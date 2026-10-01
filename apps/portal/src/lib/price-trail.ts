import type { ReferralsData } from "@/hooks/use-referrals";
import { INTEGRATION_KEYS } from "@/lib/integration-billing/catalog";

/**
 * How a tenant got to what they pay: the one calculation behind both v2
 * Billing's big number (when Stripe hasn't given us the invoice) and the
 * "Price breakdown" timeline, so the two can't disagree.
 *
 * Sources, each its own kind of step:
 *   base         the plan everyone starts on
 *   promo        a Drive247 promo code they joined with
 *   referred     a referral code they joined with (another operator's)
 *   integration  a premium integration they added: + its monthly price
 *   reward       a referral they made that moved them up a reward level
 *   retention    the "stay" offer they accepted while cancelling
 *   ended        a time-limited discount that has run out
 *
 * Percent discounts are taken off the PLAN price (integrations are charged in
 * full), each on its own — the same way the figures have always been worked
 * out here. Stripe's invoice, when we have it, is the exact amount.
 */

export type TrailKind = "base" | "promo" | "referred" | "integration" | "reward" | "retention" | "ended";

export interface TrailStep {
  key: string;
  kind: TrailKind;
  title: string;
  detail?: string | null;
  date?: string | null;
  /** The monthly price after this step. Null when it can't be worked out. */
  price: number | null;
  /** Change from the step before (negative = cheaper). */
  change?: number | null;
  /** A step that moved nothing (e.g. a referral that no longer counts). */
  muted?: boolean;
}

export interface PremiumIntegration {
  key: string;
  monthlyCents: number;
  since: string | null;
}

export interface RetentionOffer {
  percent: number;
  bills: number;
  acceptedAt: string;
}

/** "10% off every bill" → 10%; "$20 off" → 2000c. Null when neither reads. */
export function readDiscount(text: string | null | undefined): { percent: number } | { cents: number } | null {
  if (!text) return null;
  const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return { percent: Number(pct[1]) };
  const amt = text.match(/[$£€]\s?([\d,]+(?:\.\d+)?)/);
  if (amt) return { cents: Math.round(Number(amt[1].replace(/,/g, "")) * 100) };
  return null;
}

/** Minor units off `base`, as a negative number, or null when unreadable. */
export function discountCents(text: string | null | undefined, base: number): number | null {
  const d = readDiscount(text);
  if (!d) return null;
  const off = "percent" in d ? Math.round((base * d.percent) / 100) : d.cents;
  return -Math.min(off, base);
}

const integrationName = (key: string) =>
  INTEGRATION_KEYS.find((i) => i.key === key)?.name ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function rewardFor(n: number, tiers: ReferralsData["standing"]["tiers"]): string | null {
  let hit: string | null = null;
  for (const t of [...tiers].sort((a, b) => a.min - b.min)) if (n >= t.min) hit = t.reward;
  return hit;
}

const MONTH = 30 * 86_400_000;

export function buildPriceTrail(
  base: number,
  referrals: ReferralsData | undefined,
  integrations: PremiumIntegration[],
  retention: RetentionOffer | null,
  now: number = Date.now(),
): { steps: TrailStep[]; todayCents: number; estimated: boolean } {
  const steps: TrailStep[] = [{ key: "base", kind: "base", title: "Base plan", detail: "What every operator starts on", price: base }];

  // The state the price is worked out from, changed by each event in turn.
  let extras = 0; // premium integrations, in full
  let joinedOff = 0; // the code they joined with, while it runs
  let rewardOff = 0; // their referral level
  let retentionOff = 0; // the stay offer, while it runs
  let readable = true;
  const priceNow = () => Math.max(0, base + joinedOff + rewardOff + retentionOff) + extras;

  type Ev = { at: number; apply: () => Omit<TrailStep, "price" | "change"> };
  const events: Ev[] = [];

  // The code they joined with: an operator's referral code, or a promo code.
  const joined = referrals?.enabled ? referrals.joinedWith : null;
  if (joined) {
    const off = discountCents(joined.discountText, base);
    if (off === null) readable = false;
    const viaReferral = !!joined.referrerName;
    events.push({
      at: -Infinity, // they joined with it, right after the base plan
      apply: () => {
        joinedOff = off ?? 0;
        return {
          key: "joined",
          kind: viaReferral ? "referred" : "promo",
          title: viaReferral ? `Joined with ${joined.referrerName}'s referral code` : `Promo code ${joined.code ?? ""}`.trim(),
          detail: `${joined.discountText} ${joined.durationText}`.trim(),
        };
      },
    });
    if (!joined.active && joined.endsAt) {
      events.push({
        at: new Date(joined.endsAt).getTime(),
        apply: () => {
          joinedOff = 0;
          return {
            key: "joined-ended",
            kind: "ended",
            title: viaReferral ? "Referral discount ended" : "Promo discount ended",
            detail: `${joined.discountText} ${joined.durationText}`.trim(),
            date: joined.endsAt,
          };
        },
      });
    }
  }

  // Premium integrations: each adds its monthly price.
  for (const it of integrations) {
    events.push({
      at: it.since ? new Date(it.since).getTime() : now,
      apply: () => {
        extras += it.monthlyCents;
        return {
          key: `int-${it.key}`,
          kind: "integration",
          title: `${integrationName(it.key)} added`,
          detail: "Premium integration",
          date: it.since,
        };
      },
    });
  }

  // Referrals they made: each that still counts can move them up a level.
  if (referrals?.enabled) {
    let counting = 0;
    for (const r of [...referrals.referrals].sort((a, b) => a.since.localeCompare(b.since))) {
      const at = new Date(r.since).getTime();
      if (r.counts) {
        counting += 1;
        const n = counting;
        events.push({
          at,
          apply: () => {
            const reward = rewardFor(n, referrals.standing.tiers);
            const off = reward ? discountCents(reward, base) : 0;
            if (off === null) readable = false;
            rewardOff = off ?? rewardOff;
            return {
              key: `ref-${r.id}`,
              kind: "reward",
              title: `Referred ${r.name}`,
              detail: reward ? `${n} subscribed referral${n === 1 ? "" : "s"} · ${reward}` : `${n} subscribed referral${n === 1 ? "" : "s"}`,
              date: r.since,
            };
          },
        });
      } else {
        events.push({
          at,
          apply: () => ({
            key: `ref-${r.id}`,
            kind: "reward",
            title: `Referred ${r.name}`,
            detail: "No longer subscribed, so it doesn't count",
            date: r.since,
            muted: true,
          }),
        });
      }
    }
  }

  // The stay offer, from the cancel flow.
  if (retention) {
    const at = new Date(retention.acceptedAt).getTime();
    const ends = at + retention.bills * MONTH;
    events.push({
      at,
      apply: () => {
        retentionOff = -Math.round((base * retention.percent) / 100);
        return {
          key: "retention",
          kind: "retention",
          title: "Loyalty discount",
          detail: `${retention.percent}% off ${retention.bills} bills — just for you, when you told us the price was too high`,
          date: retention.acceptedAt,
        };
      },
    });
    if (ends <= now) {
      events.push({
        at: ends,
        apply: () => {
          retentionOff = 0;
          return { key: "retention-ended", kind: "ended", title: "Loyalty discount ended", detail: `${retention.percent}% off ${retention.bills} bills`, date: new Date(ends).toISOString() };
        },
      });
    }
  }

  let prev = base;
  for (const e of events.sort((a, b) => a.at - b.at)) {
    const step = e.apply();
    const price = step.muted ? null : priceNow();
    steps.push({ ...step, price, change: price === null ? null : price - prev });
    if (price !== null) prev = price;
  }

  return { steps, todayCents: priceNow(), estimated: readable };
}
