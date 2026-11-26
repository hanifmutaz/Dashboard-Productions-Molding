import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createAppPool, createConmasPool } from './db/pools.js';
import { migrationFiles } from './db/migrations.js';
import { createPgRepos } from './db/repos.js';
import { createApp } from './http/app.js';
import { createLogger } from './logger.js';
import { createConmasSource } from './modules/conmas/source.js';

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL);
if (!config.COOKIE_SECURE) log.warn('COOKIE_SECURE=false: session cookie dikirim tanpa TLS. Hanya boleh dengan exception tercatat.');

const appPool = createAppPool(config);
const conmasPool = createConmasPool(config);
appPool.on('error', (err) => log.error({ err }, 'app db pool error'));
conmasPool.on('error', (err) => log.error({ err }, 'conmas pool error'));

const here = path.dirname(fileURLToPath(import.meta.url));
const offset = config.CONMAS_SOURCE_TIMEZONE_OFFSET;
const tzOffsetMinutes = (offset.startsWith('-') ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));

const repos = createPgRepos(appPool);
const requiredMigrations = migrationFiles();
const app = createApp({
  repos,
  requiredMigrations,
  operationsPool: appPool,
  conmas: createConmasSource(conmasPool, {
    view: config.CONMAS_VIEW, tzOffset: offset, cacheTtlSeconds: Math.min(config.CONMAS_CACHE_TTL_SECONDS, 60),
    cols: { recordId: config.CONMAS_COL_RECORD_ID, revNo: config.CONMAS_COL_REV_NO, deleted: config.CONMAS_COL_DELETED, updatedAt: config.CONMAS_COL_UPDATED_AT },
    rates: { oee: config.CONMAS_COL_OEE, availability: config.CONMAS_COL_AVAILABILITY, performance: config.CONMAS_COL_PERFORMANCE },
    rateScale: config.CONMAS_RATE_SCALE,
    personnelNames: {
      leader: config.CONMAS_COL_LEADER_NAME,
      cell: config.CONMAS_COL_CELL_LEADER_NAME,
      technician: config.CONMAS_COL_TECHNICIAN_NAME,
      operator: config.CONMAS_COL_OPERATOR_NAME,
    },
  }, log, appPool),
  log,
  publicOrigin: config.PUBLIC_ORIGIN,
  cookieSecure: config.COOKIE_SECURE,
  idleMinutes: config.SESSION_IDLE_MINUTES,
  absoluteHours: config.SESSION_ABSOLUTE_HOURS,
  trustProxy: config.TRUST_PROXY === 'true' ? true : config.TRUST_PROXY === 'false' ? false : config.TRUST_PROXY,
  tzOffsetMinutes,
  version: process.env.npm_package_version ?? '1.0.0',
  employeePhotoDir: config.EMPLOYEE_PHOTO_DIR || undefined,
  webDist: config.WEB_DIST ?? path.resolve(here, '../../web/dist'),
});

const server = app.listen(config.PORT, config.HOST, () => log.info({ port: config.PORT, host: config.HOST, env: config.NODE_ENV }, 'Molding PM Dashboard API started'));

const pruneAttempts = async () => {
  if (await repos.schemaReady(requiredMigrations)) await repos.throttle.pruneExpired();
};
const pruneTimer = setInterval(() => { void pruneAttempts().catch((err: unknown) => log.warn({ err }, 'auth attempt windows cleanup failed')); }, 15 * 60_000);
pruneTimer.unref();

function shutdown(signal: string) {
  clearInterval(pruneTimer);
  log.info({ signal }, 'shutting down');
  server.close(() => {
    void Promise.allSettled([appPool.end(), conmasPool.end()]).then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
