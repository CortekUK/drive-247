// =============================================================================
// integrations/stripe — CHECKOUT DEPTH: the parts of the link-minting rail that
// checkout-health.test.ts deliberately stops short of.
//
// WHAT THIS FILE COVERS
//
//   1. create-checkout-session's ADOPTION path — the UPDATE that hands an
//      already-existing Pending payments row to a freshly minted Stripe session
//      instead of inserting a new one. Two separate defects live there: the
//      UPDATE is unbounded (one session id lands on every matching row), and it
//      never reconciles the adopted row's `amount` with what Stripe will take.
//   2. create-installment-checkout — a creator that appears in ZERO other test
//      files in this suite. It writes its plan and the whole schedule BEFORE
//      the Stripe call and then latches its own duplicate guard against every
//      retry, and it writes the same "unpaid but captured" row the suite
//      currently pins on create-upfront-checkout only.
//   3. send-excess-mileage-payment-link — where the customer who just paid is
//      actually sent, and the order in which it resolves Stripe vs the provider
//      seam.
//   4. void-payment-link — the Square rail's fail-closed 409, and the one input
//      that walks straight past it.
//
// LAYER — L1 throughout, plus one filesystem read.
//
//   L1 (source-as-text, via helpers/edge-contract) is the only honest layer for
//   these claims: every one of them is about the SHAPE of a statement — "this
//   UPDATE carries no row limit", "these two writes both omit `amount`", "this
//   INSERT happens before that Stripe call". None of it can be observed without
//   a Stripe account and a live database, and rule 4 forbids touching the
//   production ref. There is deliberately no L2 here: every finding is a
//   write-ordering or query-scoping fact that a live call would not reveal
//   anyway (a single happy-path checkout looks identical either way).
//
//   The one exception is the excess-mileage redirect block, which reads the
//   booking app's route directory off disk with readdirSync. That is still
//   offline; it is just asserting against Next.js's file-system router rather
//   than against a string.
//
// WHAT THIS FILE DELIBERATELY DOES NOT COVER
//
//   * Anything already in checkout-health.test.ts: the amount's provenance,
//     idempotency / second-click behaviour, currency fallbacks, expiry, the
//     capture/verification pair on create-upfront-checkout, or WHICH Stripe
//     account void-payment-link expires on. This file only extends those where
//     the existing assertion is scoped to one file and a second file carries
//     the same defect (see describe 4).
//   * The unique-index question on payments.stripe_checkout_session_id — pinned
//     already in webhook.test.ts. It is referenced in comments below because it
//     is the reason describe 1's defect is silent, but it is not re-asserted.
//   * The platform-subscription axis, extensions, auto-extend and pay-as-you-go.
//
// NON-OBVIOUS MECHANISMS A LATER READER WILL TRIP ON
//
//   * `src()` blanks comments before matching. These files DISCUSS the strings
//     being asserted at length (create-extension-checkout spends twenty lines
//     explaining the very hazard describe 3 pins), so a naive grep finds the
//     prose and concludes the guard exists. blankComments leaves string and
//     template literals intact, which is why the URL assertions in describe 5
//     still work on blanked source.
//   * Several assertions are POSITIONAL — indexOf(a) < indexOf(b). That is not
//     stylistic: "the rows are written before the Stripe call" is literally a
//     statement about source order, and there is no other way to assert it
//     offline. Each such test pins the two markers it compares so a rename
//     fails loudly rather than silently passing on -1 < -1.
//   * Every `it.fails` below is green WHILE THE BUG LIVES and red the day it is
//     fixed. Do not "fix" a red one by editing the assertion — delete the
//     matching pin above it and drop the `.fails` marker.
// =============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  blankComments,
  readEdgeFunctionSource,
  REPO_ROOT,
} from "../../helpers/edge-contract";

// ---------------------------------------------------------------------------
// Reading helpers. Comment-blanked by default; `raw()` is for the handful of
// assertions that are ABOUT a comment (a promise the header makes, say).
// ---------------------------------------------------------------------------

const srcCache = new Map<string, string>();
function src(fn: string): string {
  const hit = srcCache.get(fn);
  if (hit !== undefined) return hit;
  const text = blankComments(readEdgeFunctionSource(fn));
  srcCache.set(fn, text);
  return text;
}
function raw(fn: string): string {
  return readEdgeFunctionSource(fn);
}

/** Source between two markers, both of which must exist. Fails loudly if not. */
function between(text: string, from: string, to: string): string {
  const a = text.indexOf(from);
  expect(a, `marker not found (has it been renamed?): ${from}`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a);
  expect(b, `marker not found after "${from}": ${to}`).toBeGreaterThan(-1);
  return text.slice(a, b + to.length);
}

/** Same, but anchored on the LAST occurrence of `from` — several of these files
 *  read the same column in three different branches, and it is the last one
 *  (the auto-capture branch) that carries the defect. */
function betweenLast(text: string, from: string, to: string): string {
  const a = text.lastIndexOf(from);
  expect(a, `marker not found (has it been renamed?): ${from}`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a);
  expect(b, `marker not found after "${from}": ${to}`).toBeGreaterThan(-1);
  return text.slice(a, b + to.length);
}

/** Inner text of the balanced `{ ... }` that opens after `marker`. */
function objectAfter(text: string, marker: string): string {
  const at = text.indexOf(marker);
  expect(at, `marker not found: ${marker}`).toBeGreaterThan(-1);
  const open = text.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${marker}`);
}

/** Index of a marker that must exist — so positional tests never compare -1s. */
function at(text: string, marker: string): number {
  const i = text.indexOf(marker);
  expect(i, `marker not found: ${marker}`).toBeGreaterThan(-1);
  return i;
}

// ===========================================================================
// 1. ADOPTION — one session id, every unpaid Pending row on the rental
// ===========================================================================

// @usecase One successful Stripe payment must settle exactly one payments row; if this goes red the adoption UPDATE has stopped being row-scoped and a single paid session can strand every other Pending row on the rental as permanently un-voidable.
describe("stripe/checkout — the row a new session adopts", () => {
  it("PINS TODAY'S BEHAVIOUR: the adoption UPDATE is scoped to the rental, not to one row", () => {
    // create-checkout-session/index.ts:479-489. The non-targeted (portal/
    // booking) path tries to hand the new session to an existing Pending row
    // rather than inserting a fresh one. The filters are all set-level:
    // rental_id, "session id still null", status Pending, no target_categories,
    // no extension_id. There is no `.eq('id', ...)` and no `.limit(1)`, so if
    // the rental carries TWO such rows, both are stamped with the same
    // session.id.
    const adopt = between(
      src("create-checkout-session"),
      "const updateResult = await supabaseClient",
      ".select('id')",
    );

    expect(adopt).toContain(".from('payments')");
    expect(adopt).toContain(".update(updateData)");
    expect(adopt).toContain(".eq('rental_id', referenceId)");
    expect(adopt).toContain(".is('stripe_checkout_session_id', null)");
    expect(adopt).toContain(".eq('status', 'Pending')");

    // The three ways this could have been narrowed to one row. None present.
    expect(adopt).not.toContain(".limit(");
    expect(adopt).not.toContain(".eq('id'");
    expect(adopt).not.toContain(".maybeSingle()");
  });

  it("PINS TODAY'S BEHAVIOUR: the live webhook resolves that session id with .single(), which a multi-row stamp cannot satisfy", () => {
    // stripe-webhook-live/index.ts:1298-1302. The auto-capture branch looks the
    // paid session up by stripe_checkout_session_id and calls .single().
    // PostgREST's single() errors when the filter matches more than one row, so
    // `existingPayment` comes back null, the else-branch at :1325-1364 INSERTS
    // a brand-new Completed row, and the two stamped rows stay Pending for ever
    // — and un-voidable, because void-payment-link refuses anything whose
    // session has been paid.
    const hook = src("stripe-webhook-live");
    const lookup = betweenLast(
      hook,
      "const { data: existingPayment } = await supabase",
      ";",
    );
    expect(lookup).toContain('.eq("stripe_checkout_session_id", session.id)');
    expect(lookup).toContain(".single()");
    expect(lookup).not.toContain(".maybeSingle()");
    expect(lookup).not.toContain(".order(");

    // Three branches of this ONE file read that same column three different
    // ways, which is the clearest evidence that .single() here is an oversight
    // rather than a decision:
    //   :1298 auto checkout  .single()                      <- the defect
    //   :588  invoice        .maybeSingle()
    //   :921  extension      .order(...).limit(1).maybeSingle()
    const invoiceLookup = between(
      hook,
      "const { data: existingPayment } = await supabase",
      ";",
    );
    expect(invoiceLookup).toContain(".maybeSingle()");

    // The extension branch already knows this column is not unique and says so
    // in its own comment ("duplicates exist in legacy data").
    const extLookup = between(
      hook,
      "let { data: extensionPayment, error: extPaymentError } = await supabase",
      ";",
    );
    expect(extLookup).toContain('.order("created_at", { ascending: false })');
    expect(extLookup).toContain(".limit(1)");
    expect(extLookup).toContain(".maybeSingle()");
    expect(raw("stripe-webhook-live")).toContain(
      "duplicates exist in legacy",
    );
  });

  it.fails("should narrow the adoption UPDATE to exactly one payments row", () => {
    // Remove the .fails marker once supabase/functions/create-checkout-session/index.ts:479-489 is fixed.
    // Correct shape: resolve the candidate row first (ordered, limit 1) and
    // update it by id — or at minimum append `.limit(1)` — so one Stripe
    // session can only ever claim one payments row.
    const adopt = between(
      src("create-checkout-session"),
      "const updateResult = await supabaseClient",
      ".select('id')",
    );
    expect(
      adopt,
      "create-checkout-session still stamps one checkout session id onto EVERY " +
        "null-session Pending row for the rental. The live webhook then reads that " +
        "column with .single(), finds more than one, inserts an extra Completed row, " +
        "and leaves the stamped rows Pending and un-voidable.",
    ).toMatch(/\.limit\(1\)|\.eq\('id'|\.maybeSingle\(\)/);
  });

  it("PINS TODAY'S BEHAVIOUR: adopting a row copies no money — neither the UPDATE nor the webhook's settle writes an amount", () => {
    // create-checkout-session/index.ts:463-467 — updateData carries exactly
    // three keys: the session id, the platform account, and updated_at.
    const updateData = objectAfter(src("create-checkout-session"), "const updateData: any =");
    expect(updateData).toContain("stripe_checkout_session_id: session.id");
    expect(updateData).toContain("platform_account: platformAccount");
    expect(updateData).not.toMatch(/\bamount\b/);
    // ...and nothing bolts one on afterwards (target_categories and
    // extension_id are the only conditional additions, :469-474).
    expect(src("create-checkout-session")).not.toContain("updateData.amount");

    // stripe-webhook-live/index.ts:1308-1318 — the settle of that same adopted
    // row writes status/capture/verification/payment-intent and nothing else.
    const settle = betweenLast(
      src("stripe-webhook-live"),
      "if (existingPayment) {",
      '.eq("id", existingPayment.id);',
    );
    expect(settle).toContain('status: "Completed"');
    expect(settle).toContain('capture_status: "captured"');
    expect(settle).not.toMatch(/\bamount\b/);

    // The contrast that proves the figure was available all along: the
    // webhook's INSERT branch, six lines below, does take it from the session
    // (:1334).
    expect(src("stripe-webhook-live")).toContain(
      "session.amount_total ? session.amount_total / 100 : rental.monthly_amount",
    );
    // As does create-checkout-session's own INSERT branch (:513, :521).
    expect(src("create-checkout-session")).toContain(
      "const paymentAmount = Math.round(totalAmount * 100) / 100",
    );
  });

  it("the ledger allocates from the payments row's own amount column, which is the figure nobody reconciled", () => {
    // supabase/migrations/20260420140000_fix_payment_fifo_all_categories.sql:30-32
    // payment_apply_fifo_v2 reads `amount` straight off the row. So an adopted
    // row is allocated at whatever it was carrying when it was created, not at
    // what Stripe actually took.
    //
    // Worked example, by hand: a stale Pending row of 500.00 adopted by a
    // session raised for 50.00 credits 500.00 against charges.
    //   500.00 - 50.00 = 450.00 of credit the customer never paid.
    // Reverse the two figures and the paying customer is under-credited by the
    // same 450.00.
    const sql = readFileSync(
      join(REPO_ROOT, "supabase", "migrations", "20260420140000_fix_payment_fifo_all_categories.sql"),
      "utf8",
    );
    expect(sql).toContain("SELECT amount, rental_id, customer_id, vehicle_id");
    expect(sql).toContain("FROM payments WHERE id = p_id");
  });

  it.fails("should reconcile the adopted row's amount with the session total", () => {
    // Remove the .fails marker once supabase/functions/create-checkout-session/index.ts:459-467
    // (or the settle at supabase/functions/stripe-webhook-live/index.ts:1308-1318) is fixed.
    // Either site closing it is enough, so this watchdog accepts a fix at
    // either: the adopted row must end up carrying the money Stripe took.
    const updateData = objectAfter(src("create-checkout-session"), "const updateData: any =");
    const settle = betweenLast(
      src("stripe-webhook-live"),
      "if (existingPayment) {",
      '.eq("id", existingPayment.id);',
    );
    expect(
      `${updateData}\n${settle}`,
      "Neither the adoption UPDATE nor the webhook's settle writes `amount`, so a " +
        "row raised for one figure is marked Completed and FIFO-allocated at a " +
        "different one. Nothing downstream re-checks it.",
    ).toMatch(/\bamount\b/);
  });
});

// ===========================================================================
// 2. INSTALMENTS — the plan is written before the money can be taken
// ===========================================================================

// @usecase A Stripe failure mid-request must not brick instalments for a rental; if this goes red the write ordering in create-installment-checkout has changed and a stranded 'pending' plan may no longer be the outcome (check the pins before celebrating).
describe("stripe/checkout — create-installment-checkout writes its plan before it has a session", () => {
  it("PINS TODAY'S BEHAVIOUR: the plan and its whole schedule are inserted before the Stripe session is created", () => {
    // create-installment-checkout/index.ts — plan INSERT at :243, the N
    // scheduled_installments rows at :288, and only then
    // stripe.checkout.sessions.create at :323.
    const s = src("create-installment-checkout");
    const planAt = at(s, "const { data: installmentPlan, error: planError } = await supabase");
    const scheduleAt = at(s, ".from('scheduled_installments')");
    const sessionAt = at(s, "await stripe.checkout.sessions.create({");

    expect(planAt).toBeLessThan(sessionAt);
    expect(scheduleAt).toBeLessThan(sessionAt);
    // And the plan row lands in the exact status the guard below rejects.
    expect(objectAfter(s, ".from('installment_plans')\n      .insert(")).toContain("status: 'pending'");
  });

  it("PINS TODAY'S BEHAVIOUR: nothing unwinds those rows when the request fails", () => {
    // The single catch at :405-418 formats a message and returns 400. It
    // deletes nothing — the whole file contains no delete call at all.
    const s = src("create-installment-checkout");
    const catchBlock = s.slice(s.lastIndexOf("} catch (error) {"));
    expect(catchBlock).toContain("create-installment-checkout error:");
    expect(catchBlock).not.toContain(".delete(");
    expect(s).not.toContain(".delete(");
  });

  it("PINS TODAY'S BEHAVIOUR: the duplicate guard then rejects every later attempt on that rental", () => {
    // :116-123. Any plan in 'active' OR 'pending' throws. The orphan written by
    // the failed attempt is 'pending', so it is its own blocker — the failure
    // is self-latching.
    const guard = between(
      src("create-installment-checkout"),
      "const { data: existingPlan } = await supabase",
      "already exists for this rental",
    );
    expect(guard).toContain(".in('status', ['active', 'pending'])");
    expect(guard).toContain("An installment plan already exists for this rental");
  });

  it("the sibling creator wrote the same hazard down and fixed it, which is why this one is not a matter of taste", () => {
    // create-extension-checkout/index.ts:187-208 spends twenty lines on
    // precisely this shape ("a failure from here on must not lose its id" /
    // "$795.48 across 5 rentals and 2 tenants is sitting in that state") and
    // resolved it by returning 200 with a null checkout URL instead of throwing
    // after the INSERT. Asserted on RAW source because the evidence is a
    // comment.
    const ext = raw("create-extension-checkout");
    expect(ext).toContain("PAST THIS POINT THE rental_extensions ROW ALREADY EXISTS");
    expect(ext).toContain("Stripe failures now return 200 WITH the id and a null checkoutUrl");
    // create-installment-checkout has no equivalent — no such return, no
    // post-insert recovery path.
    expect(src("create-installment-checkout")).not.toContain("checkoutUrl: null");
  });

  it("the stranded plan is at least visible and clearable from the portal, so this is a blockage rather than data loss", () => {
    // Scope-correction worth recording: the orphan does NOT need DB surgery.
    // apps/portal/src/hooks/use-installment-plan.ts:66-70 loads the plan for a
    // rental with no status filter, so a 'pending' orphan renders; and
    // apps/portal/src/components/installments/InstallmentSection.tsx:257-260
    // sets status 'cancelled', which the guard above does not match. The real
    // cost is: instalments are blocked for that rental until a human notices a
    // phantom plan and cancels it.
    const hook = readFileSync(
      join(REPO_ROOT, "apps", "portal", "src", "hooks", "use-installment-plan.ts"),
      "utf8",
    );
    expect(hook).toContain("from('installment_plans')");
    expect(hook).not.toContain("eq('status'");

    const section = readFileSync(
      join(REPO_ROOT, "apps", "portal", "src", "components", "installments", "InstallmentSection.tsx"),
      "utf8",
    );
    expect(section).toContain('update({ status: "cancelled" })');
  });

  it.fails("should not leave an installment plan behind when the Stripe session cannot be created", () => {
    // Remove the .fails marker once supabase/functions/create-installment-checkout/index.ts:243-295 is fixed.
    // Two acceptable fixes: create the Stripe session BEFORE writing the plan,
    // or unwind the plan and its schedule in the catch. Either closes it.
    const s = src("create-installment-checkout");
    const planAt = at(s, "const { data: installmentPlan, error: planError } = await supabase");
    const sessionAt = at(s, "await stripe.checkout.sessions.create({");
    const catchBlock = s.slice(s.lastIndexOf("} catch (error) {"));
    const unwinds = catchBlock.includes(".delete(");

    expect(
      sessionAt < planAt || unwinds,
      "create-installment-checkout still writes a 'pending' plan plus N scheduled " +
        "rows before calling Stripe, and unwinds neither on failure. Its own duplicate " +
        "guard (:116-123) then rejects every retry for that rental until an operator " +
        "spots the phantom plan and cancels it.",
    ).toBe(true);
  });
});

// ===========================================================================
// 3. THE SECOND SITE OF THE "UNPAID BUT CAPTURED" ROW
// ===========================================================================

// @usecase void-payment-link reads capture_status === 'captured' as proof of real money; while create-installment-checkout writes it at link-creation time, an instalment link nobody has opened can never be cancelled from the portal.
describe("stripe/checkout — the unpaid instalment row that claims to be captured", () => {
  it("PINS TODAY'S BEHAVIOUR: create-installment-checkout marks its upfront row captured and auto-approved before the link is opened", () => {
    // create-installment-checkout/index.ts:354-371 — the row is INSERTed
    // immediately after sessions.create with status 'Pending' but
    // capture_status 'captured' and verification_status 'auto_approved'.
    // Identical to create-upfront-checkout/index.ts:202, which the suite
    // already pins at checkout-health.test.ts:1099-1112.
    const s = src("create-installment-checkout");
    const row = objectAfter(s, ".from('payments')\n      .insert(");
    expect(row).toContain("status: 'Pending'");
    expect(row).toContain("capture_status: 'captured'");
    expect(row).toContain("verification_status: 'auto_approved'");

    // void-payment-link/index.ts:124-126 is the reader that makes it matter.
    expect(src("void-payment-link")).toContain('payment.capture_status === "captured"');

    // The honest pair, written by the rental checkout for the same moment
    // (create-checkout-session/index.ts:527-529).
    expect(src("create-checkout-session")).toContain("capture_status: 'requires_capture'");
    expect(src("create-checkout-session")).toContain("verification_status: 'pending'");
  });

  it.fails("should not write capture_status 'captured' in create-installment-checkout before the customer has paid", () => {
    // Remove the .fails marker once supabase/functions/create-installment-checkout/index.ts:364-367 is fixed.
    // Deliberately named for THIS file. The existing watchdog at
    // checkout-health.test.ts:1114-1125 asserts only against
    // create-upfront-checkout, so fixing that file alone turns it red and gives
    // a false all-clear here. Both sites have to be closed.
    expect(
      src("create-installment-checkout"),
      "create-installment-checkout still inserts capture_status 'captured' at the " +
        "moment the link is minted, so an instalment link nobody has opened reads as " +
        "money in hand to void-payment-link and to every capture guard on that column.",
    ).not.toContain("capture_status: 'captured'");
  });
});

// ===========================================================================
// 4. WHERE THE EXCESS-MILEAGE PAYER LANDS
// ===========================================================================

// @usecase A customer who has just paid an excess-mileage charge must land somewhere that exists on the operator's own domain; if this goes red the redirect target has moved and the 404 pin below needs re-deriving before anyone celebrates.
describe("stripe/checkout — the excess-mileage redirect", () => {
  /** Route segments the booking app's customer portal actually serves. */
  function bookingPortalRoutes(): string[] {
    const dir = join(REPO_ROOT, "apps", "booking", "src", "app", "(customer-portal)", "portal");
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }

  it("PINS TODAY'S BEHAVIOUR: both redirect targets point at a booking-app route that does not exist", () => {
    // send-excess-mileage-payment-link/index.ts:166-167 sends success and
    // cancel to https://{slug}.drive-247.com/portal/rentals — bookingDomain is
    // built from the tenant slug at :72, i.e. the BOOKING host.
    const s = src("send-excess-mileage-payment-link");
    expect(s).toContain("const bookingDomain = `${tenantData.slug}.drive-247.com`");
    expect(s).toContain("success_url: `https://${bookingDomain}/portal/rentals?payment=success`");
    expect(s).toContain("cancel_url: `https://${bookingDomain}/portal/rentals?payment=cancelled`");

    // The booking app's customer portal has no `rentals` route. `rentals` lives
    // only in apps/portal/src/app/(dashboard)/rentals, which is served from
    // {tenant}.portal.drive-247.com — a different host.
    const routes = bookingPortalRoutes();
    expect(routes).toContain("payments"); // sanity: we are reading the right directory
    expect(routes).not.toContain("rentals");
  });

  it("PINS TODAY'S BEHAVIOUR: neither redirect carries the session id or the rental, so the landing page could reconcile nothing anyway", () => {
    // Contrast with the rental checkout and the instalment checkout, both of
    // which template the session id into success_url so the return page can
    // find what was just paid (create-installment-checkout/index.ts:344).
    const s = src("send-excess-mileage-payment-link");
    const success = between(s, "success_url:", "`,");
    expect(success).not.toContain("{CHECKOUT_SESSION_ID}");
    expect(success).not.toContain("rental_id");
    expect(src("create-installment-checkout")).toContain("session_id={CHECKOUT_SESSION_ID}");
  });

  it.fails("should send the excess-mileage payer to a route the booking portal actually serves", () => {
    // Remove the .fails marker once supabase/functions/send-excess-mileage-payment-link/index.ts:166-167 is fixed.
    const s = src("send-excess-mileage-payment-link");
    const m = /success_url: `https:\/\/\$\{bookingDomain\}\/([^?`]+)/.exec(s);
    expect(m, "success_url no longer matches the shape this watchdog parses").not.toBeNull();
    const path = (m as RegExpExecArray)[1]; // e.g. "portal/rentals"
    const segment = path.split("/")[1] ?? "";

    expect(
      bookingPortalRoutes(),
      `send-excess-mileage-payment-link still drops the payer on /${path}, and the ` +
        "booking app's customer portal has no such route — a 404 on the operator's own " +
        "branded domain at the one moment the customer needs to see the charge landed.",
    ).toContain(segment);
  });
});

// ===========================================================================
// 5. VOIDING A SQUARE LINK WHEN THE TENANT DOES NOT RESOLVE
// ===========================================================================

// @usecase A row marked voided must mean the provider-side link is dead; if this goes red the Square fail-closed 409 has moved and an unresolvable tenant may again be reported as a successful void while the (never-expiring) Square link stays payable.
describe("stripe/checkout — void-payment-link's Square rail and the unresolved tenant", () => {
  it("PINS TODAY'S BEHAVIOUR: the Square fail-closed 409 lives inside `if (tenant && ...)`, so no tenant means no guard", () => {
    // void-payment-link/index.ts:178-201. The tenant row is fetched with
    // .single(); on no match supabase-js returns data null WITHOUT throwing
    // (the error is discarded — only `data` is destructured at :178). Both
    // provider branches are then skipped, and control falls to the soft-cancel
    // at :246 which returns success: true.
    const s = src("void-payment-link");
    const squareBranchAt = at(s, 'if (tenant && payment.payment_provider === "square")');
    const guardAt = at(s, "if (!payment.square_payment_link_id)");
    const elseTenantAt = at(s, "} else if (tenant) {");
    const softCancelAt = at(s, 'status: "Reversed"');

    // The 409 is nested inside the square branch, which is itself gated on a
    // truthy tenant.
    expect(squareBranchAt).toBeLessThan(guardAt);
    expect(guardAt).toBeLessThan(elseTenantAt);
    expect(elseTenantAt).toBeLessThan(softCancelAt);

    // The 409's own words say what it is protecting against.
    expect(s).toContain("Voiding it here would mark it dead while it stays payable.");

    // And nothing anywhere in the file refuses a request whose tenant row did
    // not resolve.
    expect(s).not.toMatch(/if\s*\(\s*!tenant\b/);
  });

  it("PINS TODAY'S BEHAVIOUR: the file's header promises the opposite of what that path does", () => {
    // Asserted on RAW source: the promise is a comment, and the point is the
    // gap between it and :186-230.
    const header = raw("void-payment-link");
    expect(header).toContain(
      "it best-effort expires the Stripe Checkout session so a still-live link can no",
    );
    expect(header).toContain("it is fail-closed");
    // Square's own note: no expiry at all, so the exposure is unbounded rather
    // than the Stripe path's documented <24h.
    expect(header).toContain("A Square link has no expiry at all");
  });

  it.fails("should refuse the void when the payment's tenant row cannot be resolved", () => {
    // Remove the .fails marker once supabase/functions/void-payment-link/index.ts:178-186 is fixed.
    // Correct shape: a null tenant is an unknown-provider state, not a Stripe
    // state. Bail before the soft-cancel (or at minimum re-run the Square
    // fail-closed check independently of the tenant lookup) so the row is never
    // marked Reversed while the provider-side link is still payable.
    expect(
      src("void-payment-link"),
      "void-payment-link still soft-cancels and reports success: true when the " +
        "tenants lookup returns nothing. On the Square rail that means a row marked " +
        "dead behind a link that never expires — the operator collects the money " +
        "another way while the customer can still pay the old link.",
    ).toMatch(/if\s*\(\s*!tenant\b/);
  });
});

// ===========================================================================
// 6. THREE CREATORS, THREE ORDERINGS OF THE SAME TWO STEPS
// ===========================================================================

// @usecase Every creator that dispatches to the provider seam should settle Stripe configuration on the same side of that dispatch; if this goes red the ordering has changed in one of the three and the reason needs writing down.
describe("stripe/checkout — Stripe setup vs the provider seam, across the three dispatching creators", () => {
  it("PINS TODAY'S BEHAVIOUR: two creators dispatch to the seam first, and the excess-mileage link resolves Stripe first", () => {
    // create-checkout-session:    tryProviderCheckout :240, Stripe client :317
    // send-invoice-email:         tryProviderCheckout :283, Stripe client :335
    // send-excess-mileage-...:    Stripe client :61,  tryProviderCheckout :78
    const ccs = src("create-checkout-session");
    expect(at(ccs, "await tryProviderCheckout(")).toBeLessThan(
      at(ccs, "getStripeClientForAccount(platformAccount"),
    );

    const inv = src("send-invoice-email");
    expect(at(inv, "await tryProviderCheckout(")).toBeLessThan(
      at(inv, "getStripeClientForAccount(platformAccount"),
    );

    const mil = src("send-excess-mileage-payment-link");
    expect(at(mil, "getStripeClientForAccount(platformAccount")).toBeLessThan(
      at(mil, "await tryProviderCheckout("),
    );
  });

  it("the Stripe setup that runs first on that one path contains a throw, which the other two reach only after the seam has had its say", () => {
    // _shared/stripe-client.ts:123-128 — getConnectAccountId throws outright
    // for a live own-Stripe tenant with no connected account. On the
    // excess-mileage path that call (index.ts:62) happens BEFORE
    // tryProviderCheckout, so a Square tenant in that state would 500 on a
    // Stripe-only precondition.
    //
    // HONEST LIMIT: this is an ordering/consistency pin, not a claim that any
    // tenant is currently in the triggering state (payment_model 'own' AND
    // stripe_mode 'live' AND own_stripe_account_id null). That needs live data,
    // which rule 4 forbids. The throw itself is source-verified.
    const shared = readFileSync(
      join(REPO_ROOT, "supabase", "functions", "_shared", "stripe-client.ts"),
      "utf8",
    );
    expect(shared).toContain(
      "Tenant is on Own Stripe (payment_model='own') but has no connected LIVE account.",
    );

    const mil = src("send-excess-mileage-payment-link");
    expect(at(mil, "getConnectAccountId(tenantData)")).toBeLessThan(
      at(mil, "await tryProviderCheckout("),
    );
  });
});
