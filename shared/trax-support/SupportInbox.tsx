'use client';
import React from 'react';
import { type MessagingCall } from './client';
import { useSupportInbox, type HumanTicket, type SupportCompose } from './use-support-inbox';

export type { HumanTicket, SupportCompose } from './use-support-inbox';
const button='inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 disabled:cursor-not-allowed';
const primary=button.replace('bg-background','bg-primary').replace('hover:bg-secondary','hover:bg-primary/90')+' text-primary-foreground';
const statusLabel={open:'Open',in_progress:'In progress',closed:'Resolved'};
const stamp=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

/** The PLATFORM support inbox: the cross-tenant queue, one ticket's conversation and the
 * status control, in the admin app. It is full width, so the list sits beside the thread
 * from `md:` up and becomes a single-column list → conversation flow below it.
 *
 * The tenant's own inbox is no longer this component: the portal renders its own compact
 * messaging view (apps/portal/src/components/support/support-inbox.tsx) on the portal's v2
 * primitives, which this app does not have. Both drive the same `useSupportInbox`
 * behaviour over the same authenticated endpoint, so polling, unread acknowledgement,
 * retry nonces and message ordering cannot drift apart. */
export function SupportInbox({call,admin=false,initialId,compose,scope}:{call:MessagingCall;admin?:boolean;initialId?:string;compose?:SupportCompose;scope:string}){
  const inbox=useSupportInbox({call,admin,initialId,compose,scope});
  const {id,creating,tickets,next,thread,search,filter,draft,subject,status,busy,loading,error,notice,retrying,scrollRef}=inbox;
  return <div className="flex min-h-0 flex-1 flex-col text-foreground" data-testid="support-inbox">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><div><h2 className="text-base font-semibold">{admin?'Support inbox':creating?'Communicate with Support':'My Tickets'}</h2><p className="text-xs text-muted-foreground">Human support · Conversations update automatically</p></div>{!admin&&!creating&&<button className={button} disabled={busy} onClick={inbox.beginNew}>New request</button>}</div>
    {error&&<div role="alert" className="border-b border-border bg-secondary/50 px-4 py-2 text-sm">{error}</div>}
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {!creating&&<aside className={(id?'hidden md:flex ':'flex ')+(admin?'md:w-80 ':'md:w-64 ')+'shrink-0 border-r border-border min-h-0 flex-col'}>
        <div className="space-y-2 border-b border-border p-3"><input aria-label="Search support tickets" placeholder="Search tickets or company…" maxLength={120} value={search} onChange={e=>inbox.setSearch(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"/><select aria-label="Filter ticket status" value={filter} onChange={e=>inbox.setFilter(e.target.value)} className="w-full rounded-md border border-input bg-background p-2 text-sm"><option value="">All statuses</option>{Object.entries(statusLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
        <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Support tickets">{!tickets.length&&<p className="p-5 text-sm text-muted-foreground">{loading?'Loading tickets…':search||filter?'No tickets match these filters.':'No support tickets yet.'}</p>}{tickets.map((t:HumanTicket)=><button key={t.id} disabled={busy} onClick={()=>inbox.choose(t.id)} className={'block w-full border-b border-border p-3 text-left hover:bg-secondary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring '+(id===t.id?'bg-primary/10':'')}><span className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{t.reference}</span>{t.unread&&<span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">Unread</span>}</span><span className="mt-1 block break-words text-sm font-semibold">{t.summary}</span>{admin&&<span className="mt-1 block text-xs text-muted-foreground">{t.tenant_name} · {t.requester}</span>}<span className="mt-2 flex justify-between gap-1 text-[11px] text-muted-foreground"><span>{statusLabel[t.status]}</span><span>{stamp(t.updated_at)}</span></span></button>)}{next!==null&&<button className={button+' m-3'} onClick={inbox.loadMore}>Load more</button>}</div>
      </aside>}
      <section className={'flex min-h-0 min-w-0 flex-1 flex-col '+(!creating&&!id?'hidden md:flex':'')} aria-label="Support conversation">
        {creating?<div className="mx-auto w-full max-w-2xl space-y-4 p-4 sm:p-6"><p className="text-sm leading-relaxed text-muted-foreground">Describe your issue below. Your message and the relevant TRAX troubleshooting context will be shared with support.</p><label className="block text-sm font-medium">Subject<input value={subject} maxLength={240} readOnly={busy||retrying} onChange={e=>inbox.setSubject(e.target.value)} className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2"/></label><p className="text-xs text-muted-foreground">Nothing is submitted until you send. Do not include credentials, card details or identity documents.</p></div>:thread?<>
          <header className="border-b border-border px-4 py-3"><button className={button+' mb-2 md:hidden'} onClick={inbox.clearSelection}>Back to tickets</button><p className="text-xs text-muted-foreground">{thread.ticket.reference} · {statusLabel[thread.ticket.status]}</p><h3 className="mt-1 break-words text-base font-semibold">{thread.ticket.summary}</h3>{admin&&<p className="mt-1 text-sm font-medium text-primary">{thread.ticket.tenant_name} · {thread.ticket.requester}</p>}{admin&&['failed','review','pending','sending'].includes(thread.ticket.emailStatus??'')&&<p className="mt-1 text-xs text-muted-foreground">Email alert: {thread.ticket.emailStatus==='review'?'delivery needs administrator review':thread.ticket.emailStatus}. The ticket is saved.</p>}
          {thread.ticket.handoff&&<details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">TRAX troubleshooting context</summary><Handoff value={thread.ticket.handoff}/></details>}</header>
          <div ref={scrollRef} onScroll={inbox.onThreadScroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-label="Message thread" aria-live="polite">
            {thread.hasOlder&&<button className={button} onClick={inbox.loadOlder}>Load earlier messages</button>}
            {!thread.messages.length&&<p className="text-sm text-muted-foreground">This older ticket has no conversation messages yet.{thread.ticket.staff_note?' Previous update: '+thread.ticket.staff_note:''}</p>}
            {thread.messages.map(m=><article key={m.seq} className={'max-w-[92%] rounded-lg border border-border px-4 py-3 '+(m.author_kind==='support'?'bg-secondary/40':'ml-auto bg-primary/5')}><div className="mb-1 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground"><span className="font-semibold">{m.author_kind==='support'?'Drive247 Support':admin?thread.ticket.requester:'You'}</span><time dateTime={m.created_at}>{stamp(m.created_at)}</time></div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{m.body}</p><span data-seq={m.seq} aria-hidden="true" className="block h-px"/></article>)}
          </div>
        </>:<div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">{id?'Loading conversation…':'Select a ticket to read and reply.'}</div>}
        {(creating||thread)&&<form className="mt-auto shrink-0 space-y-2 border-t border-border p-4" onSubmit={e=>{e.preventDefault();void inbox.send();}}>
          {!creating&&thread?.ticket.status==='closed'&&!admin&&<p className="text-xs text-muted-foreground">A follow-up message reopens this ticket.</p>}
          <label htmlFor="support-message" className="text-sm font-medium">{creating?'Your message':'Reply in this conversation'}</label>
          <textarea id="support-message" value={draft} maxLength={4000} readOnly={busy||retrying} onChange={e=>inbox.setDraft(e.target.value)} placeholder="Write your message…" rows={3} className="w-full resize-y rounded-md border border-input bg-background p-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"/>
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2">{creating&&<button type="button" className={button} disabled={busy} onClick={inbox.cancelNew}>Cancel</button>}{admin&&thread&&<select aria-label="Status after sending reply" value={status} disabled={busy||retrying} onChange={e=>inbox.setStatus(e.target.value)} className="rounded-md border border-input bg-background p-2 text-sm"><option value="">Keep status</option>{Object.entries(statusLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>}<span role="status" className="text-xs text-muted-foreground">{busy?'Sending…':notice}</span></div><button className={primary} disabled={busy||!inbox.canSend}>{busy?'Sending…':retrying?'Retry send':'Send'}</button></div>
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
