/**
 * Postgres rows (snake_case, `numeric` money) → the UI's view shapes
 * (camelCase, integer cents). Pure.
 *
 * The columns are the ones in docs/PAYMENT_PLANS_DESIGN.md §4. Every money
 * column is `numeric(12,2)` in dollars and is converted to cents HERE, once,
 * so nothing downstream ever adds dollars.
 *
 * A plan whose end is "the rental ends" does not store the date — it follows
 * the rental's own `end_date` — so `planFromRow` takes it as an argument.
 */

import type {
  AmountSpec,
  AttemptStatus,
  CollectionMethod,
  ISODate,
  OccurrenceStatus,
  PlanEventKind,
  PlanStatus,
  ScheduleEnd,
  ScheduleRule,
  Weekday,
} from "@/lib/payment-plans/types";
import { numericToCents } from "./format";
import type { AttemptView, EventView, OccurrenceView, PlanView } from "./view-types";

type Row = Record<string, any>;

const day = (v: unknown): ISODate | null => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const int = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

export function planFromRow(row: Row, rentalEnd: ISODate | null): PlanView {
  const freq = row.freq as ScheduleRule["freq"];
  const endKind = row.end_kind as ScheduleEnd["kind"];
  let end: ScheduleEnd;
  switch (endKind) {
    case "count":
      end = { kind: "count", count: int(row.occurrence_count, 1) };
      break;
    case "until":
      end = { kind: "until", until: day(row.until_date) ?? day(row.anchor_date)! };
      break;
    case "open":
      end = { kind: "open", through: day(row.until_date) ?? day(row.anchor_date)! };
      break;
    default:
      end = { kind: "rental_end", rentalEnd: rentalEnd ?? day(row.until_date) ?? day(row.anchor_date)! };
  }

  const rule: ScheduleRule = {
    freq,
    interval: int(row.interval_count, 1),
    ...(Array.isArray(row.by_weekday) && row.by_weekday.length
      ? { byWeekday: row.by_weekday.map((d: unknown) => int(d)) as Weekday[] }
      : {}),
    ...(row.by_month_day !== null && row.by_month_day !== undefined ? { byMonthDay: int(row.by_month_day) } : {}),
    ...(Array.isArray(row.explicit_dates) && row.explicit_dates.length
      ? { dates: row.explicit_dates.map((d: unknown) => day(d)!).filter(Boolean) }
      : {}),
    anchor: day(row.anchor_date)!,
    firstOccurrence: row.first_occurrence === "on_rhythm" ? "on_rhythm" : "on_anchor",
    end,
  };

  let amount: AmountSpec;
  switch (row.amount_mode) {
    case "fixed":
      amount = { mode: "fixed", amountCents: numericToCents(row.fixed_amount) };
      break;
    case "per_period":
      amount = { mode: "per_period", dailyRateCents: numericToCents(row.daily_rate) };
      break;
    case "split_by_days":
      amount = { mode: "split_by_days", totalCents: numericToCents(row.total_amount) };
      break;
    default:
      amount = { mode: "split_total", totalCents: numericToCents(row.total_amount) };
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    rentalId: row.rental_id,
    customerId: row.customer_id,
    status: row.status as PlanStatus,
    rule,
    amount,
    currency: str(row.currency) ?? "usd",
    timezone: str(row.timezone) ?? "UTC",
    chargeLocalTime: str(row.charge_local_time)?.slice(0, 5) ?? "10:00",
    collectionMethod: row.collection_method as CollectionMethod,
    fallbackToLink: row.fallback_to_link !== false,
    maxAttempts: int(row.max_attempts, 3),
    retryAfterDays: int(row.retry_after_days, 2),
    reminderOffsets: Array.isArray(row.reminder_offsets) ? row.reminder_offsets.map((o: unknown) => int(o)) : [],
    paymentProvider: row.payment_provider === "square" ? "square" : "stripe",
    stripePaymentMethodId: str(row.stripe_payment_method_id),
    extendsRental: row.extends_rental === true,
    version: int(row.version, 1),
    createdAt: str(row.created_at),
    pausedAt: str(row.paused_at),
    cancelledAt: str(row.cancelled_at),
    completedAt: str(row.completed_at),
  };
}

export function occurrenceFromRow(row: Row): OccurrenceView {
  return {
    id: row.id,
    planId: row.plan_id,
    tenantId: row.tenant_id,
    rentalId: row.rental_id,
    seq: int(row.seq),
    planVersion: int(row.plan_version, 1),
    dueDate: day(row.due_date)!,
    dueAt: str(row.due_at) ?? "",
    periodStart: day(row.period_start),
    periodEnd: day(row.period_end),
    amountCents: numericToCents(row.amount),
    amountPaidCents: numericToCents(row.amount_paid),
    collectionMethod: row.collection_method as CollectionMethod,
    status: row.status as OccurrenceStatus,
    attemptNo: int(row.attempt_no),
    nextAttemptAt: str(row.next_attempt_at),
    movedFrom: day(row.moved_from),
    paidAt: str(row.paid_at),
    note: str(row.note),
  };
}

export function attemptFromRow(row: Row): AttemptView {
  const provider = ["stripe", "square", "manual", "simulated"].includes(row.provider) ? row.provider : "manual";
  const mode = row.provider_mode === "live" || row.provider_mode === "test" ? row.provider_mode : null;
  return {
    id: row.id,
    occurrenceId: row.occurrence_id,
    attemptNo: int(row.attempt_no),
    method: row.method as CollectionMethod,
    idempotencyKey: str(row.idempotency_key) ?? "",
    status: row.status as AttemptStatus,
    provider,
    providerAccount: str(row.provider_account),
    providerMode: mode,
    providerRef: str(row.provider_ref),
    paymentId: str(row.payment_id),
    amountCents: numericToCents(row.amount),
    declineCode: str(row.decline_code),
    errorCode: str(row.error_code),
    errorMessage: str(row.error_message),
    checkoutSessionId: str(row.checkout_session_id),
    createdAt: str(row.created_at) ?? undefined,
    finishedAt: str(row.finished_at),
  };
}

export function eventFromRow(row: Row): EventView {
  return {
    id: row.id,
    planId: row.plan_id,
    occurrenceId: str(row.occurrence_id),
    kind: row.kind as PlanEventKind,
    dedupeKey: str(row.dedupe_key),
    channel: row.channel ?? null,
    amountCents: row.amount === null || row.amount === undefined ? null : numericToCents(row.amount),
    detail: row.detail && typeof row.detail === "object" ? row.detail : {},
    actorId: str(row.actor_id),
    createdAt: str(row.created_at) ?? "",
    deliveryStatus: row.delivery_status ?? null,
  };
}
