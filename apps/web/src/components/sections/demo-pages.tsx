"use client";

import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Bell, CalendarDays, Car, Check, CreditCard, Ellipsis, ExternalLink, FileSignature, KeyRound, LayoutDashboard, Loader2, Mail, MapPin, Menu, MessageCircle, Phone, Plus, Search, Settings, ShieldCheck, Sparkles, Star, Tag, Users, X, Youtube, Instagram, Facebook, Twitter, Linkedin } from "lucide-react";
import "./demo-pages.css";

/*
 * The pages behind the demo's navigation (booking-demo.tsx), so the preview can be clicked
 * around like the real thing (Ghulam, 2026-11-10: "a live preview, no authentication, mock
 * data"):
 *
 *   the booking site   Fleet and Pricing, Promotions, Reviews, About, Contact, with the
 *                      site's header and a footer that links to the admin portal;
 *   the customer's portal   Northwind's v2 portal, copied: Rentals, one rental, Insurances,
 *                      Agreements, Finances (captured from apps/booking, 2026-11-10);
 *   the admin portal   Dashboard, Customers, Vehicles (Rentals stays in booking-demo.tsx).
 *
 * Everything here is made up and nothing is sent anywhere. The cars are the demo's own three.
 */

export type SitePage = "home" | "fleet" | "promotions" | "reviews" | "about" | "contact";
export const SITE_NAV: { id: SitePage; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "fleet", label: "Fleet and Pricing" },
  { id: "promotions", label: "Promotions" },
  { id: "reviews", label: "Reviews" },
  { id: "about", label: "About" },
  { id: "contact", label: "Contact" },
];

/* The customer's portal is Northwind's v2 one: Rentals (and one rental, opened), Insurances, Agreements, Finances. */
export type RenterPage = "rentals" | "rental" | "insurances" | "agreements" | "finances";
export const RENTER_NAV: { id: RenterPage; label: string; icon: typeof Car }[] = [
  { id: "rentals", label: "Rentals", icon: KeyRound },
  { id: "insurances", label: "Insurances", icon: ShieldCheck },
  { id: "agreements", label: "Agreements", icon: FileSignature },
  { id: "finances", label: "Finances", icon: CreditCard },
];

export type AdminPage = "dashboard" | "customers" | "vehicles" | "rentals";
export const ADMIN_NAV: { id: AdminPage; label: string; icon: typeof Car }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "customers", label: "Customers", icon: Users },
  { id: "vehicles", label: "Vehicles", icon: Car },
  { id: "rentals", label: "Rentals", icon: KeyRound },
];

export type DemoCar = { id: string; name: string; meta: string; rate: number; photo: string };
type Brand = { name: string; initial: string; slug: string };
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

/* ── The booking site ──────────────────────────────────────────────────────────────────── */

export function SiteHeader({
  brand,
  page,
  onNav,
  onSignIn,
  onBook,
  onMenu,
}: {
  brand: Brand;
  /** The page showing, or null inside the booking widget. */
  page: SitePage | null;
  onNav: (page: SitePage) => void;
  onSignIn: () => void;
  onBook: () => void;
  /** On a phone the pages move into a menu (PhoneMenu), opened from the round button. */
  onMenu?: () => void;
}) {
  return (
    <header className="bd-site-bar">
      <button type="button" className="bd-brand" onClick={() => onNav("home")}>
        <i aria-hidden>{brand.initial}</i>
        {brand.name}
      </button>
      <nav className="bd-site-nav dp-nav" aria-label={`${brand.name} pages`}>
        {SITE_NAV.map((item) => (
          <button key={item.id} type="button" aria-current={page === item.id ? "page" : undefined} onClick={() => onNav(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <span className="dp-acts">
        {/* No sign-in in the preview: the renter's way in is a Dashboard button. */}
        <button type="button" className="dp-signin" onClick={onSignIn}>
          <LayoutDashboard aria-hidden />
          Dashboard
        </button>
        <button type="button" className="bd-site-cta" onClick={onBook}>
          Book a car
        </button>
      </span>
      {onMenu && (
        <button type="button" className="dp-burger" onClick={onMenu} aria-label="Open menu">
          <Menu aria-hidden />
        </button>
      )}
    </header>
  );
}

/* The foot of every page of the site: its pages again, and the way in to the admin portal. */
export function SiteFooter({
  brand,
  onNav,
  onSignIn,
  onAdmin,
  onBook,
  glass = false,
  cars = [],
}: {
  brand: Brand;
  onNav: (page: SitePage) => void;
  onSignIn: () => void;
  onAdmin: () => void;
  /** For the phone footer's "Book a car". */
  onBook?: () => void;
  /** The Glass template's footer on a phone: a frosted card, not the deep slab. */
  glass?: boolean;
  cars?: readonly DemoCar[];
}) {
  return (
    <>
    <PhoneFooter brand={brand} onNav={onNav} onSignIn={onSignIn} onAdmin={onAdmin} onBook={onBook ?? (() => onNav("fleet"))} glass={glass} cars={cars} />
    <footer className="dp-foot">
      <div>
        <b className="bd-brand">
          <i aria-hidden>{brand.initial}</i>
          {brand.name}
        </b>
        <p>Book your car online, day or night. We&apos;ll have it ready for you.</p>
      </div>
      <nav aria-label="Site">
        <b>Site</b>
        {SITE_NAV.slice(1).map((item) => (
          <button key={item.id} type="button" onClick={() => onNav(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <nav aria-label="Accounts">
        <b>Accounts</b>
        <button type="button" onClick={onSignIn}>
          Customer portal
        </button>
        <button type="button" className="dp-admin" onClick={onAdmin}>
          Rental admin portal
        </button>
      </nav>
      <p className="dp-foot-line">
        © {brand.name} · {brand.slug}.drive-247.com
      </p>
    </footer>
    </>
  );
}

/*
 * The site's footer as a phone shows it, shown only inside the demo's handset (booking-demo.css,
 * "On a phone"). Classic follows site-v2's footer (apps/booking/src/northwind-site/site-v2/
 * site-footer.tsx): a deep slab of the operator's colour (--nw-foot, styles/site.css: their
 * colour 36% into #0b0a16), the name, the line, a white Book a car, then Company · Services ·
 * Legal · Our cars two by two, Contact us, and the copyright over the social icons. Glass follows
 * template 2's footer (template-2/footer.tsx): the same parts on a frosted card. The two portals
 * the demo needs to reach sit with Company, where a renter looks for their account.
 */
function PhoneFooter({
  brand,
  onNav,
  onSignIn,
  onAdmin,
  onBook,
  glass,
  cars,
}: {
  brand: Brand;
  onNav: (page: SitePage) => void;
  onSignIn: () => void;
  onAdmin: () => void;
  onBook: () => void;
  glass: boolean;
  cars: readonly DemoCar[];
}) {
  const year = 2026;
  const col = (heading: string, items: { label: string; go?: () => void; admin?: boolean }[]) => (
    <div className="dp-mf-col">
      <b>{heading}</b>
      {items.map((item) =>
        item.go ? (
          <button key={item.label} type="button" className={item.admin ? "dp-admin" : undefined} onClick={item.go}>
            {item.label}
          </button>
        ) : (
          <span key={item.label}>{item.label}</span>
        ),
      )}
    </div>
  );
  return (
    <footer className={`dp-mfoot${glass ? " is-glass" : ""}`}>
      <div className="dp-mf-in">
        <div className="dp-mf-lead">
          {glass ? (
            <b className="bd-brand">
              <i aria-hidden>{brand.initial}</i>
              {brand.name}
            </b>
          ) : (
            <b className="dp-mf-name">{brand.name}</b>
          )}
          <p>{glass ? "Book your car online, day or night. It is ready when you arrive." : "Book your car online, day or night. We'll have it ready for you."}</p>
          <button type="button" className="dp-mf-book" onClick={onBook}>
            Book a car
            {glass && <ArrowUpRight aria-hidden />}
          </button>
        </div>
        <div className="dp-mf-grid">
          {col("Company", [
            { label: "About us", go: () => onNav("about") },
            { label: "Contact us", go: () => onNav("contact") },
            { label: "Customer portal", go: onSignIn },
            { label: "Rental admin portal", go: onAdmin, admin: true },
          ])}
          {col("Services", [
            { label: "Fleet and Pricing", go: () => onNav("fleet") },
            { label: "Book a Vehicle", go: onBook },
            { label: "Promotions", go: () => onNav("promotions") },
          ])}
          {col("Legal", [{ label: "Privacy Policy" }, { label: "Terms & Conditions" }])}
          {col(
            "Our cars",
            cars.map((car) => ({ label: car.name, go: () => onNav("fleet") })),
          )}
        </div>
        <div className="dp-mf-col dp-mf-contact">
          <b>Contact us</b>
          <span>
            <Mail aria-hidden />
            hello@{brand.slug}.com
          </span>
          <span>
            <Phone aria-hidden />
            (555) 000-1234
          </span>
          <span>
            <MapPin aria-hidden />
            100 Market St, Springfield
          </span>
        </div>
        <div className="dp-mf-end">
          <small>
            © {year} {brand.name}. All rights reserved.
          </small>
          <span className="dp-mf-social" aria-hidden>
            <Youtube />
            <Instagram />
            <Facebook />
            <Twitter />
            <Linkedin />
          </span>
        </div>
      </div>
    </footer>
  );
}

/*
 * The site's menu on a phone, as site-v2 draws it (site-shell.tsx MenuSheet, the same sheet
 * template 2 uses): the logo and a close button along the top, the pages centred one per row
 * with a hairline between, and Sign in · Book a car at the foot. In the demo it covers the
 * handset's page, under the address bar (booking-demo.css).
 */
export function PhoneMenu({
  brand,
  open,
  page,
  onClose,
  onNav,
  onSignIn,
  onBook,
}: {
  brand: Brand;
  open: boolean;
  page: SitePage | null;
  onClose: () => void;
  onNav: (page: SitePage) => void;
  onSignIn: () => void;
  onBook: () => void;
}) {
  const tab = open ? 0 : -1;
  return (
    <div className={`dp-menu${open ? " is-open" : ""}`} role="dialog" aria-label="Menu" aria-hidden={!open}>
      <div className="dp-menu-top">
        <b className="bd-brand">
          <i aria-hidden>{brand.initial}</i>
          {brand.name}
        </b>
        <button type="button" className="dp-burger" onClick={onClose} aria-label="Close menu" tabIndex={tab}>
          <X aria-hidden />
        </button>
      </div>
      <nav className="dp-menu-links" aria-label="Pages">
        {SITE_NAV.map((item, i) => (
          <button
            key={item.id}
            type="button"
            tabIndex={tab}
            aria-current={page === item.id ? "page" : undefined}
            style={{ animationDelay: `${50 + i * 40}ms` }}
            onClick={() => {
              onClose();
              onNav(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="dp-menu-foot">
        <button
          type="button"
          className="dp-menu-out"
          tabIndex={tab}
          onClick={() => {
            onClose();
            onSignIn();
          }}
        >
          Your account
        </button>
        <button
          type="button"
          className="dp-menu-book"
          tabIndex={tab}
          onClick={() => {
            onClose();
            onBook();
          }}
        >
          Book a car
        </button>
      </div>
    </div>
  );
}

/*
 * The phone tab bar both portals carry below `md` (the operator's: apps/portal/src/components/
 * shared/layout/mobile-tab-bar.tsx; the renter's: apps/booking/src/northwind-site/portal-v2/
 * mobile-tab-bar.tsx): flat along the bottom edge, a hairline on top, up to four tabs then More,
 * the tab you are on marked by colour and weight alone. Drawn only inside the handset.
 */
export function PhoneTabBar<T extends string>({
  tabs,
  on,
  onTab,
}: {
  tabs: { id: T; label: string; icon: typeof Car }[];
  on: T | null;
  onTab: (id: T) => void;
}) {
  return (
    <nav className="cp-tabbar" aria-label="Portal">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" aria-current={on === tab.id ? "page" : undefined} className={on === tab.id ? "is-on" : undefined} onClick={() => onTab(tab.id)}>
          <tab.icon aria-hidden />
          {tab.label}
        </button>
      ))}
      <span className={`cp-tabbar-more${on === null ? " is-on" : ""}`} aria-hidden>
        <Ellipsis />
        More
      </span>
    </nav>
  );
}

const REVIEWS = [
  { who: "Ava M.", car: "Kia Telluride", stars: 5, text: "Booked on my phone at night, signed the agreement in two minutes, and the car was ready when I got there." },
  { who: "Liam F.", car: "Genesis GV80", stars: 5, text: "No counter, no queue. The price I saw online was the price I paid." },
  { who: "Mia C.", car: "Hyundai Sonata", stars: 4, text: "Clean car, easy pickup. I extended by a day from the portal without calling anyone." },
  { who: "Owen P.", car: "Chevrolet Camaro", stars: 5, text: "The licence check was quick and I got my deposit back the day I returned it." },
];

export function SitePageBody({ page, brand, cars, onBook }: { page: Exclude<SitePage, "home">; brand: Brand; cars: readonly DemoCar[]; onBook: () => void }) {
  if (page === "fleet") {
    return (
      <Page title="Fleet and pricing" lead="Every car, with its price for a day, a week and a month. What you see is what you pay.">
        <ul className="dp-grid is-3">
          {cars.map((car) => (
            <li key={car.id} className="dp-card dp-fleet">
              <span className="dp-fleet-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={car.photo} alt="" />
              </span>
              <b>{car.name}</b>
              <small>{car.meta}</small>
              <dl className="dp-rates">
                <div>
                  <dt>Day</dt>
                  <dd>{money(car.rate)}</dd>
                </div>
                <div>
                  <dt>Week</dt>
                  <dd>{money(car.rate * 6)}</dd>
                </div>
                <div>
                  <dt>Month</dt>
                  <dd>{money(car.rate * 22)}</dd>
                </div>
              </dl>
              <button type="button" className="bd-go" onClick={onBook}>
                Book this car
              </button>
            </li>
          ))}
        </ul>
      </Page>
    );
  }
  if (page === "promotions") {
    return (
      <Page title="Promotions" lead="Offers running right now. The saving is taken off at checkout.">
        <ul className="dp-grid is-3">
          {[
            ["Weekend away", "15% off", "Pick up Friday, return Monday. Any car.", "WEEKEND15"],
            ["A week or more", "1 day free", "Book 7 days and pay for 6.", "WEEK7"],
            ["First rental", "$20 off", "For new renters, on any booking over $100.", "HELLO20"],
          ].map(([title, saving, text, code]) => (
            <li key={code} className="dp-card dp-promo">
              <span className="dp-icon">
                <Tag aria-hidden />
              </span>
              <small>{title}</small>
              <b>{saving}</b>
              <p>{text}</p>
              <span className="dp-code">{code}</span>
              <button type="button" className="bd-go" onClick={onBook}>
                Use it
              </button>
            </li>
          ))}
        </ul>
      </Page>
    );
  }
  if (page === "reviews") {
    return (
      <Page title="Reviews" lead="4.8 out of 5, from renters who booked here.">
        <ul className="dp-grid is-2">
          {REVIEWS.map((r) => (
            <li key={r.who} className="dp-card dp-review">
              <span className="dp-stars" aria-label={`${r.stars} out of 5`}>
                {Array.from({ length: 5 }, (_, i) => (
                  <Star key={i} className={i < r.stars ? "is-on" : undefined} aria-hidden />
                ))}
              </span>
              <p>{r.text}</p>
              <small>
                <b>{r.who}</b> · rented the {r.car}
              </small>
            </li>
          ))}
        </ul>
      </Page>
    );
  }
  if (page === "about") {
    return (
      <Page title={`About ${brand.name}`} lead="A local rental company. You book online, we have the car clean, fuelled and waiting.">
        <ul className="dp-grid is-3">
          {[
            [BadgeCheck, "Licence checked online", "Verify before you arrive, so there's no paperwork at pickup."],
            [FileSignature, "Signed on your phone", "Read and sign your agreement in a couple of minutes."],
            [KeyRound, "Keys ready", "Collect in person or from a lockbox, at the time you chose."],
          ].map(([Icon, title, text]) => {
            const I = Icon as typeof Car;
            return (
              <li key={title as string} className="dp-card dp-point">
                <span className="dp-icon">
                  <I aria-hidden />
                </span>
                <b>{title as string}</b>
                <p>{text as string}</p>
              </li>
            );
          })}
        </ul>
        <dl className="dp-stats">
          <div>
            <dt>Cars</dt>
            <dd>9</dd>
          </div>
          <div>
            <dt>Rentals a year</dt>
            <dd>640</dd>
          </div>
          <div>
            <dt>Renters who come back</dt>
            <dd>58%</dd>
          </div>
        </dl>
      </Page>
    );
  }
  return (
    <Page title="Contact" lead="Ask us anything. We reply within the hour, every day.">
      <div className="dp-grid is-2">
        <ul className="dp-card dp-contact">
          <li>
            <MapPin aria-hidden />
            100 Market St, Springfield
          </li>
          <li>
            <Phone aria-hidden />
            (555) 000-1234
          </li>
          <li>
            <Mail aria-hidden />
            hello@{brand.slug}.example
          </li>
          <li>
            <CalendarDays aria-hidden />
            Open every day, 8:00 AM to 8:00 PM
          </li>
        </ul>
        <div className="dp-card dp-form">
          <span className="dp-field">Your name</span>
          <span className="dp-field">Your email</span>
          <span className="dp-field is-tall">How can we help?</span>
          <span className="bd-go dp-fake">Send message</span>
          <small>This is a preview: the form doesn&apos;t send.</small>
        </div>
      </div>
    </Page>
  );
}

function Page({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="bd-stage dp-page">
      <h3 className="bd-h">{title}</h3>
      <p className="bd-lead">{lead}</p>
      <div className="dp-body">{children}</div>
    </div>
  );
}

/* ── The customer's portal: Northwind's v2 portal, copied (apps/booking portal-v2) ───────── */

export type RenterBooking = {
  ref: string;
  car: DemoCar;
  total: number;
  days: number;
  /** "Nov 11" */
  from: string;
  to: string;
  /** "Nov 11, 2026" */
  fromFull: string;
  toFull: string;
  bookedOn: string;
};

/** Earlier rentals the demo renter already has, so their list is never empty. Sample data. */
const PAST_RENTALS = [
  { ref: "R-7c41d2", car: "Toyota Camry", kind: "Sedan", from: "Oct 18", to: "Oct 21", status: "Completed", total: 267, sent: "Oct 15, 2026", cover: "Oct 18 – Oct 21, 2026" },
  { ref: "R-52ab9e", car: "Jeep Wrangler", kind: "SUV", from: "Sep 26", to: "Sep 29", status: "Completed", total: 357, sent: "Sep 22, 2026", cover: "Sep 26 – Sep 29, 2026" },
  { ref: "R-1f08c3", car: "Tesla Model 3", kind: "Electric", from: "Aug 9", to: "Aug 12", status: "Completed", total: 396, sent: "Aug 5, 2026", cover: "Aug 9 – Aug 12, 2026" },
  { ref: "R-9e63a7", car: "Honda CR-V", kind: "SUV", from: "Jul 14", to: "Jul 15", status: "Completed", total: 98, sent: "Jul 12, 2026", cover: "Jul 14 – Jul 15, 2026" },
] as const;
const PAST_PAID = PAST_RENTALS.reduce((sum, rental) => sum + rental.total, 0);

export function RenterPortalV2({
  brand,
  renter,
  page,
  onPage,
  booking,
  signed,
  verified,
  approved,
  onSign,
  onVerify,
  onAdmin,
  onBook,
  onSite,
}: {
  brand: Brand;
  renter: { name: string; email: string };
  page: RenterPage;
  onPage: (page: RenterPage) => void;
  booking: RenterBooking | null;
  signed: boolean;
  verified: "no" | "checking" | "yes";
  approved: boolean;
  onSign: () => void;
  onVerify: () => void;
  /** The journey's next stop once the renter's two jobs are done. */
  onAdmin: () => void;
  onBook: () => void;
  onSite: () => void;
}) {
  const section = page === "rental" ? "rentals" : page;
  const label = RENTER_NAV.find((item) => item.id === section)?.label ?? "Rentals";
  const initials = renter.name.split(" ").map((w) => w[0]).join("");
  const status = approved ? "Confirmed" : "Upcoming";

  return (
    <div className="cp">
      <aside className="cp-side">
        <div className="cp-org">
          <i aria-hidden>{brand.initial}</i>
          <b>{brand.name}</b>
          <button type="button" className="cp-icon" onClick={onSite} aria-label="Open the booking site" title="Open the booking site">
            <ExternalLink aria-hidden />
          </button>
        </div>
        <nav className="cp-nav" aria-label="Customer portal">
          {RENTER_NAV.map((item) => (
            <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined} className={section === item.id ? "is-on" : undefined} onClick={() => onPage(item.id)}>
              <item.icon aria-hidden />
              {item.label}
            </button>
          ))}
        </nav>
        <button type="button" className="cp-book" onClick={onBook}>
          <Plus aria-hidden />
          Book a car
        </button>
        <div className="cp-user">
          <i aria-hidden>{initials}</i>
          <span>
            <b>{renter.name}</b>
            <small>{renter.email}</small>
          </span>
          <Settings aria-hidden />
        </div>
      </aside>

      <div className="cp-main">
        <header className="cp-top">
          {/* A phone: the search is a round button (portal-v2 shell.tsx TopBar). */}
          <span className="cp-search-round" aria-hidden>
            <Search />
          </span>
          <span className="cp-search" aria-hidden>
            <Search />
            {page !== "rental" && (
              <span className="cp-scope">
                in <b>{label}</b>
              </span>
            )}
            <span className="cp-search-text">{page === "rental" ? "Search your rentals…" : `Search ${label.toLowerCase()}…`}</span>
            <kbd>⌘K</kbd>
          </span>
          <span className="cp-tools" aria-hidden>
            <Phone className="cp-tel" />
            <span className="cp-help">
              <i>
                <Sparkles />
              </i>
              Help
            </span>
            <MessageCircle />
            <Bell />
          </span>
        </header>

        {page === "rentals" && (
          <div key="rentals" className="cp-page">
            <div className="cp-head">
              <div>
                <h3>Rentals</h3>
                <p>
                  <span className="cp-long">Manage your rentals, from upcoming to completed.</span>
                  <span className="cp-short">Manage your rentals.</span>
                </p>
              </div>
              <span className="cp-btn cp-long" aria-hidden>
                Calendar view
              </span>
              {/* A phone: the calendar as an icon beside Book a car (portal-v2 rentals/page.tsx). */}
              <span className="cp-phone-acts">
                <span className="cp-round" aria-hidden>
                  <CalendarDays />
                </span>
                <button type="button" className="cp-btn" onClick={onBook}>
                  <Plus aria-hidden />
                  Book a car
                </button>
              </span>
            </div>
            <div className="cp-card cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Rental #</th>
                    <th>Vehicle</th>
                    <th>Pickup</th>
                    <th>Return</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {booking && (
                    <tr className="is-link" onClick={() => onPage("rental")}>
                      <td>
                        <button type="button" className="cp-rowlink bd-hint" onClick={() => onPage("rental")}>
                          {booking.ref}
                        </button>
                      </td>
                      <td>
                        {booking.car.name}
                        <small>{booking.car.meta.split(" · ")[0]}</small>
                      </td>
                      <td>{booking.from}</td>
                      <td>{booking.to}</td>
                      <td className={approved ? "is-ok" : "is-info"}>{status}</td>
                    </tr>
                  )}
                  {PAST_RENTALS.map((rental) => (
                    <tr key={rental.ref}>
                      <td>{rental.ref}</td>
                      <td>
                        {rental.car}
                        <small>{rental.kind}</small>
                      </td>
                      <td>{rental.from}</td>
                      <td>{rental.to}</td>
                      <td className="is-muted">{rental.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cp-count">All {PAST_RENTALS.length + (booking ? 1 : 0)} rentals shown</p>
          </div>
        )}

        {page === "rental" && booking && (
          <div key="rental" className="cp-page">
            <div className="cp-head">
              <div>
                <h3 className="cp-rental-title">
                  <button type="button" className="cp-icon" onClick={() => onPage("rentals")} aria-label="Back to Rentals">
                    <ArrowLeft aria-hidden />
                  </button>
                  {booking.car.name}
                  <small>{booking.ref}</small>
                  <span className={`cp-chip${approved ? " is-ok" : ""}`}>{status}</span>
                  <span className="cp-chip is-ok">Paid</span>
                </h3>
                <p>Booked {booking.bookedOn}</p>
              </div>
            </div>
            <div className="cp-cols">
              <div className="cp-col">
                <div className="cp-card cp-car">
                  <span className="cp-car-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={booking.car.photo} alt="" />
                  </span>
                  <div>
                    <b>{booking.car.name}</b>
                    <span className="cp-tags">
                      {booking.car.meta.split(" · ").map((tag) => (
                        <i key={tag}>{tag}</i>
                      ))}
                    </span>
                    <small>Unlimited mileage included</small>
                  </div>
                </div>
                <div className="cp-card">
                  <h4>When &amp; where</h4>
                  <dl className="cp-rows">
                    <div>
                      <dt>Rental period</dt>
                      <dd>
                        {booking.from} – {booking.toFull}
                        <small>
                          {booking.days} {booking.days === 1 ? "day" : "days"} · Daily rate
                        </small>
                      </dd>
                    </div>
                    <div>
                      <dt>Pick up</dt>
                      <dd>{booking.fromFull} at 10:00 AM</dd>
                    </div>
                    <div>
                      <dt>Return</dt>
                      <dd>{booking.toFull} at 10:00 AM</dd>
                    </div>
                    <div>
                      <dt>Pick up from</dt>
                      <dd>100 Market St, Springfield</dd>
                    </div>
                  </dl>
                </div>
              </div>
              <div className="cp-col">
                {/* What only the renter can do before pickup. */}
                <div className="cp-card">
                  <h4>Before you pick up</h4>
                  <ul className="cp-todo">
                    <li className={signed ? "is-done" : undefined}>
                      <span className="cp-dot">{signed ? <Check strokeWidth={3} aria-hidden /> : <FileSignature aria-hidden />}</span>
                      <span>
                        <b>{signed ? "Agreement signed" : "Sign your agreement"}</b>
                        <small>{signed ? "Your copy is in Agreements" : "Read it and sign it here"}</small>
                      </span>
                      {!signed && (
                        <button type="button" className="cp-btn is-small bd-hint" onClick={onSign}>
                          Sign
                        </button>
                      )}
                    </li>
                    <li className={verified === "yes" ? "is-done" : undefined}>
                      <span className="cp-dot">
                        {verified === "yes" ? <Check strokeWidth={3} aria-hidden /> : verified === "checking" ? <Loader2 className="bd-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
                      </span>
                      <span>
                        <b>{verified === "yes" ? "Licence verified" : verified === "checking" ? "Checking…" : "Verify your licence"}</b>
                        <small>{verified === "yes" ? "94% face match" : "Your licence and a selfie, about a minute"}</small>
                      </span>
                      {verified === "no" && (
                        <button type="button" className={`cp-btn is-small${signed ? " bd-hint" : ""}`} onClick={onVerify}>
                          Verify
                        </button>
                      )}
                    </li>
                  </ul>
                  {signed && verified === "yes" && !approved && (
                    <button type="button" className="bd-next bd-hint" onClick={onAdmin}>
                      Approve it in your admin portal
                      <ArrowRight aria-hidden />
                    </button>
                  )}
                </div>
                <div className="cp-card">
                  <h4>Price breakdown</h4>
                  <dl className="cp-rows is-money">
                    <div>
                      <dt>Rental total</dt>
                      <dd>{money(booking.total)}.00</dd>
                    </div>
                    <div className="is-total">
                      <dt>Total</dt>
                      <dd>{money(booking.total)}.00</dd>
                    </div>
                  </dl>
                  <div className="cp-paid">
                    <span />
                    <small>
                      <b>{money(booking.total)}.00</b> paid
                    </small>
                    <small>of {money(booking.total)}.00</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {page === "insurances" && (
          <div key="insurances" className="cp-page">
            <div className="cp-head">
              <div>
                <h3>Insurances</h3>
                <p>Every insurance you have uploaded, and the cover bought with your rentals, in one place.</p>
              </div>
              <span className="cp-btn" aria-hidden>
                <Plus />
                Upload insurance
              </span>
            </div>
            <div className="cp-card cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Insurance</th>
                    <th>Provider</th>
                    <th>Policy number</th>
                    <th>Coverage dates</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Coastal Mutual policy</td>
                    <td>Coastal Mutual</td>
                    <td>CM-4471-0923</td>
                    <td>Jun 1, 2026 – Jun 1, 2027</td>
                    <td className="is-ok">Verified</td>
                  </tr>
                  {PAST_RENTALS.slice(0, 3).map((rental, i) => (
                    <tr key={rental.ref}>
                      <td>
                        Rental cover
                        <small>{rental.ref}</small>
                      </td>
                      <td>Bonzah</td>
                      <td>BZ-{["88214", "77105", "69342"][i]}</td>
                      <td>{rental.cover}</td>
                      <td className="is-muted">Expired</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cp-count">All 4 insurances shown</p>
          </div>
        )}

        {page === "agreements" && (
          <div key="agreements" className="cp-page">
            <div className="cp-head">
              <div>
                <h3>Agreements</h3>
                <p>Your agreements for signature, and every one&apos;s signed copy.</p>
              </div>
            </div>
            <div className="cp-card cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Linked to</th>
                    <th>Reference</th>
                    <th>Sent</th>
                    <th>Status</th>
                    <th aria-label="Sign" />
                  </tr>
                </thead>
                <tbody>
                  {booking && (
                    <tr>
                      <td>{brand.name}</td>
                      <td>Rental</td>
                      <td>{booking.ref}</td>
                      <td>{booking.bookedOn}</td>
                      <td className={signed ? "is-ok" : "is-warn"}>{signed ? "Signed" : "Pending"}</td>
                      <td>
                        {!signed && (
                          <button type="button" className="cp-btn is-small" onClick={onSign}>
                            Sign
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                  {PAST_RENTALS.map((rental) => (
                    <tr key={rental.ref}>
                      <td>{brand.name}</td>
                      <td>Rental</td>
                      <td>{rental.ref}</td>
                      <td>{rental.sent}</td>
                      <td className="is-ok">Signed</td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cp-count">All {PAST_RENTALS.length + (booking ? 1 : 0)} agreements shown</p>
          </div>
        )}

        {page === "finances" && (
          <div key="finances" className="cp-page">
            <div className="cp-head">
              <div>
                <h3>Finances</h3>
                <p>What you owe, what you have paid, and every invoice for your bookings.</p>
              </div>
              <span className="cp-btn" aria-hidden>
                Export CSV
              </span>
            </div>
            <div className="cp-fin">
              <div>
                <small>Still to pay today</small>
                <b>$0.00</b>
                <span className="cp-legend">
                  <i /> Still to pay
                  <i className="is-paid" /> Paid to date <b>{money(PAST_PAID + (booking?.total ?? 0))}.00</b>
                </span>
                <svg className="cp-chart" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden>
                  {/* Paid to date, stepping up with each rental (sample history). */}
                  <path d={booking ? "M0 70H60V56H130V34H200V22H270V8H300" : "M0 70H60V56H130V34H200V22H300"} />
                </svg>
              </div>
              <span className="cp-cardart" aria-hidden>
                <i />
                <b>•••• •••• •••• 4242</b>
                <em>VISA</em>
              </span>
            </div>
            <div className="cp-card cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Entity ref</th>
                    <th>Company</th>
                    <th>Due date</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {booking && (
                    <tr>
                      <td>INV-{booking.ref.replace(/^R-/, "")}</td>
                      <td>{booking.ref}</td>
                      <td>{brand.name}</td>
                      <td>{booking.bookedOn}</td>
                      <td>{money(booking.total)}.00</td>
                      <td>{money(booking.total)}.00</td>
                      <td>$0.00</td>
                    </tr>
                  )}
                  {PAST_RENTALS.map((rental) => (
                    <tr key={rental.ref}>
                      <td>INV-{rental.ref.replace(/^R-/, "")}</td>
                      <td>{rental.ref}</td>
                      <td>{brand.name}</td>
                      <td>{rental.sent}</td>
                      <td>{money(rental.total)}.00</td>
                      <td>{money(rental.total)}.00</td>
                      <td>$0.00</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cp-count">All {PAST_RENTALS.length + (booking ? 1 : 0)} invoices shown</p>
          </div>
        )}
        <PhoneTabBar tabs={RENTER_NAV} on={section} onTab={onPage} />
      </div>
    </div>
  );
}
