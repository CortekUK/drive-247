'use client';

/**
 * Customer portal v2's frame — the operator portal v2's chrome, for customers:
 * a transparent rail over the brand wash (app-sidebar-v2.tsx), a 64px top bar
 * (top-bar-v2.tsx), and one content column that is the only thing that scrolls
 * (the v2 fixed frame).
 *
 * Copied, not approximated: the rail's row metrics, hover and active ring, the
 * org row at the top with the customiser and the booking-site arrow, the
 * profile row and its menu at the bottom, ⌘B to collapse to icons, the search
 * pill with ⌘K, and the top bar's helpline, Help, messages and notifications.
 * The rail is ONE list, straight through (owner, Oct 21 2026), with the
 * operator's names and icons. One primary action in the rail (Book a car);
 * no operator-only controls (credits, Trax).
 *
 * The gate is the current portal's, unchanged in substance: children never
 * mount until the customer is signed in for THIS tenant, so no page fires a
 * query against a missing or stale customer id. Data scoping still lives in the
 * hooks (`customer_id` AND `tenant_id` on every query); the one query this file
 * runs itself (the unread-message count) carries both too.
 */

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ChevronsUpDown,
  CornerDownLeft,
  ExternalLink,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
} from 'lucide-react-nw';

import { PortalBoot } from '@nw/components/portal/portal-boot';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nw/components/ui/dialog';
import { MOTION_ANCHORED, MOTION_TOOLTIP } from '@nw/components/ui/motion';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@nw/components/ui/sheet';
import { Switch } from '@nw/components/ui/switch';
import { MessagesSheet, NotificationsSheet } from '@nw/portal-v2/top-bar-sheets';
import { useCustomerAuth } from '@nw/contexts/CustomerAuthContext';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerNotifications } from '@nw/hooks/use-customer-notifications';
import { useCustomerRentals } from '@nw/hooks/use-customer-rentals';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { supabase } from '@nw/integrations/supabase/client';
import { cn } from '@nw/lib/utils';
import { QuickBookProvider, QuickBookTrigger } from '@nw/site-v2/quick-book/quick-book-dialog';
import { V2_BUTTON_PRIMARY } from '@portal-v2-shared/button-styles';
import { PageSearchProvider, usePageSearchSlot } from '@portal-v2-shared/page-search-slot';
import { SearchField } from '@portal-v2-shared/search-field';

import { brandHslVars } from './brand';
import { HelpButton, HelplineLink } from './help-menu';
import { CustomerTraxProvider } from './trax/trax-context';
import { CustomerTraxPanel } from './trax/trax-panel';
import { PayProvider } from './pay/pay-provider';
import {
  PORTAL_V2_BASE,
  PORTAL_V2_EXTRA_PAGES,
  PORTAL_V2_ITEMS,
  arrangePortalV2Nav,
  isPortalV2Active,
  type PortalV2NavItem,
} from './nav';
import { SidebarCustomizerDialog, usePortalV2NavPreferences } from './sidebar-customizer';
import { useRecordPolicyConsent } from './policy-consent';
import { usePortalThemeRoot, type PortalTheme } from './theme';

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
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const { theme, setTheme } = usePortalThemeRoot();
  useRecordPolicyConsent();
  const brandVars = brandHslVars(tenant?.primary_color);

  const onMessages = isPortalV2Active('/portal/messages', pathname);
  const messages = useUnreadMessageCount(onMessages);
  // The top bar's two sheets, as on the operator portal: the bell opens the
  // notification centre and the chat icon the messages sheet.
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  // `/portal/notifications` (the old page's address, still in sent links)
  // lands on Home with `?panel=notifications`: open the sheet, then drop the
  // parameter so a refresh does not open it again.
  const router = useRouter();
  const searchParams = useSearchParams();
  const panel = searchParams?.get('panel');
  useEffect(() => {
    if (panel !== 'notifications') return;
    setNotificationsOpen(true);
    router.replace(pathname ?? '/portal');
  }, [panel, pathname, router]);
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
      <CustomerTraxProvider>
      <QuickBookProvider>
      {/* The one payment path, for every Pay button in the portal. */}
      <PayProvider>
        <div
          className={cn('pv2 flex h-dvh overflow-hidden', fontClass)}
          style={(brandVars ?? undefined) as React.CSSProperties | undefined}
        >
          {/* Desktop rail: 16rem, or 3rem of icons. Paints no fill of its own —
              it sits on the page wash, as the operator's does. */}
          {/* Messages is the operator's full-window workspace: no rail and no
              top bar, the conversation rail carrying the way back. */}
          {onMessages ? null : (
          <aside
            data-state={collapsed ? 'collapsed' : 'expanded'}
            className={cn(
              'relative hidden shrink-0 flex-col transition-[width] duration-200 ease-linear motion-reduce:transition-none md:flex',
              collapsed ? 'w-12' : 'w-64',
            )}
          >
            <Rail pathname={pathname} collapsed={collapsed} theme={theme} onThemeChange={setTheme} onCustomize={() => setCustomizerOpen(true)} />
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
          )}

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
                <Rail
                  pathname={pathname}
                  collapsed={false}
                  theme={theme}
                  onThemeChange={setTheme}
                  onCustomize={() => setCustomizerOpen(true)}
                  onNavigate={() => setNavOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          {/* A list page lends the top bar its search field and filter button,
              as on the operator portal (shared/portal-v2/page-search-slot). */}
          <PageSearchProvider>
          <div className="flex min-w-0 flex-1 flex-col">
            {onMessages ? (
              // The workspace fills the window and scrolls inside its columns.
              <main className="min-h-0 flex-1 overflow-hidden outline-none">
                <div key={pathname} className="pv2-enter h-full">
                  {children}
                </div>
              </main>
            ) : (
              <>
                <TopBar
                  counts={counts}
                  theme={theme}
                  onThemeChange={setTheme}
                  onOpenNav={() => setNavOpen(true)}
                  onOpenSearch={() => setSearchOpen(true)}
                  onOpenMessages={() => setMessagesOpen(true)}
                  onOpenNotifications={() => setNotificationsOpen(true)}
                />
                <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-10 pt-2 outline-none sm:px-6 md:pl-4">
                  {/* Keyed on the path so every screen arrives with the Trax lift. */}
                  <div key={pathname} className="pv2-enter mx-auto w-full max-w-[1200px]">
                    {children}
                  </div>
                </main>
              </>
            )}
          </div>
          </PageSearchProvider>

          <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
          <SidebarCustomizerDialog open={customizerOpen} onOpenChange={setCustomizerOpen} />
          <NotificationsSheet open={notificationsOpen} onOpenChange={setNotificationsOpen} />
          <MessagesSheet open={messagesOpen} onOpenChange={setMessagesOpen} unread={counts.messages} />
          <CustomerTraxPanel />
        </div>
      </PayProvider>
      </QuickBookProvider>
      </CustomerTraxProvider>
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

function Rail({
  pathname,
  collapsed,
  theme,
  onThemeChange,
  onCustomize,
  onNavigate,
}: {
  pathname: string | null;
  collapsed: boolean;
  theme: PortalTheme;
  onThemeChange: (theme: PortalTheme) => void;
  onCustomize: () => void;
  onNavigate?: () => void;
}) {
  const { preferences } = usePortalV2NavPreferences();
  const items = arrangePortalV2Nav(preferences).shown;

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 p-1.5 pt-4">
        <OrgRow collapsed={collapsed} onNavigate={onNavigate} onCustomize={onCustomize} />
        {/* The one call to action leads the rail, under the org row (owner, Oct 22 2026). */}
        <BookCta collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      {/* One list, straight through: no group headings, no split. */}
      <nav aria-label="Portal" className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <ul className="flex w-full min-w-0 flex-col gap-0.5 p-1.5">
          {items.map((item) => (
            <li key={item.href} className="relative">
              <NavRow item={item} active={isPortalV2Active(item.href, pathname)} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex shrink-0 flex-col gap-2 p-1.5 pb-2">
        <ProfileRow collapsed={collapsed} theme={theme} onThemeChange={onThemeChange} onNavigate={onNavigate} />
      </div>
    </>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: PortalV2NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  const row = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
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
 * The org row, as the operator's (org-switcher.tsx): the mark and the name,
 * then — pinned to the row's right edge — the sidebar customiser and the
 * booking-site arrow, both always visible, in the operator's 28px rounded-lg
 * boxes. The mark and the name lead back to the tenant's website, as they
 * always have here; the arrow opens it in a new tab, as the operator's does.
 */
const ORG_CONTROL =
  'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-pv-muted-fg outline-none transition-colors duration-200 ' +
  'hover:bg-pv-primary/10 hover:text-pv-primary focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none';

function OrgRow({ collapsed, onNavigate, onCustomize }: { collapsed: boolean; onNavigate?: () => void; onCustomize: () => void }) {
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

  if (collapsed) {
    return (
      <Tip label={`${name} website`} side="right">
        <Link
          href="/"
          onClick={onNavigate}
          aria-label={`Back to the ${name} website`}
          className="flex w-full cursor-pointer items-center justify-center rounded-lg p-1.5 outline-none transition-colors duration-200 hover:bg-pv-primary/10 focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none"
        >
          {mark}
        </Link>
      </Tip>
    );
  }

  return (
    <div className="flex items-center rounded-lg transition-colors duration-200 hover:bg-pv-primary/10 motion-reduce:transition-none">
      <Link
        href="/"
        onClick={onNavigate}
        title="Back to the website"
        className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50"
      >
        {mark}
        <span className="min-w-0 truncate text-[13px] font-semibold leading-tight text-pv-fg">{name}</span>
      </Link>
      <span aria-hidden className="flex-1" />
      {/* Opens a dialog over the phone drawer, so it does not close the drawer. */}
      <button type="button" onClick={onCustomize} aria-label="Customise sidebar" title="Customise sidebar" className={ORG_CONTROL}>
        <SlidersHorizontal aria-hidden className="size-3.5" />
      </button>
      <a
        href="/"
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        aria-label={`Open the ${name} website (opens in a new tab)`}
        title="Open the website"
        className={ORG_CONTROL}
      >
        <ExternalLink aria-hidden className="size-3.5" />
      </a>
    </div>
  );
}

/**
 * The rail's one call to action, at the top of the rail: the operator's
 * primary Button (shared V2_BUTTON_PRIMARY — the gradient, 36px, 14px medium)
 * stretched to the rail, with the rail rows' 8px radius rather than the pill,
 * so it reads as part of the rail. 44px on a phone, the touch floor.
 */
const BOOK_CTA_SHAPE = 'rounded-lg';
function BookCta({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  if (collapsed) {
    return (
      <Tip label="Book a car" side="right">
        <QuickBookTrigger onClick={onNavigate} aria-label="Book a car" className={cn(V2_BUTTON_PRIMARY, BOOK_CTA_SHAPE, 'mx-auto size-8 gap-0 px-0')}>
          <Plus aria-hidden />
        </QuickBookTrigger>
      </Tip>
    );
  }

  return (
    <QuickBookTrigger onClick={onNavigate} className={cn(V2_BUTTON_PRIMARY, BOOK_CTA_SHAPE, 'h-11 w-full md:h-9')}>
      <Plus aria-hidden />
      Book a car
    </QuickBookTrigger>
  );
}

/* ─────────────────────────── profile row + menu ────────────────────────── */

/** A light square button beside the profile (user-menu-v2.tsx). */
const ROW_CONTROL =
  'shrink-0 cursor-pointer rounded-lg p-1.5 text-pv-muted-fg outline-none transition-colors duration-200 ' +
  'hover:bg-pv-primary/10 hover:text-pv-primary focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none';

function Avatar({ initials, photo, size = 'md' }: { initials: string | null; photo?: string | null; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-pv-primary/10 text-xs text-pv-primary',
        size === 'lg' ? 'size-9 font-semibold ring-2 ring-pv-border/50' : 'size-8 font-medium',
      )}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="size-full object-cover" />
      ) : (
        initials ?? '·'
      )}
    </span>
  );
}

/**
 * The profile row at the foot of the rail: avatar, name and email, then the
 * Settings gear and the menu caret, as one hover group — the operator's row.
 * The gear is the way into Settings; there is no Settings tab. Collapsed, the
 * gear stacks above the avatar.
 */
function ProfileRow({
  collapsed,
  theme,
  onThemeChange,
  onNavigate,
}: {
  collapsed: boolean;
  theme: PortalTheme;
  onThemeChange: (theme: PortalTheme) => void;
  onNavigate?: () => void;
}) {
  const { displayName, email, initials, customer } = useCustomer();
  const photo = customer?.profile_photo_url ?? null;
  const [open, setOpen] = useState(false);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-1">
        <Tip label="Settings" side="right">
          <Link href="/portal/settings" onClick={onNavigate} aria-label="Settings" className={cn(ROW_CONTROL, 'flex size-8 items-center justify-center p-0')}>
            <Settings className="size-4" />
          </Link>
        </Tip>
        <AccountMenu open={open} onOpenChange={setOpen} side="right" align="end" theme={theme} onThemeChange={onThemeChange}>
          <button type="button" aria-label="Your account" className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50">
            <Avatar initials={initials} photo={photo} />
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
      <AccountMenu open={open} onOpenChange={setOpen} side="top" align="start" theme={theme} onThemeChange={onThemeChange}>
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50">
          <Avatar initials={initials} photo={photo} />
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
        onPointerDown={(event) => event.stopPropagation()}
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

/**
 * The operator's user menu (user-menu-v2.tsx), cut to what a customer needs:
 * the header, Dark mode with its switch, and Sign out. Settings is the gear
 * beside the row; Rentals and the website are in the rail.
 */
function AccountMenu({
  open,
  onOpenChange,
  side,
  align,
  theme,
  onThemeChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'top' | 'right' | 'bottom';
  align: 'start' | 'end';
  theme: PortalTheme;
  onThemeChange: (theme: PortalTheme) => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { displayName, email, initials, signOut, customer } = useCustomer();
  const [signingOut, setSigningOut] = useState(false);
  const isDark = theme === 'dark';

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
            <Avatar initials={initials} photo={customer?.profile_photo_url ?? null} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-tight">{displayName ?? 'Your account'}</p>
              {email ? <p className="truncate text-[11px] leading-tight text-pv-muted-fg/70">{email}</p> : null}
            </div>
          </div>
          <DropdownMenu.Separator className="h-px bg-pv-border" />
          <div className="p-1.5">
            <DropdownMenu.Item
              className={MENU_ITEM}
              onSelect={(event) => {
                event.preventDefault();
                onThemeChange(isDark ? 'light' : 'dark');
              }}
            >
              {isDark ? <Sun className="mr-2.5 size-4 text-pv-muted-fg" /> : <Moon className="mr-2.5 size-4 text-pv-muted-fg" />}
              <span>Dark mode</span>
              <Switch checked={isDark} tabIndex={-1} aria-hidden className="pointer-events-none ml-auto data-[state=checked]:bg-pv-primary" />
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
  theme,
  onThemeChange,
  onOpenNav,
  onOpenSearch,
  onOpenMessages,
  onOpenNotifications,
}: {
  counts: Counts;
  theme: PortalTheme;
  onThemeChange: (theme: PortalTheme) => void;
  onOpenNav: () => void;
  onOpenSearch: () => void;
  onOpenMessages: () => void;
  onOpenNotifications: () => void;
}) {
  const { initials, customer } = useCustomer();
  const [menuOpen, setMenuOpen] = useState(false);
  // A list page (Rentals) lends the bar its own field: it filters that list as
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
          <span className="min-w-0 flex-1 truncate text-[13px] text-pv-muted-on-tint">Search your rentals…</span>
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

      {/* Order as on the operator bar: the helpline and Help, then messages,
          then notifications at the far right. The phone, which has no rail,
          adds the account avatar after. */}
      <div className="ml-auto flex items-center gap-0.5">
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-pv-border sm:block" />
        <HelplineLink />
        <HelpButton />
        <Tip label="Messages">
          <button
            type="button"
            onClick={onOpenMessages}
            aria-haspopup="dialog"
            aria-label={counts.messages > 0 ? `Messages, ${counts.messages} unread` : 'Messages'}
            className={ICON_BUTTON}
          >
            <MessageCircle aria-hidden className="size-4" />
            <TopBadge count={counts.messages} />
          </button>
        </Tip>
        <Tip label="Notifications">
          <button
            type="button"
            onClick={onOpenNotifications}
            aria-haspopup="dialog"
            aria-label={counts.notifications > 0 ? `Notifications, ${counts.notifications} unread` : 'Notifications'}
            className={ICON_BUTTON}
          >
            <Bell aria-hidden className="size-4" />
            <TopBadge count={counts.notifications} />
          </button>
        </Tip>
        <div className="ml-1 md:hidden">
          <AccountMenu open={menuOpen} onOpenChange={setMenuOpen} side="bottom" align="end" theme={theme} onThemeChange={onThemeChange}>
            <button type="button" aria-label="Your account" className="flex cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50">
              <Avatar initials={initials} photo={customer?.profile_photo_url ?? null} />
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
  group: 'Rentals' | 'Pages';
  title: string;
  subtitle: string;
  href: string;
}

/**
 * ⌘K. It searches what a customer has — their own rentals, by reference,
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
          Search your rentals and pages. Use the up and down arrows to move, Enter to open.
        </DialogDescription>
        {open ? <SearchBody onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SearchBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { rentals, isLoading } = useCustomerRentals();
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
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
        group: 'Rentals',
        title: rental.vehicle?.displayName ?? 'Rental',
        subtitle: rental.reference,
        href: `/portal/rentals/${rental.id}`,
      }));
    const pages = [...PORTAL_V2_ITEMS, ...PORTAL_V2_EXTRA_PAGES]
      .filter((item) => !q || item.label.toLowerCase().includes(q))
      .map<SearchResult>((item) => ({
        key: `page-${item.href}`,
        group: 'Pages',
        title: item.label,
        subtitle: 'Page',
        href: item.href,
      }));
    return [...bookings, ...pages];
  }, [rentals, term]);

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

  const groups = (['Rentals', 'Pages'] as const)
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
          placeholder="Search by rental reference, car or page"
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
                No rental or page matches <span className="font-medium text-pv-fg">&ldquo;{term.trim()}&rdquo;</span>. Try a
                rental reference such as R-1b710f, or the name of the car.
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
