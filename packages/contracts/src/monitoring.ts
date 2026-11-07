import { z } from 'zod';
import type { Metric } from './envelope.js';

/** Loss groups and OEE buckets come from Master Data (stop categories). */
export const LossGroupSchema = z.enum(['setup', 'breakdown', 'quality', 'minor', 'planned', 'unmapped']);
export type LossGroup = z.infer<typeof LossGroupSchema>;

export interface ProductionTotals {
  plan: number;
  actual: number;
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
export interface DailyProduction { date: string; plan: number; actual: number; bekidoritsu: Metric }
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
  /** Not approved (Q-003): always unavailable until approved. */
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
