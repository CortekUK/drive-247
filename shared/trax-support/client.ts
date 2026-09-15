import { useCallback, useEffect, useRef, useState } from 'react';
export type MessagingCall=(action:string,data?:Record<string,unknown>)=>Promise<any>;
export class MessagingError extends Error {constructor(message:string,public code:string){super(message);}}
export function useMessagingClient({scope,token,tenantId,admin=false,url,anonKey}:{scope:string;token:()=>Promise<string|null>;tenantId?:string;admin?:boolean;url?:string;anonKey?:string}){
  const generation=useRef({scope,controller:new AbortController()});
  if(generation.current.scope!==scope){generation.current.controller.abort();generation.current={scope,controller:new AbortController()};}
  useEffect(()=>{if(generation.current.controller.signal.aborted)generation.current={scope,controller:new AbortController()};const state=generation.current;return()=>state.controller.abort();},[scope]);
  return useCallback<MessagingCall>(async(action,data={})=>{
    const state=generation.current;if(state.scope!==scope||state.controller.signal.aborted)throw new MessagingError('Account changed. Reload support.','context_changed');
    const bearer=await token();if(!bearer)throw new MessagingError('Sign in to view support.','unauthorized');
    const endpoint=process.env.NODE_ENV==='development'?'/api/trax-messaging':`${url}/functions/v1/trax-messaging`;
    const response=await fetch(endpoint,{method:'POST',cache:'no-store',signal:AbortSignal.any([state.controller.signal,AbortSignal.timeout(15000)]),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${bearer}`,...(anonKey?{apikey:anonKey}:{})},body:JSON.stringify({action,data,admin,...(!admin?{tenantId}:{})})});
    let result;
    try{result=await response.json();}catch{throw new MessagingError('Support could not be reached. Your draft is preserved for retry.','unavailable');}
    if(generation.current!==state||state.controller.signal.aborted)throw new MessagingError('Account changed. Reload support.','context_changed');
    if(!response.ok)throw new MessagingError(result.error??'Support request could not be confirmed.',result.code??'unavailable');
    return result;
  },[scope,token,tenantId,admin,url,anonKey]);
}
/** Persisted counts, rechecked on reconnect/focus. Never optimistically decrement. */
export function useSupportUnread(call:MessagingCall,enabled=true){
  const [state,setState]=useState<{count:number|null;allowed:boolean;checking:boolean;errorCode:string|null}>({count:null,allowed:false,checking:true,errorCode:null});
  const refreshRef=useRef<()=>Promise<void>>(async()=>{});
  const retry=useCallback(()=>refreshRef.current(),[]);
  useEffect(()=>{
    let active=true,busy=false;
    const refresh=async()=>{if(!active||!enabled||busy||document.visibilityState==='hidden')return;busy=true;setState(old=>({...old,checking:true}));
      try{const data=await call('count');if(active)setState({count:data.unread,allowed:true,checking:false,errorCode:null});}catch(error){if(active){const errorCode=error instanceof MessagingError?error.code:'unavailable';setState(old=>({count:null,allowed:['forbidden','unauthorized','context_changed'].includes(errorCode)?false:old.allowed,checking:false,errorCode}));}}finally{busy=false;}};
    refreshRef.current=refresh;
    setState({count:null,allowed:false,checking:enabled,errorCode:enabled?null:'forbidden'});void refresh();const timer=setInterval(refresh,5000);
    window.addEventListener('focus',refresh);window.addEventListener('online',refresh);
    // Count responses do not dispatch another count refresh (no polling loop).
    window.addEventListener('trax-support-read',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);window.removeEventListener('trax-support-read',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[call,enabled]);return {...state,retry};
}
