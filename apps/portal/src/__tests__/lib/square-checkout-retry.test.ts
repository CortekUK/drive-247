import { describe, it, expect } from "vitest";
import { readEdgeSource, codeOnly } from "../helpers/edge-source";

/**
 * ONE ROW PER LINK.
 *
 * The checkout seam derives a DETERMINISTIC Square idempotency key from
 * (reference, scope, currency, amount), then pre-inserts a payments row. Those
 * two facts disagreed, and the disagreement was the bug: a customer who clicked
 * "Pay" twice got ONE link back from Square — idempotency working exactly as
 * designed — but TWO payments rows, both later stamped with the SAME
 * square_order_id.
 *
 * From there it degraded quietly. square-webhook resolves with
 * `order by created_at desc limit 1`, so it completed the newer row and left the
 * older one Pending. recover-pending-square-payments sweeps precisely that shape
 * — Pending, with an order_id — asks Square about the order, is told it is
 * genuinely PAID, marks it Completed and calls payment_apply_fifo_v2. One
 * collection, allocated twice, against a rental that now looks overpaid.
 *
 * Note the asymmetry with Stripe, which is NOT exposed to this: two clicks there
 * create two DISTINCT session ids, so its recovery sweep finds the second one
 * unpaid and leaves it alone. The exposure exists only because Square's
 * idempotency key deliberately collapses two links onto one order — the fix is
 * therefore to make the ROW as unique as the LINK, not to fight the collapse.
 */

const adapter = () => codeOnly(readEdgeSource("_shared/payments/square-adapter.ts"));

describe("the payments row is as unique as the Square link", () => {
  const src = adapter();
  const body = src.slice(src.indexOf("export async function createSquareCheckout"));

  it("stamps the idempotency key onto the row it inserts", () => {
    const insert = body.slice(body.indexOf('.from("payments")'));
    expect(insert.slice(0, 500)).toMatch(/square_idempotency_key:\s*idempotencyKey/);
  });

  it("derives the key BEFORE the row, so both describe the same checkout", () => {
    const keyAt = body.indexOf("const idempotencyKey");
    const insertAt = body.indexOf('.from("payments")');
    expect(keyAt).toBeGreaterThan(-1);
    expect(keyAt).toBeLessThan(insertAt);
  });

  it("treats a unique violation as a retry, not a failure", () => {
    // 23505 here means "this exact checkout already has a row". Failing would
    // turn an ordinary double-click into a customer-visible error.
    expect(body).toMatch(/PG_UNIQUE_VIOLATION/);
    const conflict = body.slice(body.indexOf("PG_UNIQUE_VIOLATION"));
    expect(conflict.slice(0, 700)).toMatch(/square_idempotency_key["']?\s*,\s*idempotencyKey/);
  });

  it("adopts the existing row rather than inserting a second", () => {
    const conflict = body.slice(body.indexOf("PG_UNIQUE_VIOLATION"));
    const region = conflict.slice(0, 900);
    expect(region).toMatch(/paymentRowId\s*=\s*String\(existing\.id\)/);
    // Crucially there must be no second insert on this path.
    expect(region).not.toMatch(/\.insert\(/);
  });

  it("refuses to re-issue a link for a checkout that already settled", () => {
    // Adopting a Completed row would hand the customer a second live link for
    // money we already have — they would pay twice, and the second collection
    // would have no charge left to allocate against.
    const conflict = body.slice(body.indexOf("PG_UNIQUE_VIOLATION"));
    expect(conflict.slice(0, 1400)).toMatch(/square_payment_already_settled/);
    expect(conflict.slice(0, 1400)).toMatch(/!==\s*["']Pending["']/);
  });
});

describe("a dead attempt releases its key", () => {
  const body = adapter();

  it("clears the key when the Square call throws", () => {
    // Otherwise the unique index adopts this failed row on the operator's next
    // attempt, and the "already settled" guard refuses a checkout that never
    // happened — turning a transient network error into a permanent block.
    const c = body.slice(body.indexOf("} catch (err)"));
    expect(c.slice(0, 900)).toMatch(/square_idempotency_key:\s*null/);
    expect(c.slice(0, 900)).toMatch(/status:\s*["']Failed["']/);
  });

  it("clears the key when the handles cannot be written back", () => {
    const back = body.slice(body.indexOf("square_handle_persist_failed") - 2200);
    expect(back).toMatch(/square_idempotency_key:\s*null/);
  });

  it("only ever releases a row still Pending", () => {
    // A concurrent webhook may have completed it in between. Overwriting that
    // would erase a real collection.
    const c = body.slice(body.indexOf("} catch (err)"));
    expect(c.slice(0, 900)).toMatch(/\.eq\(["']status["'],\s*["']Pending["']\)/);
  });
});

describe("an uncorrelatable link is revoked, not merely reported", () => {
  const body = adapter();

  it("calls voidSquarePaymentLink instead of asking a human to", () => {
    // Anchored on CODE, not on the section comment: codeOnly() strips comments,
    // so a comment anchor silently yields an empty region and the assertion
    // passes or fails for the wrong reason.
    const region = body.slice(
      body.indexOf("payment_link ?? {}"),
      body.indexOf("square_handle_persist_failed") + 900,
    );
    // The old code told the operator to "void it in the Square dashboard" — a
    // manual step, in a console they may not have open, while the link stays
    // payable the entire time.
    expect(region).toMatch(/voidSquarePaymentLink\(/);
    expect(region).toMatch(/linkRevoked/);
  });

  it("reports honestly when the revoke itself fails", () => {
    const region = body.slice(body.indexOf("square_handle_persist_failed"));
    expect(region.slice(0, 900)).toMatch(/could NOT be revoked/);
  });
});
