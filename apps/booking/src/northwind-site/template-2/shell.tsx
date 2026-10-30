'use client';

/**
 * Template 2 ("Glass") — the public site's frame: a floating liquid-glass nav
 * over the page, nothing else. The booking site's second design, built to be
 * chosen per tenant beside the first (site-v2/): same data, same links, a
 * different site. Served at /template-2 while it is being built (see
 * V2_ONLY_SEGMENTS in src/lib/booking-design.ts).
 *
 * The glass materials (`.g2-glass`, `.g2-glass-thin`, `.g2-well`, `.g2-cta`)
 * live in styles/site.css under "Template 2". They are tinted with the tenant's
 * brand colour: the shell writes --brand-h/s/l inline, exactly as site-v2 does.
 *
 * The nav floats over the hero's photograph at the top and keeps floating as
 * the page scrolls; it never becomes a bar.
 *
 * The photograph is ONE layer for the whole site, fixed to the screen
 * (`.g2-scene`): it stays still and every pane scrolls over it. It takes on
 * the colour of the car on the hero's stage, which the hero hands up through
 * `useSceneColour`.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react-nw';

import { BrandMark } from '@nw/components/layout/brand-mark';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import type { PageSections } from '@nw/lib/cms/types';
import { NAV_LINKS } from '@nw/lib/constants';
import { cn } from '@nw/lib/utils';
import { brandHslVars } from '@nw/portal-v2/brand';
import { T2_HOME, t2Href } from '@nw/template-2/links';

const SceneColour = createContext<(colour: string | null) => void>(() => {});

/** Tint the fixed backdrop with a car's colour ("rgb(…)"); null for the plain photo. */
export const useSceneColour = () => useContext(SceneColour);

export { T2_HOME } from '@nw/template-2/links';

/** The same order site-v2 uses: the cars, deals, what people say, who we are, how to reach us. */
const NAV_ORDER = ['/fleet', '/promotions', '/reviews', '/about', '/contact'] as const;

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';

export function Template2Shell({
  fontClass,
  tenantName,
  tenantLogoUrl = null,
  siteSettings,
  footer = null,
  children,
}: {
  fontClass: string;
  tenantName: string | null;
  tenantLogoUrl?: string | null;
  siteSettings?: PageSections | null;
  /** The footer (template-2/footer.tsx), a server component, so it comes in from the layout. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { tenant } = useTenant();
  const [sceneColour, setSceneColour] = useState<string | null>(null);
  const brandVars = brandHslVars(tenant?.primary_color);

  // Popovers portal to <body>, outside the template: give <body> the same
  // tokens, font and brand colour while the template is mounted.
  useEffect(() => {
    const body = document.body;
    const classes = ['pv2-tokens', 'g2', ...fontClass.split(' ').filter(Boolean)];
    body.classList.add(...classes);
    const entries = Object.entries(brandVars ?? {});
    for (const [name, value] of entries) body.style.setProperty(name, value);
    return () => {
      body.classList.remove(...classes);
      for (const [name] of entries) body.style.removeProperty(name);
    };
  }, [fontClass, brandVars?.['--brand-h'], brandVars?.['--brand-s'], brandVars?.['--brand-l']]); // eslint-disable-line react-hooks/exhaustive-deps

  const links = NAV_ORDER.map((href) => NAV_LINKS.find((link) => link.href === href))
    .filter((link): link is (typeof NAV_LINKS)[number] => !!link)
    .map((link) => ({ ...link, href: t2Href(link.href) }));

  return (
    <div
      className={cn('pv2-tokens g2 relative isolate flex min-h-dvh flex-col overflow-x-clip bg-[#ececf0]', fontClass)}
      style={(brandVars ?? undefined) as React.CSSProperties | undefined}
    >
      <div aria-hidden className="g2-scene" style={sceneColour ? ({ '--g2-car': sceneColour } as React.CSSProperties) : undefined}>
        <span className="g2-vibe" />
      </div>
      <GlassNav links={links} tenantName={tenantName} tenantLogoUrl={tenantLogoUrl} siteSettings={siteSettings} />
      <SceneColour.Provider value={setSceneColour}>
        <main className="flex-1">{children}</main>
      </SceneColour.Provider>
      {footer}
    </div>
  );
}

/* ──────────────────────────────────── nav ──────────────────────────────── */

function GlassNav({
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
  useEffect(() => setOpen(false), [pathname]);

  // Over the photo the pane is at its clearest; once the page scrolls under it,
  // it frosts a little more so the links stay readable over any content.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="pointer-events-auto mx-auto max-w-[1400px]">
        <div
          data-dense={scrolled}
          className="g2-glass relative flex h-[60px] items-center gap-2 rounded-full pl-4 pr-2 sm:h-16 sm:pl-5"
        >
          <BrandMark
            href={T2_HOME}
            seed={siteSettings}
            nameSeed={tenantName}
            logoSeed={tenantLogoUrl}
            className={cn(
              'inline-flex min-h-11 min-w-0 shrink items-center rounded-full',
              FOCUS,
              '[&_img]:max-h-8 [&_img]:max-w-[132px] [&_span]:truncate [&_span]:text-[15px] [&_span]:font-semibold [&_span]:tracking-[-0.02em] [&_span]:text-[var(--g2-ink)]',
            )}
          />

          {/* The links sit in their own inset track, like an iOS segmented control. */}
          {/* Centred on the bar itself, not in the space left between the logo and the buttons. */}
          <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
          <nav aria-label="Primary" className="g2-well g2-tray flex items-center gap-0.5 rounded-full p-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap rounded-full px-4 py-2 text-[14px] font-medium tracking-[-0.01em] transition-colors duration-200',
                  // The page you are on: white, in the operator's colour. Hover: a wash of it.
                  pathname === link.href
                    ? 'bg-white font-semibold text-[var(--g2-accent-ink)] shadow-[0_6px_14px_-10px_color-mix(in_oklab,var(--g2-accent)_70%,transparent),inset_0_1px_0_#fff,inset_0_0_0_1px_color-mix(in_oklab,var(--g2-accent)_18%,transparent)]'
                    : 'text-[var(--g2-ink-soft)] hover:bg-[color-mix(in_oklab,var(--g2-accent)_10%,rgb(255_255_255/0.7))] hover:text-[var(--g2-accent-ink)]',
                  FOCUS,
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <AccountLink />
            <Link
              href="/booking"
              className={cn('g2-cta hidden h-11 items-center gap-1.5 rounded-full px-5 text-[14px] font-semibold sm:inline-flex', FOCUS)}
            >
              Book a car
              <ArrowUpRight aria-hidden className="size-4" strokeWidth={2.25} />
            </Link>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="g2-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              className={cn('grid size-11 place-items-center rounded-full bg-white text-[var(--g2-on-light)] shadow-[0_4px_12px_-8px_rgb(13_12_29/0.35)] lg:hidden', FOCUS)}
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {open ? (
          <div id="g2-menu" className="g2-glass g2-rise mt-2 rounded-[28px] p-2 lg:hidden">
            <nav aria-label="Primary" className="flex flex-col">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={pathname === link.href ? 'page' : undefined}
                  className={cn(
                    'rounded-2xl px-4 py-3.5 text-[16px] font-medium transition-colors duration-200',
                    pathname === link.href
                      ? 'bg-white font-semibold text-[var(--g2-accent-ink)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--g2-accent)_18%,transparent)]'
                      : 'text-[var(--g2-ink)] hover:bg-[color-mix(in_oklab,var(--g2-accent)_10%,rgb(255_255_255/0.7))] hover:text-[var(--g2-accent-ink)]',
                    FOCUS,
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <Link
              href="/booking"
              className={cn('g2-cta mt-1 flex h-12 items-center justify-center gap-1.5 rounded-full text-[15px] font-semibold sm:hidden', FOCUS)}
            >
              Book a car
              <ArrowUpRight aria-hidden className="size-4" strokeWidth={2.25} />
            </Link>
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** "Sign in" for a visitor; their account for a signed-in customer. */
function AccountLink() {
  const { status, displayName, initials } = useCustomer();
  const CLASS = cn(
    'hidden h-11 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-semibold text-[var(--g2-on-light)] shadow-[0_4px_12px_-8px_rgb(13_12_29/0.35)] transition-colors duration-200 hover:bg-[color-mix(in_oklab,var(--g2-accent)_8%,#fff)] sm:inline-flex',
    FOCUS,
  );
  if (status === 'loading') return <span aria-hidden className="hidden h-11 w-20 sm:block" />;
  if (status === 'anonymous') {
    return (
      <Link href="/login" className={CLASS}>
        Sign in
      </Link>
    );
  }
  return (
    <Link href="/portal" className={cn(CLASS, 'pl-1.5')}>
      <span aria-hidden className="grid size-8 place-items-center rounded-full bg-[var(--g2-accent)]/15 text-[11px] font-semibold text-[var(--g2-accent)]">
        {initials ?? '·'}
      </span>
      <span className="max-w-[110px] truncate">{displayName?.split(/\s+/)[0] ?? 'Account'}</span>
    </Link>
  );
}
