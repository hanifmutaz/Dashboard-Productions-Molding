import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Freshness, Notice, ViewDataEnvelope } from '@mpd/contracts';
import type { PRESETS } from './period';
import { presetRange, type Preset } from './period';
import { useSession } from './session';

export interface Filters { from: string; to: string; preset: Preset; shift: '' | '1' | '2' | '3'; status: '' | 'attention' | 'within' | 'unknown'; q: string }
export interface SourceStatus { phase: 'idle' | 'loading' | 'ready' | 'error'; state?: ViewDataEnvelope<unknown>['state']; freshness?: Freshness; sourceUpdatedAt?: string | null; notices?: Notice[] }

interface Ctx {
  f: Filters;
  setF: (p: Partial<Filters>) => void;
  applyPreset: (p: keyof typeof PRESETS) => void;
  reset: () => void;
  source: SourceStatus;
  setSource: (s: SourceStatus) => void;
}
const FilterContext = createContext<Ctx | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const { prefs } = useSession();
  const init = (): Filters => ({ ...presetRange(prefs.period), preset: prefs.period, shift: prefs.shift, status: '', q: '' });
  const [f, set] = useState<Filters>(init);
  const [source, setSource] = useState<SourceStatus>({ phase: 'idle' });
  // Re-apply user defaults once preferences arrive from the server.
  useEffect(() => set((cur) => ({ ...cur, ...presetRange(prefs.period), preset: prefs.period, shift: prefs.shift })), [prefs.period, prefs.shift]);
  const value = useMemo<Ctx>(() => ({
    f,
    setF: (p) => set((c) => ({ ...c, ...p })),
    applyPreset: (p) => set((c) => ({ ...c, ...presetRange(p), preset: p })),
    reset: () => set({ ...presetRange(prefs.period), preset: prefs.period, shift: prefs.shift, status: '', q: '' }),
    source, setSource,
  }), [f, source, prefs.period, prefs.shift]);
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
  useEffect(() => {
    if (isPending) setSource({ phase: 'loading' });
    else if (isError) setSource({ phase: 'error' });
    else if (env) setSource({ phase: 'ready', state: env.state, freshness: env.freshness, sourceUpdatedAt: env.sourceUpdatedAt, notices: env.notices });
  }, [env, isPending, isError, setSource]);
  useEffect(() => () => setSource({ phase: 'idle' }), [setSource]);
}
