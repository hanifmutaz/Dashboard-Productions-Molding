import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../config.js';
import { createAppPool } from '../db/pools.js';

/* Isi/ganti email login (npm run db:set-email [-- <username> <email>]) seorang user (migrasi 011: akun lama belum punya email dan tidak bisa login sampai diisi).
 * Dipakai terutama untuk super admin pertama; user lain bisa diisi dari Admin ▸ Users. Sesi aktif user itu dicabut. */
const EMAIL = /^[^@\s]+@[^@\s]+$/;
const pool = createAppPool(loadConfig(), true);
const rl = createInterface({ input: stdin, output: stdout });

async function main() {
  // Bisa sekali jalan: `npm run db:set-email -- <username> <email>`; tanpa argumen ditanya interaktif.
  const [argUser, argEmail] = process.argv.slice(2);
  const username = (argUser ?? await rl.question('Username: ')).trim();
  const email = (argEmail ?? await rl.question('Email login: ')).trim().toLowerCase();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username) || email.length > 254 || !EMAIL.test(email)) throw new Error('Input tidak valid.');
  const u = await pool.query<{ id: string }>('SELECT id FROM app_user WHERE lower(username) = lower($1)', [username]);
  const user = u.rows[0];
  if (!user) throw new Error('User tidak ditemukan.');
  const other = await pool.query('SELECT 1 FROM app_user WHERE email = $1 AND id <> $2', [email, user.id]);
  if (other.rowCount) throw new Error('Email sudah dipakai akun lain.');
  await pool.query('UPDATE app_user SET email = $2, version = version + 1, updated_at = now() WHERE id = $1', [user.id, email]);
  await pool.query('UPDATE app_session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
  await pool.query("INSERT INTO audit_log (id, actor_label, action, object_type, object_id, result) VALUES ($1, 'cli', 'admin.user.set-email', 'user', $2, 'success')", [randomUUID(), user.id]);
  console.log(`Email ${username} diset ke ${email}. Login sekarang memakai email ini.`);
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
