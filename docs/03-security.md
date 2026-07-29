# Keamanan

Supabase mengekspos Postgres langsung ke browser lewat anon key. Artinya **menyembunyikan tombol di UI bukan keamanan** — siapa pun bisa memanggil `supabase.from('submissions').update(...)` dari konsol browser. Semua aturan akses harus hidup di Row Level Security.

## Prinsip

1. RLS aktif di **semua** tabel. Tanpa policy = tanpa akses.
2. Transisi status dan penulisan `submission_actions` hanya lewat Server Action dengan service-role client. Klien tidak pernah punya izin `UPDATE status`.
3. Service-role key hanya ada di server. Tidak pernah masuk bundle klien, tidak pernah diawali `NEXT_PUBLIC_`.
4. Setiap Server Action memeriksa ulang role dan status saat ini sebelum bertindak.
5. Aturan yang harus berlaku **untuk service role juga** ditulis sebagai trigger, bukan policy — service role melewati seluruh RLS.

Seluruh isi dokumen ini diverifikasi otomatis: `npm run test:db` menjalankan 34 pengujian langsung terhadap database (lihat [Verifikasi otomatis](#verifikasi-otomatis)).

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

Hak eksekusi dicabut dari `public` dan diberikan hanya ke `authenticated`.

Ada satu helper lagi, `facility_is_revisable(bigint)`, yang menjawab "apakah draft facility ini masih boleh diedit?" tanpa pemanggilnya perlu hak baca ke `submissions`.

---

## Pendaftaran user

Baris `profiles` dibuat trigger `on_auth_user_created`. Yang penting: **role tidak pernah dibaca dari `raw_user_meta_data`**.

```sql
-- Bukan ini:
coalesce(new.raw_user_meta_data->>'role', 'requester')
-- Tapi ini:
'requester'
```

`raw_user_meta_data` dikendalikan penyerang — `supabase.auth.signUp({ options: { data: { role: 'admin' } } })` adalah panggilan klien biasa. Semua orang mulai sebagai requester; promosi hanya lewat admin dengan service role.

`name` dan `unit` tetap diambil dari metadata karena tidak memberi hak apa pun.

---

## Catatan penulisan policy

Dua hal berlaku untuk semua policy di bawah.

**`(select auth.uid())`, bukan `auth.uid()`.** Tanpa pembungkus `select`, Postgres mengevaluasi ulang fungsi itu **sekali per baris**; dengan pembungkusnya hasilnya jadi InitPlan — sekali per statement. Ini temuan `auth_rls_initplan` dari `supabase db advisors`, diperbaiki di migrasi `0004`.

**`to authenticated`, bukan `auth.role() = 'authenticated'`.** Yang kedua sudah deprecated dan diam-diam rusak kalau anonymous sign-in diaktifkan: user anonim membawa role Postgres `authenticated` dan lolos begitu saja. Tapi `to authenticated` sendirian **bukan** otorisasi — ia hanya memeriksa role, bukan baris mana yang boleh diakses, jadi setiap policy memasangkannya dengan predikat kepemilikan.

---

## `profiles`

```sql
alter table profiles enable row level security;

create policy profiles_select on profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.auth_role()) in ('reviewer','approver','admin')
    or exists (
      select 1 from public.submission_actions a
      join public.submissions s on s.id = a.submission_id
      where a.actor_id = profiles.id
        and s.submitted_by = (select auth.uid())
    )
  );

create policy profiles_update_self on profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = (select public.auth_role()));
```

Cabang ketiga di `select` ditambahkan setelah dua layar terbukti rusak: reviewer tidak bisa melihat siapa pengaju, dan requester melihat "Ditolak oleh —" di timeline miliknya sendiri.

Perbaikannya sengaja **bukan** "semua authenticated boleh membaca semua profil" — itu akan menyerahkan direktori pegawai lengkap beserta alamat email ke siapa pun. Yang berlaku: staf melihat semua orang karena memang mengerjakan antrean, sedangkan requester hanya melihat orang yang benar-benar pernah bertindak atas pengajuannya sendiri.

`auth_role()` bersifat `stable`, jadi ia membaca snapshot awal statement — nilai role **lama**. Dengan begitu `role = public.auth_role()` berarti "role tidak boleh berubah".

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
  for update to authenticated
  using (submitted_by = auth.uid() and status = 'rejected')
  with check (submitted_by = auth.uid() and status = 'rejected');
```

- `status = 'pending_review'` di `insert` memaksa setiap pengajuan mulai dari awal alur — tidak bisa menyisipkan baris yang sudah `approved`.
- `deadline >= current_date` mencegah deadline mundur ke masa lalu.
- Policy update pemilik **tidak** mengizinkan perubahan `status`: `using` dan `with check` sama-sama mengunci `status = 'rejected'`, jadi klien bisa memperbaiki isi tapi tidak memindahkan dirinya ke tahap berikutnya. Resubmit dilakukan lewat Server Action.

Kekekalan `deadline` **tidak** ditegakkan di policy ini, melainkan di trigger — lihat bagian berikutnya.

---

## Kenapa sebagian aturan ada di trigger, bukan policy

Dua alasan:

**Policy tidak bisa membandingkan NEW dengan baris lama tanpa risiko rekursi.** Mengunci deadline lewat `with check (deadline = (select deadline from submissions where id = submissions.id))` berarti subquery ke tabel yang sedang dilindungi policy itu sendiri. Trigger melihat `OLD` dan `NEW` langsung.

**Policy tidak berlaku untuk service role.** Server Action kita memakai service-role key yang melewati seluruh RLS. Aturan yang harus benar *apa pun* yang menulis — deadline kekal, audit trail append-only — karena itu ditulis sebagai trigger.

| Trigger | Aturan |
|---|---|
| `submissions_guard_immutables` | `deadline`, `type`, `submitted_by`, `facility_id` tidak bisa berubah setelah insert |
| `submissions_guard_facility` | Damage harus menunjuk facility `is_active`; asset harus menunjuk draft milik pengaju sendiri |
| `submission_actions_append_only` | `UPDATE` dan `DELETE` di audit trail selalu gagal |
| `on_auth_user_created` | Setiap auth user dapat profil, role dipaksa `requester` |

Constraint `reject_requires_remarks` di tabel `submission_actions` menolak penolakan tanpa alasan, termasuk `<p><br></p>` yang dihasilkan contenteditable kosong.

FK `submission_actions.submission_id` memakai `on delete restrict`, bukan `cascade` — trigger append-only akan menggagalkan cascade delete, jadi `restrict` menyatakan aturan sebenarnya: submission yang punya riwayat tidak bisa dihapus.

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

Bucket `facility-photos` privat, batas 10 MB, MIME dibatasi ke `image/jpeg|png|webp|heic`.

Path objek: **`{auth.uid()}/{uuid}.{ext}`**.

```sql
create policy facility_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'facility-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- select dan delete memakai predikat yang sama
```

Folder dikunci ke **uploader**, bukan ke submission. Ini bukan preferensi gaya: upload terjadi saat user masih mengisi form, sebelum baris `submissions` ada, jadi tidak ada submission id untuk dipakai sebagai kunci. Pola per-uploader adalah satu-satunya yang bisa ditegakkan di titik itu.

Klien hanya membaca folder miliknya sendiri (untuk preview di form). Reviewer dan approver melihat foto lewat signed URL berumur pendek yang dibuat server dengan service role, yang melewati RLS.

Bucket sengaja tidak publik — foto kerusakan bisa memuat informasi lokasi internal.

---

## Server Actions dan RPC

Semua transisi status lewat `app/(app)/submissions/actions.ts` memakai service-role client, dan setiap transisi dieksekusi sebagai **satu fungsi Postgres** — bukan beberapa panggilan `supabase-js` berurutan.

Alasannya: `supabase-js` tidak punya transaksi. Setiap transisi menulis dua sampai tiga tabel (status + audit, facility + submission, status + audit + penerbitan facility). Kalau proses mati di tengah, hasilnya facility yatim atau perubahan status tanpa jejak audit. Satu panggilan RPC = satu transaksi.

| Fungsi | Menulis |
|---|---|
| `create_damage_submission` | `submissions` + `submission_actions` |
| `create_asset_submission` | `facilities` (draft) + `submissions` + `submission_actions` |
| `resubmit_submission` | `submissions.status` + `submission_actions` |
| `review_submission` | `submissions.status` + `submission_actions` (+ `facilities.is_active` saat approve final) |

### Kenapa `security invoker`, bukan `security definer`

Fungsi `security definer` di schema `public` **dapat dipanggil `anon` dan `authenticated` secara default** — Postgres memberi `EXECUTE` ke `PUBLIC` untuk setiap fungsi baru. Itu menjadikannya endpoint API publik yang bisa dipanggil dari browser dengan anon key.

Karena itu keempatnya `security invoker`, dengan:

```sql
revoke all on function public.review_submission(bigint, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_submission(bigint, uuid, text, text)
  to service_role;
```

`service_role` sudah melewati RLS, jadi `definer` tidak memberi kemampuan tambahan — hanya risiko. Pengujian `authenticated users cannot call the workflow functions directly` menjaga ini tetap benar.

### Urutan pemeriksaan

```
1. Ambil profil dari sesi              → belum login? tolak
2. Validasi input dengan zod
3. Sanitasi remarks HTML
4. Panggil RPC:
   a. lock baris submission (for update)
   b. baca status dan role AKTUAL dari database
   c. cek role boleh bertindak di status itu
   d. update status + insert audit (+ terbitkan facility)
```

Langkah 4b memakai status dari **database**, bukan dari input klien. Kalau dua reviewer sama-sama menekan Setujui, `for update` membuat pemanggil kedua memblokir sampai yang pertama commit, lalu ia membaca status yang sudah maju dan gagal di 4c — bukan menyetujui dua kali. Ini diuji langsung dengan dua koneksi Postgres di `test/integration/concurrency.test.ts`.

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
| `POSTGRES_URL_NON_POOLING` | server | Koneksi Postgres langsung. Dipakai migrasi dan `npm run test:db` |
| `CRON_SECRET` | server | Melindungi `/api/cron/deadline` |
| `RESEND_API_KEY` | server | Diisi saat integrasi Resend selesai di-provision |

Semua diisi otomatis oleh `vercel env pull` setelah integrasi Marketplace ter-provision — tidak ada yang ditulis tangan.

Pemisahan ditegakkan bukan hanya oleh konvensi penamaan: `lib/supabase/service.ts` dan `lib/auth.ts` mengimpor `server-only`, jadi mengimpornya dari Client Component adalah **error saat build**, bukan kebocoran key yang baru ketahuan di produksi.

---

## Verifikasi otomatis

```bash
npm run typecheck && npm run lint && npm test && npm run test:db
```

`npm run test:db` menjalankan **51 pengujian langsung terhadap Postgres**, bukan lewat mock. Tiap user disimulasikan dengan `set local role authenticated` + `set_config('request.jwt.claims', …)` — persis konteks yang dilihat policy saat request nyata datang dari browser.

Seluruhnya berjalan dalam satu transaksi yang di-rollback di akhir, jadi bisa dijalankan berulang kali terhadap project hidup tanpa meninggalkan satu baris pun. Ini penting karena audit trail memang append-only dan submission tidak bisa dihapus — tanpa rollback, tiap run akan menumpuk sampah permanen.

Harness membedakan dua bentuk penolakan RLS: `INSERT`/`UPDATE` yang melanggar `with check` melempar error, sedangkan `using` yang menyaring baris hanya mengembalikan **nol baris tanpa error**. Pengujian yang cuma mencari exception akan lulus padahal datanya bocor.

Yang tercakup:

| Kelompok | Isi |
|---|---|
| Trigger signup | Profil otomatis dibuat; `role: 'admin'` dari metadata diabaikan |
| Schema guards | Deadline/type/submitter/facility kekal; severity per jenis; facility guard; `quantity > 0`; reject tanpa remarks ditolak; audit append-only |
| RLS profiles | Tidak bisa promosi diri; bisa ubah nama sendiri; tidak bisa baca profil orang lain; admin baca semua |
| RLS facilities | Tidak bisa insert `is_active=true`; tidak bisa publish draft sendiri; draft terkunci kecuali saat `rejected`; tidak bisa memalsukan `created_by`; draft orang lain tak terlihat; reviewer melihat draft |
| RLS submissions | Tidak bisa insert status `approved`; deadline lampau ditolak; tidak bisa approve/resubmit sendiri; pengajuan pending beku bagi pemiliknya; requester lain tidak bisa membaca; reviewer/approver melihat antrean |
| RLS actions | Tidak ada satu pun role yang bisa menulis audit trail; pemilik dan staf bisa membaca, orang luar tidak |
| RPC workflow | Alur approve/reject/resubmit; asset terbit tepat saat approve final; kode duplikat tidak meninggalkan facility yatim; requester tak bisa menyetujui pengajuannya sendiri; approver tak bisa melompati tahap review |
| Exposure RPC | `authenticated` tidak bisa memanggil `review_submission`, `resubmit_submission`, atau `create_damage_submission` secara langsung |
| Balapan | Dua koneksi Postgres menyetujui bersamaan: yang kedua ditolak, audit trail tetap berisi satu `approve` |

`npm test` menambahkan 9 pengujian sanitasi HTML di `test/sanitize.test.ts`: `<script>`, `<img onerror>`, `onclick`, `javascript:`, `JaVaScRiPt:`, `data:text/html`, `<iframe>`, `<object>`, `<style>`, dan `<svg onload>` semuanya tidak lolos, sementara bold/italic/list/link `https` tetap utuh.

Diuji sebagai unit, bukan lewat browser: kalau sanitasi gagal, payload di browser akan memicu `alert()` yang membekukan seluruh sesi otomasi. Pengujian unit memberi sinyal yang sama tanpa risiko itu.

## Advisors

```bash
supabase db advisors --db-url "$POSTGRES_URL_NON_POOLING"
```

Bersih per migrasi `0006`. Yang sempat ditemukan dan sudah diperbaiki:

- `auth_rls_initplan` (9 policy) — `auth.uid()`/`auth_role()` dievaluasi per baris
- `function_search_path_mutable` (3 fungsi) — `touch_updated_at`, `guard_submission_immutables`, `forbid_action_mutation` tanpa `set search_path`

## Checklist manual

Yang belum bisa diotomatiskan, dijalankan sebelum rilis:

- [x] Buka `/` tanpa sesi → dilempar ke `/login?next=/`
- [x] `grep -rn "SERVICE_ROLE" app/ components/` → tidak muncul di komponen klien
- [ ] `curl` ke `/api/cron/deadline` tanpa `CRON_SECRET` → 401 *(menunggu step 7)*
- [ ] Konfirmasi tabel baru ter-expose ke Data API — sejak 2026-05-30 tabel di schema `public` **tidak lagi otomatis** ter-expose. Empat tabel saat ini sudah dicek terjangkau; ulangi untuk tabel baru.
