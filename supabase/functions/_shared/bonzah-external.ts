// Bonzah External API — client and payload mapper.
//
// Replaces the manual "email the onboarding form to Brandon" step. It does NOT
// close the round trip the meeting asked for: their API is write-only. Verified
// directly against the live host — only PUT exists on the submission path, GET
// and POST both 404, and the descriptor says so itself:
//
//   "Write-only API: accepts submission and document writes plus stateless
//    fleet-file parsing. No GET/list/read endpoints."
//
// So there is no way to read activation status and no way to receive
// credentials. Brandon still activates by hand and still emails the credentials
// back. The email fallback stays.
//
// NOTE ON THE ANNOUNCEMENT EMAIL: it describes card masking on
// "GET /v1/external/partners/:id/submission". That endpoint does not exist —
// GET returns 404. Nothing here depends on reading anything back.

/** Canonical base, per Bonzah's own announcement. The old *.vercel.app host
 *  308-redirects; we never used it, so there is nothing to migrate. */
export const BONZAH_EXTERNAL_BASE =
  Deno.env.get("BONZAH_EXTERNAL_API_URL") || "https://onboarding.bonzah.com/api/v1/external";

export function bonzahExternalKey(): string | null {
  return Deno.env.get("BONZAH_EXTERNAL_API_KEY") || null;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── helpers ────────────────────────────────────────────────────────────────
const str = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
};
const num = (v: unknown): number | undefined => {
  const s = str(v);
  if (s === undefined) return undefined;
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};
/** Their `yesno` fields carry the strings "yes"/"no", not booleans. */
const yesno = (v: unknown): string | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v).trim().toLowerCase();
  if (["yes", "true", "y", "1"].includes(s)) return "yes";
  if (["no", "false", "n", "0"].includes(s)) return "no";
  return undefined;
};
const bool = (v: unknown): boolean | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["yes", "true", "y", "1"].includes(s)) return true;
  if (["no", "false", "n", "0"].includes(s)) return false;
  return undefined;
};
const list = (v: unknown): string[] | undefined => {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  const s = str(v);
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
};

/** Set a dotted path ("banking.accountNumber") on a nested object, skipping
 *  undefined so we never transmit an empty string where they expect absence. */
function put(target: Record<string, unknown>, path: string, value: unknown) {
  if (value === undefined) return;
  const parts = path.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    node[parts[i]] ??= {};
    node = node[parts[i]] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

/** Their `state` / `statesOfOperation` enum: 2-letter USPS codes. Our form takes
 *  free text, and real submissions contain city names — one live row has
 *  state = "Los Angeles ". Pushing that would fail their enum (or, worse, be
 *  accepted and stall in underwriting), so it is normalised where possible and
 *  REPORTED where not. */
const US_STATES: Record<string, string> = {
  alabama:"AL",alaska:"AK",arizona:"AZ",arkansas:"AR",california:"CA",colorado:"CO",
  connecticut:"CT",delaware:"DE",florida:"FL",georgia:"GA",hawaii:"HI",idaho:"ID",
  illinois:"IL",indiana:"IN",iowa:"IA",kansas:"KS",kentucky:"KY",louisiana:"LA",
  maine:"ME",maryland:"MD",massachusetts:"MA",michigan:"MI",minnesota:"MN",
  mississippi:"MS",missouri:"MO",montana:"MT",nebraska:"NE",nevada:"NV",
  "new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY",
  "north carolina":"NC","north dakota":"ND",ohio:"OH",oklahoma:"OK",oregon:"OR",
  pennsylvania:"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",
  tennessee:"TN",texas:"TX",utah:"UT",vermont:"VT",virginia:"VA",washington:"WA",
  "west virginia":"WV",wisconsin:"WI",wyoming:"WY","district of columbia":"DC",
};
const STATE_CODES = new Set(Object.values(US_STATES));

function stateCode(v: unknown): string | undefined {
  const raw = str(v);
  if (!raw) return undefined;
  const up = raw.toUpperCase();
  if (STATE_CODES.has(up)) return up;
  return US_STATES[raw.toLowerCase()];
}

/**
 * Their REQUIRED field ids, taken verbatim from the public
 * `GET /api/wizard-definition` (78 of 82, minus the additionalDrivers.*
 * children whose presence is judged on the block).
 *
 * Generated, not hand-written. A hand-written list was wrong in the SAME
 * direction as the mapper — both used invented names like `businessLegalName`
 * instead of `legalName` — so the two errors cancelled out and every submission
 * reported as complete. Regenerate this from their endpoint whenever
 * `updatedAt` moves.
 */
export const BONZAH_REQUIRED_FIELDS: string[] = [
  "assistanceNeeded",
  "tradeName",
  "legalName",
  "ein",
  "companyType",
  "businessStartDate",
  "businessPhone",
  "website",
  "street",
  "city",
  "state",
  "postalCode",
  "country",
  "statesOfOperation",
  "licensingCompliance",
  "multiJurisdictionCompliance",
  "businessOwners",
  "yearsInPrivateAutoRental",
  "yearsOnTuro",
  "primaryContact.firstName",
  "primaryContact.lastName",
  "primaryContact.email",
  "primaryContact.phone",
  "primaryContact.dob",
  "primaryContact.yearsDriving",
  "primaryContact.maritalStatus",
  "hasAdditionalDrivers",
  "fleet.vehicleSchedule",
  "fleet.telematicsDevices",
  "fleet.gpsTracking",
  "fleet.vehicleRegistrationStatus",
  "fleet.registeredInCompanyName",
  "fleet.salvageOrRebuiltTitles",
  "fleet.rideShareUsage",
  "fleet.nonRentalUsage",
  "fleet.vehicleStorageSecurity",
  "rentalOps.deliveryPickupOffered",
  "rentalOps.minimumRenterAge",
  "rentalOps.averageRentalDurationDays",
  "rentalOps.rentalsOver30DaysAllowed",
  "rentalOps.screeningProcess",
  "rentalOps.employeeDrivingRecordsChecked",
  "rentalOps.rentalManagementSystem",
  "rentalOps.theftHistory",
  "rentalOps.driverIdRetained",
  "rentalOps.primaryInsuranceRequiredFromRenter",
  "rentalOps.percentRentersWithPersonalAutoInsurance",
  "rentalOps.renterProofOfInsuranceRetained",
  "rentalOps.insuranceVerificationProcess",
  "rentalOps.paymentMethodsAccepted",
  "rentalOps.cardOnFileRequired",
  "rentalOps.inspectionProcess",
  "rentalOps.maintenanceProgram",
  "rentalOps.otherBusinessOwnership",
  "insurance.currentProvider",
  "insurance.overTheCounterInsuranceOffered",
  "insurance.usesRentalAgreement",
  "insurance.hadCommercialAutoLosses",
  "insurance.hasLossRunSummary",
  "insurance.digitalMechanicalTimestampConfirmed",
  "insurance.commercialAutoLossHistory",
  "banking.accountName",
  "banking.accountType",
  "banking.bankName",
  "banking.routingNumber",
  "banking.accountNumber",
  "banking.accountNumberConfirm",
  "banking.bankAddress",
  "card.nameOnCard",
  "card.billingStreet",
  "card.billingCity",
  "card.billingState",
  "card.billingPostalCode",
  "card.billingCountry",
  "legal.claimsPast3Years",
  "legal.policyCanceledOrNonRenewed",
  "legal.insuranceFraudConviction",
  "legal.duiOrSeriousViolations",
  "legal.vehicleModifications",
  "legal.licenseValid",
  "legal.nonRentalUsageConfirmed",
  "certifyAccuracy",
  "preparerAuthorized",
  "userAgreementAccepted",
  "signature",
];

export interface MapResult {
  payload: Record<string, unknown>;
  /** Their REQUIRED fields we could not fill — the operator has to supply these. */
  missingRequired: string[];
  /** Field PATHS whose value we could not make valid. Never carries the value. */
  warnings: { field: string; reason: string }[];
  fieldCount: number;
}

/**
 * Map our flat snake_case submission onto their dotted camelCase contract.
 *
 * Field ids, types and required flags come from their own public
 * `GET /api/wizard-definition` (110 fields, updatedAt 2026-08-20) — a real
 * contract rather than a guess. Refresh it before trusting this after any
 * Bonzah change.
 *
 * CARD FIELDS ARE DELIBERATELY NOT SENT. Their schema marks card.cardNumber,
 * card.expirationDate and card.securityCode as required:false, while every
 * banking field and the whole billing address are required:true. Since they do
 * not need them, transmitting a PAN and a CVC to a third party would be taking
 * on PCI exposure for no benefit — and retaining a CVC is prohibited outright.
 * Name-on-card and the billing address ARE sent, because those they do require.
 */
export function mapSubmissionToBonzah(d: Record<string, any>): MapResult {
  const p: Record<string, unknown> = {};
  const warnings: { field: string; reason: string }[] = [];

  const stateOr = (field: string, v: unknown): string | undefined => {
    const raw = str(v);
    if (!raw) return undefined;
    const code = stateCode(raw);
    if (!code) warnings.push({ field, reason: "not a US state code — Bonzah expects a 2-letter code" });
    return code;
  };
  const enumOr = (field: string, v: unknown, allowed: string[]): string | undefined => {
    const raw = str(v);
    if (!raw) return undefined;
    const hit = allowed.find((a) => a.toLowerCase() === raw.toLowerCase());
    if (!hit) warnings.push({ field, reason: `not one of: ${allowed.join(", ")}` });
    return hit;
  };

  // ── company ──────────────────────────────────────────────────────────────
  put(p, "assistanceNeeded", str(d.what_can_we_help_with));
  put(p, "legalName", str(d.business_legal_name));
  put(p, "tradeName", str(d.business_trade_name));
  put(p, "companyType", enumOr("companyType", d.company_type,
      ["llc","corporation","s_corp","partnership","sole_proprietor","other"]));
  put(p, "ein", str(d.ein));
  put(p, "businessStartDate", str(d.business_start_date));
  put(p, "street", str(d.business_address));
  put(p, "city", str(d.city));
  put(p, "state", stateOr("state", d.state));
  put(p, "postalCode", str(d.postal_code));
  put(p, "country", str(d.country));
  put(p, "businessPhone", str(d.business_phone));
  put(p, "altBusinessPhone", str(d.alternative_business_phone));
  put(p, "website", str(d.company_website));
  put(p, "yearsInPrivateAutoRental", num(d.years_in_private_auto_rental));
  put(p, "yearsOnTuro", num(d.years_on_turo));
  put(p, "embedInterest", yesno(d.explore_embedding_bonzah));
  put(p, "licensingCompliance", yesno(d.licensed_in_all_locations));
  put(p, "multiJurisdictionCompliance", yesno(d.adhering_to_license_requirements));
  {
    const raw = list(d.states_where_you_do_business);
    if (raw) {
      const codes = raw.map((x) => stateCode(x)).filter((x): x is string => !!x);
      if (codes.length !== raw.length) {
        warnings.push({ field: "statesOfOperation", reason: "one or more entries are not US state codes" });
      }
      if (codes.length) put(p, "statesOfOperation", codes);
    }
  }

  // ── ownership ────────────────────────────────────────────────────────────
  put(p, "primaryContact.firstName", str(d.primary_first_name));
  put(p, "primaryContact.lastName", str(d.primary_last_name));
  put(p, "primaryContact.email", str(d.primary_email));
  put(p, "primaryContact.phone", str(d.primary_phone));
  put(p, "primaryContact.dob", str(d.primary_date_of_birth));
  put(p, "primaryContact.maritalStatus", enumOr("primaryContact.maritalStatus",
      d.primary_marital_status, ["single","married","divorced","widowed","other"]));
  put(p, "primaryContact.yearsDriving", num(d.primary_years_driving));
  {
    // additional_users is an ARRAY of driver objects; their contract wants a
    // yes/no plus a repeating block. Coercing the array through yesno() left a
    // REQUIRED field empty on every submission.
    const drivers = Array.isArray(d.additional_users) ? d.additional_users : [];
    put(p, "hasAdditionalDrivers", drivers.length > 0 ? "yes" : "no");
    if (drivers.length > 0) {
      put(p, "additionalDrivers", drivers.map((x: Record<string, any>) => {
        const full = str(x?.full_name) ?? "";
        const sp = full.indexOf(" ");
        return {
          // Their contract defines only email / phone / maritalStatus /
          // yearsDriving under additionalDrivers. Sending firstName, lastName
          // and dob invents fields they never asked for.
          email: str(x?.email),
          phone: str(x?.phone),
          maritalStatus: enumOr("additionalDrivers.maritalStatus", x?.marital_status,
              ["single","married","divorced","widowed","other"]),
          yearsDriving: num(x?.years_driving),
        };
      }));
    }
  }

  // ── operations: fleet ────────────────────────────────────────────────────
  put(p, "fleet.registeredInCompanyName", yesno(d.vehicles_registered_in_company_name));
  put(p, "fleet.salvageOrRebuiltTitles", yesno(d.any_vehicles_salvage));
  put(p, "fleet.gpsTracking", yesno(d.vehicles_have_gps));
  put(p, "fleet.gpsProvider", str(d.gps_brand));
  // fleet.telematicsDevices is not the same question as GPS tracking, and the
  // GPS answer already feeds fleet.gpsTracking. Asserting one from the other
  // is a guess about the fleet, so it is reported missing instead.
  put(p, "fleet.nonRentalUsage", yesno(d.vehicles_used_outside_rentals));
  put(p, "fleet.rideShareUsage", yesno(d.rent_for_hire));
  put(p, "fleet.vehicleStorageSecurity", str(d.vehicle_storage_security));
  // fleet.vehicleRegistrationStatus is NOT mapped: their enum is
  // all_current | some_expired | mixed and we collect nothing equivalent.
  // Deriving it from a yes/no would be inventing an underwriting answer.

  // ── operations: rental ops ───────────────────────────────────────────────
  put(p, "rentalOps.deliveryPickupOffered", yesno(d.deliver_or_pickup));
  put(p, "rentalOps.minimumRenterAge", num(d.minimum_age_renters));
  put(p, "rentalOps.averageRentalDurationDays", num(d.average_rental_duration));
  put(p, "rentalOps.rentalsOver30DaysAllowed", yesno(d.rent_more_than_30_days));
  put(p, "rentalOps.screeningProcess", str(d.renter_screening_process));
  put(p, "rentalOps.employeeDrivingRecordsChecked", yesno(d.check_employee_driving_records));
  put(p, "rentalOps.rentalManagementSystem", str(d.rental_management_system));
  put(p, "rentalOps.theftHistory", yesno(d.renter_stolen_vehicle));
  put(p, "rentalOps.driverIdRetained", yesno(d.photocopy_driver_ids));
  put(p, "rentalOps.primaryInsuranceRequiredFromRenter", yesno(d.require_renters_primary_insurance));
  put(p, "rentalOps.percentRentersWithPersonalAutoInsurance", num(d.pct_renters_with_insurance));
  put(p, "rentalOps.renterProofOfInsuranceRetained", yesno(d.retain_renter_insurance_proof));
  // rentalOps.insuranceVerificationProcess is a TEXTAREA asking HOW insurance
  // is verified. Our verify_renter_insurance is a yes/no, so this was sending
  // the literal string "yes" as the narrative. Reported missing instead.
  {
    // Their multiselect accepts exactly five values. Ours is a free-text box
    // holding things like "All kinds of payment methods" and "N/A", which a
    // comma-split turned into invented options. Match what we can; report the
    // rest rather than inventing.
    const ALLOWED = ["Credit Card","Debit Card","ACH / Bank Transfer","Cash","Digital Wallet"];
    const raw = (str(d.payment_methods) ?? "").toLowerCase();
    const hits = ALLOWED.filter((a) => raw.includes(a.toLowerCase().split(" ")[0]));
    if (raw && hits.length === 0) {
      warnings.push({ field: "rentalOps.paymentMethodsAccepted", reason: "free text does not match any of their five options" });
    }
    if (hits.length) put(p, "rentalOps.paymentMethodsAccepted", hits);
  }
  put(p, "rentalOps.cardOnFileRequired", yesno(d.cash_app_card_on_file));
  // rentalOps.inspectionProcess is a textarea asking HOW vehicles are
  // inspected; inspect_vehicles is a yes/no. Reported missing instead.
  put(p, "rentalOps.maintenanceProgram", str(d.vehicle_maintenance_program));
  put(p, "rentalOps.otherBusinessOwnership", yesno(d.own_other_businesses));

  // ── operations: insurance ────────────────────────────────────────────────
  put(p, "insurance.currentProvider", str(d.current_insurance_carrier));
  put(p, "insurance.hadCommercialAutoLosses", yesno(d.had_commercial_auto_losses));
  // insurance.commercialAutoLossHistory asks for five years of loss history
  // including pending claims. what_else_should_we_know is a free "anything
  // else?" box — it was sending "We check our vehicle on regular basis" where
  // an underwriter reads a no-loss declaration. Reported missing instead.
  put(p, "insurance.hasLossRunSummary", yesno(d.has_loss_summary));
  put(p, "insurance.overTheCounterInsuranceOffered", yesno(d.offers_otc_insurance));
  // insurance.usesRentalAgreement ("Do you use a rental agreement?") and
  // insurance.digitalMechanicalTimestampConfirmed ("odometer timestamps for
  // every rental") are TWO questions. Our single field asks only whether the
  // agreement carries a timestamp, so answering both from it told Bonzah that
  // two operators use no rental agreement at all. Only the timestamp question
  // is answered here; the other is reported missing.
  put(p, "insurance.digitalMechanicalTimestampConfirmed", yesno(d.rental_agreement_has_timestamp));

  // ── financial & legal: banking ───────────────────────────────────────────
  put(p, "banking.accountName", str(d.bank_account_name));
  {
    // Our form stores "business_checking"; their enum is checking | savings.
    // Narrow rather than warn — the value is unambiguous, only more specific.
    const raw = (str(d.bank_account_type) ?? "").toLowerCase();
    const t = raw.includes("saving") ? "savings" : raw.includes("check") ? "checking" : undefined;
    if (raw && !t) warnings.push({ field: "banking.accountType", reason: "not one of: checking, savings" });
    put(p, "banking.accountType", t);
  }
  put(p, "banking.bankName", str(d.bank_name));
  put(p, "banking.bankAddress", str(d.bank_account_address));
  put(p, "banking.routingNumber", str(d.routing_number));
  put(p, "banking.accountNumber", str(d.account_number));
  put(p, "banking.accountNumberConfirm", str(d.reenter_account_number ?? d.account_number));
  put(p, "banking.desiredStartingBalance", num(d.desired_starting_balance));

  // ── financial & legal: card — NAME + BILLING ADDRESS ONLY ────────────────
  // cardNumber / expirationDate / securityCode are required:false in THEIR
  // schema. Sending a PAN and a CVC they do not need would take on PCI exposure
  // for no benefit, and retaining a CVC is prohibited outright.
  put(p, "card.nameOnCard", str(d.card_name));
  put(p, "card.billingStreet", str(d.card_billing_address ?? d.business_address));
  put(p, "card.billingCity", str(d.city));
  // card.billingState is type:"text" in their schema, not the state enum —
  // running it through the enum check dropped a required value and warned.
  put(p, "card.billingState", str(d.state));
  put(p, "card.billingPostalCode", str(d.postal_code));
  put(p, "card.billingCountry", str(d.country));

  // ── legal / declaration ──────────────────────────────────────────────────
  put(p, "legal.licenseValid", yesno(d.require_drivers_valid_license));

  // INVERTED ON PURPOSE. The two questions are opposites:
  //   theirs: "Do you confirm that NONE of the insured vehicles are used for
  //            personal or non-rental purposes?"
  //   ours:   "Do you ALLOW your vehicles to be used for any other purpose
  //            outside of private rentals?"
  // Passing our answer through unchanged made an operator who DOES allow it
  // confirm that they do not — a false statement on a signed insurance
  // declaration, and the kind that voids cover. 1 of 9 live submissions is in
  // exactly that position.
  {
    const allows = yesno(d.vehicles_used_outside_rentals);
    put(p, "legal.nonRentalUsageConfirmed",
        allows === undefined ? undefined : allows === "yes" ? "no" : "yes");
  }

  // The five disclosures Bonzah types as `structural`. They are required, they
  // are the heart of underwriting, and the first version of this mapper dropped
  // all five AND hid them from missingRequired — because the required list was
  // generated with a `type !== "structural"` filter. Two of nine operators
  // answered YES to claims in the past three years and it never left the
  // building. Our own form warns that cover can be voided if material facts are
  // omitted; this was omitting them.
  put(p, "legal.claimsPast3Years", yesno(d.uw_accidents_past_3_years));
  put(p, "legal.policyCanceledOrNonRenewed", yesno(d.uw_canceled_policy));
  put(p, "legal.insuranceFraudConviction", yesno(d.uw_insurance_fraud));
  put(p, "legal.duiOrSeriousViolations", yesno(d.uw_dui_violations));
  put(p, "legal.vehicleModifications", yesno(d.uw_modified_for_performance));
  put(p, "additionalNotes", str(d.what_else_should_we_know));
  put(p, "certifyAccuracy", bool(d.declare_complete_accurate));
  put(p, "preparerAuthorized", bool(d.declare_authorized));
  put(p, "userAgreementAccepted", bool(d.agree_user_agreement));
  // Their `signature` is type:"text" labelled "Signature (full legal name)".
  // We hold a 17-62 KB PNG data URL from a signature pad. Posting that into a
  // text field is not a signature, it is a wall of base64. The name is sent
  // instead where we have it.
  put(p, "signature", str(d.full_name) ?? str(d.name));

  // Their REQUIRED set, taken verbatim from the public wizard-definition rather
  // than hand-listed — a hand-list was wrong in the SAME direction as the
  // mapper, so the two errors cancelled and every submission reported clean.
  const REQUIRED = BONZAH_REQUIRED_FIELDS;
  const has = (path: string): boolean => {
    let node: unknown = p;
    for (const part of path.split(".")) {
      if (node === null || typeof node !== "object") return false;
      node = (node as Record<string, unknown>)[part];
    }
    return node !== undefined && node !== null && node !== "";
  };

  return {
    payload: p,
    missingRequired: REQUIRED.filter((f) => !has(f)),
    warnings,
    fieldCount: countLeaves(p),
  };
}

function countLeaves(o: unknown): number {
  if (o === null || typeof o !== "object") return 1;
  if (Array.isArray(o)) return 1;
  return Object.values(o as Record<string, unknown>).reduce<number>((n, v) => n + countLeaves(v), 0);
}

export interface PushResult {
  ok: boolean;
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  body?: unknown;
}

/**
 * PUT the submission. The ONLY place this module touches the network.
 *
 * Never logs the payload: it carries bank account and routing numbers, EIN and
 * a date of birth. Only sizes, hashes and status codes are logged.
 */
export async function putSubmission(
  partnerId: string,
  apiKey: string,
  payload: Record<string, unknown>,
  step = 6,
): Promise<PushResult> {
  const url = `${BONZAH_EXTERNAL_BASE}/partners/${encodeURIComponent(partnerId)}/submission`;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ step, data: payload }),
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        errorCode: `http_${res.status}`,
        errorMessage: (body as { error?: string })?.error ?? `Bonzah returned ${res.status}`,
        body,
      };
    }
    return { ok: true, httpStatus: res.status, body };
  } catch (e) {
    return {
      ok: false,
      errorCode: "network_error",
      errorMessage: (e as { message?: string })?.message ?? "Could not reach Bonzah",
    };
  }
}
