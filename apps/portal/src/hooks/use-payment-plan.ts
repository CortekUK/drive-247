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
import { draftToPlanForm, type PlanDraft } from "@/lib/payment-plans-ui/plan-form-model";
import { attemptFromRow, eventFromRow, occurrenceFromRow, planFromRow } from "@/lib/payment-plans-ui/rows";
import type { PlanBundle, PlanView, RecordPaymentInput } from "@/lib/payment-plans-ui/view-types";

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
  | "occurrence_record_payment";

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

/**
 * The plan fields `preview` / `create` / `update` send: the engine's
 * `PlanForm`. For a split plan it carries NO total — the server sizes it from
 * the ledger — so the browser never states an amount the server will charge.
 */
export function draftBody(d: PlanDraft) {
  return { form: draftToPlanForm(d) };
}

export function usePaymentPlanActions(rentalId: string | null | undefined) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: paymentPlanKey(tenant?.id, rentalId) });
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
      update: (planId: string, expectedVersion: number, d: PlanDraft, reason: string) =>
        run("update", "update", { planId, expectedVersion, reason, ...draftBody(d) }, "Payment plan updated"),
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
      recordPayment: (occurrenceId: string, input: RecordPaymentInput) =>
        run(
          `record:${occurrenceId}`,
          "occurrence_record_payment",
          { occurrenceId, amountCents: input.amountCents, method: input.method, paymentDate: input.date, note: input.note || null },
          "Payment recorded",
        ),
    }),
    [busy, refresh, rentalId, run],
  );
}
