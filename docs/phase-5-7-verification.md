# Phase 5–7 verification

## Monitoring
- `/api/system/monitor` requires the existing Settings view permission. No public diagnostics or credentials are exposed.
- Counts and latency are for at most 500 completed API requests, excluding health and monitor endpoints. These are per-process statistics, not persistent metrics.
- Optional environment variable `MPD_BACKUP_EVIDENCE_FILE` points to a local JSON file readable by the API service. Do not store it in the public web directory.
- Example JSON (replace null with real UTC ISO timestamps only after successful operations):

```json
{"backupAt":null,"restoreTestAt":null,"restorePassed":null,"backupSha256":null}
```

- Update backup evidence only after verifying the backup file and its SHA-256. Record restore test outcome only after restoring to an isolated test database and verifying schema and expected data. A reported backup older than 24 hours is marked stale. This is evidence reporting, not an automatic backup or restore scheduler.

## Acceptance checklist
- Run `npm run verify` and `npm run test:visual -- --grep "UI behavior"`.
- On a test DB, apply outstanding migrations 005–008 and confirm readiness.
- Verify Operations Master CRUD, permissions, price change history, calendar and export templates/history; confirm CSV matches source records.
- Compare actual production metrics against approved ConMas samples across shifts; check stale/unknown states and duplicate identities.
- Pair real iPads; test landscape, rotation, scroll, touch targets and long product names. Browser viewport emulation is not physical-device certification.
- Confirm server diagnostics are denied to users without Settings view permission. Confirm unconfigured, missing, stale and valid backup evidence states.
- Verify restore on a separate database, never on the live plant DB.

Not implemented here: automatic backup orchestration, historical valuation, freshness/deduplication policy changes, XLSX export, and full component decomposition. No production readiness sign-off until integration checks pass.
