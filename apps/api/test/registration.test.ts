import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { createApp } from '../src/http/app.js';
import { downConmas, memoryRepos } from './memory.js';

const ORIGIN = 'http://localhost:5173';
let ctx: Awaited<ReturnType<typeof memoryRepos>>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  ctx = await memoryRepos();
  app = createApp({ repos: ctx.repos, conmas: downConmas, log: pino({ level: 'silent' }), publicOrigin: ORIGIN, cookieSecure: false, idleMinutes: 60, absoluteHours: 12, trustProxy: false, tzOffsetMinutes: 420, version: 't' });
});

const NEW = { email: '  Budi.Santoso@Example.com ', displayName: 'Budi Santoso', department: 'Molding', purpose: 'Butuh lihat Production harian line A', password: 'password-budi-123' };
const register = (body: Record<string, unknown> = NEW) => request(app).post('/api/auth/register').set('Origin', ORIGIN).send(body);
const loginAs = (email: string, password: string) => request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email, password });

async function admin(username = 'admin1') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: `${username}@example.com`, password: 'correct-horse-battery' }).expect(204);
  const me = await agent.get('/api/auth/me').expect(200);
  return { agent, csrf: (me.body as { csrfToken: string }).csrfToken };
}
type Reg = { id: string; email: string; version: number; status: string };
async function pending(a: Awaited<ReturnType<typeof admin>>) {
  return (await a.agent.get('/api/admin/registrations').expect(200)).body as Reg[];
}

describe('login with email', () => {
  it('accepts email case-insensitively and rejects the old username field', async () => {
    await loginAs('  VIEWER@example.com', 'correct-horse-battery').expect(204);
    await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ username: 'viewer', password: 'correct-horse-battery' }).expect(400);
  });
  it('an existing account without email cannot log in', async () => {
    ctx.users.find((u) => u.username === 'viewer')!.email = null;
    await loginAs('viewer@example.com', 'correct-horse-battery').expect(401);
  });
  it('/auth/me exposes the email', async () => {
    const a = await admin();
    expect(((await a.agent.get('/api/auth/me')).body as { user: { email: string } }).user.email).toBe('admin1@example.com');
  });
});

describe('self registration', () => {
  it('creates a pending, inactive account that cannot log in until approved', async () => {
    await register().expect(202);
    const u = ctx.users.find((x) => x.email === 'budi.santoso@example.com')!;
    expect(u).toMatchObject({ status: 'pending', active: false, username: 'budi.santoso', roleName: 'User' });
    const r = await loginAs('budi.santoso@example.com', NEW.password).expect(403);
    expect((r.body as { error: { code: string } }).error.code).toBe('ACCOUNT_PENDING');
    // Wrong password never reveals the registration status.
    expect(((await loginAs('budi.santoso@example.com', 'wrong-password-x').expect(401)).body as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
    expect(ctx.audit).toContainEqual({ action: 'auth.register', result: 'success' });
  });
  it('ignores role/status sent by the client', async () => {
    const root = ctx.roles.find((r) => r.systemKey === 'superAdmin')!;
    await register({ ...NEW, roleId: root.id, status: 'approved', active: true }).expect(202);
    expect(ctx.users.find((x) => x.email === 'budi.santoso@example.com')).toMatchObject({ status: 'pending', roleName: 'User' });
  });
  it('rejects duplicates, weak input and silently drops honeypot submissions', async () => {
    await register().expect(202);
    await register().expect(409);
    await register({ ...NEW, email: 'viewer@example.com' }).expect(409);
    await register({ ...NEW, email: 'x@y.co', password: 'short' }).expect(400);
    await register({ ...NEW, email: 'x@y.co', purpose: 'pendek' }).expect(400);
    const before = ctx.users.length;
    await register({ ...NEW, email: 'bot@spam.example', website: 'http://spam' }).expect(202);
    expect(ctx.users.length).toBe(before);
  });
  it('gives each registrant a unique internal username', async () => {
    await register({ ...NEW, email: 'viewer@other.example' }).expect(202);
    expect(ctx.users.find((x) => x.email === 'viewer@other.example')!.username).toBe('viewer-2');
  });
});

describe('admin approval', () => {
  it('approve with a role -> user can log in; pending users stay out of the Users list', async () => {
    await register().expect(202);
    const a = await admin();
    expect(((await a.agent.get('/api/admin/users')).body as { email: string }[]).some((u) => u.email === 'budi.santoso@example.com')).toBe(false);
    expect((await a.agent.get('/api/admin/registrations/count')).body).toEqual({ pending: 1 });
    const [reg] = await pending(a);
    const userRole = ctx.roles.find((r) => r.systemKey === 'user')!;
    await a.agent.post(`/api/admin/registrations/${reg!.id}/approve`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send({ roleId: userRole.id, version: reg!.version }).expect(204);
    // Second click / stale version is a conflict, not a double approval.
    await a.agent.post(`/api/admin/registrations/${reg!.id}/approve`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send({ roleId: userRole.id, version: reg!.version }).expect(409);
    await loginAs('budi.santoso@example.com', NEW.password).expect(204);
    expect(ctx.audit).toContainEqual({ action: 'admin.registration.approve', result: 'success' });
  });
  it('admin cannot approve into a role above their own permissions', async () => {
    await register().expect(202);
    const a = await admin();
    const [reg] = await pending(a);
    const root = ctx.roles.find((r) => r.systemKey === 'superAdmin')!;
    await a.agent.post(`/api/admin/registrations/${reg!.id}/approve`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send({ roleId: root.id, version: reg!.version }).expect(403);
  });
  it('users without admin.users.manage cannot see or decide registrations', async () => {
    const v = await admin('viewer');
    await v.agent.get('/api/admin/registrations').expect(403);
  });
  it('reject -> login says rejected; the email may register again', async () => {
    await register().expect(202);
    const a = await admin();
    const [reg] = await pending(a);
    await a.agent.post(`/api/admin/registrations/${reg!.id}/reject`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send({ note: 'Bukan karyawan', version: reg!.version }).expect(204);
    const r = await loginAs('budi.santoso@example.com', NEW.password).expect(403);
    expect((r.body as { error: { code: string } }).error.code).toBe('ACCOUNT_REJECTED');
    expect(((await a.agent.get('/api/admin/registrations?status=rejected')).body as Reg[])[0]).toMatchObject({ email: 'budi.santoso@example.com', status: 'rejected' });
    await register().expect(202);
    expect(await pending(a)).toHaveLength(1);
  });
});

describe('admin edits email', () => {
  it('can set an email, blocks duplicates and revokes the user sessions', async () => {
    const a = await admin();
    const list = (await a.agent.get('/api/admin/users')).body as { id: string; username: string; displayName: string; department: string | null; roleId: string; active: boolean; version: number }[];
    const v = list.find((u) => u.username === 'viewer')!;
    const body = { displayName: v.displayName, department: v.department, roleId: v.roleId, active: true, version: v.version };
    await a.agent.put(`/api/admin/users/${v.id}`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send({ ...body, email: 'admin1@example.com' }).expect(409);
    await a.agent.put(`/api/admin/users/${v.id}`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send({ ...body, email: 'Viewer.New@Example.com' }).expect(200);
    await loginAs('viewer.new@example.com', 'correct-horse-battery').expect(204);
    await loginAs('viewer@example.com', 'correct-horse-battery').expect(401);
  });
});
