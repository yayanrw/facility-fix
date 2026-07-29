# Notifikasi Email

Satu cron harian. Dua jenis email. Tidak ada antrean, tidak ada worker, tidak ada tabel jadwal.

## Jadwal

```ts
// vercel.ts
import { type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  crons: [{ path: '/api/cron/deadline', schedule: '0 0 * * *' }], // 00:00 UTC = 07:00 WIB
};
```

Cron Vercel berjalan dalam UTC. `0 0 * * *` menghasilkan pukul 07:00 WIB — pagi hari kerja, sebelum orang menumpuk pekerjaan.

Endpoint dilindungi `CRON_SECRET`:

```ts
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // ...
}
```

---

## Dua jenis email

Keduanya hanya menyasar pengajuan yang **belum tuntas** — `status <> 'approved'`. Status `approved` terminal, jadi tidak ada yang perlu diingatkan lagi.

### 1. Pengingat H-3

```sql
select * from submissions
where status <> 'approved'
  and reminder_sent_at is null
  and deadline - current_date between 0 and 3;
```

Subjek: `[H-{n}] {judul} — deadline {tanggal}`

### 2. Lewat deadline

```sql
select * from submissions
where status <> 'approved'
  and overdue_sent_at is null
  and deadline < current_date;
```

Subjek: `[TERLAMBAT] {judul} — lewat {n} hari`

Rentang `between 0 and 3` mencakup hari-H itu sendiri, jadi pengajuan yang dibuat mepet tetap kebagian satu pengingat sebelum dinyatakan terlambat.

---

## Penerima

Ditentukan dari status saat email dikirim:

| Status pengajuan | Penerima |
|---|---|
| `pending_review` | Pelapor + **semua** reviewer |
| `pending_approval` | Pelapor + **semua** approver |
| `rejected` | Pelapor saja |

Alasannya: yang menahan proses harus tahu. Kalau deadline lewat sementara status masih `pending_approval`, yang telat adalah approver — mengirim email hanya ke pelapor tidak menggerakkan apa pun.

Untuk `rejected`, bola ada di tangan pelapor, jadi tidak perlu mengganggu yang lain.

Karena role bersifat tetap dan tidak ada pembatasan per unit ([02-workflow.md](02-workflow.md)), "semua reviewer" berarti seluruh baris `profiles` dengan role tersebut. Kalau nanti jumlah reviewer bertambah banyak, batasi berdasarkan `unit`.

---

## Anti-dobel kirim

Dua kolom stempel di `submissions`:

```
reminder_sent_at  timestamptz
overdue_sent_at   timestamptz
```

Setelah email terkirim, kolom yang bersangkutan diisi `now()`. Query berikutnya menyaring `is null`, jadi setiap pengajuan menerima **maksimum satu** pengingat dan **satu** peringatan terlambat.

Email terlambat dikirim sekali saja, bukan setiap hari. Peringatan harian akan diabaikan orang dalam tiga hari, dan yang paling rajin melaporkan justru yang paling terganggu.

Stempel diisi **setelah** provider email mengonfirmasi pengiriman. Kalau pengiriman gagal, kolom tetap `null` dan cron besok mencobanya lagi.

Deadline yang diubah tidak me-reset stempel. Deadline hanya bisa diatur saat submit pertama ([02-workflow.md](02-workflow.md)), jadi kasus ini tidak muncul.

---

## Isi email

Teks polos plus satu tautan. Tidak ada template HTML bertingkat.

```
Halo {nama},

Pengajuan berikut mendekati batas waktu:

  {judul}
  Jenis     : {Laporan Kerusakan | Data Sarana Fasilitas}
  Fasilitas : {code} — {nama} ({lokasi})
  Status    : {label status}
  Deadline  : {tanggal}  ({n} hari lagi | terlambat {n} hari)

Buka: {APP_URL}/submissions/{id}
```

Satu email per penerima per pengajuan. Tanpa pengelompokan ringkasan harian — sampai volumenya terbukti mengganggu, satu pengajuan satu email lebih mudah ditindaklanjuti dan lebih mudah di-debug.

---

## Provider

Provider dipilih lewat `vercel integration discover --category messaging`, bukan di-hardcode. Kategori itu hanya mengembalikan satu hasil: **Resend** (`resend/resend-email`).

Instalasinya masih **tertahan** menunggu penerimaan marketplace terms di browser — langkah legal yang harus dilakukan pemilik akun sendiri:

```
https://vercel.com/yayanrws-projects/~/integrations/accept-terms/resend?source=cli
vercel integration add resend/resend-email --no-claim   # ulangi setelah diterima
```

Kode pengiriman dibungkus satu fungsi:

```ts
// lib/email.ts
export async function sendEmail(to: string, subject: string, body: string): Promise<void>
```

Semua kredensial dari environment variable sisi server. Kalau provider berganti, hanya file ini yang berubah.

---

## Verifikasi

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/deadline
```

1. Siapkan dua pengajuan: satu `deadline = today + 2` (status `pending_review`), satu `deadline = today - 1` (status `pending_approval`)
2. Jalankan → dua email keluar. Yang pertama ke pelapor + semua reviewer, yang kedua ke pelapor + semua approver
3. Cek `reminder_sent_at` dan `overdue_sent_at` sudah terisi
4. Jalankan lagi → **nol** email
5. Set satu pengajuan `status = 'approved'` dengan deadline lampau → jalankan → tidak ada email untuk pengajuan itu
6. `curl` tanpa header authorization → 401
