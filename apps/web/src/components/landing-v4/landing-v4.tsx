import {
  Globe,
  IdCard,
} from "lucide-react";
import Link from "next/link";
import type { SignupPlan } from "@/lib/plans";
import { FlowPicker, LandingEffects, Pricing, Showcase } from "./interactive";
import { HeroWall } from "./hero-wall";
import { V3Section, V3SectionsBehaviour } from "./v3-sections";
import { V3_CTA, V3_FAQ, V3_FOOTER } from "./v3-markup";
import { Testimonials } from "./testimonials";
import { TraxPortal } from "./trax-portal";
import { NavMenu } from "./nav-menu";
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

// The integrations field: one glass tile per integration (no empty tiles), the
// logo large with its name and category under it, in staggered columns like
// keys. `y` nudges a column down, in tile heights. The two Twilio tiles sit
// apart because they share a logo.
const IX_LAYOUT: { y: number; names: string[] }[] = [
  { y: 0.45, names: ["Turo Sync", "Stripe Connect"] },
  { y: 0, names: ["Square", "Bonzah"] },
  { y: 0.6, names: ["BoldSign", "Twilio Messages"] },
  { y: 0.55, names: ["Xero"] },
  { y: 0.1, names: ["Tesla", "Zoho"] },
  { y: 0.5, names: ["CheckMyDriver", "Inshur"] },
  { y: 0.15, names: ["Twilio Calling", "Custom Domain"] },
];
const IX_COLUMNS = IX_LAYOUT.map((col) => ({
  y: col.y,
  cells: col.names.map((n) => INTEGRATIONS.find((it) => it.name === n)).filter((it): it is Integration => !!it),
}));

const NAV_LINKS = [
  { href: "#x-showcase", label: "Product" },
  { href: "#x-integrations", label: "Integrations" },
  { href: "#x-trax", label: "Trax AI" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#x-pricing", label: "Pricing" },
  { href: "#x-faq", label: "FAQ" },
];

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
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="ctas">
            <a className="l4-btn outline" href="#x-pricing">
              See pricing
            </a>
            <a className="l4-btn primary" href="/strategy-call">
              Book a demo
            </a>
          </div>
          <NavMenu links={NAV_LINKS} />
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
          {/* one glass tile per integration, columns staggered like keys; hover or focus one for what it does */}
          <div className="ix-field l4-rv">
            {IX_COLUMNS.map((col, c) => (
              <div key={c} className="ix-col" style={{ ["--y" as string]: col.y }}>
                {col.cells.map((it) => {
                  const src = it.mark ?? it.logo;
                  return (
                    <button
                      key={it.name}
                      type="button"
                      className="ix-tile"
                      style={{ ["--n" as string]: INTEGRATIONS.indexOf(it) }}
                      aria-label={`${it.name}: ${it.d}`}
                    >
                      <span className="mk">
                        {src ? (
                          <>
                            <img className="glow" src={src} alt="" loading="lazy" />
                            <img className="lg" src={src} alt="" loading="lazy" />
                          </>
                        ) : it.Icon ? (
                          <it.Icon className="ic" style={{ color: it.tint }} />
                        ) : null}
                      </span>
                      <span className="nm">{it.name}</span>
                      <span className="ct">{it.cat}</span>
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
            <FlowPicker>
              <span className="l4-kick">How it works</span>
              <h2 className="l4-h2">Everything your renters do, on their phone</h2>
              <p className="l4-lead">
                From booking and ID checks to paying, signing and asking for more days, on your own booking site and
                in their own account. Pick a flow to see it.
              </p>
            </FlowPicker>
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
