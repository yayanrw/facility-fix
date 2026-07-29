# Facility Fix

Aplikasi web untuk **laporan kerusakan** dan **pendataan sarana fasilitas**, dengan alur persetujuan dua tahap dan pengingat deadline via email.

## Masalah yang diselesaikan

Sebelumnya pencatatan kerusakan sarana dilakukan manual. Tidak ada jejak siapa menyetujui apa, tidak ada master data aset yang terpercaya, dan tidak ada pengingat kalau penanganan lewat batas waktu.

## Alur inti

```
User input  ──►  Reviewer  ──►  Approver  ──►  Approved
                    │              │
                    └── reject ────┴──►  User revisi  ──┐
                                                        │
                    ◄───────────────────────────────────┘
```

Dua jenis pengajuan melewati alur yang sama:

- **Laporan kerusakan** — melaporkan sarana yang rusak
- **Data sarana fasilitas** — mendaftarkan aset baru ke master data

Reviewer dan approver memberi catatan (remarks) berformat kaya. Saat menolak, alasan **wajib** diisi.

## Keputusan yang sudah final

| Hal | Keputusan |
|---|---|
| Deadline | Default **7 hari sejak tanggal submit**, bisa diubah saat input |
| Tahap setelah approved | Tidak ada — `approved` adalah status terminal |
| Role | 1 user = 1 role tetap (`requester` / `reviewer` / `approver` / `admin`) |
| Reset deadline saat revisi | **Tidak direset** — supaya reject tidak jadi celah mengulur waktu |

Karena `approved` terminal dan deadline dihitung dari submit, artinya deadline = *"pengajuan ini harus sudah tuntas di-approve dalam N hari"*. Notifikasi berhenti begitu status jadi `approved`.

## Stack

| Bagian | Pilihan | Alasan |
|---|---|---|
| Framework | Next.js 16.2 App Router + TypeScript | Server Actions untuk submit/approve/reject — tanpa API layer terpisah |
| Database, Auth, Storage | Supabase | Postgres + Auth + Storage foto dalam satu provisioning |
| Hosting & cron | Vercel | `vercel.ts` crons untuk pengingat deadline harian |
| Design system | **shadcn/ui** + Tailwind | Satu-satunya sumber komponen UI — lihat [Design system](#design-system) |
| Editor remarks | `react-simple-wysiwyg` (~5 kB) | Wrapper tipis di atas `contenteditable` |
| Sanitasi HTML | `sanitize-html` di server | Wajib — remarks HTML disimpan lalu dirender balik |
| Email | Resend (via Marketplace) | Satu-satunya hasil `discover --category messaging`. Menunggu penerimaan terms |

Yang sengaja **tidak** dipakai: state management library (Server Components + Server Actions sudah cukup), NextAuth (Supabase Auth langsung), tabel attachment terpisah (cukup kolom `text[]`).

## Design system

**shadcn/ui adalah design system aplikasi ini.** Semua komponen UI diambil dari sana — bukan sebagian, bukan sebagai pelengkap library lain.

Aturannya:

- **Tidak ada UI library lain.** Tidak ada MUI, Ant Design, Chakra, atau Radix mentah di luar yang dibawa shadcn.
- **Komponen di-`add`, bukan ditulis ulang.** Butuh dialog? `npx shadcn@latest add dialog`. Jangan bikin modal sendiri.
- Komponen tinggal di `components/ui/` sebagai kode milik project — **boleh diedit langsung**, itu memang model shadcn. Bukan dependensi node_modules yang haram disentuh.
- **Komponen custom di `components/`**, disusun dari primitif shadcn. Contoh: `StatusBadge` membungkus `Badge`, `SubmissionTable` membungkus `Table`.
- **Token tema, bukan warna mentah.** Pakai `bg-background`, `text-muted-foreground`, `border-border` — jangan `bg-white`, `text-gray-500`. Warna status didefinisikan sekali di `app/globals.css` sebagai CSS variable, supaya dark mode ikut jalan tanpa kerja tambahan.
- **Notifikasi lewat `sonner`** (toast bawaan shadcn). Tidak ada `alert()`, tidak ada banner buatan sendiri.
- **Form lewat `field` + `zod` + `useActionState`.** shadcn versi Base UI **tidak lagi mengirim komponen `form`** (pembungkus react-hook-form) — penggantinya primitif `Field`, `FieldLabel`, `FieldError`, `FieldGroup`. Validasi hanya hidup di server: skema zod dipakai di Server Action, errornya dikembalikan lewat `useActionState` dan dirender oleh `FieldError`. Tidak ada react-hook-form, dan validasi klien tidak bisa menyimpang dari validasi server karena memang cuma ada satu.

Komponen yang dipakai:

```
button  table  dialog  field  input  textarea  select  checkbox
badge   card   command  popover  calendar  tabs  skeleton  sonner
alert-dialog  dropdown-menu  avatar  separator  label
```

Combobox pemilih facility disusun dari `popover` + `command` — shadcn tidak mengirim `combobox` sebagai satu komponen.

`Badge` di `components/ui/badge.tsx` ditambahi varian `success` dan `warning`, mengikuti pola tinted milik `destructive`. Ini persis yang dimaksud "komponen `ui/` boleh diedit" — bukan menambal dengan `className` di setiap pemakaian.

Satu-satunya komponen di luar shadcn adalah editor remarks (`react-simple-wysiwyg`) — shadcn tidak punya rich text editor. Editor itu dibungkus komponen sendiri di `components/remarks-editor.tsx` supaya tampilannya menyatu dengan `Textarea` (border, radius, focus ring dari token yang sama), dan supaya gampang diganti kalau nanti pindah editor.

Warna internal editor **tidak** bisa diatur lewat utility Tailwind. Dua sebab bertumpuk: Tailwind v4 menaruh utility di dalam `@layer` sedangkan CSS library unlayered (unlayered selalu menang atas layered), dan library menyuntikkan sheet-nya ke `<style>` saat runtime sehingga selalu datang belakangan. Karena itu ada satu blok CSS unlayered di `app/globals.css`, di-scope dengan `.remarks-editor` agar specificity-nya 0,2,0 melawan 0,1,0 milik library. Seluruh nilainya tetap memakai token yang sama, jadi dark mode tetap ikut otomatis.

Warna semantik status, didefinisikan sekali:

| Status | Maksud |
|---|---|
| `pending_review` | netral / menunggu |
| `pending_approval` | netral / menunggu |
| `approved` | sukses |
| `rejected` | destruktif |
| deadline `< 0` hari | destruktif |
| deadline `0..3` hari | peringatan |

Sisa hari dan status dirender lewat satu komponen `StatusBadge` dan `DeadlineBadge`. Jangan tulis logika warna di halaman — kalau ambang batas berubah, satu file saja yang disentuh.

## Index dokumen

| Dokumen | Isi |
|---|---|
| [01-data-model.md](01-data-model.md) | Skema 4 tabel, alasan desain, ERD, storage |
| [02-workflow.md](02-workflow.md) | Mesin status, aturan deadline, matriks aksi per role |
| [03-security.md](03-security.md) | RLS policy, batas Server Action, sanitasi HTML |
| [04-notifications.md](04-notifications.md) | Logika cron, penerima, anti-dobel kirim |
| [05-roadmap.md](05-roadmap.md) | Langkah implementasi + checklist verifikasi |
