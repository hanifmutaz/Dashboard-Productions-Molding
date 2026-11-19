# ConMas → domain mapping (`view_report_27537`)

Daftar field: **FINAL** (Excel owner). Arti domain tiap baris: **PROPOSED** sampai owner konfirmasi. Sumber kode: `apps/api/src/modules/conmas/fieldMap.generated.ts`.

| Domain | Kolom | Catatan | Status |
|---|---|---|---|
| Tanggal produksi | cluster_1_0_d | timestamp tanpa TZ; shift 3 di tanggal mulai (sample) | PROPOSED |
| No. mesin | cluster_1_1_t | di-trim | PROPOSED |
| Shift | cluster_1_2_t | `S1/S2/S3` → 1/2/3 | PROPOSED |
| Group | cluster_1_3_t | tidak terikat shift (sample S2=A, S3=B, S1=A) | PROPOSED |
| Cavity | cluster_1_4_t | | PROPOSED |
| Output plan | cluster_1_5_n | | PROPOSED |
| Output actual (good) | cluster_1_14_n | | PROPOSED |
| Output gross | cluster_1_46_n (OUTPUT GROSS PCS 1) | view 2026-11-18: sebelumnya 1_50_n | PROPOSED |
| Qty reject | cluster_1_44_n (NG QTY 1) | kosong → null, bukan 0; view 2026-11-18: sebelumnya 1_48_n | PROPOSED |
| NG (gram) | cluster_1_45_n (NG (GRAM) 1) | satuan gram (owner 2026-11-18); kosong → null, bukan 0; dasar Scrap kg/value | PROPOSED |
| DP no / Produk / PO | cluster_1_9_t / 1_18_t / 1_19_t | | PROPOSED |
| CT actual | cluster_1_32_n | CT plan tidak ada di sumber | PROPOSED |
| Waktu terencana | cluster_1_975_n PROD OPT TIME | view 2026-11-18: sebelumnya 1_982_n; dipakai Kikai/Sogo/Shugyo | PROPOSED |
| Leader / Cell / Teknisi / Operator | 1_6_t / 1_7_t / 1_24_t / 1_25_t | NIK dari baris shift yang sama dengan nama | PROPOSED |
| Nama Leader / Cell Leader / Teknisi / Operator | 1_15_t / 1_16_t / 1_33_t / 1_34_t | Nomor field mengikuti tabel pemilik. Nama fisik masing-masing bisa disetel lewat CONMAS_COL_LEADER_NAME, CONMAS_COL_CELL_LEADER_NAME, CONMAS_COL_TECHNICIAN_NAME, CONMAS_COL_OPERATOR_NAME. Kolom nama yang belum masuk view dilewati. | OPSIONAL |
| 12 blok jam × 5 slot (label JAM kini 1_49_t, 1_126_t, …) | JAM, QTY PCS, MENIT, KATEGORI, DETAIL, REJECT, QTY REJECT | label KATEGORI "06.00-07.00" diabaikan; jam dari label JAM | PROPOSED |
| Stop (loss) | Σ MENIT slot dengan kategori non-info | "Informasi" tidak dihitung loss | PROPOSED |
| OEE / Availability / Performance ConMas | 1_36_n / 1_37_n / 1_38_n (view 2026-11-18: OEE, AVAILIBILITY, PERFORMANCE; sebelumnya 1_39..1_41) | owner 2026-11-17: dipakai langsung dari ConMas. Dikonfigurasi lewat `CONMAS_COL_OEE/AVAILABILITY/PERFORMANCE`; kolom yang tidak ada di view dilewati (angka tampil "—"). Skala: `CONMAS_RATE_SCALE` (percent/fraction). Agregasi antar record: DEV-018 | PROPOSED · VERIFIKASI NAMA KOLOM & SKALA |
| QUALITY / GRAM / KG ConMas | 1_39_n (QUALITY), 1_40..1_43_n (GRAM/KG PLAN & ACTUAL) | tidak dipakai; Quality dan Bekidoritsu tetap memakai rumus yang sudah disetujui di backend | tidak dipakai |
| Output per jam | Σ QTY PCS 5 slot per blok jam | owner 2026-11-17 menyetujui; plan per jam tidak ada di sumber (kosong) | APPROVED |
| SOGO/SUGYO/KIKAI ConMas | 1_986..1_988 | tampak menit; dihitung backend | PROPOSED |
| Kolom kategori loss 1_974..1_1007 | | sample 0 semua → tidak dipakai | PROPOSED |
| Kolom sistem (record id, rev_no, deleted, update time) | `CONMAS_COL_*` di `.env` | belum ada di view; tanpa ini data = unavailable | BLOCKED (Senin) |

Aturan record (Q-019, owner: "pakai yang terbaru"): per mesin+tanggal+shift ambil `rev_no` tertinggi, `deleted` dibuang, seri → update terbaru.
Timezone sumber: Asia/Bangkok (+07:00).

## Perubahan view 2026-11-18 (view_report_27537)

- Daftar kolom lengkap: `docs/03-database/view_report_27537.schema.tsv`. Peta kode dibuat ulang dengan `python tools/gen-fieldmap-from-schema.py`.
- Struktur tetap 12 blok × 5 slot, nomor kolom geser. Header yang berubah: NG QTY, OUTPUT GROSS, PROD OPT TIME, dan OEE/AVAILIBILITY/PERFORMANCE (default `CONMAS_COL_*` ikut diganti).
- Blok 11 slot 3 (jam 16.00-17.00) di view hanya punya QTY PCS, DETAIL, REJECT, QTY REJECT: **MENIT dan KATEGORI tidak ada**. Slot itu tidak bisa dihitung sebagai loss sampai kolomnya ada.
- Blok 2 slot 1 tidak punya DETAIL dan QTY REJECT (sama seperti sebelumnya).
- Kolom sistem (record id, rev_no, deleted, update time) **tetap tidak ada** di daftar baru, jadi Q-019 masih BLOCKED.

## Sales & Scrap (Q-009), 2026-11-18

- **Sales (Rp)** = OUTPUT ACTUAL (good, `1_14_n`) × Harga/PCS (Master Data, `md_part.price_per_pcs`). **APPROVED** owner; NG tidak dikurangkan lagi karena actual sudah good.
- **Scrap (kg)** = NG (GRAM) `1_45_n` ÷ 1000. Sumber ConMas, satuan gram (dikonfirmasi owner).
- **Scrap value (Rp)** = NG (gram) × harga material per gram (Master Data: part → material → `price_per_gram`). **PROPOSED**, menunggu approver Quality/Finance.
- **Scrap ratio (%)** = scrap value ÷ sales value × 100 (definisi Molding).
- Rumus ada di `apps/api/src/modules/metrics/formulas.ts` (tanpa pembulatan; pembulatan Rupiah hanya di tampilan, Q-003). Route `/v1/monitoring/sales` (buildSales) dan `/v1/monitoring/scrap` (buildScrap) memakainya. Scrap: record tanpa NG gram, atau part tanpa material/harga, tidak dihitung sebagai 0 (dilaporkan sebagai `recordsWithoutGram` / `unvaluedGram`); ratio hanya dari record yang punya scrap value dan sales sekaligus. UI memberi peringatan bila harga material ≥ Rp 10.000/gram (kemungkinan satuan per kg).
