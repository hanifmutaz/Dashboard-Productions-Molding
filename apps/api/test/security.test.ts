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
    await v.agent.get('/api/v1/monitoring/scrap').expect(403);
    const sales = await a.agent.get('/api/v1/monitoring/sales?from=2026-11-01&to=2026-11-03').expect(200);
    expect(typeof (sales.body as { state: string }).state).toBe('string');
    const scrap = await a.agent.get('/api/v1/monitoring/scrap?from=2026-11-01&to=2026-11-03').expect(200);
    expect((scrap.body as { state: string; data: unknown }).data).toBeNull(); // ConMas down -> no numbers, never zeros
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

describe('stop categories & details editing (dedicated permission)', () => {
  const body = (o: Record<string, unknown> = {}) => ({
    id: null, short: 'Cek visual', name: 'Cek visual', group: 'quality', oeeBucket: 'A', infoOnly: false, color: 's-paint-c026d3',
    aliases: ['Cek visual'], details: ['Waiting QC', 'waiting qc', 'Cek 100%'], notes: null, version: null, ...o,
  });
  const put = (a: Awaited<ReturnType<typeof login>>, b: unknown) => a.agent.put('/api/master-data/stop-categories').set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send(b as object);

  it('is denied by default for admin and user, allowed for super admin', async () => {
    await put(await login('viewer'), body()).expect(403);
    await put(await login('admin1'), body()).expect(403);
    await put(await login('root'), body()).expect(200);
  });
  it('can be granted to a specific role', async () => {
    ctx.roles[1]!.permissions.push('masterdata.stopcategories.edit');
    await put(await login('admin1'), body()).expect(200);
  });
  it('creates with a generated id, trims duplicate details and appends to the list', async () => {
    const r = await put(await login('root'), body()).expect(200);
    const list = r.body as { id: string; details: string[] }[];
    const c = list.find((x) => x.id === 'cek-visual')!;
    expect(c.details).toEqual(['Waiting QC', 'Cek 100%']);
    expect(ctx.audit).toContainEqual({ action: 'masterdata.stop-category.create', result: 'success' });
  });
  it('updates details with the version check and rejects a stale version with 409', async () => {
    const a = await login('root');
    await put(a, body({ id: 'pm', version: 0, short: 'PM loss', name: 'PM loss', aliases: ['PM loss'], details: ['PM Injection', 'PM Mold'] })).expect(200);
    const stale = await put(a, body({ id: 'pm', version: 0, short: 'PM loss', name: 'PM loss', aliases: ['PM loss'], details: ['x'] })).expect(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe('CONFLICT');
  });
  it('rejects a name/alias already owned by another category', async () => {
    const r = await put(await login('root'), body({ aliases: ['pm  LOSS'] })).expect(409);
    expect((r.body as { error: { code: string } }).error.code).toBe('CATEGORY_NAME_CONFLICT');
  });
  it('rejects an invalid colour/group and deletes with the version', async () => {
    const a = await login('root');
    await put(a, body({ color: 'red' })).expect(400);
    await put(a, body({ group: 'unmapped' })).expect(400);
    await a.agent.delete('/api/master-data/stop-categories/pm?version=0').set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).expect(200);
    await a.agent.delete('/api/master-data/stop-categories/pm?version=0').set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).expect(404);
  });
});

describe('release readiness', () => {
  it('keeps liveness up and gates app traffic when the required schema is unavailable', async () => {
    ctx.repos.schemaReady = () => Promise.resolve(false);
    const pending = createApp({ repos: ctx.repos, conmas: downConmas, log: pino({ level: 'silent' }), publicOrigin: ORIGIN, cookieSecure: false, idleMinutes: 60, absoluteHours: 12, trustProxy: false, tzOffsetMinutes: 420, version: 't', requiredMigrations: ['004_auth_attempt_window.sql'] });
    await request(pending).get('/api/health').expect(200);
    const readiness = await request(pending).get('/api/health/ready').expect(503);
    expect(readiness.body).toMatchObject({ status: 'not-ready', schema: 'not-ready' });
    const settings = await request(pending).get('/api/settings').expect(503);
    expect(settings.body).toMatchObject({ error: { code: 'SCHEMA_NOT_READY' } });
  });
});
