"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSitePreview } from "@/lib/site-preview";
import { SiteHome } from "./site-home";
import { ArrowLeft, ArrowRight, CalendarCheck, Car, Check, CreditCard, FileSignature, FileText, Globe, KeyRound, LayoutDashboard, Loader2, Lock, MessageCircle, RotateCcw, ShieldCheck, Sparkles, UserRound, Users } from "lucide-react";
import { BrowserChrome } from "./portal-glass";
import { AdminCustomers, AdminDashboard, AdminRentalsTop, AdminShell, AdminVehicles } from "./demo-admin";
import { ADMIN_NAV, RENTER_NAV, RenterPortalV2, SITE_NAV, SiteFooter, SiteHeader, SitePageBody, type AdminPage, type RenterPage, type SitePage } from "./demo-pages";
import "./booking-demo.css";

/*
 * The working part of "Your booking site" (your-site.tsx), which sets the name, template and
 * colour this reads from the shared store. It has no heading or section of its own.
 *
 * A working example of the booking site Drive247 builds
 * for an operator, in a browser window. The visitor books a car the way a renter would, in
 * the real site's three steps (Trip details, Your car, Checkout: apps/booking/.../site-v2/book),
 * and the window then turns to the operator's portal, where the booking sits at the top of
 * Rentals (the real screen: public/v2/dash-main.png).
 *
 * It is one linked journey across the four screens (Ghulam, 2026-11-10: "a proper guided
 * experience"): see the website, book a car, then be the renter (sign the agreement, verify
 * the licence in the customer portal), then be the operator (open the booking in Rentals and
 * approve it). What is done on one screen shows on the others. `onJourney` reports where the
 * visitor is, so the section around this can show the steps and what to do next.
 *
 * Nothing here is sent anywhere and no card is charged. The dates are worked out in the
 * visitor's browser from today, so the example never shows a month that has passed.
 */

type Stage = "dates" | "car" | "checkout" | "booked";
export type DemoView = "home" | "site" | "renter" | "portal";
type View = DemoView;

/* The four screens of the demo. `about` is the line on its card in your-site.tsx. */
export const DEMO_VIEWS: { id: View; label: string; about: string; icon: typeof Globe }[] = [
  { id: "home", label: "Your booking site", about: "Your home page", icon: Globe },
  { id: "site", label: "Your booking widget", about: "Book a car as a renter", icon: CalendarCheck },
  { id: "renter", label: "Your customer's portal", about: "What your renter sees", icon: UserRound },
  { id: "portal", label: "Your admin portal", about: "Where the booking lands", icon: LayoutDashboard },
];
const VIEWS = DEMO_VIEWS;

const CARS = [
  { id: "sonata", name: "Hyundai Sonata", meta: "Sedan · 5 seats · Automatic", rate: 59, photo: "/landing-v4/cars/sonata.webp" },
  { id: "gv80", name: "Genesis GV80", meta: "SUV · 5 seats · Automatic", rate: 129, photo: "/landing-v4/cars/gv80.webp" },
  { id: "camaro", name: "Chevrolet Camaro", meta: "Coupe · 4 seats · Automatic", rate: 99, photo: "/landing-v4/cars/camaro.webp" },
] as const;

const RENTER = { name: "Jordan Lee", email: "jordan@example.com", phone: "(555) 014-2290" };

/* The portal's Rentals list before the new booking arrives. Days are counted from today. */
const EARLIER = [
  { ref: "R-a4d848", name: "Ava Morgan", car: "Kia Telluride", from: -12, to: -5, status: "Completed" },
  { ref: "R-abed7c", name: "Liam Foster", car: "Genesis GV80", from: 3, to: 9, status: "Pending" },
  { ref: "R-24090e", name: "Mia Chen", car: "Hyundai Sonata", from: 5, to: 8, status: "Pending" },
  { ref: "R-d93dea", name: "Owen Price", car: "Chevrolet Camaro", from: -20, to: -16, status: "Completed" },
  { ref: "R-4f3bbe", name: "Priya Nair", car: "Jeep Wrangler", from: -2, to: 4, status: "Active" },
  { ref: "R-bf3260", name: "Daniel Okafor", car: "Ford Explorer", from: -1, to: 6, status: "Active" },
  { ref: "R-9b4eed", name: "Ava Morgan", car: "Tesla Model 3", from: -34, to: -30, status: "Completed" },
] as const;

const STEPS = ["Choose dates", "Pick a car", "Check out", "See it in your admin portal"];
const SITE_STEPS = ["Trip details", "Your car", "Checkout"];

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKS = 5;

const addDays = (date: Date, n: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const longDate = (d: Date) => `${DAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
const shortDate = (d: Date) => `${MONTH[d.getMonth()]} ${d.getDate()}`;
const fullDate = (d: Date) => `${MONTH[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

function stepOf(stage: Stage, view: View) {
  if (view === "portal") return 3;
  return stage === "dates" ? 0 : stage === "car" ? 1 : 2;
}

/** Where the visitor is in the journey: the step they are on (4 = all done), and what to do next. */
export type DemoJourney = { step: number; tip: string; started: boolean; reset: () => void };
/* The steps are the four screens themselves, under the names on their tabs (Ghulam, 2026-11-10). */
export const JOURNEY_STEPS: { view: DemoView; label: string }[] = DEMO_VIEWS.map((v) => ({ view: v.id, label: v.label }));
type Verify = "no" | "checking" | "yes";

/*
 * `view` and `onView` let the section around it own which screen is showing, so its cards
 * and the tabs here stay one choice. Left out, the demo keeps the choice itself.
 */
export function BookingDemoStage({
  view: givenView,
  onView,
  onJourney,
}: { view?: DemoView; onView?: (view: DemoView) => void; onJourney?: (journey: DemoJourney) => void } = {}) {
  // Today, in the visitor's own browser. Until it is known the calendar draws without numbers.
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => {
    const now = new Date();
    setToday(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  }, []);

  const site = useSitePreview();
  const [ownView, setOwnView] = useState<View>("home");
  const view = givenView ?? ownView;
  const setView = onView ?? setOwnView;
  const [stage, setStage] = useState<Stage>("dates");
  const [pickup, setPickup] = useState<number | null>(null);
  const [back, setBack] = useState<number | null>(null);
  const [carId, setCarId] = useState<string | null>(null);
  const [bookingRef, setBookingRef] = useState("");
  // After the booking: what the renter has done, and what the operator has done about it.
  const [signed, setSigned] = useState(false);
  const [verified, setVerified] = useState<Verify>("no");
  const [opened, setOpened] = useState(false);
  const [approved, setApproved] = useState(false);
  const [toured, setToured] = useState(false);
  // Where the visitor is inside each of the three places: the preview is theirs to click around.
  const [sitePage, setSitePage] = useState<SitePage>("home");
  const [renterPage, setRenterPage] = useState<RenterPage>("rentals");
  const [adminPage, setAdminPage] = useState<AdminPage>("rentals");
  const brand = { name: site.name, initial: site.initial, slug: site.slug };
  const goSite = (page: SitePage) => {
    setSitePage(page);
    setView("home");
  };
  // No sign-in in the preview: "Sign in" walks straight into the customer's portal.
  const goRenter = () => {
    // With a booking made, straight to it: that is where the renter's two jobs are.
    setRenterPage(booked ? "rental" : "rentals");
    setView("renter");
  };
  const goAdmin = () => {
    setAdminPage(booked ? "rentals" : "dashboard");
    setView("portal");
  };
  const verifyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(verifyTimer.current), []);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Leaving the booking site by any route (a tab here, a card outside) cancels the move to the portal.
  useEffect(() => {
    if (view !== "site") window.clearTimeout(timer.current);
    if (view !== "home") setToured(true);
  }, [view]);

  // Five weeks from this week's Monday. Bookings can start tomorrow.
  const start = useMemo(() => (today ? addDays(today, -((today.getDay() + 6) % 7)) : null), [today]);
  const firstOpen = today ? ((today.getDay() + 6) % 7) + 1 : 1;
  const dateAt = (i: number) => (start ? addDays(start, i) : null);

  const days = pickup !== null && back !== null ? back - pickup : 0;
  const car = CARS.find((c) => c.id === carId) ?? null;
  const total = car ? car.rate * days : 0;
  const cheapest = Math.min(...CARS.map((c) => c.rate)) * days;

  const tapDay = (i: number) => {
    if (pickup === null || back !== null) {
      setPickup(i);
      setBack(null);
    } else if (i > pickup) {
      setBack(i);
    } else {
      setPickup(i);
    }
  };
  const pickLength = (n: number) => {
    const from = pickup !== null && pickup + n < WEEKS * 7 ? pickup : firstOpen;
    setPickup(from);
    setBack(from + n);
  };

  const pay = () => {
    setBookingRef(`R-${Math.random().toString(16).slice(2, 8)}`);
    setStage("booked");
    timer.current = window.setTimeout(() => {
      setAdminPage("rentals");
      setView("portal");
    }, 1800);
  };
  const reset = () => {
    window.clearTimeout(timer.current);
    setStage("dates");
    setView("site");
    setPickup(null);
    setBack(null);
    setCarId(null);
    window.clearTimeout(verifyTimer.current);
    setSigned(false);
    setVerified("no");
    setOpened(false);
    setApproved(false);
  };
  const verify = () => {
    setVerified("checking");
    verifyTimer.current = window.setTimeout(() => setVerified("yes"), 1500);
  };

  // What to do next, said once above the window; the thing to press also gets a soft ring.
  const booked = stage === "booked" && car !== null;
  const tip =
    view === "home" && sitePage !== "home"
      ? `Your booking site's ${SITE_NAV.find((p) => p.id === sitePage)?.label} page. Every page is yours to edit. Book a car opens your booking widget.`
      : view === "renter" && booked && renterPage === "rentals"
        ? "Your customer's portal. Open the rental to see what's left to do before pickup."
        : view === "renter" && renterPage !== "rental" && renterPage !== "rentals"
          ? `Your customer's portal, ${RENTER_NAV.find((p) => p.id === renterPage)?.label}. Look around: Rentals has what to do before pickup.`
        : view === "portal" && adminPage !== "rentals"
          ? `Your admin portal, ${ADMIN_NAV.find((p) => p.id === adminPage)?.label}. New bookings from your site land in Rentals.`
          : view === "home"
      ? "Your booking site. Click any page, press Book a car for the widget, or Dashboard for your customer's portal."
      : view === "renter"
      ? booked
        ? approved
          ? `${RENTER.name} sees it confirmed: paid, signed, verified and approved. That's the whole journey.`
          : !signed
            ? `Your customer's portal. You're ${RENTER.name} now. Press Sign to sign the rental agreement.`
            : verified !== "yes"
              ? "Signed. Now press Verify to check the driving licence."
              : "All done on the customer's side. Open your admin portal to approve the booking."
        : `Your customer's portal. Book a car in your booking widget and it shows up here.`
      : view === "portal" && !booked
        ? "Your admin portal. Book a car in your booking widget and watch it arrive here."
        : view === "portal"
          ? approved
            ? `Approved. ${RENTER.name} gets a confirmation and the car is held for those dates. That's the whole journey.`
            : !opened
              ? "Your admin portal. There it is, at the top of your Rentals, the moment it was booked. Open it."
              : signed && verified === "yes"
                ? "Paid, signed and verified. Press Approve booking."
                : "It's paid. The agreement and the licence wait on the renter. Open your customer's portal."
        : stage === "dates"
      ? pickup === null
        ? "Your booking widget. Tap the day you'd pick the car up."
        : back === null
          ? "Now tap the day you'd bring it back."
          : "Those are your dates. Press See cars."
      : stage === "car"
        ? car
          ? "Good choice. Press Continue to checkout."
          : "Choose any car. Each one is priced for your dates."
        : stage === "checkout"
          ? "Your details are filled in. Press Pay to book."
          : "Booked. Now watch where it lands.";

  const step = stepOf(stage, view);

  /*
   * The window's own back and forward. Every place the visitor lands is a stop: the screen,
   * and the page inside it. Going back or forward walks the stops without adding new ones.
   */
  const here = `${view}|${sitePage}|${renterPage}|${adminPage}|${view === "portal" && opened ? "open" : ""}`;
  const trail = useRef<{ stops: string[]; at: number; moving: boolean }>({ stops: [], at: -1, moving: false });
  const [, redraw] = useState(0);
  useEffect(() => {
    const t = trail.current;
    if (t.moving) {
      t.moving = false;
    } else if (t.stops[t.at] !== here) {
      t.stops = [...t.stops.slice(0, t.at + 1), here];
      t.at = t.stops.length - 1;
    }
    redraw((n) => n + 1);
  }, [here]);
  const travel = (by: number) => {
    const t = trail.current;
    const stop = t.stops[t.at + by];
    if (!stop) return;
    t.at += by;
    t.moving = true;
    window.clearTimeout(timer.current);
    const [toView, toSite, toRenter, toAdmin, toOpen] = stop.split("|");
    setSitePage(toSite as SitePage);
    setRenterPage(toRenter as RenterPage);
    setAdminPage(toAdmin as AdminPage);
    setOpened(toOpen === "open");
    setView(toView as View);
  };
  const canBack = trail.current.at > 0;
  const canForward = trail.current.at < trail.current.stops.length - 1;

  // The journey's four steps, each done once and for all, whichever screen is showing.
  const done = [toured || booked, booked, booked && signed && verified === "yes", booked && approved];
  const at = done.indexOf(false);
  const journeyStep = at === -1 ? JOURNEY_STEPS.length : at;
  const started = pickup !== null || stage !== "dates";
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    onJourney?.({ step: journeyStep, tip, started, reset: () => resetRef.current() });
  }, [onJourney, journeyStep, tip, started]);
  const portal = view === "portal";
  const hint = (on: boolean) => (on ? " bd-hint" : "");

  return (
    <div id="booking-demo" className="bd-demo" style={{ "--bd-a": site.colour.hex } as CSSProperties}>
        <div className="bd-views" role="tablist" aria-label="Your sites">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? "is-on" : undefined}
              onClick={() => {
                window.clearTimeout(timer.current);
                setView(v.id);
              }}
            >
              <v.icon aria-hidden />
              {v.label}
            </button>
          ))}
        </div>

        <div className="bd-guide">
          {(view === "site" || view === "portal") && (
          <ol className="bd-rail" aria-label="The example, step by step">
            {STEPS.map((label, i) => (
              <li key={label} className={i < step ? "is-done" : i === step ? "is-now" : undefined}>
                {i > 0 && <span className="bd-rail-link" aria-hidden />}
                <span className="bd-rail-pill" aria-current={i === step ? "step" : undefined}>
                  <span className="bd-rail-no">{i < step ? <Check strokeWidth={3} aria-hidden /> : i + 1}</span>
                  <span className="bd-rail-label">{label}</span>
                </span>
              </li>
            ))}
          </ol>
          )}
          <div className="bd-tipline">
            <p className="bd-tip" aria-live="polite">
              {tip}
            </p>
            {(pickup !== null || stage !== "dates") && (
              <button type="button" className="bd-reset" onClick={reset}>
                <RotateCcw aria-hidden />
                Start over
              </button>
            )}
          </div>
        </div>

        <div className={`bd-window${view === "home" ? " is-home" : ""}`}>
          <BrowserChrome
            nav={{ back: canBack ? () => travel(-1) : undefined, forward: canForward ? () => travel(1) : undefined }}
            tab={
              portal
                ? `${ADMIN_NAV.find((p) => p.id === adminPage)?.label} · ${site.name}`
                : view === "renter"
                  ? `${RENTER_NAV.find((p) => p.id === renterPage)?.label ?? "Rentals"} · ${site.name}`
                  : view === "home"
                    ? sitePage === "home"
                      ? site.name
                      : `${SITE_NAV.find((p) => p.id === sitePage)?.label} · ${site.name}`
                    : `Book a car · ${site.name}`
            }
            url={
              view === "home"
                ? `${site.slug}.drive-247.com${sitePage === "home" ? "" : `/${sitePage}`}`
                : portal
                  ? `${site.slug}.portal.drive-247.com/${adminPage}`
                  : view === "renter"
                    ? `${site.slug}.drive-247.com/portal/${renterPage === "rental" ? `rentals/${bookingRef}` : renterPage}`
                    : `${site.slug}.drive-247.com/booking`
            }
          >
            {view === "home" && sitePage === "home" ? (
              <div className="dp-home">
                <SiteHome
                  template={site.template}
                  accent={site.colour.hex}
                  name={site.name}
                  initial={site.initial}
                  onBook={() => setView("site")}
                  onNav={goSite}
                  onSignIn={goRenter}
                />
                <SiteFooter brand={brand} onNav={goSite} onSignIn={goRenter} onAdmin={goAdmin} />
              </div>
            ) : view === "home" ? (
              <div className={`bd-site${site.template === "glass" ? " is-glass" : ""}`}>
                <SiteHeader brand={brand} page={sitePage} onNav={goSite} onSignIn={goRenter} onBook={() => setView("site")} />
                <SitePageBody key={sitePage} page={sitePage as Exclude<SitePage, "home">} brand={brand} cars={CARS} onBook={() => setView("site")} />
                <SiteFooter brand={brand} onNav={goSite} onSignIn={goRenter} onAdmin={goAdmin} />
              </div>
            ) : view === "renter" ? (
              <RenterPortalV2
                brand={brand}
                renter={RENTER}
                page={renterPage === "rental" && !(booked && car) ? "rentals" : renterPage}
                onPage={setRenterPage}
                booking={
                  booked && car && pickup !== null && back !== null && dateAt(pickup) && dateAt(back)
                    ? {
                        ref: bookingRef,
                        car,
                        total,
                        days,
                        from: shortDate(dateAt(pickup)!),
                        to: shortDate(dateAt(back)!),
                        fromFull: fullDate(dateAt(pickup)!),
                        toFull: fullDate(dateAt(back)!),
                        bookedOn: today ? fullDate(today) : "",
                      }
                    : null
                }
                signed={signed}
                verified={verified}
                approved={approved}
                onSign={() => setSigned(true)}
                onVerify={verify}
                onAdmin={goAdmin}
                onBook={() => setView("site")}
                onSite={() => goSite("home")}
              />
            ) : portal ? (
              <Portal
                site={site}
                booked={booked}
                today={today}
                fresh={{
                  ref: bookingRef,
                  name: RENTER.name,
                  car: car?.name ?? "",
                  from: pickup !== null ? dateAt(pickup) : null,
                  to: back !== null ? dateAt(back) : null,
                  days,
                  total,
                }}
                signed={signed}
                verified={verified === "yes"}
                approved={approved}
                opened={opened}
                onOpen={() => setOpened(true)}
                onClose={() => setOpened(false)}
                onApprove={() => setApproved(true)}
                onRenter={goRenter}
                page={adminPage}
                onPage={setAdminPage}
                cars={CARS}
              />
            ) : (
              <div className={`bd-site${site.template === "glass" ? " is-glass" : ""}`}>
                <SiteHeader brand={brand} page={null} onNav={goSite} onSignIn={goRenter} onBook={() => setView("site")} />

                <ol className="bd-site-steps" aria-label="Booking steps">
                  {SITE_STEPS.map((label, i) => {
                    const at = Math.min(step, 2);
                    return (
                      <li key={label} className={i < at ? "is-done" : i === at ? "is-now" : undefined}>
                        {i > 0 && <span aria-hidden />}
                        <b>{i < at ? <Check strokeWidth={3} aria-hidden /> : i + 1}</b>
                        {label}
                      </li>
                    );
                  })}
                </ol>

                {stage === "dates" && (
                  <div key="dates" className="bd-stage">
                    <h3 className="bd-h">When do you need it?</h3>
                    <p className="bd-lead">Pick your pickup and return days. Or start from a length:</p>
                    <div className="bd-lengths">
                      <button type="button" onClick={() => pickLength(3)}>
                        3 days
                      </button>
                      <button type="button" onClick={() => pickLength(7)}>
                        1 week
                      </button>
                    </div>
                    <div className="bd-body">
                      <Calendar
                        start={start}
                        firstOpen={firstOpen}
                        pickup={pickup}
                        back={back}
                        onTap={tapDay}
                        hintAt={pickup === null ? firstOpen : back === null ? pickup + 3 : null}
                      />
                      <Trip
                        from={pickup !== null ? dateAt(pickup) : null}
                        to={back !== null ? dateAt(back) : null}
                        days={days}
                        car={null}
                        note={days > 0 ? `From ${money(cheapest)} for these dates` : "Next, you'll choose your car."}
                        action={
                          <button
                            type="button"
                            className={`bd-go${hint(days > 0)}`}
                            disabled={days === 0}
                            onClick={() => setStage("car")}
                          >
                            See cars
                          </button>
                        }
                      />
                    </div>
                  </div>
                )}

                {stage === "car" && (
                  <div key="car" className="bd-stage">
                    <h3 className="bd-h">Choose your car</h3>
                    <p className="bd-lead">
                      {CARS.length} cars are free for your dates, priced for {days} {days === 1 ? "day" : "days"}.
                    </p>
                    <div className="bd-body">
                      <ul className="bd-cars">
                        {CARS.map((c, i) => {
                          const picked = c.id === carId;
                          return (
                            <li key={c.id}>
                              <button
                                type="button"
                                className={`bd-car${picked ? " is-picked" : ""}`}
                                aria-pressed={picked}
                                onClick={() => setCarId(c.id)}
                              >
                                <span className="bd-car-photo">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={c.photo} alt="" />
                                </span>
                                <span className="bd-car-text">
                                  <b>{c.name}</b>
                                  <small>{c.meta}</small>
                                  <span className="bd-car-price">
                                    <span>
                                      <strong>{money(c.rate * days)}</strong>
                                      <small>
                                        total · {money(c.rate)}/day
                                      </small>
                                    </span>
                                    <span className={`bd-car-pick${hint(!carId && i === 0)}`}>{picked ? "Selected" : "Select"}</span>
                                  </span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <Trip
                        from={pickup !== null ? dateAt(pickup) : null}
                        to={back !== null ? dateAt(back) : null}
                        days={days}
                        car={car}
                        total={car ? total : undefined}
                        note="Choose a car to see your total."
                        action={
                          <button type="button" className={`bd-go${hint(!!car)}`} disabled={!car} onClick={() => setStage("checkout")}>
                            Continue to checkout
                          </button>
                        }
                      />
                    </div>
                  </div>
                )}

                {(stage === "checkout" || stage === "booked") && car && (
                  <div key="checkout" className="bd-stage">
                    {stage === "booked" ? (
                      <div className="bd-booked" role="status">
                        <span className="bd-booked-tick">
                          <Check strokeWidth={3} aria-hidden />
                        </span>
                        <h3 className="bd-h">You&apos;re booked</h3>
                        <p className="bd-lead">
                          {car.name}, {pickup !== null && dateAt(pickup) ? longDate(dateAt(pickup)!) : ""} to{" "}
                          {back !== null && dateAt(back) ? longDate(dateAt(back)!) : ""}. Booking {bookingRef}.
                        </p>
                        <p className="bd-lead">A confirmation is on its way to {RENTER.email}.</p>
                        <button type="button" className="bd-link" onClick={() => { window.clearTimeout(timer.current); goRenter(); }}>
                          See it in your customer&apos;s portal
                        </button>
                      </div>
                    ) : (
                      <>
                        <h3 className="bd-h">Checkout</h3>
                        <p className="bd-lead">Your details and payment. For this example they&apos;re filled in.</p>
                        <div className="bd-body">
                          <div className="bd-form">
                            <p className="bd-form-title">Your details</p>
                            <div className="bd-fields">
                              <Field label="Full name" value={RENTER.name} />
                              <Field label="Email" value={RENTER.email} />
                              <Field label="Phone" value={RENTER.phone} />
                              <Field label="Pickup" value="100 Market St, Springfield" />
                            </div>
                            <p className="bd-form-title">Payment</p>
                            <div className="bd-card-field">
                              <CreditCard aria-hidden />
                              <span>Visa ending 4242</span>
                              <small>12 / 29</small>
                            </div>
                            <p className="bd-safe">
                              <Lock aria-hidden />
                              An example only: no card is charged.
                            </p>
                          </div>
                          <Trip
                            from={pickup !== null ? dateAt(pickup) : null}
                            to={back !== null ? dateAt(back) : null}
                            days={days}
                            car={car}
                            total={total}
                            note=""
                            action={
                              <button type="button" className="bd-go bd-hint" onClick={pay}>
                                Pay {money(total)}
                              </button>
                            }
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </BrowserChrome>
        </div>
    </div>
  );
}

function Calendar({
  start,
  firstOpen,
  pickup,
  back,
  onTap,
  hintAt,
}: {
  start: Date | null;
  firstOpen: number;
  pickup: number | null;
  back: number | null;
  onTap: (i: number) => void;
  hintAt: number | null;
}) {
  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => i);
  const first = start ? addDays(start, firstOpen) : null;
  const last = start ? addDays(start, WEEKS * 7 - 1) : null;
  const title =
    first && last
      ? first.getMonth() === last.getMonth()
        ? MONTH_LONG[first.getMonth()]
        : `${MONTH_LONG[first.getMonth()]} – ${MONTH_LONG[last.getMonth()]}`
      : " ";
  return (
    <div className="bd-cal">
      <div className="bd-cal-head">
        <span>{title}</span>
        <small>{first ? first.getFullYear() : ""}</small>
      </div>
      <div className="bd-cal-days" aria-hidden>
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="bd-cal-grid">
        {cells.map((i) => {
          const date = start ? addDays(start, i) : null;
          const past = i < firstOpen;
          const end = i === pickup || i === back;
          const inside = pickup !== null && back !== null && i > pickup && i < back;
          const cls = [past && "is-past", end && "is-end", inside && "is-in", i === hintAt && "bd-hint"].filter(Boolean).join(" ");
          return (
            <button
              key={i}
              type="button"
              className={cls || undefined}
              disabled={past || !date}
              onClick={() => onTap(i)}
              aria-label={date ? longDate(date) : undefined}
              aria-pressed={end}
            >
              <span>{date ? (date.getDate() === 1 ? `1 ${MONTH[date.getMonth()]}` : date.getDate()) : ""}</span>
              {i === pickup && <small>Pickup</small>}
              {i === back && <small>Return</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Trip({
  from,
  to,
  days,
  car,
  total,
  note,
  action,
}: {
  from: Date | null;
  to: Date | null;
  days: number;
  car: (typeof CARS)[number] | null;
  total?: number;
  note: string;
  action: React.ReactNode;
}) {
  return (
    <aside className="bd-trip" aria-label="Your trip">
      <p className="bd-trip-title">Your trip</p>
      <ol className="bd-trip-when">
        <li>
          <small>Pickup</small>
          <span>{from ? `${longDate(from)} · 10:00 AM` : "Add a date"}</span>
        </li>
        {days > 0 && <li className="bd-trip-days">{days} {days === 1 ? "day" : "days"}</li>}
        <li>
          <small>Return</small>
          <span>{to ? `${longDate(to)} · 10:00 AM` : "Add a date"}</span>
        </li>
      </ol>
      <div className="bd-trip-car">
        {car ? (
          <>
            <span className="bd-trip-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={car.photo} alt="" />
            </span>
            <span>
              <b>{car.name}</b>
              <small>{money(car.rate)} a day</small>
            </span>
          </>
        ) : (
          <span className="bd-trip-empty">
            <Car aria-hidden />
            {note}
          </span>
        )}
      </div>
      {total !== undefined && (
        <div className="bd-trip-total">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </div>
      )}
      <div className="bd-trip-action">{action}</div>
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bd-field">
      <small>{label}</small>
      <span>{value}</span>
    </div>
  );
}

type Site = ReturnType<typeof useSitePreview>;

function Portal({
  site,
  booked,
  today,
  fresh,
  signed,
  verified,
  approved,
  opened,
  onOpen,
  onClose,
  onApprove,
  onRenter,
  page,
  onPage,
  cars,
}: {
  site: Site;
  booked: boolean;
  today: Date | null;
  page: AdminPage;
  onPage: (page: AdminPage) => void;
  cars: typeof CARS;
  fresh: { ref: string; name: string; car: string; from: Date | null; to: Date | null; days: number; total: number };
  signed: boolean;
  verified: boolean;
  approved: boolean;
  opened: boolean;
  onOpen: () => void;
  onClose: () => void;
  onApprove: () => void;
  onRenter: () => void;
}) {
  const at = (n: number) => (today ? shortDate(addDays(today, n)) : "");
  const first = fresh.name.split(" ")[0];
  const ready = signed && verified;
  const detail = booked && opened;
  return (
    <AdminShell brand={site} page={page} onPage={onPage}>
      {page === "dashboard" ? (
        <AdminDashboard key="dashboard" fresh={booked ? { name: fresh.name, car: fresh.car, total: fresh.total } : null} approved={approved} onRentals={() => onPage("rentals")} />
      ) : page === "customers" ? (
        <AdminCustomers key="customers" fresh={booked ? { name: fresh.name, email: RENTER.email } : null} verified={verified} />
      ) : page === "vehicles" ? (
        <AdminVehicles key="vehicles" cars={cars} fresh={booked ? { car: fresh.car } : null} />
      ) : detail ? (
        // The booking, opened: what is in, what is still waiting on the renter, and the approval.
        <div key="detail" className="bd-main">
          <button type="button" className="bd-backlink" onClick={onClose}>
            <ArrowLeft aria-hidden />
            Rentals
          </button>
          <div className="bd-toast" role="status">
            <Sparkles aria-hidden />
            <span>
              {approved
                ? `Done. I've sent ${first} the confirmation and held the ${fresh.car} on your calendar.`
                : ready
                  ? `${first} has paid, signed and verified. It's ready for you to approve.`
                  : `${first} has paid. I'm waiting on ${!signed ? "the signed agreement" : ""}${!signed && !verified ? " and " : ""}${!verified ? "the licence check" : ""}.`}
            </span>
          </div>
          <h3 className="bd-main-title">
            {fresh.ref} <span className={`bd-state${approved ? " is-ok" : ""}`}>{approved ? "Confirmed" : "Pending"}</span>
          </h3>
          <p className="bd-main-sub">
            {fresh.name} · {fresh.car} · {fresh.from ? longDate(fresh.from) : ""} to {fresh.to ? longDate(fresh.to) : ""} · {fresh.days}{" "}
            {fresh.days === 1 ? "day" : "days"}
          </p>
          <ul className="bd-checks">
            <li className="is-done">
              <span className="bd-check-dot">
                <Check strokeWidth={3} aria-hidden />
              </span>
              <b>Payment</b>
              <small>{money(fresh.total)} paid by Visa ending 4242, into your account</small>
            </li>
            <li className={signed ? "is-done" : undefined}>
              <span className="bd-check-dot">{signed ? <Check strokeWidth={3} aria-hidden /> : <FileSignature aria-hidden />}</span>
              <b>Agreement</b>
              <small>{signed ? `Signed by ${fresh.name}, kept on this rental` : "Sent to the renter, not signed yet"}</small>
            </li>
            <li className={verified ? "is-done" : undefined}>
              <span className="bd-check-dot">{verified ? <Check strokeWidth={3} aria-hidden /> : <ShieldCheck aria-hidden />}</span>
              <b>Licence</b>
              <small>{verified ? "Verified, with a 94% face match" : "Waiting for the renter's licence and selfie"}</small>
            </li>
          </ul>
          <div className="bd-detail-acts">
            {approved ? (
              <p className="bd-approved" role="status">
                <Check strokeWidth={3} aria-hidden />
                Booking approved. The keys are good to go.
              </p>
            ) : ready ? (
              <button type="button" className="bd-go bd-hint" onClick={onApprove}>
                Approve booking
              </button>
            ) : (
              <>
                <button type="button" className="bd-go" disabled>
                  Approve booking
                </button>
                <button type="button" className="bd-next bd-hint" onClick={onRenter}>
                  Go to your customer&apos;s portal
                  <ArrowRight aria-hidden />
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
      <div key="list" className="bd-main">
        {booked && (
        <div className="bd-toast" role="status">
          <Sparkles aria-hidden />
          <span>
            {fresh.name} just booked the {fresh.car} on your website. I&apos;ve added it to Rentals.
          </span>
        </div>
        )}
        <AdminRentalsTop fresh={booked ? { total: fresh.total } : null} />
        <div className="cp-card cp-table-wrap">
          <table className="cp-table">
            <thead>
              <tr>
                <th>Rental #</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Pickup</th>
                <th>Return</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {booked && (
              <tr className="np-new is-link" onClick={onOpen}>
                <td>
                  {fresh.ref}
                  <span className="bd-new">From your website</span>
                </td>
                <td>{fresh.name}</td>
                <td>{fresh.car}</td>
                <td>{fresh.from ? shortDate(fresh.from) : ""}</td>
                <td>{fresh.to ? shortDate(fresh.to) : ""}</td>
                <td className={approved ? "is-ok" : "is-warn"}>{approved ? "Confirmed" : "Pending"}</td>
                <td>
                  <button type="button" className={`bd-open${approved ? "" : " bd-hint"}`} onClick={onOpen}>
                    Open
                  </button>
                </td>
              </tr>
              )}
              {EARLIER.map((row) => (
                <tr key={row.ref}>
                  <td>{row.ref}</td>
                  <td>{row.name}</td>
                  <td>{row.car}</td>
                  <td>{at(row.from)}</td>
                  <td>{at(row.to)}</td>
                  <td className={row.status === "Pending" ? "is-warn" : row.status === "Active" ? "is-info" : "is-muted"}>{row.status}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cp-count np-count">
          Showing {EARLIER.length + (booked ? 1 : 0)} of {EARLIER.length + (booked ? 1 : 0)} rentals <span>Show more</span>
        </p>
      </div>
      )}
    </AdminShell>
  );
}
