import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanBonzahText,
  resolveBonzahRenterName,
} from "../../../supabase/functions/_shared/bonzah-renter-name";

const repo = resolve(__dirname, "../../..");

describe("cleanBonzahText", () => {
  it("turns a curly apostrophe straight, because Bonzah refuses it in a name", () => {
    expect(cleanBonzahText("O’Brien")).toBe("O'Brien");
  });

  it("keeps a straight apostrophe, which Bonzah accepts", () => {
    expect(cleanBonzahText("O'Brien")).toBe("O'Brien");
  });

  it("removes accents and extra spaces", () => {
    expect(cleanBonzahText("  José   Nuñez ")).toBe("Jose Nunez");
  });

  it("copes with missing values", () => {
    expect(cleanBonzahText(null)).toBe("");
    expect(cleanBonzahText(undefined)).toBe("");
  });
});

describe("resolveBonzahRenterName", () => {
  it("keeps a real name as sent", () => {
    expect(resolveBonzahRenterName({ firstName: "Ann", lastName: "Lee" })).toEqual({
      ok: true,
      firstName: "Ann",
      lastName: "Lee",
      source: "request",
    });
  });

  it("does not treat the surname Na as a placeholder", () => {
    expect(resolveBonzahRenterName({ firstName: "Min", lastName: "Na" }).ok).toBe(true);
  });

  it.each([
    ["N/A", "the portal's fallback"],
    ["", "an empty value"],
    ["Ann", "booking's repeated first name"],
  ])("refuses last name %j (%s) when nothing better is on file", (lastName) => {
    expect(
      resolveBonzahRenterName({ firstName: "Ann", lastName, customerName: "Ann" }),
    ).toEqual({ ok: false, displayName: "Ann" });
  });

  it("finds the name behind unfinished verifications (R-7ecc5b)", () => {
    expect(
      resolveBonzahRenterName({
        firstName: "Ivita",
        lastName: "N/A",
        customerName: "Ivita",
        verifications: [
          { first_name: null, last_name: null, review_result: null },
          { first_name: null, last_name: null, review_result: null },
          { first_name: "IVITA LYNN", last_name: "COX", review_result: "RETRY" },
        ],
      }),
    ).toEqual({ ok: true, firstName: "IVITA LYNN", lastName: "COX", source: "verification" });
  });

  it("prefers a passed verification over a newer one that did not pass", () => {
    const result = resolveBonzahRenterName({
      firstName: "Ann",
      lastName: "N/A",
      verifications: [
        { first_name: "Wrong", last_name: "Read", review_result: "RETRY" },
        { first_name: "Ann", last_name: "Lee", review_result: "GREEN" },
      ],
    });
    expect(result).toMatchObject({ firstName: "Ann", lastName: "Lee" });
  });

  it("never uses the name from a failed verification", () => {
    expect(
      resolveBonzahRenterName({
        firstName: "Ann",
        lastName: "N/A",
        customerName: "Ann",
        verifications: [{ first_name: "Other", last_name: "Person", review_result: "RED" }],
      }).ok,
    ).toBe(false);
  });

  it("uses the customer profile once the full name has been added", () => {
    expect(
      resolveBonzahRenterName({ firstName: "Ann", lastName: "N/A", customerName: "Ann Marie Lee" }),
    ).toEqual({ ok: true, firstName: "Ann", lastName: "Marie Lee", source: "customer" });
  });
});

describe("bonzah-create-quote", () => {
  const src = readFileSync(join(repo, "supabase/functions/bonzah-create-quote/index.ts"), "utf8");

  it("resolves the name before it contacts Bonzah", () => {
    expect(src.indexOf("renter_name_incomplete")).toBeGreaterThan(-1);
    expect(src.indexOf("renter_name_incomplete")).toBeLessThan(
      src.indexOf("getTenantBonzahCredentials(supabase, body.tenant_id)"),
    );
  });

  it("does not log renter details when Bonzah returns no payment_id", () => {
    const block = src.slice(
      src.indexOf("No payment_id returned"),
      src.indexOf("Bonzah did not finalize the quote"),
    );
    expect(block).not.toMatch(/(first_name|last_name|dob|number): body\.renter/);
  });
});
