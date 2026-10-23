'use client';

/**
 * The phone tab bar — the operator's (apps/portal components/shared/layout/
 * mobile-tab-bar.tsx), for the customer: the portal is a PWA opened from the
 * Home Screen, so on a phone every place is one thumb-tap away along the
 * bottom edge, the way a native app moves.
 *
 * At most five slots, and they never scroll sideways (owner, Oct 23 2026: a
 * cut-off row wrongly says there is more to find): up to BAR_TABS rail tabs in
 * the customer's own order (sidebar customiser), then More — the operator's
 * bar, ditto (owner, Oct 23 2026): the ellipsis opens the More screen
 * (mobile-more-screen.tsx: the account, Settings, Dark mode, Sign out, and any
 * tab that did not fit), and stays lit while it is open.
 *
 * As the operator's: phone only (`md:hidden`); flat and attached to the bottom
 * edge — solid page colour, one hairline on top, no float, no shadow; padded
 * for the home indicator with env(safe-area-inset-bottom); the active tab
 * marked by colour and weight alone. The shell's <main> reserves the room.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Ellipsis } from 'lucide-react-nw';

import { cn } from '@nw/lib/utils';

import { arrangePortalV2Nav, isPortalV2Active, type PortalV2NavIcon } from './nav';
import { MobileMoreScreen } from './mobile-more-screen';
import { usePortalV2NavPreferences } from './sidebar-customizer';

/** Rail tabs on the bar; the rest go to More, so the row never overflows. */
const BAR_TABS = 4;

const ITEM =
  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[5px] text-[11.5px] leading-none font-medium tracking-[0.01em] ' +
  'outline-none transition-[color,transform] duration-200 ease-out active:scale-[0.94] focus-visible:text-pv-primary motion-reduce:transition-none';
const ACTIVE_TEXT = 'font-semibold text-pv-primary';
const IDLE_TEXT = 'text-pv-muted-fg';

function TabIcon({ icon: Icon, on }: { icon: PortalV2NavIcon; on: boolean }) {
  return <Icon aria-hidden className="size-5" strokeWidth={on ? 2.4 : 1.75} />;
}

export function MobileTabBar({ pathname }: { pathname: string | null }) {
  const { preferences } = usePortalV2NavPreferences();
  const shown = arrangePortalV2Nav(preferences).shown;
  const tabs = shown.slice(0, BAR_TABS);
  const overflow = shown.slice(BAR_TABS);
  const [moreOpen, setMoreOpen] = useState(false);

  // Any navigation closes More — a row tap, a tab tap, a link elsewhere.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const anyTabActive = tabs.some((tab) => isPortalV2Active(tab.href, pathname));
  // More is lit while it is open, and on any page no bar tab owns (Settings, an overflow tab).
  const moreLit = moreOpen || !anyTabActive;

  return (
    <>
    <MobileMoreScreen open={moreOpen} onClose={() => setMoreOpen(false)} pathname={pathname} overflow={overflow} />
    <div
      data-mobile-tab-bar=""
      // Record screens (a rental) bring their own dock; this bar gives way to it.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-pv-border bg-pv-bg pb-[env(safe-area-inset-bottom,0px)] md:hidden [body:has([data-record-dock])_&]:hidden"
    >
      <nav aria-label="Portal" className="mx-auto flex h-[60px] max-w-lg items-stretch overflow-hidden px-1">
        {tabs.map((tab) => {
          const active = !moreOpen && isPortalV2Active(tab.href, pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              // A tab whose page is already open would not change the route,
              // so the route-change close would never fire.
              onClick={() => setMoreOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={cn(ITEM, active ? ACTIVE_TEXT : IDLE_TEXT)}
            >
              <TabIcon icon={tab.icon} on={active} />
              {tab.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-label="More"
          aria-expanded={moreOpen}
          className={cn(ITEM, moreLit ? ACTIVE_TEXT : IDLE_TEXT)}
        >
          <TabIcon icon={Ellipsis} on={moreLit} />
          More
        </button>
      </nav>
    </div>
    </>
  );
}
