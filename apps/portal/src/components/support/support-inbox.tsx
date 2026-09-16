'use client';

import { Fragment, useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, Check, Info, Loader2, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import { Input } from '@/components/ui-v2/input';
import { Bubble, BubbleContent } from '@/components/ui-v2/bubble';
import { Message, MessageContent, MessageFooter, MessageHeader } from '@/components/ui-v2/message';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui-v2/collapsible';
import { cn } from '@/lib/utils';
import type { HumanTicket, SupportInboxState, SupportMessage } from '../../../../../shared/trax-support/use-support-inbox';

/**
 * The tenant's support inbox: a ticket list beside one conversation.
 *
 * It is a messaging view, not a stack of form cards — bubbles sized to their
 * content, a list row per ticket, and a composer that stays on screen while the
 * list and the history scroll inside themselves. All of the behaviour is
 * `useSupportInbox` (shared/trax-support), so this file decides only how the
 * conversation looks; it invents no counts, no presence and no status.
 *
 * The page owns the hook (portal-support.tsx) because the page header carries
 * "New ticket".
 */

const STATUSES: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'closed', label: 'Resolved' },
];
const statusLabel: Record<HumanTicket['status'], string> = { open: 'Open', in_progress: 'In progress', closed: 'Resolved' };
/* Status colour is the ticket's own state, never a guess from message text. */
const statusTone: Record<HumanTicket['status'], string> = {
  open: 'text-primary',
  in_progress: 'text-amber-600 dark:text-amber-400',
  closed: 'text-muted-foreground',
};

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
function dayLabel(value: Date) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(value, now)) return 'Today';
  if (sameDay(value, yesterday)) return 'Yesterday';
  return value.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(value.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
const clock = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
/** The list needs one short stamp: a time today, a date before that. */
function listStamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (sameDay(date, now)) return clock(value);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(date.getFullYear() === now.getFullYear() ? {} : { year: '2-digit' }) });
}

/** Consecutive messages from the same author, close in time, read as one turn. */
interface Turn { key: string; author: SupportMessage['author_kind']; items: SupportMessage[] }
interface Day { key: string; label: string; turns: Turn[] }
function byDay(messages: SupportMessage[]): Day[] {
  const days: Day[] = [];
  for (const message of messages) {
    const at = new Date(message.created_at);
    const key = Number.isNaN(at.getTime()) ? 'unknown' : at.toDateString();
    let day = days.at(-1);
    if (!day || day.key !== key) {
      day = { key, label: Number.isNaN(at.getTime()) ? '' : dayLabel(at), turns: [] };
      days.push(day);
    }
    const turn = day.turns.at(-1);
    const previous = turn?.items.at(-1);
    const near = previous && Math.abs(at.getTime() - new Date(previous.created_at).getTime()) < 5 * 60 * 1000;
    if (turn && turn.author === message.author_kind && near) turn.items.push(message);
    else day.turns.push({ key: String(message.seq), author: message.author_kind, items: [message] });
  }
  return days;
}

export function SupportInboxView({ inbox, className }: { inbox: SupportInboxState; className?: string }) {
  const { id, creating, tickets, next, thread, search, filter, busy, loading, error, retrying, scrollRef } = inbox;
  const open = creating || !!id;
  const days = useMemo(() => byDay(thread?.messages ?? []), [thread]);

  /* Enter sends a REPLY; Shift+Enter is a new line. The new-ticket composer is
     deliberately not wired to it (see NewRequest): a stray Enter while writing a
     first description would create the ticket. */
  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void inbox.send();
  };

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
          <div className="shrink-0 space-y-2 border-b border-border/70 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                aria-label="Search support tickets"
                placeholder="Search your tickets…"
                maxLength={120}
                value={search}
                onChange={(e) => inbox.setSearch(e.target.value)}
                className="h-9 pl-8 text-[13px]"
              />
            </div>
            <div role="group" aria-label="Filter ticket status" className="flex items-center gap-1">
              {STATUSES.map((option) => (
                <button
                  key={option.value || 'all'}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => inbox.setFilter(option.value)}
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    filter === option.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
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
                    <button
                      type="button"
                      disabled={busy}
                      aria-current={id === ticket.id ? 'true' : undefined}
                      onClick={() => inbox.choose(ticket.id)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                        id === ticket.id ? 'bg-primary/10' : 'hover:bg-muted/60',
                      )}
                    >
                      {/* The server's own unread flag: a ticket with incoming messages newer than this reader's position. */}
                      <span className="mt-1.5 flex size-2 shrink-0 items-center justify-center" aria-hidden>
                        {ticket.unread && <span className="size-2 rounded-full bg-primary" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('line-clamp-2 block text-[13px] leading-snug', ticket.unread ? 'font-semibold' : 'font-medium')}>
                          {ticket.summary}
                          {ticket.unread && <span className="sr-only"> · Unread</span>}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className={statusTone[ticket.status]}>{statusLabel[ticket.status]}</span>
                          <span aria-hidden>·</span>
                          <span className="truncate">{ticket.reference}</span>
                        </span>
                      </span>
                      <time dateTime={ticket.updated_at} className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">{listStamp(ticket.updated_at)}</time>
                    </button>
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
              <header className="flex shrink-0 items-start gap-2 border-b border-border/70 px-3 py-2.5 sm:px-4">
                <Button variant="ghost" size="icon-sm" aria-label="Back to tickets" className="-ml-1 shrink-0 md:hidden" onClick={inbox.clearSelection}>
                  <ArrowLeft />
                </Button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight">{thread.ticket.summary}</h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{thread.ticket.reference}</span>
                    <span aria-hidden>·</span>
                    <span className={statusTone[thread.ticket.status]}>{statusLabel[thread.ticket.status]}</span>
                  </p>
                </div>
                <IssueDetails ticket={thread.ticket} />
              </header>

              <div
                ref={scrollRef}
                onScroll={inbox.onThreadScroll}
                aria-label="Message thread"
                aria-live="polite"
                className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4"
              >
                {thread.hasOlder && (
                  <div className="mb-2 flex justify-center">
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
                    <div className="my-3 flex items-center gap-3" role="separator" aria-label={day.label}>
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-[11px] font-medium text-muted-foreground">{day.label}</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <div className="flex flex-col gap-3">
                      {day.turns.map((turn) => (
                        <Message key={turn.key} align={turn.author === 'tenant' ? 'end' : 'start'}>
                          <MessageContent className="gap-1">
                            <MessageHeader className="text-[11px]">{turn.author === 'support' ? 'Drive247 Support' : 'You'}</MessageHeader>
                            {turn.items.map((message) => (
                              <Bubble
                                key={message.seq}
                                align={turn.author === 'tenant' ? 'end' : 'start'}
                                variant={turn.author === 'tenant' ? 'tinted' : 'muted'}
                                className="max-w-[85%]"
                              >
                                <BubbleContent className="rounded-2xl px-3 py-2 text-[13px]">
                                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.body}</p>
                                  <span data-seq={message.seq} aria-hidden className="block h-px" />
                                </BubbleContent>
                              </Bubble>
                            ))}
                            <MessageFooter className="text-[10.5px]">
                              <time dateTime={turn.items.at(-1)!.created_at}>{clock(turn.items.at(-1)!.created_at)}</time>
                            </MessageFooter>
                          </MessageContent>
                        </Message>
                      ))}
                    </div>
                  </Fragment>
                ))}
              </div>

              <Composer inbox={inbox} label="Reply in this conversation" onKeyDown={onComposerKeyDown}>
                {thread.ticket.status === 'closed' && (
                  <p className="mb-1.5 text-[11px] text-muted-foreground">A follow-up message reopens this ticket.</p>
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

/** Secondary metadata and the TRAX handoff: available, not in the way. */
function IssueDetails({ ticket }: { ticket: HumanTicket }) {
  const handoff = ticket.handoff;
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
          <dt className="text-muted-foreground">Status</dt><dd>{statusLabel[ticket.status]}</dd>
          <dt className="text-muted-foreground">Opened</dt><dd>{new Date(ticket.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd>
          <dt className="text-muted-foreground">Last activity</dt><dd>{new Date(ticket.updated_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</dd>
        </dl>
        {handoff && <TroubleshootingSummary value={handoff} />}
      </CollapsibleContent>
    </Collapsible>
  );
}

function TroubleshootingSummary({ value }: { value: Record<string, unknown> }) {
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  const checks = Array.isArray(value.verifiedChecks) ? (value.verifiedChecks as Record<string, unknown>[]) : [];
  const reports = Array.isArray(value.reportedByUser) ? (value.reportedByUser as Record<string, unknown>[]) : [];
  const references = Array.isArray(value.recordReferences) ? (value.recordReferences as Record<string, unknown>[]) : [];
  const issue = value.issue && typeof value.issue === 'object' ? (value.issue as Record<string, unknown>) : {};
  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <p className="font-medium">TRAX troubleshooting context</p>
      <div className="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto leading-relaxed text-muted-foreground">
        <p>{text(value.disclosure) || 'Historical observations; recheck current records before acting.'}</p>
        {typeof issue.reason === 'string' && <p>Support requested: {issue.reason.replace(/_/g, ' ')}.</p>}
        {reports.map((r, i) => <p key={'r' + i}><span className="font-medium text-foreground">Reported:</span> {text(r.content)}</p>)}
        {checks.map((c, i) => (
          <div key={'c' + i}>
            <p className="font-medium text-foreground">Recorded check · {text(c.observedAt)}</p>
            {Array.isArray(c.findings) && c.findings.map((f, j) => <p key={j}>{text(f)}</p>)}
          </div>
        ))}
        {Array.isArray(value.unknowns) && value.unknowns.map((u, i) => <p key={'u' + i}>Unresolved: {text(u)}</p>)}
        {references.map((r, i) => <p key={'ref' + i} className="break-all">Record reference · {text(r.kind)}: {text(r.id)}</p>)}
      </div>
    </div>
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
            <Input
              id="support-subject"
              value={inbox.subject}
              maxLength={240}
              readOnly={inbox.busy || inbox.retrying}
              onChange={(e) => inbox.setSubject(e.target.value)}
              placeholder="What is this about?"
              className="h-9 text-[13px]"
            />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Your message, and the TRAX troubleshooting context for this issue when there is one, are shared with support. Do not include credentials, card details or identity documents.
          </p>
        </div>
      </div>
      <Composer inbox={inbox} label="Your message" onKeyDown={undefined} />
    </>
  );
}

/** One composer for both: it never leaves the bottom of the conversation column. */
function Composer({
  inbox,
  label,
  onKeyDown,
  children,
}: {
  inbox: SupportInboxState;
  label: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  children?: ReactNode;
}) {
  const { busy, retrying, notice, canSend, creating } = inbox;
  return (
    <form
      className="shrink-0 border-t border-border/70 bg-background px-3 py-2.5 sm:px-4"
      onSubmit={(e) => { e.preventDefault(); void inbox.send(); }}
    >
      {children}
      <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <label htmlFor="support-message" className="sr-only">{label}</label>
        <textarea
          id="support-message"
          value={inbox.draft}
          maxLength={4000}
          readOnly={busy || retrying}
          rows={1}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            inbox.setDraft(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          placeholder={creating ? 'Describe the problem…' : 'Write a reply…'}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
        />
        <div className="flex shrink-0 items-center gap-1 pb-0.5">
          {creating && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={inbox.cancelNew}>Cancel</Button>
          )}
          <Button type="submit" size="sm" disabled={busy || !canSend} className="gap-1.5">
            {busy ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : retrying ? null : <Send className="size-3.5" aria-hidden />}
            {busy ? 'Sending…' : retrying ? 'Retry send' : 'Send'}
          </Button>
        </div>
      </div>
      <p role="status" className="mt-1 flex h-4 items-center gap-1 text-[11px] text-muted-foreground">
        {busy ? 'Sending…' : notice ? (<><Check className="size-3" aria-hidden />{notice}</>) : ''}
      </p>
    </form>
  );
}
