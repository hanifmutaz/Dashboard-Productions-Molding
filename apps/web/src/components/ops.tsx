import { useId, useState, type ReactNode } from 'react';
import { ApiFailure } from '../lib/api';
import { DataTable, type Col } from './table';
import { PeriodPicker, type PeriodValue } from '../shell/PeriodFilter';
import { useFilters } from '../lib/filters';
import { useSession } from '../lib/session';
import { shiftLabel } from '../lib/period';
import '../styles/ops.css';

/* Shared building blocks for Operations Master, Export Data and report builders (one look, one behaviour). */

export type Cell = string | number | boolean | null | undefined;
export type Row = Record<string, unknown>;

export const errText = (e: unknown) => (e instanceof ApiFailure ? e.message : e instanceof Error ? e.message : 'Permintaan gagal.');

/** Labelled form control: label above, optional hint below (same pattern as Admin/Settings forms). */
export function Field({ label, hint, wide, children }: { label: ReactNode; hint?: ReactNode; wide?: boolean; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={wide ? 'fld wide' : 'fld'}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Pill toggle (re-uses the `.chks` look from Settings). */
export function Toggle({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return <label><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{children}</label>;
}

export function ErrorBanner({ error }: { error: unknown }) {
  return error ? <div className="banner e" role="alert">{errText(error)}</div> : null;
}

const DATE_TIME = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const DATE_ONLY = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
export const fmtDateTime = (v: unknown) => {
  if (typeof v !== 'string' || !v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : DATE_TIME.format(d);
};
export const fmtDate = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return typeof v === 'string' && v ? v : '—';
  return DATE_ONLY.format(new Date(v.slice(0, 10) + 'T00:00:00Z'));
};
export const fmtNum = (v: unknown, digits = 4) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits })
  : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: digits }) : '—');
export const text = (v: unknown): string => (v == null || v === '' ? '—' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));

export const yesNo = (v: unknown, yes = 'Yes', no = 'No') => (v === true || v === 'true' ? <span className="chip good">{yes}</span> : v === false || v === 'false' ? <span className="chip">{no}</span> : '—');

export const dayChip = (v: unknown) => <span className={v === 'holiday' ? 'chip warn' : v === 'overtime' ? 'chip good' : 'chip'}>{text(v)}</span>;

export interface GridCol { k: string; h: ReactNode; n?: boolean; cl?: string; f?: (r: Row) => ReactNode; sv?: (r: Row) => number | string | null }

/** Sortable, paged table for API rows. Without `cols` every key is shown with a humanised header. */
export function Grid({ rows, cols, empty = 'Tidak ada data', pageSize = 25, sort, rowKey }: { rows: Row[]; cols?: GridCol[]; empty?: ReactNode; pageSize?: number; sort?: { k: string; asc: boolean }; rowKey?: (r: Row, i: number) => string }) {
  const keys: GridCol[] = cols ?? Object.keys(rows[0] ?? {}).map((k) => ({ k, h: humanize(k) }));
  const indexed = rows.map((r, i) => ({ ...r, __i: i }));
  const columns: Col<Row>[] = keys.map((c) => ({
    k: c.k, h: c.h, n: c.n, cl: c.cl ?? (c.n ? 'm' : undefined),
    f: c.f ?? ((r: Row) => text(r[c.k])),
    sv: c.sv ?? ((r: Row) => { const v = r[c.k]; return typeof v === 'number' || typeof v === 'string' ? v : v == null ? null : text(v); }),
  }));
  return (
    <div className="ops-table">
      <DataTable<Row> rows={indexed} cols={columns} pageSize={pageSize} sort={sort} empty={empty}
        rowKey={(r) => (rowKey ? rowKey(r, Number(r.__i)) : String(r.__i))} />
    </div>
  );
}

export const humanize = (k: string) => k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** Small stat pills for result summaries ("1,204 rows · 3 invalid"). */
export function Stats({ items }: { items: { label: string; value: ReactNode; warn?: boolean }[] }) {
  return <div className="ops-stats">{items.map((s) => <span key={s.label} className={s.warn ? 'ops-stat warn' : 'ops-stat'}><b>{s.value}</b>{s.label}</span>)}</div>;
}

const Arrow = ({ d }: { d: 'left' | 'right' }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} /></svg>;

/** Column picker: toggle pills + numbered order list (order = export order). */
export function ColumnPicker({ all, value, onChange, label = (k: string) => humanize(k), disabled }: { all: string[]; value: string[]; onChange: (v: string[]) => void; label?: (k: string) => string; disabled?: boolean }) {
  const move = (i: number, by: -1 | 1) => { const next = [...value]; const j = i + by; [next[i], next[j]] = [next[j]!, next[i]!]; onChange(next); };
  return (
    <div className="ops-sec">
      <div className="ops-h"><span>Columns · {value.length} of {all.length}</span>
        <span className="fa">
          <button type="button" className="btn" disabled={disabled || value.length === all.length} onClick={() => onChange([...value, ...all.filter((k) => !value.includes(k))])}>Select all</button>{' '}
          <button type="button" className="btn" disabled={disabled || !value.length} onClick={() => onChange([])}>Clear</button>
        </span>
      </div>
      <div className="chks" role="group" aria-label="Columns">
        {all.map((k) => <Toggle key={k} disabled={disabled} checked={value.includes(k)} onChange={(on) => onChange(on ? [...value, k] : value.filter((x) => x !== k))}>{label(k)}</Toggle>)}
      </div>
      {value.length > 1 && <>
        <div className="ops-h" style={{ marginTop: 'var(--s-size-14)', marginBottom: 0 }}><span>Export order</span><span className="fa">Use the arrows to reorder</span></div>
        <ol className="ops-order" aria-label="Column order">
          {value.map((k, i) => (
            <li key={k}>{label(k)}
              <button type="button" aria-label={'Move ' + k + ' left'} disabled={disabled || i === 0} onClick={() => move(i, -1)}><Arrow d="left" /></button>
              <button type="button" aria-label={'Move ' + k + ' right'} disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)}><Arrow d="right" /></button>
            </li>
          ))}
        </ol>
      </>}
    </div>
  );
}

export type { PeriodValue };

/** Report period state, starting from the same period as the monitoring pages. */
export function useOpsRange() {
  const { f } = useFilters();
  return useState<PeriodValue>(() => ({ from: f.from, to: f.to, preset: f.preset, shift: f.shift, status: '' }));
}

/** Period field: the same popover picker as Production / Stop Time (presets, calendar, shift). */
export function RangeField({ label = 'Period', value, onChange, shift = true, wide = true }: { label?: ReactNode; value: PeriodValue; onChange: (v: PeriodValue) => void; shift?: boolean; wide?: boolean }) {
  const { today } = useFilters();
  const { settings } = useSession();
  const shifts = [1, 2, 3].map((n) => ({ value: String(n) as PeriodValue['shift'], label: shiftLabel(settings.shifts, n) }));
  return (
    <div className={wide ? 'fld wide ops-range' : 'fld ops-range'}>
      <span className="lb">{label}</span>
      <PeriodPicker value={value} onApply={onChange} today={today} shifts={shifts} showShift={shift} />
    </div>
  );
}
