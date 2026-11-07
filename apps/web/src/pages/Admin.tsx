import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, PERMISSION_LABELS, type AuditEntry, type KioskDevice, type PairingCode, type Permission, type Role, type User } from '@mpd/contracts';
import { ApiFailure, api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { DataTable } from '../components/table';
import { Kpi } from '../components/kpi';
import { Modal, Tabs, useToast } from '../components/ui';

const errText = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Permintaan gagal.');
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/* ---------------- Users & roles ---------------- */
export function UsersPage() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'u' | 'r'>('u');
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api.get<User[]>('/api/admin/users') });
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: () => api.get<{ roles: Role[]; permissions: Permission[] }>('/api/admin/roles') });
  const [edit, setEdit] = useState<(Partial<User> & { password?: string }) | null>(null);
  const [roleEdit, setRoleEdit] = useState<Partial<Role> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const myPerms: Permission[] = me?.kind === 'user' ? me.user.permissions : [];
  const assignable = (roles.data?.roles ?? []).filter((r) => r.permissions.every((p) => myPerms.includes(p as Permission)));
  const done = (m: string) => { setErr(null); setEdit(null); setRoleEdit(null); toast(m); void qc.invalidateQueries({ queryKey: ['admin-users'] }); void qc.invalidateQueries({ queryKey: ['admin-roles'] }); };
  const saveUser = useMutation({
    mutationFn: (u: Partial<User> & { password?: string }) => (u.id
      ? api.put(`/api/admin/users/${u.id}`, { displayName: u.displayName, department: u.department || null, roleId: u.roleId, active: u.active, version: u.version })
      : api.post('/api/admin/users', { username: u.username, displayName: u.displayName, department: u.department || null, roleId: u.roleId, password: u.password })),
    onSuccess: () => done('User saved'), onError: (e) => setErr(errText(e)),
  });
  const resetPw = useMutation({ mutationFn: (a: { id: string; password: string }) => api.post(`/api/admin/users/${a.id}/password`, { password: a.password }), onSuccess: () => done('Password reset · user sessions revoked'), onError: (e) => setErr(errText(e)) });
  const saveRole = useMutation({
    mutationFn: (r: Partial<Role>) => (r.id ? api.put(`/api/admin/roles/${r.id}`, { name: r.name, description: r.description ?? null, permissions: r.permissions ?? [], version: r.version ?? null })
      : api.post('/api/admin/roles', { name: r.name, description: r.description ?? null, permissions: r.permissions ?? [], version: null })),
    onSuccess: () => done('Role saved'), onError: (e) => setErr(errText(e)),
  });
  const delRole = useMutation({ mutationFn: (id: string) => api.del(`/api/admin/roles/${id}`), onSuccess: () => done('Role deleted'), onError: (e) => toast(errText(e)) });
  const canRoles = can(PERMISSIONS.manageRoles);
  return (
    <section className="view on"><div className="content">
      <div className="deck u4">
        <Kpi l="Users" v={users.data?.length ?? '—'} u="accounts" desc={`${users.data?.filter((u) => u.active).length ?? 0} active`} />
        <Kpi l="Roles" v={roles.data?.roles.length ?? '—'} u="roles" desc="Super admin, Admin, User + custom" />
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'u', label: 'Users' }, { id: 'r', label: 'Roles & permissions' }]}
        right={tab === 'u' ? <button className="btn pri" type="button" onClick={() => { setErr(null); setEdit({ active: true, roleId: assignable[assignable.length - 1]?.id }); }}>Add user</button>
          : canRoles ? <button className="btn pri" type="button" onClick={() => { setErr(null); setRoleEdit({ permissions: [] }); }}>Add role</button> : null} />
      {tab === 'u' && (
        <div className="card"><div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
          <DataTable rows={users.data ?? []} rowKey={(u) => u.id} sort={{ k: 'username', asc: true }} onRowClick={(u) => { setErr(null); setEdit(u); }} empty={users.isPending ? 'Memuat…' : users.error ? errText(users.error) : 'No users'}
            cols={[
              { k: 'username', h: 'Username', cl: 'mono' }, { k: 'displayName', h: 'Name' }, { k: 'department', h: 'Department', cl: 'mu' }, { k: 'roleName', h: 'Role' },
              { k: 'active', h: 'Status', f: (u) => (u.active ? <span className="chip good">Active</span> : <span className="chip">Disabled</span>) },
              { k: 'lastLoginAt', h: 'Last sign-in', cl: 'm', f: (u) => dt(u.lastLoginAt) },
            ]} />
        </div></div>
      )}
      {tab === 'r' && (
        <div className="card"><div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
          <DataTable rows={roles.data?.roles ?? []} rowKey={(r) => r.id} sort={{ k: 'name', asc: true }} onRowClick={canRoles ? (r) => { setErr(null); setRoleEdit(r); } : undefined}
            cols={[
              { k: 'name', h: 'Role', f: (r) => <><b>{r.name}</b>{r.isSystem && <> <span className="chip">System</span></>}</> }, { k: 'description', h: 'Description', cl: 'mu' },
              { k: 'permissions', h: 'Permissions', n: true, cl: 'm', sv: (r) => r.permissions.length, f: (r) => r.permissions.length }, { k: 'userCount', h: 'Users', n: true, cl: 'm' },
            ]} />
          {!canRoles && <div className="tfoot"><span>Role & permission hanya dapat diubah oleh Super admin.</span></div>}
        </div></div>
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? `Edit user · ${edit.username}` : 'Add user'} sub="Role yang dapat diberikan dibatasi oleh permission Anda sendiri">
          <form className="form" onSubmit={(e) => { e.preventDefault(); saveUser.mutate(edit); }}>
            {!edit.id && <div className="fld"><label htmlFor="uu">Username</label><input id="uu" autoComplete="off" value={edit.username ?? ''} onChange={(e) => setEdit({ ...edit, username: e.target.value })} required /></div>}
            <div className="fld"><label htmlFor="un">Name</label><input id="un" value={edit.displayName ?? ''} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} required /></div>
            <div className="fld"><label htmlFor="ud">Department</label><input id="ud" value={edit.department ?? ''} onChange={(e) => setEdit({ ...edit, department: e.target.value })} /></div>
            <div className="fld"><label htmlFor="ur">Role</label><select id="ur" value={edit.roleId ?? ''} onChange={(e) => setEdit({ ...edit, roleId: e.target.value })}>{assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            {!edit.id && <div className="fld"><label htmlFor="up">Initial password</label><input id="up" type="password" autoComplete="new-password" minLength={12} value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} required /><div className="hint">Min 12 karakter · sampaikan langsung ke user</div></div>}
            {edit.id && <div className="fld"><span className="lb">Status</span><label className="tog"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label></div>}
            {err && <div className="banner e" style={{ gridColumn: '1/-1' }}>{err}</div>}
            <div style={{ gridColumn: '1/-1', display: 'flex', gap: 'var(--s-size-8)', justifyContent: 'flex-end' }}>
              {edit.id && <button className="btn" type="button" onClick={() => { const p = prompt('New password (min 12 characters)'); if (p) resetPw.mutate({ id: edit.id!, password: p }); }}>Reset password</button>}
              <button className="btn pri" type="submit" disabled={saveUser.isPending}>Save</button>
            </div>
          </form>
        </Modal>
      )}
      {roleEdit && (
        <Modal open onClose={() => setRoleEdit(null)} title={roleEdit.id ? `Role · ${roleEdit.name}` : 'Add role'} sub={roleEdit.isSystem ? 'Role sistem tidak dapat diubah' : 'Permission yang tidak Anda miliki tidak dapat diberikan'}>
          <form onSubmit={(e) => { e.preventDefault(); saveRole.mutate(roleEdit); }}>
            <div className="form">
              <div className="fld"><label htmlFor="rn">Name</label><input id="rn" value={roleEdit.name ?? ''} disabled={roleEdit.isSystem} onChange={(e) => setRoleEdit({ ...roleEdit, name: e.target.value })} required /></div>
              <div className="fld"><label htmlFor="rd">Description</label><input id="rd" value={roleEdit.description ?? ''} disabled={roleEdit.isSystem} onChange={(e) => setRoleEdit({ ...roleEdit, description: e.target.value })} /></div>
            </div>
            <div className="fld" style={{ marginTop: 'var(--s-size-12)' }}><span className="lb">Permissions</span>
              <div className="chks">{(Object.keys(PERMISSION_LABELS) as Permission[]).map((p) => (
                <label key={p}><input type="checkbox" disabled={roleEdit.isSystem || !myPerms.includes(p)} checked={roleEdit.permissions?.includes(p) ?? false}
                  onChange={(e) => setRoleEdit({ ...roleEdit, permissions: e.target.checked ? [...(roleEdit.permissions ?? []), p] : (roleEdit.permissions ?? []).filter((x) => x !== p) })} /> {PERMISSION_LABELS[p]}</label>
              ))}</div></div>
            {err && <div className="banner e" style={{ marginTop: 'var(--s-size-12)' }}>{err}</div>}
            {!roleEdit.isSystem && (
              <div style={{ marginTop: 'var(--s-size-12)', display: 'flex', gap: 'var(--s-size-8)', justifyContent: 'flex-end' }}>
                {roleEdit.id && <button className="btn" type="button" onClick={() => { if (confirm(`Hapus role "${roleEdit.name}"? Role yang masih dipakai user tidak dapat dihapus.`)) delRole.mutate(roleEdit.id!); }}>Delete role</button>}
                <button className="btn pri" type="submit" disabled={saveRole.isPending}>Save role</button>
              </div>
            )}
          </form>
        </Modal>
      )}
    </div></section>
  );
}

/* ---------------- Audit viewer (super admin) ---------------- */
export function AuditPage() {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const q = useQuery({ queryKey: ['audit', action, actor], queryFn: () => api.get<AuditEntry[]>(`/api/admin/audit?${qs({ action: action || undefined, actor: actor || undefined, limit: '200' })}`) });
  return (
    <section className="view on"><div className="content">
      <div className="card">
        <div className="ch"><div><h3>Audit log</h3><p>Append-only · latest 200 entries for the filter · before/after values are sanitized</p></div>
          <div style={{ display: 'flex', gap: 'var(--s-size-8)' }}>
            <input className="srch" placeholder="Action prefix, e.g. auth." value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 'var(--s-size-220)', margin: 0 }} aria-label="Filter action" />
            <input className="srch" placeholder="Actor…" value={actor} onChange={(e) => setActor(e.target.value)} style={{ width: 'var(--s-size-160)', margin: 0 }} aria-label="Filter actor" />
          </div></div>
        <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
          <DataTable rows={q.data ?? []} rowKey={(a) => a.id} sort={{ k: 'at', asc: false }} pageSize={50} empty={q.isPending ? 'Memuat…' : q.error ? errText(q.error) : 'No entries'}
            footer={(pg) => <div className="tfoot"><span>Showing {pg.from}–{pg.to} of {pg.total}</span></div>}
            cols={[
              { k: 'at', h: 'Time', cl: 'm', f: (a) => dt(a.at) }, { k: 'actor', h: 'Actor', cl: 'mono' }, { k: 'action', h: 'Action' },
              { k: 'object', h: 'Object', cl: 'mu', sv: (a) => a.objectType ?? '', f: (a) => (a.objectType ? `${a.objectType}${a.objectId ? ' · ' + a.objectId.slice(0, 8) : ''}` : '—') },
              { k: 'result', h: 'Result', f: (a) => <span className={`chip${a.result === 'success' ? ' good' : a.result === 'denied' ? ' warn' : ' bad'}`}>{a.result}</span> },
              { k: 'requestId', h: 'Request ID', cl: 'mono fa' },
            ]}
            expand={(a) => <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--s-size-12)' }}>{JSON.stringify(a.detail, null, 2)}</pre>} />
        </div>
      </div>
    </div></section>
  );
}

/* ---------------- Kiosks ---------------- */
export function KiosksPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['kiosks'], queryFn: () => api.get<KioskDevice[]>('/api/admin/kiosks') });
  const machines = useQuery({ queryKey: ['machines', null], queryFn: () => api.get<{ data: { machines: { machineNo: string }[] } | null }>('/api/v1/machines') });
  const [form, setForm] = useState({ name: '', machineNo: '' });
  const [code, setCode] = useState<PairingCode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => api.post<PairingCode>('/api/admin/kiosks/pairing', form), onSuccess: (c) => { setErr(null); setCode(c); }, onError: (e) => setErr(errText(e)) });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/api/admin/kiosks/${id}/revoke`), onSuccess: () => { toast('Kiosk revoked'); void qc.invalidateQueries({ queryKey: ['kiosks'] }); }, onError: (e) => toast(errText(e)) });
  return (
    <section className="view on"><div className="content">
      <div className="g2e">
        <div className="card"><div className="ch"><div><h3>Pair a new iPad</h3><p>Kode sekali pakai, berlaku 10 menit · kiosk terkunci ke satu mesin, hanya baca Machine Detail</p></div></div>
          <div className="cb">
            <form className="form" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
              <div className="fld"><label htmlFor="kn">Device name</label><input id="kn" placeholder="iPad Line A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="fld"><label htmlFor="km">Machine</label><select id="km" value={form.machineNo} onChange={(e) => setForm({ ...form, machineNo: e.target.value })} required>
                <option value="">Choose machine…</option>{(machines.data?.data?.machines ?? []).map((m) => <option key={m.machineNo} value={m.machineNo}>MC {m.machineNo}</option>)}</select></div>
              <div style={{ gridColumn: '1/-1' }}><button className="btn pri" type="submit" disabled={create.isPending || !form.name || !form.machineNo}>Generate pairing code</button></div>
            </form>
            {err && <div className="banner e" style={{ marginTop: 'var(--s-size-12)' }}>{err}</div>}
            {code && (
              <div className="note" style={{ marginTop: 'var(--s-size-12)' }} role="status">
                Pada iPad, buka <b className="mono">{location.origin}/kiosk</b> lalu masukkan kode: <b className="mono" style={{ fontSize: 'var(--s-size-22)', letterSpacing: '.08em' }}>{code.code}</b>
                <br />Untuk {code.name} · MC {code.machineNo} · berlaku sampai {dt(code.expiresAt)}. Kode tidak ditampilkan lagi.
              </div>
            )}
          </div></div>
        <div className="card"><div className="ch"><div><h3>Paired devices</h3><p>Revoke takes effect on the next request of the device</p></div></div>
          <div className="cb" style={{ padding: 'var(--s-size-12) 0 0' }}>
            <DataTable rows={list.data ?? []} rowKey={(k) => k.id} sort={{ k: 'createdAt', asc: false }} empty={list.isPending ? 'Memuat…' : 'Belum ada kiosk'}
              cols={[
                { k: 'name', h: 'Device' }, { k: 'machineNo', h: 'Machine', f: (k) => <span className="mc">MC {k.machineNo}</span> },
                { k: 'lastSeenAt', h: 'Last seen', cl: 'm', f: (k) => dt(k.lastSeenAt) },
                { k: 'revokedAt', h: 'Status', nos: true, f: (k) => (k.revokedAt ? <span className="chip">Revoked</span> : <button className="btn" type="button" onClick={(e) => { e.stopPropagation(); if (confirm(`Cabut kiosk "${k.name}" (MC ${k.machineNo})? Perangkat harus di-pairing ulang.`)) revoke.mutate(k.id); }}>Revoke</button>) },
              ]} />
          </div></div>
      </div>
    </div></section>
  );
}
