# Phase 12–13: deployment and recovery gate

Do not deploy on the strength of mocked tests alone. PostgreSQL 9.5 is unsupported; plan an upgrade with IT. This runbook does not change ConMas, production formulas, or database schema.

## Backup operation

Use a dedicated OS account and dedicated application-database backup role with sufficient read permissions for all application objects. Install PostgreSQL client tools compatible with the source server. Restrict the external backup directory and evidence directory to the appropriate accounts using OS ACLs (Windows does not enforce POSIX mode bits). Keep encrypted/off-host copies and test recovery. Do not use a web-accessible directory, symlink into the repository, or commit credentials/dumps.

Configure these environment variables in a protected environment file outside the repository: APP_DB_HOST, APP_DB_PORT, APP_DB_NAME, APP_DB_SSL, MPD_BACKUP_DB_USER, MPD_BACKUP_DB_PASSWORD, MPD_BACKUP_DIR, MPD_BACKUP_EVIDENCE_FILE. Optionally MPD_PG_DUMP and MPD_PG_RESTORE are absolute executable paths; PGSSLROOTCERT is needed for a private CA when SSL is enabled. Set the ConMas host/name variables for the additional same-target guard. The API process must separately receive the same MPD_BACKUP_EVIDENCE_FILE path and only needs read access to that evidence, not the dump.

Run from repository root using Node 24:

```bash
node --env-file=/secure/path/backup.env scripts/backup-verified.mjs
```

Configure Windows Task Scheduler to run this command daily under the backup account, with repository root as Start in. Configure failure alerts and prevent overlapping instances. Test manually first. No scheduler is installed by this patch. A stale lock after an interrupted process must be removed only after confirming no backup is running. No automatic deletion: configure approved retention and verify off-host copies before deleting old archives.

A successful command verifies archive listing and SHA-256, publishes evidence to Status & Error, and resets restore status to unknown for the new archive. Listing is not a full restore. If the command fails, check the task exit code; previously published evidence remains unless publication already completed. Never expose passwords in command arguments or logs.

## Restore drill (weekly, isolated server/database only)

1. Verify SHA-256 of the selected archive against its recorded evidence. Retain an independent copy of evidence alongside each archived dump if required for auditing.
2. Provision a disposable empty database on a separate test instance, with no production credentials or network route to live ConMas. Use a separate restore account. Confirm host, port and database before running pg_restore; never point it at live data. Restore with --exit-on-error --no-owner --no-privileges and explicit test connection parameters. Recreate test roles/grants as appropriate.
3. Check schema migrations, row counts, master data, users/roles and representative records against the backup. Start an isolated application, verify readiness and login with a test account. Record the restore date and outcome only for the matching SHA-256; do not mark PASS on archive listing alone. Update the evidence JSON atomically while backup is not running. Restore timestamp must be ISO UTC; restorePassed is boolean.
4. Securely dispose of the restored copy according to policy.

## Release checklist (record PASS/FAIL with evidence)

- `npm run verify`, `npm run test:visual -- --grep "UI behavior"`; review full visual parity separately. On Windows use 100% display scaling for WebKit emulation.
- Confirm clean backup and successful isolated restore before migrations 005–009. Test migrations on a restored copy first; do not reset live database.
- Verify actual `/api/health/ready` and ConMas read-only grants; check view mappings, duplicate/revision assumptions, and compare daily/shift/month totals with source reports. Approve scrap valuation and calendar KPI semantics with owners.
- Verify historical price coverage, material mapping limitations, calendar warnings, stale indicators, machine registry, export XLSX with numeric/blank cells, and unauthorized access for Viewer/Supervisor/Kiosk. Do not assume every new endpoint is covered by existing tests.
- Restrict firewall to intended LAN/proxy. Use HTTPS and secure cookies; avoid blanket trust proxy and use least-privilege DB roles. Validate TLS certificate trust, rotate credentials where needed, and investigate npm audit findings. Keep employee photo directory private and inaccessible to static file serving.
- Confirm real iPad landscape pairing and touch controls, rotation, logout, restart recovery, and network outage handling. Record browser/device versions.
- Record Git commit, migration list, backup hash, operator, deployment time, rollback steps and approvals. Roll back application binaries only if compatible with migrated schema; restore database only under approved incident procedure, after preserving intervening data.

Deployment is not approved until these checks are complete. Existing automated results do not establish actual plant data accuracy or recovery readiness.
