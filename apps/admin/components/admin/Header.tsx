'use client';

import { useSidebar } from './SidebarContext';
import { Button } from '@/components/ui/button';
import { Menu } from 'lucide-react';

/**
 * The top bar, which on a desktop is now nothing at all.
 *
 * It used to compute and render a breadcrumb trail. Those were removed
 * Sep 26 2026 — "remove all breadcrumbs globally, keep headers clean and
 * minimalist" — and with the trail gone there was nothing left for this row to
 * carry but the phone's menu button.
 *
 * So the row IS the menu button, and only on a phone. Two earlier rounds of
 * this same header are worth remembering:
 *
 *   1. It painted `bg-background/80 backdrop-blur-xl border-b`, an opaque
 *      white band that cut the app's wash off at the top of every page.
 *   2. Once bare, it still reserved `h-14` on a desktop while rendering
 *      nothing — 56 pixels of empty space above every page title, which is
 *      what "remove this white space" was about.
 *
 * Both are avoided here by construction: no fill, and the element is
 * `md:hidden`, so on a desktop it contributes no height at all rather than
 * an empty row.
 *
 * `md:hidden` rather than the `isMobile` flag: that flag is false on the first
 * client render and flips in an effect, so gating on it would drop a 56px row
 * in after hydration and shove the page down as it landed.
 */
export function Header() {
  const { toggle } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 px-4 sm:px-6 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        className="-ml-2 h-8 w-8 text-muted-foreground"
        aria-label="Toggle menu"
      >
        <Menu className="h-4 w-4" />
      </Button>
    </header>
  );
}
