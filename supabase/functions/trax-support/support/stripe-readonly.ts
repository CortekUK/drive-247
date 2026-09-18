import { object, SupportError } from './types.ts';
import type { PaymentRoute, ReadOnlyStripe, StripeMapping, StripeMoney, StripePaymentEvidence } from './finance-types.ts';

// Stripe minor units, NOT payout divisibility rules. ISK/UGX remain /100.
// Unknown currencies fail closed until their API representation is reviewed.
const zero=new Set('BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF VND VUV XAF XOF XPF'.split(' '));
const two=new Set('USD GBP AED EUR AUD CAD CHF NZD SGD HKD INR PKR SAR QAR BDT THB PHP MYR IDR BRL MXN ZAR NOK SEK DKK PLN CZK RON RUB HUF TWD ISK UGX TRY COP ARS EGP MAD'.split(' '));
const three=new Set('BHD JOD KWD OMR TND'.split(' '));
export function stripeExponent(currency:string):number {
  const c=currency.toUpperCase();if(zero.has(c))return 0;if(two.has(c))return 2;if(three.has(c))return 3;
  throw new SupportError('currency_unverified','This currency’s minor-unit representation has not been verified. No amount is available.',503);
}
export function stripeMoney(amount:unknown,currency:unknown):StripeMoney {
  if(typeof currency!=='string'||!Number.isSafeInteger(amount))throw new SupportError('stripe_incomplete','Stripe returned an incomplete amount.',503);
  const c=currency.toUpperCase(),digits=stripeExponent(c),n=amount as number;
  // BigInt preserves all digits in API integers, without floating-point division.
  const a=BigInt(n),abs=a<BigInt(0)?-a:a,factor=BigInt(10)**BigInt(digits);
  return {currency:c,minorUnits:n,display:`${c} ${a<BigInt(0)?'-':''}${abs/factor}${digits?'.'+String(abs%factor).padStart(digits,'0'):''}`};
}
export function recordedMinorUnits(value:number|string,currency:string):number|null {
  const digits=stripeExponent(currency),s=String(value),match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if(!match||((match[3]??'').slice(digits).replace(/0/g,'').length>0))return null;
  const n=BigInt(match[2])*BigInt(10)**BigInt(digits)+BigInt((match[3]??'').slice(0,digits).padEnd(digits,'0')||'0');
  const signed=match[1]?-n:n;return signed>BigInt(Number.MAX_SAFE_INTEGER)||signed<BigInt(Number.MIN_SAFE_INTEGER)?null:Number(signed);
}
const failure=(code:string,message:string,status=503)=>new SupportError(code,message,status);
const INTENT=/^pi_[A-Za-z0-9]+$/,SESSION=/^cs_(?:live|test)_[A-Za-z0-9]+$/;
const RECEIPT=/^https:\/\/pay\.stripe\.com\/receipts\/[A-Za-z0-9/_-]{1,200}(?:\?[A-Za-z0-9=&_%-]{0,200})?$/;
const INTENT_STATUSES=['requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','canceled','succeeded'];
const metadataOf=(value:unknown):Record<string,string>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
};
/** The existing Supabase secrets, read by name at runtime exactly like _shared/stripe-client.ts. */
export const PLATFORM_SECRET_NAMES={uk:{live:'STRIPE_LIVE_SECRET_KEY',test:'STRIPE_TEST_SECRET_KEY'},uae:{live:'STRIPE_UAE_LIVE_SECRET_KEY',test:'STRIPE_UAE_TEST_SECRET_KEY'}} as const;
const restrictedName=(platform:string,mode:string)=>`TRAX_STRIPE_READ_${platform.toUpperCase()}_${mode.toUpperCase()}_KEY`;
/**
 * One secret can hold every platform/mode key: `{"uk":{"live":"rk_live_…"}}`.
 *
 * A separate variable per platform and mode is clearer, but it costs up to four
 * slots, and this project is at its secret limit with nothing safe to remove — the
 * unreferenced names all belong to integrations whose functions are still deployed.
 * Packing them costs one slot instead of four. The individual names win when both
 * are set, and a malformed blob yields no key rather than a partial guess.
 */
function packedReadKey(env:(key:string)=>string|undefined,platform:string,mode:string):string|undefined {
  const raw=env('TRAX_STRIPE_READ_KEYS');
  if(!raw||raw.length>4_000)return undefined;
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{return undefined;}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return undefined;
  const byPlatform=(parsed as Record<string,unknown>)[platform];
  if(!byPlatform||typeof byPlatform!=='object'||Array.isArray(byPlatform))return undefined;
  const value=(byPlatform as Record<string,unknown>)[mode];
  return typeof value==='string'?value:undefined;
}
/**
 * Which credential TRAX reads Stripe with, in order of preference.
 *
 *   1. `TRAX_STRIPE_READ_{PLATFORM}_{MODE}_KEY` — a restricted `rk_` key.
 *   2. `TRAX_STRIPE_READ_KEYS` — the same, packed into one secret.
 *   3. the existing platform secret for that platform and mode — a full-access `sk_`.
 *
 * (3) is a deliberate, recorded compromise. A restricted key is the better
 * credential and stays the documented preference, but this project is at Supabase's
 * 100-secret cap, no secret can be removed, and the platform keys are already here.
 *
 * It means the CREDENTIAL does not enforce read-only, so the CODE must. Read-only is
 * not "this file happens to contain only GETs" — `get` below refuses any path that
 * is not one of three exact shapes, before it so much as looks up a key, and the
 * returned object exposes no other method. A future write path cannot be added by
 * accident; it would have to defeat that allowlist deliberately.
 *
 * A key for the other mode, the other platform, or a publishable key, is never used,
 * and the restricted slots accept nothing but `rk_`.
 */
export function stripeReadKey(env:(key:string)=>string|undefined,platform:'uk'|'uae',mode:'test'|'live'):string|null {
  const restricted=env(restrictedName(platform,mode))??packedReadKey(env,platform,mode);
  if(restricted?.startsWith(`rk_${mode}_`))return restricted;
  const platformSecret=env(PLATFORM_SECRET_NAMES[platform][mode]);
  return platformSecret?.startsWith(`sk_${mode}_`)?platformSecret:null;
}
/** True when the credential in use is restricted at Stripe rather than only here. */
export function stripeKeyIsRestricted(env:(key:string)=>string|undefined,platform:'uk'|'uae',mode:'test'|'live'):boolean {
  return stripeReadKey(env,platform,mode)?.startsWith('rk_')===true;
}
/**
 * The only three Stripe endpoints that exist for TRAX. Checked against the fully
 * built path, so neither a caller nor the model can reach anything else — including
 * by traversal, by adding a parameter, or by naming a write endpoint.
 */
const ENDPOINTS=[
  /^balance$/,
  /^payment_intents\/pi_[A-Za-z0-9]+\?expand%5B%5D=latest_charge$/,
  /^checkout\/sessions\/cs_(?:live|test)_[A-Za-z0-9]+$/,
] as const;
/**
 * Exported so it can be tested as what it is: the boundary that keeps a full-access
 * key read-only. Testing it through `intent` would prove nothing, because the id
 * regex there rejects a bad path first — a test that passes for the wrong reason.
 */
export function isReadEndpoint(path:string):boolean {
  return ENDPOINTS.some(shape=>shape.test(path));
}
export function hasStripeReadKey(env:(key:string)=>string|undefined):boolean {
  return (['uk','uae'] as const).some(p=>(['live','test'] as const).some(m=>stripeReadKey(env,p,m)!==null));
}
/** Only three fixed GET shapes exist. There is no general request, SDK, write method,
 * platform-balance fallback or automatic retry. The key is never returned or logged. */
export function createReadOnlyStripe(env:(key:string)=>string|undefined,fetcher:typeof fetch=fetch):ReadOnlyStripe {
  async function get(mapping:Pick<StripeMapping,'platform'|'mode'|'accountId'>,path:string,signal:AbortSignal) {
    if(!['uk','uae'].includes(mapping.platform)||!['test','live'].includes(mapping.mode)||!/^acct_[A-Za-z0-9]+$/.test(mapping.accountId))throw failure('stripe_mapping_missing','A verified connected-account mapping is required.');
    // Before any credential is resolved: this must be one of the three read shapes.
    // The key may be a full-access platform secret, so this is what makes TRAX
    // read-only. It is checked here rather than at each call site so there is one
    // place to defeat, not three to keep in step.
    if(!isReadEndpoint(path))throw failure('stripe_read_refused','Only TRAX’s three read-only Stripe lookups are permitted.');
    const key=stripeReadKey(env,mapping.platform,mapping.mode);
    if(!key)throw failure('stripe_configuration_required','The Stripe key for this account and mode is not available to TRAX.');
    let response:Response;
    try{response=await fetcher(`https://api.stripe.com/v1/${path}`,{method:'GET',headers:{Authorization:`Bearer ${key}`,'Stripe-Account':mapping.accountId},redirect:'error',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(8_000)])});}
    catch{throw failure('stripe_read_failed','Stripe could not be reached. No live financial conclusion is available.');}
    if(response.status===404)throw failure('stripe_mapping_missing','The linked Stripe record is unavailable in its verified account and mode. No alternative account was searched.');
    if(!response.ok)throw failure('stripe_read_failed','The read-only Stripe check failed. No live amount is available.');
    const reader=response.body?.getReader();if(!reader)throw failure('stripe_incomplete','Stripe returned an incomplete response.');
    const chunks:Uint8Array[]=[];let bytes=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>128_000){await reader.cancel();throw Error();}chunks.push(value);}
      const data=new Uint8Array(bytes);let at=0;for(const c of chunks){data.set(c,at);at+=c.length;}
      return object(JSON.parse(new TextDecoder().decode(data)));
    }catch{throw failure('stripe_incomplete','Stripe returned an incomplete response.');}
  }
  return {
    balance:async(mapping,signal)=>{
      const r=await get(mapping,'balance',signal);
      if(r.object!=='balance'||r.livemode!==(mapping.mode==='live'))throw failure('stripe_mode_mismatch','The Stripe account mode could not be verified.');
      const amounts=(rows:unknown)=>{
        if(!Array.isArray(rows)||rows.length>30)throw failure('stripe_incomplete','Stripe balance coverage is incomplete.');
        return rows.map(row=>{const a=object(row);return stripeMoney(a.amount,a.currency);});
      };
      return {mode:mapping.mode,available:amounts(r.available),pending:amounts(r.pending)};
    },
    intent:async(mapping,id,signal)=>{
      if(!INTENT.test(id))throw failure('stripe_mapping_missing','This payment has no usable Stripe PaymentIntent link.');
      const r=await get(mapping,`payment_intents/${id}?expand%5B%5D=latest_charge`,signal);
      if(r.object!=='payment_intent'||r.id!==id||r.livemode!==(mapping.mode==='live')||String(r.currency).toUpperCase()!==mapping.currency.toUpperCase())throw failure('stripe_mapping_conflict','Stripe and the reviewed payment mapping disagree. No financial result is available.');
      const metadata=r.metadata&&typeof r.metadata==='object'?r.metadata as Record<string,unknown>:{};
      // Historical records can lack metadata; the reviewed exact mapping is then
      // required evidence. Conflicting metadata always invalidates that mapping.
      if(metadata.tenant_id&&metadata.tenant_id!==mapping.tenantId)throw failure('stripe_mapping_conflict','The Stripe record’s ownership could not be verified.');
      if(!INTENT_STATUSES.includes(String(r.status)))throw failure('stripe_incomplete','The Stripe payment state could not be verified.');
      const charge=r.latest_charge&&typeof r.latest_charge==='object'?r.latest_charge as Record<string,unknown>:null;
      if(charge&&(charge.object!=='charge'||charge.payment_intent!==id||charge.currency!==r.currency||charge.livemode!==r.livemode||typeof charge.captured!=='boolean'))throw failure('stripe_incomplete','The linked Stripe charge could not be verified.');
      return {status:String(r.status),mode:mapping.mode,requested:stripeMoney(r.amount,r.currency),received:stripeMoney(r.amount_received,r.currency),capturable:stripeMoney(r.amount_capturable,r.currency),refunded:charge?stripeMoney(charge.amount_refunded,r.currency):null,captured:charge?Boolean(charge.captured):null};
    },
    // Exactly linked objects only: the stored Checkout Session and/or PaymentIntent, in the
    // backend-derived account and environment. Relationships are verified, never inferred.
    evidence:async(route:PaymentRoute,refs,expect,signal):Promise<StripePaymentEvidence>=>{
      const storedIntent=refs.intentId&&INTENT.test(refs.intentId)?refs.intentId:null;
      const session=refs.sessionId&&SESSION.test(refs.sessionId)?refs.sessionId:null;
      if(!storedIntent&&!session)throw failure('stripe_reference_missing','This payment has no usable Stripe reference.');
      const live=route.mode==='live';
      let ownership:'metadata'|'exclusive_account'|null=null,sessionStatus:string|null=null,sessionIntent:string|null=null;
      const owns=(metadata:Record<string,string>)=>{
        if(metadata.tenant_id&&metadata.tenant_id!==expect.tenantId)throw failure('stripe_ownership_conflict','The Stripe record belongs to a different account context. It is not treated as this payment.');
        if(metadata.rental_id&&metadata.rental_id!==expect.rentalId)throw failure('stripe_ownership_conflict','The Stripe record is linked to a different rental. It is not treated as this payment.');
        if(metadata.tenant_id===expect.tenantId)ownership='metadata';
      };
      if(session){
        const s=await get(route,`checkout/sessions/${session}`,signal);
        if(s.object!=='checkout.session'||s.id!==session||s.livemode!==live)throw failure('stripe_mapping_conflict','The Stripe checkout does not match its recorded account and environment.');
        owns(metadataOf(s.metadata));
        sessionStatus=typeof s.status==='string'&&/^[a-z_]{1,20}$/.test(s.status)?s.status:null;
        sessionIntent=typeof s.payment_intent==='string'?s.payment_intent:null;
        if(storedIntent&&sessionIntent&&sessionIntent!==storedIntent)throw failure('stripe_mapping_conflict','The stored PaymentIntent is not the one linked to the stored checkout.');
      }
      const intentId=storedIntent??(sessionIntent&&INTENT.test(sessionIntent)?sessionIntent:null);
      const empty={intentId,sessionId:session,livemode:live,sessionStatus,intentStatus:null,currency:null,requested:null,received:null,capturable:null,captured:null,capturedAmount:null,refunded:null,fullyRefunded:null,createdAt:null,receiptUrl:null,platformFlow:false};
      if(!intentId){
        if(route.strictOwnership&&ownership!=='metadata')throw failure('stripe_ownership_unverified','The Stripe record could not be verified as this rental’s payment.');
        return {...empty,ownership:ownership??'exclusive_account'};
      }
      const r=await get(route,`payment_intents/${intentId}?expand%5B%5D=latest_charge`,signal);
      if(r.object!=='payment_intent'||r.id!==intentId||r.livemode!==live)throw failure('stripe_mapping_conflict','The Stripe payment does not match its recorded account and environment.');
      owns(metadataOf(r.metadata));
      if(route.strictOwnership&&ownership!=='metadata')throw failure('stripe_ownership_unverified','The Stripe record could not be verified as this rental’s payment.');
      if(!INTENT_STATUSES.includes(String(r.status)))throw failure('stripe_incomplete','The Stripe payment state could not be verified.');
      const currency=String(r.currency).toUpperCase();
      const charge=r.latest_charge&&typeof r.latest_charge==='object'?r.latest_charge as Record<string,unknown>:null;
      if(charge&&(charge.object!=='charge'||charge.payment_intent!==intentId||charge.currency!==r.currency||charge.livemode!==r.livemode||typeof charge.captured!=='boolean'||typeof charge.refunded!=='boolean'))throw failure('stripe_incomplete','The linked Stripe charge could not be verified.');
      return {...empty,ownership:ownership??'exclusive_account',intentStatus:String(r.status),currency,
        requested:stripeMoney(r.amount,r.currency),received:stripeMoney(r.amount_received,r.currency),capturable:stripeMoney(r.amount_capturable,r.currency),
        captured:charge?Boolean(charge.captured):null,capturedAmount:charge?stripeMoney(charge.amount_captured,r.currency):null,
        refunded:charge?stripeMoney(charge.amount_refunded,r.currency):null,fullyRefunded:charge?Boolean(charge.refunded):null,
        createdAt:charge&&Number.isSafeInteger(charge.created)?Number(charge.created):Number.isSafeInteger(r.created)?Number(r.created):null,
        receiptUrl:charge&&typeof charge.receipt_url==='string'&&RECEIPT.test(charge.receipt_url)?charge.receipt_url:null,
        platformFlow:Boolean(r.transfer_data||r.on_behalf_of||r.application_fee_amount)};
    },
  };
}
