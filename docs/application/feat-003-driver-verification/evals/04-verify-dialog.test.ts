import { describe, expect, it } from "vitest";
import { displayTotal, type PriceListRow } from "../../../../supabase/functions/_shared/verification/pricing";

// Spec 04 · the total on screen 1. The 5 rows of the Worked examples table, worked by hand.

const ROWS: PriceListRow[] = [
  { key: "standard", kind: "free", provider_cost_cents: 33, margin_cents: 0, has_state_fee: false },
  { key: "licence_status", kind: "premium", provider_cost_cents: 299, margin_cents: 50, has_state_fee: true },
];

describe("04 the total for one customer", () => {
  it.each([
    [1, ["standard"], {}, "Free", false],
    [2, ["standard", "licence_status"], {}, "from $3.49", true],
    [3, ["standard", "licence_status"], { licence_status: 0 }, "$3.49", false],
    [4, ["standard", "licence_status"], { licence_status: 800 }, "$11.49", false],
    [5, ["standard", "licence_status"], {}, "from $3.49", true],
  ] as Array<[number, string[], Record<string, number>, string, boolean]>)(
    "04.12 #%i shows the expected total",
    (_row, ticked, fees, label, from) => {
      const t = displayTotal(ROWS, ticked, fees);
      expect(t.label).toBe(label);
      expect(t.from).toBe(from);
      expect(Number.isInteger(t.cents)).toBe(true);
    },
  );

  it("04.10 a premium price is provider cost plus margin, as dollars", () => {
    expect(displayTotal(ROWS, ["licence_status"], { licence_status: 0 }).cents).toBe(349);
  });

  it("04.11 a known state fee is added; an unknown one makes it 'from'", () => {
    expect(displayTotal(ROWS, ["licence_status"], { licence_status: 2500 }).label).toBe("$28.49");
    expect(displayTotal(ROWS, ["licence_status"], {}).label).toBe("from $3.49");
  });
});
