import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { IsoDate, RangeQuerySchema } from '@mpd/contracts';
import { useFilters, type Filters } from '../lib/filters';
import { add, iso } from '../lib/format';
import { presetRange, rangeTxt, type Preset } from '../lib/period';
import '../styles/period-filter.css';

const labels: Record<Preset, string> = {
  lw_tw: 'Minggu lalu – minggu ini',
  tw: 'Minggu ini',
  lw: 'Minggu lalu',
  l7: '7 hari terakhir',
  tm: 'Bulan ini',
  lm: 'Bulan lalu',
  custom: 'Rentang khusus',
};
const weekdays = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const monthLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dateLabel = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full', timeZone: 'UTC' });
const earliest = '0001-01-01';
const dateAtMidnight = (day: string) => new Date(`${day}T00:00:00Z`);
const daySteps = new Map([['ArrowLeft', -1], ['ArrowRight', 1], ['ArrowUp', -7], ['ArrowDown', 7]]);

interface Draft { from: string; to: string; preset: Preset; shift: Filters['shift'] }
export type PeriodValue = Draft;
type ShiftOption = { value: Filters['shift']; label: string };

/** Satu popover untuk periode + shift: bar filter tetap ringkas. Terhubung ke filter global halaman monitoring. */
export function PeriodFilter({ shifts }: { shifts: ShiftOption[] }) {
  const { f, setF, today } = useFilters();
  return <PeriodPicker value={f} today={today} shifts={shifts} ids
    onApply={(v) => setF({ ...(v.preset === 'custom' ? { from: v.from, to: v.to, preset: 'custom' as const } : { preset: v.preset }), shift: v.shift })} />;
}

/** Pemilih periode yang sama, tapi terkontrol: dipakai juga oleh Export Data / laporan supaya tampilan & perilaku tanggal seragam. */
export function PeriodPicker({ value: f, onApply, today, shifts, showShift = true, ids = false }: {
  value: PeriodValue; onApply: (v: PeriodValue) => void; today: string; shifts: ShiftOption[]; showShift?: boolean; ids?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ from: f.from, to: f.to, preset: f.preset, shift: f.shift });
  const [cursor, setCursor] = useState(today);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const quickSelect = useRef<HTMLSelectElement>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const preview = draft.preset === 'custom' ? draft : presetRange(draft.preset, today);

  useEffect(() => {
    if (!open) return;
    quickSelect.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && wrapper.current?.contains(document.activeElement)) {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function previewPreset(preset: Preset) {
    setSelectingEnd(false);
    if (preset === 'custom') {
      setDraft((d) => ({ ...d, from: preview.from, to: preview.to, preset }));
      return;
    }
    const range = presetRange(preset, today);
    setDraft((d) => ({ ...d, ...range, preset }));
    setCursor(range.to);
  }

  function updateDate(edge: 'from' | 'to', value: string) {
    setDraft((d) => ({ ...d, from: preview.from, to: preview.to, [edge]: value, preset: 'custom' }));
    setSelectingEnd(false);
    if (IsoDate.safeParse(value).success && value >= earliest && value <= today) setCursor(value);
  }

  function pickDay(day: string) {
    const from = selectingEnd ? draft.from : day;
    setDraft((d) => ({ ...d, from: from <= day ? from : day, to: from <= day ? day : from, preset: 'custom' }));
    setCursor(day);
    setSelectingEnd(!selectingEnd);
  }

  function moveDayFocus(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const step = daySteps.get(event.key);
    if (step === undefined) return;
    event.preventDefault();
    const next = add(dateAtMidnight(day), step).toISOString();
    if (!/^\d{4}-/.test(next)) return;
    const target = next.slice(0, 10);
    if (target < earliest || target > today) return;
    setCursor(target);
    requestAnimationFrame(() => calendar.current?.querySelector<HTMLButtonElement>(`[data-day="${target}"]`)?.focus());
  }

  const [from, to] = preview.from <= preview.to ? [preview.from, preview.to] : [preview.to, preview.from];
  const range = RangeQuerySchema.safeParse({ from, to });
  const future = to > today;
  const canApply = range.success && !future && from >= earliest;
  const days = range.success ? (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 : null;
  const message = future ? 'Tanggal melewati hari produksi ini.'
    : !from || !to ? 'Lengkapi tanggal.'
      : !range.success ? range.error.issues[0]?.message
        : from < earliest ? 'Tanggal tidak valid.' : `${days} hari`;
  const month = cursor.slice(0, 7);
  const first = dateAtMidnight(`${month}-01`);
  const leading = (first.getUTCDay() + 6) % 7;
  const nextMonth = new Date(first);
  nextMonth.setUTCMonth(first.getUTCMonth() + 1);
  const length = add(nextMonth, -1).getUTCDate();
  const weeks = Math.ceil((leading + length) / 7);
  const activeParts = [
    showShift && f.shift ? shifts.find((shift) => shift.value === f.shift)?.label : undefined,
  ].filter((part): part is string => Boolean(part));
  const activeCount = activeParts.length;
  const activeTitle = activeParts.join(' · ');

  function moveMonth(step: number) {
    const next = new Date(first);
    next.setUTCMonth(first.getUTCMonth() + step);
    setCursor(iso(next));
  }

  return (
    <div className="f period-filter" ref={wrapper} onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={trigger} className="fin pbtn" type="button" aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? dialogId : undefined} onClick={() => {
          if (open) { close(); return; }
          setDraft({ from: f.from, to: f.to, preset: f.preset, shift: f.shift });
          setCursor(f.to);
          setSelectingEnd(false);
          setOpen(true);
        }}>
        <span><b>{labels[f.preset]}</b> <span className="mono mu">{rangeTxt(f.from, f.to)}</span></span>
        {activeCount > 0 && <span className="pcount" role="img" title={activeTitle} aria-label={`${activeCount} filter tambahan aktif: ${activeTitle}`}>{activeCount}</span>}
        <span aria-hidden="true">▾</span>
      </button>
      {open && <form className="period-panel" id={dialogId} role="dialog" aria-label="Filter periode" noValidate onSubmit={(event) => {
        event.preventDefault();
        if (!canApply) return;
        onApply(draft.preset === 'custom' ? { ...draft, from, to } : { ...draft, ...presetRange(draft.preset, today) });
        close();
      }}>
        <div className="period-fields">
          <label>Periode cepat
            <select ref={quickSelect} value={draft.preset} onChange={(event) => previewPreset(event.target.value as Preset)}>
              {(Object.keys(labels) as Preset[]).map((preset) => <option key={preset} value={preset}>{labels[preset]}</option>)}
            </select>
          </label>
          {showShift && <label>Shift
            <select id={ids ? 'fShift' : undefined} value={draft.shift} onChange={(event) => setDraft((d) => ({ ...d, shift: event.target.value as Filters['shift'] }))}>
              <option value="">All shifts</option>
              {shifts.filter((shift) => shift.value).map((shift) => <option key={shift.value} value={shift.value}>{shift.label}</option>)}
            </select>
          </label>}
          <label>Dari<input type="date" min={earliest} max={today} value={preview.from} onChange={(event) => updateDate('from', event.target.value)} /></label>
          <label>Sampai<input type="date" min={earliest} max={today} value={preview.to} onChange={(event) => updateDate('to', event.target.value)} /></label>
        </div>
        <div className="period-calendar">
          <div className="period-month">
            <button className="btn" type="button" aria-label="Bulan sebelumnya" disabled={month === '0001-01'} onClick={() => moveMonth(-1)}><span aria-hidden="true">‹</span></button>
            <b aria-live="polite">{monthLabel.format(first)}</b>
            <button className="btn" type="button" aria-label="Bulan berikutnya" disabled={month >= today.slice(0, 7)} onClick={() => moveMonth(1)}><span aria-hidden="true">›</span></button>
          </div>
          <div ref={calendar} role="grid" aria-label="Kalender periode" aria-multiselectable="true">
            <div className="period-week" role="row">
              {weekdays.map((label) => <div key={label} role="columnheader">{label}</div>)}
            </div>
            {Array.from({ length: weeks }, (_, row) => (
              <div className="period-week" role="row" key={row}>
                {Array.from({ length: 7 }, (_, column) => {
                  const day = 1 + row * 7 + column - leading;
                  if (day < 1 || day > length) return <div key={column} role="gridcell" />;
                  const date = add(first, day - 1);
                  const value = iso(date);
                  const inRange = Boolean(from && to && value >= from && value <= to && value <= today);
                  const boundary = inRange && (value === from || value === to);
                  return (
                    <div key={column} role="gridcell" aria-selected={inRange}>
                      <button type="button" data-day={value} data-boundary={boundary} tabIndex={cursor === value ? 0 : -1}
                        aria-label={dateLabel.format(date)} aria-current={value === today ? 'date' : undefined}
                        disabled={value > today} onClick={() => pickDay(value)} onKeyDown={(event) => moveDayFocus(event, value)}>{day}</button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="period-actions">
          <span className={canApply ? '' : 'period-warning'} role="status">{message}</span>
          <button className="btn" type="button" onClick={close}>Batal</button>
          <button className="btn pri" type="submit" disabled={!canApply}>Terapkan</button>
        </div>
      </form>}
    </div>
  );
}
