/**
 * Customer Management Service — the stored contract.
 *
 * ── HOW THIS DIFFERS FROM notifications-v2, WHICH IS NEXT DOOR ──────────────
 *
 * `lib/notifications-v2/` is a SWITCHBOARD: a catalogue of events the codebase
 * already emits, with an on/off switch and an editable template over each one.
 * Every item there carries `evidence` (file:line) pointing at the code that
 * already sends it, and `today` saying what that code does right now. Nothing
 * in it introduces a new email.
 *
 * This module is the opposite: three automations that NOTHING sends today.
 * There is no signup drip engine in `supabase/functions` and nothing warns an
 * operator before a renewal charge, so there is no existing sender to switch —
 * the sender, the schedule and the log are all new, and they are wired to real
 * cron rather than designed against it. That is why this is its own module
 * with its own table and its own runner, instead of three more catalogue
 * entries: a catalogue entry with no `evidence` would be exactly the
 * AI-invented row the notifications brief forbids.
 *
 * What it DOES reuse, deliberately: the branded email shell
 * (`lib/notifications-v2/email-layout.ts`, which is written import-free so it
 * runs under Deno too) and the shared `{{variable}}` vocabulary, so a mail
 * from here is indistinguishable in look and in wording from the rest of the
 * platform's.
 */

import type { AutomationId } from "./schedule";

export type { AutomationId } from "./schedule";

/* -------------------------------------------------------------------------- */
/* Settings — table public.customer_management_settings (single row)          */
/* -------------------------------------------------------------------------- */

/**
 * Platform-scoped, exactly one row. No `tenant_id`: these are Drive247's own
 * settings, the same whichever operator the mail is about.
 */
export interface CustomerManagementSettings {
  id: number;

  /** Master switch per automation. */
  signup_enabled: boolean;
  renewal_enabled: boolean;
  receipt_enabled: boolean;

  /**
   * OFF (the default): only the rehearsal tenant receives anything.
   * ON: every operator on the platform does.
   *
   * This is a one-way door in practice — the first time it is switched on, a
   * backlog of tenants becomes eligible at once — so the runner caps a single
   * run (`max_sends_per_run`) and the UI says what the switch will reach
   * before you touch it.
   */
  scope_all_tenants: boolean;

  /** The tenant that receives mail while `scope_all_tenants` is OFF. */
  scope_tenant_slug: string;

  /* ---- Developer Test Mode ---- */

  /**
   * Compresses the timeline so a 14-day sequence plays out in five minutes.
   * See `schedule.ts` for the curve.
   */
  test_mode: boolean;

  /**
   * When the current rehearsal began. Every compressed due time is measured
   * from here rather than from the tenant's real signup date, which for an
   * existing account is already months past every offset.
   *
   * Stamped by the UI when test mode is switched on, and cleared when it is
   * switched off.
   */
  test_mode_started_at: string | null;

  /**
   * Identifies one rehearsal, so repeating it is not blocked by the first
   * one's log rows (`cycleKey` in schedule.ts folds this into the idempotency
   * key).
   */
  test_run_id: string | null;

  /**
   * WHERE REHEARSAL MAIL GOES. Required while test mode is on, and the runner
   * refuses to send at all if it is missing.
   *
   * Without this, rehearsing the sequence would deliver "Welcome to Drive247"
   * to a real operator's real inbox at 26-second intervals. Test mode changes
   * the clock; it must never change who is written to.
   */
  test_recipient_email: string | null;

  /** Safety valve: the most emails one cron tick may send. */
  max_sends_per_run: number;

  updated_at: string;
  updated_by: string | null;
}

/* -------------------------------------------------------------------------- */
/* Steps — table public.customer_management_steps                             */
/* -------------------------------------------------------------------------- */

/**
 * One email in an automation's timeline.
 *
 * `step_key` is the stable identity (it is half of the idempotency key), so it
 * must never be renamed once it has shipped — renaming it re-sends every mail
 * that step ever sent. `offset_days` is the part that is meant to be edited.
 */
export interface CustomerManagementStep {
  id: string;
  automation: AutomationId;
  /** snake_case, unique within the automation. Never rename once shipped. */
  step_key: string;
  /** Shown in the admin timeline, e.g. "Day 3 — getting set up". */
  label: string;
  /**
   * signup:  days AFTER the operator signed up.
   * renewal: days BEFORE the next charge.
   * receipt: ignored (the payment is the trigger).
   */
  offset_days: number;
  subject: string;
  /** HTML from the editor; the runner wraps it in the branded shell. */
  body_html: string;
  enabled: boolean;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
}

/** A step as the catalogue ships it, before anyone has edited anything. */
export type CustomerManagementStepSeed = Pick<
  CustomerManagementStep,
  "automation" | "step_key" | "label" | "offset_days" | "subject" | "body_html" | "enabled" | "sort_order"
>;

/* -------------------------------------------------------------------------- */
/* Log — table public.customer_management_sends                               */
/* -------------------------------------------------------------------------- */

export type SendStatus = "sent" | "skipped" | "failed";

/**
 * One row per attempt, and the idempotency record at the same time: the unique
 * index on (tenant_id, automation, step_key, cycle_key) is what stops a second
 * cron tick re-sending. A 'skipped' row is written too, because "why did this
 * operator not get the day-7 mail" is the question this table exists to
 * answer, and silence is not an answer.
 */
export interface CustomerManagementSend {
  id: string;
  tenant_id: string;
  automation: AutomationId;
  step_key: string;
  cycle_key: string;
  due_at: string;
  sent_at: string | null;
  status: SendStatus;
  to_email: string | null;
  subject: string | null;
  /** Populated on 'skipped' and 'failed'; a `RenewalSkipReason` or a provider error. */
  detail: string | null;
  /** True when this row came from a rehearsal, so the log can be filtered. */
  test_mode: boolean;
  created_at: string;
}

/** The log row joined to the tenant it is about, for the table in the UI. */
export interface CustomerManagementSendRow extends CustomerManagementSend {
  tenant_name: string | null;
  tenant_slug: string | null;
}

/* -------------------------------------------------------------------------- */
/* Runner result                                                              */
/* -------------------------------------------------------------------------- */

/** What `customer-management-run` reports back, shown after a manual run. */
export interface RunSummary {
  ok: boolean;
  dry_run: boolean;
  test_mode: boolean;
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  capped: boolean;
  /** Present when the runner declined to do anything at all. */
  halted?: string;
  results?: Array<{
    tenant_slug: string;
    automation: AutomationId;
    step_key: string;
    status: SendStatus;
    to_email?: string | null;
    detail?: string | null;
  }>;
}
