import { describe, expect, it } from "vitest";
import { licenceValidThrough } from "../../../../supabase/functions/_shared/verification/rules";

// Spec 11 · licence expiry against the return date. Licence expires 10 Mar 2027.
const EXPIRY = "2027-03-10";

describe("11 licence valid through the return date", () => {
  it.each([
    [1, "2026-12-27", true],
    [2, "2027-03-10", true],
    [3, "2027-03-12", false],
    [4, "2027-03-15", false], // an extension from 5 Mar to 15 Mar
  ] as Array<[number, string, boolean]>)("11.4 #%i return %s: valid through it is %s", (_row, ret, valid) => {
    expect(licenceValidThrough(EXPIRY, ret)).toBe(valid);
  });

  it("11.5 an unknown expiry is never treated as valid", () => {
    expect(licenceValidThrough(null, "2027-01-01")).toBe(false);
  });
});
