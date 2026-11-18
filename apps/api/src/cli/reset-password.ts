import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../config.js';
import { createAppPool } from '../db/pools.js';
import { hashPassword } from '../modules/auth/password.js';

/* Reset password seorang user (mis. super admin yang lupa password). Dijalankan di server/laptop owner, dibaca interaktif,
 * tidak pernah dari argv/env. Semua sesi aktif user itu dicabut dan kejadian dicatat di audit_log. */
const pool = createAppPool(loadConfig(), true);
const rl = createInterface({ input: stdin, output: stdout });

async function main() {
  const username = (await rl.question('Username yang di-reset: ')).trim();
  const password = await rl.question('Password baru (min 12 karakter): ');
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username) || password.length < 12) throw new Error('Input tidak valid.');
  const u = await pool.query<{ id: string; active: boolean }>('SELECT id, active FROM app_user WHERE lower(username) = lower($1)', [username]);
  const user = u.rows[0];
  if (!user) throw new Error('User tidak ditemukan.');
  await pool.query('UPDATE app_user SET password_hash = $2, version = version + 1, updated_at = now() WHERE id = $1', [user.id, await hashPassword(password)]);
  await pool.query('UPDATE app_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
  await pool.query("INSERT INTO audit_log (id, actor_label, action, object_type, object_id, result) VALUES ($1, 'cli', 'admin.user.password-reset', 'user', $2, 'success')", [randomUUID(), user.id]);
  console.log(`Password ${username} diganti dan semua sesinya dicabut.${user.active ? '' : ' Catatan: akun ini NONAKTIF, aktifkan lewat halaman Users.'}`);
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
