import type { Metric } from './envelope.js';

export const MACHINE_PERSONNEL_ROLES = ['leader', 'cell', 'technician', 'operator'] as const;
export type MachinePersonnelRole = (typeof MACHINE_PERSONNEL_ROLES)[number];

export interface MachinePersonnel {
  role: MachinePersonnelRole;
  nik: string | null;
  name?: string | null;
  photoUrl?: string;
}

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
  /** Personnel from the latest available shift for this machine and production date. */
  personnel: MachinePersonnel[];
  personnelShift?: MachineShift['shift'] | null;
  shifts: MachineShift[];
  totals: { plan: number; actual: number; gross: number | null; reject: number | null; deviation: number; ipr: Metric; stopMinutes: number; bekidoritsu: Metric; oee: Metric };
  stops: MachineStopEvent[];
  stopCategories: { categoryId: string; name: string; color: string; minutes: number }[];
  /** Hourly output = sum of the five QTY PCS slots per hour block (APPROVED by owner 2026-11-17). `plan` stays null: no hourly plan in the source.
   * Hours are ordered from the start of shift 1. */
  hourly: { available: false; reason: string } | { available: true; hours: { hour: number; plan: number | null; actual: number }[] };
  rejectPareto: { name: string; qty: number }[];
}
