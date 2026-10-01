"use client";

/**
 * The Notifications list: the left pane of the full-screen Notifications view
 * (notifications-page-v2, Oct 1 2026, "end to end, like the agreement
 * template editor").
 *
 *   [ Search ]
 *   [ Your team | Customers ]  ← which way the messages go
 *   Booking                    ← categories, in catalog order
 *     New booking
 *     Booking approved …
 *   ─────
 *   Setups                     ← channel setup and What's sent today
 *
 * It only chooses. The page reads the choice from notifications-selection-store
 * and owns every edit, so nothing here can lose a draft. v2 only.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  Banknote, CalendarCheck, ChevronRight, Info, Car, FileSignature, KeyRound, Mail, MessageSquare,
  Receipt, Search, Settings2, ShieldCheck, Smartphone, UserCheck, type LucideIcon,
} from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui-v2/hover-card";
import { SIDEBAR_HIGHLIGHT_ACTIVE, SIDEBAR_HIGHLIGHT_FOCUS, SIDEBAR_HIGHLIGHT_HOVER } from "@/components/ui-v2/sidebar";
import { NOTIFICATION_CATALOG, NOTIFICATION_CATEGORIES } from "@/lib/notifications-v2/catalog";
import type { NotificationCategoryId, NotificationDirection, NotificationItem } from "@/lib/notifications-v2/types";
import { cn } from "@/lib/utils";
import {
  NOTIFICATIONS_SETUP,
  useNotificationsSelection,
  type NotificationMessageKind,
  type SetupSection,
} from "./notifications-selection-store";

export const CATEGORY_ICONS: Record<NotificationCategoryId, LucideIcon> = {
  booking: CalendarCheck,
  rental: Car,
  payments: Banknote,
  agreements: FileSignature,
  verification: UserCheck,
  keys: KeyRound,
  fines: Receipt,
  insurance: ShieldCheck,
  enquiries: MessageSquare,
};

/** Named by who RECEIVES the message (Ghulam, Oct 1 2026), with the longer explanation on hover. */
const SIDES: readonly { value: NotificationDirection; short: string; label: string; explain: string }[] = [
  {
    value: "customer_to_team",
    short: "To your team",
    label: "To your team",
    explain:
      "What your team is told. A customer books, pays, signs or asks something, or something needs attention on one of their rentals, and your team gets a message about it.",
  },
  {
    value: "team_to_customer",
    short: "To customers",
    label: "To customers",
    explain:
      "What your customers are told. Your team approves, extends or charges, or it happens automatically on your behalf, and the customer gets a message about it.",
  },
];

/** Short direction tag, shown only while searching (both sides are listed then). */
const SIDE_TAG: Record<NotificationDirection, string> = {
  customer_to_team: "Team",
  team_to_customer: "Customer",
};

const ROW = cn(
  "flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[13px] text-foreground/80 outline-none transition-colors motion-reduce:transition-none",
  SIDEBAR_HIGHLIGHT_HOVER,
  SIDEBAR_HIGHLIGHT_FOCUS,
);

/** The messages a notification has: App message (push and/or bell) and Email. */
function messagesOf(item: NotificationItem): { kind: NotificationMessageKind; label: string; icon: LucideIcon }[] {
  const out: { kind: NotificationMessageKind; label: string; icon: LucideIcon }[] = [];
  if (item.channels.push || item.channels.in_app) out.push({ kind: "app", label: "App message", icon: Smartphone });
  if (item.channels.email) out.push({ kind: "email", label: "Email", icon: Mail });
  return out;
}

/** What the Setups menu offers, in order. In-app bell and What's sent today were taken out (Ghulam, Oct 1 2026: "don't need those for now"). */
const SETUPS: readonly { key: SetupSection; label: string; hint: string; icon: LucideIcon }[] = [
  { key: "email", label: "Email sender", hint: "Who your emails come from", icon: Mail },
  { key: "push", label: "Push notifications", hint: "Alerts on your team's devices", icon: Smartphone },
];

function matches(item: NotificationItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.tooltip, item.when].some((text) => String(text ?? "").toLowerCase().includes(q));
}

export function NotificationsList({ className }: { className?: string }) {
  const { selected, side, message, search, pending, select, setSide, setSearch, setMessage, setupSection, openSetup } =
    useNotificationsSelection();
  const searching = search.trim().length > 0;
  const pendingSet = useMemo(() => new Set(pending), [pending]);

  // ⌘K / Ctrl+K focuses this search instead of opening the app's palette,
  // which would sit behind this full-screen view. Capture phase, so it wins.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // While searching, both sides are listed (each row tagged); otherwise one.
  const groups = useMemo(
    () =>
      NOTIFICATION_CATEGORIES.map((category) => ({
        category,
        items: NOTIFICATION_CATALOG.filter(
          (item) => item.category === category.id && (searching || item.direction === side) && matches(item, search),
        ),
      })).filter((group) => group.items.length > 0),
    [side, search, searching],
  );

  return (
    <nav aria-label="Notifications" className={cn("flex min-h-0 flex-col", className)}>
      <div className="space-y-2 px-3 pb-2 pt-3">
        {/* The top bar's search pill (top-bar-v2 FIELD), so it reads as the
            same control. ⌘K focuses it while this view is open. */}
        <label className="group relative flex h-8 w-full items-center gap-2 overflow-hidden rounded-full border border-primary/25 bg-primary/[0.07] px-2.5 transition-colors focus-within:border-primary/50 focus-within:bg-primary/10 focus-within:ring-3 focus-within:ring-ring/30 hover:border-primary/40 hover:bg-primary/10 motion-reduce:transition-none dark:hover:border-[hsl(var(--v2-link,var(--primary))_/_0.4)] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]">
          <span className="sr-only">Search notifications</span>
          <Search className="size-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden="true" />
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
        {/* Setups first, right under the search, and made to stand out from the
            plain rows below (Ghulam, Oct 1 2026): an icon tile, a title and one
            line of what is inside. A soft tint, no border or shadow. */}
        {(() => {
          const on = selected === NOTIFICATIONS_SETUP;
          return (
            // Hover opens the four setups as a menu (the app's white hover
            // card); a click opens the one last used.
            <HoverCard openDelay={120} closeDelay={150}>
            <HoverCardTrigger asChild>
            <button
              type="button"
              aria-current={on ? "true" : undefined}
              aria-haspopup="menu"
              onClick={() => openSetup(setupSection)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none",
                on
                  ? "bg-primary/[0.12] dark:bg-[hsl(var(--v2-hover,var(--muted)))]"
                  : "bg-primary/[0.06] hover:bg-primary/10 dark:bg-[hsl(var(--v2-hover,var(--muted)))]",
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Settings2 className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-foreground">Setups</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">Sender, push and what&apos;s sent today</span>
              </span>
              <ChevronRight
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                  on ? "text-primary" : "group-hover:translate-x-0.5",
                )}
                aria-hidden="true"
              />
            </button>
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start" sideOffset={8} className="w-64 p-1.5">
              <div role="menu" aria-label="Setups">
                {SETUPS.map((item) => {
                  const current = on && setupSection === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="menuitem"
                      aria-current={current ? "true" : undefined}
                      onClick={() => openSetup(item.key)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-200 ease-out motion-reduce:transition-none",
                        current ? SIDEBAR_HIGHLIGHT_ACTIVE : cn(SIDEBAR_HIGHLIGHT_HOVER, SIDEBAR_HIGHLIGHT_FOCUS),
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
            </HoverCardContent>
            </HoverCard>
          );
        })()}
        {!searching && (
          // The sidebar's Portal / Website switch (app-sidebar-v2), without the
          // shortcut badges: a sliding pill under two plain labels.
          <div role="tablist" aria-label="Who the messages go to" className="relative grid grid-cols-2 rounded-full p-1">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-background shadow-sm ring-1 ring-primary/20 transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{ transform: side === "team_to_customer" ? "translateX(100%)" : "translateX(0)" }}
            />
            {SIDES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={side === option.value}
                onClick={() => setSide(option.value)}
                className={cn(
                  "group relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-full px-2 text-[12px] font-medium transition-colors motion-reduce:transition-none",
                  side === option.value
                    ? "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.short}
                {/* The explanation opens from THIS icon only, never from the
                    button (Ghulam, Oct 1 2026): the app's white hover card. */}
                <HoverCard openDelay={150} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <span
                      aria-label={`About ${option.label}`}
                      // Hidden until the button is hovered or focused; full strength on itself.
                      className="inline-flex size-4 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-60 group-focus-visible:opacity-60 hover:!opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none"
                    >
                      <Info className="size-3.5" aria-hidden="true" />
                    </span>
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="bottom"
                    align="center"
                    className="w-64 p-3.5"
                    // Portalled, but React still bubbles its clicks to the tab button.
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-[13px] font-semibold text-foreground">{option.label}</p>
                    <p className="mt-1 text-[12px] font-normal leading-relaxed text-muted-foreground">{option.explain}</p>
                  </HoverCardContent>
                </HoverCard>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {groups.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">No notification matches “{search.trim()}”.</p>
        ) : (
          groups.map(({ category, items }, groupIndex) => {
            const Icon = CATEGORY_ICONS[category.id];
            return (
              // Groups are set apart by space, not rules, as in the main sidebar.
              <div key={category.id} className={cn("px-1.5", groupIndex > 0 ? "pt-4" : "pt-1.5")}>
                <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {category.label}
                </p>
                <ul>
                  {items.map((item) => {
                    const open = selected === item.key;
                    const messages = open ? messagesOf(item) : [];
                    // The open message, falling back to the one the item has.
                    const shown = messages.some((m) => m.kind === message) ? message : messages[0]?.kind;
                    return (
                    <li key={item.key}>
                      <button
                        type="button"
                        aria-current={selected === item.key ? "true" : undefined}
                        onClick={() => select(item.key, item.direction)}
                        data-rail-item={item.key}
                        className={cn(ROW, "pl-7", selected === item.key && cn(SIDEBAR_HIGHLIGHT_ACTIVE, "font-medium"))}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        {searching && <span className="shrink-0 text-[10px] text-muted-foreground">{SIDE_TAG[item.direction]}</span>}
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
                                aria-current={shown === m.kind ? "true" : undefined}
                                onClick={() => setMessage(m.kind)}
                                data-rail-message={m.kind}
                                className={cn(
                                  ROW,
                                  "h-7 gap-1.5 pl-3 text-[12.5px]",
                                  shown === m.kind ? "font-medium text-foreground" : "text-muted-foreground",
                                )}
                              >
                                <m.icon className="size-3.5 shrink-0" aria-hidden="true" />
                                {m.label}
                                {shown === m.kind && <span className="ml-auto size-1.5 rounded-full bg-primary" aria-hidden="true" />}
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
