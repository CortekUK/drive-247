'use client';
import React from 'react';
import type { SupportInboxState } from './use-support-inbox';
import { byDay, Composer, DaySeparator, MessageTurn, StatusBadge, SupportEmpty, TicketList, type SupportStates, type TurnMessage } from './inbox-ui';
import { InfoDrawer, participantName, TicketInfoPanel, type InfoTab, type RecordLink } from './ticket-info';
import { SuggestReplyButton, useTraxAssist } from './trax-assist';
import { EmailTenantButton } from './email-tenant';
import { ChoicePicker } from './support-filters';

/** Where Details fits beside the conversation. Below it, a drawer. */
const PANEL_BESIDE = '(min-width: 1280px)';

/**
 * The Support workspace, shared by the tenant's Support section and the platform
 * inbox: tickets on the left, the human conversation in the centre, and
 * Details on the right — all three for the SAME selected ticket.
 *
 * The left column is normally the app's rail (see support-rail.tsx), in which case
 * this renders only the centre and the right. Where the rail is not showing the
 * list — a phone, a collapsed sidebar, or an embedding without a rail — the list is
 * a column here, and below `md` the list and the conversation take turns.
 *
 * The centre is people only. TRAX no longer raises tickets; a message it wrote on
 * an older ticket (stored metadata, messaging.ts `ticketSourceReader`) is not shown.
 *
 * Presentation only: every read and write is `useSupportInbox` over the
 * authenticated messaging endpoint, and the role differences (who is "You", who
 * gets the status control, whose identity is shown) come from `viewer`, never from
 * anything the page could grant itself.
 */
export function SupportWorkspace({ inbox, viewer, listInRail = false, listHeader, recordLink, newTicketNote, compact = false, states }: {
  inbox: SupportInboxState;
  /** `support`: the platform inbox. `tenant`: a requester's own tickets. */
  viewer: 'tenant' | 'support';
  /** The rail is showing the ticket list, so this does not. */
  listInRail?: boolean;
  /** Heading and actions above the list, when the list is shown here. */
  listHeader?: React.ReactNode;
  recordLink?: RecordLink;
  newTicketNote?: string;
  /**
   * A narrow embedding (the Trax panel): one pane at any screen width — the list,
   * or the open ticket with a back arrow — flat, with details always in the drawer.
   */
  compact?: boolean;
  /** The app's skeleton and illustrations for loading and empty states. */
  states?: SupportStates;
}) {
  const admin = viewer === 'support';
  const { id, creating, thread, error, retrying, scrollRef } = inbox;
  const [drawer, setDrawer] = React.useState(false);
  const days = React.useMemo(() => byDay(thread?.messages ?? []), [thread]);
  const open = creating || !!id;
  const threadLoading = !!id && (!thread || !!states?.hold) && !!states?.Skeleton && !!states?.placeholderMessages;
  const closeDrawer = React.useCallback(() => setDrawer(false), []);
  /* The drawer is modal and covers the conversation: nothing under it is being read. */
  const pauseReading = inbox.setReadPaused;
  React.useEffect(() => { pauseReading?.(drawer); }, [drawer, pauseReading]);
  /** Show Details: beside the conversation when it fits, in the drawer when it does not. */
  const showInfo = React.useCallback(() => {
    if (compact || !window.matchMedia?.(PANEL_BESIDE).matches) setDrawer(true);
  }, [compact]);

  /* Platform support only: the Trax tab beside Details, and TRAX's suggested reply. */
  const assist = useTraxAssist(inbox, admin && !compact);
  const [tab, setTab] = React.useState<InfoTab>('details');
  const panel = <TicketInfoPanel inbox={inbox} admin={admin} tab={tab} onTab={setTab} assist={admin && !compact ? assist : undefined} />;

  return (
    <div data-testid="support-inbox" className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 text-foreground">
      {/* One place for a failed request, whichever column it came from. The draft is kept. */}
      {error && <p role="alert" className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>}
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        {!listInRail && (
          <div className={compact
            ? `min-h-0 w-full flex-col overflow-hidden ${open ? 'hidden' : 'flex'}`
            : `min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-background max-md:rounded-none max-md:border-0 md:flex md:w-[300px] md:shrink-0 ${open ? 'hidden' : 'flex'}`}>
            {listHeader}
            <TicketList inbox={inbox} admin={admin} className="pt-2" searchable={!compact} numberOnly={compact} states={states} />
          </div>
        )}

        <section aria-label="Support conversation"
          className={compact
            ? `min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${open ? 'flex' : 'hidden'}`
            : `min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background max-md:rounded-none max-md:border-0 ${listInRail ? 'flex' : `md:flex ${open ? 'flex' : 'hidden'}`}`}>
          {creating ? (
            /* Compact: the Trax panel puts Back in its own header. */
            <NewRequest inbox={inbox} admin={admin} note={newTicketNote} canGoBack={!listInRail && !compact} compact={compact} states={states} />
          ) : threadLoading ? (
            /* Opening a ticket: the real bubbles and composer, fed placeholders. */
            <ThreadSkeleton states={states!} admin={admin} />
          ) : thread ? (
            <>
              {/* Platform queue: no header where Details sits beside the thread
                  (the selected row says everything). Narrower screens keep it for
                  the Back and Details controls. */}
              {/* The Trax panel shows no ticket header at all: the conversation
                  starts right under the panel's own header. */}
              {!compact && (
              <header className={`flex shrink-0 items-start gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4 ${admin ? 'xl:hidden' : ''}`}>
                {!listInRail && !compact && <BackButton onClick={inbox.clearSelection} />}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight">{thread.ticket.summary}</h2>
                  {/* The platform queue's row already carries reference, status,
                      company and requester, so the header is the subject alone. */}
                  {!admin && !compact && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{thread.ticket.reference}</span>
                      <StatusBadge status={thread.ticket.status} />
                    </p>
                  )}
                </div>
                {/* The Trax panel shows no Details: the conversation is the whole pane. */}
                {!compact && (
                  <button type="button" onClick={showInfo} aria-haspopup="dialog" aria-expanded={drawer}
                    className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden ${drawer ? 'bg-primary/10 text-primary' : ''}`}>
                    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" strokeLinecap="round" /></svg>
                    Details
                  </button>
                )}
              </header>
              )}

              <div ref={scrollRef} onScroll={inbox.onThreadScroll} aria-label="Message thread" aria-live="polite"
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
                {thread.hasOlder && (
                  <div className="flex justify-center">
                    <button type="button" className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted" onClick={inbox.loadOlder}>Load earlier messages</button>
                  </div>
                )}
                {!thread.messages.some((m) => m.source !== 'trax_handoff') && (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">
                    This older ticket has no conversation messages yet.{thread.ticket.staff_note ? ' Previous update: ' + thread.ticket.staff_note : ''}
                  </p>
                )}
                {days.map((day) => (
                  <React.Fragment key={day.key}>
                    {/* TRAX-written lines are hidden, so a day holding only those
                        gets no date either — never a heading over nothing. */}
                    {day.turns.some((turn) => turn.author !== 'system') && <DaySeparator label={day.label} />}
                    <div className="flex flex-col gap-3">
                      {day.turns.map((turn) => turn.author === 'system' ? (
                        /* A message TRAX wrote on an older ticket (TRAX no longer raises
                           tickets): not shown; only its read marker stays. */
                        <span key={turn.key} data-seq={turn.items[0].seq} aria-hidden className="block h-px w-px" />
                      ) : (
                        <MessageTurn key={turn.key}
                          /* The viewer decides the side: support's own replies sit right
                             in the platform inbox, and left in the tenant's section. */
                          own={admin ? turn.author === 'support' : turn.author === 'tenant'}
                          support={turn.author === 'support'}
                          author={turn.author === 'support' ? (admin ? 'You · Drive247 Support' : 'Drive247 Support') : (admin ? participantName(thread.ticket) : 'You')}
                          messages={turn.items} files={thread.attachments}
                          reactions={thread.reactions} onReact={inbox.react} />
                      ))}
                    </div>
                  </React.Fragment>
                ))}
              </div>

              <Composer inbox={inbox} blend={compact} placeholder={admin ? 'Reply to tenant…' : 'Reply to support…'} label={admin ? 'Reply to the tenant' : 'Reply in this conversation'}
                onTab={assist.enabled && assist.suggestion ? assist.acceptSuggestion : undefined}
                ghost={assist.enabled ? { text: assist.suggestion, drafting: assist.drafting } : undefined}
                tools={admin && !compact ? <><SuggestReplyButton assist={assist} /><EmailTenantButton inbox={inbox} /></> : undefined}>
                {!admin && thread.ticket.status === 'closed' && <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">A follow-up message reopens this ticket.</p>}
              </Composer>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center">
              {id ? <p className="p-8 text-center text-[13px] text-muted-foreground">Loading conversation…</p> : (
                <SupportEmpty art={states?.emptyArt} title="Pick a ticket to read and reply."
                  body={admin ? 'Tenant conversations open here.' : 'Your conversations with the Drive247 support team open here.'} />
              )}
            </div>
          )}
        </section>

        {!compact && (
          <aside aria-label="Ticket details" data-testid="ticket-info"
            className={`hidden min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background xl:flex ${admin ? 'w-[360px] 2xl:w-[400px]' : 'w-[320px] 2xl:w-[340px]'}`}>
            {/* One copy at a time: the drawer holds the panel while it is open. */}
            {!drawer && panel}
          </aside>
        )}
      </div>
      {drawer && <InfoDrawer title="Ticket details" onClose={closeDrawer}>{panel}</InfoDrawer>}
      {retrying && <span className="sr-only">Your last message is waiting to be retried.</span>}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Back to tickets" onClick={onClick}
      className={`-ml-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden`}>
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4"><path d="M19 12H5M11 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

/** The new request: subject, message, and nothing submitted until Send. */
function NewRequest({ inbox, admin = false, note, canGoBack, compact = false, states }: { inbox: SupportInboxState; admin?: boolean; note?: string; canGoBack: boolean; compact?: boolean; states?: SupportStates }) {
  /* The Trax panel: no heading, no subject field, no notes — the empty state and
     the box to type in. The subject is the message's first line (useSupportInbox). */
  if (compact) return (
    <>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        <SupportEmpty art={states?.emptyArt} title="What do you need help with?"
          body="Write it below and I will pass it to the Drive247 support team." />
      </div>
      <Composer inbox={inbox} blend placeholder="Describe the problem…" label="Your message" />
    </>
  );
  return (
    <>
      <header className="flex shrink-0 items-start gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4">
        {canGoBack && <BackButton onClick={inbox.cancelNew} />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight">New ticket</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{admin ? 'It lands in their Support inbox. Nothing is sent until you press Send.' : 'Nothing is sent until you press Send.'}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        <div className="mx-auto w-full max-w-xl space-y-3">
          {/* Platform support: who the ticket is for. It is filed under that person,
              exactly as if they had raised it. */}
          {admin && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ChoicePicker label="Company" placeholder="Choose a company" disabled={inbox.busy || inbox.retrying}
                items={inbox.targetOptions.tenants?.map((t) => ({ id: t.id, label: t.name })) ?? null}
                value={inbox.target.tenant} onChange={inbox.chooseTargetTenant} loading={!inbox.targetOptions.tenants} />
              <ChoicePicker label="Person" placeholder={inbox.target.tenant ? 'Choose a person' : 'Choose a company first'}
                disabled={!inbox.target.tenant || inbox.busy || inbox.retrying}
                items={inbox.target.tenant ? inbox.targetOptions.people?.map((p) => ({ id: p.id, label: p.name, meta: p.email ?? undefined })) ?? null : []}
                value={inbox.target.requester} onChange={inbox.chooseTargetPerson} loading={!!inbox.target.tenant && !inbox.targetOptions.people} />
            </div>
          )}
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
      <Composer inbox={inbox} blend={compact} placeholder={admin ? 'Write to the tenant…' : 'Describe the problem…'} label="Your message">
        <div className="mb-1.5 flex justify-end">
          <button type="button" className="rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50" disabled={inbox.busy} onClick={inbox.cancelNew}>Cancel</button>
        </div>
      </Composer>
    </>
  );
}

/** Turns of the placeholder conversation: one, two, one, one… messages, alternating sides. */
const SKELETON_TURN_SIZES = [1, 2, 1, 2, 1];

/** The conversation while it loads: real bubbles and a composer-shaped box, drawn as bones. */
function ThreadSkeleton({ states, admin }: { states: SupportStates; admin: boolean }) {
  const Skeleton = states.Skeleton!;
  const messages = states.placeholderMessages ?? [];
  const turns: TurnMessage[][] = [];
  for (let at = 0, i = 0; at < messages.length; i++) {
    const size = SKELETON_TURN_SIZES[i % SKELETON_TURN_SIZES.length];
    turns.push(messages.slice(at, at + size)); at += size;
  }
  return (
    <Skeleton loading outerClassName="flex min-h-0 flex-1 flex-col" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3">
          {turns.map((items, i) => (
            <MessageTurn key={i} own={i % 2 === 1} author={admin ? 'Placeholder Rentals' : 'Drive247 Support'} messages={items} />
          ))}
        </div>
      </div>
      <div className="shrink-0 px-3 pb-3 sm:px-4">
        <div data-skeleton-block className="h-[84px] rounded-2xl border border-border/70" />
      </div>
    </Skeleton>
  );
}
