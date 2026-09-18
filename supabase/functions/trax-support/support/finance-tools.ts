import { canView } from './auth.ts';
import { validateEntity, runTool, type ToolContext } from './registry.ts';
import { object, onlyKeys, SupportError, UUID } from './types.ts';
import type { OperationalResult } from './operational-types.ts';
import { financeScopes, type FinancePolicy, type FinanceServices, type FinanceScope, type StripeMapping } from './finance-types.ts';
import { FINANCE_LIMIT, createFinanceReads, type FinanceDatabase } from './finance-reads.ts';
import { recordedMinorUnits, stripeMoney, hasStripeReadKey } from './stripe-readonly.ts';
import { configuredReadOnlyStripe } from './stripe-remote.ts';

/** Who may use payment checks comes from Supabase staff roles/permissions (financeScopes);
 * the only server configuration left is the optional reviewed historical mapping list. */
export function configuredFinancePolicy(mappingsText:string|undefined):FinancePolicy {
  try {
    const mappings=JSON.parse(mappingsText??'[]');
    if(!Array.isArray(mappings)||mappings.length>2000)throw Error();
    const mappingKeys=new Set<string>();
    for(const raw of mappings){const m=object(raw);onlyKeys(m,['tenantId','paymentId','platform','mode','accountId','currency','verifiedAt']);const key=`${m.tenantId}:${m.paymentId}`;
      if(!UUID.test(String(m.tenantId))||!UUID.test(String(m.paymentId))||!['uk','uae'].includes(String(m.platform))||!['test','live'].includes(String(m.mode))||!/^acct_[A-Za-z0-9]+$/.test(String(m.accountId))||! /^[A-Z]{3}$/.test(String(m.currency))||!/^\d{4}-\d{2}-\d{2}$/.test(String(m.verifiedAt))||!Number.isFinite(Date.parse(String(m.verifiedAt)))||mappingKeys.has(key))throw Error();mappingKeys.add(key);}
    return {mappings};
  }catch{throw new SupportError('finance_configuration_invalid','The read-only finance policy needs administrator review.',503);}
}
/**
 * Stripe payment investigation is configured when a RESTRICTED read key exists —
 * the configuration itself is the switch, so no separate environment variable has
 * to say "yes" about keys that are either present or not.
 *
 * `TRAX_FINANCE_READS=disabled` still turns it off outright, and `=enabled` is
 * still honoured for an environment that wants it on with the remote reader (the
 * deployed trax-stripe-read function) rather than local keys.
 *
 * Without a restricted key this returns undefined, so the finance tools are not
 * offered at all and TRAX hands a payment question to a person — which is the
 * honest answer when it cannot check the provider.
 */
export function configuredFinance(db:FinanceDatabase,env:(key:string)=>string|undefined):FinanceServices|undefined {
  const setting=env('TRAX_FINANCE_READS');
  if(setting==='disabled')return undefined;
  if(setting!=='enabled'&&!hasStripeReadKey(env))return undefined;
  return {policy:configuredFinancePolicy(env('TRAX_STRIPE_RECORD_MAPPINGS')),reads:createFinanceReads(db),stripe:configuredReadOnlyStripe(env),sharedTestAccountId:env('STRIPE_TEST_CONNECT_ACCOUNT_ID')};
}
export interface FinanceToolContext extends ToolContext {finance:FinanceServices;now:number;signal:AbortSignal}
export function requireScope(env:FinanceToolContext,scope:FinanceScope) {
  if(!financeScopes(env.auth,env.finance.policy).includes(scope))throw new SupportError('finance_restricted','This payment information is unavailable for your current access.',403);
}
export function result(env:FinanceToolContext):OperationalResult {return {status:'verified',observedAt:new Date(env.now).toISOString(),findings:[],sources:[],navigation:[],checks:[],limitations:[]};}
export function partial(r:OperationalResult,reason:string):OperationalResult {r.status='partial';r.limitations.push(reason);return r;}
export async function rentalRows(env:FinanceToolContext,rentalId:unknown) {
  requireScope(env,'rental_payments');
  if(typeof rentalId!=='string'||!UUID.test(rentalId)||!canView(env.auth,'rentals'))throw new SupportError('record_unavailable','This record is unavailable.',403);
  await validateEntity(env,{kind:'rental',id:rentalId});
  const tenant=env.auth.tenant.id,reads=env.finance.reads;
  const entries=await reads.entries(tenant,rentalId);
  if(entries.length>FINANCE_LIMIT)return null;
  if(entries.some(e=>e.tenant_id!==tenant||e.rental_id!==rentalId||!UUID.test(e.id)))throw new SupportError('record_unavailable','This record is unavailable.',403);
  const chargeIds=entries.filter(e=>e.type==='Charge').map(e=>e.id),applications=await reads.applications(tenant,chargeIds);
  if(applications.length>FINANCE_LIMIT)return null;
  if(applications.some(a=>a.tenant_id!==tenant||!chargeIds.includes(a.charge_entry_id)||!UUID.test(a.payment_id)))throw new SupportError('record_unavailable','This record is unavailable.',403);
  const paymentIds=[...new Set(applications.map(a=>a.payment_id))],payments=await reads.payments(tenant,rentalId,paymentIds);
  if(payments.length>FINANCE_LIMIT)return null;
  if(payments.some(p=>p.tenant_id!==tenant||!UUID.test(p.id)||(p.rental_id!==rentalId&&!paymentIds.includes(p.id))))throw new SupportError('record_unavailable','This payment record is unavailable.',403);
  if(paymentIds.some(id=>!payments.some(p=>p.id===id)))throw new SupportError('finance_incomplete','Related payment records are incomplete or inaccessible. No complete financial conclusion is available.',503);
  return {entries,applications,payments};
}
export async function rentalSource(r:OperationalResult,env:FinanceToolContext,rentalId:string) {
  r.sources.push({id:`rentals:${rentalId}`,recordId:rentalId,table:'rentals',title:'Rental payment records',observedAt:r.observedAt});
  const nav=await runTool('resolve_navigation_target',{target:'rental',entityId:rentalId},env);
  if('action'in nav)r.navigation.push(nav.action);
}
const state=(s:string|null)=>s&&/^[a-zA-Z_ -]{1,40}$/.test(s)?s:'unrecognized';
export async function getRentalPaymentSummary(input:unknown,env:FinanceToolContext):Promise<OperationalResult> {
  const a=object(input);onlyKeys(a,['rentalId','offset']);
  const offset=a.offset??0;if(!Number.isInteger(offset)||Number(offset)<0||Number(offset)>=FINANCE_LIMIT)throw new SupportError('invalid_input','Use a valid payment page offset.');
  const rows=await rentalRows(env,a.rentalId),r=result(env);
  if(!rows)return partial(r,'The rental exceeds the 200-row investigation limit. No complete count or money total was calculated; use the existing Payments view or support.');
  await rentalSource(r,env,String(a.rentalId));
  r.checks=['rental_access','recorded_charges','payment_applications','direct_and_allocated_payments'];
  const page=rows.payments.slice(Number(offset),Number(offset)+25);
  r.data={rentalId:a.rentalId,totalLinkedPayments:rows.payments.length,completeRecordSet:true,nextOffset:Number(offset)+25<rows.payments.length?Number(offset)+25:null,
    payments:page.map(p=>({id:p.id,recordedStatus:state(p.status),recordedCaptureStatus:state(p.capture_status),recordedVerification:state(p.verification_status),provider:state(p.payment_provider),hasStripeIntent:!!p.stripe_payment_intent_id,hasCheckoutLink:!!p.stripe_checkout_session_id,recordedRefundStatus:state(p.refund_status),applicationCount:rows.applications.filter(x=>x.payment_id===p.id).length})),moneyTotals:null};
  r.findings.push({code:'linked_payments',summary:`Drive247 records ${rows.payments.length} linked payment record(s) and ${rows.entries.filter(e=>e.type==='Charge').length} charge entry/entries for this rental. Showing ${page.length} payment record(s). These are internal records, not proof of Stripe collection.`,sourceIds:r.sources.map(s=>s.id),blocking:false});
  if(rows.payments.some(p=>p.capture_status==='requires_capture'))r.findings.push({code:'authorization_hold',summary:'At least one payment is recorded as awaiting capture. An authorization hold must not be treated as collected money.',sourceIds:r.sources.map(s=>s.id),blocking:false});
  partial(r,'No rental money total is calculated: legacy ledger/payment rows lack historical currency provenance. Statuses are recorded state only; Stripe has not been checked by this tool.');
  return r;
}
export async function inspectRentalPayment(input:unknown,env:FinanceToolContext):Promise<OperationalResult> {
  const a=object(input);onlyKeys(a,['rentalId','paymentId']);
  if(typeof a.paymentId!=='string'||!UUID.test(a.paymentId))throw new SupportError('invalid_input','Choose an exact payment record from the rental payment check.');
  const rows=await rentalRows(env,a.rentalId),r=result(env);
  if(!rows)return partial(r,'Payment relationships exceed the bounded investigation limit. Use the existing Payments view or support.');
  const p=rows.payments.find(p=>p.id===a.paymentId);if(!p)throw new SupportError('record_unavailable','This payment record is unavailable.',403);
  await rentalSource(r,env,String(a.rentalId));r.checks=['rental_access','payment_relationship'];
  if(p.payment_provider!=='stripe')return partial(r,'This payment is not linked to the supported Stripe adapter. No processor was contacted.');
  const mapping=env.finance.policy.mappings.find(m=>m.tenantId===env.auth.tenant.id&&m.paymentId===p.id);
  if(!mapping||mapping.platform!==p.platform_account||!p.stripe_payment_intent_id)return partial(r,'An exact reviewed historical Stripe account/mode/currency mapping and PaymentIntent link are required. No account was guessed and no Stripe lookup was attempted.');
  const stripe=await env.finance.stripe.intent(mapping,p.stripe_payment_intent_id,env.signal);
  const current=await rentalRows(env,a.rentalId),currentPayment=current?.payments.find(row=>row.id===p.id);
  if(!currentPayment||JSON.stringify(currentPayment)!==JSON.stringify(p))throw new SupportError('finance_context_changed','The linked payment changed while it was being checked. Request a fresh check.',409);
  r.checks.push('stripe_payment_intent','expanded_latest_charge');
  const id=`payment_check:${p.id}`;r.sources.push({id,table:'payment_check',title:'Fresh linked Stripe payment check',observedAt:r.observedAt});
  const recorded=recordedMinorUnits(p.amount,mapping.currency),refund=p.refund_amount==null?null:recordedMinorUnits(p.refund_amount,mapping.currency);
  r.data={rentalId:a.rentalId,paymentId:p.id,stripe,recordedStatus:state(p.status),recordedCaptureStatus:state(p.capture_status),mappingVerifiedAt:mapping.verifiedAt};
  r.findings.push({code:'stripe_payment_state',summary:`Stripe ${stripe.mode} payment state: ${stripe.status}. Received ${stripe.received.display}; still capturable ${stripe.capturable.display}.${stripe.refunded?` Refunded ${stripe.refunded.display}.`:' Refund total is unavailable.'}`,sourceIds:[id],blocking:false});
  const differences:string[]=[];
  if(recorded!==null&&recorded!==stripe.requested.minorUnits)differences.push(`requested amount: Drive247 ${stripeMoney(recorded,mapping.currency).display}, Stripe ${stripe.requested.display}`);
  if(refund!==null&&stripe.refunded!==null&&refund!==stripe.refunded.minorUnits)differences.push(`refund: Drive247 ${stripeMoney(refund,mapping.currency).display}, Stripe ${stripe.refunded.display}`);
  if(p.capture_status==='captured'&&stripe.captured!==true)differences.push('Drive247 records captured; Stripe has no verified captured latest charge');
  if(p.capture_status==='requires_capture'&&stripe.capturable.minorUnits===0)differences.push('Drive247 records awaiting capture; Stripe reports nothing capturable');
  if(p.status==='Pending'&&stripe.status==='succeeded')differences.push('Drive247 records Pending; Stripe reports succeeded');
  if(differences.length){r.status='partial';r.findings.push({code:'payment_conflict',summary:`Drive247 and Stripe disagree: ${differences.join('; ')}. Support should review this; TRAX has changed neither system.`,sourceIds:[id,`rentals:${a.rentalId}`],blocking:false});}
  if(recorded===null||refund===null||!stripe.refunded)partial(r,'Some recorded amounts or refund evidence are incomplete. Do not infer a reconciled total.');
  r.limitations.push('This checks one mapped payment and its latest charge, not the rental balance, disputes, payout timing or all payment attempts. A hold is not a collected payment.');
  return r;
}
export async function getStripeAccountSummary(input:unknown,env:FinanceToolContext):Promise<OperationalResult> {
  const a=object(input);onlyKeys(a,[]);requireScope(env,'account_balance');
  const r=result(env),t=await env.finance.reads.tenant(env.auth.tenant.id);
  if(!t||t.id!==env.auth.tenant.id)throw new SupportError('finance_restricted','The account is unavailable.',403);
  if(t.payment_provider!=='stripe'||!['test','live'].includes(t.stripe_mode)||!['own','managed'].includes(t.payment_model))return partial(r,'This account does not have a verified supported Stripe configuration.');
  // Match getConnectAccountId/getChargePlatformAccount. Deliberately refuse
  // shared-test/platform fallback balances: those can include other tenants.
  const account=t.payment_model==='own'?(t.stripe_mode==='test'?t.own_stripe_test_account_id:t.own_stripe_account_id):(t.stripe_mode==='live'&&t.stripe_onboarding_complete?t.stripe_account_id:null);
  if(!account||(t.stripe_mode==='test'&&account===env.finance.sharedTestAccountId))return partial(r,'No exclusive connected account is configured. Shared test and platform balances cannot be reported as this tenant’s funds.');
  if(await env.finance.reads.accountOwners(account)!==1)return partial(r,'Exclusive connected-account ownership could not be verified. No Stripe balance was requested.');
  const mapping={platform:t.payment_model==='own'?'uae' as const:'uk' as const,mode:t.stripe_mode as 'test'|'live',accountId:account};
  const balance=await env.finance.stripe.balance(mapping,env.signal);
  const currentTenant=await env.finance.reads.tenant(env.auth.tenant.id);
  if(JSON.stringify(currentTenant)!==JSON.stringify(t)||await env.finance.reads.accountOwners(account)!==1)throw new SupportError('finance_context_changed','The account mapping changed while its funds were being checked. Request a fresh check.',409);
  r.checks=['exclusive_tenant_account','stripe_balance'];
  const id='stripe_account_summary';r.sources=[{id,table:'stripe_account_summary',title:'Fresh connected-account Stripe balance',observedAt:r.observedAt}];r.data={accountScope:'exclusive_connected_account',...balance};
  r.findings.push({code:'stripe_account_balance',summary:`Stripe ${balance.mode} account funds. Available: ${balance.available.map(m=>m.display).join('; ')||'no currency entries reported'}. Pending: ${balance.pending.map(m=>m.display).join('; ')||'no currency entries reported'}.`,sourceIds:[id],blocking:false});
  r.limitations=['Account-level funds only, not any rental’s balance. Currencies are separate; no conversion or payout-arrival guarantee is provided.'];return r;
}
export const FINANCE_TOOLS=Object.freeze({get_rental_payment_summary:getRentalPaymentSummary,inspect_rental_payment:inspectRentalPayment,get_stripe_account_summary:getStripeAccountSummary});
