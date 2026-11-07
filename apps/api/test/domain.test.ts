import { describe, expect, it } from 'vitest';
import { bekidoritsu, ipr, kikai, quality, shugyo, sogo } from '../src/modules/metrics/formulas.js';
import { applyFreshness, currentProductionDate } from '../src/modules/metrics/freshness.js';
import { normalizeRow, parseHourLabel, selectLatest, toIsoWithOffset, type SourceRecord } from '../src/modules/conmas/source.js';
import { HEADER_COLUMNS, HOUR_BLOCKS } from '../src/modules/conmas/fieldMap.generated.js';
import { buildProduction, eventsOf } from '../src/modules/metrics/views.js';
import { categoryResolver } from '../src/modules/metrics/categories.js';
import { DEFAULT_SETTINGS, type StopCategory } from '@mpd/contracts';

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
    [b0.label]: '15.00-16.00', [b0.slots[0]!.minutes]: '60.0000000000', [b0.slots[0]!.category]: 'Dandori loss(Set up & Adjust ment loss)', [b0.slots[0]!.detail!]: 'Heater up',
    [b0.slots[1]!.category]: 'Informasi', [b0.slots[1]!.detail!]: 'Alarm range aktif',
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
      recordId: mc, date: '2026-11-03', machineNo: mc, shift: '1', group: 'A', cavity: null, plan, actual, gross: null, ngQty: null, dpNo: null, productName: 'P', poNo: null,
      ctActual: null, plannedMinutes: 480, personnel: { leader: null, cell: null, technician: null, operator: null }, updatedAt: null, slots: [],
    });
    const { resolve } = categoryResolver([]);
    const v = buildProduction([r('1', 100, 50), r('2', 0, 0)], null, { from: '2026-11-03', to: '2026-11-03', shift: null, days: 1 }, DEFAULT_SETTINGS, resolve);
    expect(v.totals.bekidoritsu.value).toBe(50);
    expect(v.totals.gross).toBeNull();
    expect(v.machines.find((m) => m.machineNo === '2')!.achievement).toBe('unknown');
    expect(v.machines.find((m) => m.machineNo === '1')!.achievement).toBe('attention');
  });
});
