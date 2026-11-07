# Daily pg_dump of the application DB (NOT ConMas). Schedule with Task Scheduler as a service account.
# Password via %APPDATA%\postgresql\pgpass.conf of that account (never in this file).
param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\9.5\bin",
  [string]$Db = "molding_dashboard",
  [string]$User = "mpd_owner",
  [string]$LocalDir = "D:\backup\molding",
  [string]$OffsiteDir = "\\fileserver\backup\molding",
  [int]$KeepDays = 30
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null
$file = Join-Path $LocalDir ("{0}_{1:yyyyMMdd_HHmm}.dump" -f $Db, (Get-Date))
& "$PgBin\pg_dump.exe" -h 127.0.0.1 -U $User -F c -f $file $Db
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed ($LASTEXITCODE)" }
& "$PgBin\pg_restore.exe" -l $file | Out-Null
if ($LASTEXITCODE -ne 0) { throw "dump archive unreadable" }
Copy-Item $file $OffsiteDir
Get-ChildItem $LocalDir -Filter *.dump | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item
Write-Output "backup OK: $file"
