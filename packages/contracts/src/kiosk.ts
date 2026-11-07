import { z } from 'zod';
export const PairingCreateSchema = z.object({ name: z.string().trim().min(2).max(60), machineNo: z.string().trim().min(1).max(20) });
export const PairingRedeemSchema = z.object({ code: z.string().trim().regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i) });
export interface KioskDevice { id: string; name: string; machineNo: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null }
export interface PairingCode { code: string; expiresAt: string; name: string; machineNo: string }
