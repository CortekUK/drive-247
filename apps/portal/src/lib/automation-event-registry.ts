/**
 * Automation Event Registry — Spec Section 7.1.
 *
 * Code-defined enumeration of every event that can trigger an automation.
 * MUST stay in sync with supabase/functions/_shared/automation-events.ts.
 * (For V1 we keep this hand-mirrored; if it drifts we'll introduce a JSON
 * source-of-truth file at automation-events.json.)
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

export interface EventDefinition {
  name: string;
  entity: "lead" | "rental" | "payment" | "customer" | "any";
  description: string;
  /** Payload field names available for `{{var}}` substitution and filtering */
  payloadFields: string[];
  /** Phase 3+ events are listed but not yet emitted */
  phase: 1 | 2 | 3;
}

export const EVENT_REGISTRY: EventDefinition[] = [
  // V1 (lead-only)
  { name: "lead.created", entity: "lead", phase: 1,
    description: "New row inserted into leads.",
    payloadFields: ["lead_id", "source", "score", "score_band", "vehicle_class", "start_date", "end_date"] },
  { name: "lead.application_submitted", entity: "lead", phase: 1,
    description: "Fired alongside lead.created when source='application'.",
    payloadFields: ["lead_id", "application_data", "score_band"] },
  { name: "lead.stage_changed", entity: "lead", phase: 1,
    description: "leads.stage was updated.",
    payloadFields: ["lead_id", "from_stage", "to_stage", "actor_id", "actor_type"] },
  { name: "lead.docs_requested", entity: "lead", phase: 1,
    description: "Stage moves to docs_requested.",
    payloadFields: ["lead_id", "requested_docs"] },
  { name: "lead.docs_submitted", entity: "lead", phase: 1,
    description: "First doc upload.",
    payloadFields: ["lead_id", "doc_types"] },
  { name: "lead.docs_verified", entity: "lead", phase: 1,
    description: "All docs verified.",
    payloadFields: ["lead_id"] },
  { name: "lead.docs_failed", entity: "lead", phase: 1,
    description: "Any doc verification failed.",
    payloadFields: ["lead_id", "failure_reason"] },
  { name: "lead.score_changed", entity: "lead", phase: 1,
    description: "lead_score band changed.",
    payloadFields: ["lead_id", "from_band", "to_band", "score"] },
  { name: "lead.assigned", entity: "lead", phase: 1,
    description: "assigned_to changed.",
    payloadFields: ["lead_id", "from_user_id", "to_user_id"] },
  { name: "lead.stale_24h", entity: "lead", phase: 1,
    description: "No activity for 24h (cron).",
    payloadFields: ["lead_id", "last_activity_at"] },
  { name: "lead.stale_48h", entity: "lead", phase: 1,
    description: "No activity for 48h (cron).",
    payloadFields: ["lead_id", "last_activity_at"] },
  { name: "lead.lost", entity: "lead", phase: 1,
    description: "Stage → lost.", payloadFields: ["lead_id", "reason"] },
  { name: "lead.blacklisted", entity: "lead", phase: 1,
    description: "Stage → blacklisted.", payloadFields: ["lead_id", "reason"] },
  { name: "lead.converted", entity: "lead", phase: 1,
    description: "Stage → converted.", payloadFields: ["lead_id", "customer_id", "rental_id"] },
  { name: "lead.offer_sent", entity: "lead", phase: 1,
    description: "Offer link created + sent.", payloadFields: ["lead_id", "offer_id", "vehicles"] },
  { name: "lead.offer_opened", entity: "lead", phase: 1,
    description: "First view of offer page.", payloadFields: ["lead_id", "offer_id"] },
  { name: "lead.offer_accepted", entity: "lead", phase: 1,
    description: "Lead picked from offer.", payloadFields: ["lead_id", "offer_id", "vehicle_id", "dates"] },
  { name: "lead.offer_expired", entity: "lead", phase: 1,
    description: "Offer expired without acceptance.", payloadFields: ["lead_id", "offer_id"] },
  { name: "lead.inbound_message", entity: "lead", phase: 1,
    description: "Inbound SMS/email/WhatsApp.", payloadFields: ["lead_id", "channel", "body"] },
  { name: "manual", entity: "any", phase: 1,
    description: "Operator clicks Run now.", payloadFields: ["entity_type", "entity_id", "started_by"] },

  // V3+ (planned)
  { name: "rental.created", entity: "rental", phase: 3,
    description: "New rental row.", payloadFields: ["rental_id", "customer_id", "vehicle_id"] },
  { name: "payment.received", entity: "payment", phase: 3,
    description: "Deposit/charge captured.", payloadFields: ["payment_id", "amount", "rental_id"] },
];

// Human-readable labels keyed by event name. Lookup table so the lib remains
// a single source of truth for both raw event names AND friendly UI strings.
const EVENT_LABELS: Record<string, string> = {
  "lead.created": "Lead created",
  "lead.application_submitted": "Application submitted",
  "lead.stage_changed": "Stage changed",
  "lead.docs_requested": "Documents requested",
  "lead.docs_submitted": "Documents submitted",
  "lead.docs_verified": "Documents verified",
  "lead.docs_failed": "Document verification failed",
  "lead.score_changed": "Score band changed",
  "lead.assigned": "Lead assigned",
  "lead.stale_24h": "No activity for 24h",
  "lead.stale_48h": "No activity for 48h",
  "lead.lost": "Marked as lost",
  "lead.blacklisted": "Added to blacklist",
  "lead.converted": "Converted to rental",
  "lead.offer_sent": "Offer link sent",
  "lead.offer_opened": "Offer page opened",
  "lead.offer_accepted": "Offer accepted",
  "lead.offer_expired": "Offer expired",
  "lead.inbound_message": "Inbound message",
  "manual": "Manual (Run now)",
  "rental.created": "Rental created",
  "payment.received": "Payment received",
};

export function eventLabel(eventName: string): string {
  return EVENT_LABELS[eventName] ?? eventName;
}

export const TRIGGER_OPTIONS = EVENT_REGISTRY.filter((e) => e.phase === 1).map((e) => ({
  value: e.name,
  label: eventLabel(e.name),
  rawName: e.name,
  entity: e.entity,
  description: e.description,
}));

export type AutomationStepType = "sms" | "email" | "wait" | "condition" | "stop";

export interface SmsStepConfig {
  templateId?: string;
  body?: string;
  channelFrom?: string;
}
export interface EmailStepConfig {
  templateId?: string;
  subject?: string;
  body?: string;
  fromAddress?: string;
}
export interface WaitStepConfig {
  duration: { value: number; unit: "minutes" | "hours" | "days" };
}
export interface ConditionStepConfig {
  expression: string;
}

export type AutomationStepConfig =
  | { type: "sms"; config: SmsStepConfig }
  | { type: "email"; config: EmailStepConfig }
  | { type: "wait"; config: WaitStepConfig }
  | { type: "condition"; config: ConditionStepConfig }
  | { type: "stop"; config: Record<string, never> };
