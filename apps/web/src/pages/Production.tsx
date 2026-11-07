import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS, type MachineProduction, type ProductionView, type ViewDataEnvelope } from '@mpd/contracts';
import { api, qs } from '../lib/api';
import { useFilters, useReportSource } from '../lib/filters';
import { useSession } from '../lib/session';
import { cls, colOf, delta, mv, Pc } from '../lib/status';
import { DOW, f1, fmt, lbl, lblY, pd } from '../lib/format';
import { rangeTxt } from '../lib/period';
import { BarList, Chart, RankList } from '../components/charts';
import { EmptyDeck, Kpi, SkelDeck } from '../components/kpi';
import { DataTable, downloadCsv, type Col } from '../components/table';
import { Menu, MenuCheck, MenuItem, Tabs, useToast } from '../components/ui';
import { EnvelopeBanner, emptyMsg } from '../components/state';
import { RateModal, type RateTarget } from './RateModal';

export function useMonitoring<T>(path: string, extra: Record<string, string | undefined> = {}) {
  const { f } = useFilters();
  const { settings } = useSession();
  const q = useQuery({
    queryKey: [path, f.from, f.to, f.shift, f.status, f.q, extra],
    queryFn: () => api.get<ViewDataEnvelope<T>>(`/api/v1/monitoring/${path}?${qs({ from: f.from, to: f.to, shift: f.shift || undefined, status: f.status || undefined, q: f.q || undefined, ...extra })}`),
    refetchInterval: settings.data.refresh * 60_000,
    placeholderData: (prev) => prev,
  });
  useReportSource(q.data, q.isPending, q.isError);
  return q;
}

const PCOLS: { k: string; h: string; n?: boolean; fix?: boolean }[] = [
  { k: 'machineNo', h: 'Machine', fix: true }, { k: 'productName', h: 'Part', fix: true }, { k: 'plan', h: 'Prod. plan', n: true, fix: true },
  { k: 'actual', h: 'Actual', n: true, fix: true }, { k: 'bekidoritsu', h: 'Bekidoritsu', n: true, fix: true }, { k: 'deviation', h: 'Deviation', n: true, fix: true },
  { k: 'reject', h: 'Reject', n: true, fix: true }, { k: 'sharePct', h: 'Share of output', n: true }, { k: 'rejectPct', h: 'Reject %', n: true },
  { k: 'ipr', h: 'RIP (ppm)', n: true }, { k: 'stopMinutes', h: 'Stop min', n: true },
];

export function ProductionPage() {
  const { settings: s, prefs, savePrefs, can } = useSession();
  const { f } = useFilters();
  const toast = useToast();
  const q = useMonitoring<ProductionView>('production');
  const [tab, setTab] = useState<'prod-0' | 'prod-1' | 'prod-2'>('prod-0');
  const [more, setMore] = useState(false);
  const [rate, setRate] = useState<RateTarget | null>(null);
  const env = q.data, v = env?.data ?? null;
  const t = v?.totals, p = v?.previous;
  const vs = p ? <span className="fa">vs previous {v?.range.days} days</span> : null;

  const cols: Col<MachineProduction>[] = PCOLS.filter((c) => c.fix || prefs.cols.includes(c.k)).map((c) => ({
    k: c.k, h: c.h, n: c.n, cl: c.k === 'productName' ? 'mu' : c.n ? 'm' : '',
    sv: (m) => { const x = (m as unknown as Record<string, unknown>)[c.k]; return typeof x === 'object' && x ? mv(x as { value: number | null; reason: string | null }) : (x as number | string | null); },
    f: (m) => {
      switch (c.k) {
        case 'machineNo': return <><span className="chev">›</span> <span className="mc">MC {m.machineNo}</span></>;
        case 'productName': return m.productName ?? '—';
        case 'bekidoritsu': return <Pc m={m.bekidoritsu} k="beki" s={s} onClick={() => setRate({ machineNo: m.machineNo, label: `MC ${m.machineNo} · ${m.productName ?? ''}` })} />;
        case 'deviation': return <span className={m.deviation < 0 ? 'bad' : 'good'}>{m.deviation < 0 ? '−' : '+'}{fmt(Math.abs(m.deviation))}</span>;
        case 'sharePct': return m.sharePct.value === null ? '—' : f1(m.sharePct.value) + '%';
        case 'rejectPct': return m.rejectPct.value === null ? '—' : f1(m.rejectPct.value) + '%';
        case 'ipr': return fmt(m.ipr.value);
        default: return fmt((m as unknown as Record<string, number | null>)[c.k]);
      }
    },
  }));

  const msg = emptyMsg(env);
  const offs = v ? v.daily.map((d, i) => (d.plan ? -1 : i)).filter((i) => i >= 0) : [];
  const tipD = (i: number) => { const d = v!.daily[i]!.date; return `${DOW[pd(d).getUTCDay()]} ${lblY(d)}`; };
  const worst = v ? [...v.machines].filter((m) => m.bekidoritsu.value !== null).sort((a, b) => a.bekidoritsu.value! - b.bekidoritsu.value!)[0] : undefined;
  const exportCsv = () => {
    if (!v) return;
    downloadCsv(`molding_production_${f.from}_${f.to}.csv`, [
      ['Machine', 'DP Part', 'DP Name', 'Production plan', 'Production actual', 'Bekidoritsu %', 'Deviation', 'Reject', 'Reject %', 'RIP ppm', 'Reject names', 'Stop min'],
      ...v.machines.map((m) => ['MC ' + m.machineNo, m.dpNo, m.productName, m.plan, m.actual, f1(m.bekidoritsu.value), m.deviation, m.reject, f1(m.rejectPct.value), m.ipr.value === null ? '' : Math.round(m.ipr.value), m.rejects.map((r) => `${r.name}:${r.qty}`).join(' | '), m.stopMinutes]),
    ]);
    toast(`Exported production ${f.from}_${f.to}`);
  };

  return (
    <section className="view on">
      <div className="content">
        <EnvelopeBanner env={env} error={q.error} />
        <div className="deck">
          {q.isPending ? <SkelDeck n={4} /> : !t ? <EmptyDeck labels={['Production plan', 'Production actual', 'Bekidoritsu', 'Deviation']} msg={msg} /> : (
            <>
              <Kpi l="Production plan" v={fmt(t.plan)} u="pcs" d={<>{delta(t.plan, p?.plan, 'flat')} {vs}</>} />
              <Kpi l="Production actual" v={fmt(t.actual)} u="pcs" d={<>{delta(t.actual, p?.actual, 'flat')} {vs}</>} />
              <Kpi l="Bekidoritsu" v={f1(t.bekidoritsu.value)} u="%" title={t.bekidoritsu.reason ?? undefined} d={<>{delta(t.bekidoritsu.value, p?.bekidoritsu.value, 'up', true)} {vs}</>} g={{ v: t.bekidoritsu.value, k: 'beki' }} onClick={() => setRate({ machineNo: null, label: 'All machines in filter' })} />
              <Kpi l="Deviation" v={(t.deviation < 0 ? '−' : '+') + fmt(Math.abs(t.deviation))} u="pcs" vc={t.deviation < 0 ? 'var(--bad)' : 'var(--good)'} desc="Production actual − plan" d={<>{delta(t.deviation, p?.deviation, 'up')} {vs}</>} />
            </>
          )}
        </div>
        <div className="card">
          <div className="strip-note">
            <span>{worst ? <><span className="dot" style={{ background: 'var(--bad)' }} />Lowest achievement: <b>MC {worst.machineNo}</b> at <b className="bad">{f1(worst.bekidoritsu.value)}%</b>, {fmt(-worst.deviation)} pcs below plan.</> : msg}</span>
            <span style={{ display: 'flex', gap: 'var(--s-size-14)', alignItems: 'center' }}>
              <span className="fa" style={{ fontSize: 'var(--s-size-12)' }}>Targets in Settings</span>
              <button className="lnk" type="button" aria-expanded={more} onClick={() => setMore((x) => !x)}>{more ? 'Show fewer metrics' : 'Show more metrics'}</button>
            </span>
          </div>
          <div className={`more${more ? ' open' : ''}`}>
            {([
              ['Production gross', fmt(t?.gross), 'pcs', delta(t?.gross, p?.gross, 'up')],
              ['Reject', fmt(t?.reject), `pcs · ${fmt(t?.ipr.value)} ppm`, delta(t?.reject, p?.reject, 'down')],
              ['Sales', '—', 'belum disetujui (Q-009)', <span className="fa" key="s">—</span>],
              ['Scrap', '—', 'belum disetujui (Q-009)', <span className="fa" key="c">—</span>],
            ] as [string, string, string, ReactNode][]).map((x) => (
              <div key={x[0]}><div className="caps">{x[0]}</div><div className="v">{x[1]}<small>{x[2]}</small></div><div className="d">{x[3]}</div></div>
            ))}
          </div>
        </div>
        <Tabs value={tab} onChange={setTab} items={[{ id: 'prod-0', label: 'Daily trend' }, { id: 'prod-1', label: 'By machine' }, { id: 'prod-2', label: 'Ranking' }]} />
        {tab === 'prod-0' && (
          <div className="pane on"><div className="card">
            <div className="ch"><div><h3>Production plan vs actual per day</h3><p>{v ? `${rangeTxt(v.range.from, v.range.to)} · average ${fmt(v.daily.filter((d) => d.plan).length ? v.totals.plan / v.daily.filter((d) => d.plan).length : 0)} pcs planned per production day` : msg}</p></div>
              <div className="legend"><span><i style={{ background: 'var(--plan)' }} />Production plan</span><span><i style={{ background: 'var(--act)' }} />Production actual</span><span><i style={{ background: 'var(--line-2)' }} />No production</span></div></div>
            <div className="cb">
              {v ? (
                <>
                  <Chart aria="Daily production plan versus actual" labels={v.daily.map((d) => lbl(d.date))} off={offs} h={230} bw={18} tipT={tipD}
                    bars={[{ name: 'Production plan', col: 'var(--plan)', vals: v.daily.map((d) => d.plan) }, { name: 'Production actual', col: 'var(--act)', vals: v.daily.map((d) => d.actual) }]}
                    tipX={(i) => (v.daily[i]!.plan ? [{ label: 'Deviation', value: fmt(v.daily[i]!.actual - v.daily[i]!.plan) }] : [{ label: 'No production planned', value: '' }])} />
                  <div className="subh">Bekidoritsu per day <span>target {s.tgt.beki}%{offs.length ? ' · shaded = no production day' : ''}</span></div>
                  <Chart aria="Daily Bekidoritsu versus target" labels={v.daily.map((d) => lbl(d.date))} off={offs} yMax={120} yFmt={(x) => Math.round(x) + '%'} h={160} tipT={tipD}
                    bars={[{ name: '', vals: v.daily.map(() => null) }]} target={s.tgt.beki} targetLbl={`Target ${s.tgt.beki}%`}
                    line={{ name: 'Bekidoritsu', col: 'var(--ratio)', fmt: (x) => f1(x) + '%', vals: v.daily.map((d) => d.bekidoritsu.value) }} />
                  <details style={{ marginTop: 'var(--s-size-10)' }}>
                    <summary className="lnk" style={{ cursor: 'pointer' }}>Show daily figures</summary>
                    <div className="tw" style={{ marginTop: 'var(--s-size-8)', border: 'var(--s-size-1) solid var(--line)', borderRadius: 'var(--r-sm)' }}>
                      <table>
                        <thead><tr><th className="nos">Date</th>{v.daily.map((d) => <th key={d.date} className="nos n">{lbl(d.date)}<br /><span className="fa" style={{ fontWeight: 'var(--c-font-weight-500)' }}>{DOW[pd(d.date).getUTCDay()]}</span></th>)}<th className="nos n">Total</th></tr></thead>
                        <tbody>
                          <tr><td>Production plan</td>{v.daily.map((d) => <td key={d.date} className="n">{d.plan ? fmt(d.plan) : <span className="fa">off</span>}</td>)}<td className="n"><b>{fmt(v.totals.plan)}</b></td></tr>
                          <tr><td>Production actual</td>{v.daily.map((d) => <td key={d.date} className="n">{d.actual ? fmt(d.actual) : '—'}</td>)}<td className="n"><b>{fmt(v.totals.actual)}</b></td></tr>
                          <tr><td>Bekidoritsu</td>{v.daily.map((d) => <td key={d.date} className="n"><Pc m={d.bekidoritsu} k="beki" s={s} /></td>)}<td className="n"><Pc m={v.totals.bekidoritsu} k="beki" s={s} /></td></tr>
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              ) : <div className="empty">{msg}</div>}
            </div>
          </div></div>
        )}
        {tab === 'prod-1' && (
          <div className="pane on"><div className="card">
            <div className="ch"><div><h3>Machine breakdown</h3><p>Click a row (›) for reject detail · click a percentage for daily data</p></div>
              <div style={{ display: 'flex', gap: 'var(--s-size-8)' }}>
                <Menu label="Columns ▾">
                  <div className="caps" style={{ padding: 'var(--s-size-6) var(--s-size-10)' }}>Extra columns</div>
                  {PCOLS.filter((c) => !c.fix).map((c) => (
                    <MenuCheck key={c.k} checked={prefs.cols.includes(c.k)} onChange={(on) => void savePrefs({ ...prefs, cols: on ? [...prefs.cols, c.k] : prefs.cols.filter((x) => x !== c.k) })}>{c.h}</MenuCheck>
                  ))}
                </Menu>
                {can(PERMISSIONS.exportProduction) && (
                  <Menu label="Export ▾"><MenuItem onSelect={exportCsv}>Excel / CSV (filtered)</MenuItem><MenuItem onSelect={() => print()}>Print / PDF</MenuItem></Menu>
                )}
              </div>
            </div>
            <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
              <DataTable wrapClass="tw st1" cols={cols} rows={v?.machines ?? []} rowKey={(m) => m.machineNo} sort={{ k: 'bekidoritsu', asc: true }} empty={msg || 'No data for this filter'}
                expand={(m) => (
                  <div className="exl">
                    <div className="h">Reject detail · {m.rejects.length} types · {fmt(m.reject)} pcs · {fmt(m.ipr.value)} ppm</div>
                    {m.rejects.length ? m.rejects.map((r) => (
                      <span key={r.name} style={{ display: 'contents' }}><span>{r.name}</span><span className="n">{fmt(r.qty)}</span><span className="n mu">{m.reject ? f1((r.qty / m.reject) * 100) + '%' : '—'}</span></span>
                    )) : <span className="mu">No reject in this period</span>}
                  </div>
                )} />
            </div>
          </div></div>
        )}
        {tab === 'prod-2' && (
          <div className="pane on"><div className="g2e">
            <div className="card"><div className="ch"><div><h3>Bekidoritsu by machine</h3><p>Lowest first · click a machine for daily data</p></div></div>
              <div className="cb"><div className="bl scroll" style={{ maxHeight: 'var(--s-size-470)' }}>
                <BarList max={110} kw="var(--s-size-62)" vw="var(--s-size-70)" empty={msg || 'No data'} items={[...(v?.machines ?? [])].sort((a, b) => (a.bekidoritsu.value ?? 0) - (b.bekidoritsu.value ?? 0)).map((m) => {
                  const c = cls(m.bekidoritsu.value, 'beki', s);
                  return { k: 'MC ' + m.machineNo, v: m.bekidoritsu.value ?? 0, c: colOf(c), vc: colOf(c), l: m.bekidoritsu.value === null ? '—' : (c === 'lo' ? '▼ ' : '') + f1(m.bekidoritsu.value) + '%', onClick: () => setRate({ machineNo: m.machineNo, label: `MC ${m.machineNo} · ${m.productName ?? ''}` }),
                    tip: { title: `MC ${m.machineNo}`, rows: [{ label: m.productName ?? '', value: '' }, { label: 'Plan', value: fmt(m.plan) }, { label: 'Actual', value: fmt(m.actual) }, { label: 'Bekidoritsu', value: f1(m.bekidoritsu.value) + '%' }] } };
                })} />
              </div></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-size-14)' }}>
              <div className="card"><div className="ch"><h3>Output ranking</h3></div><div className="cb"><div className="g2e" style={{ gap: 'var(--s-size-18)' }}>
                <div><div className="caps" style={{ marginBottom: 'var(--s-size-6)' }}>Highest</div><RankList rows={[...(v?.machines ?? [])].sort((a, b) => b.actual - a.actual).slice(0, 5).map((m) => ({ key: m.machineNo, title: `MC ${m.machineNo}`, sub: m.productName ?? '', value: fmt(m.actual) }))} /></div>
                <div><div className="caps" style={{ marginBottom: 'var(--s-size-6)' }}>Lowest</div><RankList rows={[...(v?.machines ?? [])].sort((a, b) => a.actual - b.actual).slice(0, 5).map((m) => ({ key: m.machineNo, title: `MC ${m.machineNo}`, sub: m.productName ?? '', value: fmt(m.actual) }))} /></div>
              </div></div></div>
              <div className="card"><div className="ch"><h3>Bekidoritsu by group</h3></div><div className="cb"><div className="bl">
                <BarList max={110} kw="var(--s-size-70)" vw="var(--s-size-60)" items={(v?.groups ?? []).map((g) => {
                  const c = cls(g.bekidoritsu.value, 'beki', s);
                  return { k: 'Group ' + g.group, v: g.bekidoritsu.value ?? 0, c: colOf(c), vc: colOf(c), l: g.bekidoritsu.value === null ? '—' : f1(g.bekidoritsu.value) + '%', tip: { title: `Group ${g.group}`, rows: [{ label: 'Bekidoritsu', value: f1(g.bekidoritsu.value) + '%' }] } };
                })} />
              </div></div></div>
            </div>
          </div></div>
        )}
      </div>
      {rate && <RateModal target={rate} onClose={() => setRate(null)} />}
    </section>
  );
}
