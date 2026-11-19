# Report eligible records by default. Run with the approved retention days and -Apply to delete expired auth state.
param(
  [Parameter(Mandatory = $true)][string]$Database,
  [Parameter(Mandatory = $true)][string]$User,
  [Parameter(Mandatory = $true)][ValidateRange(1, 3650)][int]$KeepExpiredDays,
  [ValidateRange(1, 10000)][int]$BatchSize = 5000,
  [string]$DbHost = "127.0.0.1",
  [ValidateRange(1, 65535)][int]$Port = 5432,
  [string]$PgBin = "C:\Program Files\PostgreSQL\9.5\bin",
  [switch]$Apply
)
$ErrorActionPreference = "Stop"
$cut = "now() - $KeepExpiredDays * interval '1 day'"
$sql = @"
SELECT 'eligible expired sessions' AS operation, count(*) FROM app_session WHERE absolute_expires_at < $cut
UNION ALL
SELECT 'eligible expired pairing codes', count(*) FROM kiosk_pairing WHERE expires_at < $cut;
"@
if ($Apply) {
  $sql = @"
BEGIN;
WITH removed AS (
  DELETE FROM app_session WHERE id_hash IN (
    SELECT id_hash FROM app_session WHERE absolute_expires_at < $cut ORDER BY absolute_expires_at LIMIT $BatchSize
  ) RETURNING 1
)
SELECT 'removed expired sessions' AS operation, count(*) FROM removed;
WITH removed AS (
  DELETE FROM kiosk_pairing WHERE code_hash IN (
    SELECT code_hash FROM kiosk_pairing WHERE expires_at < $cut ORDER BY expires_at LIMIT $BatchSize
  ) RETURNING 1
)
SELECT 'removed expired pairing codes' AS operation, count(*) FROM removed;
COMMIT;
"@
}
& "$PgBin\psql.exe" -h $DbHost -p $Port -U $User -d $Database -w -X -v ON_ERROR_STOP=1 -c $sql
if ($LASTEXITCODE -ne 0) { throw "Retention query failed ($LASTEXITCODE)." }
