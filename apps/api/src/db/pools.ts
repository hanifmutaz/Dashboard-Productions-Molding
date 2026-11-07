import pg from 'pg';
import type { Config } from '../config.js';

// timestamp WITHOUT time zone (OID 1114): keep the raw string; the source timezone is applied explicitly.
pg.types.setTypeParser(1114, (v: string) => v);

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export function createAppPool(c: Config, asMigrator = false): pg.Pool {
  return new pg.Pool({
    host: c.APP_DB_HOST,
    port: c.APP_DB_PORT,
    database: c.APP_DB_NAME,
    user: asMigrator ? (c.MIGRATE_DB_USER ?? c.APP_DB_USER) : c.APP_DB_USER,
    password: asMigrator ? (c.MIGRATE_DB_PASSWORD ?? c.APP_DB_PASSWORD) : c.APP_DB_PASSWORD,
    ssl: c.APP_DB_SSL ? { rejectUnauthorized: false } : false,
    max: asMigrator ? 1 : c.APP_DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: asMigrator ? 'mpd-migrate' : 'mpd-api',
  });
}

/** ConMas: read-only account, tiny pool, statement timeout, no retry at SQL level (ADR-016/021). */
export function createConmasPool(c: Config): pg.Pool {
  return new pg.Pool({
    host: c.CONMAS_DB_HOST,
    port: c.CONMAS_DB_PORT,
    database: c.CONMAS_DB_NAME,
    user: c.CONMAS_DB_USER,
    password: c.CONMAS_DB_PASSWORD,
    ssl: c.CONMAS_DB_SSL ? { rejectUnauthorized: false } : false,
    max: c.CONMAS_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: c.CONMAS_STATEMENT_TIMEOUT_MS,
    query_timeout: c.CONMAS_STATEMENT_TIMEOUT_MS + 1_000,
    application_name: 'mpd-conmas-reader',
  });
}

export async function withTransaction<T>(pool: pg.Pool, fn: (q: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
