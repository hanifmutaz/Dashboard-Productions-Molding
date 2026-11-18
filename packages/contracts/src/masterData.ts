import { z } from 'zod';
import { LossGroupSchema } from './monitoring.js';

/** Harga/PCS dalam Rupiah: >= 0, maksimal 4 desimal (kolom numeric(14,4)). */
const PriceSchema = z.number().nonnegative().max(9_999_999_999).refine((v) => Math.abs(Math.round(v * 1e4) - v * 1e4) < 1e-6, 'maksimal 4 desimal');

export const PartSchema = z.object({ dpNo: z.string().min(1).max(40), name: z.string().max(120), pricePerPcs: PriceSchema.nullable(), materialCode: z.string().max(40).nullable(), version: z.number().int() });
export type Part = z.infer<typeof PartSchema>;
export const MaterialSchema = z.object({ code: z.string().min(1).max(40), name: z.string().min(1).max(120), pricePerGram: z.number().nonnegative().nullable(), version: z.number().int() });
export type Material = z.infer<typeof MaterialSchema>;
export const StopCategorySchema = z.object({
  id: z.string(), short: z.string(), name: z.string(), group: LossGroupSchema, oeeBucket: z.enum(['A', 'P', '-']), infoOnly: z.boolean(), color: z.string(),
  aliases: z.array(z.string()), details: z.array(z.string()), notes: z.string().nullable(), version: z.number().int(),
});
export type StopCategory = z.infer<typeof StopCategorySchema>;
/** Palet warna kategori stop (token CSS yang tersedia di packages/ui-tokens). */
export const STOP_CATEGORY_COLORS = [
  's-paint-64748b', 's-paint-475569', 's-paint-94a3b8', 's-paint-cbd5e1', 's-paint-e2e8f0',
  's-paint-6366f1', 's-paint-4f46e5', 's-paint-3730a3', 's-paint-a5b4fc',
  's-paint-ec4899', 's-paint-db2777', 's-paint-9d174d', 's-paint-f9a8d4', 's-paint-fbcfe8',
  's-paint-c026d3', 's-paint-92400e',
] as const;
export const EDITABLE_LOSS_GROUPS = ['setup', 'breakdown', 'quality', 'minor', 'planned'] as const;
const TextList = (max: number, len: number) => z.array(z.string().trim().min(1).max(len)).max(max);
/** Create (id=null, version=null) or update (id + version) one stop category. Server generates the id for new ones. */
export const StopCategoryInputSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,30}$/).nullable(),
  short: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(160),
  group: z.enum(EDITABLE_LOSS_GROUPS),
  oeeBucket: z.enum(['A', 'P', '-']),
  infoOnly: z.boolean(),
  color: z.enum(STOP_CATEGORY_COLORS),
  aliases: TextList(40, 200),
  details: TextList(200, 120),
  notes: z.string().trim().max(200).nullable(),
  version: z.number().int().nullable(),
}).refine((c) => (c.id === null) === (c.version === null), { message: 'id dan version harus sama-sama kosong (baru) atau sama-sama terisi (ubah)' });
export type StopCategoryInput = z.infer<typeof StopCategoryInputSchema>;
export interface MachineMaster { machineNo: string; dpNo: string | null; productName: string | null; cavity: string | null; lastSeen: string | null }

export const PartPriceUpdateSchema = z.object({ items: z.array(z.object({ dpNo: z.string().min(1).max(40), pricePerPcs: PriceSchema, version: z.number().int().nullable(), name: z.string().max(120).optional() })).min(1).max(2000) });
export const MaterialUpdateSchema = z.object({
  materials: z.array(z.object({ code: z.string().min(1).max(40), name: z.string().min(1).max(120), pricePerGram: z.number().positive(), version: z.number().int().nullable() })).max(500),
  partMaterials: z.array(z.object({ dpNo: z.string().min(1).max(40), materialCode: z.string().min(1).max(40), version: z.number().int().nullable() })).max(2000),
});
export interface MasterDataView { parts: Part[]; materials: Material[]; categories: StopCategory[]; machines: MachineMaster[] }
