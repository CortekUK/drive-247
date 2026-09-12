/**
 * RENTAL CREATION — the first step of the team lead's spine. Layer 1, offline.
 *
 * His instruction was to keep this narrow: "right now you only have to write on
 * rental create. The whole customer system we'll come to separately." And: build
 * a basic payload with one car and one customer, and "assume that it's verified".
 * So nothing here tests customer verification, and nothing tests extensions,
 * auto-extension, pay-as-you-go or installments.
 *
 * Everything below is asserted against SHIPPED SOURCE — the two insert paths and
 * the SQL of the overlap trigger — because the rental row is written from inside
 * React components and a Postgres trigger, neither of which can be imported into
 * a Node test. Same idiom as tests/helpers/edge-contract.ts.
 *
 * Every claim in this file was verified by reading the source, not taken from a
 * summary.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = (p: string) => resolve(__dirname, "../../../", p);

const PORTAL_NEW = readFileSync(root("apps/portal/src/app/(dashboard)/rentals/new/page.tsx"), "utf8");
const BOOKING_CHECKOUT = readFileSync(root("apps/booking/src/components/BookingCheckoutStep.tsx"), "utf8");
const OVERLAP_SQL = readFileSync(
  root("supabase/migrations/20260418120000_fix_rental_overlap_trigger_for_extensions.sql"),
  "utf8",
);

// @usecase Two rentals on one vehicle for the same window means one renter
// arrives to find no car. The trigger is the only thing preventing it, so its
// blind spots are the risk.
describe("rental create — the vehicle double-booking guard", () => {
  it("refuses a second rental for the same vehicle over an overlapping window", () => {
    // The guard is a BEFORE trigger raising 23P01 (exclusion_violation), not a
    // client-side check — so it holds however the row arrives.
    expect(OVERLAP_SQL).toContain("Vehicle rental overlap");
    expect(OVERLAP_SQL).toContain("ERRCODE = '23P01'");
    expect(OVERLAP_SQL).toMatch(/SELECT\s+1\s+FROM\s+rentals/i);
  });

  it("ignores rentals that are Cancelled, Rejected or Closed when looking for a clash", () => {
    // A finished or abandoned rental must not block the vehicle forever.
    expect(OVERLAP_SQL).toMatch(/status\s+NOT\s+IN\s*\(\s*'Cancelled'\s*,\s*'Rejected'\s*,\s*'Closed'\s*\)/i);
  });

  it("treats an open-ended rental as occupying the vehicle until the end of time", () => {
    // COALESCE(end_date, '9999-12-31') on both sides: a PAYG rental with a NULL
    // end_date must not read as a zero-length booking that blocks nothing.
    expect(OVERLAP_SQL).toContain("COALESCE(NEW.end_date, '9999-12-31'::date)");
    expect(OVERLAP_SQL).toContain("COALESCE(end_date, '9999-12-31'::date)");
  });

  it("lets an extension push its own end date out without clashing with itself", () => {
    // On an end-date-only UPDATE the window checked starts at the OLD end date,
    // so the rental being extended is not compared against its own original span.
    expect(OVERLAP_SQL).toContain("check_start := OLD.end_date");
    expect(OVERLAP_SQL).toContain("NEW.end_date > OLD.end_date");
  });

  it("cannot see a rental whose status is NULL, so such a rental blocks nothing", () => {
    /**
     * DEFECT, from SQL three-valued logic at the `status NOT IN (...)` predicate.
     *
     * When `status IS NULL`, `NULL NOT IN ('Cancelled','Rejected','Closed')`
     * evaluates to NULL — not TRUE. A NULL row therefore fails the WHERE clause and
     * is excluded from the EXISTS, so a rental with no status DOES NOT BLOCK a
     * double-booking of its vehicle.
     *
     * The column has no NOT NULL constraint in this migration, so the only thing
     * preventing it is that both insert paths happen to set status explicitly
     * (asserted below). Any third writer — a script, a backfill, an import — that
     * omits status creates an invisible rental.
     *
     * Pinned here; the correct fix is asserted in the `.fails` test that follows.
     */
    expect(OVERLAP_SQL).toMatch(/status\s+NOT\s+IN/i);
    expect(OVERLAP_SQL).not.toMatch(/status\s+IS\s+DISTINCT\s+FROM/i);
    expect(OVERLAP_SQL).not.toMatch(/COALESCE\s*\(\s*status/i);
  });

  it.fails("should guard the status comparison against NULL", () => {
    // Remove the `.fails` marker once the predicate is NULL-safe, e.g.
    //   COALESCE(status, '') NOT IN ('Cancelled','Rejected','Closed')
    // or a NOT NULL constraint on rentals.status.
    const nullSafe =
      /COALESCE\s*\(\s*status/i.test(OVERLAP_SQL) ||
      /status\s+IS\s+DISTINCT\s+FROM/i.test(OVERLAP_SQL) ||
      /status\s+IS\s+NULL\s+OR/i.test(OVERLAP_SQL);
    expect(nullSafe).toBe(true);
  });

  it("takes no lock, so two simultaneous bookings of one vehicle can both commit", () => {
    /**
     * DEFECT: the trigger is a read-then-write check. Under READ COMMITTED, two
     * concurrent transactions inserting overlapping rentals for the same vehicle
     * each run the EXISTS before either commits, so neither sees the other and both
     * succeed. There is no SELECT ... FOR UPDATE, no advisory lock, and no
     * exclusion CONSTRAINT backing it.
     *
     * This is a genuine race, but it needs two concurrent transactions to
     * demonstrate and cannot be proven from source alone — so this test asserts
     * only the ABSENCE of any locking mechanism, which is the part that is
     * checkable offline. The real fix is a Postgres EXCLUDE constraint using a
     * daterange, which the database enforces atomically.
     */
    expect(OVERLAP_SQL).not.toMatch(/FOR\s+UPDATE/i);
    expect(OVERLAP_SQL).not.toMatch(/pg_advisory/i);
    expect(OVERLAP_SQL).not.toMatch(/EXCLUDE\s+USING/i);
  });
});

// @usecase RLS is off on the core tables, so tenant isolation and correct
// dates are entirely the application's job at insert time. A row written wrong
// here is wrong forever.
describe("rental create — the row both paths write", () => {
  it("stamps tenant_id on the portal insert, because RLS is off on this table", () => {
    /**
     * RLS is disabled on the core tables, so tenant isolation is entirely the
     * application's job. A rental inserted without tenant_id is unreachable by
     * its own tenant and visible to queries that forget to filter.
     *
     * Asserted against the RENTAL payload specifically, not the file as a whole.
     * `tenant_id: tenant?.id` appears SEVEN times in this file — for the rental,
     * a P&L entry, a reminder and an invoice among others — so a bare
     * `toContain` stays green while the rental's own stamp is removed. Mutation
     * testing caught exactly that: replacing the rental's with `tenant_id: null`
     * failed to turn a single test red.
     *
     * The rental payload is identified by `source: "portal"`, which is unique to
     * it, and the window is the object literal around that marker.
     */
    const marker = PORTAL_NEW.indexOf('source: "portal"');
    expect(marker, 'the rental payload marker source: "portal" has moved').toBeGreaterThan(-1);
    const payload = PORTAL_NEW.slice(marker - 1200, marker + 1200);
    expect(payload, "the RENTAL insert itself must carry tenant_id").toContain("tenant_id: tenant?.id");
  });

  it("never writes a null tenant_id on any insert in the rental-creation path", () => {
    // The broader form of the same guard: nothing on this path may opt out of
    // tenant scoping, however the value is spelled.
    expect(PORTAL_NEW).not.toMatch(/tenant_id:\s*null/);
    expect(PORTAL_NEW).not.toMatch(/tenant_id:\s*undefined/);
  });

  it("sets an explicit status on both insert paths rather than leaving it NULL", () => {
    // This is what currently saves the overlap guard above from its NULL blind
    // spot, which is why it is asserted rather than assumed.
    expect(PORTAL_NEW).toContain('status: "Pending"');
    expect(BOOKING_CHECKOUT).toContain('status: "Pending"');
  });

  it("stores an open-ended pay-as-you-go rental with a null end_date", () => {
    expect(PORTAL_NEW).toMatch(/end_date:\s*isPayAsYouGo\s*\?\s*null/);
  });

  it("formats the picker date with format(), never toISOString(), on the portal path", () => {
    // toISOString() on a picker Date saves a day EARLY for staff east of UTC
    // (e.g. Manila). The comment in source records that this was a real bug.
    expect(PORTAL_NEW).toMatch(/start_date:\s*format\(data\.start_date,\s*'yyyy-MM-dd'\)/);
    expect(PORTAL_NEW).not.toMatch(/start_date:\s*[^,\n]*toISOString/);
  });

  it("has no dropoff_time column anywhere — the columns are pickup_time and return_time", () => {
    // A stale name that was renamed out; asserted so it cannot creep back in.
    expect(PORTAL_NEW).not.toContain("dropoff_time");
    expect(BOOKING_CHECKOUT).not.toContain("dropoff_time");
  });
});

// @usecase The same column holds an operator-entered monthly rate from the
// portal and a whole invoice total from the booking site. Anything that re-
// bills from it over-charges by the deposit and tax.
describe("rental create — rentals.monthly_amount means two different things", () => {
  /**
   * DEFECT (critical), verified by reading both writers.
   *
   *   apps/portal/.../rentals/new/page.tsx:  monthly_amount: data.monthly_amount
   *       -> the operator-entered MONTHLY RATE, straight off the form field.
   *
   *   apps/booking/.../BookingCheckoutStep.tsx: monthly_amount: grandTotal
   *       -> the WHOLE INVOICE, and its own comment says so:
   *          "Store grand total (rental + taxes + fees + protection)"
   *
   * One column, two incompatible meanings, discriminated only by which app
   * happened to create the row. Nothing reading `monthly_amount` can tell which
   * it is holding, and `source` ('portal' vs otherwise) is the only hint —
   * which makes every downstream consumer a guess.
   *
   * This matters most for anything that re-bills: charging a "monthly amount"
   * that is actually a grand total including a 500.00 deposit and tax would
   * over-charge the renter every cycle.
   *
   * Pinned so the collision is on the record and cannot be closed silently.
   */
  it("stores the operator-entered monthly rate when the portal creates the rental", () => {
    expect(PORTAL_NEW).toContain("monthly_amount: data.monthly_amount");
  });

  it("stores the entire invoice total when the booking site creates the rental", () => {
    expect(BOOKING_CHECKOUT).toMatch(/monthly_amount:\s*grandTotal/);
    expect(BOOKING_CHECKOUT).toContain("Store grand total");
  });

  it("offers no discriminator on the row itself beyond which app wrote it", () => {
    // `source: "portal"` is the only marker, and only one side sets it.
    expect(PORTAL_NEW).toContain('source: "portal"');
    expect(BOOKING_CHECKOUT).not.toMatch(/monthly_amount_kind|amount_semantics/);
  });
});

// @usecase Tier toggles and minimum durations are advisory in the widget and
// re-checked nowhere, so a booking the operator disabled is still written to
// the database.
describe("rental create — availability rules that are not enforced at insert", () => {
  /**
   * DEFECT. The vehicle tier-availability toggles (available_daily /
   * available_weekly / available_monthly) and the tenant minimum duration
   * (min_rental_hours / min_rental_days) are NOT consulted on the customer insert
   * path. Verified by absence: zero references in BookingCheckoutStep.tsx.
   *
   * So a renter reaching checkout with a duration the operator disabled — or
   * shorter than the tenant's stated minimum — has the rental written anyway.
   * Whatever filtering happens earlier in the widget is advisory: it is not
   * re-checked at the point the row is created, and it is not enforced by the
   * database either.
   */
  it("does not check the vehicle tier-availability toggles on the customer path", () => {
    expect(BOOKING_CHECKOUT).not.toContain("available_daily");
    expect(BOOKING_CHECKOUT).not.toContain("available_weekly");
    expect(BOOKING_CHECKOUT).not.toContain("available_monthly");
  });

  it("does not check the tenant minimum rental duration on the customer path", () => {
    expect(BOOKING_CHECKOUT).not.toContain("min_rental_hours");
    expect(BOOKING_CHECKOUT).not.toContain("min_rental_days");
  });

  it.fails("should re-check tier availability where the rental row is written", () => {
    // Remove the `.fails` marker once the insert path validates the toggles.
    const checks =
      BOOKING_CHECKOUT.includes("available_daily") ||
      BOOKING_CHECKOUT.includes("available_weekly") ||
      BOOKING_CHECKOUT.includes("available_monthly");
    expect(checks).toBe(true);
  });
});
