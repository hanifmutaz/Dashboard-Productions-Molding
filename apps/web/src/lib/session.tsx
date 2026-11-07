import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PREFERENCES, DEFAULT_SETTINGS, type Permission, type Preferences, type Settings, type WhoAmI } from '@mpd/contracts';
import { ApiFailure, api, setCsrf } from './api';

interface Ctx {
  me: WhoAmI | null;
  loading: boolean;
  settings: Settings;
  prefs: Preferences;
  can: (p: Permission) => boolean;
  savePrefs: (p: Preferences) => Promise<void>;
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
  const value: Ctx = {
    me,
    loading: meQ.isPending || (!!me && settingsQ.isPending),
    settings: settingsQ.data ?? FALLBACK_SETTINGS,
    prefs: prefsQ.data ?? DEFAULT_PREFERENCES,
    can: (p) => me?.kind === 'user' && me.user.permissions.includes(p),
    savePrefs: async (p) => {
      qc.setQueryData(['prefs'], p);
      await api.put('/api/me/preferences', p);
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
