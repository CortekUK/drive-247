'use client';
import React from 'react';
import type { HumanTicket, PendingAttachment, SupportAttachment, SupportInboxState } from './use-support-inbox';

/**
 * The support inbox's LOOK, shared by the tenant's Support section and the
 * platform inbox so the two read as one system: the same ticket row, the same
 * status badge, the same bubbles, the same composer.
 *
 * Presentation only. Each app keeps its own authorized data access and its own
 * page shell; nothing here fetches, and nothing here decides who may see a
 * ticket. Plain Tailwind on the shared token names (`bg-card`, `border-border`,
 * `text-muted-foreground`, `bg-primary`), because the admin app does not have
 * the portal's v2 primitives and both themes define these tokens.
 */

/** The three states the ticket table actually stores. Resolved IS `closed`. */
export const STATUS_LABEL: Record<HumanTicket['status'], string> = { open: 'Open', in_progress: 'In progress', closed: 'Resolved' };
export const STATUS_ORDER: HumanTicket['status'][] = ['open', 'in_progress', 'closed'];
const STATUS_TONE: Record<HumanTicket['status'], string> = {
  open: 'bg-primary/10 text-primary',
  in_progress: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  closed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
};

export function StatusBadge({ status, className = '' }: { status: HumanTicket['status']; className?: string }) {
  return <span data-testid="ticket-status" data-status={status} className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]} ${className}`}>{STATUS_LABEL[status]}</span>;
}

export const readableSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
export const clockStamp = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
/** One short stamp for a list row: a time today, a date before that. */
export function listStamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (sameDay(date, now)) return clockStamp(value);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(date.getFullYear() === now.getFullYear() ? {} : { year: '2-digit' }) });
}
export function dayLabel(value: Date) {
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(value, now)) return 'Today';
  if (sameDay(value, yesterday)) return 'Yesterday';
  return value.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(value.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input aria-label="Search support tickets" placeholder={placeholder} maxLength={120} value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20" />
    </div>
  );
}

export function StatusFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select aria-label="Filter ticket status" value={value} onChange={(e) => onChange(e.target.value)}
      className="h-9 shrink-0 rounded-lg border border-input bg-background px-2 text-[12px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20">
      <option value="">All statuses</option>
      {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
    </select>
  );
}

/**
 * One ticket in the list: subject (up to two lines), its reference, the latest
 * message as a single truncated line, when it last moved, and its status.
 *
 * No leading dot, avatar or bullet — an unread ticket is stated by weight, and
 * the selected one by a lavender surface, so every row's text starts on the same
 * left edge. `preview` is only rendered when the server sent one.
 */
export function TicketRow({ ticket, selected, disabled, onSelect, subtitle }: {
  ticket: HumanTicket & { preview?: string };
  selected: boolean; disabled?: boolean; onSelect: () => void;
  /** Admin only: whose account this ticket belongs to. */
  subtitle?: string;
}) {
  /* The server's per-ticket count of unread incoming MESSAGES when it sends one;
     otherwise the older ticket-level flag. The subject's weight follows the same
     answer, so a row is never bold without a count or counted without being bold. */
  const count = typeof ticket.unreadMessages === 'number' ? ticket.unreadMessages : null;
  const unread = count !== null ? count > 0 : !!ticket.unread;
  return (
    <button type="button" disabled={disabled} onClick={onSelect} aria-current={selected ? 'true' : undefined}
      className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:bg-primary/10 disabled:opacity-60 ${selected ? 'bg-primary/10' : 'hover:bg-primary/10'}`}>
      <span className="flex items-start gap-2">
        <span className={`line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug ${unread ? 'font-semibold' : 'font-medium'}`}>
          {ticket.summary}
          {count !== null
            ? count > 0 && <span className="sr-only"> · {count} unread {count === 1 ? 'message' : 'messages'}</span>
            : unread && <span className="sr-only"> · Unread</span>}
        </span>
        <time dateTime={ticket.updated_at} className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">{listStamp(ticket.updated_at)}</time>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{ticket.reference}{subtitle ? ` · ${subtitle}` : ''}</span>
        {/* Unread messages, under the time: a solid accent pill, so it reads on the
            lavender selected row too and never looks like the tinted status badge. */}
        {count !== null && count > 0 && (
          <span data-testid="ticket-unread" aria-hidden
            className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10.5px] font-semibold leading-none tabular-nums text-primary-foreground">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      {ticket.preview && <span className="truncate text-[12px] text-muted-foreground">{ticket.preview}</span>}
      <StatusBadge status={ticket.status} className="mt-0.5 self-start" />
    </button>
  );
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Initials for a participant; support uses a mark instead. */
function Avatar({ label, own }: { label: string; own: boolean }) {
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span aria-hidden className={`flex size-7 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold ${own ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
      {own ? initials : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-3.5"><path d="M3 14v-2a9 9 0 0 1 18 0v2" strokeLinecap="round" /><rect x="2" y="13" width="4" height="7" rx="1.5" /><rect x="18" y="13" width="4" height="7" rx="1.5" /></svg>}
    </span>
  );
}

export interface TurnMessage { seq: number; body: string; created_at: string }
/**
 * One turn: the consecutive messages of a single author, as bubbles sized to
 * their content — a three-word reply is a small bubble, not a card.
 * `own` decides the side and the surface, so each app passes it from ITS viewer.
 */
export function MessageTurn({ own, author, messages, files, children }: {
  own: boolean; author: string; messages: TurnMessage[];
  files?: SupportAttachment[];
  children?: React.ReactNode;
}) {
  const last = messages[messages.length - 1];
  return (
    <div data-slot="message" data-align={own ? 'end' : 'start'} className={`flex w-full min-w-0 gap-2 ${own ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar label={author} own={own} />
      <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 ${own ? 'items-end' : 'items-start'}`}>
        {!own && <span data-slot="message-header" className="px-1 text-[11px] font-medium text-muted-foreground">{author}</span>}
        {messages.map((message) => (
          <div key={message.seq} data-slot="bubble" data-variant={own ? 'tinted' : 'muted'}
            className={`w-fit min-w-0 max-w-full overflow-hidden rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${own ? 'bg-primary/10 text-foreground dark:bg-primary/25' : 'bg-muted text-foreground'}`}>
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.body}</p>
            <MessageFiles files={(files ?? []).filter((file) => file.seq === message.seq)} />
            <span data-seq={message.seq} aria-hidden className="block h-px" />
          </div>
        ))}
        <span className="px-1 text-[10.5px] text-muted-foreground"><time dateTime={last.created_at}>{clockStamp(last.created_at)}</time></span>
        {children}
      </div>
    </div>
  );
}

/** Files on a message: an image shows itself, a document is a named link. Both
 *  open the short-lived signed URL the server minted for this reader. */
export function MessageFiles({ files }: { files: SupportAttachment[] }) {
  if (!files.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {files.map((file) => (
        <li key={file.id}>
          {file.mime.startsWith('image/') && file.url
            ? <a href={file.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-border/70"><img src={file.url} alt={file.name} loading="lazy" className="max-h-44 max-w-[220px] object-cover" /></a>
            : <a href={file.url ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={file.url ? undefined : true}
                className={`inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 py-1.5 text-[12px] ${file.url ? 'hover:bg-muted' : 'pointer-events-none opacity-60'}`}>
                <span className="max-w-[180px] truncate">{file.name}</span><span className="text-muted-foreground">{readableSize(file.size)}</span>
              </a>}
        </li>
      ))}
    </ul>
  );
}

/** Chosen, not sent. A file that fails the limits says so before any upload. */
export function PendingFiles({ files, busy, onRemove }: { files: PendingAttachment[]; busy: boolean; onRemove: (key: string) => void }) {
  if (!files.length) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {files.map((file) => (
        <li key={file.key} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${file.error ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-muted/50'}`}>
          <span className="max-w-[200px] truncate">{file.name}</span>
          <span className={file.error ? '' : 'text-muted-foreground'}>{file.error ?? readableSize(file.size)}</span>
          <button type="button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => onRemove(file.key)} className="rounded px-1 text-muted-foreground hover:text-foreground">×</button>
        </li>
      ))}
    </ul>
  );
}

/** The paperclip. Not offered where the app has no upload path configured. */
export function AttachButton({ inbox }: { inbox: SupportInboxState }) {
  const input = React.useRef<HTMLInputElement>(null);
  const picked = inbox.attachments ?? [];
  if (!inbox.canAttach && !picked.length) return null;
  return (
    <>
      <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="sr-only"
        aria-label="Attach a screenshot or document"
        onChange={(e) => { if (e.target.files?.length) inbox.addAttachments(e.target.files); e.target.value = ''; }} />
      <button type="button" aria-label="Attach a file" title="Attach a screenshot or document (PNG, JPEG, WebP, GIF or PDF, up to 10 MB)"
        disabled={inbox.busy || !inbox.canAttach} onClick={() => input.current?.click()}
        className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" aria-hidden><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 1 1 5 5l-8 8a2 2 0 1 1-3-3l7.5-7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </>
  );
}

/**
 * The composer, anchored at the bottom of the conversation. Enter sends a reply;
 * Shift+Enter is a new line. Drafts, the sending state and the retry all come
 * from the inbox state, so a failed send keeps what was typed.
 */
export function Composer({ inbox, placeholder, label, children }: { inbox: SupportInboxState; placeholder: string; label: string; children?: React.ReactNode }) {
  const { busy, retrying, notice, canSend } = inbox;
  return (
    <form className="shrink-0 border-t border-border/70 bg-background px-3 py-2.5 sm:px-4" onSubmit={(e) => { e.preventDefault(); void inbox.send(); }}>
      {children}
      <PendingFiles files={inbox.attachments ?? []} busy={busy} onRemove={inbox.removeAttachment} />
      <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <AttachButton inbox={inbox} />
        <label htmlFor="support-message" className="sr-only">{label}</label>
        <textarea id="support-message" value={inbox.draft} maxLength={4000} readOnly={busy || retrying} rows={1} placeholder={placeholder}
          onKeyDown={(e) => { if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return; e.preventDefault(); void inbox.send(); }}
          onChange={(e) => { inbox.setDraft(e.target.value); const el = e.target; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70" />
        <button type="submit" disabled={busy || !canSend}
          className="mb-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          {busy ? 'Sending…' : retrying ? 'Retry send' : 'Send'}
        </button>
      </div>
      <p role="status" className="mt-1 flex h-4 items-center gap-1 px-1 text-[11px] text-muted-foreground">
        {busy ? 'Sending…' : notice || 'Press Enter to send · Shift + Enter for a new line'}
      </p>
    </form>
  );
}

/* Hover, focus and selection in the Support lists use the portal sidebar's highlight
   (ui-v2/sidebar.tsx SIDEBAR_HIGHLIGHT_*): bg-primary/10 with primary text. */

/**
 * The ticket list — search, a status filter and the rows — wherever the app puts
 * it: the Support rail in the sidebar's slot on a desktop, or the page itself on a
 * phone or when the rail is collapsed. One component, so both behave the same.
 */
export function TicketList({ inbox, admin = false, onChosen, className = '' }: {
  inbox: SupportInboxState; admin?: boolean;
  /** After a row is chosen: a phone closes the sheet the list sits in. */
  onChosen?: () => void;
  className?: string;
}) {
  const { id, tickets, next, search, filter, busy, loading } = inbox;
  return (
    <section aria-label="Support tickets" data-testid="support-ticket-list" className={`flex min-h-0 min-w-0 flex-1 flex-col ${className}`}>
      <div className="flex shrink-0 items-center gap-2 px-2 pb-2">
        <div className="min-w-0 flex-1"><SearchField value={search} onChange={inbox.setSearch} placeholder={admin ? 'Search tickets or company…' : 'Search your tickets…'} /></div>
        <StatusFilter value={filter} onChange={inbox.setFilter} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {!tickets.length ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            {loading ? 'Loading tickets…' : search || filter ? 'No tickets match these filters.' : 'No support tickets yet.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <TicketRow ticket={ticket} selected={id === ticket.id} disabled={busy}
                  onSelect={() => { inbox.choose(ticket.id); onChosen?.(); }}
                  subtitle={admin ? [ticket.tenant_name, ticket.requester].filter(Boolean).join(' · ') : undefined} />
              </li>
            ))}
          </ul>
        )}
        {next !== null && (
          <button type="button" className="mt-1 w-full rounded-lg px-3 py-2 text-[12px] text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:bg-primary/10 focus-visible:text-primary" onClick={inbox.loadMore}>Load more</button>
        )}
      </div>
    </section>
  );
}

/**
 * A lifecycle event in the conversation — TRAX opening the ticket — drawn as an
 * event, not as anybody's message. What TRAX found is in the TRAX Summary tab.
 *
 * It keeps the stored message's read marker: acknowledgement is per message, and a
 * ticket whose only message is this one must still be markable as read.
 */
export function SystemEvent({ message, onOpenSummary }: { message: TurnMessage; onOpenSummary?: () => void }) {
  return (
    <div data-slot="system-event" className="flex justify-center px-2">
      <p className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-2xl bg-muted/70 px-3 py-1.5 text-center text-[11.5px] leading-snug text-muted-foreground">
        <span><span className="font-medium text-foreground">TRAX</span> created this ticket and shared its troubleshooting summary</span>
        <time dateTime={message.created_at}>{clockStamp(message.created_at)}</time>
        {onOpenSummary && (
          <button type="button" onClick={onOpenSummary} className="rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View TRAX Summary</button>
        )}
        <span data-seq={message.seq} aria-hidden className="inline-block h-px w-px" />
      </p>
    </div>
  );
}

/**
 * The status control, for platform support only (the Details tab).
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
export function StatusSelect({ inbox, ticket }: { inbox: SupportInboxState; ticket: HumanTicket }) {
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
    <div className="flex min-w-0 flex-col items-start gap-1">
      <select aria-label="Ticket status" disabled={!!saving || inbox.busy} value={saving ?? ticket.status}
        onChange={(e) => void change(e.target.value as HumanTicket['status'])}
        className="h-8 rounded-lg border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60">
        {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
      </select>
      {saving && <span role="status" className="text-[11px] text-muted-foreground">Saving…</span>}
      {failure && <span role="alert" className="text-[11px] text-destructive">{failure}</span>}
    </div>
  );
}

/**
 * Consecutive messages from one author, close in time, read as one turn.
 *
 * A message the server marks as TRAX's (`source`) is a `system` turn of its own:
 * it is never grouped with the requester's words, even though it is stored under
 * their side of the ticket.
 */
export function byDay<T extends { seq: number; author_kind: 'tenant' | 'support'; body: string; created_at: string; source?: string }>(messages: T[]) {
  const days: { key: string; label: string; turns: { key: string; author: T['author_kind'] | 'system'; items: T[] }[] }[] = [];
  for (const message of messages) {
    const at = new Date(message.created_at);
    const key = Number.isNaN(at.getTime()) ? 'unknown' : at.toDateString();
    let day = days[days.length - 1];
    if (!day || day.key !== key) { day = { key, label: Number.isNaN(at.getTime()) ? '' : dayLabel(at), turns: [] }; days.push(day); }
    const turn = day.turns[day.turns.length - 1];
    const previous = turn?.items[turn.items.length - 1];
    const near = previous && Math.abs(at.getTime() - new Date(previous.created_at).getTime()) < 5 * 60 * 1000;
    const author = message.source === 'trax_handoff' ? 'system' : message.author_kind;
    if (turn && author !== 'system' && turn.author === author && near) turn.items.push(message);
    else day.turns.push({ key: String(message.seq), author, items: [message] });
  }
  return days;
}
