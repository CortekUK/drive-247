import type { FinancePayment, FinanceTenant, HoldLink, PaymentRoute, StripeMapping, StripePaymentEvidence } from './finance-types.ts';
import { HOLD_LINK_LIMIT } from './finance-reads.ts';

/** Direct charges on connected accounts began here (commit 28977d74). Earlier card payments were
 * created on a Drive247 platform account (platform-only, then destination charges). */
export const DIRECT_CHARGE_ERA='2026-01-13T00:00:00Z';
export type RouteReason='not_stripe'|'no_stripe_reference'|'platform_unrecorded'|'platform_era'|'environment_unrecorded'|'account_unproven'|'shared_test_account'|'account_not_exclusive'|'mapping_conflict';
export type RouteResult={ok:true;route:PaymentRoute}|{ok:false;reason:RouteReason};
export const ROUTE_REASON_TEXT:Record<RouteReason,string>={
  not_stripe:'This payment was not taken through Stripe, so there is no Stripe transaction to open.',
  no_stripe_reference:'Drive247 has no Stripe transaction reference for this payment (for example one recorded by hand or by the portal), so there is nothing to look up in Stripe.',
  platform_unrecorded:'The Stripe platform this payment used is not recorded, so no Stripe account was searched.',
  platform_era:'This payment was created before 13 January 2026, when Drive247 created card payments on its own platform account rather than directly in the connected account. Verifying it needs a reviewed historical mapping, so no account was searched.',
  environment_unrecorded:'Drive247 did not record whether this payment used Stripe live or test mode, so no account was searched. A reviewed historical mapping is needed.',
  account_unproven:'Drive247 cannot prove which Stripe account received this payment (the connected account may have changed since), so no account was searched. A reviewed historical mapping is needed.',
  shared_test_account:'This is a test-mode payment on Drive247’s shared test account, which is not your Stripe account, so it cannot be opened in your Stripe dashboard.',
  account_not_exclusive:'The recorded Stripe account is linked to more than one Drive247 business, so its records cannot be attributed safely. No lookup was attempted.',
  mapping_conflict:'The reviewed payment mapping does not match this payment’s recorded platform or environment, so it was not used.',
};
const INTENT=/^pi_[A-Za-z0-9]+$/,SESSION=/^cs_(live|test)_[A-Za-z0-9]+$/,ACCOUNT=/^acct_[A-Za-z0-9]+$/;
export function stripeRefs(p:FinancePayment):{intentId:string|null;sessionId:string|null;sessionMode:'live'|'test'|null} {
  const intentId=p.stripe_payment_intent_id&&INTENT.test(p.stripe_payment_intent_id)?p.stripe_payment_intent_id:null;
  const match=p.stripe_checkout_session_id?SESSION.exec(p.stripe_checkout_session_id):null;
  return {intentId,sessionId:match?p.stripe_checkout_session_id:null,sessionMode:match?match[1] as 'live'|'test':null};
}
export function accountLabel(route:Pick<PaymentRoute,'accountId'|'accountType'>):string {
  const tail=route.accountId.slice(-4);
  return route.accountType==='standard'?`your Stripe account ending ${tail}`:`Drive247-managed Stripe Express account ending ${tail}`;
}
export interface RouteContext {
  tenant:FinanceTenant; mappings:StripeMapping[]; holdLinks:HoldLink[]|null;
  sharedTestAccountId?:string; owners:(accountId:string)=>Promise<number>;
}
const time=(value:string|null|undefined)=>value?Date.parse(value):NaN;
/** Decides where one payment's Stripe objects live, from recorded evidence only.
 * Never guesses, never searches other accounts and never routes an older payment to a newer account. */
export async function resolvePaymentRoute(p:FinancePayment,ctx:RouteContext):Promise<RouteResult> {
  if(p.payment_provider!=='stripe')return {ok:false,reason:'not_stripe'};
  const refs=stripeRefs(p);
  if(!refs.intentId&&!refs.sessionId)return {ok:false,reason:'no_stripe_reference'};
  if(p.platform_account!=='uk'&&p.platform_account!=='uae')return {ok:false,reason:'platform_unrecorded'};
  const platform=p.platform_account as 'uk'|'uae',accountType=platform==='uae'?'standard' as const:'express' as const;
  const finish=async(route:Omit<PaymentRoute,'exclusive'|'strictOwnership'>):Promise<RouteResult>=>{
    if(!ACCOUNT.test(route.accountId))return {ok:false,reason:'account_unproven'};
    if(ctx.sharedTestAccountId&&route.accountId===ctx.sharedTestAccountId)return {ok:false,reason:'shared_test_account'};
    const owners=await ctx.owners(route.accountId);
    if(owners>1)return {ok:false,reason:'account_not_exclusive'};
    return {ok:true,route:{...route,exclusive:owners===1,strictOwnership:owners!==1}};
  };
  // 1. A reviewed historical mapping is the strongest evidence.
  const mapping=ctx.mappings.find(m=>m.tenantId===ctx.tenant.id&&m.paymentId===p.id);
  if(mapping){
    if(mapping.platform!==platform||(refs.sessionMode&&refs.sessionMode!==mapping.mode))return {ok:false,reason:'mapping_conflict'};
    return finish({platform,mode:mapping.mode,accountId:mapping.accountId,accountType,basis:'reviewed_mapping'});
  }
  const created=time(p.created_at??p.paid_at);
  if(!Number.isFinite(created)||created<Date.parse(DIRECT_CHARGE_ERA))return {ok:false,reason:'platform_era'};
  // 2. The deposit-hold record for this exact PaymentIntent names its account and environment.
  const links=ctx.holdLinks??[];
  const exact=refs.intentId?links.find(l=>l.payment_intent_id===refs.intentId&&l.platform_account===platform&&(l.stripe_mode==='live'||l.stripe_mode==='test')&&!!l.connect_account_id&&ACCOUNT.test(l.connect_account_id)):undefined;
  // Environment comes only from the recorded Checkout Session prefix or that exact hold record.
  const mode=refs.sessionMode??(exact?exact.stripe_mode as 'live'|'test':null);
  if(!mode)return {ok:false,reason:'environment_unrecorded'};
  if(exact&&exact.stripe_mode===mode)return finish({platform,mode,accountId:exact.connect_account_id!,accountType,basis:'hold_record'});
  if(platform==='uae'){
    const account=mode==='live'?ctx.tenant.own_stripe_account_id:ctx.tenant.own_stripe_test_account_id;
    if(!account)return {ok:false,reason:mode==='test'?'shared_test_account':'account_unproven'};
    // 3. The current own account was connected before this payment, so the payment cannot predate it.
    const connected=time(ctx.tenant.own_stripe_connected_at);
    if(!Number.isFinite(connected)||connected>created)return {ok:false,reason:'account_unproven'};
    return finish({platform,mode,accountId:account,accountType,basis:'connected_before_payment'});
  }
  // Managed test-mode payments used Drive247's shared test account.
  if(mode==='test')return {ok:false,reason:'shared_test_account'};
  const account=ctx.tenant.stripe_account_id;
  // 4. Managed accounts record no connection time. Require complete hold history showing this same
  // account in use since before the payment, and no other account ever recorded for live UK holds.
  if(!account||ctx.holdLinks===null||ctx.holdLinks.length>HOLD_LINK_LIMIT)return {ok:false,reason:'account_unproven'};
  const history=links.filter(l=>l.platform_account==='uk'&&l.stripe_mode==='live'&&l.connect_account_id);
  if(!history.length||history.some(l=>l.connect_account_id!==account)||!(time(history[0].created_at)<=created))return {ok:false,reason:'account_unproven'};
  return finish({platform,mode,accountId:account,accountType,basis:'hold_history_continuity'});
}
export interface PaymentAction { kind:'stripe_dashboard'|'receipt'; label:'Open in Stripe'|'View receipt'; href:string; note:string }
/** Server-built destinations for a verified object only. The model never supplies URLs or accounts. */
export function paymentActions(route:PaymentRoute,e:StripePaymentEvidence):{actions:PaymentAction[];limitation:string|null} {
  const actions:PaymentAction[]=[];let limitation:string|null=null;
  if(e.intentId&&e.livemode===(route.mode==='live')&&route.accountType==='standard'&&route.exclusive&&!e.platformFlow){
    actions.push({kind:'stripe_dashboard',label:'Open in Stripe',href:`https://dashboard.stripe.com/${route.mode==='test'?'test/':''}payments/${e.intentId}`,
      note:`Sign in to ${accountLabel(route)}${route.mode==='test'?' with test mode on':''}.`});
  }else if(e.intentId&&route.accountType==='express'){
    limitation='This payment is in a Drive247-managed Stripe Express account. Stripe Express has no direct link to a single payment, so use Open Stripe on the Stripe card in Integrations and look for the Stripe reference shown.';
  }else if(e.intentId&&!route.exclusive){
    limitation='The Stripe account that holds this payment is no longer linked to your Drive247 business, so no dashboard link is offered.';
  }else if(e.intentId&&e.platformFlow){
    limitation='This payment was created with a platform payment flow, so it is not opened as a direct payment in your dashboard.';
  }else if(!e.intentId){
    limitation='This checkout has no completed Stripe payment, so there is no transaction to open.';
  }
  if(e.receiptUrl)actions.push({kind:'receipt',label:'View receipt',href:e.receiptUrl,note:'The customer’s Stripe receipt. It is not the dashboard payment page.'});
  return {actions,limitation};
}
