import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS } from '@mpd/contracts';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { downloadCsv } from '../components/table';
import { downloadXlsx } from '../lib/xlsx';
import { Kpi } from '../components/kpi';
import { Seg, useToast } from '../components/ui';
import { ColumnPicker, ErrorBanner, Field, Grid, RangeField, Stats, useOpsRange, dayChip, fmtDate, fmtDateTime, fmtNum, text, yesNo, type GridCol, type Row } from '../components/ops';
import { CompletionMaster, StopReportBuilder, QualityHistory, RecordReview } from './OperationsCompletion';

type MasterTab = 'machines' | 'prices' | 'calendar';
const DAY_TYPES = ['working', 'holiday', 'overtime'] as const;

const MASTER_COLS: Record<MasterTab, GridCol[]> = {
  machines: [
    { k: 'machine_no', h: 'Machine', cl: 'mc', f: (r) => `MC ${text(r.machine_no)}` },
    { k: 'label', h: 'Label' },
    { k: 'active', h: 'Status', f: (r) => yesNo(r.active, 'Active', 'Inactive') },
    { k: 'last_seen', h: 'Last seen in ConMas', cl: 'm', f: (r) => fmtDateTime(r.last_seen) },
  ],
  prices: [
    { k: 'changed_at', h: 'Changed', cl: 'm', f: (r) => fmtDateTime(r.changed_at) },
    { k: 'entity_type', h: 'Type', f: (r) => <span className="chip">{text(r.entity_type)}</span> },
    { k: 'entity_key', h: 'Master code', cl: 'mono' },
    { k: 'old_price', h: 'Old price (Rp)', n: true, f: (r) => fmtNum(r.old_price) },
    { k: 'new_price', h: 'New price (Rp)', n: true, f: (r) => <b>{fmtNum(r.new_price)}</b> },
  ],
  calendar: [
    { k: 'work_date', h: 'Date', cl: 'm', f: (r) => fmtDate(r.work_date) },
    { k: 'day_type', h: 'Day type', f: (r) => dayChip(r.day_type) },
    { k: 'planned_minutes', h: 'Planned minutes', n: true, f: (r) => fmtNum(r.planned_minutes, 0) },
    { k: 'note', h: 'Note', cl: 'mu wrap' },
  ],
};

export function OperationsPage() {
  const { can } = useSession();
  const toast = useToast();
  const edit = can(PERMISSIONS.editMasterData);
  const q = useQuery({ queryKey: ['operations-master'], queryFn: () => api.get<{ machines: Row[]; prices: Row[]; calendar: Row[] }>('/api/operations/master') });
  const [tab, setTab] = useState<MasterTab>('machines');
  const [date, setDate] = useState(''); const [dayType, setDayType] = useState('working'); const [minutes, setMinutes] = useState(''); const [note, setNote] = useState('');
  const [machine, setMachine] = useState(''); const [label, setLabel] = useState(''); const [active, setActive] = useState(true);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError(null);
    try {
      if (tab === 'calendar') await api.put('/api/operations/calendar', { date, dayType, minutes: minutes === '' ? null : Number(minutes), note });
      else await api.put('/api/operations/machines', { machineNo: machine, label, active });
      await q.refetch();
      toast(tab === 'calendar' ? `Calendar ${fmtDate(date)} saved` : `MC ${machine} saved`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  const machines = q.data?.machines ?? [];
  return (
    <section className="view on"><div className="content">
      <div className="deck u4">
        <Kpi l="Machines" v={q.data ? machines.filter((m) => m.active !== false).length : '—'} u={q.data ? `/ ${machines.length}` : undefined} desc="Active in the machine registry" />
        <Kpi l="Price changes" v={q.data?.prices.length ?? '—'} u="events" desc="Recorded master price changes (latest 500)" />
        <Kpi l="Calendar overrides" v={q.data?.calendar.length ?? '—'} u="days" desc="Holiday, overtime or custom planned minutes" />
      </div>
      <div className="card">
        <div className="ch">
          <div><h3>Machine registry &amp; work calendar</h3><p>Administrative metadata · existing KPI formulas are unchanged</p></div>
          <div style={{ display: 'flex', gap: 'var(--s-size-8)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Seg value={tab} onChange={(t) => { setTab(t); setError(null); }} items={[{ id: 'machines', label: 'Machines' }, { id: 'prices', label: 'Price history' }, { id: 'calendar', label: 'Work calendar' }]} />
            <button className="btn" type="button" disabled={q.isFetching} onClick={() => void q.refetch()}>{q.isFetching ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>
        <div className="cb">
          <ErrorBanner error={q.error} />
          {edit && tab !== 'prices' && (
            <form className="ops-edit" style={q.error ? { marginTop: 'var(--s-size-12)' } : undefined} onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <div className="ops-h">{tab === 'machines' ? 'Edit machine' : 'Add or update a calendar day'}</div>
              <div className="ops-form">
                {tab === 'machines' ? <>
                  <Field label="Machine">{(id) => (
                    <select id={id} required value={machine} onChange={(e) => { const m = machines.find((x) => x.machine_no === e.target.value); setMachine(e.target.value); setLabel(typeof m?.label === 'string' ? m.label : ''); setActive(m?.active !== false); }}>
                      <option value="">Select machine…</option>
                      {machines.map((m) => <option key={String(m.machine_no)} value={String(m.machine_no)}>MC {String(m.machine_no)}</option>)}
                    </select>)}
                  </Field>
                  <Field label="Label">{(id) => <input id={id} maxLength={100} placeholder="e.g. Line A – 350T" value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
                  <Field label="Status">{(id) => <select id={id} value={active ? 'active' : 'inactive'} onChange={(e) => setActive(e.target.value === 'active')}><option value="active">Active</option><option value="inactive">Inactive</option></select>}</Field>
                </> : <>
                  <Field label="Date">{(id) => <input id={id} required type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
                  <Field label="Day type">{(id) => <select id={id} value={dayType} onChange={(e) => setDayType(e.target.value)}>{DAY_TYPES.map((d) => <option key={d} value={d}>{d[0]!.toUpperCase() + d.slice(1)}</option>)}</select>}</Field>
                  <Field label="Planned minutes" hint="Blank = default schedule">{(id) => <input id={id} type="number" min="0" max="1440" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}</Field>
                  <Field label="Note">{(id) => <input id={id} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
                </>}
                <div className="act"><button className="btn pri" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
              </div>
              {error ? <div style={{ marginTop: 'var(--s-size-10)' }}><ErrorBanner error={error} /></div> : null}
            </form>
          )}
          <Grid rows={q.data?.[tab] ?? []} cols={MASTER_COLS[tab]} empty={q.isPending ? 'Memuat…' : q.isError ? 'Data tidak bisa dimuat' : 'Tidak ada data'} />
          {tab === 'prices' && <p className="note ops-note">Price history shows recorded changes to the master price. Effective valuation events (used for historical Sales/Scrap) are managed in the card below.</p>}
        </div>
      </div>
      <CompletionMaster /><QualityHistory /><RecordReview />
    </div></section>
  );
}

const FIELDS = ['date', 'machineNo', 'shift', 'dpNo', 'productName', 'plan', 'actual', 'gross', 'ngQty', 'ngGram', 'plannedMinutes', 'oee', 'availability', 'performance', 'updatedAt'];
const NUMERIC = new Set(['plan', 'actual', 'gross', 'ngQty', 'ngGram', 'plannedMinutes', 'oee', 'availability', 'performance']);
const FIELD_LABEL: Record<string, string> = { date: 'Date', machineNo: 'Machine', shift: 'Shift', dpNo: 'DP No', productName: 'Product name', plan: 'Plan', actual: 'Actual', gross: 'Gross', ngQty: 'NG qty', ngGram: 'NG gram', plannedMinutes: 'Planned min', oee: 'OEE', availability: 'Availability', performance: 'Performance', updatedAt: 'Updated at' };
const STANDARD = FIELDS.slice(0, 7);
type Report = { columns: string[]; rows: (string | number | null)[][]; total: number; invalid: number; duplicates: number };
type Quality = { records: number; invalid: number; duplicates: number; missingOutput: number; missingTimestamp: number; negativeOutput: number };

export function ExportPage() {
  const { can } = useSession();
  const toast = useToast();
  const [period, setPeriod] = useOpsRange(); const { from, to, shift } = period; const [machine, setMachine] = useState(''); const [product, setProduct] = useState('');
  const [cols, setCols] = useState(STANDARD); const [name, setName] = useState('');
  const [report, setReport] = useState<Report | null>(null); const [quality, setQuality] = useState<Quality | null>(null);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const allowed = can(PERMISSIONS.viewProduction) && can(PERMISSIONS.exportProduction);
  const saved = useQuery({ queryKey: ['operations-templates'], queryFn: () => api.get<{ templates: { name: string; columns: string[] }[]; history: Row[] }>('/api/operations/templates'), enabled: allowed });
  const range = { from, to, ...(shift ? { shift } : {}) };
  const reset = () => { setReport(null); setQuality(null); };
  async function run(download: boolean, format: 'csv' | 'xlsx' = 'csv') {
    setBusy(true); setError(null); reset();
    try {
      const r = await api.post<Report>('/api/operations/report', { range, columns: cols, machine, product, download });
      setReport(r);
      if (download) {
        if (format === 'xlsx') downloadXlsx(`molding_${from}_${to}.xlsx`, [r.columns, ...r.rows]); else downloadCsv(`molding_${from}_${to}.csv`, [r.columns, ...r.rows]);
        toast(`${r.total.toLocaleString('en-US')} rows exported`);
        void saved.refetch();
      }
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function checkQuality() {
    setBusy(true); setError(null); reset();
    try { setQuality(await api.get<Quality>('/api/operations/quality?' + qs(range))); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function saveTemplate() {
    setBusy(true); setError(null);
    try { await api.put('/api/operations/templates', { name: name.trim(), columns: cols }); await saved.refetch(); toast(`Template "${name.trim()}" saved`); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  if (!allowed) return <section className="view on"><div className="content"><div className="card"><div className="empty">Tidak memiliki hak akses laporan produksi.</div></div></div></section>;
  const rangeIssue = !from || !to ? 'Pick a date range first' : from > to ? '"From" must be on or before "To"' : null;
  const disabledReason = rangeIssue ?? (!cols.length ? 'Select at least one column' : null);
  return (
    <section className="view on"><div className="content">
      <div className="card">
        <div className="ch"><div><h3>Production report builder</h3><p>Raw production records from ConMas · preview shows the first 100 rows · data can be delayed</p></div></div>
        <div className="cb">
          <div className="ops-sec">
            <div className="ops-h">Filters</div>
            <div className="ops-form">
              <RangeField label="Period & shift" value={period} onChange={(v) => { setPeriod(v); reset(); }} />
              <Field label="Machine">{(id) => <input id={id} placeholder="All machines" value={machine} onChange={(e) => { setMachine(e.target.value); reset(); }} />}</Field>
              <Field label="Product / DP No">{(id) => <input id={id} placeholder="All products" value={product} onChange={(e) => { setProduct(e.target.value); reset(); }} />}</Field>
            </div>
          </div>
          <ColumnPicker all={FIELDS} value={cols} label={(k) => FIELD_LABEL[k] ?? k} disabled={busy} onChange={(c) => { setCols(c); reset(); }} />
          <div className="ops-sec">
            <div className="ops-h">Templates</div>
            <div className="ops-form">
              <Field label="Load template">{(id) => (
                <select id={id} aria-label="Saved templates" value="" disabled={!saved.data?.templates.length} onChange={(e) => { const t = saved.data?.templates.find((x) => x.name === e.target.value); if (t) { setCols(t.columns); setName(t.name); reset(); } }}>
                  <option value="">{saved.data?.templates.length ? 'Choose a saved template…' : 'No saved templates yet'}</option>
                  {saved.data?.templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>)}
              </Field>
              <Field label="Save current columns as">{(id) => <input id={id} placeholder="Template name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <div className="act wide">
                <button className="btn" type="button" disabled={busy || !name.trim() || !cols.length} onClick={() => void saveTemplate()}>Save template</button>
                <button className="btn" type="button" disabled={busy} onClick={() => { setCols(STANDARD); reset(); }}>Standard columns</button>
              </div>
            </div>
          </div>
          {error ? <div style={{ marginTop: 'var(--s-size-14)' }}><ErrorBanner error={error} /></div> : null}
          {quality && (
            <div className="ops-sec">
              <div className="ops-h">Data quality · {fmtDate(from)} – {fmtDate(to)}</div>
              <Stats items={[
                { label: 'records', value: fmtNum(quality.records, 0) },
                { label: 'invalid rows', value: fmtNum(quality.invalid, 0), warn: quality.invalid > 0 },
                { label: 'revisions dropped', value: fmtNum(quality.duplicates, 0) },
                { label: 'missing plan/actual', value: fmtNum(quality.missingOutput, 0), warn: quality.missingOutput > 0 },
                { label: 'missing timestamp', value: fmtNum(quality.missingTimestamp, 0), warn: quality.missingTimestamp > 0 },
                { label: 'negative output', value: fmtNum(quality.negativeOutput, 0), warn: quality.negativeOutput > 0 },
              ]} />
            </div>
          )}
          {report && (
            <div className="ops-sec">
              <div className="ops-h">Preview</div>
              <Stats items={[{ label: 'rows', value: fmtNum(report.total, 0) }, { label: 'invalid', value: fmtNum(report.invalid, 0), warn: report.invalid > 0 }, { label: 'duplicates dropped', value: fmtNum(report.duplicates, 0) }]} />
              <Grid rows={report.rows.slice(0, 100).map((row) => Object.fromEntries(report.columns.map((k, i) => [k, row[i] ?? null])))}
                cols={report.columns.map((k) => ({ k, h: FIELD_LABEL[k] ?? k, n: NUMERIC.has(k), f: k === 'updatedAt' ? (r: Row) => fmtDateTime(r[k]) : NUMERIC.has(k) ? (r: Row) => fmtNum(r[k], 2) : undefined }))}
                empty="Tidak ada record untuk filter ini" />
            </div>
          )}
          <div className="ops-actions">
            <span className="hint">{disabledReason ?? `${cols.length} columns · ${fmtDate(from)} – ${fmtDate(to)}${shift ? ` · shift ${shift}` : ''}`}</span>
            <div className="grp">
              <button className="btn" type="button" disabled={busy || !!rangeIssue} onClick={() => void checkQuality()}>Data quality</button>
              <button className="btn" type="button" disabled={busy || !!disabledReason} onClick={() => void run(false)}>{busy ? 'Working…' : 'Preview'}</button>
              <button className="btn pri" type="button" disabled={busy || !!disabledReason} onClick={() => void run(true)}>Export CSV</button>
              <button className="btn pri" type="button" disabled={busy || !!disabledReason} onClick={() => void run(true, 'xlsx')}>Export Excel</button>
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="ch"><div><h3>Export history</h3><p>Your last 50 exports</p></div></div>
        <div className="cb">
          <Grid rows={saved.data?.history ?? []} pageSize={10} empty={saved.isPending ? 'Memuat…' : 'Belum ada export'} cols={[
            { k: 'created_at', h: 'Exported', cl: 'm', f: (r) => fmtDateTime(r.created_at) },
            { k: 'type', h: 'Report', f: (r) => <span className="chip">{(r.filters as { type?: string } | null)?.type === 'stop-time' ? 'Stop time' : 'Production'}</span> },
            { k: 'filters', h: 'Filters', cl: 'mu wrap', f: (r) => filterSummary(r.filters) },
            { k: 'row_count', h: 'Rows', n: true, f: (r) => fmtNum(r.row_count, 0) },
          ]} />
        </div>
      </div>
      <StopReportBuilder /><QualityHistory />
    </div></section>
  );
}

/** md_export_history.filters (jsonb) → "Nov 1 – Nov 7 · shift 2 · MC 12 · 7 columns". */
function filterSummary(v: unknown): string {
  if (!v || typeof v !== 'object') return text(v);
  const f = v as { range?: { from?: string; to?: string; shift?: string }; machine?: string; product?: string; category?: string; columns?: unknown[] };
  const r = f.range ?? {};
  return [r.from && r.to ? `${fmtDate(r.from)} – ${fmtDate(r.to)}` : null, r.shift ? `shift ${r.shift}` : null, f.machine ? `MC ${f.machine}` : null,
    f.product ? `product ${f.product}` : null, f.category ? `category ${f.category}` : null, Array.isArray(f.columns) ? `${f.columns.length} columns` : null].filter(Boolean).join(' · ') || '—';
}
