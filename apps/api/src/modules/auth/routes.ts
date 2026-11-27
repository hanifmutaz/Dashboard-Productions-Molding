import { Router } from 'express';
import { ChangePasswordSchema, DEFAULT_PREFERENCES, LoginRequestSchema, PreferencesSchema, REGISTER_ACCEPTED_MESSAGE, RegisterRequestSchema, type MeResponse, type WhoAmI } from '@mpd/contracts';
import { isUniqueViolation, type Repos } from '../../db/repos.js';
import { HttpError, tooMany, unauthorized } from '../../http/errors.js';
import { SESSION_COOKIE, KIOSK_COOKIE, cookieOf, cookieOptions, parse, sha256, token, userOf, type Audit } from '../../http/middleware.js';
import { burnTime, hashPassword, verifyPassword } from './password.js';

export interface AuthOptions { secure: boolean; absoluteHours: number; plantUtcOffsetMinutes: number }

/** Batas antrean pending agar form publik tidak bisa membanjiri halaman admin. */
export const MAX_PENDING_REGISTRATIONS = 200;

/** Username internal pendaftar diturunkan dari bagian lokal email; login tetap memakai email. */
async function freeUsername(repos: Repos, email: string): Promise<string> {
  const base = (email.split('@')[0] ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 56).padEnd(3, '0');
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await repos.users.byUsername(candidate))) return candidate;
  }
  return `${base.slice(0, 40)}-${token(9).replace(/[^A-Za-z0-9]/g, '').slice(0, 10)}`;
}

export function authRoutes(repos: Repos, audit: Audit, opt: AuthOptions): Router {
  const r = Router();
  const invalid = new HttpError(401, 'INVALID_CREDENTIALS', 'Email atau password salah.');

  r.post('/auth/login', async (req, res) => {
    const body = parse(LoginRequestSchema, req.body);
    const ip = req.ip ?? 'unknown';
    const loginKey = 'login:' + sha256(JSON.stringify([ip, body.email]));
    if (!await repos.throttle.attempt('login-ip:' + sha256(ip), 120, 15 * 60_000) || !await repos.throttle.attempt(loginKey, 5, 15 * 60_000)) {
      throw tooMany();
    }
    const user = await repos.users.byEmail(body.email);
    if (!user) await burnTime(body.password);
    const ok = user ? await verifyPassword(user.passwordHash, body.password) : false;
    if (!user || !ok || !user.active || user.status !== 'approved') {
      const reason = !user ? 'unknown-user' : !ok ? 'bad-password' : user.status !== 'approved' ? user.status : 'inactive';
      await audit(req, { action: 'auth.login', result: 'failure', actorLabel: body.email, extra: { reason } });
      // Status pendaftaran hanya dibuka bila password benar, supaya status email orang lain tidak bisa dicek.
      if (ok && user?.status === 'pending') throw new HttpError(403, 'ACCOUNT_PENDING', 'Pendaftaran Anda masih menunggu persetujuan admin.');
      if (ok && user?.status === 'rejected') throw new HttpError(403, 'ACCOUNT_REJECTED', 'Pendaftaran Anda ditolak. Hubungi admin untuk informasi lebih lanjut.');
      throw invalid;
    }
    // Session rotation: any previous session cookie on this browser is revoked; a new id is issued.
    const old = cookieOf(req, SESSION_COOKIE);
    const sid = token();
    req.principal = undefined;
    await repos.transaction(async () => {
      if (old) await repos.sessions.revoke(sha256(old));
      await repos.sessions.create({ idHash: sha256(sid), userId: user.id, csrfToken: token(), absoluteExpiresAt: new Date(Date.now() + opt.absoluteHours * 3_600_000) });
      await repos.users.touchLogin(user.id);
      await repos.throttle.clear(loginKey);
      await audit(req, { action: 'auth.login', result: 'success', actorLabel: user.username, objectType: 'user', objectId: user.id });
    });
    res.cookie(SESSION_COOKIE, sid, cookieOptions(opt.secure));
    res.status(204).end();
  });

  /** Daftar akun mandiri (publik). Akun 'pending' dan nonaktif sampai admin menyetujui serta memilih role. */
  r.post('/auth/register', async (req, res) => {
    const body = parse(RegisterRequestSchema, req.body);
    if (!await repos.throttle.attempt('register-ip:' + sha256(req.ip ?? 'unknown'), 10, 60 * 60_000)) throw tooMany();
    if (body.website) { res.status(202).json({ message: REGISTER_ACCEPTED_MESSAGE }); return; } // bot: pura-pura sukses
    if (await repos.users.pendingCount() >= MAX_PENDING_REGISTRATIONS) throw new HttpError(429, 'REGISTRATION_QUEUE_FULL', 'Antrean pendaftaran sedang penuh. Hubungi admin.');
    const taken = new HttpError(409, 'EMAIL_TAKEN', 'Email sudah terdaftar atau masih menunggu persetujuan.');
    const existing = await repos.users.byEmail(body.email);
    if (existing && existing.status !== 'rejected') throw taken;
    const role = (await repos.roles.list()).find((x) => x.systemKey === 'user');
    if (!role) throw new HttpError(500, 'INTERNAL', 'Role dasar tidak ditemukan.');
    const passwordHash = await hashPassword(body.password);
    const username = existing?.username ?? await freeUsername(repos, body.email);
    try {
      await repos.transaction(async () => {
        const r = await repos.users.register({ email: body.email, username, displayName: body.displayName, department: body.department, purpose: body.purpose, passwordHash, roleId: role.id });
        await audit(req, { action: r.again ? 'auth.register.again' : 'auth.register', result: 'success', actorLabel: body.email, objectType: 'user', objectId: r.id, extra: { department: body.department } });
      });
    } catch (e) {
      throw isUniqueViolation(e) ? taken : e;
    }
    res.status(202).json({ message: REGISTER_ACCEPTED_MESSAGE });
  });

  r.post('/auth/logout', async (req, res) => {
    const p = req.principal;
    if (p?.kind === 'user') {
      await repos.transaction(async () => {
        await repos.sessions.revoke(p.sessionHash);
        await audit(req, { action: 'auth.logout', result: 'success', objectType: 'user', objectId: p.id });
      });
    }
    res.clearCookie(SESSION_COOKIE, cookieOptions(opt.secure));
    res.status(204).end();
  });

  r.get('/auth/me', async (req, res) => {
    const p = req.principal;
    if (!p) throw unauthorized();
    if (p.kind === 'kiosk') {
      const body: WhoAmI = { kind: 'kiosk', plantUtcOffsetMinutes: opt.plantUtcOffsetMinutes, kiosk: { id: p.id, name: p.name, machineNo: p.machineNo } };
      res.json(body);
      return;
    }
    const u = await repos.users.byId(p.id);
    if (!u) throw unauthorized();
    const body: MeResponse = {
      kind: 'user',
      plantUtcOffsetMinutes: opt.plantUtcOffsetMinutes,
      user: { id: u.id, username: u.username, email: u.email, displayName: u.displayName, department: u.department, roleId: u.roleId, roleName: u.roleName, permissions: p.permissions, lastLoginAt: u.lastLoginAt },
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
    const passwordHash = await hashPassword(body.newPassword);
    await repos.transaction(async () => {
      await repos.users.setPassword(p.id, passwordHash);
      await repos.sessions.revokeForUser(p.id);
      await audit(req, { action: 'auth.password.change', result: 'success', objectType: 'user', objectId: p.id });
    });
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
