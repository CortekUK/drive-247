// =============================================================================
// integrations/bonzah — what a cancelled or rejected rental does to its cover.
//
// LAYER 3. No network: the Bonzah client is mocked and Supabase is an in-memory
// fake. Always runs.
//
// THE INCIDENT
// ------------
// 2026-11-11, Moore Luxe, R-57f385. The booking was rejected while its PAI quote
// was still unpaid. reject-rental never looked at Bonzah, so the quote stayed
// retryable; the portal still showed "Retry" on the cancelled rental; twelve
// minutes later one tap issued live policy BORD2026111101000058 and took $6.90
// from the operator's Bonzah wallet for a car that never left.
//
// These tests pin the shared helper that reject-rental and cancel-rental-refund
// now both call, and the rule bonzah-confirm-payment enforces.
// =============================================================================

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const bonzahCalls: { path: string; body: any }[] = [];
let bonzahRefuses = false;

vi.mock("../../../supabase/functions/_shared/bonzah-client.ts", () => ({
  getTenantBonzahCredentials: async () => ({ username: "u", password: "p", mode: "live" }),
  bonzahFetchWithCredentials: async (path: string, body: any) => {
    bonzahCalls.push({ path, body });
    if (bonzahRefuses) throw new Error("Bonzah: endorsement not allowed");
    return { status: 0, data: {} };
  },
}));

import {
  cancelBonzahPoliciesForRental,
  bonzahCancellationWarning,
  isRentalClosedForInsurance,
} from "../../../supabase/functions/_shared/bonzah-rental-cancellation";
import { isRentalClosedForInsurance as portalIsClosed } from "../../../apps/portal/src/lib/bonzah-rental-closed";

type Row = Record<string, any>;

/** Just enough of the supabase-js query builder for the helper. */
function fakeSupabase(policies: Row[], tenant: Row = { id: "t", timezone: "America/Chicago" }) {
  const from = (table: string) => {
    const filters: [string, string, any][] = [];
    let patch: Row | null = null;
    const rows = () => (table === "tenants" ? [tenant] : policies);
    const matches = (r: Row) =>
      filters.every(([op, col, v]) => (op === "eq" ? r[col] === v : (v as any[]).includes(r[col])));
    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => (filters.push(["eq", c, v]), b),
      in: (c: string, v: any[]) => (filters.push(["in", c, v]), b),
      update: (p: Row) => ((patch = p), b),
      maybeSingle: async () => ({ data: rows().find(matches) ?? null, error: null }),
      then: (res: any, rej: any) => {
        const hit = rows().filter(matches);
        if (patch) hit.forEach((r) => Object.assign(r, patch));
        return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { from };
}

const rentalId = "57f385e2-ee7e-4683-8840-367340dd9fac";
const policy = (over: Row): Row => ({
  id: crypto.randomUUID(),
  rental_id: rentalId,
  policy_id: null,
  policy_no: null,
  premium_amount: 6.9,
  ...over,
});

beforeEach(() => {
  bonzahCalls.length = 0;
  bonzahRefuses = false;
});

describe("bonzah: which rentals are closed for insurance", () => {
  it.each([
    [{ status: "Cancelled", approval_status: "rejected" }, true],
    [{ status: "Cancelled", approval_status: null }, true],
    [{ status: "Pending", approval_status: "rejected" }, true],
    [{ status: "Pending", approval_status: "pending" }, false],
    [{ status: "Active" }, false],
    [{ status: "Closed" }, false],
    [null, false],
  ])("%j -> %s (server and portal agree)", (rental, closed) => {
    expect(isRentalClosedForInsurance(rental as any)).toBe(closed);
    expect(portalIsClosed(rental as any)).toBe(closed);
  });
});

describe("bonzah: cancelling a rental's policies", () => {
  it("R-57f385: an unpaid quote is closed locally, so it can never be retried", async () => {
    const quote = policy({ status: "quoted" });
    const r = await cancelBonzahPoliciesForRental(fakeSupabase([quote]), {
      rentalId,
      tenantId: "t",
      reason: "rejected_by_admin",
    });
    expect(quote.status).toBe("cancelled");
    expect(r.cancelled).toHaveLength(1);
    expect(r.cancelled[0].wasIssued).toBe(false);
    expect(bonzahCalls).toHaveLength(0); // nothing exists at Bonzah to cancel
    expect(bonzahCancellationWarning(r)).toBeNull();
  });

  it.each(["payment_pending", "failed", "insufficient_balance"])("a %s row is closed locally too", async (status) => {
    const row = policy({ status });
    await cancelBonzahPoliciesForRental(fakeSupabase([row]), { rentalId, tenantId: "t", reason: "x" });
    expect(row.status).toBe("cancelled");
    expect(bonzahCalls).toHaveLength(0);
  });

  it("an issued policy is cancelled AT Bonzah, in the tenant's timezone, before it is marked cancelled", async () => {
    const live = policy({ status: "active", policy_id: "P000000167740", policy_no: "BORD2026111101000058" });
    const r = await cancelBonzahPoliciesForRental(fakeSupabase([live]), { rentalId, tenantId: "t", reason: "Booking rejected" });
    expect(bonzahCalls).toEqual([
      expect.objectContaining({
        path: "/Bonzah/newendorse_cncl",
        body: expect.objectContaining({ policy_id: "P000000167740", endo_booking_time_zone: "America/Chicago", finalize: 1 }),
      }),
    ]);
    expect(live.status).toBe("cancelled");
    expect(r.cancelled[0].wasIssued).toBe(true);
  });

  it("a policy Bonzah REFUSES to cancel stays active and is reported by number", async () => {
    bonzahRefuses = true;
    const live = policy({ status: "active", policy_id: "P1", policy_no: "BORD-1" });
    const r = await cancelBonzahPoliciesForRental(fakeSupabase([live]), { rentalId, tenantId: "t", reason: "x" });
    expect(live.status).toBe("active");
    expect(r.failures).toEqual([{ policyNo: "BORD-1", error: expect.stringContaining("not allowed") }]);
    expect(bonzahCancellationWarning(r)).toContain("BORD-1");
  });

  it("paid-but-unissued (payment_confirmed) is left alone and flagged for a person", async () => {
    const paid = policy({ status: "payment_confirmed" });
    const r = await cancelBonzahPoliciesForRental(fakeSupabase([paid]), { rentalId, tenantId: "t", reason: "x" });
    expect(paid.status).toBe("payment_confirmed");
    expect(r.needsManualReview).toHaveLength(1);
    expect(bonzahCancellationWarning(r)).toMatch(/need checking/);
  });

  it("cancelled and other rentals' rows are untouched", async () => {
    const done = policy({ status: "cancelled" });
    const other = policy({ status: "quoted", rental_id: "someone-else" });
    const r = await cancelBonzahPoliciesForRental(fakeSupabase([done, other]), { rentalId, tenantId: "t", reason: "x" });
    expect(other.status).toBe("quoted");
    expect(r.cancelled).toHaveLength(0);
  });
});

describe("bonzah: every exit path uses the helper, and confirm-payment refuses closed rentals", () => {
  const repo = resolve(__dirname, "../../..");
  const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

  it.each(["reject-rental", "cancel-rental-refund"])("%s calls cancelBonzahPoliciesForRental", (fn) => {
    expect(read(`supabase/functions/${fn}/index.ts`)).toMatch(/cancelBonzahPoliciesForRental\(/);
  });

  it("bonzah-confirm-payment checks the rental before any Bonzah call", () => {
    const src = read("supabase/functions/bonzah-confirm-payment/index.ts");
    const guard = src.indexOf("isRentalClosedForInsurance(rentalState)");
    const firstSpend = src.indexOf("processSinglePayment(supabase, policy, credentials)");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(firstSpend);
    expect(src).toMatch(/code: 'rental_cancelled'/);
  });
});
