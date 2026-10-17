'use client';

/**
 * Northwind booking site v2 — the public site's frame, in the operator portal
 * v2's design language (the `.pv2` tokens in styles/site.css, shared with the
 * customer portal v2): Manrope, neutral surfaces over the brand wash, one
 * accent that follows the tenant's colour, soft 10px buttons, 16px cards.
 *
 * Pages v2 has not built yet still open from the current site (see
 * V2_BUILT_SEGMENTS in src/lib/booking-design.ts), so the links below are all
 * live whatever is built.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { useTenant } from '@nw/contexts/TenantContext';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { NAV_LINKS } from '@nw/lib/constants';
import { cn } from '@nw/lib/utils';
import { brandHslVars } from '@nw/portal-v2/brand';

export function SiteV2Shell({
  fontClass,
  tenantName,
  children,
}: {
  fontClass: string;
  /** The server's tenant name, so the header is right in the first HTML. */
  tenantName: string | null;
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

  return (
    <div
      className={cn('pv2 flex min-h-dvh flex-col', fontClass)}
      style={(brandVars ?? undefined) as React.CSSProperties | undefined}
    >
      <SiteHeader tenantName={tenantName} />
      <main className="pv2-enter flex-1">{children}</main>
      <SiteFooter tenantName={tenantName} />
    </div>
  );
}

/* ───────────────────────────────── header ──────────────────────────────── */

const NAV_ITEM =
  'inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium transition-colors duration-200 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30';

function isActive(pathname: string | null, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname === '';
  return !!pathname?.startsWith(href);
}

function Brand({ tenantName }: { tenantName: string | null }) {
  const { appName, logoUrl } = useTenantBranding();
  const name = appName ?? tenantName;

  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-8 shrink-0 rounded-lg object-contain" />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-pv-primary text-sm font-semibold text-pv-primary-fg">
          {(name ?? 'A').slice(0, 1)}
        </span>
      )}
      <span className="truncate text-sm font-semibold text-pv-fg">{name ?? ''}</span>
    </Link>
  );
}

function SiteHeader({ tenantName }: { tenantName: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A link tapped in the phone menu closes it.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-pv-border/70 bg-pv-bg/75 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-4 px-4 md:px-6">
        <Brand tenantName={tenantName} />

        <nav aria-label="Primary" className="ml-4 hidden flex-1 items-center gap-0.5 lg:flex">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  NAV_ITEM,
                  active ? 'bg-pv-tint text-pv-primary' : 'text-pv-muted-fg hover:bg-pv-tint hover:text-pv-fg',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <Button asChild variant="brand-ghost" className="h-9 px-3 text-[13px]">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="brand" className="h-9 px-4 text-[13px]">
            <Link href="/fleet">Book a car</Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="ml-auto grid size-11 place-items-center rounded-lg text-pv-fg transition-colors duration-200 hover:bg-pv-tint lg:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open ? (
        <nav aria-label="Primary" className="pv2-enter border-t border-pv-border bg-pv-bg px-4 pb-4 pt-2 lg:hidden">
          <ul className="flex flex-col">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-200',
                      active ? 'bg-pv-tint text-pv-primary' : 'text-pv-fg hover:bg-pv-tint',
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button asChild variant="brand-outline" className="h-11">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild variant="brand" className="h-11">
              <Link href="/fleet">Book a car</Link>
            </Button>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

/* ───────────────────────────────── footer ──────────────────────────────── */

function SiteFooter({ tenantName }: { tenantName: string | null }) {
  const { appName } = useTenantBranding();
  const name = appName ?? tenantName;

  return (
    <footer className="mt-16 border-t border-pv-border">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-8 md:flex-row md:items-center md:justify-between md:px-6">
        <Brand tenantName={tenantName} />
        <nav aria-label="Footer" className="flex flex-wrap gap-x-1 gap-y-1">
          {[...NAV_LINKS.slice(1), { href: '/privacy', label: 'Privacy' }, { href: '/terms', label: 'Terms' }].map((link) => (
            <Link key={link.href} href={link.href} className={cn(NAV_ITEM, 'text-pv-muted-fg hover:bg-pv-tint hover:text-pv-fg')}>
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-pv-muted-fg">
          © {new Date().getFullYear()} {name ?? ''}
        </p>
      </div>
    </footer>
  );
}
