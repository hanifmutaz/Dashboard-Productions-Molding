import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS } from '@mpd/contracts';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { downloadCsv } from '../components/table';
import { downloadXlsx } from '../lib/xlsx';
type Cell=string|number|boolean|null;
type Row=Record<string,unknown>;
function displayCell(value: unknown): string {
 if (value == null) return '—';
 if (typeof value === 'string') return value;
 if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
 return JSON.stringify(value) ?? '—';
}
function Table({rows}:{rows:Row[]}){
 const keys=Object.keys(rows[0]??{});
 return <div className="tw"><table><thead><tr>{keys.map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{keys.map(k=><td key={k}>{displayCell(r[k])}</td>)}</tr>)}</tbody></table>{!rows.length&&<p className="empty">Tidak ada data</p>}</div>;
}
export function CompletionMaster(){
 const {can}=useSession(),edit=can(PERMISSIONS.editMasterData);
 const q=useQuery({queryKey:['operations-completion'],queryFn:()=>api.get<{mapping:Row[];prices:Row[];shifts:Row[]}>('/api/operations/completion'),enabled:can(PERMISSIONS.viewMasterData)});
 const [tab,setTab]=useState<'prices'|'mapping'|'shifts'>('prices');
 const [kind,setKind]=useState('part'),[key,setKey]=useState(''),[value,setValue]=useState(''),[date,setDate]=useState(''),[shift,setShift]=useState('1'),[dayType,setDayType]=useState('working'),[note,setNote]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function save(){setBusy(true);setMessage('');try{
  if(tab==='prices')await api.put('/api/operations/effective-price',{kind,key,date,price:value===''?null:Number(value)});
  else if(tab==='mapping')await api.put('/api/operations/material-mapping',{part:key,material:value.trim()||null,date});
  else await api.put('/api/operations/shift-calendar',{date,shift,dayType,minutes:dayType==='holiday'?0:Number(value),note});
  await q.refetch();setMessage('Tersimpan');
 }catch(e){setMessage(String(e));}finally{setBusy(false);}}
 return <section className="card"><div className="ch"><h3>Effective pricing, material history &amp; shift calendar</h3></div><div className="cb"><div className="filters">{(['prices','mapping','shifts'] as const).map(t=><button className={'btn '+(tab===t?'pri':'')} key={t} onClick={()=>{setTab(t);setValue('');setMessage('');}}>{t}</button>)}</div>
 {edit&&<form onSubmit={e=>{e.preventDefault();void save();}}><div className="filters"><label>Effective date <input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
 {tab==='prices'?<><label>Type <select value={kind} onChange={e=>setKind(e.target.value)}><option>part</option><option>material</option></select></label><label>Master code <input required maxLength={100} value={key} onChange={e=>setKey(e.target.value)}/></label><label>Price (blank clears) <input type="number" step="any" min="0" value={value} onChange={e=>setValue(e.target.value)}/></label></>:tab==='mapping'?<><label>DP No <input required value={key} onChange={e=>setKey(e.target.value)}/></label><label>Material code (blank clears) <input value={value} onChange={e=>setValue(e.target.value)}/></label></>:<><label>Shift <select value={shift} onChange={e=>setShift(e.target.value)}>{['1','2','3'].map(x=><option key={x}>{x}</option>)}</select></label><label>Type <select value={dayType} onChange={e=>setDayType(e.target.value)}>{['working','holiday','overtime'].map(x=><option key={x}>{x}</option>)}</select></label><label>Scheduled minutes <input required={dayType!=='holiday'} disabled={dayType==='holiday'} type="number" min="0" max="1440" value={dayType==='holiday'?'0':value} onChange={e=>setValue(e.target.value)}/></label><label>Note <input maxLength={200} value={note} onChange={e=>setNote(e.target.value)}/></label></>}
 <button className="btn pri" disabled={busy}>Save event</button></div></form>}
 <p className="note">Harga dan mapping efektif merupakan event valuasi historis, tidak mengubah nilai master saat ini. Data sebelum baseline tidak ditebak. Jadwal shift harus lengkap sebelum dapat digunakan untuk denominator jadwal.</p><p role="status">{message}</p>{q.isError&&<p role="alert">{String(q.error)}</p>}<Table rows={q.data?.[tab]??[]}/></div></section>;
}
const stopFields=['date','machineNo','shift','dpNo','productName','poNo','category','categoryId','group','detail','minutes','infoOnly'];
export function StopReportBuilder(){
 const {can}=useSession();const allowed=can(PERMISSIONS.viewStopTime)&&can(PERMISSIONS.exportProduction);
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[shift,setShift]=useState(''),[machine,setMachine]=useState(''),[product,setProduct]=useState(''),[category,setCategory]=useState(''),[detail,setDetail]=useState(''),[min,setMin]=useState('0'),[info,setInfo]=useState(false),[cols,setCols]=useState(stopFields),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[rows,setRows]=useState<Row[]>([]);
 async function run(format:'preview'|'csv'|'xlsx'){setBusy(true);setRows([]);setMessage('');try{const r=await api.post<{columns:string[];rows:Cell[][];total:number;invalid:number;duplicates:number}>('/api/operations/stop-report',{range:{from,to,...(shift?{shift}:{})},columns:cols,machine,product,category,detail,minMinutes:Number(min),includeInfo:info,download:format!=='preview'});
 const data=r.rows.map(row=>row.map(v=>typeof v==='boolean'?String(v):v));setRows(data.slice(0,100).map(row=>Object.fromEntries(r.columns.map((k,i)=>[k,row[i]??null]))));setMessage(`${r.total} rows · ${r.invalid} invalid · ${r.duplicates} revisions excluded`);
 if(format==='csv')downloadCsv(`stop_time_${from}_${to}.csv`,[r.columns,...data.map(row=>row.map(v=>typeof v==='string'&&/^\s*[=+@-]/.test(v)?"'"+v:v))]);if(format==='xlsx')downloadXlsx(`stop_time_${from}_${to}.xlsx`,[r.columns,...data]);
 }catch(e){setMessage(String(e));}finally{setBusy(false);}}
 if(!allowed)return null;
 return <section className="card"><div className="ch"><h3>Stop Time Report Builder</h3></div><div className="cb"><div className="filters"><label>From <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To <input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><label>Shift <select value={shift} onChange={e=>setShift(e.target.value)}><option value="">All</option>{['1','2','3'].map(s=><option key={s}>{s}</option>)}</select></label><label>Machine <input value={machine} onChange={e=>setMachine(e.target.value)}/></label><label>Product <input value={product} onChange={e=>setProduct(e.target.value)}/></label><label>Category <input value={category} onChange={e=>setCategory(e.target.value)}/></label><label>Detail <input value={detail} onChange={e=>setDetail(e.target.value)}/></label><label>Minimum minutes <input type="number" min="0" value={min} onChange={e=>setMin(e.target.value)}/></label><label><input type="checkbox" checked={info} onChange={e=>setInfo(e.target.checked)}/> Include info-only</label></div><div className="filters">{stopFields.map(k=><label key={k}><input type="checkbox" checked={cols.includes(k)} onChange={e=>setCols(c=>e.target.checked?[...c,k]:c.filter(x=>x!==k))}/>{k}</label>)}</div><div className="filters">{(['preview','csv','xlsx'] as const).map(f=><button className="btn" key={f} disabled={busy||!from||!to||!cols.length} onClick={()=>void run(f)}>{f}</button>)}</div><p role="status">{message}</p><Table rows={rows}/></div></section>;
}
export function QualityHistory(){
 const {can}=useSession(),allowed=can(PERMISSIONS.viewProduction),edit=can(PERMISSIONS.editMasterData);
 const q=useQuery({queryKey:['quality-history'],queryFn:()=>api.get<Row[]>('/api/operations/quality-history'),enabled:allowed});
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[id,setId]=useState(''),[status,setStatus]=useState('reviewed'),[note,setNote]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function act(review:boolean){setBusy(true);try{if(review)await api.put('/api/operations/quality-history',{id,status,note});else await api.post('/api/operations/quality-history',{from,to});await q.refetch();setMessage('Tersimpan');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 if(!allowed)return null;
 const history:Row[]=(q.data??[]).map(r=>{const {metrics,...meta}=r;return {...meta,...(typeof metrics==='object'&&metrics!==null?metrics:{})};});
 const scoped=from&&to?history.filter(r=>r.date_from===from&&r.date_to===to):history;
 return <section className="card"><div className="ch"><h3>Data quality history &amp; review</h3></div><div className="cb"><div className="filters"><label>From <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To <input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><button className="btn" disabled={busy||!from||!to} onClick={()=>void act(false)}>Capture quality</button></div>{edit&&<div className="filters"><label>Review ID <input value={id} onChange={e=>setId(e.target.value)}/></label><label>Status <select value={status} onChange={e=>setStatus(e.target.value)}><option>open</option><option>reviewed</option><option>resolved</option></select></label><label>Note <input maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="btn" disabled={busy||!id||!note.trim()} onClick={()=>void act(true)}>Save review</button></div>}<p className="note">Review tidak mengubah data ConMas. Snapshot adalah hasil capture manual untuk periode terpilih.</p><p role="status">{message}</p>{q.isError&&<p role="alert">{String(q.error)}</p>}<p>{scoped.length} snapshots · {scoped.filter(r=>r.status==='open').length} open reviews</p><Table rows={scoped}/></div></section>;
}

export function RecordReview(){
 const {can}=useSession(),edit=can(PERMISSIONS.editMasterData),allowed=can(PERMISSIONS.viewProduction);
 const [date,setDate]=useState(''),[machine,setMachine]=useState(''),[shift,setShift]=useState('1'),[selected,setSelected]=useState(''),[note,setNote]=useState(''),[message,setMessage]=useState(''),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false);
 async function inspect(){setBusy(true);setRows([]);try{setRows(await api.get<Row[]>('/api/operations/record-review?'+new URLSearchParams({date,machine}).toString()));setMessage('Review source candidates');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 async function save(clear:boolean){setBusy(true);try{await api.put('/api/operations/record-review',{date,machine,shift,selected:clear?[]:selected.split(',').map(x=>x.trim()).filter(Boolean),note});setRows([]);setMessage('Policy saved; inspect again.');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 if(!allowed)return null;
 return <section className="card"><div className="ch"><h3>Multiple production record review</h3></div><div className="cb"><p className="note">Default: highest revision per shift. Approve additive IDs only after verifying that the records are independent, non-overlapping production and time. If the observed ID set changes, the policy falls back to the original latest-record rule.</p><div className="filters"><label>Date <input type="date" value={date} onChange={e=>{setDate(e.target.value);setRows([]);}}/></label><label>Machine <input value={machine} onChange={e=>{setMachine(e.target.value);setRows([]);}}/></label><button className="btn" disabled={busy||!date||!machine} onClick={()=>void inspect()}>Inspect source</button></div><Table rows={rows}/>{edit&&<div className="filters"><label>Shift <select value={shift} onChange={e=>setShift(e.target.value)}>{['1','2','3'].map(s=><option key={s}>{s}</option>)}</select></label><label>Independent record IDs (comma separated) <input value={selected} onChange={e=>setSelected(e.target.value)}/></label><label>Verification note <input maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="btn pri" disabled={busy||!date||!machine||!selected.trim()||!note.trim()} onClick={()=>void save(false)}>Approve additive records</button><button className="btn" disabled={busy||!date||!machine||!note.trim()} onClick={()=>void save(true)}>Reset to latest</button></div>}<p role="status">{message}</p></div></section>;
}
