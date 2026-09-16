'use client';
import React from 'react';
import { type MessagingCall } from './client';
import { useSupportInbox, type HumanTicket, type SupportCompose, type SupportInboxOptions } from './use-support-inbox';
import {
  byDay, Composer, DaySeparator, MessageTurn, SearchField, StatusBadge, StatusFilter, STATUS_LABEL, STATUS_ORDER, TicketRow, TroubleshootingDetails,
} from './inbox-ui';

export type { HumanTicket, SupportCompose } from './use-support-inbox';

/**
 * The PLATFORM support inbox: the cross-tenant queue, one ticket's conversation,
 * and the status control, in the admin app.
 *
 * It is the same design as the tenant's Support section — the rows, badges,
 * bubbles and composer are the shared pieces in `inbox-ui.tsx` — with the
 * differences the role actually has: which tenant a ticket belongs to, a search
 * that spans companies, "Reply to tenant…", and the status selector. The tenant's
 * view is the portal's own component over the same `useSupportInbox` behaviour,
 * so polling, unread acknowledgement, retry nonces and ordering cannot drift.
 *
 * Authorization is NOT here. Every action goes through the authenticated
 * messaging endpoint, and the SQL rechecks the platform support grant.
 */
export function SupportInbox({ call, admin = false, initialId, compose, scope, uploadAttachment }: {
  call: MessagingCall; admin?: boolean; initialId?: string; compose?: SupportCompose; scope: string;
  uploadAttachment?: SupportInboxOptions['uploadAttachment'];
}) {
  const inbox = useSupportInbox({ call, admin, initialId, compose, scope, uploadAttachment });
  const { id, creating, tickets, next, thread, search, filter, busy, loading, error, retrying, scrollRef } = inbox;
  const days = React.useMemo(() => byDay(thread?.messages ?? []), [thread]);
  const open = creating || !!id;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 text-foreground" data-testid="support-inbox">
      {error && <p role="alert" className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>}
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        <aside aria-label="Support tickets" data-testid="support-ticket-list"
          className={'min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-card/40 md:flex md:w-[340px] md:shrink-0 '+(open?'hidden':'flex')}>
          <div className="flex shrink-0 items-center gap-2 border-b border-border/70 p-2">
            <div className="min-w-0 flex-1"><SearchField value={search} onChange={inbox.setSearch} placeholder={admin?'Search tickets or company…':'Search your tickets…'}/></div>
            <StatusFilter value={filter} onChange={inbox.setFilter}/>
            {/* Support staff never open tickets; a non-admin embedding of this component
                (the isolated messaging fixture) still needs the tenant's own action. The
                portal carries it in its page header instead. */}
            {!admin&&<button type="button" disabled={busy} onClick={inbox.beginNew}
              className="h-9 shrink-0 rounded-lg border border-border bg-background px-3 text-[12px] font-medium hover:bg-muted">New request</button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {!tickets.length
              ? <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">{loading?'Loading tickets…':search||filter?'No tickets match these filters.':'No support tickets yet.'}</p>
              : <ul className="flex flex-col gap-0.5">{tickets.map((ticket:HumanTicket)=>(
                  <li key={ticket.id}>
                    <TicketRow ticket={ticket} selected={id===ticket.id} disabled={busy} onSelect={()=>inbox.choose(ticket.id)}
                      subtitle={admin?[ticket.tenant_name,ticket.requester].filter(Boolean).join(' · '):undefined}/>
                  </li>))}
                </ul>}
            {next!==null&&<button className="mt-1 w-full rounded-lg px-3 py-2 text-[12px] text-muted-foreground hover:bg-muted" onClick={inbox.loadMore}>Load more</button>}
          </div>
        </aside>

        <section aria-label="Support conversation"
          className={'min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background md:flex '+(open?'flex':'hidden')}>
          {creating ? <NewRequest inbox={inbox}/> : thread ? <>
            <header className="flex shrink-0 flex-wrap items-start gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4">
              <button aria-label="Back to tickets" onClick={inbox.clearSelection}
                className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted md:hidden">←</button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight">{thread.ticket.summary}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{thread.ticket.reference}</span>
                  <StatusBadge status={thread.ticket.status}/>
                  {admin&&<span className="truncate font-medium text-foreground">{thread.ticket.tenant_name}</span>}
                  {admin&&<span className="truncate">{thread.ticket.requester}</span>}
                </p>
                {admin&&['failed','review','pending','sending'].includes(thread.ticket.emailStatus??'')&&
                  <p className="mt-1 text-[11px] text-muted-foreground">Email alert: {thread.ticket.emailStatus==='review'?'delivery needs administrator review':thread.ticket.emailStatus}. The ticket is saved.</p>}
              </div>
              {admin&&<StatusSelect inbox={inbox} ticket={thread.ticket}/>}
            </header>

            <div ref={scrollRef} onScroll={inbox.onThreadScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4" aria-label="Message thread" aria-live="polite">
              {thread.ticket.handoff&&<TroubleshootingDetails value={thread.ticket.handoff}/>}
              {thread.hasOlder&&<div className="flex justify-center"><button className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted" onClick={inbox.loadOlder}>Load earlier messages</button></div>}
              {!thread.messages.length&&<p className="py-6 text-center text-[13px] text-muted-foreground">This older ticket has no conversation messages yet.{thread.ticket.staff_note?' Previous update: '+thread.ticket.staff_note:''}</p>}
              {days.map(day=>(
                <React.Fragment key={day.key}>
                  <DaySeparator label={day.label}/>
                  <div className="flex flex-col gap-3">
                    {day.turns.map(turn=>(
                      <MessageTurn key={turn.key}
                        /* The viewer decides the side: support's own replies sit right
                           here, and left in the tenant's Support section. */
                        own={admin?turn.author==='support':turn.author==='tenant'}
                        author={turn.author==='support'?(admin?'You · Drive247 Support':'Drive247 Support'):(admin?thread.ticket.requester||'Requester':'You')}
                        messages={turn.items} files={thread.attachments}/>
                    ))}
                  </div>
                </React.Fragment>
              ))}
            </div>

            <Composer inbox={inbox} placeholder={admin?'Reply to tenant…':'Reply to support…'} label={admin?'Reply to the tenant':'Reply in this conversation'}>
              {!admin&&thread.ticket.status==='closed'&&<p className="mb-1.5 px-1 text-[11px] text-muted-foreground">A follow-up message reopens this ticket.</p>}
            </Composer>
          </> : <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
            <p className="text-[13px] text-muted-foreground">{id?'Loading conversation…':'Select a ticket to read and reply.'}</p>
          </div>}
        </section>
      </div>
      {retrying&&<span className="sr-only">Your last message is waiting to be retried.</span>}
    </div>
  );
}

/**
 * The status control, for the platform inbox only.
 *
 * It writes the ticket record through the same authenticated `status` action the
 * queue already used — the SQL refuses it for anyone without the platform support
 * grant — and commits the change together with a short note in the conversation,
 * so the tenant sees both the new badge and why it moved. The tenant's own view
 * reads that same row: there is no second copy of a status anywhere.
 *
 * Nothing is claimed before persistence: the control shows "Saving…" while the
 * request is in flight, and a failure leaves the stored status showing.
 */
function StatusSelect({ inbox, ticket }: { inbox: ReturnType<typeof useSupportInbox>; ticket: HumanTicket }) {
  const [saving, setSaving] = React.useState<HumanTicket['status'] | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const change = async (next: HumanTicket['status']) => {
    if (next === ticket.status || saving) return;
    setSaving(next); setFailure(null);
    const ok = await inbox.setTicketStatus(next, `Support marked this ticket as ${STATUS_LABEL[next]}.`);
    setSaving(null);
    if (!ok) setFailure('That status was not saved. The ticket still shows its stored status.');
  };
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {/* The visible word and the control are siblings, not a wrapping label: the
          select's own accessible name stays "Ticket status". */}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span aria-hidden>Status</span>
        <select aria-label="Ticket status" disabled={!!saving||inbox.busy} value={saving??ticket.status}
          onChange={(e)=>void change(e.target.value as HumanTicket['status'])}
          className="h-8 rounded-lg border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60">
          {STATUS_ORDER.map((status)=><option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
        </select>
      </div>
      {saving&&<span role="status" className="text-[11px] text-muted-foreground">Saving…</span>}
      {failure&&<span role="alert" className="max-w-[16rem] text-right text-[11px] text-destructive">{failure}</span>}
    </div>
  );
}

function NewRequest({ inbox }: { inbox: ReturnType<typeof useSupportInbox> }) {
  return (
    <>
      <header className="shrink-0 border-b border-border/70 px-3 py-2.5 sm:px-4">
        <h2 className="text-[15px] font-semibold leading-tight tracking-tight">New ticket</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Nothing is sent until you press Send.</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        <div className="mx-auto w-full max-w-xl space-y-3">
          <label className="block space-y-1.5 text-[12px] font-medium">Subject
            <input value={inbox.subject} maxLength={240} readOnly={inbox.busy||inbox.retrying} onChange={e=>inbox.setSubject(e.target.value)}
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] font-normal outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"/>
          </label>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Nothing is submitted until you send. Do not include credentials, card details or identity documents.</p>
        </div>
      </div>
      <Composer inbox={inbox} placeholder="Describe the problem…" label="Your message">
        <div className="mb-1.5 flex justify-end">
          <button type="button" className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted" disabled={inbox.busy} onClick={inbox.cancelNew}>Cancel</button>
        </div>
      </Composer>
    </>
  );
}
