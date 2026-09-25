/**
 * The shapes the payment-plan UI renders from.
 *
 * Each one EXTENDS the engine's own row type (`lib/payment-plans/types.ts`)
 * with a few optional display-only fields. That is deliberate: the plan card
 * renders from plain data, so the Developer-tab simulator can hand it the
 * memory store's rows exactly as the engine wrote them, and the rental page
 * can hand it the same rows read from Postgres. One component, two sources,
 * no adapter that could make them disagree.
 */

import type { AttemptRow, ISODate, OccurrenceRow, PlanEvent, PlanRow } from "@/lib/payment-plans/types";

export interface PlanView extends PlanRow {
  createdAt?: string | null;
  pausedAt?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
}

/** `movedFrom`, `paidAt` and `note` are on the engine's row type already. */
export type OccurrenceView = OccurrenceRow;

/** `createdAt`, `finishedAt` and `checkoutSessionId` are on the engine's row type already. */
export type AttemptView = AttemptRow;

export type EventView = PlanEvent & {
  id: string;
  createdAt: string;
  deliveryStatus?: "pending" | "sent" | "failed" | "skipped" | null;
};

export interface PlanBundle {
  plan: PlanView;
  occurrences: OccurrenceView[];
  attempts: AttemptView[];
  events: EventView[];
}

/** What an operator types when recording money they already received. */
export interface RecordPaymentInput {
  amountCents: number;
  method: ManualMethod;
  /** 'YYYY-MM-DD'. */
  date: ISODate;
  note: string;
}

/** The methods `payment-plan-manage` accepts for a manual record (design §8). */
export const MANUAL_METHODS = ["Cash", "Bank Transfer", "Zelle", "Check", "Card (external)", "Other"] as const;
export type ManualMethod = (typeof MANUAL_METHODS)[number];
