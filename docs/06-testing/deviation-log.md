# Deviation log — mockup v1.10 vs FE-007 / NFR-UI / keputusan FINAL

Aturan: mockup kalah dari FINAL dan FE-007/NFR-UI. Status: PROPOSED sampai owner menandai APPROVED per baris.

| ID | Kategori | Mockup | Produksi | Alasan | Status |
|---|---|---|---|---|---|
| DEV-001 | Ukuran teks | 9.5–11.5 px (40 deklarasi) | dinaikkan ke 12 px (`tools/extract-mockup.py`) | NFR-UI teks ≥ 12 px | PROPOSED |
| DEV-002 | Hover | `:hover` di semua perangkat (43 aturan) | dibungkus `@media (hover:hover)` | NFR-UI tidak bergantung hover | PROPOSED |
| DEV-003 | Tooltip | muncul di sentuh dan menempel | hanya pointer mouse; data sama tersedia di tabel/label | NFR-UI, FE-INT-002 | PROPOSED |
| DEV-004 | Count-up angka KPI | angka berlari tiap render | angka langsung tampil | FE-MOT-003 | PROPOSED |
| DEV-005 | Kontrol dev | `Mockup: normal/stale/loading/source down` | dihapus; indikator sumber dari envelope API | STATE §14 | APPROVED (FINAL) |
| DEV-006 | Identitas | nama owner hardcode | dari session login | STATE §12 | APPROVED (FINAL) |
| DEV-007 | Sales/Scrap | angka dummy | layout sama, "—" + alasan Q-009 | rumus/approver belum ada | APPROVED (FINAL) |
| DEV-008 | OEE/Availability/Performance | angka dari dummy | nilai dibaca dari kolom ConMas (bukan dihitung); "—" + alasan bila kolom/nilai tidak ada; ranking pakai OEE bila ada, jika tidak Kikai | owner 2026-11-17: "sudah ada data di ConMas, tinggal get" (Q-003 selesai). Nama kolom (`CONMAS_COL_OEE/AVAILABILITY/PERFORMANCE`, kandidat 1_36..1_38 per view 2026-11-18) dan skala (`CONMAS_RATE_SCALE`) harus dicek terhadap Excel/data nyata | APPROVED (arah) · kolom PERLU DIVERIFIKASI |
| DEV-009 | Output per jam (MD hal. 3) | estimasi | Σ 5 slot QTY PCS per blok jam; plan per jam kosong (tidak ada di sumber) | owner 2026-11-17 menyetujui agregasi (Q-027) | APPROVED (owner 2026-11-17) |
| DEV-010 | Jam shift di Settings | bisa diedit | bisa diedit di Settings (default 06/14/22; harus berbeda dan berurutan 1→2→3); jam mulai shift 1 juga jadi pergantian tanggal produksi | owner 2026-11-17 (Q-024) | APPROVED (owner 2026-11-17) |
| DEV-011 | Freshness | satu field (30) | dua field 15/60 + refresh | FINAL freshness | APPROVED (FINAL) |
| DEV-012 | PIC strip | nama + foto dummy, default ON | NIK saja, default OFF | Q-021; Q-026 | PROPOSED |
| DEV-013 | Group A/B/C | diturunkan dari shift | dari field ConMas GROUP | data nyata | PROPOSED |
| DEV-014 | Kiosk iPad | ganti mesin, kembali, keluar | mesin terkunci, tanpa back/exit, hari tetap bisa dinavigasi | Q-023; owner 2026-11-17 menyetujui | APPROVED (owner 2026-11-17) |
| DEV-015 | Profile | SSO planned, activity contoh | akun lokal, ganti password, aktivitas dari audit sendiri, Sign out | FINAL auth lokal | PROPOSED |
| DEV-016 | Navigasi admin | tidak ada | Users & roles, Kiosks, Audit log (sesuai permission) | penambahan disetujui | APPROVED (FINAL) |
| DEV-017 | Font | Segoe UI stack | stack sama, tanpa CDN; iPad pakai font sistem | Q-015/Q-029 | PROPOSED |
| DEV-018 | Agregasi OEE/Availability/Performance | satu angka per mesin | rata-rata tertimbang menit terencana atas record ConMas dalam rentang; rata-rata biasa bila tidak ada bobot | ConMas hanya memberi nilai per record (mesin/tanggal/shift); cara menggabungkan belum dibahas | PROPOSED |
| DEV-019 | Kiosk/TV (user login) | rotasi halaman | rotasi halaman default dari Settings | Q-022; owner 2026-11-17 menyetujui | APPROVED (owner 2026-11-17) |
| DEV-020 | Jadwal uji restore backup | tidak ada | setting `backup.restoreTestDays` (default 7 hari, bisa diubah di Settings); hanya acuan jadwal, aplikasi tidak menjalankan restore | Q-014; owner 2026-11-17: sekali seminggu atau dapat diatur di Settings | APPROVED (owner 2026-11-17) |
| DEV-021 | Machine Detail | foto personel kecil, ringkasan shift di kolom output, timeline stop gabungan | identitas produk di samping mesin, foto medium 84 × 105 px di iPad landscape, ringkasan shift di bawah, timeline per shift dan tabel stop bersebelahan | mockup Machine Detail iPad disetujui owner 2026-11-19 | APPROVED (owner 2026-11-19) |
| DEV-022 | Kesesuaian tampilan Machine Detail | toolbar, kartu, dan lebar halaman masih mengikuti layout lama | port hierarki, palet, lebar konten, kartu output dan kontrol dari mockup per mesin; kedua panel tabel memakai tinggi setara di layout berdampingan | pembandingan mockup dengan tampilan aktual dan skenario satu kejadian stop | APPROVED (mockup owner 2026-11-19) |
