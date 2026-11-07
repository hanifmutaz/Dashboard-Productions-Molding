import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiFailure, api } from '../lib/api';
import { APP_VERSION } from '../shell/AppShell';

/* Approved additions (Login / Forbidden / Error) built only from mockup tokens & components. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="authwrap">
      <div className="card authcard">
        <div className="brand authbrand"><img className="hlogo" src="/hrs-logo.png" alt="HRS · Hirose Electric" /><span className="bsep" /><div className="bt"><b>Molding</b><small>PM Dashboard</small></div></div>
        {children}
      </div>
      <div className="sbver">Molding Dashboard · v{APP_VERSION}</div>
    </div>
  );
}

export function LoginPage() {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post('/api/auth/login', { username: u, password: p }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['me'] }); void nav(sp.get('next') ?? '/', { replace: true }); },
  });
  const err = m.error instanceof ApiFailure ? m.error.message : m.error ? 'Gagal masuk.' : null;
  return (
    <Frame>
      <form className="cb" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} aria-label="Sign in">
        <h3 className="authh">Sign in</h3>
        {sp.get('reason') === 'password' && <div className="banner w">Password diganti. Silakan masuk kembali.</div>}
        {sp.get('reason') === 'expired' && <div className="banner w">Sesi berakhir. Silakan masuk kembali.</div>}
        <div className="fld"><label htmlFor="lu">Username</label><input id="lu" autoComplete="username" autoCapitalize="none" spellCheck={false} value={u} onChange={(e) => setU(e.target.value)} required /></div>
        <div className="fld"><label htmlFor="lp">Password</label><input id="lp" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></div>
        {err && <div className="banner e" role="alert">{err}</div>}
        <button className="btn pri" type="submit" disabled={m.isPending || !u || !p}>{m.isPending ? 'Signing in…' : 'Sign in'}</button>
        <p className="fa authnote">Akun dibuat oleh administrator. Lupa password? Hubungi admin.</p>
      </form>
    </Frame>
  );
}

export function ForbiddenPage() {
  return (
    <section className="view on"><div className="content"><div className="card"><div className="hold">
      <h3>Akses ditolak</h3><p>Role Anda tidak memiliki izin untuk halaman ini. Hubungi admin bila Anda memerlukan akses.</p>
      <p style={{ marginTop: 'var(--s-size-14)' }}><Link className="btn" to="/">Kembali ke dashboard</Link></p>
    </div></div></div></section>
  );
}
export function NotFoundPage() {
  return (
    <section className="view on"><div className="content"><div className="card"><div className="hold">
      <h3>Halaman tidak ditemukan</h3><p>Alamat yang Anda buka tidak tersedia.</p>
      <p style={{ marginTop: 'var(--s-size-14)' }}><Link className="btn" to="/">Kembali ke dashboard</Link></p>
    </div></div></div></section>
  );
}
export function ErrorPanel({ error }: { error: unknown }) {
  const rid = error instanceof ApiFailure ? error.requestId : undefined;
  return (
    <section className="view on"><div className="content"><div className="card"><div className="hold" role="alert">
      <h3>Terjadi kesalahan</h3><p>Halaman tidak dapat ditampilkan. Muat ulang; bila berulang, hubungi admin{rid ? <> dengan Request ID <span className="mono">{rid}</span></> : null}.</p>
      <p style={{ marginTop: 'var(--s-size-14)' }}><button className="btn" type="button" onClick={() => location.reload()}>Muat ulang</button></p>
    </div></div></div></section>
  );
}
export { Frame as AuthFrame };
