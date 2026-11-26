import { Router, type Request } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { loadPriceLookup, loadMaterialLookup } from './historicalPricing.js';
import { qualityNotices, scheduleNotices, type CalendarDay } from './dataQuality.js';
import { calendarKpiNotice, loadCalendar } from './scheduledCalendar.js';
import { lifecycleFilter, loadLifecycle, readMonitoringRecords } from './persistentSource.js';
import {
  IsoDate, MACHINE_PERSONNEL_ROLES, MachineFilterSchema, PERMISSIONS, RangeQuerySchema, StopQuerySchema,
  type Notice, type SettingsBody, type StopCategory, type ViewDataEnvelope,
} from '@mpd/contracts';
import type { Repos } from '../../db/repos.js';
import { forbidden, notFound, unauthorized } from '../../http/errors.js';
import { parse, requirePermission } from '../../http/middleware.js';
import { SourceUnavailable, type ConmasSource, type SourceRecord } from '../conmas/source.js';
import { readSettings } from '../settings/routes.js';
import { categoryResolver } from './categories.js';
import { applyFreshness, currentProductionDate } from './freshness.js';
import { findPersonnelPhoto, isPhotoNik } from './personnelPhotos.js';
import { buildDailyRates, buildMachineDetail, buildMachineList, buildProduction, buildSales, buildScrap, buildStopTime, buildUtilization, partKey, daysBetween, filterMachines, latestMachineRecord, type Range, type ScrapMaterial, type ScrapPart } from './views.js';

export interface MetricsCache { settings: SettingsBody | null; categories: StopCategory[] | null }

export function metricsRoutes(repos: Repos, conmas: ConmasSource, cache: MetricsCache, tzOffsetMinutes: number, employeePhotoDir?: string, operationsPool?: pg.Pool): Router {
  const r = Router();
  const settings = async () => (cache.settings ??= await readSettings(repos));
  const categories = async () => (cache.categories ??= await repos.master.categories());
  const shiftDate = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
  const live = async (from:string,to:string,machine?:string) => lifecycleFilter(operationsPool,await conmas.records(from,to,machine),to);
  const read = async (from:string,to:string,machine?:string) => lifecycleFilter(operationsPool,await readMonitoringRecords(conmas,operationsPool,from,to,machine),to);

  async function envelope<T>(range: Pick<Range, 'from' | 'to'>, load: () => Promise<{ records: SourceRecord[]; invalid: number; duplicates?: number; ambiguousGroups?: number; snapshotAt?: string; approvedGroups?: number; extraNotices?: (rs: SourceRecord[]) => Notice[]; build: (rs: SourceRecord[]) => T }>, keepEmpty = false): Promise<ViewDataEnvelope<T>> {
    const generatedAt = new Date().toISOString();
    try {
      const s = await settings();
      const { records, invalid, duplicates = 0, ambiguousGroups = 0, snapshotAt, approvedGroups = 0, extraNotices, build } = await load();
      const now = new Date();
      const today = currentProductionDate(now, tzOffsetMinutes, s.shifts.s1);
      const f = applyFreshness(records, now, s.data, tzOffsetMinutes, s.shifts.s1, range.from <= today && today <= range.to);
      const notices: Notice[] = [...f.notices, ...qualityNotices(records, duplicates, ambiguousGroups), ...(extraNotices?.(f.records) ?? [])];
      if(snapshotAt){if(f.records.length)f.freshness='stale';else f.freshness='unavailable';notices.push({code:'PERSISTENT_SNAPSHOT',message:`ConMas tidak dapat dibaca. Snapshot ${snapshotAt} ditampilkan, BUKAN data real-time. Identitas personel tidak disimpan.`});}
      if(approvedGroups)notices.push({code:'APPROVED_MULTI_RECORD',message:`${approvedGroups} grup shift memakai record independen yang disetujui operator.`});
      if (invalid) notices.push({ code: 'INVALID_ROWS', message: `${invalid} baris sumber tidak valid dan diabaikan.` });
      const state = !f.records.length ? (f.freshness === 'unavailable' || f.freshness === 'unknown' ? 'unavailable' : 'empty') : f.freshness === 'stale' || f.freshness === 'unknown' || f.freshness === 'unavailable' ? 'stale' : 'current';
      return { state, data: f.records.length || keepEmpty ? build(f.records) : null, freshness: f.freshness, sourceUpdatedAt: f.sourceUpdatedAt, generatedAt, notices };
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
    const [cur, prev] = await Promise.all([read(range.from, range.to), live(shiftDate(range.from, -range.days), shiftDate(range.from, -1)).catch(() => null)]);
    return { cur, prev: cur.snapshotAt ? null : prev };
  };

  const shiftsOf = (rs: SourceRecord[], shift: Range['shift']) => shift ? rs.filter((r) => r.shift === shift) : rs;

  r.get('/v1/monitoring/production', requirePermission(PERMISSIONS.viewProduction), async (req, res) => {
    const range = rangeOf(req);
    const mf = parse(MachineFilterSchema, req.query);
    const s = await settings();
    const { resolve } = categoryResolver(await categories());
    res.json(await envelope(range, async () => {
      const { cur, prev } = await loadRange(range);
      return { records: shiftsOf(filterMachines(cur.records, mf, s, range.shift), range.shift), invalid: cur.invalidRows, duplicates: cur.duplicatesDropped, ambiguousGroups: cur.ambiguousGroups, snapshotAt:cur.snapshotAt, approvedGroups:cur.approvedGroups, build: (rs) => buildProduction(rs, prev ? filterMachines(prev.records, mf, s, range.shift) : null, range, s, resolve) };
    }));
  });

  r.get('/v1/monitoring/utilization', requirePermission(PERMISSIONS.viewUtilization), async (req, res) => {
    const range = rangeOf(req);
    const mf = parse(MachineFilterSchema, req.query);
    const s = await settings();
    const { resolve } = categoryResolver(await categories());
    res.json(await envelope(range, async () => {
      const { cur, prev } = await loadRange(range);
      const calendar = operationsPool && !range.shift ? await operationsPool.query<CalendarDay>('SELECT work_date::text, day_type, planned_minutes FROM md_work_calendar WHERE work_date BETWEEN $1::date AND $2::date', [range.from, range.to]) : null;
      const schedule = operationsPool && process.env.MPD_SCHEDULE_KPI==='true' ? await loadCalendar(operationsPool,shiftDate(range.from,-range.days),range.to) : undefined;
      return { records: shiftsOf(filterMachines(cur.records, mf, s, range.shift), range.shift), invalid: cur.invalidRows, duplicates: cur.duplicatesDropped, ambiguousGroups: cur.ambiguousGroups,snapshotAt:cur.snapshotAt,approvedGroups:cur.approvedGroups,
        extraNotices: operationsPool ? rs => schedule ? [calendarKpiNotice(range,schedule)] : scheduleNotices(rs, calendar?.rows ?? [], range.shift) : undefined,
        build: (rs) => buildUtilization(rs, prev ? filterMachines(prev.records, mf, s, range.shift) : null, range, s, resolve,schedule) };
    }));
  });

  r.get('/v1/monitoring/stop-time', requirePermission(PERMISSIONS.viewStopTime), async (req, res) => {
    const range = rangeOf(req);
    const f = parse(StopQuerySchema, req.query);
    const mf = parse(MachineFilterSchema, req.query);
    const s = await settings();
    const { resolve, refs } = categoryResolver(await categories());
    const filter = { group: f.group, category: f.category, includeInfo: f.includeInfo ? f.includeInfo === 'true' : s.disp.info };
    res.json(await envelope(range, async () => {
      const { cur, prev } = await loadRange(range);
      return { records: shiftsOf(filterMachines(cur.records, mf, s, range.shift), range.shift), invalid: cur.invalidRows, duplicates: cur.duplicatesDropped, ambiguousGroups: cur.ambiguousGroups, snapshotAt:cur.snapshotAt, approvedGroups:cur.approvedGroups, build: (rs) => buildStopTime(rs, prev ? filterMachines(prev.records, mf, s, range.shift) : null, range, refs, resolve, filter) };
    }));
  });

  r.get('/v1/monitoring/daily-rates', async (req, res) => {
    const p = req.principal;
    if (!p) throw unauthorized();
    if (p.kind !== 'user' || !(p.permissions.includes(PERMISSIONS.viewProduction) || p.permissions.includes(PERMISSIONS.viewUtilization))) throw forbidden();
    const range = rangeOf(req);
    const mf = parse(MachineFilterSchema, req.query);
    const { machineNo } = parse(z.object({ machineNo: z.string().trim().max(20).optional() }), req.query);
    const s = await settings();
    const { resolve } = categoryResolver(await categories());
    res.json(await envelope(range, async () => {
      const cur = await read(range.from, range.to);
      const selected = shiftsOf(filterMachines(cur.records, mf, s, range.shift), range.shift);
      const schedule=operationsPool&&process.env.MPD_SCHEDULE_KPI==='true'?await loadCalendar(operationsPool,range.from,range.to):undefined;
      return { records: machineNo ? selected.filter((r) => r.machineNo === machineNo) : selected, invalid: cur.invalidRows, duplicates: cur.duplicatesDropped, ambiguousGroups: cur.ambiguousGroups,snapshotAt:cur.snapshotAt,approvedGroups:cur.approvedGroups,extraNotices:schedule?()=>[calendarKpiNotice(range,schedule)]:undefined, build: (rs) => buildDailyRates(rs, range, machineNo ?? null, s, resolve,schedule) };
    }));
  });

  /** Sales: rumus final (owner 2026-11-18, Q-009): OUTPUT ACTUAL x Harga/PCS dari Master Data. */
  r.get('/v1/monitoring/sales', requirePermission(PERMISSIONS.viewSales), async (req, res) => {
    const range = rangeOf(req);
    const prices = new Map<string, number | null>();
    for (const p of await repos.master.parts()) {
      const k = partKey(p.dpNo);
      if (k) prices.set(k, p.pricePerPcs);
    }
    res.json(await envelope(range, async () => {
      const [cur, history] = await Promise.all([read(range.from, range.to), operationsPool ? loadPriceLookup(operationsPool, range.from, range.to, tzOffsetMinutes) : undefined]);
      return { records: shiftsOf(cur.records, range.shift), invalid: cur.invalidRows, duplicates: cur.duplicatesDropped, ambiguousGroups: cur.ambiguousGroups,snapshotAt:cur.snapshotAt,approvedGroups:cur.approvedGroups, build: (rs) => buildSales(rs, prices, range, history) };
    }));
  });

  /** Scrap: NG (gram) ConMas x harga material per gram (Master Data: part -> material). Rumus nilai PROPOSED (menunggu approver Quality/Finance). */
  r.get('/v1/monitoring/scrap', requirePermission(PERMISSIONS.viewScrap), async (req, res) => {
    const range = rangeOf(req);
    const [partRows, matRows] = await Promise.all([repos.master.parts(), repos.master.materials()]);
    const parts = new Map<string, ScrapPart>(), materials = new Map<string, ScrapMaterial>();
    for (const p of partRows) { const k = partKey(p.dpNo); if (k) parts.set(k, { materialCode: p.materialCode, pricePerPcs: p.pricePerPcs }); }
    for (const m of matRows) materials.set(m.code, { name: m.name, pricePerGram: m.pricePerGram });
    res.json(await envelope(range, async () => {
      const [cur, history, mapping] = await Promise.all([read(range.from, range.to), operationsPool ? loadPriceLookup(operationsPool, range.from, range.to, tzOffsetMinutes) : undefined, operationsPool ? loadMaterialLookup(operationsPool,range.from,range.to) : undefined]);
      return { records: shiftsOf(cur.records, range.shift), invalid: cur.invalidRows, duplicates: cur.duplicatesDropped, ambiguousGroups: cur.ambiguousGroups,snapshotAt:cur.snapshotAt,approvedGroups:cur.approvedGroups, build: (rs) => buildScrap(rs, parts, materials, range, history,mapping) };
    }));
  });

  const DateQuery = z.object({ date: IsoDate.optional() });
  r.get('/v1/machines', requirePermission(PERMISSIONS.viewMachineDetail), async (req, res) => {
    const s0 = await settings();
    const { date = currentProductionDate(new Date(), tzOffsetMinutes, s0.shifts.s1) } = parse(DateQuery, req.query);
    const { resolve } = categoryResolver(await categories());
    res.json(await envelope({ from: date, to: date }, async () => {
      const cur=await read(date,date);
      const [adj,known,active]=await Promise.all([cur.snapshotAt?Promise.resolve({prev:null,next:null}):conmas.adjacentDates(date),conmas.machines().catch(()=>[]),loadLifecycle(operationsPool,date)]);
      return { records: cur.records, invalid: cur.invalidRows, duplicates: cur.duplicatesDropped, ambiguousGroups: cur.ambiguousGroups,snapshotAt:cur.snapshotAt,approvedGroups:cur.approvedGroups, build: (rs) => buildMachineList(rs, known.filter(m=>active(m.machineNo,date)).map((m) => m.machineNo), date, adj, resolve) };
    }, true));
  });

  function permittedMachine(req: Request) {
    const machineNo = String(req.params.machineNo);
    const p = req.principal;
    if (!p) throw unauthorized();
    // A kiosk can only read the dashboard and personnel photos for its paired machine.
    if (p.kind === 'kiosk' ? p.machineNo !== machineNo : !p.permissions.includes(PERMISSIONS.viewMachineDetail)) throw forbidden();
    return machineNo;
  }
  const machineDate = (req: Request, s: SettingsBody) => parse(DateQuery, req.query).date
    ?? currentProductionDate(new Date(), tzOffsetMinutes, s.shifts.s1);

  r.get('/v1/machine-detail/:machineNo/personnel-photo/:role', async (req, res) => {
    const machineNo = permittedMachine(req);
    const role = parse(z.enum(MACHINE_PERSONNEL_ROLES), req.params.role);
    const s = await settings();
    if (!employeePhotoDir || !s.md.pic) throw notFound('Foto personel');
    const date = machineDate(req, s);
    const result = await envelope({ from: date, to: date }, async () => {
      const cur = await live(date, date, machineNo);
      return { records: cur.records, invalid: cur.invalidRows, build: (rs) => latestMachineRecord(rs, machineNo, date)?.personnel[role] ?? null };
    });
    if (!isPhotoNik(result.data) || req.query.nik !== result.data) throw notFound('Foto personel');
    const file = await findPersonnelPhoto(employeePhotoDir, result.data);
    if (!file) throw notFound('Foto personel');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(file, { cacheControl: false });
  });

  r.get('/v1/machine-detail/:machineNo', async (req, res) => {
    const machineNo = permittedMachine(req);
    const s = await settings();
    const date = machineDate(req, s);
    const { resolve } = categoryResolver(await categories());
    res.json(await envelope({ from: date, to: date }, async () => {
      const cur=await read(date,date,machineNo);
      const adj=cur.snapshotAt?{prev:null,next:null}:await conmas.adjacentDates(date,machineNo);
      return { records: cur.records, invalid: cur.invalidRows, duplicates: cur.duplicatesDropped, ambiguousGroups: cur.ambiguousGroups,snapshotAt:cur.snapshotAt,approvedGroups:cur.approvedGroups, build: (rs) => {
        const detail = buildMachineDetail(machineNo, date, rs, adj, resolve, s);
        if (employeePhotoDir && s.md.pic) {
          for (const person of detail.personnel) {
            if (isPhotoNik(person.nik)) {
              person.photoUrl = '/api/v1/machine-detail/' + encodeURIComponent(machineNo)
                + '/personnel-photo/' + person.role + '?' + new URLSearchParams({ date, nik: person.nik }).toString();
            }
          }
        }
        return detail;
      } };
    }, true));
  });
  return r;
}
