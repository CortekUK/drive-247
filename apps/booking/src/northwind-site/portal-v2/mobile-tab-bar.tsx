'use client';

/**
 * The phone tab bar — the operator's (apps/portal components/shared/layout/
 * mobile-tab-bar.tsx), for the customer, as the boss set it there (Nov 2026):
 * four places and one filled action in the CENTRE, no "More".
 *
 *   Rentals · Agreements · (+ Book a car) · Finances · Search
 *
 *   - Booking is started from the bar: the rail's own "Book a car" (the same
 *     QuickBookTrigger), the one filled control on the bar, as the operator's
 *     plus starts a rental.
 *   - Search moved down here from the top bar, where a thumb can reach it. It
 *     asks the top bar to open search (OPEN_PHONE_SEARCH_EVENT): the page's
 *     own field when the page lends one, otherwise the search dialog.
 *   - "More" is gone. The full menu opens from the burger at the top left of
 *     the top bar, and it is the desktop rail itself (shell.tsx PhoneMenu), so
 *     its order, the tenant row, the customiser, Book a car and the profile row
 *     (Settings, Dark mode, Sign out) are exactly the desktop's. Insurances
 *     lives there, as Rentals does in the operator's menu.
 *
 * As the operator's: phone only (`md:hidden`); flat and attached to the bottom
 * edge — solid page colour, one hairline on top, no float, no shadow; padded
 * for the home indicator with env(safe-area-inset-bottom); the active tab
 * marked by colour and weight alone. The shell's <main> reserves the room.
 * Record screens (a rental) bring their own dock, and this bar gives way to it.
 */

import Link from 'next/link';
import { Plus, Search } from 'lucide-react-nw';

import { NavAgreements, NavFinances, NavRentals } from '@portal-v2-shared/nav-icons/nav-icons';
import { cn } from '@nw/lib/utils';
import { QuickBookTrigger } from '@nw/site-v2/quick-book/quick-book-dialog';

import { isPortalV2Active, type PortalV2NavIcon } from './nav';

/** The bar's Search asks the top bar to open search (shell.tsx TopBar). */
export const OPEN_PHONE_SEARCH_EVENT = 'pv2-open-phone-search';

interface Tab {
  label: string;
  href: string;
  icon: PortalV2NavIcon;
}

// Names and icons are the rail's (nav.ts).
const RENTALS: Tab = { label: 'Rentals', href: '/portal/rentals', icon: NavRentals };
const AGREEMENTS: Tab = { label: 'Agreements', href: '/portal/agreements', icon: NavAgreements };
const FINANCES: Tab = { label: 'Finances', href: '/portal/payments', icon: NavFinances };

const ITEM =
  'relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-[5px] whitespace-nowrap text-[11.5px] leading-none font-medium tracking-[0.01em] ' +
  'outline-none transition-[color,transform] duration-200 ease-out active:scale-[0.94] focus-visible:text-pv-primary motion-reduce:transition-none';
const ACTIVE_TEXT = 'font-semibold text-pv-primary';
const IDLE_TEXT = 'text-pv-muted-fg';

function TabLink({ tab, pathname }: { tab: Tab; pathname: string | null }) {
  const active = isPortalV2Active(tab.href, pathname);
  const Icon = tab.icon;
  return (
    <Link href={tab.href} aria-current={active ? 'page' : undefined} className={cn(ITEM, active ? ACTIVE_TEXT : IDLE_TEXT)}>
      <Icon aria-hidden className="size-5" strokeWidth={active ? 2.4 : 1.75} />
      {tab.label}
    </Link>
  );
}

export function MobileTabBar({ pathname }: { pathname: string | null }) {
  return (
    <div
      data-mobile-tab-bar=""
      className="fixed inset-x-0 bottom-0 z-40 border-t border-pv-border bg-pv-bg pb-[env(safe-area-inset-bottom,0px)] md:hidden [body:has([data-record-dock])_&]:hidden"
    >
      <nav aria-label="Portal" className="mx-auto flex h-[60px] max-w-lg items-stretch px-1">
        <TabLink tab={RENTALS} pathname={pathname} />
        <TabLink tab={AGREEMENTS} pathname={pathname} />

        <QuickBookTrigger className={cn(ITEM, IDLE_TEXT)}>
          {/* The one filled control on the bar, the operator's: a 46×30 pill
              a little above the other icons' row, so the label stays on one
              line with the rest. */}
          <span className="-mt-0.5 flex h-[30px] w-[46px] items-center justify-center rounded-full bg-pv-primary text-pv-primary-fg shadow-[0_4px_12px_-4px_color-mix(in_srgb,var(--pv-primary)_60%,transparent)]">
            <Plus aria-hidden className="size-[19px]" strokeWidth={2.5} />
          </span>
          Book a car
        </QuickBookTrigger>

        <TabLink tab={FINANCES} pathname={pathname} />

        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_PHONE_SEARCH_EVENT))}
          aria-label="Search"
          className={cn(ITEM, IDLE_TEXT)}
        >
          <Search aria-hidden className="size-5" strokeWidth={1.75} />
          Search
        </button>
      </nav>
    </div>
  );
}
