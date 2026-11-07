import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AuditEntry, KioskDevice, Material, Part, SettingsBody, StopCategory } from '@mpd/contracts';
import type { Queryable } from './pools.js';
import { withTransaction } from './pools.js';

/* All SQL lives in this data-access layer (STATE §6). Interfaces allow in-memory fakes in tests. */

export interface UserRow {
  id: string; username: string; displayName: string; department: string | null; passwordHash: string;
  roleId: string; roleName: string; roleSystemKey: string | null; active: boolean; lastLoginAt: string | null; version: number;
}
export interface RoleRow { id: string; name: string; description: string | null; isSystem: boolean; systemKey: string | null; permissions: string[]; userCount: number; version: number }
export interface SessionRow { idHash: string; userId: string; csrfToken: string; lastSeenAt: Date; absoluteExpiresAt: Date; revokedAt: Date | null }
export interface AuditInput { actorUserId: string | null; actorLabel: string | null; requestId: string | null; action: string; objectType?: string | null; objectId?: string | null; result: 'success' | 'failure' | 'denied'; detail?: unknown }
export interface SettingsRow { body: SettingsBody; version: number; updatedAt: string; updatedBy: string | null }
export interface KioskRow extends KioskDevice { tokenHash: string }

export interface Repos {
  users: {
    byUsername(username: string): Promise<UserRow | null>;
    byId(id: string): Promise<UserRow | null>;
    list(): Promise<UserRow[]>;
    create(u: { username: string; displayName: string; department: string | null; passwordHash: string; roleId: string }): Promise<string>;
    update(id: string, u: { displayName: string; department: string | null; roleId: string; active: boolean }, version: number): Promise<boolean>;
    setPassword(id: string, hash: string): Promise<void>;
    touchLogin(id: string): Promise<void>;
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
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);

type Row = Record<string, unknown>;
const userFrom = (r: Row): UserRow => ({
  id: String(r.id), username: String(r.username), displayName: String(r.display_name), department: (r.department as string | null) ?? null,
  passwordHash: String(r.password_hash), roleId: String(r.role_id), roleName: String(r.role_name), roleSystemKey: (r.system_key as string | null) ?? null,
  active: Boolean(r.active), lastLoginAt: iso(r.last_login_at), version: Number(r.version),
});
const USER_SQL = `SELECT u.*, r.name AS role_name, r.system_key FROM app_user u JOIN app_role r ON r.id = u.role_id`;
const ROLE_SQL = `SELECT r.*, COALESCE((SELECT array_agg(p.permission ORDER BY p.permission) FROM app_role_permission p WHERE p.role_id = r.id), '{}') AS permissions,
  (SELECT count(*) FROM app_user u WHERE u.role_id = r.id) AS user_count FROM app_role r`;
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
  const q = pool;
  const getSettings = async (): Promise<SettingsRow | null> => {
    const r = await q.query('SELECT s.body, s.version, s.updated_at, u.display_name FROM app_settings s LEFT JOIN app_user u ON u.id = s.updated_by WHERE s.id = 1');
    const x = r.rows[0] as Row | undefined;
    return x ? { body: x.body as SettingsBody, version: Number(x.version), updatedAt: iso(x.updated_at) ?? '', updatedBy: (x.display_name as string | null) ?? null } : null;
  };
  const conflictKeys = (e: unknown): string[] => {
    if (e instanceof VersionConflict) return e.keys;
    throw e;
  };
  return {
    users: {
      async byUsername(username) {
        const r = await q.query(`${USER_SQL} WHERE lower(u.username) = lower($1)`, [username]);
        return r.rows[0] ? userFrom(r.rows[0] as Row) : null;
      },
      async byId(id) {
        const r = await q.query(`${USER_SQL} WHERE u.id = $1`, [id]);
        return r.rows[0] ? userFrom(r.rows[0] as Row) : null;
      },
      async list() {
        return (await q.query(`${USER_SQL} ORDER BY lower(u.username)`)).rows.map(userFrom);
      },
      async create(u) {
        const id = randomUUID();
        await q.query('INSERT INTO app_user (id, username, display_name, department, password_hash, role_id) VALUES ($1,$2,$3,$4,$5,$6)', [id, u.username, u.displayName, u.department, u.passwordHash, u.roleId]);
        return id;
      },
      async update(id, u, version) {
        const r = await q.query(
          'UPDATE app_user SET display_name=$2, department=$3, role_id=$4, active=$5, version=version+1, updated_at=now() WHERE id=$1 AND version=$6',
          [id, u.displayName, u.department, u.roleId, u.active, version],
        );
        return r.rowCount === 1;
      },
      async setPassword(id, hash) {
        await q.query('UPDATE app_user SET password_hash=$2, version=version+1, updated_at=now() WHERE id=$1', [id, hash]);
      },
      async touchLogin(id) {
        await q.query('UPDATE app_user SET last_login_at=now() WHERE id=$1', [id]);
      },
    },
    roles: {
      async list() {
        return (await q.query(`${ROLE_SQL} ORDER BY r.is_system DESC, r.name`)).rows.map(roleFrom);
      },
      async byId(id) {
        const r = await q.query(`${ROLE_SQL} WHERE r.id = $1`, [id]);
        return r.rows[0] ? roleFrom(r.rows[0] as Row) : null;
      },
      async create(role) {
        const id = randomUUID();
        await withTransaction(pool, async (c) => {
          await c.query('INSERT INTO app_role (id, name, description) VALUES ($1,$2,$3)', [id, role.name, role.description]);
          await setRolePermissions(c, id, role.permissions);
        });
        return id;
      },
      async update(id, role, version) {
        return withTransaction(pool, async (c) => {
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
      async get(idHash) {
        const r = await q.query('SELECT * FROM app_session WHERE id_hash=$1', [idHash]);
        const s = r.rows[0] as Row | undefined;
        return s
          ? { idHash: String(s.id_hash), userId: String(s.user_id), csrfToken: String(s.csrf_token), lastSeenAt: s.last_seen_at as Date, absoluteExpiresAt: s.absolute_expires_at as Date, revokedAt: (s.revoked_at as Date | null) ?? null }
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
        return ((await q.query('SELECT body FROM user_preference WHERE user_id=$1', [userId])).rows[0] as Row | undefined)?.body ?? null;
      },
      async put(userId, body) {
        // PG 9.5 supports ON CONFLICT.
        await q.query('INSERT INTO user_preference (user_id, body) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()', [userId, JSON.stringify(body)]);
      },
    },
    master: {
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
        return withTransaction(pool, async (c) => {
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
        return withTransaction(pool, async (c) => {
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
    },
    kiosks: {
      async createPairing(p) {
        await q.query('INSERT INTO kiosk_pairing (code_hash, name, machine_no, created_by, expires_at) VALUES ($1,$2,$3,$4,$5)', [p.codeHash, p.name, p.machineNo, p.createdBy, p.expiresAt]);
      },
      async redeem(codeHash, tokenHash) {
        return withTransaction(pool, async (c) => {
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
        return r.rows[0] ? kioskFrom(r.rows[0] as Row) : null;
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
  };
}
