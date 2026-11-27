import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_SETTINGS, type StopCategory } from '@mpd/contracts';
import type { Repos, RoleRow, SessionRow, UserRow } from '../src/db/repos.js';
import type { ConmasSource } from '../src/modules/conmas/source.js';
import { SourceUnavailable } from '../src/modules/conmas/source.js';
import { hashPassword } from '../src/modules/auth/password.js';

/** In-memory fakes for HTTP security tests (no database). */
export async function memoryRepos() {
  const roles: RoleRow[] = [
    { id: randomUUID(), name: 'Super admin', description: null, isSystem: true, systemKey: 'superAdmin', permissions: [...DEFAULT_ROLE_PERMISSIONS.superAdmin], userCount: 0, version: 0 },
    { id: randomUUID(), name: 'Admin', description: null, isSystem: true, systemKey: 'admin', permissions: [...DEFAULT_ROLE_PERMISSIONS.admin], userCount: 0, version: 0 },
    { id: randomUUID(), name: 'User', description: null, isSystem: true, systemKey: 'user', permissions: [...DEFAULT_ROLE_PERMISSIONS.user], userCount: 0, version: 0 },
  ];
  const hash = await hashPassword('correct-horse-battery');
  const mk = (username: string, r: RoleRow): UserRow => ({ id: randomUUID(), username, email: `${username}@example.com`, displayName: username, department: null, passwordHash: hash, roleId: r.id, roleName: r.name, roleSystemKey: r.systemKey, active: true, status: 'approved', lastLoginAt: null, version: 0 });
  type Extra = { purpose: string | null; createdAt: string; reviewedAt: string | null; reviewedBy: string | null; reviewNote: string | null };
  const extra = new Map<string, Extra>();
  const unique = (u: { username: string; email: string | null }, self?: string) => {
    if (users.some((x) => x.id !== self && (x.username.toLowerCase() === u.username.toLowerCase() || (u.email !== null && x.email === u.email)))) throw Object.assign(new Error('duplicate'), { code: '23505' });
  };
  const users = [mk('root', roles[0]!), mk('admin1', roles[1]!), mk('viewer', roles[2]!)];
  const sessions = new Map<string, SessionRow>();
  const audit: { action: string; result: string }[] = [];
  const cats: StopCategory[] = [
    { id: 'abn', short: 'Handling abnormality', name: 'Handling abnormality issue', group: 'breakdown', oeeBucket: 'A', infoOnly: false, color: 's-paint-6366f1', aliases: ['Handling abnormality issue'], details: ['Analisa'], notes: null, version: 0 },
    { id: 'pm', short: 'PM loss', name: 'PM loss', group: 'planned', oeeBucket: 'A', infoOnly: false, color: 's-paint-475569', aliases: ['PM loss'], details: ['PM Injection'], notes: null, version: 0 },
  ];
  let settings = { body: DEFAULT_SETTINGS, version: 0, updatedAt: new Date().toISOString(), updatedBy: null as string | null };
  const windows = new Map<string, { count: number; until: number }>();
  const repos: Repos = {
    transaction: (work) => work(),
    throttle: {
      attempt: (key, max, windowMs) => {
        const now = Date.now();
        const previous = windows.get(key);
        const window = previous && previous.until > now ? previous : { count: 0, until: now + windowMs };
        if (window.count >= max) return Promise.resolve(false);
        window.count++;
        windows.set(key, window);
        return Promise.resolve(true);
      },
      clear: (key) => { windows.delete(key); return Promise.resolve(); },
      pruneExpired: async () => {},
    },
    schemaReady: () => Promise.resolve(true),
    users: {
      byUsername: (u) => Promise.resolve(users.find((x) => x.username.toLowerCase() === u.toLowerCase()) ?? null),
      byEmail: (e) => Promise.resolve(users.find((x) => x.email === e.trim().toLowerCase()) ?? null),
      byId: (id) => Promise.resolve(users.find((x) => x.id === id) ?? null),
      list: () => Promise.resolve(users.filter((x) => x.status === 'approved')),
      create: (u) => { unique(u); const r = roles.find((x) => x.id === u.roleId)!; const row = { ...mk(u.username, r), email: u.email, displayName: u.displayName }; users.push(row); return Promise.resolve(row.id); },
      update: (id, u, v) => {
        const x = users.find((y) => y.id === id);
        if (!x || x.version !== v || x.status !== 'approved') return Promise.resolve(false);
        unique({ username: x.username, email: u.email }, id);
        const r = roles.find((y) => y.id === u.roleId)!;
        Object.assign(x, u, { roleName: r.name, roleSystemKey: r.systemKey, version: v + 1 });
        return Promise.resolve(true);
      },
      setPassword: (id, h) => { const x = users.find((y) => y.id === id); if (x) x.passwordHash = h; return Promise.resolve(); },
      touchLogin: () => Promise.resolve(),
      register: (u) => {
        const r = roles.find((x) => x.id === u.roleId)!;
        const old = users.find((x) => x.email === u.email && x.status === 'rejected');
        const meta: Extra = { purpose: u.purpose, createdAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null, reviewNote: null };
        if (old) {
          Object.assign(old, { displayName: u.displayName, department: u.department, passwordHash: u.passwordHash, status: 'pending', active: false, version: old.version + 1 });
          extra.set(old.id, meta);
          return Promise.resolve({ id: old.id, again: true });
        }
        unique(u);
        const row: UserRow = { ...mk(u.username, r), email: u.email, displayName: u.displayName, department: u.department, passwordHash: u.passwordHash, status: 'pending', active: false };
        users.push(row);
        extra.set(row.id, meta);
        return Promise.resolve({ id: row.id, again: false });
      },
      registrations: (status) => Promise.resolve(users.filter((x) => x.status === status).map((x) => {
        const m = extra.get(x.id);
        return { id: x.id, email: x.email ?? '', displayName: x.displayName, department: x.department, purpose: m?.purpose ?? null, status: x.status, createdAt: m?.createdAt ?? '', reviewedAt: m?.reviewedAt ?? null, reviewedBy: m?.reviewedBy ?? null, reviewNote: m?.reviewNote ?? null, version: x.version };
      })),
      pendingCount: () => Promise.resolve(users.filter((x) => x.status === 'pending').length),
      approve: (id, roleId, by, v) => {
        const x = users.find((y) => y.id === id);
        if (!x || x.status !== 'pending' || x.version !== v) return Promise.resolve(false);
        const r = roles.find((y) => y.id === roleId)!;
        Object.assign(x, { status: 'approved', active: true, roleId, roleName: r.name, roleSystemKey: r.systemKey, version: v + 1 });
        extra.set(id, { ...extra.get(id)!, reviewedAt: new Date().toISOString(), reviewedBy: by });
        return Promise.resolve(true);
      },
      reject: (id, note, by, v) => {
        const x = users.find((y) => y.id === id);
        if (!x || x.status !== 'pending' || x.version !== v) return Promise.resolve(false);
        Object.assign(x, { status: 'rejected', active: false, version: v + 1 });
        extra.set(id, { ...extra.get(id)!, reviewedAt: new Date().toISOString(), reviewedBy: by, reviewNote: note });
        return Promise.resolve(true);
      },
    },
    roles: {
      list: () => Promise.resolve(roles),
      byId: (id) => Promise.resolve(roles.find((r) => r.id === id) ?? null),
      create: (r) => { const id = randomUUID(); roles.push({ id, ...r, isSystem: false, systemKey: null, userCount: 0, version: 0 }); return Promise.resolve(id); },
      update: () => Promise.resolve(true),
      remove: () => Promise.resolve(true),
    },
    sessions: {
      create: (s) => { sessions.set(s.idHash, { ...s, lastSeenAt: new Date(), revokedAt: null }); return Promise.resolve(); },
      get: (h) => Promise.resolve(sessions.get(h) ?? null),
      touch: () => Promise.resolve(),
      revoke: (h) => { const s = sessions.get(h); if (s) s.revokedAt = new Date(); return Promise.resolve(); },
      revokeForUser: (u) => { sessions.forEach((s) => { if (s.userId === u) s.revokedAt = new Date(); }); return Promise.resolve(); },
    },
    audit: { append: (e) => { audit.push({ action: e.action, result: e.result }); return Promise.resolve(); }, list: () => Promise.resolve([]) },
    settings: {
      get: () => Promise.resolve(settings),
      update: (body, version) => { if (version !== settings.version) return Promise.resolve(null); settings = { ...settings, body, version: version + 1 }; return Promise.resolve(settings); },
      init: () => Promise.resolve(),
    },
    prefs: { get: () => Promise.resolve(null), put: () => Promise.resolve() },
    master: {
      lockCategories: async () => {}, parts: () => Promise.resolve([]), materials: () => Promise.resolve([]), categories: () => Promise.resolve(cats.map((c) => ({ ...c }))), upsertPartPrices: () => Promise.resolve([]), upsertMaterials: () => Promise.resolve([]),
      saveCategory: (c) => {
        const i = cats.findIndex((x) => x.id === c.id);
        if (c.version === null) { if (i >= 0) return Promise.resolve(false); cats.push({ ...c, version: 0 }); return Promise.resolve(true); }
        if (i < 0 || cats[i]!.version !== c.version) return Promise.resolve(false);
        cats[i] = { ...c, version: c.version + 1 };
        return Promise.resolve(true);
      },
      deleteCategory: (id, v) => { const i = cats.findIndex((x) => x.id === id && x.version === v); if (i < 0) return Promise.resolve(false); cats.splice(i, 1); return Promise.resolve(true); },
    },
    kiosks: { createPairing: () => Promise.resolve(), redeem: () => Promise.resolve(null), byTokenHash: () => Promise.resolve(null), list: () => Promise.resolve([]), revoke: () => Promise.resolve(true), touch: () => Promise.resolve() },
    ping: () => Promise.resolve(),
  };
  return { repos, roles, users, audit };
}

export const downConmas: ConmasSource = {
  records: () => Promise.reject(new SourceUnavailable('CONMAS_UNREACHABLE', 'down')),
  adjacentDates: () => Promise.reject(new SourceUnavailable('CONMAS_UNREACHABLE', 'down')),
  machines: () => Promise.resolve([]),
  health: () => Promise.resolve({ ok: false, reason: 'CONMAS_UNREACHABLE' }),
  invalidate: () => undefined,
};
