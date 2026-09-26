"use client";

/**
 * Payment plans — reads and operator actions for one rental.
 *
 * READS go straight to Postgres through the supabase client: RLS gives tenant
 * staff SELECT on all four plan tables (design §4) and nothing else.
 *
 * WRITES never touch a table. Every change goes through the
 * `payment-plan-manage` edge function (design §8), which checks the role,
 * re-derives every amount from the rule and the ledger, and calls the
 * SECURITY DEFINER SQL functions. The browser never sends an amount the server
 * charges; the one amount it does send is a manual record — the operator
 * stating money they already have.
 *
 * Conventions (CLAUDE.md): keys carry `tenant?.id`; every query is
 * `enabled: !!tenant && featureOn`, so a non-canary tenant, or a database the
 * migration has not reached, issues no plan query at all. `{ error }` is
 * checked on every call and surfaces in a toast — supabase-js never throws.
 */

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { extractFunctionError } from "@/lib/edge-error";
import type { CollectionMethod, ISODate, OccurrenceDraft } from "@/lib/payment-plans/types";
import { isPaymentPlansTenant, probePaymentPlans, type ProbeClient } from "@/lib/payment-plans-ui/feature";
import type { DashboardAccounts } from "@/lib/payment-plans-ui/dashboard-link";
import { LIVE_INSTALLMENT_STATUSES } from "@/lib/payment-plans-ui/legacy-mechanism";
import { draftToPlanForm, type PlanDraft } from "@/lib/payment-plans-ui/plan-form-model";
import { attemptFromRow, eventFromRow, occurrenceFromRow, planFromRow } from "@/lib/payment-plans-ui/rows";
import type { OccurrenceView, PlanBundle, PlanView, RecordPaymentInput } from "@/lib/payment-plans-ui/view-types";
import {
  normaliseCoverage,
  unitFromPeriodType,
  type RenewalInsurance,
  type RenewalPriceBreakdown,
  type RenewalQuote,
  type RenewalUnit,
} from "@/lib/payment-plans-ui/renewal";
import {
  agreementOutcomeWords,
  sendExtensionAgreements,
  type AgreementOutcome,
  type ExtensionForAgreement,
} from "@/lib/payment-plans-ui/extension-agreement";

export const PAYMENT_PLAN_FUNCTION = "payment-plan-manage";

/* ── the gate ────────────────────────────────────────────────────────────── */

export function paymentPlansAvailableKey(tenantId: string | undefined) {
  return ["payment-plans-available", tenantId] as const;
}

/**
 * On for the canary once its database has the tables. See
 * `lib/payment-plans-ui/feature.ts` for why both halves, and why it fails
 * closed.
 */
export function usePaymentPlansFeature() {
  const { tenant } = useTenant();
  const canary = isPaymentPlansTenant(tenant?.slug);
  const probe = useQuery({
    queryKey: paymentPlansAvailableKey(tenant?.id),
    queryFn: async () => {
      const result = await probePaymentPlans(supabase as unknown as ProbeClient);
      // A transient failure is retried; "missing" is a settled answer.
      if (result === "error") throw new Error("payment plan tables could not be checked");
      return result;
    },
    enabled: !!tenant && canary,
    staleTime: 5 * 60_000,
    retry: 2,
  });
  return {
    enabled: canary && probe.data === "available",
    isLoading: canary && probe.isLoading,
  };
}

/* ── one rental's plan ───────────────────────────────────────────────────── */

export function paymentPlanKey(tenantId: string | undefined, rentalId: string | null | undefined) {
  return ["payment-plan", tenantId, rentalId] as const;
}

export interface RentalPlanData extends PlanBundle {
  /** Earlier plans on this rental (cancelled or complete), newest first. */
  history: PlanView[];
}

const ATTEMPT_CHUNK = 80;

/** Poll while anything is mid-charge, so "Processing" settles without a reload. */
export const PROCESSING_POLL_MS = 5_000;

export function usePaymentPlan(rentalId: string | null | undefined, rentalEnd: ISODate | null) {
  const { tenant } = useTenant();
  const { enabled: featureOn } = usePaymentPlansFeature();

  return useQuery({
    queryKey: paymentPlanKey(tenant?.id, rentalId),
    enabled: !!tenant && featureOn && !!rentalId,
    queryFn: async (): Promise<RentalPlanData | null> => {
      const { data: planRows, error: planErr } = await supabaseUntyped
        .from("payment_plans")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .eq("rental_id", rentalId)
        .order("created_at", { ascending: false });
      if (planErr) throw planErr;
      const rows = (planRows ?? []) as Record<string, any>[];
      if (rows.length === 0) return null;

      // One live plan per rental is a unique index; the newest otherwise.
      const liveRow = rows.find((r) => r.status === "active" || r.status === "paused") ?? rows[0];
      const plan = planFromRow(liveRow, rentalEnd);

      const [occRes, evRes] = await Promise.all([
        supabaseUntyped
          .from("payment_plan_occurrences")
          .select("*")
          .eq("tenant_id", tenant!.id)
          .eq("plan_id", plan.id)
          .order("seq", { ascending: true }),
        supabaseUntyped
          .from("payment_plan_events")
          .select("*")
          .eq("tenant_id", tenant!.id)
          .eq("plan_id", plan.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (occRes.error) throw occRes.error;
      if (evRes.error) throw evRes.error;
      const occurrences = ((occRes.data ?? []) as Record<string, any>[]).map(occurrenceFromRow);

      // Attempts carry no plan_id; they are read by occurrence id, in chunks so
      // a long plan (up to 520 payments) never builds an over-long URL.
      const attempts: PlanBundle["attempts"] = [];
      const ids = occurrences.map((o) => o.id);
      for (let i = 0; i < ids.length; i += ATTEMPT_CHUNK) {
        const atRes = await supabaseUntyped
          .from("payment_plan_attempts")
          .select("*")
          .eq("tenant_id", tenant!.id)
          .in("occurrence_id", ids.slice(i, i + ATTEMPT_CHUNK))
          .order("attempt_no", { ascending: true });
        if (atRes.error) throw atRes.error;
        attempts.push(...((atRes.data ?? []) as Record<string, any>[]).map(attemptFromRow));
      }

      return {
        plan,
        occurrences,
        attempts,
        events: ((evRes.data ?? []) as Record<string, any>[]).map(eventFromRow),
        history: rows.filter((r) => r.id !== liveRow.id).map((r) => planFromRow(r, rentalEnd)),
      };
    },
    refetchInterval: (query) =>
      query.state.data?.occurrences.some((o) => o.status === "processing") ? PROCESSING_POLL_MS : false,
    // Returning from a Stripe tab should show what the webhook did.
    refetchOnWindowFocus: true,
  });
}

/**
 * The tenant's Stripe account ids, for the dashboard-link rules. Read from the
 * tenant's own row, which RLS already lets staff read (the rental-creation gate
 * reads the same columns).
 */
export function usePaymentPlanAccounts() {
  const { tenant } = useTenant();
  const { enabled: featureOn } = usePaymentPlansFeature();
  const q = useQuery({
    queryKey: ["payment-plan-accounts", tenant?.id],
    enabled: !!tenant && featureOn,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<DashboardAccounts> => {
      const { data, error } = await supabaseUntyped
        .from("tenants")
        .select("own_stripe_account_id, own_stripe_test_account_id, stripe_account_id")
        .eq("id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return {
        ownLive: data?.own_stripe_account_id ?? null,
        ownTest: data?.own_stripe_test_account_id ?? null,
        managed: data?.stripe_account_id ?? null,
      };
    },
  });
  return q.data ?? null;
}

/* ── one engine per rental ───────────────────────────────────────────────── */

/**
 * Does this rental have an installment plan that still collects money
 * (pending, active or overdue)? Read from the table, not from
 * `rentals.has_installment_plan`, because that flag outlives a cancelled plan
 * and the database's own refusal (pp__legacy_mechanism) reads the table.
 * `enabled` is false once a payment plan is live — the question only matters
 * before one is set up.
 */
export function useLiveInstallmentPlan(rentalId: string | null | undefined, enabled: boolean) {
  const { tenant } = useTenant();
  const { enabled: featureOn } = usePaymentPlansFeature();
  return useQuery({
    queryKey: ["payment-plan-live-installment", tenant?.id, rentalId],
    enabled: !!tenant && featureOn && !!rentalId && enabled,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabaseUntyped
        .from("installment_plans")
        .select("id")
        .eq("tenant_id", tenant!.id)
        .eq("rental_id", rentalId)
        .in("status", [...LIVE_INSTALLMENT_STATUSES])
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });
}

/* ── operator actions ────────────────────────────────────────────────────── */

export type ManageAction =
  | "preview"
  | "create"
  | "update"
  | "pause"
  | "resume"
  | "cancel"
  | "occurrence_move"
  | "occurrence_skip"
  | "occurrence_set_method"
  | "occurrence_retry"
  | "occurrence_send_link"
  | "occurrence_record_payment"
  // Wave 3 (pinned): extend the rental on its plan; the read-only comparison
  // of the old renewal job against the plan engine (Developer tab).
  | "extend"
  | "shadow_compare";

/**
 * Call `payment-plan-manage`. Throws an Error carrying the server's own
 * message — never the generic "non-2xx" text — so a toast can say what went
 * wrong. A 200 whose body says `ok: false` / carries `error` is a failure too.
 */
export async function invokePaymentPlanManage<T = Record<string, unknown>>(
  action: ManageAction,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(PAYMENT_PLAN_FUNCTION, { body: { action, ...body } });
  if (error) throw new Error(await extractFunctionError(error, "The payment plan could not be updated. Nothing was changed."));
  const d = data as Record<string, unknown> | null;
  if (d && (d.ok === false || (typeof d.error === "string" && d.error))) {
    throw new Error(String(d.error ?? d.message ?? "The payment plan could not be updated. Nothing was changed."));
  }
  return (d ?? {}) as T;
}

export interface PreviewResult {
  occurrences: OccurrenceDraft[];
  owedCents: number | null;
}

/**
 * A `preview` / `create` reply: `{ ok, occurrences?, summary: { owedCents, … } }`
 * (payment-plan-manage). `owedCents` is the balance the server sized the plan
 * from — pp_rental_owed_cents at that moment.
 */
export function readPreview(reply: Record<string, unknown>): PreviewResult {
  const occ = reply.occurrences;
  const summary = (reply.summary ?? {}) as Record<string, unknown>;
  const owed = summary.owedCents;
  return { occurrences: Array.isArray(occ) ? (occ as OccurrenceDraft[]) : [], owedCents: typeof owed === "number" ? owed : null };
}

/** Why Edit cannot make a plan keep renewing (said by the dialog and by `update`). */
export const EDIT_CANNOT_RENEW =
  "Edit changes the payments on this plan; it can't make the plan keep renewing the rental. To renew the rental, cancel this plan and set up a new one.";

/**
 * The plan fields `preview` / `create` / `update` send: the engine's
 * `PlanForm`. For a split plan it carries NO total — the server sizes it from
 * the ledger — so the browser never states an amount the server will charge.
 */
export function draftBody(d: PlanDraft) {
  return { form: draftToPlanForm(d) };
}

/* ── what one renewal period costs (D9) ──────────────────────────────────── */

/**
 * One renewal period's price from a `preview` reply —
 * `summary.renewal.breakdown` (engine PlanDraft.summary.renewal), integer
 * cents. Null when the reply carries no such breakdown.
 */
export function readRenewalQuote(reply: Record<string, unknown>): RenewalPriceBreakdown | null {
  const summary = (reply.summary ?? null) as Record<string, unknown> | null;
  const renewal = (summary?.renewal ?? null) as Record<string, unknown> | null;
  const b = (renewal?.breakdown ?? null) as Record<string, unknown> | null;
  if (!b) return null;
  const cents = (k: string) => (typeof b[k] === "number" && Number.isSafeInteger(b[k]) && (b[k] as number) >= 0 ? (b[k] as number) : null);
  const rentalCents = cents("rentalCents");
  const taxCents = cents("taxCents");
  const serviceFeeCents = cents("serviceFeeCents");
  const totalCents = cents("totalCents");
  if (rentalCents === null || taxCents === null || serviceFeeCents === null || totalCents === null || totalCents < 1) return null;
  return { rentalCents, taxCents, serviceFeeCents, totalCents };
}

/**
 * The price the SERVER will charge for one period of this renewing draft: its
 * own `preview` (no writes), read from `summary.renewal`. The price is the
 * rental's rate (less its discount) plus tax and fees — one rental-period rate
 * per renewal, whatever the period — so it is asked once per period choice,
 * not on every keystroke. Null when there is nothing to price.
 */
export function useRenewalQuote(rentalId: string | null | undefined, draft: PlanDraft | null | undefined): RenewalQuote | null {
  const { tenant } = useTenant();
  const { enabled: featureOn } = usePaymentPlansFeature();
  const renewal = draft?.renewal ?? null;
  const q = useQuery({
    queryKey: [
      "payment-plan-renewal-quote",
      tenant?.id,
      rentalId,
      renewal?.periodUnit ?? null,
      renewal?.periodCount ?? null,
      JSON.stringify(renewal?.insurance ?? null),
      draft?.collectionMethod ?? null,
    ],
    enabled: !!tenant && featureOn && !!rentalId && !!renewal,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<RenewalPriceBreakdown> => {
      const reply = await invokePaymentPlanManage("preview", { rentalId, ...draftBody(draft!) });
      const quote = readRenewalQuote(reply);
      if (!quote) throw new Error("the server did not say what one period costs.");
      return quote;
    },
  });
  if (!rentalId || !renewal || !featureOn) return null;
  if (q.data) return { state: "ready", breakdown: q.data };
  if (q.error) return { state: "error", message: q.error instanceof Error ? q.error.message : String(q.error) };
  return { state: "loading" };
}

/* ── extending on the plan (Wave 3) ──────────────────────────────────────── */

/** What the Extend dialog and the renewal answer need from the rental row. */
export interface RentalPlanFacts {
  endDate: ISODate | null;
  status: string | null;
  /** rental_period_type → the unit a renewal/extension period is counted in. */
  periodUnit: RenewalUnit;
  customerName: string | null;
  customerEmail: string | null;
  /** The rental's own Bonzah coverage (its policy's coverage_types), null when it has none. */
  coverage: RenewalInsurance | null;
}

export function rentalPlanFactsKey(tenantId: string | undefined, rentalId: string | null | undefined) {
  return ["payment-plan-rental-facts", tenantId, rentalId] as const;
}

/**
 * The rental facts behind Extend: its current return date, who to send the
 * agreement to (the same `customers` name/email the manual extension uses),
 * and the cover its Bonzah policy carries (the manual extension prefills from
 * the same `coverage_types`).
 */
export function useRentalPlanFacts(rentalId: string | null | undefined, enabled = true) {
  const { tenant } = useTenant();
  const { enabled: featureOn } = usePaymentPlansFeature();
  return useQuery({
    queryKey: rentalPlanFactsKey(tenant?.id, rentalId),
    enabled: !!tenant && featureOn && !!rentalId && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<RentalPlanFacts> => {
      const { data, error } = await supabaseUntyped
        .from("rentals")
        .select("id, end_date, status, rental_period_type, bonzah_policy_id, customers(name, email)")
        .eq("tenant_id", tenant!.id)
        .eq("id", rentalId)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? {}) as Record<string, any>;
      let coverage: RenewalInsurance | null = null;
      if (row.bonzah_policy_id) {
        const pol = await supabaseUntyped
          .from("bonzah_insurance_policies")
          .select("coverage_types")
          .eq("id", row.bonzah_policy_id)
          .maybeSingle();
        if (pol.error) throw pol.error;
        coverage = normaliseCoverage((pol.data as Record<string, any> | null)?.coverage_types);
      }
      const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
      return {
        endDate: typeof row.end_date === "string" ? row.end_date.slice(0, 10) : null,
        status: row.status ?? null,
        periodUnit: unitFromPeriodType(row.rental_period_type),
        customerName: customer?.name ?? null,
        customerEmail: customer?.email ?? null,
        coverage,
      };
    },
  });
}

/** What the operator chose in the Extend dialog (the pinned `extend` body, less rentalId). */
export interface ExtendInput {
  periods: number;
  giveDaysNow: boolean;
  sendAgreement: boolean;
  /** Bonzah cover for the new days; null = none. */
  insurance: RenewalInsurance | null;
  /**
   * The period the dialog counted and showed — ALWAYS sent. A renewing plan's
   * own period (the server uses the plan's, which is the same), else one of
   * the rental's own periods. Never left for the server to default: a default
   * that differs from the screen prices days the operator did not see.
   */
  periodUnit: RenewalUnit;
  periodCount: number;
}

export interface ExtendOutcome {
  extensionIds: string[];
  occurrenceIds: string[];
  /** Null when no agreement was asked for (or nothing to send it for). */
  agreements: AgreementOutcome | null;
}

/** rental_extension_totals, read for the agreement body. RLS: tenant staff SELECT. */
export async function readExtensionsForAgreement(ids: string[]): Promise<ExtensionForAgreement[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseUntyped
    .from("rental_extension_totals")
    .select("id, sequence_number, previous_end_date, new_end_date, total_amount")
    .in("id", ids);
  if (error) throw error;
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: String(r.id),
    sequenceNumber: Number(r.sequence_number) || 0,
    previousEndDate: typeof r.previous_end_date === "string" ? r.previous_end_date.slice(0, 10) : null,
    newEndDate: typeof r.new_end_date === "string" ? r.new_end_date.slice(0, 10) : null,
    totalAmount: r.total_amount === null || r.total_amount === undefined ? null : Number(r.total_amount),
  }));
}

/**
 * Extend the rental on its plan: `payment-plan-manage` 'extend' first — the
 * server creates the extension rows, their charges and the plan's new
 * occurrences — then, when asked, the extension agreement through the SAME
 * `/api/esign` request the manual extension makes (one per new extension).
 * An agreement that fails never undoes the extension; it is reported.
 */
export async function extendOnPlan(
  ctx: {
    rentalId: string;
    tenantId: string;
    customerName?: string | null;
    customerEmail?: string | null;
    /** The plan's occurrences after the extend, for a fallback amount per extension. */
    occurrences?: () => OccurrenceView[];
    fetchImpl?: typeof fetch;
  },
  input: ExtendInput,
): Promise<ExtendOutcome> {
  const reply = await invokePaymentPlanManage<{ extensionIds?: unknown; occurrenceIds?: unknown }>("extend", {
    rentalId: ctx.rentalId,
    periods: input.periods,
    giveDaysNow: input.giveDaysNow,
    sendAgreement: input.sendAgreement,
    // Explicit null = "no insurance for the new days" — never left for the
    // server to default.
    insurance: input.insurance,
    // The period on screen, always (D3): never the server's own default.
    periodUnit: input.periodUnit,
    periodCount: input.periodCount,
  });
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const extensionIds = ids(reply.extensionIds);
  const occurrenceIds = ids(reply.occurrenceIds);
  let agreements: AgreementOutcome | null = null;
  if (input.sendAgreement && extensionIds.length > 0) {
    const doFetch = ctx.fetchImpl ?? fetch;
    agreements = await sendExtensionAgreements({
      rentalId: ctx.rentalId,
      tenantId: ctx.tenantId,
      customerEmail: ctx.customerEmail,
      customerName: ctx.customerName,
      extensionIds,
      readExtensions: readExtensionsForAgreement,
      fallbackCents: (extId) => {
        const o = ctx.occurrences?.().find((x) => x.extensionId === extId);
        return o ? o.amountCents : null;
      },
      fetchImpl: (url, init) => doFetch(url, init),
    });
  }
  return { extensionIds, occurrenceIds, agreements };
}

export function usePaymentPlanActions(rentalId: string | null | undefined) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: paymentPlanKey(tenant?.id, rentalId) });
    // An extension moves the return date and adds extension rows.
    void qc.invalidateQueries({ queryKey: rentalPlanFactsKey(tenant?.id, rentalId) });
    void qc.invalidateQueries({ queryKey: ["rental-extension-totals", tenant?.id, rentalId] });
    // A recorded or collected payment moves the rental's own ledger too.
    void qc.invalidateQueries({ queryKey: ["rental-payments-ledger-v2", rentalId] });
    void qc.invalidateQueries({ queryKey: ["rental-totals", tenant?.id, rentalId] });
    void qc.invalidateQueries({ queryKey: ["rental-detail-v2", rentalId] });
  }, [qc, tenant?.id, rentalId]);

  /** Run one action; toast the outcome; rethrow so a dialog can stay open on failure. */
  const run = useCallback(
    async <T = Record<string, unknown>>(
      key: string,
      action: ManageAction,
      body: Record<string, unknown>,
      success: string | ((reply: T) => string),
    ): Promise<T> => {
      setBusy(key);
      try {
        const reply = await invokePaymentPlanManage<T>(action, { rentalId, ...body });
        toast({ title: typeof success === "function" ? success(reply) : success });
        refresh();
        return reply;
      } catch (err) {
        toast({
          title: "That didn't work",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        refresh();
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [rentalId, refresh, toast],
  );

  return useMemo(
    () => ({
      busy,
      refresh,
      /** No writes. The server fills the balance from the ledger. */
      preview: (d: PlanDraft) => invokePaymentPlanManage("preview", { rentalId, ...draftBody(d) }).then(readPreview),
      create: (d: PlanDraft) => run("create", "create", draftBody(d), "Payment plan set up"),
      update: (planId: string, expectedVersion: number, d: PlanDraft, reason: string) => {
        // Edit never turns a plan into one that renews the rental (the server
        // refuses it too). Converting is its own, explicit action.
        if (d.renewal) {
          toast({ title: "That didn't work", description: EDIT_CANNOT_RENEW, variant: "destructive" });
          return Promise.reject(new Error(EDIT_CANNOT_RENEW));
        }
        return run("update", "update", { planId, expectedVersion, reason, ...draftBody(d) }, "Payment plan updated");
      },
      pause: (planId: string, reason?: string) => run("pause", "pause", { planId, reason }, "Plan paused — nothing is collected until you resume it"),
      resume: (planId: string) => run("resume", "resume", { planId }, "Plan resumed"),
      cancel: (planId: string, reason?: string) => run("cancel", "cancel", { planId, reason }, "Plan cancelled"),
      move: (occurrenceId: string, to: ISODate) => run(`move:${occurrenceId}`, "occurrence_move", { occurrenceId, to }, "Payment moved"),
      skip: (occurrenceId: string) => run(`skip:${occurrenceId}`, "occurrence_skip", { occurrenceId }, "Payment skipped — its amount moved to the next one"),
      setMethod: (occurrenceId: string, method: CollectionMethod) =>
        run(`method:${occurrenceId}`, "occurrence_set_method", { occurrenceId, method }, "Collection method changed"),
      retry: (occurrenceId: string) => run(`retry:${occurrenceId}`, "occurrence_retry", { occurrenceId }, "Card retried — the result appears here in a moment"),
      sendLink: (occurrenceId: string) =>
        run<{ url?: string }>(`link:${occurrenceId}`, "occurrence_send_link", { occurrenceId }, "Payment link sent to the customer"),
      /**
       * Extend on the plan, then (if asked) send the extension agreement(s).
       * One toast says both halves; an agreement that did not go is a
       * warning, not a failure of the extension.
       */
      extend: async (input: ExtendInput, who: { customerName?: string | null; customerEmail?: string | null; occurrences?: () => OccurrenceView[] }) => {
        if (!rentalId || !tenant?.id) throw new Error("The rental is not loaded yet.");
        setBusy("extend");
        try {
          const outcome = await extendOnPlan({ rentalId, tenantId: tenant.id, ...who }, input);
          const agreementWords = agreementOutcomeWords(outcome.agreements);
          const warn = !!outcome.agreements && outcome.agreements.failed.length > 0;
          toast({
            title: input.giveDaysNow ? "Rental extended — the new days are on the plan" : "Extension added — the days are given as each period is paid",
            description: agreementWords ?? undefined,
            ...(warn ? { variant: "destructive" as const } : {}),
          });
          refresh();
          return outcome;
        } catch (err) {
          toast({
            title: "The rental was not extended",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
          refresh();
          throw err;
        } finally {
          setBusy(null);
        }
      },
      recordPayment: (occurrenceId: string, input: RecordPaymentInput) =>
        run(
          `record:${occurrenceId}`,
          "occurrence_record_payment",
          { occurrenceId, amountCents: input.amountCents, method: input.method, paymentDate: input.date, note: input.note || null },
          "Payment recorded",
        ),
    }),
    [busy, refresh, rentalId, run, tenant?.id, toast],
  );
}
