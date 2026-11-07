import type { Freshness, Notice } from '@mpd/contracts';
import type { SourceRecord } from '../conmas/source.js';

/** Production date for "now": shift 3 (22-06) belongs to the date it started (FINAL). */
export function currentProductionDate(now: Date, tzOffsetMinutes = 420): string {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  if (local.getUTCHours() < 6) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}

export interface FreshnessResult { freshness: Freshness; sourceUpdatedAt: string | null; records: SourceRecord[]; notices: Notice[] }

/**
 * FINAL freshness (thresholds from Settings): age <= stale -> current; <= unavailable -> stale (tertunda);
 * beyond -> today's values are unavailable (removed, never shown as zero). Invalid timestamp -> unknown (removed).
 * Historical dates are not subject to freshness ("not-applicable").
 */
export function applyFreshness(records: SourceRecord[], now: Date, th: { stale: number; unavailable: number }, tzOffsetMinutes = 420): FreshnessResult {
  const today = currentProductionDate(now, tzOffsetMinutes);
  const todays = records.filter((r) => r.date === today);
  const newest = records.reduce<string | null>((m, r) => (r.updatedAt && (!m || Date.parse(r.updatedAt) > Date.parse(m)) ? r.updatedAt : m), null);
  if (!todays.length) return { freshness: 'not-applicable', sourceUpdatedAt: newest, records, notices: [] };
  const stamps = todays.map((r) => (r.updatedAt ? Date.parse(r.updatedAt) : NaN));
  if (stamps.some((t) => Number.isNaN(t))) {
    return {
      freshness: 'unknown', sourceUpdatedAt: newest, records: records.filter((r) => r.date !== today),
      notices: [{ code: 'FRESHNESS_UNKNOWN', message: 'Waktu update data hari ini tidak valid; nilai hari ini tidak ditampilkan.' }],
    };
  }
  const ageMin = (now.getTime() - Math.max(...stamps)) / 60_000;
  if (ageMin <= th.stale) return { freshness: 'current', sourceUpdatedAt: newest, records, notices: [] };
  if (ageMin <= th.unavailable)
    return { freshness: 'stale', sourceUpdatedAt: newest, records, notices: [{ code: 'STALE', message: `Data hari ini tertunda ${Math.round(ageMin)} menit (batas ${th.stale} menit).` }] };
  return {
    freshness: 'unavailable', sourceUpdatedAt: newest, records: records.filter((r) => r.date !== today),
    notices: [{ code: 'TOO_OLD', message: `Data hari ini berumur ${Math.round(ageMin)} menit (> ${th.unavailable} menit); nilai hari ini tidak ditampilkan.` }],
  };
}
