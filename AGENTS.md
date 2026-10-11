# KASIR NOVA — AGENTS.md

> Dokumen ini berisi **arahan kerja** dan **aturan wajib** bagi setiap agent/AI
> yang mengerjakan proyek KASIR NOVA. **Baca dokumen ini beserta seluruh isi
> `docs/` sebelum mengubah kode.**
>
> Acuan proyek: `docs/01-arsitektur.md` … `docs/08-api-auth.md`, roadmap di
> `docs/05-roadmap.md`, dan seluruh keputusan arsitektur/bisnis yang telah
> disetujui pemilik proyek.

---

# KASIR NOVA — AUTONOMOUS DEVELOPMENT DIRECTIVE

Mulai sekarang, lanjutkan pengembangan KASIR NOVA secara mandiri berdasarkan MASTER PLAN, roadmap, AGENTS.md, dan keputusan arsitektur yang telah ditetapkan.

Anda diberi kewenangan untuk:

1. Menentukan urutan pengerjaan teknis berdasarkan dependensi antarfitur.
2. Membuat dan memperbaiki kode secara bertahap.
3. Melakukan refactoring apabila diperlukan tanpa mengubah keputusan bisnis.
4. Menjalankan pengujian otomatis.
5. Memperbaiki error yang ditemukan.
6. Memperbarui dokumentasi dan mencatat progres pengembangan.

**Ketentuan wajib:**

- Jangan melewati pengujian hanya untuk mempercepat progres.
- Jangan mengganti teknologi utama tanpa persetujuan.
- Jangan menghapus fitur yang sudah berjalan tanpa alasan dan persetujuan.
- Jangan mengubah aturan langganan per bisnis.
- Jangan mengubah aturan satu akun Kasir hanya untuk satu outlet.
- Jangan melakukan deployment publik, perubahan billing, atau tindakan destruktif tanpa persetujuan.
- Jangan menganggap fitur selesai hanya karena tampilan frontend sudah tersedia.

Setelah menyelesaikan setiap fase, tampilkan laporan yang mencakup:

- Fase yang diselesaikan.
- Fitur yang sudah berfungsi.
- File yang dibuat atau dimodifikasi.
- Hasil pengujian.
- Error atau pekerjaan yang masih tertunda.
- Fase berikutnya yang akan dikerjakan.

Anda boleh melanjutkan otomatis ke fase berikutnya jika seluruh pengujian fase sebelumnya berhasil dan tidak membutuhkan keputusan baru dari pemilik proyek.

Jika menemukan masalah yang membutuhkan perubahan arsitektur, biaya, kredensial, atau keputusan bisnis, hentikan bagian pekerjaan terkait dan mintalah persetujuan.

Tujuan akhir adalah menghasilkan KASIR NOVA yang siap diuji secara menyeluruh, bukan sekadar aplikasi demo.

---

# KASIR NOVA — ATURAN AGENT

## Prinsip utama

- Pertahankan seluruh keputusan arsitektur dan bisnis yang telah disetujui.
- Baca dokumentasi proyek sebelum mengubah kode.
- Utamakan perubahan kecil, terukur, dan dapat diuji.
- Jangan mengarang hasil pengujian atau status deployment.
- Laporkan file yang diubah, alasan perubahan, perintah pengujian, dan hasilnya.

## Keamanan

- Terapkan prinsip least privilege.
- Jangan mempercayai role, business_id, outlet_id, harga, total transaksi, atau status langganan yang dikirim browser tanpa validasi server.
- Setiap query dan operasi bisnis harus memeriksa kepemilikan tenant.
- Hash password menggunakan algoritma yang sesuai untuk password.
- Gunakan validasi server, rate limiting, dan perlindungan terhadap akses lintas tenant.
- Jangan mencatat password, token rahasia, atau informasi pembayaran sensitif di log.
- Gunakan konfigurasi lingkungan untuk secret.
- Jangan pernah mengekspos kredensial server di kode frontend.

## Database dan transaksi

- Semua perubahan skema harus menggunakan migrasi.
- Gunakan foreign key, unique constraint, dan index yang relevan.
- Penjualan dan pengurangan stok harus konsisten dalam satu transaksi database.
- Cegah duplikasi transaksi ketika permintaan dikirim ulang.
- Simpan histori perubahan penting.
- Sediakan strategi backup dan pengujian pemulihan.

## Hak akses

- Admin Platform, Owner, dan Kasir mempunyai batasan yang berbeda.
- Owner hanya mengakses bisnis yang menjadi haknya.
- Kasir hanya mengakses outlet yang ditetapkan.
- Status langganan diperiksa di backend pada operasi yang membutuhkan langganan aktif.
- Pencabutan akun atau sesi harus berlaku di server.

## Proses kerja

- Periksa git diff sebelum menyelesaikan tugas.
- Jalankan tes yang relevan.
- Jangan mengubah konfigurasi produksi tanpa izin.
- Jangan melakukan deployment tanpa persetujuan pemilik.
- Jika ada kegagalan, jelaskan penyebab yang terverifikasi dan langkah perbaikannya.
- Jangan melaporkan fitur sebagai siap produksi sebelum semua kriteria penerimaannya terpenuhi.
