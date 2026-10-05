"use client";

/**
 * The v2 phone tab bar — iPhone-style bottom navigation (Sep 28 2026).
 *
 * The portal is installed as a PWA and opened from the Home Screen, so on a
 * phone it should move like a native app: the five places an operator lives
 * are one thumb-tap away along the bottom edge, and everything else is under
 * "More", which opens a full-screen More page (mobile-more-screen.tsx, Oct 6
 * 2026) rather than the desktop sidebar as a side sheet. The bar stays on top
 * of that screen with "More" lit, the way a native tab bar does.
 *
 * Phone only (`md:hidden`); v2 chrome only (mounted from the dashboard layout
 * behind `v2Chrome`). Frosted like an iOS tab bar, and padded for the home
 * indicator with `env(safe-area-inset-bottom)` — the v2 viewport already
 * carries `viewport-fit=cover`, so that inset is real.
 *
 * It steps aside on RECORD screens (a rental, customer or vehicle), which
 * carry their own bottom dock (ui-v2/record-dock.tsx): two bars stacked at the
 * bottom of a phone is one too many. The dock marks itself `data-record-dock`,
 * and `:has()` hides this bar whenever one is on the page.
 *
 * Tabs a manager cannot open are left out, by the same route check the
 * sidebar uses.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis, FileText, LayoutGrid, Users, type LucideIcon } from "lucide-react";
import { CarMark } from "@/components/ui/car-mark";
import { cn } from "@/lib/utils";
import { useMobileNavStore } from "@/stores/mobile-nav-store";
import { MobileMoreScreen } from "@/components/shared/layout/mobile-more-screen";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

interface Tab {
  label: string;
  href: string;
  icon: LucideIcon;
}

const TABS: Tab[] = [
  { label: "Home", href: "/", icon: LayoutGrid },
  { label: "Rentals", href: "/rentals", icon: FileText },
  { label: "Vehicles", href: "/vehicles", icon: CarMark },
  { label: "Customers", href: "/customers", icon: Users },
];

const ITEM =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] pt-1.5 pb-1 text-[10px] font-medium tracking-[0.01em] transition-[color,transform] duration-150 active:scale-[0.92]";

export function MobileTabBar() {
  const pathname = usePathname() ?? "/";
  const moreOpen = useMobileNavStore((s) => s.open);
  const setMoreOpen = useMobileNavStore((s) => s.setOpen);
  const { canAccessRoute } = useManagerPermissions();

  const tabs = TABS.filter((t) => t.href === "/" || canAccessRoute(t.href));
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const anyTabActive = tabs.some((t) => isActive(t.href));

  return (
    <>
    <MobileMoreScreen />
    <nav
      aria-label="Main"
      data-mobile-tab-bar=""
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        // Record screens bring their own dock; this bar gives way to it.
        "[body:has([data-record-dock])_&]:hidden",
        "border-t border-black/[0.06] bg-white/80 backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-[hsl(var(--background)/0.8)]",
        "pb-[env(safe-area-inset-bottom,0px)]"
      )}
    >
      <div className="mx-auto flex h-[52px] max-w-lg items-stretch px-2">
        {tabs.map(({ label, href, icon: Icon }) => {
          const active = !moreOpen && isActive(href);
          return (
            <Link
              key={href}
              href={href}
              // A tab whose page is already open would not change the route,
              // so the More screen's route-change close would never fire.
              onClick={() => setMoreOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn(ITEM, active ? "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-muted-foreground")}
            >
              <Icon className="size-[22px]" strokeWidth={active ? 2.3 : 1.8} aria-hidden />
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(!moreOpen)}
          aria-label="More"
          aria-expanded={moreOpen}
          className={cn(
            ITEM,
            moreOpen || !anyTabActive ? "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-muted-foreground"
          )}
        >
          <Ellipsis className="size-[22px]" strokeWidth={moreOpen || !anyTabActive ? 2.3 : 1.8} aria-hidden />
          More
        </button>
      </div>
    </nav>
    </>
  );
}
