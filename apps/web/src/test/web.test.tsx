import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { DEFAULT_SETTINGS, type Settings } from '@mpd/contracts';
import { m } from '@mpd/test-utils';
import { Pc, cls, delta } from '../lib/status';
import { fmt, f1 } from '../lib/format';
import { presetRange, productionToday } from '../lib/period';
import { csvRows, parseMaterialRow, parseNum, type MatRow, type Row } from '../pages/MasterData';
import { DataTable } from '../components/table';
import { ApiFailure, api, setCsrf } from '../lib/api';

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
    expect(productionToday(new Date('2026-11-09T23:30:00Z'), 7)).toBe('2026-11-09'); // 06:30 WIB, shift 1 now starts at 07:00
    expect(presetRange('l7', '2026-11-09')).toEqual({ from: '2026-11-03', to: '2026-11-09' });
  });
});

describe('CSV preview parser', () => {
  it('handles quotes, semicolons and separators', () => {
    expect(csvRows('No;DP Part\n1;"A;B"\n')).toEqual([['No', 'DP Part'], ['1', 'A;B']]);
    expect(parseNum('Rp 1.250', 'int')).toBe(1250);
    expect(parseNum('364.39', 'int')).toBe(364.39);
    expect(parseNum('621.4', 'int')).toBe(621.4);
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

describe('API client: CSRF token basi', () => {
  it('mengambil token terbaru dari /api/auth/me lalu mengulang sekali', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/auth/me', () => HttpResponse.json({ kind: 'user', csrfToken: 'baru' })),
      http.put('http://localhost/api/save', ({ request }) => {
        calls += 1;
        return request.headers.get('x-csrf-token') === 'baru'
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ error: { code: 'CSRF', message: 'Sesi keamanan formulir tidak valid. Muat ulang halaman.' } }, { status: 403 });
      }),
    );
    setCsrf('lama');
    await expect(api.put('http://localhost/api/save', {})).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});

describe('material CSV without DP Part', () => {
  const csv = '\uFEFFNo,DP Part,Part Name,DP Material,Material Name,Price material/g\r\n'
    + '1,,,077221-0-11 41,DSM PA-M TS250F6D-00001 NATURAL,259580.46\r\n'
    + '4,,,073545-0-33 41,PPS Durafide 1140A6 HF2000 NATURAL,212902.3\r\n'
    + '5,,,073545-0-33 41,PPS Durafide 1140A6 HF2000 NATURAL,212902.3\r\n'
    + '6,,,073545-0-33 41,PPS Durafide 1140A6 HF2000 NATURAL,999\r\n';
  const run = (rows: string[][]) => {
    const acc: Row<MatRow>[] = [];
    rows.forEach((r, i) => acc.push({ ...parseMaterialRow(r, acc, new Map(), new Map()), line: i + 2, raw: r }));
    return acc;
  };
  it('accepts rows with an empty DP Part as material-only, merges identical repeats, flags a conflicting price', () => {
    const all = csvRows(csv);
    expect(all[0]![0]!.replace(/^\uFEFF/, '')).toBe('No');
    const out = run(all.slice(1));
    expect(out[0]).toMatchObject({ status: 'new', value: { dpNo: '', code: '077221-0-11 41', price: 259580.46 } });
    expect(out[1]!.err).toBeUndefined();
    expect(out[2]).toMatchObject({ status: 'unchanged' });
    expect(out[2]!.warn).toMatch(/merged/);
    expect(out[3]!.err).toMatch(/price conflicts with row 3/);
  });
  it('still requires material code/name/price and rejects one DP Part mapped to two materials', () => {
    expect(run([['1', '', '', '', 'x', '10']])[0]!.err).toBe('DP Material is empty');
    expect(run([['1', '', '', 'M1', 'x', '0']])[0]!.err).toBe('invalid Price material/g');
    const two = run([['1', 'DP-1', '', 'M1', 'a', '10'], ['2', 'DP-1', '', 'M2', 'b', '11']]);
    expect(two[1]!.err).toMatch(/already uses M1/);
  });
  it('warns when the price looks like per-kg (>= Rp 10.000 per gram)', () => {
    expect(run([['1', '', '', 'M1', 'a', '259580.46']])[0]!.warn).toMatch(/per-kg/);
    expect(run([['1', '', '', 'M1', 'a', '259.58']])[0]!.warn).toBeUndefined();
  });
});
