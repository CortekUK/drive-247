import type { ReactNode } from "react";
import { Manrope } from "next/font/google";
import { ArrowRight, Check, Plus } from "lucide-react";
import { PricingSection } from "@/components/sections/pricing";
import { ReferralBanner } from "@/components/sections/referral-banner";
import { FAQ_ITEMS, PROBLEM_POINTS } from "@/lib/constants";
import type { SignupPlan } from "@/lib/plans";
import type { PromoOffer } from "@/lib/promo-offer";
import { FooterV2, HeaderV2, PILL_OUTLINE, PILL_PRIMARY } from "./chrome";
import { HeroCollage } from "./hero-collage";
import { Eyebrow, ProductPreview } from "./product-preview";
import { Reveal } from "./reveal";
import { TraxShowcase } from "./trax-showcase";
import "./landing-v2.css";

/*
 * PARKED 2026-10-07: the full draft of the v2 page (hero, collage, Trax,
 * product, pillars, problem, launch, FAQ, closing). Ghulam cleared the page to
 * a plain dark canvas to choose content one section at a time; pull pieces
 * back into landing-v2.tsx from here.
 *
 * The v2 landing page: the northwind (portal v2) look on drive-247.com.
 * Served when the super-admin switch on the Signup Plans tab says "v2", or on
 * `/?landing=v2` as a preview.
 *
 * Everything v2 lives in components/landing-v2/; v1 stays untouched. It gets
 * the same data as v1: `plans` only while pricing is switched on (or on a fresh
 * referral arrival), `offer` only on a ?ref= visit. Pricing still uses v1's
 * grid, so self-serve signup and referral discounts work on either version.
 *
 * The look, from the portal: Manrope, white paper on a faint indigo wash,
 * hairline borders and no shadows, rounded-2xl cards, pill buttons, eyebrow
 * labels, one accent (#442DD7), soft neutral dark mode, 200ms ease-out motion.
 */

// The portal v2 typeface (apps/portal/src/app/layout.tsx).
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

const WRAP = "mx-auto max-w-6xl px-4 sm:px-6";

function SectionHead({ eyebrow, title, hint, center }: { eyebrow: string; title: ReactNode; hint?: string; center?: boolean }) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <Eyebrow className="text-[var(--lv-accent-ink)]">{eyebrow}</Eyebrow>
      <h2 className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">{title}</h2>
      {hint && <p className="mt-4 text-[15px] leading-relaxed text-[var(--lv-ink-3)]">{hint}</p>}
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

/*
 * Built to convert, in this order: who it is for (eyebrow), the outcome
 * (headline), what you get and why it is different (subline), one primary
 * action plus a lower-commitment one, the three worries removed right under
 * the button, then proof. The picture is the visitor's own booking site.
 *
 * Every claim is one the product backs today: the site is generated at signup
 * (signup-provision seeds it), own-domain is live, payments/deposits/ID
 * checks/agreements are built in, and the operator count is the live
 * subscription count. Nothing here mentions Turo Sync, Inshur or
 * CheckMyDriver, which are not on general release.
 */

const RISK_REMOVERS = ["Free strategy call", "Live in about a week", "On your own domain"];

/** Live operators on an active subscription (prod: 40 on 2026-10-07). Round down, never up. */
const OPERATOR_COUNT = "40+";

/** Integrations on general release (Inshur, CheckMyDriver and Turo Sync are not). */
const INTEGRATIONS = ["Stripe", "Square", "Twilio", "BoldSign", "Bonzah", "Xero", "Zoho Books", "Tesla"];

function Hero({ showPricing }: { showPricing: boolean }) {
  return (
    <section className="relative">
      <div className={`${WRAP} grid items-center gap-12 pb-12 pt-12 sm:pt-16 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:pb-16 lg:pt-20`}>
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--lv-accent)_25%,transparent)] bg-[color-mix(in_srgb,var(--lv-accent)_7%,transparent)] py-1 pl-2 pr-3 text-[12px] font-medium text-[var(--lv-accent-ink)]">
            <span className="size-1.5 rounded-full bg-[var(--lv-accent)]" />
            For independent car rental operators
          </span>

          <h1 className="mt-6 text-[44px] font-bold leading-[1.02] tracking-[-0.04em] sm:text-[56px] lg:text-[60px]">
            <span className="block">Your cars.</span>
            <span className="block">Your site.</span>
            <span className="block text-[var(--lv-accent-ink)]">Your customers.</span>
          </h1>

          <p className="mt-6 max-w-[31rem] text-[17px] leading-relaxed text-[var(--lv-ink-3)]">
            Drive247 builds your branded booking site and runs the business behind it: payments and deposits, ID
            checks, agreements and a renter portal, all in one place. No marketplace standing between you and the
            people who drive your cars.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a href="/strategy-call" className={`${PILL_PRIMARY} h-12 px-7 text-[15px]`}>
              Get your 7-day launch plan
              <ArrowRight className="size-4" aria-hidden />
            </a>
            <a href={showPricing ? "#pricing" : "#product"} className={`${PILL_OUTLINE} h-12 px-7 text-[15px]`}>
              {showPricing ? "See plans and pricing" : "See it in action"}
            </a>
          </div>

          <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[var(--lv-ink-2)]">
            {RISK_REMOVERS.map((r) => (
              <li key={r} className="flex items-center gap-1.5">
                <Check className="size-3.5 text-[var(--lv-accent-ink)]" aria-hidden />
                {r}
              </li>
            ))}
          </ul>

          <p className="mt-9 border-t border-[var(--lv-line)] pt-5 text-[13px] text-[var(--lv-ink-3)]">
            <span className="font-semibold tabular-nums text-[var(--lv-ink)]">{OPERATOR_COUNT} rental operators</span> across
            the US run their bookings on Drive247.
          </p>
        </div>

        <HeroCollage />
      </div>

      {/* Trust bar: the tools it plugs into, as quiet wordmarks. */}
      <div className={`${WRAP} pb-6`}>
        <div className="flex flex-col items-center gap-4 border-t border-[var(--lv-line)] pt-7 sm:flex-row sm:gap-8">
          <Eyebrow className="shrink-0">Works with</Eyebrow>
          <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 sm:justify-start">
            {INTEGRATIONS.map((name) => (
              <li key={name} className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--lv-ink-3)]">
                {name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ── Product ──────────────────────────────────────────────────────────── */

function Product() {
  return (
    <section id="product" className={`${WRAP} scroll-mt-20 py-14 sm:py-20`}>
      <Reveal>
        <SectionHead
          eyebrow="The operator portal"
          title="Your morning, already sorted."
          hint="Open Drive247 and the day is laid out for you: what is late, who is picking up, and where the money stands. Every row tells you how long it has been waiting."
        />
      </Reveal>
      <Reveal className="mt-10">
        <ProductPreview />
      </Reveal>
    </section>
  );
}

/* ── Three surfaces ───────────────────────────────────────────────────── */

/*
 * The dashboard's top-row treatment (dashboard-v2/card-surface.tsx): one brand
 * gradient printed at falling strength, so the cards read as one family. The
 * third drops to a flat tint and dark ink.
 */
const SURFACES = [
  { heaviness: 1, lighten: 0, gradient: true, onColour: true },
  { heaviness: 0.88, lighten: 0.2, gradient: true, onColour: true },
  { heaviness: 0.45, lighten: 0.34, gradient: false, onColour: false },
] as const;

const PILLARS = [
  {
    eyebrow: "Booking website",
    title: "Your site, on your domain.",
    points: ["Branded to your business", "Card payments and deposits through Stripe", "ID checks and agreements before pickup"],
  },
  {
    eyebrow: "Operator portal",
    title: "One desk for the whole fleet.",
    points: ["Fleet, rentals and payments in one place", "Trax flags what is late, due or at risk", "Calendar, extensions and reminders"],
  },
  {
    eyebrow: "Renter portal",
    title: "Customers look after themselves.",
    points: ["Bookings, payments and documents", "Messages with you in real time", "Extend a trip without a phone call"],
  },
];

function Pillars() {
  return (
    <section className={`${WRAP} py-14 sm:py-20`}>
      <Reveal>
        <SectionHead
          eyebrow="Everything in one system"
          title="Three surfaces. One rental business."
          hint="The site your renters book on, the portal you run it from, and the space your customers come back to, all sharing the same data."
        />
      </Reveal>
      <Reveal className="mt-10 grid gap-5 md:grid-cols-3">
        {PILLARS.map((p, i) => {
          const s = SURFACES[i];
          return (
            <div key={p.eyebrow} className="relative isolate flex min-h-[300px] flex-col overflow-hidden rounded-2xl p-6">
              <div
                aria-hidden
                className={`pointer-events-none absolute inset-0 -z-10 ${s.gradient ? "bg-gradient-to-br from-[var(--lv-chart-3)] via-[var(--lv-accent)] to-[var(--lv-chart-5)]" : ""}`}
                style={s.gradient ? { opacity: s.heaviness } : { backgroundColor: `color-mix(in srgb, var(--lv-accent) ${s.heaviness * 100}%, transparent)` }}
              />
              {s.lighten > 0 && (
                <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[var(--lv-lighten)]" style={{ opacity: s.lighten }} />
              )}
              <div className={s.onColour ? "text-white" : "text-[var(--lv-ink)]"}>
                <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${s.onColour ? "text-white/70" : "text-[var(--lv-ink-2)]"}`}>
                  {p.eyebrow}
                </span>
                <h3 className="mt-3 text-[22px] font-semibold leading-tight tracking-[-0.02em]">{p.title}</h3>
              </div>
              <ul className={`mt-auto divide-y pt-8 text-[13.5px] ${s.onColour ? "divide-white/20 text-white/90" : "divide-[color-mix(in_srgb,var(--lv-ink)_14%,transparent)] text-[var(--lv-ink)]"}`}>
                {p.points.map((pt) => (
                  <li key={pt} className="py-2.5">
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </Reveal>
    </section>
  );
}

/* ── Why leave the marketplace ────────────────────────────────────────── */

function Problem() {
  return (
    <section className={`${WRAP} py-14 sm:py-20`}>
      <Reveal>
        <SectionHead eyebrow="Why go direct" title="Marketplaces keep the customer. You keep the cars." />
      </Reveal>
      <Reveal className="mt-10 grid overflow-hidden rounded-2xl border border-[var(--lv-line)] bg-[var(--lv-paper)] md:grid-cols-3">
        {PROBLEM_POINTS.map((p, i) => (
          <div key={p.title} className={`p-6 ${i > 0 ? "border-t border-[var(--lv-line)] md:border-l md:border-t-0" : ""}`}>
            <span className="text-[12px] font-semibold tabular-nums text-[var(--lv-accent-ink)]">0{i + 1}</span>
            <h3 className="mt-4 text-[18px] font-semibold tracking-[-0.01em]">{p.title}</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--lv-ink-3)]">{p.description}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}

/* ── Launch ───────────────────────────────────────────────────────────── */

const STEPS = [
  { clock: "Day 0", title: "Kickoff call", text: "We align on your fleet, pricing, branding and growth goals." },
  { clock: "48h", title: "Portal access and your branded site", text: "Your dashboard is live and your booking website is ready for review." },
  { clock: "~1 wk", title: "Go live", text: "Payments, documents and verification are connected. Direct bookings start." },
  { clock: "Ongoing", title: "Scale support", text: "Platform updates, retention tools and optional paid demand to grow your direct channel." },
];

function Launch() {
  return (
    <section id="launch" className={`${WRAP} grid scroll-mt-20 gap-10 py-14 sm:py-20 lg:grid-cols-[1fr_1.2fr] lg:gap-16`}>
      <Reveal>
        <SectionHead
          eyebrow="How it works"
          title="Live in about a week."
          hint="No migration project. We set up your site, portal and payments with you, and you take your first direct booking within days."
        />
        <a href="/strategy-call" className={`${PILL_PRIMARY} mt-8`}>
          Book your kickoff call
          <ArrowRight className="size-4" aria-hidden />
        </a>
      </Reveal>
      <Reveal>
        <ol className="overflow-hidden rounded-2xl border border-[var(--lv-line)] bg-[var(--lv-paper)]">
          {STEPS.map((s, i) => (
            <li key={s.title} className={`flex items-start gap-4 px-6 py-5 ${i > 0 ? "border-t border-[var(--lv-line)]" : ""}`}>
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--lv-accent)]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tracking-[-0.01em]">{s.title}</span>
                <span className="mt-1 block text-[13px] leading-relaxed text-[var(--lv-ink-3)]">{s.text}</span>
              </span>
              <span className="w-[64px] shrink-0 text-right text-[12px] font-semibold tabular-nums text-[var(--lv-accent-ink)]">{s.clock}</span>
            </li>
          ))}
        </ol>
      </Reveal>
    </section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────── */

function Faq() {
  return (
    <section id="faq" className={`${WRAP} scroll-mt-20 py-14 sm:py-20`}>
      <Reveal>
        <SectionHead eyebrow="FAQ" title="Questions operators ask." center />
      </Reveal>
      <Reveal className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-2xl border border-[var(--lv-line)] bg-[var(--lv-paper)]">
        {FAQ_ITEMS.map((item, i) => (
          <details key={item.question} className={`group ${i > 0 ? "border-t border-[var(--lv-line)]" : ""}`}>
            <summary className="flex cursor-pointer list-none items-center gap-4 px-6 py-4 transition-colors duration-200 hover:bg-[var(--lv-row-hover)]">
              <span className="flex-1 text-[15px] font-medium">{item.question}</span>
              <Plus
                className="size-4 shrink-0 text-[var(--lv-ink-3)] transition-transform duration-200 ease-out group-open:rotate-45 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <p className="px-6 pb-5 text-[14px] leading-relaxed text-[var(--lv-ink-3)]">{item.answer}</p>
          </details>
        ))}
      </Reveal>
    </section>
  );
}

/* ── Closing call to action ───────────────────────────────────────────── */

function Closing() {
  return (
    <section className={`${WRAP} pb-24 pt-8`}>
      <Reveal className="relative isolate overflow-hidden rounded-[28px] px-6 py-14 text-center text-white sm:px-12 sm:py-20">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-[var(--lv-chart-3)] via-[var(--lv-accent)] to-[var(--lv-chart-5)]" />
        <h2 className="mx-auto max-w-2xl text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[44px]">
          Run the rental business you actually own.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/80">
          Book a call. We will look at how you take bookings today and hand you a 7-day launch plan.
        </p>
        <a
          href="/strategy-call"
          className="mt-9 inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[14px] font-semibold text-[hsl(248_68%_45%)] transition-opacity duration-200 ease-out hover:opacity-90 motion-reduce:transition-none"
        >
          Get your 7-day launch plan
          <ArrowRight className="size-4" aria-hidden />
        </a>
      </Reveal>
    </section>
  );
}

export function LandingV2Draft({
  plans,
  offer,
}: {
  plans: readonly SignupPlan[] | null;
  offer: PromoOffer | null;
}) {
  return (
    <div className={`lv2 ${manrope.variable}`}>
      <HeaderV2 showPricing={!!plans} />
      <main id="main">
        {offer && <ReferralBanner offer={offer} />}
        <Hero showPricing={!!plans} />
        <TraxShowcase />
        <Product />
        <Pillars />
        <Problem />
        <Launch />
        {plans && <PricingSection plans={plans} offer={offer} />}
        <Faq />
        <Closing />
      </main>
      <FooterV2 />
    </div>
  );
}
