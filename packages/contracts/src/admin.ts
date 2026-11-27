import { z } from 'zod';
import { EmailSchema } from './auth.js';
import { ALL_PERMISSIONS } from './permissions.js';

const PermissionEnum = z.enum(ALL_PERMISSIONS as [string, ...string[]]);
export const RoleSchema = z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), isSystem: z.boolean(), permissions: z.array(z.string()), userCount: z.number().int(), version: z.number().int() });
export type Role = z.infer<typeof RoleSchema>;
export const RoleUpsertSchema = z.object({ name: z.string().trim().min(2).max(60), description: z.string().max(200).nullable(), permissions: z.array(PermissionEnum).max(64), version: z.number().int().nullable() });
export const UserSchema = z.object({ id: z.string(), username: z.string(), email: z.string().nullable(), displayName: z.string(), department: z.string().nullable(), roleId: z.string(), roleName: z.string(), active: z.boolean(), lastLoginAt: z.string().nullable(), version: z.number().int() });
export type User = z.infer<typeof UserSchema>;
export const UserCreateSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  email: EmailSchema,
  displayName: z.string().trim().min(1).max(120),
  department: z.string().trim().max(120).nullable(),
  roleId: z.string().uuid(),
  password: z.string().min(12).max(256),
});
export const UserUpdateSchema = z.object({ email: EmailSchema.nullable(), displayName: z.string().trim().min(1).max(120), department: z.string().trim().max(120).nullable(), roleId: z.string().uuid(), active: z.boolean(), version: z.number().int() });
export const REGISTRATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export const RegistrationSchema = z.object({
  id: z.string(), email: z.string(), displayName: z.string(), department: z.string().nullable(), purpose: z.string().nullable(),
  status: z.enum(REGISTRATION_STATUSES), createdAt: z.string(), reviewedAt: z.string().nullable(), reviewedBy: z.string().nullable(), reviewNote: z.string().nullable(), version: z.number().int(),
});
export type Registration = z.infer<typeof RegistrationSchema>;
export const RegistrationQuerySchema = z.object({ status: z.enum(['pending', 'rejected']).default('pending') });
export const RegistrationApproveSchema = z.object({ roleId: z.string().uuid(), version: z.number().int() });
export const RegistrationRejectSchema = z.object({ note: z.string().trim().max(200).nullable(), version: z.number().int() });
export const PasswordResetSchema = z.object({ password: z.string().min(12).max(256) });
export interface AuditEntry { id: string; at: string; actor: string | null; requestId: string | null; action: string; objectType: string | null; objectId: string | null; result: 'success' | 'failure' | 'denied'; detail: unknown }
export const AuditQuerySchema = z.object({ action: z.string().max(60).optional(), actor: z.string().max(64).optional(), before: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), mine: z.enum(['true']).optional() });
