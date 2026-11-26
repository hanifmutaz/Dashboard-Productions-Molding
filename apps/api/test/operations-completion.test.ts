import { describe,expect,it } from 'vitest';
import { DEFAULT_SETTINGS } from '@mpd/contracts';
import { selectLatest,type SourceRecord } from '../src/modules/conmas/source.js';
import { applyRecordPolicies,type RecordPolicy } from '../src/modules/conmas/recordPolicy.js';
import { calendarLookup,scheduledMinutes } from '../src/modules/metrics/scheduledCalendar.js';
import { machineLifecycle } from '../src/modules/metrics/persistentSource.js';
import { buildScrap,buildUtilization,buildMachineDetail } from '../src/modules/metrics/views.js';
import { categoryResolver } from '../src/modules/metrics/categories.js';
const rec=(extra:Partial<SourceRecord>={}):SourceRecord=>({recordId:'A',date:'2026-11-26',machineNo:'1',shift:'1',group:null,cavity:null,plan:100,actual:80,gross:80,ngQty:0,ngGram:20,dpNo:'DP1',productName:'P',poNo:null,ctActual:null,plannedMinutes:240,oee:null,availability:null,performance:null,personnel:{leader:null,cell:null,technician:null,operator:null},updatedAt:'2026-11-26T08:00:00+07:00',slots:[],...extra});
const range={from:'2026-11-26',to:'2026-11-26',shift:null,days:1};
const rows=[{rec:rec(),rev:1},{rec:rec({recordId:'A',actual:90}),rev:2},{rec:rec({recordId:'B',actual:50}),rev:1}];
const policy:RecordPolicy={work_date:range.from,machine_no:'1',shift:'1',observed_ids:['A','B'],selected_ids:['A','B']};
const {resolve}=categoryResolver([]);
describe('operations completion',()=>{
 it('preserves default latest rule and requires explicit additive selection',()=>{
  expect(applyRecordPolicies(rows,[],selectLatest).records).toHaveLength(1);
  const result=applyRecordPolicies(rows,[policy],selectLatest);expect(result.records.map(r=>r.actual)).toEqual([90,50]);expect(result.approvedGroups).toBe(1);
 });
 it('invalidates approval when an unreviewed ID arrives',()=>{
  const result=applyRecordPolicies([...rows,{rec:rec({recordId:'C'}),rev:3}],[policy],selectLatest);expect(result.records).toHaveLength(1);expect(result.reviewGroups[0]?.state).toBe('changed');
 });
 it('aggregates approved records in machine shift detail',()=>{
  const result=applyRecordPolicies(rows,[policy],selectLatest);const detail=buildMachineDetail('1',range.from,result.records,{prev:null,next:null},resolve,DEFAULT_SETTINGS);expect(detail.shifts[0]?.actual).toBe(140);expect(detail.totals.actual).toBe(140);
 });
 it('requires complete calendar, and uses explicit zero for holiday',()=>{
  const cal=calendarLookup([{work_date:range.from,shift:'1',day_type:'working',planned_minutes:480},{work_date:range.from,shift:'2',day_type:'holiday',planned_minutes:0}]);expect(scheduledMinutes(range,cal)).toBeNull();expect(scheduledMinutes({...range,shift:'2'},cal)).toBe(0);
 });
 it('calendar changes only schedule-based Sogo/Shugyo denominator',()=>{
  const cal=calendarLookup([{work_date:range.from,shift:'1',day_type:'working',planned_minutes:480}]);const v=buildUtilization([rec()],null,{...range,shift:'1'},DEFAULT_SETTINGS,resolve,cal);expect(v.totals.calendarMinutes).toBe(480);expect(v.totals.shugyo.value).toBe(50);expect(v.totals.kikai.value).toBe(100);
 });
 it('historical mapping overrides current mapping per record date',()=>{
  const v=buildScrap([rec()],new Map([['DP1',{materialCode:'NEW',pricePerPcs:10}]]),new Map([['OLD',{name:'Old',pricePerGram:2}],['NEW',{name:'New',pricePerGram:9}]]),range,undefined,()=> 'OLD');expect(v.scrapValue.value).toBe(40);expect(v.byPart[0]?.materialCode).toBe('OLD');
 });
 it('retirement and reactivation do not erase historical production',()=>{
  const active=machineLifecycle([{machine_no:'1',effective_date:'2026-11-25',active:false},{machine_no:'1',effective_date:'2026-11-27',active:true}]);expect(active('1','2026-11-24')).toBe(true);expect(active('1','2026-11-26')).toBe(false);expect(active('1','2026-11-27')).toBe(true);
 });
});
