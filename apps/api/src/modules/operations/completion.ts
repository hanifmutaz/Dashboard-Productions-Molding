import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { IsoDate, PERMISSIONS, RangeQuerySchema } from '@mpd/contracts';
import { parse, requirePermission, userOf, type Audit } from '../../http/middleware.js';
import { HttpError } from '../../http/errors.js';
import type { ConmasSource } from '../conmas/source.js';
import { categoryResolver } from '../metrics/categories.js';
import { eventsOf } from '../metrics/views.js';
import type { Repos } from '../../db/repos.js';
const code=z.string().trim().min(1).max(100);
const shift=z.enum(['1','2','3']);
const stopFields=['date','machineNo','shift','dpNo','productName','poNo','category','categoryId','group','detail','minutes','infoOnly'] as const;
const columns=z.array(z.enum(stopFields)).min(1).max(stopFields.length).refine(x=>new Set(x).size===x.length);
export function completionRoutes(pool:pg.Pool,source:ConmasSource,audit:Audit,repos:Repos):Router {
 const r=Router(), master=requirePermission(PERMISSIONS.viewMasterData), edit=requirePermission(PERMISSIONS.editMasterData), view=requirePermission(PERMISSIONS.viewProduction);
 r.get('/operations/completion',master,async(_req,res)=>{
  const [mapping,prices,shifts]=await Promise.all([
   pool.query('SELECT id::text,dp_no,material_code,effective_date::text,changed_at FROM md_part_material_history ORDER BY effective_date DESC,id DESC LIMIT 500'),
   pool.query('SELECT id::text,entity_type,entity_key,new_price,effective_date::text,changed_at FROM md_price_history ORDER BY changed_at DESC,id DESC LIMIT 500'),
   pool.query('SELECT work_date::text,shift,day_type,planned_minutes,note FROM md_shift_calendar ORDER BY work_date DESC,shift LIMIT 1000')]);
  res.json({mapping:mapping.rows,prices:prices.rows,shifts:shifts.rows});
 });
 r.put('/operations/effective-price',edit,async(req,res)=>{
  const b=parse(z.object({kind:z.enum(['part','material']),key:code,date:IsoDate,price:z.number().finite().min(0).max(9999999999).nullable()}),req.body);
  if(b.kind==='material'&&b.price===0)throw new HttpError(400,'BAD_REQUEST','Harga material harus lebih besar dari nol.');
  const found=b.kind==='part'?await pool.query<{key:string}>('SELECT dp_no AS key FROM md_part WHERE dp_no=$1',[b.key]):await pool.query<{key:string}>('SELECT code AS key FROM md_material WHERE code=$1',[b.key]);
  if(!found.rowCount)throw new HttpError(404,'NOT_FOUND','Master tidak ditemukan.');
  await pool.query('INSERT INTO md_price_history(entity_type,entity_key,new_price,effective_date,changed_by) VALUES($1,$2,$3,$4,$5)',[b.kind,found.rows[0]!.key,b.price,b.date,userOf(req).id]);
  await audit(req,{action:'masterdata.price.effective',result:'success',objectType:'md_price_history',objectId:b.key,after:b});res.json({ok:true});
 });
 r.put('/operations/material-mapping',edit,async(req,res)=>{
  const b=parse(z.object({part:code,material:code.nullable(),date:IsoDate}),req.body);
  const part=await pool.query('SELECT 1 FROM md_part WHERE dp_no=$1',[b.part]);
  const material=b.material===null?true:!!(await pool.query('SELECT 1 FROM md_material WHERE code=$1',[b.material])).rowCount;
  if(!part.rowCount||!material)throw new HttpError(404,'NOT_FOUND','Part atau material tidak ditemukan.');
  await pool.query('INSERT INTO md_part_material_history(dp_no,material_code,effective_date,changed_by) VALUES($1,$2,$3,$4)',[b.part,b.material,b.date,userOf(req).id]);
  await audit(req,{action:'masterdata.mapping.effective',result:'success',objectType:'md_part_material_history',objectId:b.part,after:b});res.json({ok:true});
 });
 r.put('/operations/shift-calendar',edit,async(req,res)=>{
  const b=parse(z.object({date:IsoDate,shift,dayType:z.enum(['working','holiday','overtime']),minutes:z.number().int().min(0).max(1440),note:z.string().max(200)}),req.body);
  if(b.dayType==='holiday'&&b.minutes!==0)throw new HttpError(400,'BAD_REQUEST','Shift libur harus 0 menit.');
  await pool.query(`INSERT INTO md_shift_calendar(work_date,shift,day_type,planned_minutes,note,updated_by) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(work_date,shift) DO UPDATE SET day_type=EXCLUDED.day_type,planned_minutes=EXCLUDED.planned_minutes,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=now()`,[b.date,b.shift,b.dayType,b.minutes,b.note,userOf(req).id]);
  await audit(req,{action:'masterdata.calendar.shift',result:'success',objectType:'md_shift_calendar',objectId:b.date+':'+b.shift,after:b});res.json({ok:true});
 });
 r.post('/operations/stop-report',requirePermission(PERMISSIONS.viewStopTime),requirePermission(PERMISSIONS.exportProduction),async(req,res)=>{
  const b=parse(z.object({range:RangeQuerySchema,columns,machine:z.string().max(20),product:z.string().max(100),category:z.string().max(100),detail:z.string().max(200),minMinutes:z.number().min(0),includeInfo:z.boolean(),download:z.boolean()}),req.body);
  const [data,cats]=await Promise.all([source.records(b.range.from,b.range.to,b.machine||undefined),repos.master.categories()]);
  const {resolve}=categoryResolver(cats);
  const rows=data.records.filter(x=>(!b.range.shift||x.shift===b.range.shift)&&(!b.product||`${x.dpNo??''} ${x.productName??''}`.toLowerCase().includes(b.product.toLowerCase()))).flatMap(x=>{
   const e=eventsOf(x,resolve);return [...e.loss,...(b.includeInfo?e.info:[])].map(ev=>({date:ev.date,machineNo:ev.machineNo,shift:ev.shift,dpNo:x.dpNo,productName:x.productName,poNo:x.poNo,category:ev.cat.short,categoryId:ev.cat.id,group:ev.cat.group,detail:ev.detail,minutes:ev.minutes,infoOnly:ev.cat.infoOnly}));
  }).filter(x=>(!b.category||`${x.categoryId} ${x.category}`.toLowerCase().includes(b.category.toLowerCase()))&&(!b.detail||x.detail.toLowerCase().includes(b.detail.toLowerCase()))&&x.minutes>=b.minMinutes);
  if(rows.length>50000)throw new HttpError(400,'REPORT_LIMIT','Persempit periode atau filter (maksimum 50.000 baris).');
  if(b.download)await pool.query('INSERT INTO md_export_history(user_id,filters,row_count) VALUES($1,$2::jsonb,$3)',[userOf(req).id,JSON.stringify({type:'stop-time',...b}),rows.length]);
  res.json({columns:b.columns,rows:(b.download?rows:rows.slice(0,100)).map(x=>b.columns.map(k=>x[k])),total:rows.length,invalid:data.invalidRows,duplicates:data.duplicatesDropped});
 });
 r.get('/operations/record-review',view,async(req,res)=>{
  const q=parse(z.object({date:IsoDate,machine:code}),req.query),data=await source.records(q.date,q.date,q.machine);
  res.json(data.reviewGroups??[]);
 });
 r.put('/operations/record-review',view,edit,async(req,res)=>{
  const b=parse(z.object({date:IsoDate,machine:code,shift,selected:z.array(code).max(50),note:z.string().trim().min(1).max(500)}),req.body);
  if(b.selected.length===0){await pool.query('DELETE FROM md_production_record_policy WHERE work_date=$1 AND machine_no=$2 AND shift=$3',[b.date,b.machine,b.shift]);}
  else{
   const data=await source.records(b.date,b.date,b.machine),g=data.reviewGroups?.find(x=>x.shift===b.shift);
   if(!g||b.selected.length<2||new Set(b.selected).size!==b.selected.length||!b.selected.every(id=>g.observedIds.includes(id)))throw new HttpError(400,'BAD_REQUEST','Pilih minimal dua record yang telah diverifikasi independen.');
   await pool.query(`INSERT INTO md_production_record_policy(work_date,machine_no,shift,observed_ids,selected_ids,note,updated_by) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
     ON CONFLICT(work_date,machine_no,shift) DO UPDATE SET observed_ids=EXCLUDED.observed_ids,selected_ids=EXCLUDED.selected_ids,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=now()`,[b.date,b.machine,b.shift,JSON.stringify(g.observedIds),JSON.stringify(b.selected),b.note,userOf(req).id]);
  }
  source.invalidate();await pool.query('DELETE FROM md_source_snapshot');await audit(req,{action:'masterdata.record.review',result:'success',objectType:'md_production_record_policy',objectId:b.date+':'+b.machine+':'+b.shift,after:b});res.json({ok:true});
 });
 r.get('/operations/quality-history',view,async(_req,res)=>{
  const rows=await pool.query('SELECT id::text,captured_at,date_from::text,date_to::text,shift,metrics,status,note,reviewed_at FROM md_quality_review ORDER BY captured_at DESC,id DESC LIMIT 100');res.json(rows.rows);
 });
 r.post('/operations/quality-history',view,async(req,res)=>{
  const q=parse(RangeQuerySchema,req.body), data=await source.records(q.from,q.to);
  const rows=data.records.filter(x=>!q.shift||x.shift===q.shift);
  const metrics={records:rows.length,invalid:data.invalidRows,duplicates:data.duplicatesDropped,ambiguous:data.ambiguousGroups??0,approvedGroups:data.approvedGroups??0,policyChanged:(data.reviewGroups??[]).filter(g=>g.state==='changed').length,missingOutput:rows.filter(x=>x.plan===null||x.actual===null).length,missingTimestamp:rows.filter(x=>!x.updatedAt).length,negativeOutput:rows.filter(x=>[x.plan,x.actual,x.gross,x.ngQty,x.ngGram,x.plannedMinutes].some(v=>v!==null&&v<0)).length,futureTimestamp:rows.filter(x=>!!x.updatedAt&&Date.parse(x.updatedAt)>Date.now()+300000).length};
  await pool.query('INSERT INTO md_quality_review(date_from,date_to,shift,metrics) VALUES($1,$2,$3,$4::jsonb)',[q.from,q.to,q.shift??null,JSON.stringify(metrics)]);res.json(metrics);
 });
 r.put('/operations/quality-history',view,edit,async(req,res)=>{
  const b=parse(z.object({id:z.string().regex(/^\d+$/),status:z.enum(['open','reviewed','resolved']),note:z.string().trim().min(1).max(500)}),req.body);
  const out=await pool.query('UPDATE md_quality_review SET status=$2,note=$3,reviewed_at=now(),reviewed_by=$4 WHERE id=$1',[b.id,b.status,b.note,userOf(req).id]);
  if(!out.rowCount)throw new HttpError(404,'NOT_FOUND','Review tidak ditemukan.');
  await audit(req,{action:'masterdata.quality.review',result:'success',objectType:'md_quality_review',objectId:b.id,after:b});res.json({ok:true});
 });
 return r;
}
