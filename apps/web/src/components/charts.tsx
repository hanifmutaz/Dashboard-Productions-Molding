import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { f1, fmt, kf } from '../lib/format';
import { useTip, type TipContent } from './ui';

/** Port of the mockup SVG chart engine (no chart library; ADR-026 parity). */
export interface ChartBar { name: string; col?: string; cols?: string[]; vals: (number | null)[] }
export interface ChartOpts {
  labels: string[];
  bars: ChartBar[];
  stack?: boolean;
  line?: { name: string; col: string; vals: (number | null)[]; fmt?: (v: number) => string; axis?: 'right'; max?: number };
  target?: number; targetLbl?: string;
  h?: number; bw?: number; L?: number; rot?: boolean; lw?: number;
  off?: number[]; sel?: number | null; partial?: number | null;
  disabled?: (i: number) => boolean; onClick?: (i: number) => void;
  tipT?: (i: number) => string; tipX?: (i: number) => TipContent['rows'];
  yFmt?: (v: number) => string; vFmt?: (v: number) => string; yTitle?: string; yMax?: number; aria: string;
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const nice = (v: number) => { const p = 10 ** Math.floor(Math.log10(v)), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };

export function Chart(o: ChartOpts) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { show, hide } = useTip();
  const pid = useId().replace(/:/g, '');
  const n = o.labels.length;
  if (!n) return <div className="chw" ref={ref}><div className="empty">No data for this selection</div></div>;
  const W = Math.max(300, width || 900), H = o.h ?? 260, L = o.L ?? 52, R = o.line?.axis === 'right' ? 52 : 14, Tp = 16, B = o.rot ? 74 : 28;
  const tot = (i: number) => (o.stack ? o.bars.reduce((s, b) => s + (b.vals[i] ?? 0), 0) : Math.max(...o.bars.map((b) => b.vals[i] ?? 0)));
  let mx = Math.max(1e-9, ...o.labels.map((_, i) => tot(i)));
  if (o.target != null && o.line?.axis !== 'right') mx = Math.max(mx, o.target);
  mx = o.yMax ?? nice(mx * 1.05);
  const lineVals = (o.line?.vals ?? []).filter((v): v is number => v != null);
  const rMax = o.line?.axis === 'right' ? (o.line.max ?? nice(Math.max(1e-9, ...lineVals) * 1.15)) : 0;
  const bw = (W - L - R) / n;
  const y = (v: number) => H - B - (v / mx) * (H - Tp - B);
  const yr = (v: number) => H - B - (Math.min(rMax, v) / rMax) * (H - Tp - B);
  const yFmt = o.yFmt ?? kf, vFmt = o.vFmt ?? fmt, lFmt = o.line?.fmt ?? f1;
  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - L - R) / (o.rot ? 22 : (o.lw ?? 56))))));
  const grid: ReactNode[] = [], hits: ReactNode[] = [], bars: ReactNode[] = [], pts: [number, number][] = [];
  for (let k = 0; k <= 4; k++) {
    const v = (mx * k) / 4, yy = y(v);
    grid.push(<line key={`g${k}`} className="gl" x1={L} x2={W - R} y1={yy} y2={yy} />, <text key={`t${k}`} x={L - 8} y={yy + 4} textAnchor="end">{yFmt(v)}</text>);
    if (rMax && o.line) grid.push(<text key={`r${k}`} x={W - R + 8} y={H - B - (k / 4) * (H - Tp - B) + 4} style={{ fill: o.line.col }}>{lFmt((rMax * k) / 4)}</text>);
  }
  if (o.yTitle) grid.push(<text key="yt" transform={`translate(12,${(H - B + Tp) / 2}) rotate(-90)`} textAnchor="middle">{o.yTitle}</text>);
  const tipFor = (i: number): TipContent => ({
    title: o.tipT ? o.tipT(i) : (o.labels[i] ?? ''),
    rows: [
      ...o.bars.filter((b) => b.vals[i] != null && !(o.stack && !b.vals[i])).map((b) => ({ label: b.name, value: vFmt(b.vals[i]!), color: b.cols ? b.cols[i] : b.col })),
      ...(o.line && o.line.vals[i] != null ? [{ label: o.line.name, value: lFmt(o.line.vals[i]), color: o.line.col }] : []),
      ...(o.tipX?.(i) ?? []),
    ],
  });
  o.labels.forEach((lb, i) => {
    const x = L + i * bw, dis = o.disabled?.(i) ?? false, click = o.onClick;
    hits.push(
      <rect key={`h${i}`} className={`hit${o.sel === i ? ' sel' : ''}${dis ? ' dis' : ''}`} x={x} y={Tp} width={bw} height={H - Tp - B}
        onPointerMove={(e: PointerEvent) => !dis && show(e, tipFor(i))} onPointerLeave={hide}
        {...(click && !dis ? { onClick: () => click(i), role: 'button', tabIndex: 0, 'aria-label': lb, onKeyDown: (e: KeyboardEvent) => e.key === 'Enter' && click(i) } : {})} />,
    );
    const seg: { x: number; y: number; w: number; h: number; fill: string | undefined; rx?: number }[] = [];
    if (o.stack) {
      const w = Math.min(o.bw ?? 34, bw * 0.62);
      let acc = 0;
      o.bars.forEach((b) => {
        const v = b.vals[i] ?? 0;
        if (!v) return;
        const y0 = y(acc), y1 = y(acc + v);
        seg.push({ x: x + (bw - w) / 2, y: y1, w, h: Math.max(0, y0 - y1), fill: b.cols ? b.cols[i] : b.col });
        acc += v;
      });
    } else {
      const k = o.bars.length, w = Math.min(o.bw ?? 16, (bw * 0.7) / k);
      o.bars.forEach((b, j) => {
        const v = b.vals[i];
        if (v == null) return;
        seg.push({ x: x + (bw - w * k) / 2 + j * w, y: y(v), w: Math.max(1, w - 1), h: H - B - y(v), fill: b.cols ? b.cols[i] : b.col, rx: 1.5 });
      });
    }
    seg.forEach((r, j) => {
      bars.push(<rect key={`b${i}-${j}`} className="b" x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} rx={r.rx} pointerEvents="none" />);
      if (o.partial === i) bars.push(<rect key={`p${i}-${j}`} className="mtd" x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#mtdH-${pid})`} rx={r.rx} pointerEvents="none" />);
    });
    const lv = o.line?.vals[i];
    if (lv != null) pts.push([x + bw / 2, rMax ? yr(lv) : y(lv)]);
    if (i % step === 0) {
      const tx = x + bw / 2, st = o.sel === i ? { fill: 'var(--primary)', fontWeight: 700 } : undefined;
      grid.push(o.rot
        ? <text key={`x${i}`} transform={`translate(${tx},${H - B + 12}) rotate(-35)`} textAnchor="end" style={st}>{lb}</text>
        : <text key={`x${i}`} x={tx} y={H - B + 17} textAnchor="middle" style={st}>{lb}</text>);
    }
  });
  (o.off ?? []).forEach((i) => {
    const x = L + i * bw;
    grid.push(<rect key={`o${i}`} x={x} y={Tp} width={bw} height={H - Tp - B} fill="var(--line-2)" opacity={0.28} pointerEvents="none" />,
      <text key={`ot${i}`} x={x + bw / 2} y={Tp + 11} textAnchor="middle" style={{ fontSize: 'var(--s-size-12)', fill: 'var(--faint)' }} pointerEvents="none">off</text>);
  });
  grid.push(<line key="ax" className="ax" x1={L} x2={W - R} y1={H - B} y2={H - B} />);
  let target: ReactNode = null;
  if (o.target != null) {
    const ty = rMax ? yr(o.target) : y(o.target);
    target = (<g pointerEvents="none"><line x1={L} x2={W - R} y1={ty} y2={ty} style={{ stroke: 'var(--ink)' }} strokeOpacity={0.7} strokeDasharray="5 4" strokeWidth={1.2} />
      <text x={L + 6} y={ty - 6} style={{ fill: 'var(--ink)', fontWeight: 600 }}>{o.targetLbl}</text></g>);
  }
  const line = pts.length && o.line ? (
    <g pointerEvents="none">
      <path className="ln" pathLength={1} d={pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')} fill="none" stroke={o.line.col} strokeWidth={2.2} strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3} fill="var(--surface)" stroke={o.line!.col} strokeWidth={2} />)}
    </g>
  ) : null;
  return (
    <div className="chw" ref={ref}>
      <svg className="ch2" viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label={o.aria}>
        {o.partial != null && (
          <defs><pattern id={`mtdH-${pid}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3.5" height="7" fill="var(--s-on-brand)" fillOpacity=".62" /></pattern></defs>
        )}
        {grid}{hits}{bars}{target}{line}
      </svg>
    </div>
  );
}

/* ---------- bar list & rank list ---------- */
export interface BarItem { k: string; v: number; c?: string; l: ReactNode; vc?: string; sel?: boolean; onClick?: () => void; tip?: TipContent }
export function BarList({ items, max, text, kw, vw, empty = 'No data' }: { items: BarItem[]; max?: number; text?: boolean; kw?: string; vw?: string; empty?: string }) {
  const { show, hide } = useTip();
  const mx = max ?? Math.max(1, ...items.map((x) => x.v));
  if (!items.length) return <div className="empty">{empty}</div>;
  return (
    <>
      {items.map((x, i) => {
        const inner = (
          <>
            <span className={`bk${text ? ' t' : ''}`} title={x.k}>{x.k}</span>
            <span className="bt"><i style={{ width: `${Math.min(100, (x.v / mx) * 100)}%`, background: x.c ?? 'var(--primary)', animationDelay: `${Math.min(0.3, i * 0.02).toFixed(2)}s` }} /></span>
            <span className="bv" style={x.vc ? { color: x.vc } : undefined}>{x.l}</span>
          </>
        );
        const tipProps = x.tip ? { onPointerMove: (e: PointerEvent) => show(e, x.tip!), onPointerLeave: hide } : {};
        const style = { ...(kw ? { '--kw': kw } : {}), ...(vw ? { '--vw': vw } : {}) } as CSSProperties;
        return x.onClick ? (
          <button key={x.k + i} type="button" className={`br${x.sel ? ' sel' : ''}`} aria-pressed={x.sel} onClick={x.onClick} style={style} {...tipProps}>{inner}</button>
        ) : (
          <div key={x.k + i} className={`br${x.sel ? ' sel' : ''}`} style={style} {...tipProps}>{inner}</div>
        );
      })}
    </>
  );
}

export function RankList({ rows, col }: { rows: { key: string; title: string; sub: string; value: ReactNode }[]; col?: string }) {
  if (!rows.length) return <div className="empty">No data</div>;
  return (
    <>
      {rows.map((m, i) => (
        <div key={m.key} style={{ display: 'grid', gridTemplateColumns: 'var(--s-size-18) 1fr auto', gap: 'var(--s-size-8)', alignItems: 'start', padding: 'var(--s-size-6) 0', borderBottom: 'var(--s-size-1) solid var(--line)' }}>
          <span className="mono fa" style={{ fontWeight: 'var(--c-font-weight-700)' }}>{i + 1}</span>
          <span style={{ minWidth: 0 }}>
            <span className="mc">{m.title}</span>
            <div className="fa" style={{ fontSize: 'var(--s-size-12)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.sub}</div>
          </span>
          <b className="mono" style={col ? { color: col } : undefined}>{m.value}</b>
        </div>
      ))}
    </>
  );
}
