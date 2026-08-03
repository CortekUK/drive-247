// Reads the live plan catalogue out of `public.signup_plans`.
//
// SERVER ONLY by convention — call it from a Server Component (today: the
// marketing page) and pass the result down. It is not secret (the anon key ships
// in the client bundle anyway); the rule exists so there is exactly ONE read per
// render and the card, the dialog header and the order summary can never quote
// three different prices for the same plan.
//
// Two hard rules, both from the fact that this sits on the highest-intent
// section of the marketing site:
//
//   1. **It never throws.** The page is statically prerendered, so a throw here
//      is a failed `next build`, i.e. a Supabase outage taking down the marketing
//      site. Every failure path returns the hardcoded `SIGNUP_PLANS` instead.
//   2. **It never returns empty.** No rows, all rows unusable, no env pair — all
//      of them fall back to the hardcoded catalogue. An empty pricing grid is
//      worse than a stale one.
//
// Freshness comes from ISR: the page declares `revalidate`, and this fetch is
// tagged with the same window, so a super admin's edit appears within ~a minute
// without a deploy.

import {
  isSignupPlanId,
  reportPlanCatalogueProblems,
  SIGNUP_PLANS,
  type SignupPlan,
} from "@/lib/plans";

/**
 * How long a fetched catalogue may be served before it is re-read. Must match
 * `revalidate` on the page that calls this — a shorter page window would just
 * re-serve this cached body, and a shorter fetch window would be invisible
 * because nothing would re-render.
 */
export const PLANS_REVALIDATE_SECONDS = 60;

/**
 * A hung Supabase must not hold `next build` open indefinitely. Generous enough
 * that a cold edge region still answers; short enough that a dead one costs a
 * few seconds and then serves the fallback.
 */
const FETCH_TIMEOUT_MS = 5000;

/**
 * Explicit columns rather than `*`: the row is rendered on a public page, and a
 * column added later (an internal note, a Stripe id) should not start crossing
 * the wire because nobody revisited this query.
 */
const PLAN_COLUMNS = [
  "plan_key",
  "name",
  "tagline",
  "fleet_band",
  "max_vehicles",
  "amount_cents",
  "currency",
  "interval",
  "bullets",
  "is_highlighted",
  "sort_order",
].join(",");

// ---------------------------------------------------------------------------
// Row -> SignupPlan
// ---------------------------------------------------------------------------

/** `unknown` in, narrow types out — nothing here trusts the shape of the JSON. */
function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function readNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(row: Record<string, unknown>, key: string): string[] | null {
  const value = row[key];
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * One DB row as the shape every consumer is already written against, or null
 * when the row cannot be rendered honestly.
 *
 * Dropping is reserved for rows that would either lie about money or break the
 * `SignupPlanId` contract. Everything softer (an odd fleet band, a second
 * "most popular") survives and is reported by `reportPlanCatalogueProblems`.
 */
function toSignupPlan(raw: unknown): SignupPlan | null {
  if (typeof raw !== "object" || raw === null) {
    console.error("[plans] signup_plans returned a non-object row; skipping it.");
    return null;
  }
  const row = raw as Record<string, unknown>;

  const planKey = readString(row, "plan_key");
  // `SignupPlanId` is a literal union threaded through OnboardingState, the step
  // props and `signup-payment-intent`. Widening it to `string` to accommodate a
  // row would cascade through the whole dialog and let an id the edge functions
  // cannot price reach a checkout, so an unknown key is dropped here instead.
  if (!isSignupPlanId(planKey)) {
    console.error(
      `[plans] signup_plans row has unknown plan_key ${JSON.stringify(planKey)}; ` +
        `skipping it. Known ids are resolved server-side by ` +
        `supabase/functions/_shared/signup-plans.ts and cannot be added from the DB alone.`
    );
    return null;
  }

  const amountCents = readNumber(row, "amount_cents");
  if (amountCents === null || !Number.isInteger(amountCents) || amountCents <= 0) {
    console.error(
      `[plans] signup_plans row "${planKey}" has an unusable amount_cents ` +
        `(${JSON.stringify(row.amount_cents)}); skipping it rather than quoting a price.`
    );
    return null;
  }

  // `currency` and `interval` are literal types on SignupPlan because the whole
  // marketing surface ("/month", "$") is written for exactly one pair. A row
  // carrying anything else would render as dollars-per-month regardless, which
  // is the one failure mode worth refusing outright.
  const currency = readString(row, "currency")?.toLowerCase() ?? null;
  const interval = readString(row, "interval")?.toLowerCase() ?? null;
  if (currency !== "usd" || interval !== "month") {
    console.error(
      `[plans] signup_plans row "${planKey}" is ${currency}/${interval}; the pricing ` +
        `page only renders usd/month, so it is skipped.`
    );
    return null;
  }

  const fallback = SIGNUP_PLANS.find((p) => p.id === planKey);

  return {
    id: planKey,
    // Copy fields fall back per-field, not per-row: a blank tagline is a gap in
    // the card, not a reason to hide a plan the admin has published.
    name: readString(row, "name")?.trim() || (fallback?.name ?? planKey),
    priceUsd: amountCents / 100,
    amountCents,
    currency: "usd",
    interval: "month",
    fleetBand: readString(row, "fleet_band")?.trim() || (fallback?.fleetBand ?? ""),
    // `maxVehicles` gates the business step AFTER the card is charged. A missing
    // one must not become 0 — that would refuse every fleet — so the hardcoded
    // cap stands in.
    maxVehicles:
      readNumber(row, "max_vehicles") ?? fallback?.maxVehicles ?? 0,
    tagline: readString(row, "tagline")?.trim() || (fallback?.tagline ?? ""),
    bullets: readStringArray(row, "bullets") ?? [...(fallback?.bullets ?? [])],
    highlighted: row.is_highlighted === true,
  };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * The visible plans, newest published copy first-hand — or the hardcoded
 * catalogue when anything at all goes wrong. Never throws, never returns empty.
 *
 * RLS already restricts anon to `is_visible = true`; the filter is sent anyway
 * so the intent is readable at the call site and the query keeps working if the
 * policy is ever relaxed for another reader.
 */
export async function fetchSignupPlans(): Promise<readonly SignupPlan[]> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!baseUrl || !anonKey) {
    console.error(
      "[plans] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set — " +
        "serving the hardcoded plan catalogue. Admin edits will not appear."
    );
    return SIGNUP_PLANS;
  }

  const endpoint =
    `${baseUrl.replace(/\/$/, "")}/rest/v1/signup_plans` +
    `?select=${PLAN_COLUMNS}&is_visible=eq.true&order=sort_order.asc`;

  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // Tagged, not `no-store`: the page is prerendered and this is public data.
      next: { revalidate: PLANS_REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      // The body carries PostgREST's reason (missing table, RLS refusal), which
      // is the difference between "not migrated yet" and "policy is wrong".
      const detail = await res.text().catch(() => "");
      console.error(
        `[plans] signup_plans read failed (HTTP ${res.status}) — serving the hardcoded ` +
          `catalogue. ${detail.slice(0, 500)}`
      );
      return SIGNUP_PLANS;
    }

    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      console.error(
        "[plans] signup_plans returned a non-array body — serving the hardcoded catalogue."
      );
      return SIGNUP_PLANS;
    }

    const plans = body
      .map(toSignupPlan)
      .filter((plan): plan is SignupPlan => plan !== null);

    if (plans.length === 0) {
      // Either the table is empty, every row was hidden, or every row was
      // unusable. All three read the same to a visitor: no plans to buy.
      console.error(
        `[plans] signup_plans returned ${body.length} row(s) but none were usable — ` +
          "serving the hardcoded catalogue."
      );
      return SIGNUP_PLANS;
    }

    // Runs in production too: these rows are edited without a deploy, so a dev
    // console would never see the mistake. See the function's own comment.
    reportPlanCatalogueProblems(plans, "signup_plans");
    return plans;
  } catch (error) {
    // Includes the AbortSignal timeout and any DNS/TLS failure. Static render
    // must survive all of it.
    console.error(
      "[plans] signup_plans read threw — serving the hardcoded catalogue.",
      error
    );
    return SIGNUP_PLANS;
  }
}
