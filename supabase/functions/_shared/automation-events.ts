/**
 * Automation event names — server-side mirror of
 * apps/portal/src/lib/automation-event-registry.ts. Keep in sync.
 */
export const EVENT_NAMES = [
  "lead.created",
  "lead.application_submitted",
  "lead.stage_changed",
  "lead.docs_requested",
  "lead.docs_submitted",
  "lead.docs_verified",
  "lead.docs_failed",
  "lead.score_changed",
  "lead.assigned",
  "lead.stale_24h",
  "lead.stale_48h",
  "lead.lost",
  "lead.blacklisted",
  "lead.converted",
  "lead.offer_sent",
  "lead.offer_opened",
  "lead.offer_accepted",
  "lead.offer_expired",
  "lead.inbound_message",
  "manual",
  "rental.created",
  "payment.received",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];
