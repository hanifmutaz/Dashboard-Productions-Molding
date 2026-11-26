# Operations completion — installation and acceptance

## Install on a restored test database first

Apply after Phase 12–13. `npm run verify`, then verify backup and restore; run `npm run db:migrate` against the test database only, including 005–010. Run `npm run test:visual -- --grep "UI behavior"`. Do not reset the live database. Phase 010 uses the application DB only. ConMas remains read-only. Full integration and migration tests with PostgreSQL 9.5 are mandatory before release. PostgreSQL 9.5 is end-of-life; plan an upgrade.

## Features and acceptance criteria

- Operations Master: effective price and part-material events, including historical correction and future dates. Event dates use plant-local civil dates, last event recorded on a date wins. These override report valuation, not the current master price/material fields. Baseline starts at migration day; older missing mapping/price remains unavailable. Verify historical mixed material/price, explicit null, future and backdated changes, and permission/audit. Scrap value/ratio still require Quality/Finance approval.
- Shift calendar: add all three shifts per date; holiday=0. Set `MPD_SCHEDULE_KPI=true` in **API environment** only after approving the revised denominator. Default remains existing calendar time. In schedule mode, observed machine count × explicitly scheduled minutes, Sogo/Shugyo only; Kikai, OEE and source planned time unchanged. Missing schedule gives unavailable rates rather than an assumed default. Daily table uses the configured minutes per date. This does not establish total installed fleet capacity or machine-specific calendars. Validate with owner before enabling.
- Multiple production records: inspect exact machine/date/shift candidates, compare against ConMas report and confirm selected IDs are independent and their quantities, planned time and hourly/stop slots do not overlap. Enter comma-separated IDs and verification note. Default remains highest revision. When observed ID set changes, fallback latest and review again. Approvals apply to latest revision per approved ID; if revisions change substantively, re-review. Machine Detail sums shift quantities, header/personnel uses latest record. Raw reports also use the approved selection. No automatic classification of independent production. Verify the semantics with actual reports before approving anything.
- Stop Time Report Builder is in Export Data (requires viewProduction to enter page, viewStopTime + exportProduction for the builder). Filters: date/shift/machine/product/category/detail/minimum duration and info-only. Select columns, preview, CSV or XLSX; limit 50,000 rows. Export is live-only and keeps source coverage warnings/counts. No saved stop templates yet.
- Machine lifecycle: active changes are effective on plant civil date; monitoring respects historical events and does not erase earlier production. Unknown pre-baseline status defaults active. Raw report/quality endpoints intentionally preserve source records; paired inactive kiosk remains paired but monitoring shows no current record. Test deactivate/reactivate and historical view.
- Persistent snapshot: optional `MPD_PERSISTENT_SNAPSHOT=true` in API environment. Snapshot fallback only for connection/query failure, same exact date range and machine, seven-day maximum, up to 50 scopes, 10,000 records and 4 MiB per scope, write refresh every five minutes. Known personnel IDs/names stripped; remarks may contain sensitive text, protect the application DB. No fallback on schema drift, no live photo lookup from snapshots, no previous-period comparison while using snapshot. Display explicit stale notice; direct Report Builder remains live-only. Test outage, restart, wrong scope, expiry, empty results, recovery. Snapshot data is not a backup. Policy edits clear snapshots.
- System status: traffic-driven five-minute rolling performance snapshots, latest 288 displayed, 90-day retention during traffic. No historical interpolation during inactivity. Test restart and subsequent samples. Measure request/query latency on realistic test copy, with concurrent kiosks.
- Quality review: manually capture counts for a range, compare repeated snapshots of same scope, status open/reviewed/resolved with notes. Resolving a review does not edit ConMas. Revision counts are source-range scoped before shift filtering; reviewed candidate detail is capped to 100 groups per query. Audit review/approval permissions.
- Optimization: group-by accumulation avoids repeated array copies; indexes for effective prices, mapping, lifecycle and quality; queries use latest-prior + in-range history; bounded snapshots. Run representative query plans and measurements with DBA on restored app DB and read-only ConMas. No measured production performance gain claimed. Do not create indexes on ConMas view without DBA approval; base-table indexes depend on actual view and plans.

## Backup & restore automation

See `docs/production-release-gate.md` for backup environment and ACL requirements. Additional env: `MPD_RESTORE_ISOLATED=YES`, `MPD_RESTORE_HOST`, `MPD_RESTORE_PORT`, `MPD_RESTORE_USER`, `MPD_RESTORE_PASSWORD`, `MPD_RESTORE_SSL`, optional `MPD_PSQL` absolute path. Restore host must be a dedicated isolated test instance, with distinct configured and resolved host addresses from both live instances. Restore user must be permitted to create/drop disposable test databases only on the isolated instance. Use dedicated network account and firewall controls; guards cannot prove network isolation. Set `CONMAS_DB_HOST` and `CONMAS_DB_NAME` correctly. Protect credentials and archives with OS ACL; use encrypted/off-host backups. Use compatible PostgreSQL tools. Run manually before scheduling:

```bash
node --env-file=/secure/path/backup.env scripts/backup-verified.mjs
node --env-file=/secure/path/backup.env scripts/restore-verified.mjs
```

Restore selects the archive matching evidence SHA-256, creates a uniquely named temporary database, runs `pg_restore --exit-on-error --no-owner --no-privileges`, checks required tables and count queries, drops only the database it just created, and records result with matching SHA. This is a schema/data smoke test, not proof of full recovery or UAT. If cleanup fails contact operator. Existing Phase 12 backup resets evidence restore status on new backup; use monitoring and separate logs to retain weekly drill outcomes. Never run on a production host. No backups auto-deleted.

PowerShell (explicit operator action; do not schedule before test):

```powershell
powershell -NoProfile -File scripts/register-mpd-tasks.ps1 -NodeExe 'C:\Program Files\nodejs\node.exe' -EnvironmentFile 'D:\Secure\mpd-backup.env' -Unattended
```

Default backup 01:00 daily; restore 04:00 Sunday. The unattended switch prompts for a dedicated Windows account; grant required log-on-as-batch-job and network permissions. Without it tasks run only for an interactive user. Configure failure alerts, check task exit codes, verify restore evidence and backup retention. No tasks are installed by applying the patch.

## Release blockers

Full repository lint/typecheck/test, actual SQL migration, record-policy approval with real source, comparative KPI validation, backup/restore on isolated DB, actual load test, and UAT are not verified by a patch apply. Do not deploy until these pass. UI retains existing design tokens; check new forms in both themes and on iPad. Known limitations: manual quality capture rather than background incident scanning, no saved Stop Time templates, schedule mode is global not per machine, and no production database performance measurement yet.
