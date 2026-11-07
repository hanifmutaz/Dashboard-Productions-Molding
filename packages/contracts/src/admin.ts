import { z } from 'zod';
import { ALL_PERMISSIONS } from './permissions.js';

const PermissionEnum = z.enum(ALL_PERMISSIONS as [string, ...string[]]);
export const RoleSchema = z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), isSystem: z.boolean(), permissions: z.array(z.string()), userCount: z.number().int(), version: z.number().int() });
export type Role = z.infer<typeof RoleSchema>;
export const RoleUpsertSchema = z.object({ name: z.string().trim().min(2).max(60), description: z.string().max(200).nullable(), permissions: z.array(PermissionEnum).max(64), version: z.number().int().nullable() });
export const UserSchema = z.object({ id: z.string(), username: z.string(), displayName: z.string(), department: z.string().nullable(), roleId: z.string(), roleName: z.string(), active: z.boolean(), lastLoginAt: z.string().nullable(), version: z.number().int() });
export type User = z.infer<typeof UserSchema>;
export const UserCreateSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(120),
  department: z.string().trim().max(120).nullable(),
  roleId: z.string().uuid(),
  password: z.string().min(12).max(256),
});
export const UserUpdateSchema = z.object({ displayName: z.string().trim().min(1).max(120), department: z.string().trim().max(120).nullable(), roleId: z.string().uuid(), active: z.boolean(), version: z.number().int() });
export const PasswordResetSchema = z.object({ password: z.string().min(12).max(256) });
export interface AuditEntry { id: string; at: string; actor: string | null; requestId: string | null; action: string; objectType: string | null; objectId: string | null; result: 'success' | 'failure' | 'denied'; detail: unknown }
export const AuditQuerySchema = z.object({ action: z.string().max(60).optional(), actor: z.string().max(64).optional(), before: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), mine: z.enum(['true']).optional() });
