# Database aplikasi (PostgreSQL 9.5, instance vendor ConMas)

Jalankan sekali sebagai superuser/DBA (psql). Ganti password. Role aplikasi **bukan superuser** dan **tidak punya akses** ke DB ConMas.

```sql
CREATE ROLE mpd_owner LOGIN PASSWORD '***' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 2;
CREATE ROLE mpd_app   LOGIN PASSWORD '***' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 6;
CREATE DATABASE molding_dashboard OWNER mpd_owner ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE molding_dashboard FROM PUBLIC;
GRANT CONNECT ON DATABASE molding_dashboard TO mpd_app;
\c molding_dashboard
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO mpd_app;

-- ConMas: akun SELECT-only (bukti grant wajib di spike)
-- ALTER ROLE <conmas_reader> CONNECTION LIMIT 3;
-- Uji: sebagai <conmas_reader>, INSERT/UPDATE ke view harus DITOLAK.
```

Lalu: `npm run db:migrate` (memakai `MIGRATE_DB_USER`) dan `npm run db:create-admin`.

Aturan migrasi: file `NNN_nama.sql`, jangan ubah file yang sudah diterapkan (checksum dicek), tanpa identity column /
partisi deklaratif / extension. UUID dibuat di Node. Jalur keluar ke PG 16/17: `pg_dump` + restore.

Backup: `scripts/backup-appdb.ps1` (pg_dump harian, salinan ke share lain). RPO 24 jam, RTO 1 hari kerja. Restore test: cadence TBD (Q-014).
