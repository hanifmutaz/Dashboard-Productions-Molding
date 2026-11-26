import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { PERMISSIONS, RangeQuerySchema, IsoDate } from '@mpd/contracts';
import { parse, requirePermission, userOf, type Audit } from '../../http/middleware.js';
import { HttpError } from '../../http/errors.js';
import type { Repos } from '../../db/repos.js';
import { completionRoutes } from './completion.js';
import type { ConmasSource } from '../conmas/source.js';

const fields = ['date','machineNo','shift','dpNo','productName','plan','actual','gross','ngQty','ngGram','plannedMinutes','oee','availability','performance','updatedAt'] as const;
const columns = z.array(z.enum(fields)).min(1).max(fields.length).refine(v => new Set(v).size === v.length);
const name = z.string().trim().min(1).max(80);
export function operationsRoutes(pool: pg.Pool, source: ConmasSource, audit: Audit, repos?: Repos): Router {
  const r = Router();
  const master = requirePermission(PERMISSIONS.viewMasterData);
  const edit = requirePermission(PERMISSIONS.editMasterData);
  const view = requirePermission(PERMISSIONS.viewProduction);
  const exp = requirePermission(PERMISSIONS.exportProduction);
  r.get('/operations/master', master, async (_req,res) => {
    const [machines, prices, calendar] = await Promise.all([
      pool.query('SELECT machine_no, label, active, last_seen::text FROM md_machine_registry ORDER BY machine_no'),
      pool.query('SELECT entity_type,entity_key,old_price,new_price,changed_at FROM md_price_history ORDER BY changed_at DESC,id DESC LIMIT 500'),
      pool.query('SELECT work_date::text,day_type,planned_minutes,note FROM md_work_calendar ORDER BY work_date DESC LIMIT 1000'),
    ]);
    res.json({ machines: machines.rows, prices: prices.rows, calendar: calendar.rows });
  });
  r.put('/operations/machines', edit, async (req,res) => {
    const b = parse(z.object({ machineNo:z.string().trim().min(1).max(20), label:z.string().trim().max(100), active:z.boolean() }),req.body);
    const result = await pool.query(`UPDATE md_machine_registry SET label=$2,active=$3,inactive_from=CASE WHEN $3 THEN NULL WHEN active THEN (now() AT TIME ZONE 'Asia/Jakarta')::date ELSE inactive_from END WHERE machine_no=$1`,[b.machineNo,b.label || null,b.active]);
    if (!result.rowCount) throw new HttpError(404,'NOT_FOUND','Mesin belum terdaftar.');
    await audit(req,{action:'masterdata.machine.update',result:'success',objectType:'md_machine_registry',objectId:b.machineNo,after:b});
    res.json({ok:true});
  });
  r.put('/operations/calendar', edit, async (req,res) => {
    const b = parse(z.object({date:IsoDate,dayType:z.enum(['working','holiday','overtime']),minutes:z.number().int().min(0).max(1440).nullable(),note:z.string().max(200)}),req.body);
    if (new Date(b.date+'T00:00:00Z').toISOString().slice(0,10)!==b.date) throw new HttpError(400,'BAD_REQUEST','Tanggal tidak valid.');
    await pool.query(`INSERT INTO md_work_calendar(work_date,day_type,planned_minutes,note,updated_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(work_date) DO UPDATE SET day_type=EXCLUDED.day_type,planned_minutes=EXCLUDED.planned_minutes,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=now()`,[b.date,b.dayType,b.minutes,b.note,userOf(req).id]);
    await audit(req,{action:'masterdata.calendar.update',result:'success',objectType:'md_work_calendar',objectId:b.date,after:b});
    res.json({ok:true});
  });
  r.get('/operations/quality',view,async(req,res)=>{
    const q=parse(RangeQuerySchema,req.query);
    const data=await source.records(q.from,q.to);
    const rows=data.records.filter(x=>!q.shift||x.shift===q.shift);
    res.json({records:rows.length,invalid:data.invalidRows,duplicates:data.duplicatesDropped,missingOutput:rows.filter(x=>x.plan===null||x.actual===null).length,missingTimestamp:rows.filter(x=>!x.updatedAt).length,negativeOutput:rows.filter(x=>(x.plan??0)<0||(x.actual??0)<0).length,health:await source.health()});
  });
  r.get('/operations/templates',view,exp,async(req,res)=>{
    const id=userOf(req).id;
    const [t,h]=await Promise.all([pool.query('SELECT name,columns FROM md_export_template WHERE user_id=$1 ORDER BY name',[id]),pool.query('SELECT created_at,filters,row_count FROM md_export_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[id])]);
    res.json({templates:t.rows,history:h.rows});
  });
  r.put('/operations/templates',view,exp,async(req,res)=>{
    const b=parse(z.object({name,columns}),req.body);
    await pool.query('INSERT INTO md_export_template(user_id,name,columns) VALUES($1,$2,$3::jsonb) ON CONFLICT(user_id,name) DO UPDATE SET columns=EXCLUDED.columns',[userOf(req).id,b.name,JSON.stringify(b.columns)]);
    res.json({ok:true});
  });
  r.post('/operations/report',view,exp,async(req,res)=>{
    const b=parse(z.object({range:RangeQuerySchema,columns,machine:z.string().max(20),product:z.string().max(100),download:z.boolean()}),req.body);
    const data=await source.records(b.range.from,b.range.to,b.machine||undefined);
    const rows=data.records.filter(x=>(!b.range.shift||x.shift===b.range.shift)&&(!b.product||`${x.dpNo??''} ${x.productName??''}`.toLowerCase().includes(b.product.toLowerCase())));
    if(rows.length>50000) throw new HttpError(400,'REPORT_LIMIT','Persempit periode atau filter mesin (maksimum 50.000 baris).');
    if(b.download) await pool.query('INSERT INTO md_export_history(user_id,filters,row_count) VALUES($1,$2::jsonb,$3)',[userOf(req).id,JSON.stringify(b),rows.length]);
    res.json({columns:b.columns,rows:(b.download?rows:rows.slice(0,100)).map(x=>b.columns.map(k=>x[k])),total:rows.length,invalid:data.invalidRows,duplicates:data.duplicatesDropped});
  });
  if (repos) r.use(completionRoutes(pool,source,audit,repos));
  return r;
}
