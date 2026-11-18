import { z } from 'zod';

const pct = z.number().min(0).max(100);
const hour = z.number().int().min(0).max(23);
export const TargetsSchema = z.object({ beki: pct, oee: pct, avail: pct, perf: pct, qual: pct, kikai: pct, sogo: pct, shugyo: pct });
export const SettingsBodySchema = z
  .object({
    tgt: TargetsSchema,
    band: z.number().int().min(1).max(50),
    prob: z.object({ oee: pct, beki: pct }),
    cal: z.object({ day: z.number().int().positive(), shift: z.number().int().positive() }),
    /** Start hour of each shift (owner 2026-11-17: editable). Must be distinct and in clockwise order s1 -> s2 -> s3. */
    shifts: z
      .object({ s1: hour, s2: hour, s3: hour })
      .refine((s) => new Set([s.s1, s.s2, s.s3]).size === 3, { message: 'Jam mulai ketiga shift harus berbeda' })
      .refine((s) => ((s.s2 - s.s1 + 24) % 24) + ((s.s3 - s.s2 + 24) % 24) + ((s.s1 - s.s3 + 24) % 24) === 24, { message: 'Urutan shift harus searah jarum jam: shift 1 → 2 → 3 → 1' }),
    /** Restore-test cadence in days (owner 2026-11-17: default weekly, adjustable). Used for the reminder text; the app does not run restores. */
    backup: z.object({ restoreTestDays: z.number().int().min(1).max(90) }),
    disp: z.object({ topN: z.number().int().min(3).max(50), pareto: z.number().int().min(50).max(95), info: z.boolean() }),
    md: z.object({
      rot: z.number().int().min(5).max(120),
      photo: z.enum(['s', 'm', 'l']),
      pic: z.boolean(),
      pages: z.array(z.enum(['0', '1', '2'])).min(1),
      loc: z.enum(['en-US', 'id-ID']),
      sort: z.enum(['mc', 'low']),
      autoplay: z.boolean(),
    }),
    kiosk: z.object({ sec: z.number().int().min(5).max(300), pages: z.array(z.enum(['prod', 'util', 'stop', 'sales', 'scrap'])).min(1), theme: z.enum(['dark', 'light', 'keep']) }),
    /** FINAL freshness: <= stale = current, <= unavailable = stale (tertunda), beyond = unavailable. */
    data: z
      .object({ stale: z.number().int().min(5).max(240), unavailable: z.number().int().min(10).max(1440), refresh: z.number().int().min(1).max(60) })
      .refine((d) => d.unavailable > d.stale, { message: 'Batas unavailable harus lebih besar dari batas tertunda', path: ['unavailable'] }),
  })
  .strict();
export type SettingsBody = z.infer<typeof SettingsBodySchema>;
export const SettingsSchema = SettingsBodySchema.and(z.object({ version: z.number().int(), updatedAt: z.string(), updatedBy: z.string().nullable() }));
export type Settings = z.infer<typeof SettingsSchema>;
export const SettingsUpdateSchema = z.object({ version: z.number().int(), settings: SettingsBodySchema });

/** Shift hours default to 06/14/22 but are editable (owner 2026-11-17). */
export const DEFAULT_SETTINGS: SettingsBody = {
  tgt: { beki: 95, oee: 85, avail: 90, perf: 95, qual: 99, kikai: 95, sogo: 70, shugyo: 95 },
  band: 10,
  prob: { oee: 70, beki: 80 },
  cal: { day: 1440, shift: 480 },
  shifts: { s1: 6, s2: 14, s3: 22 },
  backup: { restoreTestDays: 7 },
  disp: { topN: 10, pareto: 80, info: false },
  md: { rot: 12, photo: 'm', pic: false, pages: ['0', '1', '2'], loc: 'en-US', sort: 'mc', autoplay: true },
  kiosk: { sec: 15, pages: ['prod', 'util', 'stop'], theme: 'dark' },
  data: { stale: 15, unavailable: 60, refresh: 5 },
};

export const PreferencesSchema = z.object({
  page: z.enum(['prod', 'util', 'stop', 'sales', 'scrap']),
  period: z.enum(['lw_tw', 'tw', 'lw', 'l7', 'tm', 'lm']),
  shift: z.enum(['', '1', '2', '3']),
  theme: z.enum(['light', 'dark']),
  side: z.enum(['', 'full', 'rail']),
  motion: z.enum(['on', 'off']),
  cols: z.array(z.string()).max(20),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
export const DEFAULT_PREFERENCES: Preferences = { page: 'prod', period: 'lw_tw', shift: '', theme: 'light', side: '', motion: 'on', cols: [] };

/** Shift start hours as an ordered tuple [shift 1, shift 2, shift 3]. */
export const shiftStartsOf = (s: Pick<SettingsBody, 'shifts'>): readonly [number, number, number] => [s.shifts.s1, s.shifts.s2, s.shifts.s3];
