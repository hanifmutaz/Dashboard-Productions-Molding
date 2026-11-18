-- Harga/PCS per DP Part bisa berpecahan (mis. Rp 364,39 per pcs untuk housing kecil).
-- bigint -> numeric(14,4): nilai lama (bilangan bulat) tidak berubah; CHECK >= 0 tetap berlaku.
ALTER TABLE md_part ALTER COLUMN price_per_pcs TYPE numeric(14,4);
