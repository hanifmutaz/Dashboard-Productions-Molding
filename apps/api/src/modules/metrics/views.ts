import {
  SHIFT_START_HOURS, metric,
  type DailyRatesView, type LossGroup, type MachineDetailView, type MachineListView, type MachineProduction, type MachineUtilization, type ProductionTotals, type ProductionView,
  type SettingsBody, type StopCategoryRef, type StopTimeView, type UtilizationTotals, type UtilizationView,
} from '@mpd/contracts';
import { machineSort, type SourceRecord } from '../conmas/source.js';
import { GROUPS } from './categories.js';
import { bekidoritsu, ipr, kikai, notApproved, quality, shugyo, sogo, sumNullable } from './formulas.js';

export interface Ev { date: string; shift: '1' | '2' | '3'; machineNo: string; productName: string | null; cat: StopCategoryRef; detail: string; minutes: number; startMinuteOfDay: number }
export type Resolve = (text: string) => StopCategoryRef;
export interface Range { from: string; to: string; shift: string | null; days: number }

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
export const datesIn = (from: string, to: string) => Array.from({ length: daysBetween(from, to) }, (_, i) => new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10));
export const pad = (n: number) => String(n).padStart(2, '0');
const sum = <T>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);

function groupBy<T, K>(a: T[], f: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  a.forEach((x) => {
    const k = f(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  });
  return m;
}

/** Stop events from ConMas slots. "Informasi" / info-only categories are never counted as loss (STATE §9). */
export function eventsOf(r: SourceRecord, resolve: Resolve): { loss: Ev[]; info: Ev[]; rejects: Map<string, number> } {
  const loss: Ev[] = [], info: Ev[] = [];
  const rejects = new Map<string, number>();
  const shiftStart = SHIFT_START_HOURS[Number(r.shift) - 1]!;
  for (const s of r.slots) {
    if (s.reject && s.rejectQty && s.rejectQty > 0) rejects.set(s.reject, (rejects.get(s.reject) ?? 0) + s.rejectQty);
    if (!s.category) continue;
    const cat = resolve(s.category);
    const hour = s.startHour ?? (shiftStart + s.block) % 24;
    const ev: Ev = { date: r.date, shift: r.shift, machineNo: r.machineNo, productName: r.productName, cat, detail: s.detail ?? '(tanpa detail)', minutes: s.minutes ?? 0, startMinuteOfDay: hour * 60 };
    if (cat.infoOnly) info.push(ev);
    else if (ev.minutes > 0) loss.push(ev);
  }
  return { loss, info, rejects };
}

const filterShift = (rs: SourceRecord[], shift: string | null) => (shift ? rs.filter((r) => r.shift === shift) : rs);

// ---------------- Production ----------------
function prodTotals(rs: SourceRecord[], resolve: Resolve): ProductionTotals {
  const plan = sum(rs, (r) => r.plan ?? 0), actual = sum(rs, (r) => r.actual ?? 0);
  const reject = sumNullable(rs.map((r) => r.ngQty));
  return {
    plan, actual, gross: sumNullable(rs.map((r) => r.gross)), reject,
    bekidoritsu: bekidoritsu(actual, plan), deviation: actual - plan, ipr: ipr(reject, actual),
    stopMinutes: sum(rs, (r) => sum(eventsOf(r, resolve).loss, (e) => e.minutes)),
  };
}

export function buildProduction(records: SourceRecord[], prev: SourceRecord[] | null, range: Range, s: SettingsBody, resolve: Resolve): ProductionView {
  const rs = filterShift(records, range.shift);
  const totals = prodTotals(rs, resolve);
  const byMc = groupBy(rs, (r) => r.machineNo);
  const machines: MachineProduction[] = [...byMc.entries()].sort((a, b) => machineSort(a[0], b[0])).map(([machineNo, list]) => {
    const t = prodTotals(list, resolve);
    const rej = new Map<string, number>();
    list.forEach((r) => eventsOf(r, resolve).rejects.forEach((q, n) => rej.set(n, (rej.get(n) ?? 0) + q)));
    const latest = list.reduce((a, b) => (b.date > a.date ? b : a));
    const beki = t.bekidoritsu.value;
    return {
      ...t, machineNo, dpNo: latest.dpNo, productName: latest.productName,
      sharePct: totals.actual > 0 ? metric((t.actual / totals.actual) * 100) : metric(null, 'Total actual = 0'),
      rejectPct: t.reject !== null && t.gross ? metric((t.reject / t.gross) * 100) : metric(null, 'Gross/reject tidak tersedia'),
      rejects: [...rej.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
      achievement: beki === null ? 'unknown' : beki < s.prob.beki ? 'attention' : 'within',
    };
  });
  const daily = datesIn(range.from, range.to).map((date) => {
    const d = rs.filter((r) => r.date === date);
    const plan = sum(d, (r) => r.plan ?? 0), actual = sum(d, (r) => r.actual ?? 0);
    return { date, plan, actual, bekidoritsu: bekidoritsu(actual, plan) };
  });
  const groups = [...groupBy(rs.filter((r) => r.group), (r) => r.group!).entries()].sort().map(([group, list]) => {
    const plan = sum(list, (r) => r.plan ?? 0), actual = sum(list, (r) => r.actual ?? 0);
    return { group, plan, actual, bekidoritsu: bekidoritsu(actual, plan) };
  });
  return { range, totals, previous: prev && prev.length ? prodTotals(filterShift(prev, range.shift), resolve) : null, machines, daily, groups };
}

/** Keeps only machines matching the search text and achievement status (Status capaian filter). */
export function filterMachines(records: SourceRecord[], f: { status?: 'attention' | 'within' | 'unknown'; q?: string }, s: SettingsBody, shift: string | null): SourceRecord[] {
  const q = f.q?.toLowerCase();
  if (!q && !f.status) return records;
  const keep = new Set<string>();
  groupBy(filterShift(records, shift), (r) => r.machineNo).forEach((list, mc) => {
    const latest = list.reduce((a, b) => (b.date > a.date ? b : a));
    if (q && !`mc ${mc} mc${mc} ${latest.productName ?? ''} ${latest.dpNo ?? ''}`.toLowerCase().includes(q)) return;
    if (f.status) {
      const b = bekidoritsu(sum(list, (r) => r.actual ?? 0), sum(list, (r) => r.plan ?? 0)).value;
      const st = b === null ? 'unknown' : b < s.prob.beki ? 'attention' : 'within';
      if (st !== f.status) return;
    }
    keep.add(mc);
  });
  return records.filter((r) => keep.has(r.machineNo));
}

// ---------------- Utilization ----------------
function utilTotals(rs: SourceRecord[], machineCount: number, days: number, calPer: number, resolve: Resolve): UtilizationTotals {
  const planned = sum(rs, (r) => r.plannedMinutes ?? 0);
  const stop = sum(rs, (r) => sum(eventsOf(r, resolve).loss, (e) => e.minutes));
  const calendar = machineCount * days * calPer;
  const actual = sum(rs, (r) => r.actual ?? 0), plan = sum(rs, (r) => r.plan ?? 0);
  return {
    kikai: kikai(planned, stop), sogo: sogo(planned, stop, calendar), shugyo: shugyo(planned, calendar),
    quality: quality(actual, sumNullable(rs.map((r) => r.gross))), bekidoritsu: bekidoritsu(actual, plan),
    availability: notApproved(), performance: notApproved(), oee: notApproved(),
    plannedMinutes: planned, stopMinutes: stop, calendarMinutes: calendar,
  };
}

export function buildUtilization(records: SourceRecord[], prev: SourceRecord[] | null, range: Range, s: SettingsBody, resolve: Resolve): UtilizationView {
  const rs = filterShift(records, range.shift);
  const calPer = range.shift ? s.cal.shift : s.cal.day;
  const byMc = groupBy(rs, (r) => r.machineNo);
  const machines: MachineUtilization[] = [...byMc.entries()].sort((a, b) => machineSort(a[0], b[0])).map(([machineNo, list]) => {
    const t = utilTotals(list, 1, range.days, calPer, resolve);
    const loss = new Map<string, { category: string; categoryId: string; color: string; minutes: number }>();
    const rej = new Map<string, number>();
    list.forEach((r) => {
      const e = eventsOf(r, resolve);
      e.loss.forEach((x) => {
        const cur = loss.get(x.cat.id) ?? { category: x.cat.short, categoryId: x.cat.id, color: x.cat.color, minutes: 0 };
        cur.minutes += x.minutes;
        loss.set(x.cat.id, cur);
      });
      e.rejects.forEach((q, n) => rej.set(n, (rej.get(n) ?? 0) + q));
    });
    const latest = list.reduce((a, b) => (b.date > a.date ? b : a));
    return {
      ...t, machineNo, productName: latest.productName,
      ctPlan: metric(null, 'CT plan belum tersedia di sumber (Master Data/ConMas)'),
      ctActual: metric(latest.ctActual, 'CT actual kosong'),
      losses: [...loss.values()].sort((a, b) => b.minutes - a.minutes),
      rejects: [...rej.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
    };
  });
  const prevRs = prev ? filterShift(prev, range.shift) : [];
  return {
    range, machines,
    totals: utilTotals(rs, byMc.size, range.days, calPer, resolve),
    previous: prevRs.length ? utilTotals(prevRs, new Set(prevRs.map((r) => r.machineNo)).size, range.days, calPer, resolve) : null,
  };
}

// ---------------- Stop time ----------------
export interface StopFilter { group?: LossGroup; category?: string; includeInfo: boolean }
function stopEvents(rs: SourceRecord[], resolve: Resolve, f: StopFilter): Ev[] {
  return rs.flatMap((r) => {
    const e = eventsOf(r, resolve);
    return [...e.loss, ...(f.includeInfo ? e.info : [])];
  }).filter((e) => (!f.group || e.cat.group === f.group) && (!f.category || e.cat.id === f.category));
}
function detailsOf(evs: Ev[]) {
  const m = new Map<string, { categoryId: string; detail: string; minutes: number; events: number }>();
  evs.forEach((e) => {
    const k = `${e.cat.id}|${e.detail}`;
    const x = m.get(k) ?? { categoryId: e.cat.id, detail: e.detail, minutes: 0, events: 0 };
    x.minutes += e.minutes;
    x.events++;
    m.set(k, x);
  });
  return [...m.values()].sort((a, b) => b.minutes - a.minutes);
}
const catMinutes = (evs: Ev[]) => evs.reduce<Record<string, number>>((o, e) => ((o[e.cat.id] = (o[e.cat.id] ?? 0) + e.minutes), o), {});

export function buildStopTime(records: SourceRecord[], prev: SourceRecord[] | null, range: Range, refs: StopCategoryRef[], resolve: Resolve, f: StopFilter): StopTimeView {
  const rs = filterShift(records, range.shift);
  const evs = stopEvents(rs, resolve, f);
  const infoMinutes = sum(rs.flatMap((r) => eventsOf(r, resolve).info), (e) => e.minutes);
  const agg = (list: Ev[]) => ({ minutes: sum(list, (e) => e.minutes), events: list.length, activeCategories: new Set(list.map((e) => e.cat.id)).size, activeDetails: new Set(list.map((e) => `${e.cat.id}|${e.detail}`)).size });
  const usedRefs = new Map(refs.map((r) => [r.id, r]));
  evs.forEach((e) => usedRefs.set(e.cat.id, e.cat));
  const byCategory = Object.entries(catMinutes(evs)).map(([categoryId, minutes]) => ({ categoryId, minutes, events: evs.filter((e) => e.cat.id === categoryId).length })).sort((a, b) => b.minutes - a.minutes);
  const byGroup = [...groupBy(evs, (e) => e.cat.group).entries()].map(([group, list]) => ({ group, minutes: sum(list, (e) => e.minutes), events: list.length, categories: new Set(list.map((e) => e.cat.id)).size })).sort((a, b) => b.minutes - a.minutes);
  const byMachine = [...groupBy(evs, (e) => e.machineNo).entries()].map(([machineNo, list]) => ({
    machineNo, productName: list[0]!.productName, minutes: sum(list, (e) => e.minutes), events: list.length, categories: catMinutes(list), details: detailsOf(list),
  })).sort((a, b) => b.minutes - a.minutes);
  const byProduct = [...groupBy(evs, (e) => e.productName ?? '(tanpa nama produk)').entries()].map(([productName, list]) => ({
    productName, machines: [...new Set(list.map((e) => e.machineNo))].sort(machineSort), minutes: sum(list, (e) => e.minutes), events: list.length, categories: catMinutes(list), details: detailsOf(list),
  })).sort((a, b) => b.minutes - a.minutes);
  const details = detailsOf(evs).map((d) => ({ ...d, machines: [...new Set(evs.filter((e) => e.cat.id === d.categoryId && e.detail === d.detail).map((e) => e.machineNo))].sort(machineSort) }));
  const prevEvs = prev ? stopEvents(filterShift(prev, range.shift), resolve, f) : null;
  return {
    range, categories: [...usedRefs.values()], groups: GROUPS,
    totals: { ...agg(evs), infoMinutes, knownDetails: refs.length ? new Set(refs.map((r) => r.id)).size : 0 },
    previous: prevEvs && prev!.length ? agg(prevEvs) : null,
    byCategory, byGroup, byMachine, byProduct, details,
    byShift: (['1', '2', '3'] as const).map((shift) => ({ shift, minutes: sum(evs.filter((e) => e.shift === shift), (e) => e.minutes) })),
  };
}

// ---------------- Machine list & detail ----------------
export function buildMachineList(records: SourceRecord[], known: string[], date: string, adj: { prev: string | null; next: string | null }, resolve: Resolve): MachineListView {
  const all = [...new Set([...known, ...records.map((r) => r.machineNo)])].sort(machineSort);
  return {
    date, prevDate: adj.prev, nextDate: adj.next,
    machines: all.map((machineNo) => {
      const list = records.filter((r) => r.machineNo === machineNo);
      if (!list.length) return { machineNo, dpNo: null, productName: null, hasRecord: false, bekidoritsu: metric(null, 'Tidak ada catatan produksi'), oee: notApproved(), stopMinutes: null, reject: null };
      const t = prodTotals(list, resolve);
      return { machineNo, dpNo: list[0]!.dpNo, productName: list[0]!.productName, hasRecord: true, bekidoritsu: t.bekidoritsu, oee: notApproved(), stopMinutes: t.stopMinutes, reject: t.reject };
    }),
  };
}

export function buildMachineDetail(machineNo: string, date: string, records: SourceRecord[], adj: { prev: string | null; next: string | null }, resolve: Resolve): MachineDetailView {
  const rs = records.filter((r) => r.machineNo === machineNo && r.date === date);
  const shiftTime = (i: number) => `${pad(SHIFT_START_HOURS[i]!)}:00–${pad(SHIFT_START_HOURS[(i + 1) % 3]!)}:00`;
  const allEv = rs.map((r) => ({ r, e: eventsOf(r, resolve) }));
  const stops = allEv.flatMap(({ e }) => e.loss).sort((a, b) => Number(a.shift) - Number(b.shift) || ((a.startMinuteOfDay - 360 + 1440) % 1440) - ((b.startMinuteOfDay - 360 + 1440) % 1440));
  const shifts = (['1', '2', '3'] as const).map((shift, i) => {
    const r = rs.find((x) => x.shift === shift);
    if (!r) return { shift, time: shiftTime(i), hasRecord: false, group: null, plan: null, actual: null, gross: null, reject: null, ipr: metric(null, 'Tidak ada record'), deviation: null, stopMinutes: null, bekidoritsu: metric(null, 'Tidak ada record') };
    const plan = r.plan ?? 0, actual = r.actual ?? 0;
    return {
      shift, time: shiftTime(i), hasRecord: true, group: r.group, plan: r.plan, actual: r.actual, gross: r.gross, reject: r.ngQty, ipr: ipr(r.ngQty, actual),
      deviation: actual - plan, stopMinutes: sum(stops.filter((e) => e.shift === shift), (e) => e.minutes), bekidoritsu: bekidoritsu(actual, plan),
    };
  });
  const t = prodTotals(rs, resolve);
  const catMap = new Map<string, { categoryId: string; name: string; color: string; minutes: number }>();
  stops.forEach((e) => {
    const c = catMap.get(e.cat.id) ?? { categoryId: e.cat.id, name: e.cat.short, color: e.cat.color, minutes: 0 };
    c.minutes += e.minutes;
    catMap.set(e.cat.id, c);
  });
  const rej = new Map<string, number>();
  allEv.forEach(({ e }) => e.rejects.forEach((q, n) => rej.set(n, (rej.get(n) ?? 0) + q)));
  let pareto = [...rej.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
  if (pareto.length > 5) pareto = [...pareto.slice(0, 4), { name: 'Others', qty: sum(pareto.slice(4), (x) => x.qty) }];
  const latest = rs.length ? rs.reduce((a, b) => (Number(b.shift) > Number(a.shift) ? b : a)) : null;
  return {
    machineNo, date, prevDate: adj.prev, nextDate: adj.next, hasRecord: rs.length > 0,
    header: {
      dpNo: latest?.dpNo ?? null, productName: latest?.productName ?? null, poNo: latest?.poNo ?? null, cavity: latest?.cavity ?? null,
      ctPlan: metric(null, 'CT plan belum tersedia di sumber'), ctActual: metric(latest?.ctActual ?? null, 'CT actual kosong'),
    },
    personnel: [
      { role: 'leader', nik: latest?.personnel.leader ?? null }, { role: 'cell', nik: latest?.personnel.cell ?? null },
      { role: 'technician', nik: latest?.personnel.technician ?? null }, { role: 'operator', nik: latest?.personnel.operator ?? null },
    ],
    shifts,
    totals: { plan: t.plan, actual: t.actual, gross: t.gross, reject: t.reject, deviation: t.deviation, ipr: t.ipr, stopMinutes: t.stopMinutes, bekidoritsu: t.bekidoritsu, oee: notApproved() },
    stops: stops.map((e) => ({ shift: e.shift, startMinuteOfDay: e.startMinuteOfDay, time: `${pad(Math.floor(e.startMinuteOfDay / 60))}:00`, minutes: e.minutes, categoryId: e.cat.id, category: e.cat.short, color: e.cat.color, detail: e.detail })),
    stopCategories: [...catMap.values()].sort((a, b) => b.minutes - a.minutes),
    hourly: { available: false, reason: 'Agregasi output per jam (5 slot QTY PCS) belum disetujui; mockup memakai estimasi yang tidak dipakai di produksi.' },
    rejectPareto: pareto,
  };
}

/** Daily rate table for the modal (approved formulas only). */
export function buildDailyRates(records: SourceRecord[], range: Range, machineNo: string | null, s: SettingsBody, resolve: Resolve): DailyRatesView {
  const rs = filterShift(records, range.shift).filter((r) => !machineNo || r.machineNo === machineNo);
  const calPer = range.shift ? s.cal.shift : s.cal.day;
  const machines = new Set(rs.map((r) => r.machineNo)).size;
  return {
    machineNo, productName: machineNo ? (rs[0]?.productName ?? null) : null,
    rows: datesIn(range.from, range.to).map((date) => {
      const d = rs.filter((r) => r.date === date);
      const plan = sum(d, (r) => r.plan ?? 0), actual = sum(d, (r) => r.actual ?? 0);
      const planned = sum(d, (r) => r.plannedMinutes ?? 0), stop = sum(d, (r) => sum(eventsOf(r, resolve).loss, (e) => e.minutes));
      const cal = d.length ? machines * calPer : 0;
      return { date, plan, actual, bekidoritsu: bekidoritsu(actual, plan), calendarMinutes: cal, plannedMinutes: planned, stopMinutes: stop, runningMinutes: Math.max(0, planned - stop), kikai: kikai(planned, stop), sogo: sogo(planned, stop, cal), shugyo: shugyo(planned, cal) };
    }),
  };
}
