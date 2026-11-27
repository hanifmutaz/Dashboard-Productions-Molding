import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS } from '@mpd/contracts';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { downloadCsv } from '../components/table';
import { downloadXlsx } from '../lib/xlsx';
import { Seg, useToast } from '../components/ui';
import { ColumnPicker, ErrorBanner, Field, Grid, RangeField, Stats, Toggle, useOpsRange, dayChip, fmtDate, fmtDateTime, fmtNum, text, type Cell, type GridCol, type Row } from '../components/ops';

const SHIFTS = ['1', '2', '3'];
const DAY_TYPES = ['working', 'holiday', 'overtime'];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/* ---------------- Effective pricing, material history & shift calendar ---------------- */
type CompletionTab = 'prices' | 'mapping' | 'shifts';
const COMPLETION_COLS: Record<CompletionTab, GridCol[]> = {
  prices: [
    { k: 'effective_date', h: 'Effective from', cl: 'm', f: (r) => fmtDate(r.effective_date) },
    { k: 'entity_type', h: 'Type', f: (r) => <span className="chip">{text(r.entity_type)}</span> },
    { k: 'entity_key', h: 'Master code', cl: 'mono' },
    { k: 'new_price', h: 'Price (Rp)', n: true, f: (r) => (r.new_price == null ? <span className="chip warn">Cleared</span> : <b>{fmtNum(r.new_price)}</b>) },
    { k: 'changed_at', h: 'Recorded', cl: 'm mu', f: (r) => fmtDateTime(r.changed_at) },
  ],
  mapping: [
    { k: 'effective_date', h: 'Effective from', cl: 'm', f: (r) => fmtDate(r.effective_date) },
    { k: 'dp_no', h: 'DP No', cl: 'mono' },
    { k: 'material_code', h: 'Material', cl: 'mono', f: (r) => (r.material_code == null ? <span className="chip warn">Cleared</span> : text(r.material_code)) },
    { k: 'changed_at', h: 'Recorded', cl: 'm mu', f: (r) => fmtDateTime(r.changed_at) },
  ],
  shifts: [
    { k: 'work_date', h: 'Date', cl: 'm', f: (r) => fmtDate(r.work_date) },
    { k: 'shift', h: 'Shift', f: (r) => `Shift ${text(r.shift)}` },
    { k: 'day_type', h: 'Day type', f: (r) => dayChip(r.day_type) },
    { k: 'planned_minutes', h: 'Scheduled min', n: true, f: (r) => fmtNum(r.planned_minutes, 0) },
    { k: 'note', h: 'Note', cl: 'mu wrap' },
  ],
};
const COMPLETION_TITLE: Record<CompletionTab, string> = { prices: 'Record an effective price', mapping: 'Record a part → material change', shifts: 'Schedule a shift' };

export function CompletionMaster() {
  const { can } = useSession();
  const toast = useToast();
  const edit = can(PERMISSIONS.editMasterData);
  const q = useQuery({ queryKey: ['operations-completion'], queryFn: () => api.get<{ mapping: Row[]; prices: Row[]; shifts: Row[] }>('/api/operations/completion'), enabled: can(PERMISSIONS.viewMasterData) });
  const [tab, setTab] = useState<CompletionTab>('prices');
  const [kind, setKind] = useState('part'); const [key, setKey] = useState(''); const [value, setValue] = useState(''); const [date, setDate] = useState('');
  const [shift, setShift] = useState('1'); const [dayType, setDayType] = useState('working'); const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError(null);
    try {
      if (tab === 'prices') await api.put('/api/operations/effective-price', { kind, key, date, price: value === '' ? null : Number(value) });
      else if (tab === 'mapping') await api.put('/api/operations/material-mapping', { part: key, material: value.trim() || null, date });
      else await api.put('/api/operations/shift-calendar', { date, shift, dayType, minutes: dayType === 'holiday' ? 0 : Number(value), note });
      await q.refetch();
      toast(tab === 'shifts' ? `Shift ${shift} · ${fmtDate(date)} saved` : `${key} · effective ${fmtDate(date)} saved`);
      setKey(''); setValue(''); setNote('');
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <section className="card">
      <div className="ch">
        <div><h3>Effective pricing, material history &amp; shift calendar</h3><p>Historical valuation events · the current Master Data values are not changed</p></div>
        <Seg value={tab} onChange={(t) => { setTab(t); setValue(''); setError(null); }} items={[{ id: 'prices', label: 'Effective prices' }, { id: 'mapping', label: 'Material mapping' }, { id: 'shifts', label: 'Shift calendar' }]} />
      </div>
      <div className="cb">
        <ErrorBanner error={q.error} />
        {edit && (
          <form className="ops-edit" style={q.error ? { marginTop: 'var(--s-size-12)' } : undefined} onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="ops-h">{COMPLETION_TITLE[tab]}</div>
            <div className="ops-form">
              <Field label={tab === 'shifts' ? 'Date' : 'Effective from'}>{(id) => <input id={id} required type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
              {tab === 'prices' ? <>
                <Field label="Type">{(id) => <select id={id} value={kind} onChange={(e) => setKind(e.target.value)}><option value="part">Part (Rp / pcs)</option><option value="material">Material (Rp / gram)</option></select>}</Field>
                <Field label={kind === 'part' ? 'DP No' : 'Material code'}>{(id) => <input id={id} required maxLength={100} value={key} onChange={(e) => setKey(e.target.value)} />}</Field>
                <Field label="Price (Rp)" hint="Leave blank to clear the price from this date">{(id) => <input id={id} type="number" step="any" min="0" value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
              </> : tab === 'mapping' ? <>
                <Field label="DP No">{(id) => <input id={id} required maxLength={100} value={key} onChange={(e) => setKey(e.target.value)} />}</Field>
                <Field label="Material code" hint="Leave blank to clear the mapping">{(id) => <input id={id} maxLength={100} value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
              </> : <>
                <Field label="Shift">{(id) => <select id={id} value={shift} onChange={(e) => setShift(e.target.value)}>{SHIFTS.map((x) => <option key={x} value={x}>Shift {x}</option>)}</select>}</Field>
                <Field label="Day type">{(id) => <select id={id} value={dayType} onChange={(e) => setDayType(e.target.value)}>{DAY_TYPES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select>}</Field>
                <Field label="Scheduled minutes">{(id) => <input id={id} required={dayType !== 'holiday'} disabled={dayType === 'holiday'} type="number" min="0" max="1440" value={dayType === 'holiday' ? '0' : value} onChange={(e) => setValue(e.target.value)} />}</Field>
                <Field label="Note">{(id) => <input id={id} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
              </>}
              <div className="act"><button className="btn pri" disabled={busy}>{busy ? 'Saving…' : 'Save event'}</button></div>
            </div>
            {error ? <div style={{ marginTop: 'var(--s-size-10)' }}><ErrorBanner error={error} /></div> : null}
          </form>
        )}
        <Grid rows={q.data?.[tab] ?? []} cols={COMPLETION_COLS[tab]} empty={q.isPending ? 'Memuat…' : q.isError ? 'Data tidak bisa dimuat' : 'Belum ada event'} />
        <p className="note ops-note">Effective prices and mappings value production on or after their date; dates before the first event are not guessed. The shift schedule must be complete before it can be used as the scheduled-time denominator.</p>
      </div>
    </section>
  );
}

/* ---------------- Stop Time report builder ---------------- */
const STOP_FIELDS = ['date', 'machineNo', 'shift', 'dpNo', 'productName', 'poNo', 'category', 'categoryId', 'group', 'detail', 'minutes', 'infoOnly'];
const STOP_LABEL: Record<string, string> = { date: 'Date', machineNo: 'Machine', shift: 'Shift', dpNo: 'DP No', productName: 'Product name', poNo: 'PO No', category: 'Category', categoryId: 'Category ID', group: 'Loss group', detail: 'Detail', minutes: 'Minutes', infoOnly: 'Info-only' };
type StopReport = { columns: string[]; rows: Cell[][]; total: number; invalid: number; duplicates: number };
type Out = string | number | null;

export function StopReportBuilder() {
  const { can } = useSession();
  const toast = useToast();
  const allowed = can(PERMISSIONS.viewStopTime) && can(PERMISSIONS.exportProduction);
  const [period, setPeriod] = useOpsRange(); const { from, to, shift } = period; const [machine, setMachine] = useState(''); const [product, setProduct] = useState('');
  const [category, setCategory] = useState(''); const [detail, setDetail] = useState(''); const [min, setMin] = useState('0'); const [info, setInfo] = useState(false);
  const [cols, setCols] = useState(STOP_FIELDS); const [result, setResult] = useState<StopReport | null>(null);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const reset = () => setResult(null);
  async function run(format: 'preview' | 'csv' | 'xlsx') {
    setBusy(true); setError(null); reset();
    try {
      const r = await api.post<StopReport>('/api/operations/stop-report', { range: { from, to, ...(shift ? { shift } : {}) }, columns: cols, machine, product, category, detail, minMinutes: Number(min) || 0, includeInfo: info, download: format !== 'preview' });
      const data: Out[][] = r.rows.map((row) => row.map((v) => (typeof v === 'boolean' ? String(v) : v ?? null)));
      setResult({ ...r, rows: data });
      // Formula-injection guard for CSV opened in Excel.
      if (format === 'csv') downloadCsv(`stop_time_${from}_${to}.csv`, [r.columns, ...data.map((row) => row.map((v) => (typeof v === 'string' && /^\s*[=+@-]/.test(v) ? "'" + v : v)))]);
      if (format === 'xlsx') downloadXlsx(`stop_time_${from}_${to}.xlsx`, [r.columns, ...data]);
      if (format !== 'preview') toast(`${r.total.toLocaleString('en-US')} stop rows exported`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  if (!allowed) return null;
  const disabledReason = !from || !to ? 'Pick a date range first' : from > to ? '"From" must be on or before "To"' : !cols.length ? 'Select at least one column' : null;
  const upd = (fn: (v: string) => void) => (e: { target: { value: string } }) => { fn(e.target.value); reset(); };
  return (
    <section className="card">
      <div className="ch"><div><h3>Stop time report builder</h3><p>Every recorded stop with category and detail · preview shows the first 100 rows</p></div></div>
      <div className="cb">
        <div className="ops-sec">
          <div className="ops-h">Filters</div>
          <div className="ops-form">
            <RangeField label="Period & shift" value={period} onChange={(v) => { setPeriod(v); reset(); }} />
            <Field label="Machine">{(id) => <input id={id} placeholder="All machines" maxLength={20} value={machine} onChange={upd(setMachine)} />}</Field>
            <Field label="Product / DP No">{(id) => <input id={id} placeholder="All products" maxLength={100} value={product} onChange={upd(setProduct)} />}</Field>
            <Field label="Category">{(id) => <input id={id} placeholder="All categories" maxLength={100} value={category} onChange={upd(setCategory)} />}</Field>
            <Field label="Detail">{(id) => <input id={id} placeholder="Any detail" maxLength={200} value={detail} onChange={upd(setDetail)} />}</Field>
            <Field label="Minimum minutes">{(id) => <input id={id} type="number" min="0" value={min} onChange={upd(setMin)} />}</Field>
            <div className="act chks"><Toggle checked={info} onChange={(v) => { setInfo(v); reset(); }}>Include info-only stops</Toggle></div>
          </div>
        </div>
        <ColumnPicker all={STOP_FIELDS} value={cols} label={(k) => STOP_LABEL[k] ?? k} disabled={busy} onChange={(c) => { setCols(c); reset(); }} />
        {error ? <div style={{ marginTop: 'var(--s-size-14)' }}><ErrorBanner error={error} /></div> : null}
        {result && (
          <div className="ops-sec">
            <div className="ops-h">Preview</div>
            <Stats items={[{ label: 'stop rows', value: fmtNum(result.total, 0) }, { label: 'invalid', value: fmtNum(result.invalid, 0), warn: result.invalid > 0 }, { label: 'revisions excluded', value: fmtNum(result.duplicates, 0) }]} />
            <Grid rows={result.rows.slice(0, 100).map((row) => Object.fromEntries(result.columns.map((k, i) => [k, row[i] ?? null])))}
              cols={result.columns.map((k) => ({ k, h: STOP_LABEL[k] ?? k, n: k === 'minutes', f: k === 'minutes' ? (r: Row) => fmtNum(r[k], 1) : k === 'infoOnly' ? (r: Row) => (r[k] === 'true' ? <span className="chip">Info</span> : '—') : undefined }))}
              empty="Tidak ada stop untuk filter ini" />
          </div>
        )}
        <div className="ops-actions">
          <span className="hint">{disabledReason ?? `${cols.length} columns · ${fmtDate(from)} – ${fmtDate(to)}${shift ? ` · shift ${shift}` : ''}${info ? ' · incl. info-only' : ''}`}</span>
          <div className="grp">
            <button className="btn" type="button" disabled={busy || !!disabledReason} onClick={() => void run('preview')}>{busy ? 'Working…' : 'Preview'}</button>
            <button className="btn pri" type="button" disabled={busy || !!disabledReason} onClick={() => void run('csv')}>Export CSV</button>
            <button className="btn pri" type="button" disabled={busy || !!disabledReason} onClick={() => void run('xlsx')}>Export Excel</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Data quality history & review ---------------- */
const STATUS_CHIP: Record<string, string> = { open: 'chip warn', reviewed: 'chip', resolved: 'chip good' };
type Snapshot = Row & { id: string; status: string };

export function QualityHistory() {
  const { can } = useSession();
  const toast = useToast();
  const allowed = can(PERMISSIONS.viewProduction); const edit = can(PERMISSIONS.editMasterData);
  const q = useQuery({ queryKey: ['quality-history'], queryFn: () => api.get<Row[]>('/api/operations/quality-history'), enabled: allowed });
  const [period, setPeriod] = useOpsRange(); const { from, to } = period; const [onlyThis, setOnlyThis] = useState(false);
  const [review, setReview] = useState<{ row: Snapshot; status: string; note: string } | null>(null);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function capture() {
    setBusy(true); setError(null);
    try { await api.post('/api/operations/quality-history', { from, to }); await q.refetch(); toast(`Quality snapshot ${fmtDate(from)} – ${fmtDate(to)} captured`); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function saveReview() {
    if (!review) return;
    setBusy(true); setError(null);
    try { await api.put('/api/operations/quality-history', { id: review.row.id, status: review.status, note: review.note }); await q.refetch(); toast('Review saved'); setReview(null); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  if (!allowed) return null;
  const history = (q.data ?? []).map((r) => { const { metrics, ...meta } = r; return { ...meta, ...(typeof metrics === 'object' && metrics !== null ? metrics : {}) } as Snapshot; });
  const scoped = onlyThis ? history.filter((r) => r.date_from === from && r.date_to === to) : history;
  const warnNum = (k: string) => (r: Row) => { const n = Number(r[k] ?? 0); return n > 0 ? <b style={{ color: 'var(--warn)' }}>{fmtNum(n, 0)}</b> : fmtNum(n, 0); };
  return (
    <section className="card">
      <div className="ch"><div><h3>Data quality history &amp; review</h3><p>Manual snapshots of ConMas data quality per period · reviewing never changes ConMas data</p></div></div>
      <div className="cb">
        <form className="ops-edit" onSubmit={(e) => { e.preventDefault(); void capture(); }}>
          <div className="ops-h"><span>Capture a snapshot</span><span className="fa">Snapshots cover whole days (all shifts)</span></div>
          <div className="ops-form">
            <RangeField value={period} onChange={setPeriod} shift={false} />
            <div className="act wide">
              <button className="btn pri" disabled={busy || !from || !to || from > to}>{busy && !review ? 'Capturing…' : 'Capture quality'}</button>
              <span className="chks"><Toggle checked={onlyThis} onChange={setOnlyThis}>Only this period in history</Toggle></span>
            </div>
          </div>
        </form>
        {review && (
          <form className="ops-edit" onSubmit={(e) => { e.preventDefault(); void saveReview(); }}>
            <div className="ops-h"><span>Review snapshot · {fmtDate(review.row.date_from)} – {fmtDate(review.row.date_to)}</span><span className="fa">Captured {fmtDateTime(review.row.captured_at)}</span></div>
            <div className="ops-form">
              <Field label="Status">{(id) => <select id={id} value={review.status} onChange={(e) => setReview({ ...review, status: e.target.value })}>{['open', 'reviewed', 'resolved'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}</select>}</Field>
              <Field label="Note" wide>{(id) => <input id={id} required maxLength={500} placeholder="What was checked or fixed" value={review.note} onChange={(e) => setReview({ ...review, note: e.target.value })} />}</Field>
              <div className="act">
                <button className="btn pri" disabled={busy || !review.note.trim()}>{busy ? 'Saving…' : 'Save review'}</button>
                <button className="btn" type="button" disabled={busy} onClick={() => setReview(null)}>Cancel</button>
              </div>
            </div>
          </form>
        )}
        <ErrorBanner error={error ?? q.error} />
        <Stats items={[{ label: 'snapshots', value: scoped.length }, { label: 'open reviews', value: scoped.filter((r) => r.status === 'open').length, warn: scoped.some((r) => r.status === 'open') }]} />
        <Grid rows={scoped} pageSize={10} empty={q.isPending ? 'Memuat…' : q.isError ? 'Data tidak bisa dimuat' : from && to ? 'Belum ada snapshot untuk periode ini' : 'Belum ada snapshot'} cols={[
          { k: 'captured_at', h: 'Captured', cl: 'm', f: (r) => fmtDateTime(r.captured_at) },
          { k: 'date_from', h: 'Period', cl: 'm', f: (r) => `${fmtDate(r.date_from)} – ${fmtDate(r.date_to)}${r.shift ? ` · S${text(r.shift)}` : ''}` },
          { k: 'records', h: 'Records', n: true, f: (r) => fmtNum(r.records, 0) },
          { k: 'invalid', h: 'Invalid', n: true, f: warnNum('invalid') },
          { k: 'missingOutput', h: 'Missing output', n: true, f: warnNum('missingOutput') },
          { k: 'missingTimestamp', h: 'No timestamp', n: true, f: warnNum('missingTimestamp') },
          { k: 'negativeOutput', h: 'Negative', n: true, f: warnNum('negativeOutput') },
          { k: 'status', h: 'Status', f: (r) => <span className={STATUS_CHIP[String(r.status)] ?? 'chip'}>{cap(text(r.status))}</span> },
          { k: 'note', h: 'Note', cl: 'mu wrap' },
          ...(edit ? [{ k: 'act', h: '', f: (r: Row) => <button className="btn" type="button" aria-label={'Review snapshot ' + text(r.id)} onClick={() => setReview({ row: r as Snapshot, status: r.status === 'resolved' ? 'resolved' : 'reviewed', note: typeof r.note === 'string' ? r.note : '' })}>Review</button> }] : []),
        ]} />
      </div>
    </section>
  );
}

/* ---------------- Multiple production record review ---------------- */
type Group = { date: string; machineNo: string; shift: string; observedIds: string[]; selectedIds: string[]; state: 'pending' | 'approved' | 'changed'; records: { recordId: string; revision: number; dpNo: string | null; poNo: string | null; plan: number | null; actual: number | null; plannedMinutes: number | null; updatedAt: string | null }[] };
const STATE: Record<Group['state'], [string, string]> = { pending: ['chip warn', 'Needs review'], approved: ['chip good', 'Additive approved'], changed: ['chip bad', 'Records changed · back to latest'] };

export function RecordReview() {
  const { can } = useSession();
  const toast = useToast();
  const edit = can(PERMISSIONS.editMasterData); const allowed = can(PERMISSIONS.viewProduction);
  const [date, setDate] = useState(''); const [machine, setMachine] = useState('');
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [picked, setPicked] = useState<Record<string, string[]>>({}); const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function inspect() {
    setBusy(true); setError(null); setGroups(null);
    try {
      const g = await api.get<Group[]>('/api/operations/record-review?' + new URLSearchParams({ date, machine }).toString());
      setGroups(g);
      setPicked(Object.fromEntries(g.map((x) => [x.shift, x.state === 'approved' ? x.selectedIds : []])));
      setNotes({});
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function save(g: Group, clear: boolean) {
    setBusy(true); setError(null);
    try {
      await api.put('/api/operations/record-review', { date, machine, shift: g.shift, selected: clear ? [] : picked[g.shift] ?? [], note: notes[g.shift] ?? '' });
      toast(clear ? `Shift ${g.shift} reset to latest record` : `Shift ${g.shift}: ${(picked[g.shift] ?? []).length} records approved as additive`);
      await inspect();
    } catch (e) { setError(e); setBusy(false); }
  }
  if (!allowed) return null;
  const toggle = (shift: string, id: string, on: boolean) => setPicked((p) => ({ ...p, [shift]: on ? [...(p[shift] ?? []), id] : (p[shift] ?? []).filter((x) => x !== id) }));
  return (
    <section className="card">
      <div className="ch"><div><h3>Multiple production record review</h3><p>When one machine-shift has several ConMas records, only the highest revision counts by default</p></div></div>
      <div className="cb">
        <form className="ops-edit" onSubmit={(e) => { e.preventDefault(); void inspect(); }}>
          <div className="ops-h">Inspect source records</div>
          <div className="ops-form">
            <Field label="Production date">{(id) => <input id={id} required type="date" value={date} onChange={(e) => { setDate(e.target.value); setGroups(null); }} />}</Field>
            <Field label="Machine">{(id) => <input id={id} required maxLength={100} placeholder="e.g. 12" value={machine} onChange={(e) => { setMachine(e.target.value); setGroups(null); }} />}</Field>
            <div className="act"><button className="btn pri" disabled={busy || !date || !machine.trim()}>{busy && !groups ? 'Inspecting…' : 'Inspect source'}</button></div>
          </div>
        </form>
        <ErrorBanner error={error} />
        {groups && !groups.length && <div className="empty">Tidak ada shift dengan record ganda untuk MC {machine} pada {fmtDate(date)}.</div>}
        {groups?.map((g) => {
          const sel = picked[g.shift] ?? [];
          const note = notes[g.shift] ?? '';
          const [chipCls, chipText] = STATE[g.state];
          return (
            <div className="ops-group" key={g.shift} style={{ marginTop: 'var(--s-size-12)' }}>
              <header>Shift {g.shift} · MC {g.machineNo} · {g.records.length} records <span className={chipCls}>{chipText}</span></header>
              <Grid rows={g.records} pageSize={50} rowKey={(r) => String(r.recordId)} cols={[
                ...(edit ? [{ k: 'pick', h: <span className="sr-only">Independent</span>, f: (r: Row) => <input type="checkbox" aria-label={'Independent record ' + text(r.recordId)} checked={sel.includes(String(r.recordId))} onChange={(e) => toggle(g.shift, String(r.recordId), e.target.checked)} /> }] : []),
                { k: 'recordId', h: 'Record ID', cl: 'mono' },
                { k: 'revision', h: 'Rev', n: true },
                { k: 'dpNo', h: 'DP No', cl: 'mono' }, { k: 'poNo', h: 'PO No', cl: 'mono' },
                { k: 'plan', h: 'Plan', n: true, f: (r) => fmtNum(r.plan, 0) }, { k: 'actual', h: 'Actual', n: true, f: (r) => fmtNum(r.actual, 0) },
                { k: 'plannedMinutes', h: 'Planned min', n: true, f: (r) => fmtNum(r.plannedMinutes, 0) },
                { k: 'updatedAt', h: 'Updated', cl: 'm', f: (r) => fmtDateTime(r.updatedAt) },
              ]} />
              {edit && (
                <div className="ops-actions" style={{ margin: 0, borderRadius: 0 }}>
                  <Field label="Verification note" wide>{(id) => <input id={id} maxLength={500} style={{ minWidth: 'min(100%, 320px)' }} placeholder="How you verified the records are independent" value={note} onChange={(e) => setNotes((n) => ({ ...n, [g.shift]: e.target.value }))} />}</Field>
                  <div className="grp">
                    <button className="btn" type="button" disabled={busy || !note.trim()} onClick={() => void save(g, true)}>Reset to latest</button>
                    <button className="btn pri" type="button" disabled={busy || !sel.length || !note.trim()} onClick={() => void save(g, false)}>Approve {sel.length || ''} additive records</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <p className="note ops-note">Approve additive records only after verifying they are independent, non-overlapping production and time. If the observed record set changes later, the shift falls back to the latest-record rule automatically.</p>
      </div>
    </section>
  );
}
