import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PERMISSIONS, type MachineUtilization, type Metric, type UtilizationView } from '@mpd/contracts';
import { useFilters } from '../lib/filters';
import { useSession } from '../lib/session';
import { cls, colOf, delta, mv, Pc, type TargetKey } from '../lib/status';
import { f1, fmt, tokenColor } from '../lib/format';
import { BarList, RankList } from '../components/charts';
import { EmptyDeck, Kpi, SkelDeck } from '../components/kpi';
import { DataTable, downloadCsv, type Col } from '../components/table';
import { Menu, MenuItem, Tabs, useToast } from '../components/ui';
import { EnvelopeBanner, emptyMsg } from '../components/state';
import { useMonitoring } from './Production';
import { RateModal, type RateTarget } from './RateModal';

function Mini({ label, m, k }: { label: string; m: Metric; k: TargetKey }) {
  const { settings: s } = useSession();
  const c = cls(m.value, k, s);
  return (
    <div className="mini" title={m.reason ?? undefined}>
      <span>{label}</span>
      <span className="mt"><i style={{ width: `${Math.min(100, m.value ?? 0)}%`, background: colOf(c) }} /></span>
      <span className="mv">{m.value === null ? '—' : f1(m.value) + '%'}</span>
      <span className="md">{m.value === null ? <span className="fa">n/a</span> : ''}</span>
    </div>
  );
}

export function UtilizationPage() {
  const { settings: s, can } = useSession();
  const { f } = useFilters();
  const nav = useNavigate();
  const toast = useToast();
  const q = useMonitoring<UtilizationView>('utilization');
  const [tab, setTab] = useState<'util-0' | 'util-1' | 'util-2'>('util-0');
  const [sel, setSel] = useState<string | null>(null);
  const [fac, setFac] = useState<'avail' | 'perf' | 'qual'>('avail');
  const [rate, setRate] = useState<RateTarget | null>(null);
  const env = q.data, v = env?.data ?? null, t = v?.totals, p = v?.previous;
  const msg = emptyMsg(env);
  const ms = v?.machines ?? [];
  const cur = ms.find((m) => m.machineNo === sel) ?? ms[0];
  const vs = p ? <span className="fa">vs previous {v?.range.days} days</span> : null;
  const kpiRate = (k: 'kikai' | 'sogo' | 'shugyo', label: string, desc: string) => (
    <Kpi l={label} v={f1(t![k].value)} u="%" desc={desc} title={t![k].reason ?? undefined} g={{ v: t![k].value, k }} d={<>{delta(t![k].value, p?.[k].value, 'up', true)} {vs}</>}
      onClick={() => setRate({ machineNo: null, label: 'All machines in filter', k })} />
  );
  const ucols: Col<MachineUtilization>[] = [
    { k: 'machineNo', h: 'Machine', f: (m) => <span className="mc">MC {m.machineNo}</span> },
    { k: 'productName', h: 'Part', cl: 'mu', f: (m) => m.productName ?? '—' },
    ...(['availability', 'performance', 'quality', 'oee'] as const).map((k) => ({ k, h: { availability: 'Availability', performance: 'Performance', quality: 'Quality', oee: 'OEE' }[k], n: true, cl: 'm', sv: (m: MachineUtilization) => mv(m[k]),
      f: (m: MachineUtilization) => (k === 'oee' ? <Pc m={m.oee} k="oee" s={s} /> : m[k].value === null ? <span className="fa" title={m[k].reason ?? undefined}>—</span> : f1(m[k].value) + '%') })),
    ...(['kikai', 'sogo', 'shugyo', 'bekidoritsu'] as const).map((k) => ({ k, h: { kikai: 'Kikai', sogo: 'Sogo', shugyo: 'Shugyo', bekidoritsu: 'Bekidoritsu' }[k], n: true, sv: (m: MachineUtilization) => mv(m[k]),
      f: (m: MachineUtilization) => <Pc m={m[k]} k={k === 'bekidoritsu' ? 'beki' : k} s={s} onClick={() => setRate({ machineNo: m.machineNo, label: `MC ${m.machineNo} · ${m.productName ?? ''}`, k: k === 'bekidoritsu' ? 'beki' : k })} /> })),
    { k: 'ctPlan', h: 'CT plan', n: true, cl: 'm', sv: (m) => mv(m.ctPlan), f: (m) => (m.ctPlan.value === null ? <span className="fa" title={m.ctPlan.reason ?? undefined}>—</span> : m.ctPlan.value.toFixed(1) + 's') },
    { k: 'ctActual', h: 'CT actual', n: true, cl: 'm', sv: (m) => mv(m.ctActual), f: (m) => (m.ctActual.value === null ? '—' : m.ctActual.value.toFixed(1) + 's') },
  ];
  const exportCsv = () => {
    downloadCsv(`molding_utilization_${f.from}_${f.to}.csv`, [
      ['Machine', 'DP Name', 'Availability %', 'Performance %', 'Quality %', 'OEE %', 'Kikai %', 'Sogo %', 'Shugyo %', 'Bekidoritsu %', 'CT actual'],
      ...ms.map((m) => ['MC ' + m.machineNo, m.productName, '', '', f1(m.quality.value), '', f1(m.kikai.value), f1(m.sogo.value), f1(m.shugyo.value), f1(m.bekidoritsu.value), m.ctActual.value]),
    ]);
    toast('Exported utilization');
  };
  const goStop = (mc: string, cat: string) => {
    toast(`Stop Time · MC ${mc}`);
    void nav(`/stop-time?machine=${encodeURIComponent(mc)}&category=${encodeURIComponent(cat)}&from=util`);
  };

  return (
    <section className="view on">
      <div className="content">
        <EnvelopeBanner env={env} error={q.error} />
        <div className="deck u4">
          {q.isPending ? <SkelDeck n={4} /> : !t ? <EmptyDeck labels={['OEE', 'Kikai Kadouritsu', 'Sogo Kadouritsu', 'Shugyo Kadouritsu']} msg={msg} /> : (
            <>
              <Kpi l="OEE" v="—" u="%" chip="Overall" title={t.oee.reason ?? undefined} desc={<span className="fa">{t.oee.reason}</span>}
                x={<div className="minis"><Mini label="Availability" m={t.availability} k="avail" /><Mini label="Performance" m={t.performance} k="perf" /><Mini label="Quality" m={t.quality} k="qual" /></div>}
                d={<span className="fa">Availability & Performance menunggu persetujuan rumus</span>} />
              {kpiRate('kikai', 'Kikai Kadouritsu', 'Running time ÷ planned time')}
              {kpiRate('sogo', 'Sogo Kadouritsu', 'Running time ÷ calendar time')}
              {kpiRate('shugyo', 'Shugyo Kadouritsu', 'Planned time ÷ calendar time')}
            </>
          )}
        </div>
        <div className="card"><div className="strip-note">
          <span>{v ? <><span className="dot" style={{ background: 'var(--primary)' }} />{ms.length} machines in range · OEE per machine belum tersedia (Q-003)</> : msg}</span>
          <span className="mono mu" style={{ fontSize: 'var(--s-size-12)' }}><b>Kikai</b> = (Planned − Stop) ÷ Planned · <b>Sogo</b> = (Planned − Stop) ÷ Calendar · <b>Shugyo</b> = Planned ÷ Calendar</span>
        </div></div>
        <Tabs value={tab} onChange={setTab} items={[{ id: 'util-0', label: 'OEE breakdown' }, { id: 'util-1', label: 'Ranking' }, { id: 'util-2', label: 'Machine table' }]}
          right={<div className="legend"><span><i style={{ background: 'var(--bad)' }} />More than {s.band} pt below target</span><span><i style={{ background: 'var(--warn)' }} />Below target</span><span><i style={{ background: 'var(--good)' }} />At / above target</span></div>} />
        {tab === 'util-0' && (
          <div className="pane on"><div className="g2">
            <div className="card"><div className="ch"><div><h3>OEE by machine</h3><p>Select a machine to see its losses · OEE shows “—” until the formula is approved</p></div><span className="chip">{ms.length} machines</span></div>
              <div className="cb"><div className="bl scroll" style={{ maxHeight: 'var(--s-size-520)' }}>
                <BarList max={100} kw="var(--s-size-62)" vw="var(--s-size-70)" empty={msg || 'No data'} items={ms.map((m) => ({ k: 'MC ' + m.machineNo, v: 0, l: '—', sel: m.machineNo === cur?.machineNo, onClick: () => setSel(m.machineNo),
                  tip: { title: `MC ${m.machineNo}`, rows: [{ label: m.productName ?? '', value: '' }, { label: 'Quality', value: f1(m.quality.value) + '%' }, { label: 'Kikai', value: f1(m.kikai.value) + '%' }] } }))} />
              </div></div>
            </div>
            <div className="card">
              {cur ? (
                <>
                  <div className="ch"><div><h3>MC {cur.machineNo} · OEE —</h3><p>{cur.productName} · select a factor, then click a loss to open it in Stop Time</p></div><span className="chip">Formula pending</span></div>
                  <div className="cb">
                    {([['avail', 'Availability', cur.availability], ['perf', 'Performance', cur.performance], ['qual', 'Quality', cur.quality]] as const).map(([k, l, m]) => (
                      <button key={k} type="button" className={`br${fac === k ? ' sel' : ''}`} style={{ ['--kw' as string]: 'var(--s-size-110)', ['--vw' as string]: 'var(--s-size-60)', minHeight: 'var(--s-size-38)' }} aria-pressed={fac === k} onClick={() => setFac(k)}>
                        <span className="bk t">{l}</span><span className="bt"><i style={{ width: `${m.value ?? 0}%`, background: colOf(cls(m.value, k, s)) }} /></span><span className="bv">{m.value === null ? '—' : f1(m.value) + '%'}</span>
                      </button>
                    ))}
                    <div style={{ marginTop: 'var(--s-size-14)' }}>
                      {(() => {
                        const rows = fac === 'qual' ? cur.rejects.map((r) => ({ label: r.name, v: r.qty, color: 'var(--s-paint-c026d3)', cat: null as string | null }))
                          : cur.losses.map((x) => ({ label: x.category, v: x.minutes, color: tokenColor(x.color), cat: x.categoryId }));
                        const unit = fac === 'qual' ? 'pcs' : 'min', mx = Math.max(1, ...rows.map((r) => r.v));
                        return (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }} className="caps"><span>{fac === 'qual' ? 'Quality losses · reject (pcs)' : 'Stop losses (min)'}</span><span>Total {fmt(rows.reduce((a, r) => a + r.v, 0))} {unit}</span></div>
                            <div className="fa" style={{ fontSize: 'var(--s-size-12)', margin: 'var(--s-size-2) 0 var(--s-size-6)' }}>{fac === 'qual' ? 'Reject detail is on Production ▸ By machine' : 'Pembagian Availability/Performance mengikuti OEE bucket di Master Data (belum disetujui) · klik kategori untuk membuka Stop Time'}</div>
                            <div className="bl" style={{ ['--kw' as string]: 'var(--s-size-170)', ['--vw' as string]: 'var(--s-size-70)' }}>
                              {rows.length ? rows.map((r) => r.cat ? (
                                <button key={r.label} type="button" className="br go" onClick={() => goStop(cur.machineNo, r.cat!)}><span className="bk t">{r.label}</span><span className="bt"><i style={{ width: `${(r.v / mx) * 100}%`, background: r.color }} /></span><span className="bv">{fmt(r.v)}</span><span className="ar">→</span></button>
                              ) : (
                                <div key={r.label} className="br go na"><span className="bk t">{r.label}</span><span className="bt"><i style={{ width: `${(r.v / mx) * 100}%`, background: r.color }} /></span><span className="bv">{fmt(r.v)}</span><span className="ar" /></div>
                              )) : <div className="empty">No loss recorded</div>}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </>
              ) : <div className="empty">{msg || 'No data'}</div>}
            </div>
          </div></div>
        )}
        {tab === 'util-1' && (
          <div className="pane on"><div className="g2e">
            <div className="card"><div className="ch"><h3>Highest Kikai Kadouritsu</h3></div><div className="cb"><RankList col="var(--good)" rows={[...ms].filter((m) => m.kikai.value !== null).sort((a, b) => b.kikai.value! - a.kikai.value!).slice(0, 5).map((m) => ({ key: m.machineNo, title: `MC ${m.machineNo}`, sub: m.productName ?? '', value: f1(m.kikai.value) + '%' }))} /></div></div>
            <div className="card"><div className="ch"><h3>Lowest Kikai Kadouritsu</h3></div><div className="cb"><RankList col="var(--bad)" rows={[...ms].filter((m) => m.kikai.value !== null).sort((a, b) => a.kikai.value! - b.kikai.value!).slice(0, 5).map((m) => ({ key: m.machineNo, title: `MC ${m.machineNo}`, sub: m.productName ?? '', value: f1(m.kikai.value) + '%' }))} /></div></div>
          </div><div className="note" style={{ marginTop: 'var(--s-size-14)' }}>Ranking OEE ditampilkan setelah rumus OEE disetujui (Q-003). Sementara ranking memakai Kikai Kadouritsu (rumus disetujui).</div></div>
        )}
        {tab === 'util-2' && (
          <div className="pane on"><div className="card">
            <div className="ch"><div><h3>Machine utilization</h3><p>Click a row for its loss breakdown · click a percentage for daily data</p></div>
              {can(PERMISSIONS.exportUtilization) && <Menu label="Export ▾"><MenuItem onSelect={exportCsv}>Excel / CSV (filtered)</MenuItem><MenuItem onSelect={() => print()}>Print / PDF</MenuItem></Menu>}
            </div>
            <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
              <DataTable wrapClass="tw st1" cols={ucols} rows={ms} rowKey={(m) => m.machineNo} sort={{ k: 'kikai', asc: true }} empty={msg || 'No data for this filter'} onRowClick={(m) => { setSel(m.machineNo); setTab('util-0'); }} />
            </div>
          </div></div>
        )}
      </div>
      {rate && <RateModal target={rate} onClose={() => setRate(null)} />}
    </section>
  );
}
