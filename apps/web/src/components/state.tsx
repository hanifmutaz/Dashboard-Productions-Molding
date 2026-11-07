import type { ReactNode } from 'react';
import type { ViewDataEnvelope } from '@mpd/contracts';
import { ApiFailure } from '../lib/api';

/** Banner for envelope notices: stale = warning, unavailable/error = error. Never shown as zero (STATE §4). */
export function EnvelopeBanner({ env, error }: { env?: ViewDataEnvelope<unknown>; error?: unknown }) {
  if (error) {
    const msg = error instanceof ApiFailure ? error.message : 'Terjadi kesalahan.';
    const rid = error instanceof ApiFailure && error.requestId ? ` (Request ID ${error.requestId})` : '';
    return <div className="banner e" role="alert"><b>Gagal memuat data.</b> {msg}{rid}</div>;
  }
  if (!env || !env.notices.length) return null;
  const bad = env.state === 'unavailable' || env.state === 'error' || env.freshness === 'unavailable' || env.freshness === 'unknown';
  return (
    <div className={`banner ${bad ? 'e' : 'w'}`} role={bad ? 'alert' : 'status'}>
      {env.state === 'unavailable' && <b>Sumber data tidak tersedia. </b>}
      {env.notices.map((n) => n.message).join(' ')}
      {env.sourceUpdatedAt && <> · Update sumber terakhir: <span className="mono">{new Date(env.sourceUpdatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span></>}
    </div>
  );
}

export const emptyMsg = (env?: ViewDataEnvelope<unknown>) =>
  !env ? 'Memuat data…' : env.state === 'unavailable' ? 'Sumber data tidak tersedia · angka disembunyikan, bukan nol.' : env.state === 'empty' ? 'Tidak ada catatan produksi untuk filter ini.' : '';

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty" role="status">{children}</div>;
}
