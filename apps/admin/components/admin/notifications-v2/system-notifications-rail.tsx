'use client';

/**
 * The Notifications list: the left pane of the super admin's full-screen
 * Notifications view (system-notifications-page.tsx). The twin of the operator
 * portal's notifications-rail.tsx, with this dashboard's three directions:
 *
 *   [ ← ][ Search ]
 *   Setups                       ← hover: Email sender / Push, as a menu
 *   [ Operators | Us | Everyone ] ← who receives the message
 *   Onboarding                   ← categories, in catalog order
 *     Portal is ready
 *       App message / Email      ← the open notification's messages
 *
 * It only chooses. The page reads the choice from the selection store and owns
 * every edit, so nothing here can lose a draft.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  ArrowRightLeft,
  ChevronRight,
  CreditCard,
  ExternalLink,
  Info,
  LifeBuoy,
  Mail,
  Megaphone,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  SYSTEM_NOTIFICATION_CATALOG,
  SYSTEM_NOTIFICATION_CATEGORIES,
  type SystemNotificationCategoryId,
  type SystemNotificationDirection,
  type SystemNotificationItem,
} from '@/lib/notifications-v2/catalog';
import { cn } from '@/lib/utils';
import { NV_HIGHLIGHT_ACTIVE, NV_HIGHLIGHT_FOCUS, NV_HIGHLIGHT_HOVER } from './highlight';
import {
  SYSTEM_NOTIFICATIONS_SETUP,
  useSystemNotificationsSelection,
  type SystemMessageKind,
  type SystemSetupSection,
} from './system-notifications-selection-store';

export const SYSTEM_CATEGORY_ICONS: Record<SystemNotificationCategoryId, LucideIcon> = {
  onboarding: Rocket,
  billing: CreditCard,
  migration: ArrowRightLeft,
  platform_activity: Activity,
  support: LifeBuoy,
  insurance: ShieldCheck,
  announcements: Megaphone,
};

/** Named by who RECEIVES the message, with the longer explanation on hover. */
const SIDES: readonly { value: SystemNotificationDirection; short: string; label: string; explain: string }[] = [
  {
    value: 'super_admin_to_admin',
    short: 'Operators',
    label: 'To operators',
    explain:
      'What operators are told. We set something up, send a link or reply to them, or it happens automatically, and the operator gets a message about it.',
  },
  {
    value: 'admin_to_super_admin',
    short: 'Us',
    label: 'To Drive247',
    explain:
      'What we are told. An operator signs up, subscribes, asks for something or raises a ticket, and our team gets a message about it.',
  },
  {
    value: 'super_admin_to_everyone',
    short: 'Everyone',
    label: 'To everyone',
    explain: 'What we broadcast to operators, to their renters, or to both. Each one is written on its own screen.',
  },
];

/** Short direction tag, shown only while searching (every direction is listed then). */
const SIDE_TAG: Record<SystemNotificationDirection, string> = {
  super_admin_to_admin: 'Operators',
  admin_to_super_admin: 'Us',
  super_admin_to_everyone: 'Everyone',
};

const ROW = cn(
  'flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] text-foreground/80 outline-none transition-colors motion-reduce:transition-none',
  NV_HIGHLIGHT_HOVER,
  NV_HIGHLIGHT_FOCUS,
);

/** The messages a notification has: App message (push and/or bell) and Email. */
function messagesOf(item: SystemNotificationItem): { kind: SystemMessageKind; label: string; icon: LucideIcon }[] {
  if (item.managedElsewhere) return [];
  const out: { kind: SystemMessageKind; label: string; icon: LucideIcon }[] = [];
  if (item.channels.push || item.channels.in_app) out.push({ kind: 'app', label: 'App message', icon: Smartphone });
  if (item.channels.email) out.push({ kind: 'email', label: 'Email', icon: Mail });
  return out;
}

const SETUPS: readonly { key: SystemSetupSection; label: string; hint: string; icon: LucideIcon }[] = [
  { key: 'email', label: 'Email sender', hint: 'Who platform emails come from', icon: Mail },
  { key: 'push', label: 'Push notifications', hint: 'Alerts on your own devices', icon: Smartphone },
];

function matches(item: SystemNotificationItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.tooltip, item.when].some((text) => String(text ?? '').toLowerCase().includes(q));
}

export function SystemNotificationsList({ className }: { className?: string }) {
  const { selected, side, message, search, pending, select, setSide, setSearch, setMessage, setupSection, openSetup } =
    useSystemNotificationsSelection();
  const searching = search.trim().length > 0;
  const pendingSet = useMemo(() => new Set(pending), [pending]);
  const onSetup = selected === SYSTEM_NOTIFICATIONS_SETUP;

  // ⌘K / Ctrl+K focuses this search instead of the dashboard's own search,
  // which would sit behind this full-screen view. Capture phase, so it wins.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // While searching, every direction is listed (each row tagged); otherwise one.
  const groups = useMemo(
    () =>
      SYSTEM_NOTIFICATION_CATEGORIES.map((category) => ({
        category,
        items: SYSTEM_NOTIFICATION_CATALOG.filter(
          (item) => item.category === category.id && (searching || item.direction === side) && matches(item, search),
        ),
      })).filter((group) => group.items.length > 0),
    [side, search, searching],
  );

  // The sliding pill follows the chosen tab's real box: the three labels
  // differ in width, so equal thirds would cut "Operators" off.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useIsoLayoutEffect(() => {
    if (searching) return;
    const measure = (): void => {
      const el = tabRefs.current[SIDES.findIndex((o) => o.value === side)];
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    for (const el of tabRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [side, searching]);

  return (
    <nav aria-label="Notifications" className={cn('flex min-h-0 flex-col', className)}>
      <div className="space-y-2 px-3 pb-2 pt-3">
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/admin/dashboard"
                aria-label="Back to the dashboard"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-primary/10 hover:text-primary motion-reduce:transition-none"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back (Esc)</TooltipContent>
          </Tooltip>
          {/* The top bar's search pill, so it reads as the same control. */}
          <label className="group relative flex h-8 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-full border border-primary/25 bg-primary/[0.07] px-2.5 transition-colors focus-within:border-primary/50 focus-within:bg-primary/10 hover:border-primary/40 hover:bg-primary/10 motion-reduce:transition-none dark:hover:border-[hsl(var(--v2-link,var(--primary))_/_0.4)] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]">
            <span className="sr-only">Search notifications</span>
            <Search
              className="size-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications…"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[hsl(var(--v2-muted-on-tint,var(--muted-foreground)))] [&::-webkit-search-cancel-button]:hidden"
            />
            <kbd className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
              ⌘K
            </kbd>
          </label>
        </div>

        {/* Setups, right under the search: an icon tile, a title and one line of
            what is inside. A soft tint, no border. Hover opens its setups as a
            menu (the app's white floating card), as in the portal; a click
            opens the one last used. */}
        <SetupsMenu onSetup={onSetup} setupSection={setupSection} openSetup={openSetup} />

        {!searching && (
          // A sliding pill under three plain labels, as the portal's two.
          <div role="tablist" aria-label="Who the messages go to" className="relative flex rounded-full p-1">
            {pill && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-1 left-0 rounded-full bg-background shadow-sm ring-1 ring-primary/20 transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
                style={{ width: pill.width, transform: `translateX(${pill.left}px)` }}
              />
            )}
            {SIDES.map((option, i) => (
              <button
                key={option.value}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                aria-selected={side === option.value}
                onClick={() => setSide(option.value)}
                className={cn(
                  'group relative z-10 flex h-8 min-w-0 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] font-medium transition-colors motion-reduce:transition-none',
                  side === option.value
                    ? 'text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.short}
                {/* The explanation opens from THIS icon only, never from the button. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      aria-label={`About ${option.label}`}
                      className="inline-flex size-4 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-60 group-focus-visible:opacity-60 hover:!opacity-100 data-[state=delayed-open]:opacity-100 motion-reduce:transition-none"
                    >
                      <Info className="size-3.5" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="w-64 p-3.5" onClick={(e) => e.stopPropagation()}>
                    <p className="text-[13px] font-semibold">{option.label}</p>
                    <p className="mt-1 text-[12px] font-normal leading-relaxed opacity-80">{option.explain}</p>
                  </TooltipContent>
                </Tooltip>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {groups.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
            No notification matches “{search.trim()}”.
          </p>
        ) : (
          groups.map(({ category, items }, groupIndex) => {
            const Icon = SYSTEM_CATEGORY_ICONS[category.id];
            return (
              <div key={category.id} className={cn('px-1.5', groupIndex > 0 ? 'pt-4' : 'pt-1.5')}>
                <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {category.label}
                </p>
                <ul>
                  {items.map((item) => {
                    const open = selected === item.key;
                    const messages = open ? messagesOf(item) : [];
                    const shown = messages.some((m) => m.kind === message) ? message : messages[0]?.kind;
                    return (
                      <li key={item.key}>
                        <button
                          type="button"
                          aria-current={open ? 'true' : undefined}
                          onClick={() => select(item.key, item.direction)}
                          data-rail-item={item.key}
                          className={cn(ROW, 'pl-7', open && cn(NV_HIGHLIGHT_ACTIVE, 'font-medium'))}
                        >
                          <span className="min-w-0 flex-1 truncate">{item.name}</span>
                          {searching && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">{SIDE_TAG[item.direction]}</span>
                          )}
                          {item.managedElsewhere && (
                            <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-label="Written on its own screen" />
                          )}
                          {pendingSet.has(item.key) && (
                            <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Unsaved changes" />
                          )}
                        </button>
                        {/* The chosen notification's messages, nested under it. */}
                        {messages.length > 0 && (
                          <ul className="mb-1 mt-0.5 space-y-0.5 pl-7" aria-label={`${item.name} messages`}>
                            {messages.map((m) => (
                              <li key={m.kind}>
                                <button
                                  type="button"
                                  aria-current={shown === m.kind ? 'true' : undefined}
                                  onClick={() => setMessage(m.kind)}
                                  data-rail-message={m.kind}
                                  className={cn(
                                    ROW,
                                    'h-7 gap-1.5 pl-3 text-[12.5px]',
                                    shown === m.kind ? 'font-medium text-foreground' : 'text-muted-foreground',
                                  )}
                                >
                                  <m.icon className="size-3.5 shrink-0" aria-hidden="true" />
                                  {m.label}
                                  {shown === m.kind && (
                                    <span className="ml-auto size-1.5 rounded-full bg-primary" aria-hidden="true" />
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </nav>
  );
}

// useLayoutEffect warns during server rendering; nothing here runs there anyway.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The Setups card. Hover (or focus) opens its two setups as a menu on the
 * right, in the white floating card the portal uses for the same thing; a
 * click opens the setup last used.
 */
function SetupsMenu({
  onSetup,
  setupSection,
  openSetup,
}: {
  onSetup: boolean;
  setupSection: SystemSetupSection;
  openSetup: (section: SystemSetupSection) => void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const later = (next: boolean, ms: number): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), ms);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-current={onSetup ? 'true' : undefined}
          aria-haspopup="menu"
          onClick={(e) => {
            e.preventDefault();
            setOpen(false);
            openSetup(setupSection);
          }}
          onMouseEnter={() => later(true, 120)}
          onMouseLeave={() => later(false, 150)}
          className={cn(
            'group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none',
            onSetup
              ? 'bg-primary/[0.12] dark:bg-[hsl(var(--v2-hover,var(--muted)))]'
              : 'bg-primary/[0.06] hover:bg-primary/10 dark:bg-[hsl(var(--v2-hover,var(--muted)))]',
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Settings2 className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-foreground">Setups</span>
            <span className="block truncate text-[11.5px] text-muted-foreground">Sender and push</span>
          </span>
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none',
              onSetup ? 'text-primary' : 'group-hover:translate-x-0.5',
            )}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onMouseEnter={() => later(true, 0)}
        onMouseLeave={() => later(false, 150)}
        className="w-64 rounded-3xl border-0 bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10"
      >
        <div role="menu" aria-label="Setups">
          {SETUPS.map((item) => {
            const current = onSetup && setupSection === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                aria-current={current ? 'true' : undefined}
                onClick={() => {
                  setOpen(false);
                  openSetup(item.key);
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none transition-colors duration-200 ease-out motion-reduce:transition-none',
                  current ? NV_HIGHLIGHT_ACTIVE : cn(NV_HIGHLIGHT_HOVER, NV_HIGHLIGHT_FOCUS),
                )}
              >
                <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-foreground">{item.label}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
