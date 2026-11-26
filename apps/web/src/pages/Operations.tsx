import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS } from '@mpd/contracts';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { downloadCsv } from '../components/table';
import { downloadXlsx } from '../lib/xlsx';
import { CompletionMaster, StopReportBuilder, QualityHistory, RecordReview } from './OperationsCompletion';

type Cell = string | number | boolean | null;
type Row = Record<string,Cell>;
function Grid({rows}:{rows:Row[]}) {
  const keys=Object.keys(rows[0]??{});
  return <div className="tw"><table><thead><tr>{keys.map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{keys.map(k=><td key={k}>{String(r[k]??'—')}</td>)}</tr>)}</tbody></table>{!rows.length&&<p className="empty">Tidak ada data</p>}</div>;
}
export function OperationsPage(){
  const {can}=useSession();
  const q=useQuery({queryKey:['operations-master'],queryFn:()=>api.get<{machines:Row[];prices:Row[];calendar:Row[]}>('/api/operations/master')});
  const [tab,setTab]=useState<'machines'|'prices'|'calendar'>('machines');
  const [date,setDate]=useState(''); const [dayType,setDayType]=useState('working'); const [minutes,setMinutes]=useState(''); const [note,setNote]=useState('');
  const [machine,setMachine]=useState('');const [label,setLabel]=useState('');const [active,setActive]=useState(true);
  const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  async function save(){setBusy(true);setMessage('');try{if(tab==='calendar')await api.put('/api/operations/calendar',{date,dayType,minutes:minutes===''?null:Number(minutes),note});else await api.put('/api/operations/machines',{machineNo:machine,label,active});await q.refetch();setMessage('Tersimpan');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  return <section className="view on"><div className="content"><div className="card"><div className="ch"><h3>Operations Master</h3></div><div className="cb">
    <div className="filters">{(['machines','prices','calendar'] as const).map(t=><button className={'btn '+(t===tab?'pri':'')} key={t} onClick={()=>setTab(t)}>{t}</button>)}<button className="btn" onClick={()=>void q.refetch()}>Refresh</button></div>
    {q.isError&&<p role="alert">{String(q.error)}</p>}{q.isPending&&<p>Memuat…</p>}
    {can(PERMISSIONS.editMasterData)&&tab!=='prices'&&<form onSubmit={e=>{e.preventDefault();void save();}}><div className="filters">
    {tab==='machines'?<><label>Machine <select required value={machine} onChange={e=>{const m=q.data?.machines.find(x=>x.machine_no===e.target.value);setMachine(e.target.value);setLabel(String(m?.label??''));setActive(m?.active!==false);}}><option value="">Select</option>{q.data?.machines.map(m=><option key={String(m.machine_no)}>{String(m.machine_no)}</option>)}</select></label><label>Label <input value={label} onChange={e=>setLabel(e.target.value)}/></label><label><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Active</label></>:<><label>Date <input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Type <select value={dayType} onChange={e=>setDayType(e.target.value)}><option>working</option><option>holiday</option><option>overtime</option></select></label><label>Minutes <input type="number" min="0" max="1440" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label><label>Note <input maxLength={200} value={note} onChange={e=>setNote(e.target.value)}/></label></>}
    <button className="btn pri" disabled={busy}>Save</button></div></form>}
    <p role="status">{message}</p><Grid rows={q.data?.[tab]??[]}/><p className="note">Calendar overrides and machine status are administrative metadata; existing KPI formulas are unchanged. Price history shows recorded changes; effective valuation events are managed below.</p>
  </div></div><CompletionMaster/><QualityHistory/><RecordReview/></div></section>;
}
const fields=['date','machineNo','shift','dpNo','productName','plan','actual','gross','ngQty','ngGram','plannedMinutes','oee','availability','performance','updatedAt'];
type Report={columns:string[];rows:(string|number|null)[][];total:number;invalid:number;duplicates:number};
export function ExportPage(){
 const {can}=useSession();const [from,setFrom]=useState('');const [to,setTo]=useState('');const [shift,setShift]=useState('');const [machine,setMachine]=useState('');const [product,setProduct]=useState('');const [cols,setCols]=useState(fields.slice(0,7));const [name,setName]=useState('');const [report,setReport]=useState<Report|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 const allowed=can(PERMISSIONS.viewProduction)&&can(PERMISSIONS.exportProduction);
 const saved=useQuery({queryKey:['operations-templates'],queryFn:()=>api.get<{templates:{name:string;columns:string[]}[];history:Row[]}>('/api/operations/templates'),enabled:allowed});
 const range={from,to,...(shift?{shift}:{})};
 async function run(download:boolean, format: 'csv' | 'xlsx' = 'csv'){setBusy(true);setMessage('');setReport(null);try{const r=await api.post<Report>('/api/operations/report',{range,columns:cols,machine,product,download});setReport(r);if(download){if(format==='xlsx') downloadXlsx(`molding_${from}_${to}.xlsx`,[r.columns,...r.rows]);else downloadCsv(`molding_${from}_${to}.csv`,[r.columns,...r.rows]);void saved.refetch();}}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 async function quality(){setBusy(true);try{const r=await api.get<Record<string,unknown>>('/api/operations/quality?'+qs(range));setMessage(JSON.stringify(r));}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 async function save(){setBusy(true);try{await api.put('/api/operations/templates',{name,columns:cols});await saved.refetch();setMessage('Template saved');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 if(!allowed)return <div className="empty">Tidak memiliki hak akses laporan produksi.</div>;
 return <section className="view on"><div className="content"><div className="card"><div className="ch"><h3>Production Report Builder</h3></div><div className="cb"><div className="filters"><label>From <input type="date" value={from} onChange={e=>{setFrom(e.target.value);setReport(null);}}/></label><label>To <input type="date" value={to} onChange={e=>{setTo(e.target.value);setReport(null);}}/></label><label>Shift <select value={shift} onChange={e=>{setShift(e.target.value);setReport(null);}}><option value="">All</option>{['1','2','3'].map(s=><option key={s}>{s}</option>)}</select></label><label>Machine <input value={machine} onChange={e=>{setMachine(e.target.value);setReport(null);}}/></label><label>Product <input value={product} onChange={e=>{setProduct(e.target.value);setReport(null);}}/></label></div>
 <p>Columns (selection order determines export order)</p><div className="filters">{fields.map(k=><label key={k}><input type="checkbox" checked={cols.includes(k)} onChange={e=>{setCols(c=>e.target.checked?[...c,k]:c.filter(x=>x!==k));setReport(null);}}/>{k}</label>)}</div><ol aria-label="Column order">{cols.map((k,i)=><li key={k}>{k} <button type="button" className="btn" aria-label={'Move '+k+' up'} disabled={busy||i===0} onClick={()=>{setCols(c=>{const next=[...c];[next[i-1],next[i]]=[next[i]!,next[i-1]!];return next;});setReport(null);}}>↑</button> <button type="button" className="btn" aria-label={'Move '+k+' down'} disabled={busy||i===cols.length-1} onClick={()=>{setCols(c=>{const next=[...c];[next[i+1],next[i]]=[next[i]!,next[i+1]!];return next;});setReport(null);}}>↓</button></li>)}</ol>
 <div className="filters"><button className="btn" onClick={()=>{setCols(fields.slice(0,7));setReport(null);}}>Standard report</button><input placeholder="Template name" value={name} onChange={e=>setName(e.target.value)}/><button className="btn" disabled={busy||!name.trim()||!cols.length} onClick={()=>void save()}>Save template</button><select aria-label="Saved templates" value="" onChange={e=>{const t=saved.data?.templates.find(x=>x.name===e.target.value);if(t){setCols(t.columns);setName(t.name);setReport(null);}}}><option value="">Load template</option>{saved.data?.templates.map(t=><option key={t.name}>{t.name}</option>)}</select></div>
 <div className="filters"><button className="btn" disabled={busy||!from||!to||!cols.length} onClick={()=>void run(false)}>Preview</button><button className="btn pri" disabled={busy||!from||!to||!cols.length} onClick={()=>void run(true)}>Export CSV</button><button className="btn pri" disabled={busy||!from||!to||!cols.length} onClick={()=>void run(true,'xlsx')}>Export Excel</button><button className="btn" disabled={busy||!from||!to} onClick={()=>void quality()}>Data quality</button></div><p role="status">{message}</p><p className="note">Raw production records; timestamps included when selected. Preview limited to 100 rows. Data can be delayed.</p>{report&&<><p>{report.total} rows · {report.invalid} invalid · {report.duplicates} duplicates dropped</p><Grid rows={report.rows.slice(0,100).map(row=>Object.fromEntries(report.columns.map((k,i)=>[k,row[i]??null])))}/></>}
 </div></div><div className="card"><div className="ch"><h3>Export history</h3></div><div className="cb"><Grid rows={saved.data?.history??[]}/></div></div><StopReportBuilder/><QualityHistory/></div></section>;
}
