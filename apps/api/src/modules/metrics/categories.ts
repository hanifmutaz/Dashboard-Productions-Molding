import type { LossGroup, StopCategory, StopCategoryRef } from '@mpd/contracts';

export const GROUPS: { id: LossGroup; name: string; color: string }[] = [
  { id: 'setup', name: 'Setup & changeover', color: 's-paint-db2777' },
  { id: 'breakdown', name: 'Breakdown & abnormality', color: 's-paint-4f46e5' },
  { id: 'quality', name: 'Quality', color: 's-paint-c026d3' },
  { id: 'minor', name: 'Minor stop', color: 's-paint-92400e' },
  { id: 'planned', name: 'Planned & info', color: 's-paint-64748b' },
  { id: 'unmapped', name: 'Unmapped', color: 's-paint-94a3b8' },
];
export const UNMAPPED: StopCategoryRef = { id: 'unmapped', short: 'Unmapped', name: 'Kategori ConMas belum dipetakan di Master Data', group: 'unmapped', color: 's-paint-94a3b8', infoOnly: false, oeeBucket: '-' };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Maps a ConMas category text to a Master Data category via name + aliases (punctuation/space-insensitive). */
export function categoryResolver(cats: StopCategory[]) {
  const map = new Map<string, StopCategoryRef>();
  const refs = cats.map((c) => ({ id: c.id, short: c.short, name: c.name, group: c.group, color: c.color, infoOnly: c.infoOnly, oeeBucket: c.oeeBucket }) satisfies StopCategoryRef);
  cats.forEach((c, i) => [c.name, c.short, ...c.aliases].forEach((a) => map.set(norm(a), refs[i]!)));
  return { refs, resolve: (text: string): StopCategoryRef => map.get(norm(text)) ?? UNMAPPED };
}
