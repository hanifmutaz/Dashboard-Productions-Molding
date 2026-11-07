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
| DEV-008 | OEE/Availability/Performance | angka dari dummy | "—" + alasan Q-003; ranking pakai Kikai | rumus belum disetujui | PROPOSED |
| DEV-009 | Output per jam (MD hal. 3) | estimasi | alasan "belum disetujui" | formula karangan dilarang; Q-027 | PROPOSED |
| DEV-010 | Jam shift di Settings | bisa diedit | read-only (06/14/22 FINAL) | Q-024 | PROPOSED |
| DEV-011 | Freshness | satu field (30) | dua field 15/60 + refresh | FINAL freshness | APPROVED (FINAL) |
| DEV-012 | PIC strip | nama + foto dummy, default ON | NIK saja, default OFF | Q-021; Q-026 | PROPOSED |
| DEV-013 | Group A/B/C | diturunkan dari shift | dari field ConMas GROUP | data nyata | PROPOSED |
| DEV-014 | Kiosk iPad | ganti mesin, kembali, keluar | mesin terkunci, tanpa back/exit, hari tetap bisa dinavigasi | Q-023 | PROPOSED |
| DEV-015 | Profile | SSO planned, activity contoh | akun lokal, ganti password, aktivitas dari audit sendiri, Sign out | FINAL auth lokal | PROPOSED |
| DEV-016 | Navigasi admin | tidak ada | Users & roles, Kiosks, Audit log (sesuai permission) | penambahan disetujui | APPROVED (FINAL) |
| DEV-017 | Font | Segoe UI stack | stack sama, tanpa CDN; iPad pakai font sistem | Q-015/Q-029 | PROPOSED |
