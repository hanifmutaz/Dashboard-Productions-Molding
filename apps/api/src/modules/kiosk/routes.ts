import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { PERMISSIONS, PairingCreateSchema, PairingRedeemSchema, type PairingCode } from '@mpd/contracts';
import type { Repos } from '../../db/repos.js';
import { HttpError, notFound } from '../../http/errors.js';
import { KIOSK_COOKIE, cookieOptions, parse, requirePermission, sha256, token, userOf, type Audit } from '../../http/middleware.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const normalize = (c: string) => c.replace('-', '').toUpperCase();

/** ADR-019: one-time pairing code -> revocable device credential locked to one machine, read-only Machine Detail. */
export function kioskRoutes(repos: Repos, audit: Audit, secure: boolean): Router {
  const r = Router();
  const manage = requirePermission(PERMISSIONS.manageKiosks);
  r.get('/admin/kiosks', manage, async (_req, res) => {
    res.json(await repos.kiosks.list());
  });
  r.post('/admin/kiosks/pairing', manage, async (req, res) => {
    const me = userOf(req);
    const b = parse(PairingCreateSchema, req.body);
    const code = newCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await repos.kiosks.createPairing({ codeHash: sha256(code), name: b.name, machineNo: b.machineNo, expiresAt, createdBy: me.id });
    await audit(req, { action: 'kiosk.pairing.create', result: 'success', objectType: 'kiosk', after: b });
    const out: PairingCode = { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: expiresAt.toISOString(), name: b.name, machineNo: b.machineNo };
    res.status(201).json(out);
  });
  r.post('/admin/kiosks/:id/revoke', manage, async (req, res) => {
    const me = userOf(req);
    const id = String(req.params.id);
    if (!(await repos.kiosks.revoke(id, me.id))) throw notFound('Kiosk aktif');
    await audit(req, { action: 'kiosk.revoke', result: 'success', objectType: 'kiosk', objectId: id });
    res.status(204).end();
  });
  r.post('/kiosk/pair', async (req, res) => {
    const b = parse(PairingRedeemSchema, req.body);
    const credential = token(48);
    const device = await repos.kiosks.redeem(sha256(normalize(b.code)), sha256(credential));
    if (!device) {
      await audit(req, { action: 'kiosk.pair', result: 'failure', actorLabel: 'kiosk' });
      throw new HttpError(400, 'PAIRING_INVALID', 'Kode pairing tidak valid, sudah dipakai, atau kedaluwarsa.');
    }
    res.cookie(KIOSK_COOKIE, credential, cookieOptions(secure, 400 * 864e5));
    await audit(req, { action: 'kiosk.pair', result: 'success', objectType: 'kiosk', objectId: device.id, actorLabel: `kiosk:${device.name}` });
    res.json({ machineNo: device.machineNo, name: device.name });
  });
  return r;
}
