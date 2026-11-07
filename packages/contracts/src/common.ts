import { z } from 'zod';

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD');
export const ShiftSchema = z.enum(['1', '2', '3']);
export type Shift = z.infer<typeof ShiftSchema>;
/** FINAL: shift 1 06-14, 2 14-22, 3 22-06 (counted on the date the shift starts). */
export const SHIFT_START_HOURS = [6, 14, 22] as const;
export const MAX_RANGE_DAYS = 93;

export const RangeQuerySchema = z
  .object({ from: IsoDate, to: IsoDate, shift: ShiftSchema.optional() })
  .refine((q) => q.from <= q.to, { message: 'from harus <= to' })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 864e5 < MAX_RANGE_DAYS, { message: `Rentang maksimal ${MAX_RANGE_DAYS} hari` });
export type RangeQuery = z.infer<typeof RangeQuerySchema>;

export const VersionedSchema = z.object({ version: z.number().int().nonnegative() });

/** Machine filter (status capaian + search) applied server-side so totals stay consistent (ADR-003). */
export const MachineFilterSchema = z.object({ status: z.enum(['attention', 'within', 'unknown']).optional(), q: z.string().trim().max(60).optional() });
export type MachineFilter = z.infer<typeof MachineFilterSchema>;
