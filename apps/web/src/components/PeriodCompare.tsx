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
/** Mingguan di kiri, bulanan di kanan; di tiap grup urut dari yang terbaru (ini, lalu, 2 lalu, ...). */
const byOrder = (a: Col, b: Col) => (a.kind === b.kind ? a.offset - b.offset : a.kind === 'w' ? -1 : 1);
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
  const cols = [...FIXED, ...custom].sort(byOrder);
  const weekCount = cols.filter((c) => c.kind === 'w').length, monthCount = cols.length - weekCount;
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

  const optionsOf = (kind: Kind) => available.filter((o) => o.kind === kind);
  return (
    <div className="card pcmp">
      <div className="ch">
        <div><h3>Perbandingan periode</h3><p>Minggu = Senin–Minggu · periode berjalan dihitung sampai hari produksi ini · mengikuti filter shift{path === 'sales' || path === 'scrap' ? '' : ' & pencarian'}</p></div>
        <div className="pcmp-tools">
          {custom.length > 0 && <button type="button" className="btn" onClick={() => update([])}>Reset kolom</button>}
          <label className="pcmp-add">
            <span aria-hidden="true">＋</span>
            <select aria-label="Tambah periode pembanding" value="" disabled={!available.length} onChange={(e) => {
              const [kind, offset] = e.target.value.split(':');
              if (kind === 'w' || kind === 'm') update([...custom, { kind, offset: Number(offset) }]);
            }}>
              <option value="">Tambah periode</option>
              {optionsOf('w').length > 0 && <optgroup label="Mingguan">{optionsOf('w').map((o) => <option key={`w:${o.offset}`} value={`w:${o.offset}`}>{name(o)}</option>)}</optgroup>}
              {optionsOf('m').length > 0 && <optgroup label="Bulanan">{optionsOf('m').map((o) => <option key={`m:${o.offset}`} value={`m:${o.offset}`}>{name(o)}</option>)}</optgroup>}
            </select>
          </label>
        </div>
      </div>
      <div className="cb" style={{ padding: 0 }}>
        <div className="pcmp-wrap">
          <table>
            <thead>
              <tr className="pcmp-groups">
                <th rowSpan={2} scope="col" className="pcmp-kpi">KPI</th>
                <th colSpan={weekCount} scope="colgroup" className="pcmp-g">Mingguan</th>
                {monthCount > 0 && <th colSpan={monthCount} scope="colgroup" className="pcmp-g pcmp-split">Bulanan</th>}
              </tr>
              <tr>
                {cols.map((c, i) => {
                  const r = rangeOf(c), isCustom = custom.some((x) => same(x, c));
                  return (
                    <th key={`${c.kind}${c.offset}`} scope="col" className={`n pcmp-col${c.offset === 0 ? ' cur' : ''}${i > 0 && cols[i - 1]!.kind !== c.kind ? ' pcmp-split' : ''}`}>
                      <span className="pcmp-name">{name(c)}{isCustom && <button type="button" className="pcmp-x" aria-label={`Hapus kolom ${name(c)}`} onClick={() => update(custom.filter((x) => !same(x, c)))}>×</button>}</span>
                      <span className="pcmp-range">{lbl(r.from)} – {lbl(r.to)}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className="pcmp-kpi">{row.label}</td>
                  {cols.map((c, i) => {
                    const q = results[i]!, v = q.data?.data ?? null;
                    const k = `pcmp-cell n${c.offset === 0 ? ' cur' : ''}${i > 0 && cols[i - 1]!.kind !== c.kind ? ' pcmp-split' : ''}`;
                    if (q.isPending) return <td key={i} className={`${k} fa`}><span className="skel pcmp-skel" /></td>;
                    if (q.isError || !v) return <td key={i} className={`${k} fa`} title={q.isError ? 'Gagal memuat periode ini' : 'Belum ada data pada periode ini'}>—</td>;
                    const cell = row.cell(v, s);
                    return <td key={i} className={k} title={cell.title}><span className={cell.tone ? `pct ${cell.tone}` : undefined}>{cell.tone === 'lo' ? '▼ ' : cell.tone === 'mid' ? '▽ ' : ''}{cell.text}</span></td>;
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
