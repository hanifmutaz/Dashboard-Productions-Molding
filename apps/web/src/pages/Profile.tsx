import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSION_LABELS, PreferencesSchema, type AuditEntry, type Permission, type Preferences } from '@mpd/contracts';
import { ApiFailure, api } from '../lib/api';
import { useSession } from '../lib/session';
import { PRESETS } from '../lib/period';
import { initials } from '../shell/AppShell';
import { useToast } from '../components/ui';

export function ProfilePage() {
  const { me, prefs, savePrefs } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [p, setP] = useState<Preferences>(prefs);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  useEffect(() => setP(prefs), [prefs]);
  const act = useQuery({ queryKey: ['audit-mine'], queryFn: () => api.get<AuditEntry[]>('/api/admin/audit?mine=true&limit=8') });
  const logout = useMutation({ mutationFn: () => api.post('/api/auth/logout'), onSettled: () => { qc.clear(); void nav('/login'); } });
  const changePw = useMutation({
    mutationFn: () => api.post('/api/auth/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
    onSuccess: () => { qc.clear(); void nav('/login?reason=password'); },
    onError: (e: unknown) => setPwMsg(e instanceof ApiFailure ? e.message : 'Gagal mengganti password.'),
  });
  if (me?.kind !== 'user') return null;
  const u = me.user;
  const sel = (k: Exclude<keyof Preferences, 'cols'>, label: string, opts: [string, string][]) => (
    <div className="fld"><label htmlFor={`pr-${k}`}>{label}</label>
      <select id={`pr-${k}`} value={String(p[k])} onChange={(e) => setP({ ...p, [k]: e.target.value })}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
  );
  return (
    <section className="view on">
      <div className="content">
        <div className="card"><div className="phead">
          <div className="av">{initials(u.displayName)}</div>
          <div style={{ flex: 1 }}><h2>{u.displayName}</h2><div className="mu">{u.department ?? '—'} · PT Hirose Electric Indonesia</div>
            <div style={{ marginTop: 'var(--s-size-6)', display: 'flex', gap: 'var(--s-size-6)' }}><span className="chip">{u.roleName}</span><span className="chip">Molding Dashboard</span></div></div>
          <button className="btn" type="button" onClick={() => logout.mutate(undefined)}>Sign out</button>
        </div></div>
        <div className="g2e">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-size-14)' }}>
            <div className="card"><div className="ch"><div><h3>Account</h3><p>Local account managed by the administrator</p></div></div>
              <div className="cb"><dl className="kvl">
                <dt>Full name</dt><dd>{u.displayName}</dd><dt>Username</dt><dd className="mono">{u.username}</dd><dt>Department</dt><dd>{u.department ?? '—'}</dd>
                <dt>Role</dt><dd style={{ color: 'var(--primary)', fontWeight: 'var(--c-font-weight-600)' }}>{u.roleName}</dd><dt>Sign-in method</dt><dd>Local account</dd>
                <dt>Last sign-in</dt><dd>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd>
              </dl></div></div>
            <div className="card"><div className="ch"><div><h3>Access</h3><p>Granted by the {u.roleName} role · enforced by the server</p></div></div>
              <div className="cb"><div className="perm">
                {(Object.keys(PERMISSION_LABELS) as Permission[]).map((k) => (
                  <div key={k} className={u.permissions.includes(k) ? '' : 'x'}><span>{PERMISSION_LABELS[k]}</span>{u.permissions.includes(k) ? <b className="good">✓ Allowed</b> : <b className="bad">✕ Not allowed</b>}</div>
                ))}
                <div className="x"><span>Edit ConMas source data</span><b className="bad">✕ Read-only</b></div>
              </div></div></div>
            <div className="card"><div className="ch"><div><h3>Change password</h3><p>Minimal 12 karakter · semua sesi Anda akan keluar</p></div></div>
              <div className="cb"><form className="form" onSubmit={(e) => { e.preventDefault(); setPwMsg(null); if (pw.newPassword !== pw.confirm) { setPwMsg('Konfirmasi password tidak sama.'); return; } changePw.mutate(undefined); }}>
                <div className="fld"><label htmlFor="pw0">Current password</label><input id="pw0" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></div>
                <div className="fld"><label htmlFor="pw1">New password</label><input id="pw1" type="password" autoComplete="new-password" minLength={12} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></div>
                <div className="fld"><label htmlFor="pw2">Confirm new password</label><input id="pw2" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></div>
                <div className="fld" style={{ alignSelf: 'end' }}><button className="btn pri" type="submit" disabled={changePw.isPending || pw.newPassword.length < 12}>Change password</button></div>
                {pwMsg && <div className="banner e" style={{ gridColumn: '1/-1' }}>{pwMsg}</div>}
              </form></div></div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-size-14)' }}>
            <div className="card"><div className="ch"><div><h3>My preferences</h3><p>Only for your account · applied every time you open the dashboard</p></div>
              <button className="btn pri" type="button" onClick={() => { const r = PreferencesSchema.safeParse(p); if (r.success) void savePrefs(r.data).then(() => toast('Preferences saved'), () => toast('Gagal menyimpan preferensi')); }}>Save</button></div>
              <div className="cb"><div className="form">
                {sel('page', 'Default page', [['prod', 'Production'], ['util', 'Machine Utilization'], ['stop', 'Stop Time'], ['sales', 'Sales'], ['scrap', 'Scrap']])}
                {sel('period', 'Default period', Object.entries(PRESETS))}
                {sel('shift', 'Default shift', [['', 'All shifts'], ['1', 'Shift 1 · 06–14'], ['2', 'Shift 2 · 14–22'], ['3', 'Shift 3 · 22–06']])}
                {sel('theme', 'Theme', [['light', 'Light'], ['dark', 'Dark']])}
                {sel('side', 'Sidebar', [['', 'Automatic (by screen width)'], ['full', 'Always expanded'], ['rail', 'Always collapsed']])}
                {sel('motion', 'Animations', [['on', 'On'], ['off', 'Off']])}
              </div></div></div>
            <div className="card"><div className="ch"><div><h3>Recent activity</h3><p>Your own entries from the audit log</p></div></div>
              <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}><table>
                <thead><tr><th className="nos">Time</th><th className="nos">Action</th><th className="nos">Result</th></tr></thead>
                <tbody>{(act.data ?? []).map((a) => <tr key={a.id}><td className="m">{new Date(a.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{a.action}</td><td><span className={`chip${a.result === 'success' ? ' good' : ' bad'}`}>{a.result}</span></td></tr>)}
                  {!act.data?.length && <tr><td colSpan={3} className="empty">{act.isPending ? 'Memuat…' : 'Belum ada aktivitas.'}</td></tr>}</tbody>
              </table></div></div>
          </div>
        </div>
      </div>
    </section>
  );
}
