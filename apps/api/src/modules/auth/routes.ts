import { Router } from 'express';
import { ChangePasswordSchema, DEFAULT_PREFERENCES, LoginRequestSchema, PreferencesSchema, type MeResponse, type WhoAmI } from '@mpd/contracts';
import type { Repos } from '../../db/repos.js';
import { HttpError, tooMany, unauthorized } from '../../http/errors.js';
import { SESSION_COOKIE, KIOSK_COOKIE, cookieOf, cookieOptions, parse, sha256, token, userOf, type Audit } from '../../http/middleware.js';
import { burnTime, hashPassword, verifyPassword } from './password.js';
import { LoginThrottle } from './rateLimit.js';

export interface AuthOptions { secure: boolean; absoluteHours: number }

export function authRoutes(repos: Repos, audit: Audit, opt: AuthOptions): Router {
  const r = Router();
  const throttle = new LoginThrottle();
  const invalid = new HttpError(401, 'INVALID_CREDENTIALS', 'Username atau password salah.');

  r.post('/auth/login', async (req, res) => {
    const body = parse(LoginRequestSchema, req.body);
    const ip = req.ip ?? 'unknown';
    if (throttle.blocked(body.username, ip)) {
      await audit(req, { action: 'auth.login', result: 'denied', actorLabel: body.username, extra: { reason: 'throttled' } });
      throw tooMany();
    }
    const user = await repos.users.byUsername(body.username);
    if (!user) await burnTime(body.password);
    const ok = user ? await verifyPassword(user.passwordHash, body.password) : false;
    if (!user || !ok || !user.active) {
      throttle.fail(body.username, ip);
      await audit(req, { action: 'auth.login', result: 'failure', actorLabel: body.username, extra: { reason: !user ? 'unknown-user' : !ok ? 'bad-password' : 'inactive' } });
      throw invalid;
    }
    throttle.reset(body.username, ip);
    // Session rotation: any previous session cookie on this browser is revoked; a new id is issued.
    const old = cookieOf(req, SESSION_COOKIE);
    if (old) await repos.sessions.revoke(sha256(old));
    const sid = token();
    await repos.sessions.create({ idHash: sha256(sid), userId: user.id, csrfToken: token(), absoluteExpiresAt: new Date(Date.now() + opt.absoluteHours * 3_600_000) });
    await repos.users.touchLogin(user.id);
    res.cookie(SESSION_COOKIE, sid, cookieOptions(opt.secure));
    req.principal = undefined;
    await audit(req, { action: 'auth.login', result: 'success', actorLabel: user.username, objectType: 'user', objectId: user.id });
    res.status(204).end();
  });

  r.post('/auth/logout', async (req, res) => {
    const p = req.principal;
    if (p?.kind === 'user') {
      await repos.sessions.revoke(p.sessionHash);
      await audit(req, { action: 'auth.logout', result: 'success', objectType: 'user', objectId: p.id });
    }
    res.clearCookie(SESSION_COOKIE, cookieOptions(opt.secure));
    res.status(204).end();
  });

  r.get('/auth/me', async (req, res) => {
    const p = req.principal;
    if (!p) throw unauthorized();
    if (p.kind === 'kiosk') {
      const body: WhoAmI = { kind: 'kiosk', kiosk: { id: p.id, name: p.name, machineNo: p.machineNo } };
      res.json(body);
      return;
    }
    const u = await repos.users.byId(p.id);
    if (!u) throw unauthorized();
    const body: MeResponse = {
      kind: 'user',
      user: { id: u.id, username: u.username, displayName: u.displayName, department: u.department, roleId: u.roleId, roleName: u.roleName, permissions: p.permissions, lastLoginAt: u.lastLoginAt },
      csrfToken: p.csrfToken,
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  });

  r.post('/auth/password', async (req, res) => {
    const p = userOf(req);
    const body = parse(ChangePasswordSchema, req.body);
    const u = await repos.users.byId(p.id);
    if (!u || !(await verifyPassword(u.passwordHash, body.currentPassword))) {
      await audit(req, { action: 'auth.password.change', result: 'failure', objectType: 'user', objectId: p.id });
      throw invalid;
    }
    await repos.users.setPassword(p.id, await hashPassword(body.newPassword));
    await repos.sessions.revokeForUser(p.id);
    await audit(req, { action: 'auth.password.change', result: 'success', objectType: 'user', objectId: p.id });
    res.clearCookie(SESSION_COOKIE, cookieOptions(opt.secure));
    res.status(204).end();
  });

  r.get('/me/preferences', async (req, res) => {
    const p = userOf(req);
    const stored = PreferencesSchema.safeParse(await repos.prefs.get(p.id));
    res.json(stored.success ? stored.data : DEFAULT_PREFERENCES);
  });
  r.put('/me/preferences', async (req, res) => {
    const p = userOf(req);
    const body = parse(PreferencesSchema, req.body);
    await repos.prefs.put(p.id, body);
    res.json(body);
  });

  /** Kiosk device leaves (admin-revocation is the real control; this only clears the cookie). */
  r.post('/kiosk/leave', (_req, res) => {
    res.clearCookie(KIOSK_COOKIE, cookieOptions(opt.secure));
    res.status(204).end();
  });
  return r;
}
