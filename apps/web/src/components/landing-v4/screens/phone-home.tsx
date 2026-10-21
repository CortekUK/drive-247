import { Bell, Ellipsis, FileText, LayoutGrid, MessageCircle, Phone, Search, Users } from "lucide-react";
import { TraxDot } from "../screens";
import { FeatureCard, RequestsCard, RevenueLine, TodoCard, TraxCard } from "./dashboard";
import { HiwStatus } from "./hiw-status";
import "./dashboard.css";
import "./phone-home.css";

/* ===================================================================== *
 * The portal's Home on a phone (390 × 820): the same v2 dashboard as the
 * laptop's Dashboard tab, laid out the way the portal lays it out under
 * 768px. Mirrors, in apps/portal/src:
 *   components/shared/layout/top-bar-v2.tsx      h-16 bar on the wash: the round
 *                                                search button (the pill is
 *                                                hidden sm:flex), then the helpline
 *                                                icon (number md:inline only),
 *                                                Help, messages and the bell
 *   components/dashboard-v2/dashboard-v2.tsx      the md:hidden large title: the
 *                                                date in small caps over "Home"
 *   components/dashboard-v2/home/phone-carousel.tsx  the desk row as a swipe
 *                                                carousel (86% cards, gap-3) + dots
 *   components/dashboard-v2/home/home-bands.tsx   the three cards stacked, gap-5
 *   components/dashboard-v2/home/requests-card.tsx  five rows on a phone
 *   components/dashboard-v2/home/todo-card.tsx    15px text, the time under it
 *   components/dashboard-v2/home/sortable-cards.tsx  grips max-md:hidden
 *   components/shared/layout/mobile-tab-bar.tsx   the flat 60px tab bar: Home,
 *                                                Rentals, Vehicles, Customers, More
 * Same demo tenant, data and clock (Tue 20 Oct, 09:14) as the laptop.
 * The page scrolls itself in short flicks, as a thumb would.
 * ===================================================================== */

const TABS = [
  { label: "Home", icon: <LayoutGrid strokeWidth={2.4} />, on: true },
  { label: "Rentals", icon: <FileText strokeWidth={1.75} /> },
  {
    label: "Vehicles",
    // NavVehicles (components/icons/nav-icons.tsx)
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12.6" r="2.5" />
        <path d="M9.6 12 3.1 11.1M14.4 12l6.5-.9M12 15.1V21" />
        <path d="M12 3v2.2" strokeWidth={3} />
      </svg>
    ),
  },
  { label: "Customers", icon: <Users strokeWidth={1.75} /> },
  { label: "More", icon: <Ellipsis strokeWidth={1.75} /> },
];

export function PhoneHomeScreen() {
  return (
    <div className="ph-home wash">
      <HiwStatus time="9:14" tone="dark" />
      <div className="ph-top">
        <span className="ph-search">
          <Search />
        </span>
        <span className="ph-right">
          <span className="ib tel">
            <Phone />
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
      <div className="ph-main">
        <div className="ph-scroll scr-dash">
          <header className="ph-title">
            <p>Tuesday 20 October</p>
            <h1>Home</h1>
          </header>
          <section className="ph-desk" aria-label="On your desk">
            <div className="ph-carousel">
              <RevenueLine />
              <FeatureCard />
            </div>
            <div className="ph-dots" aria-hidden="true">
              <span className="on" />
              <span />
            </div>
          </section>
          <section className="ph-ops" aria-label="Operations">
            <TraxCard />
            <RequestsCard />
            <TodoCard />
          </section>
        </div>
      </div>
      <nav className="ph-tabs" aria-label="Main">
        {TABS.map((t) => (
          <span key={t.label} className={t.on ? "on" : undefined}>
            {t.icon}
            {t.label}
          </span>
        ))}
      </nav>
    </div>
  );
}
