import type { FinanceReads, FinancePayment, FinanceEntry, FinanceApplication, FinanceTenant, HoldLink } from './finance-types.ts';
import { SupportError, UUID } from './types.ts';

interface Query extends PromiseLike<{data:unknown;error:unknown;count?:number|null}> {
  eq(k:string,v:string):Query; in(k:string,v:string[]):Query; or(filter:string):Query;
  order(k:string):Query; limit(n:number):Query;
  maybeSingle():PromiseLike<{data:unknown;error:unknown}>;
}
export interface FinanceDatabase {from(table:string):{select(columns:string,options?:{count:'exact';head:true}):Query}}
export const FINANCE_LIMIT=200;
export const HOLD_LINK_LIMIT=1000;
export const FINANCE_PAYMENT_COLUMNS='id,tenant_id,rental_id,amount,status,capture_status,verification_status,payment_type,payment_provider,platform_account,stripe_payment_intent_id,stripe_checkout_session_id,refund_amount,refund_status,paid_at,created_at';
/** Fixed SELECTs only. In particular, never call fetch-payment-intent,
 * audit-stripe-payment, verify-deposit-hold or a relationship repair helper. */
export function createFinanceReads(db:FinanceDatabase):FinanceReads {
  const read=async<T>(q:PromiseLike<{data:unknown;error:unknown}>):Promise<T>=>{
    const result=await q;if(result.error)throw new SupportError('finance_read_failed','The payment record check failed. No complete financial result is available.',503);return result.data as T;
  };
  const ids=(values:string[])=>{if(values.length>FINANCE_LIMIT||values.some(id=>!UUID.test(id)))throw new SupportError('invalid_input','Invalid payment relationship.');return values;};
  return {
    tenant:t=>read<FinanceTenant|null>(db.from('tenants').select('id,currency_code,payment_provider,payment_model,stripe_mode,stripe_account_id,stripe_onboarding_complete,own_stripe_account_id,own_stripe_test_account_id,own_stripe_connected_at,own_stripe_test_connected_at,timezone').eq('id',t).maybeSingle()),
    entries:(t,r)=>read<FinanceEntry[]>(db.from('ledger_entries').select('id,tenant_id,rental_id,type,category,amount,remaining_amount').eq('tenant_id',t).eq('rental_id',r).order('id').limit(FINANCE_LIMIT+1)),
    applications:(t,charges)=>charges.length?read<FinanceApplication[]>(db.from('payment_applications').select('id,tenant_id,payment_id,charge_entry_id,amount_applied').eq('tenant_id',t).in('charge_entry_id',ids(charges)).order('id').limit(FINANCE_LIMIT+1)):Promise.resolve([]),
    payments:(t,r,pids)=>{
      if(!UUID.test(r))throw new SupportError('invalid_input','Invalid rental.');
      const related=ids(pids);return read<FinancePayment[]>(db.from('payments').select(FINANCE_PAYMENT_COLUMNS).eq('tenant_id',t).or(`rental_id.eq.${r}${related.length?`,id.in.(${related.join(',')})`:''}`).order('id').limit(FINANCE_LIMIT+1));
    },
    accountOwners:async account=>{
      if(!/^acct_[A-Za-z0-9]+$/.test(account))throw new SupportError('stripe_mapping_missing','The account mapping is unavailable.');
      const result=await db.from('tenants').select('id',{count:'exact',head:true}).or(`stripe_account_id.eq.${account},own_stripe_account_id.eq.${account},own_stripe_test_account_id.eq.${account}`);
      if(result.error||!Number.isSafeInteger(result.count)||Number(result.count)<0)throw new SupportError('stripe_mapping_missing','Exclusive account ownership could not be verified.',503);
      return result.count!;
    },
    // Historical account/environment evidence for this tenant only. A truncated history proves nothing.
    holdLinks:t=>read<HoldLink[]>(db.from('deposit_hold_links').select('tenant_id,rental_id,platform_account,stripe_mode,connect_account_id,payment_intent_id,created_at').eq('tenant_id',t).order('created_at').limit(HOLD_LINK_LIMIT+1)),
  };
}
