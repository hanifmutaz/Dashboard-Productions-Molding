import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  IsoDate, MachineFilterSchema, PERMISSIONS, RangeQuerySchema, StopQuerySchema,
  type Notice, type SettingsBody, type StopCategory, type ViewDataEnvelope,
} from '@mpd/contracts';
import type { Repos } from '../../db/repos.js';
import { forbidden, unauthorized } from '../../http/errors.js';
import { parse, requirePermission } from '../../http/middleware.js';
import { SourceUnavailable, type ConmasSource, type SourceRecord } from '../conmas/source.js';
import { readSettings } from '../settings/routes.js';
import { categoryResolver } from './categories.js';
import { applyFreshness, currentProductionDate } from './freshness.js';
import { buildDailyRates, buildMachineDetail, buildMachineList, buildProduction, buildStopTime, buildUtilization, daysBetween, filterMachines, type Range } from './views.js';

export interface MetricsCache { settings: SettingsBody | null; categories: StopCategory[] | null }

export function metricsRoutes(repos: Repos, conmas: ConmasSource, cache: MetricsCache, tzOffsetMinutes: number): Router {
  const r = Router();
  const settings = async () => (cache.settings ??= await readSettings(repos));
  const categories = async () => (cache.categories ??= await repos.master.categories());
  const shiftDate = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

  async function envelope<T>(load: () => Promise<{ records: SourceRecord[]; invalid: number; build: (rs: SourceRecord[]) => T }>): Promise<ViewDataEnvelope<T>> {
    const generatedAt = new Date().toISOString();
    try {
      const s = await settings();
      const { records, invalid, build } = await load();
      const f = applyFreshness(records, new Date(), s.data, tzOffsetMinutes);
      const notices: Notice[] = [...f.notices];
      if (invalid) notices.push({ code: 'INVALID_ROWS', message: `${invalid} baris sumber tidak valid dan diabaikan.` });
      const state = !f.records.length ? (f.freshness === 'unavailable' || f.freshness === 'unknown' ? 'unavailable' : 'empty') : f.freshness === 'stale' ? 'stale' : 'current';
      return { state, data: build(f.records), freshness: f.freshness, sourceUpdatedAt: f.sourceUpdatedAt, generatedAt, notices };
    } catch (e) {
      if (e instanceof SourceUnavailable) return { state: 'unavailable', data: null, freshness: 'unavailable', sourceUpdatedAt: null, generatedAt, notices: [{ code: e.code, message: e.message }] };
      throw e;
    }
  }
  const rangeOf = (req: Request): Range => {
    const q = parse(RangeQuerySchema, req.query);
    return { from: q.from, to: q.to, shift: q.shift ?? null, days: daysBetween(q.from, q.to) };
  };
  const loadRange = async (range: Range) => {
    const cur = await conmas.records(range.from, range.to);
    const prev = await conmas.records(shiftDate(range.from, -range.days), shiftDate(range.from, -1)).catch(() => null);
    return { cur, prev };
  };

  r.get('/v1/monitoring/production', requirePermission(PERMISSIONS.viewProduction), async (req, res) => {
    const range = rangeOf(req);
    const mf = parse(MachineFilterSchema, req.query);
    const s = await settings();
    const { resolve } = categoryResolver(await categories());
    res.json(await envelope(async () => {
      const { cur, prev } = await loadRange(range);
      return { records: cur.records, invalid: cur.invalidRows, build: (rs) => buildProduction(filterMachines(rs, mf, s, range.shift), prev ? filterMachines(prev.records, mf, s, range.shift) : null, range, s, resolve) };
    }));
  });

  r.get('/v1/monitoring/utilization', requirePermission(PERMISSIONS.viewUtilization), async (req, res) => {
    const range = rangeOf(req);
    const mf = parse(MachineFilterSchema, req.query);
    const s = await settings();
    const { resolve } = categoryResolver(await categories());
    res.json(await envelope(async () => {
      const { cur, prev } = await loadRange(range);
      return { records: cur.records, invalid: cur.invalidRows, build: (rs) => buildUtilization(filterMachines(rs, mf, s, range.shift), prev ? filterMachines(prev.records, mf, s, range.shift) : null, range, s, resolve) };
    }));
  });

  r.get('/v1/monitoring/stop-time', requirePermission(PERMISSIONS.viewStopTime), async (req, res) => {
    const range = rangeOf(req);
    const f = parse(StopQuerySchema, req.query);
    const mf = parse(MachineFilterSchema, req.query);
    const s = await settings();
    const { resolve, refs } = categoryResolver(await categories());
    const filter = { group: f.group, category: f.category, includeInfo: f.includeInfo ? f.includeInfo === 'true' : s.disp.info };
    res.json(await envelope(async () => {
      const { cur, prev } = await loadRange(range);
      return { records: cur.records, invalid: cur.invalidRows, build: (rs) => buildStopTime(filterMachines(rs, mf, s, range.shift), prev ? filterMachines(prev.records, mf, s, range.shift) : null, range, refs, resolve, filter) };
    }));
  });

  r.get('/v1/monitoring/daily-rates', async (req, res) => {
    const p = req.principal;
    if (!p) throw unauthorized();
    if (p.kind !== 'user' || !(p.permissions.includes(PERMISSIONS.viewProduction) || p.permissions.includes(PERMISSIONS.viewUtilization))) throw forbidden();
    const range = rangeOf(req);
    const { machineNo } = parse(z.object({ machineNo: z.string().trim().max(20).optional() }), req.query);
    const s = await settings();
    const { resolve } = categoryResolver(await categories());
    res.json(await envelope(async () => {
      const cur = await conmas.records(range.from, range.to);
      return { records: cur.records, invalid: cur.invalidRows, build: (rs) => buildDailyRates(rs, range, machineNo ?? null, s, resolve) };
    }));
  });

  /** Sales & Scrap: formula, price source, currency rounding and approver (Finance/Quality) not decided (Q-003, Q-009). */
  for (const [path, perm] of [['sales', PERMISSIONS.viewSales], ['scrap', PERMISSIONS.viewScrap]] as const) {
    r.get(`/v1/monitoring/${path}`, requirePermission(perm), (_req, res) => {
      const body: ViewDataEnvelope<null> = {
        state: 'unavailable', data: null, freshness: 'not-applicable', sourceUpdatedAt: null, generatedAt: new Date().toISOString(),
        notices: [{ code: 'Q-009', message: 'Rumus, sumber harga dan approver Sales/Scrap belum ditetapkan. Angka tidak ditampilkan sampai disetujui.' }],
      };
      res.json(body);
    });
  }

  const DateQuery = z.object({ date: IsoDate.optional() });
  r.get('/v1/machines', requirePermission(PERMISSIONS.viewMachineDetail), async (req, res) => {
    const { date = currentProductionDate(new Date(), tzOffsetMinutes) } = parse(DateQuery, req.query);
    const { resolve } = categoryResolver(await categories());
    res.json(await envelope(async () => {
      const [cur, adj, known] = await Promise.all([conmas.records(date, date), conmas.adjacentDates(date), conmas.machines().catch(() => [])]);
      return { records: cur.records, invalid: cur.invalidRows, build: (rs) => buildMachineList(rs, known.map((m) => m.machineNo), date, adj, resolve) };
    }));
  });

  r.get('/v1/machine-detail/:machineNo', async (req, res) => {
    const machineNo = String(req.params.machineNo);
    const p = req.principal;
    if (!p) throw unauthorized();
    // Kiosk credential is locked to exactly one machine and is read-only (ADR-019).
    if (p.kind === 'kiosk' ? p.machineNo !== machineNo : !p.permissions.includes(PERMISSIONS.viewMachineDetail)) throw forbidden();
    const { date = currentProductionDate(new Date(), tzOffsetMinutes) } = parse(DateQuery, req.query);
    const { resolve } = categoryResolver(await categories());
    res.json(await envelope(async () => {
      const [cur, adj] = await Promise.all([conmas.records(date, date, machineNo), conmas.adjacentDates(date, machineNo)]);
      return { records: cur.records, invalid: cur.invalidRows, build: (rs) => buildMachineDetail(machineNo, date, rs, adj, resolve) };
    }));
  });
  return r;
}
