import { describe, it, expect } from "vitest";
import { readEdgeSource, liftDeclaration, compile } from "../helpers/edge-source";

/**
 * Guards for the Bonzah External API mapper and push function.
 *
 * The handover records six defects that were found by adversarial review rather
 * than by writing the code, and warns that the same mistakes are easy to
 * reintroduce. Each one has a test here, phrased as the thing that must stay
 * true rather than as the bug that was fixed — a mapping that answers a
 * different question is not a style problem, it is a false statement on a signed
 * insurance declaration.
 *
 * Source assertions, not executions, wherever the logic lives in a Deno module
 * that Vitest cannot import. `readDocId` is pure and dependency-free, so it is
 * lifted and actually run.
 */

const mapper = () => readEdgeSource("_shared/bonzah-external.ts");
const pushFn = () => readEdgeSource("push-bonzah-submission/index.ts");

/**
 * Strip comments before asserting.
 *
 * Several of these guards are negative ("this name must not appear"), and the
 * file explains each past defect in prose that necessarily quotes the wrong
 * name. Without this the tests pass or fail on the documentation rather than on
 * the code, which is precisely the kind of test that gives false comfort.
 */
const codeOnly = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The mapper body only, so assertions cannot drift into the doc tables below it. */
const mapperBody = (): string => {
  const s = mapper();
  return s.slice(s.indexOf("export function mapSubmissionToBonzah"), s.indexOf("function countLeaves"));
};

describe("the required-field list is generated, not hand-written", () => {
  it("carries the contract version it was generated against", () => {
    // A hand-written list was wrong in the SAME direction as the mapper, so the
    // two errors cancelled and every submission reported clean.
    expect(mapper()).toContain("2026-08-20T15:42:28.316Z");
  });

  it("includes the five underwriting questions Bonzah types as structural", () => {
    // A `type !== "structural"` filter silently dropped these AND hid them from
    // missingRequired. Two of nine operators had answered YES to claims.
    const s = mapper();
    for (const f of [
      "legal.claimsPast3Years",
      "legal.policyCanceledOrNonRenewed",
      "legal.insuranceFraudConviction",
      "legal.duiOrSeriousViolations",
      "legal.vehicleModifications",
    ]) {
      expect(s, `${f} must be required`).toContain(`"${f}"`);
    }
  });

  it("never filters the contract on field type", () => {
    expect(codeOnly(mapper())).not.toContain('!== "structural"');
  });

  it("requires the three document references their contract marks required", () => {
    const s = mapper();
    expect(s).toContain('"primaryDriverLicenseDocId"');
    expect(s).toContain('"fleet.vehicleScheduleDocId"');
    expect(s).toContain('"insurance.insurancePolicyDocId"');
  });

  it("uses their real field names, not invented ones", () => {
    const s = codeOnly(mapper());
    expect(s).toContain('"legalName"');
    expect(s).toContain("primaryContact.dob");
    // The invented names that made every submission report clean.
    expect(s).not.toContain("businessLegalName");
    expect(s).not.toContain("primaryContact.dateOfBirth");
  });
});

describe("polarity — the inverted legal declaration", () => {
  it("inverts nonRentalUsageConfirmed rather than passing our answer through", () => {
    // Theirs: "do you confirm NONE of the vehicles are used for non-rental
    // purposes?" Ours: "do you ALLOW non-rental use?" — opposite. Passing it
    // through made an operator who DOES allow it confirm that they do not.
    const b = mapperBody();
    const clause = b.slice(b.indexOf("legal.nonRentalUsageConfirmed"));
    expect(clause).toContain('allows === "yes" ? "no" : "yes"');
  });

  it("still maps the same source field to fleet.nonRentalUsage un-inverted", () => {
    // The fleet question asks the same thing our form does, so it is NOT flipped.
    expect(mapperBody()).toContain('put(p, "fleet.nonRentalUsage", yesno(d.vehicles_used_outside_rentals))');
  });
});

describe("mappings that answer a different question stay unmapped", () => {
  const mustNotMap: [string, string][] = [
    ["rentalOps.inspectionProcess", "a yes/no sent as a narrative"],
    ["rentalOps.insuranceVerificationProcess", "a yes/no sent as a narrative"],
    ["insurance.commercialAutoLossHistory", "an 'anything else?' box sent as loss history"],
    ["insurance.usesRentalAgreement", "answered from the timestamp question"],
    ["fleet.telematicsDevices", "asserted from the GPS answer"],
    ["fleet.vehicleRegistrationStatus", "an enum we collect nothing equivalent for"],
    ["businessOwners", "free text sent as a structural ownership block"],
  ];

  for (const [field, why] of mustNotMap) {
    it(`does not map ${field} — ${why}`, () => {
      expect(mapperBody()).not.toContain(`put(p, "${field}"`);
    });
  }

  it("explains every one of them instead of just reporting 'missing'", () => {
    const s = mapper();
    for (const [field] of mustNotMap) {
      // Dotted keys are quoted; bare identifiers are not. Accept either.
      const declared = s.includes(`"${field}": {`) || new RegExp(`\\b${field}:\\s*\\{`).test(s);
      expect(declared, `${field} needs a gap reason`).toBe(true);
    }
  });

  it("names who can close each gap", () => {
    const s = mapper();
    expect(s).toContain('resolvedBy: "product"');
  });
});

describe("card data is never transmitted", () => {
  it("sends name and billing address only", () => {
    const b = mapperBody();
    expect(b).toContain('put(p, "card.nameOnCard"');
    expect(b).toContain('put(p, "card.billingStreet"');
  });

  it("never sends the PAN, expiry or CVC — all three are optional in their schema", () => {
    const b = mapperBody();
    expect(b).not.toContain('put(p, "card.cardNumber"');
    expect(b).not.toContain('put(p, "card.expirationDate"');
    expect(b).not.toContain('put(p, "card.securityCode"');
  });

  it("does not run billingState through the state enum — their field is free text", () => {
    expect(mapperBody()).toContain('put(p, "card.billingState", str(d.state))');
  });
});

describe("the signature is a name, not an image", () => {
  it("sends text rather than the signature-pad PNG", () => {
    const b = mapperBody();
    expect(b).toContain('put(p, "signature", str(d.full_name)');
    expect(b).not.toContain("signature_data_url");
  });
});

describe("documents and fleet parsing", () => {
  it("maps every storage category to a Bonzah field", () => {
    const s = mapper();
    for (const c of [
      "driver_licenses",
      "vehicle_schedule_file",
      "fleet_insurance_policy",
      "rental_agreement_file",
      "loss_runs_file",
      "business_logo",
      "additional_users_spreadsheet",
      "loss_history_file",
    ]) {
      expect(s, `${c} must map to a field`).toContain(`${c}:`);
    }
  });

  it("marks exactly the three required document fields as required", () => {
    const s = mapper();
    const map = s.slice(s.indexOf("BONZAH_DOC_CATEGORY_MAP"), s.indexOf("export interface DocumentUploadInput"));
    expect((map.match(/required:\s*true/g) ?? []).length).toBe(3);
  });

  it("prefers the submission's own file_urls over a per-tenant bucket scan", () => {
    // The bucket is laid out per TENANT, so a tenant with two submissions would
    // get the newer one's files attached to the older.
    const s = pushFn();
    expect(s).toContain("documentsFromSubmission");
    expect(s).toContain("file_urls");
  });

  it("uploads documents BEFORE the submission, since three required fields are DocIds", () => {
    const s = pushFn();
    expect(s.indexOf("postDocument(")).toBeLessThan(s.indexOf("putSubmission("));
  });

  it("refuses to send the form when a required document failed to upload", () => {
    const s = pushFn();
    expect(s).toContain("required_document_failed");
  });

  it("re-hashes the payload after DocIds are merged, so the ledger describes what was sent", () => {
    expect(pushFn()).toContain("finalHash");
  });
});

describe("readDocId tolerates a response shape we have never seen", () => {
  const readDocId = compile<(b: unknown) => string | undefined>(
    [liftDeclaration(mapper(), "readDocId")],
    "readDocId",
  );

  it.each([
    ["docId", { docId: "abc" }],
    ["documentId", { documentId: "abc" }],
    ["id", { id: "abc" }],
    ["data.docId", { data: { docId: "abc" } }],
    ["document.id", { document: { id: "abc" } }],
    ["documents[0].id", { documents: [{ id: "abc" }] }],
  ])("reads %s", (_label, body) => {
    expect(readDocId(body)).toBe("abc");
  });

  it("returns undefined rather than inventing an id", () => {
    // A DocId we invent points an underwriter at nothing.
    expect(readDocId({ status: "ok" })).toBeUndefined();
    expect(readDocId(null)).toBeUndefined();
    expect(readDocId("abc")).toBeUndefined();
  });

  it("ignores an empty string", () => {
    expect(readDocId({ docId: "   " })).toBeUndefined();
  });
});

describe("the push function's safety rails", () => {
  it("defaults to a dry run — live must be asked for explicitly", () => {
    expect(pushFn()).toContain("body?.live === true");
  });

  it("is super-admin only", () => {
    expect(pushFn()).toContain("is_super_admin");
  });

  it("refuses loudly when the API key is missing", () => {
    expect(pushFn()).toContain("missing_api_key");
  });

  it("refuses loudly when the tenant has no partner id", () => {
    expect(pushFn()).toContain("missing_partner_id");
  });

  it("blocks a live push on its own validation", () => {
    // It used to compute the gaps, write them to the ledger, then transmit anyway.
    expect(pushFn()).toContain("incomplete_submission");
  });

  it("refuses a duplicate live push — their API has no idempotency key", () => {
    const s = pushFn();
    expect(s).toContain("duplicate_push");
    expect(s).toContain("payload_sha256");
  });

  it("lets a repeated DRY run through, since that is how the gap report is used", () => {
    const s = pushFn();
    const dup = s.slice(s.indexOf("duplicate protection"), s.indexOf("Open the ledger row"));
    expect(dup).toContain("if (live)");
  });

  it("does not advance the submission status — their API cannot confirm acceptance", () => {
    expect(pushFn()).toContain("Deliberately does NOT advance submission status");
  });
});

describe("the payload is never stored or logged", () => {
  it("audits a hash, not the payload", () => {
    const s = pushFn();
    expect(s).toContain("payload_sha256");
    expect(s).not.toMatch(/payload:\s*mapped\.payload\s*,?\s*\}\s*\)\s*\.select/);
  });

  it("never console.logs the payload", () => {
    const s = pushFn();
    expect(s).not.toContain("console.log(mapped.payload");
    expect(s).not.toContain("JSON.stringify(mapped.payload))");
  });

  it("the HTTP client says it never logs the body", () => {
    expect(mapper()).toContain("Never logs the payload");
  });
});

describe("no read/status/credential workflow was invented", () => {
  it("uses PUT for the submission — GET and POST 404 on that path", () => {
    expect(mapper()).toContain('method: "PUT"');
  });

  it("does not call GET on the submission path", () => {
    const s = mapper();
    expect(s).not.toContain('method: "GET"');
  });

  it("records that activation and credentials still come back by hand", () => {
    expect(pushFn()).toContain("write-only");
  });
});
