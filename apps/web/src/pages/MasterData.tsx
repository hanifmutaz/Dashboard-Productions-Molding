import { useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, type MasterDataView, type Material, type Part } from '@mpd/contracts';
import { ApiFailure, api } from '../lib/api';
import { useSession } from '../lib/session';
import { fmt, tokenColor } from '../lib/format';
import { Kpi } from '../components/kpi';
import { DataTable, downloadCsv } from '../components/table';
import { Tabs, useToast } from '../components/ui';

/* ---------- CSV helpers (client preview only; server validates again on apply) ---------- */
export function csvRows(t: string): string[][] {
  const first = t.split('\n')[0] ?? '';
  const d = (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length ? ';' : ',';
  const out: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(cur.trim()); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur.trim()); if (row.some(Boolean)) out.push(row); row = []; cur = ''; }
    else cur += c;
  }
  row.push(cur.trim());
  if (row.some(Boolean)) out.push(row);
  return out;
}
export function parseNum(raw: string, mode: 'int' | 'dec'): number {
  const s = raw.trim().replace(/^rp\.?\s*/i, '').replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const hc = s.includes(','), hd = s.includes('.');
  if (hc && hd) { const l = Math.max(s.lastIndexOf(','), s.lastIndexOf('.')); return Number(s.slice(0, l).replace(/[.,]/g, '') + '.' + s.slice(l + 1)); }
  const sep = hc ? ',' : hd ? '.' : null;
  if (!sep) return Number(s);
  const p = s.split(sep);
  if (p.length > 2) return Number(p.join(''));
  if (mode === 'int' && p[1]!.length === 3) return Number(p.join(''));
  return Number(p[0] + '.' + p[1]);
}

interface Row<T> { line: number; raw: string[]; value?: T; err?: string; warn?: string; status?: 'new' | 'changed' | 'unchanged' }

function Uploader<T>({ id, title, sub, expected, cols, parse, onApply, template, disabled }: {
  id: string; title: string; sub: string; expected: string[]; cols: [string, (v: T) => string][];
  parse: (r: string[], all: Row<T>[]) => Row<T>; onApply: (rows: T[]) => Promise<void>; template: () => void; disabled: boolean;
}) {
  const [rows, setRows] = useState<Row<T>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const read = (file?: File) => {
    setRows(null); setError(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { setError('Choose a .csv file.'); return; }
    setFileName(file.name);
    file.text().then((text) => {
      const all = csvRows(text);
      if (!all.length) { setError('The file is empty.'); return; }
      const head = all[0]!.map((x) => x.replace(/^\uFEFF/, '').trim().toLowerCase());
      if (!expected.every((x, i) => head[i] === x.toLowerCase())) { setError(`CSV header doesn’t match this template. Expected: ${expected.join(' · ')} — Found: ${all[0]!.join(' · ')}`); return; }
      const data = all.slice(1);
      if (!data.length) { setError('The header is valid, but there are no data rows.'); return; }
      const acc: Row<T>[] = [];
      data.forEach((r, i) => acc.push(r.length < expected.length ? { line: i + 2, raw: r, err: `needs ${expected.length} columns` } : { ...parse(r, acc), line: i + 2, raw: r }));
      setRows(acc);
    }, () => setError('Could not read this file. Try saving it as CSV UTF-8.'));
  };
  const errors = rows?.filter((r) => r.err).length ?? 0, ok = rows?.filter((r) => !r.err && r.value) ?? [];
  return (
    <details className="card master-upload">
      <summary className="ch"><div><h3>{title}</h3><p>{sub}</p></div><span className="chip">Upload CSV <span className="upload-chevron">▾</span></span></summary>
      <div className="cb">
        <div className="caps">CSV columns</div>
        <div className="fmt">{expected.map((c, i) => <span key={c}><b>{String.fromCharCode(65 + i)}</b>{c}</span>)}</div>
        <div className={`tray upload-drop${drag ? ' drag' : ''}`} style={{ marginTop: 'var(--s-size-8)' }}
          onDragOver={(e: DragEvent) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files[0]); }}>
          <div className="drop-hint"><b>Drop CSV here</b> or choose a file</div>
          <input type="file" accept=".csv,text/csv" id={id} aria-label={title} disabled={disabled} onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} />
          <span className="fa" style={{ fontSize: 'var(--s-size-12)' }}>Excel: Save As ▸ CSV UTF-8 · dot or comma for decimals</span>
        </div>
        <div style={{ fontSize: 'var(--s-size-12p5)', marginTop: 'var(--s-size-8)' }}>
          {error && <div className="banner e">{error}</div>}
          {rows && (
            <>
              <div className="note"><b>{rows.length} rows checked</b> · {rows.filter((r) => r.status === 'new').length} new · {rows.filter((r) => r.status === 'changed').length} changed · {rows.filter((r) => r.status === 'unchanged').length} unchanged · {rows.filter((r) => !r.err && r.warn).length} warnings · {errors} errors</div>
              {errors ? <div className="banner e" style={{ marginTop: 'var(--s-size-8)' }}><b>Upload blocked.</b> Fix all errors in the CSV and upload it again; no rows will be applied.</div>
                : <div className="banner w" style={{ marginTop: 'var(--s-size-8)' }}><b>Review before applying.</b> Warnings don’t block upload. Changes are saved to the server and audited.</div>}
              <div className="caps" style={{ marginTop: 'var(--s-size-10)' }}>Preview · {fileName}</div>
              <div className="pvw"><table>
                <thead><tr><th>CSV row</th>{cols.map((c) => <th key={c[0]}>{c[0]}</th>)}<th>Status</th></tr></thead>
                <tbody>
                  {rows.slice(0, 20).map((r) => (
                    <tr key={r.line} className={r.err ? 'bad' : r.warn ? 'wn' : ''}><td>{r.line}</td>{cols.map((c, i) => <td key={c[0]}>{r.value ? c[1](r.value) : (r.raw[i + 1] ?? '')}</td>)}
                      <td>{r.err ? `ERROR · ${r.err}` : `${(r.status ?? '').toUpperCase()}${r.warn ? ` · Warning: ${r.warn}` : ''}`}</td></tr>
                  ))}
                  {rows.length > 20 && <tr><td colSpan={cols.length + 2} className="fa">Preview shows first 20 of {rows.length} rows; summary covers every row.</td></tr>}
                </tbody>
              </table></div>
            </>
          )}
        </div>
        <div style={{ marginTop: 'var(--s-size-10)', display: 'flex', gap: 'var(--s-size-8)' }}>
          <button className="btn pri" type="button" disabled={disabled || busy || !!errors || !ok.length}
            onClick={() => { setBusy(true); onApply(ok.map((r) => r.value!)).then(() => setRows(null), () => undefined).finally(() => setBusy(false)); }}>{busy ? 'Applying…' : 'Apply upload'}</button>
          <button className="btn" type="button" onClick={template}>Download template</button>
        </div>
      </div>
    </details>
  );
}

export function MasterDataPage() {
  const { can } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const editable = can(PERMISSIONS.editMasterData);
  const q = useQuery({ queryKey: ['master-data'], queryFn: () => api.get<MasterDataView>('/api/master-data') });
  const [tab, setTab] = useState<'master-0' | 'master-1' | 'master-2' | 'master-3'>('master-0');
  const [pq, setPq] = useState('');
  const [cq, setCq] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [mDraft, setMDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const v = q.data;
  const fail = (e: unknown) => { const m = e instanceof ApiFailure ? e.message : 'Gagal menyimpan.'; setMsg(m); toast(m); };
  const saveParts = useMutation({
    mutationFn: (items: { dpNo: string; pricePerPcs: number; version: number | null; name?: string }[]) => api.put<Part[]>('/api/master-data/part-prices', { items }),
    onSuccess: () => { setDraft({}); setMsg('✓ Saved.'); toast('Harga/PCS saved'); void qc.invalidateQueries({ queryKey: ['master-data'] }); },
    onError: fail,
  });
  const saveMats = useMutation({
    mutationFn: (b: { materials: { code: string; name: string; pricePerGram: number; version: number | null }[]; partMaterials: { dpNo: string; materialCode: string; version: number | null }[] }) => api.put('/api/master-data/materials', b),
    onSuccess: () => { setMDraft({}); toast('Material data saved'); void qc.invalidateQueries({ queryKey: ['master-data'] }); },
    onError: fail,
  });
  const parts = v?.parts ?? [], mats = v?.materials ?? [], cats = v?.categories ?? [], machines = v?.machines ?? [];
  const partBy = new Map(parts.map((p) => [p.dpNo.toLowerCase(), p]));
  const matBy = new Map(mats.map((m) => [m.code, m]));
  const machinesOf = (dp: string) => machines.filter((m) => m.dpNo === dp).map((m) => m.machineNo);
  const changedParts = Object.entries(draft).filter(([dp, val]) => String(parts.find((p) => p.dpNo === dp)?.pricePerPcs ?? '') !== val);

  return (
    <section className="view on">
      <div className="content">
        {q.error && <div className="banner e">{q.error instanceof ApiFailure ? q.error.message : 'Gagal memuat Master Data.'}</div>}
        <div className="deck u4">
          <Kpi l="Parts (DP Part)" v={parts.length} u="parts" desc={`${parts.filter((p) => p.pricePerPcs === null).length} without price`} />
          <Kpi l="Materials (DP Material)" v={mats.length} u="materials" desc={mats.map((m) => m.name).join(' · ') || '—'} />
          <Kpi l="Stop categories" v={cats.length} u="categories" desc={`${cats.reduce((a, c) => a + c.details.length, 0)} known details`} />
          <Kpi l="Machines" v={machines.length} u="machines" desc="Read from ConMas (last 30 days)" />
        </div>
        <Tabs value={tab} onChange={setTab} items={[{ id: 'master-0', label: 'Part & price' }, { id: 'master-1', label: 'Material & price' }, { id: 'master-2', label: 'Stop categories' }, { id: 'master-3', label: 'Machines' }]}
          right={<span className="fa" style={{ fontSize: 'var(--s-size-12)' }}>All prices in Rupiah · {editable ? 'changes are audited' : 'read-only for your role'}</span>} />
        {tab === 'master-0' && (
          <div className="pane on"><div className="master-stack">
            <Uploader<{ p: Part | null; dpNo: string; price: number; name: string }> id="ims-file" title="Upload CSV · Master data part" sub="One row per DP Part · price per pcs in Rupiah, whole number" disabled={!editable}
              expected={['No', 'DP Part', 'DP Name', 'Harga/PCS']} cols={[['DP Part', (x) => x.dpNo], ['DP Name', (x) => x.name], ['Harga/PCS', (x) => 'Rp ' + fmt(x.price)]]}
              parse={(r, acc) => {
                const dp = r[1]!.trim(), price = parseNum(r[3]!, 'int'), name = r[2]!.trim();
                if (!dp) return { line: 0, raw: r, err: 'DP Part is empty' };
                if (!(price >= 0) || !Number.isInteger(price)) return { line: 0, raw: r, err: 'invalid Harga/PCS' };
                const dup = acc.find((a) => a.value?.dpNo.toLowerCase() === dp.toLowerCase());
                if (dup) return { line: 0, raw: r, err: `Duplicate DP Part · also in row ${dup.line}` };
                const p = partBy.get(dp.toLowerCase()) ?? null;
                const old = p?.pricePerPcs ?? null;
                return { line: 0, raw: r, value: { p, dpNo: p?.dpNo ?? dp, price, name }, status: !p ? 'new' : old === price ? 'unchanged' : 'changed',
                  warn: old && Math.abs(price - old) / old > 0.5 ? `changes ${Math.round(((price - old) / old) * 100)}% vs current Rp ${fmt(old)} – check the separator` : p && name && name.toLowerCase() !== p.name.toLowerCase() ? `DP Name differs from master (${p.name})` : undefined };
              }}
              onApply={(rows) => saveParts.mutateAsync(rows.map((x) => ({ dpNo: x.dpNo, pricePerPcs: x.price, version: x.p?.version ?? null, name: x.name }))).then(() => undefined)}
              template={() => downloadCsv('master_data_part.csv', [['No', 'DP Part', 'DP Name', 'Harga/PCS'], ...parts.map((p, i) => [i + 1, p.dpNo, p.name, p.pricePerPcs])])} />
            <div className="card">
              <div className="ch"><div><h3>Part &amp; price <span className="chip">{parts.length} parts</span></h3><p>One price per DP Part applies to every machine running it</p></div>
                <input className="srch" placeholder="Search DP Part or name…" style={{ width: 'var(--s-size-220)', margin: 0 }} value={pq} onChange={(e) => setPq(e.target.value)} aria-label="Search part" /></div>
              <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
                <div className="tw" style={{ maxHeight: '56vh' }}><table>
                  <thead><tr><th className="nos">DP Part</th><th className="nos">DP Name</th><th className="nos">Machines</th><th className="nos n">Harga/PCS</th></tr></thead>
                  <tbody>
                    {parts.filter((p) => !pq || `${p.dpNo} ${p.name}`.toLowerCase().includes(pq.toLowerCase())).map((p) => {
                      const val = draft[p.dpNo] ?? (p.pricePerPcs === null ? '' : String(p.pricePerPcs));
                      return (
                        <tr key={p.dpNo}><td className="mc">{p.dpNo}</td><td>{p.name}</td><td>{machinesOf(p.dpNo).map((m) => <span key={m} className="tagm">MC {m}</span>)}</td>
                          <td className="n"><span className="pr"><span>Rp</span><input className={`pin${draft[p.dpNo] !== undefined && draft[p.dpNo] !== String(p.pricePerPcs ?? '') ? ' chg' : ''}`} type="number" min={0} step={1} value={val} disabled={!editable} aria-label={`Harga/PCS ${p.dpNo}`} onChange={(e) => setDraft((d) => ({ ...d, [p.dpNo]: e.target.value }))} /></span></td></tr>
                      );
                    })}
                    {!parts.length && <tr><td colSpan={4} className="empty">{q.isPending ? 'Memuat…' : 'Belum ada part. Upload CSV master data part.'}</td></tr>}
                  </tbody>
                </table></div>
                <div className="savebar"><span>{msg ?? 'Edit a price, then save. Changed cells are highlighted.'}</span>
                  <span style={{ display: 'flex', gap: 'var(--s-size-8)' }}>
                    <button className="btn" type="button" disabled={!changedParts.length} onClick={() => { setDraft({}); setMsg(null); }}>Discard changes</button>
                    <button className="btn pri" type="button" disabled={!editable || !changedParts.length || saveParts.isPending} onClick={() => {
                      const bad = changedParts.find(([, val]) => !(Number(val) >= 0) || !Number.isInteger(Number(val)) || val === '');
                      if (bad) { setMsg(`Harga untuk ${bad[0]} harus bilangan bulat ≥ 0.`); return; }
                      saveParts.mutate(changedParts.map(([dp, val]) => ({ dpNo: dp, pricePerPcs: Number(val), version: parts.find((p) => p.dpNo === dp)!.version })));
                    }}>{saveParts.isPending ? 'Saving…' : 'Save prices'}</button>
                  </span>
                </div>
              </div>
            </div>
          </div></div>
        )}
        {tab === 'master-1' && (
          <div className="pane on"><div className="master-stack">
            <Uploader<{ dpNo: string; part: Part | null; code: string; name: string; price: number }> id="imm-file" title="Upload CSV · Master data material" sub="One row per DP Part · the same DP Material must have the same price in every row" disabled={!editable}
              expected={['No', 'DP Part', 'Part Name', 'DP Material', 'Material Name', 'Price material/g']} cols={[['DP Part', (x) => x.dpNo], ['DP Material', (x) => x.code], ['Material Name', (x) => x.name], ['Price/g', (x) => 'Rp ' + x.price]]}
              parse={(r, acc) => {
                const dp = r[1]!.trim(), code = r[3]!.trim(), name = r[4]!.trim(), price = parseNum(r[5]!, 'dec');
                if (!dp) return { line: 0, raw: r, err: 'DP Part is empty' };
                if (!code) return { line: 0, raw: r, err: 'DP Material is empty' };
                if (!name) return { line: 0, raw: r, err: 'Material Name is empty' };
                if (!(price > 0)) return { line: 0, raw: r, err: 'invalid Price material/g' };
                const first = acc.find((a) => a.value?.code === code);
                if (first && first.value!.price !== price) return { line: 0, raw: r, err: `${code} price conflicts with row ${first.line}` };
                const part = partBy.get(dp.toLowerCase()) ?? null, cur = matBy.get(code);
                return { line: 0, raw: r, value: { dpNo: part?.dpNo ?? dp, part, code, name, price }, status: !cur ? 'new' : cur.pricePerGram !== price || cur.name !== name || part?.materialCode !== code ? 'changed' : 'unchanged',
                  warn: cur?.pricePerGram && Math.abs(price - cur.pricePerGram) / cur.pricePerGram > 0.5 ? 'large price change – check the separator' : undefined };
              }}
              onApply={(rows) => {
                const uniq = new Map<string, { code: string; name: string; pricePerGram: number; version: number | null }>();
                rows.forEach((x) => uniq.set(x.code, { code: x.code, name: x.name, pricePerGram: x.price, version: matBy.get(x.code)?.version ?? null }));
                return saveMats.mutateAsync({ materials: [...uniq.values()], partMaterials: rows.map((x) => ({ dpNo: x.dpNo, materialCode: x.code, version: x.part?.version ?? null })) }).then(() => undefined);
              }}
              template={() => downloadCsv('master_data_material.csv', [['No', 'DP Part', 'Part Name', 'DP Material', 'Material Name', 'Price material/g'], ...parts.map((p, i) => { const m = p.materialCode ? matBy.get(p.materialCode) : undefined; return [i + 1, p.dpNo, p.name, m?.code ?? '', m?.name ?? '', m?.pricePerGram ?? '']; })])} />
            <div className="card"><div className="ch"><div><h3>Material &amp; price</h3><p>Scrap value formula is pending approval (Q-009)</p></div></div>
              <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
                <div className="tw"><table>
                  <thead><tr><th className="nos">DP Material</th><th className="nos">Material Name</th><th className="nos n">Parts</th><th className="nos n">Price material/g</th></tr></thead>
                  <tbody>{mats.map((m: Material) => (
                    <tr key={m.code}><td className="mc">{m.code}</td><td>{m.name}</td><td className="n m">{parts.filter((p) => p.materialCode === m.code).length}</td>
                      <td className="n"><span className="pr"><span>Rp</span><input className={`pin${mDraft[m.code] !== undefined ? ' chg' : ''}`} type="number" min={0} step={0.01} disabled={!editable} value={mDraft[m.code] ?? String(m.pricePerGram ?? '')} aria-label={`Price material/g ${m.code}`} onChange={(e) => setMDraft((d) => ({ ...d, [m.code]: e.target.value }))} /></span></td></tr>
                  ))}{!mats.length && <tr><td colSpan={4} className="empty">Belum ada material.</td></tr>}</tbody>
                </table></div>
                <div className="savebar"><span>Edit a price per gram, then save.</span><span style={{ display: 'flex', gap: 'var(--s-size-8)' }}>
                  <button className="btn" type="button" disabled={!Object.keys(mDraft).length} onClick={() => setMDraft({})}>Discard changes</button>
                  <button className="btn pri" type="button" disabled={!editable || !Object.keys(mDraft).length || saveMats.isPending} onClick={() => saveMats.mutate({
                    materials: Object.entries(mDraft).map(([code, val]) => ({ code, name: matBy.get(code)!.name, pricePerGram: Number(val), version: matBy.get(code)!.version })), partMaterials: [] })}>Save prices</button>
                </span></div>
              </div>
            </div>
            <div className="card"><div className="ch"><div><h3>Part → material</h3><p>Which material each DP Part is moulded from</p></div></div>
              <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}><div className="tw" style={{ maxHeight: '44vh' }}><table>
                <thead><tr><th className="nos">DP Part</th><th className="nos">Part Name</th><th className="nos">DP Material</th><th className="nos">Material Name</th></tr></thead>
                <tbody>{parts.map((p) => <tr key={p.dpNo}><td className="mc">{p.dpNo}</td><td>{p.name}</td><td className="mono">{p.materialCode ?? '—'}</td><td>{p.materialCode ? matBy.get(p.materialCode)?.name : '—'}</td></tr>)}</tbody>
              </table></div></div>
            </div>
          </div></div>
        )}
        {tab === 'master-2' && (
          <div className="pane on"><div className="card">
            <div className="ch"><div><h3>Stop categories &amp; details</h3><p>{cats.length} categories · click a category (›) to see its details and ConMas aliases · loss group and OEE bucket are defaults to be confirmed by Molding</p></div>
              <input className="srch" placeholder="Search category or detail…" style={{ width: 'var(--s-size-240)', margin: 0 }} value={cq} onChange={(e) => setCq(e.target.value)} aria-label="Search category" /></div>
            <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
              <DataTable wrapStyle={{ maxHeight: 'none' }} rows={cats.filter((c) => !cq || c.name.toLowerCase().includes(cq.toLowerCase()) || c.details.some((d) => d.toLowerCase().includes(cq.toLowerCase())))} rowKey={(c) => c.id} sort={{ k: 'sort', asc: true }}
                cols={[
                  { k: 'sort', h: 'Category', nos: true, sv: (c) => cats.indexOf(c), f: (c) => <><span className="chev">›</span> <span className="sw" style={{ background: tokenColor(c.color) }} />{c.name}</> },
                  { k: 'group', h: 'Loss group', nos: true },
                  { k: 'oee', h: 'OEE bucket', nos: true, f: (c) => (c.oeeBucket === 'A' ? 'Availability' : c.oeeBucket === 'P' ? 'Performance' : '—') },
                  { k: 'loss', h: 'Counted as loss', nos: true, f: (c) => (c.infoOnly ? <span className="chip warn">No · info only</span> : <span className="chip good">Yes</span>) },
                  { k: 'n', h: 'Details', n: true, nos: true, cl: 'm', f: (c) => c.details.length },
                  { k: 'notes', h: 'Notes', nos: true, cl: 'mu wrap', f: (c) => c.notes ?? (c.infoOnly ? 'Excluded from stop time & loss by default – confirm' : '') },
                ]}
                expand={(c) => (
                  <div style={{ maxWidth: 'none' }}>
                    <div className="caps" style={{ marginBottom: 'var(--s-size-8)' }}>{c.details.length} detail rows · ConMas aliases: {c.aliases.join(' · ')}</div>
                    <div className="dl">{c.details.map((d) => <span key={d} style={cq && d.toLowerCase().includes(cq.toLowerCase()) ? { borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 'var(--c-font-weight-600)' } : undefined}>{d}</span>)}</div>
                  </div>
                )} />
              <div className="tfoot"><span>Editing and Excel upload of categories is planned. ConMas categories that are not in this list show as “Unmapped”.</span></div>
            </div>
          </div></div>
        )}
        {tab === 'master-3' && (
          <div className="pane on"><div className="card">
            <div className="ch"><div><h3>Machines</h3><p>Read from ConMas · latest part and cavity per machine (last 30 days)</p></div></div>
            <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
              <DataTable wrapClass="tw st1" rows={machines} rowKey={(m) => m.machineNo} sort={{ k: 'machineNo', asc: true }} empty="ConMas tidak tersedia atau belum ada data"
                cols={[
                  { k: 'machineNo', h: 'Machine', sv: (m) => Number(m.machineNo) || m.machineNo, f: (m) => <span className="mc">MC {m.machineNo}</span> },
                  { k: 'dpNo', h: 'DP Part', cl: 'mu' }, { k: 'productName', h: 'DP Name' }, { k: 'cavity', h: 'Cavity', cl: 'm' },
                  { k: 'lastSeen', h: 'Last record', cl: 'm' },
                ]} />
            </div>
          </div></div>
        )}
      </div>
    </section>
  );
}
