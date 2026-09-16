import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { handleMessaging, type MessagingDatabase } from '../trax-support/support/messaging.ts';
import { createSupportReads, type SupportDatabase } from '../trax-support/support/reads.ts';
Deno.serve(async(req:Request)=>{
  const preflight=handleCors(req);if(preflight)return preflight;
  const url=Deno.env.get('SUPABASE_URL'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!secret)return Response.json({error:'Support is not configured.'},{status:503,headers:corsHeaders});
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([req.signal,AbortSignal.timeout(8000)])})}});
  const response=await handleMessaging(req,{reads:createSupportReads(db as unknown as SupportDatabase),db:db as unknown as MessagingDatabase,enabled:(Deno.env.get('TRAX_SUPPORT_STORAGE')??'enabled')==='enabled'}); // Defaults on: the project is at its secret limit; a secret still overrides.
  for(const[k,v]of Object.entries(corsHeaders))response.headers.set(k,v);return response;
});
