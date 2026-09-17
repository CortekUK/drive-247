'use client';

import { Fragment, useMemo } from 'react';
import { ArrowLeft, Info } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui-v2/collapsible';
import { cn } from '@/lib/utils';
import {
  byDay, Composer, DaySeparator, MessageTurn, SearchField, StatusBadge, StatusFilter, TicketRow, TroubleshootingDetails,
} from '../../../../../shared/trax-support/inbox-ui';
import type { HumanTicket, SupportInboxState } from '../../../../../shared/trax-support/use-support-inbox';

/**
 * The tenant's support inbox: a compact ticket list beside one conversation.
 *
 * The rows, badges, bubbles and composer come from `shared/trax-support/inbox-ui`
 * — the same pieces the platform inbox uses, so the two surfaces read as one
 * support system. What stays here is what is tenant-specific: their own tickets,
 * their own side of the conversation, and the portal's Issue details disclosure.
 *
 * All of the behaviour is `useSupportInbox`; this file only decides how it looks,
 * and it invents no counts, no presence and no status.
 *
 * The page owns the hook (portal-support.tsx) because the page header carries
 * "New ticket".
 */
export function SupportInboxView({ inbox, className }: { inbox: SupportInboxState; className?: string }) {
  const { id, creating, tickets, next, thread, search, filter, busy, loading, error, retrying, scrollRef } = inbox;
  const open = creating || !!id;
  const days = useMemo(() => byDay(thread?.messages ?? []), [thread]);

  return (
    <div data-testid="support-inbox" className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-2', className)}>
      {/* One place for a failed request, whichever column it came from. The draft is kept. */}
      {error && (
        <p role="alert" className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        {/* 1 — the tickets. Below `md` the list and the conversation take turns. */}
        <aside
          aria-label="Support tickets"
          data-testid="support-ticket-list"
          className={cn(
            'min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-card/40 md:flex md:w-[320px] md:shrink-0',
            open ? 'hidden' : 'flex',
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border/70 p-2">
            <div className="min-w-0 flex-1"><SearchField value={search} onChange={inbox.setSearch} placeholder="Search your tickets…" /></div>
            <StatusFilter value={filter} onChange={inbox.setFilter} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {!tickets.length ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                {loading ? 'Loading tickets…' : search || filter ? 'No tickets match these filters.' : 'No support tickets yet.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <TicketRow ticket={ticket} selected={id === ticket.id} disabled={busy} onSelect={() => inbox.choose(ticket.id)} />
                  </li>
                ))}
              </ul>
            )}
            {next !== null && (
              <Button variant="ghost" size="sm" className="mt-1 w-full text-[12px] text-muted-foreground" onClick={inbox.loadMore}>Load more</Button>
            )}
          </div>
        </aside>

        {/* 2 — the conversation, or the new request. */}
        <section
          aria-label="Support conversation"
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background md:flex',
            open ? 'flex' : 'hidden',
          )}
        >
          {creating ? (
            <NewRequest inbox={inbox} />
          ) : thread ? (
            <>
              <ConversationHeader ticket={thread.ticket} onBack={inbox.clearSelection} />

              <div
                ref={scrollRef}
                onScroll={inbox.onThreadScroll}
                aria-label="Message thread"
                aria-live="polite"
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4"
              >
                {thread.ticket.handoff && <TroubleshootingDetails value={thread.ticket.handoff} />}
                {thread.hasOlder && (
                  <div className="flex justify-center">
                    <Button variant="ghost" size="sm" className="text-[12px] text-muted-foreground" onClick={inbox.loadOlder}>Load earlier messages</Button>
                  </div>
                )}
                {!thread.messages.length && (
                  <p className="py-6 text-center text-[13px] text-muted-foreground">
                    This older ticket has no conversation messages yet.{thread.ticket.staff_note ? ' Previous update: ' + thread.ticket.staff_note : ''}
                  </p>
                )}
                {days.map((day) => (
                  <Fragment key={day.key}>
                    <DaySeparator label={day.label} />
                    <div className="flex flex-col gap-3">
                      {day.turns.map((turn) => (
                        <MessageTurn
                          key={turn.key}
                          own={turn.author === 'tenant'}
                          author={turn.author === 'support' ? 'Drive247 Support' : 'You'}
                          messages={turn.items}
                          files={thread.attachments}
                        />
                      ))}
                    </div>
                  </Fragment>
                ))}
              </div>

              <Composer inbox={inbox} placeholder="Reply to support…" label="Reply in this conversation">
                {thread.ticket.status === 'closed' && (
                  <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">A follow-up message reopens this ticket.</p>
                )}
              </Composer>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
              <p className="text-[13px] text-muted-foreground">{id ? 'Loading conversation…' : 'Select a ticket to read and reply.'}</p>
              {!id && <p className="text-[12px] text-muted-foreground/80">Your conversations with the Drive247 support team appear here.</p>}
            </div>
          )}
        </section>
      </div>
      {retrying && <span className="sr-only">Your last message is waiting to be retried.</span>}
    </div>
  );
}

/** Subject, then the reference and the stored status. No created/updated strip. */
function ConversationHeader({ ticket, onBack }: { ticket: HumanTicket; onBack: () => void }) {
  return (
    <header className="flex shrink-0 items-start gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4">
      <Button variant="ghost" size="icon-sm" aria-label="Back to tickets" className="-ml-1 shrink-0 md:hidden" onClick={onBack}>
        <ArrowLeft />
      </Button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight">{ticket.summary}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>{ticket.reference}</span>
          <StatusBadge status={ticket.status} />
        </p>
      </div>
      <IssueDetails ticket={ticket} />
    </header>
  );
}

/** Secondary metadata: available, not in the way. */
function IssueDetails({ ticket }: { ticket: HumanTicket }) {
  return (
    <Collapsible className="relative shrink-0">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-[12px] text-muted-foreground">
          <Info className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Issue details</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="absolute right-0 top-full z-20 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 text-[12px] shadow-lg">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Reference</dt><dd className="break-all">{ticket.reference}</dd>
          <dt className="text-muted-foreground">Status</dt><dd>{ticket.status === 'in_progress' ? 'In progress' : ticket.status === 'closed' ? 'Resolved' : 'Open'}</dd>
          <dt className="text-muted-foreground">Opened</dt><dd>{new Date(ticket.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd>
          <dt className="text-muted-foreground">Last activity</dt><dd>{new Date(ticket.updated_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</dd>
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The new request: subject, message, and nothing submitted until Send. */
function NewRequest({ inbox }: { inbox: SupportInboxState }) {
  return (
    <>
      <header className="flex shrink-0 items-start gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon-sm" aria-label="Back to tickets" className="-ml-1 shrink-0 md:hidden" onClick={inbox.cancelNew}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight">New ticket</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Nothing is sent until you press Send.</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        <div className="mx-auto w-full max-w-xl space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="support-subject" className="text-[12px] font-medium">Subject</label>
            <input
              id="support-subject"
              value={inbox.subject}
              maxLength={240}
              readOnly={inbox.busy || inbox.retrying}
              onChange={(e) => inbox.setSubject(e.target.value)}
              placeholder="What is this about?"
              className="h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Your message, and the TRAX troubleshooting context for this issue when there is one, are shared with support. Do not include credentials, card details or identity documents.
          </p>
        </div>
      </div>
      <Composer inbox={inbox} placeholder="Describe the problem…" label="Your message">
        <div className="mb-1.5 flex justify-end">
          <Button type="button" variant="ghost" size="sm" disabled={inbox.busy} onClick={inbox.cancelNew}>Cancel</Button>
        </div>
      </Composer>
    </>
  );
}
