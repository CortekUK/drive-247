/** Browser-only, anonymized fixture adapter. Never imported by application code.
 * The scripted model verifies plumbing/UI, not real-model understanding. */
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
export const tenant='00000000-0000-4000-8000-000000000001';
export const vehicle='00000000-0000-4000-8000-000000000002';
export const rental='00000000-0000-4000-8000-000000000003';
let returned=false;
export function simulateCompletedReturn(){returned=true;}
const row={id:rental,tenant_id:tenant,vehicle_id:vehicle,rental_number:'DEMO-104',status:'Active',start_date:'2026-09-01',end_date:'2026-09-10',return_time:'10:00',is_pay_as_you_go:false,payg_closed_at:null};
const v={id:vehicle,tenant_id:tenant,reg:'DEMO-01',make:'Example',model:'Compact',status:'Available',is_paused:false,is_disposed:false,show_on_website:true,pickup_location_id:null,available_daily:true,available_weekly:true,available_monthly:true};
export const operational={vehicle:async()=>v,rental:async()=>row,findVehicles:async()=>[v],findRentals:async()=>[row],config:async()=>({id:tenant,buffer_time_minutes:0,monthly_tier_days:30}),location:async()=>null,findLocations:async()=>[],occupancy:async()=>returned?[]:[row],blocks:async()=>returned?[{id:'00000000-0000-4000-8000-000000000004',tenant_id:tenant,vehicle_id:null,start_date:'2026-09-16',end_date:'2026-09-17'}]:[],completed:async()=>[],receiving:async()=>[]};
const call=(name,args)=>({content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const final=()=>({content:JSON.stringify({answer:returned?'The open rental no longer blocks these dates. A fleet-wide blocked period still applies, so the vehicle remains unavailable for this window.':'Drive247 still records the previous rental as open, and the date check identifies it as a blocker. Receiving completion is not recorded. You reported that the car and keys are back; authorized staff can review the existing return workflow.',sourceIds:[`availability_check:${vehicle}:date_availability`],navigationIds:[]})});
export const model={name:'gpt-4o',complete:async(messages)=>{
  const last=messages.at(-1);
  if(last.role==='system'&&last.content.startsWith('Fresh backend'))return final();
  if(last.role==='tool') {
    const out=JSON.parse(last.content);
    if(out.diagnostic)return final();
    return call('diagnose_vehicle_availability',{vehicleId:vehicle,operation:'date_availability',startDate:'2026-09-15',endDate:'2026-09-18',customerTimezone:'America/New_York',pickupLocationId:null});
  }
  return call('resolve_authorized_entity',{kind:'vehicle',query:vehicle});
}};
export const clock={today:(zone,now)=>formatInTimeZone(new Date(now),zone,'yyyy-MM-dd'),timestamp:(date,time,zone)=>fromZonedTime(`${date}T${time}`,zone).getTime()};
