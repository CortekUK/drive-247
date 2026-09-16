import { runTool } from './registry.ts';
import { object, onlyKeys, SupportError, UUID } from './types.ts';
import type { OperationalResult } from './operational-types.ts';
import type { FinancePayment, FinanceTenant, HoldLink, PaymentRoute, StripePaymentEvidence } from './finance-types.ts';
import { FINANCE_LIMIT } from './finance-reads.ts';
import { partial, rentalRows, rentalSource, result, type FinanceToolContext } from './finance-tools.ts';
import { recordedMinorUnits, stripeMoney } from './stripe-readonly.ts';
import { accountLabel, paymentActions, resolvePaymentRoute, ROUTE_REASON_TEXT, stripeRefs, type PaymentAction } from './payment-routing.ts';

export const PAYMENT_PAGE_SIZE=8;
export type VerificationResult='verified'|'discrepancy'|'offline'|'unable';
export interface PaymentCard {
  paymentId:string;
  reference:{internal:string;stripe:string|null};
  amount:{display:string;basis:'stripe'|'recorded'}|null;
  date:{display:string;basis:'stripe'|'recorded'}|null;
  drive247Status:string; stripeStatus:string|null;
  account:{label:string;mode:'live'|'test'}|null;
  verification:{result:VerificationResult;reason:string;detail:string};
  actions:PaymentAction[]; limitation:string|null;
}
export interface PaymentExplanation { kind:'evidence'|'suggestion'; text:string }
export interface PaymentReferenceSummary { paymentId:string; stripeReference:string|null; mode:'live'|'test'|null; account:string|null; verification:VerificationResult; reason:string; observedAt:string }
interface Checked { card:PaymentCard; evidence:StripePaymentEvidence|null; route:PaymentRoute|null; failed:'partial'|'error'|null }

const safeState=(s:string|null|undefined)=>s&&/^[a-zA-Z_ -]{1,40}$/.test(s)?s:'unrecorded';
const PAID_IN_DRIVE247=new Set(['Applied','Completed','Partial','Credit']);
function displayDate(value:number|string|null|undefined,timezone:string|null|undefined):string|null {
  if(value==null)return null;
  const ms=typeof value==='number'?value*1000:Date.parse(value);if(!Number.isFinite(ms))return null;
  let tz=timezone||'UTC';try{new Intl.DateTimeFormat('en-GB',{timeZone:tz});}catch{tz='UTC';}
  return `${new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(ms)} (${tz})`;
}
function recordedAmount(value:number|string):PaymentCard['amount'] {
  return /^-?\d{1,12}(?:\.\d{1,4})?$/.test(String(value))?{display:`${String(value)} as recorded in Drive247 (currency not stored on the payment)`,basis:'recorded'}:null;
}
function describeStripe(e:StripePaymentEvidence):string {
  if(!e.intentId)return e.sessionStatus==='expired'?'Checkout expired without payment':e.sessionStatus==='complete'?'Checkout complete, no payment linked':'Checkout not completed';
  switch(e.intentStatus){
    case 'succeeded':return e.fullyRefunded?'Refunded':e.refunded&&e.refunded.minorUnits>0?'Succeeded, partially refunded':'Succeeded (captured)';
    case 'requires_capture':return 'Authorized, not captured (hold)';
    case 'canceled':return 'Canceled, not collected';
    case 'processing':return 'Processing';
    default:return 'Not completed (failed or abandoned attempt)';
  }
}
function stripeAmount(e:StripePaymentEvidence):PaymentCard['amount'] {
  if(!e.intentId||!e.requested)return null;
  const refunded=e.refunded&&e.refunded.minorUnits>0?` · ${e.refunded.display} refunded`:'';
  if(e.intentStatus==='succeeded'&&e.capturedAmount)return {display:`${e.capturedAmount.display} captured${refunded}`,basis:'stripe'};
  if(e.intentStatus==='requires_capture'&&e.capturable)return {display:`${e.capturable.display} authorized, not captured`,basis:'stripe'};
  return {display:`${e.requested.display} attempted`,basis:'stripe'};
}
function differences(p:FinancePayment,e:StripePaymentEvidence,tenant:FinanceTenant):string[] {
  const out:string[]=[];
  // Recorded amounts carry no currency; compare only when the current account currency matches Stripe's.
  if(e.intentId&&e.currency&&e.requested&&tenant.currency_code?.toUpperCase()===e.currency){
    const recorded=recordedMinorUnits(p.amount,e.currency);
    if(recorded!==null&&recorded!==e.requested.minorUnits)out.push(`amount: Drive247 ${stripeMoney(recorded,e.currency).display}, Stripe ${e.requested.display}`);
    if(p.refund_amount!=null&&e.refunded){const refund=recordedMinorUnits(p.refund_amount,e.currency);if(refund!==null&&refund!==e.refunded.minorUnits)out.push(`refund: Drive247 ${stripeMoney(refund,e.currency).display}, Stripe ${e.refunded.display}`);}
  }
  const paid=PAID_IN_DRIVE247.has(p.status??'');
  if(!e.intentId&&paid)out.push('Drive247 records this as paid, but the Stripe checkout has no completed payment');
  if(e.intentId&&paid&&!['succeeded','requires_capture','processing'].includes(e.intentStatus??''))out.push(`Drive247 records ${safeState(p.status)}, but Stripe shows ${describeStripe(e).toLowerCase()}`);
  if(p.capture_status==='captured'&&e.intentId&&e.captured===false)out.push('Drive247 records captured; Stripe shows the charge was not captured');
  if(p.capture_status==='requires_capture'&&e.intentStatus==='succeeded')out.push('Drive247 records an uncaptured hold; Stripe shows it was captured');
  if(p.capture_status==='requires_capture'&&e.intentStatus==='canceled')out.push('Drive247 records an active hold; Stripe shows the authorization was canceled');
  if(p.status==='Pending'&&e.intentStatus==='succeeded')out.push('Drive247 records Pending; Stripe shows succeeded');
  return out;
}
const UNABLE:Record<string,{reason:string;detail:string;failed:'partial'|'error'}>={
  stripe_mapping_missing:{reason:'not_found_in_account',detail:'I could not find the linked Stripe transaction in the recorded account and environment, so I have not confirmed receipt of these funds. No other account was searched.',failed:'partial'},
  stripe_configuration_required:{reason:'stripe_not_configured',detail:'Read-only Stripe verification is not configured for this account and environment, so Stripe was not checked.',failed:'partial'},
  stripe_mapping_conflict:{reason:'record_mismatch',detail:'The Stripe record does not match this payment’s recorded account, environment or links, so it is not treated as this payment.',failed:'partial'},
  stripe_ownership_conflict:{reason:'record_mismatch',detail:'The Stripe record is linked to a different rental or business, so it is not treated as this payment.',failed:'partial'},
  stripe_ownership_unverified:{reason:'ownership_unverified',detail:'The Stripe record could not be verified as this rental’s payment, so it is not shown as a match.',failed:'partial'},
  currency_unverified:{reason:'currency_unverified',detail:'This transaction uses a currency whose amounts TRAX cannot verify yet.',failed:'partial'},
};
const READ_FAILED={reason:'stripe_unreachable',detail:'The Stripe check could not be completed right now. That does not mean the payment is missing; use Check again.',failed:'error' as const};

async function checkPayment(env:FinanceToolContext,p:FinancePayment,tenant:FinanceTenant,holdLinks:HoldLink[]|null,owners:(id:string)=>Promise<number>,rentalId:string):Promise<Checked> {
  const refs=stripeRefs(p);
  const base={paymentId:p.id,reference:{internal:p.id.slice(0,8),stripe:refs.intentId??refs.sessionId},
    drive247Status:`${safeState(p.status)}${p.capture_status?` · ${safeState(p.capture_status)}`:''}`,stripeStatus:null,account:null,actions:[] as PaymentAction[],limitation:null};
  const recordedDate=displayDate(p.paid_at??p.created_at,tenant.timezone);
  const recorded={amount:recordedAmount(p.amount),date:recordedDate?{display:recordedDate,basis:'recorded' as const}:null};
  const routed=await resolvePaymentRoute(p,{tenant,mappings:env.finance.policy.mappings,holdLinks,sharedTestAccountId:env.finance.sharedTestAccountId,owners});
  if(!routed.ok)return {card:{...base,...recorded,verification:{result:routed.reason==='not_stripe'?'offline':'unable',reason:routed.reason,detail:ROUTE_REASON_TEXT[routed.reason]}},evidence:null,route:null,failed:null};
  const route=routed.route,account={label:accountLabel(route),mode:route.mode};
  if(!env.finance.stripe.evidence)return {card:{...base,...recorded,account,verification:{result:'unable',...UNABLE.stripe_configuration_required}},evidence:null,route,failed:'partial'};
  try{
    const e=await env.finance.stripe.evidence(route,{intentId:refs.intentId,sessionId:refs.sessionId},{tenantId:env.auth.tenant.id,rentalId},env.signal);
    const diff=differences(p,e,tenant),{actions,limitation}=paymentActions(route,e);
    const stripeDate=e.createdAt!=null?displayDate(e.createdAt,tenant.timezone):null;
    return {evidence:e,route,failed:null,card:{...base,reference:{internal:base.reference.internal,stripe:e.intentId??e.sessionId},
      amount:stripeAmount(e)??recorded.amount,date:stripeDate?{display:stripeDate,basis:'stripe'}:recorded.date,stripeStatus:describeStripe(e),account,actions,limitation,
      verification:diff.length?{result:'discrepancy',reason:'records_disagree',detail:`Drive247 and Stripe disagree: ${diff.join('; ')}.`}
        :{result:'verified',reason:'stripe_confirmed',detail:`Verified in ${account.label} (Stripe ${route.mode} mode).`}}};
  }catch(error){
    const known=error instanceof SupportError?UNABLE[error.code]:undefined,outcome=known??READ_FAILED;
    return {card:{...base,...recorded,account,verification:{result:'unable',reason:outcome.reason,detail:outcome.detail}},evidence:null,route,failed:outcome.failed};
  }
}
function totals(checked:Checked[]) {
  const byCurrency=new Map<string,{captured:number;refunded:number;held:number}>();
  for(const {evidence:e} of checked){
    if(!e?.intentId||!e.currency)continue;
    const t=byCurrency.get(e.currency)??{captured:0,refunded:0,held:0};
    // One PaymentIntent and its latest charge are one payment; transfers are never counted.
    if(e.intentStatus==='succeeded'&&e.captured&&e.capturedAmount)t.captured+=e.capturedAmount.minorUnits;
    if(e.refunded)t.refunded+=e.refunded.minorUnits;
    if(e.intentStatus==='requires_capture'&&e.capturable)t.held+=e.capturable.minorUnits;
    byCurrency.set(e.currency,t);
  }
  return [...byCurrency].sort(([a],[b])=>a.localeCompare(b)).map(([currency,t])=>({currency,captured:stripeMoney(t.captured,currency).display,refunded:stripeMoney(t.refunded,currency).display,heldNotCaptured:stripeMoney(t.held,currency).display}));
}
function memoOwners(env:FinanceToolContext) {
  const cache=new Map<string,Promise<number>>();
  return (id:string)=>{if(!cache.has(id))cache.set(id,env.finance.reads.accountOwners(id));return cache.get(id)!;};
}
async function context(env:FinanceToolContext) {
  const tenant=await env.finance.reads.tenant(env.auth.tenant.id);
  if(!tenant||tenant.id!==env.auth.tenant.id)throw new SupportError('finance_restricted','This payment information is unavailable for your current access.',403);
  const holdLinks=env.finance.reads.holdLinks?await env.finance.reads.holdLinks(env.auth.tenant.id):null;
  if(holdLinks?.some(l=>l.tenant_id!==env.auth.tenant.id))throw new SupportError('record_unavailable','This record is unavailable.',403);
  return {tenant,holdLinks};
}
const routingFields=(t:FinanceTenant)=>JSON.stringify([t.id,t.currency_code,t.payment_provider,t.payment_model,t.stripe_mode,t.stripe_account_id,t.own_stripe_account_id,t.own_stripe_test_account_id,t.own_stripe_connected_at,t.timezone]);
/** Provider results are discarded if the linked records or routing inputs changed during the read. */
async function ensureUnchanged(env:FinanceToolContext,rentalId:string,checked:FinancePayment[],tenant:FinanceTenant) {
  const current=await rentalRows(env,rentalId),fresh=await env.finance.reads.tenant(env.auth.tenant.id);
  const same=(p:FinancePayment)=>JSON.stringify(current?.payments.find(row=>row.id===p.id))===JSON.stringify(p);
  if(!current||!fresh||routingFields(fresh)!==routingFields(tenant)||!checked.every(same))throw new SupportError('finance_context_changed','The linked payment records changed while they were being checked. Request a fresh check.',409);
}
function addEvidenceSource(r:OperationalResult,rentalId:string) {
  const id=`payment_evidence:${rentalId}`;
  r.sources.push({id,table:'payment_evidence',recordId:rentalId,title:'Fresh rental payment verification',observedAt:r.observedAt});
  return id;
}

export async function getRentalPaymentEvidence(input:unknown,env:FinanceToolContext):Promise<OperationalResult> {
  const a=object(input);onlyKeys(a,['rentalId','offset']);
  const offset=a.offset??0;
  if(!Number.isInteger(offset)||Number(offset)<0||Number(offset)>=FINANCE_LIMIT)throw new SupportError('invalid_input','Use a valid payment page offset.');
  const rows=await rentalRows(env,a.rentalId),r=result(env);
  if(!rows)return partial(r,'The rental exceeds the 200-row investigation limit. No complete list or money total was calculated; use the rental’s Payments stage or support.');
  const rentalId=String(a.rentalId),{tenant,holdLinks}=await context(env),owners=memoOwners(env);
  const ordered=[...rows.payments].sort((x,y)=>String(x.created_at??'').localeCompare(String(y.created_at??''))||x.id.localeCompare(y.id));
  const page=ordered.slice(Number(offset),Number(offset)+PAYMENT_PAGE_SIZE);
  const checked:Checked[]=[];
  for(let i=0;i<page.length;i+=4)checked.push(...await Promise.all(page.slice(i,i+4).map(p=>checkPayment(env,p,tenant,holdLinks,owners,rentalId))));
  await ensureUnchanged(env,rentalId,page,tenant);
  await rentalSource(r,env,rentalId);const sourceId=addEvidenceSource(r,rentalId);
  r.checks=['rental_access','recorded_charges','payment_applications','direct_and_allocated_payments','payment_routing','stripe_linked_transactions'];
  const cards=checked.map(c=>c.card),nextOffset=Number(offset)+PAYMENT_PAGE_SIZE<ordered.length?Number(offset)+PAYMENT_PAGE_SIZE:null;
  const count=(result:VerificationResult)=>cards.filter(c=>c.verification.result===result).length;
  const moneyTotals=totals(checked);
  r.data={rentalId,totalLinkedPayments:ordered.length,offset,nextOffset,checkedPayments:cards.length,
    payments:cards.map(c=>({id:c.paymentId,reference:c.reference.internal,verification:c.verification.result})),
    paymentCards:cards,totals:moneyTotals,coverage:nextOffset===null?'all_linked_payments':'this_page_only'};
  const sourceIds=[sourceId,`rentals:${rentalId}`];
  r.findings.push({code:'payment_evidence_summary',summary:ordered.length?`Drive247 links ${ordered.length} payment record(s) to this rental. Checked ${cards.length}: ${count('verified')} verified in Stripe, ${count('discrepancy')} with differences, ${count('unable')} not verifiable, ${count('offline')} not taken through Stripe.`:'Drive247 has no payment records linked to this rental.',sourceIds,blocking:false});
  for(const t of moneyTotals)r.findings.push({code:'stripe_verified_totals',summary:`Verified in Stripe (${t.currency}): captured ${t.captured}; refunded ${t.refunded}; authorized but not captured ${t.heldNotCaptured}. Only payments verified in Stripe are included${nextOffset!==null?', for this page':''}.`,sourceIds,blocking:false});
  for(const c of cards.filter(c=>c.verification.result==='discrepancy'))r.findings.push({code:'payment_conflict',summary:`Payment ${c.reference.internal}: ${c.verification.detail} TRAX changed neither system.`,sourceIds,blocking:false});
  if(nextOffset!==null)partial(r,`Only ${cards.length} of ${ordered.length} linked payments were checked on this page. Ask to see more payments for the rest.`);
  if(cards.some(c=>c.verification.result==='unable'||c.verification.result==='discrepancy'))r.status='partial';
  const routable=checked.filter(c=>c.route);
  if(routable.length&&routable.every(c=>c.failed==='error'))r.status='error';
  r.limitations.push('Totals come only from Stripe-verified transactions in their original currencies. They do not replace the rental’s Drive247 balance or allocation rules, and say nothing about payouts or bank arrival.');
  return r;
}

function explain(c:Checked):PaymentExplanation[] {
  const out:PaymentExplanation[]=[],{card,evidence:e,route}=c;
  if((card.verification.result==='verified'||card.verification.result==='discrepancy')&&route&&e){
    out.push({kind:'evidence',text:`I verified this transaction in ${card.account!.label} in Stripe ${route.mode} mode.`});
    if(card.verification.result==='discrepancy')out.push({kind:'evidence',text:card.verification.detail});
    if(e.intentStatus==='requires_capture')out.push({kind:'evidence',text:'It is an authorization hold that has not been captured, so it has not collected money yet.'});
    else if(e.intentStatus==='canceled')out.push({kind:'evidence',text:'The authorization was canceled, so this attempt did not collect money.'});
    else if(e.intentId&&!['succeeded','processing'].includes(e.intentStatus??''))out.push({kind:'evidence',text:'Stripe shows this attempt did not complete, so it did not collect money.'});
    else if(!e.intentId)out.push({kind:'evidence',text:'The checkout in Stripe has no completed payment.'});
    if(e.refunded&&e.refunded.minorUnits>0)out.push({kind:'evidence',text:`Stripe shows ${e.refunded.display} refunded on this charge.`});
    if(route.mode==='test')out.push({kind:'evidence',text:'It is a test-mode transaction, so Stripe shows it only while test mode is on.'});
    if(card.actions.some(x=>x.kind==='stripe_dashboard'))out.push({kind:'evidence',text:'Use Open in Stripe while signed in to the account shown.'});
    if(card.limitation)out.push({kind:'evidence',text:card.limitation});
    if(route.accountType==='standard')out.push({kind:'suggestion',text:`If Stripe still does not show it, check that Stripe is signed in to the account shown${route.mode==='test'?' and that test mode is on':''}. TRAX cannot see your Stripe screen.`});
  }else out.push({kind:'evidence',text:card.verification.detail});
  return out;
}
async function singlePayment(input:unknown,env:FinanceToolContext,purpose:'investigate'|'action'):Promise<OperationalResult> {
  const a=object(input);onlyKeys(a,['rentalId','paymentId']);
  if(typeof a.paymentId!=='string'||!UUID.test(a.paymentId))throw new SupportError('invalid_input','Choose a payment from the rental payment check.');
  const rows=await rentalRows(env,a.rentalId),r=result(env);
  if(!rows)return partial(r,'Payment relationships exceed the bounded investigation limit. Use the rental’s Payments stage or support.');
  const rentalId=String(a.rentalId),p=rows.payments.find(row=>row.id===a.paymentId);
  if(!p)throw new SupportError('record_unavailable','This payment record is unavailable.',403);
  const {tenant,holdLinks}=await context(env);
  const c=await checkPayment(env,p,tenant,holdLinks,memoOwners(env),rentalId);
  await ensureUnchanged(env,rentalId,[p],tenant);
  await rentalSource(r,env,rentalId);const sourceId=addEvidenceSource(r,rentalId);
  r.checks=['rental_access','payment_relationship','payment_routing','stripe_linked_transactions'];
  if(c.card.limitation&&c.route?.accountType==='express'){
    try{const nav=await runTool('resolve_navigation_target',{target:'integrations'},env);if('action' in nav)r.navigation.push(nav.action);}catch{/* Integrations is not available to this user. */}
  }
  const explanations=purpose==='investigate'?explain(c):[];
  r.data={rentalId,paymentId:p.id,payments:[{id:p.id,reference:c.card.reference.internal,verification:c.card.verification.result}],paymentCards:[c.card],explanations};
  const code={verified:'payment_verified',discrepancy:'payment_conflict',unable:'payment_unverified',offline:'payment_not_stripe'}[c.card.verification.result];
  r.findings.push({code,summary:`Payment ${c.card.reference.internal}: ${c.card.verification.detail}${c.card.stripeStatus?` Stripe status: ${c.card.stripeStatus}.`:''}`,sourceIds:[sourceId,`rentals:${rentalId}`],blocking:false});
  if(purpose==='action'&&!c.card.actions.length)r.findings.push({code:'payment_link_unavailable',summary:c.card.limitation??c.card.verification.detail,sourceIds:[sourceId],blocking:false});
  if(c.card.verification.result==='discrepancy'||c.card.verification.result==='unable')r.status='partial';
  if(c.failed==='error')r.status='error';
  r.limitations.push('This checks the exactly linked Stripe records for one payment. It does not check payouts, bank arrival, disputes or every historical attempt.');
  return r;
}
export const investigateRentalPayment=(input:unknown,env:FinanceToolContext)=>singlePayment(input,env,'investigate');
export const resolvePaymentDashboardAction=(input:unknown,env:FinanceToolContext)=>singlePayment(input,env,'action');
export function paymentReferences(r:OperationalResult):PaymentReferenceSummary[] {
  const cards=Array.isArray(r.data?.paymentCards)?r.data!.paymentCards as PaymentCard[]:[];
  return cards.map(c=>({paymentId:c.paymentId,stripeReference:c.reference.stripe,mode:c.account?.mode??null,account:c.account?.label??null,verification:c.verification.result,reason:c.verification.reason,observedAt:r.observedAt}));
}
export const PAYMENT_INVESTIGATION_TOOLS=Object.freeze({get_rental_payment_evidence:getRentalPaymentEvidence,investigate_rental_payment:investigateRentalPayment,resolve_payment_dashboard_action:resolvePaymentDashboardAction});
