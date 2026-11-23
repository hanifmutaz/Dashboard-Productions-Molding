import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { OrganizationName } from '../components/OrganizationName';
import { ApiFailure, api } from '../lib/api';
import { APP_VERSION } from '../shell/AppShell';
import facility from '../assets/login-hrs-facility.webp';
import '../styles/login.css';

/* Compact frame for kiosk pairing and session messages. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="authwrap">
      <div className="card authcard">
        <div className="brand authbrand">
          <img className="hlogo" src="/hrs-logo.png" alt="HRS · Hirose Electric" />
          <span className="bsep" />
          <OrganizationName className="bt" />
        </div>
        {children}
      </div>
      <div className="sbver">Molding Dashboard · v{APP_VERSION}</div>
    </div>
  );
}

export function LoginPage() {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post('/api/auth/login', { username: u, password: p }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['me'] }); void nav(sp.get('next') ?? '/', { replace: true }); },
  });
  const err = m.error instanceof ApiFailure ? m.error.message : m.error ? 'Gagal masuk.' : null;
  return (
    <main className="login-page" data-theme={dark ? 'dark' : 'light'}>
      <div className="login-hero">
        <img className="login-photo" src={facility} alt="" width={1024} height={1536} fetchPriority="high" />
        <div className="login-brand">
          <img src="/hrs-logo.png" width={147} height={80} alt="HRS" />
          <OrganizationName className="login-organization" />
        </div>
        <p className="login-name">Dashboard<br />Productions</p>
      </div>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-content">
          <div className="login-heading">
            <h1 id="login-title">Masuk ke dashboard</h1>
            <button className="login-theme" type="button" aria-label="Mode gelap" aria-pressed={dark}
              title={dark ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'} onClick={() => setDark((on) => !on)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" /></>
                  : <path d="M20.8 14.2A8.8 8.8 0 0 1 9.8 3.2a8.9 8.9 0 1 0 11 11z" />}
              </svg>
            </button>
          </div>
          <form className="login-form" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} aria-labelledby="login-title">
            {sp.get('reason') === 'password' && <div className="login-notice" role="status">Password diganti. Silakan masuk kembali.</div>}
            {sp.get('reason') === 'expired' && <div className="login-notice" role="status">Sesi berakhir. Silakan masuk kembali.</div>}
            <label htmlFor="lu">
              Username
              <input id="lu" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
                value={u} onChange={(e) => setU(e.target.value)} required />
            </label>
            <label htmlFor="lp">
              Password
              <input id="lp" name="password" type="password" autoComplete="current-password"
                value={p} onChange={(e) => setP(e.target.value)} required />
            </label>
            {err && <div className="login-notice login-error" role="alert">{err}</div>}
            <button className="login-submit" type="submit" disabled={m.isPending || !u || !p}>{m.isPending ? 'Sedang masuk…' : 'Masuk'}</button>
          </form>
          <p className="login-support">Lupa password? Hubungi administrator.</p>
        </div>
      </section>
    </main>
  );
}

function ProblemPage({ title, children, action, alert }: { title: string; children: ReactNode; action: ReactNode; alert?: boolean }) {
  return (
    <section className="view on"><div className="content"><div className="card">
      <div className="problem-message" role={alert ? 'alert' : undefined}>
        <h1 className="authh">{title}</h1>
        {children}
        <div className="problem-actions">{action}</div>
      </div>
    </div></div></section>
  );
}

export function ForbiddenPage() {
  return <ProblemPage title="Akses ditolak" action={<Link className="btn" to="/">Kembali ke dashboard</Link>}>
    <p>Hubungi admin jika Anda memerlukan izin untuk halaman ini.</p>
  </ProblemPage>;
}

export function NotFoundPage() {
  return <ProblemPage title="Halaman tidak ditemukan" action={<Link className="btn" to="/">Kembali ke dashboard</Link>}>
    <p>Periksa alamat atau kembali ke dashboard.</p>
  </ProblemPage>;
}

export function ErrorPanel({ error }: { error: unknown }) {
  const rid = error instanceof ApiFailure ? error.requestId : undefined;
  return <ProblemPage title="Terjadi kesalahan" alert action={<button className="btn pri" type="button" onClick={() => location.reload()}>Muat ulang</button>}>
    <p>Halaman belum bisa dimuat. Jika berulang, hubungi admin.</p>
    {rid && <p className="mono">Request ID · {rid}</p>}
  </ProblemPage>;
}
export { Frame as AuthFrame };
