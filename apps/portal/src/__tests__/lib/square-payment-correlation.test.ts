import { describe, it, expect } from "vitest";
import { readEdgeSource, codeOnly } from "../helpers/edge-source";

/**
 * THE CORRELATION SUITE.
 *
 * Every test here exists because of one bug that shipped past three earlier
 * review passes, two type-checks and 934 green tests.
 *
 * `createSquareCheckout` used to return a `persist: { square_order_id }` block,
 * documented in its own source as "a loud, machine-readable statement of the
 * caller's obligation". It was loud and it was machine-readable, and it was
 * also entirely advisory: no caller ever read it. Nothing wrote square_order_id
 * to the payments table, so `square-webhook`'s findPaymentByHandles() — which
 * matches only on square_payment_id or square_order_id — could never match.
 *
 * The failure was silent by construction. The buyer paid, Square fired the
 * webhook, the handler found no row, logged "no local payments row", and
 * returned 200. A 200 is what Square wants, so Square stopped retrying. The
 * money was taken and never recorded against the rental.
 *
 * Nothing in the type system could catch it: an optional field that no one
 * passes is not a type error. Nothing in the routing tests caught it either,
 * because they asserted the dispatch was WIRED, and it was — it just led
 * nowhere. So the invariant gets asserted directly, at the only two places it
 * can be violated: the seam, and the call sites.
 */

const adapter = () => readEdgeSource("_shared/payments/square-adapter.ts");
const fn = (name: string) => readEdgeSource(`${name}/index.ts`);

// ---------------------------------------------------------------------------
// 1. The seam: ordering is the property, not merely presence.
// ---------------------------------------------------------------------------
describe("createSquareCheckout persists before it charges", () => {
  const src = codeOnly(adapter());
  const body = src.slice(src.indexOf("export async function createSquareCheckout"));

  it("inserts the payments row BEFORE calling Square", () => {
    const insertAt = body.indexOf('.from("payments")');
    const squareAt = body.indexOf("squareFetch");
    expect(insertAt).toBeGreaterThan(-1);
    expect(squareAt).toBeGreaterThan(-1);
    // If this ever inverts, a buyer who pays instantly races a row that does
    // not exist yet — which is the original bug with extra steps.
    expect(insertAt).toBeLessThan(squareAt);
  });

  it("aborts instead of returning a payable URL when the pre-insert fails", () => {
    expect(body).toMatch(/square_payment_row_insert_failed/);
    const failAt = body.indexOf("square_payment_row_insert_failed");
    // Anchored on the CREATE call, not on "the first squareFetch".
    //
    // squareFetch is now also used to RE-READ an existing link on the retry
    // path, and that call sits earlier in the function — so the old proxy
    // started measuring the wrong request and failed for a reason that had
    // nothing to do with the invariant.
    const createAt = body.indexOf('method: "POST"');
    expect(createAt).toBeGreaterThan(-1);
    // The abort must be upstream of the charge. Returning a live link we cannot
    // track is worse than an error: the customer is charged either way, but
    // only one of the two leaves us able to see it.
    expect(failAt).toBeLessThan(createAt);
  });

  it("writes both correlation handles back after the link exists", () => {
    const back = body.slice(body.indexOf("payment_link ?? {}"));
    expect(back).toMatch(/square_order_id:\s*link\.order_id/);
    expect(back).toMatch(/square_payment_link_id:\s*link\.id/);
  });

  it("treats a missing order_id as a failure, not a success", () => {
    // order_id is the ONLY key square-webhook can correlate on at the moment
    // the buyer pays — payment_id does not exist yet. A link without one is
    // un-correlatable, so it must not be handed back as if it worked.
    expect(body).toMatch(/!link\.order_id/);
    expect(body).toMatch(/square_handle_persist_failed/);
  });

  it("does not strand a Pending row when the Square call throws", () => {
    const c = body.slice(body.indexOf("} catch (err)"));
    expect(c).toMatch(/markSquareRowDead\(supabase, paymentRowId\)/);
  });

  it("writes a status payments_status_check actually permits", () => {
    // THE BUG THIS EXISTS FOR.
    //
    // The cleanup used to write status 'Failed'. payments_status_check permits
    // only Applied | Credit | Partial | Reversed | Pending | Completed |
    // Refunded | Partial Refund — so every cleanup silently violated the
    // constraint, the update failed unchecked, and the row stayed Pending with
    // a live idempotency key. The operator's next attempt then adopted that
    // corpse and was refused as "already settled".
    //
    // Source-level, because a status string is only wrong relative to a
    // constraint no unit test can reach. Keep this list in step with the CHECK.
    const ALLOWED = [
      "Applied", "Credit", "Partial", "Reversed",
      "Pending", "Completed", "Refunded", "Partial Refund",
    ];
    // Bounded by the NEXT top-level declaration, not by the first "}" — the
    // first brace in this helper closes the `const { error }` destructuring.
    const from = src.indexOf("async function markSquareRowDead");
    const helper = src.slice(from, src.indexOf("\nexport async function", from));
    const written = helper.match(/status:\s*"([^"]+)"/);
    expect(written, "markSquareRowDead does not write a status").toBeTruthy();
    expect(ALLOWED).toContain(written![1]);
  });

  it("marks the row dead without ever overwriting a completed one", () => {
    const helper = src.slice(src.indexOf("async function markSquareRowDead"));
    // Guarded on Pending so a concurrent webhook that already completed the row
    // is never overwritten by this cleanup.
    expect(helper).toMatch(/\.eq\(["']status["'],\s*["']Pending["']\)/);
    // And the failure must be logged: the original bug was invisible precisely
    // because this update's error was discarded.
    expect(helper).toMatch(/console\.error/);
  });

  it("stamps payment_provider so the exclusivity CHECK classifies the row", () => {
    expect(body).toMatch(/payment_provider:\s*["']square["']/);
  });
});

// ---------------------------------------------------------------------------
// 2. The call sites. This is the test that was missing.
// ---------------------------------------------------------------------------
describe("every Square checkout call site produces a correlatable row", () => {
  // Each entry is a function that routes real customer money through the seam.
  const CALLERS = [
    "create-checkout-session",
    "create-extension-checkout",
    "send-invoice-email",
    "send-excess-mileage-payment-link",
  ] as const;

  it.each(CALLERS)("%s writes the handles, one way or the other", (name) => {
    const src = codeOnly(fn(name));
    expect(src).toContain("tryProviderCheckout");

    // Two legitimate shapes:
    //   (a) hand the row to the seam via paymentRow, or
    //   (b) insert it yourself WITH the handles after the link exists.
    // Anything else is the original bug.
    const delegates = /paymentRow:/.test(src);
    const selfWrites = /square_order_id/.test(src) && /\.from\(["']payments["']\)/.test(src);

    expect(
      delegates || selfWrites,
      `${name} calls tryProviderCheckout but never persists square_order_id — ` +
        `its payments will arrive at square-webhook with nothing to match.`,
    ).toBe(true);
  });

  it("no caller inserts a second row for a collection the seam already recorded", () => {
    // send-excess-mileage-payment-link delegates AND still has a payments insert
    // for the Stripe rail. That insert must be fenced behind !squareBody, or one
    // Square collection produces two Pending rows and FIFO allocates both.
    const src = codeOnly(fn("send-excess-mileage-payment-link"));
    const insertAt = src.indexOf('.from("payments").insert');
    expect(insertAt).toBeGreaterThan(-1);
    const guardAt = src.lastIndexOf("if (!squareBody)", insertAt);
    expect(guardAt).toBeGreaterThan(-1);
    // The guard must be immediately upstream, not somewhere far above.
    expect(insertAt - guardAt).toBeLessThan(600);
  });

  it("no caller relies on the advisory persist block that nobody honoured", () => {
    // The block is gone from the adapter's contract; assert no call site grew a
    // dependency on it in the meantime.
    for (const name of CALLERS) {
      expect(codeOnly(fn(name))).not.toMatch(/\.persist\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The other end of the wire: the webhook can only use what we stored.
// ---------------------------------------------------------------------------
describe("square-webhook correlates on the handles the seam writes", () => {
  const src = codeOnly(fn("square-webhook"));

  it("matches on square_order_id, which is all that exists at payment time", () => {
    expect(src).toMatch(/square_order_id/);
  });

  it("still matches on square_payment_id for later lifecycle events", () => {
    expect(src).toMatch(/square_payment_id/);
  });
});

// ---------------------------------------------------------------------------
// 4. Stripe must be untouched by all of the above.
// ---------------------------------------------------------------------------
describe("the fix does not disturb the Stripe rail", () => {
  it("create-checkout-session still keys its Stripe row on the session id", () => {
    expect(codeOnly(fn("create-checkout-session"))).toMatch(/stripe_checkout_session_id/);
  });

  it("the hoisted customer lookup reads the same column from the same table", () => {
    const src = codeOnly(fn("create-checkout-session"));
    // Hoisted, not duplicated: exactly one resolution site, so the Stripe path
    // cannot diverge from the Square path.
    const hits = src.match(/let resolvedCustomerId = customerId/g) ?? [];
    expect(hits.length).toBe(1);
    expect(src).toMatch(/\.select\(['"]customer_id['"]\)/);
  });

  it("Square's pre-insert can never carry a Stripe handle", () => {
    // payments_provider_handle_exclusivity_check rejects that combination at the
    // database, which would throw AFTER the link is payable.
    const body = codeOnly(adapter());
    const region = body.slice(
      body.indexOf("export async function createSquareCheckout"),
      body.indexOf("squareFetch", body.indexOf("export async function createSquareCheckout")),
    );
    expect(region).not.toMatch(/stripe_/);
  });
});
