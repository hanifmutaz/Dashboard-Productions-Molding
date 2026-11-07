import { useQuery } from '@tanstack/react-query';
import type { ViewDataEnvelope } from '@mpd/contracts';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { useReportSource } from '../lib/filters';
import { EmptyDeck } from '../components/kpi';
import { EnvelopeBanner } from '../components/state';

/* Sales & Scrap keep the mockup layout, but every figure stays "—" until formula, price source,
 * rounding and approver (Finance/Quality) are decided (Q-003, Q-009). No placeholder numbers. */
function useGated(path: 'sales' | 'scrap') {
  const q = useQuery({ queryKey: [path], queryFn: () => api.get<ViewDataEnvelope<null>>(`/api/v1/monitoring/${path}`) });
  useReportSource(q.data, q.isPending, q.isError);
  return q;
}
const reason = 'Menunggu persetujuan rumus & approver (Q-009)';
const Pending = ({ h }: { h: string }) => <div className="chw" style={{ height: h }}><div className="empty" role="status">{reason}</div></div>;

export function SalesPage() {
  const q = useGated('sales');
  return (
    <section className="view on"><div className="content">
      <EnvelopeBanner env={q.data} error={q.error} />
      <div className="deck"><EmptyDeck labels={['Sales', 'Production actual', 'Average price']} msg={reason} /></div>
      <div className="g2e">
        <div className="card"><div className="ch"><div><h3>Sales per month</h3><p>Rp million · click a month to filter the KPIs, the daily chart and the part breakdown</p></div></div><div className="cb"><Pending h="var(--s-size-280)" /></div></div>
        <div className="card"><div className="ch"><div><h3>Sales per day</h3><p>Weekly / monthly view</p></div></div><div className="cb"><Pending h="var(--s-size-280)" /></div></div>
      </div>
      <div className="card"><div className="ch"><div><h3>Breakdown per part</h3><p>Per DP Part, in Rupiah</p></div></div><div className="cb"><Pending h="var(--s-size-200)" /></div></div>
      <div className="note"><b>Sales</b> = Production Actual × price per pcs of the DP Part (Rupiah, maintained in <Link className="lnk" to="/master-data">Master Data</Link>). Rumus, sumber harga, pembulatan dan approver Finance belum ditetapkan, sehingga angka tidak ditampilkan. Halaman ini memakai pilihan tahun/bulan sendiri dan tidak terpengaruh filter shift, status atau mesin.</div>
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
