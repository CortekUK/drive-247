import { authorize, digest } from './auth.ts';
import { conversationToken, verifyConversation, type Conversation } from './conversation.ts';
import { KNOWLEDGE } from './knowledge.generated.ts';
import { guideAvailable, guideNavigation, isFinanceQuestion, runTool, validateEntity, type Guide } from './registry.ts';
import { object, onlyKeys, SupportError, type Locale, type PageContext, type SupportReads } from './types.ts';

export interface Dependencies { reads:SupportReads; signingSecret:string; now?:()=>number }
const disclaimer={en:'This is application guidance. I have not checked live records, vehicle availability or Stripe.','ur-Latn':'Ye application guidance hai. Maine live records, gaari ki availability ya Stripe check nahi kiya.'};
const unavailable={en:'Live diagnostics, balances and business actions are not available in this phase. Ask about Rentals, returns, Vehicles, Customers, Availability, Messages, Reminders, Website Content or Settings. I only show destinations your account can access.','ur-Latn':'Is phase mein live diagnosis, balance aur business actions available nahi hain. Rentals, return, Vehicles, Customers, Availability, Messages, Reminders, Website Content ya Settings ke bare mein poochein. Sirf aap ke account ke liye allowed destinations dikhaye jate hain.'};
const provenance={kind:'application_guidance',liveDataChecked:false,knowledgeVersion:KNOWLEDGE.version,sourceCommit:KNOWLEDGE.sourceCommit,verifiedAt:KNOWLEDGE.verifiedAt,productionReleaseVerified:false,conversationStorage:'browser_memory_only'};
const knowledgeRevision=JSON.stringify(KNOWLEDGE);
async function boundedBody(req:Request):Promise<Record<string,unknown>> {
  const reader=req.body?.getReader();
  if (!reader) throw new SupportError('invalid_input','A request body is required.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SupportError('request_timeout','The request timed out. Try again.',408));
      void reader.cancel().catch(() => {});
    }, 5_000);
  });
  try {
    const chunks:Uint8Array[]=[];let size=0;
    for (;;) {
      const {done,value}=await Promise.race([reader.read(),timeout]);
      if(done)break;
      size+=value.length;
      if(size>8192){void reader.cancel().catch(() => {});throw new SupportError('request_too_large','Ask a shorter question.',413);}
      chunks.push(value);
    }
    const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
    try{return object(JSON.parse(new TextDecoder().decode(all)));}catch(error){if(error instanceof SupportError)throw error;throw new SupportError('invalid_input','Invalid request JSON.');}
  } finally {
    clearTimeout(timer);
  }
}
function localeFor(message:string,requested:unknown,previous?:Conversation):Locale {
  if(requested==='en'||requested==='ur-Latn')return requested;
  if(/\b(kahan|kaise|kyun|nahi|hai|hain|gaari|gari|wapis|wapas|karein|chabi|chaabi|mujhe|mera|kitna|dikhao)\b/i.test(message))return 'ur-Latn';
  return previous?.locale??'en';
}
/** No provider call, legacy history, embeddings or metrics are reachable here. */
export async function handleSupportRequest(req:Request,deps:Dependencies):Promise<Response> {
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Authorization'};
  const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
  try {
    if(req.method!=='POST')throw new SupportError('method_not_allowed','Use POST.',405);
    const token=req.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if(!token)throw new SupportError('unauthorized','Sign in to use TRAX.',401);
    const body=await boundedBody(req);onlyKeys(body,['type','message','tenantId','conversationId','contextScope','pageContext','navigation','locale']);
    const type=body.type??'message';
    if(!['message','context','navigate'].includes(String(type)))throw new SupportError('tool_unavailable','Business actions are not available in this TRAX phase.',403);
    const auth=await authorize(deps.reads,token,body.tenantId);auth.scope=await digest(auth.scope+knowledgeRevision);
    if(body.contextScope!=null && body.contextScope!==auth.scope)throw new SupportError('context_changed','Account access changed. Start a new conversation.',409);
    const now=deps.now?.()??Date.now();
    const conversation=body.conversationId==null?{id:crypto.randomUUID(),expires:now+30*60_000} as Conversation:await verifyConversation(deps.signingSecret,auth,body.conversationId,now);
    const env={auth,reads:deps.reads};let page:PageContext|undefined;
    if(body.pageContext!=null){const p=object(body.pageContext);onlyKeys(p,['kind','id']);if(typeof p.kind!=='string'||typeof p.id!=='string')throw new SupportError('invalid_input','Invalid page context.');page=p as unknown as PageContext;await validateEntity(env,page);}
    let response:Record<string,unknown>={response:'',sources:[],navigation:[],provenance};
    if(type==='navigate'){
      const navigation=await runTool('resolve_navigation_target',body.navigation,env);
      if (!('href' in navigation)) throw new SupportError('service_unavailable','Navigation could not be verified.',503);
      response={...response,href:navigation.href,navigation:[navigation.action]};
    }else if(type==='message'){
      if(typeof body.message!=='string'||!body.message.trim()||body.message.length>4000)throw new SupportError('invalid_input','Enter an application question of up to 4,000 characters.');
      const language=localeFor(body.message,body.locale,conversation);
      const guides=await runTool('search_application_knowledge',{query:body.message},env) as Guide[];let guide=guides[0];
      if(!guide && !isFinanceQuestion(body.message) && /^(and |aur |what next|next|tell me more|more|explain|details|continue)/i.test(body.message.trim()) && conversation.section){const previous=KNOWLEDGE.guides.find((g)=>g.id===conversation.section);if(previous&&guideAvailable(auth,previous))guide=previous;}
      response={...response,response:`${disclaimer[language]}\n\n${guide?guide[language]:unavailable[language]}`,
        sources:guide?[{table:'application_knowledge',id:guide.id,title:guide.title,knowledgeVersion:KNOWLEDGE.version,sourceCommit:KNOWLEDGE.sourceCommit,verifiedAt:KNOWLEDGE.verifiedAt}]:[],navigation:guide?await guideNavigation(guide,env,page):[]};
      conversation.section=guide?.id;conversation.locale=language;
    }
    const fresh=await authorize(deps.reads,token,body.tenantId);fresh.scope=await digest(fresh.scope+knowledgeRevision);
    if(fresh.scope!==auth.scope)throw new SupportError('context_changed','Account access changed. Start a new conversation.',409);
    return respond({...response,contextScope:auth.scope,conversationId:await conversationToken(deps.signingSecret,auth,conversation)});
  }catch(error){
    if(error instanceof SupportError)return respond({error:error.message,code:error.code},error.status);
    return respond({error:'TRAX could not verify access or load application guidance. Try again.',code:'service_unavailable'},503);
  }
}
