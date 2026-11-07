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
| Output gross | cluster_1_50_n | | PROPOSED |
| Qty reject | cluster_1_48_n (NG QTY 1) | kosong → null, bukan 0 | PROPOSED |
| DP no / Produk / PO | cluster_1_9_t / 1_18_t / 1_19_t | | PROPOSED |
| CT actual | cluster_1_32_n | CT plan tidak ada di sumber | PROPOSED |
| Waktu terencana | cluster_1_982_n PROD OPT TIME | dipakai Kikai/Sogo/Shugyo | PROPOSED |
| Leader / Cell / Teknisi / Operator | 1_6_t / 1_7_t / 1_24_t / 1_25_t | NIK; nama = Q-021 | PROPOSED |
| 12 blok jam × 5 slot | JAM, QTY PCS, MENIT, KATEGORI, DETAIL, REJECT, QTY REJECT | label KATEGORI "06.00-07.00" diabaikan; jam dari label JAM | PROPOSED |
| Stop (loss) | Σ MENIT slot dengan kategori non-info | "Informasi" tidak dihitung loss | PROPOSED |
| OEE/AVAIL/PERF/QUALITY/BEKI ConMas | 1_39..1_43 | sample berisi 0/1 → tidak dipakai (Q-018) | REJECTED (sementara) |
| SOGO/SUGYO/KIKAI ConMas | 1_993..1_995 | tampak menit; dihitung backend | PROPOSED |
| Kolom kategori loss 1_985..1_1014 | | sample 0 semua → tidak dipakai | PROPOSED |
| Kolom sistem (record id, rev_no, deleted, update time) | `CONMAS_COL_*` di `.env` | belum ada di view; tanpa ini data = unavailable | BLOCKED (Senin) |

Aturan record (Q-019, owner: "pakai yang terbaru"): per mesin+tanggal+shift ambil `rev_no` tertinggi, `deleted` dibuang, seri → update terbaru.
Timezone sumber: Asia/Bangkok (+07:00).
