import { canView } from './auth.ts';
import { runTool, validateEntity, type ToolContext } from './registry.ts';
import { object, onlyKeys, SupportError, UUID } from './types.ts';
import { rentalOccupiesWindow, websiteVisibilityReasons, durationTierForDays, bufferOccupiesPickup } from './availability-rules.generated.js';
import type { CalendarClock, DiagnosticInput, OperationalReads, OperationalResult, RentalRecord } from './operational-types.ts';

export interface OperationalContext extends ToolContext { operational: OperationalReads; clock: CalendarClock; now: number }
export const dateValid = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
const label = (s: string | null | undefined) => (s ?? '').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,90);
const empty = (env: OperationalContext): OperationalResult => ({status:'verified',observedAt:new Date(env.now).toISOString(),findings:[],sources:[],navigation:[],checks:[],limitations:[]});
function scoped<T extends {id:string;tenant_id:string}>(row:T|null,tenant:string,id?:string):T {
  if (!row || row.tenant_id !== tenant || (id && row.id !== id)) throw new SupportError('record_unavailable','This record is missing or inaccessible in the current account.',403);
  return row;
}
function source(r:OperationalResult,table:OperationalResult['sources'][number]['table'],id:string,title:string) {
  const ref=`${table}:${id}`;
  if (!r.sources.some(s=>s.id===ref)) r.sources.push({id:ref,table,recordId:table==='availability_check'?undefined:id,title,observedAt:r.observedAt});
  return ref;
}
function finding(r:OperationalResult,code:string,summary:string,sourceIds:string[],blocking=true) { r.findings.push({code,summary,sourceIds,blocking}); }
function partial(r:OperationalResult,reason:string) { r.status='partial'; if(!r.limitations.includes(reason))r.limitations.push(reason); }
async function navigation(r:OperationalResult,env:OperationalContext,target:string,entityId?:string) {
  try {
    const resolved=await runTool('resolve_navigation_target',{target,...(entityId?{entityId}:{})},env);
    if ('action' in resolved && !r.navigation.some(a=>a.target===target&&a.entityId===entityId))r.navigation.push(resolved.action);
  } catch(error) { if (!(error instanceof SupportError) || error.status>=500) partial(r,'Navigation could not be checked.'); }
}
function needPermission(env:OperationalContext,key:string) { if(!canView(env.auth,key))throw new SupportError('restricted','Your permissions do not allow this record check.',403); }
function rentalData(row:RentalRecord) {
  return {id:row.id,number:label(row.rental_number),status:label(row.status),vehicleId:row.vehicle_id,startDate:row.start_date,endDate:row.end_date,payAsYouGo:row.is_pay_as_you_go,paygClosedAt:row.payg_closed_at};
}

async function returnEvidence(r:OperationalResult,env:OperationalContext,row:RentalRecord,blocking:boolean) {
  const ref=source(r,'rentals',row.id,`Rental ${label(row.rental_number)||row.id}`);
  const rows=await env.operational.receiving(env.auth.tenant.id,row.id);
  for(const h of rows) { scoped(h,env.auth.tenant.id); if(h.rental_id!==row.id||h.handover_type!=='receiving')throw new SupportError('record_unavailable','Return context could not be verified.',403); }
  r.checks.push(`return_receiving:${row.id}`);
  const received=rows.find(h=>h.handed_at);
  const open=!['Closed','Completed','Cancelled','Rejected'].includes(row.status??'');
  if(received && open || row.payg_closed_at && open) {
    const refs=[ref]; if(received)refs.push(source(r,'rental_key_handovers',received.id,'Receiving handover'));
    finding(r,'return_conflict',`Rental ${label(row.rental_number)} remains ${label(row.status)} but ${received?'receiving is recorded':'pay-as-you-go closure is recorded'}. Records conflict; review the rental before repeating any return action.`,refs,false);
  } else if(open && !received && rows.length<3) {
    finding(r,'return_not_recorded',`Rental ${label(row.rental_number)} remains ${label(row.status)}. Receiving completion is not recorded. This does not establish whether the vehicle physically returned.`,[ref],false);
    // Pending/Upcoming/Confirmed need review, not an assertion that a return is due.
    if(blocking && ['Active','Started'].includes(row.status??''))await navigation(r,env,'rental_return',row.id);
  } else if(received) {
    const h=source(r,'rental_key_handovers',received.id,'Receiving handover');
    finding(r,'return_recorded',`Receiving completion is recorded at ${received.handed_at}.`,[ref,h],false);
  }
  if(rows.length>=3)partial(r,'Receiving history reached its query limit; additional handovers may exist.');
  await navigation(r,env,'rental',row.id);
}

export function diagnosticInput(input:unknown):DiagnosticInput {
  const a=object(input);onlyKeys(a,['vehicleId','operation','startDate','endDate','customerTimezone','pickupLocationId']);
  if(typeof a.vehicleId!=='string'||!UUID.test(a.vehicleId)||!['website_visibility','date_availability','booking_rejection'].includes(String(a.operation)))throw new SupportError('invalid_input','Choose a vehicle and whether it is missing from the V2 website, unavailable for dates, or rejected at checkout.');
  for(const key of ['startDate','endDate'])if(a[key]!=null&&!dateValid(a[key]))throw new SupportError('invalid_input','Use valid calendar dates in YYYY-MM-DD format.');
  if(a.startDate&&a.endDate&&(String(a.endDate)<String(a.startDate)||(Date.parse(String(a.endDate))-Date.parse(String(a.startDate)))/86400000>366))throw new SupportError('invalid_input','Use an ordered date range of at most 366 days for this support check.');
  if(a.pickupLocationId!=null&&(typeof a.pickupLocationId!=='string'||!UUID.test(a.pickupLocationId)))throw new SupportError('invalid_input','Use a verified pickup location identifier.');
  if(a.customerTimezone!=null) {try {if(typeof a.customerTimezone!=='string'||a.customerTimezone.length>80)throw Error();new Intl.DateTimeFormat('en',{timeZone:a.customerTimezone});}catch{throw new SupportError('invalid_input','Provide the customer’s browser timezone, such as America/New_York.');} }
  return {vehicleId:a.vehicleId,operation:a.operation as DiagnosticInput['operation'],startDate:a.startDate as string??null,endDate:a.endDate as string??null,customerTimezone:a.customerTimezone as string??null,pickupLocationId:a.pickupLocationId as string??null};
}

export async function resolveAuthorizedEntity(input:unknown,env:OperationalContext):Promise<OperationalResult> {
  const a=object(input);onlyKeys(a,['kind','query']);
  if(a.kind==='pickup_location') {
    needPermission(env,'vehicles');
    if(typeof a.query!=='string'||!/^[\p{L}\p{N} -]{2,90}$/u.test(a.query))throw new SupportError('invalid_input','Use the exact pickup location name shown in the website selector.');
    const r=empty(env),rows=await env.operational.findLocations(env.auth.tenant.id,a.query.trim());
    for(const row of rows)scoped(row,env.auth.tenant.id);
    r.matches=rows.slice(0,5).map(row=>({kind:'pickup_location',id:row.id,label:label(row.name)}));
    for(const match of r.matches)source(r,'pickup_locations',match.id,match.label);
    if(!rows.length){r.status='missing';r.limitations.push('No matching pickup location found. Ask for the exact selected location name.');}
    if(rows.length>1){r.status='needs_input';r.limitations.push('More than one location matches; ask the operator to identify the selected location.');}
    if(rows.length>5)r.limitations.push('Only five location matches shown.');
    return r;
  }
  if(!['vehicle','rental'].includes(String(a.kind))||typeof a.query!=='string'||!a.query.trim()||a.query.length>90)throw new SupportError('invalid_input','Use a vehicle registration, make/model, rental number, or record identifier.');
  const kind=a.kind as 'vehicle'|'rental';needPermission(env,kind==='vehicle'?'vehicles':'rentals');
  const q=a.query.trim(), t=env.auth.tenant.id,r=empty(env);
  let rows;
  if(UUID.test(q)) {const row=kind==='vehicle'?await env.operational.vehicle(t,q):await env.operational.rental(t,q);rows=row?[row]:[];}
  else {
    // Query syntax, wildcards and arbitrarily broad searches cannot reach PostgREST.
    if(!/^[\p{L}\p{N} -]{2,90}$/u.test(q))throw new SupportError('invalid_input','Use the registration, rental number, or a short make/model name without filter punctuation.');
    rows=kind==='vehicle'?await env.operational.findVehicles(t,q,true):await env.operational.findRentals(t,q);
    if(kind==='vehicle'&&!rows.length)rows=await env.operational.findVehicles(t,q,false);
    // "Tesla NWD-3311" or "rental R-NW26": retry identifier-like tokens (containing a digit) exactly.
    if(!rows.length&&/\s/.test(q)){
      for(const token of [...new Set(q.split(/\s+/).filter(part=>/\d/.test(part)&&part.length>=2))].slice(0,2)){
        rows=kind==='vehicle'?await env.operational.findVehicles(t,token,true):await env.operational.findRentals(t,token);
        if(rows.length)break;
      }
    }
  }
  for(const row of rows)scoped(row,t,UUID.test(q)?q:undefined);
  r.matches=rows.slice(0,5).map(row=>({kind,id:row.id,label:'reg'in row?[label(row.reg),label(row.make),label(row.model)].filter(Boolean).join(' · '):`Rental ${label(row.rental_number)}`}));
  for(const match of r.matches??[])source(r,kind==='vehicle'?'vehicles':'rentals',match.id,match.label);
  if(!rows.length){r.status='missing';r.limitations.push('No matching record was found in your authorized account.');}
  else if(rows.length>1){r.status='needs_input';r.limitations.push('Ask the operator to choose a matching record. Do not select arbitrarily.');}
  if(rows.length>5)r.limitations.push('Only five matches are shown. Refine the registration or rental number.');
  return r;
}

export async function getRentalSupportContext(input:unknown,env:OperationalContext):Promise<OperationalResult> {
  const a=object(input);onlyKeys(a,['rentalId']);
  if(typeof a.rentalId!=='string')throw new SupportError('invalid_input','Select a rental.');
  await validateEntity(env,{kind:'rental',id:a.rentalId});
  const row=scoped(await env.operational.rental(env.auth.tenant.id,a.rentalId),env.auth.tenant.id,a.rentalId),r=empty(env);
  r.data=rentalData(row);await returnEvidence(r,env,row,false);return r;
}

export async function diagnoseVehicleAvailability(input:unknown,env:OperationalContext):Promise<OperationalResult> {
  const a=diagnosticInput(input),r=empty(env),t=env.auth.tenant.id;
  await validateEntity(env,{kind:'vehicle',id:a.vehicleId});
  const v=scoped(await env.operational.vehicle(t,a.vehicleId),t,a.vehicleId);
  const ref=source(r,'vehicles',v.id,[label(v.reg),label(v.make),label(v.model)].filter(Boolean).join(' · '));
  r.diagnostic=a;
  const checkRef=source(r,'availability_check',`${v.id}:${a.operation}`,'V2 '+a.operation.replaceAll('_',' '));
  await navigation(r,env,'vehicle',v.id);
  if(a.pickupLocationId)scoped(await env.operational.location(t,a.pickupLocationId),t,a.pickupLocationId);
  if(a.operation!=='booking_rejection') {
    const messages:Record<string,string>={vehicle_status:'The vehicle status excludes it from the V2 website fleet.',paused:'The vehicle is paused.',pause_state_missing:'The website requires pause to be explicitly off; its value is missing.',website_hidden:'Show on website is off.',disposed:'The vehicle is recorded as disposed.'};
    for(const code of websiteVisibilityReasons(v))finding(r,code,messages[code],[ref]);
    r.checks.push('website_visibility');
    if(a.pickupLocationId){r.checks.push('pickup_location');if(v.pickup_location_id!==null&&v.pickup_location_id!==a.pickupLocationId)finding(r,'pickup_location','This vehicle is assigned to a different pickup location.',[ref]);}
    if(a.startDate&&a.endDate){try {
      const config=await env.operational.config(t);if(!config||config.id!==t)throw new SupportError('live_read_failed','Tenant availability settings could not be verified.',503);
      const days=Math.max(1,Math.round((Date.parse(a.endDate)-Date.parse(a.startDate))/86400000));
      const tier=durationTierForDays(days,config.monthly_tier_days??30);r.checks.push('duration_tier');
      if(v[`available_${tier}`]!==true)finding(r,'duration_disabled',`This vehicle is not enabled for the ${tier} duration selected by the V2 website.`,[ref]);
    }catch {partial(r,'Duration settings could not be checked.');}}
  } else {r.checks.push('checkout_pause');if(v.is_paused===true)finding(r,'paused','The checkout pause guard rejects this vehicle.',[ref]);}
  if(a.operation==='website_visibility') {
    r.limitations.push('Checks the V2 fleet listing filters only. A direct vehicle page has different visibility behavior. Date occupancy, other customer-selected filters, and checkout are not checked.');
    if(!a.startDate||!a.endDate)r.limitations.push('No duration filter evaluated: no complete booking range supplied.');
    if(!a.pickupLocationId)r.limitations.push('No pickup location filter supplied.');
    return r;
  }
  if(!a.startDate||!a.endDate||a.operation==='date_availability'&&!a.customerTimezone) {
    r.status='needs_input';r.limitations.push('Ask for the actual pickup and return dates'+(a.operation==='date_availability'?' and the customer browser’s timezone (used for today and turnaround calculations).':'.')+' Do not invent a window.');return r;
  }
  const start=a.startDate,end=a.endDate;
  if(a.operation==='booking_rejection')partial(r,'Checkout coverage is limited to the read-only pause and overlap prechecks. Customer/draft reuse, all write-time validations and the deployed overlap trigger were not executed; no successful checkout is implied.');
  let rows:RentalRecord[]=[];
  try {rows=await env.operational.occupancy(t,v.id,a.operation,start,end);r.checks.push(a.operation==='booking_rejection'?'checkout_overlap_precheck':'rental_occupancy');}
  catch {partial(r,'Rental occupancy could not be checked.');}
  if(rows.length>200)partial(r,'Rental query reached 200 records; results may omit blockers.');
  const today=a.customerTimezone?env.clock.today(a.customerTimezone,env.now):'';
  let detailed=0;
  for(const row of rows.slice(0,200)) {
    scoped(row,t);if(row.vehicle_id!==v.id)throw new SupportError('record_unavailable','Vehicle occupancy could not be verified.',403);
    if(!dateValid(row.start_date)||row.end_date!==null&&!dateValid(row.end_date)){partial(r,'A rental contains invalid dates.');continue;}
    if(a.operation!=='booking_rejection'&&!rentalOccupiesWindow(row,start,end,today))continue;
    if(!canView(env.auth,'rentals')) {
      if(!r.findings.some(f=>f.code==='restricted_rental'))finding(r,'restricted_rental','A rental blocks the selected dates. Your permissions do not allow its details.',[checkRef]);
      partial(r,'Blocking rental details and return records are restricted.');continue;
    }
    if(detailed++>=5){partial(r,'More than five blocking rentals were found; only five are detailed.');continue;}
    await validateEntity(env,{kind:'rental',id:row.id});
    const rr=source(r,'rentals',row.id,`Rental ${label(row.rental_number)}`);
    finding(r,'rental_occupancy',`Rental ${label(row.rental_number)} (${label(row.status)}, ${row.start_date} to ${row.end_date??'no recorded end date'}) blocks the requested dates under ${a.operation==='booking_rejection'?'the checkout overlap precheck':'the V2 website occupancy rule'}.`,[rr,checkRef]);
    try{await returnEvidence(r,env,row,true);}catch(error){if(error instanceof SupportError&&error.status===403)throw error;partial(r,'Receiving records could not be checked; return completion is unknown.');}
  }
  if(a.operation==='booking_rejection')return r;
  // Independent checks continue if another one fails, with explicit partial coverage.
  try {
    const blocks=await env.operational.blocks(t,v.id,start,end);r.checks.push('blocked_dates');
    if(blocks.length>200)partial(r,'Blocked-date query reached 200 records.');
    for(const b of blocks.slice(0,200)) {
      scoped(b,t);if(b.vehicle_id!==null&&b.vehicle_id!==v.id)throw new SupportError('record_unavailable','Block context could not be verified.',403);
      if(!dateValid(b.start_date)||!dateValid(b.end_date)){partial(r,'A blocked period contains invalid dates.');continue;}
      if(b.start_date>end||b.end_date<start)throw new SupportError('record_unavailable','Block date context could not be verified.',403);
      const allowed=canView(env.auth,'availability');
      if(!allowed) { if(!r.findings.some(f=>f.code==='restricted_block'))finding(r,'restricted_block','A blocked-date period covers these dates; its details are restricted.',[checkRef]);partial(r,'Blocked-period details are restricted.');continue; }
      if(r.findings.filter(f=>f.code==='blocked_dates').length>=5){partial(r,'Only five blocked periods are detailed.');continue;}
      finding(r,'blocked_dates',`${b.vehicle_id?'A vehicle':'A fleet-wide'} blocked period covers ${b.start_date} to ${b.end_date}.`,[source(r,'blocked_dates',b.id,'Blocked period'),checkRef]);
    }
    if(blocks.length&&canView(env.auth,'availability'))await navigation(r,env,'availability');
  }catch(error){if(error instanceof SupportError&&error.status===403)throw error;partial(r,'Blocked dates could not be checked.');}
  try {
    const config=await env.operational.config(t);if(!config||config.id!==t)throw Error();
    const minutes=config.buffer_time_minutes??0;
    if(!Number.isFinite(minutes)||minutes<0||minutes>525600)throw Error();
    r.checks.push('turnaround_buffer');
    if(minutes>0) {
      const from=new Date(Date.parse(start)-(Math.ceil(minutes/1440)+1)*86400000).toISOString().slice(0,10);
      const completed=await env.operational.completed(t,v.id,from,start);
      if(completed.length>200)partial(r,'Completed-rental query reached 200 records.');
      for(const row of completed.slice(0,200)) {
        scoped(row,t);if(row.vehicle_id!==v.id||row.status!=='Completed')throw new SupportError('record_unavailable','Buffer context could not be verified.',403);
        const pickup=env.clock.timestamp(start,'00:00',a.customerTimezone!);
        const ended=row.end_date?env.clock.timestamp(row.end_date,row.return_time??'23:59',a.customerTimezone!):NaN;
        if(!Number.isFinite(ended)||!Number.isFinite(pickup)){partial(r,'A turnaround date/time could not be interpreted safely.');continue;}
        if(bufferOccupiesPickup(pickup,ended,minutes)) {
          const refs=[checkRef];let detail='';
          if(canView(env.auth,'rentals')) {
            if(r.findings.filter(f=>f.code==='turnaround_buffer').length>=5){partial(r,'Only five turnaround rentals are detailed.');continue;}
            await validateEntity(env,{kind:'rental',id:row.id});
            refs.push(source(r,'rentals',row.id,`Rental ${label(row.rental_number)}`));
            detail=` Rental ${label(row.rental_number)} is Completed with end ${row.end_date}, return time ${row.return_time??'23:59 (website fallback)'}.`;
          } else {
            partial(r,'Turnaround rental details are restricted.');
            if(r.findings.some(f=>f.code==='turnaround_buffer'))continue;
          }
          finding(r,'turnaround_buffer',`The V2 website turnaround buffer (${minutes} minutes) covers the pickup day. This website check uses midnight in the customer’s browser timezone.${detail}`,refs);
        }
      }
    }
  }catch(error){if(error instanceof SupportError&&error.status===403)throw error;partial(r,'Turnaround buffer could not be checked.');}
  r.limitations.push('This evaluates V2 website listing/date filters, not a reservation guarantee or the final checkout trigger.');
  if(!a.pickupLocationId)r.limitations.push('No pickup location filter supplied.');
  return r;
}

export const OPERATIONAL_TOOLS=Object.freeze({resolve_authorized_entity:resolveAuthorizedEntity,get_rental_support_context:getRentalSupportContext,diagnose_vehicle_availability:diagnoseVehicleAvailability});
