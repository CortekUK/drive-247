'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessagingError, type MessagingCall } from './client';

export interface HumanTicket {id:string;reference:string;summary:string;status:'open'|'in_progress'|'closed';tenant_name:string;requester:string;updated_at:string;created_at:string;unread?:boolean;handoff?:Record<string,unknown>;emailStatus?:string;staff_note?:string}
interface Message {seq:number;author_kind:'tenant'|'support';body:string;created_at:string}
interface Thread {ticket:HumanTicket;messages:Message[];hasOlder:boolean;latestSeq:number}
export interface SupportCompose {summary:string;submit?:(body:string,nonce:string,subject:string)=>Promise<{id:string}|null>}
const button='inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 disabled:cursor-not-allowed';
const primary=button.replace('bg-background','bg-primary').replace('hover:bg-secondary','hover:bg-primary/90')+' text-primary-foreground';
const statusLabel={open:'Open',in_progress:'In progress',closed:'Resolved'};
const stamp=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

/** `compact` forces the single-column list → conversation flow for narrow containers (the Trax
 * panel), where viewport `md:` breakpoints would otherwise place the list beside the thread. */
export function SupportInbox({call,admin=false,initialId,compose,scope,onCancel,compact=false}:{call:MessagingCall;admin?:boolean;initialId?:string;compose?:SupportCompose;scope:string;onCancel?:()=>void;compact?:boolean}){
  const [id,setId]=useState<string|null>(initialId??null),[creating,setCreating]=useState(!!compose);
  const [tickets,setTickets]=useState<HumanTicket[]>([]),[next,setNext]=useState<number|null>(null);
  const [thread,setThread]=useState<Thread|null>(null),[search,setSearch]=useState(''),[filter,setFilter]=useState('');
  const [draft,setDraft]=useState(''),[subject,setSubject]=useState(compose?.summary??''),[status,setStatus]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState('');
  const listRequest=useRef(0),threadRequest=useRef(0),selected=useRef(id);selected.current=id;
  const scroll=useRef<HTMLDivElement>(null),opened=useRef<string|null>(null),readThrough=useRef(0),marking=useRef(false),sending=useRef(false);
  const followBottom=useRef(true);
  const outgoing=useRef<{action:string;data:Record<string,unknown>}|null>(null);
  const nonceKey='trax-support-compose:'+scope;
  const [nonce,setNonce]=useState(()=>{try{const saved=sessionStorage.getItem(nonceKey);if(saved)return saved;const value=crypto.randomUUID();sessionStorage.setItem(nonceKey,value);return value;}catch{return crypto.randomUUID();}});
  const fail=useCallback((e:unknown)=>{if(e instanceof MessagingError&&['unauthorized','forbidden','context_changed'].includes(e.code)){setThread(null);setTickets([]);}
    setError(e instanceof Error?e.message:'The request could not be confirmed. Your draft is preserved.');},[]);
  const loadList=useCallback(async(offset=0)=>{const version=++listRequest.current;
    try{const data=await call('list',{search,status:filter,offset});if(version!==listRequest.current)return;setTickets(old=>offset?[...old,...data.tickets.filter((t:HumanTicket)=>!old.some(x=>x.id===t.id))]:data.tickets);setNext(data.nextOffset);setError(null);}catch(e){fail(e);}finally{setLoading(false);}
  },[call,search,filter,fail]);
  const loadThread=useCallback(async(before?:number)=>{if(!id)return;const version=++threadRequest.current;
    try{const data:Thread=await call('detail',{id,...(before?{before}:{})});if(selected.current!==id||version!==threadRequest.current)return;
      setThread(old=>{const map=new Map<number,Message>();if(old?.ticket.id===id)for(const m of old.messages)map.set(m.seq,m);for(const m of data.messages)map.set(m.seq,m);
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
  useEffect(()=>{if(thread&&scroll.current&&(opened.current!==thread.ticket.id||followBottom.current)){scroll.current.scrollTop=scroll.current.scrollHeight;opened.current=thread.ticket.id;}},[thread]);
  useEffect(()=>{
    if(!thread||!scroll.current)return;const ticketId=thread.ticket.id;
    const observer=new IntersectionObserver(entries=>{if(document.visibilityState==='hidden'||marking.current||selected.current!==ticketId)return;
      const seen=Math.max(0,...entries.filter(e=>e.isIntersecting).map(e=>Number((e.target as HTMLElement).dataset.seq)));
      if(seen<=readThrough.current)return;marking.current=true;
      void call('read',{id:ticketId,through:seen}).then(()=>{if(selected.current===ticketId)readThrough.current=Math.max(readThrough.current,seen);window.dispatchEvent(new Event('trax-support-read'));}).catch(fail).finally(()=>{marking.current=false;});
    },{root:scroll.current,threshold:0.5});
    scroll.current.querySelectorAll('[data-seq]').forEach(el=>observer.observe(el));return()=>observer.disconnect();
  },[thread,call,fail]);
  const choose=(ticketId:string)=>{if(ticketId===id)return;setId(ticketId);setCreating(false);setDraft('');outgoing.current=null;setStatus('');setNotice('');};
  const beginNew=()=>{let value=crypto.randomUUID();try{value=sessionStorage.getItem(nonceKey)||value;sessionStorage.setItem(nonceKey,value);}catch{}setNonce(value);setCreating(true);setId(null);setSubject('');setDraft('');outgoing.current=null;setNotice('');};
  const send=async()=>{
    if(sending.current||!draft.trim()||(creating&&!subject.trim()))return;sending.current=true;setBusy(true);setError(null);
    if(!outgoing.current)outgoing.current={action:creating?'create':admin&&status?'status':'send',data:{...(id&&!creating?{id}:{}),nonce:creating?nonce:crypto.randomUUID(),body:draft.trim(),...(creating?{subject:subject.trim()}:{}),...(admin&&status&&!creating?{status}:{})}};
    try{
      const out=outgoing.current;
      const result=creating&&compose?.submit?await compose.submit(String(out.data.body),String(out.data.nonce),String(out.data.subject)):await call(out.action,out.data);
      if(!result)throw Error('Your message was not confirmed. Retry to check the same submission.');
      setDraft('');outgoing.current=null;setStatus('');setNotice('Message sent.');
      if(creating){try{sessionStorage.removeItem(nonceKey);}catch{}setNonce(crypto.randomUUID());setCreating(false);setId(result.id);}
      else{await loadThread();requestAnimationFrame(()=>{if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;});}
      await loadList();window.dispatchEvent(new Event('trax-support-read'));
    }catch(e){fail(e);}finally{sending.current=false;setBusy(false);}
  };
  return <div className="flex min-h-0 flex-1 flex-col text-foreground" data-testid="support-inbox">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><div><h2 className="text-base font-semibold">{admin?'Support inbox':creating?'Communicate with Support':'My Tickets'}</h2><p className="text-xs text-muted-foreground">Human support · Conversations update automatically</p></div>{!admin&&!creating&&<button className={button} disabled={busy} onClick={beginNew}>New request</button>}</div>
    {error&&<div role="alert" className="border-b border-border bg-secondary/50 px-4 py-2 text-sm">{error}</div>}
    <div className={'flex min-h-0 flex-1 flex-col'+(compact?'':' md:flex-row')}>
      {!creating&&<aside className={(compact?(id?'hidden ':'flex flex-1 '):(id?'hidden md:flex ':'flex ')+(admin?'md:w-80 ':'md:w-64 ')+'shrink-0 border-r border-border ')+'min-h-0 flex-col'}>
        <div className="space-y-2 border-b border-border p-3"><input aria-label="Search support tickets" placeholder="Search tickets or company…" maxLength={120} value={search} onChange={e=>setSearch(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"/><select aria-label="Filter ticket status" value={filter} onChange={e=>setFilter(e.target.value)} className="w-full rounded-md border border-input bg-background p-2 text-sm"><option value="">All statuses</option>{Object.entries(statusLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
        <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Support tickets">{!tickets.length&&<p className="p-5 text-sm text-muted-foreground">{loading?'Loading tickets…':search||filter?'No tickets match these filters.':'No support tickets yet.'}</p>}{tickets.map(t=><button key={t.id} disabled={busy} onClick={()=>choose(t.id)} className={'block w-full border-b border-border p-3 text-left hover:bg-secondary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring '+(id===t.id?'bg-primary/10':'')}><span className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{t.reference}</span>{t.unread&&<span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">Unread</span>}</span><span className="mt-1 block break-words text-sm font-semibold">{t.summary}</span>{admin&&<span className="mt-1 block text-xs text-muted-foreground">{t.tenant_name} · {t.requester}</span>}<span className="mt-2 flex justify-between gap-1 text-[11px] text-muted-foreground"><span>{statusLabel[t.status]}</span><span>{stamp(t.updated_at)}</span></span></button>)}{next!==null&&<button className={button+' m-3'} onClick={()=>void loadList(next)}>Load more</button>}</div>
      </aside>}
      <section className={'flex min-h-0 min-w-0 flex-1 flex-col '+(!creating&&!id?(compact?'hidden':'hidden md:flex'):'')} aria-label="Support conversation">
        {creating?<div className="mx-auto w-full max-w-2xl space-y-4 p-4 sm:p-6"><p className="text-sm leading-relaxed text-muted-foreground">Describe your issue below. Your message and the relevant TRAX troubleshooting context will be shared with support.</p><label className="block text-sm font-medium">Subject<input value={subject} maxLength={240} readOnly={busy||!!outgoing.current} onChange={e=>setSubject(e.target.value)} className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2"/></label><p className="text-xs text-muted-foreground">Nothing is submitted until you send. Do not include credentials, card details or identity documents.</p></div>:thread?<>
          <header className="border-b border-border px-4 py-3"><button className={button+' mb-2'+(compact?'':' md:hidden')} onClick={()=>setId(null)}>Back to tickets</button><p className="text-xs text-muted-foreground">{thread.ticket.reference} · {statusLabel[thread.ticket.status]}</p><h3 className="mt-1 break-words text-base font-semibold">{thread.ticket.summary}</h3>{admin&&<p className="mt-1 text-sm font-medium text-primary">{thread.ticket.tenant_name} · {thread.ticket.requester}</p>}{admin&&['failed','review','pending','sending'].includes(thread.ticket.emailStatus??'')&&<p className="mt-1 text-xs text-muted-foreground">Email alert: {thread.ticket.emailStatus==='review'?'delivery needs administrator review':thread.ticket.emailStatus}. The ticket is saved.</p>}
          {thread.ticket.handoff&&<details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">TRAX troubleshooting context</summary><Handoff value={thread.ticket.handoff}/></details>}</header>
          <div ref={scroll} onScroll={e=>{const el=e.currentTarget;followBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;}} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-label="Message thread" aria-live="polite">
            {thread.hasOlder&&<button className={button} onClick={()=>{followBottom.current=false;void loadThread(thread.messages[0]?.seq);}}>Load earlier messages</button>}
            {!thread.messages.length&&<p className="text-sm text-muted-foreground">This older ticket has no conversation messages yet.{thread.ticket.staff_note?' Previous update: '+thread.ticket.staff_note:''}</p>}
            {thread.messages.map(m=><article key={m.seq} className={'max-w-[92%] rounded-lg border border-border px-4 py-3 '+(m.author_kind==='support'?'bg-secondary/40':'ml-auto bg-primary/5')}><div className="mb-1 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground"><span className="font-semibold">{m.author_kind==='support'?'Drive247 Support':admin?thread.ticket.requester:'You'}</span><time dateTime={m.created_at}>{stamp(m.created_at)}</time></div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{m.body}</p><span data-seq={m.seq} aria-hidden="true" className="block h-px"/></article>)}
          </div>
        </>:<div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">{id?'Loading conversation…':'Select a ticket to read and reply.'}</div>}
        {(creating||thread)&&<form className="mt-auto shrink-0 space-y-2 border-t border-border p-4" onSubmit={e=>{e.preventDefault();void send();}}>
          {!creating&&thread?.ticket.status==='closed'&&!admin&&<p className="text-xs text-muted-foreground">A follow-up message reopens this ticket.</p>}
          <label htmlFor="support-message" className="text-sm font-medium">{creating?'Your message':'Reply in this conversation'}</label>
          <textarea id="support-message" value={draft} maxLength={4000} readOnly={busy||!!outgoing.current} onChange={e=>setDraft(e.target.value)} placeholder="Write your message…" rows={3} className="w-full resize-y rounded-md border border-input bg-background p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"/>
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2">{creating&&<button type="button" className={button} disabled={busy} onClick={()=>{setCreating(false);onCancel?.();}}>Cancel</button>}{admin&&thread&&<select aria-label="Status after sending reply" value={status} disabled={busy||!!outgoing.current} onChange={e=>setStatus(e.target.value)} className="rounded-md border border-input bg-background p-2 text-sm"><option value="">Keep status</option>{Object.entries(statusLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>}<span role="status" className="text-xs text-muted-foreground">{busy?'Sending…':notice}</span></div><button className={primary} disabled={busy||!draft.trim()||(creating&&!subject.trim())}>{busy?'Sending…':outgoing.current?'Retry send':'Send'}</button></div>
        </form>}
      </section>
    </div>
  </div>;
}
function Handoff({value}:{value:Record<string,unknown>}){
  const safeText=(v:unknown)=>typeof v==='string'?v:'';
  const checks=Array.isArray(value.verifiedChecks)?value.verifiedChecks as Record<string,unknown>[]:[];
  const reports=Array.isArray(value.reportedByUser)?value.reportedByUser as Record<string,unknown>[]:[];
  const references=Array.isArray(value.recordReferences)?value.recordReferences as Record<string,unknown>[]:[];
  const issue=value.issue&&typeof value.issue==='object'?value.issue as Record<string,unknown>:{};
  return <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-3 text-xs leading-relaxed">
    <p>{safeText(value.disclosure)||'Historical observations; recheck current records before acting.'}</p>
    {typeof issue.reason==='string'&&<p>Support requested: {issue.reason.replace(/_/g,' ')}.</p>}
    {reports.map((r,i)=><p key={'r'+i}><strong>Reported by requester:</strong> {safeText(r.content)}</p>)}
    {checks.map((c,i)=><div key={i}><strong>Recorded check · {safeText(c.observedAt)}</strong>{Array.isArray(c.findings)&&c.findings.map((f,j)=><p key={j}>{safeText(f)}</p>)}</div>)}
    {Array.isArray(value.unknowns)&&value.unknowns.map((u,i)=><p key={'u'+i}>Unresolved: {safeText(u)}</p>)}
    {references.map((r,i)=><p key={'ref'+i} className="break-all">Record reference · {safeText(r.kind)}: {safeText(r.id)}</p>)}
  </div>;
}
