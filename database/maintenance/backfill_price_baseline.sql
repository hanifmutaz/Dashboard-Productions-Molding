-- DATA-FIX SEKALI JALAN (bukan migration): mundurkan tanggal efektif baseline harga & mapping material.
--
-- Latar belakang: migration 009 membuat baseline harga part/material dan migration 010 membuat baseline mapping
-- part->material, keduanya efektif mulai HARI MIGRATION. Hari produksi sebelumnya dianggap "belum berharga",
-- sehingga Sales/Scrap kosong untuk tanggal-tanggal itu. Script ini memundurkan HANYA baris baseline tersebut
-- ke tanggal awal data. ASUMSI (harus disetujui owner): harga & mapping pada hari migration berlaku sejak tanggal itu.
--
-- Cara pakai (psql, sebagai owner DB; ambil backup dulu):
--   1) Dry run (tidak menyimpan apa pun):
--        psql -d molding_dashboard -v ON_ERROR_STOP=1 -v backfill_from=2026-11-01 -v finish=ROLLBACK -f backfill_price_baseline.sql
--   2) Cek jumlah baris & contoh di output, lalu jalankan sungguhan:
--        psql -d molding_dashboard -v ON_ERROR_STOP=1 -v backfill_from=2026-11-01 -v finish=COMMIT   -f backfill_price_baseline.sql
-- Tanpa -v backfill_from / -v finish script berhenti dengan error dan tidak menyimpan apa pun.
-- Aman dijalankan ulang: baris yang sudah dimundurkan tidak cocok lagi dengan kondisi "efektif = hari migration".
-- Kompatibel PostgreSQL 9.5.

BEGIN;

-- 0) Waktu migration diambil dari schema_migration (baris baseline dibuat di transaksi migration yang sama).
CREATE TEMP TABLE _bf AS
SELECT (SELECT applied_at FROM schema_migration WHERE name = '009_price_history_baseline.sql') AS t009,
       (SELECT applied_at FROM schema_migration WHERE name = '010_operations_completion.sql')  AS t010,
       :'backfill_from'::date AS d;

-- Hentikan kalau migration tidak ditemukan atau tanggal tujuan tidak lebih awal dari hari migration.
DO $$
DECLARE r _bf%ROWTYPE;
BEGIN
  SELECT * INTO r FROM _bf;
  IF r.t009 IS NULL OR r.t010 IS NULL THEN RAISE EXCEPTION 'Migration 009/010 tidak ditemukan di schema_migration'; END IF;
  IF r.d >= (r.t009 AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION 'backfill_from (%) harus lebih awal dari hari migration 009 (%)', r.d, (r.t009 AT TIME ZONE 'Asia/Jakarta')::date;
  END IF;
END $$;

-- 1) Baris baseline harga: old_price NULL, belum punya effective_date, dibuat dalam +-1 menit dari migration 009.
--    Dilewati bila entitas itu sudah punya event bertanggal eksplisit pada/sebelum tanggal tujuan (koreksi manual dihormati).
CREATE TEMP TABLE _price_rows AS
SELECT h.id, h.entity_type, h.entity_key, h.new_price,
       (h.changed_at AT TIME ZONE 'Asia/Jakarta')::date AS effective_sekarang
FROM md_price_history h, _bf
WHERE h.old_price IS NULL AND h.effective_date IS NULL
  AND h.changed_at BETWEEN _bf.t009 - interval '1 minute' AND _bf.t009 + interval '1 minute'
  AND NOT EXISTS (SELECT 1 FROM md_price_history o
                  WHERE o.entity_type = h.entity_type AND o.entity_key = h.entity_key
                    AND o.effective_date IS NOT NULL AND o.effective_date <= _bf.d);

-- 2) Baris baseline mapping: dibuat dalam +-1 menit dari migration 010, efektif = hari migration.
CREATE TEMP TABLE _map_rows AS
SELECT m.id, m.dp_no, m.material_code, m.effective_date AS effective_sekarang
FROM md_part_material_history m, _bf
WHERE m.changed_at BETWEEN _bf.t010 - interval '1 minute' AND _bf.t010 + interval '1 minute'
  AND m.effective_date = (_bf.t010 AT TIME ZONE 'Asia/Jakarta')::date
  AND NOT EXISTS (SELECT 1 FROM md_part_material_history o
                  WHERE upper(btrim(o.dp_no)) = upper(btrim(m.dp_no)) AND o.id <> m.id AND o.effective_date <= _bf.d);

\echo '== SEBELUM: baris yang akan dimundurkan =='
SELECT 'harga part'     AS jenis, count(*) AS baris, min(effective_sekarang) AS efektif_sekarang, (SELECT d FROM _bf) AS menjadi FROM _price_rows WHERE entity_type = 'part'
UNION ALL
SELECT 'harga material', count(*), min(effective_sekarang), (SELECT d FROM _bf) FROM _price_rows WHERE entity_type = 'material'
UNION ALL
SELECT 'mapping part-material', count(*), min(effective_sekarang), (SELECT d FROM _bf) FROM _map_rows;

\echo '== Contoh 10 baris harga =='
SELECT entity_type, entity_key, new_price, effective_sekarang FROM _price_rows ORDER BY entity_type, entity_key LIMIT 10;

\echo '== Entitas baseline yang DILEWATI karena sudah punya koreksi bertanggal =='
SELECT count(*) AS dilewati FROM md_price_history h, _bf
WHERE h.old_price IS NULL AND h.effective_date IS NULL
  AND h.changed_at BETWEEN _bf.t009 - interval '1 minute' AND _bf.t009 + interval '1 minute'
  AND h.id NOT IN (SELECT id FROM _price_rows);

-- 3) Terapkan.
UPDATE md_price_history      SET effective_date = (SELECT d FROM _bf) WHERE id IN (SELECT id FROM _price_rows);
UPDATE md_part_material_history SET effective_date = (SELECT d FROM _bf) WHERE id IN (SELECT id FROM _map_rows);

\echo '== SESUDAH: baris baseline per tanggal efektif =='
SELECT effective_date, count(*) FROM md_price_history WHERE id IN (SELECT id FROM _price_rows) GROUP BY 1;
SELECT effective_date, count(*) FROM md_part_material_history WHERE id IN (SELECT id FROM _map_rows) GROUP BY 1;

:finish;
