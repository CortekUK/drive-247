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
 * Super Admin has no credits and no Trax, so the cluster is its Support inbox
 * (the platform's messages) with the unread count, drawn exactly as
 * Northwind's Messages button.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, Search } from 'lucide-react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AdminGlobalSearch } from '@/components/admin/admin-global-search';
import { useAdminNav } from '@/components/admin/admin-nav';

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
  const open = useCallback(() => setSearchOpen(true), []);

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

  const supportItem = nav.quick.find((i) => i.href === '/admin/support');
  const unread = nav.supportCount ?? 0;

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 bg-transparent px-3 sm:px-4">
      {/* Phone-only navigation opener; the desktop rail collapses on its own
          hairline and ⌘B. */}
      {showNavTrigger && <SidebarTrigger aria-label="Open navigation" className="-ml-1 shrink-0 md:hidden" />}

      <button type="button" onClick={open} aria-label="Search" className={`hidden sm:flex ${FIELD}`}>
        <Search className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
          {nav.salesOnly ? 'Search pages…' : 'Search rental companies, pages…'}
        </span>
        <kbd className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        onClick={open}
        aria-label="Search"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.07] text-primary sm:hidden"
      >
        <Search className="size-4" aria-hidden />
      </button>

      <div className="ml-auto flex items-center gap-0.5">
        {supportItem && (
          <>
            <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={supportItem.href}
                  aria-label={unread > 0 ? `Support, ${unread} unread` : 'Support'}
                  className={ICON_BUTTON}
                >
                  <MessageCircle />
                  {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground ring-2 ring-background">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8} className={TIP}>
                Support
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>

      <AdminGlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
