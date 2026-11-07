"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Car, Check, CreditCard, KeyRound, LayoutDashboard, Lock, RotateCcw, Sparkles, Users } from "lucide-react";
import { useFadeIn } from "@/hooks/use-fade-in";
import { BrowserChrome } from "./portal-glass";
import "./booking-demo.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Experience your own booking website: a working example of the booking site Drive247 builds
 * for an operator, in a browser window. The visitor books a car the way a renter would, in
 * the real site's three steps (Trip details, Your car, Checkout: apps/booking/.../site-v2/book),
 * and the window then turns to the operator's portal, where the booking sits at the top of
 * Rentals (the real screen: public/v2/dash-main.png).
 *
 * Nothing here is sent anywhere and no card is charged. The dates are worked out in the
 * visitor's browser from today, so the example never shows a month that has passed.
 */

type Stage = "dates" | "car" | "checkout" | "booked" | "portal";

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
] as const;

const STEPS = ["Choose dates", "Pick a car", "Check out", "See it in your portal"];
const SITE_STEPS = ["Trip details", "Your car", "Checkout"];

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKS = 5;

const addDays = (date: Date, n: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const longDate = (d: Date) => `${DAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
const shortDate = (d: Date) => `${MONTH[d.getMonth()]} ${d.getDate()}`;
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

function stepOf(stage: Stage) {
  return stage === "dates" ? 0 : stage === "car" ? 1 : stage === "checkout" ? 2 : 3;
}

export function BookingDemo() {
  const { ref, visible } = useFadeIn();

  // Today, in the visitor's own browser. Until it is known the calendar draws without numbers.
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => {
    const now = new Date();
    setToday(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  }, []);

  const [stage, setStage] = useState<Stage>("dates");
  const [pickup, setPickup] = useState<number | null>(null);
  const [back, setBack] = useState<number | null>(null);
  const [carId, setCarId] = useState<string | null>(null);
  const [bookingRef, setBookingRef] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

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
    timer.current = window.setTimeout(() => setStage("portal"), 1800);
  };
  const reset = () => {
    window.clearTimeout(timer.current);
    setStage("dates");
    setPickup(null);
    setBack(null);
    setCarId(null);
  };

  // What to do next, said once above the window; the thing to press also gets a soft ring.
  const tip =
    stage === "dates"
      ? pickup === null
        ? "Tap the day you'd pick the car up."
        : back === null
          ? "Now tap the day you'd bring it back."
          : "Those are your dates. Press See cars."
      : stage === "car"
        ? car
          ? "Good choice. Press Continue to checkout."
          : "Choose any car. Each one is priced for your dates."
        : stage === "checkout"
          ? "Your details are filled in. Press Pay to book."
          : stage === "booked"
            ? "Booked. Now watch where it lands."
            : "There it is, at the top of your Rentals, the moment it was booked.";

  const step = stepOf(stage);
  const portal = stage === "portal";
  const hint = (on: boolean) => (on ? " bd-hint" : "");

  return (
    <section id="booking-demo" aria-labelledby="booking-demo-heading" className="bd-section">
      <div ref={ref} className={`bd-inner ${visible ? "fade-in-visible" : "fade-in-hidden"}`}>
        <div className="bd-head">
          <SectionHeading
            id="booking-demo-heading"
            title={
              <>
                Experience your own <Accent>booking website</Accent>
              </>
            }
            sub={
              <>
                Book a car the way your renters will: choose dates, pick a car and check out. Then see the booking land in your portal.
              </>
            }
          />
        </div>

        <div className="bd-guide">
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

        <div className="bd-window">
          <BrowserChrome
            tab={portal ? "Rentals · Your portal" : "Book a car · Your Rentals"}
            url={portal ? "northwind.portal.drive-247.com/rentals" : "yourrentals.com/booking"}
          >
            {portal ? (
              <Portal
                today={today}
                fresh={{
                  ref: bookingRef,
                  name: RENTER.name,
                  car: car?.name ?? "",
                  from: pickup !== null ? dateAt(pickup) : null,
                  to: back !== null ? dateAt(back) : null,
                  days,
                }}
              />
            ) : (
              <div className="bd-site">
                <header className="bd-site-bar">
                  <span className="bd-brand">
                    <i aria-hidden />
                    Your Rentals
                  </span>
                  <nav className="bd-site-nav" aria-hidden>
                    <span>Fleet and Pricing</span>
                    <span>Reviews</span>
                    <span>About</span>
                    <span>Contact</span>
                  </nav>
                  <span className="bd-site-cta" aria-hidden>
                    Book a car
                  </span>
                </header>

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
    </section>
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

function Portal({
  today,
  fresh,
}: {
  today: Date | null;
  fresh: { ref: string; name: string; car: string; from: Date | null; to: Date | null; days: number };
}) {
  const at = (n: number) => (today ? shortDate(addDays(today, n)) : "");
  return (
    <div className="bd-portal">
      <aside className="bd-side" aria-hidden>
        <span className="bd-org">
          <i>N</i>
          Northwind
        </span>
        <span>
          <LayoutDashboard />
          Dashboard
        </span>
        <span>
          <Users />
          Customers
        </span>
        <span>
          <Car />
          Vehicles
        </span>
        <span className="is-on">
          <KeyRound />
          Rentals
        </span>
      </aside>
      <div className="bd-main">
        <div className="bd-toast" role="status">
          <Sparkles aria-hidden />
          <span>
            {fresh.name} just booked the {fresh.car} on your website. I&apos;ve added it to Rentals.
          </span>
        </div>
        <h3 className="bd-main-title">Rentals</h3>
        <p className="bd-main-sub">Manage rental agreements and contracts</p>
        <div className="bd-table-wrap">
          <table className="bd-table">
            <thead>
              <tr>
                <th>Rental #</th>
                <th>Customer</th>
                <th className="bd-opt">Vehicle</th>
                <th className="bd-opt">Pickup</th>
                <th className="bd-opt">Return</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="is-new">
                <td>
                  {fresh.ref}
                  <span className="bd-new">From your website</span>
                </td>
                <td>{fresh.name}</td>
                <td className="bd-opt">{fresh.car}</td>
                <td className="bd-opt">{fresh.from ? shortDate(fresh.from) : ""}</td>
                <td className="bd-opt">{fresh.to ? shortDate(fresh.to) : ""}</td>
                <td className="is-pending">Pending</td>
              </tr>
              {EARLIER.map((row) => (
                <tr key={row.ref}>
                  <td>{row.ref}</td>
                  <td>{row.name}</td>
                  <td className="bd-opt">{row.car}</td>
                  <td className="bd-opt">{at(row.from)}</td>
                  <td className="bd-opt">{at(row.to)}</td>
                  <td className={row.status === "Pending" ? "is-pending" : "is-done"}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
