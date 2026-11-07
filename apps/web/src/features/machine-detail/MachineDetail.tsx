import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import type { MachineDetailView, Metric, Settings, ViewDataEnvelope } from '@mpd/contracts';
import { api, qs } from '../../lib/api';
import { useReportSource } from '../../lib/filters';
import { cls, type TargetKey } from '../../lib/status';
import { hh, timeAgo, tokenColor } from '../../lib/format';
import { useWidth } from '../../components/charts';
import mdCss from './machine-detail.css?inline';

/* Machine Detail (normal + iPad/kiosk). Rendered inside a Shadow DOM exactly like mockup v1.10 so its
 * component CSS cannot collide with the dashboard CSS; tokens are inherited through the host. */

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
    <div id="mdHost" ref={host} className={className} data-source={source} style={{ ['--phw' as string]: phw }}>
      {root && createPortal(children, root)}
    </div>
  );
}

const PAGES = ['Ringkasan', 'Shift & stop time', 'Trend & analisa'];
const PERSON = <svg viewBox="0 0 100 110" fill="currentColor"><circle cx="50" cy="38" r="20" /><path d="M8 110c0-25 19-42 42-42s42 17 42 42z" /></svg>;
const ROLE = { leader: 'Leader', cell: 'Cell leader', technician: 'Technician', operator: 'Operator' } as const;

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
    queryFn: () => api.get<ViewDataEnvelope<MachineDetailView>>(`/api/v1/machine-detail/${encodeURIComponent(p.machineNo)}?${qs({ date: p.date })}`),
    refetchInterval: s.data.refresh * 60_000,
    placeholderData: (prev) => prev,
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
  useEffect(() => setPlay(p.ipad && s.md.autoplay), [p.ipad, s.md.autoplay]);
  const go = (i: number) => { setPg((i + 3) % 3); setRem(s.md.rot); };
  const next = () => { for (let k = 1; k <= 3; k++) { const j = (pg + k) % 3; if (enabled.includes(j)) return go(j); } };
  useEffect(() => {
    if (!play) return;
    const iv = setInterval(() => setRem((r) => r - 0.1), 100);
    return () => clearInterval(iv);
  }, [play]);
  useEffect(() => { if (rem <= 0) next(); });  
  // Keep the iPad screen awake in iPad / kiosk mode (Screen Wake Lock, iPadOS 16.4+).
  useEffect(() => {
    if (!p.ipad || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const req = () => { navigator.wakeLock.request('screen').then((l) => { lock = l; }, () => undefined); };
    req();
    const vis = () => document.visibilityState === 'visible' && req();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); void lock?.release(); };
  }, [p.ipad]);
  const touchX = useRef<number | null>(null);

  const blocked = q.isPending || env?.state === 'unavailable' || q.isError;
  const source = q.isPending ? 'loading' : q.isError || env?.state === 'unavailable' ? 'down' : env?.freshness === 'stale' ? 'stale' : 'ok';
  const srcLabel = q.isPending ? 'Memuat data…' : q.isError ? 'Gagal memuat data' : env?.state === 'unavailable' ? 'Sumber tidak tersedia'
    : env?.freshness === 'stale' ? `Data tertunda · ${timeAgo(env.sourceUpdatedAt)}` : env?.freshness === 'current' ? `Sumber normal · ${timeAgo(env.sourceUpdatedAt)}` : `Histori · update ${timeAgo(env?.sourceUpdatedAt ?? null)}`;
  const dt = x ? new Date(x.date + 'T00:00:00') : null;
  const MST = (v: number | null, k: TargetKey) => {
    const c = cls(v, k, s);
    return c === 'ok' ? { c: 'var(--good)', bg: 'var(--good-bg)', t: 'On target' } : c === 'mid' ? { c: 'var(--warn)', bg: 'var(--warn-bg)', t: 'Di bawah target' } : c === 'lo' ? { c: 'var(--bad)', bg: 'var(--bad-bg)', t: 'Jauh di bawah target' } : { c: 'var(--muted)', bg: 'var(--surface)', t: 'Tidak tersedia' };
  };
  const meter = (v: number | null, k: TargetKey, c = '') => (
    <div className={`meter ${c}`}><i style={{ width: `${Math.min(100, v ?? 0)}%`, background: MST(v, k).c }} /><b style={{ left: `${Math.min(100, s.tgt[k])}%` }} /></div>
  );
  const offMsg = q.isPending ? <><b>Memuat data mesin</b><span>Angka disembunyikan sampai pemuatan selesai.</span></>
    : q.isError || env?.state === 'unavailable' ? <><b>Sumber data tidak tersedia</b><span>Angka disembunyikan, bukan nol produksi. {env?.notices.map((n) => n.message).join(' ')}</span></>
    : x && !x.hasRecord ? <><b>MC {p.machineNo} · belum ada data produksi</b><span>Tidak ditemukan catatan produksi pada {dt?.toLocaleDateString('id-ID', { dateStyle: 'full' })}. Ini bukan konfirmasi bahwa mesin tidak dijadwalkan.</span></>
    : null;

  return (
    <ShadowHost className={p.ipad ? 'ipad' : ''} source={source} phw={{ s: 4.8, m: 6.4, l: 7.8 }[s.md.photo]}>
      <div className="app">
        <header className="top">
          <div className="logo"><img src="/hrs-logo.png" alt="HRS · Hirose Electric" /></div>
          {p.onBack && !p.locked && (
            <button className="back" type="button" aria-label="Kembali ke daftar mesin" onClick={p.onBack}><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg><span className="bl">Semua mesin</span></button>
          )}
          {!p.locked && p.machines && p.onMachine && (
            <div className="msw">
              <button type="button" aria-label="Mesin sebelumnya" onClick={() => { const m = p.machines!, i = m.indexOf(p.machineNo); p.onMachine!(m[(i - 1 + m.length) % m.length]!); }}><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button>
              <select aria-label="Pilih mesin" value={p.machineNo} onChange={(e) => p.onMachine!(e.target.value)}>{p.machines.map((m) => <option key={m} value={m}>MC {m}</option>)}</select>
              <button type="button" aria-label="Mesin berikutnya" onClick={() => { const m = p.machines!, i = m.indexOf(p.machineNo); p.onMachine!(m[(i + 1) % m.length]!); }}><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg></button>
            </div>
          )}
          <div className="mh">
            {p.locked && <div className="mct"><span>Mesin</span><b>MC {p.machineNo}</b></div>}
            <div className="mpn"><span>Part no.</span><b>{x?.header.dpNo ?? '—'}</b></div>
            <div className="mpm"><span>Part name</span><b style={{ fontFamily: 'var(--font)' }}>{x?.header.productName ?? '—'}</b></div>
            <div className="mct"><span>CT plan / actual</span><b>{dec(x?.header.ctPlan.value)} / {dec(x?.header.ctActual.value)} s</b></div>
            <div className="srctag" role="status" aria-live="polite" aria-atomic="true">{srcLabel}</div>
          </div>
          <div className="dsw">
            <button type="button" aria-label="Hari sebelumnya" disabled={!x?.prevDate} onClick={() => x?.prevDate && p.onDate(x.prevDate)}><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button>
            <div className="date">{dt ? <><b>{dt.toLocaleDateString('id-ID', { weekday: 'long' })}</b>{dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</> : '—'}</div>
            <button type="button" aria-label="Hari berikutnya" disabled={!x?.nextDate} onClick={() => x?.nextDate && p.onDate(x.nextDate)}><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg></button>
          </div>
          {p.onIpad && !p.locked && (
            <button className="ipb" type="button" aria-label={p.ipad ? 'Keluar mode iPad' : 'Mode iPad (layar penuh)'} title={p.ipad ? 'Keluar mode iPad' : 'Mode iPad (layar penuh)'} onClick={() => p.onIpad!(!p.ipad)}>
              <svg viewBox="0 0 24 24">{p.ipad ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
            </button>
          )}
        </header>
        <main className="stage" aria-busy={q.isPending}
          onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
          onTouchEnd={(e) => { const t0 = touchX.current, t1 = e.changedTouches[0]?.clientX; if (t0 != null && t1 != null && Math.abs(t1 - t0) > 60) go(t1 < t0 ? pg + 1 : pg - 1); touchX.current = null; }}>
          <div className="off" role="status" style={{ display: offMsg ? 'flex' : 'none' }}>{offMsg}</div>
          {x && x.hasRecord && !blocked && (
            <>
              <Page1 on={pg === 0} x={x} s={s} idn={idn} dec={dec} MST={MST} meter={meter} />
              <Page2 on={pg === 1} x={x} idn={idn} dec={dec} MST={MST} />
              <Page3 on={pg === 2} x={x} s={s} dec={dec} MST={MST} meter={meter} />
            </>
          )}
        </main>
        <footer className="kiosk">
          <div className="tabs">
            {PAGES.map((name, i) => (
              <button key={name} type="button" className={`tab${i === pg ? ' on' : ''}${i < pg ? ' done' : ''}`} onClick={() => go(i)} aria-current={i === pg ? 'page' : undefined}>
                <span className="tl2"><i>0{i + 1}</i>{name}</span>
                <span className="pb"><b style={{ width: i === pg ? `${play ? ((s.md.rot - rem) / s.md.rot) * 100 : 100}%` : undefined }} /></span>
              </button>
            ))}
          </div>
          <div className="ctl">
            <button type="button" aria-label="Halaman sebelumnya" onClick={() => go(pg - 1)}><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button>
            <button id="playBtn" type="button" aria-label={play ? 'Jeda rotasi' : 'Putar rotasi'} onClick={() => { setPlay((x2) => !x2); setRem(s.md.rot); }}>
              <svg viewBox="0 0 24 24">{play ? <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></> : <path d="M7 4.5l13 7.5-13 7.5z" />}</svg>
            </button>
            <button type="button" aria-label="Halaman berikutnya" onClick={() => go(pg + 1)}><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg></button>
          </div>
        </footer>
      </div>
    </ShadowHost>
  );
}

type Fmt = (n: number | null | undefined) => string;
type Mst = (v: number | null, k: TargetKey) => { c: string; bg: string; t: string };
type Meter = (v: number | null, k: TargetKey, c?: string) => ReactNode;

function Page1({ on, x, s, idn, dec, MST, meter }: { on: boolean; x: MachineDetailView; s: Settings; idn: Fmt; dec: Fmt; MST: Mst; meter: Meter }) {
  const t = x.totals, pc = t.bekidoritsu.value, st = MST(pc, 'beki'), tg = s.tgt.beki;
  const longest = x.stops.reduce<MachineDetailView['stops'][number] | null>((a, r) => (!a || r.minutes > a.minutes ? r : a), null);
  const fig = (v: string, u: string, l: string, c?: string) => <div className="fig"><div className="v n" style={c ? { color: c } : undefined}>{v}<span className="u">{u}</span></div><div className="t">{l}</div></div>;
  let cats = x.stopCategories;
  const tot = cats.reduce((a, c) => a + c.minutes, 0);
  if (cats.length > 6) { const rest = cats.slice(5); cats = [...cats.slice(0, 5), { categoryId: 'rest', name: `Lainnya (${rest.length} kategori)`, color: 's-paint-b3bbc2', minutes: rest.reduce((a, c) => a + c.minutes, 0) }]; }
  const mx = cats[0]?.minutes ?? 1;
  return (
    <section className={`page p1${on ? ' on' : ''}${s.md.pic ? '' : ' nopic'}`} inert={!on} aria-hidden={!on}>
      {s.md.pic && (
        <div className="card ident">
          {x.personnel.map((p) => (
            <div className="pic" key={p.role} title={p.nik ? `NIK ${p.nik}` : undefined}>
              <span className="ph">{PERSON}</span>
              <span className="pt"><span className="role">{ROLE[p.role]}</span><span className="nm">{p.nik ? `NIK ${p.nik}` : '—'}</span></span>
            </div>
          ))}
        </div>
      )}
      <div className="p1main">
        <div className="left">
          <div className="hero" style={{ background: st.bg }}>
            <div>
              <div className="lbl">Pencapaian output <span className="pill" style={{ background: st.c }}>{st.t}</span></div>
              <div className="bignum" style={{ color: st.c }}>{dec(pc)}<small>%</small></div>
            </div>
            <div className="figs">
              {fig(idn(t.plan), 'pcs', 'Output plan')}{fig(idn(t.actual), 'pcs', 'Output actual')}{fig(idn(t.gross), 'pcs', 'Output gross')}
              {fig(idn(t.deviation), 'pcs', 'Deviasi dari plan', t.deviation < 0 ? 'var(--bad)' : 'var(--good)')}{fig(idn(t.reject), 'pcs', 'Quantity reject', t.reject ? 'var(--bad)' : undefined)}{fig(idn(t.ipr.value), 'ppm', 'IPR (PPM)')}
            </div>
            <div className="bar">{meter(pc, 'beki', 'lg')}<div className="mrow"><span>0%</span><span>Target <b>{tg}%</b> · {pc === null ? 'tidak tersedia' : pc >= tg ? <>lebih <b>{dec(pc - tg)} pt</b></> : <>kurang <b>{dec(tg - pc)} pt</b></>}</span><span>100%</span></div></div>
            <div className={`attn${longest ? '' : ' quiet'}`}>{longest
              ? <><b>Stop terlama tercatat</b><span>{longest.detail} · {longest.minutes} menit · {longest.time} · Shift {longest.shift} · {longest.category}</span></>
              : <><b>Tidak ada catatan stop</b><span>Data stop kosong bukan bukti mesin berjalan normal.</span></>}</div>
          </div>
          <div className="shifts">
            {x.shifts.map((sh) => (
              <div className="card sh" key={sh.shift}>
                <div className="hd"><b>Shift {sh.shift}</b><span>{sh.time}</span></div>
                <div className="pc n" style={{ color: MST(sh.bekidoritsu.value, 'beki').c }}>{dec(sh.bekidoritsu.value)}<span className="u">%</span></div>
                {meter(sh.bekidoritsu.value, 'beki')}
                <div className="ft"><span><b>{idn(sh.actual)}</b> / {idn(sh.plan)}</span><span>stop <b>{sh.stopMinutes ?? '—'}</b> mnt</span></div>
              </div>
            ))}
          </div>
        </div>
        <div className="card stop">
          <div className="ttl"><span>Stop time pada tanggal terpilih</span><small>{x.stopCategories.length} kategori</small></div>
          <div className="stopsum"><div className="n">{idn(tot)}<span className="u">menit</span></div><div className="side"><b>{dec(tot / 60)}</b> jam<br /><b>{x.stops.length}</b> kejadian</div></div>
          <div className="stack">{cats.map((c) => <i key={c.categoryId} style={{ width: `${(c.minutes / (tot || 1)) * 100}%`, background: tokenColor(c.color) }} />)}</div>
          {cats.length ? (
            <div className="cats" style={{ gridTemplateRows: `repeat(${cats.length},minmax(calc(var(--u)*3.2),calc(var(--u)*4.6)))` }}>
              {cats.map((c) => (
                <div className="cat" key={c.categoryId}>
                  <span className="nm"><i className="dot" style={{ background: tokenColor(c.color) }} />{c.name}</span>
                  <span className="vl"><b>{c.minutes}</b> mnt <em>{Math.round((c.minutes / (tot || 1)) * 100)}%</em></span>
                  <div className="tr"><i style={{ width: `${(c.minutes / mx) * 100}%`, background: tokenColor(c.color) }} /></div>
                </div>
              ))}
            </div>
          ) : <div className="none">Tidak ada catatan stop pada periode ini. Data kosong bukan konfirmasi mesin berjalan normal.</div>}
        </div>
      </div>
    </section>
  );
}

function Page2({ on, x, idn, dec, MST }: { on: boolean; x: MachineDetailView; idn: Fmt; dec: Fmt; MST: Mst }) {
  const base = 6 * 60, L = x.stops, mxd = Math.max(1, ...L.map((r) => r.minutes));
  const td = L.reduce((a, r) => a + r.minutes, 0), lg = L.reduce<(typeof L)[number] | null>((a, r) => (!a || r.minutes > a.minutes ? r : a), null);
  const row = (l: string, fn: (s: MachineDetailView['shifts'][number]) => ReactNode, c?: string) => <tr className={c}><td>{l}</td>{x.shifts.map((s) => <td key={s.shift} className="r">{fn(s)}</td>)}</tr>;
  return (
    <section className={`page p2${on ? ' on' : ''}`} inert={!on} aria-hidden={!on}>
      <div className="card tl">
        <div className="ttl"><span>Stop time sepanjang hari</span><div className="legend">{x.stopCategories.slice(0, 6).map((c) => <span key={c.categoryId}><i className="dot" style={{ background: tokenColor(c.color) }} />{c.name}</span>)}</div></div>
        <div>
          <div className="tlhead">{x.shifts.map((s) => <div key={s.shift}><b>Shift {s.shift}</b>{s.time}<span className="n">{s.stopMinutes ?? '—'} mnt</span></div>)}</div>
          <div className="track"><span /><span /><span />
            {L.map((r, i) => <i key={i} title={`${r.time} · ${r.minutes} mnt · ${r.category} · ${r.detail}`} style={{ left: `${(((r.startMinuteOfDay - base + 1440) % 1440) / 14.4)}%`, width: `${r.minutes / 14.4}%`, background: tokenColor(r.color) }} />)}
          </div>
          <div className="axis">{Array.from({ length: 13 }, (_, j) => <span key={j} className={j % 4 === 0 ? 's' : ''} style={{ left: `${(j / 12) * 100}%` }}>{hh(6 + j * 2)}</span>)}</div>
        </div>
      </div>
      <div className="p2main">
        <div className="card tblcard">
          <div className="ttl"><span>Perbandingan shift</span></div>
          <div className="tblwrap"><table id="shiftTbl">
            <thead><tr><th />{x.shifts.map((s) => <th key={s.shift} className="r">Shift {s.shift}</th>)}</tr></thead>
            <tbody>
              {row('Output plan', (s) => idn(s.plan))}{row('Output actual', (s) => idn(s.actual))}{row('Output gross', (s) => idn(s.gross))}{row('Quantity reject', (s) => idn(s.reject))}
              {row('IPR (PPM)', (s) => idn(s.ipr.value))}{row('Deviasi', (s) => <span style={{ color: (s.deviation ?? 0) < 0 ? 'var(--bad)' : 'var(--good)' }}>{idn(s.deviation)}</span>)}{row('Stop time (mnt)', (s) => s.stopMinutes ?? '—')}
              {row('Pencapaian', (s) => <span style={{ color: MST(s.bekidoritsu.value, 'beki').c }}>{dec(s.bekidoritsu.value)}%</span>, 'hl')}
            </tbody>
          </table></div>
        </div>
        <div className="card tblcard">
          <div className="ttl"><span>Detail stop time</span><small>{L.length} kejadian</small></div>
          <div className="tblwrap">
            <table id="stopTbl" style={L.length < 10 ? { height: 'auto' } : undefined}>
              <thead><tr><th>Jam</th><th className="r">Durasi</th><th>Kategori</th><th>Keterangan</th></tr></thead>
              <tbody>{L.map((r, i) => (
                <tr key={i}><td className="n">{r.time}<span className="sb">S{r.shift}</span></td>
                  <td className="r"><div className="dur"><i style={{ width: `calc(var(--u)*${((r.minutes / mxd) * 2.4).toFixed(2)})`, background: tokenColor(r.color) }} />{r.minutes}'</div></td>
                  <td><span className="cat2"><i className="dot" style={{ background: tokenColor(r.color) }} />{r.category}</span></td><td className="d" title={r.detail}>{r.detail}</td></tr>
              ))}</tbody>
            </table>
            <div className="none empty" style={{ display: L.length < 10 ? 'flex' : 'none' }}><span>{L.length ? `Hanya ${L.length} kejadian tercatat hari ini.` : 'Tidak ada stop time tercatat hari ini'}</span></div>
          </div>
          <div className="tsum"><div><span>Total tercatat</span><b>{td}</b> mnt</div><div><span>Rata-rata</span><b>{L.length ? Math.round(td / L.length) : 0}</b> mnt</div><div><span>Terlama</span><b>{lg ? lg.minutes : 0}</b> mnt</div><div><span>Jam terlama</span><b>{lg ? lg.time : '—'}</b></div></div>
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
        <div className="ttl"><span>Output per jam</span></div>
        <div className="chart">
          {x.hourly.available ? null : <div className="none"><span>{x.hourly.reason}</span></div>}
        </div>
      </div>
      <div className="p3b">
        <div className="card chartcard">
          <div className="ttl"><span>Pareto reject</span><div className="legend"><span><i className="dot" style={{ background: 'var(--s-paint-9fb0b3)', borderRadius: 'var(--s-size-2)' }} />Qty reject (pcs)</span><span><i className="ln" style={{ borderColor: 'var(--plan)' }} />% kumulatif</span></div></div>
          <Pareto items={x.rejectPareto} paretoLine={s.disp.pareto} />
        </div>
        <div className="card kpis">
          <div className="ttl"><span>Capaian terhadap target</span></div>
          {([['Pencapaian output', x.totals.bekidoritsu, 'beki'], ['OEE', x.totals.oee, 'oee']] as const).map(([l, m, k]) => (
            <div className="kpi" key={k}>
              <div className="hd">{l} · target {s.tgt[k]}%<span>{gap(m, k)}</span></div>
              <div className="big n" style={{ color: MST(m.value, k).c }}>{dec(m.value)}<small>%</small></div>
              {meter(m.value, k, 'lg')}
            </div>
          ))}
        </div>
      </div>
    </section>
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
