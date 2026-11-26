// feat-001 spec 08.13: the REAL ensureCodeCoupon (_shared/platform-promo.ts),
// run in Deno against a fake Stripe and a fake Supabase, so the coupon a BF30
// signup would get on Stripe is checked without any network or key.
//
// Run from the repo root:
//   deno test -A --no-check supabase/functions/_tests/signup-promo-coupon_test.ts
// deno-lint-ignore-file no-explicit-any
import { ensureCodeCoupon, type PromoCodeRow } from "../_shared/platform-promo.ts";

function assertEquals(actual: unknown, expected: unknown, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** A Supabase stand-in: no coupon minted yet; records what is inserted. */
function fakeSupabase() {
  const inserted: any[] = [];
  const query: any = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: async (row: any) => { inserted.push(row); return { error: null }; },
  };
  return { client: { from: () => query } as any, inserted };
}

/** A Stripe stand-in that records every coupon it is asked to create. */
function fakeStripe() {
  const created: Array<{ params: any; idempotencyKey: string }> = [];
  return {
    client: {
      coupons: {
        create: async (params: any, opts: any) => {
          created.push({ params, idempotencyKey: opts?.idempotencyKey });
          return { id: `coupon_${created.length}` };
        },
      },
    } as any,
    created,
  };
}

const BF30: PromoCodeRow = {
  id: "11111111-1111-1111-1111-111111111111",
  code: "BF30",
  kind: "campaign",
  discount_type: "percent",
  discount_value: 30,
  duration: "repeating",
  duration_months: 3,
  currency: "usd",
  owner_tenant_id: null,
} as unknown as PromoCodeRow;

async function couponFor(code: PromoCodeRow, trialDays: number, signupISO: string) {
  const sb = fakeSupabase();
  const st = fakeStripe();
  const out = await ensureCodeCoupon(sb.client, st.client, code, {
    account: "uae", mode: "test", productId: "prod_growth", trialDays, signupISO,
  });
  return { out, params: st.created[0]?.params, key: st.created[0]?.idempotencyKey, row: sb.inserted[0] };
}

// Hand-worked in spec 08 (rows 5, 9, 13, 16): months from SIGNUP the coupon
// must run so exactly 3 PAID bills are discounted.
const CASES: Array<[string, number, string, number, string]> = [
  // [why, trialDays, signup, expected duration_in_months, expected variant]
  ["today's plans: 14-day trial (row 5)", 14, "2026-11-26", 3, "deferred_0m"],
  ["30-day trial (row 9)", 30, "2026-11-26", 4, "deferred_1m"],
  ["60-day trial: the old rule gave 5 = 4 discounted bills (row 13)", 60, "2026-11-26", 4, "deferred_1m"],
  ["90-day trial, the most allowed (row 16)", 90, "2026-11-26", 5, "deferred_2m"],
];

for (const [why, trial, signup, months, variant] of CASES) {
  Deno.test(`08.13 BF30 coupon, ${why}`, async () => {
    const { out, params, key, row } = await couponFor(BF30, trial, signup);
    assertEquals(params.percent_off, 30, "percent_off");
    assertEquals(params.duration, "repeating", "duration");
    assertEquals(params.duration_in_months, months, "duration_in_months");
    assertEquals(params.applies_to, { products: ["prod_growth"] }, "only the plan's product");
    assertEquals(out.variant, variant, "variant");
    assertEquals(params.metadata.d247_variant, variant, "variant on the coupon");
    assertEquals(row.variant, variant, "variant recorded in platform_promo_code_stripe");
    if (!key.includes(variant)) throw new Error(`idempotency key ${key} does not name the variant`);
  });
}

Deno.test("08.13 BF30 coupon, no trial: 3 months, the standard coupon", async () => {
  const { out, params } = await couponFor(BF30, 0, "2026-11-26");
  assertEquals([params.duration, params.duration_in_months, out.variant], ["repeating", 3, "standard"], "coupon");
});

Deno.test("08.13 a 'once' code with a 14-day trial lands on the first paid bill only", async () => {
  const once = { ...BF30, code: "HALFOFF", duration: "once", duration_months: null, discount_value: 50 } as unknown as PromoCodeRow;
  const { out, params } = await couponFor(once, 14, "2026-11-26");
  assertEquals([params.duration, params.duration_in_months, out.variant], ["repeating", 1, "deferred_0m"], "coupon");
});

Deno.test("08.13 a 'forever' code is never stretched", async () => {
  const forever = { ...BF30, code: "FOREVER10", duration: "forever", duration_months: null, discount_value: 10 } as unknown as PromoCodeRow;
  const { out, params } = await couponFor(forever, 14, "2026-11-26");
  assertEquals([params.duration, params.duration_in_months, out.variant], ["forever", undefined, "standard"], "coupon");
});

Deno.test("08.15 a fixed code becomes amount_off in cents", async () => {
  const fixed = { ...BF30, code: "FLAT50", discount_type: "fixed", discount_value: 50, duration: "once", duration_months: null } as unknown as PromoCodeRow;
  const { params } = await couponFor(fixed, 0, "2026-11-26");
  assertEquals([params.amount_off, params.currency, params.percent_off], [5000, "usd", undefined], "amount_off");
});
