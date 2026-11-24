'use client';

/**
 * Super Admin's phone navigation, as the operator portal's is now (apps/portal
 * components/shared/layout/mobile-tab-bar.tsx, boss, Nov 2026): no "More"
 * screen. Three places and one filled action in the CENTRE, then Search.
 *
 *   MobileTabBar      — Home · Companies · (+ Company) · <third rail page> ·
 *                       Search. The places are the head of the rail as this
 *                       user arranged it (Customise sidebar), so the bar can
 *                       never offer a page the rail would not. The plus starts
 *                       a rental company, the way the operator's plus starts a
 *                       rental: it opens Rental Companies' own "Add New
 *                       Company" chooser. Search asks the top bar to open
 *                       search (OPEN_PHONE_SEARCH_EVENT): the page's own field
 *                       when the page lends one, otherwise ⌘K search.
 *   The full menu     — the burger at the TOP LEFT of the top bar opens the
 *                       desktop sidebar itself, full screen (ui/sidebar.tsx),
 *                       so its order, the org row, the Admin | Retention
 *                       switch, the customiser and the profile row (Settings,
 *                       Dark Mode, Sign Out) are exactly the desktop's.
 *   PhoneSectionChips — a page's own sections (useRegisterSidebarSections),
 *                       which a desktop shows in the rail, as a row of chips
 *                       that scrolls sideways under the top bar.
 *
 * Phone only (`md:hidden`). Flat and attached to the bottom edge — solid page
 * colour, one hairline on top, no float, no shadow — padded for the home
 * indicator. The active tab is marked by colour and weight alone.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Building2, LayoutGrid, Plus, Search, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebarSections } from '@/components/admin/sidebar-sections';
import { isNavActive, useAdminNav, type AdminNavItem } from '@/components/admin/admin-nav';

/** The bar's Search asks the top bar to open search (TopBar.tsx). */
export const OPEN_PHONE_SEARCH_EVENT = 'admin-open-phone-search';

/** The bar's plus asks Rental Companies to open its "Add New Company" chooser. */
export const OPEN_ADD_COMPANY_EVENT = 'admin-open-add-company';
/** …or, from any other page, lands there with this asking the same. */
export const ADD_COMPANY_PARAM = 'new';

const COMPANIES = '/admin/rentals';

// ─── Tab bar ────────────────────────────────────────────────────────────────

/** Short labels for the bar; the rail's names are too long for a fifth of a phone. */
const SHORT: Record<string, { label: string; icon?: LucideIcon }> = {
  '/admin/dashboard': { label: 'Home', icon: LayoutGrid },
  '/admin/rentals': { label: 'Companies', icon: Building2 },
  '/admin/onboarding-questions': { label: 'Questions' },
  '/admin/contacts': { label: 'Contacts' },
  '/admin/blacklist': { label: 'Blacklist' },
  '/admin/signup-plans': { label: 'Plans' },
  '/admin/promo-codes': { label: 'Promos' },
  '/admin/announcements': { label: 'Updates' },
  '/admin/sales': { label: 'Onboarding' },
};

const ITEM =
  'relative flex min-w-fit flex-1 flex-col whitespace-nowrap items-center justify-center gap-[5px] text-[11.5px] leading-none font-medium tracking-[0.01em] transition-[color,transform] duration-200 ease-out active:scale-[0.94] motion-reduce:transition-none';
const ACTIVE_TEXT = 'font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]';
const IDLE_TEXT = 'text-muted-foreground';

function TabLink({ item, active }: { item: AdminNavItem; active: boolean }) {
  const short = SHORT[item.href];
  const Icon = short?.icon ?? item.icon;
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} className={cn(ITEM, active ? ACTIVE_TEXT : IDLE_TEXT)}>
      <Icon className="size-5" strokeWidth={active ? 2.4 : 1.75} aria-hidden />
      {/* Never cut: a tab is at least as wide as its label ("Integrations"),
          and the others share what is left. */}
      <span className="px-0.5">{short?.label ?? item.name}</span>
    </Link>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const nav = useAdminNav();

  // The head of the rail, as this user arranged it. Support opens in its own
  // tab, so it never takes a slot.
  const tabs = nav.topLevel.filter((i) => !i.newTab).slice(0, 3);
  // Sales-only accounts have no Rental Companies to add to.
  const canAddCompany = !nav.salesOnly && nav.topLevel.some((i) => i.href === COMPANIES);

  const addCompany = () => {
    if (pathname === COMPANIES) window.dispatchEvent(new Event(OPEN_ADD_COMPANY_EVENT));
    else router.push(`${COMPANIES}?${ADD_COMPANY_PARAM}=1`);
  };

  return (
    <div
      data-mobile-tab-bar=""
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)] md:hidden"
    >
      <nav aria-label="Main" className="mx-auto flex h-[60px] max-w-lg items-stretch px-1">
        {tabs.slice(0, 2).map((tab) => (
          <TabLink key={tab.href} item={tab} active={isNavActive(pathname, tab.href)} />
        ))}

        {canAddCompany && (
          <button type="button" onClick={addCompany} aria-label="Add New Company" className={cn(ITEM, IDLE_TEXT)}>
            {/* The one filled control on the bar, the operator's: a 46×30 pill
                a little above the other icons' row, so the label stays on one
                line with the rest. */}
            <span className="-mt-0.5 flex h-[30px] w-[46px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_hsl(var(--primary)/0.6)]">
              <Plus className="size-[19px]" strokeWidth={2.5} aria-hidden />
            </span>
            Company
          </button>
        )}

        {tabs.slice(2).map((tab) => (
          <TabLink key={tab.href} item={tab} active={isNavActive(pathname, tab.href)} />
        ))}

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

// ─── A page's sections, on a phone ──────────────────────────────────────────

/**
 * A page's own sections — the rail's job on a desktop — as chips that scroll
 * sideways, the way Northwind's dashboard lays out a row too wide for a phone.
 * The open one is filled; tapping one scrolls it into view.
 */
export function PhoneSectionChips() {
  const registration = useSidebarSections();
  const sections = registration?.sections ?? [];
  const active = registration?.active;

  useEffect(() => {
    if (!active) return;
    document
      .querySelector<HTMLElement>(`[data-phone-section="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [active]);

  if (sections.length === 0) return null;

  return (
    <div className="shrink-0 md:hidden">
      <div
        role="tablist"
        aria-label={registration?.title ?? 'Sections'}
        className="flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((section) => {
          const on = section.id === active;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={on}
              data-phone-section={section.id}
              onClick={() => registration?.onSelect(section.id)}
              className={cn(
                'h-8 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-200',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground active:bg-primary/[0.06]',
              )}
            >
              {section.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
