import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { ViewDataEnvelope } from '@mpd/contracts';
import { api, qs } from '../lib/api';
import { useFilters } from '../lib/filters';
import { lbl } from '../lib/format';
import { monthRange, weekRange } from '../lib/period';
import { useSession } from '../lib/session';
import type { CompareRow } from '../lib/compareRows';

type Kind = 'w' | 'm';
interface Col { kind: Kind; offset: number }
const FIXED: Col[] = [{ kind: 'w', offset: 0 }, { kind: 'w', offset: 1 }, { kind: 'm', offset: 0 }, { kind: 'm', offset: 1 }];
const MAX_OFFSET = 12;
const STORE = 'mpd.compare.extra';
const same = (a: Col, b: Col) => a.kind === b.kind && a.offset === b.offset;
const name = (c: Col) => c.kind === 'w'
  ? (c.offset === 0 ? 'Minggu ini' : c.offset === 1 ? 'Minggu lalu' : `${c.offset} minggu lalu`)
  : (c.offset === 0 ? 'Bulan ini' : c.offset === 1 ? 'Bulan lalu' : `${c.offset} bulan lalu`);

function isExtraCol(c: unknown): c is Col {
  if (typeof c !== 'object' || c === null) return false;
  const { kind, offset } = c as Partial<Col>;
  return (kind === 'w' || kind === 'm') && typeof offset === 'number' && Number.isInteger(offset) && offset >= 2 && offset <= MAX_OFFSET && !FIXED.some((f) => f.kind === kind && f.offset === offset);
}
function loadExtra(): Col[] {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(STORE) ?? '[]');
    return Array.isArray(raw) ? (raw as unknown[]).filter(isExtraCol) : [];
  } catch { return []; }
}
function saveExtra(cols: Col[]) {
  try { globalThis.localStorage?.setItem(STORE, JSON.stringify(cols)); } catch { /* storage tidak tersedia: pilihan hanya berlaku di sesi ini */ }
}

/** Tabel KPI per periode: minggu ini/lalu, bulan ini/lalu, plus kolom pilihan user ("N minggu/bulan lalu").
 * Memakai endpoint monitoring yang sama dengan halaman (shift & pencarian mengikuti filter), satu query per kolom. */
export function PeriodCompare<T>({ path, rows, extra = {} }: { path: string; rows: CompareRow<T>[]; extra?: Record<string, string | undefined> }) {
  const { f, today } = useFilters();
  const { settings: s } = useSession();
  const [custom, setCustom] = useState<Col[]>(loadExtra);
  const cols = [...FIXED, ...custom];
  const rangeOf = (c: Col) => (c.kind === 'w' ? weekRange(c.offset, today) : monthRange(c.offset, today));
  const results = useQueries({
    queries: cols.map((c) => {
      const r = rangeOf(c);
      const params = qs({ from: r.from, to: r.to, shift: f.shift, q: path === 'sales' || path === 'scrap' ? undefined : f.q, ...extra, noPrevious: 'true' });
      return {
        queryKey: ['monitoring-compare', path, params],
        queryFn: ({ signal }: { signal: AbortSignal }) => api.get<ViewDataEnvelope<T>>(`/api/v1/monitoring/${path}?${params}`, signal),
        staleTime: 60_000,
        refetchInterval: s.data.refresh * 60_000,
      };
    }),
  });
  const update = (next: Col[]) => { setCustom(next); saveExtra(next); };
  const options: Col[] = [];
  for (let n = 2; n <= 8; n++) options.push({ kind: 'w', offset: n });
  for (let n = 2; n <= 6; n++) options.push({ kind: 'm', offset: n });
  const available = options.filter((o) => !custom.some((c) => same(c, o)));

  return (
    <div className="card pcmp">
      <div className="ch">
        <div><h3>Perbandingan periode</h3><p>Minggu = Senin–Minggu · periode berjalan dihitung sampai hari produksi ini · mengikuti filter shift{path === 'sales' || path === 'scrap' ? '' : ' & pencarian'}</p></div>
        <label className="pcmp-add">Tambah periode
          <select value="" disabled={!available.length} onChange={(e) => {
            const [kind, offset] = e.target.value.split(':');
            if (kind === 'w' || kind === 'm') update([...custom, { kind, offset: Number(offset) }]);
          }}>
            <option value="">Pilih…</option>
            {available.map((o) => <option key={`${o.kind}:${o.offset}`} value={`${o.kind}:${o.offset}`}>{name(o)}</option>)}
          </select>
        </label>
      </div>
      <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
        <div className="tw st1">
          <table>
            <thead>
              <tr>
                <th>KPI</th>
                {cols.map((c) => {
                  const r = rangeOf(c), isCustom = custom.some((x) => same(x, c));
                  return (
                    <th key={`${c.kind}${c.offset}`} className="n">
                      {name(c)}
                      {isCustom && <button type="button" className="pcmp-x" aria-label={`Hapus kolom ${name(c)}`} onClick={() => update(custom.filter((x) => !same(x, c)))}>×</button>}
                      <br /><span className="fa" style={{ fontWeight: 'var(--c-font-weight-500)' }}>{lbl(r.from)} – {lbl(r.to)}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {results.map((q, i) => {
                    const v = q.data?.data ?? null;
                    if (q.isPending) return <td key={i} className="n fa">…</td>;
                    if (q.isError || !v) return <td key={i} className="n fa" title={q.isError ? 'Gagal memuat periode ini' : 'Belum ada data pada periode ini'}>—</td>;
                    const c = row.cell(v, s);
                    return <td key={i} className="n" title={c.title}><span className={c.tone ? `pct ${c.tone}` : undefined}>{c.tone === 'lo' ? '▼ ' : c.tone === 'mid' ? '▽ ' : ''}{c.text}</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
