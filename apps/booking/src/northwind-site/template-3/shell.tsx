'use client';

/**
 * Template 3 ("Cinematic") — the public site's frame: a light, quiet page, a
 * normal navbar, and smooth scrolling (Lenis) so the scroll-driven scenes
 * glide instead of stepping with the wheel.
 *
 * The navbar is the booking site's usual one: logo on the left, the pages in
 * the middle, "Sign in" and "Book a car" on the right. Below `lg` the pages
 * fold into a small dropdown panel under the bar, never a full-screen sheet.
 * Transparent over the hero; once the page scrolls it becomes a white bar
 * with a hairline so the links stay readable over anything.
 *
 * The accent is the tenant's brand colour (`--t3-accent`), red when the brand
 * colour is unusable (too grey, too dark, too light — see brandHslVars).
 */

import Lenis from 'lenis';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react-nw';

import { BrandMark } from '@nw/components/layout/brand-mark';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import type { PageSections } from '@nw/lib/cms/types';
import { NAV_LINKS } from '@nw/lib/constants';
import { cn } from '@nw/lib/utils';
import { t3Accent } from '@nw/template-3/accent';
import { T3_HOME, t3Href } from '@nw/template-3/links';

export const T3_DISPLAY: React.CSSProperties = { fontFamily: 'var(--font-t3-display), "Times New Roman", serif' };

/** The page's own colours, shared with the hero. */
export const T3 = {
  bg: '#f3f4f6',
  ink: '#111216',
  inkSoft: '#5b5f69',
  line: '#e2e4e9',
} as const;

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t3-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f3f4f6]';

/** The same order the other templates use: the cars, deals, what people say, who we are, how to reach us. */
const NAV_ORDER = ['/fleet', '/promotions', '/reviews', '/about', '/contact'] as const;

export function Template3Shell({
  fontClass,
  tenantName,
  tenantLogoUrl = null,
  siteSettings,
  children,
}: {
  fontClass: string;
  tenantName: string | null;
  tenantLogoUrl?: string | null;
  siteSettings?: PageSections | null;
  children: React.ReactNode;
}) {
  const { tenant } = useTenant();
  const accent = t3Accent(tenant?.primary_color);
  const reduce = useReducedMotion();

  // The page colour reaches the edges (overscroll), and popovers portalled to <body> get the accent.
  useEffect(() => {
    const body = document.body;
    const prev = { bg: body.style.backgroundColor, accent: body.style.getPropertyValue('--t3-accent') };
    body.style.backgroundColor = T3.bg;
    body.style.setProperty('--t3-accent', accent);
    return () => {
      body.style.backgroundColor = prev.bg;
      body.style.setProperty('--t3-accent', prev.accent);
    };
  }, [accent]);

  // Smooth scroll. Skipped for reduced motion, where native scrolling is the kinder choice.
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
    let frame = requestAnimationFrame(function raf(time) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    });
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, [reduce]);

  const links = NAV_ORDER.map((href) => NAV_LINKS.find((link) => link.href === href))
    .filter((link): link is (typeof NAV_LINKS)[number] => !!link)
    .map((link) => ({ href: t3Href(link.href), label: link.label }));

  return (
    <div
      className={cn('relative isolate flex min-h-dvh flex-col overflow-x-clip antialiased selection:bg-[var(--t3-accent)] selection:text-white', fontClass)}
      style={{ '--t3-accent': accent, backgroundColor: T3.bg, color: T3.ink, fontFamily: 'var(--font-t3-body), system-ui, sans-serif' } as React.CSSProperties}
    >
      <Nav links={links} tenantName={tenantName} tenantLogoUrl={tenantLogoUrl} siteSettings={siteSettings} />
      <main className="flex-1">{children}</main>
      <Footer tenantName={tenantName} links={links} />
    </div>
  );
}

/* ──────────────────────────────────── nav ──────────────────────────────── */

type NavLinkItem = { href: string; label: string };

function Nav({
  links,
  tenantName,
  tenantLogoUrl,
  siteSettings,
}: {
  links: NavLinkItem[];
  tenantName: string | null;
  tenantLogoUrl: string | null;
  siteSettings?: PageSections | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    // A page can keep the bar clear over its opening scene: the home hero marks
    // itself with data-t3-clear-nav="<viewport heights>", so the bar stays
    // transparent over the blue line-up and turns white only as that scene ends.
    const onScroll = () => {
      const hero = document.querySelector<HTMLElement>('[data-t3-clear-nav]');
      const clearFor = hero ? hero.offsetTop + Number(hero.dataset.t3ClearNav) * window.innerHeight : 16;
      setScrolled(window.scrollY > clearFor);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The dropdown closes on Escape or a tap anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const solid = scrolled || open;

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 border-b transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500',
        solid ? 'border-[#e2e4e9] bg-white/90 backdrop-blur-md' : 'border-transparent bg-transparent',
      )}
    >
      <div className="relative mx-auto flex h-16 max-w-[1320px] items-center gap-6 px-5 sm:h-[72px] sm:px-8">
        <BrandMark
          href={T3_HOME}
          seed={siteSettings}
          nameSeed={tenantName}
          logoSeed={tenantLogoUrl}
          className={cn(
            'inline-flex min-h-11 min-w-0 shrink items-center rounded',
            FOCUS,
            '[&_img]:max-h-8 [&_img]:max-w-[140px] [&_span]:truncate [&_span]:text-[17px] [&_span]:font-semibold [&_span]:tracking-[-0.02em] [&_span]:text-[#111216]',
          )}
        />

        {/* Centred on the bar, not in the space left between logo and buttons. */}
        <nav aria-label="Primary" className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1 lg:flex">
          {links.map((link) => {
            const current = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'relative whitespace-nowrap rounded-md px-3.5 py-2 text-[14px] font-medium transition-colors',
                  current ? 'text-[#111216]' : 'text-[#5b5f69] hover:text-[#111216]',
                  FOCUS,
                )}
              >
                {link.label}
                {current ? <span aria-hidden className="absolute inset-x-3.5 -bottom-0.5 h-[2px] rounded-full bg-[var(--t3-accent)]" /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <AccountLink />
          <Link
            href="/booking"
            className={cn(
              'hidden h-10 items-center rounded-full bg-[var(--t3-accent)] px-5 text-[14px] font-semibold text-white transition-[filter] hover:brightness-110 sm:inline-flex',
              FOCUS,
            )}
          >
            Book a car
          </Link>
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="t3-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className={cn('grid size-10 place-items-center rounded-full border border-[#e2e4e9] bg-white text-[#111216] lg:hidden', FOCUS)}
          >
            {open ? <X className="size-[18px]" /> : <Menu className="size-[18px]" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            id="t3-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute inset-x-3 top-full mt-2 rounded-2xl border border-[#e2e4e9] bg-white p-2 shadow-[0_18px_40px_-20px_rgba(17,18,22,0.35)] sm:inset-x-auto sm:right-8 sm:w-[300px] lg:hidden"
          >
            <nav aria-label="Primary" className="flex flex-col">
              {links.map((link) => {
                const current = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'rounded-xl px-4 py-3 text-[15px] font-medium transition-colors',
                      current ? 'bg-[#f3f4f6] text-[#111216]' : 'text-[#5b5f69] hover:bg-[#f3f4f6] hover:text-[#111216]',
                      FOCUS,
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-1 grid gap-2 border-t border-[#e2e4e9] p-2 pt-3">
              <Link
                href="/login"
                className={cn('flex h-11 items-center justify-center rounded-full border border-[#e2e4e9] text-[14px] font-semibold text-[#111216] lg:hidden', FOCUS)}
              >
                Sign in
              </Link>
              <Link
                href="/booking"
                className={cn('flex h-11 items-center justify-center rounded-full bg-[var(--t3-accent)] text-[14px] font-semibold text-white sm:hidden', FOCUS)}
              >
                Book a car
              </Link>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

/** "Sign in" for a visitor; their first name for a signed-in customer. */
function AccountLink() {
  const { status, displayName } = useCustomer();
  const CLASS = cn(
    'hidden h-10 items-center rounded-full px-4 text-[14px] font-semibold text-[#111216] transition-colors hover:bg-black/[0.04] lg:inline-flex',
    FOCUS,
  );
  if (status === 'loading') return <span aria-hidden className="hidden w-20 lg:block" />;
  if (status === 'anonymous') {
    return (
      <Link href="/login" className={CLASS}>
        Sign in
      </Link>
    );
  }
  return (
    <Link href="/portal" className={CLASS}>
      {displayName?.split(/\s+/)[0] ?? 'My account'}
    </Link>
  );
}

/* ─────────────────────────────────── footer ────────────────────────────── */

function Footer({ tenantName, links }: { tenantName: string | null; links: NavLinkItem[] }) {
  return (
    <footer className="border-t border-[#e2e4e9] bg-white">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
        <span style={T3_DISPLAY} className="text-[26px] text-[#111216]">
          {tenantName ?? 'Car rental'}
        </span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={cn('rounded text-[14px] text-[#5b5f69] hover:text-[#111216]', FOCUS)}>
              {link.label}
            </Link>
          ))}
        </nav>
        <span className="text-[13px] text-[#5b5f69]">
          © {new Date().getFullYear()} {tenantName ?? ''}
        </span>
      </div>
    </footer>
  );
}
