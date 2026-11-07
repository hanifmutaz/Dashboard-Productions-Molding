import { Router } from 'express';
import { MaterialUpdateSchema, PERMISSIONS, PartPriceUpdateSchema, type MasterDataView } from '@mpd/contracts';
import type { Repos } from '../../db/repos.js';
import { HttpError } from '../../http/errors.js';
import { parse, requirePermission, userOf, type Audit } from '../../http/middleware.js';
import type { ConmasSource } from '../conmas/source.js';

export function masterDataRoutes(repos: Repos, conmas: ConmasSource, audit: Audit, onChange: () => void): Router {
  const r = Router();
  r.get('/master-data', requirePermission(PERMISSIONS.viewMasterData), async (_req, res) => {
    const [parts, materials, categories] = await Promise.all([repos.master.parts(), repos.master.materials(), repos.master.categories()]);
    const machines = await conmas.machines().catch(() => []);
    const body: MasterDataView = { parts, materials, categories, machines };
    res.json(body);
  });
  const conflictError = (keys: string[]) => new HttpError(409, 'CONFLICT', `Data sudah diubah pengguna lain: ${keys.slice(0, 5).join(', ')}. Muat ulang lalu ulangi.`, { keys });
  r.put('/master-data/part-prices', requirePermission(PERMISSIONS.editMasterData), async (req, res) => {
    const me = userOf(req);
    const b = parse(PartPriceUpdateSchema, req.body);
    const failed = await repos.master.upsertPartPrices(b.items, me.id);
    if (failed.length) throw conflictError(failed);
    onChange();
    await audit(req, { action: 'masterdata.part-prices.update', result: 'success', objectType: 'md_part', after: { count: b.items.length, items: b.items.slice(0, 200) } });
    res.json(await repos.master.parts());
  });
  r.put('/master-data/materials', requirePermission(PERMISSIONS.editMasterData), async (req, res) => {
    const me = userOf(req);
    const b = parse(MaterialUpdateSchema, req.body);
    const failed = await repos.master.upsertMaterials(b.materials, b.partMaterials, me.id);
    if (failed.length) throw conflictError(failed);
    onChange();
    await audit(req, { action: 'masterdata.materials.update', result: 'success', objectType: 'md_material', after: { materials: b.materials, partMaterials: b.partMaterials.length } });
    res.json({ materials: await repos.master.materials(), parts: await repos.master.parts() });
  });
  return r;
}
