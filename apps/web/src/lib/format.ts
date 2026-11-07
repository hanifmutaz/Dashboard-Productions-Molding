/* Display formatting only (ADR-003: no business formulas in the UI). */
export const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export const fmt = (n: number | null | undefined) => (isNum(n) ? Math.round(n).toLocaleString('en-US') : '—');
export const f1 = (n: number | null | undefined) => (isNum(n) ? (Math.round(n * 10) / 10).toFixed(1) : '—');
export const kf = (n: number) => (Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(2) + ' bn' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + ' mn' : fmt(n));
export const rp = (n: number | null | undefined) => (isNum(n) ? 'Rp ' + fmt(n) : '—');
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const pd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)); };
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const add = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);
export const lbl = (s: string) => { const d = pd(s); return `${MN[d.getUTCMonth()]} ${d.getUTCDate()}`; };
export const lblY = (s: string) => `${lbl(s)}, ${s.slice(0, 4)}`;
export const hh = (h: number) => String(((h % 24) + 24) % 24).padStart(2, '0');
export const tokenColor = (t: string) => (t.startsWith('var(') ? t : `var(--${t})`);
export const timeAgo = (isoTs: string | null) => {
  if (!isoTs) return '—';
  const m = Math.round((Date.now() - Date.parse(isoTs)) / 60_000);
  return m < 1 ? 'baru saja' : m < 60 ? `${m} min lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : new Date(isoTs).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
};
