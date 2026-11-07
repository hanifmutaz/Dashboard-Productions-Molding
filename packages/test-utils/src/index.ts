import type { Metric, ViewDataEnvelope } from '@mpd/contracts';

/** Test-only builders. This package MUST NOT be imported by production code (guard enforces). */
export const m = (value: number | null, reason = 'test: tidak tersedia'): Metric => (value === null ? { value: null, reason } : { value, reason: null });
export function env<T>(data: T | null, over: Partial<ViewDataEnvelope<T>> = {}): ViewDataEnvelope<T> {
  return { state: data === null ? 'unavailable' : 'current', data, freshness: 'current', sourceUpdatedAt: '2026-11-07T08:00:00+07:00', generatedAt: '2026-11-07T08:05:00+07:00', notices: [], ...over };
}
