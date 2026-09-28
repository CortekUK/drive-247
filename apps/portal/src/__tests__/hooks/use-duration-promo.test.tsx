/**
 * Long-rental discounts reach a booking the staff take over the phone.
 *
 * Moore Luxe's agent was with a customer on a four-day rental. Their LUXE code
 * gives 12.5% at 4+ days, the rental qualified exactly, and the portal would
 * not put it on — it hid the code from the picker and told her it "applies
 * automatically". It did not: the auto-apply only ever existed on the customer
 * booking site, and this tenant takes every booking in the portal. Not one
 * rental they had ever written carried a promo code. The deal had never worked,
 * for anyone, since the day it was created.
 *
 * The rules are worth stating because each one is a way to get this wrong:
 *
 *   - the BEST qualifying tier wins, not the first row back;
 *   - a code the agent typed is never overwritten by an automatic one;
 *   - the discount is withdrawn again if the booking stops qualifying, so a
 *     shortened rental cannot keep a discount it no longer earns;
 *   - instalments withdraw it, because the booking site does the same and two
 *     screens that disagree price one rental two ways;
 *   - an expired or fully-claimed tier falls through to the next one down
 *     rather than cancelling the discount outright.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

type Row = {
  id: string;
  code: string;
  type: string;
  value: number;
  expires_at: string | null;
  min_duration_days: number | null;
  max_duration_days?: number | null;
  max_users: number | null;
};

/** The tenant's real ladder, as configured: 12.5% at 4 days, 14.28% at 7. */
const LUXE: Row = {
  id: "luxe", code: "LUXE", type: "percentage", value: 12.5,
  expires_at: "2027-11-30", min_duration_days: 4, max_users: 10000,
};
/** The same ladder once Moore Luxe capped each tier at its own length. */
const LUXE_EXACT: Row = { ...LUXE, max_duration_days: 4 };
const WEEK: Row = {
  id: "week", code: "WEEK", type: "percentage", value: 14.28,
  expires_at: "2027-09-03", min_duration_days: 7, max_users: 1000,
};
const WEEK_EXACT: Row = { ...WEEK, max_duration_days: 7 };

let tiers: Row[] = [];
/** promo code -> how many rentals already carry it. */
let redemptions: Record<string, number> = {};
let countFails = false;

vi.mock("@/integrations/supabase/client", () => ({
  supabaseUntyped: {
    from: (table: string) => {
      if (table === "rentals") {
        const chain: Record<string, unknown> = {};
        let code = "";
        chain.select = () => chain;
        chain.eq = (col: string, val: string) => {
          if (col === "promo_code") code = val;
          return chain;
        };
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve(
            countFails
              ? { count: null, error: { message: "boom" } }
              : { count: redemptions[code] ?? 0, error: null },
          ).then(resolve);
        return chain;
      }

      // promocodes: filter the ladder exactly as the query does.
      const chain: Record<string, unknown> = {};
      let maxDays = Infinity;
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.gt = () => chain;
      chain.lte = (_col: string, v: number) => { maxDays = v; return chain; };
      chain.order = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => {
        const rows = tiers
          .filter((t) => (t.min_duration_days ?? 0) > 0 && (t.min_duration_days ?? 0) <= maxDays)
          .sort((a, b) => (b.min_duration_days ?? 0) - (a.min_duration_days ?? 0));
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      };
      return chain;
    },
  },
}));

import { useDurationPromo, type AppliedPromo } from "@/hooks/use-duration-promo";

/** Drives the hook the way a create screen does: it owns the promo state. */
function harness(initial: AppliedPromo | null = null) {
  let promo = initial;
  const setPromo = vi.fn((next: AppliedPromo | null) => { promo = next; });
  const render = (days: number, payInFull = true) =>
    renderHook(
      ({ d, f }: { d: number; f: boolean }) =>
        useDurationPromo({
          tenantId: "tenant-1", rentalDays: d, payInFull: f, promo, setPromo,
        }),
      { initialProps: { d: days, f: payInFull } },
    );
  return { render, setPromo, get promo() { return promo; } };
}

/** Let the tier query and its effect resolve, so a "nothing happened"
    assertion is made AFTER the work rather than before it. */
const settle = () => new Promise((r) => setTimeout(r, 25));

beforeEach(() => {
  tiers = [LUXE, WEEK];
  redemptions = {};
  countFails = false;
});

describe("a long rental gets its discount in the portal", () => {
  it("applies LUXE to the four-day booking that started this", async () => {
    const h = harness();
    h.render(4);
    await waitFor(() => expect(h.setPromo).toHaveBeenCalled());
    expect(h.promo).toMatchObject({ code: "LUXE", value: 12.5, type: "percentage", source: "duration" });
  });

  it("gives a three-day booking nothing, because it does not qualify", async () => {
    const h = harness();
    h.render(3);
    // Nothing applied, and nothing to clear.
    await waitFor(() => expect(h.setPromo).not.toHaveBeenCalledWith(expect.objectContaining({ code: "LUXE" })));
    expect(h.promo).toBeNull();
  });

  it("takes the BEST tier, not the first row back", async () => {
    const h = harness();
    h.render(9); // qualifies for both; WEEK is worth more
    await waitFor(() => expect(h.setPromo).toHaveBeenCalled());
    expect(h.promo).toMatchObject({ code: "WEEK" });
  });
});

describe("it never takes a decision away from the agent", () => {
  it("leaves a typed code alone", async () => {
    const typed: AppliedPromo = {
      id: "manual-1", code: "STAFF10", type: "percentage", value: 10, source: "manual",
    };
    const h = harness(typed);
    h.render(9); // WEEK would otherwise win
    await new Promise((r) => setTimeout(r, 30));
    expect(h.setPromo).not.toHaveBeenCalled();
    expect(h.promo).toBe(typed);
  });

  it("leaves a promo with no source alone, because it is not ours", async () => {
    // A promo restored from a saved draft carries no source. Reading that as
    // "not ours" is the safe way round — the worst case is an automatic
    // discount left in place, never a typed one silently replaced.
    const restored: AppliedPromo = { id: "draft", code: "DRAFT", type: "percentage", value: 5 };
    const h = harness(restored);
    h.render(9);
    await new Promise((r) => setTimeout(r, 30));
    expect(h.promo).toBe(restored);
  });
});

describe("it withdraws the discount when the booking stops earning it", () => {
  it("drops it when the rental is shortened below the tier", async () => {
    const h = harness({ id: "luxe", code: "LUXE", type: "percentage", value: 12.5, source: "duration" });
    h.render(2);
    await waitFor(() => expect(h.setPromo).toHaveBeenCalledWith(null));
  });

  it("drops it when an instalment plan is chosen", async () => {
    // The booking site withdraws duration tiers on instalments. If the two
    // disagree, one rental is priced two ways depending on who entered it.
    const h = harness({ id: "luxe", code: "LUXE", type: "percentage", value: 12.5, source: "duration" });
    h.render(4, false);
    await waitFor(() => expect(h.setPromo).toHaveBeenCalledWith(null));
  });
});

describe("a tier that cannot be granted falls through to the next", () => {
  it("skips an expired tier and applies the one below", async () => {
    tiers = [LUXE, { ...WEEK, expires_at: "2020-01-01" }];
    const h = harness();
    h.render(9);
    await waitFor(() => expect(h.setPromo).toHaveBeenCalled());
    expect(h.promo).toMatchObject({ code: "LUXE" });
  });

  it("skips a fully-claimed tier and applies the one below", async () => {
    redemptions = { WEEK: 1000 }; // at its max_users
    const h = harness();
    h.render(9);
    await waitFor(() => expect(h.setPromo).toHaveBeenCalled());
    expect(h.promo).toMatchObject({ code: "LUXE" });
  });

  it("does not hand out a capped tier when the count itself fails", async () => {
    // The booking site counts `invoices.promo_code`, a column that does not
    // exist, so its cap has never fired. A failed count here must not read as
    // "nobody has used it".
    countFails = true;
    const h = harness();
    h.render(9);
    await new Promise((r) => setTimeout(r, 30));
    expect(h.promo).toBeNull();
  });
});

describe("both create screens use it", () => {
  it("is wired into the v2 screen and the v1 page alike", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const root = resolve(__dirname, "../..");
    for (const f of [
      "components/rentals-v2/rental-create-v2.tsx",
      "app/(dashboard)/rentals/new/page.tsx",
    ]) {
      const s = readFileSync(resolve(root, f), "utf8");
      expect(s).toContain("useDurationPromo({");
      // The half that already existed: typed duration codes are refused. It is
      // only correct while the automatic half is present too.
      expect(s).toContain("min_duration_days");
      expect(s).toContain("source: 'manual'");
    }
  });
});

/*
 * FIXED-LENGTH PACKAGES.
 *
 * Reported 29 Sep 2026, once the fix above had made duration codes work in the
 * portal at all: "Why is it a 12.5% discount on a regular five day — there
 * should be no promotion for a five day". `min_duration_days` is only a floor,
 * so LUXE (4) was collecting every 5- and 6-day rental on its way up to WEEK.
 *
 * The numbers say these were always meant as packages, not a scale: 12.5% of
 * four days is half a day free, 14.28% of seven is exactly one day free.
 * `max_duration_days` is the ceiling that makes that expressible.
 */
describe("a tier can be capped to an exact length", () => {
  beforeEach(() => {
    tiers = [LUXE_EXACT, WEEK_EXACT];
  });

  it("still applies on the exact day the package is sold for", async () => {
    const h = harness();
    h.render(4);
    await waitFor(() => expect(h.setPromo).toHaveBeenCalled());
    expect(h.promo).toMatchObject({ code: "LUXE", value: 12.5 });
  });

  it("gives the five-day rental NOTHING — the report that prompted this", async () => {
    const h = harness();
    h.render(5);
    /* A bare `not.toHaveBeenCalled` passes before the effect has even run, which
       would make this test green with the ceiling deleted. Wait for the query to
       resolve first — the control case above proves that path fires — and only
       then assert nothing was applied. */
    await settle();
    expect(h.setPromo).not.toHaveBeenCalled();
    expect(h.promo).toBeNull();
  });

  it("does not quietly fall through to a lower tier at six days", async () => {
    const h = harness();
    h.render(6);
    await settle();
    expect(h.setPromo).not.toHaveBeenCalled();
    expect(h.promo).toBeNull();
  });

  it("applies WEEK on exactly seven", async () => {
    const h = harness();
    h.render(7);
    await waitFor(() => expect(h.setPromo).toHaveBeenCalled());
    expect(h.promo).toMatchObject({ code: "WEEK", value: 14.28 });
  });

  it("gives an eight-day rental nothing once the week is capped too", async () => {
    const h = harness();
    h.render(8);
    await settle();
    expect(h.setPromo).not.toHaveBeenCalled();
    expect(h.promo).toBeNull();
  });

  it("withdraws a tier the booking has outgrown", async () => {
    const h = harness({ id: "luxe", code: "LUXE", type: "percentage", value: 12.5, source: "duration" });
    h.render(5);
    await waitFor(() => expect(h.setPromo).toHaveBeenCalledWith(null));
    expect(h.promo).toBeNull();
  });
});

describe("an uncapped tier keeps meaning \"or more\"", () => {
  it("leaves every existing tenant's ladder exactly as it was", async () => {
    // tiers is [LUXE, WEEK] from the outer beforeEach — neither has a ceiling.
    const h = harness();
    h.render(5);
    await waitFor(() => expect(h.setPromo).toHaveBeenCalled());
    expect(h.promo).toMatchObject({ code: "LUXE" });
  });

  it("caps only the tier that carries a ceiling, not its neighbours", async () => {
    tiers = [LUXE_EXACT, WEEK]; // 4 exactly, then 7+
    const h = harness();
    h.render(9);
    await waitFor(() => expect(h.setPromo).toHaveBeenCalled());
    expect(h.promo).toMatchObject({ code: "WEEK" });
  });
});
