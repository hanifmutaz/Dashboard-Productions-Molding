import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { PERMISSIONS, type Permission } from '@mpd/contracts';
import { useSession } from '../lib/session';
import { useFilters } from '../lib/filters';
import { PRESETS, rangeTxt, productionToday } from '../lib/period';
import { hh, timeAgo } from '../lib/format';
import { useTip } from '../components/ui';

export const APP_VERSION = '1.0.0';

export interface PageMeta { path: string; key: string; title: string; sub: string; group: string; perm?: Permission; filtered?: boolean }
export const PAGES: PageMeta[] = [
  { path: '/production', key: 'prod', title: 'Production', sub: 'Plan vs actual, achievement and output by machine', group: 'Monitoring', perm: PERMISSIONS.viewProduction, filtered: true },
  { path: '/utilization', key: 'util', title: 'Machine Utilization', sub: 'OEE and Kikai / Sogo / Shugyo Kadouritsu by machine', group: 'Monitoring', perm: PERMISSIONS.viewUtilization, filtered: true },
  { path: '/stop-time', key: 'stop', title: 'Stop Time', sub: 'Where production time is lost · categories and details from Master Data', group: 'Monitoring', perm: PERMISSIONS.viewStopTime, filtered: true },
  { path: '/sales', key: 'sales', title: 'Sales', sub: 'Production actual × Harga/PCS per DP Part, in Rupiah', group: 'Monitoring', perm: PERMISSIONS.viewSales },
  { path: '/scrap', key: 'scrap', title: 'Scrap', sub: 'Monthly and daily scrap value (Rupiah) and ratio', group: 'Monitoring', perm: PERMISSIONS.viewScrap },
  { path: '/need-part', key: 'needpart', title: 'Need Part', sub: 'Segera Hadir', group: 'Monitoring' },
  { path: '/machines', key: 'detail', title: 'Machine Detail', sub: 'Every machine has its own dashboard · pick a machine to open it', group: 'Analysis', perm: PERMISSIONS.viewMachineDetail },
  { path: '/master-data', key: 'master', title: 'Master Data', sub: 'Parts, materials, prices (Rupiah), stop categories and machines used by every page', group: 'Data & system', perm: PERMISSIONS.viewMasterData },
  { path: '/settings', key: 'settings', title: 'Settings', sub: 'Plant-wide rules: targets, status colours, calendar, stop-time display, kiosk and data freshness', group: 'Data & system', perm: PERMISSIONS.viewSettings },
  { path: '/admin/users', key: 'users', title: 'Users & roles', sub: 'Accounts, roles and permissions · authorization is enforced by the server', group: 'Data & system', perm: PERMISSIONS.manageUsers },
  { path: '/admin/kiosks', key: 'kiosks', title: 'Kiosks', sub: 'Pair floor iPads to one machine · revoke at any time', group: 'Data & system', perm: PERMISSIONS.manageKiosks },
  { path: '/admin/audit', key: 'audit', title: 'Audit log', sub: 'Append-only record of sign-ins and sensitive changes', group: 'Data & system', perm: PERMISSIONS.viewAudit },
  { path: '/profile', key: 'profile', title: 'My Profile', sub: 'Account, personal preferences and activity', group: 'Account' },
];
export const pageOf = (pathname: string) => PAGES.find((p) => pathname === p.path || pathname.startsWith(p.path + '/'));

const ICONS: Record<string, ReactNode> = {
  prod: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  util: <><path d="M12 13l4-4" /><path d="M3.3 17a9 9 0 1 1 17.4 0" /></>,
  stop: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></>,
  sales: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M7 9.5v5M17 9.5v5" /></>,
  scrap: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />,
  needpart: <path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4" />,
  detail: <><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M8 20h8M12 16v4" /></>,
  master: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  settings: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.5 2.8 3.5 6" /></>,
  kiosks: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M10 18h4" /></>,
  audit: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 10h6M9 14h6M9 18h3" /></>,
};

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

export function AppShell() {
  const { me, prefs, savePrefs, can, settings } = useSession();
  const loc = useLocation();
  const nav = useNavigate();
  const page = pageOf(loc.pathname);
  const user = me?.kind === 'user' ? me.user : null;
  const [drawer, setDrawer] = useState(false);
  const [width, setWidth] = useState(innerWidth);
  const [kiosk, setKiosk] = useState(false);
  const mdFull = /^\/machines\/[^/]+$/.test(loc.pathname);

  useEffect(() => {
    let t: number | undefined;
    const on = () => { clearTimeout(t); t = window.setTimeout(() => setWidth(innerWidth), 150); };
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  const rail = width >= 900 && (prefs.side === 'rail' || (prefs.side !== 'full' && width < 1280));
  const kioskTheme = kiosk && settings.kiosk.theme !== 'keep' ? settings.kiosk.theme : prefs.theme;
  useEffect(() => {
    const b = document.body.classList;
    b.toggle('dark', kioskTheme === 'dark');
    b.toggle('rail', rail);
    b.toggle('drawer', drawer);
    b.toggle('kiosk', kiosk);
    b.toggle('md-on', mdFull);
  }, [kioskTheme, rail, drawer, kiosk, mdFull]);
  // Motion: brief entrance on navigation, then still (mockup behaviour); "off" keeps everything still.
  useEffect(() => {
    const b = document.body.classList;
    if (prefs.motion === 'off') { b.add('still'); return; }
    b.remove('still');
    const t = setTimeout(() => b.add('still'), 900);
    return () => clearTimeout(t);
  }, [loc.pathname, prefs.motion]);
  useEffect(() => { setDrawer(false); scrollTo({ top: 0 }); }, [loc.pathname]);
  useEffect(() => { if (page) document.title = `${page.title} · Molding Dashboard`; }, [page]);

  const groups = ['Monitoring', 'Analysis', 'Data & system'];
  const visible = PAGES.filter((p) => p.group !== 'Account' && (!p.perm || can(p.perm)));
  const { show, hide } = useTip();

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <img className="hlogo" src="/hrs-logo.png" alt="HRS · Hirose Electric" />
          <span className="bsep" />
          <div className="bt"><b>Molding</b><small>PM Dashboard</small></div>
          <button className="sbt" type="button" title={rail ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!rail}
            onClick={() => void savePrefs({ ...prefs, side: rail ? 'full' : 'rail' })}>
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path className="bar2" d="M9 4v16" /></svg>
          </button>
        </div>
        <nav className="nav">
          {groups.map((g) => (
            <Fragment key={g}>
              {visible.some((p) => p.group === g) && <div className="ngrp caps">{g}</div>}
              {visible.filter((p) => p.group === g).map((p) =>
                p.key === 'needpart' ? (
                  <NavLink key={p.key} to={p.path} className={({ isActive }) => `ni dis${isActive ? ' on' : ''}`} aria-disabled="true" title="Need Part · Segera Hadir"
                    onPointerMove={(e) => rail && show(e, { title: 'Need Part · Segera Hadir' })} onPointerLeave={hide}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[p.key]}</svg><span className="lbl">Need Part</span><span className="tag">Segera Hadir</span>
                  </NavLink>
                ) : (
                  <NavLink key={p.key} to={p.path} className={({ isActive }) => `ni${isActive ? ' on' : ''}`}
                    onPointerMove={(e) => rail && show(e, { title: p.title })} onPointerLeave={hide}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[p.key]}</svg><span className="lbl">{p.title}</span>
                  </NavLink>
                ),
              )}
            </Fragment>
          ))}
        </nav>
        <div className="sbfoot">
          <button className={`ubox${page?.key === 'profile' ? ' on' : ''}`} type="button" onClick={() => void nav('/profile')} title="My profile">
            <div className="av">{user ? initials(user.displayName) : '?'}</div>
            <div><b>{user?.displayName ?? '—'}</b><small>{user?.roleName ?? ''}</small></div>
            <span className="chev2">›</span>
          </button>
          <div className="sbver">Molding Dashboard · v{APP_VERSION}</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="tbtn hamb" type="button" aria-label="Open menu" onClick={() => setDrawer((d) => !d)}>☰</button>
          <div className="crumb"><span className="c1">{page?.group}</span><span className="sl">/</span><span className="c2">{page?.title}</span></div>
          <span className="co">PT Hirose Electric Indonesia · Molding Division</span>
          <div className="tr">
            <SourceIndicator />
            <button className="tbtn" id="themeBtn" type="button" title={prefs.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={prefs.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => void savePrefs({ ...prefs, theme: prefs.theme === 'dark' ? 'light' : 'dark' })}>
              <svg viewBox="0 0 24 24">{prefs.theme === 'dark'
                ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2m-17.07 7.07 1.41-1.41m11.32-11.32 1.41-1.41" /></>
                : <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}</svg>
            </button>
            {!kiosk && (
              <button className="tbtn" id="kioskBtn" type="button" title="Kiosk / TV mode" onClick={() => setKiosk(true)}>
                <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg><span className="tl">Kiosk</span>
              </button>
            )}
            <button className="meav" type="button" title="My profile" onClick={() => void nav('/profile')}>{user ? initials(user.displayName) : '?'}</button>
          </div>
        </header>
        {!mdFull && page && <Band page={page} />}
        <Outlet />
        {!mdFull && <footer className="foot"><span>© 2026 PT Hirose Electric Indonesia · Kaizen × Molding</span><span>Molding Dashboard · v{APP_VERSION}</span></footer>}
      </div>
      {kiosk && <KioskBar onExit={() => setKiosk(false)} />}
    </div>
  );
}

function SourceIndicator() {
  const { source } = useFilters();
  if (source.phase === 'idle') return null;
  let cls = '', txt: string;
  if (source.phase === 'loading') { cls = ' w'; txt = 'Memuat data…'; }
  else if (source.phase === 'error') { cls = ' e'; txt = 'Gagal memuat'; }
  else if (source.state === 'unavailable') { cls = ' e'; txt = 'Sumber tidak tersedia'; }
  else if (source.freshness === 'stale') { cls = ' w'; txt = `Data tertunda · ${timeAgo(source.sourceUpdatedAt ?? null)}`; }
  else if (source.freshness === 'current') txt = `Sumber normal · ${timeAgo(source.sourceUpdatedAt ?? null)}`;
  else txt = `Histori · update ${timeAgo(source.sourceUpdatedAt ?? null)}`;
  return <span className={`conn${cls}`} role="status" aria-live="polite"><i aria-hidden="true" /><span>{txt}</span></span>;
}

function Band({ page }: { page: PageMeta }) {
  const { f, setF, applyPreset, reset } = useFilters();
  const [pop, setPop] = useState(false);
  const [from, setFrom] = useState(f.from);
  const [to, setTo] = useState(f.to);
  const [q, setQ] = useState(f.q);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setFrom(f.from); setTo(f.to); }, [f.from, f.to]);
  useEffect(() => setQ(f.q), [f.q]);
  useEffect(() => { const t = setTimeout(() => q !== f.q && setF({ q }), 200); return () => clearTimeout(t); }, [q, f.q, setF]);
  useEffect(() => {
    if (!pop) return;
    const close = (e: MouseEvent) => { if (!popRef.current?.contains(e.target as Node)) setPop(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPop(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [pop]);
  const today = productionToday();
  const shiftLbl = (s: number) => `Shift ${s} · ${hh([6, 14, 22][s - 1]!)}–${hh([14, 22, 6][s - 1]!)}`;
  return (
    <section className="band">
      <div className="bh">
        <h1>{page.title}</h1>
        <div className="bmeta">{page.filtered && <span>Shifts 06–14 · 14–22 · 22–06</span>}</div>
        <p>{page.sub}</p>
      </div>
      {page.filtered && (
        <div className="filters">
          <div className="f" style={{ position: 'relative' }} ref={popRef}>
            <span className="fl">Period</span>
            <button className="fin pbtn" type="button" aria-haspopup="dialog" aria-expanded={pop} onClick={() => setPop((p) => !p)}>
              <span><b>{f.preset === 'custom' ? 'Custom range' : PRESETS[f.preset]}</b> <span className="mono mu">{rangeTxt(f.from, f.to)}</span></span><span aria-hidden="true">▾</span>
            </button>
            <div className={`pop${pop ? ' open' : ''}`} role="dialog" aria-label="Period">
              <div>
                {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => (
                  <button key={k} type="button" className={`po${f.preset === k ? ' on' : ''}`} onClick={() => { applyPreset(k); setPop(false); }}>{PRESETS[k]}</button>
                ))}
              </div>
              <div className="pc">
                <label>From<input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></label>
                <label>To<input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
                <button className="btn pri" type="button" disabled={!from || !to} onClick={() => {
                  const [a, b] = from <= to ? [from, to] : [to, from];
                  setF({ from: a, to: b > today ? today : b, preset: 'custom' });
                  setPop(false);
                }}>Apply custom range</button>
              </div>
            </div>
          </div>
          <div className="f"><label htmlFor="fShift">Shift</label>
            <select className="fin" id="fShift" value={f.shift} onChange={(e) => setF({ shift: e.target.value as typeof f.shift })}>
              <option value="">All shifts</option>{[1, 2, 3].map((s) => <option key={s} value={String(s)}>{shiftLbl(s)}</option>)}
            </select>
          </div>
          <div className="f"><label htmlFor="fStatus">Status capaian</label>
            <select className="fin" id="fStatus" value={f.status} onChange={(e) => setF({ status: e.target.value as typeof f.status })}>
              <option value="">All machines</option><option value="attention">Perlu perhatian</option><option value="within">Dalam batas capaian</option><option value="unknown">Capaian belum tersedia</option>
            </select>
          </div>
          <div className="f"><label htmlFor="fSearch">Machine / part</label><input className="fin" id="fSearch" placeholder="Search MC No or part…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="f"><span className="fl">&nbsp;</span><button className="reset" type="button" onClick={reset}>Reset</button></div>
        </div>
      )}
    </section>
  );
}

/** Kiosk / TV mode for a signed-in user: rotates allowed monitoring pages (Q-022 default). */
function KioskBar({ onExit }: { onExit: () => void }) {
  const { settings, can } = useSession();
  const nav = useNavigate();
  const pages = settings.kiosk.pages.map((k) => PAGES.find((p) => p.key === k)).filter((p): p is PageMeta => !!p && (!p.perm || can(p.perm)));
  const list = pages.length ? pages : PAGES.slice(0, 1);
  const [i, setI] = useState(0);
  const [t, setT] = useState(0);
  const sec = settings.kiosk.sec;
  useEffect(() => { void nav(list[0]!.path); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const iv = setInterval(() => setT((x) => x + 0.25), 250);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    if (t < sec) return;
    const n = (i + 1) % list.length;
    setI(n);
    setT(0);
    void nav(list[n]!.path);
  }, [t, sec, i, list, nav]);
  useEffect(() => {
    const kz = Math.min(1.7, Math.max(1.15, innerWidth / 1366));
    document.body.style.setProperty('--kz', kz.toFixed(2));
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onExit();
    addEventListener('keydown', esc);
    return () => { removeEventListener('keydown', esc); document.body.style.removeProperty('--kz'); };
  }, [onExit]);
  return (
    <div className="kbar">
      <div className="kdots">{list.map((p, j) => <span key={p.key} className={j === i ? 'on' : ''}>{j + 1} · {p.title}</span>)}</div>
      <div className="kprog"><i style={{ width: `${(t / sec) * 100}%` }} /></div>
      <span className="mu">Next page in {Math.ceil(sec - t)}s</span>
      <button className="btn" type="button" onClick={onExit}>Exit kiosk</button>
    </div>
  );
}
