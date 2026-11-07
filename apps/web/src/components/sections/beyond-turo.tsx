"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Globe, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";

import "@/components/content/content.css";
import "./beyond-turo.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Beyond Turo: keep the renters Turo brings you, and grow a direct business beside it.
 * The Turo section says what Turo costs and Turo Sync brings the trips across; this one is
 * the path in between, as four steps of one worked example, then what Drive247 gives an
 * operator for it.
 *
 * What it must never say, so the page stays true:
 * - That Turo guests should be moved off Turo or asked to book direct. Turo's rules forbid
 *   taking a Turo booking off the platform. Direct renters come from the operator's own
 *   channels: their Google Business Profile, Instagram, their own ads, word of mouth, and
 *   repeat renters who found them directly.
 * - That Drive247 runs or measures the marketing. There are no ad tools or ad integrations,
 *   website analytics is still demo data (and so is the dashboard's "where bookings come
 *   from" card by default), so the chart is an example, never a product screen.
 * - That Turo Sync is included. It is early access.
 *
 * The section's one animation: each step's direct share rises into its bar as the bar comes
 * into view. Reduced motion, and a bar already on screen when the page loads, show the
 * finished chart with no motion. The server renders it finished too.
 */

/*
 * Turo's US earnings plans, from January 7, 2026: hosts keep 70%, 80% or 90% of a trip. The
 * example uses the middle one. The same source as TURO_SOURCE in turo-section.tsx.
 */
const TURO_KEEPS = 80;
const TURO_SOURCE = "https://help.turo.com/en_us/earnings-plans-in-detail-us-hosts-ByMOIVxEc";

/* The example: the same trips each month at every step, in dollars. Only where they book changes. */
const TRIPS = 10_000;

/* Each step's share of those trips booked direct, in percent. Turo has the rest. */
const STEPS = [
  {
    direct: 0,
    title: "Turo brings your renters",
    text: "Keep your listings live while you set up. Nothing changes for your Turo renters.",
  },
  {
    direct: 10,
    title: "Open your own booking site",
    text: "Put its link on your Google Business Profile and your Instagram, so people who find you can book you directly.",
  },
  {
    direct: 30,
    title: "Find renters of your own",
    text: "From your own ads, word of mouth, and repeat renters who found you directly. Trips booked on Turo stay on Turo.",
  },
  {
    direct: 50,
    title: "Turo becomes one channel",
    text: "Your own site and your own customers carry half the business. Turo still fills the rest.",
  },
];

/**
 * What the operator keeps in a month: TURO_KEEPS% of the Turo trips, and all of the direct ones,
 * as Drive247 takes no commission (before card fees and the plan). Whole dollars for any whole
 * percent, so the figures on the page add up exactly.
 */
function kept(direct: number): number {
  const onTuro = (TRIPS * (100 - direct)) / 100;
  const booked = (TRIPS * direct) / 100;
  return (onTuro * TURO_KEEPS) / 100 + booked;
}

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (n: number) => MONEY.format(n);

const PIECES: { icon: typeof Globe; title: string; early?: boolean; text: ReactNode }[] = [
  {
    icon: Globe,
    title: "Your own booking site",
    text: (
      <>
        Live the day you sign up, at <span className="bt-addr">yourname.drive-247.com</span> or on your own domain.
        Renters book and pay there, into your own Stripe or Square account.
      </>
    ),
  },
  {
    icon: UsersRound,
    title: "Your own customers",
    text: "Everyone who books direct is your customer, and their details stay with your business. Your ads and posts send people to your site, not a marketplace.",
  },
  {
    icon: ShieldCheck,
    title: "Protection on direct trips",
    text: "Licence front and back, matched to a selfie. E-signed agreements. Deposits held on the renter’s card. Insurance through Bonzah per rental, or the renter’s own policy.",
  },
  {
    icon: RefreshCw,
    title: "Turo Sync",
    early: true,
    text: "Reads your Turo trips into Drive247, so they sit on the same calendar as your direct bookings.",
  },
];

export function BeyondTuro() {
  const stepsRef = useRef<HTMLOListElement>(null);
  // Off until the client knows the chart is still below the screen: the server draws it finished.
  const [armed, setArmed] = useState(false);
  const [risen, setRisen] = useState<number[]>([]);

  useEffect(() => {
    const list = stepsRef.current;
    if (!list) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bars = [...list.querySelectorAll<HTMLElement>(".bt-bar")];
    // Already on screen (or scrolled past): leave it finished rather than empty it in view.
    if (bars.some((bar) => bar.getBoundingClientRect().top < window.innerHeight)) return;

    setArmed(true);
    const observer = new IntersectionObserver(
      (entries) => {
        const arrived = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number((entry.target as HTMLElement).dataset.step));
        if (!arrived.length) return;
        arrived.forEach((step) => observer.unobserve(bars[step]));
        setRisen((now) => [...now, ...arrived]);
      },
      { threshold: 0.6 },
    );
    bars.forEach((bar) => observer.observe(bar));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="beyond-turo" className="bt" aria-labelledby="bt-title">
      <div className="ct-inner">
        <SectionHeading
          id="bt-title"
          title={
            <>
              Keep the demand you already have.{" "} <Accent>Build a business that doesn&apos;t depend on it.</Accent>
            </>
          }
          sub={
            <>
              You don&apos;t have to leave Turo to start.{" "} Grow your own direct bookings beside it, one step at a time.
            </>
          }
        />

        <div className="bt-path" data-armed={armed || undefined}>
          <div className="bt-head">
            <div>
              <p className="bt-head-title">
                Where your trips book
                <span className="bt-pill">Example</span>
              </p>
              <p className="bt-head-sub">
                {money(TRIPS)} of trips a month at every step. Only where they book changes.
              </p>
            </div>
            <ul className="bt-legend" aria-hidden>
              <li>
                <i className="is-direct" />
                Direct
              </li>
              <li>
                <i className="is-turo" />
                Turo
              </li>
            </ul>
          </div>

          <ol ref={stepsRef} className="bt-steps">
            {STEPS.map((step, i) => {
              const keep = kept(step.direct);
              const gain = keep - kept(STEPS[0].direct);
              return (
                <li
                  key={step.title}
                  className={`bt-step${step.direct > 0 && step.direct < 20 ? " is-thin" : ""}${risen.includes(i) ? " is-risen" : ""}`}
                  style={{ "--bt-direct": step.direct, "--bt-at": `${i * 150}ms` } as CSSProperties}
                >
                  <h3 className="bt-step-title">
                    <span className="bt-n">{i + 1}</span>
                    {step.title}
                  </h3>
                  <p className="bt-step-text">{step.text}</p>
                  <div
                    className="bt-bar"
                    data-step={i}
                    role="img"
                    aria-label={`${step.direct}% of trips booked direct, ${100 - step.direct}% on Turo`}
                  >
                    <span className="bt-turo">
                      <span>
                        <b>{100 - step.direct}%</b>
                        <span className="bt-word"> Turo</span>
                      </span>
                    </span>
                    {step.direct > 0 && (
                      <span className="bt-fill">
                        <span>
                          <b>{step.direct}%</b>
                          <span className="bt-word"> direct</span>
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="bt-keep">
                    <span className="bt-keep-label">You keep</span>
                    <span className="bt-keep-value">
                      {money(keep)} <small>a month</small>
                    </span>
                    <span className={`bt-keep-gain${gain > 0 ? " is-up" : ""}`}>
                      {gain > 0 ? `+${money(gain)} vs step 1` : "Where you start"}
                    </span>
                  </p>
                </li>
              );
            })}
          </ol>

          <div className="bt-notes">
            <p className="bt-notes-lead">An example, not a forecast.</p>
            <dl>
              <div>
                <dt>On Turo</dt>
                <dd>
                  You keep {TURO_KEEPS}% of each trip, on the middle of Turo&apos;s three US plans. Hosts keep 70%, 80% or
                  90% on plans from January 7, 2026.{" "}
                  <a href={TURO_SOURCE} target="_blank" rel="noreferrer">
                    Turo&apos;s US plan terms
                  </a>
                </dd>
              </div>
              <div>
                <dt>Direct</dt>
                <dd>
                  Drive247 takes no commission, so direct trips count in full. Figures are before card fees (Stripe or
                  Square, typically about 2.9% + 30¢ a payment in the US) and before your Drive247 plan.
                </dd>
              </div>
              <div>
                <dt>Protection</dt>
                <dd>On direct trips you arrange your own. Anything it costs you isn&apos;t counted here.</dd>
              </div>
            </dl>
          </div>
        </div>

        <h3 className="bt-more-title">What Drive247 gives you along the way</h3>
        <ul className="bt-pieces">
          {PIECES.map(({ icon: Icon, title, early, text }) => (
            <li key={title} className="bt-piece">
              <span className="bt-piece-icon" aria-hidden>
                <Icon strokeWidth={2} />
              </span>
              <h4 className="bt-piece-title">
                {title}
                {early && <span className="bt-pill">Early access</span>}
              </h4>
              <p className="bt-piece-text">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
