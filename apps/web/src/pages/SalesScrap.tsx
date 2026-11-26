import type { SalesPartRow, SalesView, ScrapMaterialRow, ScrapPartRow, ScrapView } from '@mpd/contracts';
import { Link } from 'react-router';
import { fmt, fmtPrice, kf, lbl, lblY, MN, rp, tokenColor } from '../lib/format';
import { Chart } from '../components/charts';
import { EmptyDeck, Kpi, SkelDeck } from '../components/kpi';
import { DataTable, type Col } from '../components/table';
import { useMonitoring } from '../lib/monitoring';
import { EnvelopeBanner, emptyMsg } from '../components/state';

/* Sales: rumus final (Q-009, owner 2026-11-18). Scrap: NG gram ConMas x harga material per gram (Master Data); rumus nilai PROPOSED, menunggu approver Quality/Finance.
 * No placeholder numbers: nilai yang belum ada tampil "—" + alasan, bukan 0. */
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
      <EnvelopeBanner env={env} error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      {v ? (
        <div className="deck">
          <Kpi l="Sales" v={v.total.value === null ? '—' : kf(v.total.value)} u={v.total.value === null ? undefined : 'Rp'} title={v.total.reason ?? undefined} desc={v.total.value === null ? undefined : rp(v.total.value)} />
          <Kpi l="Production actual" v={fmt(v.goodQty)} u="pcs" desc={v.uncoveredQty > 0 ? `${fmt(v.uncoveredQty)} pcs belum berharga` : undefined} />
          <Kpi l="Average price" v={v.averagePrice.value === null ? '—' : fmtPrice(Math.round(v.averagePrice.value * 100) / 100)} u="Rp/pcs" title={v.averagePrice.reason ?? undefined} />
        </div>
      ) : q.isPending ? <SkelDeck n={3} /> : <div className="deck"><EmptyDeck labels={['Sales', 'Production actual', 'Average price']} msg={msg} /></div>}
      {v && <p className="note">Valuasi memakai harga terakhir yang tercatat sampai akhir tanggal produksi (tanggal lokal plant). Harga sebelum histori dimulai tidak ditebak. Kolom harga kosong juga dapat berarti harga berbeda dalam periode.</p>}
      {v && v.uncoveredQty > 0 && <div className="banner w" role="status">{fmt(v.uncoveredQty)} pcs output tidak memiliki Harga/PCS yang tercatat untuk tanggal produksi. Output itu tidak dihitung ke Sales (bukan dianggap Rp 0). Periksa <Link className="lnk" to="/operations">riwayat harga</Link>.</div>}
      <div className="g2e">
        <div className="card"><div className="ch"><div><h3>Sales per month</h3><p>Rp · bulan di dalam rentang tanggal yang dipilih</p></div></div><div className="cb">
          {v && v.byMonth.length ? <Chart aria="Sales per month" labels={v.byMonth.map((m) => monthLbl(m.key))} h={240} bw={28} yFmt={kf} vFmt={kf} tipT={(i) => monthLbl(v.byMonth[i]!.key)}
            bars={[{ name: 'Sales (Rp)', col: 'var(--act)', vals: v.byMonth.map((m) => m.hasValuation === false ? null : m.sales) }]} tipX={(i) => [{ label: 'Actual', value: fmt(v.byMonth[i]!.goodQty) + ' pcs' }]} /> : <div className="chw" style={{ height: 'var(--s-size-240)' }}><div className="empty" role="status">{msg || 'Tidak ada data'}</div></div>}
        </div></div>
        <div className="card"><div className="ch"><div><h3>Sales per day</h3><p>Rp per hari produksi</p></div></div><div className="cb">
          {v && v.byDay.length ? <Chart aria="Sales per day" labels={v.byDay.map((d) => lbl(d.key))} h={240} bw={18} yFmt={kf} vFmt={kf} tipT={(i) => lblY(v.byDay[i]!.key)}
            bars={[{ name: 'Sales (Rp)', col: 'var(--act)', vals: v.byDay.map((d) => d.hasValuation === false ? null : d.sales) }]} tipX={(i) => [{ label: 'Actual', value: fmt(v.byDay[i]!.goodQty) + ' pcs' }]} /> : <div className="chw" style={{ height: 'var(--s-size-240)' }}><div className="empty" role="status">{msg || 'Tidak ada data'}</div></div>}
        </div></div>
      </div>
      <div className="card"><div className="ch"><div><h3>Breakdown per part</h3><p>Per DP Part, dalam Rupiah</p></div></div><div className="cb">
        <DataTable wrapClass="tw st1" cols={partCols} rows={v?.byPart ?? []} rowKey={(p) => p.dpNo ?? '—'} sort={{ k: 'sales', asc: false }} empty={msg || 'Tidak ada data untuk filter ini'} />
      </div></div>
      <div className="note"><b>Sales</b> = Production Actual × Harga/PCS dari DP Part (Rupiah, dikelola di <Link className="lnk" to="/master-data">Master Data</Link>). Actual sudah berupa output good, jadi NG tidak dikurangkan lagi. Rumus disetujui owner 2026-11-18. Angka ditampilkan tanpa pembulatan sampai aturan pembulatan Rupiah ditetapkan (Q-003).</div>
    </div></section>
  );
}

const pct = (v: number) => v.toFixed(2) + '%';
const kg = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));
const MAT_COLORS = ['s-paint-6366f1', 's-paint-ec4899', 's-paint-c026d3', 's-paint-92400e', 's-paint-4f46e5', 's-paint-94a3b8'];
const dash = (m: { value: number | null; reason: string | null }, f: (n: number) => string) => (m.value === null && m.reason ? <details><summary title={m.reason}>—</summary>{m.reason}</details> : m.value === null ? '—' : f(m.value));

export function ScrapPage() {
  const q = useMonitoring<ScrapView>('scrap');
  const env = q.data, v = env?.data ?? null;
  const msg = emptyMsg(env);
  const empty = <div className="chw" style={{ height: 'var(--s-size-240)' }}><div className="empty" role="status">{msg || 'Tidak ada data'}</div></div>;
  // Monthly stack: top 5 materials over the range, the rest grouped as "Lainnya".
  const names = new Map((v?.byMaterial ?? []).map((m) => [m.code, m.name ?? m.code ?? '—']));
  const totals = new Map<string, number>();
  v?.byMonth.forEach((m) => m.materials.forEach((x) => { if (x.code) totals.set(x.code, (totals.get(x.code) ?? 0) + x.value); }));
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  const monthBars = v ? [
    ...top.map((c, i) => ({ name: names.get(c) ?? c, col: tokenColor(MAT_COLORS[i]!), vals: v.byMonth.map((m) => m.hasValuation === false ? null : (m.materials.find((x) => x.code === c)?.value ?? 0)) })),
    ...(totals.size > top.length ? [{ name: 'Lainnya', col: tokenColor(MAT_COLORS[5]!), vals: v.byMonth.map((m) => m.hasValuation === false ? null : m.materials.filter((x) => !x.code || !top.includes(x.code)).reduce((a, x) => a + x.value, 0)) }] : []),
  ] : [];
  const matCols: Col<ScrapMaterialRow>[] = [
    { k: 'code', h: 'DP Material', cl: 'mu', sv: (m) => m.code, f: (m) => m.code ?? 'Tanpa material' },
    { k: 'name', h: 'Material', cl: 'mu', sv: (m) => m.name, f: (m) => m.name ?? '—' },
    { k: 'price', h: 'Harga/gram', n: true, cl: 'm', sv: (m) => m.pricePerGram, f: (m) => (m.pricePerGram === null ? <span title="Harga belum diisi di Master Data">—</span> : 'Rp ' + fmtPrice(m.pricePerGram)) },
    { k: 'kg', h: 'Scrap (kg)', n: true, cl: 'm', sv: (m) => m.scrapGram, f: (m) => kg(m.scrapGram / 1000) },
    { k: 'value', h: 'Scrap value (Rp)', n: true, cl: 'm', sv: (m) => m.scrapValue.value, f: (m) => dash(m.scrapValue, rp) },
  ];
  const partCols: Col<ScrapPartRow>[] = [
    { k: 'dpNo', h: 'DP Part', cl: 'mu', sv: (p) => p.dpNo, f: (p) => p.dpNo ?? '—' },
    { k: 'productName', h: 'Part', cl: 'mu', sv: (p) => p.productName, f: (p) => p.productName ?? '—' },
    { k: 'material', h: 'Material', cl: 'mu', sv: (p) => p.materialName, f: (p) => p.materialName ?? <span title="Part belum dipetakan ke material di Master Data">—</span> },
    { k: 'qty', h: 'Actual (pcs)', n: true, cl: 'm', sv: (p) => p.goodQty, f: (p) => fmt(p.goodQty) },
    { k: 'kg', h: 'Scrap (kg)', n: true, cl: 'm', sv: (p) => p.scrapKg.value, f: (p) => dash(p.scrapKg, kg) },
    { k: 'value', h: 'Scrap value (Rp)', n: true, cl: 'm', sv: (p) => p.scrapValue.value, f: (p) => dash(p.scrapValue, rp) },
    { k: 'sales', h: 'Sales (Rp)', n: true, cl: 'm', sv: (p) => p.sales.value, f: (p) => dash(p.sales, rp) },
    { k: 'ratio', h: 'Scrap ratio', n: true, cl: 'm', sv: (p) => p.ratio.value, f: (p) => dash(p.ratio, pct) },
  ];
  return (
    <section className="view on"><div className="content">
      <EnvelopeBanner env={env} error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      {v ? (
        <div className="deck">
          <Kpi l="Scrap value" v={v.scrapValue.value === null ? '—' : kf(v.scrapValue.value)} u={v.scrapValue.value === null ? undefined : 'Rp'} title={v.scrapValue.reason ?? undefined} desc={v.scrapValue.value === null ? undefined : rp(v.scrapValue.value)} />
          <Kpi l="Scrap weight" v={kg(v.scrapKg.value)} u={v.scrapKg.value === null ? undefined : 'kg'} title={v.scrapKg.reason ?? undefined} desc={v.scrapKg.value === null ? undefined : `${fmt(v.scrapGram)} gram dari ConMas`} />
          <Kpi l="Scrap ratio" v={v.ratio.value === null ? '—' : v.ratio.value.toFixed(2)} u={v.ratio.value === null ? undefined : '%'} title={v.ratio.reason ?? undefined} desc="scrap value ÷ sales value" />
        </div>
      ) : q.isPending ? <SkelDeck n={3} /> : <div className="deck"><EmptyDeck labels={['Scrap value', 'Scrap weight', 'Scrap ratio']} msg={msg} /></div>}
      {v && <div className="banner w" role="status">Nilai dan rasio Scrap masih menunggu persetujuan Quality/Finance. Harga dan mapping part-material mengikuti tanggal efektif produksi. Nilai sebelum histori dimulai tidak ditebak; kolom material atau harga kosong juga dapat berarti nilainya berbeda dalam periode.</div>}
      {v?.priceUnitSuspect && <div className="banner w" role="status"><b>Cek satuan harga material.</b> Ada harga material ≥ Rp 10.000 per gram, yang tidak wajar untuk resin; kemungkinan harga di CSV per kg. Kalau benar, Scrap value dan ratio terlihat 1.000× terlalu besar. Perbaiki di <Link className="lnk" to="/master-data">Master Data</Link>.</div>}
      {v && v.unvaluedGram > 0 && <div className="banner w" role="status">{fmt(v.unvaluedGram)} gram scrap berasal dari part tanpa material atau material tanpa harga di <Link className="lnk" to="/master-data">Master Data</Link>. Gram itu tercatat di Scrap weight tetapi tidak dihitung ke Scrap value (bukan dianggap Rp 0).</div>}
      {v && v.recordsWithoutGram > 0 && <div className="banner w" role="status">{fmt(v.recordsWithoutGram)} dari {fmt(v.recordsTotal)} record produksi belum punya NG (gram) di ConMas. Record itu tidak dihitung sebagai scrap 0.</div>}
      <div className="card"><div className="ch"><div><h3>Scrap per month</h3><p>Rp per material (5 terbesar) · garis = scrap ratio (scrap ÷ sales)</p></div></div><div className="cb">
        {v && v.byMonth.length ? <Chart aria="Scrap per month" labels={v.byMonth.map((m) => monthLbl(m.key))} h={300} bw={34} stack yFmt={kf} vFmt={kf} tipT={(i) => monthLbl(v.byMonth[i]!.key)}
          bars={monthBars.length ? monthBars : [{ name: 'Scrap value (Rp)', col: 'var(--act)', vals: v.byMonth.map((m) => m.hasValuation === false ? null : m.scrapValue) }]}
          line={{ name: 'Scrap ratio', col: 'var(--plan)', axis: 'right', vals: v.byMonth.map((m) => m.ratio.value), fmt: pct }}
          tipX={(i) => [{ label: 'Scrap', value: kg(v.byMonth[i]!.scrapGram / 1000) + ' kg' }]} /> : empty}
      </div></div>
      <div className="card"><div className="ch"><div><h3>Scrap per day</h3><p>Rp per hari produksi · garis = scrap ratio</p></div></div><div className="cb">
        {v && v.byDay.length ? <Chart aria="Scrap per day" labels={v.byDay.map((d) => lbl(d.key))} h={280} bw={18} yFmt={kf} vFmt={kf} tipT={(i) => lblY(v.byDay[i]!.key)}
          bars={[{ name: 'Scrap value (Rp)', col: 'var(--act)', vals: v.byDay.map((d) => d.hasValuation === false ? null : d.scrapValue) }]}
          line={{ name: 'Scrap ratio', col: 'var(--plan)', axis: 'right', vals: v.byDay.map((d) => d.ratio.value), fmt: pct }}
          tipX={(i) => [{ label: 'Scrap', value: kg(v.byDay[i]!.scrapGram / 1000) + ' kg' }]} /> : empty}
      </div></div>
      <div className="g2e">
        <div className="card"><div className="ch"><div><h3>Per material</h3><p>NG (gram) dari ConMas × harga material per gram</p></div></div><div className="cb">
          <DataTable wrapClass="tw st1" cols={matCols} rows={v?.byMaterial ?? []} rowKey={(m) => m.code ?? '—'} sort={{ k: 'value', asc: false }} empty={msg || 'Tidak ada data untuk filter ini'} />
        </div></div>
        <div className="card"><div className="ch"><div><h3>Per part</h3><p>Scrap ratio = scrap value ÷ sales value part itu</p></div></div><div className="cb">
          <DataTable wrapClass="tw st1" cols={partCols} rows={v?.byPart ?? []} rowKey={(p) => p.dpNo ?? '—'} sort={{ k: 'value', asc: false }} empty={msg || 'Tidak ada data untuk filter ini'} />
        </div></div>
      </div>
      <div className="note"><b>Scrap kg</b> = NG (gram) ConMas ÷ 1.000. <b>Scrap value</b> = NG (gram) × harga material per gram (part → material → harga, dikelola di <Link className="lnk" to="/master-data">Master Data</Link>). <b>Scrap ratio</b> = scrap value ÷ sales value × 100, hanya dari record yang punya keduanya. Sumber gram dikonfirmasi owner 2026-11-18; rumus nilai & ratio masih menunggu approver Quality/Finance (Q-009). Angka ditampilkan tanpa pembulatan Rupiah sampai Q-003 ditetapkan.</div>
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
