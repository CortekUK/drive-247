import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { sendResendEmail } from '../_shared/resend-service.ts';
import { processTicketEmails } from '../trax-support/support/ticket-email.ts';
// Scheduler-only endpoint. No user, tenant or model can choose the recipient.
Deno.serve(async(req:Request)=>{
  const token=Deno.env.get('TRAX_SUPPORT_WORKER_SECRET');
  if(req.method!=='POST'||!token||req.headers.get('Authorization')!==`Bearer ${token}`)return new Response('Forbidden',{status:403});
  const origin=Deno.env.get('TRAX_SUPPORT_ADMIN_ORIGIN'),url=Deno.env.get('SUPABASE_URL'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(Deno.env.get('TRAX_SUPPORT_EMAILS')!=='enabled'||!origin||!url||!secret||!Deno.env.get('RESEND_API_KEY'))return Response.json({error:'Email worker is not configured; jobs remain queued.'},{status:503});
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(8000)})}});
  try{return Response.json(await processTicketEmails(db,{origin,recipient:Deno.env.get('TRAX_SUPPORT_NOTIFICATION_TO')??'ilyasghulam35@gmail.com'},email=>sendResendEmail(email)));}
  catch{return Response.json({error:'Notification processing unavailable. Pending jobs are retained.'},{status:503});}
});
