import { z } from 'zod';
import type { Metric } from './envelope.js';

/** Loss groups and OEE buckets come from Master Data (stop categories). */
export const LossGroupSchema = z.enum(['setup', 'breakdown', 'quality', 'minor', 'planned', 'unmapped']);
export type LossGroup = z.infer<typeof LossGroupSchema>;

export interface ProductionTotals {
  plan: number;
  actual: number;
  planReported?: boolean;
  actualReported?: boolean;
  gross: number | null;
  reject: number | null;
  /** Approved: actual / plan * 100. null when plan = 0. */
  bekidoritsu: Metric;
  deviation: number;
  /** Approved: reject / actual * 1e6. */
  ipr: Metric;
  stopMinutes: number;
}
export interface MachineProduction extends ProductionTotals {
  machineNo: string;
  dpNo: string | null;
  productName: string | null;
  sharePct: Metric;
  rejectPct: Metric;
  rejects: { name: string; qty: number }[];
  achievement: 'attention' | 'within' | 'unknown';
}
export interface DailyProduction { date: string; plan: number; actual: number; bekidoritsu: Metric; hasRecord?: boolean; planReported?: boolean; actualReported?: boolean }
export interface GroupProduction { group: string; plan: number; actual: number; bekidoritsu: Metric }
export interface ProductionView {
  range: { from: string; to: string; shift: string | null; days: number };
  totals: ProductionTotals;
  previous: ProductionTotals | null;
  machines: MachineProduction[];
  daily: DailyProduction[];
  groups: GroupProduction[];
}

export interface UtilizationTotals {
  /** Approved: (planned - stop) / planned * 100 */
  kikai: Metric;
  /** Approved: (planned - stop) / calendar * 100 */
  sogo: Metric;
  /** Approved: planned / calendar * 100 */
  shugyo: Metric;
  /** Approved: good / gross * 100 */
  quality: Metric;
  bekidoritsu: Metric;
  /** Taken from ConMas (owner 2026-11-17), aggregated as a planned-minutes weighted mean. Unavailable when ConMas has no value. */
  availability: Metric;
  performance: Metric;
  oee: Metric;
  plannedMinutes: number;
  stopMinutes: number;
  calendarMinutes: number;
}
export interface MachineUtilization extends UtilizationTotals {
  machineNo: string;
  productName: string | null;
  ctPlan: Metric;
  ctActual: Metric;
  losses: { category: string; categoryId: string; color: string; minutes: number }[];
  rejects: { name: string; qty: number }[];
}
export interface UtilizationView { range: ProductionView['range']; totals: UtilizationTotals; previous: UtilizationTotals | null; machines: MachineUtilization[] }

export interface StopCategoryRef { id: string; short: string; name: string; group: LossGroup; color: string; infoOnly: boolean; oeeBucket: 'A' | 'P' | '-' }
export interface StopAgg { minutes: number; events: number }
export interface StopTimeView {
  range: ProductionView['range'];
  categories: StopCategoryRef[];
  groups: { id: LossGroup; name: string; color: string }[];
  totals: StopAgg & { activeCategories: number; activeDetails: number; infoMinutes: number; knownDetails: number };
  previous: (StopAgg & { activeCategories: number; activeDetails: number }) | null;
  byCategory: (StopAgg & { categoryId: string })[];
  byGroup: (StopAgg & { group: LossGroup; categories: number })[];
  byShift: { shift: '1' | '2' | '3'; minutes: number }[];
  byMachine: (StopAgg & { machineNo: string; productName: string | null; categories: Record<string, number>; details: { categoryId: string; detail: string; minutes: number; events: number }[] })[];
  byProduct: (StopAgg & { productName: string; machines: string[]; categories: Record<string, number>; details: { categoryId: string; detail: string; minutes: number; events: number }[] })[];
  details: (StopAgg & { detail: string; categoryId: string; machines: string[] })[];
}
export const StopQuerySchema = z.object({ group: LossGroupSchema.optional(), category: z.string().max(40).optional(), includeInfo: z.enum(['true', 'false']).optional() });

export interface MachineSummary {
  machineNo: string;
  dpNo: string | null;
  productName: string | null;
  hasRecord: boolean;
  bekidoritsu: Metric;
  oee: Metric;
  stopMinutes: number | null;
  reject: number | null;
}
export interface MachineListView { date: string; machines: MachineSummary[]; prevDate: string | null; nextDate: string | null }

export interface DailyRateRow { date: string; plan: number; actual: number; bekidoritsu: Metric; calendarMinutes: number; plannedMinutes: number; stopMinutes: number; runningMinutes: number; kikai: Metric; sogo: Metric; shugyo: Metric }
export interface DailyRatesView { machineNo: string | null; productName: string | null; rows: DailyRateRow[] }

/** Sales (Q-009): Rp = OUTPUT ACTUAL x Harga/PCS (Master Data). Part tanpa harga tidak dihitung sebagai 0: qty-nya dilaporkan di uncoveredQty. */
export interface SalesPeriodRow { key: string; sales: number; goodQty: number; uncoveredQty: number; hasValuation?: boolean }
export interface SalesPartRow { dpNo: string | null; productName: string | null; goodQty: number; pricePerPcs: number | null; sales: Metric }
export interface SalesView {
  range: { from: string; to: string; days: number };
  total: Metric;
  goodQty: number;
  coveredQty: number;
  uncoveredQty: number;
  averagePrice: Metric;
  byMonth: SalesPeriodRow[];
  byDay: SalesPeriodRow[];
  byPart: SalesPartRow[];
}

/** Scrap (Q-009): NG (gram) ConMas -> kg; Rp = gram x harga material per gram (part -> material, Master Data). Rumus nilai PROPOSED.
 *  Record tanpa NG gram atau tanpa harga material tidak dihitung sebagai 0: gram-nya dilaporkan di unvaluedGram / recordsWithoutGram.
 *  Ratio = scrap value / sales hanya dari record yang punya keduanya (agar pembilang dan penyebut sebanding). */
export interface ScrapPeriodRow { key: string; hasValuation?: boolean; scrapGram: number; scrapValue: number; unvaluedGram: number; ratio: Metric; materials: { code: string | null; value: number }[] }
export interface ScrapMaterialRow { code: string | null; name: string | null; pricePerGram: number | null; scrapGram: number; scrapValue: Metric }
export interface ScrapPartRow {
  dpNo: string | null; productName: string | null; materialCode: string | null; materialName: string | null; pricePerGram: number | null; pricePerPcs: number | null;
  goodQty: number; scrapGram: number | null; scrapKg: Metric; scrapValue: Metric; sales: Metric; ratio: Metric;
}
export interface ScrapView {
  range: { from: string; to: string; days: number };
  scrapValue: Metric;
  scrapKg: Metric;
  ratio: Metric;
  scrapGram: number;
  /** Gram NG yang belum bisa dinilai karena part belum punya material / material belum punya harga. */
  unvaluedGram: number;
  recordsTotal: number;
  recordsWithoutGram: number;
  /** true bila harga material yang dipakai >= Rp 10.000 per gram (kemungkinan satuan per kg). */
  priceUnitSuspect: boolean;
  byMonth: ScrapPeriodRow[];
  byDay: ScrapPeriodRow[];
  byMaterial: ScrapMaterialRow[];
  byPart: ScrapPartRow[];
}
