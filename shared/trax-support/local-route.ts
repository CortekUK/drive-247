import { createClient } from '@supabase/supabase-js';
import { handleMessaging, nudgeStore, ticketSourceReader, ticketUnreadReader, unreadMessageReader, type MessagingDatabase, type SourceClient } from '../../supabase/functions/trax-support/support/messaging';
import { createSupportReads, type SupportDatabase } from '../../supabase/functions/trax-support/support/reads';
import { attachmentStorage } from './attachment-storage';/** Same server handler in both local apps. No secret ever reaches a browser. */
export async function localMessaging(request:Request){
  const headers={'Cache-Control':'no-store'};
  if(process.env.NODE_ENV!=='development')return Response.json({error:'Not found'},{status:404,headers});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!secret)return Response.json({code:'local_configuration_required',error:'Local support needs server configuration.'},{status:503,headers});
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([request.signal,AbortSignal.timeout(8000)])})}});
  return handleMessaging(request,{reads:createSupportReads(db as unknown as SupportDatabase),db:db as unknown as MessagingDatabase,enabled:(process.env.TRAX_SUPPORT_STORAGE??'enabled')==='enabled',storage:attachmentStorage(db),sources:ticketSourceReader(db as unknown as SourceClient),unread:unreadMessageReader(db as unknown as SourceClient),ticketUnread:ticketUnreadReader(db as unknown as SourceClient),nudges:nudgeStore(db as unknown as Parameters<typeof nudgeStore>[0],slug=>`http://${slug}.portal.localhost:4002`),sendEmail:localEmail,...(process.env.OPENAI_API_KEY?{assist:{key:process.env.OPENAI_API_KEY,model:process.env.TRAX_ASSIST_MODEL??'gpt-4.1'}}:{})});
}

/** Local dev: a real send when RESEND_API_KEY is set here, otherwise logged and reported as simulated. */
async function localEmail(email:{to:string;subject:string;html:string;text:string;fromName:string;idempotencyKey:string}){
  const key=process.env.RESEND_API_KEY;
  if(!key){console.log('[support email simulated]',email.to,email.subject,'\n'+email.text);return {success:true,simulated:true,messageId:'simulated-'+Date.now()};}
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':email.idempotencyKey},
    body:JSON.stringify({from:`${email.fromName} <noreply@drive-247.com>`,to:[email.to],subject:email.subject,html:email.html,text:email.text})});
  const body=await r.json().catch(()=>({}));
  return r.ok&&body.id?{success:true,messageId:String(body.id)}:{success:false};
}
