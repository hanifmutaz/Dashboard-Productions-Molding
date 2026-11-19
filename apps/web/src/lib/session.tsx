import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PREFERENCES, DEFAULT_SETTINGS, type Permission, type Preferences, type Settings, type WhoAmI } from '@mpd/contracts';
import { ApiFailure, api, setCsrf } from './api';

interface Ctx {
  me: WhoAmI | null;
  loading: boolean;
  sessionError: boolean;
  settings: Settings;
  prefs: Preferences;
  can: (p: Permission) => boolean;
  savePrefs: (p: Partial<Preferences>) => Promise<void>;
  refreshMe: () => Promise<unknown>;
}
const SessionContext = createContext<Ctx | null>(null);
const FALLBACK_SETTINGS: Settings = { ...DEFAULT_SETTINGS, version: -1, updatedAt: '', updatedBy: null };

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<WhoAmI>('/api/auth/me').catch((e: unknown) => {
      if (e instanceof ApiFailure && e.status === 401) return null;
      throw e;
    }),
    staleTime: 60_000,
  });
  const me = meQ.data ?? null;
  useEffect(() => setCsrf(me?.kind === 'user' ? me.csrfToken : null), [me]);
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings'), enabled: !!me, staleTime: 5 * 60_000 });
  const prefsQ = useQuery({ queryKey: ['prefs'], queryFn: () => api.get<Preferences>('/api/me/preferences'), enabled: me?.kind === 'user', staleTime: Infinity });
  const settings = settingsQ.data ?? FALLBACK_SETTINGS;
  const prefWrites = useRef<Promise<unknown>>(Promise.resolve());
  const value: Ctx = {
    me,
    loading: meQ.isPending || (!!me && settingsQ.isPending),
    sessionError: meQ.isError && !me,
    settings,
    prefs: prefsQ.data ?? DEFAULT_PREFERENCES,
    can: (p) => me?.kind === 'user' && me.user.permissions.includes(p),
    savePrefs: (changes) => {
      const userId = me?.kind === 'user' ? me.user.id : null;
      const write = prefWrites.current.then(async () => {
        const current = qc.getQueryData<WhoAmI>(['me']);
        if (!userId || current?.kind !== 'user' || current.user.id !== userId) return;
        const saved = await api.put<Preferences>('/api/me/preferences', { ...(qc.getQueryData<Preferences>(['prefs']) ?? DEFAULT_PREFERENCES), ...changes });
        const after = qc.getQueryData<WhoAmI>(['me']);
        if (after?.kind === 'user' && after.user.id === userId) qc.setQueryData(['prefs'], saved);
      });
      prefWrites.current = write.catch(() => undefined);
      return write;
    },
    refreshMe: () => qc.invalidateQueries({ queryKey: ['me'] }),
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const c = useContext(SessionContext);
  if (!c) throw new Error('SessionProvider missing');
  return c;
}
export const useSettings = () => useSession().settings;
