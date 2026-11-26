import type pg from 'pg';
import type { SourceRecord } from './source.js';
export type Candidate={rec:SourceRecord;rev:number};
export type RecordPolicy={work_date:string;machine_no:string;shift:string;observed_ids:string[];selected_ids:string[]};
export type ReviewGroup={date:string;machineNo:string;shift:string;observedIds:string[];selectedIds:string[];state:'pending'|'approved'|'changed';records:{recordId:string;revision:number;dpNo:string|null;poNo:string|null;plan:number|null;actual:number|null;plannedMinutes:number|null;updatedAt:string|null}[]};
const key=(r:{date:string;machineNo:string;shift:string})=>JSON.stringify([r.date,r.machineNo,r.shift]);
const equal=(a:string[],b:string[])=>JSON.stringify([...new Set(a)].sort())===JSON.stringify([...new Set(b)].sort());
function newest(a:Candidate,b:Candidate):Candidate{
 const stamp=(r:SourceRecord)=>{const n=Date.parse(r.updatedAt??'');return Number.isFinite(n)?n:-Infinity;};
 return b.rev>a.rev||(b.rev===a.rev&&(stamp(b.rec)>stamp(a.rec)||(stamp(b.rec)===stamp(a.rec)&&b.rec.recordId>a.rec.recordId)))?b:a;
}
/** Keep latest as default. Add only explicitly approved IDs while the observed ID set is unchanged. */
export function applyRecordPolicies(rows:Candidate[],policies:readonly RecordPolicy[],fallback:(rows:Candidate[])=>{records:SourceRecord[];dropped:number;ambiguousGroups:number}){
 const groups=new Map<string,Candidate[]>(), policy=new Map(policies.map(p=>[key({date:p.work_date,machineNo:p.machine_no,shift:p.shift}),p]));
 for(const r of rows){const k=key(r.rec),g=groups.get(k);if(g)g.push(r);else groups.set(k,[r]);}
 const normal:Candidate[]=[],approved:SourceRecord[]=[],reviewGroups:ReviewGroup[]=[];
 let approvedGroups=0;
 for(const [k,list] of groups){
  const byId=new Map<string,Candidate>();for(const c of list){const old=byId.get(c.rec.recordId);byId.set(c.rec.recordId,old?newest(old,c):c);}
  const ids=[...byId.keys()].sort(),p=policy.get(k),selected=p?.selected_ids??[];
  const valid=!!p&&Array.isArray(p.observed_ids)&&Array.isArray(selected)&&selected.length>=2&&selected.length<=50&&new Set(selected).size===selected.length&&equal(ids,p.observed_ids)&&selected.every(id=>!!id&&byId.has(id));
  if(valid){approved.push(...selected.map(id=>byId.get(id)!.rec));approvedGroups++;}else normal.push(...list);
  if(ids.length>1||p){const r=list[0]!.rec;reviewGroups.push({date:r.date,machineNo:r.machineNo,shift:r.shift,observedIds:ids,selectedIds:selected,state:valid?'approved':p?'changed':'pending',records:[...byId.values()].map(c=>({recordId:c.rec.recordId,revision:c.rev,dpNo:c.rec.dpNo,poNo:c.rec.poNo,plan:c.rec.plan,actual:c.rec.actual,plannedMinutes:c.rec.plannedMinutes,updatedAt:c.rec.updatedAt}))});}
 }
 const base=fallback(normal);const records=[...base.records,...approved];
 return {records,dropped:rows.length-records.length,ambiguousGroups:base.ambiguousGroups,approvedGroups,reviewGroups:reviewGroups.slice(0,100)};
}
export async function loadRecordPolicies(pool:pg.Pool,from:string,to:string,machine?:string):Promise<RecordPolicy[]>{
 const r=await pool.query<RecordPolicy>('SELECT work_date::text,machine_no,shift,observed_ids,selected_ids FROM md_production_record_policy WHERE work_date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR machine_no=$3)',[from,to,machine??null]);return r.rows;
}
