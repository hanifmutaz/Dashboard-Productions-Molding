import { useQuery } from '@tanstack/react-query';
import { ApiFailure } from '../lib/api';
import { SystemMonitorPanel } from './SystemMonitorPanel';

interface Readiness {
  latencyMs?: number;
  appDb: 'up' | 'down';
  schema: 'ready' | 'not-ready';
  conmas: 'up' | 'unavailable';
}

async function loadReadiness(signal: AbortSignal): Promise<Readiness> {
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch('/api/health/ready', {
      headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiFailure(0, 'NETWORK', 'Tidak dapat terhubung ke server. Periksa jaringan.');
  }
  // Readiness can return 503 with a valid component status.
  const body = response.ok || response.status === 503 ? await response.json().catch(() => null) as Partial<Readiness> | null : null;
  if ((body?.appDb === 'up' || body?.appDb === 'down') && (body.schema === 'ready' || body.schema === 'not-ready')
    && (body.conmas === 'up' || body.conmas === 'unavailable')) {
    return { appDb: body.appDb, schema: body.schema, conmas: body.conmas, latencyMs: Math.round(performance.now() - started) };
  }
  throw new ApiFailure(response.status, 'BAD_RESPONSE', 'Status server belum bisa diperiksa.');
}

export function SystemStatusPage() {
  const check = useQuery({
    queryKey: ['system-readiness'],
    queryFn: ({ signal }) => loadReadiness(signal),
    retry: false,
    refetchInterval: 60_000,
  });
  const info = check.isSuccess ? check.data : null;
  const rows = info ? [
    { label: 'Database aplikasi', ok: info.appDb === 'up', fail: 'Tidak terhubung' },
    { label: 'Skema aplikasi', ok: info.schema === 'ready', fail: 'Belum siap' },
    { label: 'Sumber ConMas', ok: info.conmas === 'up', fail: 'Tidak tersedia' },
  ] : [];

  return (
    <section className="view on"><div className="content">
      <section className="card system-status">
        <div className="ch">
          <div><h3>Status sistem</h3>{info && <p>Terakhir diperiksa · {new Date(check.dataUpdatedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</p>}</div>
          <button className="btn" type="button" disabled={check.isFetching} onClick={() => void check.refetch()}>
            {check.isFetching ? 'Memeriksa…' : check.isError ? 'Coba lagi' : 'Periksa ulang'}
          </button>
        </div>
        <div className="cb">
          {check.isPending && <p role="status">Memeriksa status server…</p>}
          {check.isError && <div className="banner e" role="alert">{check.error instanceof ApiFailure ? check.error.message : 'Status server belum bisa diperiksa.'}</div>}
          {info && <p>Readiness request: {info.latencyMs} ms</p>}
          {info && (
            <dl className="system-status-list" aria-label="Hasil pemeriksaan">
              {rows.map(({ label, ok, fail }) => (
                <div key={label}><dt>{label}</dt><dd><span className={ok ? 'chip good' : 'chip bad'}>{ok ? 'Siap' : fail}</span></dd></div>
              ))}
            </dl>
          )}
        </div>
      </section>
      <SystemMonitorPanel />
    </div></section>
  );
}
