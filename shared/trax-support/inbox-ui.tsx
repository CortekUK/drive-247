'use client';
import React from 'react';
import { activeFilterCount, ATTACHMENT_MAX_FILES, SUPPORT_REACTIONS, type SupportReaction, type HumanTicket, type PendingAttachment, type SupportAttachment, type SupportInboxState } from './use-support-inbox';
import { FilterButton, FilterPanel } from './support-filters';

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

export function StatusBadge({ status, className = '', small = false }: { status: HumanTicket['status']; className?: string; small?: boolean }) {
  return <span data-testid="ticket-status" data-status={status} className={`inline-flex shrink-0 items-center rounded-full font-medium ${small ? 'h-[18px] px-1.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'} ${STATUS_TONE[status]} ${className}`}>{STATUS_LABEL[status]}</span>;
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

/** The one search: the tinted pill Messages uses (messages-v2/conversation-rail.tsx). */
export function SearchField({ value, onChange, placeholder, trailing }: { value: string; onChange: (value: string) => void; placeholder: string;
  /** A control at the pill's right end (the platform queue's Filters). */
  trailing?: React.ReactNode }) {
  return (
    <div className={`relative flex h-9 min-w-0 flex-1 items-center rounded-full border border-primary/25 bg-primary/[0.07] ${trailing ? 'pr-1' : ''} transition-colors duration-200 ease-out motion-reduce:transition-none hover:border-primary/40 hover:bg-primary/10 focus-within:border-primary/50 focus-within:bg-primary/10 focus-within:ring-3 focus-within:ring-ring/30`}>
    <label className="flex h-full min-w-0 flex-1 cursor-text items-center gap-2 px-3">
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4 shrink-0 text-primary">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <input type="search" aria-label="Search support tickets" placeholder={placeholder} maxLength={120} value={value} onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden" />
    </label>
    {trailing}
    </div>
  );
}

/**
 * The status filter.
 *
 * A native `<select>` before this. Its OPTION LIST is drawn by the operating
 * system, not by us: the panel, the font and that flat blue highlight row come
 * from Windows, and no class on the element reaches inside them. So the control
 * sat in the middle of a themed sidebar looking like nothing else on the page,
 * and could not be made to match however it was styled.
 *
 * This is a listbox we draw ourselves, built from the same tokens the rest of
 * this file uses — `border-input`, `bg-background`, `ring-ring`, `text-primary`
 * — which resolve to whichever app mounts it. Nothing here names a colour, so
 * the portal and the admin each get their own theme without this file knowing
 * either exists.
 *
 * Keyboard behaviour is the part a native select gives away for free and a
 * hand-rolled one usually loses: arrows move, Home/End jump, Enter and Space
 * select, Escape closes and returns focus to the trigger.
 */
export function StatusFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const options = React.useMemo(
    () => [{ value: '', label: 'All statuses' }, ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] }))],
    [],
  );
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = options[selectedIndex];

  // Clicking anywhere else closes it — the one behaviour people expect from a
  // dropdown and the one a hand-rolled listbox most often forgets.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openAt = (index: number) => { setActive(index); setOpen(true); };

  const commit = (index: number) => {
    onChange(options[index]!.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openAt(selectedIndex);
      }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(active); }
  };

  return (
    <div ref={rootRef} className="relative shrink-0" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Filter ticket status"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-[12px] outline-none transition-colors hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
      >
        <span className="truncate">{selected?.label}</span>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Ticket status"
          className="absolute right-0 z-50 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-input bg-popover p-1 shadow-lg"
        >
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            return (
              <li key={option.value || 'all'}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => commit(index)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
                    index === active ? 'bg-primary/10 text-primary' : 'text-foreground'
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && (
                    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="size-3.5 shrink-0">
                      <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
export function TicketRow({ ticket, selected, disabled, onSelect, admin = false, onStar, numberOnly = false }: {
  ticket: HumanTicket & { preview?: string };
  selected: boolean; disabled?: boolean; onSelect: () => void;
  /** Platform queue: star or unstar this ticket for the viewer. */
  onStar?: (starred: boolean) => void;
  /** The platform queue: the row carries the conversation header's facts in
   *  full — company, requester, reference and status — nothing truncated. */
  admin?: boolean;
  /** The Trax panel: a chat-list row — number, status, time, then the latest message. */
  numberOnly?: boolean;
}) {
  /* The server's per-ticket count of unread incoming MESSAGES when it sends one;
     otherwise the older ticket-level flag. The subject's weight follows the same
     answer, so a row is never bold without a count or counted without being bold. */
  const count = typeof ticket.unreadMessages === 'number' ? ticket.unreadMessages : null;
  const unread = count !== null ? count > 0 : !!ticket.unread;
  /* The Trax panel, like a chat list: the number, its status and the time on
     top, then one truncated line of the latest message with the unread count.
     The subject stands in until the server sends a preview. */
  if (numberOnly && !admin) {
    const preview = ticket.preview || ticket.summary;
    return (
      <button type="button" disabled={disabled} onClick={onSelect} aria-current={selected ? 'true' : undefined}
        className={`flex w-full min-w-0 flex-col gap-1 rounded-lg px-3.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:bg-primary/10 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30 disabled:opacity-60 ${selected ? 'bg-primary/10' : 'hover:bg-primary/10'}`}>
        <span className="flex min-w-0 items-center gap-2">
          <span className={`min-w-0 truncate text-[13px] leading-snug tabular-nums text-foreground ${unread ? 'font-semibold' : 'font-medium'}`}>
            {ticket.reference}
            {count !== null
              ? count > 0 && <span className="sr-only"> · {count} unread {count === 1 ? 'message' : 'messages'}</span>
              : unread && <span className="sr-only"> · Unread</span>}
          </span>
          <StatusBadge status={ticket.status} small />
          <time dateTime={ticket.updated_at} className={`ml-auto shrink-0 text-[11px] ${unread ? 'font-medium text-primary' : 'text-muted-foreground'}`}>{listStamp(ticket.updated_at)}</time>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-[12.5px] ${unread ? 'text-foreground' : 'text-muted-foreground'}`}>{preview}</span>
          {count !== null && count > 0 && <UnreadCount count={count} />}
        </span>
      </button>
    );
  }
  return (
    <div className="group/row relative">
    <button type="button" disabled={disabled} onClick={onSelect} aria-current={selected ? 'true' : undefined}
      className={`flex w-full flex-col gap-1.5 rounded-lg px-3.5 py-3 text-left transition-colors focus:outline-none focus-visible:bg-primary/10 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30 disabled:opacity-60 ${selected ? 'bg-primary/10' : 'hover:bg-primary/10'}`}>
      {/* Platform queue: the ticket number IS the heading (the subject is in the
          conversation). The tenant's own list keeps the subject. */}
      <span className="flex items-start gap-2">
        {/* With a star control, the number makes room for it on hover (or for
            good, once starred) by sliding — transform only, never padding. */}
        <span className={`min-w-0 flex-1 text-[13px] leading-snug ${admin ? 'truncate tabular-nums' : 'line-clamp-2'} ${unread ? 'font-semibold' : 'font-medium'} ${
          onStar ? `pr-5 transition-transform duration-200 ease-out motion-reduce:transition-none ${ticket.starred ? 'translate-x-5' : 'group-hover/row:translate-x-5 group-focus-within/row:translate-x-5'}` : ''}`}>
          {admin ? ticket.reference : ticket.summary}
          {count !== null
            ? count > 0 && <span className="sr-only"> · {count} unread {count === 1 ? 'message' : 'messages'}</span>
            : unread && <span className="sr-only"> · Unread</span>}
        </span>
        <time dateTime={ticket.updated_at} className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">{listStamp(ticket.updated_at)}</time>
        {/* Unread messages: a solid accent pill, so it reads on the lavender
            selected row too and never looks like the tinted status badge. */}
        {admin && count !== null && count > 0 && <UnreadCount count={count} />}
      </span>
      {!admin && (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{ticket.reference}</span>
          {count !== null && count > 0 && <UnreadCount count={count} />}
        </span>
      )}
      {/* The latest message, one line, cut with an ellipsis (WhatsApp's preview);
          darker while there is something unread in it. */}
      {ticket.preview && <span className={`block min-w-0 truncate text-[12.5px] leading-snug ${unread ? 'text-foreground/80' : 'text-muted-foreground'}`}>{ticket.preview}</span>}
      {/* Pills along the bottom: status, then (platform queue) company and requester. */}
      {/* One line, small: a long name shortens rather than wrapping the row. */}
      <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
        <StatusBadge status={ticket.status} small />
        {admin && ticket.tenant_name && (
          <span data-testid="ticket-row-tenant" className="block h-[18px] min-w-0 truncate rounded-full leading-[16px] border border-border/70 bg-background/60 px-1.5 text-[10px] font-medium text-foreground">{ticket.tenant_name}</span>
        )}
        {admin && ticket.requester && (
          <span className="block h-[18px] min-w-0 truncate rounded-full leading-[16px] border border-border/70 bg-background/60 px-1.5 text-[10px] text-muted-foreground">{ticket.requester}</span>
        )}
      </span>
    </button>
    {/* A sibling of the row, not inside it: a button cannot hold a button. */}
    {onStar && (
      <button type="button" onClick={() => onStar(!ticket.starred)} aria-pressed={!!ticket.starred}
        aria-label={ticket.starred ? `Unstar ${ticket.reference}` : `Star ${ticket.reference}`}
        className={`absolute left-2 top-[10px] flex size-6 items-center justify-center rounded-full [transition:opacity_200ms_ease-out,background-color_200ms_ease-out] motion-reduce:transition-none hover:bg-primary/10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${ticket.starred ? 'text-amber-500 opacity-100' : 'text-muted-foreground opacity-0 hover:text-primary group-hover/row:opacity-100 group-focus-within/row:opacity-100'}`}>
        <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill={ticket.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>
      </button>
    )}
    </div>
  );
}

function UnreadCount({ count }: { count: number }) {
  return (
    <span data-testid="ticket-unread" aria-hidden
      className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10.5px] font-semibold leading-none tabular-nums text-primary-foreground">
      {count > 99 ? '99+' : count}
    </span>
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
function Avatar({ label, own, support }: { label: string; own: boolean; support: boolean }) {
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span aria-hidden className={`flex size-7 shrink-0 select-none items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold ${support ? 'bg-card text-primary shadow-[0_1px_2px_hsl(var(--foreground)/0.06)] ring-1 ring-foreground/[0.05]' : own ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
      {support ? <SupportAgentFace /> : initials}
    </span>
  );
}

/**
 * A chat bubble. Your side wears a soft wash of the app's gradient (the send
 * button's colours, kept light), the other side a white card. Bubbles in one turn join up: the corners facing the
 * avatar tighten between them, and the last one ends in a tail.
 */
function bubbleClass(own: boolean, first: boolean, tail: boolean) {
  const joined = own
    ? `${first ? '' : 'rounded-tr-[6px]'} ${tail ? 'rounded-br-none' : 'rounded-br-[6px]'}`
    : `${first ? '' : 'rounded-tl-[6px]'} ${tail ? 'rounded-bl-none' : 'rounded-bl-[6px]'}`;
  return `w-fit min-w-0 max-w-full overflow-hidden rounded-[18px] px-3.5 py-2 text-[13.5px] leading-relaxed ${joined} ${own
    ? 'bg-[linear-gradient(135deg,hsl(var(--chart-2)/0.14),hsl(var(--primary)/0.2))] text-foreground dark:bg-[linear-gradient(135deg,hsl(var(--chart-2)/0.28),hsl(var(--primary)/0.36))]'
    : 'bg-card text-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.06)] ring-1 ring-foreground/[0.05]'}`;
}

/** The tail under the last bubble of a turn, in the bubble's own colour. It sits
 *  flush beside the bubble, never over it, so a see-through wash never doubles up. */
function BubbleTail({ own }: { own: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 10 14" className={`pointer-events-none absolute bottom-0 h-3.5 w-2.5 ${own ? '-right-2.5 text-primary/20 dark:text-primary/[0.36]' : '-left-2.5 -scale-x-100 text-card'}`}>
      <path d="M0 0 C0 7 3 12 10 14 H0 Z" fill="currentColor" />
    </svg>
  );
}

/** The support team's avatar: a headset with its mic, in indigo on white — the same card as the other side's bubble. */
function SupportAgentFace() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" />
      <path d="M21 16v2a4 4 0 0 1-4 4h-5" />
    </svg>
  );
}

export interface TurnMessage { seq: number; body: string; created_at: string }
/**
 * One turn: the consecutive messages of a single author, as bubbles sized to
 * their content — a three-word reply is a small bubble, not a card.
 * `own` decides the side and the surface, so each app passes it from ITS viewer.
 */
export function MessageTurn({ own, author, messages, files, children, reactions, onReact, support = !own }: {
  own: boolean; author: string; messages: TurnMessage[];
  /** The support team wrote this turn: it gets the agent avatar. Defaults to the other side. */
  support?: boolean;
  files?: SupportAttachment[];
  children?: React.ReactNode;
  /** The thread's reactions; each bubble shows its own. */
  reactions?: SupportReaction[];
  /** Set, replace or clear (null) the viewer's reaction. Without it, reactions are read-only. */
  onReact?: (seq: number, emoji: string | null) => void;
}) {
  return (
    <div data-slot="message" data-align={own ? 'end' : 'start'} className={`flex w-full min-w-0 items-end gap-2.5 ${own ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar label={author} own={own} support={support} />
      <div className={`flex min-w-0 max-w-[85%] flex-col gap-0.5 ${own ? 'items-end' : 'items-start'}`}>
        {!own && <span data-slot="message-header" className="mb-0.5 px-1 text-[11px] font-medium text-muted-foreground">{author}</span>}
        {messages.map((message, i) => {
          const mine = reactions?.filter((reaction) => reaction.seq === message.seq) ?? [];
          const first = i === 0, tail = i === messages.length - 1;
          return (
          <div key={message.seq} className={`group/bubble flex min-w-0 max-w-full flex-col ${own ? 'items-end' : 'items-start'}`}>
            <div className={`flex min-w-0 max-w-full items-center gap-1 ${own ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className="relative min-w-0 max-w-full">
                <div data-slot="bubble" data-variant={own ? 'tinted' : 'muted'} className={bubbleClass(own, first, tail)}>
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {message.body}
                    {/* The time rides inside the bubble, on the last line when it fits. */}
                    <time dateTime={message.created_at}
                      className={`float-right ml-2.5 mt-1.5 translate-y-1 select-none text-[10px] leading-none tabular-nums text-muted-foreground`}>
                      {clockStamp(message.created_at)}
                    </time>
                  </p>
                  <MessageFiles files={(files ?? []).filter((file) => file.seq === message.seq)} />
                  <span data-seq={message.seq} aria-hidden className="block h-px" />
                </div>
                {tail && <BubbleTail own={own} />}
              </div>
              {onReact && !own && <ReactButton current={mine.find((reaction) => reaction.mine)?.emoji ?? null} own={own} onReact={(emoji) => onReact(message.seq, emoji)} />}
            </div>
            <ReactionChips reactions={mine} own={own} onReact={onReact && ((emoji) => onReact(message.seq, emoji))} />
          </div>
          );
        })}
        {children}
      </div>
    </div>
  );
}

/**
 * The reaction control beside a bubble: a small smiley that appears on hover (and
 * stays on touch screens), opening the five reactions in a row. Picking the one
 * already chosen takes it back.
 */
function ReactButton({ current, own, onReact }: { current: string | null; own: boolean; onReact: (emoji: string | null) => void }) {
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" aria-label="React to this message" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={`flex size-7 items-center justify-center rounded-full text-muted-foreground transition-opacity duration-200 hover:bg-primary/10 hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 [@media(hover:none)]:opacity-60 ${open ? 'bg-primary/10 text-primary opacity-100' : 'opacity-0 group-hover/bubble:opacity-100'}`}>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Reactions"
          className={`absolute bottom-full z-20 mb-1 flex items-center gap-0.5 rounded-full border border-border/70 bg-card p-1 shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200 ${own ? 'right-0' : 'left-0'}`}>
          {SUPPORT_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" role="menuitemradio" aria-checked={current === emoji} aria-label={`React ${emoji}`}
              onClick={() => { onReact(current === emoji ? null : emoji); setOpen(false); }}
              className={`flex size-8 items-center justify-center rounded-full text-[17px] transition-transform duration-200 hover:scale-110 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${current === emoji ? 'bg-primary/15' : ''}`}>
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Under a bubble: each emoji once, with how many reacted. Only the viewer's own
 *  is tappable (tinted; tapping takes it back) — the other side's reaction is
 *  theirs alone, shown but never touched. The server enforces the same rule. */
function ReactionChips({ reactions, own, onReact }: { reactions: SupportReaction[]; own: boolean; onReact?: (emoji: string | null) => void }) {
  if (!reactions.length) return null;
  const groups = SUPPORT_REACTIONS.map((emoji) => ({ emoji, list: reactions.filter((reaction) => reaction.emoji === emoji) })).filter((group) => group.list.length);
  return (
    <div className={`-mt-1.5 flex flex-wrap gap-1 px-2 ${own ? 'justify-end' : 'justify-start'}`}>
      {groups.map(({ emoji, list }) => {
        const mineHere = list.some((reaction) => reaction.mine);
        return (
          <button key={emoji} type="button" disabled={!onReact || !mineHere} onClick={() => { if (mineHere) onReact?.(null); }}
            aria-label={`${emoji} ${list.length}${mineHere ? ', yours — remove' : ''}`}
            className={`relative inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-[12px] leading-none shadow-sm transition-colors duration-200 disabled:cursor-default ${mineHere ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15' : 'border-border/70 bg-card text-muted-foreground'}`}>
            <span className="text-[13px]">{emoji}</span>
            {list.length > 1 && <span className="tabular-nums">{list.length}</span>}
          </button>
        );
      })}
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
            ? <a href={file.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border border-border/70"><img src={file.url} alt={file.name} loading="lazy" className="max-h-44 max-w-[220px] object-cover" /></a>
            /* A document: the same tile the composer shows before sending. */
            : <a href={file.url ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={file.url ? undefined : true}
                className={`block rounded-xl transition-opacity ${file.url ? 'hover:opacity-80' : 'pointer-events-none opacity-60'}`}>
                <FileTile name={file.name} size={file.size} />
              </a>}
        </li>
      ))}
    </ul>
  );
}

/** Chosen, not sent. A file that fails the limits says so before any upload. */
export function PendingFiles({ files, busy, onRemove }: { files: PendingAttachment[]; busy: boolean; onRemove: (key: string) => void }) {
  /* Newest first, so what was just added is the tile you see; scrolled back to
     the start whenever one arrives. Display order only — they upload as added. */
  const shown = React.useMemo(() => [...files].reverse(), [files]);
  const row = React.useRef<HTMLUListElement>(null);
  const count = files.length;
  const previous = React.useRef(count);
  React.useLayoutEffect(() => {
    if (count > previous.current && row.current) row.current.scrollLeft = 0;
    previous.current = count;
  }, [count]);
  if (!files.length) return null;
  return (
    /* One row that scrolls sideways, never a pile: the padding keeps each tile's
       corner × inside the scroll area, which would otherwise clip it. No scroll
       anchoring: a tile added at the start must push the others right, not be
       kept out of view to the left. */
    <ul ref={row} className="no-scrollbar mb-2 flex items-end gap-2 overflow-x-auto overscroll-x-contain pr-1.5 pt-1.5 [overflow-anchor:none]">
      {shown.map((file) => !file.error ? (
        /* Every good file is a tile with its remove button on the corner: an
           image shows itself, a document shows its type and name. */
        <li key={file.key} className="group/thumb relative shrink-0">
          {file.mime.startsWith('image/')
            ? <ImageThumb file={file.file} name={file.name} size={file.size} />
            : <FileTile name={file.name} size={file.size} />}
          <button type="button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => onRemove(file.key)}
            className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-foreground/80 text-[12px] leading-none text-background shadow-sm transition-colors hover:bg-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">×</button>
        </li>
      ) : (
        <li key={file.key} className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${file.error ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-muted/50'}`}>
          <span className="max-w-[200px] truncate">{file.name}</span>
          <span className={file.error ? '' : 'text-muted-foreground'}>{file.error ?? readableSize(file.size)}</span>
          <button type="button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => onRemove(file.key)} className="rounded px-1 text-muted-foreground hover:text-foreground">×</button>
        </li>
      ))}
    </ul>
  );
}

/** A document: the same 64px-tall tile as an image preview, but wide enough to
 *  carry its name — two PDFs must never look alike — then its type and size. */
function FileTile({ name, size }: { name: string; size: number }) {
  const ext = (name.includes('.') ? name.split('.').pop() ?? '' : '').slice(0, 4).toUpperCase() || 'FILE';
  return (
    <span title={`${name} · ${readableSize(size)}`} className="flex h-16 w-[184px] items-center gap-2.5 overflow-hidden rounded-xl border border-border/70 bg-muted/50 px-3 text-left">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-[18px]"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" strokeLinejoin="round" /><path d="M14 3v5h5" strokeLinejoin="round" /></svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium leading-tight text-foreground">{name}</span>
        <span className="mt-0.5 block text-[10.5px] leading-tight text-muted-foreground">{ext} · {readableSize(size)}</span>
      </span>
    </span>
  );
}

/** A local preview of a picked or pasted image. The object URL is the browser's
 *  own copy of the file — nothing is uploaded — and is released on unmount. */
function ImageThumb({ file, name, size }: { file: File; name: string; size: number }) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let next: string | null = null;
    try { next = URL.createObjectURL(file); } catch { /* not a real file (or no URL API): the tile stays plain */ }
    setUrl(next);
    return () => { if (next) URL.revokeObjectURL(next); };
  }, [file]);
  return (
    <span title={`${name} · ${readableSize(size)}`} className="block size-16 overflow-hidden rounded-xl border border-border/70 bg-muted/50">
      {url && <img src={url} alt="" className="size-full object-cover" />}
      <span className="sr-only">{name}, {readableSize(size)}</span>
    </span>
  );
}

/** The five emojis, beside the paperclip: one tap puts one in the message. */
function EmojiButton({ disabled, onPick }: { disabled: boolean; onPick: (emoji: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" aria-label="Add an emoji" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}
        className={`flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${open ? 'bg-background text-foreground' : ''}`}>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Emojis"
          className="absolute bottom-full left-0 z-20 mb-2.5 flex items-center gap-0.5 rounded-full border border-border/70 bg-card p-1 shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200">
          {SUPPORT_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" role="menuitem" aria-label={`Add ${emoji}`}
              onClick={() => { onPick(emoji); setOpen(false); }}
              className="flex size-8 items-center justify-center rounded-full text-[17px] transition-transform duration-200 hover:scale-110 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
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
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4" aria-hidden><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 1 1 5 5l-8 8a2 2 0 1 1-3-3l7.5-7.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </>
  );
}

/**
 * The composer, anchored at the bottom of the conversation. Shift+Enter sends a reply;
 * Enter is a new line. Drafts, the sending state and the retry all come
 * from the inbox state, so a failed send keeps what was typed.
 */
export function Composer({ inbox, placeholder, label, children, blend = false, onTab, tools, ghost }: { inbox: SupportInboxState; placeholder: string; label: string; children?: React.ReactNode;
  /** More tools beside attach and emoji (the platform inbox's Email the tenant). */
  tools?: React.ReactNode;
  /** Tab in an empty box: true when it filled the box (TRAX's suggested reply). */
  onTab?: () => boolean;
  /** TRAX's suggested reply, typed as grey text into the empty box (platform inbox). */
  ghost?: { text: string | null; drafting: boolean };
  /** The Trax panel: no band or rule — the same floating white card and round
   *  send arrow as the Trax composer, so both tabs type the same way. */
  blend?: boolean }) {
  const { busy, retrying, notice, canSend } = inbox;
  const sendable = !busy && canSend;
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const ghostText = useTypedOnce(ghost?.text ?? '');
  const ghostOn = !blend && !!ghost && !inbox.draft && !busy && !retrying && (!!ghost.text || ghost.drafting);
  /* The box follows its text both ways: it grows as you type, and shrinks back to
     one line when the draft is sent or cleared (the sent message used to leave it
     tall, the placeholder floating at the top). */
  React.useLayoutEffect(() => {
    const el = textRef.current; if (!el) return;
    /* While TRAX's ghost fills the empty box, the shared grid cell sizes it. */
    if (ghostOn) { el.style.height = ''; return; }
    el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, blend ? 160 : 240)}px`;
  }, [inbox.draft, ghostOn, blend]);
  /* A short line inside the box when a paste goes past the per-message limit. */
  const [limitHit, setLimitHit] = React.useState(false);
  const limitTimer = React.useRef<number | null>(null);
  const showLimit = React.useCallback(() => {
    setLimitHit(true);
    if (limitTimer.current) window.clearTimeout(limitTimer.current);
    limitTimer.current = window.setTimeout(() => setLimitHit(false), 4000);
  }, []);
  React.useEffect(() => () => { if (limitTimer.current) window.clearTimeout(limitTimer.current); }, []);
  return (
    <form className={blend ? 'shrink-0 px-3.5 pb-3.5 pt-1' : 'shrink-0 bg-background px-3 pb-3 pt-1 sm:px-4'} onSubmit={(e) => { e.preventDefault(); void inbox.send(); }}>
      {children}
      {/* The box holds its attachments: the tiles sit inside it, above the line
          you type on, the way the Trax composer holds its files. */}
      <div className={blend
        ? 'rounded-3xl bg-card p-1.5 shadow-[0_10px_36px_-14px_hsl(var(--primary)/0.35)] focus-within:ring-1 focus-within:ring-primary/20'
        : 'rounded-xl border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20'}>
        <div className="px-1.5 [&>ul]:mb-1">
          <PendingFiles files={inbox.attachments ?? []} busy={busy} onRemove={inbox.removeAttachment} />
          {limitHit && (
            <p role="status" className="mb-1 px-0.5 text-[11.5px] text-muted-foreground">
              Up to {ATTACHMENT_MAX_FILES} files per message. Remove one to add another.
            </p>
          )}
        </div>
        {blend ? (
        <div className="flex items-end gap-1">
        {/* Attach and emoji: one small group, two tools that add to the message. */}
        <div className="mb-0.5 flex shrink-0 items-center rounded-full bg-muted/60 p-0.5">
        <AttachButton inbox={inbox} />
        <EmojiButton disabled={busy || retrying} onPick={(emoji) => {
          // In at the caret (or over a selection), then the caret just after it.
          const el = textRef.current;
          const start = el?.selectionStart ?? inbox.draft.length, end = el?.selectionEnd ?? start;
          const next = (inbox.draft.slice(0, start) + emoji + inbox.draft.slice(end)).slice(0, 4000);
          inbox.setDraft(next);
          requestAnimationFrame(() => { if (!el) return; el.focus(); const at = Math.min(start + emoji.length, next.length); el.setSelectionRange(at, at); });
        }} />
        {tools}
        </div>
        <label htmlFor="support-message" className="sr-only">{label}</label>
        <textarea ref={textRef} id="support-message" value={inbox.draft} maxLength={4000} readOnly={busy || retrying} rows={1} placeholder={ghostOn ? '' : placeholder}
          /* Shift + Enter sends; Enter on its own is a new line. */
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey && onTab && !inbox.draft.trim()) { if (onTab()) e.preventDefault(); return; }
            if (e.key !== 'Enter' || !e.shiftKey || e.nativeEvent.isComposing) return; e.preventDefault(); void inbox.send(); }}
          aria-keyshortcuts="Shift+Enter"
          /* A copied screenshot or file pastes straight in as an attachment (the
             same checks as the paperclip); plain text pastes as text as usual. */
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (!files.length || busy || retrying) return;
            const room = ATTACHMENT_MAX_FILES - (inbox.attachments?.length ?? 0);
            // At the limit: say so, rather than drop the paste without a word.
            if (!inbox.canAttach || files.length > room) {
              if (room <= 0) e.preventDefault();
              showLimit();
              if (room <= 0 || !inbox.canAttach) return;
            }
            e.preventDefault();
            inbox.addAttachments(files);
          }}
          onChange={(e) => inbox.setDraft(e.target.value)}
          className={blend
            ? 'max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/70'
            : 'relative block h-full max-h-60 min-h-[84px] w-full resize-none [grid-area:1/1] bg-transparent px-2.5 pb-1 pt-2 text-[13.5px] leading-[22px] outline-none placeholder:text-muted-foreground/70'} />
        {blend ? (
          <>
          <span className="relative mb-0.5 shrink-0">
            <button type="submit" disabled={!sendable} aria-label={busy ? 'Sending' : retrying ? 'Retry send' : 'Send'}
              className={`flex size-8 shrink-0 items-center justify-center rounded-full transition-[filter,background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sendable
                ? 'bg-[linear-gradient(135deg,hsl(var(--chart-2)),hsl(var(--primary)))] text-primary-foreground shadow-[0_4px_12px_-4px_hsl(var(--primary)/0.6)] hover:brightness-110'
                : 'bg-muted text-muted-foreground'}`}>
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4"><path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </span>
          </>
        ) : (
          <button type="submit" disabled={busy || !canSend}
            className="mb-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            {busy ? 'Sending…' : retrying ? 'Retry send' : 'Send'}
          </button>
        )}
        </div>
        ) : (
        /* The reply box: a roomy text area on top (TRAX's suggestion is typed into
           it as grey text while it is empty — Tab takes it), the tools and Send
           underneath, the way the Messages composer is laid out. */
        <>
        {/* Ghost and text area share one grid cell: a long suggestion grows the
            box instead of being cut off. */}
        <div className="grid">
          {ghostOn && <GhostReply text={ghostText} drafting={!!ghost?.drafting && !ghost?.text} />}
        <label htmlFor="support-message" className="sr-only">{label}</label>
        <textarea ref={textRef} id="support-message" value={inbox.draft} maxLength={4000} readOnly={busy || retrying} rows={1} placeholder={ghostOn ? '' : placeholder}
          /* Shift + Enter sends; Enter on its own is a new line. */
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey && onTab && !inbox.draft.trim()) { if (onTab()) e.preventDefault(); return; }
            if (e.key !== 'Enter' || !e.shiftKey || e.nativeEvent.isComposing) return; e.preventDefault(); void inbox.send(); }}
          aria-keyshortcuts="Shift+Enter"
          /* A copied screenshot or file pastes straight in as an attachment (the
             same checks as the paperclip); plain text pastes as text as usual. */
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (!files.length || busy || retrying) return;
            const room = ATTACHMENT_MAX_FILES - (inbox.attachments?.length ?? 0);
            // At the limit: say so, rather than drop the paste without a word.
            if (!inbox.canAttach || files.length > room) {
              if (room <= 0) e.preventDefault();
              showLimit();
              if (room <= 0 || !inbox.canAttach) return;
            }
            e.preventDefault();
            inbox.addAttachments(files);
          }}
          onChange={(e) => inbox.setDraft(e.target.value)}
          className={blend
            ? 'max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/70'
            : 'relative block h-full max-h-60 min-h-[84px] w-full resize-none [grid-area:1/1] bg-transparent px-2.5 pb-1 pt-2 text-[13.5px] leading-[22px] outline-none placeholder:text-muted-foreground/70'} />
        </div>
        <div className="flex items-center justify-between gap-2 px-0.5 pt-1">
        {/* Attach and emoji: one small group, two tools that add to the message. */}
        <div className="mb-0.5 flex shrink-0 items-center rounded-full bg-muted/60 p-0.5">
        <AttachButton inbox={inbox} />
        <EmojiButton disabled={busy || retrying} onPick={(emoji) => {
          // In at the caret (or over a selection), then the caret just after it.
          const el = textRef.current;
          const start = el?.selectionStart ?? inbox.draft.length, end = el?.selectionEnd ?? start;
          const next = (inbox.draft.slice(0, start) + emoji + inbox.draft.slice(end)).slice(0, 4000);
          inbox.setDraft(next);
          requestAnimationFrame(() => { if (!el) return; el.focus(); const at = Math.min(start + emoji.length, next.length); el.setSelectionRange(at, at); });
        }} />
        {tools}
        </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-muted-foreground sm:inline">Shift + Enter to send</span>
            <button type="submit" disabled={busy || !canSend}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              {busy ? 'Sending…' : retrying ? 'Retry send' : 'Send'}
            </button>
          </div>
        </div>
        </>
        )}
      </div>
      {/* Blended: nothing under the box — no hint, no "Sending…" or "Message sent."
          The message appearing in the thread says it; screen readers still hear it. */}
      <p role="status" className={blend || !notice || busy ? 'sr-only' : 'mt-1 flex h-4 items-center gap-1 px-1 text-[11px] text-muted-foreground'}>
        {busy ? 'Sending…' : notice}
      </p>
    </form>
  );
}

/**
 * TRAX's suggestion, typed ONCE into the empty reply box (no cycling through
 * alternatives), then held with a Tab keycap until the agent takes it or types.
 * Laid over the textarea with its exact padding and type, so the letters sit
 * where typed ones would; never takes a click.
 */
function useTypedOnce(text: string) {
  const [shown, setShown] = React.useState('');
  React.useEffect(() => {
    if (!text) { setShown(''); return; }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(text); return; }
    let n = 0; setShown('');
    const timer = window.setInterval(() => { n += 2; setShown(text.slice(0, n)); if (n >= text.length) window.clearInterval(timer); }, 18);
    return () => window.clearInterval(timer);
  }, [text]);
  return { shown, done: !!text && shown.length >= text.length };
}

function GhostReply({ text, drafting }: { text: { shown: string; done: boolean }; drafting: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none max-h-60 min-h-[84px] overflow-hidden px-2.5 pb-1 pt-2 text-[13.5px] leading-[22px] [grid-area:1/1]">
      {drafting ? (
        <span className="animate-pulse text-muted-foreground/60 motion-reduce:animate-none">TRAX is writing a reply…</span>
      ) : (
        <>
          <span className="whitespace-pre-wrap break-words text-muted-foreground/70">{text.shown}</span>
          {text.done ? (
            <kbd className="ml-2 inline-flex h-[18px] -translate-y-px items-center gap-1 rounded-[5px] border border-b-2 border-border bg-card px-1.5 align-middle text-[10px] font-semibold leading-none text-muted-foreground animate-in fade-in duration-200 motion-reduce:animate-none">
              Tab
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="size-2.5"><path d="M3 12h13M11 7l5 5-5 5M20 5v14" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </kbd>
          ) : (
            <span className="ml-0.5 inline-block h-[1.05em] w-px translate-y-[3px] animate-pulse bg-primary/60 motion-reduce:animate-none" />
          )}
        </>
      )}
    </div>
  );
}

/* Hover, focus and selection in the Support lists use the portal sidebar's highlight
   (ui-v2/sidebar.tsx SIDEBAR_HIGHLIGHT_*): bg-primary/10 with primary text. */

/**
 * The ticket list — search, a status filter and the rows — wherever the app puts
 * it: the Support rail in the sidebar's slot on a desktop, or the page itself on a
 * phone or when the rail is collapsed. One component, so both behave the same.
 */
/**
 * How an app draws Support's loading and empty states. The portal passes its
 * AutoSkeleton (the real rows, fed placeholders, measured into bones) and its
 * illustrations; without them the states fall back to a quiet line of text.
 */
export interface SupportStates {
  Skeleton?: React.ComponentType<{ loading: boolean; children: React.ReactNode; className?: string; outerClassName?: string }>;
  /** No tickets at all, and no ticket picked. */
  emptyArt?: React.ReactNode;
  /** A search or filter that matched nothing. */
  noMatchArt?: React.ReactNode;
  /** Placeholder tickets the skeleton draws the real rows from. */
  placeholders?: (HumanTicket & { preview?: string })[];
  /** Placeholder messages for the conversation's skeleton, alternating sides. */
  placeholderMessages?: TurnMessage[];
  /** Keep showing the skeleton (the portal's developer "Hold skeletons" switch). */
  hold?: boolean;
}

/** A centred illustration, one line saying what is going on, and what to do next. */
export function SupportEmpty({ art, title, body, action }: { art?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div data-testid="support-empty" className="flex flex-col items-center px-6 py-8 text-center">
      {art && <div className="w-full max-w-[220px]">{art}</div>}
      <p className={`${art ? 'mt-3' : ''} text-[13px] font-medium text-foreground`}>{title}</p>
      {body && <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function TicketList({ inbox, admin = false, onChosen, className = '', searchable = true, numberOnly = false, states }: {
  inbox: SupportInboxState; admin?: boolean;
  /** The app's skeleton and illustrations (see SupportStates). */
  states?: SupportStates;
  /** After a row is chosen: a phone closes the sheet the list sits in. */
  onChosen?: () => void;
  className?: string;
  /** False in the Trax panel: tickets are found through the portal's global search. */
  searchable?: boolean;
  /** The Trax panel: rows show the ticket number, not the subject. */
  numberOnly?: boolean;
}) {
  const { id, tickets, next, search, filter, busy, loading } = inbox;
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const closeFilters = React.useCallback(() => setFiltersOpen(false), []);
  const applied = admin ? activeFilterCount(inbox.filters) : 0;
  return (
    <section aria-label="Support tickets" data-testid="support-ticket-list" className={`flex min-h-0 min-w-0 flex-1 flex-col ${className}`}>
      {/* One search; the platform queue adds the Filter button, whose panel drops
          underneath (support-filters.tsx). Each row carries its status pill. */}
      {searchable && (
        <div className="flex shrink-0 flex-col px-2 pb-2">
          <div className="flex items-center gap-1.5">
          <SearchField value={search} onChange={inbox.setSearch} placeholder={admin ? 'Search tickets or companies' : 'Search tickets'}
            trailing={admin ? <FilterButton open={filtersOpen} count={applied} onClick={() => setFiltersOpen((o) => !o)} /> : undefined} />
          {/* Platform support writes first, too: a ticket opened for a tenant user. */}
          {admin && (
            <button type="button" onClick={inbox.beginNew} disabled={busy} aria-label="New ticket" title="New ticket"
              className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full border text-primary outline-none transition-colors duration-200 ease-out motion-reduce:transition-none hover:border-primary/40 hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50 ${inbox.creating ? 'border-primary/50 bg-primary/15' : 'border-primary/25 bg-primary/[0.07]'}`}>
              <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          </div>
          {admin && <FilterPanel inbox={inbox} open={filtersOpen} onClose={closeFilters} />}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {(states?.hold || (!tickets.length && loading)) && states?.Skeleton && states.placeholders ? (
          /* The real rows, fed placeholders: the skeleton is the list's own shape. */
          <states.Skeleton loading>
            <ul className="flex flex-col gap-1">
              {states.placeholders.map((ticket) => (
                <li key={ticket.id}><TicketRow ticket={ticket} selected={false} onSelect={() => {}} admin={admin} numberOnly={numberOnly} /></li>
              ))}
            </ul>
          </states.Skeleton>
        ) : !tickets.length && loading ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">Loading tickets…</p>
        ) : !tickets.length && (search || filter || applied) ? (
          <SupportEmpty art={states?.noMatchArt} title="No tickets match that." body={admin ? 'Try another search, or clear a filter.' : 'Try another ticket number or a word from the conversation.'} />
        ) : !tickets.length ? (
          <SupportEmpty art={states?.emptyArt} title={admin ? 'No tickets in the queue.' : 'No tickets yet.'}
            body={admin ? 'When a tenant asks for help, their ticket lands here.' : 'When something needs a person, start a ticket and I will pass it to the Drive247 support team.'}
            action={admin ? undefined : (
              <button type="button" onClick={inbox.beginNew} disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-3.5"><path d="M12 5v14M5 12h14" /></svg>
                New ticket
              </button>
            )} />
        ) : (
          <ul className="flex flex-col gap-1">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <TicketRow ticket={ticket} selected={id === ticket.id} disabled={busy}
                  onSelect={() => { inbox.choose(ticket.id); onChosen?.(); }}
                  admin={admin} numberOnly={numberOnly} onStar={admin ? (starred) => void inbox.toggleStar(ticket.id, starred) : undefined} />
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
