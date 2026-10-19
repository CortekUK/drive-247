'use client';

/**
 * Northwind booking site v2 — the public site's frame, in the operator portal
 * v2's design language (the `.pv2` tokens in styles/site.css, shared with the
 * customer portal v2): Manrope, neutral surfaces over the brand wash, one
 * accent that follows the tenant's colour, pill buttons, 16px cards.
 *
 * Parity with v1's navbar / mobile-nav / brand-mark: the logo and name are
 * seeded by the server (layout.tsx), Blog appears only when the operator has it
 * switched on, and a signed-in customer sees their account instead of
 * "Sign in". The footer is a server component (site-footer.tsx) the layout
 * passes in, because it reads the CMS and the fleet on the server like v1's.
 *
 * Pages v2 has not built yet still open from the current site (see
 * V2_BUILT_SEGMENTS in src/lib/booking-design.ts), so the links below are all
 * live whatever is built.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CalendarDays, ChevronDown, LayoutGrid, LogOut, Menu, X } from 'lucide-react-nw';

import { BrandMark } from '@nw/components/layout/brand-mark';
import { Button } from '@nw/components/ui/button';
import { MOTION_ANCHORED } from '@nw/components/ui/motion';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@nw/components/ui/sheet';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { QuickBookProvider, QuickBookTrigger } from '@nw/site-v2/quick-book/quick-book-dialog';
import type { PageSections } from '@nw/lib/cms/types';
import { NAV_LINKS } from '@nw/lib/constants';
import { cn } from '@nw/lib/utils';
import { brandHslVars } from '@nw/portal-v2/brand';

import { SITE_CONTAINER } from './kit';

export function SiteV2Shell({
  fontClass,
  tenantName,
  siteSettings,
  blogEnabled = false,
  footer,
  children,
}: {
  fontClass: string;
  /** The server's tenant name, so the header is right in the first HTML. */
  tenantName: string | null;
  /** The server's `site-settings` sections — the logo, in the first HTML. */
  siteSettings?: PageSections | null;
  /** "Show blog on website". /blog 404s when off, so no link to it then. */
  blogEnabled?: boolean;
  /** The server-rendered footer (site-footer.tsx). */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { tenant } = useTenant();
  const brandVars = brandHslVars(tenant?.primary_color);

  // Dialogs and popovers portal to <body>, outside `.pv2`: give <body> the
  // same tokens, font and brand colour while the site is mounted.
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

  /* Blog sits before Contact, as in v1, so "Contact" stays the last item. */
  const links: ReadonlyArray<{ href: string; label: string }> = blogEnabled
    ? [...NAV_LINKS.slice(0, -1), { href: '/blog', label: 'Blog' }, NAV_LINKS[NAV_LINKS.length - 1]]
    : NAV_LINKS;

  return (
    <QuickBookProvider>
      <div
        className={cn('pv2 flex min-h-dvh flex-col overflow-x-clip', fontClass)}
        style={(brandVars ?? undefined) as React.CSSProperties | undefined}
      >
        <SiteHeader
          links={links}
          tenantName={tenantName}
          siteSettings={siteSettings}
          fontClass={fontClass}
          brandVars={brandVars}
        />
        <main className="pv2-enter flex-1">{children}</main>
        {footer}
      </div>
    </QuickBookProvider>
  );
}

/* ───────────────────────────────── header ──────────────────────────────── */

const NAV_ITEM =
  'inline-flex h-9 items-center whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-colors duration-200 ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none';

const MENU_ITEM =
  'flex cursor-pointer select-none items-center rounded-lg px-2.5 py-2 text-[13px] text-pv-fg outline-none ' +
  'transition-colors duration-200 data-[highlighted]:bg-pv-hover motion-reduce:transition-none';

/** The internal preview path (/northwind-site-v2/...) reads as the public one. */
const INTERNAL_PREFIX = /^\/northwind-site-v2(?=\/|$)/;

function isActive(pathname: string | null, href: string): boolean {
  const path = (pathname ?? '').replace(INTERNAL_PREFIX, '') || '/';
  if (href === '/') return path === '/';
  return path === href || path.startsWith(`${href}/`);
}

/**
 * v1's BrandMark — the CMS logo, then `tenants.logo_url`, then the name — sized
 * down to the v2 header. Reused rather than re-typed so the logo rules stay in
 * one place.
 */
function Brand({ tenantName, siteSettings }: { tenantName: string | null; siteSettings?: PageSections | null }) {
  return (
    <BrandMark
      seed={siteSettings}
      nameSeed={tenantName}
      withName
      className={cn(
        'min-w-0 shrink rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30',
        '[&_img]:max-h-8 [&_img]:max-w-[140px] [&_span]:truncate [&_span]:text-[15px] [&_span]:text-pv-fg',
      )}
    />
  );
}

function Avatar({ initials, size = 'md' }: { initials: string | null; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-pv-primary/10 font-semibold text-pv-primary',
        size === 'lg' ? 'size-9 text-xs' : 'size-7 text-[11px]',
      )}
    >
      {initials ?? '·'}
    </span>
  );
}

/** Sign out, then home — `replace` so Back does not land on a signed-in page. */
function useSignOut() {
  const router = useRouter();
  const { signOut } = useCustomer();
  const [signingOut, setSigningOut] = useState(false);
  const run = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
      router.replace('/');
    }
  }, [router, signOut]);
  return { signingOut, signOut: run };
}

/** The desktop account control: "Sign in" for a visitor, their menu for a customer. */
function AccountControl() {
  const router = useRouter();
  const { status, displayName, email, initials } = useCustomer();
  const { signingOut, signOut } = useSignOut();

  // Hold the slot while the session resolves, so "Sign in" does not flash for
  // a customer who is in fact signed in.
  if (status === 'loading') return <span aria-hidden="true" className="h-9 w-24" />;

  if (status === 'anonymous') {
    return (
      <Button asChild variant="brand-ghost" className="h-9 px-3 text-[13px]">
        <Link href="/login">Sign in</Link>
      </Button>
    );
  }

  const firstName = displayName?.split(/\s+/)[0] ?? 'Account';

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 max-w-[180px] items-center gap-2 rounded-full border border-pv-border bg-pv-card pl-1 pr-2.5 text-[13px] font-medium text-pv-fg transition-colors duration-200 hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
        >
          <Avatar initials={initials} />
          <span className="truncate">{firstName}</span>
          <ChevronDown className="size-3.5 shrink-0 text-pv-muted-fg" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className={cn('pv2-tokens z-50 w-64 overflow-hidden rounded-xl border border-pv-border bg-pv-card text-pv-fg shadow-lg outline-none', MOTION_ANCHORED)}
        >
          <div className="flex items-center gap-2.5 p-2.5 pb-2">
            <Avatar initials={initials} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-tight">{displayName ?? 'Your account'}</p>
              {email ? <p className="truncate text-[11px] leading-tight text-pv-muted-fg">{email}</p> : null}
            </div>
          </div>
          <DropdownMenu.Separator className="h-px bg-pv-border" />
          <div className="p-1.5">
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => router.push('/portal')}>
              <LayoutGrid className="mr-2.5 size-4 text-pv-muted-fg" />
              Your account
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => router.push('/portal/bookings')}>
              <CalendarDays className="mr-2.5 size-4 text-pv-muted-fg" />
              Your bookings
            </DropdownMenu.Item>
          </div>
          <DropdownMenu.Separator className="h-px bg-pv-border" />
          <div className="p-1.5">
            <DropdownMenu.Item
              disabled={signingOut}
              onSelect={(event) => {
                event.preventDefault();
                void signOut();
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

function SiteHeader({
  links,
  tenantName,
  siteSettings,
  fontClass,
  brandVars,
}: {
  links: ReadonlyArray<{ href: string; label: string }>;
  tenantName: string | null;
  siteSettings?: PageSections | null;
  fontClass: string;
  brandVars: Record<string, string> | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A link tapped in the phone menu closes it; so does any other navigation.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-pv-border/70 bg-pv-bg/75 backdrop-blur-md">
      <div className={cn(SITE_CONTAINER, 'flex h-16 items-center gap-3')}>
        <Brand tenantName={tenantName} siteSettings={siteSettings} />

        <nav aria-label="Primary" className="ml-3 hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
          {links.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  NAV_ITEM,
                  active ? 'bg-pv-tint text-pv-primary' : 'text-pv-muted-fg hover:bg-pv-hover hover:text-pv-fg',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden shrink-0 items-center gap-2 lg:flex">
          <AccountControl />
          <Button asChild variant="brand" className="h-9 px-4 text-[13px]">
            <QuickBookTrigger>Book a car</QuickBookTrigger>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label="Open menu"
          className="ml-auto grid size-11 shrink-0 place-items-center rounded-full text-pv-fg transition-colors duration-200 hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none lg:hidden"
        >
          <Menu className="size-5" />
        </button>
      </div>

      <PhoneNav
        open={open}
        onOpenChange={setOpen}
        links={links}
        pathname={pathname}
        tenantName={tenantName}
        siteSettings={siteSettings}
        fontClass={fontClass}
        brandVars={brandVars}
      />
    </header>
  );
}

/* ─────────────────────────────── phone drawer ──────────────────────────── */

/** The phone menu — the one side sheet the site allows. 44px rows throughout. */
function PhoneNav({
  open,
  onOpenChange,
  links,
  pathname,
  tenantName,
  siteSettings,
  fontClass,
  brandVars,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: ReadonlyArray<{ href: string; label: string }>;
  pathname: string | null;
  tenantName: string | null;
  siteSettings?: PageSections | null;
  fontClass: string;
  brandVars: Record<string, string> | null;
}) {
  const { status, displayName, email, initials } = useCustomer();
  const { signingOut, signOut } = useSignOut();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        // Focus lands on the drawer, not its first link (which would open looking hovered).
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn('pv2-tokens w-[min(20rem,88vw)] max-w-none gap-0 border-l border-pv-border bg-pv-bg p-0 sm:max-w-none lg:hidden', fontClass)}
        style={(brandVars ?? undefined) as React.CSSProperties | undefined}
      >
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SheetDescription className="sr-only">Site navigation, your account, and the booking link.</SheetDescription>

        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-pv-border px-4">
          <Brand tenantName={tenantName} siteSettings={siteSettings} />
          <SheetClose
            aria-label="Close menu"
            className="ml-auto grid size-11 shrink-0 place-items-center rounded-full text-pv-fg transition-colors duration-200 hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
          >
            <X className="size-5" />
          </SheetClose>
        </div>

        <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <ul className="flex flex-col gap-0.5">
            {links.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <li key={link.href}>
                  <SheetClose asChild>
                    <Link
                      href={link.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-11 items-center rounded-full px-4 text-sm font-medium transition-colors duration-200 motion-reduce:transition-none',
                        active ? 'bg-pv-tint text-pv-primary' : 'text-pv-fg hover:bg-pv-hover',
                      )}
                    >
                      {link.label}
                    </Link>
                  </SheetClose>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Booking first, account second — one primary action, as in v1. */}
        <div className="shrink-0 space-y-2 border-t border-pv-border p-4">
          <SheetClose asChild>
            <Button asChild variant="brand" className="h-11 w-full">
              <QuickBookTrigger>Book a car</QuickBookTrigger>
            </Button>
          </SheetClose>

          {status === 'authenticated' ? (
            <>
              <SheetClose asChild>
                <Link
                  href="/portal"
                  className="flex h-12 items-center gap-2.5 rounded-xl px-2 transition-colors duration-200 hover:bg-pv-hover motion-reduce:transition-none"
                >
                  <Avatar initials={initials} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-pv-fg">{displayName ?? 'Your account'}</span>
                    {email ? <span className="block truncate text-[11px] text-pv-muted-fg">{email}</span> : null}
                  </span>
                  <LayoutGrid className="size-4 shrink-0 text-pv-muted-fg" />
                </Link>
              </SheetClose>
              <button
                type="button"
                disabled={signingOut}
                onClick={() => void signOut()}
                className="flex h-11 w-full items-center gap-2.5 rounded-full px-4 text-sm font-medium text-pv-danger transition-colors duration-200 hover:bg-pv-danger/10 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
              >
                <LogOut className="size-4" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : status === 'anonymous' ? (
            <SheetClose asChild>
              <Button asChild variant="brand-outline" className="h-11 w-full">
                <Link href="/login">Sign in</Link>
              </Button>
            </SheetClose>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
