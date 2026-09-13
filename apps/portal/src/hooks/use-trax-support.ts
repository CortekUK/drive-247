import { useState, useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { useTenant } from '@/contexts/TenantContext';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { TraxRequestScope, traxPageContext } from '@/lib/trax-session';
import { isV2 } from '@/lib/v2';
import { useV2 } from '@/lib/v2-context';
import type { ChatMessage, ChatApiResponse, UseChatReturn, TraxNavigation } from '@/types/trax-support';

class ChatFailure extends Error { constructor(message:string,public code:string){super(message);} }
interface ChatState { key:string; scope:string|null; ready:boolean; messages:ChatMessage[]; conversationId:string|null; error:string|null }
const empty=(key:string):ChatState=>({key,scope:null,ready:false,messages:[],conversationId:null,error:null});

export function useTraxSupport(enabled = true): UseChatReturn {
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
    if(data.provenance?.kind!=='application_guidance'||data.provenance?.liveDataChecked!==false||typeof data.contextScope!=='string'
      ||!Array.isArray(data.sources)||data.sources.some((s:{table:string})=>s.table!=='application_knowledge')||data.chart||data.rentalRequests||data.action){
      throw new ChatFailure('The application-guidance service is not available in this environment.','unsupported_service');
    }
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
      if(state.current.key===key && state.current.scope && state.current.scope!==data.contextScope){
        gate.current.invalidate();busy.current=false;setLoading(false);
      }
      setChat((old)=>old.key===key&&old.scope===data.contextScope?{...old,ready:true,error:null}:{...empty(key),ready:true,scope:data.contextScope});
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
    const timer=setInterval(()=>void checkContext(),30_000);
    const revalidate=()=>{setChat((old)=>({...old,ready:false}));gate.current.invalidate();busy.current=false;setLoading(false);void checkContext();};
    window.addEventListener('focus',revalidate);
    const visibility=()=>{if(document.visibilityState==='visible')revalidate();};
    document.addEventListener('visibilitychange',visibility);
    // Payloads are not trusted as permissions; only invalidate and refetch server context.
    const channel=appUser?.id?supabase.channel(`trax-access-${appUser.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'manager_permissions',filter:`app_user_id=eq.${appUser.id}`},()=>{reset();void checkContext();})
      .on('postgres_changes',{event:'*',schema:'public',table:'app_users',filter:`id=eq.${appUser.id}`},()=>{reset();void checkContext();}).subscribe():null;
    return()=>{clearInterval(timer);window.removeEventListener('focus',revalidate);document.removeEventListener('visibilitychange',visibility);gate.current.invalidate();if(channel)void supabase.removeChannel(channel);};
  },[enabled,key,checkContext,appUser?.id,reset]);

  const sendMessage=useCallback(async(content:string)=>{
    if(!enabled||!content.trim()||busy.current)return;
    let scope=state.current.key===key&&state.current.ready?state.current.scope:null;
    if(!scope)scope=await checkContext();
    if(!scope||currentKey.current!==key)return;
    const lease=gate.current.begin();busy.current=true;setLoading(true);
    const previous=state.current.key===key&&state.current.scope===scope?state.current.conversationId:null;
    const message:ChatMessage={id:crypto.randomUUID(),role:'user',content:content.trim(),timestamp:new Date()};
    setChat((old)=>({...old,messages:[...old.messages,message],error:null}));
    try{
      const data=await call({message:content.trim(),contextScope:scope,conversationId:previous,pageContext:traxPageContext(pathname)},lease.signal);
      if(!lease.current())return;
      if(data.contextScope!==scope){reset('Your access changed. Start a new conversation.');return;}
      setChat((old)=>({...old,conversationId:data.conversationId,messages:[...old.messages,{id:crypto.randomUUID(),role:'assistant',content:data.response,sources:data.sources,provenance:data.provenance,navigation:data.navigation,timestamp:new Date()}]}));
    }catch(error){
      if(!lease.current())return;
      const text=error instanceof Error?error.message:'Unable to load application guidance.';
      // Discard context after every failed access/service response; never reuse uncertain evidence.
      reset(text);
    }finally{if(lease.current()){busy.current=false;setLoading(false);}lease.finish();}
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

  const clearChat=useCallback(()=>{reset();void checkContext();},[reset,checkContext]);
  // Kept for existing component contracts. Never calls the legacy write endpoint.
  const confirmAction=useCallback(async()=>{setChat((old)=>({...old,error:'Business actions are unavailable in application guidance.'}));},[]);
  const rejectAction=useCallback(()=>{},[]);
  const visible=enabled&&chat.key===key&&chat.ready;
  return {messages:visible?chat.messages:[],conversationId:visible?chat.conversationId:null,
    isLoading:loading||(enabled&&!visible&&!chat.error),error:chat.key===key?chat.error:null,
    sendMessage,confirmAction,rejectAction,clearChat,navigate};
}
