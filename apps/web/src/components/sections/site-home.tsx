"use client";

import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, BadgeCheck, CalendarDays, ChevronLeft, ChevronRight, CreditCard, FileSignature, KeyRound, MapPin } from "lucide-react";
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
}: {
  template: SiteTemplate;
  accent: string;
  name: string;
  initial: string;
  onBook?: () => void;
  /** A live drawing: the nav opens the site's other pages, and Sign in the customer's portal. */
  onNav?: (page: SiteHomeNav) => void;
  onSignIn?: () => void;
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
                <BadgeCheck /> Licence checked
              </span>
              <span className="ws-chip is-2">
                <FileSignature /> Agreement signed
              </span>
              <span className="ws-chip is-3">
                <KeyRound /> Keys ready
              </span>
            </div>
          </div>
          <Search onBook={onBook} />
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
        <small>Pick-up</small>
        Add date
      </span>
      <span>
        <CalendarDays />
        <small>Return</small>
        Add date
      </span>
      <Act onBook={onBook} className="ws-btn is-find">
        Find a car <ArrowRight />
      </Act>
    </div>
  );
}
