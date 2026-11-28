// feat-003: Didit's decision → our ten lines and the details to save (spec 07.12 to 07.25).
// Pure: everything it needs from the database is passed in, so Vitest can feed it recorded decisions.

import {
  type Line,
  licenceTypeLine,
  nameLine,
  normaliseDocumentNumber,
  notExpiredLine,
  oldEnoughLine,
  standardOutcome,
  type StandardOutcome,
} from "./rules.ts";

export interface ReadDetails {
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  document_number: string | null;
  document_type: string | null;
  document_subtype: string | null;
  expiry: string | null;
  region: string | null;          // the US state, e.g. "TX"
  country: string | null;         // e.g. "USA"
  address: { street: string | null; city: string | null; state: string | null; zip: string | null } | null;
  images: { front: string | null; back: string | null; selfie: string | null };
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "puerto rico": "PR",
};

/** "TX", "tx", "US-TX" or "Texas" → "TX". Anything else is returned as read. */
export function stateCode(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  const m = /^(?:US-)?([A-Z]{2})$/i.exec(v);
  if (m) return m[1].toUpperCase();
  return US_STATES[v.toLowerCase()] ?? v;
}
const isoDate = (v: unknown): string | null => {
  const t = s(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};

/** Reads the first entry of each v3 list (the workflow has one node of each). */
export function readDetails(decision: any): ReadDetails {
  const id = decision?.id_verifications?.[0] ?? {};
  const live = decision?.liveness_checks?.[0] ?? {};
  const parsed = id.parsed_address ?? {};
  const region = s(id.region) ?? s(parsed.region) ?? s(parsed.state) ?? null;
  return {
    first_name: s(id.first_name),
    last_name: s(id.last_name),
    date_of_birth: isoDate(id.date_of_birth),
    document_number: s(id.document_number) ?? s(id.personal_number),
    document_type: s(id.document_type),
    document_subtype: s(id.document_subtype),
    expiry: isoDate(id.expiration_date),
    region: stateCode(region),
    country: s(id.issuing_state) ?? s(id.issuing_state_name),
    address: id.address || Object.keys(parsed).length
      ? {
        street: s(parsed.street_1) ?? s(parsed.address_line_1) ?? s(id.address),
        city: s(parsed.city),
        state: s(parsed.region) ?? s(parsed.state),
        zip: s(parsed.postal_code) ?? s(parsed.zip),
      }
      : null,
    images: {
      front: s(id.front_image),
      back: s(id.back_image),
      selfie: s(live.reference_image) ?? s(id.portrait_image),
    },
  };
}

function statusLine(check: string, status: unknown, failReason: string, score?: unknown): Line {
  const st = s(status);
  if (st === "Approved") return { check, result: "pass", reason: typeof score === "number" ? `Score ${Math.round(score)}` : null };
  if (st === "Declined") return { check, result: "fail", reason: failReason };
  return { check, result: "could_not_check", reason: st ? `Didit says: ${st}` : "Not returned" };
}

export interface StandardContext {
  customerName: string;
  minimumAge: number | null;
  acceptedDocument: string | null;
  today: string;                      // YYYY-MM-DD, UTC
  blockedReason: string | null;       // from this company's blocked list, when the number matched
  sameFaceNames: string[];            // other customers of this company with the same face
}

export interface StandardResult {
  lines: Line[];
  outcome: StandardOutcome;
  reason: string | null;
  details: ReadDetails;
}

/** The ten lines and the outcome (spec 07.12 to 07.24). */
export function standardResult(decision: any, ctx: StandardContext): StandardResult {
  const d = readDetails(decision);
  const id = decision?.id_verifications?.[0] ?? {};
  const live = decision?.liveness_checks?.[0] ?? {};
  const face = decision?.face_matches?.[0] ?? {};

  const missing = (
    [["name", d.first_name && d.last_name], ["date of birth", d.date_of_birth], ["document number", d.document_number],
      ["expiry date", d.expiry], ["state or country", d.region ?? d.country]] as Array<[string, unknown]>
  ).filter(([, v]) => !v).map(([k]) => k);

  const blocked: Line = d.document_number === null
    ? { check: "not_blocked", result: "could_not_check", reason: "No document number to check" }
    : ctx.blockedReason
      ? { check: "not_blocked", result: "fail", reason: `On your blocked list: ${ctx.blockedReason}` }
      : ctx.sameFaceNames.length
        ? { check: "not_blocked", result: "fail", reason: `Same face as ${ctx.sameFaceNames.join(", ")}` }
        : { check: "not_blocked", result: "pass", reason: null };

  const kind = d.document_type
    ? `${d.document_type}${d.region ? ` (${d.region})` : d.country ? ` (${d.country})` : ""}`
    : "Unknown document";

  const lines: Line[] = [
    statusLine("real_licence", id.status, "The licence is not genuine, or could not be read"),
    statusLine("live_person", live.status, "A photo of a photo, a screen, or a mask"),
    statusLine("face_match", face.status, "The selfie is not the person on the licence", face.score),
    missing.length
      ? { check: "details_saved", result: "could_not_check", reason: `Could not read: ${missing.join(", ")}` }
      : { check: "details_saved", result: "pass", reason: null },
    notExpiredLine(d.expiry, ctx.today),
    oldEnoughLine(d.date_of_birth, ctx.minimumAge, ctx.today),
    nameLine(ctx.customerName, d.first_name, d.last_name),
    licenceTypeLine(d.document_type, d.document_subtype, ctx.acceptedDocument),
    blocked,
    { check: "document_kind", result: "pass", reason: kind },
  ];

  const diditStatus = s(decision?.status);
  let outcome = standardOutcome(lines, diditStatus === "In Review");
  let reason: string | null = lines.find((l) => l.result === "fail")?.reason ?? null;
  // Didit declined but none of our lines can say why (spec 07.24).
  if (outcome !== "failed" && diditStatus === "Declined") {
    outcome = "failed";
    reason = "Didit declined the check";
  }
  if (outcome === "needs_review" && !reason) {
    reason = lines.find((l) => l.result === "could_not_check")?.reason ?? "Didit asked for a person to look";
  }
  return { lines, outcome, reason, details: d };
}

/** The decision without the short-lived image links: what is kept as `raw` (spec 07.28). */
export function stripImages(decision: any): any {
  return JSON.parse(JSON.stringify(decision ?? {}, (k, v) =>
    typeof v === "string" && /(image|video|_url)$/i.test(k) && /^https?:/.test(v) ? "[copied]" : v));
}

export { normaliseDocumentNumber };
