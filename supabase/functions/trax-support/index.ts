// Operator TRAX: Phase 1 application guidance and authorized navigation only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { handleSupportRequest } from './support/handler.ts';
import { createSupportReads, type SupportDatabase } from './support/reads.ts';

Deno.serve(async (req:Request) => {
  const preflight=handleCors(req);if(preflight)return preflight;
  const started=Date.now();const requestId=crypto.randomUUID();
  const url=Deno.env.get('SUPABASE_URL');const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!secret)return new Response(JSON.stringify({error:'TRAX is not configured.',code:'service_unavailable'}),{status:503,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
  const signal=AbortSignal.timeout(8_000);
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal})}});
  const reads=createSupportReads(db as unknown as SupportDatabase);
  const response=await handleSupportRequest(req,{reads,signingSecret:secret});
  for(const[key,value]of Object.entries(corsHeaders))response.headers.set(key,value);
  console.info(JSON.stringify({event:'trax_phase1',requestId,status:response.status,durationMs:Date.now()-started}));
  return response;
});
