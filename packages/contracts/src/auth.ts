import { z } from 'zod';
import type { Permission } from './permissions.js';

export const LoginRequestSchema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) });
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  department: string | null;
  roleId: string;
  roleName: string;
  permissions: Permission[];
  lastLoginAt: string | null;
}
export interface MeResponse {
  kind: 'user';
  user: SessionUser;
  csrfToken: string;
}
export interface KioskMeResponse {
  kind: 'kiosk';
  kiosk: { id: string; name: string; machineNo: string };
}
export type WhoAmI = MeResponse | KioskMeResponse;

export const ChangePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(256) });
