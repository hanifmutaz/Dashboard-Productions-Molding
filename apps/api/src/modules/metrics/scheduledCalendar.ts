import type pg from 'pg';
import type { Notice } from '@mpd/contracts';
import type { Range } from './views.js';
export type CalendarLookup=(date:string,shift:string|null)=>number|null;
export type ShiftCalendarRow={work_date:string;shift:string;day_type:string;planned_minutes:number};
export function calendarLookup(rows:readonly ShiftCalendarRow[]):CalendarLookup {
 const map=new Map(rows.map(r=>[`${r.work_date}:${r.shift}`,r.planned_minutes]));
 return (date,shift)=>{
  const minutes=(shift?[shift]:['1','2','3']).map(s=>map.get(`${date}:${s}`));
  if(minutes.some(m=>m===undefined||!Number.isFinite(m)||m<0))return null;
  const total=minutes.reduce<number>((n,m)=>n+(m??0),0);
  return total<=1440?total:null;
 };
}
export async function loadCalendar(pool:pg.Pool,from:string,to:string):Promise<CalendarLookup>{
 const q=await pool.query<ShiftCalendarRow>('SELECT work_date::text,shift,day_type,planned_minutes FROM md_shift_calendar WHERE work_date BETWEEN $1::date AND $2::date',[from,to]);return calendarLookup(q.rows);
}
/** Only a complete, explicit schedule may replace the default calendar denominator. */
export function scheduledMinutes(range:Range,lookup:CalendarLookup):number|null{
 let total=0;
 for(let i=0;i<range.days;i++){
  const date=new Date(Date.parse(range.from)+i*864e5).toISOString().slice(0,10),minutes=lookup(date,range.shift);
  if(minutes===null)return null;total+=minutes;
 }
 return total;
}
export function calendarKpiNotice(range:Range,lookup:CalendarLookup):Notice {
 const minutes=scheduledMinutes(range,lookup);
 return minutes===null?{code:'SCHEDULE_KPI_INCOMPLETE',message:'Jadwal shift belum lengkap. KPI berbasis kalender jadwal tidak tersedia untuk periode ini.'}:{code:'SCHEDULE_KPI',message:`Mode kalender jadwal aktif: denominator Sogo/Shugyo = ${minutes} menit per mesin pada periode ini. Kikai dan OEE tidak diubah.`};
}
