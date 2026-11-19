import { z } from 'zod';
import type pg from 'pg';
import { MACHINE_PERSONNEL_ROLES, type MachineMaster, type MachinePersonnelRole } from '@mpd/contracts';
import type { Logger } from '../../logger.js';
import { HEADER_COLUMNS, HOUR_BLOCKS } from './fieldMap.generated.js';

/* Anti-corruption layer (ADR-021): ConMas view -> SELECT-only role -> this adapter -> Zod-validated SourceRecord.
 * Physical cluster_* names stay here. Field meanings are PROPOSED (STATE §10) until confirmed by the owner. */

export interface SourceSlot { block: number; startHour: number | null; qty: number | null; minutes: number | null; category: string | null; detail: string | null; reject: string | null; rejectQty: number | null }
export interface SourceRecord {
  recordId: string;
  date: string;
  machineNo: string;
  shift: '1' | '2' | '3';
  group: string | null;
  cavity: string | null;
  plan: number | null;
  actual: number | null;
  gross: number | null;
  ngQty: number | null;
  /** NG (GRAM) 1 dari ConMas, satuan gram (bukan kg). */
  ngGram: number | null;
  dpNo: string | null;
  productName: string | null;
  poNo: string | null;
  ctActual: number | null;
  plannedMinutes: number | null;
  /** OEE / Availability / Performance as published by ConMas, normalised to percent (0-100). null when the column is absent or empty. */
  oee: number | null;
  availability: number | null;
  performance: number | null;
  personnel: Record<MachinePersonnelRole, string | null>;
  personnelNames?: Partial<Record<MachinePersonnelRole, string | null>>;
  /** ISO with offset; null when the source timestamp is missing/invalid. */
  updatedAt: string | null;
  slots: SourceSlot[];
}
export interface SourceResult { records: SourceRecord[]; invalidRows: number; duplicatesDropped: number }

export class SourceUnavailable extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export interface ConmasSource {
  records(from: string, to: string, machineNo?: string): Promise<SourceResult>;
  adjacentDates(date: string, machineNo?: string): Promise<{ prev: string | null; next: string | null }>;
  machines(): Promise<MachineMaster[]>;
  health(): Promise<{ ok: boolean; reason?: string; missingColumns?: string[] }>;
  invalidate(): void;
}

/** Optional ConMas columns holding OEE / Availability / Performance (owner 2026-11-17: read them from ConMas). */
export interface RateColumns { oee: string | null; availability: string | null; performance: string | null }
export const NO_RATE_COLUMNS: RateColumns = { oee: null, availability: null, performance: null };

export interface ConmasConfig {
  view: string;
  tzOffset: string;
  cacheTtlSeconds: number;
  cols: { recordId: string | null; revNo: string | null; deleted: string | null; updatedAt: string | null };
  /** Columns for OEE/Availability/Performance. Used only when they really exist in the view. */
  rates?: RateColumns;
  /** `percent`: ConMas stores 0-100. `fraction`: ConMas stores 0-1 and is multiplied by 100. */
  rateScale?: 'percent' | 'fraction';
  /** Optional names from the same production row as the NIKs. */
  personnelNames?: Partial<Record<MachinePersonnelRole, string | null>>;
}

// ---------- row validation & normalisation (pure, unit-tested) ----------
const num = z.union([z.number(), z.string(), z.null(), z.undefined()]).transform((v, ctx) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: 'custom', message: 'bukan angka' });
    return z.NEVER;
  }
  return n;
});
const text = z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s === "''" ? null : s;
});

const SHIFT_MAP: Record<string, '1' | '2' | '3'> = { S1: '1', S2: '2', S3: '3', '1': '1', '2': '2', '3': '3' };
const TRUTHY = new Set(['1', 't', 'true', 'y', 'yes']);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' ? String(v) : '');

export function toIsoWithOffset(raw: unknown, offset: string): string | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(raw.trim());
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}${(m[3] ?? '').slice(0, 4)}${offset}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function parseHourLabel(label: string | null): number | null {
  const m = label ? /^(\d{1,2})[.:]\d{2}/.exec(label) : null;
  return m ? Number(m[1]) % 24 : null;
}

/** Optional rate value: absent / empty / non-numeric -> null (never invalidates the row). */
export function parseRate(raw: unknown, scale: 'percent' | 'fraction'): number | null {
  const r = num.safeParse(raw);
  if (!r.success || r.data === null) return null;
  return scale === 'fraction' ? r.data * 100 : r.data;
}

export function normalizeRow(row: Record<string, unknown>, cfg: ConmasConfig): SourceRecord | null {
  const H = HEADER_COLUMNS;
  const date = typeof row[H.productionDate] === 'string' ? (row[H.productionDate] as string).slice(0, 10) : null;
  const shift = SHIFT_MAP[str(row[H.shift]).trim().toUpperCase()];
  const machineNo = text.parse(row[H.machineNo]);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !shift || !machineNo) return null;
  const n = (c: string) => num.safeParse(row[c]);
  const nums = { plan: n(H.outputPlan), actual: n(H.outputActual), gross: n(H.outputGross), ng: n(H.ngQty), ngGram: n(H.ngGram), ct: n(H.ctActual), planned: n(H.plannedMinutes) };
  if (Object.values(nums).some((r) => !r.success)) return null;
  const v = (r: (typeof nums)['plan']) => (r.success ? r.data : null);
  const rc = cfg.rates ?? NO_RATE_COLUMNS, rs = cfg.rateScale ?? 'percent';
  const rate = (c: string | null) => (c ? parseRate(row[c], rs) : null);
  const personnelNames: NonNullable<SourceRecord['personnelNames']> = {};
  for (const role of MACHINE_PERSONNEL_ROLES) {
    const column = cfg.personnelNames?.[role];
    if (!column) continue;
    const name = text.safeParse(row[column]);
    if (name.success && name.data && name.data !== '-') personnelNames[role] = name.data;
  }
  const slots: SourceSlot[] = [];
  HOUR_BLOCKS.forEach((b, block) => {
    const startHour = parseHourLabel(text.parse(row[b.label]));
    for (const s of b.slots) {
      const minutes = s.minutes ? num.safeParse(row[s.minutes]) : null;
      const qty = num.safeParse(row[s.qty]);
      const rq = s.rejectQty ? num.safeParse(row[s.rejectQty]) : null;
      const slot: SourceSlot = {
        block, startHour,
        qty: qty.success ? qty.data : null,
        minutes: minutes?.success ? minutes.data : null,
        category: s.category ? text.parse(row[s.category]) : null,
        detail: s.detail ? text.parse(row[s.detail]) : null,
        reject: s.reject ? text.parse(row[s.reject]) : null,
        rejectQty: rq?.success ? rq.data : null,
      };
      if (slot.category || slot.reject || slot.qty !== null || slot.minutes !== null) slots.push(slot);
    }
  });
  return {
    recordId: cfg.cols.recordId ? str(row[cfg.cols.recordId]) : `${date}|${machineNo}|${shift}`,
    date, machineNo, shift,
    group: text.parse(row[H.group]), cavity: text.parse(row[H.cavity]),
    plan: v(nums.plan), actual: v(nums.actual), gross: v(nums.gross), ngQty: v(nums.ng), ngGram: v(nums.ngGram),
    dpNo: text.parse(row[H.dpNo]), productName: text.parse(row[H.productName]), poNo: text.parse(row[H.poNo]),
    ctActual: v(nums.ct), plannedMinutes: v(nums.planned),
    oee: rate(rc.oee), availability: rate(rc.availability), performance: rate(rc.performance),
    personnel: { leader: text.parse(row[H.leaderNik]), cell: text.parse(row[H.cellLeaderNik]), technician: text.parse(row[H.technicianNik]), operator: text.parse(row[H.operatorNik]) },
    personnelNames,
    updatedAt: cfg.cols.updatedAt ? toIsoWithOffset(row[cfg.cols.updatedAt], cfg.tzOffset) : null,
    slots,
  };
}

/** Q-019 (owner: "pakai yang terbaru"): per machine+date+shift keep highest rev_no; tie -> latest update; deleted rows excluded before. */
export function selectLatest(rows: { rec: SourceRecord; rev: number }[]): { records: SourceRecord[]; dropped: number } {
  const best = new Map<string, { rec: SourceRecord; rev: number }>();
  for (const r of rows) {
    const k = `${r.rec.date}|${r.rec.machineNo}|${r.rec.shift}`;
    const cur = best.get(k);
    if (!cur || r.rev > cur.rev || (r.rev === cur.rev && (r.rec.updatedAt ?? '') > (cur.rec.updatedAt ?? ''))) best.set(k, r);
  }
  return { records: [...best.values()].map((x) => x.rec), dropped: rows.length - best.size };
}

const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;
const ALL_DATA_COLUMNS = [...Object.values(HEADER_COLUMNS), ...HOUR_BLOCKS.flatMap((b) => [b.label, ...b.slots.flatMap((s) => Object.values(s) as string[])])];

export const machineSort = (a: string, b: string) => {
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
};

export function createConmasSource(pool: pg.Pool, cfg: ConmasConfig, log: Logger): ConmasSource {
  const cache = new Map<string, { at: number; value: SourceResult }>();
  const inFlight = new Map<string, Promise<SourceResult>>();
  let schemaCheck: { at: number; missing: string[] } | null = null;
  /** Rate columns that are configured AND present in the view; the rest are silently skipped (shown as "—" with a reason). */
  let activeRates: RateColumns = NO_RATE_COLUMNS;
  let activeNames: ConmasConfig['personnelNames'] = {};
  const sysCols = Object.entries(cfg.cols).filter(([, v]) => !v).map(([k]) => k);

  async function missingColumns(): Promise<string[]> {
    if (schemaCheck && Date.now() - schemaCheck.at < 10 * 60_000) return schemaCheck.missing;
    const r = await pool.query<{ column_name: string }>('SELECT column_name FROM information_schema.columns WHERE table_name = $1', [cfg.view]);
    const have = new Set(r.rows.map((x) => x.column_name));
    const wanted = [...ALL_DATA_COLUMNS, ...Object.values(cfg.cols).filter((x): x is string => !!x)];
    const missing = have.size === 0 ? ['<view tidak ditemukan atau tidak ada hak SELECT>'] : wanted.filter((c) => !have.has(c));
    schemaCheck = { at: Date.now(), missing };
    const want = cfg.rates ?? NO_RATE_COLUMNS;
    const pick = (c: string | null) => (c && have.has(c) ? c : null);
    activeRates = { oee: pick(want.oee), availability: pick(want.availability), performance: pick(want.performance) };
    activeNames = Object.fromEntries(MACHINE_PERSONNEL_ROLES.map((role) => [role, pick(cfg.personnelNames?.[role] ?? null)]));
    const absent = (Object.keys(want) as (keyof RateColumns)[]).filter((k) => want[k] && !activeRates[k]).map((k) => want[k]);
    if (absent.length) log.warn({ absent }, 'ConMas rate columns configured but not found in view; OEE/Availability/Performance stay unavailable');
    if (missing.length) log.warn({ missing: missing.slice(0, 20), count: missing.length }, 'ConMas schema drift detected');
    return missing;
  }

  async function guard() {
    if (sysCols.length)
      throw new SourceUnavailable('CONMAS_SYSTEM_COLUMNS', `Kolom sistem ConMas belum dikonfigurasi (${sysCols.join(', ')}). Pemilihan record terbaru (Q-019) tidak bisa dilakukan, data tidak ditampilkan.`);
    const missing = await missingColumns().catch((e: unknown) => {
      log.error({ err: e }, 'ConMas unreachable');
      throw new SourceUnavailable('CONMAS_UNREACHABLE', 'Sumber data ConMas tidak dapat dihubungi.');
    });
    if (missing.length) throw new SourceUnavailable('CONMAS_SCHEMA_DRIFT', `Struktur view ConMas berubah: ${missing.length} kolom tidak ditemukan.`);
  }

  async function query(from: string, to: string, machineNo?: string): Promise<SourceResult> {
    await guard();
    const c = cfg.cols as { recordId: string; revNo: string; deleted: string; updatedAt: string };
    const names = machineNo ? activeNames : undefined;
    const { oee, availability, performance } = activeRates;
    const optionalColumns = [oee, availability, performance, ...MACHINE_PERSONNEL_ROLES.map((role) => names?.[role])].filter((x): x is string => !!x);
    const cols = [...new Set([...ALL_DATA_COLUMNS, c.recordId, c.revNo, c.deleted, c.updatedAt, ...optionalColumns])].map(quote).join(', ');
    const values: unknown[] = [from, to];
    let sql = `SELECT ${cols} FROM ${quote(cfg.view)} WHERE ${quote(HEADER_COLUMNS.productionDate)} >= $1::date AND ${quote(HEADER_COLUMNS.productionDate)} < ($2::date + 1)`;
    if (machineNo) {
      values.push(machineNo);
      sql += ` AND trim(${quote(HEADER_COLUMNS.machineNo)}) = $3`;
    }
    const started = Date.now();
    let res: pg.QueryResult<Record<string, unknown>>;
    try {
      res = await pool.query<Record<string, unknown>>(sql, values);
    } catch (e) {
      log.error({ err: e, ms: Date.now() - started }, 'ConMas query failed');
      throw new SourceUnavailable('CONMAS_QUERY_FAILED', 'Gagal membaca data ConMas (timeout atau koneksi).');
    }
    log.debug({ ms: Date.now() - started, rows: res.rowCount }, 'ConMas query');
    let invalid = 0;
    const kept: { rec: SourceRecord; rev: number }[] = [];
    for (const row of res.rows) {
      if (TRUTHY.has(str(row[c.deleted]).trim().toLowerCase())) continue;
      const rec = normalizeRow(row, { ...cfg, rates: activeRates, personnelNames: names });
      const rev = Number(row[c.revNo]);
      if (!rec || !Number.isFinite(rev)) {
        invalid++;
        continue;
      }
      kept.push({ rec, rev });
    }
    const sel = selectLatest(kept);
    return { records: sel.records, invalidRows: invalid, duplicatesDropped: sel.dropped };
  }

  const records = async (from: string, to: string, machineNo?: string): Promise<SourceResult> => {
    const key = `${from}|${to}|${machineNo ?? ''}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cfg.cacheTtlSeconds * 1000) return hit.value;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const task = query(from, to, machineNo).then((value) => {
      if (inFlight.get(key) === task) {
        cache.set(key, { at: Date.now(), value });
        if (cache.size > 200) cache.delete(cache.keys().next().value!);
      }
      return value;
    }).finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); });
    inFlight.set(key, task);
    return task;
  };

  return {
    records,
    async adjacentDates(date, machineNo) {
      await guard();
      const d = quote(HEADER_COLUMNS.productionDate);
      const mc = machineNo ? ` AND trim(${quote(HEADER_COLUMNS.machineNo)}) = $2` : '';
      const v = machineNo ? [date, machineNo] : [date];
      try {
        const result = await pool.query<{ prev: string | null; next: string | null }>(`
          SELECT (SELECT max(${d})::date::text FROM ${quote(cfg.view)} WHERE ${d} < $1::date${mc}) AS prev,
                 (SELECT min(${d})::date::text FROM ${quote(cfg.view)} WHERE ${d} >= ($1::date + 1)${mc}) AS next`, v);
        return result.rows[0] ?? { prev: null, next: null };
      } catch (e) {
        log.error({ err: e }, 'ConMas adjacent query failed');
        throw new SourceUnavailable('CONMAS_QUERY_FAILED', 'Gagal membaca data ConMas (timeout atau koneksi).');
      }
    },
    async machines() {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const { records: rs } = await records(from, to);
      const latest = new Map<string, SourceRecord>();
      for (const r of rs) {
        const cur = latest.get(r.machineNo);
        if (!cur || r.date > cur.date) latest.set(r.machineNo, r);
      }
      return [...latest.values()]
        .sort((a, b) => machineSort(a.machineNo, b.machineNo))
        .map((r) => ({ machineNo: r.machineNo, dpNo: r.dpNo, productName: r.productName, cavity: r.cavity, lastSeen: r.date }));
    },
    async health() {
      try {
        await guard();
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof SourceUnavailable ? e.code : 'UNKNOWN', missingColumns: schemaCheck?.missing.slice(0, 20) };
      }
    },
    invalidate() {
      cache.clear();
      inFlight.clear();
    },
  };
}
