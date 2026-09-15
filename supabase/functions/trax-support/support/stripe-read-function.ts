import { object, SupportError, UUID } from './types.ts';
import type { PaymentRoute, StripeMapping } from './finance-types.ts';
import { createReadOnlyStripe } from './stripe-readonly.ts';

/** Runs inside Supabase as trax-stripe-read. A backend outside Supabase cannot see the Stripe
 * secrets, so it sends its already authorized, backend-derived account context here; this reads
 * the secret by name and runs the same fixed read-only checks. The key never leaves Supabase. */
const GENERIC='The read-only Stripe check failed. No live amount is available.';
const text=(v:unknown)=>typeof v==='string'?v:'';
function sameSecret(given:string,expected:string):boolean {
  const a=new TextEncoder().encode(given),b=new TextEncoder().encode(expected);
  let diff=a.length^b.length;
  for(let i=0;i<b.length;i++)diff|=(a[i]??0)^b[i];
  return diff===0;
}
function owner(value:unknown):{tenantId:string;rentalId:string} {
  const e=object(value),tenantId=text(e.tenantId),rentalId=text(e.rentalId);
  if(!UUID.test(tenantId)||!UUID.test(rentalId))throw new SupportError('invalid_input','Invalid request.');
  return {tenantId,rentalId};
}
export async function handleStripeReadRequest(req:Request,env:(key:string)=>string|undefined,fetcher:typeof fetch=fetch):Promise<Response> {
  const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(req.method!=='POST')return reply({error:'Not found.'},404);
  const expected=env('SUPABASE_SERVICE_ROLE_KEY'),given=/^Bearer (\S+)$/.exec(req.headers.get('Authorization')??'')?.[1];
  if(!expected||!given||!sameSecret(given,expected))return reply({error:'Forbidden.'},403);
  let body:Record<string,unknown>;
  try{const raw=await req.text();if(raw.length>8_000)throw Error();body=object(JSON.parse(raw));}
  catch{return reply({error:'Invalid request.'},400);}
  if(!['intent','balance','evidence'].includes(String(body.op)))return reply({error:'Invalid request.'},400);
  const stripe=createReadOnlyStripe(env,fetcher),signal=AbortSignal.any([req.signal,AbortSignal.timeout(20_000)]);
  try{
    if(body.op==='balance'){
      const m=object(body.mapping);
      return reply({ok:true,result:await stripe.balance({platform:text(m.platform),mode:text(m.mode),accountId:text(m.accountId)} as StripeMapping,signal)});
    }
    if(body.op==='intent'){
      const m=object(body.mapping),{tenantId}=owner({tenantId:m.tenantId,rentalId:m.paymentId});
      const mapping={tenantId,paymentId:text(m.paymentId),platform:text(m.platform),mode:text(m.mode),accountId:text(m.accountId),currency:text(m.currency),verifiedAt:text(m.verifiedAt)} as StripeMapping;
      return reply({ok:true,result:await stripe.intent(mapping,text(body.intentId),signal)});
    }
    const r=object(body.route),refs=object(body.refs);
    // Fail closed: anything but an explicit exclusive account requires record-level ownership.
    const route={platform:text(r.platform),mode:text(r.mode),accountId:text(r.accountId),accountType:text(r.accountType),basis:text(r.basis),exclusive:r.exclusive===true,strictOwnership:r.strictOwnership!==false} as PaymentRoute;
    return reply({ok:true,result:await stripe.evidence!(route,{intentId:text(refs.intentId)||null,sessionId:text(refs.sessionId)||null},owner(body.expect),signal)});
  }catch(error){
    const e=error instanceof SupportError?error:new SupportError('stripe_read_failed',GENERIC,503);
    return reply({ok:false,error:{code:e.code,message:e.message,status:e.status}});
  }
}
