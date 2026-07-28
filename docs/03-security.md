# Keamanan

Supabase mengekspos Postgres langsung ke browser lewat anon key. Artinya **menyembunyikan tombol di UI bukan keamanan** — siapa pun bisa memanggil `supabase.from('submissions').update(...)` dari konsol browser. Semua aturan akses harus hidup di Row Level Security.

## Prinsip

1. RLS aktif di **semua** tabel. Tanpa policy = tanpa akses.
2. Transisi status dan penulisan `submission_actions` hanya lewat Server Action dengan service-role client. Klien tidak pernah punya izin `UPDATE status`.
3. Service-role key hanya ada di server. Tidak pernah masuk bundle klien, tidak pernah diawali `NEXT_PUBLIC_`.
4. Setiap Server Action memeriksa ulang role dan status saat ini sebelum bertindak.

---

## Helper

```sql
create or replace function public.auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;
```

`security definer` diperlukan supaya fungsi ini bisa membaca `profiles` tanpa terjerat policy `profiles` sendiri (rekursi tak berujung). `set search_path` mencegah pembajakan search_path — wajib di setiap fungsi `security definer`.

---

## `profiles`

```sql
alter table profiles enable row level security;

create policy profiles_select_self on profiles
  for select using (id = auth.uid() or auth_role() = 'admin');

create policy profiles_update_self on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));
```

User boleh mengubah nama dan unit sendiri, **tidak** rolenya. Klausa `with check` mengunci itu — tanpa ini, requester bisa mempromosikan diri jadi approver dengan satu panggilan.

Perubahan role hanya lewat admin di server.

---

## `facilities`

```sql
alter table facilities enable row level security;

create policy facilities_select on facilities
  for select using (
    is_active
    or created_by = auth.uid()
    or auth_role() in ('reviewer','approver','admin')
  );

create policy facilities_insert on facilities
  for insert with check (
    created_by = auth.uid()
    and auth_role() in ('requester','admin')
    and not is_active
  );

create policy facilities_update_owner on facilities
  for update using (
    created_by = auth.uid()
    and not is_active
    and exists (
      select 1 from submissions s
      where s.facility_id = facilities.id and s.status = 'rejected'
    )
  )
  with check (not is_active);
```

Poin penting:

- Facility baru **selalu** lahir `is_active = false`. Klausa `not is_active` di `insert` mencegah requester langsung menerbitkan aset ke master tanpa persetujuan.
- Pemilik hanya bisa mengedit selama pengajuannya `rejected`. Setelah masuk antrean review, data terkunci — reviewer tidak boleh menilai sasaran yang bergerak.
- `with check (not is_active)` di `update` menutup celah aktivasi diri sendiri.
- Mengubah `is_active` jadi `true` hanya bisa lewat service role saat approve.

---

## `submissions`

```sql
alter table submissions enable row level security;

create policy submissions_select on submissions
  for select using (
    submitted_by = auth.uid()
    or auth_role() in ('reviewer','approver','admin')
  );

create policy submissions_insert on submissions
  for insert with check (
    submitted_by = auth.uid()
    and auth_role() in ('requester','admin')
    and status = 'pending_review'
    and deadline >= current_date
  );

create policy submissions_update_owner on submissions
  for update using (submitted_by = auth.uid() and status = 'rejected')
  with check (
    submitted_by = auth.uid()
    and status = 'rejected'
    and deadline = (select deadline from submissions s2 where s2.id = submissions.id)
  );
```

- `status = 'pending_review'` di `insert` memaksa setiap pengajuan mulai dari awal alur — tidak bisa menyisipkan baris yang sudah `approved`.
- `deadline >= current_date` mencegah deadline mundur ke masa lalu.
- Policy update pemilik **tidak** mengizinkan perubahan `status`: `using` dan `with check` sama-sama mengunci `status = 'rejected'`, jadi klien bisa memperbaiki isi tapi tidak memindahkan dirinya ke tahap berikutnya. Resubmit dilakukan lewat Server Action.
- Klausa `deadline = (...)` mengunci deadline saat revisi, sesuai aturan di [02-workflow.md](02-workflow.md).

---

## `submission_actions`

```sql
alter table submission_actions enable row level security;

create policy actions_select on submission_actions
  for select using (
    exists (
      select 1 from submissions s
      where s.id = submission_actions.submission_id
        and (s.submitted_by = auth.uid() or auth_role() in ('reviewer','approver','admin'))
    )
  );
```

Tidak ada policy `insert`, `update`, atau `delete` untuk klien — **disengaja**. Audit trail hanya ditulis service role, dan tidak pernah diubah atau dihapus oleh siapa pun.

---

## Storage

Bucket `facility-photos` privat.

```sql
create policy photos_insert on storage.objects
  for insert with check (
    bucket_id = 'facility-photos' and auth.uid() is not null
  );

create policy photos_select on storage.objects
  for select using (
    bucket_id = 'facility-photos' and auth.uid() is not null
  );
```

Foto ditampilkan lewat signed URL berumur pendek yang dibuat di server. Bucket sengaja tidak publik — foto kerusakan bisa memuat informasi lokasi internal.

---

## Server Actions

Semua transisi status lewat `app/submissions/actions.ts` memakai service-role client. Setiap action menjalankan urutan yang sama:

```
1. Ambil profil dari sesi          → belum login? tolak
2. Baca submission saat ini        → tidak ada? tolak
3. Cek role boleh bertindak di status ini
4. Sanitasi remarks HTML
5. Kalau reject: pastikan remarks tidak kosong
6. Transaksi: update status + insert submission_actions
```

Langkah 3 memakai status dari **database**, bukan dari input klien. Kalau dua reviewer membuka halaman yang sama lalu keduanya menekan Approve, yang kedua akan melihat status sudah bukan `pending_review` dan ditolak — bukan mengaproval dua kali.

Aksi approve untuk `type = 'asset'` di tahap approver juga menyetel `facilities.is_active = true` dalam transaksi yang sama.

---

## Sanitasi HTML

Remarks disimpan sebagai HTML lalu dirender kembali ke pengguna lain — ini jalur XSS langsung. Sanitasi dilakukan **di server, saat menulis**, tidak saat membaca dan tidak di klien.

```ts
import sanitizeHtml from 'sanitize-html';

export function cleanRemarks(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: ['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'ul', 'ol', 'li', 'a'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
  });
}
```

Sanitasi saat menulis, bukan saat membaca: data yang tersimpan dijamin bersih, jadi tidak ada risiko satu jalur render lupa membersihkan. Tanpa `<img>` dan `<script>` di daftar izin, `onerror` dan sejenisnya tidak punya tempat menempel.

Editor WYSIWYG di klien hanya soal kenyamanan — apa pun yang dikirimnya tetap melewati fungsi ini.

---

## Environment variables

| Nama | Sisi | Catatan |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | klien | Aman diekspos |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | klien | Aman — RLS yang jadi penjaga |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **Melewati semua RLS.** Jangan pernah diberi awalan `NEXT_PUBLIC_` |
| `CRON_SECRET` | server | Melindungi `/api/cron/deadline` |
| kredensial email | server | Ditentukan saat provisioning provider |

---

## Checklist verifikasi keamanan

Dijalankan sebelum rilis:

- [ ] Login sebagai requester A, buka `/submissions/{id}` milik requester B → 404
- [ ] Dari konsol browser sebagai requester: `supabase.from('submissions').update({status:'approved'}).eq('id', <milik sendiri>)` → ditolak
- [ ] Dari konsol browser sebagai requester: `supabase.from('profiles').update({role:'approver'}).eq('id', <diri sendiri>)` → ditolak
- [ ] Dari konsol browser: `supabase.from('facilities').update({is_active:true})` → ditolak
- [ ] Dari konsol browser: `supabase.from('submission_actions').insert(...)` → ditolak
- [ ] Kirim remarks `<img src=x onerror=alert(1)>` → tersimpan bersih, tidak ada eksekusi saat detail dibuka
- [ ] `grep -r "SERVICE_ROLE" app/ components/` → tidak ada hasil di komponen klien
- [ ] `curl` ke `/api/cron/deadline` tanpa `CRON_SECRET` → 401
