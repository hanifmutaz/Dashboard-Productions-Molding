import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_SETTINGS } from '@mpd/contracts';
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
  const mk = (username: string, r: RoleRow): UserRow => ({ id: randomUUID(), username, displayName: username, department: null, passwordHash: hash, roleId: r.id, roleName: r.name, roleSystemKey: r.systemKey, active: true, lastLoginAt: null, version: 0 });
  const users = [mk('root', roles[0]!), mk('admin1', roles[1]!), mk('viewer', roles[2]!)];
  const sessions = new Map<string, SessionRow>();
  const audit: { action: string; result: string }[] = [];
  let settings = { body: DEFAULT_SETTINGS, version: 0, updatedAt: new Date().toISOString(), updatedBy: null as string | null };
  const repos: Repos = {
    users: {
      byUsername: (u) => Promise.resolve(users.find((x) => x.username.toLowerCase() === u.toLowerCase()) ?? null),
      byId: (id) => Promise.resolve(users.find((x) => x.id === id) ?? null),
      list: () => Promise.resolve(users),
      create: (u) => { const r = roles.find((x) => x.id === u.roleId)!; const row = { ...mk(u.username, r), displayName: u.displayName }; users.push(row); return Promise.resolve(row.id); },
      update: (id, u, v) => { const x = users.find((y) => y.id === id); if (!x || x.version !== v) return Promise.resolve(false); Object.assign(x, u, { version: v + 1 }); return Promise.resolve(true); },
      setPassword: () => Promise.resolve(),
      touchLogin: () => Promise.resolve(),
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
    master: { parts: () => Promise.resolve([]), materials: () => Promise.resolve([]), categories: () => Promise.resolve([]), upsertPartPrices: () => Promise.resolve([]), upsertMaterials: () => Promise.resolve([]) },
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
