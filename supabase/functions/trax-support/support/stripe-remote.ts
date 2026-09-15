import { object, SupportError } from './types.ts';
import type { ReadOnlyStripe } from './finance-types.ts';
import { createReadOnlyStripe, hasStripeReadKey } from './stripe-readonly.ts';

export const STRIPE_READ_FUNCTION='trax-stripe-read';
const CODE=/^[a-z_]{1,60}$/;

/** Outside Supabase (the local portal) the Stripe secrets are not in this process. The same
 * read-only checks then run in the trax-stripe-read edge function, which reads each secret by
 * name. Authorization and routing have already happened here; only sanitized results return. */
export function createRemoteReadOnlyStripe(supabaseUrl:string,serviceKey:string,fetcher:typeof fetch=fetch):ReadOnlyStripe {
  const endpoint=`${supabaseUrl.replace(/\/+$/,'')}/functions/v1/${STRIPE_READ_FUNCTION}`;
  async function call<T>(payload:Record<string,unknown>,signal:AbortSignal):Promise<T> {
    let response:Response;
    try{response=await fetcher(endpoint,{method:'POST',headers:{Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(20_000)])});}
    catch{throw new SupportError('stripe_read_failed','Stripe could not be reached. No live financial conclusion is available.',503);}
    if(!response.ok)throw new SupportError('stripe_configuration_required','The read-only Stripe function is not available. No live financial conclusion is available.',503);
    let body:Record<string,unknown>;
    try{const raw=await response.text();if(raw.length>256_000)throw Error();body=object(JSON.parse(raw));}
    catch{throw new SupportError('stripe_incomplete','Stripe returned an incomplete response.',503);}
    if(body.ok===true&&body.result&&typeof body.result==='object')return body.result as T;
    const e=body.error&&typeof body.error==='object'?body.error as Record<string,unknown>:{};
    throw new SupportError(typeof e.code==='string'&&CODE.test(e.code)?e.code:'stripe_read_failed',
      typeof e.message==='string'&&e.message.length<=300?e.message:'The read-only Stripe check failed. No live amount is available.',
      typeof e.status==='number'&&e.status>=400&&e.status<600?e.status:503);
  }
  return {
    intent:(mapping,intentId,signal)=>call({op:'intent',mapping,intentId},signal),
    balance:(mapping,signal)=>call({op:'balance',mapping:{platform:mapping.platform,mode:mapping.mode,accountId:mapping.accountId}},signal),
    evidence:(route,refs,expect,signal)=>call({op:'evidence',route,refs,expect},signal),
  };
}
/** Inside Supabase the secret is read by name directly; elsewhere through the edge function. */
export function configuredReadOnlyStripe(env:(key:string)=>string|undefined,fetcher:typeof fetch=fetch):ReadOnlyStripe {
  if(hasStripeReadKey(env))return createReadOnlyStripe(env,fetcher);
  const url=env('SUPABASE_URL')??env('NEXT_PUBLIC_SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY');
  return url&&key?createRemoteReadOnlyStripe(url,key,fetcher):createReadOnlyStripe(env,fetcher);
}
