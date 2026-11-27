import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AuditEntry, KioskDevice, Material, Part, Registration, RegistrationStatus, SettingsBody, StopCategory, StopCategoryInput } from '@mpd/contracts';
import type { Queryable } from './pools.js';
import { withTransaction } from './pools.js';

/* All SQL lives in this data-access layer (STATE §6). Interfaces allow in-memory fakes in tests. */

export interface UserRow {
  id: string; username: string; email: string | null; displayName: string; department: string | null; passwordHash: string;
  roleId: string; roleName: string; roleSystemKey: string | null; active: boolean; status: RegistrationStatus; lastLoginAt: string | null; version: number;
}
export interface RegisterInput { email: string; username: string; displayName: string; department: string; purpose: string; passwordHash: string; roleId: string }

/** Postgres unique_violation (23505), mis. email/username yang sama didaftarkan bersamaan. */
export const isUniqueViolation = (e: unknown): boolean => typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === '23505';
export interface RoleRow { id: string; name: string; description: string | null; isSystem: boolean; systemKey: string | null; permissions: string[]; userCount: number; version: number }
export interface SessionRow { idHash: string; userId: string; csrfToken: string; lastSeenAt: Date; absoluteExpiresAt: Date; revokedAt: Date | null }
export interface AuditInput { actorUserId: string | null; actorLabel: string | null; requestId: string | null; action: string; objectType?: string | null; objectId?: string | null; result: 'success' | 'failure' | 'denied'; detail?: unknown }
export interface SettingsRow { body: SettingsBody; version: number; updatedAt: string; updatedBy: string | null }
export interface KioskRow extends KioskDevice { tokenHash: string }

export interface Repos {
  transaction<T>(work: () => Promise<T>): Promise<T>;
  throttle: {
    attempt(key: string, max: number, windowMs: number): Promise<boolean>;
    clear(key: string): Promise<void>;
    pruneExpired(): Promise<void>;
  };
  users: {
    byUsername(username: string): Promise<UserRow | null>;
    byEmail(email: string): Promise<UserRow | null>;
    byId(id: string): Promise<UserRow | null>;
    /** Hanya akun yang sudah disetujui; pendaftar pending/rejected ada di `registrations`. */
    list(): Promise<UserRow[]>;
    create(u: { username: string; email: string; displayName: string; department: string | null; passwordHash: string; roleId: string }): Promise<string>;
    /** Hanya mengubah akun 'approved'; false = konflik versi atau akun belum disetujui. */
    update(id: string, u: { email: string | null; displayName: string; department: string | null; roleId: string; active: boolean }, version: number): Promise<boolean>;
    setPassword(id: string, hash: string): Promise<void>;
    touchLogin(id: string): Promise<void>;
    /** Akun baru berstatus 'pending' (active=false). Email yang pernah ditolak boleh mendaftar ulang (baris lama dipakai lagi). */
    register(u: RegisterInput): Promise<{ id: string; again: boolean }>;
    registrations(status: Exclude<RegistrationStatus, 'approved'>): Promise<Registration[]>;
    pendingCount(): Promise<number>;
    approve(id: string, roleId: string, by: string, version: number): Promise<boolean>;
    reject(id: string, note: string | null, by: string, version: number): Promise<boolean>;
  };
  roles: {
    list(): Promise<RoleRow[]>;
    byId(id: string): Promise<RoleRow | null>;
    create(r: { name: string; description: string | null; permissions: string[] }): Promise<string>;
    update(id: string, r: { name: string; description: string | null; permissions: string[] }, version: number): Promise<boolean>;
    remove(id: string): Promise<boolean>;
  };
  sessions: {
    create(s: { idHash: string; userId: string; csrfToken: string; absoluteExpiresAt: Date }): Promise<void>;
    get(idHash: string): Promise<SessionRow | null>;
    touch(idHash: string): Promise<void>;
    revoke(idHash: string): Promise<void>;
    revokeForUser(userId: string): Promise<void>;
  };
  audit: { append(e: AuditInput): Promise<void>; list(q: { action?: string; actor?: string; actorUserId?: string; before?: string; limit: number }): Promise<AuditEntry[]> };
  settings: { get(): Promise<SettingsRow | null>; update(body: SettingsBody, version: number, actor: string): Promise<SettingsRow | null>; init(body: SettingsBody): Promise<void> };
  prefs: { get(userId: string): Promise<unknown>; put(userId: string, body: unknown): Promise<void> };
  master: {
    lockCategories(): Promise<void>;
    parts(): Promise<Part[]>;
    materials(): Promise<Material[]>;
    categories(): Promise<StopCategory[]>;
    /** Returns dpNo values that failed the optimistic version check (nothing is written when non-empty). */
    upsertPartPrices(items: { dpNo: string; pricePerPcs: number; version: number | null; name?: string }[], actor: string): Promise<string[]>;
    upsertMaterials(
      materials: { code: string; name: string; pricePerGram: number; version: number | null }[],
      parts: { dpNo: string; materialCode: string; version: number | null }[],
      actor: string,
    ): Promise<string[]>;
    /** Insert (version null) or update with optimistic version check. `id` is already resolved by the caller. False = conflict. */
    saveCategory(c: Omit<StopCategoryInput, 'id'> & { id: string }): Promise<boolean>;
    deleteCategory(id: string, version: number): Promise<boolean>;
  };
  kiosks: {
    createPairing(p: { codeHash: string; name: string; machineNo: string; expiresAt: Date; createdBy: string }): Promise<void>;
    redeem(codeHash: string, tokenHash: string): Promise<KioskDevice | null>;
    byTokenHash(hash: string): Promise<KioskRow | null>;
    list(): Promise<KioskDevice[]>;
    revoke(id: string, by: string): Promise<boolean>;
    touch(id: string): Promise<void>;
  };
  ping(): Promise<void>;
  schemaReady(names: string[]): Promise<boolean>;
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);

type Row = Record<string, unknown>;
const userFrom = (r: Row): UserRow => ({
  id: String(r.id), username: String(r.username), email: (r.email as string | null) ?? null, displayName: String(r.display_name), department: (r.department as string | null) ?? null,
  passwordHash: String(r.password_hash), roleId: String(r.role_id), roleName: String(r.role_name), roleSystemKey: (r.system_key as string | null) ?? null,
  active: Boolean(r.active), status: r.status as RegistrationStatus, lastLoginAt: iso(r.last_login_at), version: Number(r.version),
});
const registrationFrom = (r: Row): Registration => ({
  id: String(r.id), email: String(r.email), displayName: String(r.display_name), department: (r.department as string | null) ?? null, purpose: (r.purpose as string | null) ?? null,
  status: r.status as RegistrationStatus, createdAt: iso(r.created_at) ?? '', reviewedAt: iso(r.reviewed_at), reviewedBy: (r.reviewer_name as string | null) ?? null,
  reviewNote: (r.review_note as string | null) ?? null, version: Number(r.version),
});
const USER_SQL = `SELECT u.*, r.name AS role_name, r.system_key FROM app_user u JOIN app_role r ON r.id = u.role_id`;
const ROLE_SQL = `SELECT r.*, COALESCE((SELECT array_agg(p.permission ORDER BY p.permission) FROM app_role_permission p WHERE p.role_id = r.id), '{}') AS permissions,
  (SELECT count(*) FROM app_user u WHERE u.role_id = r.id AND u.status = 'approved') AS user_count FROM app_role r`;
const roleFrom = (r: Row): RoleRow => ({
  id: String(r.id), name: String(r.name), description: (r.description as string | null) ?? null, isSystem: Boolean(r.is_system),
  systemKey: (r.system_key as string | null) ?? null, permissions: (r.permissions as string[]) ?? [], userCount: Number(r.user_count), version: Number(r.version),
});
const kioskFrom = (r: Row): KioskRow => ({
  id: String(r.id), name: String(r.name), machineNo: String(r.machine_no), tokenHash: String(r.token_hash), createdAt: iso(r.created_at) ?? '',
  lastSeenAt: iso(r.last_seen_at), revokedAt: iso(r.revoked_at),
});

async function setRolePermissions(c: Queryable, roleId: string, permissions: string[]) {
  await c.query('DELETE FROM app_role_permission WHERE role_id = $1', [roleId]);
  for (const p of permissions) await c.query('INSERT INTO app_role_permission (role_id, permission) VALUES ($1, $2)', [roleId, p]);
}

class VersionConflict extends Error {
  constructor(public readonly keys: string[]) {
    super('version conflict');
  }
}

export function createPgRepos(pool: pg.Pool): Repos {
  const context = new AsyncLocalStorage<pg.PoolClient>();
  const q: Queryable = { query: (text, values) => (context.getStore() ?? pool).query(text, values) };
  const run = <T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
    const client = context.getStore();
    return client ? work(client) : withTransaction(pool, (tx) => context.run(tx, () => work(tx)));
  };
  let preparedSchema: { key: string; until: number } | null = null;
  const getSettings = async (): Promise<SettingsRow | null> => {
    const r = await q.query('SELECT s.body, s.version, s.updated_at, u.display_name FROM app_settings s LEFT JOIN app_user u ON u.id = s.updated_by WHERE s.id = 1');
    const x = r.rows[0];
    return x ? { body: x.body as SettingsBody, version: Number(x.version), updatedAt: iso(x.updated_at) ?? '', updatedBy: (x.display_name as string | null) ?? null } : null;
  };
  const conflictKeys = (e: unknown): string[] => {
    if (e instanceof VersionConflict) return e.keys;
    throw e;
  };
  return {
    transaction: (work) => run(work),
    throttle: {
      async attempt(key, max, windowMs) {
        // A database-side reservation enforces the same bound across workers and concurrent requests.
        const result = await q.query(`
          INSERT INTO auth_attempt_window AS w (bucket, attempts, expires_at)
          VALUES ($1, 1, now() + $3::integer * interval '1 millisecond')
          ON CONFLICT (bucket) DO UPDATE
            SET attempts = CASE WHEN w.expires_at <= now() THEN 1 ELSE w.attempts + 1 END,
                expires_at = CASE WHEN w.expires_at <= now() THEN EXCLUDED.expires_at ELSE w.expires_at END
            WHERE w.expires_at <= now() OR w.attempts < $2
          RETURNING attempts`, [key, max, windowMs]);
        return result.rowCount === 1;
      },
      async clear(key) { await q.query('DELETE FROM auth_attempt_window WHERE bucket=$1', [key]); },
      async pruneExpired() {
        await q.query('DELETE FROM auth_attempt_window WHERE bucket IN (SELECT bucket FROM auth_attempt_window WHERE expires_at <= now() ORDER BY expires_at LIMIT 10000)');
      },
    },
    users: {
      async byUsername(username) {
        const r = await q.query(`${USER_SQL} WHERE lower(u.username) = lower($1)`, [username]);
        return r.rows[0] ? userFrom(r.rows[0]) : null;
      },
      async byEmail(email) {
        const r = await q.query(`${USER_SQL} WHERE u.email = lower(btrim($1))`, [email]);
        return r.rows[0] ? userFrom(r.rows[0]) : null;
      },
      async byId(id) {
        const r = await q.query(`${USER_SQL} WHERE u.id = $1`, [id]);
        return r.rows[0] ? userFrom(r.rows[0]) : null;
      },
      async list() {
        return (await q.query(`${USER_SQL} WHERE u.status = 'approved' ORDER BY lower(u.username)`)).rows.map(userFrom);
      },
      async create(u) {
        const id = randomUUID();
        await q.query('INSERT INTO app_user (id, username, email, display_name, department, password_hash, role_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, u.username, u.email, u.displayName, u.department, u.passwordHash, u.roleId]);
        return id;
      },
      async update(id, u, version) {
        const r = await q.query(
          "UPDATE app_user SET email=$2, display_name=$3, department=$4, role_id=$5, active=$6, version=version+1, updated_at=now() WHERE id=$1 AND version=$7 AND status='approved'",
          [id, u.email, u.displayName, u.department, u.roleId, u.active, version],
        );
        return r.rowCount === 1;
      },
      async setPassword(id, hash) {
        await q.query('UPDATE app_user SET password_hash=$2, version=version+1, updated_at=now() WHERE id=$1', [id, hash]);
      },
      async touchLogin(id) {
        await q.query('UPDATE app_user SET last_login_at=now() WHERE id=$1', [id]);
      },
      async register(u) {
        return run(async (c) => {
          const again = await c.query(
            `UPDATE app_user SET display_name=$2, department=$3, purpose=$4, password_hash=$5, role_id=$6, status='pending', active=false,
               reviewed_by=NULL, reviewed_at=NULL, review_note=NULL, created_at=now(), version=version+1, updated_at=now()
             WHERE email=$1 AND status='rejected' RETURNING id`,
            [u.email, u.displayName, u.department, u.purpose, u.passwordHash, u.roleId],
          );
          const prior = again.rows[0] as Row | undefined;
          if (prior) return { id: String(prior.id), again: true };
          const id = randomUUID();
          await c.query(
            "INSERT INTO app_user (id, username, email, display_name, department, purpose, password_hash, role_id, status, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',false)",
            [id, u.username, u.email, u.displayName, u.department, u.purpose, u.passwordHash, u.roleId],
          );
          return { id, again: false };
        });
      },
      async registrations(status) {
        const r = await q.query(
          `SELECT u.*, rv.display_name AS reviewer_name FROM app_user u LEFT JOIN app_user rv ON rv.id = u.reviewed_by
           WHERE u.status = $1 ORDER BY u.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 500`, [status]);
        return r.rows.map(registrationFrom);
      },
      async pendingCount() {
        return Number((await q.query("SELECT count(*) AS n FROM app_user WHERE status = 'pending'")).rows[0]?.n ?? 0);
      },
      async approve(id, roleId, by, version) {
        const r = await q.query(
          `UPDATE app_user SET status='approved', active=true, role_id=$2, reviewed_by=$3, reviewed_at=now(), review_note=NULL, version=version+1, updated_at=now()
           WHERE id=$1 AND status='pending' AND version=$4`, [id, roleId, by, version]);
        return r.rowCount === 1;
      },
      async reject(id, note, by, version) {
        const r = await q.query(
          `UPDATE app_user SET status='rejected', active=false, reviewed_by=$2, reviewed_at=now(), review_note=$3, version=version+1, updated_at=now()
           WHERE id=$1 AND status='pending' AND version=$4`, [id, by, note, version]);
        return r.rowCount === 1;
      },
    },
    roles: {
      async list() {
        return (await q.query(`${ROLE_SQL} ORDER BY r.is_system DESC, r.name`)).rows.map(roleFrom);
      },
      async byId(id) {
        const r = await q.query(`${ROLE_SQL} WHERE r.id = $1`, [id]);
        return r.rows[0] ? roleFrom(r.rows[0]) : null;
      },
      async create(role) {
        const id = randomUUID();
        await run(async (c) => {
          await c.query('INSERT INTO app_role (id, name, description) VALUES ($1,$2,$3)', [id, role.name, role.description]);
          await setRolePermissions(c, id, role.permissions);
        });
        return id;
      },
      async update(id, role, version) {
        return run(async (c) => {
          const r = await c.query('UPDATE app_role SET name=$2, description=$3, version=version+1, updated_at=now() WHERE id=$1 AND version=$4 AND NOT is_system', [id, role.name, role.description, version]);
          if (r.rowCount !== 1) return false;
          await setRolePermissions(c, id, role.permissions);
          return true;
        });
      },
      async remove(id) {
        const r = await q.query('DELETE FROM app_role WHERE id=$1 AND NOT is_system AND NOT EXISTS (SELECT 1 FROM app_user u WHERE u.role_id=$1)', [id]);
        return r.rowCount === 1;
      },
    },
    sessions: {
      async create(s) {
        await q.query('INSERT INTO app_session (id_hash, user_id, csrf_token, absolute_expires_at) VALUES ($1,$2,$3,$4)', [s.idHash, s.userId, s.csrfToken, s.absoluteExpiresAt]);
      },
      // csrf_token bertipe char(64): Postgres mengisi spasi di kanan, sedangkan header HTTP tidak membawanya -> trimEnd.
      async get(idHash) {
        const r = await q.query('SELECT * FROM app_session WHERE id_hash=$1', [idHash]);
        const s = r.rows[0];
        return s
          ? { idHash: String(s.id_hash), userId: String(s.user_id), csrfToken: String(s.csrf_token).trimEnd(), lastSeenAt: s.last_seen_at as Date, absoluteExpiresAt: s.absolute_expires_at as Date, revokedAt: (s.revoked_at as Date | null) ?? null }
          : null;
      },
      async touch(idHash) {
        await q.query('UPDATE app_session SET last_seen_at=now() WHERE id_hash=$1', [idHash]);
      },
      async revoke(idHash) {
        await q.query('UPDATE app_session SET revoked_at=now() WHERE id_hash=$1 AND revoked_at IS NULL', [idHash]);
      },
      async revokeForUser(userId) {
        await q.query('UPDATE app_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
      },
    },
    audit: {
      async append(e) {
        await q.query(
          'INSERT INTO audit_log (id, actor_user_id, actor_label, request_id, action, object_type, object_id, result, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [randomUUID(), e.actorUserId, e.actorLabel, e.requestId, e.action, e.objectType ?? null, e.objectId ?? null, e.result, e.detail === undefined ? null : JSON.stringify(e.detail)],
        );
      },
      async list(f) {
        const where: string[] = [];
        const v: unknown[] = [];
        if (f.action) { v.push(`${f.action}%`); where.push(`action LIKE $${v.length}`); }
        if (f.actor) { v.push(`%${f.actor}%`); where.push(`actor_label ILIKE $${v.length}`); }
        if (f.actorUserId) { v.push(f.actorUserId); where.push(`actor_user_id = $${v.length}`); }
        if (f.before) { v.push(f.before); where.push(`at < $${v.length}`); }
        v.push(f.limit);
        const r = await q.query(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC LIMIT $${v.length}`, v);
        return r.rows.map((x: Row) => ({
          id: String(x.id), at: iso(x.at) ?? '', actor: (x.actor_label as string | null) ?? null, requestId: (x.request_id as string | null) ?? null, action: String(x.action),
          objectType: (x.object_type as string | null) ?? null, objectId: (x.object_id as string | null) ?? null, result: x.result as AuditEntry['result'], detail: x.detail,
        }));
      },
    },
    settings: {
      get: getSettings,
      async update(body, version, actor) {
        const r = await q.query('UPDATE app_settings SET body=$1, version=version+1, updated_at=now(), updated_by=$3 WHERE id=1 AND version=$2', [JSON.stringify(body), version, actor]);
        return r.rowCount === 1 ? getSettings() : null;
      },
      async init(body) {
        await q.query('INSERT INTO app_settings (id, body) SELECT 1, $1 WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE id = 1)', [JSON.stringify(body)]);
      },
    },
    prefs: {
      async get(userId) {
        return ((await q.query<{ body: unknown }>('SELECT body FROM user_preference WHERE user_id=$1', [userId])).rows[0])?.body ?? null;
      },
      async put(userId, body) {
        // PG 9.5 supports ON CONFLICT.
        await q.query('INSERT INTO user_preference (user_id, body) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()', [userId, JSON.stringify(body)]);
      },
    },
    master: {
      async lockCategories() {
        if (!context.getStore()) throw new Error('Category lock requires an active transaction');
        await q.query('SELECT pg_advisory_xact_lock(414017, 1)');
      },
      async parts() {
        return (await q.query('SELECT * FROM md_part ORDER BY dp_no')).rows.map((r: Row) => ({
          dpNo: String(r.dp_no), name: String(r.name), pricePerPcs: r.price_per_pcs == null ? null : Number(r.price_per_pcs), materialCode: (r.material_code as string | null) ?? null, version: Number(r.version),
        }));
      },
      async materials() {
        return (await q.query('SELECT * FROM md_material ORDER BY code')).rows.map((r: Row) => ({
          code: String(r.code), name: String(r.name), pricePerGram: r.price_per_gram == null ? null : Number(r.price_per_gram), version: Number(r.version),
        }));
      },
      async categories() {
        return (await q.query('SELECT * FROM md_stop_category ORDER BY sort_order, id')).rows.map((r: Row) => ({
          id: String(r.id), short: String(r.short_name), name: String(r.name), group: r.loss_group as StopCategory['group'], oeeBucket: r.oee_bucket as StopCategory['oeeBucket'],
          infoOnly: Boolean(r.info_only), color: String(r.color), aliases: (r.aliases as string[]) ?? [], details: (r.details as string[]) ?? [], notes: (r.notes as string | null) ?? null, version: Number(r.version),
        }));
      },
      async upsertPartPrices(items, actor) {
        return run(async (c) => {
          const failed: string[] = [];
          for (const it of items) {
            if (it.version === null) {
              const r = await c.query('INSERT INTO md_part (dp_no, name, price_per_pcs, updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (dp_no) DO NOTHING', [it.dpNo, it.name ?? '', it.pricePerPcs, actor]);
              if (r.rowCount !== 1) failed.push(it.dpNo);
            } else {
              const r = await c.query('UPDATE md_part SET price_per_pcs=$2, version=version+1, updated_at=now(), updated_by=$4 WHERE dp_no=$1 AND version=$3', [it.dpNo, it.pricePerPcs, it.version, actor]);
              if (r.rowCount !== 1) failed.push(it.dpNo);
            }
          }
          if (failed.length) throw new VersionConflict(failed);
          return failed;
        }).catch(conflictKeys);
      },
      async upsertMaterials(materials, parts, actor) {
        return run(async (c) => {
          const failed: string[] = [];
          for (const m of materials) {
            const r = m.version === null
              ? await c.query('INSERT INTO md_material (code, name, price_per_gram, updated_by) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING', [m.code, m.name, m.pricePerGram, actor])
              : await c.query('UPDATE md_material SET name=$2, price_per_gram=$3, version=version+1, updated_at=now(), updated_by=$5 WHERE code=$1 AND version=$4', [m.code, m.name, m.pricePerGram, m.version, actor]);
            if (r.rowCount !== 1) failed.push(m.code);
          }
          for (const p of parts) {
            const r = p.version === null
              ? await c.query('INSERT INTO md_part (dp_no, material_code, updated_by) VALUES ($1,$2,$3) ON CONFLICT (dp_no) DO NOTHING', [p.dpNo, p.materialCode, actor])
              : await c.query('UPDATE md_part SET material_code=$2, version=version+1, updated_at=now(), updated_by=$4 WHERE dp_no=$1 AND version=$3', [p.dpNo, p.materialCode, p.version, actor]);
            if (r.rowCount !== 1) failed.push(p.dpNo);
          }
          if (failed.length) throw new VersionConflict(failed);
          return failed;
        }).catch(conflictKeys);
      },
      async saveCategory(c) {
        const f = [c.id, c.short, c.name, c.group, c.oeeBucket, c.infoOnly, c.color, c.aliases, c.details, c.notes];
        if (c.version === null) {
          const r = await q.query(
            `INSERT INTO md_stop_category (id, short_name, name, loss_group, oee_bucket, info_only, color, aliases, details, notes, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::text[],$10,(SELECT COALESCE(MAX(sort_order), -1) + 1 FROM md_stop_category)) ON CONFLICT (id) DO NOTHING`, f);
          return r.rowCount === 1;
        }
        const r = await q.query(
          `UPDATE md_stop_category SET short_name=$2, name=$3, loss_group=$4, oee_bucket=$5, info_only=$6, color=$7, aliases=$8::text[], details=$9::text[], notes=$10, version=version+1
           WHERE id=$1 AND version=$11`, [...f, c.version]);
        return r.rowCount === 1;
      },
      async deleteCategory(id, version) {
        return (await q.query('DELETE FROM md_stop_category WHERE id=$1 AND version=$2', [id, version])).rowCount === 1;
      },
    },
    kiosks: {
      async createPairing(p) {
        await q.query('INSERT INTO kiosk_pairing (code_hash, name, machine_no, created_by, expires_at) VALUES ($1,$2,$3,$4,$5)', [p.codeHash, p.name, p.machineNo, p.createdBy, p.expiresAt]);
      },
      async redeem(codeHash, tokenHash) {
        return run(async (c) => {
          // Row lock guarantees a pairing code is used exactly once even with concurrent redeem attempts.
          const r = await c.query('SELECT * FROM kiosk_pairing WHERE code_hash=$1 AND used_at IS NULL AND expires_at > now() FOR UPDATE', [codeHash]);
          const p = r.rows[0] as Row | undefined;
          if (!p) return null;
          const id = randomUUID();
          await c.query('INSERT INTO kiosk_device (id, name, machine_no, token_hash, created_by) VALUES ($1,$2,$3,$4,$5)', [id, p.name, p.machine_no, tokenHash, p.created_by]);
          await c.query('UPDATE kiosk_pairing SET used_at=now(), device_id=$2 WHERE code_hash=$1', [codeHash, id]);
          return { id, name: String(p.name), machineNo: String(p.machine_no), createdAt: new Date().toISOString(), lastSeenAt: null, revokedAt: null };
        });
      },
      async byTokenHash(hash) {
        const r = await q.query('SELECT * FROM kiosk_device WHERE token_hash=$1', [hash]);
        return r.rows[0] ? kioskFrom(r.rows[0]) : null;
      },
      async list() {
        return (await q.query('SELECT * FROM kiosk_device ORDER BY created_at DESC')).rows.map((r: Row) => {
          const { tokenHash: _t, ...k } = kioskFrom(r);
          return k;
        });
      },
      async revoke(id, by) {
        return (await q.query('UPDATE kiosk_device SET revoked_at=now(), revoked_by=$2 WHERE id=$1 AND revoked_at IS NULL', [id, by])).rowCount === 1;
      },
      async touch(id) {
        await q.query('UPDATE kiosk_device SET last_seen_at=now() WHERE id=$1', [id]);
      },
    },
    async ping() {
      await q.query('SELECT 1');
    },
    async schemaReady(names) {
      const key = names.join(',');
      if (preparedSchema?.key === key && preparedSchema.until > Date.now()) return true;
      const result = await q.query('SELECT name FROM schema_migration WHERE name = ANY($1::text[])', [names]);
      if (result.rowCount !== names.length) return false;
      preparedSchema = { key, until: Date.now() + 10_000 };
      return true;
    },
  };
}
