"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOptionalOnboarding } from "@/components/onboarding/onboarding-provider";
import { formatPlanPriceUsd, type SignupPlan, type SignupPlanId } from "@/lib/plans";
import type { EnterpriseCard as EnterpriseCardData } from "@/lib/enterprise-card-server";
import { discountedPrice, type PromoOffer } from "@/lib/promo-offer";
import { DepotArt, DrivewayArt, HeadquartersArt, LotArt } from "./plan-art";
import "./pricing-breakdown.css";

/*
 * Pricing (Ghulam, 2026-11-10): four long cards side by side in one container,
 * one per plan. On top of each: its drawing, a name for the size of business it is for, the
 * price and the button. Under that, the breakdown, the same lines in the same order in every
 * card, so reading across compares the plans. Hovering a line lights it in all four.
 * The drawing, name, price and button of each card stay pinned to the top of the screen while its
 * breakdown scrolls, so the price is always in view next to the line being compared.
 *
 * Add-ons are priced by use. Their live prices are credits today and the monthly add-on
 * prices are not agreed, so no figure is quoted here.
 */

/* What a business of each size is called, smallest first. Enterprise is always the last. */
const LOOKS = [
  { nick: "The Driveway", art: DrivewayArt },
  { nick: "The Lot", art: LotArt },
  { nick: "The Depot", art: DepotArt },
] as const;
const ENTERPRISE_LOOK = { nick: "The Headquarters", art: HeadquartersArt };

type Val = { text: string; quiet?: boolean } | "yes" | "addon";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const says = (bullets: readonly string[], words: string) => bullets.some((b) => b.toLowerCase().includes(words));

/*
 * Where the plans differ they say so in their own bullets (signup_plans and the Enterprise
 * card, both edited by a super admin). These lines read those bullets, so the breakdown and
 * the plans can never disagree.
 */
/*
 * `phone`: one of the five lines a phone shows (boss, 2026-11-12: "reduce to five, no long
 * scrolling"). The rest are hidden on phones only; desktop compares every line.
 */
const ROWS: { label: string; phone?: true; plan(p: SignupPlan): Val; enterprise(c: EnterpriseCardData): Val }[] = [
  {
    label: "Per car, at a full fleet",
    phone: true,
    plan: (p) => (p.maxVehicles > 0 ? { text: `${money(p.priceUsd / p.maxVehicles)} a month` } : { text: "By fleet" }),
    enterprise: () => ({ text: "Custom" }),
  },
  {
    label: "Support",
    phone: true,
    plan: (p) => ({ text: says(p.bullets, "priority") ? "Priority" : "Standard" }),
    enterprise: (c) => ({ text: says(c.bullets, "named") ? "Named contact" : "Dedicated" }),
  },
  {
    label: "Onboarding",
    phone: true,
    plan: (p) => ({ text: says(p.bullets, "onboarding") ? "30 minutes, free" : "Included" }),
    enterprise: (c) => ({ text: says(c.bullets, "migration") ? "With data migration" : "Assisted" }),
  },
  {
    label: "Slack channel with us",
    plan: (p) => {
      const line = p.bullets.find((b) => b.toLowerCase().includes("slack"));
      if (!line) return { text: "Not offered", quiet: true };
      if (line.toLowerCase().includes("included")) return { text: "Included" };
      const price = line.match(/\$\d+/)?.[0];
      return { text: price ? `${price} a month` : "On request" };
    },
    enterprise: (c) => ({ text: says(c.bullets, "slack") ? "Included" : "On request" }),
  },
  { label: "Booking site on your own domain", phone: true, plan: () => "yes", enterprise: () => "yes" },
  { label: "Rentals, fleet and calendar", plan: () => "yes", enterprise: () => "yes" },
  { label: "Renter portal and records", plan: () => "yes", enterprise: () => "yes" },
  { label: "Payments into your own account", phone: true, plan: () => ({ text: "0% commission" }), enterprise: () => ({ text: "0% commission" }) },
  { label: "Insights, finances and Trax", plan: () => "yes", enterprise: () => "yes" },
  { label: "ID checks, e-sign and texts", plan: () => "addon", enterprise: () => "addon" },
  { label: "Staff logins and bookings", plan: () => ({ text: "Unlimited" }), enterprise: () => ({ text: "Unlimited" }) },
];

/** "$79", "$79.20". */
const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

function Value({ val }: { val: Val }) {
  if (val === "yes") return <Check aria-label="Included" />;
  if (val === "addon") return <i className="pb-chip">Add-on</i>;
  return <b className={val.quiet ? "is-quiet" : undefined}>{val.text}</b>;
}

/* The lines of one card. `hot` is the line the visitor is on, lit in every card at once. */
function Rows({ values, hot, onHot }: { values: Val[]; hot: number | null; onHot(i: number | null): void }) {
  return (
    <>
      {ROWS.map((row, i) => (
        <div key={row.label} className={`pb-row${hot === i ? " is-hot" : ""}`} data-phone={row.phone || undefined} onMouseEnter={() => onHot(i)} onMouseLeave={() => onHot(null)}>
          <span>{row.label}</span>
          <Value val={values[i]} />
        </div>
      ))}
    </>
  );
}

function Head({ look, name, band, tagline, tag, children }: { look: { nick: string; art: () => ReactNode }; name: string; band: string; tagline: string; tag?: boolean; children: ReactNode }) {
  return (
    <>
      {/* Stays at the top of the screen while the breakdown scrolls under it, like a sheet's frozen header. */}
      <div className="pb-stick">
        {tag && <span className="pb-tag">Most popular</span>}
        {/* No drawings on the cards (Ghulam, 2026-11-10): the big numbers carry them. look.art stays in plan-art.tsx. */}
        <p className="pb-nick">{look.nick}</p>
        <p className="pb-plan">
          {name}
          {band && <span> · {band}</span>}
        </p>
        {children}
      </div>
      {/* The one part of the top that scrolls away, so the pinned part stays short. */}
      <p className="pb-tagline">{tagline}</p>
    </>
  );
}

export function PricingBreakdown({
  plans,
  enterprise = null,
  offer = null,
  onSelect,
  showTrial = true,
}: {
  plans: readonly SignupPlan[];
  enterprise?: EnterpriseCardData | null;
  offer?: PromoOffer | null;
  onSelect?(planId: SignupPlanId): void;
  showTrial?: boolean;
}) {
  const [hot, setHot] = useState<number | null>(null);
  // `open()` never throws: every failure shows inside the signup dialog itself.
  const onboarding = useOptionalOnboarding();
  if (!onSelect && !onboarding) {
    throw new Error("<PricingBreakdown> needs either an onSelect handler or <OnboardingProvider>");
  }
  const press = (id: SignupPlanId) => (onSelect ? onSelect(id) : onboarding?.open(id));
  const cols = plans.length + (enterprise ? 1 : 0);

  /*
   * Phones: the cards sit side by side in a swipe (pricing-breakdown.css), with a row of plan
   * names above them. The name of the card in view is lit; pressing a name brings its card in.
   * On wider screens the switcher is hidden and the grid never scrolls, so none of this runs.
   */
  const gridRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(0);
  const names = [...plans.map((p, i) => ({ id: p.id, nick: LOOKS[Math.min(i, LOOKS.length - 1)].nick, price: offer ? usd(discountedPrice(p.priceUsd, offer)) : formatPlanPriceUsd(p) })), ...(enterprise ? [{ id: "enterprise", nick: ENTERPRISE_LOOK.nick, price: enterprise.priceLabel }] : [])];
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const cards = [...grid.children] as HTMLElement[];
      if (cards.length < 2 || grid.scrollWidth <= grid.clientWidth) return;
      const left = grid.scrollLeft;
      let best = 0;
      cards.forEach((card, i) => {
        if (Math.abs(card.offsetLeft - grid.offsetLeft - left) < Math.abs(cards[best].offsetLeft - grid.offsetLeft - left)) best = i;
      });
      setInView(best);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    grid.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      grid.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  const bringIn = (i: number) => {
    const grid = gridRef.current;
    const card = grid?.children[i] as HTMLElement | undefined;
    if (!grid || !card) return;
    const pad = parseFloat(getComputedStyle(grid).scrollPaddingLeft) || 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    grid.scrollTo({ left: card.offsetLeft - grid.offsetLeft - pad, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className="pb">
      {cols > 1 && (
        <div className="pb-switch" aria-label="Plans">
          {names.map((n, i) => (
            <button key={n.id} type="button" aria-current={i === inView || undefined} onClick={() => bringIn(i)}>
              <b>{n.nick.replace(/^The /, "")}</b>
              <span>{n.price}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={gridRef} className="pb-grid" style={{ "--pb-cols": cols, "--pb-rows": ROWS.length } as CSSProperties}>
        {plans.map((p, i) => {
          const trialDays = p.trialDays ?? 0;
          return (
            <article key={p.id} className={`pb-col${p.highlighted ? " is-hi" : ""}`}>
              <Head look={LOOKS[Math.min(i, LOOKS.length - 1)]} name={p.name} band={p.fleetBand} tagline={p.tagline} tag={p.highlighted}>
                <p className="pb-price">
                  {offer && (
                    <s aria-label={`was ${formatPlanPriceUsd(p)}`}>{formatPlanPriceUsd(p)}</s>
                  )}
                  <strong>{offer ? usd(discountedPrice(p.priceUsd, offer)) : formatPlanPriceUsd(p)}</strong>
                  <span>/month</span>
                </p>
                {offer && (
                  <p className="pb-note">
                    {offer.discountText} {offer.durationText}
                  </p>
                )}
                {/* Said once above the cards when every plan has the same trial. */}
                {showTrial && trialDays > 0 && <p className="pb-note">{trialDays}-day free trial, card required</p>}
                <Button
                  size="lg"
                  onClick={() => press(p.id)}
                  // Several buttons with one label are ambiguous out of context, so the name carries the plan and price.
                  aria-label={
                    trialDays > 0
                      ? `Start a ${trialDays}-day free trial of ${p.name}, then ${formatPlanPriceUsd(p)} per month`
                      : `Subscribe to ${p.name}, ${formatPlanPriceUsd(p)} per month`
                  }
                  className="pb-btn"
                >
                  {trialDays > 0 ? "Start free trial" : "Subscribe"}
                </Button>
              </Head>
              <Rows values={ROWS.map((r) => r.plan(p))} hot={hot} onHot={setHot} />
            </article>
          );
        })}

        {enterprise && (
          <article className="pb-col">
            <Head look={ENTERPRISE_LOOK} name={enterprise.name} band={enterprise.fleetBand} tagline={enterprise.tagline}>
              <p className="pb-price">
                <strong>{enterprise.priceLabel}</strong>
              </p>
              {/* Holds the trial line's room, so this button lines up with the plans' buttons. */}
              {showTrial && (
                <p className="pb-note" aria-hidden style={{ visibility: "hidden" }}>
                  &nbsp;
                </p>
              )}
              <Button asChild size="lg" className="pb-btn">
                <a href={enterprise.ctaHref}>{enterprise.ctaLabel}</a>
              </Button>
            </Head>
            <Rows values={ROWS.map((r) => r.enterprise(enterprise))} hot={hot} onHot={setHot} />
          </article>
        )}
      </div>

      <p className="pb-foot">No setup fee and no contract. Add-ons are priced by use, so you pay for them only when you use them.</p>
    </div>
  );
}
