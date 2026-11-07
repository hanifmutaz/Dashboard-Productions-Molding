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

async function login(username: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ username, password: 'correct-horse-battery' }).expect(204);
  const me = await agent.get('/api/auth/me').expect(200);
  return { agent, csrf: (me.body as { csrfToken: string }).csrfToken };
}

describe('authentication', () => {
  it('rejects anonymous access with 401 (deny by default)', async () => {
    await request(app).get('/api/v1/monitoring/production?from=2026-11-01&to=2026-11-07').expect(401);
    await request(app).get('/api/settings').expect(401);
  });
  it('wrong password -> 401 without revealing which part was wrong, audited', async () => {
    const r = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ username: 'viewer', password: 'nope' }).expect(401);
    expect((r.body as { error: { message: string } }).error.message).toBe('Username atau password salah.');
    expect(ctx.audit).toContainEqual({ action: 'auth.login', result: 'failure' });
  });
  it('throttles after 5 failures', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ username: 'viewer', password: 'x' });
    await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ username: 'viewer', password: 'correct-horse-battery' }).expect(429);
  });
  it('sets an HttpOnly SameSite=Strict session cookie', async () => {
    const r = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ username: 'viewer', password: 'correct-horse-battery' }).expect(204);
    const c = String(r.headers['set-cookie']);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
  });
  it('logout revokes the server-side session', async () => {
    const { agent, csrf } = await login('viewer');
    await agent.post('/api/auth/logout').set('Origin', ORIGIN).set('X-CSRF-Token', csrf).expect(204);
    await agent.get('/api/auth/me').expect(401);
  });
});

describe('CSRF', () => {
  it('blocks mutation without token or from a foreign origin', async () => {
    const { agent, csrf } = await login('root');
    await agent.put('/api/settings').set('Origin', ORIGIN).send({}).expect(403);
    await agent.put('/api/settings').set('Origin', 'http://evil.example').set('X-CSRF-Token', csrf).send({}).expect(403);
  });
});

describe('authorization (API enforced)', () => {
  it('user cannot see Sales/Scrap, admin can', async () => {
    const v = await login('viewer');
    await v.agent.get('/api/v1/monitoring/sales').expect(403);
    const a = await login('admin1');
    const r = await a.agent.get('/api/v1/monitoring/sales').expect(200);
    expect((r.body as { state: string }).state).toBe('unavailable');
  });
  it('only super admin edits settings; stale version -> 409', async () => {
    const a = await login('admin1');
    await a.agent.put('/api/settings').set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send({}).expect(403);
    const s = await login('root');
    const cur = (await s.agent.get('/api/settings')).body as Record<string, unknown> & { version: number };
    const { version, updatedAt: _u, updatedBy: _b, ...settings } = cur;
    await s.agent.put('/api/settings').set('Origin', ORIGIN).set('X-CSRF-Token', s.csrf).send({ version, settings }).expect(200);
    await s.agent.put('/api/settings').set('Origin', ORIGIN).set('X-CSRF-Token', s.csrf).send({ version, settings }).expect(409);
  });
  it('admin cannot create a role or assign super admin (no privilege escalation)', async () => {
    const a = await login('admin1');
    await a.agent.post('/api/admin/roles').set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send({ name: 'x', description: null, permissions: [], version: null }).expect(403);
    const superRole = ctx.roles.find((r) => r.systemKey === 'superAdmin')!;
    await a.agent.post('/api/admin/users').set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf)
      .send({ username: 'evil', displayName: 'E', department: null, roleId: superRole.id, password: 'long-enough-password' }).expect(403);
  });
  it('audit log is super admin only; others may read their own activity', async () => {
    const a = await login('admin1');
    await a.agent.get('/api/admin/audit').expect(403);
    await a.agent.get('/api/admin/audit?mine=true').expect(200);
  });
});

describe('source failure is not shown as zero', () => {
  it('returns unavailable envelope with null data', async () => {
    const v = await login('viewer');
    const r = await v.agent.get('/api/v1/monitoring/production?from=2026-11-01&to=2026-11-07').expect(200);
    expect(r.body).toMatchObject({ state: 'unavailable', data: null });
  });
  it('error responses do not leak internals', async () => {
    const r = await request(app).get('/api/nope').expect(404);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|node_modules|SELECT/i);
  });
});
