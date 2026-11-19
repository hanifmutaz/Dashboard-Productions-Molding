import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MachineListView, MachineSummary, Settings, ViewDataEnvelope } from '@mpd/contracts';
import { api, qs } from '../lib/api';
import { useFilters, useReportSource } from '../lib/filters';
import { useSession } from '../lib/session';
import { cls, colOf } from '../lib/status';
import { DOW, f1, fmt, lblY, pd } from '../lib/format';
import { Seg } from '../components/ui';
import { EnvelopeBanner } from '../components/state';
import { MachineDashboard } from '../features/machine-detail/MachineDetail';

function useMachineList(date: string | null) {
  const { settings } = useSession();
  return useQuery({
    queryKey: ['machines', date],
    queryFn: ({ signal }) => api.get<ViewDataEnvelope<MachineListView>>(`/api/v1/machines?${qs({ date })}`, signal),
    refetchInterval: settings.data.refresh * 60_000,
  });
}

function Gauge({ v, tg, col }: { v: number; tg: number; col: string }) {
  const r = 50, cx = 60, cy = 60;
  const pt = (p: number, rr: number) => { const a = Math.PI * (1 - Math.min(100, Math.max(0, p)) / 100); return [(cx + rr * Math.cos(a)).toFixed(1), (cy - rr * Math.sin(a)).toFixed(1)]; };
  const [a1, b1] = pt(tg, r - 9), [a2, b2] = pt(tg, r + 9), arc = `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <svg viewBox="0 0 120 66" aria-hidden="true">
      <path d={arc} pathLength={100} fill="none" stroke="var(--line)" strokeWidth={8} strokeLinecap="round" />
      {v > 0 && <path d={arc} pathLength={100} fill="none" stroke={col} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${Math.min(100, v).toFixed(1)} 200`} />}
      <line x1={a1} y1={b1} x2={a2} y2={b2} stroke="var(--ink)" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

function Card({ m, onOpen }: { m: MachineSummary; onOpen: () => void }) {
  const { settings: s } = useSession();
  const target = s.tgt.beki;
  const beki = m.hasRecord ? m.bekidoritsu.value : null;
  const status = cls(beki, 'beki', s);
  const color = beki === null ? 'var(--line-2)' : colOf(status);
  const badgeTone = beki === null ? '' : status === 'ok' ? 'good' : status === 'mid' ? 'warn' : 'bad';
  const badgeLabel = beki === null
    ? (m.hasRecord ? 'Capaian belum tersedia' : 'No data')
    : (status === 'ok' ? 'On target' : status === 'mid' ? 'Below' : 'Far below') + ' · '
      + (beki >= target ? '+' : '−') + f1(Math.abs(beki - target)) + ' pt';
  const dataNote = !m.hasRecord ? 'Tidak ada catatan produksi'
    : beki === null ? m.bekidoritsu.reason : null;

  return (
    <button type="button" className={beki === null ? 'mdc off' : 'mdc'} style={{ ['--sc' as string]: color }}
      onClick={onOpen} title={'Open dashboard MC ' + m.machineNo}>
      <div className="h">
        <b>MC {m.machineNo}</b>
        <span className={'chip ' + badgeTone}>{badgeLabel}</span>
      </div>
      <div className="p" title={m.productName ?? undefined}>{m.productName ?? '—'}</div>
      <div className="gw">
        <Gauge v={beki ?? 0} tg={target} col={color} />
        <div className="gv">
          {beki === null ? <span className="fa">—</span> : <span style={{ color }}>{f1(beki)}<i>%</i></span>}
          <small>Bekidoritsu</small>
        </div>
      </div>
      <small className="mdc-data-note">{dataNote}</small>
      <div className="mf">
        <div><span>OEE</span><b title={m.oee.reason ?? undefined}>{m.oee.value === null ? '—' : <>{f1(m.oee.value)}<i>%</i></>}</b></div>
        <div><span>Stop</span><b>{m.stopMinutes == null ? '—' : <>{fmt(m.stopMinutes)}<i> min</i></>}</b></div>
        <div><span>Reject</span><b>{fmt(m.reject)}</b></div>
      </div>
    </button>
  );
}

type Status = 'all' | 'ok' | 'mid' | 'lo' | 'none';
type Sort = 'mc' | 'low' | 'high' | 'oee' | 'stop' | 'reject';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'mc', label: 'MC no.' }, { id: 'low', label: 'Lowest first' }, { id: 'high', label: 'Highest first' },
  { id: 'oee', label: 'Lowest OEE' }, { id: 'stop', label: 'Most stop time' }, { id: 'reject', label: 'Most reject' },
];
const KEY = 'mpd.machines.filters';
/** Filters survive opening a machine and coming back (same browser tab only). */
function loadFilters(): { q: string; status: Status; sort: Sort | null } {
  try {
    const o = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Partial<{ q: string; status: Status; sort: Sort }>;
    return { q: typeof o.q === 'string' ? o.q : '', status: (['all', 'ok', 'mid', 'lo', 'none'] as const).includes(o.status as Status) ? o.status! : 'all', sort: SORTS.some((x) => x.id === o.sort) ? o.sort! : null };
  } catch { return { q: '', status: 'all', sort: null }; }
}
const statusOf = (m: MachineSummary, s: Settings): Exclude<Status, 'all'> => {
  if (!m.hasRecord || m.bekidoritsu.value === null) return 'none';
  const c = cls(m.bekidoritsu.value, 'beki', s);
  return c === 'ok' || c === 'mid' || c === 'lo' ? c : 'none';
};
const BIG = 1e9;
const SORT_FN: Record<Sort, (a: MachineSummary, b: MachineSummary) => number> = {
  mc: () => 0,
  low: (a, b) => (a.bekidoritsu.value ?? BIG) - (b.bekidoritsu.value ?? BIG),
  high: (a, b) => (b.bekidoritsu.value ?? -1) - (a.bekidoritsu.value ?? -1),
  oee: (a, b) => (a.oee.value ?? BIG) - (b.oee.value ?? BIG),
  stop: (a, b) => (b.stopMinutes ?? -1) - (a.stopMinutes ?? -1),
  reject: (a, b) => (b.reject ?? -1) - (a.reject ?? -1),
};

export function MachineListPage() {
  const { settings: s } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { today } = useFilters();
  const date = sp.get('date') ?? today;
  const q = useMachineList(date);
  useReportSource(q.data, q.isPending, q.isError);
  const [init] = useState(loadFilters);
  const [search, setSearch] = useState(init.q);
  const [status, setStatus] = useState<Status>(init.status);
  const [sort, setSort] = useState<Sort>(init.sort ?? s.md.sort);
  // The Settings default only applies until the user picks a sort themselves.
  const [picked, setPicked] = useState(init.sort !== null);
  useEffect(() => { if (!picked) setSort(s.md.sort); }, [s.md.sort, picked]);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify({ q: search, status, sort: picked ? sort : null })); } catch { /* storage unavailable: filters just reset */ } }, [search, status, sort, picked]);
  const v = q.data?.data ?? null;
  const all = v?.machines ?? [];
  const run = all.filter((m) => m.hasRecord);
  const below = run.filter((m) => m.bekidoritsu.value !== null && m.bekidoritsu.value < s.tgt.beki);
  const unknown = run.filter((m) => m.bekidoritsu.value === null).length;
  const count = (st: Status) => (st === 'all' ? all.length : all.filter((m) => statusOf(m, s) === st).length);
  const text = search.trim().toLowerCase();
  let list = all.filter((m) => (status === 'all' || statusOf(m, s) === status) && (!text || `mc ${m.machineNo} mc${m.machineNo} ${m.productName ?? ''} ${m.dpNo ?? ''}`.toLowerCase().includes(text)));
  if (sort !== 'mc') list = [...list].sort(SORT_FN[sort]);
  const filtered = status !== 'all' || !!text;
  const reset = () => { setSearch(''); setStatus('all'); };
  const setDate = (d: string) => setSp({ date: d });
  return (
    <section className="view on">
      <div className="content">
        <EnvelopeBanner env={q.data} error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
        {!v ? <div className="card empty" role="status">{q.isPending ? 'Memuat daftar mesin…' : 'Sumber data tidak tersedia. Angka mesin disembunyikan.'}</div> : (
          <>
            <div className="card"><div className="strip-note">
              <span><span className="dot" style={{ background: 'var(--primary)' }} /><b>{run.length}</b> dari {v.machines.length} mesin dengan catatan produksi (bukan status Running) · <b className={below.length ? 'bad' : 'good'}>{below.length}</b> di bawah target Bekidoritsu {s.tgt.beki}% · {unknown} capaian belum tersedia · pilih mesin untuk membuka dashboard</span>
              <span className="mdtools">
                <span className="mdday">
                  <button className="btn" type="button" aria-label="Previous day" disabled={!v.prevDate} onClick={() => v.prevDate && setDate(v.prevDate)}>‹</button>
                  <b className="mono">{DOW[pd(v.date).getUTCDay()]} {lblY(v.date)}</b>
                  <button className="btn" type="button" aria-label="Next day" disabled={!v.nextDate} onClick={() => v.nextDate && setDate(v.nextDate)}>›</button>
                </span>
              </span>
            </div>
            <div className="mdfilter" role="search">
              <input className="srch" placeholder="Search MC or part…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search machine" />
              <span className="mdstatus"><Seg value={status} onChange={setStatus} items={[
                { id: 'all', label: `All ${count('all')}` }, { id: 'ok', label: `On target ${count('ok')}` }, { id: 'mid', label: `Below ${count('mid')}` },
                { id: 'lo', label: `Far below ${count('lo')}` }, { id: 'none', label: `No data ${count('none')}` },
              ]} /></span>
              <label className="mdsort"><span>Sort</span>
                <select value={sort} aria-label="Sort machines" onChange={(e) => { setPicked(true); setSort(e.target.value as Sort); }}>{SORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
              {filtered && <button className="btn" type="button" onClick={reset}>Reset</button>}
            </div></div>
            {filtered && <div className="mdcount" role="status">Showing <b>{list.length}</b> of {all.length} machines</div>}
            <div className="mdgrid">
              {list.length ? list.map((m) => <Card key={m.machineNo} m={m} onOpen={() => void nav(`/machines/${encodeURIComponent(m.machineNo)}?${qs({ date: v.date })}`)} />) : <div className="card empty">No machine matches</div>}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function MachineDetailPage() {
  const { today } = useFilters();
  const { settings } = useSession();
  const { machineNo = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const ipad = sp.get('ipad') === '1';
  const date = sp.get('date');
  const list = useMachineList(date ?? today);
  useEffect(() => {
    document.body.classList.toggle('md-ipad', ipad);
    return () => document.body.classList.remove('md-ipad');
  }, [ipad]);
  const set = (o: Record<string, string | null>) => setSp(qs({ date, ipad: ipad ? '1' : null, ...o }));
  return (
    <section className="view on" id="v-detail">
      <MachineDashboard machineNo={machineNo} date={date ?? today} settings={settings} ipad={ipad}
        machines={list.data?.data?.machines.map((m) => m.machineNo)}
        onMachine={(mc) => void nav(`/machines/${encodeURIComponent(mc)}?${qs({ date, ipad: ipad ? '1' : null })}`)}
        onDate={(d) => set({ date: d })} onBack={() => void nav(`/machines?${qs({ date })}`)} onIpad={(on) => set({ ipad: on ? '1' : null })} />
    </section>
  );
}
