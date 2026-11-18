import { Router } from 'express';
import { MaterialUpdateSchema, PERMISSIONS, PartPriceUpdateSchema, StopCategoryInputSchema, type MasterDataView } from '@mpd/contracts';
import type { Repos } from '../../db/repos.js';
import { HttpError, notFound } from '../../http/errors.js';
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

  /* ---- Stop categories & details: dedicated permission so Super admin can grant it to specific roles ---- */
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  /** Same keys the ConMas resolver uses (name, short, aliases). A key owned by two categories would silently remap stop records. */
  const keysOf = (c: { name: string; short: string; aliases: string[] }) => [c.name, c.short, ...c.aliases].map(norm).filter(Boolean);
  const slug = (t: string, taken: Set<string>) => {
    const base = (t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'kategori').slice(0, 24);
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`.slice(0, 30);
    return id;
  };
  const dedupe = (l: string[]) => { const seen = new Set<string>(); return l.filter((x) => { const k = x.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true); }); };
  r.put('/master-data/stop-categories', requirePermission(PERMISSIONS.editStopCategories), async (req, res) => {
    const b = parse(StopCategoryInputSchema, req.body);
    const all = await repos.master.categories();
    const before = b.id ? all.find((c) => c.id === b.id) : undefined;
    if (b.id && !before) throw notFound('Kategori stop');
    const id = b.id ?? slug(b.short, new Set(all.map((c) => c.id)));
    const next = { ...b, id, aliases: dedupe(b.aliases), details: dedupe(b.details), notes: b.notes || null };
    const mine = new Set(keysOf(next));
    const clash = all.filter((c) => c.id !== id).find((c) => keysOf(c).some((k) => mine.has(k)));
    if (clash) throw new HttpError(409, 'CATEGORY_NAME_CONFLICT', `Nama atau alias bentrok dengan kategori “${clash.name}”. Setiap nama/alias ConMas hanya boleh dimiliki satu kategori.`);
    if (!(await repos.master.saveCategory(next))) throw conflictError([id]);
    onChange();
    const after = (await repos.master.categories()).find((c) => c.id === id);
    await audit(req, { action: before ? 'masterdata.stop-category.update' : 'masterdata.stop-category.create', result: 'success', objectType: 'md_stop_category', objectId: id, before, after });
    res.json(await repos.master.categories());
  });
  r.delete('/master-data/stop-categories/:id', requirePermission(PERMISSIONS.editStopCategories), async (req, res) => {
    const id = String(req.params.id), version = Number(req.query.version);
    if (!Number.isInteger(version)) throw new HttpError(400, 'BAD_REQUEST', 'Parameter version wajib diisi.');
    const before = (await repos.master.categories()).find((c) => c.id === id);
    if (!before) throw notFound('Kategori stop');
    if (!(await repos.master.deleteCategory(id, version))) throw conflictError([id]);
    onChange();
    await audit(req, { action: 'masterdata.stop-category.delete', result: 'success', objectType: 'md_stop_category', objectId: id, before });
    res.json(await repos.master.categories());
  });
  return r;
}
