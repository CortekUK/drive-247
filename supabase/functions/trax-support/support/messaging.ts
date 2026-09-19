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
/** Where a ticket's content came from, for ONE ticket the caller has just been
 *  authorized to open. See `ticketSourceReader`. */
export interface TicketSources {traxLinked:boolean;generated:number[]}
export interface MessagingDependencies {reads:SupportReads;db:MessagingDatabase;enabled:boolean;storage?:MessagingStorage;
  /** Optional: a deployment without it returns the thread unmarked, exactly as before. */
  sources?:(ticketId:string)=>Promise<TicketSources|null>;
  /** Optional: without it a requester's `count` carries no `unreadMessages`, and no badge is shown. */
  unread?:(userId:string,tenantId:string)=>Promise<number|null>;
  /** Optional: without it list rows carry no `unreadMessages`, and no row badge is shown. */
  ticketUnread?:(viewer:UnreadViewer,ids:string[])=>Promise<Record<string,number>|null>}

/** The support tables, read with the server's own client — only by the readers below,
 *  and only after `trax_messaging_request` has authorized the same caller. */
interface SourceQuery extends PromiseLike<{data:unknown;error:unknown}> {eq(column:string,value:unknown):SourceQuery;in(column:string,values:unknown[]):SourceQuery;maybeSingle():PromiseLike<{data:unknown;error:unknown}>}
export interface SourceClient {from(table:string):{select(columns:string):SourceQuery}}
/**
 * Which messages TRAX wrote, and whether a TRAX conversation is behind the ticket.
 *
 * STORED METADATA, NEVER TEXT. The automatic handoff (handler.ts, `support_ticket`)
 * is the only writer that posts a TRAX-linked ticket's first message under the
 * TRAX issue's own id as its nonce. A tenant's typed escalation uses the
 * composer's random nonce, and a ticket opened directly in Support has no TRAX
 * conversation at all (its handoff carries no `conversationId`), so neither is
 * ever marked — whatever its words say about TRAX.
 *
 * It runs only AFTER `trax_messaging_request` has authorized the same ticket for
 * the same caller, and it returns sequence numbers and a flag, never a body. The
 * linkage is read from the stored handoff rather than the reader's copy, which the
 * SQL blanks when record permissions fail: "there is TRAX context you cannot see"
 * and "there is no TRAX context" are different answers.
 */
export function ticketSourceReader(client:SourceClient){
  return async(ticketId:string):Promise<TicketSources|null>=>{
    const ticket=await client.from('trax_support_tickets').select('issue_id,conversation_id,linked:handoff->>conversationId').eq('id',ticketId).maybeSingle();
    const row=ticket.data as {issue_id?:string;conversation_id?:string|null;linked?:string|null}|null;
    if(ticket.error||!row?.issue_id)return null;
    const traxLinked=!!row.linked||!!row.conversation_id;
    if(!traxLinked)return {traxLinked,generated:[]};
    const messages=await client.from('trax_support_messages').select('seq').eq('ticket_id',ticketId).eq('author_kind','tenant').eq('nonce',row.issue_id);
    if(messages.error||!Array.isArray(messages.data))return null;
    return {traxLinked,generated:(messages.data as {seq:number}[]).map(m=>m.seq).filter(Number.isSafeInteger)};
  };
}
/* `status` still accepts a `body` from older clients and ignores it: the server writes that note. */
const fields:Record<string,string[]>={count:[],list:['search','status','offset'],detail:['id','before'],read:['id','through'],send:['id','nonce','body'],status:['id','nonce','body','status'],create:['nonce','body','subject'],attach:['id','nonce','name','mime','size']};
const STATUS_LABEL:Record<string,string>={open:'Open',in_progress:'In progress',closed:'Resolved'};

/**
 * A status change's note in the conversation is a lifecycle event, not a reply.
 *
 * The SERVER writes it — the words and the message id — so the two cannot drift
 * from what happened. Its nonce is a standard UUIDv8 (RFC 9562's layout for
 * application-defined ids) carrying a fixed `85a7` tag, derived from the caller's
 * own retry nonce so a retried status change is still one message. Every other
 * nonce is a random v4 (the composer) or a TRAX issue id (v4), so the tag is stored
 * metadata a count can rely on, never a reading of the text.
 */
export const STATUS_NOTE_NONCE=/^[0-9a-f]{8}-[0-9a-f]{4}-85a7-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function statusNoteNonce(callerNonce:string):Promise<string>{
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`trax-support-status-note:${callerNonce.toLowerCase()}`)));
  const hex=Array.from(hash.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
  const variant=((parseInt(hex[16],16)&0x3)|0x8).toString(16);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-85a7-${variant}${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

/** The ticket columns the unread rules need, read from storage (not the reader's copy). */
const UNREAD_TICKET_COLUMNS='id,issue_id,message_seq,conversation_id,linked:handoff->>conversationId';
interface UnreadTicket {id:string;issue_id:string;message_seq:number;conversation_id:string|null;linked:string|null}
/** Who is reading: a requester (their own tickets) or platform support (the queue). */
export interface UnreadViewer {userId:string;tenantId:string|null;admin:boolean}

/**
 * Unread INCOMING messages per ticket, for one viewer. The one rule behind the
 * tenant's per-ticket badges and sidebar total, and platform support's per-ticket
 * badges — so a row and a total can never disagree.
 *
 * Incoming depends on the viewer:
 * - a requester: messages human support wrote, except a status change's note
 *   (`STATUS_NOTE_NONCE`);
 * - platform support: messages the requester wrote, except TRAX's generated
 *   summary (nonce = the ticket's TRAX issue id, on a ticket with a TRAX
 *   conversation — the same stored rule as `ticketSourceReader`). A ticket opened
 *   directly in Support shares that id with its first message but has no TRAX
 *   conversation, so the requester's own first words still count.
 * Never the viewer's own messages, and never another agent's reply as incoming.
 *
 * MESSAGES, not tickets: two unread in one ticket are 2. "Unread" is past THIS
 * viewer's own persisted read-through, so one person reading never clears anyone
 * else's count, and every number is recomputed from storage — a repeated delivery
 * cannot count twice. `null` means "could not be counted": no badge, not a guess.
 */
async function unreadByTicket(client:SourceClient,viewer:UnreadViewer,tickets:UnreadTicket[]):Promise<Map<string,number>|null>{
  const counts=new Map<string,number>();
  if(!tickets.length)return counts;
  let readsQuery=client.from('trax_support_reads').select('ticket_id,last_seq').eq('user_id',viewer.userId);
  if(tickets.length<=50)readsQuery=readsQuery.in('ticket_id',tickets.map(t=>t.id));
  const reads=await readsQuery;
  if(reads.error||!Array.isArray(reads.data))return null;
  const through=new Map((reads.data as {ticket_id:string;last_seq:number}[]).map(r=>[r.ticket_id,Number(r.last_seq)||0]));
  const byId=new Map(tickets.map(t=>[t.id,t]));
  // Only a ticket holding anything past this viewer's read-through can hold an unread message.
  const candidates=tickets.filter(t=>Number(t.message_seq)>(through.get(t.id)??0)).map(t=>t.id);
  for(const id of tickets.map(t=>t.id))counts.set(id,0);
  const incoming=viewer.admin?'tenant':'support';
  for(let i=0;i<candidates.length;i+=50){
    const messages=await client.from('trax_support_messages').select('ticket_id,seq,nonce').eq('author_kind',incoming).in('ticket_id',candidates.slice(i,i+50));
    if(messages.error||!Array.isArray(messages.data))return null;
    for(const message of messages.data as {ticket_id:string;seq:number;nonce:string}[]){
      const ticket=byId.get(message.ticket_id);
      if(!ticket||Number(message.seq)<=(through.get(ticket.id)??0))continue;
      if(!viewer.admin&&STATUS_NOTE_NONCE.test(message.nonce))continue;
      if(viewer.admin&&message.nonce===ticket.issue_id&&(ticket.linked||ticket.conversation_id))continue;
      counts.set(ticket.id,(counts.get(ticket.id)??0)+1);
    }
  }
  return counts;
}

/**
 * The requester's sidebar total: unread support messages across ALL their tickets,
 * not only the page of the list on screen. Same rule as each row (`unreadByTicket`).
 *
 * The ticket rule is the SQL's own (`tenant_id` and `user_id` of the authenticated
 * requester), and this runs only after `trax_messaging_request('count')` has passed
 * the same guard for the same caller.
 */
export function unreadMessageReader(client:SourceClient){
  return async(userId:string,tenantId:string):Promise<number|null>=>{
    const tickets=await client.from('trax_support_tickets').select(UNREAD_TICKET_COLUMNS).eq('tenant_id',tenantId).eq('user_id',userId);
    if(tickets.error||!Array.isArray(tickets.data))return null;
    const counts=await unreadByTicket(client,{userId,tenantId,admin:false},tickets.data as UnreadTicket[]);
    return counts?[...counts.values()].reduce((sum,n)=>sum+n,0):null;
  };
}

/**
 * Per-ticket counts for one page of the ticket list. The ids are the page the
 * authorized `list` request just returned; a requester's are ALSO filtered to their
 * own tenant and user here, so an id that is not theirs can never be counted.
 */
export function ticketUnreadReader(client:SourceClient){
  return async(viewer:UnreadViewer,ids:string[]):Promise<Record<string,number>|null>=>{
    if(!ids.length)return {};
    let query=client.from('trax_support_tickets').select(UNREAD_TICKET_COLUMNS).in('id',ids);
    if(!viewer.admin){
      if(!viewer.tenantId)return null;
      query=query.eq('tenant_id',viewer.tenantId).eq('user_id',viewer.userId);
    }
    const tickets=await query;
    if(tickets.error||!Array.isArray(tickets.data))return null;
    const counts=await unreadByTicket(client,viewer,tickets.data as UnreadTicket[]);
    return counts?Object.fromEntries(counts):null;
  };
}

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
    if(body.action==='status'){
      if(!STATUS_LABEL[String(data.status)])throw new SupportError('invalid_input','Invalid support status.');
      data.body=`Support marked this ticket as ${STATUS_LABEL[String(data.status)]}.`;
      data.nonce=await statusNoteNonce(String(data.nonce));
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
    if(body.action==='count'&&body.admin!==true&&tenantId&&result.data&&typeof result.data==='object'){
      /* The ticket-level count is kept as it was. No ticket with an unread support
         message means no unread message, so the per-message count is only read when
         there is something to count. */
      const count=result.data as {unread?:number};
      const unreadMessages=!Number(count.unread)?0:deps.unread?await deps.unread(userId,tenantId).catch(()=>null):null;
      return respond(unreadMessages===null?count:{...count,unreadMessages});
    }
    if(body.action==='list'&&result.data&&typeof result.data==='object'){
      let page=result.data as {tickets?:{id:string}[]}&Record<string,unknown>;
      const ids=(page.tickets??[]).map(ticket=>ticket.id).filter(id=>typeof id==='string');
      if(ids.length){
        /* One truncated line of the latest message per row. Its own authorized
           reader, so the reviewed list query is untouched; a deployment without the
           function simply answers without previews rather than failing the list. */
        const previews=await deps.db.rpc('trax_support_ticket_previews',{p_user:userId,p_staff:staffId,p_tenant:tenantId,p_admin:body.admin===true,p_ids:ids});
        if(!previews.error&&previews.data&&typeof previews.data==='object'){
          const map=previews.data as Record<string,string>;
          page={...page,tickets:(page.tickets??[]).map(ticket=>({...ticket,...(map[ticket.id]?{preview:map[ticket.id]}:{})}))};
        }
        /* Each row's unread incoming MESSAGES for this viewer (`unreadByTicket`). Only
           for the tickets this authorized page returned; a failed count leaves the
           rows without one rather than showing a guess. */
        const counts=deps.ticketUnread?await deps.ticketUnread({userId,tenantId,admin:body.admin===true},ids).catch(()=>null):null;
        if(counts)page={...page,tickets:(page.tickets??[]).map(ticket=>({...ticket,unreadMessages:counts[ticket.id]??0}))};
      }
      return respond(page);
    }
    if(body.action==='detail'&&result.data&&typeof result.data==='object'){
      let detail=result.data as {ticket?:Record<string,unknown>;messages?:{seq:number}[]}&Record<string,unknown>;
      /* What TRAX wrote versus what a person wrote, from stored metadata (see
         `ticketSourceReader`). A failed lookup leaves every message as it was:
         nothing is hidden on a guess. */
      if(deps.sources){
        const sources=await deps.sources(String(data.id)).catch(()=>null);
        if(sources){
          detail={...detail,ticket:{...(detail.ticket??{}),traxLinked:sources.traxLinked},
            messages:(detail.messages??[]).map(message=>sources.generated.includes(message.seq)?{...message,source:'trax_handoff'}:message)};
        }
      }
      if(deps.storage){
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
          detail={...detail,attachments:files};
        }
      }
      return respond(detail);
    }
    return respond(result.data);
  }catch(error){return error instanceof SupportError?respond({error:error.message,code:error.code},error.status):respond({error:'Support is temporarily unavailable. Your draft has not been discarded.',code:'support_unavailable'},503);}
}
