import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import type { MachineDetailView, Metric, Settings, ViewDataEnvelope } from '@mpd/contracts';
import { api, qs } from '../../lib/api';
import { useReportSource } from '../../lib/filters';
import { shiftStarts } from '../../lib/period';
import { cls, type TargetKey } from '../../lib/status';
import { hh, timeAgo, tokenColor } from '../../lib/format';
import { useWidth } from '../../components/charts';
import { OrganizationName } from '../../components/OrganizationName';
import mdCss from './machine-detail.css?inline';

/* Keep Machine Detail styles inside the Shadow DOM in dashboard and kiosk modes. */

function ShadowHost({ className, source, phw, children }: { className: string; source: string; phw: number; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const sr = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    if (!sr.querySelector('style')) {
      const st = document.createElement('style');
      st.textContent = mdCss;
      sr.appendChild(st);
    }
    setRoot(sr);
  }, []);
  return (
    <div id="mdHost" ref={host} className={className} data-source={source} style={{ ['--photo-width' as string]: phw + 'px' }}>
      {root && createPortal(children, root)}
    </div>
  );
}

const PAGES = ['Ringkasan', 'Shift & Stop', 'Trend & Analisa'];
const ROLE = { leader: 'Leader', cell: 'Cell Leader', technician: 'Teknisi', operator: 'Operator' } as const;

function PersonnelPhoto({ src, name }: { src?: string; name?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="ph" aria-hidden="true">
      {!loaded && (name?.split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join('').toLocaleUpperCase() || '—')}
      {src && !failed && <img src={src} alt="" onLoad={() => setLoaded(true)}
        onError={() => { setFailed(true); setLoaded(false); }} style={{ opacity: loaded ? 1 : 0 }} />}
    </span>
  );
}

interface Props {
  machineNo: string;
  date: string | null;
  settings: Settings;
  ipad: boolean;
  /** Kiosk device: locked to one machine, no machine switch, no back/exit (Q-023 default). */
  locked?: boolean;
  machines?: string[];
  onMachine?: (mc: string) => void;
  onDate: (d: string) => void;
  onBack?: () => void;
  onIpad?: (on: boolean) => void;
}

export function MachineDashboard(p: Props) {
  const s = p.settings;
  const q = useQuery({
    queryKey: ['machine-detail', p.machineNo, p.date],
    queryFn: ({ signal }) => api.get<ViewDataEnvelope<MachineDetailView>>(`/api/v1/machine-detail/${encodeURIComponent(p.machineNo)}?${qs({ date: p.date })}`, signal),
    refetchInterval: s.data.refresh * 60_000,
  });
  useReportSource(q.data, q.isPending, q.isError);
  const env = q.data, x = env?.data ?? null;
  const loc = s.md.loc;
  const idn = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString(loc));
  const dec = (n: number | null | undefined) => (n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const enabled = s.md.pages.map(Number);
  const [pg, setPg] = useState(enabled[0] ?? 0);
  const [play, setPlay] = useState(p.ipad && s.md.autoplay);
  const [rem, setRem] = useState(s.md.rot);
  const deadline = useRef(0);
  useEffect(() => setPlay(p.ipad && s.md.autoplay), [p.ipad, s.md.autoplay]);
  const go = (i: number) => {
    setPg((i + 3) % 3);
    deadline.current = Date.now() + s.md.rot * 1000;
    setRem(s.md.rot);
  };
  const next = () => { for (let k = 1; k <= 3; k++) { const j = (pg + k) % 3; if (enabled.includes(j)) return go(j); } };
  useEffect(() => {
    if (!play) return;
    deadline.current = Date.now() + s.md.rot * 1000;
    const iv = setInterval(() => setRem((deadline.current - Date.now()) / 1000), 1000);
    return () => clearInterval(iv);
  }, [play, s.md.rot]);
  useEffect(() => { if (rem <= 0) next(); });
  // Keep the iPad screen awake in iPad / kiosk mode (Screen Wake Lock, iPadOS 16.4+).
  useEffect(() => {
    if (!p.ipad || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let active = true;
    const req = () => {
      if (lock && !lock.released) return;
      void navigator.wakeLock.request('screen').then((l) => {
        if (!active) { void l.release(); return; }
        lock = l;
      }, () => undefined);
    };
    req();
    const vis = () => document.visibilityState === 'visible' && req();
    document.addEventListener('visibilitychange', vis);
    return () => { active = false; document.removeEventListener('visibilitychange', vis); void lock?.release(); };
  }, [p.ipad]);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const stage = useRef<HTMLElement>(null);
  const stopTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (stage.current) stage.current.scrollTop = 0;
  }, [pg]);

  const blocked = q.isPending || env?.state === 'unavailable' || q.isError;
  const source = q.isPending ? 'loading' : blocked ? 'down' : env?.freshness === 'stale' ? 'stale' : x && !x.hasRecord ? 'empty' : 'ok';
  const tooOld = env?.notices.some(n => n.code === 'TOO_OLD' || n.code === 'PERSISTENT_SNAPSHOT') ?? false;
  const sourceLabel = source === 'loading' ? 'Memuat data…' : q.isError ? 'Gagal memuat data' : source === 'down' ? 'Sumber tidak tersedia'
    : source === 'stale' ? (tooOld ? 'Bukan real-time' : 'Data tertunda') : source === 'empty' ? 'Tidak ada data' : env?.freshness === 'current' ? 'Data tersedia' : 'Histori';
  const sourceTime = env?.sourceUpdatedAt ? `Update ${timeAgo(env.sourceUpdatedAt)}` : null;
  const dt = x ? new Date(x.date + 'T00:00:00') : null;
  const partCode = (label: 'DP' | 'PO', value: string | null) =>
    value?.toUpperCase().startsWith(label) ? value : label + ' ' + (value ?? '—');
  const MST = (v: number | null, k: TargetKey) => {
    const c = cls(v, k, s);
    return c === 'ok' ? { c: 'var(--good)', t: 'Mencapai target' } : c === 'mid' ? { c: 'var(--warn)', t: 'Di bawah target' } : c === 'lo' ? { c: 'var(--bad)', t: 'Jauh di bawah target' } : { c: 'var(--muted)', t: 'Tidak tersedia' };
  };
  const meter = (v: number | null, k: TargetKey, c = '') => {
    const scale = c === 'score-meter' ? Math.max(105, v ?? 0, s.tgt[k]) : 100;
    return (
      <div className={`meter ${c}`} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, (v ?? 0) / scale)) * 100}%`, background: c === 'score-meter' ? 'var(--score-fill)' : MST(v, k).c }} /><b style={{ left: `${Math.min(1, s.tgt[k] / scale) * 100}%` }} /></div>
    );
  };
  const offMsg = q.isPending ? <><b>Memuat data mesin</b><span>Angka disembunyikan sampai pemuatan selesai.</span></>
    : q.isError || env?.state === 'unavailable' ? <><b>Sumber data tidak tersedia</b><span>Angka disembunyikan, bukan nol produksi. {env?.notices.map((n) => n.message).join(' ')}</span></>
    : x && !x.hasRecord ? <><b>MC {p.machineNo} · belum ada data produksi</b><span>Tidak ditemukan catatan produksi pada {dt?.toLocaleDateString('id-ID', { dateStyle: 'full' })}. Ini bukan konfirmasi bahwa mesin tidak dijadwalkan.</span></>
    : null;
  const ipadLabel = p.ipad ? 'Keluar mode iPad' : 'Mode iPad';
  const rotationLabel = play ? 'Jeda rotasi' : 'Putar rotasi';

  return (
    <ShadowHost className={p.ipad ? 'ipad' : ''} source={source} phw={{ s: 68, m: 84, l: 100 }[s.md.photo]}>
      <div className="app">
        <header className="top">
          <div className="topin frame">
            <div className="brand">
              <span className="logo"><img src="/hrs-logo.png" alt="HRS" /></span>
              <OrganizationName className="product-title" />
            </div>
            <div className="top-tools">
              {p.onBack && !p.ipad && !p.locked && (
                <button className="display-btn icon-btn" type="button" aria-label="Kembali ke daftar mesin" title="Semua mesin" onClick={p.onBack}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>
                </button>
              )}
              {p.onIpad && !p.locked && (
                <button className="display-btn icon-btn" type="button" aria-label={p.ipad ? ipadLabel : 'Mode iPad (layar penuh)'} title={ipadLabel}
                  aria-pressed={p.ipad} onClick={() => p.onIpad!(!p.ipad)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={p.ipad ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </header>
        <main ref={stage} className="stage" aria-busy={q.isPending}
          onTouchStart={(e) => {
            const t = e.touches[0];
            swipeStart.current = t && !(e.target instanceof Element && e.target.closest('button, select, .tblwrap'))
              ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchCancel={() => { swipeStart.current = null; }}
          onTouchEnd={(e) => {
            const start = swipeStart.current, end = e.changedTouches[0];
            swipeStart.current = null;
            if (!start || !end) return;
            const dx = end.clientX - start.x, dy = end.clientY - start.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? pg + 1 : pg - 1);
          }}>
          <div className={`workspace frame${pg === 1 ? ' stop-workspace' : ''}`}>
            <header className="machine-head">
              <div className="machine-identity">
                <h1>MC {p.machineNo}</h1>
                {x?.hasRecord && !blocked && (
                  <div className="machine-part">
                    <strong>{x.header.productName ?? '—'}</strong>
                    <div className="machine-meta">
                      <span>{partCode('DP', x.header.dpNo)}</span>
                      <span>{partCode('PO', x.header.poNo)}</span>
                      <span>{x.header.cavity == null ? 'Cavity —' : x.header.cavity + ' cavity'}</span>
                      <span>CT {dec(x.header.ctActual.value)} dtk / plan {dec(x.header.ctPlan.value)} dtk</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="machine-controls">
                {!p.locked && p.machines && p.onMachine && (
                  <div className="control">
                    <span>Mesin</span>
                    <div className="picker">
                      <button className="day-btn" type="button" aria-label="Mesin sebelumnya" onClick={() => { const m = p.machines!, i = m.indexOf(p.machineNo); p.onMachine!(m[(i - 1 + m.length) % m.length]!); }}>‹</button>
                      <select aria-label="Pilih mesin" value={p.machineNo} onChange={(e) => p.onMachine!(e.target.value)}>{p.machines.map((m) => <option key={m} value={m}>MC {m}</option>)}</select>
                      <button className="day-btn" type="button" aria-label="Mesin berikutnya" onClick={() => { const m = p.machines!, i = m.indexOf(p.machineNo); p.onMachine!(m[(i + 1) % m.length]!); }}>›</button>
                    </div>
                  </div>
                )}
                <div className="control">
                  <span id="production-date-label">Tanggal produksi</span>
                  <div className="picker">
                    <button className="day-btn" type="button" aria-label="Hari sebelumnya" disabled={!x?.prevDate} onClick={() => x?.prevDate && p.onDate(x.prevDate)}>‹</button>
                    <div className="date" role="group" aria-labelledby="production-date-label">{dt ? dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</div>
                    <button className="day-btn" type="button" aria-label="Hari berikutnya" disabled={!x?.nextDate} onClick={() => x?.nextDate && p.onDate(x.nextDate)}>›</button>
                  </div>
                </div>
                <div className="source" role="status" aria-live="polite" aria-atomic="true" title={env?.notices.map(n => n.message).join(' ')}>
                  <span>{sourceLabel}</span>
                  {sourceTime && source !== 'empty' && <small>{sourceTime}</small>}
                </div>
              </div>
            </header>
            <nav className="tabs" aria-label="Panel Machine Detail">
              {PAGES.map((name, i) => (
                <button key={name} ref={i === 1 ? stopTab : undefined} type="button" onClick={() => go(i)}
                  aria-current={i === pg ? 'page' : undefined}>{name}</button>
              ))}
            </nav>
            <div className="panels">
              {offMsg ? <div className="card off" role="status">{offMsg}</div> : x && (
                <>
                  <Page1 on={pg === 0} x={x} s={s} idn={idn} dec={dec} MST={MST} meter={meter}
                    onStops={() => { go(1); stopTab.current?.focus(); }} />
                  <Page2 key={x.machineNo + '/' + x.date} on={pg === 1} x={x} shifts={s.shifts} idn={idn} dec={dec} MST={MST} />
                  <Page3 on={pg === 2} x={x} s={s} dec={dec} MST={MST} meter={meter} />
                </>
              )}
            </div>
            <footer className="foot">
              <span>PT Hirose Electric Indonesia · Molding Division</span>
              <div className="rotation">
                {play && <span>Pindah panel dalam {Math.ceil(Math.max(0, rem))} dtk</span>}
                <button className="day-btn" type="button" aria-label="Halaman sebelumnya" onClick={() => go(pg - 1)}>‹</button>
                <button className="action icon-btn" type="button" aria-label={rotationLabel} title={rotationLabel} aria-pressed={play}
                  onClick={() => { setPlay((running) => !running); setRem(s.md.rot); }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={play ? 'M8 5v14m8-14v14' : 'm9 5 11 7-11 7z'} />
                  </svg>
                </button>
                <button className="day-btn" type="button" aria-label="Halaman berikutnya" onClick={() => go(pg + 1)}>›</button>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </ShadowHost>
  );
}

type Fmt = (n: number | null | undefined) => string;
type Mst = (v: number | null, k: TargetKey) => { c: string; t: string };
type Meter = (v: number | null, k: TargetKey, c?: string) => ReactNode;

function Page1({ on, x, s, idn, dec, MST, meter, onStops }: { on: boolean; x: MachineDetailView; s: Settings; idn: Fmt; dec: Fmt; MST: Mst; meter: Meter; onStops: () => void }) {
  const t = x.totals, pc = t.bekidoritsu.value, st = MST(pc, 'beki'), tg = s.tgt.beki;
  const longest = x.stops.reduce<MachineDetailView['stops'][number] | null>((a, r) => (!a || r.minutes > a.minutes ? r : a), null);
  const fig = (label: string, value: number | null, unit: string, color?: string) => (
    <div><dt>{label}</dt><dd style={{ color }}>{idn(value)}{value !== null && <small>{unit}</small>}</dd></div>
  );
  let cats = x.stopCategories;
  const tot = cats.reduce((a, c) => a + c.minutes, 0);
  if (cats.length > 6) { const rest = cats.slice(5); cats = [...cats.slice(0, 5), { categoryId: 'rest', name: `Lainnya (${rest.length} kategori)`, color: 's-paint-b3bbc2', minutes: rest.reduce((a, c) => a + c.minutes, 0) }]; }
  const mx = Math.max(1, ...cats.map((c) => c.minutes));
  return (
    <section className={`page p1${on ? ' on' : ''}`} inert={!on} aria-hidden={!on}>
      {s.md.pic && (
        <section className="card pic-card">
          <header className="card-head"><h2>Personel mesin</h2>{x.personnelShift && <span className="panel-sub">Shift {x.personnelShift}</span>}</header>
          <div className="ident">
            {x.personnel.map((p) => {
              const name = p.name?.trim() || undefined;
              return (
                <div className="pic" key={p.role}>
                  <PersonnelPhoto key={[x.machineNo, x.date, p.role, p.nik, p.photoUrl].join('|')} src={p.photoUrl} name={name} />
                  <span className="pt">
                    <span className="role">{ROLE[p.role]}</span>
                    <strong>{name ?? 'Nama belum tersedia'}</strong>
                    <small>NIK {p.nik || '—'}</small>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div className="p1main">
        <section className="card output-summary">
          <header className="card-head"><h2>Pencapaian output</h2><span className="panel-sub" title={pc === null ? t.bekidoritsu.reason ?? undefined : undefined}>{st.t}</span></header>
          <div className="output-content">
            <div className="output-score">
              <span>Bekidoritsu</span>
              <div className="bignum">{dec(pc)}{pc !== null && <small>%</small>}</div>
              <div className="target-text">
                Target {tg}%{pc !== null && <> · <b style={{ color: st.c }}>{pc >= tg ? '+' : '−'}{dec(Math.abs(pc - tg))} poin</b></>}
                {meter(pc, 'beki', 'score-meter')}
              </div>
            </div>
            <dl className="figs">
              {fig('Plan', t.plan, 'pcs')}{fig('Actual', t.actual, 'pcs')}{fig('Gross', t.gross, 'pcs')}
              {fig('Deviasi', t.deviation, 'pcs', t.deviation < 0 ? 'var(--bad)' : 'var(--good)')}{fig('Reject', t.reject, 'pcs', t.reject ? 'var(--bad)' : undefined)}{fig('IPR', t.ipr.value, 'ppm')}
            </dl>
          </div>
        </section>
        <section className="card stop-summary">
          <header className="card-head"><h2>{longest ? 'Stop terlama' : 'Stop time'}</h2><button type="button" className="action" onClick={onStops}>Detail stop</button></header>
          <div className="stop-content">
            {longest && (
              <div className="longest-stop">
                <b>{idn(longest.minutes)} <small>menit</small></b>
                <div><h3>{longest.detail || longest.category}</h3><p>{longest.time} · Shift {longest.shift}{longest.detail && ' · ' + longest.category}</p></div>
              </div>
            )}
            {cats.length ? (
              <>
                <p className="panel-sub stop-total">Stop per kategori · total {idn(tot)} menit</p>
                <div className="cats">
                  {cats.map((c) => (
                    <div className="cat" key={c.categoryId}>
                      <span>{c.name}</span>
                      <div className="tr" aria-hidden="true"><i style={{ width: `${(c.minutes / mx) * 100}%` }} /></div>
                      <b>{idn(c.minutes)} mnt</b>
                    </div>
                  ))}
                </div>
              </>
            ) : <p className="none">Tidak ada catatan stop pada periode ini.</p>}
          </div>
        </section>
      </div>
      <section className="card shift-summary">
        <header className="card-head"><h2>Ringkasan shift</h2></header>
        <div className="shifts">
          {x.shifts.map((sh) => (
            <div className="sh" key={sh.shift}>
              <div className="shift-top"><b>Shift {sh.shift}</b><span>{sh.time}</span></div>
              <div className="shift-rate" style={{ color: MST(sh.bekidoritsu.value, 'beki').c }}>{dec(sh.bekidoritsu.value)}{sh.bekidoritsu.value !== null && '%'}</div>
              <div className="shift-values">
                <span>Plan<b>{idn(sh.plan)}{sh.plan !== null && ' pcs'}</b></span>
                <span>Actual<b>{idn(sh.actual)}{sh.actual !== null && ' pcs'}</b></span>
                <span>Stop<b>{idn(sh.stopMinutes)}{sh.stopMinutes !== null && ' mnt'}</b></span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function Page2({ on, x, shifts, idn, dec, MST }: { on: boolean; x: MachineDetailView; shifts: Settings['shifts']; idn: Fmt; dec: Fmt; MST: Mst }) {
  const [filter, setFilter] = useState<'all' | MachineDetailView['shifts'][number]['shift']>('all');
  const starts = shiftStarts(shifts);
  const activeShifts = x.shifts.filter((sh) => filter === 'all' || sh.shift === filter);
  const events = x.stops.filter((r) => filter === 'all' || r.shift === filter);
  const total = events.reduce((sum, r) => sum + r.minutes, 0);
  const longest = events.reduce<MachineDetailView['stops'][number] | null>((a, event) => (!a || event.minutes > a.minutes ? event : a), null);
  const clock = (minutes: number) => hh(Math.floor(minutes / 60)) + ':' + String(minutes % 60).padStart(2, '0');
  const row = (label: string, value: (sh: MachineDetailView['shifts'][number]) => ReactNode) => (
    <tr><th scope="row">{label}</th>{x.shifts.map((sh) => <td key={sh.shift} className="r">{value(sh)}</td>)}</tr>
  );
  return (
    <section className={`page p2${on ? ' on' : ''}`} inert={!on} aria-hidden={!on}>
      <div className="card timeline-card">
        <header className="card-head">
          <h2>Timeline stop</h2>
          <label className="filter">Shift
            <select aria-label="Filter shift" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">Semua shift</option>
              {x.shifts.map((sh) => <option key={sh.shift} value={sh.shift}>Shift {sh.shift}</option>)}
            </select>
          </label>
        </header>
        <div className="shift-timeline" style={{ ['--shift-count' as string]: activeShifts.length }}>
          {activeShifts.map((sh) => {
            const i = Number(sh.shift) - 1;
            const start = starts[i]! * 60;
            const end = starts[(i + 1) % starts.length]! * 60;
            const duration = (end - start + 1440) % 1440;
            return (
              <div className="timeline-shift" key={sh.shift}>
                <div className="timeline-label"><b>Shift {sh.shift}</b><span>{sh.stopMinutes == null ? '—' : <><strong>{idn(sh.stopMinutes)}</strong> menit stop</>}</span></div>
                <div className="timeline-scale" role="img" aria-label={sh.time + ' · ' + (sh.stopMinutes === null ? 'Stop belum tersedia' : idn(sh.stopMinutes) + ' menit stop')}>
                  {events.filter((r) => r.shift === sh.shift).map((r, index) => {
                    const offset = (r.startMinuteOfDay - start + 1440) % 1440;
                    if (offset >= duration || r.minutes <= 0) return null;
                    return <i key={index} title={`${r.time} · ${r.minutes} mnt · ${r.category} · ${r.detail}`} style={{
                      left: `${offset / duration * 100}%`, width: `${Math.min(r.minutes, duration - offset) / duration * 100}%`, background: tokenColor(r.color),
                    }} />;
                  })}
                </div>
                <div className="timeline-hours" aria-hidden="true"><span>{clock(start)}</span><span>{clock(start + duration / 2)}</span><span>{clock(end)}</span></div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="p2main">
        <div className="card compare-card">
          <header className="card-head"><h2>Perbandingan shift</h2></header>
          <div className="tblwrap"><table id="shiftTbl">
            <thead><tr><th scope="col">Metrik</th>{x.shifts.map((sh) => <th scope="col" key={sh.shift} className="r">Shift {sh.shift}<small>{sh.time}</small></th>)}</tr></thead>
            <tbody>
              {row('Plan (pcs)', (sh) => idn(sh.plan))}
              {row('Actual (pcs)', (sh) => idn(sh.actual))}
              {row('Gross (pcs)', (sh) => idn(sh.gross))}
              {row('Deviasi (pcs)', (sh) => <span style={sh.deviation === null ? undefined : { color: sh.deviation < 0 ? 'var(--bad)' : 'var(--good)' }}>{idn(sh.deviation)}</span>)}
              {row('Reject (pcs)', (sh) => idn(sh.reject))}
              {row('IPR (ppm)', (sh) => idn(sh.ipr.value))}
              {row('Bekidoritsu', (sh) => <span style={{ color: MST(sh.bekidoritsu.value, 'beki').c }}>{dec(sh.bekidoritsu.value)}{sh.bekidoritsu.value !== null && '%'}</span>)}
              {row('Stop (mnt)', (sh) => idn(sh.stopMinutes))}
            </tbody>
          </table></div>
        </div>
        <div className="card stop-events">
          <header className="card-head">
            <h2>Rincian stop</h2>
            <span className="panel-sub">Total {idn(total)} mnt · {events.length} kejadian · rata-rata {events.length ? `${dec(total / events.length)} mnt` : '—'}</span>
          </header>
          {events.length ? (
            <div className="tblwrap events-scroll" role="region" aria-label="Daftar kejadian stop" tabIndex={0}>
              <table id="stopTbl">
                <thead><tr><th scope="col">Jam</th><th scope="col">Kejadian</th><th scope="col" className="r">Durasi</th></tr></thead>
                <tbody>{events.map((r, i) => (
                  <tr key={i}>
                    <th scope="row"><strong>{r.time}</strong><small>Shift {r.shift}</small></th>
                    <td className="event-details"><strong>{r.detail || '—'}</strong><small><i className="dot" style={{ background: tokenColor(r.color) }} />{r.category}</small></td>
                    <td className="r">{idn(r.minutes)} mnt</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="none">{filter === 'all' ? 'Tidak ada kejadian stop tercatat pada tanggal ini.' : `Tidak ada kejadian stop tercatat di Shift ${filter}.`}</div>}
          {longest && (
            <dl className="stop-record">
              <div><dt>Terlama</dt><dd>{idn(longest.minutes)} mnt</dd></div>
              <div><dt>Jam terlama</dt><dd>{longest.time}</dd></div>
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}

function Page3({ on, x, s, dec, MST, meter }: { on: boolean; x: MachineDetailView; s: Settings; dec: Fmt; MST: Mst; meter: Meter }) {
  const gap = (m: Metric, k: TargetKey) => (m.value === null ? (m.reason ?? 'tidak tersedia') : m.value >= s.tgt[k] ? `+${dec(m.value - s.tgt[k])} pt di atas target` : `${dec(s.tgt[k] - m.value)} pt di bawah target`);
  return (
    <section className={`page p3${on ? ' on' : ''}`} inert={!on} aria-hidden={!on}>
      <div className="card chartcard">
        <header className="card-head"><h2>Output per jam</h2><span className="panel-sub">Actual · pcs</span></header>
        {x.hourly.available ? <HourlyChart hours={x.hourly.hours} /> : <div className="chart"><div className="none"><span>{x.hourly.reason}</span></div></div>}
      </div>
      <div className="p3b">
        <div className="card chartcard">
          <header className="card-head"><h2>Pareto reject</h2><div className="legend"><span><i className="dot" style={{ background: 'var(--s-paint-8fa3a8)' }} />Qty reject (pcs)</span><span><i className="ln" />% kumulatif</span></div></header>
          <Pareto items={x.rejectPareto} paretoLine={s.disp.pareto} />
        </div>
        <div className="card kpis">
          <header className="card-head"><h2>Capaian terhadap target</h2></header>
          <div className="kpi-values">
            {([['Pencapaian output', x.totals.bekidoritsu, 'beki'], ['OEE', x.totals.oee, 'oee']] as const).map(([l, m, k]) => (
              <div className="kpi" key={k}>
                <div className="hd">{l} · target {s.tgt[k]}%<span>{gap(m, k)}</span></div>
                <div className="big" style={{ color: MST(m.value, k).c }}>{dec(m.value)}{m.value !== null && <small>%</small>}</div>
                {meter(m.value, k)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HourlyChart({ hours }: { hours: { hour: number; plan: number | null; actual: number }[] }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [H, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, [ref]);
  if (W < 40 || H < 40) return <div className="chart" ref={ref} />;
  const fs = Math.max(13, Math.round(H / 20)), m = { l: 48, r: 12, t: 24, b: 28 }, n = hours.length, iw = W - m.l - m.r, ih = H - m.t - m.b, slot = iw / n, bw = Math.min(slot * 0.62, 64);
  const mx = Math.max(1, ...hours.map((h) => h.actual));
  const rawStep = mx / 4, pw = 10 ** Math.floor(Math.log10(rawStep || 1)), step = Math.max(1, [1, 2, 5, 10].map((f) => f * pw).find((v) => v >= rawStep) ?? 1), ymax = Math.ceil(mx / step) * step;
  const yb = (v: number) => m.t + ih - (v / ymax) * ih, cx = (i: number) => m.l + slot * (i + 0.5);
  const every = Math.max(1, Math.ceil((fs * 3.4) / slot)), showVal = slot >= fs * 2.4;
  const ticks: number[] = [];
  for (let v = 0; v <= ymax + 1e-6; v += step) ticks.push(v);
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Output per jam">
        {ticks.map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={yb(v)} y2={yb(v)} stroke="var(--s-paint-e3eae9)" /><text x={m.l - 6} y={yb(v) + 4} fontSize={fs - 1} fill="var(--s-paint-8a989c)" textAnchor="end">{v}</text></g>)}
        {hours.map((h, i) => (
          <g key={h.hour}>
            <rect x={cx(i) - bw / 2} y={yb(h.actual)} width={bw} height={Math.max(0, m.t + ih - yb(h.actual))} rx={4} fill="var(--s-brand-blue)"><title>{`${String(h.hour).padStart(2, '0')}:00 · ${h.actual} pcs`}</title></rect>
            {showVal && <text x={cx(i)} y={yb(h.actual) - 6} fontSize={fs - 1} fontWeight={700} fill="var(--s-paint-1d2b30)" textAnchor="middle">{h.actual}</text>}
            {i % every === 0 && <text x={cx(i)} y={H - 5} fontSize={fs - 1} fill="var(--s-paint-5a6a6f)" textAnchor="middle">{String(h.hour).padStart(2, '0')}:00</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}

function Pareto({ items, paretoLine }: { items: { name: string; qty: number }[]; paretoLine: number }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [H, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, [ref]);
  if (!items.length) return <div className="chart" ref={ref}><div className="none">Tidak ada reject hari ini</div></div>;
  if (W < 40 || H < 40) return <div className="chart" ref={ref} />;
  const fs = Math.max(13, Math.round(H / 20)), m = { l: 40, r: 48, t: 24, b: 28 }, n = items.length, iw = W - m.l - m.r, ih = H - m.t - m.b, slot = iw / n, bw = Math.min(slot * 0.56, 80);
  const tot = items.reduce((a, i) => a + i.qty, 0) || 1, mx = Math.max(...items.map((i) => i.qty));
  const rawStep = mx / 3, pw = 10 ** Math.floor(Math.log10(rawStep || 1)), step = Math.max(1, [1, 2, 5, 10].map((f) => f * pw).find((v) => v >= rawStep) ?? 1), ymax = Math.ceil(mx / step) * step;
  const yb = (v: number) => m.t + ih - (v / ymax) * ih, yp = (p: number) => m.t + ih - (p / 100) * ih, cx = (i: number) => m.l + slot * (i + 0.5);
  const maxChars = Math.max(6, Math.floor(slot / (fs * 0.58)));
  let cum = 0;
  const pts = items.map((it, i) => { cum += it.qty; return [cx(i), yp((cum / tot) * 100)] as const; });
  const ticks: number[] = [];
  for (let v = 0; v <= ymax + 1e-6; v += step) ticks.push(v);
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pareto reject">
        {ticks.map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={yb(v)} y2={yb(v)} stroke="var(--s-paint-e3eae9)" /><text x={m.l - 6} y={yb(v) + 4} fontSize={fs - 1} fill="var(--s-paint-8a989c)" textAnchor="end">{v}</text></g>)}
        {[0, 50, 100].map((p) => <text key={p} x={W - m.r + 6} y={yp(p) + 4} fontSize={fs - 1} fill="var(--s-brand-blue)">{p}%</text>)}
        <line x1={m.l} x2={W - m.r} y1={yp(paretoLine)} y2={yp(paretoLine)} stroke="var(--s-brand-blue)" strokeDasharray="2 4" opacity={0.55} />
        {items.map((it, i) => (
          <g key={it.name}>
            <rect x={cx(i) - bw / 2} y={yb(it.qty)} width={bw} height={m.t + ih - yb(it.qty)} rx={5} fill="var(--s-paint-8fa3a8)" />
            <text x={cx(i)} y={yb(it.qty) - 6} fontSize={fs} fontWeight={700} fill="var(--s-paint-1d2b30)" textAnchor="middle">{it.qty}</text>
            <text x={cx(i)} y={H - 5} fontSize={fs - 1} fill="var(--s-paint-5a6a6f)" textAnchor="middle">{it.name.length > maxChars ? it.name.slice(0, maxChars - 1) + '…' : it.name}<title>{it.name}</title></text>
          </g>
        ))}
        <path d={pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')} fill="none" stroke="var(--s-brand-blue)" strokeWidth={2.2} />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3.6} fill="var(--s-on-brand)" stroke="var(--s-brand-blue)" strokeWidth={2.2} />)}
      </svg>
    </div>
  );
}
