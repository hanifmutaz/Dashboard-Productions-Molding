import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import type { Permission } from '@mpd/contracts';
import type { Logger } from '../logger.js';
import type { Repos } from '../db/repos.js';
import { HttpError, badRequest, forbidden, unauthorized } from './errors.js';
import type { Principal } from './types.js';

export const SESSION_COOKIE = 'mpd_sid';
export const KIOSK_COOKIE = 'mpd_kiosk';
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const cookieOf = (req: Request, name: string): string | undefined => (req.cookies as Record<string, string | undefined>)[name];

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
};

export const cookies: RequestHandler = (req, _res, next) => {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore malformed cookie */
    }
  }
  req.cookies = out;
  next();
};

export interface SessionOptions { idleMinutes: number; secure: boolean }

export function cookieOptions(secure: boolean, maxAgeMs?: number) {
  return { httpOnly: true, secure, sameSite: 'strict' as const, path: '/', ...(maxAgeMs ? { maxAge: maxAgeMs } : {}) };
}

/** Resolves the principal from a server-side session (users) or a revocable device credential (kiosks). */
export function authenticate(repos: Repos, opt: SessionOptions): RequestHandler {
  return async (req, res, next) => {
    const sid = cookieOf(req, SESSION_COOKIE);
    if (sid) {
      const hash = sha256(sid);
      const s = await repos.sessions.get(hash);
      const now = Date.now();
      const valid = s && !s.revokedAt && s.absoluteExpiresAt.getTime() > now && now - s.lastSeenAt.getTime() < opt.idleMinutes * 60_000;
      if (s && valid) {
        const u = await repos.users.byId(s.userId);
        if (u && u.active) {
          const role = await repos.roles.byId(u.roleId);
          req.principal = {
            kind: 'user', id: u.id, username: u.username, displayName: u.displayName, roleId: u.roleId, roleName: u.roleName, systemKey: u.roleSystemKey,
            permissions: (role?.permissions ?? []) as Permission[], sessionHash: hash, csrfToken: s.csrfToken,
          };
          if (now - s.lastSeenAt.getTime() > 60_000) await repos.sessions.touch(hash);
        }
      } else {
        res.clearCookie(SESSION_COOKIE, cookieOptions(opt.secure));
      }
    }
    if (!req.principal) {
      const kt = cookieOf(req, KIOSK_COOKIE);
      if (kt) {
        const k = await repos.kiosks.byTokenHash(sha256(kt));
        if (k && !k.revokedAt) {
          req.principal = { kind: 'kiosk', id: k.id, name: k.name, machineNo: k.machineNo };
          await repos.kiosks.touch(k.id);
        } else res.clearCookie(KIOSK_COOKIE, cookieOptions(opt.secure));
      }
    }
    next();
  };
}

/** CSRF: Origin check on every mutation + synchronizer token for authenticated mutations. */
export function csrf(publicOrigin: string): RequestHandler {
  const allowed = new URL(publicOrigin).origin;
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && origin !== allowed) return next(forbidden());
    const p = req.principal;
    if (p?.kind === 'user' && req.get('x-csrf-token') !== p.csrfToken) return next(new HttpError(403, 'CSRF', 'Sesi keamanan formulir tidak valid. Muat ulang halaman.'));
    next();
  };
}

export const userOf = (req: Request): Extract<Principal, { kind: 'user' }> => {
  const p = req.principal;
  if (!p) throw unauthorized();
  if (p.kind !== 'user') throw forbidden();
  return p;
};

/** Deny by default (ADR-018): authorization is enforced here, never only in the UI. */
export function requirePermission(...needed: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const p = req.principal;
    if (!p) return next(unauthorized());
    if (p.kind !== 'user' || !needed.every((n) => p.permissions.includes(n))) return next(forbidden());
    next();
  };
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest('Input tidak valid.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function errorHandler(log: Logger): (err: unknown, req: Request, res: Response, next: NextFunction) => void {
  return (err, req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.status >= 500) log.error({ err, requestId: req.requestId }, 'request failed');
      res.status(err.status).json({ error: { code: err.code, message: err.message, requestId: req.requestId, ...(err.details ? { details: err.details } : {}) } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Input tidak valid.', requestId: req.requestId } });
      return;
    }
    if (typeof err === 'object' && err && 'type' in err && err.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'BAD_JSON', message: 'Format permintaan tidak valid.', requestId: req.requestId } });
      return;
    }
    log.error({ err, requestId: req.requestId }, 'unhandled error');
    // Never leak stack traces, SQL or internal paths.
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server. Hubungi admin dengan Request ID ini.', requestId: req.requestId } });
  };
}

const SENSITIVE = /password|token|secret|hash|code/i;
export function sanitize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE.test(k) ? '[redacted]' : sanitize(x)]));
  return v;
}

export function auditor(repos: Repos, log: Logger) {
  return async (req: Request, e: { action: string; objectType?: string; objectId?: string; result: 'success' | 'failure' | 'denied'; before?: unknown; after?: unknown; extra?: unknown; actorLabel?: string }) => {
    const p = req.principal;
    try {
      await repos.audit.append({
        actorUserId: p?.kind === 'user' ? p.id : null,
        actorLabel: e.actorLabel ?? (p?.kind === 'user' ? p.username : p?.kind === 'kiosk' ? `kiosk:${p.name}` : null),
        requestId: req.requestId, action: e.action, objectType: e.objectType ?? null, objectId: e.objectId ?? null, result: e.result,
        detail: sanitize({ before: e.before, after: e.after, extra: e.extra }),
      });
    } catch (err) {
      // Audit failure must be visible to operators; the business response is already decided.
      log.error({ err, requestId: req.requestId, action: e.action }, 'AUDIT WRITE FAILED');
    }
  };
}
export type Audit = ReturnType<typeof auditor>;
