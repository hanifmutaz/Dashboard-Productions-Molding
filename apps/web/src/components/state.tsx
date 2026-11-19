import type { ReactNode } from 'react';
import type { ViewDataEnvelope } from '@mpd/contracts';
import { ApiFailure } from '../lib/api';

interface EnvelopeBannerProps {
  env?: ViewDataEnvelope<unknown>;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Describe freshness independently of the values rendered by each report. */
export function EnvelopeBanner({ env, error, onRetry, retrying = false }: EnvelopeBannerProps) {
  const failure = Boolean(error) || env?.state === 'error';
  const unavailable = env?.state === 'unavailable' || env?.freshness === 'unavailable';
  const uncertain = env?.freshness === 'unknown';
  const stale = env?.state === 'stale' || env?.freshness === 'stale';
  const bad = failure || unavailable || uncertain;
  if (!bad && !stale && !env?.notices.length) return null;

  const title = failure ? 'Gagal memuat data' : unavailable ? 'Sumber data tidak tersedia'
    : uncertain ? 'Status data belum diketahui' : stale ? 'Data terlambat' : 'Informasi data';
  const description = error ? (error instanceof ApiFailure ? error.message : 'Terjadi kesalahan.')
    : env?.notices.map((n) => n.message).join(' ') || (stale ? 'Dashboard menampilkan rekaman terakhir.' : '');
  const rid = error instanceof ApiFailure ? error.requestId : undefined;

  return (
    <div className={bad ? 'banner e source-banner' : 'banner w source-banner'} role={bad ? 'alert' : 'status'}>
      <div>
        <strong>{title}</strong>
        {description && <div>{description}</div>}
        {!error && env?.sourceUpdatedAt && <div>Update sumber terakhir · <time dateTime={env.sourceUpdatedAt} className="mono">{new Date(env.sourceUpdatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>}
        {rid && <div>Request ID · <span className="mono">{rid}</span></div>}
      </div>
      {(failure || unavailable) && onRetry && (
        <button className="btn" type="button" disabled={retrying} onClick={onRetry}>{retrying ? 'Memuat…' : 'Coba lagi'}</button>
      )}
    </div>
  );
}

export const emptyMsg = (env?: ViewDataEnvelope<unknown>) =>
  !env ? 'Memuat data…' : env.state === 'unavailable' ? 'Sumber data tidak tersedia · angka disembunyikan, bukan nol.' : env.state === 'empty' ? 'Tidak ada catatan produksi untuk filter ini.' : '';

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty" role="status">{children}</div>;
}
