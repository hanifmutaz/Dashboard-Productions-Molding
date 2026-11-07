import type { Metric } from './envelope.js';

export interface MachineShift {
  shift: '1' | '2' | '3';
  time: string;
  hasRecord: boolean;
  group: string | null;
  plan: number | null;
  actual: number | null;
  gross: number | null;
  reject: number | null;
  ipr: Metric;
  deviation: number | null;
  stopMinutes: number | null;
  bekidoritsu: Metric;
}
export interface MachineStopEvent { shift: '1' | '2' | '3'; startMinuteOfDay: number; time: string; minutes: number; categoryId: string; category: string; color: string; detail: string }
export interface MachineDetailView {
  machineNo: string;
  date: string;
  prevDate: string | null;
  nextDate: string | null;
  hasRecord: boolean;
  header: { dpNo: string | null; productName: string | null; poNo: string | null; cavity: string | null; ctPlan: Metric; ctActual: Metric };
  /** Personnel NIK only; name lookup is Q-021. Hidden unless Settings md.pic is on. */
  personnel: { role: 'leader' | 'cell' | 'technician' | 'operator'; nik: string | null }[];
  shifts: MachineShift[];
  totals: { plan: number; actual: number; gross: number | null; reject: number | null; deviation: number; ipr: Metric; stopMinutes: number; bekidoritsu: Metric; oee: Metric };
  stops: MachineStopEvent[];
  stopCategories: { categoryId: string; name: string; color: string; minutes: number }[];
  /** Hourly output aggregation of the five QTY PCS slots is PROPOSED (not approved) -> unavailable. */
  hourly: { available: false; reason: string } | { available: true; hours: { hour: number; plan: number | null; actual: number }[] };
  rejectPareto: { name: string; qty: number }[];
}
