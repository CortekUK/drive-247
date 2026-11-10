"use client";

import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, BadgeCheck, CalendarDays, ChevronLeft, ChevronRight, CreditCard, FileSignature, Fuel, Gauge, KeyRound, MapPin, Menu } from "lucide-react";
import type { SiteTemplate } from "@/lib/site-preview";
import "./site-home.css";

/*
 * The home page of an operator's booking site, drawn in either template, in their colour
 * and under their name. Classic follows the default site (site-v2's home); Glass follows
 * template 2 (apps/booking/src/northwind-site/template-2). Sized in em from the width it
 * is given, so the same drawing works small in the editor and large in the demo.
 */

const NAV = ["Fleet and Pricing", "Promotions", "Reviews", "About", "Contact"];
/** The page each nav label opens, in the demo (demo-pages.tsx SitePage). */
const NAV_PAGE = ["fleet", "promotions", "reviews", "about", "contact"] as const;
export type SiteHomeNav = (typeof NAV_PAGE)[number];

/*
 * Only a live drawing gets real buttons; one drawn with no `onBook` gets plain spans.
 * Kept out here, not inside SiteHome: made in there it was a new component on every render,
 * so its button was thrown away and rebuilt each time the name changed, and a press that
 * straddled a render was lost.
 */
function Act({ onBook, className, children }: { onBook?: () => void; className: string; children: ReactNode }) {
  return onBook ? (
    <button type="button" className={className} onClick={onBook}>
      {children}
    </button>
  ) : (
    <span className={className}>{children}</span>
  );
}

export function SiteHome({
  template,
  accent,
  name,
  initial,
  onBook,
  onNav,
  onSignIn,
  onMenu,
  cars = [],
}: {
  template: SiteTemplate;
  accent: string;
  name: string;
  initial: string;
  onBook?: () => void;
  /** A live drawing: the nav opens the site's other pages, and Sign in the customer's portal. */
  onNav?: (page: SiteHomeNav) => void;
  onSignIn?: () => void;
  /** A phone: the round menu button (site-v2 site-shell.tsx), which opens the demo's PhoneMenu. */
  onMenu?: () => void;
  /** The cars for the phone's car strip under the search (classic "Ready to drive", glass "Choose your car."). */
  cars?: readonly { id: string; name: string; meta: string; rate: number; photo: string }[];
}) {
  const links = NAV.map((n, i) => (
    <Act key={n} onBook={onNav && (() => onNav(NAV_PAGE[i]))} className="ws-link">
      {n}
    </Act>
  ));
  const style = { "--ws-a": accent } as CSSProperties;
  return (
    <div className="ws-frame">
      {template === "glass" ? (
        <div className="ws ws-glass" style={style}>
          <div className="ws-backdrop" aria-hidden />
          <header className="ws-nav ws-pane-thin">
            <Brand name={name} initial={initial} />
            <span className="ws-links ws-pane-thin">
              {links}
            </span>
            <span className="ws-acts">
              <Act onBook={onSignIn} className="ws-signin">
                {onSignIn ? "Dashboard" : "Sign in"}
              </Act>
              <Act onBook={onBook} className="ws-btn">
                Book a car
              </Act>
            </span>
            {onMenu && (
              <button type="button" className="ws-burger" onClick={onMenu} aria-label="Open menu">
                <Menu aria-hidden />
              </button>
            )}
          </header>
          <div className="ws-sheet ws-pane">
            <h4 className="ws-g-title">Book the car. Skip the counter.</h4>
            <p className="ws-g-sub">Choose your dates, check your licence and sign online. When you arrive, the keys are ready.</p>
            <div className="ws-show" aria-hidden>
              <span className="ws-model">GV80</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/landing-v4/cars/gv80.webp" alt="" />
              <i className="ws-arrow is-left">
                <ChevronLeft />
              </i>
              <i className="ws-arrow is-right">
                <ChevronRight />
              </i>
            </div>
            <span className="ws-dots" aria-hidden>
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="ws-toggle ws-pane-thin" aria-hidden>
              <b>Return to same place</b>
              <span>Different return</span>
            </span>
            <Search onBook={onBook} glass />
            <span className="ws-perks" aria-hidden>
              <span>
                <BadgeCheck /> Licence checked online
              </span>
              <span>
                <FileSignature /> Signed on screen
              </span>
              <span>
                <CreditCard /> Paid online
              </span>
            </span>
          </div>
          {cars.length > 0 && <ChooseYourCar cars={cars} onBook={onBook} onFleet={onNav && (() => onNav("fleet"))} />}
        </div>
      ) : (
        <div className="ws ws-classic" style={style}>
          <header className="ws-nav">
            <Brand name={name} initial={initial} />
            <span className="ws-links">
              <b>Home</b>
              {links}
            </span>
            <span className="ws-acts">
              <Act onBook={onSignIn} className="ws-signin">
                {onSignIn ? "Dashboard" : "Sign in"}
              </Act>
              <Act onBook={onBook} className="ws-btn">
                Book a car
              </Act>
            </span>
            {onMenu && (
              <button type="button" className="ws-burger" onClick={onMenu} aria-label="Open menu">
                <Menu aria-hidden />
              </button>
            )}
          </header>
          <div className="ws-c-hero">
            <div className="ws-c-copy">
              <h4 className="ws-c-title">
                Your car is <em>ready</em> when you are.
              </h4>
              <p className="ws-c-sub">Pick a car, choose your dates and pay online. We&apos;ll have it clean and waiting for you.</p>
              <span className="ws-c-btns">
                <Act onBook={onBook} className="ws-btn is-ink">
                  Choose your dates
                </Act>
                <Act onBook={onNav && (() => onNav("fleet"))} className="ws-btn is-plain">
                  See all cars
                </Act>
              </span>
            </div>
            <div className="ws-c-art" aria-hidden={!onBook}>
              <div className="ws-c-phone">
                <i className="ws-n" aria-hidden>1</i>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/landing-v4/cars/sonata.webp" alt="" />
                <b>Hyundai Sonata</b>
                <small>Sedan · 2024</small>
                <span className="ws-c-price">
                  <small>Price</small>
                  <b>$59</b>
                </span>
                <Act onBook={onBook} className="ws-btn is-full">
                  Book this car
                </Act>
              </div>
              <span className="ws-chip is-1">
                <i className="ws-n" aria-hidden>2</i>
                <BadgeCheck /> Licence checked
              </span>
              <span className="ws-chip is-2">
                <i className="ws-n" aria-hidden>3</i>
                <FileSignature /> Agreement signed
              </span>
              <span className="ws-chip is-3">
                <i className="ws-n" aria-hidden>4</i>
                <KeyRound /> Keys ready
              </span>
            </div>
          </div>
          <Search onBook={onBook} />
          {cars.length > 0 && <ReadyToDrive cars={cars} onBook={onBook} onFleet={onNav && (() => onNav("fleet"))} />}
        </div>
      )}
    </div>
  );
}

function Brand({ name, initial }: { name: string; initial: string }) {
  return (
    <span className="ws-brand">
      <i>{initial}</i>
      {name}
    </span>
  );
}

function Search({ onBook, glass = false }: { onBook?: () => void; glass?: boolean }) {
  return (
    <div className={`ws-search${glass ? " ws-pane-thin" : ""}`}>
      <span>
        <MapPin />
        <small>Pick-up location</small>
        Enter an address
      </span>
      {!glass && (
        <span className="ws-opt">
          <MapPin />
          <small>Drop-off location</small>
          Same as pick-up
        </span>
      )}
      <span>
        <CalendarDays />
        <small>
          Pick-up<em className="ws-nd"> date</em>
        </small>
        Add date
      </span>
      <span>
        <CalendarDays />
        <small>
          Return<em className="ws-nd"> date</em>
        </small>
        Add date
      </span>
      <Act onBook={onBook} className="ws-btn is-find">
        Find a car <ArrowRight />
      </Act>
    </div>
  );
}

type StripCar = { id: string; name: string; meta: string; rate: number; photo: string };

/*
 * Phone only (site-home.css hides both outside a narrow frame). Under the search the real home
 * pages go on to their cars: Classic's "Ready to drive" (site-v2 sections/home-fleet.tsx: the
 * heading, "Swipe through our cars. Tap one to book it.", See all, then a snapping row that opens
 * on the "Prices are per day" card), and Glass's "Choose your car." (template-2/fleet.tsx: a
 * centred heading on its own pane, Compare all, and one row per car).
 */
function ReadyToDrive({ cars, onBook, onFleet }: { cars: readonly StripCar[]; onBook?: () => void; onFleet?: () => void }) {
  return (
    <section className="ws-cars">
      <div className="ws-cars-head">
        <span>
          <b>Ready to drive</b>
          <small>Swipe through our cars. Tap one to book it.</small>
        </span>
        <Act onBook={onFleet} className="ws-see">
          See all {cars.length} <ArrowRight />
        </Act>
      </div>
      <div className="ws-cars-row">
        <div className="ws-car is-note">
          <span className="ws-note-art" aria-hidden>
            <CalendarDays />
          </span>
          <b>Prices are per day</b>
          <small>Add your dates in the search above and we&apos;ll show you the total for your trip.</small>
          <Act onBook={onBook} className="ws-see">
            Add dates <ArrowRight />
          </Act>
        </div>
        {cars.map((car) => (
          <div key={car.id} className="ws-car">
            <span className="ws-car-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={car.photo} alt="" />
            </span>
            <span className="ws-car-body">
              <span className="ws-car-top">
                <span>
                  <b>{car.name}</b>
                  <small>{car.meta.split(" · ")[0]} · 2024</small>
                </span>
                <span className="ws-car-rate">
                  <b>${car.rate}</b>
                  <small>a day</small>
                </span>
              </span>
              <span className="ws-car-specs">
                <span>
                  <Fuel /> Petrol
                </span>
                <span>
                  <Gauge /> Automatic
                </span>
              </span>
              <Act onBook={onBook} className="ws-car-book">
                Book this car
              </Act>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ChooseYourCar({ cars, onBook, onFleet }: { cars: readonly StripCar[]; onBook?: () => void; onFleet?: () => void }) {
  return (
    <section className="ws-choose ws-pane">
      <b className="ws-choose-title">Choose your car.</b>
      <small>Every car in the fleet, with its price by the day, the week and the month.</small>
      <Act onBook={onFleet} className="ws-see">
        Compare all {cars.length} cars <ArrowRight />
      </Act>
      <span className="ws-choose-list">
        {cars.map((car) => (
          <Act key={car.id} onBook={onBook} className="ws-choose-row ws-pane-thin">
            <span className="ws-choose-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={car.photo} alt="" />
            </span>
            <span className="ws-choose-name">
              <b>{car.name}</b>
              <small>2024 · {car.meta.split(" · ")[0]}</small>
            </span>
            <span className="ws-car-rate">
              <b>${car.rate}</b>
              <small>a day</small>
            </span>
          </Act>
        ))}
      </span>
    </section>
  );
}
