'use client';

/**
 * Customer portal v2's frame — the operator portal v2's chrome, for customers:
 * a transparent rail over the brand wash, a 64px top bar, and one content
 * column that is the only thing that scrolls (the v2 fixed frame).
 *
 * The gate is the current portal's, unchanged in substance: children never
 * mount until the customer is signed in for THIS tenant, so no page fires a
 * query against a missing or stale customer id. Data scoping still lives in the
 * hooks (`customer_id` AND `tenant_id` on every query).
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Bell, LogOut, Menu, MessageSquare, Plus } from 'lucide-react-nw';

import { PortalBoot } from '@nw/components/portal/portal-boot';
import { Popover, PopoverContent, PopoverTrigger } from '@nw/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@nw/components/ui/sheet';
import { useCustomerAuth } from '@nw/contexts/CustomerAuthContext';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';

import { brandHslVars } from './brand';
import { PORTAL_V2_BASE, PORTAL_V2_NAV, isPortalV2Active } from './nav';

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

/* ───────────────────────────────── shell ───────────────────────────────── */

function PortalV2Shell({ fontClass, children }: { fontClass: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const { tenant } = useTenant();
  const [navOpen, setNavOpen] = useState(false);
  const brandVars = brandHslVars(tenant?.primary_color);

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

  return (
    <div
      className={cn('pv2 flex h-dvh overflow-hidden', fontClass)}
      style={(brandVars ?? undefined) as React.CSSProperties | undefined}
    >
      {/* Desktop rail. Paints no fill of its own — it sits on the page wash. */}
      <aside className="hidden w-64 shrink-0 flex-col md:flex">
        <Rail pathname={pathname} />
      </aside>

      {/* Phone: the same rail in a drawer, opened from the top bar. */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="pv2 w-72 border-0 p-0" style={(brandVars ?? undefined) as React.CSSProperties | undefined}>
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Your account pages</SheetDescription>
          <div className={cn('flex h-full flex-col', fontClass)}>
            <Rail pathname={pathname} onNavigate={() => setNavOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar pathname={pathname} onOpenNav={() => setNavOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 outline-none md:pl-2 md:pr-6">
          {/* Keyed on the path so every screen arrives with the Trax lift. */}
          <div key={pathname} className="pv2-enter mx-auto w-full max-w-[1200px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ───────────────────────────────── rail ────────────────────────────────── */

const NAV_ROW =
  'group flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors md:h-8 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30';

function Rail({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  const { appName, logoUrl } = useTenantBranding();

  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-4">
        {logoUrl ? (
          // A wordmark, not a square: give it its own width, and let the
          // logo stand for the name.
          <div className="min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt={appName ?? ''} className="h-6 w-auto max-w-[150px] object-contain object-left" />
            <p className="mt-0.5 truncate text-[11px] text-pv-muted-fg">Customer portal</p>
          </div>
        ) : (
          <>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-pv-primary text-sm font-semibold text-pv-primary-fg">
              {(appName ?? 'A').slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-pv-fg">{appName ?? 'Your account'}</p>
              <p className="truncate text-[11px] text-pv-muted-fg">Customer portal</p>
            </div>
          </>
        )}
      </div>

      <nav aria-label="Portal" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2.5 py-2">
        {PORTAL_V2_NAV.map((group, index) => (
          <div key={group.label ?? index} className="flex flex-col gap-0.5">
            {group.label ? (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-pv-muted-fg">
                {group.label}
              </p>
            ) : null}
            {group.items.map((item) => {
              const active = isPortalV2Active(item.href, pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    NAV_ROW,
                    active
                      ? 'bg-pv-primary/10 text-pv-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--pv-primary)_12%,transparent)]'
                      : 'text-pv-fg/70 hover:bg-pv-primary/10 hover:text-pv-primary',
                  )}
                >
                  <Icon
                    aria-hidden
                    strokeWidth={1.75}
                    className={cn(
                      'size-[18px] shrink-0 md:size-4',
                      active ? 'text-pv-primary' : 'text-pv-fg/60 group-hover:text-pv-primary',
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 p-2.5">
        <Link
          href="/booking"
          onClick={onNavigate}
          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-pv-primary text-[13px] font-semibold text-pv-primary-fg transition-colors hover:bg-pv-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 md:h-9"
        >
          <Plus aria-hidden className="size-4" />
          Book a car
        </Link>
      </div>
    </>
  );
}

/* ──────────────────────────────── top bar ──────────────────────────────── */

const ICON_BUTTON =
  'relative inline-flex size-9 items-center justify-center rounded-full text-pv-muted-fg transition-colors ' +
  'hover:bg-pv-primary/10 hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30';

function TopBar({ pathname, onOpenNav }: { pathname: string | null; onOpenNav: () => void }) {
  // No title here: every page carries its own big heading, as on the operator portal v2.
  void pathname;

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 px-4 md:pl-2 md:pr-6">
      <button type="button" onClick={onOpenNav} aria-label="Open menu" className={cn(ICON_BUTTON, '-ml-1 md:hidden')}>
        <Menu aria-hidden className="size-5" />
      </button>

      <div className="ml-auto flex items-center gap-0.5">
        <Link href="/portal-v2/messages" aria-label="Messages" className={ICON_BUTTON}>
          <MessageSquare aria-hidden className="size-4" />
        </Link>
        <Link href="/portal-v2/notifications" aria-label="Notifications" className={ICON_BUTTON}>
          <Bell aria-hidden className="size-4" />
        </Link>
        <AccountMenu />
      </div>
    </header>
  );
}

function AccountMenu() {
  const router = useRouter();
  const { displayName, email, initials, signOut } = useCustomer();
  const { tenant } = useTenant();
  const brandVars = brandHslVars(tenant?.primary_color);
  const [signingOut, setSigningOut] = useState(false);

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
    <Popover>
      <PopoverTrigger
        aria-label="Your account"
        className="ml-1.5 grid size-8 cursor-pointer place-items-center rounded-full bg-pv-primary text-xs font-semibold text-pv-primary-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30"
      >
        {initials ?? '·'}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        style={(brandVars ?? undefined) as React.CSSProperties | undefined}
        className="pv2 w-64 rounded-xl border border-pv-border bg-pv-card p-1.5 shadow-lg">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-semibold text-pv-fg">{displayName ?? 'Your account'}</p>
          {email ? <p className="truncate text-xs text-pv-muted-fg">{email}</p> : null}
        </div>
        <div className="my-1 h-px bg-pv-border" />
        <Link
          href="/portal-v2/settings"
          className="flex h-9 items-center rounded-lg px-2.5 text-[13px] text-pv-fg hover:bg-pv-tint"
        >
          Settings
        </Link>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-pv-danger hover:bg-pv-danger-light disabled:cursor-wait disabled:opacity-60"
        >
          <LogOut aria-hidden className="size-4" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </PopoverContent>
    </Popover>
  );
}
