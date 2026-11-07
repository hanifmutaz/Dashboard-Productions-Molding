import { z } from 'zod';
import { LossGroupSchema } from './monitoring.js';

export const PartSchema = z.object({ dpNo: z.string().min(1).max(40), name: z.string().max(120), pricePerPcs: z.number().int().nonnegative().nullable(), materialCode: z.string().max(40).nullable(), version: z.number().int() });
export type Part = z.infer<typeof PartSchema>;
export const MaterialSchema = z.object({ code: z.string().min(1).max(40), name: z.string().min(1).max(120), pricePerGram: z.number().nonnegative().nullable(), version: z.number().int() });
export type Material = z.infer<typeof MaterialSchema>;
export const StopCategorySchema = z.object({
  id: z.string(), short: z.string(), name: z.string(), group: LossGroupSchema, oeeBucket: z.enum(['A', 'P', '-']), infoOnly: z.boolean(), color: z.string(),
  aliases: z.array(z.string()), details: z.array(z.string()), notes: z.string().nullable(), version: z.number().int(),
});
export type StopCategory = z.infer<typeof StopCategorySchema>;
export interface MachineMaster { machineNo: string; dpNo: string | null; productName: string | null; cavity: string | null; lastSeen: string | null }

export const PartPriceUpdateSchema = z.object({ items: z.array(z.object({ dpNo: z.string().min(1).max(40), pricePerPcs: z.number().int().nonnegative(), version: z.number().int().nullable(), name: z.string().max(120).optional() })).min(1).max(2000) });
export const MaterialUpdateSchema = z.object({
  materials: z.array(z.object({ code: z.string().min(1).max(40), name: z.string().min(1).max(120), pricePerGram: z.number().positive(), version: z.number().int().nullable() })).max(500),
  partMaterials: z.array(z.object({ dpNo: z.string().min(1).max(40), materialCode: z.string().min(1).max(40), version: z.number().int().nullable() })).max(2000),
});
export interface MasterDataView { parts: Part[]; materials: Material[]; categories: StopCategory[]; machines: MachineMaster[] }
