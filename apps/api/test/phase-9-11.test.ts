import { describe, expect, it } from 'vitest';
import { priceLookup, uniformPrice } from '../src/modules/metrics/historicalPricing.js';
import { compareSchedule, qualityNotices, scheduleNotices } from '../src/modules/metrics/dataQuality.js';
import { buildSales, buildScrap } from '../src/modules/metrics/views.js';
import type { SourceRecord } from '../src/modules/conmas/source.js';

const record = (date: string, extra: Partial<SourceRecord> = {}): SourceRecord => ({
  recordId: date, date, machineNo: '1', shift: '1', group: null, cavity: null,
  plan: 100, actual: 100, gross: 100, ngQty: 0, ngGram: 20, dpNo: 'dp1', productName: 'P1', poNo: null,
  ctActual: null, plannedMinutes: 480, oee: null, availability: null, performance: null,
  personnel: { leader: null, cell: null, technician: null, operator: null }, updatedAt: null, slots: [], ...extra,
});
const range = { from: '2026-11-01', to: '2026-11-03', shift: null, days: 3 };
const history = priceLookup([
  { entity_type: 'part', entity_key: 'DP1', effective_date: '2026-11-02', new_price: '10' },
  { entity_type: 'material', entity_key: 'M1', effective_date: '2026-11-02', new_price: '2' },
  { entity_type: 'part', entity_key: 'dp1', effective_date: '2026-11-03', new_price: '15' },
  { entity_type: 'part', entity_key: 'DP1', effective_date: '2026-11-03', new_price: '20' },
  { entity_type: 'material', entity_key: 'M1', effective_date: '2026-11-03', new_price: '3' },
  { entity_type: 'part', entity_key: 'DP1', effective_date: '2026-11-04', new_price: null },
]);

describe('Phase 9: historical valuation', () => {
  it('uses latest same-day event, does not backdate or replace an explicit null', () => {
    expect(history('part', ' dp1 ', '2026-11-01')).toBeNull();
    expect(history('part', 'dp1', '2026-11-02')).toBe(10);
    expect(history('part', 'dp1', '2026-11-03')).toBe(20);
    expect(history('part', 'dp1', '2026-11-04')).toBeNull();
    expect(uniformPrice([10, 20])).toBeNull();
  });
  it('Sales sums historical row values, not latest price times the whole period', () => {
    const v = buildSales([record('2026-11-01'), record('2026-11-02'), record('2026-11-03')], new Map([['DP1', 999]]), range, history);
    expect(v.total.value).toBe(3000);
    expect(v.uncoveredQty).toBe(100);
    expect(v.byPart[0]?.pricePerPcs).toBeNull();
    expect(v.byPart[0]?.sales.value).toBe(3000);
  });
  it('Scrap totals and part totals reconcile using historical gram and part prices', () => {
    const v = buildScrap([record('2026-11-01'), record('2026-11-02'), record('2026-11-03')], new Map([['DP1', { materialCode: 'M1', pricePerPcs: 999 }]]), new Map([['M1', { name: 'Resin', pricePerGram: 999 }]]), range, history);
    expect(v.scrapValue.value).toBe(100);
    expect(v.unvaluedGram).toBe(20);
    expect(v.byPart[0]?.sales.value).toBe(3000);
    expect(v.byMaterial[0]?.pricePerGram).toBeNull();
    expect(v.ratio.value).toBeCloseTo(100 / 3000 * 100);
  });
});

describe('Phase 10: calendar comparison', () => {
  it('does not count unknown dates or missing planned minutes as zero', () => {
    const records = [record('2026-11-01'), record('2026-11-02'), record('2026-11-03', { plannedMinutes: null })];
    const days = [{ work_date: '2026-11-02', day_type: 'holiday' as const, planned_minutes: null }, { work_date: '2026-11-03', day_type: 'working' as const, planned_minutes: 480 }];
    expect(compareSchedule(records, days)).toEqual({ observedMachineDays: 3, coveredMachineDays: 2, comparableMachineDays: 1, scheduledMinutes: 0, sourcePlannedMinutes: 480, holidayRecordDays: 1 });
    expect(scheduleNotices(records, days, '1')[0]?.code).toBe('CALENDAR_SHIFT');
  });
  it('adds multiple shifts only once to each machine-day schedule', () => {
    const records = [record('2026-11-01'), record('2026-11-01', { shift: '2' })];
    const s = compareSchedule(records, [{ work_date: '2026-11-01', day_type: 'overtime', planned_minutes: 960 }]);
    expect(s.scheduledMinutes).toBe(960);
    expect(s.sourcePlannedMinutes).toBe(960);
  });
});

describe('Phase 11: source data quality', () => {
  it('surfaces duplicate, missing and negative counts without changing quantities', () => {
    const rows = [record('2026-11-01', { actual: null }), record('2026-11-02', { plan: -1 })];
    expect(qualityNotices(rows, 3).map(n => n.code)).toEqual(['DUPLICATE_ROWS', 'MISSING_OUTPUT', 'NEGATIVE_VALUES']);
    expect(rows[1]?.plan).toBe(-1);
  });
});
