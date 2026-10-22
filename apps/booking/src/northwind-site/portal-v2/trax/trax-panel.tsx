'use client';

/**
 * The customer's Trax panel — the operator's floating Trax panel
 * (apps/portal components/trax/trax-panel.tsx) on the customer palette:
 * portalled to <body>, pinned bottom-right on a desktop and full screen on a
 * phone, the page left live underneath (no scrim, no focus trap), an Expand
 * size with a light scrim, Escape stepping back one size at a time.
 *
 * The header carries only the chat: the operator's panel switches between
 * Trax and Support; a customer's has no Support tab (owner, Oct 21 2026 —
 * "only the chat"). Its controls are New conversation, Expand and Close.
 *
 * The thread is the operator's TraxSupportThread shape: the mark and a
 * greeting centred over the composer while empty, with starter questions
 * beneath; then a scrolling conversation with the composer pinned. Answers
 * are short markdown, drawn by a small renderer below (paragraphs, bold,
 * lists) — never as HTML.
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, CalendarClock, CreditCard, IdCard, Loader2, Sparkles, SquarePen, User, X } from 'lucide-react-nw';

import { useCustomer } from '@nw/hooks/use-customer';
import { cn } from '@nw/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@portal-v2-shared/tooltip';

import { useCustomerTrax, type TraxMessage } from './trax-context';

/* ──────────────────────────────── the mark ─────────────────────────────── */

const MARK_SIZES = {
  xs: { box: 'size-5', icon: 'size-3', halo: '-inset-2', lift: 'shadow-[0_2px_6px_-2px_hsl(var(--v2-primary)/0.5)]' },
  sm: { box: 'size-7', icon: 'size-3.5', halo: '-inset-3', lift: 'shadow-[0_4px_14px_-4px_hsl(var(--v2-primary)/0.55)]' },
  md: { box: 'size-10', icon: 'size-5', halo: '-inset-5', lift: 'shadow-[0_4px_14px_-4px_hsl(var(--v2-primary)/0.55)]' },
} as const;

/** The operator's TraxMark: an iridescent conic fill that turns, a halo that breathes. */
export function TraxMark({ size = 'sm', animated = false, className }: { size?: keyof typeof MARK_SIZES; animated?: boolean; className?: string }) {
  const s = MARK_SIZES[size];
  return (
    <span aria-hidden className={cn('relative isolate inline-flex shrink-0 items-center justify-center rounded-full', s.box, className)}>
      {animated ? (
        <span
          className={cn(
            'pointer-events-none absolute -z-10 rounded-full opacity-60 blur-xl',
            'bg-[radial-gradient(closest-side,hsl(var(--v2-chart-2)/0.6),hsl(var(--v2-primary)/0.25)_60%,transparent)]',
            'animate-[v2-glow_4s_ease-in-out_infinite] motion-reduce:animate-none',
            s.halo,
          )}
        />
      ) : null}
      <span className={cn('absolute inset-0 overflow-hidden rounded-full', s.lift)}>
        <span
          className={cn(
            'absolute -inset-1/4',
            'bg-[conic-gradient(from_180deg,hsl(var(--v2-chart-2)),hsl(var(--v2-primary)),hsl(var(--v2-chart-4)),hsl(var(--v2-chart-1)),hsl(var(--v2-chart-2)))]',
            'dark:bg-[conic-gradient(from_180deg,hsl(var(--v2-chart-2)),hsl(var(--v2-chart-3)),hsl(var(--v2-chart-1)),hsl(var(--v2-chart-4)),hsl(var(--v2-chart-2)))]',
            animated && 'animate-[v2-spin-slow_12s_linear_infinite] motion-reduce:animate-none',
          )}
        />
      </span>
      <Sparkles strokeWidth={2} className={cn('relative text-pv-primary-fg drop-shadow-[0_1px_2px_hsl(var(--v2-chart-5)/0.55)]', s.icon)} />
    </span>
  );
}

/* ─────────────────────────────── markdown ──────────────────────────────── */

/** `**bold**` inside a line, as text nodes and <strong> — nothing else. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={index} className="font-semibold text-pv-fg">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

/** Paragraphs, and bulleted or numbered lists; headings read as bold lines. */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(
        <p key={blocks.length} className="mb-2 last:mb-0">
          {paragraph.map((line, index) => (
            <Fragment key={index}>
              {index > 0 ? <br /> : null}
              {inline(line)}
            </Fragment>
          ))}
        </p>,
      );
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={blocks.length} className={cn('mb-2 ml-4 space-y-1 last:mb-0', list.ordered ? 'list-decimal' : 'list-disc')}>
          {list.items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </Tag>,
      );
      list = null;
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
    } else if (/^\s*$/.test(line)) {
      flushParagraph();
      flushList();
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // A continuation line indented under a list item.
      list.items[list.items.length - 1] += ` — ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line.replace(/^#{1,6}\s+/, ''));
    }
  }
  flushParagraph();
  flushList();
  return <div className="break-words">{blocks}</div>;
}

/* ─────────────────────────────── the thread ────────────────────────────── */

function greeting(hour: number) {
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

const SUGGESTIONS = [
  { icon: CalendarClock, label: 'My next rental', prompt: 'When is my next rental, and what do I need to do before pickup?' },
  { icon: CreditCard, label: 'What I owe', prompt: 'Do I owe anything right now? Show me what is due and when.' },
  { icon: IdCard, label: 'My documents and ID', prompt: 'Is my ID verified, and are my agreements and insurance in order?' },
];

function Message({ message, photo, initials }: { message: TraxMessage; photo: string | null; initials: string | null }) {
  const user = message.role === 'user';
  return (
    <div className={cn('flex gap-3 py-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200', user ? 'flex-row-reverse' : 'flex-row')}>
      {user ? (
        photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" className="size-7 shrink-0 rounded-full object-cover shadow-sm" />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-pv-primary/10 text-[11px] font-semibold text-pv-primary">
            {initials ?? <User className="size-3.5" />}
          </span>
        )
      ) : (
        <TraxMark size="sm" />
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-3.5 py-2.5 text-[14px] leading-relaxed',
          user ? 'rounded-tr-sm bg-pv-primary text-pv-primary-fg' : 'rounded-tl-sm border border-pv-border/60 bg-pv-card/70 text-pv-fg',
        )}
      >
        {user ? <div className="whitespace-pre-wrap break-words">{message.content}</div> : <Markdown text={message.content} />}
      </div>
    </div>
  );
}

function Composer({ busy, autoFocus, onSend }: { busy: boolean; autoFocus: boolean; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // Grow with the text, up to the cap.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [draft]);

  const canSend = draft.trim().length > 0 && !busy;
  const submit = () => {
    if (!canSend) return;
    onSend(draft);
    setDraft('');
  };

  return (
    <div className="group/composer relative w-full">
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-1 rounded-[1.75rem] bg-[linear-gradient(135deg,hsl(var(--v2-chart-2)/0.5),hsl(var(--v2-primary)/0.3),hsl(var(--v2-chart-4)/0.45))] opacity-0 blur-xl transition-opacity duration-500 group-focus-within/composer:opacity-70 motion-reduce:transition-none"
      />
      <div className="relative rounded-[calc(1.5rem+1.5px)] p-[1.5px]">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(135deg,hsl(var(--v2-chart-2)),hsl(var(--v2-primary)),hsl(var(--v2-chart-4)))] opacity-0 transition-opacity duration-300 group-focus-within/composer:opacity-100 motion-reduce:transition-none"
        />
        <div className="relative rounded-3xl bg-pv-card shadow-[0_10px_36px_-14px_hsl(var(--v2-primary)/0.35)]">
          <textarea
            ref={ref}
            value={draft}
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about your rentals, payments or documents…"
            aria-label="Ask Trax"
            className="block max-h-60 min-h-10 w-full resize-none overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-transparent px-4 pt-3 pb-1 text-[14px] leading-6 text-pv-fg outline-none placeholder:text-pv-muted-fg"
          />
          <div className="flex items-center gap-2 px-2.5 pt-1 pb-2.5">
            <span className="pl-1.5 text-[11px] text-pv-muted-fg">Reads your own account only</span>
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label={busy ? 'Trax is replying' : 'Send'}
              className={cn(
                'ml-auto flex size-8 shrink-0 items-center justify-center rounded-full transition-[filter,background-color,color,box-shadow]',
                'focus-visible:ring-2 focus-visible:ring-pv-ring focus-visible:ring-offset-2 focus-visible:outline-none',
                canSend
                  ? 'bg-[linear-gradient(135deg,hsl(var(--v2-chart-2)),hsl(var(--v2-primary)))] text-pv-primary-fg shadow-[0_4px_12px_-4px_hsl(var(--v2-primary)/0.6)] hover:brightness-110'
                  : 'bg-pv-muted text-pv-muted-fg',
              )}
            >
              {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowUp className="size-4" strokeWidth={2.25} aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Thread({ autoFocus }: { autoFocus: boolean }) {
  const { messages, isLoading, error, send } = useCustomerTrax();
  const { displayName, customer, initials } = useCustomer();
  const endRef = useRef<HTMLDivElement>(null);
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);
  const empty = messages.length === 0;
  const firstName = displayName?.split(/\s+/)[0] ?? '';

  useEffect(() => {
    if (empty) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' });
  }, [messages.length, isLoading, empty]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('flex min-h-0 flex-1 flex-col', empty && 'overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden')}>
        {empty ? (
          <div className="flex flex-[1_0_auto] flex-col items-center justify-end px-4 pt-10">
            <div className="relative isolate flex w-full flex-col items-center gap-3 text-center">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -inset-y-10 -z-10 bg-[radial-gradient(closest-side,hsl(var(--v2-chart-2)/0.16),hsl(var(--v2-primary)/0.06)_55%,transparent)] dark:bg-[radial-gradient(closest-side,hsl(var(--v2-chart-2)/0.14),transparent)]"
              />
              <TraxMark size="md" animated />
              <h2 className="text-xl leading-tight font-medium tracking-tight text-balance text-pv-fg">
                {greeting(hour ?? 8)}
                {firstName ? `, ${firstName}` : ''}
              </h2>
            </div>
            <p className="mt-2 text-center text-[12px] leading-relaxed text-pv-muted-fg">
              Ask about your rentals, payments, agreements and documents. Trax checks your own account before it answers.
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]">
            <div className="flex w-full min-w-0 flex-col gap-1 px-3.5 py-4">
              {messages.map((message) => (
                <Message key={message.id} message={message} photo={customer?.profile_photo_url ?? null} initials={initials ?? null} />
              ))}
              {isLoading ? (
                <p role="status" className="py-2 pl-10 text-[13px] font-medium text-pv-muted-fg">
                  Checking your account…
                </p>
              ) : null}
              <div ref={endRef} />
            </div>
          </div>
        )}

        <div className={cn('relative shrink-0 px-3.5', empty ? 'pt-6' : 'pt-1 pb-4')}>
          <Composer busy={isLoading} autoFocus={autoFocus} onSend={(text) => void send(text)} />
        </div>

        {empty ? (
          <div className="flex flex-[1_0_auto] justify-center px-3.5 pt-4 pb-8">
            <div className="flex h-fit w-full flex-col items-stretch gap-1">
              {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
                <button
                  key={label}
                  type="button"
                  disabled={isLoading}
                  onClick={() => void send(prompt)}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-pv-border/40 bg-pv-card/40 px-3 py-2.5 text-left text-[13px] text-pv-muted-fg transition-colors duration-200 hover:bg-pv-primary/10 hover:text-pv-primary focus-visible:ring-2 focus-visible:ring-pv-ring focus-visible:outline-none disabled:opacity-50"
                >
                  <Icon className="size-3.5 shrink-0 text-pv-primary" aria-hidden />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mx-3.5 mb-3 rounded-lg bg-pv-danger-light p-3 text-[13px] text-pv-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────── the panel ────────────────────────────── */

function PanelAction({ label, icon, onClick, active = false, disabled = false }: { label: string; icon: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-full text-pv-muted-fg transition-colors duration-200 hover:bg-pv-primary/10 hover:text-pv-primary',
            'focus-visible:ring-2 focus-visible:ring-pv-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4',
            active && 'bg-pv-primary/10 text-pv-primary',
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function CustomerTraxPanel() {
  const { open, setOpen, messages, isLoading, startNew } = useCustomerTrax();
  const [hasOpened, setHasOpened] = useState(false);
  if (open && !hasOpened) setHasOpened(true);
  const [expanded, setExpanded] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

  // The composer stays above a phone's keyboard.
  const [visualHeight, setVisualHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const read = () => setVisualHeight(viewport.height);
    read();
    viewport.addEventListener('resize', read);
    return () => viewport.removeEventListener('resize', read);
  }, []);

  // Focus goes back where it was when the panel closes with focus inside it.
  const asideRef = useRef<HTMLElement>(null);
  const lastOutside = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && !asideRef.current?.contains(target)) lastOutside.current = target;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (asideRef.current?.contains(document.activeElement) && lastOutside.current?.isConnected) {
      lastOutside.current.focus({ preventScroll: true });
    }
  }, [open]);

  if (!host) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (expanded) setExpanded(false);
    else setOpen(false);
  };

  return createPortal(
    <>
      {open && expanded ? (
        <div aria-hidden onClick={() => setExpanded(false)} className="fixed inset-0 z-40 hidden bg-pv-fg/10 motion-safe:animate-in motion-safe:fade-in-0 md:block" />
      ) : null}
      {/* Phone: the page dims behind the sheet, and a tap on it closes the sheet. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={[
          'fixed inset-0 z-40 bg-black/35 md:hidden',
          open ? 'opacity-100 [transition:opacity_300ms_ease-out]' : 'pointer-events-none opacity-0 [transition:opacity_250ms_ease-in]',
          'motion-reduce:transition-none',
        ].join(' ')}
      />
      <aside
        ref={asideRef}
        aria-label="Trax"
        data-state={open ? 'open' : 'closed'}
        onKeyDown={onKeyDown}
        style={visualHeight ? { maxHeight: `${Math.round(visualHeight)}px` } : undefined}
        className={[
          'pv2 fixed z-40 flex flex-col overflow-hidden text-pv-fg',
          'rounded-2xl border border-pv-border/70 bg-pv-bg shadow-[0_28px_70px_-28px_rgb(0_0_0/0.45)]',
          // Phone: a native bottom sheet — rises from the bottom edge to just
          // under the status bar, rounded on top, padded for the home indicator.
          // Phone: full screen, as the operator's Trax (trax/trax-panel.tsx),
          // rising from the bottom edge, padded for the status bar and the
          // home indicator.
          'max-md:inset-0 max-md:rounded-none max-md:border-0 max-md:shadow-none max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]',
          expanded
            ? 'md:inset-auto md:right-8 md:bottom-8 md:h-[min(900px,calc(100dvh-7rem))] md:w-[min(1100px,calc(100vw-4rem))]'
            : 'md:inset-auto md:right-5 md:bottom-5 md:h-[min(720px,calc(100dvh-7rem))] md:w-[clamp(400px,30vw,480px)]',
          open
            ? 'visible translate-y-0 opacity-100 [transition:transform_200ms_ease-out,opacity_200ms_ease-out] max-md:[transition:transform_380ms_cubic-bezier(0.32,0.72,0,1)]'
            : 'pointer-events-none invisible translate-y-3 opacity-0 max-md:translate-y-full max-md:opacity-100 [transition:transform_200ms_ease-in,opacity_200ms_ease-in,visibility_0s_linear_200ms] max-md:[transition:transform_280ms_cubic-bezier(0.32,0.72,0,1),visibility_0s_linear_280ms]',
          'motion-reduce:transition-none',
        ].join(' ')}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-0 bg-[radial-gradient(120%_60%_at_100%_0%,hsl(var(--v2-primary)/0.07),transparent_60%)]"
        />
        <header className="relative flex h-16 shrink-0 items-center gap-2 pr-2 pl-3">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-pv-primary/[0.07] px-2.5 text-[12px] font-medium text-pv-link">
            <TraxMark size="xs" />
            Trax
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <PanelAction label="New conversation" icon={<SquarePen />} disabled={isLoading || messages.length === 0} onClick={startNew} />
            <PanelAction label="Close · ⌘J" icon={<X />} onClick={() => setOpen(false)} />
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1 flex-col">{hasOpened ? <Thread autoFocus={open} /> : null}</div>
      </aside>
    </>,
    host,
  );
}
