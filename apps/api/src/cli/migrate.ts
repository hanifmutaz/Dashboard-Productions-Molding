import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_SETTINGS } from '@mpd/contracts';
import { loadConfig } from '../config.js';
import { createAppPool, withTransaction } from '../db/pools.js';

/* Plain ordered SQL migrations (ADR-014). Runs as the DB owner (MIGRATE_DB_USER); the runtime role only receives grants.
 * Each file runs in its own transaction; checksum mismatch of an applied file aborts (no silent drift). */
const config = loadConfig();
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../database/migrations');
const appRole = config.APP_DB_USER;
if (!/^[a-z_][a-z0-9_]*$/i.test(appRole)) throw new Error('APP_DB_USER tidak valid untuk GRANT');
const pool = createAppPool(config, true);

async function main() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migration (name varchar(120) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum char(64) NOT NULL)');
  const applied = new Map((await pool.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migration')).rows.map((r) => [r.name, r.checksum]));
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    const sql = readFileSync(path.join(dir, f), 'utf8').replaceAll('{{APP_ROLE}}', `"${appRole}"`);
    const sum = createHash('sha256').update(sql).digest('hex');
    const prev = applied.get(f);
    if (prev) {
      if (prev !== sum) throw new Error(`Checksum migrasi ${f} berubah setelah diterapkan. Buat migrasi baru, jangan ubah file lama.`);
      continue;
    }
    await withTransaction(pool, async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migration (name, checksum) VALUES ($1, $2)', [f, sum]);
    });
    console.log(`applied ${f}`);
  }
  // System roles are code-defined and immutable through the API: keep them in sync with the FINAL matrix.
  await withTransaction(pool, async (c) => {
    const defs = [
      { key: 'superAdmin', name: 'Super admin', perms: DEFAULT_ROLE_PERMISSIONS.superAdmin },
      { key: 'admin', name: 'Admin', perms: DEFAULT_ROLE_PERMISSIONS.admin },
      { key: 'user', name: 'User', perms: DEFAULT_ROLE_PERMISSIONS.user },
    ];
    for (const d of defs) {
      const r = await c.query<{ id: string }>('SELECT id FROM app_role WHERE system_key = $1', [d.key]);
      const id = r.rows[0]?.id ?? randomUUID();
      if (!r.rows[0]) await c.query('INSERT INTO app_role (id, name, is_system, system_key) VALUES ($1, $2, true, $3)', [id, d.name, d.key]);
      await c.query('DELETE FROM app_role_permission WHERE role_id = $1', [id]);
      for (const p of d.perms) await c.query('INSERT INTO app_role_permission (role_id, permission) VALUES ($1, $2)', [id, p]);
    }
    await c.query('INSERT INTO app_settings (id, body) SELECT 1, $1 WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE id = 1)', [JSON.stringify(DEFAULT_SETTINGS)]);
  });
  console.log('migrations complete');
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
