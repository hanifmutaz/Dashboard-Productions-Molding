import { Router } from 'express';
import {
  ALL_PERMISSIONS, AuditQuerySchema, PERMISSIONS, PasswordResetSchema, RoleUpsertSchema, UserCreateSchema, UserUpdateSchema,
  isSubset, type Role, type User,
} from '@mpd/contracts';
import type { Repos, RoleRow, UserRow } from '../../db/repos.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { parse, requirePermission, userOf, type Audit } from '../../http/middleware.js';
import { hashPassword } from '../auth/password.js';

const toUser = (u: UserRow): User => ({ id: u.id, username: u.username, displayName: u.displayName, department: u.department, roleId: u.roleId, roleName: u.roleName, active: u.active, lastLoginAt: u.lastLoginAt, version: u.version });
const toRole = (r: RoleRow): Role => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, permissions: r.permissions, userCount: r.userCount, version: r.version });

export function adminRoutes(repos: Repos, audit: Audit): Router {
  const r = Router();
  const usersOnly = requirePermission(PERMISSIONS.manageUsers);
  const rolesOnly = requirePermission(PERMISSIONS.manageRoles);

  /** An actor may only assign roles whose permissions are a subset of their own; the super admin role only by a super admin. */
  async function assertAssignable(actorPerms: readonly string[], actorKey: string | null, roleId: string) {
    const role = await repos.roles.byId(roleId);
    if (!role) throw badRequest('Role tidak ditemukan.');
    if (role.systemKey === 'superAdmin' && actorKey !== 'superAdmin') throw forbidden();
    if (!isSubset(role.permissions, actorPerms)) throw new HttpError(403, 'PRIVILEGE_ESCALATION', 'Tidak boleh memberi permission melebihi milik Anda.');
    return role;
  }

  r.get('/admin/users', usersOnly, async (_req, res) => {
    res.json((await repos.users.list()).map(toUser));
  });
  r.post('/admin/users', usersOnly, async (req, res) => {
    const me = userOf(req);
    const b = parse(UserCreateSchema, req.body);
    await assertAssignable(me.permissions, me.systemKey, b.roleId);
    if (await repos.users.byUsername(b.username)) throw new HttpError(409, 'USERNAME_TAKEN', 'Username sudah dipakai.');
    const id = await repos.users.create({ username: b.username, displayName: b.displayName, department: b.department, roleId: b.roleId, passwordHash: await hashPassword(b.password) });
    await audit(req, { action: 'admin.user.create', result: 'success', objectType: 'user', objectId: id, after: { ...b, password: undefined } });
    res.status(201).json(toUser((await repos.users.byId(id))!));
  });
  r.put('/admin/users/:id', usersOnly, async (req, res) => {
    const me = userOf(req);
    const id = String(req.params.id);
    const b = parse(UserUpdateSchema, req.body);
    const before = await repos.users.byId(id);
    if (!before) throw notFound('User');
    if (before.roleSystemKey === 'superAdmin' && me.systemKey !== 'superAdmin') throw forbidden();
    if (id === me.id && (!b.active || b.roleId !== before.roleId)) throw badRequest('Anda tidak dapat menonaktifkan atau mengganti role akun sendiri.');
    await assertAssignable(me.permissions, me.systemKey, b.roleId);
    if (!(await repos.users.update(id, b, b.version))) throw conflict();
    if (!b.active || b.roleId !== before.roleId) await repos.sessions.revokeForUser(id);
    await audit(req, { action: 'admin.user.update', result: 'success', objectType: 'user', objectId: id, before: toUser(before), after: b });
    res.json(toUser((await repos.users.byId(id))!));
  });
  r.post('/admin/users/:id/password', usersOnly, async (req, res) => {
    const me = userOf(req);
    const id = String(req.params.id);
    const b = parse(PasswordResetSchema, req.body);
    const u = await repos.users.byId(id);
    if (!u) throw notFound('User');
    if (u.roleSystemKey === 'superAdmin' && me.systemKey !== 'superAdmin') throw forbidden();
    await repos.users.setPassword(id, await hashPassword(b.password));
    await repos.sessions.revokeForUser(id);
    await audit(req, { action: 'admin.user.password-reset', result: 'success', objectType: 'user', objectId: id });
    res.status(204).end();
  });

  r.get('/admin/roles', requirePermission(PERMISSIONS.manageUsers), async (_req, res) => {
    res.json({ roles: (await repos.roles.list()).map(toRole), permissions: ALL_PERMISSIONS });
  });
  r.post('/admin/roles', rolesOnly, async (req, res) => {
    const me = userOf(req);
    const b = parse(RoleUpsertSchema, req.body);
    if (!isSubset(b.permissions, me.permissions)) throw new HttpError(403, 'PRIVILEGE_ESCALATION', 'Tidak boleh memberi permission melebihi milik Anda.');
    const id = await repos.roles.create({ name: b.name, description: b.description, permissions: b.permissions });
    await audit(req, { action: 'admin.role.create', result: 'success', objectType: 'role', objectId: id, after: b });
    res.status(201).json(toRole((await repos.roles.byId(id))!));
  });
  r.put('/admin/roles/:id', rolesOnly, async (req, res) => {
    const me = userOf(req);
    const id = String(req.params.id);
    const b = parse(RoleUpsertSchema, req.body);
    const before = await repos.roles.byId(id);
    if (!before) throw notFound('Role');
    if (before.isSystem) throw new HttpError(403, 'SYSTEM_ROLE', 'Role sistem tidak dapat diubah.');
    if (!isSubset(b.permissions, me.permissions)) throw new HttpError(403, 'PRIVILEGE_ESCALATION', 'Tidak boleh memberi permission melebihi milik Anda.');
    if (b.version === null || !(await repos.roles.update(id, b, b.version))) throw conflict();
    await audit(req, { action: 'admin.role.update', result: 'success', objectType: 'role', objectId: id, before: toRole(before), after: b });
    res.json(toRole((await repos.roles.byId(id))!));
  });
  r.delete('/admin/roles/:id', rolesOnly, async (req, res) => {
    const id = String(req.params.id);
    if (!(await repos.roles.remove(id))) throw new HttpError(409, 'ROLE_IN_USE', 'Role sistem atau role yang masih dipakai user tidak dapat dihapus.');
    await audit(req, { action: 'admin.role.delete', result: 'success', objectType: 'role', objectId: id });
    res.status(204).end();
  });

  r.get('/admin/audit', async (req, res) => {
    const me = userOf(req);
    const q = parse(AuditQuerySchema, req.query);
    const full = me.permissions.includes(PERMISSIONS.viewAudit);
    // Without audit permission a user may only see their own activity (Profile ▸ Recent activity).
    if (!full && !q.mine) throw forbidden();
    res.json(await repos.audit.list({ action: q.action, actor: full && !q.mine ? q.actor : undefined, actorUserId: q.mine ? me.id : undefined, before: q.before, limit: q.limit }));
  });
  return r;
}
