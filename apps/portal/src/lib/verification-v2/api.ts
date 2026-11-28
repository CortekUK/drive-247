// feat-003 · the portal's calls to the `verification-v2` edge function (specs 03, 04, 05).
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/function-error";

export type VerificationStatus =
  | "not_verified" | "link_sent" | "in_progress" | "verified" | "needs_review" | "failed" | "expired";

/** The words every screen uses (spec 03.3). */
export const STATUS_LABEL: Record<VerificationStatus, string> = {
  not_verified: "Not verified",
  link_sent: "Link sent",
  in_progress: "In progress",
  verified: "Verified",
  needs_review: "Needs a look",
  failed: "Failed",
  expired: "Expired",
};

/** Text-only status colours, as the portal design system asks. */
export const STATUS_TONE: Record<VerificationStatus, string> = {
  not_verified: "text-muted-foreground",
  link_sent: "text-[#2563eb]",
  in_progress: "text-[#2563eb]",
  verified: "text-[#16a34a]",
  needs_review: "text-[#d97706]",
  failed: "text-[#dc2626]",
  expired: "text-muted-foreground",
};

/** Verify on these; Remind on Link sent and In progress (spec 03.4, 03.5). */
export const VERIFY_ON: VerificationStatus[] = ["not_verified", "failed", "expired", "needs_review"];
export const REMIND_ON: VerificationStatus[] = ["link_sent", "in_progress"];

export function asStatus(value: unknown): VerificationStatus {
  return (Object.keys(STATUS_LABEL) as VerificationStatus[]).includes(value as VerificationStatus)
    ? (value as VerificationStatus)
    : "not_verified";
}

export interface ServiceRow {
  key: string;
  name: string;
  description: string;
  kind: "free" | "premium";
  availability: "live" | "switched_off" | "coming_soon";
  provider_cost_cents: number;
  margin_cents: number;
  has_state_fee: boolean;
  sort_order: number;
}

export interface VerificationContext {
  services: ServiceRow[];
  lastTicks: string[];
  canStart: boolean;
  canTickPremium: boolean;
  premiumBySubscription: boolean;
  subscriptionStatus: string | null;
  smsAvailable: boolean;
  knownState: string | null;
  stateFees: Record<string, number>;
  openSession: { id: string; status: string; expiresAt: string; link: string; sentVia: string; sentTo: string | null } | null;
  status: VerificationStatus;
  lastVerifiedAt: string | null;
  customer: { id: string; name: string; email: string | null; phone: string | null };
}

export interface ResultLine { check: string; result: "pass" | "fail" | "could_not_check" | "not_set" | "not_run"; reason: string | null }

export interface VerificationStatusResponse {
  status: VerificationStatus;
  warning?: string | null;
  session: {
    id: string; createdAt: string; expiresAt: string; finishedAt: string | null;
    sentVia: string; sentTo: string | null; remindersSent: number; link: string | null;
  } | null;
  events: Array<{ kind: string; at: string; detail: Record<string, unknown> }>;
  checks: Array<{ service_key: string; result: string; lines: ResultLine[]; reason: string | null; finished_at: string | null }>;
}

export class VerificationError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

export async function callVerification<T>(action: string, body: Record<string, unknown>, tenantSlug?: string | null): Promise<T> {
  const { data, error } = await supabase.functions.invoke("verification-v2", {
    body: { action, ...body, ...(tenantSlug ? { tenantSlug } : {}) },
  });
  if (error) {
    let code: string | undefined;
    try { code = (await (error as { context?: Response }).context?.clone().json())?.error; } catch { /* not JSON */ }
    throw new VerificationError(await functionErrorMessage(error, "Something went wrong"), code);
  }
  return data as T;
}

/** The plain-words name of each result line (spec 07.12 to 07.20, 08.15). */
export const LINE_LABEL: Record<string, string> = {
  real_licence: "Real licence",
  live_person: "Live person",
  face_match: "Face match",
  details_saved: "Details saved",
  not_expired: "Not expired",
  old_enough: "Old enough",
  name_matches: "Name matches",
  licence_type: "Right type of licence",
  not_blocked: "Not blocked, not a repeat",
  document_kind: "Kind of document",
  licence_status: "Licence active with the state",
  driving_record: "Driving record",
  criminal_record: "Criminal record",
  premium: "Premium check",
};

export const RESULT_LABEL: Record<string, string> = {
  pass: "Pass", fail: "Fail", could_not_check: "Could not check", not_set: "Not set", not_run: "Not run", pending: "Waiting",
};

/** The moments on screen 3 and the customer's page (spec 05.14). */
export function momentText(e: { kind: string; detail: Record<string, unknown> }): string {
  const to = typeof e.detail?.to === "string" ? ` to ${e.detail.to}` : "";
  switch (e.kind) {
    case "session_created": return "Check made";
    case "link_emailed": return `Link emailed${to}`;
    case "link_texted": return `Link texted${to}`;
    case "link_copied": return "Link copied";
    case "code_shown": return "Code shown to scan";
    case "reminder_sent": return `Reminder sent${to}`;
    case "link_opened": return "Link opened";
    case "consent_given": return "Agreed to the check";
    case "consent_refused": return "Did not agree to the check";
    case "check_started": return "Check started";
    case "standard_result": return "Standard check finished";
    case "premium_started": return "Premium check started";
    case "premium_result": return "Premium check finished";
    case "cancelled": return "Cancelled";
    case "expired": return "Link ended (24 hours)";
    case "replaced": return "Replaced by a newer check";
    default: return e.kind;
  }
}
