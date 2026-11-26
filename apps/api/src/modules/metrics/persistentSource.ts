import type pg from 'pg';
import { SourceUnavailable,type ConmasSource,type SourceResult } from '../conmas/source.js';
export type SnapshotResult=SourceResult & {snapshotAt?:string};
/** Exact range only, no fallback on schema drift, no personnel data persisted. */
export async function readMonitoringRecords(source:ConmasSource,pool:pg.Pool|undefined,from:string,to:string,machine?:string):Promise<SnapshotResult>{
 if(!pool||process.env.MPD_PERSISTENT_SNAPSHOT!=='true')return source.records(from,to,machine);
 const scope=JSON.stringify([1,from,to,machine??null]);
 try{
  const data=await source.records(from,to,machine);
  if(data.records.length<=10000){
   const payload=JSON.stringify({invalidRows:data.invalidRows,duplicatesDropped:data.duplicatesDropped,ambiguousGroups:data.ambiguousGroups,approvedGroups:data.approvedGroups,records:data.records.map(r=>({...r,personnel:{leader:null,cell:null,technician:null,operator:null},personnelNames:undefined}))});
   if(Buffer.byteLength(payload)<=4*1024*1024){
    const result=await pool.query('INSERT INTO md_source_snapshot(scope,payload) VALUES($1,$2::jsonb) ON CONFLICT(scope) DO UPDATE SET payload=EXCLUDED.payload,captured_at=now() WHERE md_source_snapshot.captured_at<now()-interval \'5 minutes\'',[scope,payload]).catch(()=>null);
    if(result?.rowCount)await pool.query("DELETE FROM md_source_snapshot WHERE captured_at<now()-interval '7 days' OR scope IN (SELECT scope FROM md_source_snapshot ORDER BY captured_at DESC,scope OFFSET 50)").catch(()=>undefined);
   }
  }
  return data;
 }catch(e){
  if(!(e instanceof SourceUnavailable)||!['CONMAS_UNREACHABLE','CONMAS_QUERY_FAILED'].includes(e.code))throw e;
  const result=await pool.query<{payload:SourceResult;captured_at:Date}>('SELECT payload,captured_at FROM md_source_snapshot WHERE scope=$1 AND captured_at>=now()-interval \'7 days\'',[scope]).catch(()=>null);
  const row=result?.rows[0];if(!row||!Array.isArray(row.payload.records)||!row.payload.records.length)throw e;
  return {...row.payload,snapshotAt:new Date(row.captured_at).toISOString()};
 }
}
export type LifecycleEvent={machine_no:string;effective_date:string;active:boolean};
export function machineLifecycle(events:readonly LifecycleEvent[]){
 const byMachine=new Map<string,LifecycleEvent[]>();
 for(const e of events){const list=byMachine.get(e.machine_no);if(list)list.push(e);else byMachine.set(e.machine_no,[e]);}
 return (machine:string,date:string)=>{let active=true;for(const e of byMachine.get(machine)??[]){if(e.effective_date>date)break;active=e.active;}return active;};
}
export async function loadLifecycle(pool:pg.Pool|undefined,to:string){
 const rows=pool?(await pool.query<LifecycleEvent>('SELECT machine_no,effective_date::text,active FROM md_machine_lifecycle WHERE effective_date <= $1::date ORDER BY effective_date,id',[to])).rows:[];
 return machineLifecycle(rows);
}
export async function lifecycleFilter<T extends SourceResult>(pool:pg.Pool|undefined,rows:T,to:string):Promise<T>{
 if(!pool)return rows;const active=await loadLifecycle(pool,to);return {...rows,records:rows.records.filter(r=>active(r.machineNo,r.date))};
}
