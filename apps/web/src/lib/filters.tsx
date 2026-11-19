import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { RangeQuerySchema, type Freshness, type Notice, type ViewDataEnvelope } from '@mpd/contracts';
import { useLocation, useSearchParams } from 'react-router';
import type { PRESETS } from './period';
import { presetRange, productionToday, type Preset } from './period';
import { useSession } from './session';

export interface Filters { from: string; to: string; preset: Preset; shift: '' | '1' | '2' | '3'; status: '' | 'attention' | 'within' | 'unknown'; q: string }
export interface SourceStatus { phase: 'idle' | 'loading' | 'ready' | 'error'; state?: ViewDataEnvelope<unknown>['state']; freshness?: Freshness; sourceUpdatedAt?: string | null; notices?: Notice[] }

interface Ctx {
  f: Filters;
  setF: (p: Partial<Filters>) => void;
  applyPreset: (p: keyof typeof PRESETS) => void;
  reset: () => void;
  source: SourceStatus;
  today: string;
  setSource: (id: string, s?: SourceStatus) => void;
}
const FilterContext = createContext<Ctx | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const { me, prefs, settings } = useSession();
  const { pathname } = useLocation();
  const [search, setSearch] = useSearchParams();
  const finance = pathname === '/sales' || pathname === '/scrap';
  const [now, setNow] = useState(() => new Date());
  const today = productionToday(now, settings.shifts.s1, me?.plantUtcOffsetMinutes);
  const init = (): Filters => ({ ...presetRange(prefs.period, today), preset: prefs.period, shift: prefs.shift, status: '', q: '' });
  const [stored, set] = useState<Filters>(init);
  const [sources, setSources] = useState<Record<string, SourceStatus>>({});
  const setSource = useCallback((id: string, value?: SourceStatus) => setSources((current) => {
    if (value) return { ...current, [id]: value };
    if (!(id in current)) return current;
    const next = { ...current };
    delete next[id];
    return next;
  }), []);
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useEffect(() => set((cur) => ({ ...cur, preset: prefs.period, shift: prefs.shift })), [prefs.period, prefs.shift]);
  const shared = useMemo(() => {
    if (!finance || !search.has('from') || !search.has('to')) return null;
    const result = RangeQuerySchema.safeParse({ from: search.get('from'), to: search.get('to'), shift: search.get('shift') ?? undefined });
    return result.success && result.data.to <= today ? result.data : null;
  }, [finance, search, today]);
  const f = useMemo<Filters>(() => shared ? { ...stored, ...shared, shift: shared.shift ?? '', preset: 'custom' }
    : stored.preset === 'custom' ? stored : { ...stored, ...presetRange(stored.preset, today) }, [shared, stored, today]);
  const clearShared = useCallback(() => {
    if (!shared) return;
    const next = new URLSearchParams(search);
    for (const key of ['from', 'to', 'shift']) next.delete(key);
    setSearch(next, { replace: true });
  }, [shared, search, setSearch]);
  const value = useMemo<Ctx>(() => ({
    f,
    setF: (p) => { clearShared(); set((c) => ({ ...(shared ? f : c), ...p })); },
    applyPreset: (p) => { clearShared(); set((c) => ({ ...(shared ? f : c), preset: p })); },
    reset: () => { clearShared(); set({ ...presetRange(prefs.period, today), preset: prefs.period, shift: prefs.shift, status: '', q: '' }); },
    source: Object.values(sources).at(-1) ?? { phase: 'idle' }, setSource, today,
  }), [f, shared, clearShared, sources, setSource, today, prefs.period, prefs.shift]);
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}
export function useFilters() {
  const c = useContext(FilterContext);
  if (!c) throw new Error('FilterProvider missing');
  return c;
}

/** Pages report their envelope so the topbar source indicator reflects business freshness (not query staleness). */
export function useReportSource(env: ViewDataEnvelope<unknown> | undefined, isPending: boolean, isError: boolean) {
  const { setSource } = useFilters();
  const id = useId();
  useEffect(() => {
    if (isPending) setSource(id, { phase: 'loading' });
    else if (isError) setSource(id, { phase: 'error' });
    else if (env) setSource(id, { phase: 'ready', state: env.state, freshness: env.freshness, sourceUpdatedAt: env.sourceUpdatedAt, notices: env.notices });
    return () => { setSource(id); };
  }, [id, env, isPending, isError, setSource]);
}
