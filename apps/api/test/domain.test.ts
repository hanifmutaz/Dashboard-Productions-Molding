import { describe, expect, it } from 'vitest';
import { aggregateRate, bekidoritsu, ipr, kikai, quality, salesValue, scrapKg, scrapRatio, scrapValue, shugyo, sogo } from '../src/modules/metrics/formulas.js';
import { applyFreshness, currentProductionDate } from '../src/modules/metrics/freshness.js';
import { normalizeRow, parseHourLabel, parseRate, selectLatest, toIsoWithOffset, type SourceRecord } from '../src/modules/conmas/source.js';
import { HEADER_COLUMNS, HOUR_BLOCKS } from '../src/modules/conmas/fieldMap.generated.js';
import { buildMachineDetail, buildMachineList, buildSales, buildUtilization, buildProduction, eventsOf, hourlyOutput } from '../src/modules/metrics/views.js';
import { categoryResolver } from '../src/modules/metrics/categories.js';
import { DEFAULT_SETTINGS, SettingsBodySchema, type StopCategory } from '@mpd/contracts';

const cfg = { view: 'v', tzOffset: '+07:00', cacheTtlSeconds: 0, cols: { recordId: 'rid', revNo: 'rev', deleted: 'del', updatedAt: 'upd' } };

describe('approved formulas (owner 2026-11-07)', () => {
  it('bekidoritsu = actual/plan*100, plan 0 -> unavailable (not 0)', () => {
    expect(bekidoritsu(750, 2880).value).toBeCloseTo(26.04, 2);
    expect(bekidoritsu(10, 0)).toEqual({ value: null, reason: 'Plan = 0' });
  });
  it('IPR, quality, kikai, sogo, shugyo', () => {
    expect(ipr(5, 1_000_000).value).toBe(5);
    expect(ipr(null, 10).value).toBeNull();
    expect(quality(990, 1000).value).toBe(99);
    expect(kikai(480, 200).value).toBeCloseTo(58.33, 2);
    expect(sogo(480, 200, 480).value).toBeCloseTo(58.33, 2);
    expect(shugyo(480, 1440).value).toBeCloseTo(33.33, 2);
    expect(kikai(0, 0).value).toBeNull();
  });
});

describe('ConMas normalisation', () => {
  const b0 = HOUR_BLOCKS[0]!;
  const row: Record<string, unknown> = {
    [HEADER_COLUMNS.productionDate]: '2026-11-03 00:00:00', [HEADER_COLUMNS.machineNo]: '31', [HEADER_COLUMNS.shift]: 'S2', [HEADER_COLUMNS.group]: 'A',
    [HEADER_COLUMNS.outputPlan]: '2880.0000000000', [HEADER_COLUMNS.outputActual]: '750.0000000000', [HEADER_COLUMNS.outputGross]: '1275.0000000000', [HEADER_COLUMNS.ngQty]: '',
    [HEADER_COLUMNS.productName]: 'HIF4-16D-3.18R PROTECTOR                ', [HEADER_COLUMNS.plannedMinutes]: '480.0000000000',
    [b0.label]: '15.00-16.00', [b0.slots[0]!.minutes!]: '60.0000000000', [b0.slots[0]!.category!]: 'Dandori loss(Set up & Adjust ment loss)', [b0.slots[0]!.detail!]: 'Heater up',
    [b0.slots[1]!.category!]: 'Informasi', [b0.slots[1]!.detail!]: 'Alarm range aktif',
    rid: '457678', rev: '2', del: '0', upd: '2026-11-04 08:25:52.829606',
  };
  it('parses sample row (PROPOSED mapping), keeps null for empty numerics, trims text', () => {
    const r = normalizeRow(row, cfg)!;
    expect(r).toMatchObject({ date: '2026-11-03', machineNo: '31', shift: '2', group: 'A', plan: 2880, actual: 750, gross: 1275, ngQty: null, productName: 'HIF4-16D-3.18R PROTECTOR', plannedMinutes: 480 });
    expect(r.updatedAt).toBe('2026-11-04T08:25:52.829+07:00');
    expect(r.slots[0]).toMatchObject({ startHour: 15, minutes: 60, detail: 'Heater up' });
  });
  it('rejects rows without machine/date/shift and non-numeric values', () => {
    expect(normalizeRow({ ...row, [HEADER_COLUMNS.shift]: 'X' }, cfg)).toBeNull();
    expect(normalizeRow({ ...row, [HEADER_COLUMNS.outputActual]: 'abc' }, cfg)).toBeNull();
  });
  it('timestamp & hour label helpers', () => {
    expect(toIsoWithOffset('bad', '+07:00')).toBeNull();
    expect(parseHourLabel('23.00-24.00')).toBe(23);
    expect(parseHourLabel(null)).toBeNull();
  });
  it('Q-019: keeps highest rev per machine/date/shift, tie -> latest update', () => {
    const base = normalizeRow(row, cfg)!;
    const a = { rec: { ...base, recordId: 'a', updatedAt: '2026-11-04T08:00:00+07:00' }, rev: 1 };
    const b = { rec: { ...base, recordId: 'b', updatedAt: '2026-11-04T07:00:00+07:00' }, rev: 2 };
    const c = { rec: { ...base, recordId: 'c', updatedAt: '2026-11-04T09:00:00+07:00' }, rev: 2 };
    const r = selectLatest([a, b, c]);
    expect(r.records.map((x) => x.recordId)).toEqual(['c']);
    expect(r.dropped).toBe(2);
  });
  it('info-only category is never counted as loss', () => {
    const cats: StopCategory[] = [
      { id: 'dandori', short: 'Dandori', name: 'Dandori loss (Set up & Adjustment loss)', group: 'setup', oeeBucket: 'A', infoOnly: false, color: 'x', aliases: ['Dandori loss(Set up & Adjust ment loss)'], details: [], notes: null, version: 0 },
      { id: 'info', short: 'Informasi', name: 'Informasi', group: 'planned', oeeBucket: '-', infoOnly: true, color: 'y', aliases: [], details: [], notes: null, version: 0 },
    ];
    const { resolve } = categoryResolver(cats);
    const e = eventsOf(normalizeRow(row, cfg)!, resolve);
    expect(e.loss.map((x) => [x.cat.id, x.minutes])).toEqual([['dandori', 60]]);
    expect(e.info).toHaveLength(1);
    expect(resolve('Something new').id).toBe('unmapped');
  });
});

describe('freshness (FINAL 15/60)', () => {
  const rec = (date: string, updatedAt: string | null) => ({ date, updatedAt }) as SourceRecord;
  const now = new Date('2026-11-09T10:00:00+07:00');
  it('production date: before 06:00 belongs to previous day', () => {
    expect(currentProductionDate(new Date('2026-11-09T05:59:00+07:00'))).toBe('2026-11-08');
    expect(currentProductionDate(new Date('2026-11-09T06:00:00+07:00'))).toBe('2026-11-09');
  });
  it('current / stale / unavailable / unknown', () => {
    const th = { stale: 15, unavailable: 60 };
    expect(applyFreshness([rec('2026-11-09', '2026-11-09T09:50:00+07:00')], now, th).freshness).toBe('current');
    expect(applyFreshness([rec('2026-11-09', '2026-11-09T09:30:00+07:00')], now, th).freshness).toBe('stale');
    const old = applyFreshness([rec('2026-11-09', '2026-11-09T08:00:00+07:00'), rec('2026-11-08', '2026-11-08T23:00:00+07:00')], now, th);
    expect(old.freshness).toBe('unavailable');
    expect(old.records.map((r) => r.date)).toEqual(['2026-11-08']);
    expect(applyFreshness([rec('2026-11-09', null)], now, th).freshness).toBe('unknown');
    expect(applyFreshness([rec('2026-11-01', '2026-11-02T08:00:00+07:00')], now, th).freshness).toBe('not-applicable');
  });
});

describe('production view', () => {
  it('aggregates without inventing values; achievement uses approved bekidoritsu', () => {
    const r = (mc: string, plan: number, actual: number): SourceRecord => ({
      recordId: mc, date: '2026-11-03', machineNo: mc, shift: '1', group: 'A', cavity: null, plan, actual, gross: null, ngGram: null, ngQty: null, dpNo: null, productName: 'P', poNo: null,
      ctActual: null, plannedMinutes: 480, oee: null, availability: null, performance: null, personnel: { leader: null, cell: null, technician: null, operator: null }, updatedAt: null, slots: [],
    });
    const { resolve } = categoryResolver([]);
    const v = buildProduction([r('1', 100, 50), r('2', 0, 0)], null, { from: '2026-11-03', to: '2026-11-03', shift: null, days: 1 }, DEFAULT_SETTINGS, resolve);
    expect(v.totals.bekidoritsu.value).toBe(50);
    expect(v.totals.gross).toBeNull();
    expect(v.machines.find((m) => m.machineNo === '2')!.achievement).toBe('unknown');
    expect(v.machines.find((m) => m.machineNo === '1')!.achievement).toBe('attention');
  });
});

// ---------- owner decisions 2026-11-17 ----------
const rec = (o: Partial<SourceRecord> = {}): SourceRecord => ({
  recordId: 'r', date: '2026-11-03', machineNo: '1', shift: '1', group: 'A', cavity: null, plan: 100, actual: 90, gross: 95, ngGram: null, ngQty: 5, dpNo: 'DP1', productName: 'P', poNo: null,
  ctActual: null, plannedMinutes: 480, oee: null, availability: null, performance: null,
  personnel: { leader: null, cell: null, technician: null, operator: null }, updatedAt: null, slots: [], ...o,
});
const slot = (block: number, qty: number | null, startHour: number | null = 6 + block) => ({ block, startHour, qty, minutes: null, category: null, detail: null, reject: null, rejectQty: null });
const range = { from: '2026-11-03', to: '2026-11-03', shift: null, days: 1 };

describe('OEE / Availability / Performance come from ConMas', () => {
  it('parseRate: percent as-is, fraction x100, empty/garbage -> null', () => {
    expect(parseRate('83.5', 'percent')).toBe(83.5);
    expect(parseRate(0.835, 'fraction')).toBeCloseTo(83.5, 5);
    expect(parseRate('', 'percent')).toBeNull();
    expect(parseRate('abc', 'percent')).toBeNull();
    expect(parseRate(null, 'percent')).toBeNull();
  });
  it('normalizeRow reads rate columns only when configured; bad value never invalidates the row', () => {
    const row: Record<string, unknown> = {
      [HEADER_COLUMNS.productionDate]: '2026-11-03 00:00:00', [HEADER_COLUMNS.machineNo]: '7', [HEADER_COLUMNS.shift]: 'S1',
      [HEADER_COLUMNS.outputPlan]: 100, [HEADER_COLUMNS.outputActual]: 90, rate_oee: '80', rate_av: 'oops', rate_pf: 0.9,
    };
    const base = normalizeRow(row, cfg)!;
    expect([base.oee, base.availability, base.performance]).toEqual([null, null, null]);
    const withRates = normalizeRow(row, { ...cfg, rates: { oee: 'rate_oee', availability: 'rate_av', performance: 'rate_pf' } })!;
    expect([withRates.oee, withRates.availability, withRates.performance]).toEqual([80, null, 0.9]);
    expect(normalizeRow(row, { ...cfg, rates: { oee: null, availability: null, performance: 'rate_pf' }, rateScale: 'fraction' })!.performance).toBeCloseTo(90, 5);
  });
  it('aggregateRate: planned-minutes weighted mean, plain mean without weights, unavailable when empty', () => {
    expect(aggregateRate([{ value: 80, weight: 480 }, { value: 60, weight: 240 }], 'OEE').value).toBeCloseTo(73.33, 2);
    expect(aggregateRate([{ value: 80, weight: null }, { value: 60, weight: 0 }], 'OEE').value).toBe(70);
    expect(aggregateRate([{ value: null, weight: 480 }], 'OEE')).toEqual({ value: null, reason: 'OEE dari ConMas belum tersedia' });
  });
  it('utilization + machine list + machine detail expose the ConMas values', () => {
    const { resolve } = categoryResolver([]);
    const rs = [rec({ machineNo: '1', oee: 80, availability: 90, performance: 95 }), rec({ machineNo: '2', oee: 60, availability: 70, performance: 85 })];
    const u = buildUtilization(rs, null, range, DEFAULT_SETTINGS, resolve);
    expect(u.totals.oee.value).toBe(70);
    expect(u.totals.availability.value).toBe(80);
    expect(u.machines.find((m) => m.machineNo === '2')!.performance.value).toBe(85);
    expect(buildUtilization([rec()], null, range, DEFAULT_SETTINGS, resolve).totals.oee.value).toBeNull();
    const l = buildMachineList(rs, ['1', '2'], '2026-11-03', { prev: null, next: null }, resolve);
    expect(l.machines.find((m) => m.machineNo === '1')!.oee.value).toBe(80);
    const d = buildMachineDetail('1', '2026-11-03', rs, { prev: null, next: null }, resolve, DEFAULT_SETTINGS);
    expect(d.totals.oee.value).toBe(80);
  });
});

describe('hourly output = sum of the five QTY PCS slots per hour block (approved)', () => {
  it('sums slots per block, skips blocks without qty, keeps plan null', () => {
    const r = rec({ slots: [slot(0, 10), slot(0, 15), slot(0, null), slot(1, null), slot(2, 40)] });
    const h = hourlyOutput([r], [6, 14, 22]);
    expect(h).toEqual({ available: true, hours: [{ hour: 6, plan: null, actual: 25 }, { hour: 8, plan: null, actual: 40 }] });
  });
  it('orders hours from the start of shift 1 (night hours last) and falls back to shift start + block', () => {
    const r1 = rec({ shift: '1', slots: [slot(0, 5)] });
    const r3 = rec({ shift: '3', slots: [slot(0, 7, null), slot(3, 9, 1)] });
    const h = hourlyOutput([r3, r1], [6, 14, 22]);
    expect(h.available && h.hours.map((x) => x.hour)).toEqual([6, 22, 1]);
  });
  it('unavailable (with reason) when no slot has qty', () => {
    expect(hourlyOutput([rec({ slots: [slot(0, null)] })], [6, 14, 22]).available).toBe(false);
    expect(hourlyOutput([], [6, 14, 22]).available).toBe(false);
  });
  it('machine detail wires it in', () => {
    const { resolve } = categoryResolver([]);
    const d = buildMachineDetail('1', '2026-11-03', [rec({ slots: [slot(0, 12)] })], { prev: null, next: null }, resolve, DEFAULT_SETTINGS);
    expect(d.hourly).toEqual({ available: true, hours: [{ hour: 6, plan: null, actual: 12 }] });
  });
});

describe('shift hours are editable in Settings (owner 2026-11-17)', () => {
  const resolve = categoryResolver([]).resolve;
  it('machine detail labels and stop ordering follow settings.shifts', () => {
    const s = { ...DEFAULT_SETTINGS, shifts: { s1: 7, s2: 15, s3: 23 } };
    const d = buildMachineDetail('1', '2026-11-03', [rec()], { prev: null, next: null }, resolve, s);
    expect(d.shifts.map((x) => x.time)).toEqual(['07:00–15:00', '15:00–23:00', '23:00–07:00']);
  });
  it('production day rolls over at the shift 1 start', () => {
    expect(currentProductionDate(new Date('2026-11-09T06:30:00+07:00'), 420, 7)).toBe('2026-11-08');
    expect(currentProductionDate(new Date('2026-11-09T07:00:00+07:00'), 420, 7)).toBe('2026-11-09');
  });
  it('validation: distinct and clockwise', () => {
    const ok = (shifts: { s1: number; s2: number; s3: number }) => SettingsBodySchema.safeParse({ ...DEFAULT_SETTINGS, shifts }).success;
    expect(ok({ s1: 6, s2: 14, s3: 22 })).toBe(true);
    expect(ok({ s1: 7, s2: 15, s3: 23 })).toBe(true);
    expect(ok({ s1: 22, s2: 6, s3: 14 })).toBe(true);
    expect(ok({ s1: 6, s2: 6, s3: 22 })).toBe(false);
    expect(ok({ s1: 6, s2: 22, s3: 14 })).toBe(false);
    expect(ok({ s1: 6, s2: 14, s3: 24 })).toBe(false);
  });
  it('restore-test cadence defaults to weekly and is bounded', () => {
    expect(DEFAULT_SETTINGS.backup.restoreTestDays).toBe(7);
    expect(SettingsBodySchema.safeParse({ ...DEFAULT_SETTINGS, backup: { restoreTestDays: 0 } }).success).toBe(false);
    expect(SettingsBodySchema.safeParse({ ...DEFAULT_SETTINGS, backup: { restoreTestDays: 14 } }).success).toBe(true);
  });
});

import type pg from 'pg';
import { createPgRepos } from '../src/db/repos.js';
describe('session csrf_token dari kolom char(64)', () => {
  it('membuang spasi pengisi sehingga cocok dengan header X-CSRF-Token', async () => {
    const token = 'abcDEF_-0123456789abcDEF_-0123456789abcDEF_-';
    const fake = { query: () => Promise.resolve({ rows: [{ id_hash: 'h', user_id: 'u', csrf_token: token.padEnd(64, ' '), last_seen_at: new Date(), absolute_expires_at: new Date(), revoked_at: null }] }) } as unknown as pg.Pool;
    const s = await createPgRepos(fake).sessions.get('h');
    expect(s?.csrfToken).toBe(token);
  });
});

describe('Sales & Scrap formulas (Q-009)', () => {
  it('Sales = good qty x Harga/PCS, tanpa pembulatan, null tidak jadi 0', () => {
    expect(salesValue(1065, 364.39).value).toBeCloseTo(388075.35, 2);
    expect(salesValue(0, 364.39).value).toBe(0);
    expect(salesValue(null, 364.39)).toMatchObject({ value: null });
    expect(salesValue(100, null)).toMatchObject({ value: null, reason: expect.stringContaining('Harga/PCS') as string });
    expect(salesValue(-1, 10).value).toBeNull();
  });
  it('Scrap kg dari gram ConMas, scrap value = gram x harga per gram', () => {
    expect(scrapKg(1172).value).toBeCloseTo(1.172, 6);
    expect(scrapKg(null).value).toBeNull();
    expect(scrapValue(1172, 0.05).value).toBeCloseTo(58.6, 6);
    expect(scrapValue(1172, null).value).toBeNull();
    expect(scrapValue(null, 0.05).value).toBeNull();
  });
  it('Scrap ratio = scrap value / sales value x 100; sales 0 atau data kosong -> tidak tersedia', () => {
    expect(scrapRatio(58.6, 388075.35).value).toBeCloseTo(0.0151, 3);
    expect(scrapRatio(10, 0).value).toBeNull();
    expect(scrapRatio(null, 100).value).toBeNull();
    expect(scrapRatio(0, 100).value).toBe(0);
  });
});

describe('buildSales', () => {
  const range = { from: '2026-11-03', to: '2026-11-04', shift: null, days: 2 };
  const prices = new Map<string, number | null>([['DP1', 10], ['DP2', null]]);
  it('Sales = actual x harga; part tanpa harga dilaporkan di uncoveredQty, bukan 0', () => {
    const v = buildSales([
      rec({ dpNo: 'dp1 ', actual: 100, date: '2026-11-03' }),
      rec({ dpNo: 'DP1', actual: 50, date: '2026-11-04', machineNo: '2' }),
      rec({ dpNo: 'DP2', actual: 30, date: '2026-11-04', machineNo: '3' }),
    ], prices, range);
    expect(v.total.value).toBe(1500);
    expect(v.goodQty).toBe(180);
    expect(v.coveredQty).toBe(150);
    expect(v.uncoveredQty).toBe(30);
    expect(v.averagePrice.value).toBe(10);
    expect(v.byDay.map((d) => [d.key, d.sales, d.uncoveredQty])).toEqual([['2026-11-03', 1000, 0], ['2026-11-04', 500, 30]]);
    expect(v.byMonth).toHaveLength(1);
    expect(v.byPart[0]).toMatchObject({ pricePerPcs: 10, goodQty: 150 });
    expect(v.byPart.find((p) => p.dpNo === 'DP2')?.sales.value).toBeNull();
  });
  it('tanpa harga sama sekali: total tidak tersedia, bukan 0', () => {
    const v = buildSales([rec({ dpNo: 'DP2', actual: 30 })], prices, range);
    expect(v.total.value).toBeNull();
    expect(v.uncoveredQty).toBe(30);
  });
});
