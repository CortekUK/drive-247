import { authorize } from './auth.ts';
import { redactSupportText } from './issues.ts';
import { object, onlyKeys, SupportError, UUID, type SupportReads } from './types.ts';

export interface MessagingDatabase {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
/** Private storage for support attachments. The FILE never passes through this API:
 *  the client uploads to a short-lived signed URL and reads through a short-lived
 *  signed URL, both minted here for a path the database reserved. */
export interface MessagingStorage {
  signUpload(path:string):Promise<{url:string;token:string}>;
  signDownload(path:string,seconds:number):Promise<string|null>;
}
export interface MessagingDependencies {reads:SupportReads;db:MessagingDatabase;enabled:boolean;storage?:MessagingStorage}
const fields:Record<string,string[]>={count:[],list:['search','status','offset'],detail:['id','before'],read:['id','through'],send:['id','nonce','body'],status:['id','nonce','body','status'],create:['nonce','body','subject'],attach:['id','nonce','name','mime','size']};
/** Screenshots and documents only: no SVG (script), archives or executables. */
const ATTACHMENT_TYPES=['image/png','image/jpeg','image/webp','image/gif','application/pdf'];
const ATTACHMENT_LIMIT=10*1024*1024;
/** Dedicated human API. No model, opaque AI session, or client author identity. */
export async function handleMessaging(req:Request,deps:MessagingDependencies):Promise<Response>{
  const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store',Vary:'Authorization'}});
  try{
    if(req.method!=='POST')throw new SupportError('method_not_allowed','Use POST.',405);
    const bearer=req.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if(!bearer)throw new SupportError('unauthorized','Sign in to view support conversations.',401);
    // Bound the streaming request too; Content-Length is not trusted.
    const reader=req.body?.getReader();if(!reader)throw new SupportError('invalid_input','Missing request.');
    const chunks:Uint8Array[]=[];let size=0;let timer:ReturnType<typeof setTimeout>|undefined;
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel();reject(new SupportError('request_timeout','Request timed out. Please retry.',408));},5000);});
    try{for(;;){const part=await Promise.race([reader.read(),timeout]);if(part.done)break;size+=part.value.length;if(size>24000){void reader.cancel();throw new SupportError('invalid_input','Message is too long.');}chunks.push(part.value);}}finally{clearTimeout(timer);reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
    let body;try{body=object(JSON.parse(new TextDecoder().decode(bytes)));}catch{throw new SupportError('invalid_input','Invalid request.');}
    onlyKeys(body,['action','data','tenantId','admin']);
    if(typeof body.action!=='string'||!fields[body.action])throw new SupportError('invalid_input','Unsupported support action.');
    if(body.admin!=null&&typeof body.admin!=='boolean')throw new SupportError('invalid_input','Invalid support view.');
    const data=object(body.data??{});onlyKeys(data,fields[body.action]);
    for(const key of ['id','nonce'])if(fields[body.action].includes(key)&&(typeof data[key]!=='string'||!UUID.test(data[key] as string))){
      // A new ticket's first attachment has no ticket id yet; everything else must.
      if(!(body.action==='attach'&&key==='id'&&data[key]==null))throw new SupportError('invalid_input','Invalid support reference.');
    }
    if(body.action==='attach'){
      const name=typeof data.name==='string'?data.name.replace(/[\u0000-\u001f\u007f]/g,' ').trim():'';
      if(!name||name.length>200)throw new SupportError('invalid_input','Choose a file with a shorter name.');
      if(typeof data.mime!=='string'||!ATTACHMENT_TYPES.includes(data.mime))throw new SupportError('invalid_input','Attach a PNG, JPEG, WebP, GIF or PDF.');
      if(!Number.isSafeInteger(data.size)||Number(data.size)<1||Number(data.size)>ATTACHMENT_LIMIT)throw new SupportError('invalid_input','Attach a file of up to 10 MB.');
      data.name=name;
    }
    for(const key of ['body','subject'])if(fields[body.action].includes(key)){
      if(typeof data[key]!=='string'||!(data[key] as string).trim()||(data[key] as string).length>(key==='body'?4000:240))throw new SupportError('invalid_input','Enter a subject and a message of up to 4,000 characters.');
      data[key]=redactSupportText((data[key] as string).trim(),key==='body'?4000:240);
    }
    for(const key of ['offset','before','through'])if(data[key]!=null&&(!Number.isSafeInteger(data[key])||Number(data[key])<0||Number(data[key])>2147483646))throw new SupportError('invalid_input','Invalid conversation page.');
    if(data.search!=null&&(typeof data.search!=='string'||data.search.length>120))throw new SupportError('invalid_input','Search is too long.');
    if(data.status!=null&&!['','open','in_progress','closed'].includes(String(data.status)))throw new SupportError('invalid_input','Invalid support status.');
    let userId:string,staffId:string,tenantId:string|null;
    if(body.admin===true){
      if(body.tenantId!=null)throw new SupportError('invalid_input','The platform inbox does not accept a tenant override.');
      const user=await deps.reads.authenticate(bearer);if(!user)throw new SupportError('unauthorized','Sign in again.',401);
      const staff=await deps.reads.staff(user.id);
      if(!staff||!staff.is_active||!staff.is_super_admin||staff.auth_user_id!==user.id)throw new SupportError('forbidden','Platform support access is required.',403);
      userId=user.id;staffId=staff.id;tenantId=null;
    }else{
      const ctx=await authorize(deps.reads,bearer,body.tenantId);userId=ctx.userId;staffId=ctx.staffId;tenantId=ctx.tenant.id;
    }
    if(!deps.enabled)throw new SupportError('support_unavailable','Support messaging is not configured in this environment. No message has been sent.',503);
    if(body.action==='attach'){
      if(!deps.storage)throw new SupportError('support_unavailable','Attachments are not configured in this environment. Your message can still be sent without one.',503);
      const reserved=await deps.db.rpc('trax_support_attachment_reserve',{p_user:userId,p_staff:staffId,p_tenant:tenantId,p_admin:body.admin===true,
        p_ticket:data.id??null,p_nonce:data.nonce,p_name:data.name,p_mime:data.mime,p_size:data.size});
      if(reserved.error){
        const message=(reserved.error as {message?:string}).message??'';
        if(message.includes('support_attachment_limit'))throw new SupportError('invalid_input','Up to three files per message.');
        if(message.includes('support_rate_limited'))throw new SupportError('rate_limited','Please wait before attaching more files.',429);
        if(message.includes('support_access_denied'))throw new SupportError('forbidden','This support conversation is not available with your current access.',403);
        throw new SupportError('support_unavailable','The attachment could not be reserved. Your message has not been sent.',503);
      }
      const row=reserved.data as {storagePath:string;id:string;fileName:string;mimeType:string;sizeBytes:number};
      const upload=await deps.storage.signUpload(row.storagePath);
      // The reserved row is claimed by the message that follows, by nonce.
      return respond({attachment:{id:row.id,path:row.storagePath,name:row.fileName,mime:row.mimeType,size:row.sizeBytes},upload});
    }
    // RPC rechecks active membership and the dedicated support grant atomically.
    const result=await deps.db.rpc('trax_messaging_request',{p_user:userId,p_staff:staffId,p_tenant:tenantId,p_admin:body.admin===true,p_action:body.action,p_data:data});
    if(result.error){
      const error=result.error as {message?:string};
      if(error.message?.includes('support_access_denied'))throw new SupportError('forbidden','This support conversation is not available with your current access.',403);
      if(error.message?.includes('support_rate_limited'))throw new SupportError('rate_limited','Please wait a minute before sending again. Your draft is preserved.',429);
      throw new SupportError('support_unavailable','Support could not confirm this request. Retry with the same draft; duplicate messages are prevented.',503);
    }
    if(body.action==='list'&&result.data&&typeof result.data==='object'){
      /* One truncated line of the latest message per row. Its own authorized
         reader, so the reviewed list query is untouched; a deployment without the
         function simply answers without previews rather than failing the list. */
      const page=result.data as {tickets?:{id:string}[]};
      const ids=(page.tickets??[]).map(ticket=>ticket.id).filter(id=>typeof id==='string');
      if(ids.length){
        const previews=await deps.db.rpc('trax_support_ticket_previews',{p_user:userId,p_staff:staffId,p_tenant:tenantId,p_admin:body.admin===true,p_ids:ids});
        if(!previews.error&&previews.data&&typeof previews.data==='object'){
          const map=previews.data as Record<string,string>;
          return respond({...page,tickets:(page.tickets??[]).map(ticket=>({...ticket,...(map[ticket.id]?{preview:map[ticket.id]}:{})}))});
        }
      }
    }
    if(body.action==='detail'&&deps.storage&&result.data&&typeof result.data==='object'){
      /* The conversation's files, with a short-lived read URL each. The list comes
         from the database under the same access rule as the thread itself; a URL
         that cannot be signed is returned without one rather than guessed. */
      const attachments=await deps.db.rpc('trax_support_attachment_list',{p_user:userId,p_staff:staffId,p_tenant:tenantId,p_admin:body.admin===true,p_ticket:data.id});
      if(!attachments.error&&Array.isArray(attachments.data)){
        const files=[] as Record<string,unknown>[];
        for(const file of attachments.data as {id:string;seq:number;path:string;name:string;mime:string;size:number;author_kind:string}[]){
          const url=await deps.storage.signDownload(file.path,3600).catch(()=>null);
          files.push({id:file.id,seq:file.seq,name:file.name,mime:file.mime,size:file.size,authorKind:file.author_kind,...(url?{url}:{})});
        }
        return respond({...(result.data as Record<string,unknown>),attachments:files});
      }
    }
    return respond(result.data);
  }catch(error){return error instanceof SupportError?respond({error:error.message,code:error.code},error.status):respond({error:'Support is temporarily unavailable. Your draft has not been discarded.',code:'support_unavailable'},503);}
}
