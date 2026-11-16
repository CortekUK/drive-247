"use client";

/**
 * The v2 phone tab bar — bottom navigation for the installed PWA.
 *
 * Mobile-first (boss, Nov 2026): Home · Vehicles · (+) · Customers · Search,
 * in that order, the plus in the CENTRE.
 *   - The rental is CREATED from the tab bar: a prominent plus, the one filled
 *     control on the bar, in the middle slot, opens `/rentals/new` (which starts a draft and steps
 *     into it, rentals-v2/rental-drafts.tsx). The Rentals list itself is in the
 *     menu, with everything else.
 *   - Search moved down here from the top bar, where a thumb can reach it. It
 *     asks the top bar to open search (`open-phone-search`): the page's own
 *     field when the page lends one, otherwise the global search dialog.
 *   - "More" is gone. The full menu opens from the burger at the top left of
 *     the top bar, and it is the desktop sidebar itself (as a sheet), so its
 *     order, its tenant row and its customiser are exactly the desktop's.
 *
 * Phone only (`md:hidden`); v2 chrome only (mounted from the dashboard layout
 * behind `v2Chrome`). Padded for the home indicator with
 * `env(safe-area-inset-bottom)`; the v2 viewport carries `viewport-fit=cover`.
 *
 * It steps aside on RECORD screens (a rental, customer or vehicle), which carry
 * their own bottom dock (ui-v2/record-dock.tsx): the dock marks itself
 * `data-record-dock`, and `:has()` hides this bar whenever one is on the page.
 *
 * Tabs a manager cannot open are left out, by the same route check the sidebar
 * uses.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Plus, Search, Users, type LucideIcon } from "lucide-react";
import { NavVehicles } from "@/components/icons/nav-icons";
import { cn } from "@/lib/utils";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { OPEN_PHONE_SEARCH_EVENT } from "@/components/shared/layout/phone-search-event";


interface Tab {
  label: string;
  href: string;
  icon: LucideIcon;
}

const HOME: Tab = { label: "Home", href: "/", icon: LayoutGrid };
const VEHICLES: Tab = { label: "Vehicles", href: "/vehicles", icon: NavVehicles as unknown as LucideIcon };
const CUSTOMERS: Tab = { label: "Customers", href: "/customers", icon: Users };

/**
 * The active tab is marked by colour and weight alone — the icon goes bold and
 * takes the accent, the label follows. No background shape behind it.
 */
const ITEM =
  "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[5px] text-[11.5px] leading-none font-medium tracking-[0.01em] transition-[color,transform] duration-200 ease-out active:scale-[0.94] motion-reduce:transition-none";
const ACTIVE_TEXT = "font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]";
const IDLE_TEXT = "text-muted-foreground";

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  const Icon = tab.icon;
  return (
    <Link href={tab.href} aria-current={active ? "page" : undefined} className={cn(ITEM, active ? ACTIVE_TEXT : IDLE_TEXT)}>
      <Icon className="size-5" strokeWidth={active ? 2.4 : 1.75} aria-hidden />
      {tab.label}
    </Link>
  );
}

export function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  const { canAccessRoute } = useManagerPermissions();

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const canCreate = canAccessRoute("/rentals");
  const creating = pathname === "/rentals/new";

  return (
    /*
      Attached to the bottom edge like the Android apps the operators already
      use: solid page colour, one hairline on top, no float, no shadow. Solid
      rather than translucent so nothing scrolling beneath shows through it.
      60px plus the inset sits inside the 4.5rem the dashboard's <main>
      reserves below the last row.
    */
    <div
      data-mobile-tab-bar=""
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        // Record screens bring their own dock; this bar gives way to it.
        "[body:has([data-record-dock])_&]:hidden",
        "border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)]"
      )}
    >
      <nav aria-label="Main" className="mx-auto flex h-[60px] max-w-lg items-stretch px-1">
        <TabLink tab={HOME} active={isActive("/")} />
        {canAccessRoute(VEHICLES.href) && <TabLink tab={VEHICLES} active={isActive(VEHICLES.href)} />}

        {canCreate && (
          <Link
            href="/rentals/new"
            aria-label="New rental"
            aria-current={creating ? "page" : undefined}
            className={cn(ITEM, creating ? ACTIVE_TEXT : IDLE_TEXT)}
          >
            {/* The one filled control on the bar: a rental is what an operator
                starts most, so it is the thumb's target. Same height as the
                other icons' row plus a little, so the labels stay on one line. */}
            <span className="-mt-0.5 flex h-[30px] w-[46px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_hsl(var(--primary)/0.6)]">
              <Plus className="size-[19px]" strokeWidth={2.5} aria-hidden />
            </span>
            Rental
          </Link>
        )}

        {canAccessRoute(CUSTOMERS.href) && <TabLink tab={CUSTOMERS} active={isActive(CUSTOMERS.href)} />}

        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_PHONE_SEARCH_EVENT))}
          aria-label="Search"
          className={cn(ITEM, IDLE_TEXT)}
        >
          <Search className="size-5" strokeWidth={1.75} aria-hidden />
          Search
        </button>
      </nav>
    </div>
  );
}
