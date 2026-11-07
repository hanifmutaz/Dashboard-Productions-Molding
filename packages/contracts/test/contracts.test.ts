import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_SETTINGS, PERMISSIONS, RangeQuerySchema, SettingsBodySchema, isSubset, metric } from '../src/index.js';

describe('contracts', () => {
  it('metric never turns null into 0', () => {
    expect(metric(null)).toEqual({ value: null, reason: 'Nilai tidak tersedia' });
    expect(metric(Number.NaN, 'x').value).toBeNull();
    expect(metric(0).value).toBe(0);
  });
  it('default settings are valid and freshness follows FINAL 15/60', () => {
    expect(SettingsBodySchema.parse(DEFAULT_SETTINGS).data).toMatchObject({ stale: 15, unavailable: 60 });
  });
  it('rejects unavailable threshold not above stale threshold', () => {
    expect(SettingsBodySchema.safeParse({ ...DEFAULT_SETTINGS, data: { stale: 30, unavailable: 30, refresh: 5 } }).success).toBe(false);
  });
  it('range query rejects inverted and oversized ranges', () => {
    expect(RangeQuerySchema.safeParse({ from: '2026-11-05', to: '2026-11-01' }).success).toBe(false);
    expect(RangeQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(false);
    expect(RangeQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-07', shift: '3' }).success).toBe(true);
  });
  it('default matrix: only super admin edits settings, manages roles and views audit', () => {
    for (const p of [PERMISSIONS.editSettings, PERMISSIONS.manageRoles, PERMISSIONS.viewAudit]) {
      expect(DEFAULT_ROLE_PERMISSIONS.admin).not.toContain(p);
      expect(DEFAULT_ROLE_PERMISSIONS.user).not.toContain(p);
    }
    expect(DEFAULT_ROLE_PERMISSIONS.user).not.toContain(PERMISSIONS.viewSales);
    expect(isSubset(DEFAULT_ROLE_PERMISSIONS.admin, DEFAULT_ROLE_PERMISSIONS.superAdmin)).toBe(true);
  });
});
