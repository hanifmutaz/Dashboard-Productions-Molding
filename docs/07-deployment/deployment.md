# Deployment — Windows Server 2019 (on-premise)

Akses dari luar jaringan internal: **dilarang**. Satu proses Node melayani API + SPA (`apps/web/dist`).

## 1. Build di server
```bash
git pull && npm ci && npm run verify
npm run db:migrate
```
Folder runtime tanpa spasi/tanda kutip disarankan (mis. `D:\apps\molding`).

## 2. Service Node (NSSM) — ADR-025 PROPOSED
```cmd
nssm install MoldingDashboard "C:\Program Files\nodejs\node.exe" "--env-file=D:\apps\molding\apps\api\.env" "D:\apps\molding\apps\api\dist\server.js"
nssm set MoldingDashboard AppDirectory D:\apps\molding
nssm set MoldingDashboard AppStdout D:\apps\molding\logs\api.log
nssm set MoldingDashboard AppStderr D:\apps\molding\logs\api.err.log
nssm set MoldingDashboard AppRotateFiles 1
nssm set MoldingDashboard AppRotateBytes 10485760
nssm start MoldingDashboard
```
`.env` produksi: `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3100`, `TRUST_PROXY=loopback`, `PUBLIC_ORIGIN=https://<nama-host>`.

## 3. IIS sebagai reverse proxy TLS
1. Install **Application Request Routing 3.0** + **URL Rewrite 2.1**.
2. IIS Manager → server → ARR → Server Proxy Settings → **Enable proxy**; matikan "Reverse rewrite host in response headers".
3. Site baru (binding HTTPS 443 + sertifikat), `web.config`:
```xml
<configuration><system.webServer>
  <rewrite><rules>
    <rule name="https" stopProcessing="true"><match url="(.*)"/><conditions><add input="{HTTPS}" pattern="off"/></conditions>
      <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent"/></rule>
    <rule name="node" stopProcessing="true"><match url="(.*)"/><action type="Rewrite" url="http://127.0.0.1:3100/{R:1}"/>
      <serverVariables><set name="HTTP_X_FORWARDED_PROTO" value="https"/></serverVariables></rule>
  </rules></rewrite>
  <security><requestFiltering removeServerHeader="true"/></security>
</system.webServer></configuration>
```
(Tambahkan `HTTP_X_FORWARDED_PROTO` ke Allowed Server Variables di URL Rewrite.)

## 4. Sertifikat TLS (wajib sebelum user asli)
1. **Let's Encrypt DNS-01** untuk subdomain internal (record ke IP internal, di DNS internal atau Cloudflare *DNS only*), pakai **win-acme**; terpasang otomatis ke IIS dan diperpanjang. Tanpa install di perangkat.
2. CA internal (AD CS) bila IT punya.
3. Self-signed + distribusi manual.

Tanpa TLS → lihat EXC-003 (belum disetujui).

## 5. Firewall
Port 443 hanya dari subnet internal. Port 3100 hanya loopback. PostgreSQL hanya dari server aplikasi.

## 6. Verifikasi pasca deploy
`GET /api/health` (200) · `GET /api/health/ready` · login · buka Production · cek audit login di Audit log.

## 7. Rollback
Simpan rilis sebelumnya (`git tag`). Rollback = checkout tag lama + `npm ci && npm run build` + restart service. Migrasi forward-only; perubahan skema destruktif didahului backup.

## Gate rilis dan verifikasi

- Workflow **Verify dashboard** menjalankan verifikasi aplikasi dan uji interaksi browser. Jadikan job ini required check pada branch `master`, dengan review PR, setelah satu run berhasil. Status GitHub Pages menunjukkan deployment Pages dan diperiksa terpisah dari rilis Windows.
- Jalankan `npm run db:migrate` sebelum mengarahkan traffic ke versi baru. `/api/health/ready` melaporkan status schema. Rute API bisnis mengembalikan 503 selama daftar migrasi rilis belum terpenuhi. Periksa pula `conmas: up` pada body sebelum menjalankan smoke test Production.
- Gunakan `HOST=127.0.0.1` dan `TRUST_PROXY=loopback` saat IIS dan Node satu mesin. Di ARR, pastikan header forwarded berasal dari proxy yang dikonfigurasi dan header dari klien tidak diperlakukan sebagai identitas terpercaya. Periksa IP klien di staging sebelum membuka akses operator.
- Ukur ConMas di staging dengan rentang pendek, panjang, dan beberapa dashboard. Catat durasi query, jumlah baris, serta umur `sourceUpdatedAt` terhadap waktu respons. Cache query ConMas dibatasi maksimal satu menit sesuai interval polling terkecil. Jalankan tinjauan query bersama DBA bila hasil pengukuran melampaui target tim.

## Latihan restore dan retensi

Jalankan `scripts/test-restore-appdb.ps1` memakai dump terbaru dan instance staging terisolasi. Tentukan nama baru dengan awalan `mpd_restore_`. Simpan JSON verifikasi bersama hasil smoke test login, Settings, dan Audit log pada salinan staging. Cocokkan umur dump dan waktu pemulihan dengan RPO 24 jam dan RTO 1 hari kerja. Bersihkan database uji mengikuti prosedur staging setelah bukti disimpan.

Jalankan `scripts/appdb-retention.ps1` dalam mode laporan untuk menghitung sesi dan kode pairing kedaluwarsa yang memenuhi kebijakan simpan. Gunakan `-Apply` dengan masa simpan yang disepakati dan jadwalkan batch bila diperlukan. Tabel audit dan backup offsite punya kebijakan simpan tersendiri. Tetapkan akses, jadwal, dan masa simpannya dengan DBA.

### Nama dan foto personel pada Machine Detail

Aktifkan **Settings → Machine Detail / iPad → PIC strip**. Dashboard menampilkan personel dari shift terakhir yang datanya tersedia untuk mesin dan tanggal produksi yang dipilih. NIK dan nama berasal dari baris ConMas yang sama.

- Pastikan view ConMas menampilkan kolom nama yang disetel di contoh konfigurasi. Jika nama fisiknya berbeda, ikuti hasil pemeriksaan skema view dan sesuaikan variabel CONMAS_COL_*_NAME pada API. Kolom nama yang belum ada akan dilewati, dan NIK masih tampil.
- Isi EMPLOYEE_PHOTO_DIR pada file .env API dengan path absolut folder foto di server, di luar WEB_DIST dan folder yang disajikan web server secara publik. Beri akun proses API akses baca ke folder tersebut.
- Simpan foto sebagai NIK.jpg, NIK.jpeg, NIK.png, atau NIK.webp. Gunakan NIK persis dari ConMas, termasuk nol di depan. Restart API setelah mengubah .env. Foto yang belum tersedia memakai avatar.
