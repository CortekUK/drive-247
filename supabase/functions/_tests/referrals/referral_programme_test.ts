// Referral programme, end to end: the REAL edge functions (lookup, payment
// link v2, engine, portal, admin, discount v2, signup v2) against a real
// Postgres with the real migrations, and a strict Stripe emulator. No keys,
// no network beyond module downloads, nothing deployed.
//
// Run from the repo root:
//   deno test -A --no-check --config supabase/functions/_tests/referrals/deno.json supabase/functions/_tests/referrals/
//
// (--no-check because an existing shared helper, _shared/resend-service.ts,
// has a type error of its own that is not this feature's to fix.)
// deno-lint-ignore-file no-explicit-any
import {
  addAuthUser, call, emails, q, restLog, SERVICE_KEY, settleBackground, stripe, UAE_TEST,
} from "./world.ts";

// ── checks that report every failure in a step, not just the first ─────────
let stepFailures: string[] = [];
function check(cond: unknown, what: string, detail?: unknown) {
  if (!cond) stepFailures.push(`${what}${detail === undefined ? "" : `\n    got: ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}
const eq = (actual: unknown, expected: unknown, what: string) =>
  check(JSON.stringify(actual) === JSON.stringify(expected), `${what} (expected ${JSON.stringify(expected)})`, actual);

type Step = (name: string, fn: () => Promise<void>) => Promise<void>;
function stepper(t: Deno.TestContext): Step {
  return async (name, fn) => {
    await t.step(name, async () => {
      stepFailures = [];
      const restMark = restLog.length;
      await fn();
      await settleBackground();
      if (stepFailures.length) {
        const rest = restLog.slice(restMark).filter(r => r.status >= 400).slice(0, 5);
        throw new Error(stepFailures.join("\n") + (rest.length ? `\n  REST errors: ${JSON.stringify(rest)}` : ""));
      }
    });
  };
}

const uae = () => stripe.acct(UAE_TEST);
const subOf = (id: string) => uae().subscriptions.get(id)!;
const discountCoupons = (subId: string) => (subOf(subId).discounts as string[]).map(d => uae().discounts.get(d)!.coupon.id);

// ── fixtures ─────────────────────────────────────────────────────────────
const AU = { sa: crypto.randomUUID(), sales: crypto.randomUUID(), opA: crypto.randomUUID(), opC: crypto.randomUUID(), newop: crypto.randomUUID() };
const TOK = { sa: "tok-super-admin", sales: "tok-sales", opA: "tok-op-a", opC: "tok-op-c", newop: "tok-new-op" };
addAuthUser(TOK.sa, { id: AU.sa, email: "sa@drive247.test", app_metadata: {}, user_metadata: {} });
addAuthUser(TOK.sales, { id: AU.sales, email: "sales@drive247.test", app_metadata: {}, user_metadata: {} });
addAuthUser(TOK.opA, { id: AU.opA, email: "owner@northwind.test", app_metadata: {}, user_metadata: {} });
addAuthUser(TOK.opC, { id: AU.opC, email: "owner@keyway.test", app_metadata: {}, user_metadata: {} });
const nowIso = new Date().toISOString();
addAuthUser(TOK.newop, {
  id: AU.newop, email: "new@operator.test", user_metadata: {},
  app_metadata: { d247_signup: { v: 1, status: "account_created", planId: "growth", fullName: "New Operator", email: "new@operator.test", mode: "test", createdAt: nowIso, updatedAt: nowIso } },
});

async function tenant(slug: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const cols = { slug, company_name: name, status: "active", tenant_type: "production", contact_email: `owner@${slug}.test`, subscription_stripe_mode: "test", subscription_account: "uae", ...extra };
  const keys = Object.keys(cols);
  const rows = await q(`INSERT INTO tenants (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, Object.values(cols));
  return rows[0].id;
}
async function liveSub(tenantId: string, subId: string, customer: string, status = "active") {
  const rows = await q(`INSERT INTO tenant_subscriptions (tenant_id, stripe_subscription_id, stripe_customer_id, status, stripe_account, current_period_end, amount, currency)
    VALUES ($1,$2,$3,$4,'uae', now() + interval '20 days', 19900, 'usd') RETURNING id`, [tenantId, subId, customer, status]);
  return rows[0].id as string;
}

const A = await tenant("northwind", "Northwind Rentals", { tenant_type: "test" });
const B = await tenant("sunset", "Sunset Rentals");
const C = await tenant("keyway", "Keyway");
const F = await tenant("fleetco", "Fleetco");

await q(`INSERT INTO app_users (auth_user_id, email, role, is_super_admin, is_active) VALUES ($1,'sa@drive247.test','super_admin',true,true)`, [AU.sa]);
await q(`INSERT INTO app_users (auth_user_id, email, role, is_sales_agent, is_active) VALUES ($1,'sales@drive247.test','sales',true,true)`, [AU.sales]);
await q(`INSERT INTO app_users (auth_user_id, email, role, tenant_id, is_active) VALUES ($1,'owner@northwind.test','head_admin',$2,true)`, [AU.opA, A]);
await q(`INSERT INTO app_users (auth_user_id, email, role, tenant_id, is_active) VALUES ($1,'owner@keyway.test','head_admin',$2,true)`, [AU.opC, C]);

// Stripe: A and C are long-standing subscribers on the UAE account.
const pA = stripe.seedProductPrice(UAE_TEST, { amount: 19900, name: "Northwind plan" });
const pC = stripe.seedProductPrice(UAE_TEST, { amount: 9900, name: "Keyway plan" });
const pB = stripe.seedProductPrice(UAE_TEST, { amount: 14900, name: "Sunset plan" });
const pF = stripe.seedProductPrice(UAE_TEST, { amount: 24900, name: "Fleetco plan" });
const pSignup = stripe.seedProductPrice(UAE_TEST, { amount: 19900, name: "Drive247 Growth" });
const cusA = stripe.seedCustomer(UAE_TEST, "owner@northwind.test");
const cusC = stripe.seedCustomer(UAE_TEST, "owner@keyway.test");
const subA = stripe.seedSubscription(UAE_TEST, { customer: cusA, priceId: pA.priceId });
const subC = stripe.seedSubscription(UAE_TEST, { customer: cusC, priceId: pC.priceId });
const tsA = await liveSub(A, subA, cusA);
await liveSub(C, subC, cusC);

// B and F: sales-onboarded prospects with a plan and a pending payment link.
async function planAndLink(tenantId: string, price: { priceId: string }, amount: number, token: string): Promise<string> {
  const plan = (await q(`INSERT INTO subscription_plans (tenant_id, name, amount, currency, interval, stripe_price_id, is_active, trial_days, billing_model, stripe_account)
    VALUES ($1,'Growth',$2,'usd','month',$3,true,0,'monthly','uae') RETURNING id`, [tenantId, amount, price.priceId]))[0].id;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))).map(b => b.toString(16).padStart(2, "0")).join("");
  const link = (await q(`INSERT INTO subscription_links (tenant_id, plan_id, token_hash, status, expires_at, amount_snapshot, currency_snapshot, interval_snapshot,
      billing_model_snapshot, plan_name_snapshot, stripe_account_snapshot, stripe_mode_snapshot, stripe_price_id_snapshot, trial_days_snapshot, mint_count, link_mode)
    VALUES ($1,$2,$3,'pending', now() + interval '7 days', $4,'usd','month','monthly','Growth','uae','test',$5,0,0,'subscription') RETURNING id`,
    [tenantId, plan, hash, amount, price.priceId]))[0].id;
  return link;
}
const TOKEN_B = "tokB_" + "x".repeat(40);
const TOKEN_F = "tokF_" + "y".repeat(40);
const linkB = await planAndLink(B, pB, 14900, TOKEN_B);
const linkF = await planAndLink(F, pF, 24900, TOKEN_F);

await q(`INSERT INTO signup_plans (plan_key, name, amount_cents, currency, interval, max_vehicles, stripe_price_id) VALUES ('growth','Growth',19900,'usd','month',25,$1)`, [pSignup.priceId]);

Deno.test({ name: "referral programme, end to end", sanitizeOps: false, sanitizeResources: false }, async (t) => {
  const step = stepper(t);
  // ── scenarios ──────────────────────────────────────────────────────────────
  let codeA = "";
  let codeC = "";

  await step("1. engine: every eligible operator gets a code", async () => {
    const r = await call("referral-engine", { token: SERVICE_KEY, body: {} });
    eq(r.status, 200, "status");
    eq(r.json?.codesCreated, 2, "codes created (A allow-listed + C subscribed; B, F not subscribed)");
    eq(r.json?.errors, [], "no errors");
    const codes = await q(`SELECT code, owner_tenant_id, discount_type, discount_value::float v, duration, duration_months FROM platform_promo_codes WHERE kind='referral' AND status='active'`);
    eq(codes.length, 2, "two referral codes");
    codeA = codes.find(c => c.owner_tenant_id === A)?.code ?? "";
    codeC = codes.find(c => c.owner_tenant_id === C)?.code ?? "";
    check(/^NORTHWIND-\d{4}$/.test(codeA), "A's code is NORTHWIND-dddd (RENTALS dropped)", codeA);
    check(/^KEYWAY-\d{4}$/.test(codeC), "C's code is KEYWAY-dddd", codeC);
    const a = codes.find(c => c.owner_tenant_id === A);
    eq([a?.discount_type, a?.v, a?.duration, a?.duration_months], ["percent", 20, "repeating", 3], "default referee terms 20% x 3 months");
    eq(r.json?.subscriptionsScanned, 2, "both live subscriptions scanned once");
    const again = await call("referral-engine", { token: SERVICE_KEY, body: {} });
    eq([again.json?.codesCreated, again.json?.subscriptionsScanned, again.json?.stripeUpdates], [0, 0, 0], "second run changes nothing");
  });

  await step("2. portal: the operator's Referrals page", async () => {
    const r = await call("tenant-referrals", { token: TOK.opA, body: { tenantId: A } });
    eq(r.status, 200, "status");
    eq(r.json?.enabled, true, "enabled");
    eq(r.json?.code, { code: codeA, link: `https://drive-247.com/r/${codeA}` }, "code and link");
    eq(r.json?.refereeOffer, { discountText: "20% off", durationText: "for your first 3 months" }, "what a new operator gets");
    eq(r.json?.standing?.activeReferrals, 0, "no referrals yet");
    eq(r.json?.standing?.next, { needed: 1, reward: "10% off every bill" }, "next tier");
    eq(r.json?.standing?.tiers?.map((t: any) => t.min), [1, 3, 5], "default tiers");
    const cross = await call("tenant-referrals", { token: TOK.opA, body: { tenantId: C } });
    eq(cross.status, 403, "another operator's page is refused");
    const anon = await call("tenant-referrals", { body: { tenantId: A } });
    eq(anon.status, 401, "no token is refused");
  });

  await step("3. public lookup", async () => {
    const r = await call("promo-code-lookup", { body: { code: codeA.toLowerCase() }, headers: { "x-forwarded-for": "1.1.1.1" } });
    eq(r.json?.valid, true, "a lower-case code is found");
    eq([r.json?.kind, r.json?.referrerName, r.json?.discountText, r.json?.durationText], ["referral", "Northwind Rentals", "20% off", "for your first 3 months"], "the offer");
    check(!("id" in (r.json ?? {})) && !("owner_tenant_id" in (r.json ?? {})), "no ids leak", r.json);
    const bad = await call("promo-code-lookup", { body: { code: "NOPE-0000" }, headers: { "x-forwarded-for": "1.1.1.1" } });
    eq(bad.json, { valid: false, reason: "not_found" }, "unknown code");
  });

  await step("4. sales puts A's code on B's payment link", async () => {
    const list = await call("admin-promo-codes", { token: TOK.sales, body: { action: "list_for_payment_link", tenantId: B } });
    eq(list.status, 200, "sales may list");
    check(list.json?.codes?.some((c: any) => c.code === codeA), "A's code is offered", list.json?.codes?.map((c: any) => c.code));
    eq(list.json?.pendingLink?.id, linkB, "B's pending link");
    const set = await call("admin-promo-codes", { token: TOK.sales, body: { action: "set_link_promo", tenantId: B, code: codeA } });
    eq(set.json, { success: true }, "code set on the link");
    const rows = await q(`SELECT p.code FROM subscription_links l JOIN platform_promo_codes p ON p.id = l.promo_code_id WHERE l.id = $1`, [linkB]);
    eq(rows[0]?.code, codeA, "link carries the code");
    const denied = await call("admin-promo-codes", { token: TOK.sales, body: { action: "create_campaign", code: "SALES10", terms: { discount_type: "percent", discount_value: 10, duration: "once" } } });
    eq(denied.status, 403, "sales cannot create codes");
  });

  await step("5. payment link page shows the discount", async () => {
    const r = await call("subscription-link-v2", { method: "GET", query: `?token=${TOKEN_B}&info=1` });
    eq(r.json?.state, "ready", "state");
    eq([r.json?.promo?.displayCode, r.json?.promo?.preApplied, r.json?.promo?.discountedAmount], [codeA, true, 11920], "pre-applied, $149 -> $119.20");
    const two = await call("subscription-link-v2", { method: "GET", query: `?token=${TOKEN_B}&info=1&promo_code=${codeC}` });
    eq(two.json?.promoError, "one_code_per_checkout", "a second code is refused");
  });

  let sessionB = "";
  await step("6. checkout is created with the code's coupon (plan product only)", async () => {
    const r = await call("subscription-link-v2", { method: "POST", query: `?token=${TOKEN_B}`, form: { accept_terms: "on" } });
    eq(r.status, 303, "redirect to Stripe");
    const loc = r.headers.get("Location") ?? "";
    check(loc.startsWith("https://checkout.stripe.test/c/pay/"), "to Checkout", loc);
    sessionB = loc.split("/").pop()!;
    const s = uae().sessions.get(sessionB)!;
    eq(s._discounts.length, 1, "one discount");
    const coupon = uae().coupons.get(s._discounts[0].coupon)!;
    eq([coupon.percent_off, coupon.duration, coupon.duration_in_months], [20, "repeating", 3], "20% for 3 months");
    eq(coupon.applies_to?.products, [pB.productId], "applies to B's plan product only");
    check(String(coupon.name).startsWith("Invited by Northwind Rentals"), "coupon name", coupon.name);
    eq(s.metadata?.d247_promo_code, codeA, "session carries the code");
    const mirror = await q(`SELECT stripe_coupon_id, variant FROM platform_promo_code_stripe`);
    eq(mirror.map(m => m.variant), ["standard"], "coupon mirrored");
  });

  await step("7. B pays: redemption, referral, and A's tier reward (D8)", async () => {
    const sub = stripe.completeCheckout(UAE_TEST, sessionB);
    await liveSub(B, sub.id, sub.customer); // what the subscription webhook writes
    const r = await call("subscription-link-v2", { method: "GET", query: `?token=${TOKEN_B}&done=1&session_id=${sessionB}` });
    eq(r.json?.state, "paid", "done page");
    await settleBackground(); // the engine kick runs under EdgeRuntime.waitUntil
    const red = await q(`SELECT tenant_id, discount_ends_at FROM promo_code_redemptions`);
    eq(red.length, 1, "one redemption");
    check(red[0]?.discount_ends_at, "discount end recorded", red[0]);
    const refs = await q(`SELECT referrer_tenant_id, referred_tenant_id, source, status, referee_discount_applied FROM referrals`);
    eq(refs.map(x => [x.referrer_tenant_id === A, x.referred_tenant_id === B, x.source, x.status, x.referee_discount_applied]), [[true, true, "payment_link", "active", true]], "referral A -> B");
    const state = await q(`SELECT active_referrals, current_discount_type, current_discount_value::float v, applied_stripe_coupon_id FROM referral_tier_state WHERE tenant_id=$1`, [A]);
    eq([state[0]?.active_referrals, state[0]?.current_discount_type, state[0]?.v], [1, "percent", 10], "A is on 10%");
    eq(discountCoupons(subA), [`d247-ref-tier-pct-10-${pA.productId}`], "A's subscription carries the tier coupon");
    const tier = uae().coupons.get(`d247-ref-tier-pct-10-${pA.productId}`)!;
    eq([tier.duration, tier.applies_to?.products], ["forever", [pA.productId]], "tier coupon: forever, A's plan only");
    const notes = await q(`SELECT title FROM notifications WHERE tenant_id=$1`, [A]);
    eq(notes.map(n => n.title), ["Your referral reward went up"], "A is told in the portal");
    eq(emails.map(e => e.subject), ["Your referral reward went up — Drive247"], "and by email");
  });

  await step("8. engine is idempotent (and discovery agrees with the checkout)", async () => {
    const r = await call("referral-engine", { token: SERVICE_KEY, body: {} });
    eq([r.json?.redemptionsFound, r.json?.stripeUpdates, r.json?.tiersChanged], [1, 0, 0], "B's sub found again, nothing changes");
    eq((await q(`SELECT count(*)::int n FROM promo_code_redemptions`))[0].n, 1, "still one redemption");
    eq((await q(`SELECT count(*)::int n FROM referrals WHERE status='active'`))[0].n, 1, "still one referral");
    const again = await call("referral-engine", { token: SERVICE_KEY, body: {} });
    eq([again.json?.subscriptionsScanned, again.json?.stripeUpdates], [0, 0], "nothing new to scan");
  });

  await step("9. super admin one-time discount keeps the tier reward last", async () => {
    const r = await call("apply-subscription-discount-v2", { token: TOK.sa, body: { tenantId: A, action: "apply", discountType: "percent", value: 15 } });
    eq(r.status, 200, "applied");
    const cs = discountCoupons(subA);
    eq(cs.length, 2, "two discounts");
    eq(cs[1], `d247-ref-tier-pct-10-${pA.productId}`, "tier stays last");
    eq(r.json?.discount?.percentOff, 15, "reports its own discount");
    const e = await call("referral-engine", { token: SERVICE_KEY, body: { tenantId: A } });
    eq(e.json?.stripeUpdates, 0, "engine leaves the admin discount alone");
    const rm = await call("apply-subscription-discount-v2", { token: TOK.sa, body: { tenantId: A, action: "remove" } });
    eq(rm.status, 200, "removed");
    eq(discountCoupons(subA), [`d247-ref-tier-pct-10-${pA.productId}`], "only the tier remains");
    const nope = await call("apply-subscription-discount-v2", { token: TOK.sales, body: { tenantId: A, action: "apply", discountType: "percent", value: 5 } });
    eq(nope.status, 403, "sales cannot discount");
  });

  await step("10. B cancels: A's reward pauses, and the discount really comes off", async () => {
    stripe.setStatus(UAE_TEST, subOf((await q(`SELECT stripe_subscription_id s FROM tenant_subscriptions WHERE tenant_id=$1`, [B]))[0].s).id, "canceled");
    await q(`UPDATE tenant_subscriptions SET status='canceled' WHERE tenant_id=$1`, [B]);
    const r = await call("referral-engine", { token: SERVICE_KEY, body: {} });
    eq([r.json?.tiersChanged, r.json?.stripeUpdates], [1, 1], "one tier change, one Stripe update");
    eq(discountCoupons(subA), [], "A's subscription has no discount left");
    const state = await q(`SELECT active_referrals, current_discount_type FROM referral_tier_state WHERE tenant_id=$1`, [A]);
    eq([state[0]?.active_referrals, state[0]?.current_discount_type], [0, null], "standing 0");
    const titles = (await q(`SELECT title FROM notifications WHERE tenant_id=$1 ORDER BY created_at`, [A])).map(n => n.title);
    eq(titles.at(-1), "Your referral reward has paused", "A is told (R7)");
  });

  let refAC = "";
  await step("11. manual attach A -> C with the referee discount on C's existing subscription", async () => {
    const r = await call("admin-promo-codes", { token: TOK.sa, body: { action: "attach_referral", referrerTenantId: A, referredTenantId: C, applyRefereeDiscount: true, note: "Met at the expo" } });
    eq(r.status, 200, "attached");
    refAC = r.json?.referralId;
    const cs = discountCoupons(subC);
    eq(cs.length, 1, "C now has one discount");
    const coupon = uae().coupons.get(cs[0])!;
    eq([coupon.percent_off, coupon.applies_to?.products], [20, [pC.productId]], "A's code terms, on C's product");
    eq((await q(`SELECT count(*)::int n FROM promo_code_redemptions WHERE tenant_id=$1`, [C]))[0].n, 1, "C's redemption recorded");
    eq(discountCoupons(subA), [`d247-ref-tier-pct-10-${pA.productId}`], "A is back on 10% (C is live)");
    const dup = await call("admin-promo-codes", { token: TOK.sa, body: { action: "attach_referral", referrerTenantId: C, referredTenantId: C } });
    eq(dup.status, 400, "self-referral refused");
  });

  await step("12. void the referral: A's reward goes, C keeps its discount", async () => {
    const r = await call("admin-promo-codes", { token: TOK.sa, body: { action: "void_referral", referralId: refAC, reason: "Duplicate entry" } });
    eq(r.status, 200, "voided");
    eq(discountCoupons(subA), [], "A's reward removed");
    eq(discountCoupons(subC).length, 1, "C keeps the discount it was given");
    const short = await call("admin-promo-codes", { token: TOK.sa, body: { action: "void_referral", referralId: refAC, reason: "x" } });
    eq(short.status, 400, "a reason is required");
  });

  await step("13. claim -> approve (R6)", async () => {
    const c = await call("tenant-referrals", { token: TOK.opA, body: { tenantId: A, action: "claim", businessName: "Keyway", contact: "hello@keyway.test" } });
    eq(c.status, 200, "claim filed");
    const list = await call("admin-promo-codes", { token: TOK.sa, body: { action: "list_claims", status: "pending" } });
    eq(list.json?.claims?.map((x: any) => [x.claimed_business_name, x.referrerName]), [["Keyway", "Northwind Rentals"]], "in the queue");
    const ok = await call("admin-promo-codes", { token: TOK.sa, body: { action: "resolve_claim", claimId: c.json.claimId, decision: "approve", referredTenantId: C } });
    eq(ok.status, 200, "approved");
    eq((await q(`SELECT status FROM referral_claims`))[0].status, "approved", "claim closed");
    eq(discountCoupons(subA), [`d247-ref-tier-pct-10-${pA.productId}`], "A is on 10% again");
  });

  await step("14. rotate A's code terms; a platform default change moves only default codes", async () => {
    const codeRow = (await q(`SELECT id FROM platform_promo_codes WHERE code=$1 AND status='active'`, [codeA]))[0];
    const r = await call("admin-promo-codes", { token: TOK.sa, body: { action: "update_code", id: codeRow.id, terms: { discount_type: "percent", discount_value: 25, duration: "repeating", duration_months: 2 } } });
    eq(r.status, 200, "updated");
    const versions = await q(`SELECT status, discount_value::float v FROM platform_promo_codes WHERE code=$1 ORDER BY created_at`, [codeA]);
    eq(versions.map(v => [v.status, v.v]), [["superseded", 20], ["active", 25]], "old version superseded, same string");
    const look = await call("promo-code-lookup", { body: { code: codeA }, headers: { "x-forwarded-for": "2.2.2.2" } });
    eq([look.json?.discountText, look.json?.durationText], ["25% off", "for your first 2 months"], "lookup shows the new terms");
    const s = await call("admin-promo-codes", { token: TOK.sa, body: { action: "update_program_settings", refereeDiscount: { discount_type: "percent", discount_value: 30, duration: "once" } } });
    eq(s.status, 200, "defaults changed");
    eq(s.json?.engine?.codesRotated, 1, "only C's (default) code rotated");
    const c = await q(`SELECT discount_value::float v, duration FROM platform_promo_codes WHERE owner_tenant_id=$1 AND status='active'`, [C]);
    eq([c[0]?.v, c[0]?.duration], [30, "once"], "C follows the new default");
    const a = await q(`SELECT discount_value::float v FROM platform_promo_codes WHERE owner_tenant_id=$1 AND status='active'`, [A]);
    eq(a[0]?.v, 25, "A keeps its custom terms");
  });

  let signupSub = "";
  await step("15. self-serve signup with A's code (and switching codes mid-checkout)", async () => {
    const r = await call("signup-payment-intent-v2", { token: TOK.newop, body: { planId: "growth", promoCode: codeA } });
    eq(r.status, 200, "intent created");
    eq([r.json?.amountCents, r.json?.listAmountCents, r.json?.promo?.displayCode], [14925, 19900, codeA], "25% off $199 = $149.25 due");
    check(r.json?.clientSecret, "client secret", r.json);
    const first = r.json?.stripeSubscriptionId;
    eq(discountCoupons(first).length, 1, "discounted subscription");
    eq(uae().coupons.get(discountCoupons(first)[0])!.applies_to?.products, [pSignup.productId], "coupon on the signup plan's product");
    const bad = await call("signup-payment-intent-v2", { token: TOK.newop, body: { planId: "growth", promoCode: "NOPE-0000" } });
    eq([bad.status, bad.json?.code, bad.json?.detail?.reason], [400, "PROMO_INVALID", "not_found"], "a bad code is refused with a reason");
    const none = await call("signup-payment-intent-v2", { token: TOK.newop, body: { planId: "growth" } });
    eq([none.status, none.json?.amountCents, none.json?.promo], [200, 19900, null], "dropping the code: full price");
    check(none.json?.stripeSubscriptionId !== first, "the discounted draft was replaced", none.json);
    eq(subOf(first).status, "incomplete_expired", "old draft cancelled");
    const back = await call("signup-payment-intent-v2", { token: TOK.newop, body: { planId: "growth", promoCode: codeA } });
    eq(back.json?.amountCents, 14925, "code back on");
    signupSub = back.json?.stripeSubscriptionId;
    const reuse = await call("signup-payment-intent-v2", { token: TOK.newop, body: { planId: "growth", promoCode: codeA } });
    eq(reuse.json?.stripeSubscriptionId, signupSub, "same code again reuses the draft");
  });

  let D = "";
  await step("16. the new operator is provisioned: the engine finds the code and credits A", async () => {
    stripe.payFirstInvoice(UAE_TEST, signupSub);
    D = await tenant("newop", "New Operator");
    await liveSub(D, signupSub, subOf(signupSub).customer);
    const r = await call("referral-engine", { token: SERVICE_KEY, body: {} });
    eq(r.json?.redemptionsFound, 1, "found on discovery");
    const ref = await q(`SELECT source FROM referrals WHERE referred_tenant_id=$1 AND status='active'`, [D]);
    eq(ref.map(x => x.source), ["self_serve_checkout"], "referral A -> D (self-serve)");
    const st = await q(`SELECT active_referrals FROM referral_tier_state WHERE tenant_id=$1`, [A]);
    eq(st[0]?.active_referrals, 2, "A has 2 subscribed referrals (C, D)");
    const page = await call("tenant-referrals", { token: TOK.opA, body: { tenantId: A } });
    // Sunset (B) cancelled in step 10: still listed, no longer counting (R1).
    eq(page.json?.referrals?.map((x: any) => [x.name, x.counts]).sort(), [["Keyway", true], ["New Operator", true], ["Sunset Rentals", false]], "A's list");
  });

  await step("17. savings: what the tier took off A's paid bills", async () => {
    const inv = stripe.billAndPay(UAE_TEST, subA);
    await q(`INSERT INTO tenant_subscription_invoices (tenant_id, stripe_invoice_id, status, paid_at, subscription_id, amount_due, amount_paid)
      VALUES ($1,$2,'paid', now(), $3, $4, $4)`, [A, inv.id, tsA, inv.amount_due]);
    const r = await call("referral-engine", { token: SERVICE_KEY, body: { tenantId: A } });
    eq(r.json?.savingsRecorded, 1, "one invoice recorded");
    const page = await call("tenant-referrals", { token: TOK.opA, body: { tenantId: A } });
    eq(page.json?.savedCents, 1990, "10% of $199 saved");
  });

  await step("18. campaign codes: plan limits, payment links, max uses", async () => {
    const mk = (code: string, terms: Record<string, unknown>) => call("admin-promo-codes", { token: TOK.sa, body: { action: "create_campaign", code, terms } });
    eq((await mk("launch50", { discount_type: "percent", discount_value: 50, duration: "once", restrict_signup_plan_keys: ["growth"] })).status, 200, "LAUNCH50 created");
    const starter = await call("promo-code-lookup", { body: { code: "LAUNCH50", planKey: "starter" }, headers: { "x-forwarded-for": "3.3.3.3" } });
    eq(starter.json?.reason, "plan_not_eligible", "not for Starter");
    const growth = await call("promo-code-lookup", { body: { code: "LAUNCH50", planKey: "growth" }, headers: { "x-forwarded-for": "3.3.3.3" } });
    eq(growth.json?.valid, true, "fine for Growth");
    const onLink = await call("admin-promo-codes", { token: TOK.sa, body: { action: "set_link_promo", tenantId: F, code: "LAUNCH50" } });
    eq(onLink.status, 400, "a plan-restricted code cannot go on a payment link");
    eq((await mk("ONCE1", { discount_type: "fixed", discount_value: 25, duration: "forever", max_redemptions: 1 })).status, 200, "ONCE1 created");
    eq((await call("admin-promo-codes", { token: TOK.sa, body: { action: "set_link_promo", tenantId: F, code: "ONCE1" } })).status, 200, "ONCE1 on F's link");
    const mint = await call("subscription-link-v2", { method: "POST", query: `?token=${TOKEN_F}`, form: { accept_terms: "on" } });
    const sess = (mint.headers.get("Location") ?? "").split("/").pop()!;
    const coupon = uae().coupons.get(uae().sessions.get(sess)!._discounts[0].coupon)!;
    eq([coupon.amount_off, coupon.currency, coupon.duration], [2500, "usd", "forever"], "$25 off forever");
    const sub = stripe.completeCheckout(UAE_TEST, sess);
    await liveSub(F, sub.id, sub.customer);
    await call("subscription-link-v2", { method: "GET", query: `?token=${TOKEN_F}&done=1&session_id=${sess}` });
    eq((await q(`SELECT count(*)::int n FROM referrals WHERE referred_tenant_id=$1`, [F]))[0].n, 0, "a campaign code makes no referral");
    const used = await call("promo-code-lookup", { body: { code: "ONCE1" }, headers: { "x-forwarded-for": "3.3.3.3" } });
    eq(used.json?.reason, "maxed_out", "used up after one redemption");
  });

  await step("19. operator settings: custom tiers, brand, reset", async () => {
    const r = await call("admin-promo-codes", { token: TOK.sa, body: { action: "update_tenant_referral", tenantId: A, tiers: [{ min_active_referrals: 1, discount_type: "percent", discount_value: 15 }, { min_active_referrals: 2, discount_type: "percent", discount_value: 25 }] } });
    eq(r.status, 200, "custom tiers saved");
    eq(discountCoupons(subA), [`d247-ref-tier-pct-25-${pA.productId}`], "A (2 referrals) moves to 25%");
    const reset = await call("admin-promo-codes", { token: TOK.sa, body: { action: "update_tenant_referral", tenantId: A, tiers: null } });
    eq(reset.status, 200, "reset");
    eq(discountCoupons(subA), [`d247-ref-tier-pct-10-${pA.productId}`], "back to the default 10% (levels, never summed)");
    const brand = await call("admin-promo-codes", { token: TOK.sa, body: { action: "update_tenant_referral", tenantId: A, brandPrefix: "nwind" } });
    eq(brand.status, 200, "brand changed");
    const code = (await q(`SELECT code FROM platform_promo_codes WHERE owner_tenant_id=$1 AND status='active'`, [A]))[0].code;
    check(/^NWIND-\d{4}$/.test(code), "new code carries the brand", code);
    const old = await call("promo-code-lookup", { body: { code: codeA }, headers: { "x-forwarded-for": "4.4.4.4" } });
    eq(old.json?.reason, "inactive", "the old string no longer works");
    codeA = code;
  });

  await step("20. leaderboard, operator view, sales read-only", async () => {
    const lb = await call("admin-promo-codes", { token: TOK.sales, body: { action: "leaderboard" } });
    eq(lb.json?.leaders?.[0]?.name, "Northwind Rentals", "A leads");
    eq(lb.json?.leaders?.[0]?.savedCents, 1990, "with savings");
    const view = await call("admin-promo-codes", { token: TOK.sa, body: { action: "get_tenant_referral", tenantId: A } });
    eq(view.json?.code?.code, codeA, "admin sees the current code");
    eq(view.json?.referralsMade?.filter((x: any) => x.counts).length, 2, "two counting referrals");
    const attach = await call("admin-promo-codes", { token: TOK.sales, body: { action: "attach_referral", referrerTenantId: A, referredTenantId: F } });
    eq(attach.status, 403, "sales cannot attach");
  });

  await step("21. programme switch off", async () => {
    await call("admin-promo-codes", { token: TOK.sa, body: { action: "update_program_settings", enabled: false } });
    const look = await call("promo-code-lookup", { body: { code: codeA }, headers: { "x-forwarded-for": "5.5.5.5" } });
    eq(look.json?.reason, "programme_disabled", "referral codes stop working");
    const page = await call("tenant-referrals", { token: TOK.opA, body: { tenantId: A } });
    eq(page.json?.enabled, false, "the page says so");
    await call("admin-promo-codes", { token: TOK.sa, body: { action: "update_program_settings", enabled: true } });
  });

  await step("22. two engine runs at once: the lease lets one through", async () => {
    const [x, y] = await Promise.all([
      call("referral-engine", { token: SERVICE_KEY, body: {} }),
      call("referral-engine", { token: SERVICE_KEY, body: {} }),
    ]);
    const skipped = [x.json?.skipped, y.json?.skipped].filter(Boolean).length;
    eq(skipped, 1, "one run skipped");
    const lease = (await q(`SELECT engine_lease_until FROM referral_program_settings`))[0].engine_lease_until;
    eq(lease, null, "lease released");
    const opA = await call("referral-engine", { token: TOK.opA, body: {} });
    eq(opA.status, 403, "an operator cannot run the engine");
  });

  await step("23. lookup throttle", async () => {
    let last: any = null;
    for (let i = 0; i < 31; i++) last = await call("promo-code-lookup", { body: { code: "NOPE-1111" }, headers: { "x-forwarded-for": "6.6.6.6" } });
    eq([last.status, last.json?.reason], [429, "rate_limited"], "31st lookup in 10 minutes is refused");
  });

});
