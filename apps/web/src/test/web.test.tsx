import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { DEFAULT_SETTINGS, type Settings } from '@mpd/contracts';
import { m } from '@mpd/test-utils';
import { Pc, cls, delta } from '../lib/status';
import { fmt, f1 } from '../lib/format';
import { presetRange, productionToday } from '../lib/period';
import { csvRows, parseNum } from '../pages/MasterData';
import { DataTable } from '../components/table';
import { ApiFailure, api } from '../lib/api';

const S: Settings = { ...DEFAULT_SETTINGS, version: 0, updatedAt: '', updatedBy: null };

describe('display helpers (no business formulas)', () => {
  it('null is shown as —, never 0', () => {
    expect(fmt(null)).toBe('—');
    expect(f1(undefined)).toBe('—');
    render(<Pc m={m(null, 'Plan = 0')} k="beki" s={S} />);
    expect(screen.getByText('—')).toHaveAttribute('title', 'Plan = 0');
  });
  it('status uses target and band; far-below shows ▼ marker (not colour only)', () => {
    expect(cls(96, 'beki', S)).toBe('ok');
    expect(cls(90, 'beki', S)).toBe('mid');
    expect(cls(80, 'beki', S)).toBe('lo');
    render(<Pc m={m(80)} k="beki" s={S} />);
    expect(screen.getByText(/▼ 80.0%/)).toBeInTheDocument();
  });
  it('delta handles missing previous data', () => {
    render(<>{delta(5, null, 'up')}</>);
    expect(screen.getByText('No earlier data')).toBeInTheDocument();
  });
  it('production date: shift 3 after midnight belongs to the start date', () => {
    expect(productionToday(new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-10'); // 06:30 WIB
    expect(productionToday(new Date('2026-11-09T22:30:00Z'))).toBe('2026-11-09'); // 05:30 WIB, shift 3 of 11-09
    expect(presetRange('l7', '2026-11-09')).toEqual({ from: '2026-11-03', to: '2026-11-09' });
  });
});

describe('CSV preview parser', () => {
  it('handles quotes, semicolons and separators', () => {
    expect(csvRows('No;DP Part\n1;"A;B"\n')).toEqual([['No', 'DP Part'], ['1', 'A;B']]);
    expect(parseNum('Rp 1.250', 'int')).toBe(1250);
    expect(parseNum('38,5', 'dec')).toBe(38.5);
    expect(Number.isNaN(parseNum('', 'int'))).toBe(true);
  });
});

describe('DataTable', () => {
  it('sorts by clicked header', () => {
    render(<DataTable rows={[{ id: 'a', v: 2 }, { id: 'b', v: 1 }]} rowKey={(r) => r.id} cols={[{ k: 'id', h: 'Id' }, { k: 'v', h: 'V', n: true }]} sort={{ k: 'v', asc: true }} />);
    const cells = screen.getAllByRole('cell').filter((c) => c.className === '');
    expect(cells.map((c) => c.textContent)).toEqual(['b', 'a']);
  });
});

const server = setupServer(
  http.get('http://localhost/api/forbidden', () => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Anda tidak memiliki akses untuk tindakan ini.', requestId: 'r1' } }, { status: 403 })),
  http.get('http://localhost/api/broken', () => new HttpResponse('<html>', { status: 500 })),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('API client', () => {
  it('maps server errors without exposing internals', async () => {
    await expect(api.get('http://localhost/api/forbidden')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', requestId: 'r1' });
    await expect(api.get('http://localhost/api/broken')).rejects.toBeInstanceOf(ApiFailure);
  });
});
