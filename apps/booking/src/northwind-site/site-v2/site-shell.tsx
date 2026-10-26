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
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CalendarDays, ChevronDown, LayoutGrid, LogOut, Menu, X } from 'lucide-react-nw';

import { BrandMark } from '@nw/components/layout/brand-mark';
import { MOTION_ANCHORED } from '@nw/components/ui/motion';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { SITE_EDGE } from '@nw/site-v2/kit';
import { QuickBookProvider, QuickBookTrigger } from '@nw/site-v2/quick-book/quick-book-dialog';
import type { PageSections } from '@nw/lib/cms/types';
import { NAV_LINKS } from '@nw/lib/constants';

const NAV_ORDER = ['/', '/fleet', '/promotions', '/reviews', '/about', '/contact'] as const;
import { cn } from '@nw/lib/utils';
import { brandHslVars } from '@nw/portal-v2/brand';

export function SiteV2Shell({
  fontClass,
  tenantName,
  tenantLogoUrl = null,
  siteSettings,
  blogEnabled = false,
  footer,
  children,
}: {
  fontClass: string;
  /** The server's tenant name, so the header is right in the first HTML. */
  tenantName: string | null;
  /** The server's `tenants.logo_url` — the logo's fallback, in the first HTML. */
  tenantLogoUrl?: string | null;
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
  // The order a renter looks for things in: the cars and what they cost, any
  // deal on them, what other customers say, who we are, then how to reach us.
  // (v1 keeps NAV_LINKS' own order; only this shell reorders.)
  const ordered = NAV_ORDER.map((href) => NAV_LINKS.find((link) => link.href === href)).filter(
    (link): link is (typeof NAV_LINKS)[number] => !!link,
  );
  const links: ReadonlyArray<{ href: string; label: string }> = blogEnabled
    ? [...ordered.slice(0, -1), { href: '/blog', label: 'Blog' }, ordered[ordered.length - 1]]
    : ordered;

  return (
    <QuickBookProvider>
      <div
        className={cn('pv2 flex min-h-dvh flex-col overflow-x-clip', fontClass)}
        style={(brandVars ?? undefined) as React.CSSProperties | undefined}
      >
        <SiteHeader links={links} tenantName={tenantName} tenantLogoUrl={tenantLogoUrl} siteSettings={siteSettings} />
        <main className="pv2-enter flex-1">{children}</main>
        {footer}
      </div>
    </QuickBookProvider>
  );
}

/* ───────────────────────────────── header ──────────────────────────────── */

/**
 * The bar runs edge to edge with the same side padding as the Drive247 landing
 * page's nav (`apps/web/src/components/landing-v4`): 20px on a phone, growing
 * with the window to 100px.
 */
const EDGE = SITE_EDGE;

/** The landing's nav pills: 40px (36px on phones), 14px semibold, fully round. */
const PILL =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold ' +
  'transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none';
const PILL_PRIMARY = `${PILL} bg-pv-primary text-pv-primary-fg hover:bg-pv-primary/90`;
const PILL_OUTLINE = `${PILL} border border-pv-border bg-pv-card text-pv-fg hover:border-pv-tint hover:bg-pv-tint`;

/** The square-ish menu button, as on the landing. */
const BURGER =
  'grid size-[42px] shrink-0 place-items-center rounded-xl border border-pv-border bg-pv-card text-pv-fg transition-colors duration-200 ' +
  'hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none';

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
function Brand({
  tenantName,
  tenantLogoUrl,
  siteSettings,
}: {
  tenantName: string | null;
  tenantLogoUrl: string | null;
  siteSettings?: PageSections | null;
}) {
  return (
    <BrandMark
      seed={siteSettings}
      nameSeed={tenantName}
      logoSeed={tenantLogoUrl}
      className={cn(
        'inline-flex min-h-11 min-w-0 shrink items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30',
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
  if (status === 'loading') return <span aria-hidden="true" className="h-10 w-24" />;

  if (status === 'anonymous') {
    return (
      <Link href="/login" className={PILL_OUTLINE}>
        Sign in
      </Link>
    );
  }

  const firstName = displayName?.split(/\s+/)[0] ?? 'Account';

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-10 max-w-[180px] items-center gap-2 rounded-full border border-pv-border bg-pv-card pl-1.5 pr-3 text-[13px] font-medium text-pv-fg transition-colors duration-200 hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
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
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => router.push('/portal/rentals')}>
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
  tenantLogoUrl,
  siteSettings,
}: {
  links: ReadonlyArray<{ href: string; label: string }>;
  tenantName: string | null;
  tenantLogoUrl: string | null;
  siteSettings?: PageSections | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A link tapped in the menu closes it; so does any other navigation.
  useEffect(() => setOpen(false), [pathname]);

  /* At the top the bar is the hero's own surface; the hairline under it comes
     in once the page scrolls under the bar. */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-30">
      <div
        className={cn(
          EDGE,
          'flex h-[60px] items-center gap-3 border-b transition-colors duration-200 sm:h-[68px] min-[1060px]:gap-7 motion-reduce:transition-none',
          scrolled
            ? 'border-pv-border bg-[color-mix(in_srgb,var(--nw-hero-bg)_90%,transparent)] backdrop-blur-md backdrop-saturate-150'
            : 'border-transparent bg-[var(--nw-hero-bg)]',
        )}
      >
        <Brand tenantName={tenantName} tenantLogoUrl={tenantLogoUrl} siteSettings={siteSettings} />

        {/* The section links, centred in the bar; they move into the menu below 1060px. */}
        <nav aria-label="Primary" className="mx-auto hidden items-center gap-0.5 min-[1060px]:flex">
          {links.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-2 text-[14px] font-medium transition-colors duration-200 ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none',
                  // The page you are on wears the brand colour; a hover is only a
                  // neutral wash, so the two never look alike.
                  active
                    ? 'bg-pv-primary/[0.13] font-semibold text-pv-primary dark:bg-pv-primary/30 dark:text-pv-fg'
                    : 'text-pv-muted-fg hover:bg-pv-fg/[0.06] hover:text-pv-fg dark:hover:bg-white/[0.08]',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 max-[380px]:hidden min-[1060px]:ml-0">
          <span className="hidden sm:contents">
            <AccountControl />
          </span>
          <QuickBookTrigger className={cn(PILL_PRIMARY, 'max-sm:h-9 max-sm:px-3.5 max-sm:text-[13.5px]')}>
            Book a car
          </QuickBookTrigger>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label="Open menu"
          className={cn(BURGER, 'max-[380px]:ml-auto min-[1060px]:hidden')}
        >
          <Menu className="size-5" />
        </button>
      </div>

      <MenuSheet
        open={open}
        onClose={() => setOpen(false)}
        links={links}
        pathname={pathname}
        tenantName={tenantName}
        tenantLogoUrl={tenantLogoUrl}
        siteSettings={siteSettings}
      />
    </header>
  );
}

/* ──────────────────────────────── menu sheet ───────────────────────────── */

const noSubscribe = () => () => {};

/**
 * The menu below 1060px, as on the landing page: a full-screen sheet with the
 * logo and a close button on top, the links centred one per row with a
 * hairline between them, and the two actions at the foot. It is portalled to
 * <body> (which carries the site's tokens and font while the shell is
 * mounted): the bar's backdrop-filter would otherwise trap a fixed sheet
 * inside the bar. While closed it stays painted but invisible, so it can fade
 * out rather than vanish.
 */
function MenuSheet({
  open,
  onClose,
  links,
  pathname,
  tenantName,
  tenantLogoUrl,
  siteSettings,
}: {
  open: boolean;
  onClose: () => void;
  links: ReadonlyArray<{ href: string; label: string }>;
  pathname: string | null;
  tenantName: string | null;
  tenantLogoUrl: string | null;
  siteSettings?: PageSections | null;
}) {
  const host = useSyncExternalStore(noSubscribe, () => document.body, () => null);
  const { status } = useCustomer();
  const tab = open ? 0 : -1;

  // The page stays still behind the sheet; Escape closes it.
  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!host) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-[60] flex flex-col bg-pv-bg text-pv-fg motion-reduce:transition-none min-[1060px]:hidden',
        open
          ? 'visible translate-y-0 opacity-100 [transition:opacity_200ms_ease-out,transform_200ms_ease-out]'
          : 'invisible -translate-y-3 opacity-0 [transition:opacity_200ms_ease-in,transform_200ms_ease-in,visibility_0s_linear_200ms]',
      )}
    >
      <div className={cn(EDGE, 'flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-pv-border sm:h-[68px]')}>
        <Brand tenantName={tenantName} tenantLogoUrl={tenantLogoUrl} siteSettings={siteSettings} />
        <button type="button" onClick={onClose} aria-label="Close menu" tabIndex={tab} className={BURGER}>
          <X className="size-5" />
        </button>
      </div>

      <nav aria-label="Primary" className={cn(EDGE, 'flex min-h-0 flex-1 flex-col overflow-y-auto py-4')}>
        {links.map((link, index) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onClose}
              tabIndex={tab}
              aria-current={active ? 'page' : undefined}
              style={{ animationDelay: `${50 + index * 40}ms` }}
              className={cn(
                'block border-b border-pv-border py-[22px] text-center text-[20px] font-semibold tracking-[-0.01em] transition-colors duration-200',
                'hover:text-pv-primary focus-visible:text-pv-primary focus-visible:outline-none motion-reduce:transition-none',
                active ? 'text-pv-primary' : 'text-pv-fg',
                open && 'pv2-enter',
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className={cn(EDGE, 'grid shrink-0 grid-cols-2 gap-2.5 pb-[calc(20px+env(safe-area-inset-bottom,0px))] pt-4')}>
        {status === 'authenticated' ? (
          <Link href="/portal" onClick={onClose} tabIndex={tab} className={cn(PILL_OUTLINE, 'h-12 text-[15px]')}>
            Your account
          </Link>
        ) : (
          <Link href="/login" onClick={onClose} tabIndex={tab} className={cn(PILL_OUTLINE, 'h-12 text-[15px]')}>
            Sign in
          </Link>
        )}
        <QuickBookTrigger onClick={onClose} tabIndex={tab} className={cn(PILL_PRIMARY, 'h-12 text-[15px]')}>
          Book a car
        </QuickBookTrigger>
      </div>
    </div>,
    host,
  );
}
