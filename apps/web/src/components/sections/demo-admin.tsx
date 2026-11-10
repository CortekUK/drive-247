"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChevronDown,
  Compass,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Gift,
  KeyRound,
  LifeBuoy,
  MessageCircle,
  MessageSquare,
  Phone,
  Plug,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { AdminPage, DemoCar } from "./demo-pages";
import "./demo-admin.css";

/*
 * The operator's admin portal in the landing page's booking demo, drawn as Northwind's v2
 * portal draws it (apps/portal, v2 chrome): the sidebar with its Portal / Website switch and
 * three groups, the search pill scoped to the page, and each page's head, chart with its
 * side card, and table. Only Dashboard, Customers, Vehicles and Rentals open; the rest of
 * the sidebar is there to look the part.
 *
 * ALL DATA HERE IS SAMPLE DATA. Nothing is read from anywhere.
 */

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

type NavItem = { id: AdminPage | null; label: string; icon: typeof Gauge };
const GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { id: "dashboard", label: "Dashboard", icon: Gauge },
      { id: null, label: "Integrations", icon: Plug },
      { id: null, label: "Billing", icon: CreditCard },
      { id: null, label: "Rewards", icon: Gift },
    ],
  },
  {
    items: [
      { id: "customers", label: "Customers", icon: Users },
      { id: "vehicles", label: "Vehicles", icon: LifeBuoy },
      { id: "rentals", label: "Rentals", icon: KeyRound },
    ],
  },
  {
    label: "More",
    items: [
      { id: null, label: "Agreements", icon: FileText },
      { id: null, label: "Availability", icon: CalendarDays },
      { id: null, label: "Finances", icon: Wallet },
      { id: null, label: "Support", icon: MessageSquare },
    ],
  },
];

const SCOPE: Record<AdminPage, { label: string; placeholder: string } | null> = {
  dashboard: null,
  rentals: { label: "Rentals", placeholder: "Search customer, reg, rental #…" },
  customers: { label: "Customers", placeholder: "Search customers…" },
  vehicles: { label: "Vehicles", placeholder: "Search vehicles…" },
};

/* ── The shell ──────────────────────────────────────────────────────────────────────── */

export function AdminShell({
  brand,
  page,
  onPage,
  children,
}: {
  brand: { name: string; initial: string };
  page: AdminPage;
  onPage: (page: AdminPage) => void;
  children: ReactNode;
}) {
  const scope = SCOPE[page];
  return (
    <div className="cp np">
      <aside className="cp-side np-side">
        <div className="cp-org">
          <i aria-hidden>{brand.initial}</i>
          <b>{brand.name}</b>
          <span className="cp-icon" aria-hidden>
            <SlidersHorizontal />
          </span>
          <span className="cp-icon" aria-hidden>
            <ExternalLink />
          </span>
        </div>
        <div className="np-switch" aria-hidden>
          <span className="is-on">
            Portal <kbd>⌥1</kbd>
          </span>
          <span>
            Website <kbd>⌥2</kbd>
          </span>
        </div>
        <nav className="cp-nav np-nav" aria-label="Admin portal">
          {GROUPS.map((group, g) => (
            <div key={g} className="np-group">
              {group.label && <small className="np-group-label">{group.label}</small>}
              {group.items.map((item) =>
                item.id ? (
                  <button
                    key={item.label}
                    type="button"
                    aria-current={page === item.id ? "page" : undefined}
                    className={page === item.id ? "is-on" : undefined}
                    onClick={() => onPage(item.id as AdminPage)}
                  >
                    <item.icon aria-hidden />
                    {item.label}
                  </button>
                ) : (
                  <span key={item.label} className="np-nav-static">
                    <item.icon aria-hidden />
                    {item.label}
                  </span>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="cp-user np-user">
          <i aria-hidden>{brand.initial}</i>
          <span>
            <b>You</b>
            <small>Owner · Head admin</small>
          </span>
        </div>
      </aside>

      <div className="cp-main">
        <header className="cp-top">
          <span className="cp-search np-search" aria-hidden>
            <Search />
            {scope && (
              <span className="cp-scope np-scope">
                in <b>{scope.label}</b>
                <X />
              </span>
            )}
            <span className="cp-search-text">{scope ? scope.placeholder : "Search bookings, customers, vehicles…"}</span>
            {scope && (
              <span className="np-filter">
                <SlidersHorizontal />
              </span>
            )}
            <kbd>⌘K</kbd>
          </span>
          <span className="cp-tools" aria-hidden>
            <span className="np-phone">
              <Phone />
              +1 (555) 010-2470
            </span>
            <span className="cp-help">
              <i>
                <Sparkles />
              </i>
              Help
            </span>
            <span className="np-badged">
              <MessageCircle />
              <i>2</i>
            </span>
            <span className="np-badged">
              <Bell />
              <i>5</i>
            </span>
          </span>
        </header>
        {children}
      </div>
    </div>
  );
}

/* ── The pieces every page shares ───────────────────────────────────────────────────── */

export function AdminHead({ title, sub, icons, action }: { title: string; sub: string; icons: (typeof Gauge)[]; action?: string }) {
  return (
    <div className="np-head">
      <div>
        <h3>{title}</h3>
        <p>{sub}</p>
      </div>
      <span className="np-head-tools" aria-hidden>
        {icons.map((Icon, i) => (
          <span key={i} className="np-round">
            <Icon />
          </span>
        ))}
        {action && (
          <span className="cp-btn">
            <Plus />
            {action}
          </span>
        )}
      </span>
    </div>
  );
}

type Line = { d: string; kind: "main" | "soft" | "prev" };

/** The chart under a page head, with the side card beside it, as the v2 pages draw them. */
export function AdminHero({
  label,
  value,
  unit,
  delta,
  legend,
  lines,
  card,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: { text: string; up: boolean | null };
  legend: { kind: Line["kind"]; text: string; value?: string }[];
  lines: Line[];
  card: { title: string; sub: string };
}) {
  return (
    <div className="np-hero">
      <div className="np-chart">
        <div className="np-chart-top">
          <span className="np-metric">
            {label}
            <ChevronDown aria-hidden />
          </span>
          <span className="np-range">
            Last 30 days
            <ChevronDown aria-hidden />
          </span>
        </div>
        <div className="np-value">
          <b>{value}</b>
          {unit && <small>{unit}</small>}
          {delta && <span className={`np-delta${delta.up === true ? " is-up" : delta.up === false ? " is-down" : ""}`}>{delta.text}</span>}
          <span className="np-legend">
            {legend.map((item) => (
              <span key={item.text} className={`is-${item.kind}`}>
                <i />
                {item.text}
                {item.value && <b>{item.value}</b>}
              </span>
            ))}
          </span>
        </div>
        <svg className="np-lines" viewBox="0 0 600 150" preserveAspectRatio="none" aria-hidden>
          <path className="np-axis" d="M0 149H600" />
          {lines.map((line, i) => (
            <path key={i} className={`np-line is-${line.kind}`} d={line.d} />
          ))}
        </svg>
      </div>
      <div className="np-side-card">
        <b>{card.title}</b>
        <span>
          <small>{card.sub}</small>
          <em>
            Open <ArrowRight aria-hidden />
          </em>
        </span>
      </div>
    </div>
  );
}

/* ── Dashboard ──────────────────────────────────────────────────────────────────────── */

const REQUESTS = [
  { name: "Liam Foster", ask: "Keep the Genesis GV80 until Fri", age: "2h", face: "https://randomuser.me/api/portraits/men/22.jpg" },
  { name: "Mia Chen", ask: "Keep the Hyundai Sonata for longer", age: "1d", face: "https://randomuser.me/api/portraits/women/12.jpg" },
  { name: "Owen Price", ask: "Add a second driver", age: "3d", face: "https://randomuser.me/api/portraits/men/75.jpg" },
];

export function AdminDashboard({
  fresh,
  approved,
  onRentals,
}: {
  fresh: { name: string; car: string; total: number } | null;
  approved: boolean;
  onRentals: () => void;
}) {
  const revenue = 12480 + (fresh?.total ?? 0);
  const waiting = fresh && !approved;
  return (
    <div className="cp-page">
      <div className="np-hero is-dash">
        <div className="np-chart">
          <div className="np-value is-big">
            <b>{money(revenue)}</b>
          </div>
          <small className="np-caption">last 30 days</small>
          <svg className="np-lines is-tall" viewBox="0 0 600 150" preserveAspectRatio="none" aria-hidden>
            <path className="np-line is-prev" d="M0 142H70C90 142 92 110 110 108H260C280 108 285 96 300 94H400C420 94 425 60 440 56H560" />
            <path className="np-line is-main" d="M0 146H60C80 146 84 128 104 124H150C170 124 172 104 190 100H520" />
            <path className="np-line is-ahead" d="M520 100H600" />
          </svg>
        </div>
        <div className="np-side-card">
          <b>Your booking site</b>
          <span>
            <small>Bookings from your own site land here, ready to approve.</small>
            <em>
              See how it works <ArrowRight aria-hidden />
            </em>
          </span>
        </div>
      </div>

      <div className="np-cards">
        <div className="np-card is-brief">
          <small className="np-card-label">
            <i>
              <Sparkles />
            </i>
            Your business today
            <ArrowUpRight aria-hidden />
          </small>
          <b className="np-brief-head">Morning. 4 cars are out today, and 2 come back this afternoon.</b>
          <ul>
            {waiting && (
              <li>
                <button type="button" className="np-brief-link bd-hint" onClick={onRentals}>
                  <b>{fresh.name}</b> just booked the {fresh.car} on your website. It&apos;s waiting in Rentals for you.
                </button>
              </li>
            )}
            <li>
              <b>{money(revenue)}</b> came in over the last 30 days, up <b>18%</b> on the month before.
            </li>
            <li>
              Liam Foster wants to keep the Genesis GV80 <b>2 more days</b>.
            </li>
            <li>
              <b>3</b> cars are free all week, so there&apos;s room to take more bookings.
            </li>
          </ul>
          <span className="np-chips" aria-hidden>
            <i>Tell me more</i>
            <i>What first?</i>
            <i>Who owes most?</i>
          </span>
        </div>

        <div className="np-card">
          <small className="np-card-label">Requests</small>
          <ul className="np-requests">
            {waiting && (
              <li>
                <button type="button" className="np-request bd-hint" onClick={onRentals}>
                  <span className="np-avatar">{fresh.name.split(" ").map((w) => w[0]).join("")}</span>
                  <span>
                    <b>
                      {fresh.name} <em className="is-new">New booking</em>
                    </b>
                    <small>The {fresh.car}, from your website</small>
                  </span>
                  <time>now</time>
                </button>
              </li>
            )}
            {REQUESTS.map((request) => (
              <li key={request.name}>
                <span className="np-request">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="np-avatar" src={request.face} alt="" />
                  <span>
                    <b>
                      {request.name} <em>Extension</em>
                    </b>
                    <small>{request.ask}</small>
                  </span>
                  <time>{request.age}</time>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="np-card">
          <small className="np-card-label">To do</small>
          <span className="np-add">
            <Plus aria-hidden />
            Add a to-do
          </span>
          <ul className="np-todos">
            <li>
              <i />
              Wash the Camaro before Friday&apos;s pickup
            </li>
            <li>
              <i />
              Renew the GV80&apos;s registration
            </li>
            <li className="is-done">
              <i />
              Order new floor mats
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ── Customers ──────────────────────────────────────────────────────────────────────── */

const CUSTOMERS = [
  { name: "Ava Morgan", email: "ava.morgan@example.com", type: "Account", state: "Verified", gig: "No" },
  { name: "Liam Foster", email: "liam.foster@example.com", type: "Account", state: "Verified", gig: "Yes" },
  { name: "Mia Chen", email: "mia.chen@example.com", type: "Guest", state: "Verified", gig: "No" },
  { name: "Owen Price", email: "owen.price@example.com", type: "Account", state: "Pending", gig: "No" },
  { name: "Priya Nair", email: "priya.nair@example.com", type: "Guest", state: "Verified", gig: "Yes" },
  { name: "Daniel Okafor", email: "daniel.okafor@example.com", type: "Guest", state: "Unverified", gig: "No" },
];

export function AdminCustomers({ fresh, verified }: { fresh: { name: string; email: string } | null; verified: boolean }) {
  const rows = fresh ? [{ name: fresh.name, email: fresh.email, type: "Account", state: verified ? "Verified" : "Pending", gig: "No" }, ...CUSTOMERS] : CUSTOMERS;
  return (
    <div className="cp-page">
      <AdminHead title="Customers" sub="Manage customers and account balances" icons={[Compass, X, ExternalLink, Upload, Download]} action="Add Customer" />
      <AdminHero
        label="New customers"
        value={String(23 + (fresh ? 1 : 0))}
        delta={{ text: "↗ 92%", up: true }}
        legend={[
          { kind: "main", text: "New customers" },
          { kind: "soft", text: "Verified", value: "18" },
          { kind: "prev", text: "Previous 30 days", value: "12" },
        ]}
        lines={[
          { kind: "prev", d: "M0 146H250C300 146 320 140 360 120C400 100 420 96 600 96" },
          { kind: "soft", d: "M0 148H380C420 148 430 128 460 126H600" },
          { kind: "main", d: "M0 146H300C340 146 360 140 400 128C440 116 460 80 500 50C540 20 560 14 600 12" },
        ]}
        card={{ title: "Blocked customers", sub: "Who you won't rent to" }}
      />
      <div className="cp-card cp-table-wrap">
        <table className="cp-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Type</th>
              <th>Verification</th>
              <th>Gig driver</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.email} className={fresh && i === 0 ? "np-new" : undefined}>
                <td>
                  {c.name}
                  {fresh && i === 0 && <span className="bd-new">New</span>}
                </td>
                <td>{c.email}</td>
                <td>
                  <span className="np-pill">{c.type}</span>
                </td>
                <td className={c.state === "Verified" ? "is-ok" : c.state === "Pending" ? "is-warn" : "is-muted"}>{c.state}</td>
                <td>{c.gig}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cp-count np-count">
        Showing {rows.length} of {rows.length + 37} customers <span>Show more</span>
      </p>
    </div>
  );
}

/* ── Vehicles ───────────────────────────────────────────────────────────────────────── */

const MORE_CARS = [
  { reg: "KTL 4821", make: "Kia", model: "Telluride", year: 2025, color: "Black", state: "Available" },
  { reg: "TCM 1190", make: "Toyota", model: "Camry", year: 2024, color: "White", state: "Available" },
  { reg: "JWR 3307", make: "Jeep", model: "Wrangler", year: 2025, color: "Green", state: "On rent" },
  { reg: "TM3 0558", make: "Tesla", model: "Model 3", year: 2024, color: "Grey", state: "Available" },
  { reg: "HCR 7712", make: "Honda", model: "CR-V", year: 2023, color: "Blue", state: "In service" },
  { reg: "FEX 2046", make: "Ford", model: "Explorer", year: 2024, color: "Silver", state: "On rent" },
];

export function AdminVehicles({ cars, fresh }: { cars: readonly DemoCar[]; fresh: { car: string } | null }) {
  const rows = [
    ...cars.map((car, i) => {
      const [make, ...model] = car.name.split(" ");
      return {
        reg: ["HSN 2231", "GV8 0417", "CMR 5590"][i] ?? `DEM ${100 + i}`,
        make,
        model: model.join(" "),
        year: 2025,
        color: ["White", "Black", "Red"][i] ?? "White",
        state: fresh?.car === car.name ? "Booked" : i === 1 ? "On rent" : "Available",
      };
    }),
    ...MORE_CARS,
  ];
  const out = rows.filter((row) => row.state === "On rent").length;
  return (
    <div className="cp-page">
      <AdminHead title="Fleet Management" sub="Manage your vehicle fleet and track performance" icons={[Compass, Download]} action="Add Vehicle" />
      <AdminHero
        label="Cars on rent today"
        value={String(out)}
        unit={`of ${rows.length} cars`}
        delta={{ text: "↗ 1", up: true }}
        legend={[
          { kind: "main", text: "Cars on rent" },
          { kind: "soft", text: "Fleet", value: String(rows.length) },
          { kind: "prev", text: "On Oct 11", value: String(out - 1) },
        ]}
        lines={[
          { kind: "soft", d: "M0 30H420V18H600" },
          { kind: "main", d: "M0 110H180V96H360V84H520V80H600" },
          { kind: "prev", d: "M0 120H260V110H600" },
        ]}
        card={{ title: "Availability", sub: "Your hours and blocked dates" }}
      />
      <div className="cp-card cp-table-wrap">
        <table className="cp-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Make / Model</th>
              <th>Year</th>
              <th>Color</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.reg}>
                <td>{row.reg}</td>
                <td>
                  {row.make} <span className="np-soft">{row.model}</span>
                </td>
                <td>{row.year}</td>
                <td>{row.color}</td>
                <td className={row.state === "Available" ? "is-ok" : row.state === "In service" ? "is-muted" : "is-info"}>{row.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cp-count np-count">
        Showing {rows.length} of {rows.length} vehicles <span>Show more</span>
      </p>
    </div>
  );
}

/* ── Rentals: the head and chart above the list (the list stays in booking-demo.tsx) ──── */

export function AdminRentalsTop({ fresh }: { fresh: { total: number } | null }) {
  const value = 6214 + (fresh?.total ?? 0);
  return (
    <>
      <AdminHead title="Rentals" sub="Manage rental agreements and contracts" icons={[Compass, CalendarDays, Download]} action="New Rental" />
      <AdminHero
        label="Booked value"
        value={`${money(value)}.00`}
        delta={{ text: "↗ 18%", up: true }}
        legend={[
          { kind: "main", text: "Booked value" },
          { kind: "soft", text: "Picked up", value: "$3,980.00" },
          { kind: "prev", text: "Previous 30 days", value: "$5,266.00" },
        ]}
        lines={[
          { kind: "prev", d: "M0 146H200C230 146 240 110 270 110H420C450 110 460 80 480 70H600" },
          { kind: "soft", d: "M0 148H300C320 148 330 132 350 130H600" },
          { kind: "main", d: fresh ? "M0 146H220C250 146 260 92 290 90H500C520 90 530 50 560 46H600" : "M0 146H220C250 146 260 92 290 90H600" },
        ]}
        card={{ title: "Calendar View", sub: "See your fleet on a timeline" }}
      />
    </>
  );
}
