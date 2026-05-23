/**
 * Lead Stage State Machine — Spec Section 6.1.
 *
 * Authoritative TS-side enforcement of allowed transitions. The DB trigger
 * validate_lead_stage_transition() only records stage_updated_at; the app layer
 * enforces *which* transitions are valid before calling the UPDATE.
 *
 * Pattern:
 *   - canTransition(from, to) is the gate every UI / mutation MUST consult.
 *   - allowedTransitions(from) drives the constrained stage selector in the
 *     workspace top action bar.
 *   - stageLabel / stageColor are presentation helpers.
 */

export type LeadStage =
  | "new"
  | "contacted"
  | "docs_requested"
  | "docs_submitted"
  | "docs_verified"
  | "docs_failed"
  | "approved"
  | "vehicle_offered"
  | "offer_accepted"
  | "agreement_sent"
  | "agreement_signed"
  | "deposit_paid"
  | "pickup_scheduled"
  | "converted"
  | "waitlist"
  | "lost"
  | "blacklisted";

export const ALL_STAGES: LeadStage[] = [
  "new",
  "contacted",
  "docs_requested",
  "docs_submitted",
  "docs_verified",
  "docs_failed",
  "approved",
  "vehicle_offered",
  "offer_accepted",
  "agreement_sent",
  "agreement_signed",
  "deposit_paid",
  "pickup_scheduled",
  "converted",
  "waitlist",
  "lost",
  "blacklisted",
];

export const TERMINAL_STAGES: LeadStage[] = ["converted", "lost", "blacklisted"];

/**
 * Allowed transitions per spec §6.1. Operator-driven moves are explicit;
 * auto transitions (BoldSign webhook, Stripe webhook, Veriff webhook, etc.)
 * are listed here too because they reuse this gate via the same mutation path.
 */
const TRANSITIONS: Record<LeadStage, LeadStage[]> = {
  new: ["contacted", "docs_requested", "waitlist", "lost", "blacklisted"],
  contacted: ["docs_requested", "approved", "waitlist", "lost", "blacklisted"],
  docs_requested: ["docs_submitted", "lost", "blacklisted"],
  docs_submitted: ["docs_verified", "docs_failed"],
  docs_verified: ["approved", "lost"],
  docs_failed: ["docs_requested", "approved", "lost", "blacklisted"], // operator override
  approved: ["vehicle_offered", "waitlist", "lost"],
  vehicle_offered: ["offer_accepted", "lost"], // also auto-expires → lost
  offer_accepted: ["agreement_sent", "lost"],
  agreement_sent: ["agreement_signed", "lost"],
  agreement_signed: ["deposit_paid", "lost"],
  deposit_paid: ["pickup_scheduled", "lost"],
  pickup_scheduled: ["converted", "lost"],
  converted: [],
  waitlist: ["approved", "vehicle_offered", "lost", "blacklisted"],
  lost: ["new"], // operator can resurrect
  blacklisted: ["new"], // operator can unblacklist
};

export function canTransition(from: LeadStage, to: LeadStage): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: LeadStage): LeadStage[] {
  return TRANSITIONS[from] ?? [];
}

export function isTerminalStage(stage: LeadStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  docs_requested: "Docs Requested",
  docs_submitted: "Docs Submitted",
  docs_verified: "Docs Verified",
  docs_failed: "Docs Failed",
  approved: "Approved",
  vehicle_offered: "Vehicle Offered",
  offer_accepted: "Offer Accepted",
  agreement_sent: "Agreement Sent",
  agreement_signed: "Agreement Signed",
  deposit_paid: "Deposit Paid",
  pickup_scheduled: "Pickup Scheduled",
  converted: "Converted",
  waitlist: "Waitlist",
  lost: "Lost",
  blacklisted: "Blacklisted",
};

export function stageLabel(stage: LeadStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

/**
 * Tailwind-class strings for badges. Mirrors the portal design system
 * (.claude/projects/.../figma-design-system.md): status badges use text colour,
 * not background pills, except in dedicated badge contexts where these are used.
 */
const STAGE_COLORS: Record<LeadStage, { text: string; bg: string; dot: string }> = {
  new: { text: "text-blue-600", bg: "bg-blue-50", dot: "bg-blue-500" },
  contacted: { text: "text-indigo-600", bg: "bg-indigo-50", dot: "bg-indigo-500" },
  docs_requested: { text: "text-amber-600", bg: "bg-amber-50", dot: "bg-amber-500" },
  docs_submitted: { text: "text-amber-700", bg: "bg-amber-50", dot: "bg-amber-600" },
  docs_verified: { text: "text-emerald-600", bg: "bg-emerald-50", dot: "bg-emerald-500" },
  docs_failed: { text: "text-red-600", bg: "bg-red-50", dot: "bg-red-500" },
  approved: { text: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-600" },
  vehicle_offered: { text: "text-indigo-700", bg: "bg-indigo-50", dot: "bg-indigo-600" },
  offer_accepted: { text: "text-violet-700", bg: "bg-violet-50", dot: "bg-violet-600" },
  agreement_sent: { text: "text-violet-700", bg: "bg-violet-50", dot: "bg-violet-600" },
  agreement_signed: { text: "text-purple-700", bg: "bg-purple-50", dot: "bg-purple-600" },
  deposit_paid: { text: "text-fuchsia-700", bg: "bg-fuchsia-50", dot: "bg-fuchsia-600" },
  pickup_scheduled: { text: "text-pink-700", bg: "bg-pink-50", dot: "bg-pink-600" },
  converted: { text: "text-emerald-700", bg: "bg-emerald-100", dot: "bg-emerald-700" },
  waitlist: { text: "text-yellow-700", bg: "bg-yellow-50", dot: "bg-yellow-500" },
  lost: { text: "text-zinc-500", bg: "bg-zinc-100", dot: "bg-zinc-400" },
  blacklisted: { text: "text-red-700", bg: "bg-red-100", dot: "bg-red-700" },
};

export function stageColor(stage: LeadStage) {
  return STAGE_COLORS[stage];
}

/**
 * Kanban column groupings per spec §6.3.
 * 8 visible columns on the Active tab; Docs Submitted/Verified merged,
 * Agreement Sent/Signed merged, Deposit Paid/Pickup Scheduled merged.
 * Waitlist/Lost/Blacklisted accessible via separate tabs.
 */
export const ACTIVE_COLUMNS: { id: string; label: string; stages: LeadStage[] }[] = [
  { id: "new", label: "New", stages: ["new"] },
  { id: "contacted", label: "Contacted", stages: ["contacted"] },
  { id: "docs_requested", label: "Docs Requested", stages: ["docs_requested"] },
  { id: "docs", label: "Docs Submitted / Verified", stages: ["docs_submitted", "docs_verified", "docs_failed"] },
  { id: "approved", label: "Approved", stages: ["approved"] },
  { id: "vehicle_offered", label: "Vehicle Offered", stages: ["vehicle_offered"] },
  { id: "offer_accepted", label: "Offer Accepted", stages: ["offer_accepted"] },
  { id: "agreement", label: "Agreement Sent / Signed", stages: ["agreement_sent", "agreement_signed"] },
  { id: "deposit", label: "Deposit Paid / Pickup Scheduled", stages: ["deposit_paid", "pickup_scheduled"] },
];

export const TAB_STAGES: Record<"active" | "waitlist" | "lost" | "blacklisted" | "converted", LeadStage[]> = {
  active: ACTIVE_COLUMNS.flatMap((c) => c.stages),
  waitlist: ["waitlist"],
  lost: ["lost"],
  blacklisted: ["blacklisted"],
  converted: ["converted"],
};

/**
 * When dragging a card to a merged column, which destination stage do we pick?
 * Default to the FIRST stage in the column (the entry stage). Operator can later
 * advance within the column via the workspace stage selector.
 */
export function entryStageForColumn(columnId: string): LeadStage | null {
  const col = ACTIVE_COLUMNS.find((c) => c.id === columnId);
  return col ? col.stages[0] : null;
}
