import { useQuery } from '@tanstack/react-query';
import type { SalesPartRow, SalesView, ViewDataEnvelope } from '@mpd/contracts';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { useReportSource } from '../lib/filters';
import { fmt, fmtPrice, kf, lbl, lblY, MN, rp } from '../lib/format';
import { Chart } from '../components/charts';
import { EmptyDeck, Kpi, SkelDeck } from '../components/kpi';
import { DataTable, type Col } from '../components/table';
import { useMonitoring } from './Production';
import { EnvelopeBanner, emptyMsg } from '../components/state';

/* Sales: rumus final (Q-009, owner 2026-11-18). Scrap tetap "—" sampai rumus nilai dan approver Quality/Finance ditetapkan. No placeholder numbers. */
function useGated(path: 'scrap') {
  const q = useQuery({ queryKey: [path], queryFn: () => api.get<ViewDataEnvelope<null>>(`/api/v1/monitoring/${path}`) });
  useReportSource(q.data, q.isPending, q.isError);
  return q;
}
const reason = 'Menunggu persetujuan rumus & approver (Q-009)';
const Pending = ({ h }: { h: string }) => <div className="chw" style={{ height: h }}><div className="empty" role="status">{reason}</div></div>;

const monthLbl = (k: string) => { const [y, m] = k.split('-'); return `${MN[Number(m) - 1] ?? k} ${y ?? ''}`; };

export function SalesPage() {
  const q = useMonitoring<SalesView>('sales');
  const env = q.data, v = env?.data ?? null;
  const msg = emptyMsg(env);
  const partCols: Col<SalesPartRow>[] = [
    { k: 'dpNo', h: 'DP Part', cl: 'mu', sv: (p) => p.dpNo, f: (p) => p.dpNo ?? '—' },
    { k: 'productName', h: 'Part', cl: 'mu', sv: (p) => p.productName, f: (p) => p.productName ?? '—' },
    { k: 'goodQty', h: 'Actual (pcs)', n: true, cl: 'm', sv: (p) => p.goodQty, f: (p) => fmt(p.goodQty) },
    { k: 'pricePerPcs', h: 'Harga/PCS', n: true, cl: 'm', sv: (p) => p.pricePerPcs, f: (p) => (p.pricePerPcs === null ? <span title="Harga belum diisi di Master Data">—</span> : 'Rp ' + fmtPrice(p.pricePerPcs)) },
    { k: 'sales', h: 'Sales (Rp)', n: true, cl: 'm', sv: (p) => p.sales.value, f: (p) => (p.sales.value === null ? <span title={p.sales.reason ?? undefined}>—</span> : rp(p.sales.value)) },
  ];
  return (
    <section className="view on"><div className="content">
      <EnvelopeBanner env={env} error={q.error} />
      {v ? (
        <div className="deck">
          <Kpi l="Sales" v={v.total.value === null ? '—' : kf(v.total.value)} u={v.total.value === null ? undefined : 'Rp'} title={v.total.reason ?? undefined} desc={v.total.value === null ? undefined : rp(v.total.value)} />
          <Kpi l="Production actual" v={fmt(v.goodQty)} u="pcs" desc={v.uncoveredQty > 0 ? `${fmt(v.uncoveredQty)} pcs belum berharga` : undefined} />
          <Kpi l="Average price" v={v.averagePrice.value === null ? '—' : fmtPrice(Math.round(v.averagePrice.value * 100) / 100)} u="Rp/pcs" title={v.averagePrice.reason ?? undefined} />
        </div>
      ) : q.isPending ? <SkelDeck n={3} /> : <div className="deck"><EmptyDeck labels={['Sales', 'Production actual', 'Average price']} msg={msg} /></div>}
      {v && v.uncoveredQty > 0 && <div className="banner w" role="status">{fmt(v.uncoveredQty)} pcs output berasal dari part tanpa Harga/PCS di <Link className="lnk" to="/master-data">Master Data</Link>. Output itu tidak dihitung ke Sales (bukan dianggap Rp 0).</div>}
      <div className="g2e">
        <div className="card"><div className="ch"><div><h3>Sales per month</h3><p>Rp · bulan di dalam rentang tanggal yang dipilih</p></div></div><div className="cb">
          {v && v.byMonth.length ? <Chart aria="Sales per month" labels={v.byMonth.map((m) => monthLbl(m.key))} h={240} bw={28} yFmt={kf} vFmt={kf} tipT={(i) => monthLbl(v.byMonth[i]!.key)}
            bars={[{ name: 'Sales (Rp)', col: 'var(--act)', vals: v.byMonth.map((m) => m.sales) }]} tipX={(i) => [{ label: 'Actual', value: fmt(v.byMonth[i]!.goodQty) + ' pcs' }]} /> : <div className="chw" style={{ height: 'var(--s-size-240)' }}><div className="empty" role="status">{msg || 'Tidak ada data'}</div></div>}
        </div></div>
        <div className="card"><div className="ch"><div><h3>Sales per day</h3><p>Rp per hari produksi</p></div></div><div className="cb">
          {v && v.byDay.length ? <Chart aria="Sales per day" labels={v.byDay.map((d) => lbl(d.key))} h={240} bw={18} yFmt={kf} vFmt={kf} tipT={(i) => lblY(v.byDay[i]!.key)}
            bars={[{ name: 'Sales (Rp)', col: 'var(--act)', vals: v.byDay.map((d) => d.sales) }]} tipX={(i) => [{ label: 'Actual', value: fmt(v.byDay[i]!.goodQty) + ' pcs' }]} /> : <div className="chw" style={{ height: 'var(--s-size-240)' }}><div className="empty" role="status">{msg || 'Tidak ada data'}</div></div>}
        </div></div>
      </div>
      <div className="card"><div className="ch"><div><h3>Breakdown per part</h3><p>Per DP Part, dalam Rupiah</p></div></div><div className="cb">
        <DataTable wrapClass="tw st1" cols={partCols} rows={v?.byPart ?? []} rowKey={(p) => p.dpNo ?? '—'} sort={{ k: 'sales', asc: false }} empty={msg || 'Tidak ada data untuk filter ini'} />
      </div></div>
      <div className="note"><b>Sales</b> = Production Actual × Harga/PCS dari DP Part (Rupiah, dikelola di <Link className="lnk" to="/master-data">Master Data</Link>). Actual sudah berupa output good, jadi NG tidak dikurangkan lagi. Rumus disetujui owner 2026-11-18. Angka ditampilkan tanpa pembulatan sampai aturan pembulatan Rupiah ditetapkan (Q-003).</div>
    </div></section>
  );
}

export function ScrapPage() {
  const q = useGated('scrap');
  return (
    <section className="view on"><div className="content">
      <EnvelopeBanner env={q.data} error={q.error} />
      <div className="deck"><EmptyDeck labels={['Scrap value', 'Scrap weight', 'Scrap ratio']} msg={reason} /></div>
      <div className="card"><div className="ch"><div><h3>Scrap per month</h3><p>Scrap value by material · line = scrap ratio (scrap ÷ sales)</p></div></div><div className="cb"><Pending h="var(--s-size-300)" /></div></div>
      <div className="card"><div className="ch"><div><h3>Scrap per day</h3><p>Weekly / monthly view</p></div></div><div className="cb"><Pending h="var(--s-size-280)" /></div></div>
      <div className="note"><b>Scrap ratio</b> = scrap value ÷ sales value × 100, as defined by Molding. <b>Scrap kg</b> dan <b>scrap value</b> menunggu konfirmasi sumber data dan approver Quality/Finance (Q-009). Harga material per gram dikelola di <Link className="lnk" to="/master-data">Master Data</Link>.</div>
    </div></section>
  );
}

export function NeedPartPage() {
  return (
    <section className="view on"><div className="content">
      <div className="card"><div className="hold"><h3>Need Part · Segera Hadir</h3><p>Modul ini belum tersedia. Tidak ada data dan tidak ada API untuk Need Part pada rilis ini (ADR-006).</p></div></div>
    </div></section>
  );
}
