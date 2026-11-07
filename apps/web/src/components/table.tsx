import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';

export interface Col<R> { k: string; h: ReactNode; n?: boolean; cl?: string; nos?: boolean; f?: (r: R) => ReactNode; sv?: (r: R) => number | string | null }
export interface TableProps<R> {
  cols: Col<R>[];
  rows: R[];
  rowKey: (r: R) => string;
  sort?: { k: string; asc: boolean };
  expand?: (r: R) => ReactNode;
  onRowClick?: (r: R) => void;
  pageSize?: number;
  empty?: ReactNode;
  className?: string;
  wrapClass?: string;
  wrapStyle?: CSSProperties;
  footer?: (info: { from: number; to: number; total: number; page: number; pages: number; go: (p: number) => void }) => ReactNode;
}

/** Port of the mockup sortable table: header click sorts, › rows expand in place, optional paging. */
const cellText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

export function DataTable<R>(p: TableProps<R>) {
  const [sort, setSort] = useState(p.sort ?? { k: p.cols[0]?.k ?? '', asc: true });
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const sv = (r: R, k: string) => { const c = p.cols.find((x) => x.k === k); return c?.sv ? c.sv(r) : ((r as Record<string, unknown>)[k] as number | string | null | undefined) ?? null; };
  const sorted = [...p.rows].sort((a, b) => {
    const x = sv(a, sort.k), y = sv(b, sort.k);
    if (typeof x === 'string' || typeof y === 'string') return sort.asc ? String(x ?? '').localeCompare(String(y ?? '')) : String(y ?? '').localeCompare(String(x ?? ''));
    const xx = x ?? -1e18, yy = y ?? -1e18;
    return sort.asc ? xx - yy : yy - xx;
  });
  const ps = p.pageSize, pages = ps ? Math.max(1, Math.ceil(sorted.length / ps)) : 1, pg = Math.min(page, pages - 1);
  const shown = ps ? sorted.slice(pg * ps, pg * ps + ps) : sorted;
  const onHead = (c: Col<R>) => {
    if (c.nos) return;
    setSort((s) => (s.k === c.k ? { k: c.k, asc: !s.asc } : { k: c.k, asc: !c.n }));
    setPage(0);
  };
  const clickable = !!(p.expand ?? p.onRowClick);
  const activate = (r: R) => {
    if (p.expand) { const k = p.rowKey(r); setOpen((o) => (o === k ? null : k)); }
    else p.onRowClick?.(r);
  };
  return (
    <>
      <div className={p.wrapClass ?? 'tw'} style={p.wrapStyle}>
        <table className={p.className}>
          <thead>
            <tr>
              {p.cols.map((c) => (
                <th key={c.k} className={`${c.n ? 'n' : ''}${c.nos ? ' nos' : ''}${sort.k === c.k && !c.nos ? ' s' + (sort.asc ? ' a' : '') : ''}`}
                  aria-sort={c.nos ? undefined : sort.k === c.k ? (sort.asc ? 'ascending' : 'descending') : 'none'}
                  onClick={() => onHead(c)} onKeyDown={(e) => e.key === 'Enter' && onHead(c)} tabIndex={c.nos ? undefined : 0}>
                  {c.h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length ? shown.map((r) => {
              const k = p.rowKey(r), isOpen = open === k;
              return (
                <Fragment key={k}>
                  <tr className={`${clickable ? 'r' : ''}${isOpen ? ' open' : ''}`} tabIndex={clickable ? 0 : undefined} aria-expanded={p.expand ? isOpen : undefined}
                    onClick={clickable ? () => activate(r) : undefined} onKeyDown={clickable ? (e) => e.key === 'Enter' && activate(r) : undefined}>
                    {p.cols.map((c) => <td key={c.k} className={`${c.n ? 'n' : ''}${c.cl ? ' ' + c.cl : ''}`}>{c.f ? c.f(r) : cellText((r as Record<string, unknown>)[c.k])}</td>)}
                  </tr>
                  {isOpen && p.expand && (
                    <tr className="ex"><td colSpan={50}><div className="exin">{p.expand(r)}</div></td></tr>
                  )}
                </Fragment>
              );
            }) : (
              <tr><td colSpan={p.cols.length} className="empty">{p.empty ?? 'No data for this filter'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {ps && p.footer?.({ from: sorted.length ? pg * ps + 1 : 0, to: Math.min(sorted.length, (pg + 1) * ps), total: sorted.length, page: pg, pages, go: setPage })}
    </>
  );
}

export function Pager({ page, pages, go }: { page: number; pages: number; go: (p: number) => void }) {
  const idx = Array.from({ length: pages }, (_, i) => i).filter((i) => i < 2 || i > pages - 3 || Math.abs(i - page) < 2);
  return (
    <span className="pg">
      <button type="button" disabled={!page} onClick={() => go(page - 1)} aria-label="Previous page">‹</button>
      {idx.map((i, j) => (
        <Fragment key={i}>
          {j > 0 && i - idx[j - 1]! > 1 && <span className="fa">…</span>}
          <button type="button" className={i === page ? 'on' : ''} aria-current={i === page ? 'page' : undefined} onClick={() => go(i)}>{i + 1}</button>
        </Fragment>
      ))}
      <button type="button" disabled={page >= pages - 1} onClick={() => go(page + 1)} aria-label="Next page">›</button>
    </span>
  );
}

export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const s = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
