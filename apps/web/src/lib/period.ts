import { add, iso, lbl, lblY, pd } from './format';

export const PRESETS = { lw_tw: 'Last week – this week', tw: 'This week', lw: 'Last week', l7: 'Last 7 days', tm: 'This month', lm: 'Last month' } as const;
export type Preset = keyof typeof PRESETS | 'custom';

/** Production date (shift 3 22:00-06:00 counts on the start date, FINAL), in plant time (UTC+7). */
export function productionToday(now = new Date()): string {
  const local = new Date(now.getTime() + 7 * 3_600_000);
  if (local.getUTCHours() < 6) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}

export function presetRange(p: keyof typeof PRESETS, today = productionToday()): { from: string; to: string } {
  const t = pd(today), mon = add(t, -((t.getUTCDay() + 6) % 7));
  let a: Date, b: Date;
  switch (p) {
    case 'lw_tw': a = add(mon, -7); b = add(mon, 6); break;
    case 'tw': a = mon; b = add(mon, 6); break;
    case 'lw': a = add(mon, -7); b = add(mon, -1); break;
    case 'l7': a = add(t, -6); b = t; break;
    case 'tm': a = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)); b = t; break;
    case 'lm': a = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)); b = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)); break;
  }
  if (iso(b) > today) b = t;
  return { from: iso(a), to: iso(b) };
}
export const rangeTxt = (from: string, to: string) => `${lbl(from)} – ${lblY(to)}`;
