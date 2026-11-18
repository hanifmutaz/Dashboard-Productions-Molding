import { metric, type Metric } from '@mpd/contracts';

/* ADR-003: business formulas live only in the backend. Approved by owner 2026-11-07 (6 formulas, from the approved baseline (ADR-026)).
 * Owner 2026-11-17: OEE / Availability / Performance are NOT computed here; they are read from ConMas (see aggregateRate)
 * and hourly output = sum of the five QTY PCS slots per hour block. Sales and Scrap stay unavailable (Q-009). */

export const NOT_APPROVED = 'Rumus belum disetujui (Q-003)';

/** Bekidoritsu = actual / plan * 100 (APPROVED). */
export const bekidoritsu = (actual: number, plan: number): Metric => (plan > 0 ? metric((actual / plan) * 100) : metric(null, 'Plan = 0'));
/** IPR (PPM) = reject / actual * 1,000,000 (APPROVED). */
export const ipr = (reject: number | null, actual: number): Metric =>
  reject === null ? metric(null, 'Qty reject tidak tersedia') : actual > 0 ? metric((reject / actual) * 1e6) : metric(null, 'Actual = 0');
/** Quality = good / gross * 100 (APPROVED). */
export const quality = (good: number, gross: number | null): Metric =>
  gross === null ? metric(null, 'Output gross tidak tersedia') : gross > 0 ? metric((good / gross) * 100) : metric(null, 'Gross = 0');
/** Kikai = (planned - stop) / planned * 100 (APPROVED). */
export const kikai = (planned: number, stop: number): Metric => (planned > 0 ? metric(((planned - stop) / planned) * 100) : metric(null, 'Waktu terencana = 0'));
/** Sogo = (planned - stop) / calendar * 100 (APPROVED). */
export const sogo = (planned: number, stop: number, calendar: number): Metric => (calendar > 0 && planned > 0 ? metric(((planned - stop) / calendar) * 100) : metric(null, 'Waktu kalender/terencana = 0'));
/** Shugyo = planned / calendar * 100 (APPROVED). */
export const shugyo = (planned: number, calendar: number): Metric => (calendar > 0 && planned > 0 ? metric((planned / calendar) * 100) : metric(null, 'Waktu kalender/terencana = 0'));

export const notApproved = (): Metric => metric(null, NOT_APPROVED);

/** Aggregates a ConMas-published rate (percent) over records. Weighted by planned minutes; plain mean when no weights exist.
 * Aggregation weighting is PROPOSED (DEV-018): the per-record values themselves come straight from ConMas. */
export function aggregateRate(items: { value: number | null; weight: number | null }[], label: string): Metric {
  const have = items.filter((i): i is { value: number; weight: number | null } => i.value !== null && Number.isFinite(i.value));
  if (!have.length) return metric(null, `${label} dari ConMas belum tersedia`);
  const w = have.reduce((a, i) => a + (i.weight && i.weight > 0 ? i.weight : 0), 0);
  if (w > 0) return metric(have.reduce((a, i) => a + i.value * (i.weight && i.weight > 0 ? i.weight : 0), 0) / w);
  return metric(have.reduce((a, i) => a + i.value, 0) / have.length);
}

/** Pure aggregation helpers (not business formulas). */
export const sumNullable = (vals: (number | null)[]): number | null => (vals.some((v) => v === null) ? null : vals.reduce<number>((a, b) => a + (b ?? 0), 0));
