import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS } from '@mpd/contracts';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

type Monitor = { count:number; errors:number; clientErrors:number; avgMs:number|null; p95Ms:number|null; uptimeSeconds:number; rssMb:number; heapMb:number; backup:{state:string; evidence:{backupAt:string|null; restoreTestAt:string|null; restorePassed:boolean|null; backupSha256:string|null}|null} };
const stamp = (s:string|null|undefined) => s ? new Date(s).toLocaleString('id-ID') : 'Belum tercatat';
export function SystemMonitorPanel() {
  const { can } = useSession();
  const allowed = can(PERMISSIONS.viewSettings);
  const q = useQuery({queryKey:['system-monitor'], queryFn:({signal})=>api.get<Monitor>('/api/system/monitor',signal), enabled:allowed, retry:false, refetchInterval:60_000});
  const history=useQuery({queryKey:['system-performance-history'],queryFn:()=>api.get<{bucket:string;metrics:{count:number;avgMs:number|null;p95Ms:number|null;errors:number;rssMb:number}}[]>('/api/system/performance-history'),enabled:allowed,refetchInterval:60_000,retry:false});
  if (!allowed) return null;
  const m=q.data;
  return <section className="card system-status"><div className="ch"><div><h3>System performance &amp; backup</h3><p>500 request API terakhir sejak server dimulai · refresh setiap 60 detik</p></div><button className="btn" disabled={q.isFetching} onClick={()=>void q.refetch()}>Refresh</button></div><div className="cb">
    {q.isError&&<p role="alert">Monitoring tidak tersedia. {String(q.error)}</p>}
    {q.isPending&&<p role="status">Memuat…</p>}
    {m&&<><dl className="system-status-list">
      {[[ 'Request',m.count],['Server error (5xx)',m.errors],['Client error (4xx)',m.clientErrors],['Average latency',m.avgMs===null?'—':m.avgMs+' ms'],['P95 latency',m.p95Ms===null?'—':m.p95Ms+' ms'],['Uptime',Math.floor(m.uptimeSeconds/60)+' min'],['Process RSS',m.rssMb+' MB'],['Heap used',m.heapMb+' MB']].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl><h3>Backup &amp; restore evidence</h3><dl className="system-status-list"><div><dt>Evidence status</dt><dd>{m.backup.state}</dd></div><div><dt>Backup terakhir</dt><dd>{stamp(m.backup.evidence?.backupAt)}</dd></div><div><dt>Restore test terakhir</dt><dd>{stamp(m.backup.evidence?.restoreTestAt)}</dd></div><div><dt>Hasil restore test</dt><dd>{m.backup.evidence?.restorePassed===true?'Reported PASS':m.backup.evidence?.restorePassed===false?'Reported FAIL':'Belum tercatat'}</dd></div></dl><p className="note">Status berdasarkan bukti yang dicatat operator backup, bukan pemeriksaan restore otomatis. Statistik live direset saat restart; snapshot traffic lima menit disimpan di DB aplikasi.</p></>}
    <h3>Performance history (latest 288 samples)</h3>{history.isError&&<p role="alert">History unavailable</p>}<div className="tw"><table><thead><tr><th>Time</th><th>Sample size</th><th>Average ms</th><th>P95 ms</th><th>5xx</th><th>RSS MB</th></tr></thead><tbody>{history.data?.map(h=><tr key={h.bucket}><td>{stamp(h.bucket)}</td><td>{h.metrics.count}</td><td>{h.metrics.avgMs??'—'}</td><td>{h.metrics.p95Ms??'—'}</td><td>{h.metrics.errors}</td><td>{h.metrics.rssMb}</td></tr>)}</tbody></table></div>
  </div></section>;
}
