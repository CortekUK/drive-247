/**
 * Balance adjustments — the reads and the three writes behind the canary
 * "Adjust balance" panel (docs/PAYMENTS_ROADMAP.md Wave 1, assumption A1).
 *
 * No new money path. Every write goes through something that already exists:
 *
 *   (a) a charge was wrong / (c) goodwill / request a payment / undo
 *       → `adjust-customer-balance` (its additive v2 body), which calls ONE SQL
 *         function that writes the ledger row and the audit row together.
 *   (b) money received outside the platform
 *       → the portal's own Record Payment sequence, step for step as
 *         `AddPaymentDialog` (rental) / `CollectPaymentDialog` (account) do it:
 *         a `payments` insert — with `is_off_platform: true` in that same insert
 *         — then `apply-payment`, rolled back the same way if it fails; THEN
 *         `adjust-customer-balance` records who and why against it.
 *   undo of (b) → the existing `reverse-payment` function, then the audit row.
 *
 * Reads degrade instead of failing: until the migration is applied the table
 * does not exist, and `available` is false — the panel says so and offers
 * nothing that would fail.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { extractFunctionError } from "@/lib/edge-error";
import { centsOf, type AdjustmentKind } from "@/components/balance/balance-words";

export const BALANCE_ADJUSTMENTS_KEY = "balance-adjustments";

export interface BalanceScope {
  customerId: string;
  /** Narrows everything to one rental. */
  rentalId?: string | null;
}

export interface AdjustmentRow {
  id: string;
  kind: AdjustmentKind;
  amount: number | string;
  reason_code: string;
  note: string;
  rental_id: string | null;
  extension_id: string | null;
  ledger_entry_id: string | null;
  payment_id: string | null;
  target_charge_id: string | null;
  reverses_id: string | null;
  created_by: string;
  created_at: string;
}

export interface OffPlatformPaymentRow {
  id: string;
  amount: number | string;
  method: string | null;
  payment_date: string | null;
  status: string | null;
  rental_id: string | null;
}

export interface AdjustmentEntry {
  id: string;
  kind: AdjustmentKind;
  amountCents: number;
  reasonCode: string;
  note: string;
  rentalId: string | null;
  extensionId: string | null;
  ledgerEntryId: string | null;
  paymentId: string | null;
  targetChargeId: string | null;
  reversesId: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  /** The entry that undid this one, if any. */
  undoneBy: { id: string; at: string; byName: string | null } | null;
  /** Off-platform only: the payment's own status now ('Reversed' once taken back). */
  paymentStatus: string | null;
  paymentMethod: string | null;
  /** Off-platform only: the payment was reversed (e.g. from Finances) but no undo was recorded here. */
  reversedWithoutUndo: boolean;
}

/** An off-platform payment with no audit row — recorded, but its "why" was never saved. */
export interface UnrecordedPayment {
  paymentId: string;
  amountCents: number;
  method: string | null;
  paymentDate: string | null;
  rentalId: string | null;
}

const ADJUSTMENT_COLUMNS =
  "id, kind, amount, reason_code, note, rental_id, extension_id, ledger_entry_id, payment_id, target_charge_id, reverses_id, created_by, created_at";

/** The table (or the column) is not there yet: the migration is not applied. */
export function isMissingSchema(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "42P01" || e.code === "PGRST205" || e.code === "42703" || e.code === "PGRST204") return true;
  const text = typeof e.message === "string" ? e.message : "";
  return /balance_adjustments|is_off_platform/.test(text) && /does not exist|could not find/i.test(text);
}

/**
 * Pure: the rows, the staff names and the scope's off-platform payments → the
 * history, newest first, with each undo tied to what it undid, and the
 * off-platform payments nobody wrote a note for.
 */
export function buildAdjustmentHistory(
  rows: AdjustmentRow[],
  names: Map<string, string>,
  payments: OffPlatformPaymentRow[],
): { entries: AdjustmentEntry[]; unrecorded: UnrecordedPayment[] } {
  const undoOf = new Map<string, AdjustmentRow>();
  for (const r of rows) if (r.reverses_id) undoOf.set(r.reverses_id, r);
  const paymentById = new Map(payments.map((p) => [p.id, p]));

  const entries: AdjustmentEntry[] = rows
    .map((r) => {
      const undo = undoOf.get(r.id) ?? null;
      const pay = r.payment_id ? paymentById.get(r.payment_id) ?? null : null;
      const paymentStatus = pay?.status ?? null;
      return {
        id: r.id,
        kind: r.kind,
        amountCents: centsOf(r.amount),
        reasonCode: r.reason_code,
        note: r.note,
        rentalId: r.rental_id,
        extensionId: r.extension_id,
        ledgerEntryId: r.ledger_entry_id,
        paymentId: r.payment_id,
        targetChargeId: r.target_charge_id,
        reversesId: r.reverses_id,
        createdBy: r.created_by,
        createdByName: names.get(r.created_by) ?? null,
        createdAt: r.created_at,
        undoneBy: undo ? { id: undo.id, at: undo.created_at, byName: names.get(undo.created_by) ?? null } : null,
        paymentStatus,
        paymentMethod: pay?.method ?? null,
        reversedWithoutUndo: r.kind === "off_platform_payment" && !r.reverses_id && !undo && paymentStatus === "Reversed",
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const recorded = new Set(rows.filter((r) => r.kind === "off_platform_payment" && !r.reverses_id).map((r) => r.payment_id));
  const unrecorded: UnrecordedPayment[] = payments
    .filter((p) => !recorded.has(p.id) && p.status !== "Reversed" && p.status !== "Refunded" && p.status !== "Pending")
    .map((p) => ({ paymentId: p.id, amountCents: centsOf(p.amount), method: p.method, paymentDate: p.payment_date, rentalId: p.rental_id }));

  return { entries, unrecorded };
}

export function useBalanceAdjustments(scope: BalanceScope | null) {
  const { tenant } = useTenant();
  const customerId = scope?.customerId ?? null;
  const rentalId = scope?.rentalId ?? null;

  const query = useQuery({
    queryKey: [BALANCE_ADJUSTMENTS_KEY, tenant?.id, customerId, rentalId],
    queryFn: async (): Promise<{ available: boolean; entries: AdjustmentEntry[]; unrecorded: UnrecordedPayment[] }> => {
      let q = supabaseUntyped
        .from("balance_adjustments")
        .select(ADJUSTMENT_COLUMNS)
        .eq("tenant_id", tenant!.id)
        .eq("customer_id", customerId);
      if (rentalId) q = q.eq("rental_id", rentalId);
      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) {
        if (isMissingSchema(error)) return { available: false, entries: [], unrecorded: [] };
        throw new Error(error.message || "Could not read the balance history.");
      }
      const rows = (data ?? []) as AdjustmentRow[];

      // Names are a courtesy: a failed read shows "A team member", never an error.
      const names = new Map<string, string>();
      const ids = [...new Set(rows.map((r) => r.created_by))];
      if (ids.length) {
        const { data: users } = await supabaseUntyped.from("app_users").select("id, name, email").in("id", ids);
        for (const u of (users ?? []) as { id: string; name: string | null; email: string | null }[]) {
          names.set(u.id, u.name || u.email || "A team member");
        }
      }

      let pq = supabaseUntyped
        .from("payments")
        .select("id, amount, method, payment_date, status, rental_id")
        .eq("tenant_id", tenant!.id)
        .eq("customer_id", customerId)
        .eq("is_off_platform", true);
      if (rentalId) pq = pq.eq("rental_id", rentalId);
      const { data: pays, error: payError } = await pq;
      if (payError && !isMissingSchema(payError)) throw new Error(payError.message || "Could not read payments.");

      return { available: true, ...buildAdjustmentHistory(rows, names, (pays ?? []) as OffPlatformPaymentRow[]) };
    },
    enabled: !!tenant && !!customerId,
  });

  return {
    available: query.data?.available,
    entries: query.data?.entries ?? [],
    unrecorded: query.data?.unrecorded ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   The charges a correction can be aimed at
   ══════════════════════════════════════════════════════════════════════════ */

export interface AdjustableCharge {
  id: string;
  category: string;
  amountCents: number;
  remainingCents: number;
  dueDate: string | null;
  reference: string | null;
  rentalId: string | null;
  extensionId: string | null;
}

/** Positive charges on the account (or one rental), never the deposit — the only things `balance_adjust` will correct. */
export function useAdjustableCharges(scope: BalanceScope | null, enabled = true) {
  const { tenant } = useTenant();
  const customerId = scope?.customerId ?? null;
  const rentalId = scope?.rentalId ?? null;
  return useQuery({
    queryKey: [BALANCE_ADJUSTMENTS_KEY, "charges", tenant?.id, customerId, rentalId],
    queryFn: async (): Promise<AdjustableCharge[]> => {
      let q = supabase
        .from("ledger_entries")
        .select("id, category, amount, remaining_amount, due_date, reference, rental_id, extension_id")
        .eq("tenant_id", tenant!.id)
        .eq("customer_id", customerId!)
        .eq("type", "Charge")
        .gt("amount", 0)
        .neq("category", "Security Deposit");
      if (rentalId) q = q.eq("rental_id", rentalId);
      const { data, error } = await q.order("due_date", { ascending: true });
      if (error) throw new Error(error.message || "Could not read the charges.");
      return ((data ?? []) as any[]).map((c) => ({
        id: c.id,
        category: c.category,
        amountCents: centsOf(c.amount),
        remainingCents: centsOf(c.remaining_amount),
        dueDate: c.due_date ?? null,
        reference: c.reference ?? null,
        rentalId: c.rental_id ?? null,
        extensionId: c.extension_id ?? null,
      }));
    },
    enabled: enabled && !!tenant && !!customerId,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   The writes
   ══════════════════════════════════════════════════════════════════════════ */

/** The adjust-customer-balance v2 body (see supabase/functions/adjust-customer-balance/core.ts). */
export type AdjustBody =
  | {
      kind: "charge_correction";
      amount: number;
      direction: "increase" | "decrease";
      reason_code: string;
      note: string;
      charge_id?: string | null;
      rentalId?: string | null;
      extensionId?: string | null;
    }
  | { kind: "goodwill"; amount: number; direction: "decrease"; reason_code: string; note: string; rentalId?: string | null }
  | { kind: "off_platform_payment"; payment_id: string; reason_code: string; note: string }
  | { kind: AdjustmentKind; reverses_id: string; reason_code: string; note: string };

export interface AdjustResult {
  ok: true;
  kind: AdjustmentKind;
  adjustmentId: string;
  entryId: string | null;
  paymentId: string | null;
  reversesId: string | null;
  signedAmount: number;
  reference: string | null;
}

/** An off-platform payment that landed and was applied, but whose audit row did not save. */
export class AuditNotSavedError extends Error {
  constructor(public paymentId: string, cause: string) {
    super(`The payment was recorded and applied, but its note was not saved: ${cause}`);
    this.name = "AuditNotSavedError";
  }
}

/** A likely duplicate the operator must confirm — the same rule Record Payment applies. */
export interface DuplicateHint {
  amountCents: number;
  paymentDate: string | null;
  method: string | null;
}

export interface OffPlatformInput {
  customerId: string;
  /** Null = held on the account, as Collect Payment does. */
  rentalId: string | null;
  /** Undefined = read it off the rental, as Record Payment's vehicle picker would have. */
  vehicleId?: string | null;
  amountCents: number;
  method: string;
  /** 'YYYY-MM-DD', the day the money arrived. */
  paymentDate: string;
  reasonCode: string;
  note: string;
}

const dollars = (cents: number) => Math.round(cents) / 100;

export function useBalanceActions() {
  const { tenant } = useTenant();
  const qc = useQueryClient();

  const invalidate = async () => {
    const keys: unknown[][] = [
      [BALANCE_ADJUSTMENTS_KEY],
      ["customer-balance"],
      ["customer-balance-status"],
      ["customers-list"],
      ["customer-balances-enhanced"],
      ["ledger-entries"],
      ["customer-payments"],
      ["customer-v2-ledger"],
      ["rental-payments-ledger-v2"],
      ["rental-charges-payments"],
      ["rental-totals"],
      ["rental-balance"],
      ["payments-data"],
      ["finances"],
    ];
    await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey, refetchType: "all" })));
  };

  /** One adjust-customer-balance v2 call. Throws the server's own words. */
  const adjust = async (customerId: string, body: AdjustBody): Promise<AdjustResult> => {
    const { data, error } = await supabase.functions.invoke("adjust-customer-balance", {
      body: { customerId, tenantId: tenant?.id, ...body },
    });
    if (error) throw new Error(await extractFunctionError(error, "The change could not be saved."));
    if (!data?.ok) throw new Error(data?.error || "The change could not be saved.");
    return data as AdjustResult;
  };

  const adjustAndRefresh = async (customerId: string, body: AdjustBody) => {
    const out = await adjust(customerId, body);
    await invalidate();
    return out;
  };

  /** Record Payment's duplicate rule: same rental, same amount, in the last 14 days, not cancelled. */
  const findRecentDuplicate = async (rentalId: string | null, amountCents: number): Promise<DuplicateHint | null> => {
    if (!rentalId) return null;
    const sinceIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("payments")
      .select("id, amount, payment_date, method, status")
      .eq("rental_id", rentalId)
      .eq("amount", dollars(amountCents))
      .neq("status", "Cancelled")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1);
    const m = (data ?? [])[0] as any;
    return m ? { amountCents: centsOf(m.amount), paymentDate: m.payment_date ?? null, method: m.method ?? null } : null;
  };

  /**
   * (b) — Record Payment's own sequence with the flag set in the same insert,
   * then the audit row. Returns the payment id.
   */
  const recordOffPlatformPayment = async (input: OffPlatformInput): Promise<string> => {
    const amount = dollars(input.amountCents);
    let vehicleId = input.vehicleId ?? null;
    if (input.vehicleId === undefined && input.rentalId) {
      const { data: rental, error: rentalError } = await supabase
        .from("rentals")
        .select("vehicle_id")
        .eq("id", input.rentalId)
        .maybeSingle();
      if (rentalError) throw new Error(rentalError.message || "Could not read the rental.");
      vehicleId = (rental as { vehicle_id: string | null } | null)?.vehicle_id ?? null;
    }
    const { data: payment, error: paymentError } = await supabaseUntyped
      .from("payments")
      .insert({
        customer_id: input.customerId,
        vehicle_id: vehicleId,
        rental_id: input.rentalId,
        amount,
        payment_date: input.paymentDate,
        method: input.method,
        payment_type: "Payment",
        status: "Completed",
        remaining_amount: amount,
        tenant_id: tenant?.id,
        verification_status: "approved",
        booking_source: "admin",
        is_off_platform: true,
      })
      .select()
      .single();
    if (paymentError) {
      if (isMissingSchema(paymentError)) {
        throw new Error("Off-platform payments switch on once the database update is applied.");
      }
      throw new Error(paymentError.message || "The payment could not be recorded.");
    }

    // Exactly as AddPaymentDialog (rental) / CollectPaymentDialog (account).
    const applyBody: Record<string, unknown> = { paymentId: payment.id };
    if (!input.rentalId) applyBody.holdAsCredit = true;
    const { data: applyResult, error: applyError } = await supabase.functions.invoke("apply-payment", { body: applyBody });

    // Roll back BOTH the ledger Payment entry AND the payments row when
    // apply-payment fails — an orphan ledger Payment row becomes phantom credit
    // (see AddPaymentDialog).
    if (applyError || !applyResult?.ok) {
      let ledgerDelete = supabase.from("ledger_entries").delete().eq("payment_id", payment.id).eq("type", "Payment");
      if (tenant?.id) ledgerDelete = ledgerDelete.eq("tenant_id", tenant.id);
      await ledgerDelete;
      let paymentDelete = supabase.from("payments").delete().eq("id", payment.id);
      if (tenant?.id) paymentDelete = paymentDelete.eq("tenant_id", tenant.id);
      await paymentDelete;
      const detail = applyError
        ? await extractFunctionError(applyError, "Payment processing failed")
        : applyResult?.error || applyResult?.detail || "Payment processing failed";
      throw new Error(detail);
    }

    try {
      await adjust(input.customerId, {
        kind: "off_platform_payment",
        payment_id: payment.id,
        reason_code: input.reasonCode,
        note: input.note,
      });
    } catch (err: any) {
      await invalidate();
      throw new AuditNotSavedError(payment.id, err?.message || "unknown error");
    }
    await invalidate();
    return payment.id as string;
  };

  /** Save the missing "why" against an off-platform payment already recorded. */
  const recordOffPlatformNote = (customerId: string, paymentId: string, reasonCode: string, note: string) =>
    adjustAndRefresh(customerId, { kind: "off_platform_payment", payment_id: paymentId, reason_code: reasonCode, note });

  /**
   * Undo. An off-platform payment is first taken back by the existing
   * `reverse-payment` function (unless it already was), then the reversing
   * entry is recorded. Everything else is one call.
   */
  const undo = async (
    customerId: string,
    entry: { id: string; kind: AdjustmentKind; paymentId: string | null; paymentStatus: string | null },
    reasonCode: string,
    note: string,
  ): Promise<AdjustResult> => {
    if (entry.kind === "off_platform_payment" && entry.paymentId && entry.paymentStatus !== "Reversed") {
      const { data, error } = await supabase.functions.invoke("reverse-payment", {
        body: { paymentId: entry.paymentId, reason: note.trim() },
      });
      if (error) throw new Error(await extractFunctionError(error, "The payment could not be reversed."));
      if (!data?.success) throw new Error(data?.error || "The payment could not be reversed.");
    }
    return adjustAndRefresh(customerId, { kind: entry.kind, reverses_id: entry.id, reason_code: reasonCode, note });
  };

  return { adjust: adjustAndRefresh, findRecentDuplicate, recordOffPlatformPayment, recordOffPlatformNote, undo, invalidate };
}
