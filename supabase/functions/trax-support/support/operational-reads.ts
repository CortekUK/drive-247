import { SupportError } from './types.ts';
import { RELEASED_RENTAL_STATUSES, applyCheckoutOverlap } from './availability-rules.generated.js';
import type { OperationalReads } from './operational-types.ts';

export const VEHICLE_COLUMNS = 'id,tenant_id,reg,make,model,status,is_paused,is_disposed,show_on_website,pickup_location_id,available_daily,available_weekly,available_monthly';
export const RENTAL_COLUMNS = 'id,tenant_id,vehicle_id,rental_number,status,start_date,end_date,return_time,is_pay_as_you_go,payg_closed_at';
interface Query extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: string): Query; ilike(column: string, value: string): Query;
  not(column: string, op: string, value: string): Query; or(filter: string): Query;
  lte(column: string, value: string): Query; gte(column: string, value: string): Query;
  order(column: string, options?: {ascending: boolean}): Query;
  limit(count: number): Query;
  maybeSingle(): PromiseLike<{data: unknown; error: unknown}>;
}
export interface OperationalDatabase { from(table: string): {select(columns: string): Query} }
/** No SDK/client reaches the model; every query is fixed here. No notes, contact
 * details, identity documents, prices, balances, or relationship repair. */
export function createOperationalReads(db: OperationalDatabase): OperationalReads {
  async function read<T>(q: PromiseLike<{data: unknown; error: unknown}>): Promise<T> {
    const result = await q;
    if (result.error) throw new SupportError('live_read_failed', 'A live record check failed. No complete conclusion is available.', 503);
    return result.data as T;
  }
  const vehicles = (tenant: string) => db.from('vehicles').select(VEHICLE_COLUMNS).eq('tenant_id', tenant);
  const rentals = (tenant: string) => db.from('rentals').select(RENTAL_COLUMNS).eq('tenant_id', tenant);
  return {
    vehicle: (t,id) => read(vehicles(t).eq('id',id).maybeSingle()),
    rental: (t,id) => read(rentals(t).eq('id',id).maybeSingle()),
    findVehicles: (t,q,exact) => read((exact ? vehicles(t).ilike('reg',q) : vehicles(t).or(`make.ilike.*${q}*,model.ilike.*${q}*`)).order('id').limit(6)),
    findRentals: (t,q) => read(rentals(t).ilike('rental_number',q).order('id').limit(6)),
    config: (t) => read(db.from('tenants').select('id,buffer_time_minutes,monthly_tier_days').eq('id',t).maybeSingle()),
    location: (t,id) => read(db.from('pickup_locations').select('id,tenant_id').eq('tenant_id',t).eq('id',id).maybeSingle()),
    findLocations: (t,name) => read(db.from('pickup_locations').select('id,tenant_id,name').eq('tenant_id',t).ilike('name',name).order('id').limit(6)),
    occupancy: (t,v,operation,start,end) => {
      let q = rentals(t).eq('vehicle_id',v);
      // V2 createBooking courtesy precheck includes Completed. Never invoke the
      // write function or its overlap trigger to obtain a diagnostic.
      q = operation === 'booking_rejection'
        ? applyCheckoutOverlap(q,start,end)
        : q.not('status','in',RELEASED_RENTAL_STATUSES);
      return read(q.order('start_date').order('id').limit(201));
    },
    blocks: (t,v,start,end) => read(db.from('blocked_dates').select('id,tenant_id,vehicle_id,start_date,end_date').eq('tenant_id',t).or(`vehicle_id.eq.${v},vehicle_id.is.null`).lte('start_date',end).gte('end_date',start).order('id').limit(201)),
    completed: (t,v,from,through) => read(rentals(t).eq('vehicle_id',v).eq('status','Completed').gte('end_date',from).lte('end_date',through).order('end_date').order('id').limit(201)),
    receiving: (t,r) => read(db.from('rental_key_handovers').select('id,tenant_id,rental_id,handover_type,handed_at').eq('tenant_id',t).eq('rental_id',r).eq('handover_type','receiving').order('created_at',{ascending:false}).limit(3)),
  };
}
