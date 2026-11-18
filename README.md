# Molding PM Dashboard

Aplikasi produksi dari mockup v1.10 (27 mesin molding). Modular monolith: React + TypeScript (Vite) di depan,
Express + TypeScript di belakang, PostgreSQL 9.5 untuk DB aplikasi, ConMas dibaca read-only lewat backend.

> Status: **kode lengkap ditulis, BELUM terverifikasi.** Belum ada `npm install`, lint, typecheck, test, atau build
> yang dijalankan di mesin owner. Jangan anggap lulus sebelum `npm run verify` di laptop menunjukkan PASS.

## Struktur

```
apps/web            React SPA (semua halaman mockup + Login/Forbidden/Error/Users/Roles/Kiosks/Audit)
apps/api            Express API: auth, RBAC, audit, settings, master data, kiosk, adapter ConMas, metrik
packages/contracts  Kontrak Zod/TypeScript bersama (tanpa nama kolom fisik ConMas)
packages/ui-tokens  Token 3 lapis (primitive/semantic/component) diekstrak dari mockup
packages/config     Preset tool bersama
packages/test-utils Builder khusus test (dilarang di produksi; dicek guard)
database/migrations SQL biasa, berurutan, kompatibel PG 9.5
tests/visual        Playwright: parity visual + cek NFR-UI di iPad (WebKit 1024x768)
mockup/             Baseline visual resmi v1.10 (tidak pernah masuk build)
tools/              Script ekstraksi token/CSS/field map dari mockup & Excel
docs/               ADR, exception, deviation log, mapping ConMas, deployment
```

## Prasyarat (laptop & server harus sama)

Node **24.18.0**, npm **12.0.2**, Git Bash. Cek: `node -v && npm -v`.

## Langkah pertama (Git Bash, folder `system`)

```bash
npm install
npm approve-scripts esbuild        # hanya esbuild (Vite) yang boleh menjalankan install script
npx playwright install chromium webkit
npm run verify                     # build:pkgs -> lint -> typecheck -> test -> build -> guard:production
```

## Menjalankan lokal

1. Buat DB aplikasi + role (lihat `database/README.md`).
2. `cp .env.example apps/api/.env` lalu isi.
3. `npm run build && npm run db:migrate && npm run db:create-admin`
4. Terminal 1: `npm run dev:api` · Terminal 2: `npm run dev:web` → http://localhost:5173

## Hal yang sengaja tampil "—"

| Area | Alasan | Referensi |
|---|---|---|
| Sales, Scrap | Rumus, sumber harga, approver belum ada | Q-009 |
| CT plan | Tidak ada di sumber | Master Data |
| OEE, Availability, Performance | Dibaca dari ConMas; "—" bila kolom `CONMAS_COL_OEE/AVAILABILITY/PERFORMANCE` tidak ada di view atau kosong | DEV-008 |
| Output per jam (Machine Detail hal. 3) | Σ 5 slot QTY PCS per blok jam (disetujui); "—" bila ConMas belum punya QTY PCS | DEV-009 |
| Semua angka ConMas | Sampai `CONMAS_COL_*` diisi (kolom sistem masuk view Senin) | Q-019/Q-020 |

Rumus yang **disetujui owner 2026-11-07**: Bekidoritsu, Kikai, Sogo, Shugyo, Quality, IPR (PPM).

Keputusan owner **2026-11-17**: OEE/Availability/Performance dibaca dari ConMas (tidak dihitung); output per jam = Σ 5 slot QTY PCS per blok jam;
jam mulai shift bisa diubah di Settings (shift 1 juga menentukan pergantian tanggal produksi); mode Kiosk iPad dan rotasi Kiosk/TV disetujui;
uji restore backup default mingguan dan bisa diubah di Settings. Detail: `docs/06-testing/deviation-log.md`.
