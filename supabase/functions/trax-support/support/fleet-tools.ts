import { canView } from './auth.ts';
import { object, onlyKeys, SupportError } from './types.ts';
import { diagnoseVehicleAvailability, diagnosticInput, type OperationalContext } from './operational-tools.ts';
import { OUT_NOW_STATUSES } from './availability-rules.generated.js';
import { validateEntity } from './registry.ts';
import type { OperationalResult, RentalRecord, VehicleRecord } from './operational-types.ts';

export interface Page<T> { rows:T[]; total:number; nextOffset:number|null }
export interface FleetReads {
  count(tenant:string,kind:'vehicles'|'customers'|'rentals'):Promise<number>;
  timezone(tenant:string):Promise<string|null>;
  bookings(tenant:string,view:'active'|'upcoming',today:string,offset:number):Promise<Page<RentalRecord>>;
  vehicles(tenant:string,offset:number,limit:number):Promise<Page<VehicleRecord>>;
}
export interface FleetContext extends OperationalContext { fleet:FleetReads; reauthorize?:()=>Promise<void> }
interface Result {data:unknown;error:unknown;count?:number|null}
interface Query extends PromiseLike<Result> {
  eq(key:string,value:string):Query; in(key:string,values:string[]):Query; gte(key:string,value:string):Query;
  order(key:string):Query; range(start:number,end:number):Query; maybeSingle():PromiseLike<Result>;
}
export interface FleetDatabase {from(table:string):{select(columns:string,options?:{count?:'exact';head?:boolean}):Query}}
import { VEHICLE_COLUMNS, RENTAL_COLUMNS } from './operational-reads.ts';
export function createFleetReads(db:FleetDatabase):FleetReads {
  async function result(query:PromiseLike<Result>) {const r=await query;if(r.error)throw new SupportError('live_read_failed','The account query failed. Its total is unknown.',503);return r;}
  async function page<T>(query:Query,offset:number,limit:number):Promise<Page<T>> {
    const r=await result(query.order('id').range(offset,offset+limit-1));
    if(!Array.isArray(r.data)||!Number.isSafeInteger(r.count)||r.count!<0)throw new SupportError('incomplete_read','A complete query count was not returned.',503);
    const rows=r.data as T[];
    if(rows.length!==Math.min(limit,Math.max(0,r.count!-offset)))throw new SupportError('incomplete_read','Records changed or the query was truncated; check again.',503);
    return {rows,total:r.count!,nextOffset:offset+rows.length<r.count!?offset+rows.length:null};
  }
  return {
    count:async(t,kind)=>{const r=await result(db.from(kind).select('id',{count:'exact',head:true}).eq('tenant_id',t));if(!Number.isSafeInteger(r.count)||r.count!<0)throw new SupportError('incomplete_read','The exact total is unavailable.',503);return r.count!;},
    timezone:async(t)=>{const r=await result(db.from('tenants').select('id,timezone').eq('id',t).maybeSingle());const row=r.data as {id:string;timezone:string|null}|null;return row?.id===t?row.timezone:null;},
    bookings:(t,view,today,offset)=>{
      let q=db.from('rentals').select(RENTAL_COLUMNS,{count:'exact'}).eq('tenant_id',t);
      q=view==='active'?q.in('status',[...OUT_NOW_STATUSES]):q.in('status',['Pending','Upcoming','Confirmed']).gte('start_date',today);
      return page(q,offset,50);
    },
    vehicles:(t,offset,limit)=>page(db.from('vehicles').select(VEHICLE_COLUMNS,{count:'exact'}).eq('tenant_id',t),offset,limit),
  };
}
const clean=(value:string|null)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,90);
const offsetOf=(value:unknown)=>{if(value==null)return 0;if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>100000)throw new SupportError('invalid_input','Invalid page offset.');return Number(value);};
function permission(env:FleetContext,key:string){if(!canView(env.auth,key))throw new SupportError('restricted','Your role cannot inspect this part of the account.',403);}
function base(env:FleetContext,check:string):OperationalResult {const observedAt=new Date(env.now).toISOString();return {status:'verified',observedAt,checks:[check],findings:[],sources:[{id:`account_summary:${check}`,table:'account_summary',title:'Current account '+check.replaceAll('_',' '),observedAt}],navigation:[],limitations:[],data:{scope:'Authenticated tenant and effective role only'}};}
function assertRows(rows:{tenant_id:string}[],env:FleetContext){if(rows.some(row=>row.tenant_id!==env.auth.tenant.id))throw new SupportError('record_unavailable','Account records could not be verified.',403);}
async function today(env:FleetContext) {const timezone=await env.fleet.timezone(env.auth.tenant.id);try{if(!timezone)throw Error();return {timezone,today:env.clock.today(timezone,env.now)};}catch{throw new SupportError('timezone_unavailable','The tenant timezone is not configured or could not be verified. No current-time conclusion is available.',503);}}
export async function getAccountCounts(input:unknown,env:FleetContext):Promise<OperationalResult> {
  const a=object(input);onlyKeys(a,['kinds']);
  if(!Array.isArray(a.kinds)||!a.kinds.length||a.kinds.length>3||a.kinds.some(k=>!['vehicles','customers','rentals'].includes(String(k))))throw new SupportError('invalid_input','Choose vehicles, customers or rentals.');
  const r=base(env,'totals'),counts:Record<string,unknown>={};
  for(const kind of [...new Set(a.kinds)] as ('vehicles'|'customers'|'rentals')[]) {
    if(!canView(env.auth,kind)){counts[kind]={status:'restricted',total:null};r.status='partial';continue;}
    await env.reauthorize?.();
    try{counts[kind]={status:'verified',total:await env.fleet.count(env.auth.tenant.id,kind)};}
    catch{counts[kind]={status:'error',total:null};r.status='partial';}
  }
  r.data={...r.data,counts,definition:'All records in each authorized table, including historical or disposed records. Counts are not fleet availability.'};
  if(r.status==='partial')r.limitations.push('Restricted or failed totals are unknown, never zero.');
  r.findings.push({code:'account_totals',summary:Object.entries(counts).map(([kind,value])=>{const count=value as {status:string;total:number|null};return `${kind}: ${count.total===null?count.status:count.total}`;}).join('; '),blocking:false,sourceIds:[r.sources[0].id]});return r;
}
export async function listAccountBookings(input:unknown,env:FleetContext):Promise<OperationalResult> {
  const a=object(input);onlyKeys(a,['view','offset']);permission(env,'rentals');
  if(!['active','upcoming','out_now'].includes(String(a.view)))throw new SupportError('invalid_input','Choose active, upcoming or out_now.');
  const offset=offsetOf(a.offset),clock=await today(env),r=base(env,'bookings');
  const page=await env.fleet.bookings(env.auth.tenant.id,a.view==='upcoming'?'upcoming':'active',clock.today,offset);assertRows(page.rows,env);
  const verifiedVehicles=new Set<string>(),vehicleLabels=new Map<string,string>();
  if(canView(env.auth,'vehicles'))for(const id of new Set(page.rows.map(row=>row.vehicle_id).filter((id):id is string=>!!id))){
    await env.reauthorize?.();
    try{await validateEntity(env,{kind:'vehicle',id});verifiedVehicles.add(id);}catch{/* A relation is not authorization. */continue;}
    // The car label is optional context for the operator; only a verified, same-tenant record is named.
    try{const v=await env.operational.vehicle(env.auth.tenant.id,id);if(v&&v.id===id&&v.tenant_id===env.auth.tenant.id){const name=[clean(v.reg),clean(v.make),clean(v.model)].filter(Boolean).join(' · ');if(name)vehicleLabels.set(id,name);}}catch{/* Label unavailable. */}
  }
  const completeRelations=canView(env.auth,'vehicles')&&page.rows.every(row=>!row.vehicle_id||verifiedVehicles.has(row.vehicle_id));
  r.data={...r.data,...clock,view:a.view,totalBookings:page.total,offset,nextOffset:page.nextOffset,bookings:page.rows.map(row=>({id:row.id,number:clean(row.rental_number),status:row.status,startDate:row.start_date,endDate:row.end_date,...(row.vehicle_id&&verifiedVehicles.has(row.vehicle_id)?{vehicleId:row.vehicle_id,...(vehicleLabels.has(row.vehicle_id)?{vehicle:vehicleLabels.get(row.vehicle_id)}:{})}:{})})),
    uniqueVehicles:offset===0&&page.nextOffset===null&&completeRelations?verifiedVehicles.size:null};
  if(canView(env.auth,'vehicles')&&!completeRelations){r.status='partial';r.limitations.push('Some vehicle relationships could not be verified. Their identifiers and a complete unique-vehicle count are unavailable.');}
  r.limitations.push(a.view==='upcoming'?'Upcoming reservations include Pending, Upcoming and Confirmed records starting on or after the tenant-local date; pending is not approval.':'Out on hire uses the V2 Active/Started recorded-state rule, including overdue open rentals. This is system state, not proof of physical possession or bookability.');
  r.limitations.push('For bookability, supply the requested dates and customer timezone. Do not subtract active bookings from the vehicle total.');
  if(page.nextOffset!==null){r.status='partial';r.limitations.push('Only this page of bookings is listed. The booking total is exact; a complete unique-vehicle total is not available from this page.');}
  for(const row of page.rows.slice(0,8)){r.sources.push({id:`rentals:${row.id}`,table:'rentals',recordId:row.id,title:`Rental ${clean(row.rental_number)}`,observedAt:r.observedAt});r.navigation.push({target:'rental',entityId:row.id,label:`Open ${clean(row.rental_number)||'rental'}`});}
  r.findings.push({code:'booking_summary',summary:`${page.total} ${a.view==='upcoming'?'upcoming reservations':'recorded active rentals'}; showing ${page.rows.length}. Each booking is separate from its vehicle.`,sourceIds:[r.sources[0].id],blocking:false});return r;
}
export async function findAvailableVehicles(input:unknown,env:FleetContext):Promise<OperationalResult> {
  const a=object(input);onlyKeys(a,['startDate','endDate','customerTimezone','pickupLocationId','offset']);permission(env,'vehicles');
  const offset=offsetOf(a.offset),r=base(env,'fleet_date_check');
  // Validate the shared date conventions before querying any fleet records.
  const {offset:ignoredOffset,...dateFields}=a;
  const dates=diagnosticInput({...dateFields,vehicleId:'00000000-0000-4000-8000-000000000001',operation:'date_availability'});
  if(!dates.startDate||!dates.endDate||!dates.customerTimezone){r.status='needs_input';r.limitations.push('Provide actual pickup/return dates and the customer browser timezone.');return r;}
  const page=await env.fleet.vehicles(env.auth.tenant.id,offset,5);assertRows(page.rows,env);
  const vehicles:{id:string;label:string;result:string;blockers:string[];limitations:string[]}[]=[];
  for(const row of page.rows){await env.reauthorize?.();const checked=await diagnoseVehicleAvailability({...dates,vehicleId:row.id},env);
    const blockers=checked.findings.filter(f=>f.blocking);
    vehicles.push({id:row.id,label:[clean(row.reg),clean(row.make),clean(row.model)].filter(Boolean).join(' · '),result:blockers.length?'blocked':checked.status==='verified'?'no_blocker_in_evaluated_rules':'unknown',blockers:blockers.map(f=>f.summary),limitations:checked.limitations});
    r.sources.push({id:`vehicles:${row.id}`,table:'vehicles',recordId:row.id,title:[clean(row.reg),clean(row.make),clean(row.model)].join(' '),observedAt:r.observedAt});r.navigation.push({target:'vehicle',entityId:row.id,label:`Open ${clean(row.reg)||'vehicle'}`});
    if(checked.status!=='verified')r.status='partial';
  }
  r.data={...r.data,vehicles,totalVehicles:page.total,nextOffset:page.nextOffset,offset,startDate:dates.startDate,endDate:dates.endDate,customerTimezone:dates.customerTimezone};
  if(page.nextOffset!==null)r.status='partial';
  r.limitations.push('Five vehicles maximum per page. Results reuse the V2 website visibility, duration, location, occupancy, block and turnaround checks. No successful checkout is guaranteed; partial results are not a whole-fleet available total.');
  r.findings.push({code:'fleet_date_summary',summary:`Checked ${vehicles.length} vehicles in the requested date window. ${vehicles.filter(v=>v.result==='no_blocker_in_evaluated_rules').length} had no blocker in the evaluated rules on this page.`,sourceIds:[r.sources[0].id],blocking:false});return r;
}
