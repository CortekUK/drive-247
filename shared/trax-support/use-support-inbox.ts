'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessagingError, type MessagingCall } from './client';

/**
 * The support inbox's behaviour, without any markup: ticket list, one ticket's
 * conversation, unread acknowledgement, the composer and its retry.
 *
 * It is shared because the two surfaces that show support are not the same
 * shape and must not be the same component: the portal's tenant inbox is a
 * compact messaging view built on the portal's own v2 primitives, and the
 * platform inbox in the admin app is a queue with status controls. Only the
 * behaviour is common, and it is the part that must not drift — polling,
 * read-through acknowledgement, nonce reuse on retry and message ordering are
 * where a second implementation would quietly invent unread counts or duplicate
 * tickets.
 *
 * Everything here goes through `call` (shared/trax-support/client.ts): the same
 * authenticated `trax-messaging` endpoint, the same permissions, no direct
 * table access and no optimistic state that outlives a confirmation.
 */

export interface HumanTicket {id:string;reference:string;summary:string;status:'open'|'in_progress'|'closed';tenant_name:string;requester:string;updated_at:string;created_at:string;unread?:boolean;handoff?:Record<string,unknown>;emailStatus?:string;staff_note?:string}
export interface SupportMessage {seq:number;author_kind:'tenant'|'support';body:string;created_at:string}
export interface SupportThread {ticket:HumanTicket;messages:SupportMessage[];hasOlder:boolean;latestSeq:number}
/** A new request opened from elsewhere (a TRAX escalation), with its own submit path. */
export interface SupportCompose {summary:string;submit?:(body:string,nonce:string,subject:string)=>Promise<{id:string}|null>}

export interface SupportInboxOptions {
  call:MessagingCall;
  /** Identity + permissions the data belongs to; changing it resets everything. */
  scope:string;
  /** The platform queue: cross-tenant tickets, status changes, no New request. */
  admin?:boolean;
  initialId?:string;
  compose?:SupportCompose;
}

export function useSupportInbox({call,admin=false,initialId,compose,scope}:SupportInboxOptions){
  const [id,setId]=useState<string|null>(initialId??null),[creating,setCreating]=useState(!!compose);
  const [tickets,setTickets]=useState<HumanTicket[]>([]),[next,setNext]=useState<number|null>(null);
  const [thread,setThread]=useState<SupportThread|null>(null),[search,setSearch]=useState(''),[filter,setFilter]=useState('');
  const [draft,setDraft]=useState(''),[subject,setSubject]=useState(compose?.summary??''),[status,setStatus]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState('');
  const listRequest=useRef(0),threadRequest=useRef(0),selected=useRef(id);selected.current=id;
  const scrollRef=useRef<HTMLDivElement>(null),opened=useRef<string|null>(null),readThrough=useRef(0),marking=useRef(false),sending=useRef(false);
  const followBottom=useRef(true);
  const outgoing=useRef<{action:string;data:Record<string,unknown>}|null>(null);
  const [retrying,setRetrying]=useState(false);
  const nonceKey='trax-support-compose:'+scope;
  const [nonce,setNonce]=useState(()=>{try{const saved=sessionStorage.getItem(nonceKey);if(saved)return saved;const value=crypto.randomUUID();sessionStorage.setItem(nonceKey,value);return value;}catch{return crypto.randomUUID();}});
  const fail=useCallback((e:unknown)=>{if(e instanceof MessagingError&&['unauthorized','forbidden','context_changed'].includes(e.code)){setThread(null);setTickets([]);}
    setError(e instanceof Error?e.message:'The request could not be confirmed. Your draft is preserved.');},[]);
  const loadList=useCallback(async(offset=0)=>{const version=++listRequest.current;
    try{const data=await call('list',{search,status:filter,offset});if(version!==listRequest.current)return;setTickets(old=>offset?[...old,...data.tickets.filter((t:HumanTicket)=>!old.some(x=>x.id===t.id))]:data.tickets);setNext(data.nextOffset);setError(null);}catch(e){fail(e);}finally{setLoading(false);}
  },[call,search,filter,fail]);
  const loadThread=useCallback(async(before?:number)=>{if(!id)return;const version=++threadRequest.current;
    try{const data:SupportThread=await call('detail',{id,...(before?{before}:{})});if(selected.current!==id||version!==threadRequest.current)return;
      setThread(old=>{const map=new Map<number,SupportMessage>();if(old?.ticket.id===id)for(const m of old.messages)map.set(m.seq,m);for(const m of data.messages)map.set(m.seq,m);
        const messages=[...map.values()].sort((a,b)=>a.seq-b.seq);return {...data,messages,hasOlder:messages[0]?.seq>1};});setError(null);
    }catch(e){fail(e);}finally{setLoading(false);}
  },[id,call,fail]);
  useEffect(()=>{const delay=setTimeout(()=>void loadList(),200);return()=>{clearTimeout(delay);listRequest.current++;};},[loadList]);
  useEffect(()=>{setThread(null);readThrough.current=0;opened.current=null;setLoading(true);void loadThread();return()=>{threadRequest.current++;};},[loadThread]);
  useEffect(()=>{
    let fetching=false;
    const refresh=async()=>{if(fetching||sending.current||document.visibilityState==='hidden')return;fetching=true;await Promise.all([loadList(),loadThread()]);fetching=false;};
    const timer=setInterval(refresh,5000);window.addEventListener('online',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[loadList,loadThread]);
  /* Follow new messages only while the reader is already at the bottom: someone
     reading older messages is never yanked away from them. */
  useEffect(()=>{if(thread&&scrollRef.current&&(opened.current!==thread.ticket.id||followBottom.current)){scrollRef.current.scrollTop=scrollRef.current.scrollHeight;opened.current=thread.ticket.id;}},[thread]);
  /* Acknowledge only what was actually displayed, by the sequence the server
     returned — never the current server maximum. */
  useEffect(()=>{
    if(!thread||!scrollRef.current)return;const ticketId=thread.ticket.id;
    const observer=new IntersectionObserver(entries=>{if(document.visibilityState==='hidden'||marking.current||selected.current!==ticketId)return;
      const seen=Math.max(0,...entries.filter(e=>e.isIntersecting).map(e=>Number((e.target as HTMLElement).dataset.seq)));
      if(seen<=readThrough.current)return;marking.current=true;
      void call('read',{id:ticketId,through:seen}).then(()=>{if(selected.current===ticketId)readThrough.current=Math.max(readThrough.current,seen);window.dispatchEvent(new Event('trax-support-read'));}).catch(fail).finally(()=>{marking.current=false;});
    },{root:scrollRef.current,threshold:0.5});
    scrollRef.current.querySelectorAll('[data-seq]').forEach(el=>observer.observe(el));return()=>observer.disconnect();
  },[thread,call,fail]);
  /* A compose request can arrive AFTER mount: the portal's escalation handoff has
     to wait for the TRAX conversation to load before it knows the issue. Open the
     composer the first time one appears, and never again, so cancelling it stays
     cancelled and a later re-render cannot reopen it over the operator. */
  const composeSeen=useRef(!!compose);
  useEffect(()=>{
    if(!compose||composeSeen.current)return;
    composeSeen.current=true;
    setCreating(true);setId(null);setSubject(compose.summary);
  },[compose]);
  const choose=useCallback((ticketId:string)=>{if(ticketId===id)return;setId(ticketId);setCreating(false);setDraft('');outgoing.current=null;setRetrying(false);setStatus('');setNotice('');},[id]);
  const beginNew=useCallback(()=>{let value=crypto.randomUUID();try{value=sessionStorage.getItem(nonceKey)||value;sessionStorage.setItem(nonceKey,value);}catch{}setNonce(value);setCreating(true);setId(null);setSubject(compose?.summary??'');setDraft('');outgoing.current=null;setRetrying(false);setNotice('');},[compose,nonceKey]);
  /** Back to the list on a narrow screen: nothing is selected, nothing is lost. */
  const clearSelection=useCallback(()=>{setId(null);},[]);
  const cancelNew=useCallback(()=>{setCreating(false);setDraft('');outgoing.current=null;setRetrying(false);},[]);
  const loadMore=useCallback(()=>{if(next!==null)void loadList(next);},[loadList,next]);
  const loadOlder=useCallback(()=>{followBottom.current=false;void loadThread(thread?.messages[0]?.seq);},[loadThread,thread]);
  const onThreadScroll=useCallback((e:{currentTarget:HTMLElement})=>{const el=e.currentTarget;followBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;},[]);
  const canSend=!!draft.trim()&&(!creating||!!subject.trim());
  const send=useCallback(async()=>{
    if(sending.current||!draft.trim()||(creating&&!subject.trim()))return;sending.current=true;setBusy(true);setError(null);
    /* One payload per submission: an uncertain send is RETRIED with its original
       nonce, so support never receives the same message twice. */
    if(!outgoing.current){outgoing.current={action:creating?'create':admin&&status?'status':'send',data:{...(id&&!creating?{id}:{}),nonce:creating?nonce:crypto.randomUUID(),body:draft.trim(),...(creating?{subject:subject.trim()}:{}),...(admin&&status&&!creating?{status}:{})}};setRetrying(true);}
    try{
      const out=outgoing.current;
      const result=creating&&compose?.submit?await compose.submit(String(out.data.body),String(out.data.nonce),String(out.data.subject)):await call(out.action,out.data);
      if(!result)throw Error('Your message was not confirmed. Retry to check the same submission.');
      setDraft('');outgoing.current=null;setRetrying(false);setStatus('');setNotice('Message sent.');
      if(creating){try{sessionStorage.removeItem(nonceKey);}catch{}setNonce(crypto.randomUUID());setCreating(false);setId(result.id);}
      else{await loadThread();requestAnimationFrame(()=>{if(scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;});}
      await loadList();window.dispatchEvent(new Event('trax-support-read'));
    }catch(e){fail(e);}finally{sending.current=false;setBusy(false);}
  },[admin,call,compose,creating,draft,fail,id,loadList,loadThread,nonce,nonceKey,status,subject]);

  return {
    id,creating,tickets,next,thread,search,filter,draft,subject,status,
    busy,loading,error,notice,retrying,canSend,scrollRef,
    setSearch,setFilter,setDraft,setSubject,setStatus,
    choose,clearSelection,beginNew,cancelNew,loadMore,loadOlder,onThreadScroll,send,
  };
}

export type SupportInboxState=ReturnType<typeof useSupportInbox>;
