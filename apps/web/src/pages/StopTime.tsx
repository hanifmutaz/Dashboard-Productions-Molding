import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { PERMISSIONS, type LossGroup, type StopCategoryRef, type StopTimeView } from '@mpd/contracts';
import { useFilters } from '../lib/filters';
import { useSession } from '../lib/session';
import { delta } from '../lib/status';
import { f1, fmt, tokenColor } from '../lib/format';
import { BarList, RankList } from '../components/charts';
import { EmptyDeck, Kpi, SkelDeck } from '../components/kpi';
import { DataTable, Pager, downloadCsv } from '../components/table';
import { Menu, MenuItem, Tabs, Toggle, useTipProps, useToast } from '../components/ui';
import { EnvelopeBanner, emptyMsg } from '../components/state';
import { useMonitoring } from './Production';

type Grouped = StopTimeView['byMachine'][number] | StopTimeView['byProduct'][number];
const SHIFT_LBL = { '1': 'Shift 1 · 06–14', '2': 'Shift 2 · 14–22', '3': 'Shift 3 · 22–06' } as const;

export function StopTimePage() {
  const { settings: s, can } = useSession();
  const { f } = useFilters();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const fromUtil = sp.get('from') === 'util';
  const [group, setGroup] = useState<LossGroup | ''>('');
  const [cat, setCat] = useState<string>('');
  const [info, setInfo] = useState(s.disp.info);
  const [tab, setTab] = useState<'stop-0' | 'stop-1' | 'stop-2' | 'stop-3' | 'stop-4'>(sp.get('machine') ? 'stop-1' : 'stop-0');
  const [tdQ, setTdQ] = useState('');
  useEffect(() => setInfo(s.disp.info), [s.disp.info]);
  const q = useMonitoring<StopTimeView>('stop-time', { group: group || undefined, category: cat || undefined, includeInfo: String(info) });
  const env = q.data, v = env?.data ?? null, t = v?.totals, p = v?.previous;
  const msg = emptyMsg(env);
  const C = new Map<string, StopCategoryRef>((v?.categories ?? []).map((c) => [c.id, c]));
  const G = new Map((v?.groups ?? []).map((g) => [g.id, g]));
  const catOf = (id: string): StopCategoryRef => C.get(id) ?? { id, short: id, name: id, group: 'unmapped', color: 's-paint-94a3b8', infoOnly: false, oeeBucket: '-' };
  const PL = s.disp.pareto;
  const vs = p ? <span className="fa">vs previous {v?.range.days} days</span> : null;

  const pareto = () => {
    const rows = v?.byCategory ?? [], tot = t?.minutes || 1, mx = rows[0]?.minutes ?? 1;
    let cum = 0, cutDone = false;
    return (
      <div className="hp" role="list" aria-label="Pareto of stop time by category">
        <div className="hph"><span>Category</span><span /><span className="r">Min</span><span className="r">Share</span><span className="r">Cum.</span></div>
        {rows.map((r) => {
          cum += r.minutes;
          const cp = (cum / tot) * 100, sh = (r.minutes / tot) * 100, cut = !cutDone && cp >= PL, c = catOf(r.categoryId);
          if (cut) cutDone = true;
          return <ParetoRow key={r.categoryId} c={c} r={r} sh={sh} cp={cp} cut={cut} mx={mx} sel={cat === r.categoryId} groupName={G.get(c.group)?.name ?? ''} onClick={() => { setCat(cat === r.categoryId ? '' : r.categoryId); setGroup(''); }} />;
        })}
        <div className="hpn">Dashed line = {PL}% cumulative cut-off</div>
      </div>
    );
  };

  const exportEvents = () => {
    downloadCsv(`molding_stop_details_${f.from}_${f.to}.csv`, [['Rank', 'Detail', 'Category', 'Group', 'Events', 'Minutes', 'Share %', 'Machines'],
      ...(v?.details ?? []).map((d, i) => [i + 1, d.detail, catOf(d.categoryId).short, G.get(catOf(d.categoryId).group)?.name ?? '', d.events, d.minutes, f1((d.minutes / (t?.minutes || 1)) * 100), d.machines.join(' ')])]);
    toast('Exported top details');
  };
  const largest = v?.byCategory[0];
  const nP = (() => { let c = 0, n = 0; (v?.byCategory ?? []).forEach((r) => { if ((c / (t?.minutes || 1)) * 100 < PL) n++; c += r.minutes; }); return n; })();
  const detailRows = (v?.details ?? []).map((d, i) => ({ ...d, rank: i + 1, share: (d.minutes / (t?.minutes || 1)) * 100 })).filter((d) => !tdQ || `${d.detail} ${catOf(d.categoryId).short}`.toLowerCase().includes(tdQ.toLowerCase()));
  let cumD = 0;
  const detailWithCum = detailRows.map((d) => ({ ...d, cum: ((cumD += d.minutes) / (t?.minutes || 1)) * 100 }));

  return (
    <section className="view on">
      <div className="content">
        <EnvelopeBanner env={env} error={q.error} />
        <div className="deck">
          {q.isPending ? <SkelDeck n={5} /> : !t ? <EmptyDeck labels={['Total stop time', 'Stop events', 'Active categories', 'Active details', 'Info-only stops']} msg={msg} /> : (
            <>
              <Kpi l="Total stop time" v={fmt(t.minutes)} u="min" desc={`${f1(t.minutes / 60)} hours${info ? ' · incl. info-only' : ''}`} d={<>{delta(t.minutes, p?.minutes, 'down')} {vs}</>} />
              <Kpi l="Stop events" v={fmt(t.events)} desc="All recorded occurrences" d={<>{delta(t.events, p?.events, 'down')} {vs}</>} />
              <Kpi l="Active categories" v={t.activeCategories} u={`/ ${v.categories.length}`} desc="With stop time in range" d={<>{delta(t.activeCategories, p?.activeCategories, 'down')} {vs}</>} />
              <Kpi l="Active details" v={t.activeDetails} desc="Unique category + detail" d={<>{delta(t.activeDetails, p?.activeDetails, 'down')} {vs}</>} />
              <Kpi l="Info-only stops" v={fmt(t.infoMinutes)} u="min" chip={info ? 'Included' : 'Excluded'} desc="End shift, Informasi · not counted as loss" />
            </>
          )}
        </div>
        <div className="card"><div className="strip-note">
          <span>{largest && t ? <><span className="dot" style={{ background: tokenColor('s-paint-92400e') }} /><b>{nP} of {v.byCategory.length}</b> categories make ~{PL}% of stop time · largest: <b>{catOf(largest.categoryId).short}</b> {fmt(largest.minutes)} min ({Math.round((largest.minutes / t.minutes) * 100)}%)</> : msg || 'No stop time for this filter.'}</span>
          <span style={{ display: 'flex', gap: 'var(--s-size-12)', alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="sel2" aria-label="Loss group" value={group} onChange={(e) => { const g = e.target.value as LossGroup | ''; setGroup(g); if (cat && g && catOf(cat).group !== g) setCat(''); }}>
              <option value="">All loss groups</option>{(v?.groups ?? []).filter((g) => g.id !== 'unmapped').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select className="sel2" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">All categories ({v?.categories.length ?? 0})</option>
              {(v?.categories ?? []).filter((c) => !group || c.group === group).map((c) => <option key={c.id} value={c.id}>{c.short}{c.infoOnly ? ' (info)' : ''}</option>)}
            </select>
            <Toggle on={info} onChange={setInfo}>Include info-only stops</Toggle>
          </span>
        </div></div>
        <Tabs value={tab} onChange={setTab} items={[{ id: 'stop-0', label: 'Overview' }, { id: 'stop-1', label: 'By machine' }, { id: 'stop-2', label: 'By product' }, { id: 'stop-3', label: 'Top details' }, { id: 'stop-4', label: 'Ranking & shift' }]}
          right={<div className="legend">{(v?.groups ?? []).filter((g) => g.id !== 'unmapped').map((g) => <span key={g.id}><i style={{ background: tokenColor(g.color) }} />{g.name}</span>)}</div>} />
        {tab === 'stop-0' && (
          <div className="pane on"><div className="g2">
            <div className="card"><div className="ch"><div><h3>Pareto by category</h3><p>Sorted by minutes · cumulative % in the last column · click a row to filter that category</p></div></div><div className="cb">{v ? pareto() : <div className="empty">{msg}</div>}</div></div>
            <div className="card"><div className="ch"><div><h3>Loss groups</h3><p>Categories rolled up into loss groups (Master Data)</p></div></div>
              <div className="cb">
                <div className="gbar">{(v?.byGroup ?? []).map((g) => <GroupSeg key={g.group} pct={(g.minutes / (t?.minutes || 1)) * 100} color={tokenColor(G.get(g.group)?.color ?? 's-paint-94a3b8')} name={G.get(g.group)?.name ?? g.group} minutes={g.minutes} />)}</div>
                <table className="gtab"><tbody>
                  {(v?.byGroup ?? []).map((g) => (
                    <tr key={g.group}><td><span className="sw" style={{ background: tokenColor(G.get(g.group)?.color ?? '') }} />{G.get(g.group)?.name} <span className="fa">· {g.categories} cat.</span></td><td className="n m">{fmt(g.events)}×</td><td className="n m"><b>{fmt(g.minutes)}</b> min</td><td className="n m">{Math.round((g.minutes / (t?.minutes || 1)) * 100)}%</td></tr>
                  ))}
                  {!info && <tr><td colSpan={4} className="fa wrap" style={{ fontSize: 'var(--s-size-12)', border: 'none' }}>Info-only categories are hidden. Switch on “Include info-only stops” to show them.</td></tr>}
                </tbody></table>
              </div>
            </div>
          </div></div>
        )}
        {(tab === 'stop-1' || tab === 'stop-2') && (
          <div className="pane on">
            {v && (tab === 'stop-1' ? v.byMachine : v.byProduct).length ? (
              <GroupPanel key={tab} mode={tab === 'stop-1' ? 'mc' : 'pt'} list={tab === 'stop-1' ? v.byMachine : v.byProduct} catOf={catOf} topN={s.disp.topN}
                initial={tab === 'stop-1' ? sp.get('machine') : null} initialCat={sp.get('category')} back={fromUtil && tab === 'stop-1' ? () => void nav('/utilization') : undefined} />
            ) : <div className="card"><div className="empty">{msg || 'No stop time for this filter'}</div></div>}
          </div>
        )}
        {tab === 'stop-3' && (
          <div className="pane on"><div className="card">
            <div className="ch"><div><h3>Top details across all categories</h3><p>{v?.details.length ?? 0} active details · key = category + detail</p></div>
              <div style={{ display: 'flex', gap: 'var(--s-size-8)' }}>
                <input className="srch" placeholder="Search detail or category…" style={{ width: 'var(--s-size-240)', margin: 0 }} value={tdQ} onChange={(e) => setTdQ(e.target.value)} aria-label="Search detail" />
                {can(PERMISSIONS.exportStopTime) && <Menu label="Export ▾"><MenuItem onSelect={exportEvents}>Top details (CSV)</MenuItem></Menu>}
              </div>
            </div>
            <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
              <DataTable rows={detailWithCum} rowKey={(d) => `${d.categoryId}|${d.detail}`} sort={{ k: 'minutes', asc: false }} pageSize={25} empty={msg || 'No detail matches'}
                footer={(pg) => <div className="tfoot"><span>Showing {pg.from}–{pg.to} of {pg.total}</span><Pager page={pg.page} pages={pg.pages} go={pg.go} /></div>}
                cols={[
                  { k: 'rank', h: '#', n: true, cl: 'm fa' },
                  { k: 'detail', h: 'Detail' },
                  { k: 'cat', h: 'Category', sv: (d) => catOf(d.categoryId).short, f: (d) => <><span className="sw" style={{ background: tokenColor(catOf(d.categoryId).color) }} />{catOf(d.categoryId).short}</> },
                  { k: 'grp', h: 'Group', cl: 'mu', sv: (d) => G.get(catOf(d.categoryId).group)?.name ?? '', f: (d) => G.get(catOf(d.categoryId).group)?.name ?? '' },
                  { k: 'events', h: 'Events', n: true, cl: 'm', f: (d) => fmt(d.events) },
                  { k: 'minutes', h: 'Minutes', n: true, cl: 'm', f: (d) => <b>{fmt(d.minutes)}</b> },
                  { k: 'share', h: 'Share', n: true, cl: 'm', f: (d) => f1(d.share) + '%' },
                  { k: 'cum', h: 'Cum.', n: true, cl: 'm fa', f: (d) => Math.round(d.cum) + '%' },
                  { k: 'mcs', h: 'Machines', n: true, cl: 'm', sv: (d) => d.machines.length, f: (d) => <span title={d.machines.map((m) => 'MC ' + m).join(', ')}>{d.machines.length}</span> },
                ]} />
            </div>
          </div></div>
        )}
        {tab === 'stop-4' && (
          <div className="pane on"><div className="g2e">
            <div className="card"><div className="ch"><div><h3>Stop time by machine</h3><p>Click a row (›) for stop details</p></div></div>
              <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
                <DataTable wrapClass="tw st1" rows={v?.byMachine ?? []} rowKey={(m) => m.machineNo} sort={{ k: 'minutes', asc: false }} empty={msg || 'No data'}
                  cols={[
                    { k: 'machineNo', h: 'Machine', f: (m) => <><span className="chev">›</span> <span className="mc">MC {m.machineNo}</span></> },
                    { k: 'minutes', h: 'Stop min', n: true, cl: 'm', f: (m) => <b>{fmt(m.minutes)}</b> },
                    { k: 'events', h: 'Events', n: true, cl: 'm' },
                    { k: 'top', h: 'Main causes', nos: true, cl: 'mu', f: (m) => m.details.slice(0, 2).map((d) => d.detail).join(', ') },
                  ]}
                  expand={(m) => (
                    <div className="exl"><div className="h">MC {m.machineNo} · {m.productName} · {m.events} events · {fmt(m.minutes)} min</div>
                      {m.details.map((d) => <span key={d.categoryId + d.detail} style={{ display: 'contents' }}><span><span className="sw" style={{ background: tokenColor(catOf(d.categoryId).color) }} />{d.detail} <span className="fa">· {catOf(d.categoryId).short}</span></span><span className="n">{d.events}×</span><span className="n">{fmt(d.minutes)} min</span></span>)}
                    </div>
                  )} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-size-14)' }}>
              <div className="card"><div className="ch"><h3>Stop time by shift</h3></div><div className="cb"><div className="bl"><BarList text kw="var(--s-size-120)" vw="var(--s-size-90)" items={(v?.byShift ?? []).map((x) => ({ k: SHIFT_LBL[x.shift], v: x.minutes, c: 'var(--primary)', l: fmt(x.minutes) + ' min' }))} /></div></div></div>
              <div className="card"><div className="ch"><h3>Lowest stop time</h3></div><div className="cb"><RankList col="var(--good)" rows={[...(v?.byMachine ?? [])].sort((a, b) => a.minutes - b.minutes).slice(0, 5).map((m) => ({ key: m.machineNo, title: `MC ${m.machineNo}`, sub: m.productName ?? '', value: fmt(m.minutes) + ' min' }))} /></div></div>
            </div>
          </div></div>
        )}
      </div>
    </section>
  );
}

function ParetoRow({ c, r, sh, cp, cut, mx, sel, groupName, onClick }: { c: StopCategoryRef; r: { minutes: number }; sh: number; cp: number; cut: boolean; mx: number; sel: boolean; groupName: string; onClick: () => void }) {
  const tip = useTipProps({ title: c.name, rows: [{ label: 'Minutes', value: fmt(r.minutes) }, { label: 'Share', value: f1(sh) + '%' }, { label: 'Cumulative', value: f1(cp) + '%' }, { label: 'Group', value: groupName }] });
  return (
    <button type="button" className={`hpr${sel ? ' sel' : ''}${cut ? ' cut' : ''}`} aria-pressed={sel} onClick={onClick} {...tip}>
      <span className="hk"><i className="dot" style={{ background: tokenColor(c.color) }} />{c.short}</span>
      <span className="hb"><i style={{ width: `${(r.minutes / mx) * 100}%`, background: tokenColor(c.color) }} /></span>
      <span className="hv">{fmt(r.minutes)}</span><span className="hv m">{Math.round(sh)}%</span><span className="hv">{Math.round(cp)}%</span>
    </button>
  );
}
function GroupSeg({ pct, color, name, minutes }: { pct: number; color: string; name: string; minutes: number }) {
  const tip = useTipProps({ title: name, rows: [{ label: 'Minutes', value: fmt(minutes) }, { label: 'Share', value: f1(pct) + '%' }] });
  return <i style={{ width: `${pct}%`, background: color }} {...tip} aria-label={`${name} ${f1(pct)}%`} />;
}

function GroupPanel({ mode, list, catOf, topN, initial, initialCat, back }: { mode: 'mc' | 'pt'; list: Grouped[]; catOf: (id: string) => StopCategoryRef; topN: number; initial: string | null; initialCat: string | null; back?: () => void }) {
  const keyOf = (g: Grouped) => ('machineNo' in g ? g.machineNo : g.productName);
  const labOf = (g: Grouped) => ('machineNo' in g ? `MC ${g.machineNo}` : g.productName);
  const [selK, setSelK] = useState<string>(initial && list.some((g) => keyOf(g) === initial) ? initial : keyOf(list[0]!));
  const g = list.find((x) => keyOf(x) === selK) ?? list[0]!;
  const cats = Object.entries(g.categories).sort((a, b) => b[1] - a[1]);
  const [selC, setSelC] = useState<string | null>(initialCat);
  const [all, setAll] = useState(false);
  const [dq, setDq] = useState('');
  const sc = selC && g.categories[selC] !== undefined ? selC : cats[0]?.[0] ?? '';
  const C = catOf(sc), cvM = g.categories[sc] ?? 0;
  const details = g.details.filter((d) => d.categoryId === sc);
  const cvN = details.reduce((a, d) => a + d.events, 0);
  const shown = dq ? details.filter((d) => d.detail.toLowerCase().includes(dq.toLowerCase())) : all ? details : details.slice(0, topN);
  const totals = new Map<string, number>();
  list.forEach((x) => Object.entries(x.categories).forEach(([c, m]) => totals.set(c, (totals.get(c) ?? 0) + m)));
  const top5 = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((x) => x[0]);
  const mx = list[0]?.minutes ?? 1, K = mode === 'mc' ? 'machine' : 'product';
  const t3 = details.slice(0, 3).reduce((a, d) => a + d.minutes, 0);
  const smy = details.length === 1 ? <>One detail · average <b>{fmt(cvM / Math.max(1, cvN))} min</b> per event</> : details.length > 3 ? <>Top 3 details = <b>{Math.round((t3 / (cvM || 1)) * 100)}%</b> of {C.short} time</> : details[0] ? <><b>{details[0].detail}</b> is the main cause at {Math.round((details[0].minutes / (cvM || 1)) * 100)}%</> : null;
  return (
    <div className="g3 stp">
      <div className="card"><div className="ch"><div><h3>Stop time by {K}</h3><p>{list.length} {K}s · colours = top 5 categories, grey = others</p></div>{back && <button className="backlnk" type="button" onClick={back}>‹ Back to OEE breakdown</button>}</div>
        <div className="cb"><div className="fill">
          {list.map((x) => {
            const oth = Object.entries(x.categories).filter(([c]) => !top5.includes(c)).reduce((a, [, v]) => a + v, 0);
            return (
              <button key={keyOf(x)} type="button" className={`br${keyOf(x) === keyOf(g) ? ' sel' : ''}`} style={{ ['--kw' as string]: mode === 'mc' ? 'var(--s-size-58)' : 'var(--s-size-150)', ['--vw' as string]: 'var(--s-size-74)' }} aria-pressed={keyOf(x) === keyOf(g)}
                onClick={() => { setSelK(keyOf(x)); setSelC(null); setAll(false); setDq(''); }}>
                <span className="bk">{labOf(x)}</span>
                <span className="bt">{top5.filter((c) => x.categories[c]).map((c) => <i key={c} style={{ width: `${(x.categories[c]! / mx) * 100}%`, background: tokenColor(catOf(c).color) }} />)}{oth > 0 && <i style={{ width: `${(oth / mx) * 100}%`, background: 'var(--s-paint-cbd5e1)' }} />}</span>
                <span className="bv">{fmt(x.minutes)} m</span>
              </button>
            );
          })}
        </div>
          <div className="legend" style={{ paddingTop: 'var(--s-size-8)' }}>{top5.map((c) => <span key={c}><i style={{ background: tokenColor(catOf(c).color) }} />{catOf(c).short}</span>)}<span><i style={{ background: 'var(--s-paint-cbd5e1)' }} />Others</span></div>
        </div>
      </div>
      <div className="card"><div className="ch"><div style={{ minWidth: 0 }}><h3>{labOf(g)} · {fmt(g.minutes)} min</h3><p>{'machines' in g ? g.machines.map((m) => 'MC ' + m).join(', ') : g.productName} · {g.events} events · {cats.length} categories</p></div></div>
        <div className="cb">
          {cats[0] && <div className="sum"><b>{catOf(cats[0][0]).short}</b> is the largest loss at {Math.round((cats[0][1] / (g.minutes || 1)) * 100)}%</div>}
          <div className="hd"><span>Category</span><span>Events</span><span>Min</span><span>Share</span></div>
          <div className="fill">
            {cats.map(([c, m]) => (
              <button key={c} type="button" className={`rw${c === sc ? ' sel' : ''}`} aria-pressed={c === sc} onClick={() => { setSelC(c); setAll(false); setDq(''); }}>
                <span className="nm" title={catOf(c).name}><span className="sw" style={{ background: tokenColor(catOf(c).color) }} />{catOf(c).short}</span>
                <span className="v">{g.details.filter((d) => d.categoryId === c).reduce((a, d) => a + d.events, 0)}×</span><span className="v m">{fmt(m)}</span><span className="v">{Math.round((m / (g.minutes || 1)) * 100)}%</span>
                <span className="bar"><i style={{ width: `${(m / (g.minutes || 1)) * 100}%`, background: tokenColor(catOf(c).color) }} /></span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card"><div className="ch"><div style={{ minWidth: 0 }}><h3><span className="sw" style={{ background: tokenColor(C.color) }} />{C.short} · {fmt(cvM)} min</h3><p>{details.length} details occurred · {cvN} events · {Math.round((cvM / (g.minutes || 1)) * 100)}% of {labOf(g)}</p></div></div>
        <div className="cb">
          <div className="sum">{smy}</div>
          {details.length > 15 && <input className="srch" placeholder={`Search ${details.length} details…`} value={dq} onChange={(e) => setDq(e.target.value)} aria-label="Search details" />}
          <div className="hd det"><span>#</span><span style={{ textAlign: 'left' }}>Detail</span><span>Events</span><span>Min</span><span>Share</span></div>
          <div className="fill">
            {shown.length ? shown.map((d) => (
              <div key={d.detail} className="rw det">
                <span className="rk">{details.indexOf(d) + 1}</span><span className="nm" title={d.detail}>{d.detail}</span><span className="v">{d.events}×</span><span className="v m">{fmt(d.minutes)}</span><span className="v">{Math.round((d.minutes / (cvM || 1)) * 100)}%</span>
                <span className="bar"><i style={{ width: `${(d.minutes / (cvM || 1)) * 100}%`, background: tokenColor(C.color) }} /></span>
              </div>
            )) : <div className="empty">No detail matches</div>}
          </div>
          <div className="ffoot"><span />{details.length > topN && !dq && <button className="lnk" type="button" onClick={() => setAll((a) => !a)}>{all ? `Show top ${topN}` : `Show all ${details.length}`}</button>}</div>
        </div>
      </div>
    </div>
  );
}
