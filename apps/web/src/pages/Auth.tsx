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

const MIN_PASSWORD = 12;

/** Form daftar akun mandiri (port dari Production-Dashboard-PD). Akun pending sampai admin menyetujui dan memilih role. */
function RegisterForm({ onBack }: { onBack: (email?: string) => void }) {
  const [f, setF] = useState({ email: '', displayName: '', department: '', purpose: '', password: '', confirm: '', website: '' });
  const [localErr, setLocalErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => api.post<{ message: string }>('/api/auth/register', {
      email: f.email, displayName: f.displayName, department: f.department, purpose: f.purpose, password: f.password, website: f.website,
    }),
  });
  if (m.isSuccess) {
    return (
      <div className="login-form" id="register-done">
        <div className="login-notice login-success" role="status">{m.data.message}</div>
        <p className="login-help">Anda bisa masuk setelah admin menyetujui pendaftaran. Hubungi admin bila perlu dipercepat.</p>
        <button className="login-submit" type="button" onClick={() => onBack(f.email.trim())}>Kembali ke halaman masuk</button>
      </div>
    );
  }
  const err = localErr ?? (m.error instanceof ApiFailure ? m.error.message : m.error ? 'Pendaftaran gagal. Coba lagi.' : null);
  return (
    <form className="login-form" id="register-form" aria-labelledby="login-title" onSubmit={(e) => {
      e.preventDefault();
      if (m.isPending) return;
      if (f.password.length < MIN_PASSWORD) return setLocalErr(`Password minimal ${MIN_PASSWORD} karakter.`);
      if (f.password !== f.confirm) return setLocalErr('Konfirmasi password tidak sama.');
      setLocalErr(null);
      m.mutate();
    }}>
      <label htmlFor="re">Email
        <input id="re" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={f.email} onChange={set('email')} required />
      </label>
      <label htmlFor="rn">Nama lengkap
        <input id="rn" autoComplete="name" minLength={2} maxLength={120} value={f.displayName} onChange={set('displayName')} required />
      </label>
      <label htmlFor="rd">Departemen / bagian
        <input id="rd" minLength={2} maxLength={120} placeholder="mis. Molding, QA, Maintenance" value={f.department} onChange={set('department')} required />
      </label>
      <label htmlFor="rp">Kebutuhan akses
        <textarea id="rp" rows={3} minLength={10} maxLength={500} placeholder="Untuk apa Anda butuh akses dashboard ini?" value={f.purpose} onChange={set('purpose')} required />
      </label>
      <label htmlFor="rpw">Password
        <input id="rpw" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} maxLength={256} value={f.password} onChange={set('password')} required aria-describedby="rpw-hint" />
        <span className="login-help" id="rpw-hint">Minimal {MIN_PASSWORD} karakter.</span>
      </label>
      <label htmlFor="rpc">Ulangi password
        <input id="rpc" type="password" autoComplete="new-password" maxLength={256} value={f.confirm} onChange={set('confirm')} required />
      </label>
      {/* Honeypot anti-bot: tersembunyi dari pengguna & pembaca layar; manusia tidak mengisinya. */}
      <div className="login-hp" aria-hidden="true">
        <label htmlFor="rw">Website<input id="rw" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label>
      </div>
      {err && <div className="login-notice login-error" role="alert">{err}</div>}
      <button className="login-submit" type="submit" disabled={m.isPending}>{m.isPending ? 'Mengirim…' : 'Kirim pendaftaran'}</button>
      <p className="login-switch">Sudah punya akun? <button type="button" onClick={() => onBack()}>Masuk</button></p>
    </form>
  );
}

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [p, setP] = useState('');
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post('/api/auth/login', { email, password: p }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['me'] }); void nav(sp.get('next') ?? '/', { replace: true }); },
  });
  const err = m.error instanceof ApiFailure ? m.error.message : m.error ? 'Gagal masuk.' : null;
  const pendingInfo = m.error instanceof ApiFailure && (m.error.code === 'ACCOUNT_PENDING' || m.error.code === 'ACCOUNT_REJECTED');
  const register = mode === 'register';
  return (
    <main className="login-page" data-theme={dark ? 'dark' : 'light'}>
      <div className="login-hero">
        <img className="login-photo" src={facility} alt="" width={1024} height={1536} fetchPriority="high" />
        <div className="login-brand">
          <img src="/hrs-logo.png" width={147} height={80} alt="HRS" />
          <div className="login-identity">
            <p className="login-product">Dashboard Productions</p>
            <OrganizationName className="login-organization" />
          </div>
        </div>
      </div>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-content">
          <div className="login-heading">
            <h1 id="login-title">{register ? 'Daftar akun baru' : 'Masuk ke dashboard'}</h1>
            <button className="login-theme" type="button" aria-label="Mode gelap" aria-pressed={dark}
              title={dark ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'} onClick={() => setDark((on) => !on)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" /></>
                  : <path d="M20.8 14.2A8.8 8.8 0 0 1 9.8 3.2a8.9 8.9 0 1 0 11 11z" />}
              </svg>
            </button>
          </div>
          {register ? <RegisterForm onBack={(registered) => { if (registered) setEmail(registered); m.reset(); setMode('login'); }} /> : (
            <form className="login-form" onSubmit={(e) => { e.preventDefault(); m.mutate(); }} aria-labelledby="login-title">
              {sp.get('reason') === 'password' && <div className="login-notice" role="status">Password diganti. Silakan masuk kembali.</div>}
              {sp.get('reason') === 'expired' && <div className="login-notice" role="status">Sesi berakhir. Silakan masuk kembali.</div>}
              <label htmlFor="lu">
                Email
                <input id="lu" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254}
                  value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label htmlFor="lp">
                Password
                <input id="lp" name="password" type="password" autoComplete="current-password"
                  value={p} onChange={(e) => setP(e.target.value)} required />
              </label>
              {err && <div className={pendingInfo ? 'login-notice' : 'login-notice login-error'} role="alert">{err}</div>}
              <button className="login-submit" type="submit" disabled={m.isPending || !email || !p}>{m.isPending ? 'Sedang masuk…' : 'Masuk'}</button>
              <p className="login-switch">Belum punya akun? <button type="button" onClick={() => setMode('register')}>Daftar</button></p>
            </form>
          )}
          <p className="login-support">Akun baru perlu disetujui admin. Lupa password atau akun lama belum punya email? Hubungi administrator.</p>
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
