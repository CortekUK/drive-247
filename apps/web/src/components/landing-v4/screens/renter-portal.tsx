import type { ComponentType } from "react";
import {
  ArrowUpDown,
  Bell,
  Calendar,
  CalendarCheck,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  DollarSign,
  FileSignature,
  FileText,
  History,
  Megaphone,
  MessageCircle,
  MessageSquare,
  PanelLeft,
  Search,
  Settings,
  Shield,
  Sun,
} from "lucide-react";
import "./renter-portal.css";

/* ===================================================================== *
 * Renter portal — the ORIGINAL customer portal every tenant except
 * `northwind` gets (apps/booking/src/lib/booking-design.ts: only
 * NEW_DESIGN_TENANTS are rewritten to the new design), as a signed-in
 * renter sees it first in a 1280 × 800 window.
 *
 * `/portal` itself renders nothing and router.replace()s to
 * `/portal/bookings`, so "what a renter sees first" is My Bookings.
 *
 * Mirrors, file for file (apps/booking/src/...):
 *   app/(legacy)/(customer-portal)/layout.tsx       SidebarProvider shell,
 *       SidebarInset, <main> flex-col gap-4 p-4, TraxChatWidget launcher
 *   app/(legacy)/(customer-portal)/portal/page.tsx  redirect → /portal/bookings
 *   app/(legacy)/(customer-portal)/portal/bookings/page.tsx
 *       header + "Book a Vehicle", StatCard ×4, All/Active/Current/Past tabs,
 *       "Search by reference...", Newest First sort, the rental rows
 *       (ref badge, name, plate, dates, Booked …, amount, alerts, status)
 *   components/customer-portal/CustomerPortalSidebar.tsx  nav items + badges
 *   components/customer-portal/CustomerPortalHeader.tsx   trigger, bell,
 *       AnnouncementsBell, ThemeToggle, profile button
 *   components/customer-portal/trax-chat/TraxChatButton.tsx  floating chat
 *   components/ui/{sidebar,card,badge,tabs,button,input,select,avatar}.tsx
 * Tokens: the colours supabase/functions/signup-provision writes for a new
 * self-serve tenant (_shared/brand-colors.ts buildTenantPalette of the
 * default palette), run through hooks/useDynamicTheme.ts' dark branch over
 * app/(legacy)/globals.css `.dark` — indigo #6366F1 accent → --primary,
 * #0F172A sidebar, #0B1120 page. customer_theme_mode is left at the code
 * default 'dark' (layout.tsx getTenantThemeMode). Resolved values: renter-portal.css.
 *
 * Demo data: renter Daniel Reyes, tenant "Northwind Rentals" (no logo
 * uploaded, so the sidebar shows company_name as text), USD. Refs use the
 * DB trigger's format ('R-' + first 6 hex of the rental id); dates use the
 * page's 'dd MMM yyyy' and 'dd MMM yyyy, HH:mm'; money uses formatCurrency
 * (en-US, 2 dp). Stats follow useCustomerRentalStats over these 4 rentals.
 * ===================================================================== */

type Icon = ComponentType<{ className?: string }>;

const NAV: [string, Icon][] = [
  ["Bookings", Car],
  ["Payments", CreditCard],
  ["ID Verification", Shield],
  ["Insurance", FileText],
  ["Agreements", FileSignature],
  ["Messages", MessageSquare],
  ["Settings", Settings],
];

const STATS: [string, string, Icon][] = [
  ["Active Rentals", "2", Car],
  ["Total Rentals", "4", CalendarCheck],
  ["Past Rentals", "2", History],
  ["Total Spent", "$2,584.00", DollarSign],
];

type Status = "Pending" | "Active" | "Completed";

const RENTALS: {
  ref: string;
  name: string;
  reg: string;
  photo: string | null;
  dates: string;
  booked: string;
  amount: string;
  sign?: boolean;
  status: Status;
}[] = [
  {
    ref: "R-3fa0d2",
    name: "Hyundai Sonata",
    reg: "9LMV284",
    photo: "/landing-v4/cars/sonata.webp",
    dates: "07 Nov 2026 — 10 Nov 2026",
    booked: "19 Oct 2026, 09:15",
    amount: "$327.00",
    sign: true,
    status: "Pending",
  },
  {
    ref: "R-7c41e9",
    name: "Genesis GV80",
    reg: "8KTR512",
    photo: "/landing-v4/cars/gv80.webp",
    dates: "18 Oct 2026 — 25 Oct 2026",
    booked: "12 Oct 2026, 14:32",
    amount: "$1,260.00",
    status: "Active",
  },
  {
    ref: "R-b2e817",
    name: "Chevrolet Camaro",
    reg: "7WXN193",
    photo: "/landing-v4/cars/camaro.webp",
    dates: "12 Sep 2026 — 15 Sep 2026",
    booked: "03 Sep 2026, 18:47",
    amount: "$585.00",
    status: "Completed",
  },
  {
    ref: "R-04d9f3",
    name: "Toyota Camry",
    reg: "6PJD447",
    photo: null,
    dates: "21 Aug 2026 — 24 Aug 2026",
    booked: "14 Aug 2026, 11:02",
    amount: "$412.00",
    status: "Completed",
  },
];

export function CustomerPortalScreen() {
  return (
    <div className="scr-rp">
      {/* CustomerPortalSidebar — collapsible="icon", expanded (16rem) */}
      <aside className="sb">
        <div className="sb-h">
          <span className="co">Northwind Rentals</span>
        </div>
        <div className="sb-c">
          <div className="grp">
            <span className="mb back">
              <ChevronLeft />
              <span>Back to Booking</span>
            </span>
          </div>
          <div className="grp">
            <div className="lbl">Navigation</div>
            <ul>
              {NAV.map(([title, I]) => (
                <li key={title}>
                  <span className={`mb${title === "Bookings" ? " on" : ""}${title === "Messages" ? " pr" : ""}`}>
                    <I />
                    <span>{title}</span>
                  </span>
                  {title === "Messages" ? <span className="unread">1</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      {/* SidebarInset */}
      <div className="inset">
        {/* CustomerPortalHeader */}
        <header className="hd">
          <span className="trig">
            <PanelLeft />
          </span>
          <span className="sep" />
          <span className="fill" />
          <div className="acts">
            <span className="ib">
              <Bell />
              <span className="cnt">2</span>
            </span>
            <span className="ib">
              <Megaphone />
            </span>
            <span className="tt">
              <Sun />
            </span>
            <span className="prof">
              <span className="av">DR</span>
              <span className="who">
                <b>Daniel Reyes</b>
                <small>daniel.reyes@example.com</small>
              </span>
              <ChevronDown />
            </span>
          </div>
        </header>

        <main className="mn">
          {/* bookings/page.tsx */}
          <div className="pg">
            <div className="ph">
              <div>
                <div className="h1">My Bookings</div>
                <p>View and manage your rentals</p>
              </div>
              <span className="btn">
                <Car />
                Book a Vehicle
              </span>
            </div>

            <div className="stats">
              {STATS.map(([title, value, I]) => (
                <div key={title} className="card">
                  <div className="ch">
                    <div className="ct">{title}</div>
                    <I />
                  </div>
                  <div className="cc">
                    <div className="v">{value}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bar">
              <div className="tabs">
                <span className="on">All</span>
                <span>Active</span>
                <span>Current</span>
                <span>Past</span>
              </div>
              <div className="tools">
                <div className="srch">
                  <Search />
                  <span className="in">Search by reference...</span>
                </div>
                <div className="sort">
                  <ArrowUpDown />
                  <span className="sel">
                    <span>Newest First</span>
                    <ChevronDown />
                  </span>
                </div>
              </div>
            </div>

            <div className="list">
              {RENTALS.map((r) => (
                <div key={r.ref} className="row">
                  <div className="th">
                    {r.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.photo} alt={r.name} />
                    ) : (
                      <span className="ph0">
                        <Car />
                      </span>
                    )}
                  </div>
                  <div className="info">
                    <div className="l1">
                      <span className="ref">#{r.ref}</span>
                      <p className="nm">{r.name}</p>
                      <span className="reg">{r.reg}</span>
                    </div>
                    <div className="l2">
                      <span>
                        <Calendar />
                        {r.dates}
                      </span>
                      <span>
                        <Clock />
                        Booked {r.booked}
                      </span>
                      <span>{r.amount}</span>
                    </div>
                  </div>
                  <div className="alerts">{r.sign ? <span className="sign">Sign Agreement</span> : null}</div>
                  <span className={`st ${r.status.toLowerCase()}`}>{r.status}</span>
                  <ChevronRight className="chev" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      {/* TraxChatWidget → TraxChatButton (fixed bottom-6 right-6) */}
      <span className="trax">
        <MessageCircle />
        <span className="cnt">1</span>
      </span>
    </div>
  );
}
