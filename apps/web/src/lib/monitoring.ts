import { useQuery } from '@tanstack/react-query';
import type { ViewDataEnvelope } from '@mpd/contracts';
import { api, qs } from './api';
import { useFilters, useReportSource } from './filters';
import { useSession } from './session';

export function useMonitoring<T>(path: string, extra: Record<string, string | undefined> = {}) {
  const { f } = useFilters();
  const { settings } = useSession();
  const params = qs({
    from: f.from, to: f.to, shift: f.shift,
    q: path === 'sales' || path === 'scrap' ? undefined : f.q,
    ...extra,
  });
  const query = useQuery({
    queryKey: ['monitoring', path, params],
    queryFn: ({ signal }) => api.get<ViewDataEnvelope<T>>(`/api/v1/monitoring/${path}?${params}`, signal),
    refetchInterval: settings.data.refresh * 60_000,
  });
  useReportSource(query.data, query.isPending, query.isError);
  return query;
}
