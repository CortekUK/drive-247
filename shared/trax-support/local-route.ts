import { createClient } from '@supabase/supabase-js';
import { handleMessaging, ticketSourceReader, unreadMessageReader, type MessagingDatabase, type SourceClient } from '../../supabase/functions/trax-support/support/messaging';
import { createSupportReads, type SupportDatabase } from '../../supabase/functions/trax-support/support/reads';
import { attachmentStorage } from './attachment-storage';/** Same server handler in both local apps. No secret ever reaches a browser. */
export async function localMessaging(request:Request){
  const headers={'Cache-Control':'no-store'};
  if(process.env.NODE_ENV!=='development')return Response.json({error:'Not found'},{status:404,headers});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!secret)return Response.json({code:'local_configuration_required',error:'Local support needs server configuration.'},{status:503,headers});
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([request.signal,AbortSignal.timeout(8000)])})}});
  return handleMessaging(request,{reads:createSupportReads(db as unknown as SupportDatabase),db:db as unknown as MessagingDatabase,enabled:process.env.TRAX_SUPPORT_STORAGE==='enabled',storage:attachmentStorage(db),sources:ticketSourceReader(db as unknown as SourceClient),unread:unreadMessageReader(db as unknown as SourceClient)});
}
