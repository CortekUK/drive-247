'use client';

/**
 * The authenticated portal frame: sidebar, header, content well.
 *
 * The shell renders ONLY for a signed-in customer — `(portal)/layout.tsx`
 * refuses to mount it otherwise — so nothing in here re-checks auth. One gate,
 * in one place, is the whole point; a second check here would be a second
 * chance to disagree with the first.
 *
 * Layout: a 272px sidebar pinned on `lg`, an off-canvas Sheet below it. Both
 * render the SAME nav list from `nav.ts`, so a route can never appear in one
 * and not the other.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { LogOut, Menu, Plus } from 'lucide-react';

import { BrandMark } from '@/components/layout/brand-mark';
import { PORTAL_NAV, isPortalNavItemActive } from '@/components/portal/nav';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useCustomer } from '@/hooks/use-customer';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { cn } from '@/lib/utils';

/* ─────────────────────────────── nav list ──────────────────────────────── */

function NavList({
  pathname,
  onNavigate,
  showHints = false,
}: {
  pathname: string | null;
  onNavigate?: () => void;
  showHints?: boolean;
}) {
  return (
    <nav aria-label="Portal" className="flex flex-col gap-1">
      {PORTAL_NAV.map((item) => {
        const active = isPortalNavItemActive(item.href, pathname);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // min-h-11 keeps the tap target at 44px even though the type is
              // 14px — the box grows, the text does not.
              'group flex min-h-11 items-center gap-3 rounded-full px-3.5 py-2.5 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25',
              active
                ? 'bg-brand-forest text-white'
                : 'text-brand-text-soft hover:bg-brand-stone hover:text-brand-text',
            )}
          >
            <Icon
              aria-hidden
              strokeWidth={1.75}
              className={cn(
                'size-[18px] shrink-0',
                active ? 'text-white' : 'text-brand-text-subtle group-hover:text-brand-text',
              )}
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{item.label}</span>
              {showHints ? (
                <span
                  className={cn(
                    'truncate text-xs',
                    active ? 'text-white/70' : 'text-brand-text-subtle',
                  )}
                >
                  {item.hint}
                </span>
              ) : null}
            </span>
            {!item.built ? (
              <span
                className={cn(
                  'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                  active ? 'bg-white/15 text-white' : 'bg-brand-stone text-brand-text-subtle',
                )}
              >
                Soon
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/* ───────────────────────────── account block ───────────────────────────── */

function AccountBlock({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  // `displayName` and `initials` come from the auth read model, which already
  // handles the awkward cases (`customers.name` is NOT NULL but can be empty; a
  // name whose first character is an emoji must not be sliced in half). One
  // derivation, so the header and any future avatar cannot disagree.
  const { displayName, email, initials, signOut } = useCustomer();
  const [signingOut, setSigningOut] = useState(false);

  const name = displayName ?? 'Your account';

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      // Home, not /login: a customer who has just signed out is a visitor
      // again, and dropping them on a login form reads as a failed sign-out.
      // `replace` so Back does not bounce them into the guarded layout.
      router.replace('/');
    }
  }, [router, signOut]);

  return (
    <div className={cn('flex items-center gap-3', compact ? '' : 'w-full')}>
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-forest text-xs font-semibold text-white"
      >
        {initials ?? '?'}
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-brand-text">{name}</span>
        {email && email !== name ? (
          <span className="truncate text-xs text-brand-text-subtle">{email}</span>
        ) : null}
      </span>
      <Button
        type="button"
        variant="brand-ghost"
        size="icon"
        className="size-11 shrink-0"
        onClick={handleSignOut}
        disabled={signingOut}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

/* ─────────────────────────────── the shell ─────────────────────────────── */

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { appName } = useTenantBranding();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeItem = PORTAL_NAV.find((item) =>
    isPortalNavItemActive(item.href, pathname),
  );

  return (
    <div className="min-h-dvh bg-brand-cream">
      {/* Keyboard users land here first; the sidebar is 5 links deep. */}
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand-forest focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      {/* ── Sidebar (lg and up) ─────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] flex-col border-r border-brand-border-soft bg-brand-card lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <BrandMark href="/" />
          <span className="truncate text-sm font-medium text-brand-text">
            {appName ?? 'Your account'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-3">
          <NavList pathname={pathname} />
        </div>

        <div className="px-3 pb-4">
          <Button asChild variant="brand" className="h-11 w-full">
            <Link href="/booking">
              <Plus className="size-4" aria-hidden />
              Book a car
            </Link>
          </Button>
        </div>

        <div className="border-t border-brand-border-soft px-3 py-3">
          <AccountBlock />
        </div>
      </aside>

      {/* ── Content column ──────────────────────────────────────────────── */}
      <div className="lg:pl-[272px]">
        <header className="sticky top-0 z-20 border-b border-brand-border-soft bg-brand-cream/95 backdrop-blur supports-[backdrop-filter]:bg-brand-cream/80">
          <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="brand-ghost"
                  size="icon"
                  className="size-11 lg:hidden"
                  aria-label="Open portal menu"
                >
                  <Menu className="size-5" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="flex w-[min(20rem,88vw)] flex-col gap-0 overflow-y-auto bg-brand-card p-0"
              >
                <SheetHeader className="border-b border-brand-border-soft px-5 py-5 text-left">
                  <SheetTitle className="text-base text-brand-text">
                    {appName ?? 'Your account'}
                  </SheetTitle>
                  <SheetDescription className="text-xs text-brand-text-subtle">
                    Your bookings, documents and payments.
                  </SheetDescription>
                </SheetHeader>

                <div className="flex-1 px-3 py-3">
                  <NavList
                    pathname={pathname}
                    showHints
                    onNavigate={() => setDrawerOpen(false)}
                  />
                </div>

                <div className="px-3 pb-3">
                  <Button asChild variant="brand" className="h-11 w-full">
                    <Link href="/booking" onClick={() => setDrawerOpen(false)}>
                      <Plus className="size-4" aria-hidden />
                      Book a car
                    </Link>
                  </Button>
                </div>

                <div className="border-t border-brand-border-soft px-3 py-3">
                  <AccountBlock />
                </div>
              </SheetContent>
            </Sheet>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-sm font-medium text-brand-text lg:text-base">
                {activeItem?.label ?? 'Portal'}
              </span>
            </div>

            <Button
              asChild
              variant="brand-outline"
              size="sm"
              className="hidden h-11 sm:inline-flex lg:hidden"
            >
              <Link href="/booking">Book a car</Link>
            </Button>
          </div>
        </header>

        <main
          id="portal-main"
          className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
