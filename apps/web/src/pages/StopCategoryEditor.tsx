import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EDITABLE_LOSS_GROUPS, STOP_CATEGORY_COLORS, type StopCategory, type StopCategoryInput } from '@mpd/contracts';
import { ApiFailure, api } from '../lib/api';
import { tokenColor } from '../lib/format';
import { Modal, useToast } from '../components/ui';

const GROUP_LABEL: Record<(typeof EDITABLE_LOSS_GROUPS)[number], string> = {
  setup: 'Setup & changeover', breakdown: 'Breakdown & abnormality', quality: 'Quality', minor: 'Minor stop', planned: 'Planned & info',
};
const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);

/** Add / edit / delete one stop category and its detail list. Only rendered for roles holding masterdata.stopcategories.edit;
 *  the API enforces the same permission, a hidden button is not the security boundary. */
export function StopCategoryEditor({ cat, onClose }: { cat: StopCategory | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    short: cat?.short ?? '', name: cat?.name ?? '', group: cat && cat.group !== 'unmapped' ? cat.group : ('setup' as const),
    oeeBucket: cat?.oeeBucket ?? 'A', infoOnly: cat?.infoOnly ?? false, color: cat?.color ?? (STOP_CATEGORY_COLORS[0] as string),
    notes: cat?.notes ?? '', details: (cat?.details ?? []).join('\n'), aliases: (cat?.aliases ?? []).join('\n'),
  });
  const [err, setErr] = useState<string | null>(null);
  const palette = [...new Set<string>([...STOP_CATEGORY_COLORS, f.color])];
  const done = (m: string) => { toast(m); void qc.invalidateQueries(); onClose(); };
  const fail = (e: unknown) => setErr(e instanceof ApiFailure ? e.message : 'Gagal menyimpan.');
  const save = useMutation({
    mutationFn: () => {
      const body = {
        id: cat?.id ?? null, short: f.short.trim(), name: f.name.trim(), group: f.group, oeeBucket: f.infoOnly ? '-' : f.oeeBucket === '-' ? 'A' : f.oeeBucket,
        infoOnly: f.infoOnly, color: f.color, aliases: lines(f.aliases), details: lines(f.details), notes: f.notes.trim() || null, version: cat?.version ?? null,
      } as StopCategoryInput;
      return api.put<StopCategory[]>('/api/master-data/stop-categories', body);
    },
    onSuccess: () => done(cat ? 'Kategori stop disimpan' : 'Kategori stop ditambahkan'),
    onError: fail,
  });
  const del = useMutation({
    mutationFn: () => api.del<StopCategory[]>(`/api/master-data/stop-categories/${encodeURIComponent(cat!.id)}?version=${cat!.version}`),
    onSuccess: () => done('Kategori stop dihapus'),
    onError: fail,
  });
  const nDetail = lines(f.details).length;
  return (
    <Modal open onClose={onClose} title={cat ? `Stop category · ${cat.short}` : 'Add stop category'}
      sub="Nama & alias dipakai untuk memetakan teks kategori dari ConMas. Perubahan dicatat di audit log.">
      <form onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate(); }}>
        <div className="form">
          <div className="fld"><label htmlFor="sc-short">Short name</label><input id="sc-short" value={f.short} maxLength={60} required onChange={(e) => setF({ ...f, short: e.target.value })} /></div>
          <div className="fld"><label htmlFor="sc-name">Full name (ConMas)</label><input id="sc-name" value={f.name} maxLength={160} required onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="fld"><label htmlFor="sc-group">Loss group</label>
            <select id="sc-group" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value as typeof f.group })}>{EDITABLE_LOSS_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select></div>
          <div className="fld"><label htmlFor="sc-oee">OEE bucket</label>
            <select id="sc-oee" value={f.infoOnly ? '-' : f.oeeBucket} disabled={f.infoOnly} onChange={(e) => setF({ ...f, oeeBucket: e.target.value as StopCategory['oeeBucket'] })}>
              <option value="A">Availability</option><option value="P">Performance</option>{f.infoOnly && <option value="-">— (info only)</option>}
            </select></div>
        </div>
        <div className="fld" style={{ marginTop: 'var(--s-size-12)' }}><span className="lb">Counted as loss</span>
          <div className="chks"><label><input type="checkbox" checked={f.infoOnly} onChange={(e) => setF({ ...f, infoOnly: e.target.checked, oeeBucket: e.target.checked ? '-' : 'A' })} /> Info only (tidak dihitung sebagai loss / stop time)</label></div></div>
        <div className="fld" style={{ marginTop: 'var(--s-size-12)' }}><span className="lb">Colour</span>
          <div className="swatches" role="radiogroup" aria-label="Colour">{palette.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={c.replace('s-paint-', '#')} className={`swb${f.color === c ? ' on' : ''}`} style={{ background: tokenColor(c) }} onClick={() => setF({ ...f, color: c })} />
          ))}</div></div>
        <div className="form" style={{ marginTop: 'var(--s-size-12)' }}>
          <div className="fld"><label htmlFor="sc-det">Details <span className="fa">({nDetail})</span></label>
            <textarea id="sc-det" rows={9} value={f.details} placeholder="Satu detail per baris" onChange={(e) => setF({ ...f, details: e.target.value })} />
            <div className="hint">Pilihan detail yang muncul di Stop Time. Satu per baris.</div></div>
          <div className="fld"><label htmlFor="sc-ali">ConMas aliases <span className="fa">({lines(f.aliases).length})</span></label>
            <textarea id="sc-ali" rows={9} value={f.aliases} placeholder="Satu alias per baris" onChange={(e) => setF({ ...f, aliases: e.target.value })} />
            <div className="hint">Penulisan lain teks kategori di ConMas. Satu per baris; huruf besar/kecil dan tanda baca diabaikan.</div></div>
        </div>
        <div className="fld" style={{ marginTop: 'var(--s-size-12)' }}><label htmlFor="sc-notes">Notes</label><input id="sc-notes" value={f.notes} maxLength={200} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        {err && <div className="banner e" role="alert" style={{ marginTop: 'var(--s-size-12)' }}>{err}</div>}
        <div style={{ marginTop: 'var(--s-size-12)', display: 'flex', gap: 'var(--s-size-8)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {cat && <button className="btn" type="button" disabled={del.isPending}
            onClick={() => { if (confirm(`Hapus kategori "${cat.short}"? Catatan stop ConMas dengan nama ini akan tampil sebagai "Unmapped" sampai dipetakan lagi.`)) { setErr(null); del.mutate(); } }}>Delete category</button>}
          <button className="btn pri" type="submit" disabled={save.isPending || !f.short.trim() || !f.name.trim()}>{save.isPending ? 'Saving…' : 'Save category'}</button>
        </div>
      </form>
    </Modal>
  );
}
