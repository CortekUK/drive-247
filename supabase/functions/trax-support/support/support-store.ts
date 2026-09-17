import type { Conversation } from './conversation.ts';
import type { SupportIssue } from './issues.ts';
import { issueView, redactSupportText } from './issues.ts';
import { object, onlyKeys, SupportError, UUID, type SupportContext } from './types.ts';

export interface StoredConversation {id:string;tenant_id:string;user_id:string;scope:string;revision:number;state:Conversation;last_activity_at:string}
export interface SupportTicket {id:string;reference:string;tenant_id:string;user_id:string;issue_id:string;summary:string;status:'open'|'in_progress'|'closed';created_at:string;updated_at:string;closed_at:string|null;handoff:Record<string,unknown>;staff_note:string;retention_hold:boolean;review_due?:boolean}
export interface RetentionPolicy {conversation_days:number;closed_ticket_days:number;inactive_open_days:number;cleanup_enabled:boolean}
export interface TicketStore {
  capabilities(ctx:SupportContext):Promise<{supportAgent:boolean;managePolicy:boolean;deliveryReady:boolean}>;
  load(ctx:SupportContext,id:string):Promise<StoredConversation|null>;
  recent(ctx:SupportContext):Promise<StoredConversation[]>;
  save(ctx:SupportContext,state:Conversation,revision:number|null):Promise<number>;
  submit(ctx:SupportContext,state:Conversation,issue:SupportIssue,message:{body:string;nonce:string;subject:string}):Promise<SupportTicket>;
  tickets(ctx:SupportContext,queue:boolean,offset:number):Promise<{tickets:SupportTicket[];nextOffset:number|null}>;
  detail(ctx:SupportContext,id:string,queue:boolean):Promise<SupportTicket>;
  update(ctx:SupportContext,id:string,status:SupportTicket['status'],note:string,retentionHold:boolean):Promise<SupportTicket>;
  policy(ctx:SupportContext,update?:Pick<RetentionPolicy,'conversation_days'|'closed_ticket_days'|'inactive_open_days'>):Promise<RetentionPolicy>;
  holdConversation(ctx:SupportContext,id:string,hold:boolean):Promise<void>;
  dryRun(ctx:SupportContext):Promise<Record<string,unknown>>;
}
interface Result {data:unknown;error:unknown}
interface Query extends PromiseLike<Result> {eq(key:string,value:string|boolean|number):Query;order(key:string,options?:{ascending:boolean}):Query;limit(value:number):Query;range(start:number,end:number):Query;maybeSingle():PromiseLike<Result>}
export interface TicketDatabase {from(table:string):{select(columns:string):Query};rpc(name:string,args:Record<string,unknown>):PromiseLike<Result>}
const ticketColumns='id,reference,tenant_id,user_id,issue_id,summary,status,created_at,updated_at,closed_at,handoff,staff_note,retention_hold';
export function createTicketStore(db:TicketDatabase):TicketStore {
  async function checked<T>(query:PromiseLike<Result>):Promise<T>{const result=await query;if(result.error)throw new SupportError('support_storage_unavailable','Support storage is unavailable. Your issue has not been submitted. Try again after the support service is available.',503);return result.data as T;}
  async function rpc<T>(name:string,ctx:SupportContext,args:Record<string,unknown>={}):Promise<T>{return checked(db.rpc(name,{p_user:ctx.userId,p_staff:ctx.staffId,p_tenant:ctx.tenant.id,p_scope:ctx.scope,...args}));}
  const capabilities=(ctx:SupportContext)=>rpc<{supportAgent:boolean;managePolicy:boolean;deliveryReady:boolean}>('trax_support_capabilities',ctx);
  const store:TicketStore={
    capabilities,
    load:async(ctx,id)=>{if(!UUID.test(id))throw new SupportError('invalid_input','Invalid conversation.');return checked(db.from('trax_support_conversations').select('id,tenant_id,user_id,scope,revision,state,last_activity_at').eq('id',id).eq('tenant_id',ctx.tenant.id).eq('user_id',ctx.userId).eq('scope',ctx.scope).maybeSingle());},
    recent:ctx=>checked(db.from('trax_support_conversations').select('id,tenant_id,user_id,scope,revision,state,last_activity_at').eq('tenant_id',ctx.tenant.id).eq('user_id',ctx.userId).eq('scope',ctx.scope).order('last_activity_at',{ascending:false}).limit(20)),
    save:(ctx,state,revision)=>rpc<number>('trax_support_save_conversation',ctx,{p_id:state.id,p_revision:revision,p_state:state}),
    submit:(ctx,state,issue,message)=>rpc<SupportTicket>('trax_support_submit_message',ctx,{p_conversation:state.id,p_issue:issue.id,p_summary:redactSupportText(message.subject,240),p_nonce:message.nonce,p_body:redactSupportText(message.body,4000),p_handoff:{conversationId:state.id,issue:issueView(issue),reportedByUser:issue.excerpts.filter(e=>e.role==='user').map(e=>({content:redactSupportText(e.content),at:e.at})),verifiedChecks:issue.checks,recordReferences:issue.records,paymentReferences:issue.paymentReferences??[],unknowns:issue.unknowns,escalationHistory:issue.events.map(({key,reason,at})=>({key,reason,at})),excerpt:issue.excerpts.slice(-8).map(e=>({...e,content:redactSupportText(e.content)})),disclosure:'User reports and historical system observations are separate. Payment references record what TRAX checked and when; they are not a financial outcome or a promise of funds.'}}),
    tickets:(ctx,queue,offset)=>rpc('trax_support_list_tickets',ctx,{p_queue:queue,p_offset:offset}),
    detail:(ctx,id,queue)=>rpc('trax_support_ticket_detail',ctx,{p_id:id,p_queue:queue}),
    update:(ctx,id,status,note,retentionHold)=>rpc('trax_support_update_ticket',ctx,{p_id:id,p_status:status,p_note:redactSupportText(note,2000),p_hold:retentionHold}),
    policy:(ctx,update)=>rpc('trax_support_policy',ctx,{p_update:update??null}),
    holdConversation:async(ctx,id,hold)=>{await rpc('trax_support_hold_conversation',ctx,{p_id:id,p_hold:hold});},
    dryRun:ctx=>rpc('trax_support_retention_preview',ctx),
  };
  return store;
}
export function ticketInput(input:unknown) {const a=object(input);onlyKeys(a,['id','queue','offset','status','note','retentionHold']);if(a.id!=null&&(typeof a.id!=='string'||!UUID.test(a.id)))throw new SupportError('invalid_input','Invalid ticket reference.');if(a.offset!=null&&(!Number.isSafeInteger(a.offset)||Number(a.offset)<0||Number(a.offset)>100000))throw new SupportError('invalid_input','Invalid page.');if(a.queue!=null&&typeof a.queue!=='boolean')throw new SupportError('invalid_input','Invalid support view.');return a;}
