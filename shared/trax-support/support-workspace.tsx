'use client';
import React from 'react';
import type { SupportInboxState } from './use-support-inbox';
import { byDay, Composer, DaySeparator, MessageTurn, StatusBadge, SystemEvent, TicketList } from './inbox-ui';
import { InfoDrawer, TicketInfoPanel, type InfoTab, type RecordLink } from './ticket-info';

/** Where Details | TRAX Summary fits beside the conversation. Below it, a drawer. */
const PANEL_BESIDE = '(min-width: 1280px)';

/**
 * The Support workspace, shared by the tenant's Support section and the platform
 * inbox: tickets on the left, the human conversation in the centre, and
 * Details | TRAX Summary on the right — all three for the SAME selected ticket.
 *
 * The left column is normally the app's rail (see support-rail.tsx), in which case
 * this renders only the centre and the right. Where the rail is not showing the
 * list — a phone, a collapsed sidebar, or an embedding without a rail — the list is
 * a column here, and below `md` the list and the conversation take turns.
 *
 * The centre is people only. A message TRAX wrote (stored metadata, see
 * messaging.ts `ticketSourceReader`) is a one-line event with a link to the TRAX
 * Summary tab, never a bubble that reads as if the requester or an agent wrote it.
 *
 * Presentation only: every read and write is `useSupportInbox` over the
 * authenticated messaging endpoint, and the role differences (who is "You", who
 * gets the status control, whose identity is shown) come from `viewer`, never from
 * anything the page could grant itself.
 */
export function SupportWorkspace({ inbox, viewer, listInRail = false, listHeader, recordLink, newTicketNote }: {
  inbox: SupportInboxState;
  /** `support`: the platform inbox. `tenant`: a requester's own tickets. */
  viewer: 'tenant' | 'support';
  /** The rail is showing the ticket list, so this does not. */
  listInRail?: boolean;
  /** Heading and actions above the list, when the list is shown here. */
  listHeader?: React.ReactNode;
  recordLink?: RecordLink;
  newTicketNote?: string;
}) {
  const admin = viewer === 'support';
  const { id, creating, thread, error, retrying, scrollRef } = inbox;
  const [tab, setTab] = React.useState<InfoTab>('details');
  const [drawer, setDrawer] = React.useState(false);
  const days = React.useMemo(() => byDay(thread?.messages ?? []), [thread]);
  const generated = thread?.messages.find((message) => message.source === 'trax_handoff');
  const open = creating || !!id;
  const closeDrawer = React.useCallback(() => setDrawer(false), []);
  /* The drawer is modal and covers the conversation: nothing under it is being read. */
  const pauseReading = inbox.setReadPaused;
  React.useEffect(() => { pauseReading?.(drawer); }, [drawer, pauseReading]);
  /** Show a tab: beside the conversation when it fits, in the drawer when it does not. */
  const showInfo = React.useCallback((next: InfoTab) => {
    setTab(next);
    if (!window.matchMedia?.(PANEL_BESIDE).matches) setDrawer(true);
  }, []);

  const panel = <TicketInfoPanel inbox={inbox} admin={admin} tab={tab} onTab={setTab} generated={generated} recordLink={recordLink} />;

  return (
    <div data-testid="support-inbox" className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 text-foreground">
      {/* One place for a failed request, whichever column it came from. The draft is kept. */}
      {error && <p role="alert" className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>}
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        {!listInRail && (
          <div className={`min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-background md:flex md:w-[300px] md:shrink-0 ${open ? 'hidden' : 'flex'}`}>
            {listHeader}
            <TicketList inbox={inbox} admin={admin} className="pt-2" />
          </div>
        )}

        <section aria-label="Support conversation"
          className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background ${listInRail ? 'flex' : `md:flex ${open ? 'flex' : 'hidden'}`}`}>
          {creating ? (
            <NewRequest inbox={inbox} note={newTicketNote} canGoBack={!listInRail} />
          ) : thread ? (
            <>
              <header className="flex shrink-0 items-start gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4">
                {!listInRail && <BackButton onClick={inbox.clearSelection} />}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight">{thread.ticket.summary}</h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{thread.ticket.reference}</span>
                    <StatusBadge status={thread.ticket.status} />
                    {/* Support works across companies: whose ticket this is, at a glance. */}
                    {admin && thread.ticket.tenant_name && (
                      <span data-testid="ticket-tenant" className="max-w-full truncate rounded-md border border-border/70 px-1.5 py-px font-medium text-foreground">{thread.ticket.tenant_name}</span>
                    )}
                    {admin && thread.ticket.requester && <span className="truncate">{thread.ticket.requester}</span>}
                  </p>
                </div>
                <button type="button" onClick={() => showInfo(tab)} aria-haspopup="dialog" aria-expanded={drawer}
                  className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden ${drawer ? 'bg-primary/10 text-primary' : ''}`}>
                  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" strokeLinecap="round" /></svg>
                  Details
                </button>
              </header>

              <div ref={scrollRef} onScroll={inbox.onThreadScroll} aria-label="Message thread" aria-live="polite"
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
                {thread.hasOlder && (
                  <div className="flex justify-center">
                    <button type="button" className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted" onClick={inbox.loadOlder}>Load earlier messages</button>
                  </div>
                )}
                {!thread.messages.length && (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">
                    This older ticket has no conversation messages yet.{thread.ticket.staff_note ? ' Previous update: ' + thread.ticket.staff_note : ''}
                  </p>
                )}
                {days.map((day) => (
                  <React.Fragment key={day.key}>
                    <DaySeparator label={day.label} />
                    <div className="flex flex-col gap-3">
                      {day.turns.map((turn) => turn.author === 'system' ? (
                        <SystemEvent key={turn.key} message={turn.items[0]} onOpenSummary={() => showInfo('trax')} />
                      ) : (
                        <MessageTurn key={turn.key}
                          /* The viewer decides the side: support's own replies sit right
                             in the platform inbox, and left in the tenant's section. */
                          own={admin ? turn.author === 'support' : turn.author === 'tenant'}
                          author={turn.author === 'support' ? (admin ? 'You · Drive247 Support' : 'Drive247 Support') : (admin ? thread.ticket.requester || 'Requester' : 'You')}
                          messages={turn.items} files={thread.attachments} />
                      ))}
                    </div>
                  </React.Fragment>
                ))}
              </div>

              <Composer inbox={inbox} placeholder={admin ? 'Reply to tenant…' : 'Reply to support…'} label={admin ? 'Reply to the tenant' : 'Reply in this conversation'}>
                {!admin && thread.ticket.status === 'closed' && <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">A follow-up message reopens this ticket.</p>}
              </Composer>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
              <p className="text-[13px] text-muted-foreground">{id ? 'Loading conversation…' : 'Select a ticket to read and reply.'}</p>
              {!id && <p className="text-[12px] text-muted-foreground/80">{admin ? 'Tenant conversations appear here.' : 'Your conversations with the Drive247 support team appear here.'}</p>}
            </div>
          )}
        </section>

        <aside aria-label="Ticket details" data-testid="ticket-info"
          className="hidden min-h-0 w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background xl:flex 2xl:w-[340px]">
          {/* One copy at a time: the drawer holds the panel while it is open. */}
          {!drawer && panel}
        </aside>
      </div>
      {drawer && <InfoDrawer title="Ticket details" onClose={closeDrawer}>{panel}</InfoDrawer>}
      {retrying && <span className="sr-only">Your last message is waiting to be retried.</span>}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Back to tickets" onClick={onClick}
      className="-ml-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden">
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4"><path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

/** The new request: subject, message, and nothing submitted until Send. */
function NewRequest({ inbox, note, canGoBack }: { inbox: SupportInboxState; note?: string; canGoBack: boolean }) {
  return (
    <>
      <header className="flex shrink-0 items-start gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4">
        {canGoBack && <BackButton onClick={inbox.cancelNew} />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight">New ticket</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Nothing is sent until you press Send.</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        <div className="mx-auto w-full max-w-xl space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="support-subject" className="text-[12px] font-medium">Subject</label>
            <input id="support-subject" value={inbox.subject} maxLength={240} readOnly={inbox.busy || inbox.retrying}
              onChange={(e) => inbox.setSubject(e.target.value)} placeholder="What is this about?"
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20" />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {note ?? 'Do not include credentials, card details or identity documents.'}
          </p>
        </div>
      </div>
      <Composer inbox={inbox} placeholder="Describe the problem…" label="Your message">
        <div className="mb-1.5 flex justify-end">
          <button type="button" className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50" disabled={inbox.busy} onClick={inbox.cancelNew}>Cancel</button>
        </div>
      </Composer>
    </>
  );
}
