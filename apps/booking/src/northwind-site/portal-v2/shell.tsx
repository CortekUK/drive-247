'use client';

/**
 * Customer portal v2's frame — the operator portal v2's chrome, for customers:
 * a transparent rail over the brand wash (app-sidebar-v2.tsx), a 64px top bar
 * (top-bar-v2.tsx), and one content column that is the only thing that scrolls
 * (the v2 fixed frame).
 *
 * Copied, not approximated: the rail's row metrics, hover and active ring, the
 * group labels, the org row at the top, the profile row and its menu at the
 * bottom, ⌘B to collapse to icons, the search pill with ⌘K, and the icon
 * cluster with notifications at the far right. Calmer where a customer needs
 * it: one primary action in the rail (Book a car), and no operator-only
 * controls (credits, Help/Trax, the sidebar customiser).
 *
 * The gate is the current portal's, unchanged in substance: children never
 * mount until the customer is signed in for THIS tenant, so no page fires a
 * query against a missing or stale customer id. Data scoping still lives in the
 * hooks (`customer_id` AND `tenant_id` on every query); the one query this file
 * runs itself (the unread-message count) carries both too.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChevronsUpDown,
  CornerDownLeft,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Settings,
} from 'lucide-react-nw';

import { PortalBoot } from '@nw/components/portal/portal-boot';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nw/components/ui/dialog';
import { MOTION_ANCHORED, MOTION_TOOLTIP } from '@nw/components/ui/motion';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@nw/components/ui/sheet';
import { useCustomerAuth } from '@nw/contexts/CustomerAuthContext';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerNotifications } from '@nw/hooks/use-customer-notifications';
import { useCustomerRentals } from '@nw/hooks/use-customer-rentals';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { supabase } from '@nw/integrations/supabase/client';
import { cn } from '@nw/lib/utils';
import { QuickBookProvider, QuickBookTrigger } from '@nw/site-v2/quick-book/quick-book-dialog';
import { PageSearchProvider, usePageSearchSlot } from '@portal-v2-shared/page-search-slot';
import { SearchField } from '@portal-v2-shared/search-field';

import { brandHslVars } from './brand';
import {
  PORTAL_V2_BASE,
  PORTAL_V2_ITEMS,
  PORTAL_V2_NAV,
  isPortalV2Active,
  type PortalV2NavItem,
} from './nav';

/* ───────────────────────────────── gate ────────────────────────────────── */

export function PortalV2Gate({ fontClass, children }: { fontClass: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { customer, isAuthenticated, isLoading: authLoading } = useCustomerAuth();
  const { tenant, isLoading: tenantLoading } = useTenant();

  // Only a POSITIVE mismatch counts: `customers.tenant_id` is nullable.
  const tenantMismatch = customer?.tenant_id != null && tenant?.id != null && customer.tenant_id !== tenant.id;
  const allowed = isAuthenticated && !tenantMismatch;

  useEffect(() => {
    if (authLoading || allowed) return;
    const target = pathname && pathname.startsWith(PORTAL_V2_BASE) ? pathname : PORTAL_V2_BASE;
    router.replace(`/login?next=${encodeURIComponent(target)}`);
  }, [allowed, authLoading, pathname, router]);

  if (authLoading) return <PortalBoot />;
  if (!allowed) return <PortalBoot label="Taking you to sign in…" />;
  if (!tenantLoading && !tenant) {
    return <PortalBoot label="We could not identify this site. Please reload, or contact support if it continues." />;
  }

  return <PortalV2Shell fontClass={fontClass}>{children}</PortalV2Shell>;
}

/* ─────────────────────────────── shared bits ───────────────────────────── */

/** The operator's tooltip surface (top-bar-v2.tsx, TIP). */
const TIP =
  'z-50 rounded-xl border border-pv-border bg-pv-card px-3 py-1.5 text-[12px] text-pv-fg shadow-sm ' + MOTION_TOOLTIP;

/** A round 32px icon button: the operator top bar's ghost `icon-sm`. */
const ICON_BUTTON =
  'relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-pv-muted-fg ' +
  'transition-colors duration-200 hover:bg-pv-primary/10 hover:text-pv-fg aria-expanded:bg-pv-primary/10 aria-expanded:text-pv-fg ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none';

/** The red count on the bell and the messages button (top-bar-v2.tsx). */
function TopBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pv-danger px-1 text-[9px] font-bold leading-none text-white"
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

function Tip({ label, side = 'bottom', children }: { label: React.ReactNode; side?: 'bottom' | 'right'; children: React.ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={8} className={TIP}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const RAIL_KEY = 'pv2-rail-collapsed';

/* ─────────────────────────────── live counts ───────────────────────────── */

/**
 * The operator's messages not yet read by this customer, as a count.
 *
 * Its own head-only count rather than `useCustomerMessages`, which marks the
 * thread read the moment it loads — mounting that in the frame would clear the
 * customer's unread messages on every page. The same filters as the hook's
 * mark-read write: in-app channel, not sent by the customer, unread; and the
 * customer + tenant pair re-applied through the channel join.
 */
function useUnreadMessageCount(paused: boolean): number {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const tenantId = tenant?.id ?? null;

  const query = useQuery({
    queryKey: ['customer-messages-unread', tenantId, customerId],
    queryFn: async (): Promise<number> => {
      if (!tenantId || !customerId) return 0;
      const { count, error } = await supabase
        .from('chat_channel_messages')
        .select('id, chat_channels!inner(tenant_id, customer_id)', { count: 'exact', head: true })
        .eq('chat_channels.tenant_id', tenantId)
        .eq('chat_channels.customer_id', customerId)
        .eq('channel', 'in_app')
        .neq('sender_type', 'customer')
        .eq('is_read', false);
      // A badge is decoration: on failure show none rather than an error.
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!tenantId && !!customerId,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // On the thread itself the page is reading them as they arrive.
  return paused ? 0 : query.data ?? 0;
}

interface Counts {
  messages: number;
  notifications: number;
}

/* ───────────────────────────────── shell ───────────────────────────────── */

function PortalV2Shell({ fontClass, children }: { fontClass: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const brandVars = brandHslVars(tenant?.primary_color);

  const onMessages = isPortalV2Active('/portal/messages', pathname);
  const messages = useUnreadMessageCount(onMessages);
  const { unreadCount: notifications } = useCustomerNotifications();
  const counts: Counts = { messages, notifications };

  // Leaving the thread: it has just marked everything read, so re-count.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['customer-messages-unread'] });
  }, [pathname, queryClient]);

  // Dialogs, sheets and popovers portal to <body>, outside `.pv2`. Put the same
  // tokens, font and brand colour on <body> while the portal is mounted.
  useEffect(() => {
    const body = document.body;
    const classes = ['pv2-tokens', ...fontClass.split(' ').filter(Boolean)];
    body.classList.add(...classes);
    const entries = Object.entries(brandVars ?? {});
    for (const [name, value] of entries) body.style.setProperty(name, value);
    return () => {
      body.classList.remove(...classes);
      for (const [name] of entries) body.style.removeProperty(name);
    };
  }, [fontClass, brandVars?.['--brand-h'], brandVars?.['--brand-s'], brandVars?.['--brand-l']]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rail remembers being collapsed, per browser. Read after mount so the
  // server render and the first client render agree.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(RAIL_KEY) === '1') setCollapsed(true);
    } catch {
      /* storage blocked: the rail simply starts open */
    }
  }, []);

  const toggleRail = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(RAIL_KEY, next ? '1' : '0');
      } catch {
        /* not remembered — harmless */
      }
      return next;
    });
  }, []);

  // ⌘B collapses the rail and ⌘K opens search, as on the operator portal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === 'b') {
        event.preventDefault();
        toggleRail();
      } else if (key === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRail]);

  return (
    <Tooltip.Provider delayDuration={300}>
      <QuickBookProvider>
        <div
          className={cn('pv2 flex h-dvh overflow-hidden', fontClass)}
          style={(brandVars ?? undefined) as React.CSSProperties | undefined}
        >
          {/* Desktop rail: 16rem, or 3rem of icons. Paints no fill of its own —
              it sits on the page wash, as the operator's does. */}
          <aside
            data-state={collapsed ? 'collapsed' : 'expanded'}
            className={cn(
              'relative hidden shrink-0 flex-col transition-[width] duration-200 ease-linear motion-reduce:transition-none md:flex',
              collapsed ? 'w-12' : 'w-64',
            )}
          >
            <Rail pathname={pathname} collapsed={collapsed} counts={counts} />
            {/* The operator's SidebarRail: a 16px strip on the edge that shows a
                2px line on hover and toggles the rail on click. */}
            <button
              type="button"
              onClick={toggleRail}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
              className="absolute inset-y-0 -right-2 z-20 w-4 cursor-ew-resize after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:transition-colors after:duration-200 hover:after:bg-pv-sidebar-border focus-visible:outline-none focus-visible:after:bg-pv-sidebar-border"
            />
          </aside>

          {/* Phone: the same rail in a drawer, opened from the top bar — the one
              sheet in the portal, as on the operator portal. */}
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              // Focus lands on the drawer itself, not on its first link — which
              // would otherwise open the drawer looking hovered.
              onOpenAutoFocus={(event) => event.preventDefault()}
              className="pv2 w-72 max-w-none gap-0 border-0 bg-pv-sidebar p-0 sm:max-w-none"
              style={(brandVars ?? undefined) as React.CSSProperties | undefined}
            >
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Your account pages</SheetDescription>
              <div className={cn('flex h-full flex-col', fontClass)}>
                <Rail pathname={pathname} collapsed={false} counts={counts} onNavigate={() => setNavOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          {/* A list page lends the top bar its search field and filter button,
              as on the operator portal (shared/portal-v2/page-search-slot). */}
          <PageSearchProvider>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar counts={counts} onOpenNav={() => setNavOpen(true)} onOpenSearch={() => setSearchOpen(true)} />
            <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-10 pt-2 outline-none sm:px-6 md:pl-4">
              {/* Keyed on the path so every screen arrives with the Trax lift. */}
              <div key={pathname} className="pv2-enter mx-auto w-full max-w-[1200px]">
                {children}
              </div>
            </main>
          </div>
          </PageSearchProvider>

          <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
        </div>
      </QuickBookProvider>
    </Tooltip.Provider>
  );
}

/* ───────────────────────────────── rail ────────────────────────────────── */

/**
 * One rail row — app-sidebar-v2's NAV_ROW over ui-v2's SidebarMenuButton:
 * 44px on a phone, 32px from `md`, 15px / 13px labels, a 17px icon, the light
 * purple hover, and the active row's inset 1px brand ring with a 1px drop.
 * The label's hover growth is `.pv2-nav-row` in site.css.
 */
const NAV_ROW =
  'pv2-nav-row group/row relative flex h-11 w-full items-center gap-2 rounded-lg px-3 text-left font-medium outline-none md:h-8 ' +
  'transition-colors duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-pv-ring/50';
const NAV_ROW_REST = 'text-pv-sidebar-fg/70 hover:bg-pv-primary/10 hover:text-pv-primary';
const NAV_ROW_ACTIVE =
  'bg-pv-primary/10 text-pv-primary ' +
  'shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--pv-primary)_12%,transparent),0_1px_2px_color-mix(in_srgb,var(--pv-primary)_8%,transparent)]';
const NAV_ROW_ICON_ONLY = 'md:mx-auto md:size-8 md:justify-center md:p-0';

/** The group heading: 10px, uppercase, widest tracking, muted. */
const GROUP_LABEL = 'px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-pv-muted-fg';

function Rail({
  pathname,
  collapsed,
  counts,
  onNavigate,
}: {
  pathname: string | null;
  collapsed: boolean;
  counts: Counts;
  onNavigate?: () => void;
}) {
  const { tenant } = useTenant();
  const gigDriver = (tenant as { gig_driver_enabled?: boolean | null } | null)?.gig_driver_enabled === true;

  const groups = PORTAL_V2_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.requires !== 'gig_driver' || gigDriver),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <div className="shrink-0 p-1.5 pt-4">
        <OrgRow collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      <nav aria-label="Portal" className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pt-1">
        {groups.map((group, index) => (
          <div key={group.label ?? index} className={cn('flex flex-col p-1.5', group.label ? 'pb-2 pt-1' : 'pb-0')}>
            {group.label && !collapsed ? <p className={GROUP_LABEL}>{group.label}</p> : null}
            <ul className="flex w-full min-w-0 flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.href} className="relative">
                  <NavRow
                    item={item}
                    active={isPortalV2Active(item.href, pathname)}
                    collapsed={collapsed}
                    count={item.badge ? counts[item.badge] : 0}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
            {/* The operator's hairline under the top-level row. */}
            {!group.label && !collapsed ? <div className="mx-2 mt-1.5 h-px bg-pv-sidebar-border/60" /> : null}
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 flex-col gap-2 p-1.5 pb-2">
        <BookCta collapsed={collapsed} onNavigate={onNavigate} />
        <ProfileRow collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  count,
  onNavigate,
}: {
  item: PortalV2NavItem;
  active: boolean;
  collapsed: boolean;
  count: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const label = count > 0 ? `${item.label}, ${count} unread` : item.label;

  const row = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed || count > 0 ? label : undefined}
      className={cn(NAV_ROW, active ? NAV_ROW_ACTIVE : NAV_ROW_REST, collapsed && NAV_ROW_ICON_ONLY)}
    >
      <Icon
        aria-hidden
        className={cn(
          'size-[17px] shrink-0 transition-colors duration-200 motion-reduce:transition-none',
          active ? 'text-pv-primary' : 'text-pv-sidebar-fg/60 group-hover/row:text-pv-primary',
        )}
      />
      {collapsed ? null : (
        <span className="pv2-nav-label min-w-0 flex-1 truncate text-[15px] md:text-[13px]">{item.label}</span>
      )}
      {count > 0 && !collapsed ? (
        <span
          aria-hidden
          className="ml-auto inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-pv-danger px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
      {count > 0 && collapsed ? (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pv-danger px-0.5 text-[10px] font-bold leading-none tabular-nums text-white"
        >
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Link>
  );

  return collapsed ? (
    <Tip label={item.label} side="right">
      {row}
    </Tip>
  ) : (
    row
  );
}

/**
 * The org row (org-switcher.tsx): a 32px rounded-lg mark and the name at 13px
 * semibold, the whole row hovering with the light tint. Here it leads back to
 * the tenant's website — the customer's way out of their account.
 */
function OrgRow({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { appName, faviconUrl } = useTenantBranding();
  const name = appName ?? 'Your account';
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase() || 'A';

  const mark = faviconUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={faviconUrl} alt="" className="size-8 shrink-0 rounded-lg object-contain" />
  ) : (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-pv-primary text-[12px] font-semibold text-pv-primary-fg">
      {initials}
    </span>
  );

  const ROW =
    'group/site flex w-full cursor-pointer items-center rounded-lg outline-none transition-colors duration-200 ' +
    'hover:bg-pv-primary/10 focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none';

  if (collapsed) {
    return (
      <Tip label={`${name} website`} side="right">
        <Link href="/" onClick={onNavigate} aria-label={`Back to the ${name} website`} className={cn(ROW, 'justify-center p-1.5')}>
          {mark}
        </Link>
      </Tip>
    );
  }

  return (
    <Link href="/" onClick={onNavigate} title="Back to the website" className={cn(ROW, 'gap-2.5 p-1.5')}>
      {mark}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight text-pv-fg">{name}</span>
        <span className="block truncate text-[11px] leading-tight text-pv-muted-fg">Your account</span>
      </span>
      {/* The operator row's 28px control, fading in with the row's hover. */}
      <span
        aria-hidden
        className="mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-pv-muted-fg opacity-0 transition-opacity duration-200 ease-in group-hover/site:opacity-100 group-hover/site:ease-out group-focus-visible/site:opacity-100 motion-reduce:transition-none"
      >
        <ArrowUpRight className="size-4" />
      </span>
    </Link>
  );
}

/**
 * The operator ui-v2 primary Button's look: the rail's "Book a car", and the
 * same action in a page header (sized there with HEADER_PRIMARY_V2).
 */
export const PRIMARY_CTA =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-pv-primary text-sm font-medium text-pv-primary-fg ' +
  'transition-colors duration-200 hover:bg-pv-primary/80 active:translate-y-px motion-reduce:transition-none ' +
  'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-pv-ring/30';

/** The rail's one call to action, as the operator ui-v2 primary Button. */
function BookCta({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const CTA = PRIMARY_CTA;

  if (collapsed) {
    return (
      <Tip label="Book a car" side="right">
        <QuickBookTrigger onClick={onNavigate} aria-label="Book a car" className={cn(CTA, 'mx-auto size-8')}>
          <Plus aria-hidden className="size-4" />
        </QuickBookTrigger>
      </Tip>
    );
  }

  return (
    <QuickBookTrigger onClick={onNavigate} className={cn(CTA, 'h-11 w-full px-3 md:h-9')}>
      <Plus aria-hidden className="size-4" />
      Book a car
    </QuickBookTrigger>
  );
}

/* ─────────────────────────── profile row + menu ────────────────────────── */

/** A light square button beside the profile (user-menu-v2.tsx). */
const ROW_CONTROL =
  'shrink-0 cursor-pointer rounded-lg p-1.5 text-pv-muted-fg outline-none transition-colors duration-200 ' +
  'hover:bg-pv-primary/10 hover:text-pv-primary focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none';

function Avatar({ initials, size = 'md' }: { initials: string | null; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-pv-primary/10 text-xs text-pv-primary',
        size === 'lg' ? 'size-9 font-semibold ring-2 ring-pv-border/50' : 'size-8 font-medium',
      )}
    >
      {initials ?? '·'}
    </span>
  );
}

/**
 * The profile row at the foot of the rail: avatar, name and email, then the
 * Settings gear and the menu caret, as one hover group. Collapsed, the gear
 * stacks above the avatar.
 */
function ProfileRow({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { displayName, email, initials } = useCustomer();
  const [open, setOpen] = useState(false);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        <Tip label="Settings" side="right">
          <Link href="/portal/settings" onClick={onNavigate} aria-label="Settings" className={cn(ROW_CONTROL, 'flex size-8 items-center justify-center p-0')}>
            <Settings className="size-4" />
          </Link>
        </Tip>
        <AccountMenu open={open} onOpenChange={setOpen} side="right" align="end" onNavigate={onNavigate}>
          <button type="button" aria-label="Your account" className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50">
            <Avatar initials={initials} />
          </button>
        </AccountMenu>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex w-full items-center rounded-lg pr-1 transition-colors duration-200 hover:bg-pv-primary/10 motion-reduce:transition-none',
        open && 'bg-pv-primary/10',
      )}
    >
      <AccountMenu open={open} onOpenChange={setOpen} side="top" align="start" onNavigate={onNavigate}>
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50">
          <Avatar initials={initials} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight text-pv-fg">{displayName ?? 'Your account'}</span>
            {email ? <span className="block truncate text-[11px] leading-tight text-pv-muted-fg">{email}</span> : null}
          </span>
        </button>
      </AccountMenu>
      <Link href="/portal/settings" onClick={onNavigate} aria-label="Settings" title="Settings" className={ROW_CONTROL}>
        <Settings className="size-4" />
      </Link>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open account menu"
        className={ROW_CONTROL}
      >
        <ChevronsUpDown className="size-4" />
      </button>
    </div>
  );
}

const MENU_ITEM =
  'flex cursor-pointer select-none items-center rounded-lg px-2.5 py-1.5 text-[13px] text-pv-fg outline-none ' +
  'transition-colors duration-200 data-[highlighted]:bg-pv-hover motion-reduce:transition-none';

/** The operator's user menu (user-menu-v2.tsx): header, then plain rows. */
function AccountMenu({
  open,
  onOpenChange,
  side,
  align,
  onNavigate,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'top' | 'right' | 'bottom';
  align: 'start' | 'end';
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { displayName, email, initials, signOut } = useCustomer();
  const { appName } = useTenantBranding();
  const [signingOut, setSigningOut] = useState(false);

  const go = (href: string) => {
    onNavigate?.();
    router.push(href);
  };

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      // Home, not /login, and `replace` so Back does not land in the gate.
      router.replace('/');
    }
  }, [router, signOut]);

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align={align}
          sideOffset={8}
          className={cn('z-50 w-64 overflow-hidden rounded-xl border border-pv-border bg-pv-card p-0 text-pv-fg shadow-lg outline-none', MOTION_ANCHORED)}
        >
          <div className="flex items-center gap-2.5 p-2.5 pb-2">
            <Avatar initials={initials} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-tight">{displayName ?? 'Your account'}</p>
              {email ? <p className="truncate text-[11px] leading-tight text-pv-muted-fg/70">{email}</p> : null}
            </div>
          </div>
          <DropdownMenu.Separator className="h-px bg-pv-border" />
          <div className="p-1.5">
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => go('/portal/settings')}>
              <Settings className="mr-2.5 size-4 text-pv-muted-fg" />
              Settings
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => go('/portal/bookings')}>
              <CalendarDays className="mr-2.5 size-4 text-pv-muted-fg" />
              Your bookings
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => go('/')}>
              <ArrowUpRight className="mr-2.5 size-4 text-pv-muted-fg" />
              {appName ? `${appName} website` : 'Back to the website'}
            </DropdownMenu.Item>
          </div>
          <DropdownMenu.Separator className="h-px bg-pv-border" />
          <div className="p-1.5">
            <DropdownMenu.Item
              disabled={signingOut}
              onSelect={(event) => {
                event.preventDefault();
                void handleSignOut();
              }}
              className={cn(MENU_ITEM, 'text-pv-danger data-[highlighted]:bg-pv-danger/10 data-[disabled]:cursor-wait data-[disabled]:opacity-60')}
            >
              <LogOut className="mr-2.5 size-4" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ──────────────────────────────── top bar ──────────────────────────────── */

/** The operator's search pill (top-bar-v2.tsx, FIELD). */
const FIELD =
  'group relative flex h-8 w-full max-w-[380px] cursor-pointer items-center gap-2 overflow-hidden rounded-full ' +
  'border border-pv-primary/25 bg-pv-primary/[0.07] px-2.5 text-left backdrop-blur-[2px] transition-colors duration-200 ' +
  'hover:border-pv-primary/40 hover:bg-pv-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none';

function TopBar({
  counts,
  onOpenNav,
  onOpenSearch,
}: {
  counts: Counts;
  onOpenNav: () => void;
  onOpenSearch: () => void;
}) {
  const { initials } = useCustomer();
  const [menuOpen, setMenuOpen] = useState(false);
  // A list page (Bookings) lends the bar its own field: it filters that list as
  // you type, and "Search everywhere" / ⌘K hand off to the search dialog.
  // Everywhere else the bar keeps the pill that opens the dialog.
  const slot = usePageSearchSlot();

  // No title here: every page carries its own big heading, as on the operator portal v2.
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 bg-transparent px-3 sm:px-4">
      <button type="button" onClick={onOpenNav} aria-label="Open menu" className={cn(ICON_BUTTON, '-ml-1 md:hidden')}>
        <Menu aria-hidden className="size-4" />
      </button>

      {slot ? (
        <div className="hidden w-full max-w-[440px] sm:block">
          <SearchField slot={slot} onSearchEverywhere={onOpenSearch} />
        </div>
      ) : (
        <button type="button" onClick={onOpenSearch} aria-label="Search" className={cn(FIELD, 'hidden sm:flex')}>
          <Search aria-hidden className="size-4 shrink-0 text-pv-primary" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-pv-muted-on-tint">Search your bookings…</span>
          <kbd className="shrink-0 rounded-full bg-pv-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-pv-primary">
            ⌘K
          </kbd>
        </button>
      )}
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search"
        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-pv-primary/25 bg-pv-primary/[0.07] text-pv-primary sm:hidden"
      >
        <Search aria-hidden className="size-4" />
      </button>

      {/* Order as on the operator bar: messages, then notifications at the far
          right. The phone, which has no rail, adds the account avatar after. */}
      <div className="ml-auto flex items-center gap-0.5">
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-pv-border sm:block" />
        <Tip label="Messages">
          <Link
            href="/portal/messages"
            aria-label={counts.messages > 0 ? `Messages, ${counts.messages} unread` : 'Messages'}
            className={ICON_BUTTON}
          >
            <MessageCircle aria-hidden className="size-4" />
            <TopBadge count={counts.messages} />
          </Link>
        </Tip>
        <Tip label="Notifications">
          <Link
            href="/portal/notifications"
            aria-label={counts.notifications > 0 ? `Notifications, ${counts.notifications} unread` : 'Notifications'}
            className={ICON_BUTTON}
          >
            <Bell aria-hidden className="size-4" />
            <TopBadge count={counts.notifications} />
          </Link>
        </Tip>
        <div className="ml-1 md:hidden">
          <AccountMenu open={menuOpen} onOpenChange={setMenuOpen} side="bottom" align="end">
            <button type="button" aria-label="Your account" className="flex cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50">
              <Avatar initials={initials} />
            </button>
          </AccountMenu>
        </div>
      </div>
    </header>
  );
}

/* ───────────────────────────────── search ──────────────────────────────── */

interface SearchResult {
  key: string;
  group: 'Bookings' | 'Pages';
  title: string;
  subtitle: string;
  href: string;
}

/**
 * ⌘K. It searches what a customer has — their own bookings, by reference,
 * car or plate — and the portal's pages. Nothing else, so it never promises a
 * result it cannot find. Mounted only while open, so a closed search costs no
 * query.
 */
function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] max-w-xl translate-y-0 gap-0 overflow-hidden border-pv-border bg-pv-card p-0 shadow-lg sm:top-[14vh]"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search your bookings and pages. Use the up and down arrows to move, Enter to open.
        </DialogDescription>
        {open ? <SearchBody onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SearchBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { tenant } = useTenant();
  const { rentals, isLoading } = useCustomerRentals();
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const gigDriver = (tenant as { gig_driver_enabled?: boolean | null } | null)?.gig_driver_enabled === true;

  const results = useMemo<SearchResult[]>(() => {
    const q = term.trim().toLowerCase();
    const bookings = rentals
      .filter((rental) => {
        if (!q) return true;
        return [rental.reference, rental.vehicle?.displayName, rental.vehicle?.registration]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .slice(0, q ? 8 : 5)
      .map<SearchResult>((rental) => ({
        key: `booking-${rental.id}`,
        group: 'Bookings',
        title: rental.vehicle?.displayName ?? 'Booking',
        subtitle: rental.reference,
        href: `/portal/bookings/${rental.id}`,
      }));
    const pages = PORTAL_V2_ITEMS.filter((item) => item.requires !== 'gig_driver' || gigDriver)
      .filter((item) => !q || item.label.toLowerCase().includes(q))
      .map<SearchResult>((item) => ({
        key: `page-${item.href}`,
        group: 'Pages',
        title: item.label,
        subtitle: 'Page',
        href: item.href,
      }));
    return [...bookings, ...pages];
  }, [gigDriver, rentals, term]);

  useEffect(() => setSelected(0), [term]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const openResult = (result: SearchResult | undefined) => {
    if (!result) return;
    onDone();
    router.push(result.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openResult(results[selected]);
    }
  };

  const groups = (['Bookings', 'Pages'] as const)
    .map((name) => ({ name, items: results.filter((result) => result.group === name) }))
    .filter((group) => group.items.length > 0);

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b border-pv-border px-4 py-3">
        <Search aria-hidden className="size-4 shrink-0 text-pv-primary" />
        <input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by booking reference, car or page"
          aria-label="Search"
          className="h-8 min-w-0 flex-1 bg-transparent text-[15px] font-medium text-pv-fg outline-none placeholder:font-medium placeholder:text-pv-muted-fg sm:text-sm"
        />
        <kbd className="hidden shrink-0 rounded-full bg-pv-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-pv-primary sm:block">
          Esc
        </kbd>
      </div>

      <div ref={listRef} className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
        {groups.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-semibold text-pv-fg">{isLoading ? 'Looking…' : 'Nothing found'}</p>
            {isLoading ? null : (
              <p className="mt-1 text-xs text-pv-muted-fg">
                No booking or page matches <span className="font-medium text-pv-fg">&ldquo;{term.trim()}&rdquo;</span>. Try a
                booking reference such as R-1234, or the name of the car.
              </p>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.name} className="mb-2 last:mb-0">
              <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-pv-muted-fg/80">{group.name}</p>
              {group.items.map((result) => {
                const index = results.indexOf(result);
                const isSelected = index === selected;
                return (
                  <button
                    key={result.key}
                    type="button"
                    data-index={index}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => openResult(result)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-200 motion-reduce:transition-none',
                      isSelected && NAV_ROW_ACTIVE,
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13px] font-medium', isSelected ? 'text-pv-primary' : 'text-pv-fg')}>
                        {result.title}
                      </span>
                      <span className="block truncate text-[11px] text-pv-muted-fg">{result.subtitle}</span>
                    </span>
                    {isSelected ? <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-pv-muted-fg" /> : null}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
