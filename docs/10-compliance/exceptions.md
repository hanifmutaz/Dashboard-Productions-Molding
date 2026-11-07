# Exceptions

## EXC-001 — Slice 1 sebelum G2 penuh
Status: **SUPERSEDED oleh EXC-002** (2026-11-07). Artefak Batch 1 lama diarsipkan (`_archive/`), tidak dipakai.

## EXC-002 — Semua slice dibangun sekaligus, verifikasi penuh di akhir
- Affected standard: urutan gate G2→G3→G4 per slice; "perubahan kecil dan koheren"; verifikasi per batch.
- Reason: owner meminta implementasi penuh mockup v1.10 dalam satu kali pengerjaan; test dijalankan setelah semua selesai.
- Risk: banyak error muncul bersamaan saat `npm run verify` pertama; defect lintas lapisan lebih sulit dilacak; G3/G4 tidak bisa PASS tanpa evidence.
- Mitigation: kontrak Zod bersama; unit test domain/rumus; supertest keamanan (auth, CSRF, RBAC, 409, no-leak); guard produksi; parity visual Playwright; semua klaim lulus menunggu output nyata dari mesin owner.
- Residual risk: kompatibilitas versi dependency terbaru (TS dipin 5.9.3 karena peer typescript-eslint `<6.1.0`); perilaku nyata ConMas (kolom sistem, timezone, `sys_update_time`) belum diuji.
- Owner / Approved by: Hanif Mutaz · Approval date: 2026-11-07
- Review date: setelah `npm run verify` pertama PASS, atau 2026-11-21 (mana lebih dulu).
- Resolution plan: perbaiki hasil verify → spike ConMas dengan kolom sistem (Senin) → G4 evidence → G5/G6.
- Status: APPROVED / ACTIVE

## EXC-003 (kandidat, BELUM disetujui) — HTTP tanpa TLS di jaringan internal
- Berlaku hanya bila deploy dilakukan sebelum sertifikat tersedia. Membutuhkan `COOKIE_SECURE=false` + `ALLOW_INSECURE_COOKIE=true`.
- Risk: password, session dan credential kiosk dapat disadap di jaringan (termasuk Wi-Fi iPad); audit kehilangan non-repudiation.
- Default kode: aplikasi **menolak start** dengan cookie tidak Secure di `NODE_ENV=production` kecuali flag exception di-set.
- Keputusan owner: TBD.
