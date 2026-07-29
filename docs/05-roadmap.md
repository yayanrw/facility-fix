# Roadmap Implementasi

Urutan dipilih supaya setiap langkah bisa dijalankan dan dilihat hasilnya sebelum lanjut. Tidak ada langkah yang membangun sesuatu yang baru terpakai tiga langkah kemudian.

**Status: step 0–8 selesai.** Perintah verifikasi: `npm run typecheck && npm run lint && npm test && npm run test:db && npm run build`.

## 0 — Provisioning ✅

- [x] Install Vercel CLI: `npm i -g vercel` (v58.0.0)
- [x] Load skill `marketplace`, jalankan `vercel integration discover`
- [x] `vercel link` → project `yayanrws-projects/facility-fix`
- [x] Provision Supabase lewat marketplace
- [ ] **Provision Resend** — terhenti menunggu penerimaan marketplace terms di browser
- [x] `vercel env pull` (otomatis dijalankan integrasi)

Provisioning lewat marketplace membuat environment variable ikut tersinkron ke Preview dan Production sekaligus. Bikin manual berarti mengurus tiga tempat.

Provider email dipilih dari `vercel integration discover --category messaging`, yang hanya mengembalikan satu hasil: **Resend** (`resend/resend-email`). Instalasinya butuh penerimaan terms di browser — langkah legal yang harus dilakukan pemilik akun sendiri:

```
https://vercel.com/yayanrws-projects/~/integrations/accept-terms/resend?source=cli
vercel integration add resend/resend-email --no-claim   # ulangi setelah diterima
```

Belum menghalangi apa pun sampai step 7.

## 1 — Scaffold & design system ✅

- [x] `create-next-app` → Next.js 16.2.12, React 19.2.4, Tailwind 4, Turbopack
- [x] `npx shadcn@latest init -d --yes`
- [x] Tambahkan komponen sekaligus:

```bash
npx shadcn@latest add button table dialog field input textarea select checkbox \
  badge card command popover calendar tabs skeleton sonner alert-dialog \
  dropdown-menu avatar separator label
```

- [x] `npm i @supabase/supabase-js @supabase/ssr sanitize-html react-simple-wysiwyg zod server-only`
- [x] `npm i -D @types/sanitize-html pg @types/pg`
- [x] Token `--success` / `--warning` di `app/globals.css` (light + dark), varian `success`/`warning` di `Badge`
- [x] `components/status-badge.tsx` dan `components/deadline-badge.tsx`
- [x] `components/remarks-editor.tsx` + blok CSS `.remarks-editor` di `globals.css`

Aturan design system ada di [README.md](README.md#design-system).

Dua kejutan yang mengubah rencana:

- **shadcn tidak lagi punya komponen `form`.** Versi Base UI menggantinya dengan primitif `field`. Konsekuensinya react-hook-form tidak dipakai sama sekali; validasi jalan lewat zod di Server Action dan dikembalikan lewat `useActionState`.
- **Utility Tailwind tidak bisa menembus CSS react-simple-wysiwyg.** Butuh blok CSS unlayered ber-scope `.remarks-editor`; alasan lengkapnya di README.

**Terverifikasi:** `StatusBadge` untuk keempat status dan `DeadlineBadge` untuk `-1`, `0`, `2`, `10` hari sudah dilihat di light **dan** dark mode; `approved` benar tidak merender apa pun.

## 2 — Skema database ✅

- [x] `supabase/migrations/0001_init.sql` — 4 tabel, indeks, constraint, trigger ([01-data-model.md](01-data-model.md))
- [x] `supabase/migrations/0002_rls.sql` — `auth_role()`, `facility_is_revisable()`, seluruh policy ([03-security.md](03-security.md))
- [x] `supabase/migrations/0003_storage.sql` — bucket `facility-photos` + policy
- [x] Trigger `on_auth_user_created` → buat baris `profiles`

Diterapkan dengan `supabase db push --db-url "$POSTGRES_URL_NON_POOLING"` (tanpa `supabase link`).

Dua perbaikan keamanan yang muncul saat menulis migrasi:

- **`role` tidak boleh dibaca dari `raw_user_meta_data`.** Field itu dikendalikan klien, jadi rancangan awal memungkinkan siapa pun mendaftar sebagai admin. Sekarang dipaksa `requester`.
- **Aturan kekal ditaruh di trigger, bukan `with check`.** Policy tidak berlaku untuk service role dan tidak bisa membandingkan `NEW` dengan `OLD` tanpa risiko rekursi.

**Terverifikasi:** `npm run test:db` — 34 pengujian, semua lolos, transaksi di-rollback (nol residu, sudah dicek).

## 3 — Auth ✅

- [x] `lib/supabase/{env,server,client,service}.ts`
- [x] `proxy.ts` — refresh sesi + redirect belum-login ke `/login?next=…`
- [x] `lib/auth.ts` — `getCurrentProfile()`, `requireProfile()`, `requireRole()`
- [x] Halaman `/login` + `app/login/actions.ts` (`signIn`, `signOut`)
- [x] `app/page.tsx` sementara menampilkan profil + tombol Keluar

**`proxy.ts`, bukan `middleware.ts`** — Next 16 mengganti nama konvensi ini; `middleware.ts` masih jalan tapi memunculkan peringatan deprecation, dan menaruh keduanya adalah error build.

Catatan implementasi:

- `supabase.auth.getUser()` di proxy, bukan `getSession()` — yang kedua percaya begitu saja pada cookie yang dikirim browser.
- Pesan gagal login sengaja generik ("Email atau password salah"); membedakan "email tidak ada" dari "password salah" mengubah form login jadi alat enumerasi akun.
- Parameter `next` divalidasi harus diawali `/` dan bukan `//`, supaya tidak jadi open redirect.
- `lib/auth.ts` dan `lib/supabase/service.ts` mengimpor `server-only`: mengimpornya dari Client Component jadi **error build**, bukan kebocoran key.

**Terverifikasi di browser:** `/` tanpa sesi → 307 ke `/login?next=%2F`; password salah → pesan generik + `aria-invalid`; login benar → `/` menampilkan nama, role "Pelapor", unit dari metadata; Keluar → kembali ke `/login`. User verifikasi sudah dihapus setelahnya.

## 4 — Server Actions ✅

`app/(app)/submissions/actions.ts`:

- [x] `createSubmission(formData)` — jenis `asset` membuat facility + submission dalam satu transaksi
- [x] `updateSubmission(id, formData)` — hanya pemilik, hanya saat `rejected`
- [x] `resubmit(id)` — `rejected` → `pending_review`
- [x] `reviewAction(id, 'approve' | 'reject', remarksHtml)` — dipakai reviewer dan approver
- [x] `lib/sanitize.ts` — `cleanRemarks()`, `lib/schemas.ts` — skema zod
- [x] Uji dua Approve bersamaan: yang kedua ditolak

Setiap action membaca status dari database, bukan dari input klien.

**Transaksi turun ke Postgres.** `supabase-js` tidak punya transaksi, sedangkan setiap transisi menulis dua sampai tiga tabel sekaligus — status + audit, atau facility + submission, atau status + audit + penerbitan facility. Dua panggilan terpisah dari Node berarti crash di tengah meninggalkan facility yatim atau perubahan status tanpa jejak audit. Karena itu `supabase/migrations/0005_workflow.sql` berisi empat fungsi: `create_damage_submission`, `create_asset_submission`, `resubmit_submission`, `review_submission`. Satu panggilan = satu transaksi.

Fungsi-fungsi itu **`security invoker`**, bukan `security definer`, dan `execute`-nya dicabut dari `public`/`anon`/`authenticated` lalu diberikan hanya ke `service_role`. Fungsi `security definer` di schema `public` bisa dipanggil siapa saja dengan anon key — persis lubang yang sedang dihindari. `service_role` sudah melewati RLS, jadi `definer` tidak memberi apa pun.

Pengaman double-approve adalah `select … for update` di dalam `review_submission`: pemanggil kedua memblokir di baris itu, lalu membaca status yang sudah maju dan gagal di pemeriksaan role.

**Terverifikasi:** `npm run test:db` — 15 pengujian RPC di `test/integration/workflow.test.ts` + 2 pengujian balapan di `test/integration/concurrency.test.ts`. `npm test` — 9 pengujian sanitasi di `test/sanitize.test.ts` (script, img/onerror, `javascript:`, `data:`, iframe, svg/onload).

## 5 — Halaman submissions ✅

- [x] `/submissions` — tabel terfilter per role + chip filter status berisi jumlah
- [x] `/submissions/new` — form dua cabang ([02-workflow.md](02-workflow.md))
- [x] `/submissions/[id]` — detail + timeline actions + panel approve/reject + form revisi
- [x] Dialog reject dengan editor WYSIWYG, submit nonaktif saat remarks kosong
- [x] Upload foto ke Storage, render lewat signed URL

Daftar **tidak** memfilter per role di TypeScript. Policy `submissions_select` sudah membatasi requester ke barisnya sendiri dan membuka antrean untuk staf; menulis ulang filter itu di query layer menciptakan sumber kebenaran kedua yang bisa berbeda dari policy.

Rute dipindah ke route group `app/(app)/` supaya nav bar hidup di satu layout dan `/login` tetap di luarnya.

## 6 — Halaman facilities ✅

- [x] `/facilities` — hanya `is_active = true`, filter kategori/lokasi/kondisi + pencarian kode/nama
- [x] `/facilities/[id]` — detail + riwayat kerusakan facility tersebut

Filter memakai form `GET`, jadi hasil tersaring ada di URL — bisa dibagikan dan tahan refresh.

**Terverifikasi di browser, tiga akun** (`req@`, `rev@`, `app@ff.test`):

1. Requester ajukan data sarana → deadline prefill 2026-08-04 (hari ini + 7)
2. `/facilities` masih kosong — sarana belum terbit
3. Reviewer lihat antrean, nama pengaju tampil, tolak dengan remarks **bold + bullet**
4. Requester lihat remarks terformat, ubah kode aset, simpan revisi, ajukan ulang → status kembali **Menunggu Review**, deadline **tetap** 2026-08-04
5. Reviewer setujui → Menunggu Approval; approver setujui → Disetujui, badge deadline hilang
6. `/facilities` menampilkan sarana dengan kode hasil revisi
7. Requester buat laporan kerusakan pada sarana itu, deadline diubah ke 3 hari → badge kuning "3 hari lagi"
8. `/facilities/45` menampilkan laporan itu di Riwayat kerusakan
9. Light dan dark mode, console browser bersih

Butir 7 pada daftar verifikasi lama — penolakan approver yang direvisi harus masuk antrean **reviewer** — dicakup pengujian otomatis `a rejection by the approver still returns to the reviewer`.

## 7 — Notifikasi ✅

- [x] `lib/notification-content.ts` — format subjek/isi email, murni tanpa `server-only` supaya bisa diuji lewat `npm test`
- [x] `lib/notifications.ts` — `runDeadlineCron()`, dua query + stempel `*_sent_at`
- [x] `lib/email.ts` — `sendEmail()` lewat fetch langsung ke Resend REST API (tanpa SDK tambahan)
- [x] `lib/cron-auth.ts` + `app/api/cron/deadline/route.ts` — endpoint dilindungi `CRON_SECRET`
- [x] `vercel.ts` dengan entri cron (`0 0 * * *`)
- [x] `CRON_SECRET` sudah diprovisikan ke Production/Preview/Development lewat `vercel env add`

Satu kejutan: `lib/notifications.ts` mengimpor `"server-only"`, yang **throw** begitu diimpor di luar kondisi `react-server` — termasuk lewat `node --test` biasa. `npm run test:db` karena itu menambahkan `--conditions=react-server` supaya modul itu resolve ke stub kosongnya, bukan melempar error.

**Terverifikasi:** `npm test` — 8 pengujian murni untuk format subjek/isi email dan `isAuthorizedCron` (`test/notifications.test.ts`). `npm run test:db` — `test/integration/notifications.test.ts` membuat baris submission committed (lewat koneksi `pg` mentah, sama seperti `concurrency.test.ts`, karena `runDeadlineCron` membaca lewat PostgREST — koneksi terpisah yang tidak melihat transaksi yang di-rollback), lalu memanggil `runDeadlineCron` dengan `sendEmail` tiruan: pengingat H-3 dan lewat-deadline terkirim ke penerima yang benar, `approved` dan di luar jendela dilewati, stempel mencegah kirim dobel pada `run` kedua.

Resend **masih tertahan** menunggu penerimaan marketplace terms di browser (langkah pemilik akun, bukan sesuatu yang bisa CLI selesaikan):

```
https://vercel.com/yayanrws-projects/~/integrations/accept-terms/resend?source=cli
vercel integration add resend/resend-email --no-claim   # ulangi setelah diterima, lalu vercel env pull
```

Sampai itu selesai, `RESEND_API_KEY` belum ada di environment dan `sendEmail()` akan gagal saat benar-benar dipanggil — tapi seluruh jalur di atasnya (query, penerima, format, stempel) sudah teruji lewat `send` tiruan.

## 8 — Dashboard & seed ✅

- [x] `/` — kartu jumlah per status (klik untuk filter), daftar "Mendekati deadline" (5 teratas, `status <> 'approved'`, urut deadline)
- [x] `supabase/seed.sql` — 4 user (`req@`/`rev@`/`app@`/`admin@ff.test`, password `FlowTest!2026`), 9 facility langsung + 1 lewat asset submission yang di-approve, submission di tiap status

Seed sudah dijalankan terhadap project dev, menggantikan data verifikasi step 5–6:

| Isi | Jumlah |
|---|---|
| User | 4 — satu per role |
| Facility terbit | 10 |
| Submission | 5 — 2× `pending_review`, 1× `pending_approval`, 1× `rejected`, 1× `approved` |

Skrip idempoten — aman dijalankan ulang (`node -e "..." "$DBURL"` dengan isi `supabase/seed.sql`, atau `psql "$DBURL" -f supabase/seed.sql`). Dua kejutan yang baru ketahuan saat menulis dan menjalankannya sungguhan lewat login browser, bukan lewat RPC test harness:

- **`session_replication_role = replica`, yang dibutuhkan untuk melewati trigger append-only `submission_actions`, juga membungkam trigger `on delete cascade`.** Baris `profiles` untuk akun lama jadi tidak ikut terhapus, meninggalkan baris yatim dengan email yang sama — kelihatan sebagai profil dobel. Perbaikannya: hapus `public.profiles` secara eksplisit di skrip cleanup, jangan bergantung pada cascade dari `auth.users`.
- **Insert manual ke `auth.users` belum cukup untuk login sungguhan.** GoTrue butuh baris `auth.identities` (provider `email`) juga, dan kolom `*_token`/`*_change` yang defaultnya `NULL` harus diisi `''` secara eksplisit — kalau tidak, login gagal dengan `500 Database error querying schema`, bukan pesan yang jelas. Test harness (`test/integration/db.ts`) tidak pernah menabrak ini karena dia hanya meng-impersonate lewat `request.jwt.claims`, tidak pernah login sungguhan lewat GoTrue.

**Terverifikasi di browser:** login `req@`/`rev@ff.test` dengan password seed, dashboard menampilkan kartu jumlah dan daftar deadline yang benar untuk kedua role, `/facilities` menampilkan seluruh 10 sarana termasuk yang terbit lewat asset submission yang di-approve, console bersih.

---

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Build produksi |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Logika domain + sanitasi HTML (21 pengujian, tanpa jaringan) |
| `npm run test:db` | RLS, schema guard, RPC workflow, dan balapan approve terhadap Postgres nyata (51 pengujian) |

Test memakai runner bawaan Node (`node --test`) dengan type stripping — tanpa Jest, Vitest, atau konfigurasi tambahan. `tsconfig.json` menyalakan `allowImportingTsExtensions` karena type stripping mewajibkan ekstensi `.ts` pada import.

`npm test` bebas jaringan dan aman dijalankan kapan pun. `npm run test:db` menyentuh project Supabase asli tetapi membungkus semuanya dalam transaksi yang di-rollback.

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

Sudah **otomatis** lewat `npm run test:db` — termasuk requester A tidak bisa membaca submission requester B, `status:'approved'` ditolak, dan `role:'approver'` pada profil sendiri ditolak. Rincian di [03-security.md](03-security.md).

Sisa yang masih manual:

- [ ] Remarks `<img src=x onerror=alert(1)>` → tersimpan bersih *(menunggu step 4)*

### Notifikasi

Ketiganya sudah tercakup otomatis di `test/integration/notifications.test.ts` dan `test/notifications.test.ts` lewat `send` tiruan (lihat step 7) — belum diverifikasi dengan email **sungguhan** karena Resend belum diprovisikan:

- [x] Cron dipanggil dua kali → email hanya keluar sekali *(diverifikasi lewat test, bukan Resend sungguhan)*
- [x] Pengajuan `approved` dengan deadline lampau → tidak dapat email *(diverifikasi lewat test)*
- [x] Cron tanpa `CRON_SECRET` → 401 *(diverifikasi lewat test)*
- [ ] `curl` terhadap cron yang benar-benar mengirim lewat Resend *(menunggu provisioning)*

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
