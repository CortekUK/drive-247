import type { ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  ChevronsUpDown,
  ExternalLink,
  Gift,
  MessageCircle,
  Pencil,
  Phone,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";

/*
 * The operator portal v2 chrome, drawn from the product's own source so the
 * landing page shows the portal as it really is — same layout, tokens, icons
 * and copy. Each part names the files it mirrors.
 *
 * This file holds only PortalShell (sidebar + top bar) and the chrome pieces
 * it is built from (OrgRow, ModeSwitch, NavRow, SidebarPromo, UserRow, TopBar,
 * TraxDot). The showcase screens (dashboard, booking site, checkout, calendar,
 * verification, finances, renter portal, insights) and the renter's phone in
 * "How it works" (phone-verify, phone-sign, phone-keys) live in screens/, one
 * file and stylesheet each; the operator screens wrap themselves in
 * PortalShell.
 *
 * Rendered at a fixed design size and scaled by frames.tsx. Styles for this
 * file are in portal-screens.css.
 */

/* ===================================================================== *
 * Operator portal v2 shell — the `chrome` area, as a head_admin on a v2
 * (lean) tenant sees it at 1280px, in apps/portal/src:
 *   app/(dashboard)/layout.tsx            frame, wash, <main> padding
 *   components/ui-v2/sidebar.tsx           16rem rail, menu-button variants
 *   components/shared/layout/app-sidebar-v2.tsx   rows, order, "More", footer
 *   components/shared/layout/org-switcher.tsx     org row (OrgMark: the tenant icon)
 *   components/shared/layout/sidebar-promo.tsx    footer promo card
 *   components/shared/layout/user-menu-v2.tsx     profile row + Settings gear
 *   components/shared/layout/top-bar-v2.tsx       search pill, right cluster
 *   components/shared/layout/helpline-link.tsx    support number
 *   components/notifications-v2/notification-bell-v2.tsx
 *   components/trax/trax-greeting.tsx      TraxMark (xs)
 *   components/icons/nav-icons.tsx         custom nav glyphs
 *   components/ui-v2/{button,avatar,separator}.tsx
 *   lib/lean-areas.ts                      which rows a lean tenant loses
 *   styles/v2-theme.css, tailwind.config.ts   tokens, radii, Manrope
 * ===================================================================== */

/** components/icons/nav-icons.tsx, path for path (2.2 stroke on a 24 grid). */
const NAV_ICON: Record<string, ReactNode> = {
  Dashboard: (
    <>
      <path d="M3.5 17.9A9.8 9.8 0 1 1 20.5 17.9" />
      <path d="M12 13 15.9 8.4" />
      <circle cx="12" cy="13" r="1.3" fill="currentColor" />
    </>
  ),
  Integrations: (
    <>
      <path d="M12.4 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7.4v-5.2a2.2 2.2 0 1 0 0-3.6Z" />
      <path d="M13.6 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5.4v-5a2.45 2.45 0 1 0 0-4Z" />
    </>
  ),
  Billing: (
    <>
      <path d="M19 7.5V5.8A1.8 1.8 0 0 0 17.2 4H5.5a2.5 2.5 0 0 0 0 5H19" />
      <path d="M5.5 9H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 17.5v-11" />
      <path d="M16.5 14.5h.01" strokeWidth={3.2} />
    </>
  ),
  Customers: (
    <>
      <path d="M5.2 6.2a2.6 2.6 0 0 0 0 5M2 17.8c0-2.3 1.2-4 3-4.6" />
      <circle cx="12" cy="8" r="3.2" />
      <path d="M6.5 20c0-3.3 2.4-5.6 5.5-5.6s5.5 2.3 5.5 5.6" />
      <path d="M18.8 6.2a2.6 2.6 0 0 1 0 5M22 17.8c0-2.3-1.2-4-3-4.6" />
    </>
  ),
  Vehicles: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12.6" r="2.5" />
      <path d="M9.6 12 3.1 11.1M14.4 12l6.5-.9M12 15.1V21" />
      <path d="M12 3v2.2" strokeWidth={3} />
    </>
  ),
  Rentals: (
    <>
      <circle cx="8" cy="8" r="4.8" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
      <path d="M11.4 11.4 20.5 20.5" />
      <path d="M16.2 16.2l2.4-2.4" />
    </>
  ),
  Agreements: (
    <>
      <path d="M6 2.5h8l5.5 5.5v11.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z" />
      <path d="M14 2.5V7a1 1 0 0 0 1 1h4.5" />
      <path d="M7.5 16.5c1.2-2.3 2.1-2.6 2.6-.8.4 1.4 1.3 1.4 2.4-.4.5-.8 1-.9 1.4-.2.3.5.8.6 1.6.2" />
    </>
  ),
  Availability: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
      <path d="M3 10h18" />
      <path d="M8 2.5v3.6M16 2.5v3.6" />
      <path d="M7.5 15.5h6" />
    </>
  ),
  Finances: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M2.5 9.8h19" />
      <path d="M6.5 15h3.5" />
    </>
  ),
  Insights: (
    <>
      <path d="M5.5 20.5V13" />
      <path d="M12 20.5V8" />
      <path d="M18.5 20.5V3.5" />
    </>
  ),
  Support: (
    <>
      <path d="M5 3.5h14a2.5 2.5 0 0 1 2.5 2.5v8.5A2.5 2.5 0 0 1 19 17h-6.5L8 21v-4H5a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 5 3.5Z" />
      <path d="M8 10.3h.01M12 10.3h.01M16 10.3h.01" strokeWidth={3} />
    </>
  ),
};

function NavIcon({ name }: { name: string }) {
  if (name === "Rewards") return <Gift />;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      {NAV_ICON[name]}
    </svg>
  );
}

/** One SidebarMenuButton with app-sidebar-v2's NAV_ROW: 32px, 17px icon, 13px medium label, red count. */
function NavRow({ label, active, badge }: { label: string; active?: boolean; badge?: number }) {
  return (
    <span className={`nr${active ? " on" : ""}`}>
      <NavIcon name={label} />
      <span className="lb">{label}</span>
      {badge ? <em className="badge">{badge}</em> : null}
    </span>
  );
}

/** TraxMark size="xs" (trax-greeting.tsx) — the conic sparkle disc, 20px. */
export function TraxDot() {
  return (
    <span className="trax-dot" aria-hidden="true">
      <span className="lift">
        <span className="cone" />
      </span>
      <Sparkles strokeWidth={2} />
    </span>
  );
}

/**
 * org-switcher.tsx: OrgMark, name, then the hover-only pencil, customise and
 * open-site controls. Northwind has a square icon (`favicon_url`), so OrgMark
 * draws that image (h-8 w-8 rounded-lg object-contain) rather than initials;
 * the name is the tenant's display name, "Northwind".
 */
function OrgRow() {
  return (
    <div className="org">
      <span className="site">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo-img" src="/landing-v3/app-icon-512.png" alt="" />
        <b>Northwind</b>
      </span>
      <span className="ib ghost">
        <Pencil />
      </span>
      <span className="fill" />
      <span className="ib">
        <SlidersHorizontal />
      </span>
      <span className="ib">
        <ExternalLink />
      </span>
    </div>
  );
}

/** The Portal / Website tab strip with its sliding pill. */
function ModeSwitch() {
  return (
    <div className="mode-wrap">
      <div className="mode">
        <i className="pill" aria-hidden="true" />
        <span className="on">
          Portal<kbd>⌥1</kbd>
        </span>
        <span>
          Website<kbd>⌥2</kbd>
        </span>
      </div>
    </div>
  );
}

/**
 * Main sidebar mode. A lean v2 tenant (lib/lean-areas.ts) loses Welcome Pack
 * and every drill-down group: Fleet Quotes, Expenses, Reminders, Reports and
 * P&L are lean-hidden, Pending Bookings needs payment_mode "manual" (default
 * "automated"), and Fleet / Pipeline / Owners are off by default — so "More"
 * is its flat rows only. Insights and Insurances are `optional` (off until the
 * customiser turns them on). Shown here as the live northwind portal has it
 * customised — Insights on, Availability above Agreements — because the
 * showcase has an Insights tab and its row should be there to light up.
 */
function PortalSidebar({ active }: { active?: string }) {
  return (
    <aside className="ps-side">
      <OrgRow />
      <div className="ps-content">
        <ModeSwitch />
        <nav className="grp-a">
          {["Dashboard", "Integrations", "Billing", "Rewards"].map((l) => (
            <NavRow key={l} label={l} active={l === active} />
          ))}
        </nav>
        <i className="sep" />
        <nav className="grp-a">
          {["Customers", "Vehicles", "Rentals"].map((l) => (
            <NavRow key={l} label={l} active={l === active} />
          ))}
        </nav>
        <nav className="grp-more">
          <small className="more-lb">More</small>
          {["Availability", "Agreements", "Finances", "Insights"].map((l) => (
            <NavRow key={l} label={l} active={l === active} />
          ))}
          <NavRow label="Support" active={active === "Support"} badge={2} />
        </nav>
      </div>
      <div className="ps-foot">
        <SidebarPromo />
        <UserRow />
      </div>
    </aside>
  );
}

/** sidebar-promo.tsx — shown until the operator dismisses it. */
function SidebarPromo() {
  return (
    <div className="promo-wrap">
      <div className="promo">
        <i className="sheen" />
        <i className="glow" />
        <span className="x">
          <X />
        </span>
        <p className="t">Portal Appearance</p>
        <p className="b">Pick your brand colour and logo, and watch the portal change as you do.</p>
        <span className="cta">
          Try it <ArrowRight />
        </span>
      </div>
    </div>
  );
}

/** user-menu-v2.tsx variant="row" settings — avatar fallback initials, name, email, gear, caret. */
function UserRow() {
  return (
    <div className="user">
      <span className="me">
        <span className="av">MO</span>
        <span className="who">
          <b>Maya Okafor</b>
          <small>maya@northwindrentals.com</small>
        </span>
      </span>
      <span className="ub">
        <Settings />
      </span>
      <span className="ub">
        <ChevronsUpDown />
      </span>
    </div>
  );
}

/**
 * What a list page lends the top bar through usePageSearch (page-search-slot.tsx):
 * the field's placeholder, the scope chip ("in Invoices ×") and, when the page
 * has a filter panel, the sliders button before ⌘K.
 */
export type PageSearch = { placeholder: string; scopeLabel?: string; filters?: boolean };

/**
 * top-bar-v2.tsx at 1280px. With no page search: the global ⌘K pill. With one,
 * the page's own field (max-w-[440px]): scope chip, placeholder, filters, ⌘K.
 * Then the separator, helpline, Help (Trax), Crossroads, notifications. No
 * credits pill: northwind is on integration billing (`useIntegrationBilling`),
 * which retires it.
 */
function TopBar({ search }: { search?: PageSearch }) {
  return (
    <div className="ps-top">
      {search ? (
        <span className="search page">
          <Search />
          {search.scopeLabel && (
            <span className="scope">
              <span className="in">in</span>
              {search.scopeLabel}
              <span className="sx">
                <X />
              </span>
            </span>
          )}
          <span className="ph">{search.placeholder}</span>
          {search.filters && (
            <span className="flt">
              <SlidersHorizontal />
            </span>
          )}
          <kbd className="sq">⌘K</kbd>
        </span>
      ) : (
        <span className="search">
          <Search />
          <span className="ph">Search bookings, customers, vehicles…</span>
          <kbd>⌘K</kbd>
        </span>
      )}
      <span className="right">
        <i className="div" />
        <span className="phone">
          <Phone />
          <span>+1 315 444 0085</span>
        </span>
        <span className="help">
          <TraxDot />
          Help
        </span>
        <span className="ib">
          <MessageCircle />
          <em>2</em>
        </span>
        <span className="ib">
          <Bell />
          <em>3</em>
        </span>
      </span>
    </div>
  );
}

/** `ps-body` is the layout's <main>: p-4, pt-0 under the bar, first child pulled up 14px. Pages bring their own padding. */
export function PortalShell({ active, search, children }: { active?: string; search?: PageSearch; children: ReactNode }) {
  return (
    <div className="ps wash">
      <PortalSidebar active={active} />
      <div className="ps-main">
        <TopBar search={search} />
        <div className="ps-body">{children}</div>
      </div>
    </div>
  );
}
