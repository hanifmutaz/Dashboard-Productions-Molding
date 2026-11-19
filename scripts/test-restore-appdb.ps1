# Restores a dump into a new disposable staging database and prints a verification summary.
param(
  [Parameter(Mandatory = $true)][string]$Dump,
  [Parameter(Mandatory = $true)][string]$StagingHost,
  [Parameter(Mandatory = $true)][string]$RestoreDb,
  [Parameter(Mandatory = $true)][string]$User,
  [ValidateRange(1, 65535)][int]$Port = 5432,
  [string]$PgBin = "C:\Program Files\PostgreSQL\9.5\bin"
)
$ErrorActionPreference = "Stop"
if ($RestoreDb -cnotmatch '^mpd_restore_[a-z0-9_]{1,40}$') {
  throw "RestoreDb must be an isolated staging database named mpd_restore_<test>."
}
$archive = Get-Item -LiteralPath $Dump
if ($archive.PSIsContainer) { throw "Dump must be a file." }
$started = Get-Date
$connArgs = @('-h', $StagingHost, '-p', $Port, '-U', $User, '-w')
& "$PgBin\createdb.exe" @connArgs $RestoreDb
if ($LASTEXITCODE -ne 0) { throw "Could not create new restore DB ($LASTEXITCODE)." }
& "$PgBin\pg_restore.exe" @connArgs --exit-on-error --no-owner --no-privileges -d $RestoreDb $archive.FullName
if ($LASTEXITCODE -ne 0) { throw "Restore failed ($LASTEXITCODE). Inspect the isolated database before cleanup." }
$query = @"
SELECT json_build_object(
  'migrations', (SELECT count(*) FROM schema_migration),
  'users', (SELECT count(*) FROM app_user),
  'settings', (SELECT count(*) FROM app_settings),
  'auditEntries', (SELECT count(*) FROM audit_log)
);
"@
$check = & "$PgBin\psql.exe" @connArgs -d $RestoreDb -X -A -t -v ON_ERROR_STOP=1 -c $query
if ($LASTEXITCODE -ne 0) { throw "Restore verification failed ($LASTEXITCODE)." }
$counts = $check | ConvertFrom-Json
if ($counts.migrations -lt 1 -or $counts.settings -ne 1) { throw "Restored schema or settings are incomplete." }
[pscustomobject]@{
  Database = $RestoreDb
  Dump = $archive.Name
  DumpLastWriteUtc = $archive.LastWriteTimeUtc.ToString("o")
  DurationSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds)
  RowCounts = $counts
} | ConvertTo-Json -Depth 4
