import type { KeyboardEvent, ReactNode } from 'react';
import { useSettings } from '../lib/session';
import { cls, colOf, type TargetKey } from '../lib/status';
import { isNum } from '../lib/format';

export interface KpiProps {
  l: ReactNode; v: ReactNode; u?: ReactNode; d?: ReactNode; desc?: ReactNode; chip?: ReactNode; chipC?: string; mk?: string;
  vc?: string; x?: ReactNode; g?: { v: number | null; k: TargetKey }; onClick?: () => void; title?: string;
}
/** Port of mockup kpi(): gauge shows target marker; value colour always accompanied by text (▼/delta). */
export function Kpi(o: KpiProps) {
  const s = useSettings();
  let gauge: ReactNode = null;
  if (o.g) {
    const t = s.tgt[o.g.k], v = isNum(o.g.v) ? o.g.v : 0, c = cls(o.g.v, o.g.k, s);
    const sp = t > 78 ? { right: `${100 - t}%`, transform: `translateX(${t > 96 ? 0 : 4}px)` } : t < 15 ? { left: `${t}%`, transform: 'none' } : { left: `${t}%` };
    gauge = (
      <div className="gauge" title={`Target ${t}%`}>
        <i style={{ width: `${Math.min(100, v)}%`, background: colOf(c) }} />
        <b style={{ left: `${Math.min(99.5, t)}%` }} />
        <s style={sp}>target {t}%</s>
      </div>
    );
  }
  const click = o.onClick;
  return (
    <div className={`kpi${click ? ' click' : ''}`} title={o.title}
      {...(click ? { onClick: click, role: 'button', tabIndex: 0, onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter') click(); } } : {})}>
      <div className="kt">
        <span className="caps">{o.l}{o.mk && <> <span className="fa" title="Data belum disetujui / placeholder">{o.mk}</span></>}</span>
        {click ? <span className="daily">daily ↗</span> : o.chip ? <span className={`chip${o.chipC ? ' ' + o.chipC : ''}`}>{o.chip}</span> : null}
      </div>
      <div className="kv"><b style={o.vc ? { color: o.vc } : undefined}>{o.v}</b><small>{o.u}</small></div>
      {o.desc && <div className="desc">{o.desc}</div>}
      {o.x}
      {gauge}
      <div className="kd">{o.d}</div>
    </div>
  );
}

export function SkelDeck({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div className="kpi" key={i} aria-hidden="true">
          <span className="skel" style={{ width: 'var(--s-size-90)', height: 'var(--s-size-11)' }} />
          <span className="skel" style={{ width: 'var(--s-size-150)', height: 'var(--s-size-30)', marginTop: 'var(--s-size-10)' }} />
          <span className="skel" style={{ width: 'var(--s-size-120)', height: 'var(--s-size-10)', marginTop: 'var(--s-size-18)' }} />
        </div>
      ))}
    </>
  );
}
export function EmptyDeck({ labels, msg }: { labels: string[]; msg: string }) {
  return (
    <>
      {labels.map((l) => (
        <div className="kpi" key={l}><span className="caps">{l}</span><div className="kv"><b className="fa">—</b></div><div className="kd fa">{msg}</div></div>
      ))}
    </>
  );
}
