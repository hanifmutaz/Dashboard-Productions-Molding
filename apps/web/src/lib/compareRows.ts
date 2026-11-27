import type { Metric, ProductionView, SalesView, ScrapView, Settings, StopTimeView, UtilizationView } from '@mpd/contracts';
import { cls, type TargetKey } from './status';
import { f1, fmt, fmtPrice, kf } from './format';

/** Satu sel di tabel perbandingan periode. Tampilan saja: semua angka sudah dihitung backend (ADR-003). */
export interface CompareCell { text: string; tone?: 'lo' | 'mid' | 'ok'; title?: string }
export interface CompareRow<T> { label: string; cell: (v: T, s: Settings) => CompareCell }

const dash = (title?: string | null): CompareCell => ({ text: '—', ...(title ? { title } : {}) });
const pct = (m: Metric, k: TargetKey, s: Settings): CompareCell => {
  if (m.value === null) return dash(m.reason);
  const c = cls(m.value, k, s);
  return { text: f1(m.value) + '%', ...(c ? { tone: c } : {}) };
};
const plain = (m: Metric, f: (n: number) => string, unit = ''): CompareCell => (m.value === null ? dash(m.reason) : { text: f(m.value) + unit });

export const productionRows: CompareRow<ProductionView>[] = [
  { label: 'Production plan (pcs)', cell: (v) => (v.totals.planReported === false ? dash() : { text: fmt(v.totals.plan) }) },
  { label: 'Production actual (pcs)', cell: (v) => (v.totals.actualReported === false ? dash() : { text: fmt(v.totals.actual) }) },
  { label: 'Bekidoritsu', cell: (v, s) => pct(v.totals.bekidoritsu, 'beki', s) },
  { label: 'Deviation (pcs)', cell: (v) => (v.totals.planReported === false || v.totals.actualReported === false ? dash() : { text: (v.totals.deviation < 0 ? '−' : '+') + fmt(Math.abs(v.totals.deviation)), tone: v.totals.deviation < 0 ? 'lo' : 'ok' }) },
];

export const utilizationRows: CompareRow<UtilizationView>[] = [
  { label: 'OEE', cell: (v, s) => pct(v.totals.oee, 'oee', s) },
  { label: 'Availability', cell: (v, s) => pct(v.totals.availability, 'avail', s) },
  { label: 'Performance', cell: (v, s) => pct(v.totals.performance, 'perf', s) },
  { label: 'Quality', cell: (v, s) => pct(v.totals.quality, 'qual', s) },
  { label: 'Kikai Kadouritsu', cell: (v, s) => pct(v.totals.kikai, 'kikai', s) },
  { label: 'Sogo Kadouritsu', cell: (v, s) => pct(v.totals.sogo, 'sogo', s) },
  { label: 'Shugyo Kadouritsu', cell: (v, s) => pct(v.totals.shugyo, 'shugyo', s) },
];

export const stopRows: CompareRow<StopTimeView>[] = [
  { label: 'Total stop time (min)', cell: (v) => ({ text: fmt(v.totals.minutes) }) },
  { label: 'Stop events', cell: (v) => ({ text: fmt(v.totals.events) }) },
  { label: 'Active categories', cell: (v) => ({ text: String(v.totals.activeCategories) }) },
  { label: 'Active details', cell: (v) => ({ text: String(v.totals.activeDetails) }) },
  { label: 'Info-only stops (min)', cell: (v) => ({ text: fmt(v.totals.infoMinutes) }) },
];

export const salesRows: CompareRow<SalesView>[] = [
  { label: 'Sales (Rp)', cell: (v) => plain(v.total, kf) },
  { label: 'Production actual (pcs)', cell: (v) => ({ text: fmt(v.goodQty), ...(v.uncoveredQty > 0 ? { title: `${fmt(v.uncoveredQty)} pcs belum berharga` } : {}) }) },
  { label: 'Average price (Rp/pcs)', cell: (v) => plain(v.averagePrice, (n) => fmtPrice(Math.round(n * 100) / 100)) },
];

export const scrapRows: CompareRow<ScrapView>[] = [
  { label: 'Scrap value (Rp)', cell: (v) => plain(v.scrapValue, kf) },
  { label: 'Scrap weight (kg)', cell: (v) => plain(v.scrapKg, (n) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })) },
  { label: 'Scrap ratio', cell: (v) => plain(v.ratio, (n) => n.toFixed(2), '%') },
];
