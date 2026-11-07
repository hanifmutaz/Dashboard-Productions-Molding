import { useEffect, useState, type ReactNode } from 'react';
import { Link, useBlocker } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, PERMISSIONS, SettingsBodySchema, type Settings, type SettingsBody } from '@mpd/contracts';
import { ApiFailure, api } from '../lib/api';
import { useSession } from '../lib/session';
import { Toggle, useToast } from '../components/ui';

const TGL: [keyof SettingsBody['tgt'], string][] = [['beki', 'Bekidoritsu'], ['oee', 'OEE'], ['avail', 'Availability'], ['perf', 'Performance'], ['qual', 'Quality'], ['kikai', 'Kikai Kadouritsu'], ['sogo', 'Sogo Kadouritsu'], ['shugyo', 'Shugyo Kadouritsu']];
const KPAGES = [['prod', 'Production'], ['util', 'Machine Utilization'], ['stop', 'Stop Time'], ['sales', 'Sales'], ['scrap', 'Scrap']] as const;
const MDPAGES = ['Ringkasan', 'Shift & stop time', 'Trend & analisa'];
const SECTIONS = [['st-tgt', 'Targets'], ['st-rule', 'Status & colours'], ['st-cal', 'Calendar & shifts'], ['st-stop', 'Stop time display'], ['st-md', 'Machine Detail / iPad'], ['st-kiosk', 'Kiosk / TV'], ['st-data', 'Data freshness']] as const;

const bodyOf = (s: Settings): SettingsBody => { const { version: _v, updatedAt: _u, updatedBy: _b, ...b } = s; return b; };

export function SettingsPage() {
  const { settings, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = can(PERMISSIONS.editSettings);
  const [draft, setDraft] = useState<SettingsBody>(() => bodyOf(settings));
  const [msg, setMsg] = useState<ReactNode>(null);
  const [active, setActive] = useState<string>('st-tgt');
  useEffect(() => setDraft(bodyOf(settings)), [settings]);
  const saved = bodyOf(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const isDirtyAt = (get: (b: SettingsBody) => unknown) => JSON.stringify(get(draft)) !== JSON.stringify(get(saved));
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state === 'blocked') { if (confirm('You have unsaved settings. Leave this page and discard them?')) blocker.proceed(); else blocker.reset(); }
  }, [blocker]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    addEventListener('beforeunload', h);
    return () => removeEventListener('beforeunload', h);
  }, [dirty]);
  useEffect(() => {
    const f = () => {
      let cur: string = SECTIONS[0][0];
      for (const [id] of SECTIONS) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < 140) cur = id; }
      if (innerHeight + scrollY >= document.body.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1]![0];
      setActive(cur);
    };
    addEventListener('scroll', f, { passive: true });
    return () => removeEventListener('scroll', f);
  }, []);
  const save = useMutation({
    mutationFn: (b: SettingsBody) => api.put<Settings>('/api/settings', { version: settings.version, settings: b }),
    onSuccess: (s) => { qc.setQueryData(['settings'], s); setMsg(null); toast('Settings saved · every page uses the new values'); void qc.invalidateQueries(); },
    onError: (e: unknown) => setMsg(<span className="bad">{e instanceof ApiFailure ? e.message : 'Gagal menyimpan.'}</span>),
  });
  const set = (fn: (d: SettingsBody) => SettingsBody) => setDraft((d) => fn(structuredClone(d)));
  const num = (v: string) => (v === '' ? Number.NaN : Number(v));
  const field = (id: string, label: string, unit: string, get: (b: SettingsBody) => number, put: (b: SettingsBody, v: number) => void, attrs: { min?: number; max?: number; step?: number } = {}, hint?: string) => (
    <div className="fld">
      <label htmlFor={id}>{label}</label>
      <div className="unit"><input id={id} type="number" {...attrs} disabled={!canEdit} className={isDirtyAt(get) ? 'dirty' : ''} value={Number.isNaN(get(draft)) ? '' : get(draft)} onChange={(e) => set((d) => { put(d, num(e.target.value)); return d; })} /><span>{unit}</span></div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
  const onSave = () => {
    const r = SettingsBodySchema.safeParse(draft);
    if (!r.success) { const e = r.error.issues; setMsg(<span className="bad">{e[0]?.path.map(String).join('.')}: {e[0]?.message}{e.length > 1 ? ` (+${e.length - 1} more)` : ''}</span>); return; }
    save.mutate(r.data);
  };
  const t = draft.tgt.beki, b = draft.band, lo = Math.max(0, t - b), mn = Math.max(0, Math.min(50, lo - 15)), mx = Math.max(110, t + 10), W = (v: number) => ((v - mn) / (mx - mn)) * 100;

  return (
    <section className="view on">
      <div className="content">
        {!canEdit && <div className="banner w">Settings berlaku untuk semua pengguna dan hanya dapat diubah oleh Super admin. Anda melihat dalam mode baca.</div>}
        <div className="set">
          <nav className="snav" aria-label="Settings sections">
            {SECTIONS.map(([id, l]) => <a key={id} href={`#${id}`} className={active === id ? 'on' : ''} onClick={(e) => { e.preventDefault(); const el = document.getElementById(id); if (el) scrollTo({ top: el.getBoundingClientRect().top + scrollY - 70, behavior: 'smooth' }); }}>{l}</a>)}
          </nav>
          <div className="sbody">
            <div className="card" id="st-tgt"><div className="ch"><div><h3>Targets</h3><p>Used for KPI gauges, target lines and colour status on every page</p></div></div>
              <div className="cb"><div className="form f3">{TGL.map(([k, l]) => <div key={k}>{field(`tg-${k}`, l, '%', (d) => d.tgt[k], (d, v) => { d.tgt[k] = v; }, { min: 0, max: 100, step: 0.5 })}</div>)}</div></div></div>
            <div className="card" id="st-rule"><div className="ch"><div><h3>Status &amp; colours</h3><p>How a value is coloured and when achievement needs attention in the achievement filter</p></div></div>
              <div className="cb">
                <div className="form f3">
                  {field('cfBand', 'Far-below band', 'pt', (d) => d.band, (d, v) => { d.band = v; }, { min: 1, max: 50, step: 1 }, 'Red when value is this far below target')}
                  {field('cfPO', 'Perlu perhatian jika OEE di bawah', '%', (d) => d.prob.oee, (d, v) => { d.prob.oee = v; }, { min: 0, max: 100 })}
                  {field('cfPB', 'Perlu perhatian jika Bekidoritsu di bawah', '%', (d) => d.prob.beki, (d, v) => { d.prob.beki = v; }, { min: 0, max: 100 })}
                </div>
                <div style={{ marginTop: 'var(--s-size-14)' }}><div className="caps">Preview · Bekidoritsu</div>
                  <div className="prev"><span style={{ width: `${W(lo)}%`, background: 'var(--bad)' }}>▼ below {lo}%</span><span style={{ width: `${W(t) - W(lo)}%`, background: 'var(--warn)' }}>{lo}–{t}%</span><span style={{ width: `${100 - W(t)}%`, background: 'var(--good)' }}>≥ {t}%</span></div></div>
              </div></div>
            <div className="card" id="st-cal"><div className="ch"><div><h3>Calendar &amp; shifts</h3><p>Calendar time is the basis for Sogo and Shugyo Kadouritsu</p></div></div>
              <div className="cb">
                <div className="form">
                  {field('cfCD', 'Calendar min per day', 'min', (d) => d.cal.day, (d, v) => { d.cal.day = v; }, { min: 1 })}
                  {field('cfCS', 'Calendar min per shift', 'min', (d) => d.cal.shift, (d, v) => { d.cal.shift = v; }, { min: 1 })}
                </div>
                <div className="note" style={{ marginTop: 'var(--s-size-12)' }}><b>Shift 1</b> 06:00–14:00 · <b>Shift 2</b> 14:00–22:00 · <b>Shift 3</b> 22:00–06:00 (dihitung ke tanggal saat shift dimulai). Jam shift adalah keputusan FINAL dan tidak dapat diubah dari aplikasi.</div>
              </div></div>
            <div className="card" id="st-stop"><div className="ch"><div><h3>Stop time display</h3><p>Defaults for the Stop Time page</p></div></div>
              <div className="cb"><div className="form f3">
                {field('cfTop', 'Details shown before “Show all”', 'rows', (d) => d.disp.topN, (d, v) => { d.disp.topN = v; }, { min: 3, max: 50 })}
                {field('cfPar', 'Pareto reference line', '%', (d) => d.disp.pareto, (d, v) => { d.disp.pareto = v; }, { min: 50, max: 95, step: 5 })}
                <div className="fld"><span className="lb">Info-only stops</span><Toggle disabled={!canEdit} on={draft.disp.info} onChange={(v) => set((d) => { d.disp.info = v; return d; })} style={{ height: 'var(--s-size-34)' }}>Include by default</Toggle></div>
              </div></div></div>
            <div className="card" id="st-md"><div className="ch"><div><h3>Machine Detail / iPad</h3><p>Per-machine dashboard on the floor iPad · applies to every user and kiosk</p></div></div>
              <div className="cb">
                <div className="form f3">
                  {field('cfMr', 'Seconds per page', 'sec', (d) => d.md.rot, (d, v) => { d.md.rot = v; }, { min: 5, max: 120 }, 'Auto-rotation in iPad mode')}
                  <div className="fld"><label htmlFor="cfMp">PIC photo size</label><select id="cfMp" disabled={!canEdit} value={draft.md.photo} onChange={(e) => set((d) => { d.md.photo = e.target.value as SettingsBody['md']['photo']; return d; })}><option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option></select></div>
                  <div className="fld"><label htmlFor="cfMl">Number format</label><select id="cfMl" disabled={!canEdit} value={draft.md.loc} onChange={(e) => set((d) => { d.md.loc = e.target.value as SettingsBody['md']['loc']; return d; })}><option value="en-US">1,234.5 (same as dashboard)</option><option value="id-ID">1.234,5 (Indonesian)</option></select></div>
                  <div className="fld"><label htmlFor="cfMs">Default machine order</label><select id="cfMs" disabled={!canEdit} value={draft.md.sort} onChange={(e) => set((d) => { d.md.sort = e.target.value as SettingsBody['md']['sort']; return d; })}><option value="mc">MC number</option><option value="low">Lowest achievement first</option></select></div>
                  <div className="fld"><span className="lb">PIC strip</span><Toggle disabled={!canEdit} on={draft.md.pic} onChange={(v) => set((d) => { d.md.pic = v; return d; })} style={{ height: 'var(--s-size-34)' }}>Show leader &amp; technician (NIK)</Toggle><div className="hint">Nama/foto menunggu Q-021 (data pribadi)</div></div>
                  <div className="fld"><span className="lb">iPad mode</span><Toggle disabled={!canEdit} on={draft.md.autoplay} onChange={(v) => set((d) => { d.md.autoplay = v; return d; })} style={{ height: 'var(--s-size-34)' }}>Start rotating automatically</Toggle></div>
                </div>
                <div className="fld" style={{ marginTop: 'var(--s-size-12)' }}><span className="lb">Pages in rotation</span>
                  <div className="chks">{MDPAGES.map((l, i) => { const k = String(i) as '0' | '1' | '2'; return <label key={k}><input type="checkbox" disabled={!canEdit} checked={draft.md.pages.includes(k)} onChange={(e) => set((d) => { d.md.pages = e.target.checked ? [...d.md.pages, k].sort() : d.md.pages.filter((x) => x !== k); return d; })} /> {l}</label>; })}</div></div>
              </div></div>
            <div className="card" id="st-kiosk"><div className="ch"><div><h3>Kiosk / TV</h3><p>Rotation for the production-floor screen</p></div></div>
              <div className="cb">
                <div className="form">
                  {field('cfKs', 'Seconds per page', 'sec', (d) => d.kiosk.sec, (d, v) => { d.kiosk.sec = v; }, { min: 5, max: 300 })}
                  <div className="fld"><label htmlFor="cfKt">Theme on TV</label><select id="cfKt" disabled={!canEdit} value={draft.kiosk.theme} onChange={(e) => set((d) => { d.kiosk.theme = e.target.value as SettingsBody['kiosk']['theme']; return d; })}><option value="dark">Dark (recommended)</option><option value="light">Light</option><option value="keep">Same as user</option></select></div>
                </div>
                <div className="fld" style={{ marginTop: 'var(--s-size-12)' }}><span className="lb">Pages in rotation</span>
                  <div className="chks">{KPAGES.map(([k, l]) => <label key={k}><input type="checkbox" disabled={!canEdit} checked={draft.kiosk.pages.includes(k)} onChange={(e) => set((d) => { d.kiosk.pages = e.target.checked ? [...d.kiosk.pages, k] : d.kiosk.pages.filter((x) => x !== k); return d; })} /> {l}</label>)}</div></div>
              </div></div>
            <div className="card" id="st-data"><div className="ch"><div><h3>Data freshness</h3><p>When the dashboard warns that ConMas data may be out of date</p></div></div>
              <div className="cb"><div className="form f3">
                {field('cfSt', 'Show delayed (tertunda) after', 'min', (d) => d.data.stale, (d, v) => { d.data.stale = v; }, { min: 5, max: 240 })}
                {field('cfSu', 'Hide values (unavailable) after', 'min', (d) => d.data.unavailable, (d, v) => { d.data.unavailable = v; }, { min: 10, max: 1440 }, 'Values older than this are not shown')}
                {field('cfRf', 'Auto refresh every', 'min', (d) => d.data.refresh, (d, v) => { d.data.refresh = v; }, { min: 1, max: 60 })}
              </div></div></div>
            <div className="note">Prices, materials, stop categories and machines are maintained in <Link className="lnk" to="/master-data">Master Data</Link>. Personal preferences (default page, period, theme, sidebar, animations) are in <Link className="lnk" to="/profile">My profile</Link>.{settings.updatedBy && <> Last changed by <b>{settings.updatedBy}</b> · {new Date(settings.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.</>}</div>
            {canEdit && (
              <div className={`ssave${dirty ? ' dirty' : ''}`}>
                <span className="st">{msg ?? (dirty ? 'Unsaved changes' : 'All changes saved')}</span>
                <span style={{ display: 'flex', gap: 'var(--s-size-8)' }}>
                  <button className="btn" type="button" disabled={!dirty} onClick={() => { setDraft(saved); setMsg(null); toast('Changes discarded'); }}>Discard changes</button>
                  <button className="btn" type="button" onClick={() => { setDraft(structuredClone(DEFAULT_SETTINGS)); setMsg('Defaults loaded · press Save to apply'); }}>Reset to defaults</button>
                  <button className="btn pri" type="button" disabled={!dirty || save.isPending} onClick={onSave}>{save.isPending ? 'Saving…' : 'Save settings'}</button>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
