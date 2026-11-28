import { describe, expect, it } from "vitest";
import {
  licenceTypeLine,
  nameLine,
  normaliseDocumentNumber,
  notExpiredLine,
  oldEnoughLine,
  standardOutcome,
  type Line,
} from "../../../../supabase/functions/_shared/verification/rules";

// Spec 07 · the standard check's own rules. Today = 29 Nov 2026 in every case.
const TODAY = "2026-11-29";

describe("07 the standard check's rules", () => {
  it.each([
    [1, "2005-11-29", "pass"],
    [2, "2005-11-30", "fail"],
    [3, "2004-02-29", "pass"],
    [4, null, "could_not_check"],
  ] as Array<[number, string | null, string]>)("07.16 #%i age rule, minimum 21", (_row, dob, result) => {
    expect(oldEnoughLine(dob, 21, TODAY).result).toBe(result);
  });

  it("07.16 a fail says the company's minimum; no minimum is not_set", () => {
    expect(oldEnoughLine("2005-11-30", 21, TODAY).reason).toBe("Under your minimum age of 21");
    expect(oldEnoughLine("2005-11-30", null, TODAY).result).toBe("not_set");
  });

  it.each([
    ["2026-11-29", "pass"],
    ["2026-11-28", "fail"],
    [null, "could_not_check"],
  ] as Array<[string | null, string]>)("07.15 expiry %s is %s", (expiry, result) => {
    expect(notExpiredLine(expiry, TODAY).result).toBe(result);
  });

  it("07.17 the name rule is the secondary-driver rule, and a fail shows both names", () => {
    expect(nameLine("Mike Hill", "Mike James", "Hill").result).toBe("pass");
    expect(nameLine("Michael Hill", "Michael James", "Hill").result).toBe("pass");
    const fail = nameLine("Mike Hill", "Michael James", "Hill");
    expect(fail.result).toBe("fail");
    expect(fail.reason).toBe("On file: Mike Hill. On the licence: Michael James Hill");
  });

  it.each([
    ["Driver's License", "TEXAS_DRIVER_LICENSE_GENERIC", "drivers_license", "pass"],
    ["Driver's License", "TEXAS_COMMERCIAL_DL", "drivers_license", "pass"],
    ["Driver's License", "FLORIDA_LEARNER_PERMIT_REAL_ID", "drivers_license", "fail"],
    ["Driver's License", "MARYLAND_PROVISIONAL_DL", "drivers_license", "fail"],
    ["Identity Card", "FLORIDA_ID_CARD_REAL_ID", "drivers_license", "fail"],
    ["Passport", "GBR_PASSPORT", "drivers_license", "fail"],
    ["Passport", "GBR_PASSPORT", "passport", "pass"],
    ["Driver's License", "SOMETHING_NEW_2027", "drivers_license", "could_not_check"],
    [null, null, "drivers_license", "could_not_check"],
  ] as Array<[string | null, string | null, string, string]>)("07.18 %s / %s (accepts %s) is %s", (type, sub, accepted, result) => {
    expect(licenceTypeLine(type, sub, accepted).result).toBe(result);
  });

  it("07.18 a learner's permit says so", () => {
    expect(licenceTypeLine("Driver's License", "FLORIDA_LEARNER_PERMIT", "drivers_license").reason).toBe(
      "This is a learner's permit, not a full driving licence",
    );
  });

  it("07.19 document numbers are compared upper case without spaces or dashes", () => {
    expect(normaliseDocumentNumber(" d123-456 78 ")).toBe("D12345678");
  });

  const pass = (check: string): Line => ({ check, result: "pass", reason: null });
  const ALL_PASS = ["real_licence", "live_person", "face_match", "details_saved", "not_expired", "old_enough", "name_matches", "licence_type", "not_blocked", "document_kind"].map(pass);

  it("07.21 every deciding line passing is Verified", () => {
    expect(standardOutcome(ALL_PASS, false)).toBe("verified");
  });

  it("07.21 old enough 'not_set' does not stop Verified", () => {
    const lines = ALL_PASS.map((l) => (l.check === "old_enough" ? { ...l, result: "not_set" as const } : l));
    expect(standardOutcome(lines, false)).toBe("verified");
  });

  it("07.22 any deciding line failing is Failed", () => {
    const lines = ALL_PASS.map((l) => (l.check === "licence_type" ? { ...l, result: "fail" as const } : l));
    expect(standardOutcome(lines, false)).toBe("failed");
  });

  it("07.23 Didit 'In Review' is Needs a look", () => {
    expect(standardOutcome(ALL_PASS, true)).toBe("needs_review");
  });

  it("07.23 a deciding line we could not check is Needs a look, never a pass", () => {
    const lines = ALL_PASS.map((l) => (l.check === "not_expired" ? { ...l, result: "could_not_check" as const } : l));
    expect(standardOutcome(lines, false)).toBe("needs_review");
  });

  it("07.14 details saved missing a field does not decide the outcome", () => {
    const lines = ALL_PASS.map((l) => (l.check === "details_saved" ? { ...l, result: "could_not_check" as const } : l));
    expect(standardOutcome(lines, false)).toBe("verified");
  });
});
