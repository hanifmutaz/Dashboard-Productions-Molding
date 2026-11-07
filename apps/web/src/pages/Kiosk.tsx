import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiFailure, api } from '../lib/api';
import { useSession } from '../lib/session';
import { MachineDashboard } from '../features/machine-detail/MachineDetail';
import { AuthFrame } from './Auth';

/** /kiosk: pairing screen, then the read-only Machine Detail locked to the paired machine (ADR-019). */
export function KioskPage() {
  const { me, settings } = useSession();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const pair = useMutation({ mutationFn: () => api.post('/api/kiosk/pair', { code }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }) });
  const isKiosk = me?.kind === 'kiosk';
  useEffect(() => {
    document.body.classList.toggle('md-on', isKiosk);
    document.body.classList.toggle('md-ipad', isKiosk);
  }, [isKiosk]);
  if (me?.kind === 'kiosk') {
    return (
      <section className="view on" id="v-detail">
        <MachineDashboard machineNo={me.kiosk.machineNo} date={date} settings={settings} ipad locked onDate={setDate} />
      </section>
    );
  }
  return (
    <AuthFrame>
      <form className="cb" onSubmit={(e) => { e.preventDefault(); pair.mutate(); }} aria-label="Pair kiosk">
        <h3 className="authh">Pair this iPad</h3>
        <p className="mu">Masukkan kode pairing dari admin (menu Kiosks). Perangkat akan terkunci ke satu mesin dan hanya menampilkan Machine Detail.</p>
        <div className="fld"><label htmlFor="kc">Pairing code</label><input id="kc" className="mono" autoCapitalize="characters" autoComplete="one-time-code" placeholder="ABCD-EFGH" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required /></div>
        {pair.error && <div className="banner e" role="alert">{pair.error instanceof ApiFailure ? pair.error.message : 'Pairing gagal.'}</div>}
        <button className="btn pri" type="submit" disabled={pair.isPending || code.replace('-', '').length !== 8}>Pair device</button>
      </form>
    </AuthFrame>
  );
}
