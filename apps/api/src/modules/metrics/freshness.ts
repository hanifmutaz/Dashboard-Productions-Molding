import type { Freshness, Notice } from '@mpd/contracts';
import type { SourceRecord } from '../conmas/source.js';

/** Production date for "now": shift 3 (22-06) belongs to the date it started (FINAL). */
/** The production day starts at the shift 1 start hour (default 06:00, editable in Settings since 2026-11-17). */
export function currentProductionDate(now: Date, tzOffsetMinutes = 420, dayStartHour = 6): string {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  if (local.getUTCHours() < dayStartHour) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}

export interface FreshnessResult { freshness: Freshness; sourceUpdatedAt: string | null; records: SourceRecord[]; notices: Notice[] }

/**
 * Keep the last successfully read records with valid timestamps even past the unavailable threshold,
 * but mark them stale and explicitly warn they are not real-time. Invalid/future timestamps remain unknown.
 * Historical dates are not subject to freshness ("not-applicable"). A failed source query is still unavailable.
 */
export function applyFreshness(records: SourceRecord[], now: Date, th: { stale: number; unavailable: number }, tzOffsetMinutes = 420, dayStartHour = 6, requestedToday = false): FreshnessResult {
  const today = currentProductionDate(now, tzOffsetMinutes, dayStartHour);
  const todays = records.filter((r) => r.date === today);
  const newest = records.reduce<string | null>((m, r) => (r.updatedAt && Number.isFinite(Date.parse(r.updatedAt)) && Date.parse(r.updatedAt) <= now.getTime() + 5 * 60_000 && (!m || Date.parse(r.updatedAt) > Date.parse(m)) ? r.updatedAt : m), null);
  if (!todays.length) return requestedToday
    ? { freshness: 'unknown', sourceUpdatedAt: newest, records, notices: [{ code: 'NO_TODAY_RECORDS', message: 'Belum ada catatan hari produksi ini untuk cakupan yang dipilih.' }] }
    : { freshness: 'not-applicable', sourceUpdatedAt: newest, records, notices: [] };
  const byMachine = new Map<string, SourceRecord[]>();
  for (const record of todays) {
    const group = byMachine.get(record.machineNo) ?? [];
    group.push(record);
    byMachine.set(record.machineNo, group);
  }
  if (byMachine.size > 1) {
    const summaries = [...byMachine.values()].map((group) => applyFreshness(group, now, th, tzOffsetMinutes, dayStartHour));
    const kept = new Set(summaries.flatMap((summary) => summary.records));
    const issues = summaries.filter((summary) => summary.freshness !== 'current');
    const omitted = todays.length - kept.size;
    const freshness = issues.length === 0 ? 'current' : kept.size ? 'stale'
      : summaries.some((summary) => summary.freshness === 'unknown') ? 'unknown' : 'unavailable';
    const notices = issues.length ? [{ code: 'PARTIAL_FRESHNESS', message: `Data ${issues.length} mesin tertunda atau belum dapat diverifikasi.${omitted ? ` ${omitted} catatan hari ini tidak ditampilkan.` : ''}${summaries.some(x => x.notices.some(n => n.code === 'TOO_OLD')) ? ' Ada rekaman terakhir yang melewati batas unavailable; bukan data real-time.' : ''}` }] : [];
    return { freshness, sourceUpdatedAt: newest, records: records.filter((r) => r.date !== today || kept.has(r)), notices };
  }
  const stamps = todays.map((r) => (r.updatedAt ? Date.parse(r.updatedAt) : NaN));
  if (stamps.some((t) => !Number.isFinite(t) || t > now.getTime() + 5 * 60_000)) {
    return {
      freshness: 'unknown', sourceUpdatedAt: newest, records: records.filter((r) => r.date !== today),
      notices: [{ code: 'FRESHNESS_UNKNOWN', message: 'Waktu update data hari ini tidak valid atau terlalu jauh di masa depan; nilai hari ini tidak ditampilkan.' }],
    };
  }
  const ageMin = (now.getTime() - Math.max(...stamps)) / 60_000;
  if (ageMin <= th.stale) return { freshness: 'current', sourceUpdatedAt: newest, records, notices: [] };
  if (ageMin <= th.unavailable)
    return { freshness: 'stale', sourceUpdatedAt: newest, records, notices: [{ code: 'STALE', message: `Data hari ini tertunda ${Math.round(ageMin)} menit (batas ${th.stale} menit).` }] };
  return {
    freshness: 'stale', sourceUpdatedAt: newest, records,
    notices: [{ code: 'TOO_OLD', message: `Data hari ini berumur ${Math.round(ageMin)} menit (> ${th.unavailable} menit); rekaman terakhir ditampilkan, bukan data real-time.` }],
  };
}
