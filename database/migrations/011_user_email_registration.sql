-- 011_user_email_registration.sql  Login memakai email + daftar akun mandiri dengan persetujuan admin (port dari Production-Dashboard-PD).
-- PostgreSQL 9.5 compatible. Akun lama otomatis 'approved' tetapi email masih kosong: mereka TIDAK bisa login sampai email diisi
-- (Admin ▸ Users ▸ Edit user, atau `npm run db:set-email` untuk super admin).

ALTER TABLE app_user ADD COLUMN email varchar(254);
ALTER TABLE app_user ADD CONSTRAINT app_user_email_chk CHECK (email IS NULL OR (email = lower(btrim(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'));
CREATE UNIQUE INDEX app_user_email_uq ON app_user (email);

ALTER TABLE app_user ADD COLUMN status varchar(10) NOT NULL DEFAULT 'approved';
ALTER TABLE app_user ADD COLUMN purpose varchar(500);
ALTER TABLE app_user ADD COLUMN reviewed_by uuid REFERENCES app_user(id);
ALTER TABLE app_user ADD COLUMN reviewed_at timestamptz;
ALTER TABLE app_user ADD COLUMN review_note varchar(200);
ALTER TABLE app_user ADD CONSTRAINT app_user_status_chk CHECK (status IN ('pending', 'approved', 'rejected'));
-- Invarian: akun yang belum/tidak disetujui tidak boleh aktif (sesi ditolak oleh pengecekan `active`).
ALTER TABLE app_user ADD CONSTRAINT app_user_unapproved_inactive_chk CHECK (status = 'approved' OR active = false);
CREATE INDEX app_user_status_idx ON app_user (status);
