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

export interface HumanTicket {id:string;reference:string;summary:string;status:'open'|'in_progress'|'closed';tenant_name:string;requester:string;updated_at:string;created_at:string;unread?:boolean;handoff?:Record<string,unknown>;emailStatus?:string;staff_note?:string;
  /** The latest message, one truncated line. Present only where the deployment's list query provides it. */
  preview?:string;
  /** List only: this viewer's unread INCOMING messages in this ticket, counted by the
   *  server from stored messages and the viewer's own read state. Absent where the
   *  deployment does not report it. */
  unreadMessages?:number;
  /** Detail only. `conversation_id` is null for a ticket opened directly in Support. */
  conversation_id?:string|null;closed_at?:string|null;
  /** Platform queue only: whose ticket this is, by id (the filter panel's keys). */
  tenant_id?:string|null;requester_id?:string|null;
  /** This viewer's own star. */
  starred?:boolean;
  /** Platform view, detail only: when the requester was last emailed about this ticket. */
  emailedAt?:string;
  /** Detail only, from stored metadata: a TRAX conversation is behind this ticket,
   *  even where the reader's record permissions hide its context. Absent from a
   *  deployment that does not report it. */
  traxLinked?:boolean}
export interface SupportMessage {seq:number;author_kind:'tenant'|'support';body:string;created_at:string;
  /** `trax_handoff`: written by TRAX's automatic handoff, not typed by a person.
   *  Set by the server from stored metadata (messaging.ts, ticketSourceReader). */
  source?:'trax_handoff'}
/** A file on a message: metadata plus a short-lived signed read URL from the server. */
export interface SupportAttachment {id:string;seq:number;name:string;mime:string;size:number;authorKind:'tenant'|'support';url?:string}
/** One the operator picked but has not sent yet. */
export interface PendingAttachment {key:string;file:File;name:string;mime:string;size:number;error?:string}
export const ATTACHMENT_TYPES=['image/png','image/jpeg','image/webp','image/gif','application/pdf'];
export const ATTACHMENT_MAX_BYTES=10*1024*1024;
export const ATTACHMENT_MAX_FILES=3;
/** A reaction on a message: which side reacted, and whether it was the viewer. */
export interface SupportReaction {seq:number;emoji:string;by:'tenant'|'support';mine:boolean}
/** The five reactions, also the composer's emoji row. The server holds the same list. */
export const SUPPORT_REACTIONS=['👍','❤️','😂','😮','🙏'] as const;
export interface SupportThread {ticket:HumanTicket;messages:SupportMessage[];hasOlder:boolean;latestSeq:number;attachments?:SupportAttachment[];reactions?:SupportReaction[]}

/** The platform queue's combinable filters. Empty = no constraint. */
export interface SupportFilters {statuses:HumanTicket['status'][];tenants:string[];requesters:string[];reference:string;createdFrom:string;createdTo:string;unread:boolean;starred:boolean}
export const NO_FILTERS:SupportFilters={statuses:[],tenants:[],requesters:[],reference:'',createdFrom:'',createdTo:'',unread:false,starred:false};
/** How many filters are set: the number on the Filter button. */
export function activeFilterCount(f:SupportFilters){
  return (f.statuses.length?1:0)+(f.tenants.length?1:0)+(f.requesters.length?1:0)+(f.reference.trim()?1:0)+(f.createdFrom||f.createdTo?1:0)+(f.unread?1:0)+(f.starred?1:0);
}
/** The choices the panel offers: every company and requester with a ticket. */
export interface SupportFacets {tenants:{id:string;name:string;count:number}[];requesters:{id:string;name:string;tenantId:string;count:number}[]}
/** Platform support's new ticket: which company, and which of its people, it is for. */
export interface SupportTarget {tenant:string;requester:string}
export interface SupportTargetOptions {tenants:{id:string;name:string}[]|null;people:{id:string;name:string;email?:string|null;role?:string}[]|null}

export interface SupportInboxOptions {
  call:MessagingCall;
  /** Uploads the chosen file to the signed URL the server reserved for it.
   *  Supplied by the app (its Supabase client); without it the attach control
   *  is not offered rather than failing at send time. */
  uploadAttachment?:(upload:{url:string;token:string;path:string},file:File)=>Promise<void>;
  /** Identity + permissions the data belongs to; changing it resets everything. */
  scope:string;
  /** The platform queue: cross-tenant tickets, status changes, no New request. */
  admin?:boolean;
  initialId?:string;
}

export function useSupportInbox({call,admin=false,initialId,scope,uploadAttachment}:SupportInboxOptions){
  const [id,setId]=useState<string|null>(initialId??null),[creating,setCreating]=useState(false);
  const [tickets,setTickets]=useState<HumanTicket[]>([]),[next,setNext]=useState<number|null>(null);
  const [thread,setThread]=useState<SupportThread|null>(null),[search,setSearch]=useState(''),[filter,setFilter]=useState('');
  const [filters,setFilters]=useState<SupportFilters>(NO_FILTERS),[facets,setFacets]=useState<SupportFacets|null>(null);
  const [draft,setDraft]=useState(''),[subject,setSubject]=useState('');
  const [target,setTarget]=useState<SupportTarget>({tenant:'',requester:''});
  const [targetOptions,setTargetOptions]=useState<SupportTargetOptions>({tenants:null,people:null});
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState('');
  const listRequest=useRef(0),threadRequest=useRef(0),selected=useRef(id);selected.current=id;
  const scrollRef=useRef<HTMLDivElement>(null),opened=useRef<string|null>(null),readThrough=useRef(0),marking=useRef(false),sending=useRef(false);
  const followBottom=useRef(true);
  const outgoing=useRef<{action:string;data:Record<string,unknown>}|null>(null);
  /** Files already stored for the pending submission; a retry skips them. */
  const uploaded=useRef<Set<string>>(new Set());
  const [retrying,setRetrying]=useState(false);
  const [attachments,setAttachments]=useState<PendingAttachment[]>([]);
  const nonceKey='trax-support-compose:'+scope;
  const [nonce,setNonce]=useState(()=>{try{const saved=sessionStorage.getItem(nonceKey);if(saved)return saved;const value=crypto.randomUUID();sessionStorage.setItem(nonceKey,value);return value;}catch{return crypto.randomUUID();}});
  const fail=useCallback((e:unknown)=>{if(e instanceof MessagingError&&['unauthorized','forbidden','context_changed'].includes(e.code)){setThread(null);setTickets([]);}
    setError(e instanceof Error?e.message:'The request could not be confirmed. Your draft is preserved.');},[]);
  const loadList=useCallback(async(offset=0)=>{const version=++listRequest.current;
    /* Only the filters that are set travel, so a plain list request is unchanged. */
    const set:Record<string,unknown>={};
    if(admin){
      if(filters.statuses.length)set.statuses=filters.statuses;if(filters.tenants.length)set.tenants=filters.tenants;
      if(filters.requesters.length)set.requesters=filters.requesters;if(filters.reference.trim())set.reference=filters.reference.trim();
      if(filters.createdFrom)set.createdFrom=filters.createdFrom;if(filters.createdTo)set.createdTo=filters.createdTo;
      if(filters.unread)set.unread=true;if(filters.starred)set.starred=true;
    }
    try{const data=await call('list',{search,status:filter,offset,...set});if(version!==listRequest.current)return;setTickets(old=>offset?[...old,...data.tickets.filter((t:HumanTicket)=>!old.some(x=>x.id===t.id))]:data.tickets);setNext(data.nextOffset);setError(null);}catch(e){fail(e);}finally{setLoading(false);}
  },[call,search,filter,filters,admin,fail]);
  /* The filter panel's choices, once per inbox (platform queue only). */
  useEffect(()=>{if(!admin)return;let live=true;call('facets').then((data:SupportFacets)=>{if(live)setFacets(data);}).catch(()=>{});return()=>{live=false;};},[admin,call]);
  /* Platform support's new ticket: the companies once the form opens, then the
     chosen company's people. A company with one person picks them. */
  const targetsRequested=useRef(false);
  useEffect(()=>{if(!admin||!creating||targetsRequested.current)return;targetsRequested.current=true;
    call('targets').then((data:{tenants?:SupportTargetOptions['tenants']})=>setTargetOptions(old=>({...old,tenants:data?.tenants??[]}))).catch(e=>{targetsRequested.current=false;fail(e);});
  },[admin,creating,call,fail]);
  useEffect(()=>{if(!admin||!creating||!target.tenant)return;let live=true;setTargetOptions(old=>({...old,people:null}));
    call('targets',{tenant:target.tenant}).then((data:{people?:SupportTargetOptions['people']})=>{if(!live)return;const people=data?.people??[];
      setTargetOptions(old=>({...old,people}));if(people.length===1)setTarget(old=>old.tenant===target.tenant&&!old.requester?{...old,requester:people[0].id}:old);}).catch(e=>{if(live)fail(e);});
    return()=>{live=false;};
  },[admin,creating,target.tenant,call,fail]);
  const chooseTargetTenant=useCallback((tenant:string)=>setTarget({tenant,requester:''}),[]);
  const chooseTargetPerson=useCallback((requester:string)=>setTarget(old=>({...old,requester})),[]);
  /** Star or unstar a ticket for this viewer; the list is re-read from the server. */
  /* React to a message, replace the reaction, or clear it (null; also what picking
     the same emoji again does). Shown at once, then settled by the server's list;
     a failure puts the old reactions back. */
  /* Bumped on every reaction and held while one is saving: a thread refresh that
     started before it, or lands during it, keeps the reactions on screen instead
     of flashing the old ones back. */
  const reactionEdit=useRef({version:0,pending:0});
  const react=useCallback(async(seq:number,emoji:string|null)=>{
    if(!id)return;
    const ticketId=id;let before:SupportReaction[]|undefined;
    reactionEdit.current.version++;reactionEdit.current.pending++;
    setThread(old=>{if(!old||old.ticket.id!==ticketId)return old;before=old.reactions;
      const side=admin?'support':'tenant';const others=(old.reactions??[]).filter(r=>!(r.seq===seq&&r.mine&&r.by===side));
      return {...old,reactions:emoji?[...others,{seq,emoji,by:side,mine:true}]:others};});
    try{const result=await call('react',{id:ticketId,seq,emoji});
      setThread(old=>old&&old.ticket.id===ticketId?{...old,reactions:Array.isArray(result?.reactions)?result.reactions:old.reactions}:old);
    }catch(e){setThread(old=>old&&old.ticket.id===ticketId?{...old,reactions:before}:old);fail(e);}
    finally{reactionEdit.current.version++;reactionEdit.current.pending--;}
  },[admin,call,fail,id]);
  const toggleStar=useCallback(async(ticketId:string,starred:boolean)=>{
    try{await call('star',{id:ticketId,starred});await loadList();}catch(e){fail(e);}
  },[call,fail,loadList]);
  const loadThread=useCallback(async(before?:number)=>{if(!id)return;const version=++threadRequest.current,reactionsAt=reactionEdit.current.version;
    try{const data:SupportThread=await call('detail',{id,...(before?{before}:{})});if(selected.current!==id||version!==threadRequest.current)return;
      setThread(old=>{const map=new Map<number,SupportMessage>();if(old?.ticket.id===id)for(const m of old.messages)map.set(m.seq,m);for(const m of data.messages)map.set(m.seq,m);
        const messages=[...map.values()].sort((a,b)=>a.seq-b.seq);
        const reactionsStale=old?.ticket.id===id&&(reactionEdit.current.pending>0||reactionEdit.current.version!==reactionsAt);
        return {...data,messages,hasOlder:messages[0]?.seq>1,...(reactionsStale?{reactions:old.reactions}:{})};});setError(null);
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
  /* Reading pauses while something covers the conversation (the Details drawer):
     a message under it has not been displayed. Resuming re-observes, so what is
     then on screen is acknowledged. */
  const [readPaused,setReadPaused]=useState(false);
  const loadListRef=useRef(loadList);loadListRef.current=loadList;
  /* Acknowledge only what was actually displayed, by the sequence the server
     returned — never the current server maximum. Fetching a thread, loading the
     list or opening Support marks nothing. After an acknowledgement the list is
     reloaded at once, so that ticket's row badge drops without waiting for the
     next reconciliation; every other row keeps the server's count. */
  useEffect(()=>{
    if(!thread||!scrollRef.current||readPaused)return;const ticketId=thread.ticket.id;
    const observer=new IntersectionObserver(entries=>{if(document.visibilityState==='hidden'||marking.current||selected.current!==ticketId)return;
      const seen=Math.max(0,...entries.filter(e=>e.isIntersecting).map(e=>Number((e.target as HTMLElement).dataset.seq)));
      if(seen<=readThrough.current)return;marking.current=true;
      void call('read',{id:ticketId,through:seen}).then(()=>{if(selected.current===ticketId)readThrough.current=Math.max(readThrough.current,seen);window.dispatchEvent(new Event('trax-support-read'));void loadListRef.current();}).catch(fail).finally(()=>{marking.current=false;});
    },{root:scrollRef.current,threshold:0.5});
    scrollRef.current.querySelectorAll('[data-seq]').forEach(el=>observer.observe(el));return()=>observer.disconnect();
  },[thread,call,fail,readPaused]);
  /* Picked, not sent. Each file is checked here for the same limits the server
     enforces, so an oversized or unsupported file is refused before an upload. */
  const addAttachments=useCallback((files:FileList|File[])=>{
    /* Read the list NOW: a file input's FileList is live, and the picker clears the
       input as soon as this returns, so a lazy state updater would see nothing. */
    const picked=Array.from(files);
    setAttachments(old=>{
      const next=[...old];
      for(const file of picked){
        if(next.length>=ATTACHMENT_MAX_FILES)break;
        const problem=!ATTACHMENT_TYPES.includes(file.type)?'Attach a PNG, JPEG, WebP, GIF or PDF.'
          :file.size>ATTACHMENT_MAX_BYTES?'Attach a file of up to 10 MB.'
          :file.size<1?'This file is empty.':undefined;
        next.push({key:`${file.name}:${file.size}:${file.lastModified}:${next.length}`,file,name:file.name,mime:file.type,size:file.size,error:problem});
      }
      return next;
    });
  },[]);
  const removeAttachment=useCallback((key:string)=>setAttachments(old=>old.filter(a=>a.key!==key)),[]);
  const choose=useCallback((ticketId:string)=>{if(ticketId===id)return;setId(ticketId);setCreating(false);setDraft('');setAttachments([]);outgoing.current=null;setRetrying(false);setNotice('');},[id]);
  const beginNew=useCallback(()=>{let value=crypto.randomUUID();try{value=sessionStorage.getItem(nonceKey)||value;sessionStorage.setItem(nonceKey,value);}catch{}setNonce(value);setCreating(true);setId(null);setSubject('');setTarget({tenant:'',requester:''});setDraft('');setAttachments([]);outgoing.current=null;setRetrying(false);setNotice('');},[nonceKey]);
  /** Back to the list on a narrow screen: nothing is selected, nothing is lost. */
  const clearSelection=useCallback(()=>{setId(null);},[]);
  const cancelNew=useCallback(()=>{setCreating(false);setDraft('');setAttachments([]);outgoing.current=null;setRetrying(false);},[]);
  /**
   * Move a ticket's stored status (platform support only).
   *
   * It writes the SAME ticket record both views read — there is no second copy —
   * through the existing authenticated `status` action, which commits the status
   * and a short note in one transaction. The SQL refuses it without the platform
   * support grant, so this is not a frontend permission.
   *
   * Returns only after the server confirms, and refreshes the thread and the list
   * from the server rather than assuming: nothing is claimed before persistence,
   * and a failure leaves the stored status showing.
   */
  const setTicketStatus=useCallback(async(status:HumanTicket['status'],note:string)=>{
    if(!admin||!id||busy)return false;
    setBusy(true);setError(null);
    try{
      await call('status',{id,nonce:crypto.randomUUID(),body:note,status});
      await Promise.all([loadThread(),loadList()]);
      setNotice('Status updated.');
      return true;
    }catch(e){fail(e);return false;}
    finally{setBusy(false);}
  },[admin,busy,call,fail,id,loadList,loadThread]);
  const loadMore=useCallback(()=>{if(next!==null)void loadList(next);},[loadList,next]);
  const loadOlder=useCallback(()=>{followBottom.current=false;void loadThread(thread?.messages[0]?.seq);},[loadThread,thread]);
  const onThreadScroll=useCallback((e:{currentTarget:HTMLElement})=>{const el=e.currentTarget;followBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;},[]);
  /* Files alone are a message: with no text typed, the body names what was
     attached (the server requires one, and it reads as the bubble's caption). */
  const hasFiles=attachments.length>0&&!attachments.some(a=>a.error);
  const messageBody=draft.trim()||(hasFiles?'Attached '+attachments.map(a=>a.name).join(', ').slice(0,3900):'');
  /* A ticket's subject: the one typed, or else the message's first line (the Trax
     panel asks for no subject; the server still files one). */
  const firstLine=messageBody.split('\n').map(l=>l.trim()).find(Boolean)??'';
  const ticketSubject=subject.trim()||(firstLine.length>80?firstLine.slice(0,79).trimEnd()+'…':firstLine);
  /* Platform support writes TO someone: a new ticket needs its company and person. */
  const needsTarget=admin&&creating;
  const hasTarget=!needsTarget||(!!target.tenant&&!!target.requester);
  const canSend=!!messageBody&&(!creating||!!ticketSubject)&&hasTarget&&!attachments.some(a=>a.error);
  /* Files reserve under a ticket's company; support's new ticket has none until it is
     filed, so its first message goes without attachments. */
  const canAttach=!!uploadAttachment&&!needsTarget&&attachments.length<ATTACHMENT_MAX_FILES;
  const send=useCallback(async()=>{
    if(sending.current||!messageBody||attachments.some(a=>a.error)||(creating&&!ticketSubject)||!hasTarget)return;sending.current=true;setBusy(true);setError(null);
    /* One payload per submission: an uncertain send is RETRIED with its original
       nonce, so support never receives the same message twice. */
    if(!outgoing.current){outgoing.current={action:needsTarget?'open':creating?'create':'send',data:{...(id&&!creating?{id}:{}),nonce:creating?nonce:crypto.randomUUID(),body:messageBody,...(creating?{subject:ticketSubject}:{}),...(needsTarget?{tenant:target.tenant,requester:target.requester}:{})}};setRetrying(true);}
    try{
      const out=outgoing.current;
      /* Files first, under the message's own nonce: the message that follows
         claims them. A retry re-uploads only what has not been reserved yet, so
         the same file is never stored twice. */
      if(uploadAttachment&&attachments.length){
        for(const pending of attachments){
          if(uploaded.current.has(pending.key))continue;
          const reserved=await call('attach',{...(id&&!creating?{id}:{}),nonce:out.data.nonce,name:pending.name,mime:pending.mime,size:pending.size});
          await uploadAttachment({...reserved.upload,path:reserved.attachment.path},pending.file);
          uploaded.current.add(pending.key);
        }
      }
      const result=await call(out.action,out.data);
      if(!result)throw Error('Your message was not confirmed. Retry to check the same submission.');
      setDraft('');setAttachments([]);uploaded.current.clear();outgoing.current=null;setRetrying(false);setNotice('Message sent.');
      if(creating){try{sessionStorage.removeItem(nonceKey);}catch{}setNonce(crypto.randomUUID());setCreating(false);setId(result.id);}
      else{await loadThread();requestAnimationFrame(()=>{if(scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight;});}
      await loadList();window.dispatchEvent(new Event('trax-support-read'));
    }catch(e){fail(e);}finally{sending.current=false;setBusy(false);}
  },[attachments,call,creating,draft,fail,hasTarget,id,loadList,loadThread,messageBody,needsTarget,nonce,nonceKey,target,ticketSubject,uploadAttachment]);

  /* Never another ticket's content: between choosing a ticket and its first
     response, the previous thread is still in state for one render. Every view —
     the conversation and Details — reads this, so all three change
     together and show "loading" rather than the last ticket. */
  const current=thread&&thread.ticket.id===id?thread:null;

  return {
    id,creating,tickets,next,thread:current,search,filter,filters,facets,draft,subject,
    target,targetOptions,chooseTargetTenant,chooseTargetPerson,
    busy,loading,error,notice,retrying,canSend,canAttach,attachments,scrollRef,
    setSearch,setFilter,setFilters,toggleStar,setDraft,setSubject,
    choose,clearSelection,beginNew,cancelNew,loadMore,loadOlder,onThreadScroll,send,
    addAttachments,removeAttachment,setTicketStatus,setReadPaused,react,
    /** The authenticated messaging call, for TRAX assist (trax-assist.tsx). */
    call,
  };
}

export type SupportInboxState=ReturnType<typeof useSupportInbox>;
