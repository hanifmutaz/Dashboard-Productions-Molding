import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MachineListView, MachineSummary, ViewDataEnvelope } from '@mpd/contracts';
import { api, qs } from '../lib/api';
import { useReportSource } from '../lib/filters';
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
    queryFn: () => api.get<ViewDataEnvelope<MachineListView>>(`/api/v1/machines?${qs({ date })}`),
    refetchInterval: settings.data.refresh * 60_000,
    placeholderData: (prev) => prev,
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
  const tg = s.tgt.beki, b = m.bekidoritsu.value;
  if (!m.hasRecord || b === null) {
    return (
      <button type="button" className="mdc off" style={{ ['--sc' as string]: 'var(--line-2)' }} onClick={onOpen}>
        <div className="h"><b>MC {m.machineNo}</b><span className="chip">{m.hasRecord ? 'Plan = 0' : 'No data'}</span></div>
        <div className="p">{m.productName ?? '—'}</div>
        <div className="gw"><Gauge v={0} tg={tg} col="" /><div className="gv"><span className="fa">—</span><small>{m.hasRecord ? m.bekidoritsu.reason : 'Tidak ada catatan produksi'}</small></div></div>
        <div className="mf"><div><span>OEE</span>—</div><div><span>Stop</span>{m.stopMinutes == null ? '—' : <b>{fmt(m.stopMinutes)}<i> min</i></b>}</div><div><span>Reject</span>{fmt(m.reject)}</div></div>
      </button>
    );
  }
  const c = cls(b, 'beki', s), col = colOf(c);
  return (
    <button type="button" className="mdc" style={{ ['--sc' as string]: col }} onClick={onOpen} title={`Open dashboard MC ${m.machineNo}`}>
      <div className="h"><b>MC {m.machineNo}</b><span className={`chip ${c === 'ok' ? 'good' : c === 'mid' ? 'warn' : 'bad'}`}>{c === 'ok' ? 'On target' : c === 'mid' ? 'Below' : 'Far below'} · {(b - tg >= 0 ? '+' : '−') + f1(Math.abs(b - tg))} pt</span></div>
      <div className="p">{m.productName}</div>
      <div className="gw"><Gauge v={b} tg={tg} col={col} /><div className="gv"><span style={{ color: col }}>{f1(b)}<i>%</i></span><small>Bekidoritsu</small></div></div>
      <div className="mf"><div><span>OEE</span><b title={m.oee.reason ?? undefined}>—</b></div><div><span>Stop</span><b>{fmt(m.stopMinutes)}<i> min</i></b></div><div><span>Reject</span><b>{fmt(m.reject)}</b></div></div>
    </button>
  );
}

export function MachineListPage() {
  const { settings: s } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const date = sp.get('date');
  const q = useMachineList(date);
  useReportSource(q.data, q.isPending, q.isError);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'mc' | 'low'>(s.md.sort);
  useEffect(() => setSort(s.md.sort), [s.md.sort]);
  const v = q.data?.data ?? null;
  const run = v?.machines.filter((m) => m.hasRecord) ?? [];
  const below = run.filter((m) => cls(m.bekidoritsu.value, 'beki', s) !== 'ok');
  let list = (v?.machines ?? []).filter((m) => !search || `mc ${m.machineNo} mc${m.machineNo} ${m.productName ?? ''} ${m.dpNo ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  if (sort === 'low') list = [...list].sort((a, b) => (a.bekidoritsu.value ?? 1e3) - (b.bekidoritsu.value ?? 1e3));
  const setDate = (d: string) => setSp({ date: d });
  return (
    <section className="view on">
      <div className="content">
        <EnvelopeBanner env={q.data} error={q.error} />
        {!v ? <div className="card empty" role="status">{q.isPending ? 'Memuat daftar mesin…' : 'Sumber data tidak tersedia. Angka mesin disembunyikan.'}</div> : (
          <>
            <div className="card"><div className="strip-note">
              <span><span className="dot" style={{ background: 'var(--primary)' }} /><b>{run.length}</b> dari {v.machines.length} mesin dengan catatan produksi (bukan status Running) · <b className={below.length ? 'bad' : 'good'}>{below.length}</b> di bawah target Bekidoritsu {s.tgt.beki}% · pilih mesin untuk membuka dashboard</span>
              <span className="mdtools">
                <span className="mdday">
                  <button className="btn" type="button" aria-label="Previous day" disabled={!v.prevDate} onClick={() => v.prevDate && setDate(v.prevDate)}>‹</button>
                  <b className="mono">{DOW[pd(v.date).getUTCDay()]} {lblY(v.date)}</b>
                  <button className="btn" type="button" aria-label="Next day" disabled={!v.nextDate} onClick={() => v.nextDate && setDate(v.nextDate)}>›</button>
                </span>
                <input className="srch" placeholder="Search MC or part…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 'var(--s-size-190)', margin: 0 }} aria-label="Search machine" />
                <Seg value={sort} onChange={setSort} items={[{ id: 'mc', label: 'MC no.' }, { id: 'low', label: 'Lowest first' }]} />
              </span>
            </div></div>
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
  const { settings } = useSession();
  const { machineNo = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const ipad = sp.get('ipad') === '1';
  const date = sp.get('date');
  const list = useMachineList(date);
  useEffect(() => {
    document.body.classList.toggle('md-ipad', ipad);
    return () => document.body.classList.remove('md-ipad');
  }, [ipad]);
  const set = (o: Record<string, string | null>) => setSp(qs({ date, ipad: ipad ? '1' : null, ...o }));
  return (
    <section className="view on" id="v-detail">
      <MachineDashboard machineNo={machineNo} date={date} settings={settings} ipad={ipad}
        machines={list.data?.data?.machines.map((m) => m.machineNo)}
        onMachine={(mc) => void nav(`/machines/${encodeURIComponent(mc)}?${qs({ date, ipad: ipad ? '1' : null })}`)}
        onDate={(d) => set({ date: d })} onBack={() => void nav(`/machines?${qs({ date })}`)} onIpad={(on) => set({ ipad: on ? '1' : null })} />
    </section>
  );
}
