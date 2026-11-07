import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../config.js';
import { createAppPool } from '../db/pools.js';
import { hashPassword } from '../modules/auth/password.js';

/* Bootstrap the first Super admin (no hardcoded identity). Password is read interactively, never from argv/env. */
const pool = createAppPool(loadConfig(), true);
const rl = createInterface({ input: stdin, output: stdout });

async function main() {
  const username = (await rl.question('Username super admin: ')).trim();
  const displayName = (await rl.question('Nama tampilan: ')).trim();
  const password = await rl.question('Password (min 12 karakter): ');
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username) || !displayName || password.length < 12) throw new Error('Input tidak valid.');
  const role = await pool.query<{ id: string }>("SELECT id FROM app_role WHERE system_key = 'superAdmin'");
  if (!role.rows[0]) throw new Error('Jalankan db:migrate terlebih dahulu.');
  const id = randomUUID();
  await pool.query('INSERT INTO app_user (id, username, display_name, password_hash, role_id) VALUES ($1,$2,$3,$4,$5)', [id, username, displayName, await hashPassword(password), role.rows[0].id]);
  await pool.query("INSERT INTO audit_log (id, actor_label, action, object_type, object_id, result) VALUES ($1, 'cli', 'admin.user.bootstrap', 'user', $2, 'success')", [randomUUID(), id]);
  console.log(`Super admin ${username} dibuat.`);
}
main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    void pool.end();
  });
