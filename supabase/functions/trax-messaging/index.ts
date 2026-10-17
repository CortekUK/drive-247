import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { sendResendEmail } from '../_shared/resend-service.ts';
import { handleMessaging, nudgeStore, ticketSourceReader, ticketUnreadReader, unreadMessageReader, type MessagingDatabase, type MessagingStorage, type SourceClient } from '../trax-support/support/messaging.ts';
const ATTACHMENT_BUCKET='trax-support-attachments';
import { createSupportReads, type SupportDatabase } from '../trax-support/support/reads.ts';
Deno.serve(async(req:Request)=>{
  const preflight=handleCors(req);if(preflight)return preflight;
  const url=Deno.env.get('SUPABASE_URL'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!secret)return Response.json({error:'Support is not configured.'},{status:503,headers:corsHeaders});
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([req.signal,AbortSignal.timeout(8000)])})}});
  /* Attachments: reads and writes are short-lived signed URLs for a path the
     database reserved. The bucket is private; a missing bucket surfaces as an
     honest "attachments are not configured" rather than a broken upload. */
  const bucket=()=>(db as unknown as {storage:{from(name:string):{createSignedUploadUrl(path:string):Promise<{data:{signedUrl:string;token:string}|null;error:unknown}>;createSignedUrl(path:string,seconds:number):Promise<{data:{signedUrl:string}|null;error:unknown}>}}}).storage.from(ATTACHMENT_BUCKET);
  const storage:MessagingStorage={
    signUpload:async(path)=>{const {data,error}=await bucket().createSignedUploadUrl(path);if(error||!data)throw new Error('The attachment could not be prepared.');return {url:data.signedUrl,token:data.token};},
    signDownload:async(path,seconds)=>{const {data}=await bucket().createSignedUrl(path,seconds);return data?.signedUrl??null;},
  };
  const response=await handleMessaging(req,{reads:createSupportReads(db as unknown as SupportDatabase),db:db as unknown as MessagingDatabase,enabled:(Deno.env.get('TRAX_SUPPORT_STORAGE')??'enabled')==='enabled',storage,sources:ticketSourceReader(db as unknown as SourceClient),unread:unreadMessageReader(db as unknown as SourceClient),ticketUnread:ticketUnreadReader(db as unknown as SourceClient),
    /* TRAX in the platform inbox (assist.ts). The model call may run past the 8s
       database timeout above, so it is not bound by it. */
    /* "Email the tenant": a no-reply email back to the conversation. */
    nudges:nudgeStore(db as unknown as Parameters<typeof nudgeStore>[0]),
    sendEmail:(email)=>sendResendEmail({...email,from:'noreply@drive-247.com',source:'trax-messaging'}),
    ...(Deno.env.get('OPENAI_API_KEY')?{assist:{key:Deno.env.get('OPENAI_API_KEY')!,model:Deno.env.get('TRAX_ASSIST_MODEL')??'gpt-4.1'}}:{})}); // Defaults on: the project is at its secret limit; a secret still overrides.
  for(const[k,v]of Object.entries(corsHeaders))response.headers.set(k,v);return response;
});
