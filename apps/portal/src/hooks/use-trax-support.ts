import { useState, useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { useTenant } from '@/contexts/TenantContext';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { TraxRequestScope, traxPageContext } from '@/lib/trax-session';
import { isV2 } from '@/lib/v2';
import { useV2 } from '@/lib/v2-context';
import type { ChatMessage, ChatApiResponse, UseChatReturn, TraxNavigation, TraxCapabilities } from '@/types/trax-support';

class ChatFailure extends Error { constructor(message:string,public code:string){super(message);} }
interface ChatState { key:string; scope:string|null; ready:boolean; messages:ChatMessage[]; conversationId:string|null; error:string|null; capabilities?:TraxCapabilities; issues?:ChatApiResponse['issues'];activeIssueId?:string;recentConversations?:ChatApiResponse['recentConversations'] }
const empty=(key:string):ChatState=>({key,scope:null,ready:false,messages:[],conversationId:null,error:null});

export function useTraxSupport(enabled = true, surfaceVisible = true): UseChatReturn {
  const { appUser, user } = useAuthStore();
  const { tenant } = useTenant();
  const chromeEnabled=useV2('chrome');
  // Follow the reviewed V2 rollout, including tenants enrolled after Northwind.
  enabled=enabled && chromeEnabled && isV2('chrome',tenant?.slug);
  const { permissions } = useManagerPermissions();
  const pathname=usePathname();const router=useRouter();
  const userId=user?.id??appUser?.auth_user_id;
  const key=JSON.stringify([enabled,userId,appUser?.id,appUser?.role,appUser?.is_active,appUser?.is_super_admin,tenant?.id,
    [...permissions].map((p)=>`${p.tab_key}:${p.access_level}`).sort()]);
  const gate=useRef(new TraxRequestScope());gate.current.setScope(key);
  const [chat,setChat]=useState<ChatState>(()=>empty(key));
  const state=useRef(chat);state.current=chat;
  const [loading,setLoading]=useState(false);
  const busy=useRef(false);
  const currentKey=useRef(key);currentKey.current=key;

  const call=useCallback(async(body:Record<string,unknown>,signal:AbortSignal):Promise<ChatApiResponse>=>{
    const supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const localDevelopment=process.env.NODE_ENV==='development';
    if(!localDevelopment&&!supabaseUrl)throw new ChatFailure('The application-guidance service is not configured in this environment.','unsupported_service');
    const endpoint=localDevelopment?'/api/trax-support':`${supabaseUrl}/functions/v1/trax-support`;
    const {data:{session}}=await supabase.auth.getSession();
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    if(!session?.access_token || session.user.id!==userId)throw new ChatFailure('Sign in again to use TRAX.','unauthorized');
    const result=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({...body,tenantId:tenant?.id}),signal,cache:'no-store'});
    const data=await result.json();
    if(!result.ok)throw new ChatFailure(data.error||'TRAX could not verify access.',data.code||'service_unavailable');
    // Do not silently consume an old deployed RAG endpoint with live-looking data.
    const guidance=data.provenance?.kind==='application_guidance'&&data.provenance?.liveDataChecked===false;
    const operational=data.provenance?.kind==='operational_support'&&data.provenance?.protocolVersion===2&&data.provenance?.engine==='model'&&typeof data.provenance?.liveDataChecked==='boolean';
    const allowedTables=operational?['application_knowledge','vehicles','rentals','pickup_locations','blocked_dates','rental_key_handovers','availability_check','account_summary',...(data.capabilities?.finance===true?['payment_check','stripe_account_summary','payment_evidence']:[])]:['application_knowledge'];
    if((!guidance&&!operational)||typeof data.contextScope!=='string'
      ||!Array.isArray(data.sources)||data.sources.some((s:{table:string})=>!allowedTables.includes(s.table))||data.chart||data.rentalRequests||data.action){
      throw new ChatFailure('The application-guidance service is not available in this environment.','unsupported_service');
    }
    if(operational&&(!Array.isArray(data.evidence)||data.evidence.length>7||data.evidence.some((e:any)=>!['verified','partial','restricted','missing','error','needs_input'].includes(e.status)||typeof e.observedAt!=='string'||!Array.isArray(e.findings)||!Array.isArray(e.checks)||!Array.isArray(e.limitations))))throw new ChatFailure('The diagnostic response could not be verified.','unsupported_service');
    // External destinations are the only links TRAX renders: exact Stripe dashboard payment pages for the
    // card's own verified PaymentIntent, or Stripe-hosted receipts, and only with the finance capability.
    const dashboard=/^https:\/\/dashboard\.stripe\.com\/(?:test\/)?payments\/(pi_[A-Za-z0-9]+)$/,receipt=/^https:\/\/pay\.stripe\.com\/receipts\/[A-Za-z0-9/_-]{1,200}(?:\?[A-Za-z0-9=&_%-]{0,200})?$/;
    const validAction=(card:any,action:any)=>typeof action?.href==='string'&&(action.kind==='stripe_dashboard'?action.label==='Open in Stripe'&&dashboard.exec(action.href)?.[1]===card.reference?.stripe:action.kind==='receipt'&&action.label==='View receipt'&&receipt.test(action.href));
    if(operational&&data.evidence.some((e:any)=>e.data?.paymentCards!==undefined&&(data.capabilities?.finance!==true||!Array.isArray(e.data.paymentCards)||e.data.paymentCards.length>25
      ||e.data.paymentCards.some((card:any)=>typeof card?.paymentId!=='string'||!['verified','discrepancy','offline','unable'].includes(card?.verification?.result)||!Array.isArray(card.actions)||card.actions.length>2||card.actions.some((action:any)=>!validAction(card,action))))))
      throw new ChatFailure('The payment evidence could not be verified.','unsupported_service');
    return data;
  },[tenant?.id,userId]);

  const reset=useCallback((error:string|null=null)=>{
    gate.current.invalidate();busy.current=false;setLoading(false);
    setChat({...empty(currentKey.current),error});
  },[]);

  const checkContext=useCallback(async()=>{
    if(!tenant?.id||!userId||!enabled)return null;
    const lease=gate.current.begin();
    try{
      const data=await call({type:'context'},lease.signal);
      if(!lease.current())return null;
      const supportAccessChanged=state.current.capabilities?.supportAgent!==data.capabilities?.supportAgent||state.current.capabilities?.managePolicy!==data.capabilities?.managePolicy||state.current.capabilities?.finance!==data.capabilities?.finance;
      if(state.current.key===key && state.current.scope && (state.current.scope!==data.contextScope||supportAccessChanged)){
        gate.current.invalidate();busy.current=false;setLoading(false);
      }
      setChat((old)=>old.key===key&&old.scope===data.contextScope?{...old,ready:true,error:null,capabilities:data.capabilities,recentConversations:data.recentConversations}:{...empty(key),ready:true,scope:data.contextScope,capabilities:data.capabilities,recentConversations:data.recentConversations});
      return data.contextScope;
    }catch(error){
      if(lease.current())reset(error instanceof Error?error.message:'Access could not be verified.');
      return null;
    }finally{lease.finish();}
  },[call,enabled,key,reset,tenant?.id,userId]);

  useEffect(()=>{
    gate.current.invalidate();busy.current=false;setLoading(false);setChat(empty(key));
    if(!enabled)return;
    void checkContext();
    // Payloads are not trusted as permissions; only invalidate and refetch server context.
    const channel=appUser?.id?supabase.channel(`trax-access-${appUser.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'manager_permissions',filter:`app_user_id=eq.${appUser.id}`},()=>{reset();void checkContext();})
      .on('postgres_changes',{event:'*',schema:'public',table:'app_users',filter:`id=eq.${appUser.id}`},()=>{reset();void checkContext();}).subscribe():null;
    return()=>{gate.current.invalidate();if(channel)void supabase.removeChannel(channel);};
  },[enabled,key,checkContext,appUser?.id,reset]);

  // Recheck access while a surface shows the conversation. Returning to the window no longer
  // aborts a reply in flight or blanks the thread: checkContext resets only when the server
  // scope or support access actually changed. Nothing polls while Trax is closed.
  useEffect(()=>{
    if(!enabled||!surfaceVisible)return;
    const revalidate=()=>{if(!busy.current&&state.current.ready&&state.current.key===key)void checkContext();};
    revalidate();
    const timer=setInterval(revalidate,30_000);
    window.addEventListener('focus',revalidate);
    const visibility=()=>{if(document.visibilityState==='visible')revalidate();};
    document.addEventListener('visibilitychange',visibility);
    return()=>{clearInterval(timer);window.removeEventListener('focus',revalidate);document.removeEventListener('visibilitychange',visibility);};
  },[enabled,surfaceVisible,key,checkContext]);

  const sendMessage=useCallback(async(content:string,recheck=false)=>{
    if(!enabled||!content.trim()||busy.current)return;
    let scope=state.current.key===key&&state.current.ready?state.current.scope:null;
    if(!scope)scope=await checkContext();
    if(!scope||currentKey.current!==key)return;
    const lease=gate.current.begin();busy.current=true;setLoading(true);
    const previous=state.current.key===key&&state.current.scope===scope?state.current.conversationId:null;
    const message:ChatMessage={id:crypto.randomUUID(),role:'user',content:content.trim(),timestamp:new Date()};
    let refreshRecent=false;
    setChat((old)=>({...old,messages:[...old.messages,message],error:null}));
    try{
      const data=await call({type:recheck?'recheck':'message',message:content.trim(),contextScope:scope,conversationId:previous,pageContext:traxPageContext(pathname)},lease.signal);
      if(!lease.current())return;
      if(data.contextScope!==scope){reset('Your access changed. Start a new conversation.');return;}
      setChat((old)=>({...old,conversationId:data.conversationId,capabilities:data.capabilities,issues:data.issues,activeIssueId:data.activeIssueId,messages:[...old.messages,{id:crypto.randomUUID(),role:'assistant',content:data.response,sources:data.sources,provenance:data.provenance,navigation:data.navigation,evidence:data.evidence,canRecheck:data.canRecheck,ticket:data.ticket&&{id:data.ticket.id,reference:data.ticket.reference},ticketRetry:data.ticketRetry,timestamp:new Date()}]}));
      refreshRecent=!previous&&data.capabilities?.supportStorage===true;
    }catch(error){
      if(!lease.current())return;
      const text=error instanceof Error?error.message:'Unable to load application guidance.';
      // Discard context after every failed access/service response; never reuse uncertain evidence.
      reset(text);
    }finally{if(lease.current()){busy.current=false;setLoading(false);}lease.finish();}
    // A newly stored conversation appears in the recent list on the next context read.
    if(refreshRecent)void checkContext();
  },[enabled,key,checkContext,call,pathname,reset]);

  const navigate=useCallback(async(action:TraxNavigation)=>{
    const current=state.current;
    if(!enabled||current.key!==key||!current.ready||!current.scope||busy.current)return false;
    const lease=gate.current.begin();busy.current=true;setLoading(true);
    try{
      const data=await call({type:'navigate',contextScope:current.scope,conversationId:current.conversationId,navigation:{target:action.target,...(action.entityId?{entityId:action.entityId}:{})}},lease.signal);
      if(!lease.current())return false;
      if(data.contextScope!==current.scope || typeof data.href!=='string'||!data.href.startsWith('/')||data.href.startsWith('//')||/[\\\r\n]/.test(data.href))throw new ChatFailure('Navigation could not be verified.','navigation_unavailable');
      router.push(data.href);return true;
    }catch(error){if(lease.current())reset(error instanceof Error?error.message:'Navigation unavailable.');return false;}
    finally{if(lease.current()){busy.current=false;setLoading(false);}lease.finish();}
  },[enabled,key,call,router,reset]);

  const supportRequest=useCallback(async(type:string,payload:Record<string,unknown>={})=>{
    const current=state.current;
    if(!enabled||current.key!==key||!current.ready||!current.scope||busy.current)return null;
    const lease=gate.current.begin();busy.current=true;setLoading(true);
    try{
      // Resume starts from a fresh token (the current one may have expired); the server loads the
      // stored conversation by resumeId after checking access.
      const data=await call({type,contextScope:current.scope,conversationId:type==='resume'?null:current.conversationId,...payload},lease.signal);
      if(!lease.current())return null;
      if(data.contextScope!==current.scope){reset('Your access changed. Reload this conversation.');return null;}
      setChat(old=>({...old,error:null,conversationId:data.conversationId,issues:data.issues,activeIssueId:data.activeIssueId,capabilities:data.capabilities,
        // A reopened conversation keeps its ticket: the last answer gets the ticket
        // back, so Open support ticket is there rather than only in the text.
        messages:type==='new_issue'?[]:data.resumedMessages?(data.resumedMessages.length?data.resumedMessages.map((e,index,all)=>({id:crypto.randomUUID(),role:e.role,content:e.content,
          ...(data.ticket&&e.role==='assistant'&&index===all.map(m=>m.role).lastIndexOf('assistant')?{ticket:{id:data.ticket.id,reference:data.ticket.reference}}:{}),timestamp:new Date(e.at)}))
          :[{id:crypto.randomUUID(),role:'assistant' as const,content:'This earlier conversation is open again. Its previous messages are not stored for display; ask your next question to continue.',timestamp:new Date()}]):old.messages}));
      return data;
    }catch(error){
      if(lease.current()){
        const text=error instanceof Error?error.message:'Support request failed. Your issue is preserved for retry.';
        if(error instanceof ChatFailure&&['unauthorized','forbidden','context_changed','conversation_invalid'].includes(error.code)){reset(text);void checkContext();}
        else setChat(old=>({...old,error:text}));
      }
      return null;
    }finally{if(lease.current()){busy.current=false;setLoading(false);}lease.finish();}
  },[enabled,key,call,reset,checkContext]);

  /* The retry behind a failed automatic handoff. The server decides whether a
     ticket is created or an existing one is reused, and its answer — the real
     reference, or the honest failure — becomes the next assistant message. */
  const requestTicket=useCallback(async(issueId?:string)=>{
    const data=await supportRequest('support_ticket',issueId?{issueId}:{});
    if(!data)return null;
    setChat(old=>({...old,messages:[...old.messages,{id:crypto.randomUUID(),role:'assistant' as const,content:data.response,
      ticket:data.ticket&&{id:data.ticket.id,reference:data.ticket.reference},ticketRetry:data.ticketRetry,timestamp:new Date()}]}));
    return data;
  },[supportRequest]);

  const clearChat=useCallback(()=>{reset();void checkContext();},[reset,checkContext]);
  const checkAgain=useCallback(()=>sendMessage('Check again',true),[sendMessage]);
  // Kept for existing component contracts. Never calls the legacy write endpoint.
  const confirmAction=useCallback(async()=>{setChat((old)=>({...old,error:'Business actions are unavailable in application guidance.'}));},[]);
  const rejectAction=useCallback(()=>{},[]);
  const visible=enabled&&chat.key===key&&chat.ready;
  return {messages:visible?chat.messages:[],conversationId:visible?chat.conversationId:null,
    isLoading:loading||(enabled&&!visible&&!chat.error),error:chat.key===key?chat.error:null,
    sendMessage,confirmAction,rejectAction,clearChat,navigate,checkAgain,requestTicket,capabilities:visible?chat.capabilities:undefined,
    supportRequest,contextKey:key+':'+(visible?chat.scope:'')+':'+Boolean(chat.capabilities?.supportAgent)+':'+Boolean(chat.capabilities?.managePolicy),issues:visible?chat.issues:undefined,activeIssueId:visible?chat.activeIssueId:undefined,recentConversations:visible?chat.recentConversations:undefined};
}
