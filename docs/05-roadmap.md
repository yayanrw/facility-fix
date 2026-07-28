# Roadmap Implementasi

Urutan dipilih supaya setiap langkah bisa dijalankan dan dilihat hasilnya sebelum lanjut. Tidak ada langkah yang membangun sesuatu yang baru terpakai tiga langkah kemudian.

## 0 — Provisioning

- [ ] Install Vercel CLI: `npm i -g vercel`
- [ ] Load skill `marketplace`, jalankan `vercel integration discover`
- [ ] Provision Supabase lewat marketplace (jangan buat project manual lalu tempel kredensial)
- [ ] Pilih dan provision provider email dari hasil discover
- [ ] `vercel env pull .env.local`

Provisioning lewat marketplace membuat environment variable ikut tersinkron ke Preview dan Production sekaligus. Bikin manual berarti mengurus tiga tempat.

## 1 — Scaffold & design system

- [ ] `npx create-next-app@latest . --typescript --tailwind --app --yes`
- [ ] `npx shadcn@latest init`
- [ ] Tambahkan komponen sekaligus:

```bash
npx shadcn@latest add button table dialog form input textarea select checkbox \
  badge card command popover calendar tabs skeleton sonner alert-dialog \
  dropdown-menu avatar separator label
```

- [ ] `npm i @supabase/supabase-js @supabase/ssr sanitize-html react-simple-wysiwyg zod`
- [ ] `npm i -D @types/sanitize-html`
- [ ] Definisikan CSS variable warna status di `app/globals.css` (light + dark)
- [ ] `components/status-badge.tsx` dan `components/deadline-badge.tsx` — satu-satunya tempat logika warna status
- [ ] `components/remarks-editor.tsx` — bungkus `react-simple-wysiwyg` dengan token shadcn

Aturan design system ada di [README.md](README.md#design-system). Ringkasnya: shadcn/ui satu-satunya sumber komponen, komponen di-`add` bukan ditulis ulang, pakai token tema bukan warna mentah.

**Bisa dicek:** `npm run dev` menampilkan halaman default. Render `StatusBadge` untuk keempat status dan `DeadlineBadge` untuk `-1`, `2`, `10` hari — periksa di light **dan** dark mode.

## 2 — Skema database

- [ ] `supabase/migrations/0001_init.sql` — 4 tabel + indeks + constraint ([01-data-model.md](01-data-model.md))
- [ ] `supabase/migrations/0002_rls.sql` — `auth_role()` + seluruh policy ([03-security.md](03-security.md))
- [ ] `supabase/migrations/0003_storage.sql` — bucket `facility-photos` + policy
- [ ] Trigger `on auth.users insert` → buat baris `profiles`

**Bisa dicek:** jalankan migrasi, buat user lewat dashboard Supabase, pastikan baris `profiles` muncul otomatis.

## 3 — Auth

- [ ] `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/service.ts`
- [ ] `middleware.ts` — refresh sesi, redirect belum-login ke `/login`
- [ ] `lib/auth.ts` — `getCurrentProfile()`, `requireRole(...)`
- [ ] Halaman `/login`

**Bisa dicek:** login berhasil, akses `/` tanpa login melempar ke `/login`.

## 4 — Server Actions

`app/submissions/actions.ts`:

- [ ] `createSubmission(formData)` — jenis `asset` membuat facility + submission dalam satu transaksi
- [ ] `updateSubmission(id, formData)` — hanya pemilik, hanya saat `rejected`
- [ ] `resubmit(id)` — `rejected` → `pending_review`
- [ ] `reviewAction(id, 'approve' | 'reject', remarksHtml)` — dipakai reviewer dan approver
- [ ] `lib/sanitize.ts` — `cleanRemarks()`
- [ ] Uji: dua Approve bersamaan pada submission yang sama, yang kedua harus ditolak

Setiap action membaca status dari database, bukan dari input klien. Urutan pemeriksaan ada di [03-security.md](03-security.md).

**Bisa dicek:** panggil action lewat form sederhana, verifikasi baris berubah dan `submission_actions` bertambah.

## 5 — Halaman submissions

- [ ] `/submissions` — tabel terfilter per role, kolom sisa hari
- [ ] `/submissions/new` — form dua cabang ([02-workflow.md](02-workflow.md))
- [ ] `/submissions/[id]` — detail + timeline actions + panel approve/reject
- [ ] Dialog reject dengan editor WYSIWYG, submit nonaktif saat remarks kosong
- [ ] Upload foto ke Storage, render lewat signed URL

**Bisa dicek:** alur lengkap submit → reject → revisi → approve → approve dengan tiga akun.

## 6 — Halaman facilities

- [ ] `/facilities` — hanya `is_active = true`, filter kategori/lokasi/kondisi
- [ ] `/facilities/[id]` — detail + riwayat kerusakan facility tersebut

**Bisa dicek:** aset dari pengajuan `asset` baru muncul setelah approve.

## 7 — Notifikasi

- [ ] `lib/email.ts` — `sendEmail()`
- [ ] `app/api/cron/deadline/route.ts` — dua query + stempel `*_sent_at`
- [ ] `vercel.ts` dengan entri cron

**Bisa dicek:** langkah verifikasi di [04-notifications.md](04-notifications.md).

## 8 — Dashboard & seed

- [ ] `/` — kartu jumlah per status, daftar mendekati deadline
- [ ] `supabase/seed.sql` — 4 user (satu per role), ~10 facility, pengajuan di tiap status

---

## Verifikasi end-to-end

Dijalankan di browser dengan tiga akun sebelum deploy production.

### Alur utama

1. Login **requester** → buat laporan kerusakan → deadline ter-prefill `today + 7` → ubah jadi 3 hari → submit
2. Login **reviewer** → item muncul di daftar → Reject dengan remarks berformat (bold + bullet) → status jadi `rejected`
3. Login **requester** → remarks tampil terformat di timeline → revisi → resubmit → status kembali `pending_review`, **deadline tidak berubah**
4. **Reviewer** approve → `pending_approval`
5. Login **approver** → approve → `approved`
6. Ulangi dengan jenis "data sarana" → cek aset muncul di `/facilities` **hanya setelah** approved
7. Approver reject sebuah pengajuan → requester resubmit → masuk antrean **reviewer**, bukan approver

### Keamanan

Checklist lengkap ada di [03-security.md](03-security.md). Yang paling gampang bocor:

- [ ] Requester A membuka submission milik requester B → 404
- [ ] `update({status:'approved'})` dari konsol browser → ditolak
- [ ] `update({role:'approver'})` pada profil sendiri → ditolak
- [ ] Remarks `<img src=x onerror=alert(1)>` → tersimpan bersih

### Notifikasi

- [ ] Cron dipanggil dua kali → email hanya keluar sekali
- [ ] Pengajuan `approved` dengan deadline lampau → tidak dapat email
- [ ] Cron tanpa `CRON_SECRET` → 401

---

## Sengaja belum dibuat

Bukan kelalaian — ditunda sampai ada kebutuhan nyata:

| Fitur | Tambahkan kalau |
|---|---|
| Tahap penyelesaian (In Progress → Selesai + foto bukti) | Perlu melacak perbaikan fisik, bukan hanya persetujuan |
| Pembatasan akses per unit | Jumlah reviewer bertambah dan mereka saling melihat data yang bukan urusannya |
| Multi-role per user | Ada orang yang benar-benar perlu dua kapasitas sekaligus |
| Tabel referensi kategori | Kategori bebas mulai berantakan karena salah ketik |
| Export Excel / laporan periodik | Ada yang memintanya untuk rapat |
| Notifikasi in-app | Email terbukti tidak cukup |
| Ringkasan email harian | Volume email terbukti mengganggu |
| Tabel attachment terpisah | Foto perlu caption atau urutan |
