/**
 * TRAX for platform support: the Trax tab beside a ticket, and the reply the
 * composer suggests.
 *
 * SUPER ADMINS ONLY. `handleMessaging` authorizes the caller as an active super
 * admin and loads the ticket through the same authorized `detail` request before
 * anything here runs, so this module never decides access itself.
 *
 * Two jobs:
 * - `chat`: the agent asks, TRAX answers. It sees the whole ticket conversation
 *   and can look things up with read-only SQL (`trax_assist_query`: one select,
 *   read-only transaction, 50 rows, no secret columns, no auth schema).
 * - `suggest`: the next reply to the tenant, written for the agent to edit and
 *   send. It sees the conversation and what the agent and TRAX worked out in the
 *   Trax tab, and may check the database the same way.
 *
 * Nothing here writes: no message is sent, no record changed. The agent sends.
 */
import { SupportError } from './types.ts';

export interface AssistConfig {key:string;model:string}
export interface AssistDatabase {rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
export interface AssistTurn {role:'user'|'assistant';content:string}
interface Detail {ticket?:Record<string,unknown>;messages?:{seq:number;author_kind:string;body:string;created_at:string;source?:string}[]}

const MAX_ROUNDS=8;
const ROW_TEXT_LIMIT=12_000;

const QUERY_TOOL={type:'function',function:{name:'query_database',
  description:'Run ONE read-only PostgreSQL SELECT (or WITH … SELECT) on the Drive247 production database, public schema. Returns at most 50 rows as JSON. No semicolons. Secret columns (tokens, passwords, keys, hashes, codes) are not readable. Use information_schema.columns to discover columns.',
  parameters:{type:'object',additionalProperties:false,required:['sql','why'],properties:{
    sql:{type:'string',description:'The SELECT statement.'},
    why:{type:'string',description:'A few words on what you are checking.'}}}}};

const PLATFORM=`Drive247 is a multi-tenant car rental platform. Tenants are rental operators (table tenants; slug, company_name). Their staff are app_users (tenant_id, auth_user_id, name, email, role: head_admin, admin, manager, ops, viewer). Super admins have tenant_id NULL. Core tables carry tenant_id: customers, vehicles, rentals, payments, invoices, fines, blocked_dates, identity_verifications, tenant_subscriptions, tenant_subscription_invoices, subscription_plans, reminders, rental_reviews. Support tickets live in trax_support_tickets (id, reference, tenant_id, user_id = auth user of the requester, status, summary, handoff) and trax_support_messages (ticket_id, seq, author_kind tenant|support, body, created_at). Stripe Connect and BoldSign run per tenant in test or live mode (tenants.stripe_mode, tenants.boldsign_mode).

Querying rules:
- Status and type values are capitalised text, not what you might guess (e.g. rentals.status is Active, Pending, Closed, Cancelled, Rejected; vehicles.status is Available, Rented, …). Before filtering on any status/type/category column, look at its real values (select status, count(*) … group by 1). Prefer one grouped query over several guessed filters.
- Never report a zero or "none found" from a filter you have not verified matches real values. If a result looks surprising, check it another way first.
- Not sure of a column name? Read information_schema.columns for that table.`;

function transcript(detail:Detail){
  const ticket=detail.ticket??{};
  const lines=(detail.messages??[]).map(m=>{
    const who=m.source==='trax_handoff'?'TRAX (automatic summary from an earlier TRAX chat)':m.author_kind==='support'?'Drive247 Support':'Tenant';
    return `[${m.created_at}] ${who}: ${m.body}`;
  });
  const facts={reference:ticket.reference,ticket_id:ticket.id,subject:ticket.summary,status:ticket.status,tenant_id:ticket.tenant_id,company:ticket.tenant_name,requester:ticket.requester,created_at:ticket.created_at,updated_at:ticket.updated_at};
  return `TICKET\n${JSON.stringify(facts)}\n\nCONVERSATION (oldest first)\n${lines.join('\n')||'(no messages yet)'}`;
}

async function query(db:AssistDatabase,sql:string){
  const result=await db.rpc('trax_assist_query',{p_sql:sql});
  if(result.error){
    const message=String((result.error as {message?:string}).message??'query failed');
    return JSON.stringify({error:message.includes('assist_query_rejected')?'Rejected: send exactly one SELECT, no semicolons.':message.slice(0,400)});
  }
  const text=JSON.stringify(result.data);
  return text.length>ROW_TEXT_LIMIT?text.slice(0,ROW_TEXT_LIMIT)+'… (truncated; narrow the query)':text;
}

async function complete(config:AssistConfig,messages:Record<string,unknown>[],tools:boolean,signal:AbortSignal){
  const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',signal,
    headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:config.model,messages,temperature:0.3,max_tokens:1400,...(tools?{tools:[QUERY_TOOL],parallel_tool_calls:false}:{})})});
  if(!response.ok){console.warn(JSON.stringify({event:'trax_assist_model_failed',status:response.status}));throw new SupportError('assist_unavailable','TRAX could not answer right now. Try again.',503);}
  const body=await response.json();
  return body?.choices?.[0]?.message as {content:string|null;tool_calls?:{id:string;function:{name:string;arguments:string}}[]}|undefined;
}

/** The tool loop shared by both jobs. Returns the final text and the lookups made. */
async function run(config:AssistConfig,db:AssistDatabase,messages:Record<string,unknown>[]){
  const signal=AbortSignal.timeout(110_000);
  const checks:string[]=[];
  for(let round=0;round<MAX_ROUNDS;round++){
    const reply=await complete(config,messages,round<MAX_ROUNDS-1,signal);
    if(!reply)break;
    if(!reply.tool_calls?.length)return {text:(reply.content??'').trim(),checks};
    messages.push({role:'assistant',content:reply.content,tool_calls:reply.tool_calls.map(c=>({id:c.id,type:'function',function:c.function}))});
    for(const call of reply.tool_calls){
      let args:{sql?:string;why?:string}={};try{args=JSON.parse(call.function.arguments);}catch{/* answered below */}
      const output=call.function.name==='query_database'&&typeof args.sql==='string'?await query(db,args.sql):JSON.stringify({error:'Unknown tool or missing sql.'});
      if(typeof args.why==='string'&&args.why.trim())checks.push(args.why.trim().slice(0,120));
      messages.push({role:'tool',tool_call_id:call.id,content:output});
    }
  }
  throw new SupportError('assist_unavailable','TRAX could not finish that answer. Try asking more narrowly.',503);
}

export async function assistChat(config:AssistConfig,db:AssistDatabase,detail:Detail,turns:AssistTurn[]){
  const system=`You are TRAX, the assistant inside Drive247's platform support inbox. You are talking to a Drive247 super admin (support agent), NOT to the tenant. Help them understand and resolve the ticket below.

${PLATFORM}

You can check the live database with query_database. When the answer depends on data (a rental, payment, subscription, setting, user, integration), look it up rather than guess, scoped to this ticket's tenant_id unless asked otherwise. Say what you found, with the figures and record references that matter. If something cannot be determined from the data, say so plainly.

When the agent asks for a reply to the tenant, write it ready to paste: friendly, clear, first person plural as Drive247 Support, no internal table or column names, no ids the tenant would not recognise. Put only that reply in the answer when they ask for one.

Write plain text. Short paragraphs; "- " bullets where a list helps. No markdown headings, no bold, no emojis.

${transcript(detail)}`;
  const {text,checks}=await run(config,db,[{role:'system',content:system},...turns.map(t=>({role:t.role,content:t.content}))]);
  return {answer:text||'I could not form an answer. Try rephrasing.',checks};
}

export async function assistSuggest(config:AssistConfig,db:AssistDatabase,detail:Detail,notes:AssistTurn[]){
  const worked=notes.length?`\n\nWHAT THE AGENT AND TRAX WORKED OUT (private, in the Trax tab; use it, never quote it as a chat)\n${notes.map(n=>`${n.role==='user'?'Agent':'TRAX'}: ${n.content}`).join('\n')}`:'';
  const system=`You draft the next message Drive247 Support will send to the tenant in the ticket below. The agent will read and edit it before sending.

${PLATFORM}

Write the reply as Drive247 Support (first person plural), to the tenant. Answer what the tenant last asked or move the ticket forward. Be friendly, specific and brief: usually two to five sentences. If facts are needed you may check the database with query_database, scoped to this ticket's tenant_id; never invent amounts, dates or policies — if unsure, say we are checking. No internal table or column names, no ids the tenant would not recognise, no emojis, no markdown, no greeting line like "Subject:". Do not sign off with a name.

Return ONLY the message text.

${transcript(detail)}${worked}`;
  const {text}=await run(config,db,[{role:'system',content:system},{role:'user',content:'Draft the next reply to the tenant.'}]);
  return {reply:text.replace(/^["']|["']$/g,'').trim()};
}

/** Shape checks for the two actions' inputs. */
export function assistTurns(value:unknown,max:number):AssistTurn[]{
  if(value==null)return [];
  if(!Array.isArray(value)||value.length>max)throw new SupportError('invalid_input','Invalid TRAX conversation.');
  return value.map(t=>{
    const turn=t as AssistTurn;
    if(!turn||!['user','assistant'].includes(turn.role)||typeof turn.content!=='string'||!turn.content.trim()||turn.content.length>6000)throw new SupportError('invalid_input','Invalid TRAX conversation.');
    return {role:turn.role,content:turn.content.trim()};
  });
}
