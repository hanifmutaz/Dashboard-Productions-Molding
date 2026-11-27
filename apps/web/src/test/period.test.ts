import { describe, expect, it } from 'vitest';
import { monthRange, weekRange } from '../lib/period';

describe('weekRange / monthRange (kolom perbandingan periode)', () => {
  const today = '2026-11-28'; // Sabtu
  it('minggu ini dipotong sampai hari produksi ini, minggu sebelumnya penuh Senin–Minggu', () => {
    expect(weekRange(0, today)).toEqual({ from: '2026-11-23', to: '2026-11-28' });
    expect(weekRange(1, today)).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(weekRange(2, today)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
  });
  it('bulan ini dipotong sampai hari ini, bulan lalu dan sebelumnya penuh', () => {
    expect(monthRange(0, today)).toEqual({ from: '2026-11-01', to: '2026-11-28' });
    expect(monthRange(1, today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange(2, today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
  it('lintas tahun', () => {
    expect(monthRange(1, '2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(monthRange(2, '2027-01-15')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
});
