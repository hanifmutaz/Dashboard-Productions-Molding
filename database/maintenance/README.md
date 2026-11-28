# database/maintenance

Script data-fix sekali jalan. **Bukan migration**: tidak dibaca oleh `npm run db:migrate` dan tidak boleh ditaruh di `database/migrations/`.
Selalu ambil backup dulu, jalankan dry run (`-v finish=ROLLBACK`) sebelum `-v finish=COMMIT`.

| Script | Fungsi |
|---|---|
| `backfill_price_baseline.sql` | Memundurkan tanggal efektif baseline harga (migration 009) dan mapping part-material (migration 010) ke tanggal awal data, supaya Sales/Scrap terisi untuk hari sebelum hari migration. Butuh persetujuan owner: mengasumsikan harga/mapping hari migration berlaku sejak tanggal itu. |
