import { authorize, digest } from './auth.ts';
import { conversationToken, verifyConversation, type Conversation } from './conversation.ts';
import { KNOWLEDGE } from './knowledge.generated.ts';
import { guideAvailable, guideNavigation, isFinanceQuestion, needsProviderEvidence, runTool, validateEntity, type Guide } from './registry.ts';
import { object, onlyKeys, SupportError, UUID, type Locale, type PageContext, type SupportReads } from './types.ts';
import { modelConversation } from './orchestrator.ts';
import { ModelUnavailable, type SupportModel } from './model.ts';
import type { CalendarClock, OperationalReads } from './operational-types.ts';
import type { FleetReads } from './fleet-tools.ts';
import type { BusinessReads } from './business-query.ts';
import type { ReportStore } from './report-tools.ts';
import type { IntegrationReads } from './integration-status.ts';
import { newIssue, issueView, recordIssueEvent, redactSupportText, DEFAULT_ESCALATION_POLICY, type EscalationPolicy } from './issues.ts';
import { ticketInput, type TicketStore } from './support-store.ts';
import { financeScopes, databaseFinanceScopes, type FinanceServices } from './finance-types.ts';

export interface Dependencies { reads:SupportReads; signingSecret:string; now?:()=>number; model?:SupportModel; operational?:OperationalReads; fleet?:FleetReads; business?:BusinessReads; reports?:ReportStore; integrations?:IntegrationReads; finance?:FinanceServices; store?:TicketStore; escalationPolicy?:EscalationPolicy; clock?:CalendarClock; audit?:(event:{kind:'model'|'tool';name:string;status:string})=>void }
const disclaimer={en:'This is application guidance. I have not checked live records, vehicle availability or Stripe.','ur-Latn':'Ye application guidance hai. Maine live records, gaari ki availability ya Stripe check nahi kiya.'};
const unavailable={en:'This prepared fallback cannot run a live diagnostic. Balances and business actions are not available. Ask about Rentals, returns, Vehicles, Customers, Availability, Messages, Reminders, Website Content or Settings. I only show destinations your account can access.','ur-Latn':'Is prepared fallback mein live diagnosis nahi hota. Balance aur business actions available nahi hain. Rentals, return, Vehicles, Customers, Availability, Messages, Reminders, Website Content ya Settings ke bare mein poochein. Sirf aap ke account ke liye allowed destinations dikhaye jate hain.'};
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
      if(size>145000){void reader.cancel().catch(() => {});throw new SupportError('request_too_large','Ask a shorter question.',413);}
      chunks.push(value);
    }
    const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
    try{
      const parsed=object(JSON.parse(new TextDecoder().decode(all)));
      const {conversationId:opaqueContext,...fields}=parsed;
      if(JSON.stringify(fields).length>16384)throw new SupportError('request_too_large','Ask a shorter question.',413);
      return parsed;
    }catch(error){if(error instanceof SupportError)throw error;throw new SupportError('invalid_input','Invalid request JSON.');}
  } finally {
    clearTimeout(timer);
  }
}
function localeFor(message:string,requested:unknown,previous?:Conversation):Locale {
  if(requested==='en'||requested==='ur-Latn')return requested;
  if(/\b(kahan|kaise|kyun|nahi|hai|hain|gaari|gari|wapis|wapas|karein|chabi|chaabi|mujhe|mera|kitna|dikhao)\b/i.test(message))return 'ur-Latn';
  return previous?.locale??'en';
}
/** Shared local/edge boundary; model and read-only capabilities are injected. */
export async function handleSupportRequest(req:Request,deps:Dependencies):Promise<Response> {
  const authorizationRevision=knowledgeRevision+(deps.finance?JSON.stringify(deps.finance.policy):'');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Authorization'};
  const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
  try {
    if(req.method!=='POST')throw new SupportError('method_not_allowed','Use POST.',405);
    const token=req.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if(!token)throw new SupportError('unauthorized','Sign in to use TRAX.',401);
    const body=await boundedBody(req);onlyKeys(body,['type','message','tenantId','conversationId','contextScope','pageContext','navigation','locale','issueId','resumeId','ticket','policy','retentionHold']);
    const type=body.type??'message';
    if(!['message','context','navigate','recheck','resume','select_issue','new_issue','resolve_issue','tickets','ticket_detail','update_ticket','retention_policy','retention_preview','retention_hold'].includes(String(type)))throw new SupportError('tool_unavailable','Business actions are not available in this TRAX phase.',403);
    const auth=await authorize(deps.reads,token,body.tenantId);auth.scope=await digest(auth.scope+authorizationRevision);
    if(body.contextScope!=null && body.contextScope!==auth.scope)throw new SupportError('context_changed','Account access changed. Start a new conversation.',409);
    const now=deps.now?.()??Date.now();
    let conversation=body.conversationId==null?{id:crypto.randomUUID(),expires:now+30*60_000} as Conversation:await verifyConversation(deps.signingSecret,auth,body.conversationId,now);
    let revision:number|null=null;
    const policy=deps.escalationPolicy??DEFAULT_ESCALATION_POLICY;
    let supportAccess={supportAgent:false,managePolicy:false,deliveryReady:false};
    let storageReady=false;
    if(deps.store){try{supportAccess=await deps.store.capabilities(auth);storageReady=true;}catch{/* Failed storage is visible; it must not prevent safe guidance. */}}
    if(type==='resume'){
      if(!storageReady||typeof body.resumeId!=='string')throw new SupportError('support_storage_unavailable','Stored conversations are unavailable.',503);
      const stored=await deps.store!.load(auth,body.resumeId);if(!stored)throw new SupportError('conversation_invalid','This conversation is unavailable in your current access context.',409);
      conversation={...stored.state,expires:now+30*60_000,persisted:true};revision=stored.revision;
    }else if(conversation.persisted){
      if(!storageReady)throw new SupportError('support_storage_unavailable','Your stored issue is temporarily unavailable. Try again; it has not been deleted.',503);
      const stored=await deps.store!.load(auth,conversation.id);if(!stored)throw new SupportError('conversation_invalid','This conversation is unavailable in your current access context.',409);
      conversation={...stored.state,expires:now+30*60_000,persisted:true};revision=stored.revision;
    }
    const env={auth,reads:deps.reads};let page:PageContext|undefined;
    if(body.pageContext!=null){const p=object(body.pageContext);onlyKeys(p,['kind','id']);if(typeof p.kind!=='string'||typeof p.id!=='string')throw new SupportError('invalid_input','Invalid page context.');page=p as unknown as PageContext;await validateEntity(env,page);}
    const reauthorize=async()=>{const fresh=await authorize(deps.reads,token,body.tenantId);fresh.scope=await digest(fresh.scope+authorizationRevision);if(fresh.scope!==auth.scope)throw new SupportError('context_changed','Account access changed. Start a new conversation.',409);};
    const modelReady=!!(deps.model&&deps.operational&&deps.clock);
    const financeReady=modelReady&&financeScopes(auth,deps.finance?.policy).length>0;
    // A money question used to be diverted away from the model unless the STRIPE
    // read-only feature was configured, because there was no verified source for a
    // figure. There is now: the business query layer measures the account's own
    // records, gated by the staff finance rule. So "export our payments" reaches
    // the model when this caller may read money, even where Stripe is not set up.
    // `financeReady` still means the Stripe investigation capability, and still
    // drives the capability flag the client reads.
    const moneyAnswerable=modelReady&&databaseFinanceScopes(auth).length>0;
    // …but only for questions the database can actually settle. "What is my Stripe
    // balance" and "did the payment arrive" need the provider, so they still go to
    // a person when the Stripe capability is absent.
    const answerableHere=moneyAnswerable&&!needsProviderEvidence(body.message);;
    let response:Record<string,unknown>={response:'',sources:[],navigation:[],provenance:{...provenance,engine:'prepared_fallback'},capabilities:{modelReady,operationalChecks:modelReady,finance:financeReady,supportStorage:storageReady,supportAgent:supportAccess.supportAgent,managePolicy:supportAccess.managePolicy,supportSubmission:false}};
    const requireStore=()=>{if(!storageReady)throw new SupportError('support_storage_unavailable','Persistent support storage is not available. No ticket was created. Your conversation is preserved for retry.',503);return deps.store!;};
    const activeIssue=()=>{const issue=conversation.issues?.find(i=>i.id===(body.issueId??conversation.activeIssueId));if(!issue)throw new SupportError('issue_unavailable','Select an issue in this conversation.');return issue;};
    const validateIssueRecords=async()=>{for(const record of activeIssue().records)await validateEntity(env,record);};
    if(['resume','message','recheck'].includes(String(type))&&conversation.activeIssueId)await validateIssueRecords();
    let stateChanged=type==='resume';
    if(type==='context'&&storageReady){response.recentConversations=(await deps.store!.recent(auth)).map(row=>({id:row.id,lastActivityAt:row.last_activity_at,summary:row.state.issues?.[0]?.summary??'Support conversation'}));}
    if(['tickets','ticket_detail','update_ticket'].includes(String(type))){
      const store=requireStore(),a=ticketInput(body.ticket??{}),queue=a.queue===true;
      if((queue||type==='update_ticket')&&!supportAccess.supportAgent)throw new SupportError('forbidden','Support staff access is required.',403);
      if(type==='tickets')response.ticketPage=await store.tickets(auth,queue,Number(a.offset??0));
      else if(typeof a.id!=='string')throw new SupportError('invalid_input','Choose a ticket.');
      else if(type==='ticket_detail'){
        const ticket=await store.detail(auth,a.id,queue);
        if(!queue&&Array.isArray(ticket.handoff.recordReferences))for(const record of ticket.handoff.recordReferences)await validateEntity(env,record);
        response.ticket=ticket;
      }else{
        if(!['open','in_progress','closed'].includes(String(a.status))||typeof a.note!=='string'||a.note.length>2000||typeof a.retentionHold!=='boolean')throw new SupportError('invalid_input','Choose a ticket status and a note of up to 2,000 characters.');
        response.ticket=await store.update(auth,a.id,a.status as 'open',a.note,a.retentionHold);
      }
    }else if(type==='retention_policy'||type==='retention_preview'||type==='retention_hold'){
      const store=requireStore();if(!supportAccess.managePolicy)throw new SupportError('forbidden','Retention administrator access is required.',403);
      if(type==='retention_preview')response.retentionPreview=await store.dryRun(auth);
      else if(type==='retention_hold'){if(typeof body.resumeId!=='string'||typeof body.retentionHold!=='boolean')throw new SupportError('invalid_input','Choose a conversation and its retention hold.');await store.holdConversation(auth,body.resumeId,body.retentionHold);response.retentionHold=body.retentionHold;}
      else{let update;if(body.policy!=null){const a=object(body.policy);onlyKeys(a,['conversation_days','closed_ticket_days','inactive_open_days']);for(const key of ['conversation_days','closed_ticket_days','inactive_open_days'])if(!Number.isInteger(a[key])||Number(a[key])<1||Number(a[key])>3650)throw new SupportError('invalid_input','Retention periods must be between 1 and 3,650 days.');update=a as {conversation_days:number;closed_ticket_days:number;inactive_open_days:number};}response.retentionPolicy=await store.policy(auth,update);}
    }else if(type==='select_issue'||type==='resolve_issue'||type==='new_issue'){
      if(type==='new_issue'){conversation.issues??=[];if(conversation.issues.length>=12)throw new SupportError('issue_limit','Start a new conversation for more issues.');const issue=newIssue('other','New support issue');conversation.issues.push(issue);conversation.activeIssueId=issue.id;conversation.turns=[];conversation.diagnostic=undefined;conversation.paymentCheck=undefined;}
      else{const issue=activeIssue();await validateIssueRecords();conversation.activeIssueId=issue.id;
        if(type==='resolve_issue')recordIssueEvent(issue,'user_resolved','user_confirmed_resolution',now,policy);
        if(type==='select_issue'){conversation.turns=issue.excerpts.slice(-4).map(e=>({role:e.role,content:e.content}));conversation.diagnostic=issue.diagnostic;conversation.paymentCheck=issue.paymentCheck;}}
      stateChanged=true;
    }else if(type==='navigate'){
      const navigation=await runTool('resolve_navigation_target',body.navigation,env);
      if (!('href' in navigation)) throw new SupportError('service_unavailable','Navigation could not be verified.',503);
      response={...response,href:navigation.href,navigation:[navigation.action]};
    }else if(type==='message'||type==='recheck'){
      if(type==='recheck'){
        if(!conversation.diagnostic&&!conversation.paymentCheck)throw new SupportError('invalid_input','There is no previous diagnostic to recheck.');
        body.message=conversation.diagnostic?(conversation.locale==='ur-Latn'?'Dobara live records check karein.':'Check the same vehicle and booking window again using fresh records.')
          :(conversation.locale==='ur-Latn'?'Check again: isi rental ki payments dobara fresh Stripe records se check karein.':'Check again: verify the same rental payments with fresh Stripe records.');
      }
      if(typeof body.message!=='string'||!body.message.trim()||body.message.length>4000)throw new SupportError('invalid_input','Enter an application question of up to 4,000 characters.');
      const language=localeFor(body.message,body.locale,conversation);
      const humanRequested=/\b(?:human (?:support|agent)|contact support|speak to (?:a |an )?(?:person|agent|human)|support se baat|insaan se baat|insan se baat)\b/i.test(body.message);
      stateChanged=true;
      conversation.issues??=[];
      if(!conversation.issues.some(i=>i.id===conversation.activeIssueId)){
        const issue=newIssue(isFinanceQuestion(body.message)?'payments':page?.kind==='vehicle'?'vehicle_availability':'workflow',body.message,page);conversation.issues.push(issue);conversation.activeIssueId=issue.id;
      }
      if((isFinanceQuestion(body.message)&&!financeReady&&!answerableHere)||humanRequested){
        const finance=isFinanceQuestion(body.message);
        let issue=finance?conversation.issues.find(i=>i.topic==='payments'&&i.state!=='resolved'&&(!page||i.record?.id===page.id)):conversation.issues.find(i=>i.id===conversation.activeIssueId&&i.state!=='resolved');
        if(!issue){if(conversation.issues.length>=12)throw new SupportError('issue_limit','Start a new conversation for another issue.');issue=newIssue(finance?'payments':'other',body.message,page);conversation.issues.push(issue);}conversation.activeIssueId=issue.id;conversation.diagnostic=issue.diagnostic;conversation.paymentCheck=issue.paymentCheck;
        recordIssueEvent(issue,humanRequested?'human_requested':'unsupported_finance',humanRequested?'user_request':'finance_capability',now,policy);
        issue.excerpts=[...issue.excerpts,{role:'user' as const,content:redactSupportText(body.message),at:new Date(now).toISOString()}].slice(-8);
      }
      let modelAnswer=false;
      if(modelReady&&(!isFinanceQuestion(body.message)||financeReady||answerableHere)&&!humanRequested) {
        try {
          const answer=await modelConversation(body.message,language,conversation,page,{...env,model:deps.model!,operational:deps.operational!,fleet:deps.fleet,business:deps.business,reports:deps.reports,integrations:deps.integrations,finance:deps.finance,escalationPolicy:policy,clock:deps.clock!,now,observe:deps.now,reauthorize,signal:AbortSignal.any([req.signal,AbortSignal.timeout(65_000)]),audit:deps.audit},type==='recheck');
          response={...response,...answer,provenance:{...provenance,kind:'operational_support',protocolVersion:2,engine:'model',model:deps.model!.name,liveDataChecked:answer.evidence.some(e=>e.checks.length>0||e.sources.length>0),observedAt:answer.evidence.at(-1)?.observedAt}};
          modelAnswer=true;
          // Cited reviewed guidance keeps its permission-checked destinations when the model resolved none.
          if(!answer.navigation.length){const cited=KNOWLEDGE.guides.find(g=>answer.sources.some(s=>s.id===g.id&&'table' in s&&s.table==='application_knowledge'));if(cited&&guideAvailable(auth,cited))response.navigation=await guideNavigation(cited,env,page);}
        }catch(error){if(!(error instanceof ModelUnavailable))throw error;response.modelUnavailable=true;const issue=conversation.issues?.find(i=>i.id===conversation.activeIssueId);if(issue)recordIssueEvent(issue,'persistent_tool_failure','required_model_unavailable',now,policy);}
      }
      if(!modelAnswer){
      const guides=await runTool('search_application_knowledge',{query:body.message},env) as Guide[];let guide=guides[0];
      if(!guide && !isFinanceQuestion(body.message) && /^(and |aur |what next|next|tell me more|more|explain|details|continue)/i.test(body.message.trim()) && conversation.section){const previous=KNOWLEDGE.guides.find((g)=>g.id===conversation.section);if(previous&&guideAvailable(auth,previous))guide=previous;}
      response={...response,response:`${response.modelUnavailable?(language==='en'?'Application guidance only. Any attempted live checks could not produce a verified diagnostic answer.':'Sirf application guidance. Live checks se verified diagnostic jawab nahi mila.'):disclaimer[language]}\n\n${guide?guide[language]:unavailable[language]}`,
        sources:guide?[{table:'application_knowledge',id:guide.id,title:guide.title,knowledgeVersion:KNOWLEDGE.version,sourceCommit:KNOWLEDGE.sourceCommit,verifiedAt:KNOWLEDGE.verifiedAt}]:[],navigation:guide?await guideNavigation(guide,env,page):[]};
      conversation.section=guide?.id;conversation.locale=language;
      response.response=`${language==='en'?'Prepared guidance fallback — no AI model answer or live diagnostic was verified.':'Tayyar guidance fallback — AI model ka jawab ya live diagnosis verify nahi hua.'}\n\n${response.response}`;
      if(isFinanceQuestion(body.message))response.response=language==='en'?'Payment and Stripe investigations are not available in this TRAX environment. No payment record or processor balance was checked, and no charge, refund or repair was attempted. I cannot establish the cause or promise an outcome. Open Support from the sidebar to message the Drive247 support team.':'Is TRAX environment mein payment aur Stripe checks available nahi hain. Koi payment record check ya change nahi hua. Wajah ya paison ka result verify nahi kar sakta. Drive247 support team se baat ke liye sidebar se Support kholein.';
      else if(humanRequested){response.response=language==='en'?'I can’t contact the support team for you. Open Support from the sidebar to message the Drive247 support team directly.':'Main support team se aap ki taraf se rabta nahi kar sakta. Drive247 support team ko seedha message karne ke liye sidebar se Support kholein.';response.sources=[];response.navigation=[];}
      } else conversation.locale=language;
      if(!modelAnswer&&isFinanceQuestion(body.message)&&financeReady&&response.modelUnavailable){
        response.response=language==='en'?'The AI response could not be completed. Payment checks may have been attempted, but no complete answer was verified. No payment was charged, captured, refunded or repaired.':'AI ka jawab mukammal nahi ho saka. Payment checks ki koshish hui ho sakti hai, lekin mukammal jawab verify nahi hua. Koi payment change nahi hui.';
      }
      const currentIssue=conversation.issues?.find(i=>i.id===conversation.activeIssueId);
      if(currentIssue&&!modelAnswer){currentIssue.excerpts=[...currentIssue.excerpts.filter(e=>!(e.at===new Date(now).toISOString()&&e.role==='user'&&e.content===redactSupportText(String(body.message)))),{role:'user' as const,content:redactSupportText(String(body.message)),at:new Date(now).toISOString()},{role:'assistant' as const,content:redactSupportText(String(response.response)),at:new Date(now).toISOString()}].slice(-8);}
    }
    /* TRAX does not raise support tickets (removed 2026-10-16). When it cannot
       resolve something it says so and points the operator to Support, where
       they write to the team themselves. Nothing here creates a ticket. */
    /* Keep the answer as it was shown, with the conversation. A reopened
       conversation then replays evidence, the provenance line, verified
       destinations and Check Again — not a bare text echo.
       Only where support storage is configured: an unstored conversation travels
       in its own token, which has a hard size limit, and the browser already
       holds that session's messages. Bounded to the last 30 turns. */
    if(storageReady&&['message','recheck'].includes(String(type))){
      const at=new Date(now).toISOString();
      conversation.transcript=[...(conversation.transcript??[]),
        {role:'user' as const,content:redactSupportText(type==='recheck'?'Check again':String(body.message??''),4000),at},
        {role:'assistant' as const,content:String(response.response??''),at,
          sources:response.sources as unknown[],provenance:response.provenance as Record<string,unknown>,
          evidence:response.evidence as unknown[],navigation:response.navigation as unknown[],
          canRecheck:response.canRecheck===true}
      ].slice(-30);
      stateChanged=true;
    }

    const fresh=await authorize(deps.reads,token,body.tenantId);fresh.scope=await digest(fresh.scope+authorizationRevision);
    if(fresh.scope!==auth.scope)throw new SupportError('context_changed','Account access changed. Start a new conversation.',409);
    if(storageReady&&stateChanged){conversation.persisted=true;revision=await deps.store!.save(auth,conversation,revision);}
    if(storageReady){const latestAccess=await deps.store!.capabilities(fresh);if(JSON.stringify(latestAccess)!==JSON.stringify(supportAccess))throw new SupportError('context_changed','Support permissions changed. Reload this conversation.',409);}
    response.issues=(conversation.issues??[]).map(issueView);response.activeIssueId=conversation.activeIssueId;
    if(type==='resume'||type==='select_issue'){
      /* Reopening replays the stored transcript when there is one (everything the
         answer carried), and falls back to the issue's redacted excerpts for a
         conversation recorded before transcripts existed. Check Again is offered
         only on the last answer, and only while the diagnostic it would re-run is
         still part of this conversation. */
      const transcript=type==='resume'?conversation.transcript??[]:[];
      response.resumedMessages=transcript.length
        ?transcript.map((turn,index)=>({...turn,canRecheck:turn.canRecheck===true&&index===transcript.length-1&&!!(conversation.diagnostic||conversation.paymentCheck)}))
        :conversation.issues?.find(i=>i.id===conversation.activeIssueId)?.excerpts??[];
    }
    response.provenance={...(response.provenance as object),conversationStorage:conversation.persisted?'tenant_scoped_support_store':'browser_memory_only'};
    const tokenState=conversation.persisted?{id:conversation.id,expires:now+30*60_000,persisted:true}:conversation;
    return respond({...response,contextScope:auth.scope,conversationId:await conversationToken(deps.signingSecret,auth,tokenState)});
  }catch(error){
    if(error instanceof SupportError)return respond({error:error.message,code:error.code},error.status);
    return respond({error:'TRAX could not verify access or load application guidance. Try again.',code:'service_unavailable'},503);
  }
}
