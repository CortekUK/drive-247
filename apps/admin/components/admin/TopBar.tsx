'use client';

/**
 * Super Admin's top bar, drawn as Northwind's (`apps/portal/src/components/
 * shared/layout/top-bar-v2.tsx`): a 64px row across the CONTENT column only,
 * no fill, no border, sitting straight on the app wash — the ⌘K search pill on
 * the left, a right-hand cluster of the things you reach for.
 *
 * It is a non-scrolling row of a one-viewport frame; `<main>` below is the
 * only scroll container, so nothing ever passes underneath it.
 *
 * Northwind's cluster is credits · Help (Trax) · messages · notifications.
 * Super Admin's is Messaging · Notifications · Support. Messaging (the team
 * chat, to come) opens a coming-soon dialog; Notifications opens nothing yet. Support opens the platform Support inbox and carries its
 * unread count.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Bell, LifeBuoy, MessageCircle, Search, SlidersHorizontal, X } from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AdminGlobalSearch } from '@/components/admin/admin-global-search';
import { useAdminNav } from '@/components/admin/admin-nav';
import { TeamChatComingSoon } from '@/components/admin/team-chat-coming-soon';
import { usePageSearchSlot, type PageSearchRegistration } from '@/components/admin/page-search-slot';

const FIELD =
  'group relative flex h-8 w-full max-w-[380px] items-center gap-2 overflow-hidden rounded-full ' +
  'border border-primary/25 bg-primary/[0.07] px-2.5 text-left backdrop-blur-[2px] transition-colors ' +
  'hover:border-primary/40 hover:bg-primary/10 ' +
  'focus-visible:border-primary/50 focus-visible:bg-primary/10 focus-visible:outline-none ' +
  'focus-visible:ring-3 focus-visible:ring-ring/30';

const TIP = 'rounded-xl border border-border bg-card px-3 py-1.5 text-[12px] text-foreground shadow-sm';

const ICON_BUTTON =
  'relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-4xl text-muted-foreground outline-none transition-all ' +
  'hover:bg-primary/10 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 [&_svg]:size-4';

export function TopBar({ showNavTrigger = true }: { showNavTrigger?: boolean }) {
  const nav = useAdminNav();
  const [searchOpen, setSearchOpen] = useState(false);
  /** What "Search everywhere" carries into the ⌘K window. */
  const [searchSeed, setSearchSeed] = useState('');
  const slot = usePageSearchSlot();
  const searchEverywhere = useCallback((q: string) => {
    setSearchSeed(q.trim());
    setSearchOpen(true);
  }, []);
  const [chatOpen, setChatOpen] = useState(false);
  const open = useCallback(() => setSearchOpen(true), []);
  /** A phone: the page's own search, opened from the magnifier, takes the row. */
  const [phoneFieldOpen, setPhoneFieldOpen] = useState(false);

  // ⌘K / Ctrl+K from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const supportItem = nav.support;
  const unread = nav.supportCount ?? 0;

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 bg-transparent px-3 sm:px-4">
      {/* Phone-only navigation opener; the desktop rail collapses on its own
          hairline and ⌘B. */}
      {showNavTrigger && <SidebarTrigger aria-label="Open navigation" className="-ml-1 shrink-0 md:hidden" />}

      {/* sm+: either the page's own list search, or the global ⌘K pill —
          never both (Northwind's rule: two search fields on one screen, one
          global and one local with nothing saying which, is the confusion). */}
      {slot ? (
        <PageField
          slot={slot}
          onSearchEverywhere={searchEverywhere}
          phoneOpen={phoneFieldOpen}
          onPhoneClose={() => setPhoneFieldOpen(false)}
        />
      ) : (
        <button type="button" onClick={open} aria-label="Search" className={`hidden sm:flex ${FIELD}`}>
          <Search className="size-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
            {nav.salesOnly ? 'Search pages…' : 'Search rental companies, pages…'}
          </span>
          <kbd className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
            ⌘K
          </kbd>
        </button>
      )}

      {/* A phone's magnifier: on a list page it opens that page's own search
          in the bar, as Northwind's does; elsewhere, ⌘K search. It gives way
          while the page field is showing. */}
      <button
        type="button"
        onClick={slot ? () => setPhoneFieldOpen(true) : open}
        aria-label={slot ? 'Search this page' : 'Search'}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.07] text-primary sm:hidden [header:has([data-phone-field])_&]:hidden"
      >
        <Search className="size-4" aria-hidden />
      </button>

      <div className="ml-auto flex items-center gap-0.5 max-sm:[header:has([data-phone-field])_&]:hidden">
        {supportItem && (
          <>
            <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
            {/* Support: the same icon button as its neighbours, with the
                unread count as a small badge on its corner. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={supportItem.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={unread > 0 ? `Support, ${unread} unread` : 'Support'}
                  className={ICON_BUTTON}
                >
                  <LifeBuoy />
                  {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-[3px] text-[8px] font-semibold leading-none text-destructive-foreground">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8} className={TIP}>
                {unread > 0 ? `Support · ${unread} unread` : 'Support'}
              </TooltipContent>
            </Tooltip>
            {/* Messaging: Drive247's internal team chat, to come. Opens a
                "coming soon" dialog until then. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Messaging" className={ICON_BUTTON} onClick={() => setChatOpen(true)}>
                  <MessageCircle />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8} className={TIP}>
                Messaging
              </TooltipContent>
            </Tooltip>
            {/* Notifications: not wired to anything yet, so a click does nothing. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Notifications" className={ICON_BUTTON}>
                  <Bell />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8} className={TIP}>
                Notifications
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>

      <AdminGlobalSearch
        open={searchOpen}
        initialQuery={searchSeed}
        onOpenChange={(next) => {
          setSearchOpen(next);
          if (!next) setSearchSeed('');
        }}
      />
      <TeamChatComingSoon open={chatOpen} onOpenChange={setChatOpen} />
    </header>
  );
}

/**
 * The top bar's field while a list page has lent it its search — Northwind's
 * (top-bar-v2.tsx): the page's placeholder, an "in …" scope chip, the page's
 * Filters toggle with its count, and ⌘K to search everything instead. While it
 * holds a term, a row under it offers "Search everywhere" (⌘↵).
 */
function PageField({
  slot,
  onSearchEverywhere,
  phoneOpen,
  onPhoneClose,
}: {
  slot: PageSearchRegistration;
  onSearchEverywhere: (q: string) => void;
  phoneOpen: boolean;
  onPhoneClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState(slot.value);
  const [focused, setFocused] = useState(false);
  const pushed = useRef(slot.value);

  // A change from outside (Clear filters, a reset) lands in the field; the
  // echo of what this field pushed does not.
  useEffect(() => {
    if (slot.value !== pushed.current) {
      pushed.current = slot.value;
      setTerm(slot.value);
    }
  }, [slot.value]);

  // A different page lending the bar starts clean.
  useEffect(() => {
    pushed.current = slot.value;
    setTerm(slot.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.placeholder]);

  useEffect(() => {
    if (term === pushed.current) return;
    const t = setTimeout(() => {
      pushed.current = term;
      slot.onChange(term);
    }, slot.debounceMs ?? 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const trimmed = term.trim();
  const filters = slot.filters;
  // Below `sm` the field shows only once opened, or while it holds a term.
  const onPhone = phoneOpen || term !== '';

  useEffect(() => {
    if (phoneOpen) inputRef.current?.focus();
  }, [phoneOpen]);

  return (
    <>
    <div data-phone-field={onPhone ? '' : undefined} className={`relative w-full min-w-0 max-w-[440px] ${onPhone ? 'block' : 'hidden sm:block'}`}>
      <div className={`${FIELD} max-w-none cursor-text`} onClick={() => inputRef.current?.focus()}>
        <Search className="size-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden />
        {slot.scopeLabel && (
          <span className="flex shrink-0 items-center gap-1 rounded-md border border-primary/30 max-sm:hidden bg-background/70 py-0.5 pl-1.5 pr-0.5 text-[11px] font-medium text-foreground dark:bg-[hsl(var(--v2-hover,var(--muted)))]">
            <span className="text-muted-foreground">in</span>
            {slot.scopeLabel}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSearchEverywhere(term);
              }}
              aria-label={`Remove ${slot.scopeLabel} filter and search everything`}
              className="flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && trimmed) {
              e.preventDefault();
              onSearchEverywhere(term);
            } else if (e.key === 'Escape') {
              inputRef.current?.blur();
            }
          }}
          placeholder={slot.placeholder}
          aria-label={slot.placeholder}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {filters && (
          <button
            type="button"
            aria-label={filters.open ? 'Hide filters' : 'Show filters'}
            aria-pressed={filters.open}
            onClick={(e) => {
              e.stopPropagation();
              filters.onOpenChange(!filters.open);
            }}
            className={
              'relative flex h-6 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors ' +
              (filters.open
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/10 text-primary hover:bg-primary/20 dark:text-[hsl(var(--v2-link,var(--primary)))]')
            }
          >
            <SlidersHorizontal className="size-4" />
            {!filters.open && filters.activeCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-semibold leading-none text-primary-foreground">
                {filters.activeCount}
              </span>
            )}
          </button>
        )}
        {!trimmed && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSearchEverywhere('');
            }}
            aria-label="Search everything"
            className="shrink-0 cursor-pointer max-sm:hidden rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary hover:bg-primary/25 dark:text-[hsl(var(--v2-link,var(--primary)))]"
          >
            ⌘K
          </button>
        )}
      </div>
      {focused && trimmed && (
        <button
          type="button"
          // mousedown: a click would blur the field (hiding this row) before it lands.
          onMouseDown={(e) => {
            e.preventDefault();
            onSearchEverywhere(term);
          }}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-[13px] shadow-sm transition-colors hover:bg-primary/10"
        >
          <ArrowUpRight className="size-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-foreground">
            Search everywhere for <span className="font-semibold">&ldquo;{trimmed}&rdquo;</span>
          </span>
          <kbd className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">⌘↵</kbd>
        </button>
      )}
    </div>
    {onPhone && (
      <button
        type="button"
        onClick={() => {
          setTerm('');
          onPhoneClose();
        }}
        aria-label="Clear and close search"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground sm:hidden"
      >
        <X className="size-4" aria-hidden />
      </button>
    )}
    </>
  );
}
