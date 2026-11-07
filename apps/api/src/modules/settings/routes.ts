import { Router } from 'express';
import { DEFAULT_SETTINGS, PERMISSIONS, SettingsUpdateSchema, type Settings } from '@mpd/contracts';
import type { Repos } from '../../db/repos.js';
import { conflict } from '../../http/errors.js';
import { parse, requirePermission, userOf, type Audit } from '../../http/middleware.js';

export function settingsRoutes(repos: Repos, audit: Audit, onChange: () => void): Router {
  const r = Router();
  const load = async (): Promise<Settings> => {
    let s = await repos.settings.get();
    if (!s) {
      await repos.settings.init(DEFAULT_SETTINGS);
      s = await repos.settings.get();
    }
    return { ...DEFAULT_SETTINGS, ...s!.body, version: s!.version, updatedAt: s!.updatedAt, updatedBy: s!.updatedBy };
  };
  // Every signed-in user needs settings (targets, colours, shift labels) to render pages.
  r.get('/settings', async (req, res) => {
    if (!req.principal) userOf(req);
    res.json(await load());
  });
  r.put('/settings', requirePermission(PERMISSIONS.editSettings), async (req, res) => {
    const me = userOf(req);
    const b = parse(SettingsUpdateSchema, req.body);
    const before = await load();
    const saved = await repos.settings.update(b.settings, b.version, me.id);
    if (!saved) throw conflict();
    onChange();
    await audit(req, { action: 'settings.update', result: 'success', objectType: 'settings', objectId: '1', before, after: b.settings });
    res.json(await load());
  });
  return r;
}
export async function readSettings(repos: Repos) {
  const s = await repos.settings.get();
  return { ...DEFAULT_SETTINGS, ...(s?.body ?? {}) };
}
