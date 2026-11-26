import type { Notice } from '@mpd/contracts';
import type { SourceRecord } from '../conmas/source.js';

export function qualityNotices(records: SourceRecord[], duplicates: number, ambiguousGroups = 0): Notice[] {
  const notices: Notice[] = [];
  if (duplicates > 0) notices.push({ code: 'DUPLICATE_ROWS', message: `${duplicates} baris revisi/duplikat disisihkan oleh aturan satu record per mesin, tanggal dan shift (cakupan sumber sebelum filter). Periksa bila satu shift memiliki beberapa laporan sah.` });
  if (ambiguousGroups) notices.push({ code: 'AMBIGUOUS_REVISIONS', message: `${ambiguousGroups} grup revisi memiliki DP/PO berbeda atau timestamp dan revisi sama dengan ID berbeda. Aturan latest tetap berlaku; verifikasi apakah terdapat laporan sah terpisah.` });
  const missing = records.filter(r => r.plan === null || r.actual === null).length;
  const negative = records.filter(r => [r.plan, r.actual, r.gross, r.ngQty, r.ngGram, r.plannedMinutes].some(v => v !== null && v < 0)).length;
  if (missing) notices.push({ code: 'MISSING_OUTPUT', message: `${missing} record memiliki Plan atau Actual kosong; total mungkin tidak lengkap.` });
  if (negative) notices.push({ code: 'NEGATIVE_VALUES', message: `${negative} record memiliki angka produksi/waktu negatif; verifikasi sumber sebelum memakai KPI.` });
  return notices;
}

export interface CalendarDay { work_date: string; day_type: 'working' | 'holiday' | 'overtime'; planned_minutes: number | null }
export interface ScheduleComparison { observedMachineDays: number; coveredMachineDays: number; comparableMachineDays: number; scheduledMinutes: number; sourcePlannedMinutes: number; holidayRecordDays: number; }
/** Compare full-day planned time only for observed machine-days with a known schedule and known source minutes.
 * This is not a fleet utilization denominator: unobserved machines and unconfigured dates are excluded. */
export function compareSchedule(records: SourceRecord[], days: readonly CalendarDay[]): ScheduleComparison {
  const schedule = new Map(days.map(d => [d.work_date, d]));
  const groups = new Map<string, SourceRecord[]>();
  for (const r of records) {
    const key = JSON.stringify([r.date, r.machineNo]);
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }
  const result: ScheduleComparison = { observedMachineDays: groups.size, coveredMachineDays: 0, comparableMachineDays: 0, scheduledMinutes: 0, sourcePlannedMinutes: 0, holidayRecordDays: 0 };
  for (const group of groups.values()) {
    const day = schedule.get(group[0]!.date);
    if (!day) continue;
    result.coveredMachineDays++;
    if (day.day_type === 'holiday') result.holidayRecordDays++;
    const minutes = day.planned_minutes ?? (day.day_type === 'holiday' ? 0 : null);
    if (minutes === null || !Number.isFinite(minutes) || minutes < 0 || group.some(r => r.plannedMinutes === null || r.plannedMinutes < 0)) continue;
    result.comparableMachineDays++;
    result.scheduledMinutes += minutes;
    result.sourcePlannedMinutes += group.reduce((n, r) => n + (r.plannedMinutes ?? 0), 0);
  }
  return result;
}

export function scheduleNotices(records: SourceRecord[], days: readonly CalendarDay[], shift: string | null): Notice[] {
  if (shift) return [{ code: 'CALENDAR_SHIFT', message: 'Pembanding kalender hanya berlaku untuk semua shift; pembagian jadwal per shift belum ditetapkan.' }];
  const s = compareSchedule(records, days);
  if (!s.observedMachineDays) return [];
  if (!s.comparableMachineDays) return [{ code: 'CALENDAR_MISSING', message: `Kalender belum lengkap: 0 dari ${s.observedMachineDays} hari-mesin dapat dibandingkan.` }];
  const diff = s.sourcePlannedMinutes - s.scheduledMinutes;
  return [{ code: 'CALENDAR_COMPARISON', message: `Jadwal kalender vs planned time ConMas: ${s.scheduledMinutes} vs ${s.sourcePlannedMinutes} menit (selisih ${diff} menit), ${s.comparableMachineDays}/${s.observedMachineDays} hari-mesin yang tercatat. ${s.holidayRecordDays} hari-mesin memiliki catatan pada tanggal libur. Denominator Kadouritsu tidak diubah.` }];
}
