import { z } from 'zod';
import type { Permission } from './permissions.js';

/** Email dinormalisasi (trim + huruf kecil) sebelum divalidasi, sama dengan CHECK di database. */
export const EmailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Format email tidak valid.'));

export const LoginRequestSchema = z.object({ email: EmailSchema, password: z.string().min(1).max(256) });
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Daftar akun mandiri (publik). Sengaja TIDAK ada role/status: ditentukan admin saat approval.
 * Field di luar skema dibuang zod, jadi `roleId` dari klien tidak berefek.
 */
export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  displayName: z.string().trim().min(2, 'Nama minimal 2 karakter.').max(120),
  department: z.string().trim().min(2, 'Departemen/bagian wajib diisi.').max(120),
  purpose: z.string().trim().min(10, 'Kebutuhan akses minimal 10 karakter.').max(500),
  password: z.string().min(12, 'Password minimal 12 karakter.').max(256),
  /** Honeypot: input tersembunyi. Manusia tidak mengisinya; bot biasanya mengisi semua field. */
  website: z.string().max(200).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export const REGISTER_ACCEPTED_MESSAGE = 'Pendaftaran diterima. Akun Anda aktif setelah disetujui admin.';

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  department: string | null;
  roleId: string;
  roleName: string;
  permissions: Permission[];
  lastLoginAt: string | null;
}
export interface MeResponse {
  kind: 'user';
  plantUtcOffsetMinutes?: number;
  user: SessionUser;
  csrfToken: string;
}
export interface KioskMeResponse {
  kind: 'kiosk';
  plantUtcOffsetMinutes?: number;
  kiosk: { id: string; name: string; machineNo: string };
}
export type WhoAmI = MeResponse | KioskMeResponse;

export const ChangePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(256) });
