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
