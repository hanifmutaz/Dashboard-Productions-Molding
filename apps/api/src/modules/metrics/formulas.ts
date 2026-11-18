import { metric, type Metric } from '@mpd/contracts';

/* ADR-003: business formulas live only in the backend. Approved by owner 2026-11-07 (6 formulas, from the approved baseline (ADR-026)).
 * Owner 2026-11-17: OEE / Availability / Performance are NOT computed here; they are read from ConMas (see aggregateRate)
 * and hourly output = sum of the five QTY PCS slots per hour block.
 * Sales: APPROVED owner 2026-11-18 (Q-009 selesai untuk Sales). Scrap: sumber gram dari ConMas dikonfirmasi owner 2026-11-18, rumus
 * scrap value & ratio masih menunggu approver Quality/Finance (PROPOSED) dan belum dipakai oleh route mana pun. */

export const NOT_APPROVED = 'Rumus belum disetujui (Q-003)';

/** Bekidoritsu = actual / plan * 100 (APPROVED). */
export const bekidoritsu = (actual: number, plan: number): Metric => (plan > 0 ? metric((actual / plan) * 100) : metric(null, 'Plan = 0'));
/** IPR (PPM) = reject / actual * 1,000,000 (APPROVED). */
export const ipr = (reject: number | null, actual: number): Metric =>
  reject === null ? metric(null, 'Qty reject tidak tersedia') : actual > 0 ? metric((reject / actual) * 1e6) : metric(null, 'Actual = 0');
/** Quality = good / gross * 100 (APPROVED). */
export const quality = (good: number, gross: number | null): Metric =>
  gross === null ? metric(null, 'Output gross tidak tersedia') : gross > 0 ? metric((good / gross) * 100) : metric(null, 'Gross = 0');
/** Kikai = (planned - stop) / planned * 100 (APPROVED). */
export const kikai = (planned: number, stop: number): Metric => (planned > 0 ? metric(((planned - stop) / planned) * 100) : metric(null, 'Waktu terencana = 0'));
/** Sogo = (planned - stop) / calendar * 100 (APPROVED). */
export const sogo = (planned: number, stop: number, calendar: number): Metric => (calendar > 0 && planned > 0 ? metric(((planned - stop) / calendar) * 100) : metric(null, 'Waktu kalender/terencana = 0'));
/** Shugyo = planned / calendar * 100 (APPROVED). */
export const shugyo = (planned: number, calendar: number): Metric => (calendar > 0 && planned > 0 ? metric((planned / calendar) * 100) : metric(null, 'Waktu kalender/terencana = 0'));

export const notApproved = (): Metric => metric(null, NOT_APPROVED);

/* ---- Sales & Scrap (Q-009). Tanpa pembulatan di sini: pembulatan Rupiah hanya di lapisan tampilan (Q-003). ----
 * Null tidak pernah dianggap 0: nilai yang belum ada mengembalikan metric(null, alasan). */

/** Sales (Rp) = good qty × Harga/PCS (APPROVED 2026-11-18). Good qty = OUTPUT ACTUAL ConMas (sudah good, NG tidak dikurangkan lagi).
 * Harga/PCS dari Master Data (md_part.price_per_pcs). */
export const salesValue = (goodQty: number | null, pricePerPcs: number | null): Metric => {
  if (goodQty === null) return metric(null, 'Output actual tidak tersedia');
  if (goodQty < 0) return metric(null, 'Output actual tidak valid');
  if (pricePerPcs === null) return metric(null, 'Harga/PCS belum diisi di Master Data');
  return metric(goodQty * pricePerPcs);
};
/** Scrap (kg) = NG (gram) ConMas / 1000 (sumber & satuan gram dikonfirmasi owner 2026-11-18; rumus nilai PROPOSED). */
export const scrapKg = (ngGram: number | null): Metric =>
  ngGram === null ? metric(null, 'NG (gram) belum tersedia dari ConMas') : ngGram < 0 ? metric(null, 'NG (gram) tidak valid') : metric(ngGram / 1000);
/** Scrap value (Rp) = NG (gram) × harga material per gram (Master Data: part -> material -> price_per_gram). PROPOSED. */
export const scrapValue = (ngGram: number | null, pricePerGram: number | null): Metric => {
  if (ngGram === null) return metric(null, 'NG (gram) belum tersedia dari ConMas');
  if (ngGram < 0) return metric(null, 'NG (gram) tidak valid');
  if (pricePerGram === null) return metric(null, 'Harga material per gram belum diisi di Master Data');
  return metric(ngGram * pricePerGram);
};
/** Scrap ratio (%) = scrap value / sales value × 100 (definisi Molding; nilai scrap PROPOSED). */
export const scrapRatio = (scrapValueRp: number | null, salesValueRp: number | null): Metric => {
  if (scrapValueRp === null || salesValueRp === null) return metric(null, 'Scrap value atau Sales value tidak tersedia');
  return salesValueRp > 0 ? metric((scrapValueRp / salesValueRp) * 100) : metric(null, 'Sales = 0');
};

/** Aggregates a ConMas-published rate (percent) over records. Weighted by planned minutes; plain mean when no weights exist.
 * Aggregation weighting is PROPOSED (DEV-018): the per-record values themselves come straight from ConMas. */
export function aggregateRate(items: { value: number | null; weight: number | null }[], label: string): Metric {
  const have = items.filter((i): i is { value: number; weight: number | null } => i.value !== null && Number.isFinite(i.value));
  if (!have.length) return metric(null, `${label} dari ConMas belum tersedia`);
  const w = have.reduce((a, i) => a + (i.weight && i.weight > 0 ? i.weight : 0), 0);
  if (w > 0) return metric(have.reduce((a, i) => a + i.value * (i.weight && i.weight > 0 ? i.weight : 0), 0) / w);
  return metric(have.reduce((a, i) => a + i.value, 0) / have.length);
}

/** Pure aggregation helpers (not business formulas). */
export const sumNullable = (vals: (number | null)[]): number | null => (vals.some((v) => v === null) ? null : vals.reduce<number>((a, b) => a + (b ?? 0), 0));
