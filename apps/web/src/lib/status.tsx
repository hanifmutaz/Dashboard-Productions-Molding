import type { Metric, Settings } from '@mpd/contracts';
import type { ReactNode } from 'react';
import { f1, isNum } from './format';

export type TargetKey = keyof Settings['tgt'];
export type Cls = 'lo' | 'mid' | 'ok' | '';
export const cls = (v: number | null | undefined, k: TargetKey, s: Settings): Cls => {
  if (!isNum(v)) return '';
  const t = s.tgt[k];
  return v < t - s.band ? 'lo' : v < t ? 'mid' : 'ok';
};
export const colOf = (c: Cls) => (c === 'lo' ? 'var(--bad)' : c === 'mid' ? 'var(--warn)' : 'var(--good)');
export const mv = (m: Metric | null | undefined) => (m ? m.value : null);

/** Percentage with status colour + arrow; status is never conveyed by colour alone (▼ marker, NFR-UI). */
export function Pc({ m, k, s, onClick }: { m: Metric; k: TargetKey; s: Settings; onClick?: () => void }) {
  if (m.value === null) return <span className="fa" title={m.reason ?? undefined}>—</span>;
  const c = cls(m.value, k, s);
  return (
    <span
      className={`pct ${c}${onClick ? ' lk' : ''}`}
      {...(onClick ? { role: 'button', tabIndex: 0, onClick: (e) => { e.stopPropagation(); onClick(); }, onKeyDown: (e) => { if (e.key === 'Enter') onClick(); } } : {})}
    >
      {c === 'lo' ? '▼ ' : ''}{f1(m.value)}%
    </span>
  );
}

export function delta(c: number | null | undefined, p: number | null | undefined, good: 'up' | 'down' | 'flat', pt = false): ReactNode {
  if (!isNum(p) || !isNum(c)) return <span className="fa">No earlier data</span>;
  let d: number, txt: string;
  if (pt) { d = c - p; txt = Math.abs(d).toFixed(1) + ' pt'; } else { if (!p) return <span className="fa">—</span>; d = ((c - p) / Math.abs(p)) * 100; txt = Math.abs(d).toFixed(1) + '%'; }
  if (Math.abs(d) < 0.05) return <span className="fa">● no change</span>;
  const ok = good === 'up' ? d > 0 : d < 0;
  return <span className={`dv ${good === 'flat' ? 'neu' : ok ? 'good' : 'bad'}`}>{d > 0 ? '▲' : '▼'} {txt}</span>;
}
