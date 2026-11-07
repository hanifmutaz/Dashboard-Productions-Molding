import { z } from 'zod';

/** ADR-002 ViewDataEnvelope<T>. Business freshness is NOT TanStack Query staleness. */
export const DataStateSchema = z.enum(['current', 'stale', 'empty', 'unavailable', 'error']);
export type DataState = z.infer<typeof DataStateSchema>;
export const FreshnessSchema = z.enum(['current', 'stale', 'unavailable', 'unknown', 'not-applicable']);
export type Freshness = z.infer<typeof FreshnessSchema>;

export const NoticeSchema = z.object({ code: z.string(), message: z.string() });
export type Notice = z.infer<typeof NoticeSchema>;

export const envelope = <T extends z.ZodType>(data: T) =>
  z.object({
    state: DataStateSchema,
    data: data.nullable(),
    freshness: FreshnessSchema,
    /** ISO timestamp of newest source update included in the result (null = unknown). */
    sourceUpdatedAt: z.string().nullable(),
    /** ISO timestamp when the API produced this response. */
    generatedAt: z.string(),
    notices: z.array(NoticeSchema),
  });
export interface ViewDataEnvelope<T> {
  state: DataState;
  data: T | null;
  freshness: Freshness;
  sourceUpdatedAt: string | null;
  generatedAt: string;
  notices: Notice[];
}

/** A metric value that may be unavailable. null !== 0. */
export const MetricSchema = z.object({ value: z.number().nullable(), reason: z.string().nullable() });
export type Metric = z.infer<typeof MetricSchema>;
export const metric = (value: number | null, reason: string | null = null): Metric =>
  value === null || !Number.isFinite(value) ? { value: null, reason: reason ?? 'Nilai tidak tersedia' } : { value, reason: null };

export const ApiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }) });
export type ApiError = z.infer<typeof ApiErrorSchema>;
