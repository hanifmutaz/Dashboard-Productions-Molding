import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DailyRatesView, ViewDataEnvelope } from '@mpd/contracts';
import { api, qs } from '../lib/api';
import { useFilters } from '../lib/filters';
import { useSession } from '../lib/session';
import { cls, colOf, Pc } from '../lib/status';
import { DOW, f1, fmt, lbl, lblY, pd } from '../lib/format';
import { rangeTxt } from '../lib/period';
import { Chart } from '../components/charts';
import { Modal, Seg } from '../components/ui';
import { EnvelopeBanner } from '../components/state';

export interface RateTarget { machineNo: string | null; label: string; k?: RateKey }
type RateKey = 'beki' | 'kikai' | 'sogo' | 'shugyo';
const MK: Record<RateKey, string> = { beki: 'Bekidoritsu', kikai: 'Kikai Kadouritsu', sogo: 'Sogo Kadouritsu', shugyo: 'Shugyo Kadouritsu' };
const FIELD: Record<RateKey, 'bekidoritsu' | 'kikai' | 'sogo' | 'shugyo'> = { beki: 'bekidoritsu', kikai: 'kikai', sogo: 'sogo', shugyo: 'shugyo' };

export function RateModal({ target, onClose }: { target: RateTarget; onClose: () => void }) {
  const { f } = useFilters();
  const { settings: s } = useSession();
  const [k, setK] = useState<RateKey>(target.k ?? 'beki');
  const q = useQuery({
    queryKey: ['daily-rates', f.from, f.to, f.shift, target.machineNo],
    queryFn: () => api.get<ViewDataEnvelope<DailyRatesView>>(`/api/v1/monitoring/daily-rates?${qs({ from: f.from, to: f.to, shift: f.shift || undefined, machineNo: target.machineNo ?? undefined })}`),
  });
  const rows = q.data?.data?.rows ?? [];
  const fld = FIELD[k];
  return (
    <Modal open onClose={onClose} title={`${target.label} — ${MK[k]} by day`} sub={`${rangeTxt(f.from, f.to)}${f.shift ? ` · Shift ${f.shift}` : ''} · target ${s.tgt[k]}%`}>
      <Seg value={k} onChange={setK} items={(Object.keys(MK) as RateKey[]).map((x) => ({ id: x, label: MK[x].replace(' Kadouritsu', '') }))} />
      <EnvelopeBanner env={q.data} error={q.error} />
      <div style={{ margin: 'var(--s-size-12) 0' }}>
        <Chart aria={`${MK[k]} by day`} labels={rows.map((r) => lbl(r.date))} h={200} bw={26} yMax={k === 'beki' ? 120 : 100} yFmt={(v) => Math.round(v) + '%'} vFmt={(v) => f1(v) + '%'}
          bars={[{ name: MK[k], cols: rows.map((r) => colOf(cls(r[fld].value, k, s))), vals: rows.map((r) => r[fld].value) }]}
          target={s.tgt[k]} targetLbl={`target ${s.tgt[k]}%`} disabled={(i) => rows[i]?.[fld].value == null} tipT={(i) => `${DOW[pd(rows[i]!.date).getUTCDay()]} ${lblY(rows[i]!.date)}`} />
      </div>
      <div className="tw st1" style={{ maxHeight: '45vh', border: 'var(--s-size-1) solid var(--line)', borderRadius: 'var(--r-sm)' }}>
        <table>
          <thead><tr>{['Date', 'Plan', 'Actual', 'Bekidoritsu', 'Calendar min', 'Planned min', 'Stop min', 'Running min', 'Kikai', 'Sogo', 'Shugyo'].map((h, i) => <th key={h} className={`nos${i ? ' n' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date}>
                <td>{DOW[pd(r.date).getUTCDay()]} {lbl(r.date)}</td>
                <td className="n m">{r.plan ? fmt(r.plan) : <span className="fa">off</span>}</td>
                <td className="n m">{fmt(r.actual)}</td>
                <td className="n"><Pc m={r.bekidoritsu} k="beki" s={s} /></td>
                <td className="n m fa">{fmt(r.calendarMinutes)}</td>
                <td className="n m">{fmt(r.plannedMinutes)}</td>
                <td className="n m">{fmt(r.stopMinutes)}</td>
                <td className="n m">{fmt(r.runningMinutes)}</td>
                <td className="n"><Pc m={r.kikai} k="kikai" s={s} /></td>
                <td className="n"><Pc m={r.sogo} k="sogo" s={s} /></td>
                <td className="n"><Pc m={r.shugyo} k="shugyo" s={s} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note" style={{ marginTop: 'var(--s-size-12)' }}>
        <b>Bekidoritsu</b> = Production actual ÷ Production plan × 100 · <b>Kikai</b> = (Planned − Stop) ÷ Planned · <b>Sogo</b> = (Planned − Stop) ÷ Calendar · <b>Shugyo</b> = Planned ÷ Calendar. Stop = loss stops only (info-only excluded). Calendar minutes are set in Settings. Rumus disetujui owner 2026-11-07.
      </div>
    </Modal>
  );
}
