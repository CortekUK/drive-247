import { describe, expect, it } from "vitest";
import type { Line } from "../../../../supabase/functions/_shared/verification/rules";
import { readDetails, standardResult, stateCode, stripImages } from "../../../../supabase/functions/_shared/verification/standard";

// Spec 07 · Didit decisions in the documented v3 shape (docs.didit.me/reference/data-models) → our ten lines.
// Didit's sandbox "simulate" call changes only the status and returns no licence data, so the mapping is
// proved here with decisions in Didit's own shape; a real sandbox run on a phone is in the QA report.

const TODAY = "2026-11-29";
const approvedTexas = {
  status: "Approved",
  id_verifications: [{
    status: "Approved", document_type: "Driver's License", document_subtype: "TEXAS_DRIVER_LICENSE_GENERIC",
    document_number: "12345678", date_of_birth: "1990-05-12", expiration_date: "2030-05-12", issuing_state: "USA",
    first_name: "Marcus", last_name: "Hill", region: "Texas",
    parsed_address: { street_1: "1 Main St", city: "Austin", region: "TX", postal_code: "78701", country: "US" },
    front_image: "https://media.example/front.jpg?sig=1", back_image: "https://media.example/back.jpg?sig=1",
  }],
  liveness_checks: [{ status: "Approved", score: 97, reference_image: "https://media.example/selfie.jpg?sig=1" }],
  face_matches: [{ status: "Approved", score: 94.2 }],
  linked_records: { same_face: { count: 0, best_match: null } },
};
const ctx = { customerName: "Marcus Hill", minimumAge: 21, acceptedDocument: "drivers_license", today: TODAY, blockedReason: null, sameFaceNames: [] as string[] };
const lineOf = (r: { lines: Line[] }, check: string) => r.lines.find((l) => l.check === check)!;
const clone = () => structuredClone(approvedTexas) as any;

describe("07 Didit's decision to our ten lines", () => {
  it("07.21 a clean Texas licence is Verified with every deciding line passing", () => {
    const r = standardResult(approvedTexas, ctx);
    expect(r.outcome).toBe("verified");
    expect(r.lines).toHaveLength(10);
    expect(r.lines.filter((l) => l.result === "fail")).toHaveLength(0);
  });

  it("07.25 the details read are the ones saved, with the state as two letters", () => {
    const d = readDetails(approvedTexas);
    expect(d).toMatchObject({ first_name: "Marcus", last_name: "Hill", date_of_birth: "1990-05-12", document_number: "12345678",
      expiry: "2030-05-12", region: "TX", country: "USA", document_subtype: "TEXAS_DRIVER_LICENSE_GENERIC" });
    expect(d.address).toMatchObject({ street: "1 Main St", city: "Austin", state: "TX", zip: "78701" });
    expect(d.images).toEqual({ front: "https://media.example/front.jpg?sig=1", back: "https://media.example/back.jpg?sig=1", selfie: "https://media.example/selfie.jpg?sig=1" });
  });

  it("07.25 state names and codes become two letters", () => {
    expect(stateCode("Texas")).toBe("TX");
    expect(stateCode("us-ca")).toBe("CA");
    expect(stateCode("New York")).toBe("NY");
    expect(stateCode("Madrid")).toBe("Madrid");
  });

  it("07.12 Didit declining the document fails line 1", () => {
    const d = clone(); d.status = "Declined"; d.id_verifications[0].status = "Declined";
    const r = standardResult(d, ctx);
    expect(lineOf(r, "real_licence").result).toBe("fail");
    expect(r.outcome).toBe("failed");
  });

  it("07.13 a failed liveness or face match fails the check", () => {
    const a = clone(); a.liveness_checks[0].status = "Declined";
    expect(standardResult(a, ctx).outcome).toBe("failed");
    const b = clone(); b.face_matches[0].status = "Declined";
    expect(lineOf(standardResult(b, ctx), "face_match").reason).toBe("The selfie is not the person on the licence");
  });

  it("07.16 a renter under the company's minimum fails with the minimum named", () => {
    const d = clone(); d.id_verifications[0].date_of_birth = "2006-01-01";
    const r = standardResult(d, ctx);
    expect(r.outcome).toBe("failed");
    expect(r.reason).toBe("Under your minimum age of 21");
  });

  it("07.18 a learner's permit fails line 8", () => {
    const d = clone(); d.id_verifications[0].document_subtype = "TEXAS_LEARNER_PERMIT";
    expect(lineOf(standardResult(d, ctx), "licence_type").result).toBe("fail");
  });

  it("07.19 a number on the blocked list fails line 9 with the list's reason", () => {
    const r = standardResult(approvedTexas, { ...ctx, blockedReason: "Unpaid damage" });
    expect(lineOf(r, "not_blocked").reason).toBe("On your blocked list: Unpaid damage");
    expect(r.outcome).toBe("failed");
  });

  it("07.19 the same face under another name at this company fails line 9", () => {
    const r = standardResult(approvedTexas, { ...ctx, sameFaceNames: ["Mark Hilton"] });
    expect(lineOf(r, "not_blocked").reason).toBe("Same face as Mark Hilton");
  });

  it("07.20 line 10 names the kind of document and never fails", () => {
    expect(lineOf(standardResult(approvedTexas, ctx), "document_kind")).toEqual({ check: "document_kind", result: "pass", reason: "Driver's License (TX)" });
  });

  it("07.23 Didit 'In Review' is Needs a look", () => {
    const d = clone(); d.status = "In Review";
    expect(standardResult(d, ctx).outcome).toBe("needs_review");
  });

  it("07.23 an empty decision is Needs a look, never Verified or Failed", () => {
    const r = standardResult({ status: "Approved", id_verifications: [], liveness_checks: [], face_matches: [] }, ctx);
    expect(r.outcome).toBe("needs_review");
  });

  it("07.24 Didit declining with no line we can name fails as 'Didit declined the check'", () => {
    const r = standardResult({ ...approvedTexas, status: "Declined" }, ctx);
    expect(r.outcome).toBe("failed");
    expect(r.reason).toBe("Didit declined the check");
  });

  it("07.28 the short-lived image links are not kept in the raw answer", () => {
    const raw = JSON.stringify(stripImages(approvedTexas));
    expect(raw).not.toContain("media.example");
    expect(raw).toContain("TEXAS_DRIVER_LICENSE_GENERIC");
  });
});
