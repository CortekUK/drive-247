import {
  Globe,
  IdCard,
} from "lucide-react";
import Link from "next/link";
import type { SignupPlan } from "@/lib/plans";
import { Handover, LandingEffects, Pricing, Showcase } from "./interactive";
import { HeroWall } from "./hero-wall";
import { V3Section, V3SectionsBehaviour } from "./v3-sections";
import { V3_CTA, V3_FAQ, V3_FOOTER } from "./v3-markup";
import { Testimonials } from "./testimonials";
import { TraxPortal } from "./trax-portal";
import "./landing-v4.css";
import "./portal-screens.css";

/*
 * Drive247 landing v4 — served as the "v2" landing page (`/?landing=v2`).
 *
 * Rebuilt after the team review of the Claude Design export (landing-v3, still
 * on disk, no longer mounted). What changed and why:
 *   - Native scrolling. v3 sealed the page on the hero until a wheel gesture
 *     played the 24/7 door animation, so a plain scroll did nothing.
 *   - The portal v2 design system is the source of truth: Manrope only, brand
 *     #442DD7, white surfaces, 26px cards, pill buttons (landing-v4.css).
 *   - The hero is copy on the left and a wall of operators, cars and product
 *     clips on the right (hero-wall.tsx); the old split hero (SplitHero) is
 *     unmounted. Bookings are
 *     shown as four real surfaces (booking site + CMS, customer portal,
 *     calendar, request queue); the handover is shown on the renter's phone.
 *   - Payments are no longer a headline section; they are one tab of the
 *     showcase, which presents the seven things Drive247 sells.
 *   - Integrations list what the portal's integrations board actually offers
 *     (apps/portal/src/app/(dashboard)/integrations/integrations-board.tsx).
 *   - Trax is the portal's own Trax panel, replicated (trax-portal.tsx).
 *   - Testimonials keep the old section's look but render from
 *     testimonials-data.ts, text or video (testimonials.tsx).
 *   - FAQ, the closing CTA and the footer are the old page's own sections,
 *     unchanged (v3-sections.tsx), by request.
 */

// logo.dev publishable key — the same one the portal's integrations board uses.
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const logoDev = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=128&format=png`;

type Integration = { name: string; cat: string; d: string; logo?: string; mark?: string; Icon?: typeof Globe; tint?: string };

// The portal's integrations board, name for name and in its own words
// (apps/portal/src/app/(dashboard)/integrations/integrations-board.tsx).
const INTEGRATIONS: Integration[] = [
  { name: "Turo Sync", cat: "Fleet", d: "Pull your Turo trips in and stop double-booking.", mark: logoDev("turo.com") },
  { name: "Stripe Connect", cat: "Payments", d: "Accept booking payments, deposits & payouts.", mark: logoDev("stripe.com") },
  { name: "Square", cat: "Payments", d: "Take booking payments through your Square account.", mark: logoDev("squareup.com") },
  { name: "Bonzah", cat: "Insurance", d: "Per-rental insurance coverage at checkout.", mark: logoDev("bonzah.com") },
  { name: "Inshur", cat: "Insurance", d: "Fleet insurance for your vehicles between rentals.", mark: logoDev("inshur.com") },
  { name: "BoldSign", cat: "Documents", d: "E-signature for rental agreements.", mark: logoDev("boldsign.com") },
  { name: "CheckMyDriver", cat: "Verification", d: "Verify driver's licenses & identity.", Icon: IdCard, tint: "#0EA5E9" }, // the board's iconColor
  { name: "Twilio Messages", cat: "Messaging", d: "SMS notifications, reminders & 2-way chat.", mark: logoDev("twilio.com") },
  { name: "Twilio Calling", cat: "Calling", d: "Call forwarding, voicemail & recordings.", mark: logoDev("twilio.com") },
  { name: "Tesla", cat: "Fleet", d: "Supercharging & vehicle data via the Fleet API.", mark: logoDev("tesla.com") },
  { name: "Custom Domain", cat: "Website", d: "Use your own domain for booking & portal.", Icon: Globe, tint: "#737373" }, // text-muted-foreground
  { name: "Xero", cat: "Accounting", d: "Sync invoices & payments to Xero.", mark: logoDev("xero.com") },
  { name: "Zoho", cat: "Accounting", d: "Sync books & CRM with Zoho.", mark: logoDev("zoho.com") },
];

// The integrations field: a full-width wall of glass tiles, IX_COLS columns of
// IX_ROWS, each column nudged down a little. Real integrations sit in the
// middle (column, row below); every other tile is empty glass that fades the
// further it is from the middle, so the wall reads as wide without inventing
// integrations Drive247 does not have.
const IX_COLS = 21;
const IX_ROWS = 4;
const IX_AT: Record<string, [number, number]> = {
  "Turo Sync": [5, 2],
  "Stripe Connect": [6, 1],
  Square: [7, 2],
  Bonzah: [8, 1],
  BoldSign: [9, 0],
  "Twilio Messages": [10, 1],
  "Twilio Calling": [15, 0], // apart from Twilio Messages: they share a logo
  Xero: [11, 0],
  Tesla: [12, 1],
  Zoho: [12, 2],
  CheckMyDriver: [13, 0],
  Inshur: [14, 1],
  "Custom Domain": [15, 2],
};
const IX_COLUMNS = Array.from({ length: IX_COLS }, (_, c) => ({
  y: Math.round((Math.sin(c * 1.3) * 0.45 + Math.cos(c * 0.55) * 0.3) * 100) / 100,
  // 0 at the middle of the wall, 1 at its edges
  far: Math.round(Math.min(1, Math.abs(c - 10) / 10) * 100) / 100,
  cells: Array.from({ length: IX_ROWS }, (_, r) => INTEGRATIONS.find((it) => IX_AT[it.name]?.[0] === c && IX_AT[it.name]?.[1] === r) ?? null),
}));

export function LandingV4({ plans }: { plans: readonly SignupPlan[] }) {
  return (
    <div className="l4">
      <LandingEffects />

      {/* ---------------- nav ---------------- */}
      <header className="l4-nav is-tucked">{/* hidden over the hero; hero-wall.tsx brings it down */}
        <div className="bar">
          <Link className="logo" href="/" aria-label="Drive247 home">
            <img src="/logo-light.png" alt="Drive247" />
          </Link>
          <nav className="links" aria-label="Sections">
            <a href="#x-showcase">Product</a>
            <a href="#x-integrations">Integrations</a>
            <a href="#x-trax">Trax AI</a>
            <a href="#how-it-works">How pickup works</a>
            <a href="#x-pricing">Pricing</a>
            <a href="#x-faq">FAQ</a>
          </nav>
          <div className="ctas">
            <a className="l4-btn outline" href="#x-pricing">
              See pricing
            </a>
            <a className="l4-btn primary" href="/strategy-call">
              Book a demo
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ---------------- hero: copy left, a wall of operators and product clips right ---------------- */}
        <HeroWall fromPrice={plans.length ? Math.min(...plans.map((p) => p.priceUsd)) : null} />

        {/* ---------------- the portal, tab by tab ---------------- */}
        <section className="l4-sec" id="x-showcase">
          <div className="l4-wrap">
            <div className="l4-head l4-rv">
              <span className="l4-kick">The portal</span>
              <h2 className="l4-h2">Your whole business in one portal</h2>
              <p className="l4-lead">The same tabs your team works in every day. Pick one to see it.</p>
            </div>
            <Showcase />
          </div>
        </section>

        {/* ---------------- integrations ---------------- */}
        <section className="l4-sec l4-ix" id="x-integrations">
          <div className="l4-wrap">
            <div className="ix-head l4-rv">
              <span className="l4-kick">Integrations</span>
              <h2 className="l4-h2">
                Plug into the tools you trust
                <br />
                <span>Payments, insurance, books and more</span>
              </h2>
              <p className="l4-lead">
                {INTEGRATIONS.length} integrations and growing. Switch each one on from the Integrations page in your portal.
              </p>
            </div>
          </div>
          {/* a field of glass tiles, columns staggered like keys; hover or focus a logo for what it does */}
          <div className="ix-field l4-rv">
            {IX_COLUMNS.map((col, c) => (
              <div key={c} className="ix-col" style={{ ["--y" as string]: col.y, ["--far" as string]: col.far }}>
                {col.cells.map((it, r) => {
                  const k = Math.abs(c - 10) * 2 + r; // rises in from the middle outward
                  if (!it) return <span key={r} className="ix-tile empty" style={{ ["--k" as string]: k }} />;
                  const src = it.mark ?? it.logo;
                  return (
                    <button
                      key={r}
                      type="button"
                      className="ix-tile"
                      style={{ ["--k" as string]: k, ["--n" as string]: INTEGRATIONS.indexOf(it) }}
                      aria-label={`${it.name}: ${it.d}`}
                    >
                      {src ? (
                        <>
                          <img className="glow" src={src} alt="" loading="lazy" />
                          <img className="lg" src={src} alt="" loading="lazy" />
                        </>
                      ) : it.Icon ? (
                        <it.Icon className="ic" style={{ color: it.tint }} />
                      ) : null}
                      <span className="tip" role="tooltip">
                        <span className="th">
                          {src ? <img src={src} alt="" /> : it.Icon ? <it.Icon style={{ color: it.tint }} /> : null}
                          <span>
                            <b>{it.name}</b>
                            <small>{it.cat}</small>
                          </span>
                        </span>
                        <span className="td">{it.d}</span>
                        <span className="tf">Switch on in Portal → Integrations</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- Trax: the portal's own panel ---------------- */}
        <TraxPortal />

        {/* ---------------- how it works: the renter's phone ---------------- */}
        <section className="l4-sec soft" id="how-it-works">
          <div className="l4-wrap">
            <Handover>
              <span className="l4-kick">How pickup works</span>
              <h2 className="l4-h2">Your customers pick up the car on their own</h2>
              <p className="l4-lead">
                This is what the people renting your cars see on their phone, from the moment they book until they
                pick up the keys. You don’t need to be there.
              </p>
            </Handover>
          </div>
        </section>

        {/* ---------------- testimonials: text and video (testimonials-data.ts) ---------------- */}
        <Testimonials />

        {/* ---------------- pricing ---------------- */}
        <section className="l4-sec" id="x-pricing">
          <div className="l4-wrap">
            <Pricing plans={plans} />
          </div>
        </section>

        {/* ---------------- FAQ (as before) ---------------- */}
        <V3Section html={V3_FAQ} />

        {/* ---------------- CTA (as before) ---------------- */}
        <V3Section html={V3_CTA} />
      </main>

      {/* ---------------- footer (as before) ---------------- */}
      <V3Section html={V3_FOOTER} />
      <V3SectionsBehaviour />
    </div>
  );
}
