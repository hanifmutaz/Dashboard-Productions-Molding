// Run as a dedicated OS backup account, outside the web server.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, stat, unlink, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function required(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Missing ${name}`);
  return value;
}
function outsideRepo(value) {
  const target = path.resolve(value);
  const relative = path.relative(root, target);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Backup/evidence must be outside repository');
  return target;
}
function run(command, args, env) {
  const result = spawnSync(command, args, { env, stdio: ['ignore', 'ignore', 'ignore'], timeout: 60 * 60 * 1000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed (exit ${result.status ?? 'unknown'})`);
}
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function main() {
  const dir = outsideRepo(required('MPD_BACKUP_DIR'));
  const evidence = outsideRepo(required('MPD_BACKUP_EVIDENCE_FILE'));
  const host = required('APP_DB_HOST'), db = required('APP_DB_NAME');
  const user = required('MPD_BACKUP_DB_USER');
  if (host === process.env.CONMAS_DB_HOST && db === process.env.CONMAS_DB_NAME) throw new Error('Refusing configured ConMas database');
  const env = { ...process.env, PGHOST: host, PGPORT: process.env.APP_DB_PORT || '5432', PGDATABASE: db, PGUSER: user, PGPASSWORD: required('MPD_BACKUP_DB_PASSWORD'), PGSSLMODE: process.env.APP_DB_SSL === 'true' ? 'verify-full' : 'disable' };
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  delete env.PGHOSTADDR;
  delete env.PGOPTIONS;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(evidence), { recursive: true, mode: 0o700 });
  const lockPath = path.join(dir, '.mpd-backup.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const output = path.join(dir, `mpd-${stamp}.dump`), partial = output + '.partial';
  const evidenceTemp = evidence + `.tmp-${process.pid}`;
  try {
    const placeholder = await open(partial, 'wx', 0o600);
    await placeholder.close();
    run(process.env.MPD_PG_DUMP || 'pg_dump', ['--no-password', '--format=custom', '--file', partial], env);
    if ((await stat(partial)).size === 0) throw new Error('Empty backup');
    run(process.env.MPD_PG_RESTORE || 'pg_restore', ['--list', partial], env);
    const backupSha256 = await digest(partial);
    await rename(partial, output);
    // A successful archive check is not a restore test. Preserve no stale PASS for a new archive.
    await writeFile(evidenceTemp, JSON.stringify({ backupAt: new Date().toISOString(), restoreTestAt: null, restorePassed: null, backupSha256 }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(evidenceTemp, evidence);
    const recorded = JSON.parse(await readFile(evidence, 'utf8'));
    if (recorded.backupSha256 !== backupSha256) throw new Error('Evidence mismatch');
    console.log(`Backup archive checked: ${path.basename(output)}; SHA-256 ${backupSha256}`);
  } finally {
    await unlink(partial).catch(() => undefined);
    await unlink(evidenceTemp).catch(() => undefined);
    await lock.close();
    await unlink(lockPath);
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'Backup failed'); process.exitCode = 1; });
