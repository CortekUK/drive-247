import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { computePaygDailyRate } from "@/lib/payg-rate";

export type PaygInvoiceStatus = "open" | "paid" | "superseded";

export interface PaygInvoiceRow {
  id: string;
  dayIndex: number;
  invoiceRef: string; // pg-001
  createdAt: string; // accrual_window_start
  dayTotal: number; // this invoice's own day charge (rental + tax + service_fee)
  /** Per-day breakdown — exposed for the statement view. */
  dailyRate: number;
  taxAmount: number;
  serviceFeeAmount: number;
  cumulativeAmount: number; // rolling total at creation time
  status: PaygInvoiceStatus;
  paidAt: string | null;
  settlingPaymentId: string | null;
  supersededBy: string | null; // e.g., "pg-002"
}

export interface PaygPaymentRow {
  id: string;
  amount: number;
  refundAmount: number;
  status: string | null;
  paymentDate: string | null;
  createdAt: string;
}

export interface PaygReminderRow {
  id: string;
  sentAt: string;
  reminderNumber: number;
  accrualId: string | null;
  invoiceRef: string | null; // derived from accrualId -> dayIndex
  outstandingAmount: number;
  channel: string;
  recipient: string;
  success: boolean;
}

/**
 * Why automated reminders are not currently sending.
 * Mirrors the gates inside `send-payg-reminders` so the UI can explain itself.
 */
export type PaygReminderBlockReason =
  | "tenant_disabled"            // tenant.payg_auto_reminders_enabled === false
  | "rental_reminders_disabled"  // rental.payg_auto_reminders_enabled === false (operator flipped this rental's toggle off)
  | "rental_inactive"            // rental.status !== 'Active'
  | "rental_paused"              // rental.payg_paused === true
  | "rental_closed"              // rental.payg_closed_at !== null
  | "no_open_invoice"            // no PAYG accrual with invoice_status='open'
  | null;

export interface PaygReminderStatus {
  /** Master tenant toggle. */
  autoEnabled: boolean;
  /** Per-rental toggle. Defaults to true; operator flips it from the PAYG section. */
  rentalAutoEnabled: boolean;
  /**
   * When the next automated reminder is scheduled to fire (or `null` when not
   * applicable). Computed as max(last_sent_at, payg_start_ts) + intervalDays,
   * ignoring blockers — the cron will skip past it when blockers clear.
   */
  nextReminderAt: string | null;
  /** Effective reminder interval in days (per-rental override, falling back to tenant default). */
  intervalDays: number;
  /** True when this rental uses an override different from the tenant default. */
  isCustomInterval: boolean;
  /** Why the cron will skip this rental right now (null = will fire on schedule). */
  blockReason: PaygReminderBlockReason;
}

export interface PaygInvoiceData {
  invoices: PaygInvoiceRow[]; // ascending by dayIndex (the caller reverses for display)
  payments: PaygPaymentRow[];
  reminders: PaygReminderRow[];
  dailyRate: number;
  lastUpdatedAt: string | null;
  totals: {
    collected: number;
    balanceDue: number;
    refunded: number;
    netReceived: number;
  };
  latestOpenInvoice: PaygInvoiceRow | null;
  reminderStatus: PaygReminderStatus;
}

const EMPTY: PaygInvoiceData = {
  invoices: [],
  payments: [],
  reminders: [],
  dailyRate: 0,
  lastUpdatedAt: null,
  totals: { collected: 0, balanceDue: 0, refunded: 0, netReceived: 0 },
  latestOpenInvoice: null,
  reminderStatus: { autoEnabled: false, rentalAutoEnabled: true, nextReminderAt: null, intervalDays: 4, isCustomInterval: false, blockReason: null },
};

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function invoiceRefFor(dayIndex: number): string {
  return `pg-${String(dayIndex).padStart(3, "0")}`;
}

export const usePaygInvoices = (rentalId: string | undefined, enabled: boolean) => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["payg-invoices", tenant?.id, rentalId] as const,
    [tenant?.id, rentalId],
  );

  // Realtime: subscribe to changes on the 3 tables this hook reads. Any
  // INSERT/UPDATE/DELETE for THIS rental triggers a query invalidation, so
  // the admin's view updates the instant a Stripe webhook settles a payment /
  // cron creates an invoice / a reminder is logged (and vice versa). Polling
  // stays on as a backup if the websocket drops.
  useEffect(() => {
    if (!rentalId || !tenant?.id || !enabled) return;
    const filter = `rental_id=eq.${rentalId}`;
    const channel = supabase
      .channel(`payg:${rentalId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payg_accruals", filter },
        () => queryClient.invalidateQueries({ queryKey }))
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter },
        () => queryClient.invalidateQueries({ queryKey }))
      .on("postgres_changes", { event: "*", schema: "public", table: "payg_reminder_log", filter },
        () => queryClient.invalidateQueries({ queryKey }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rentalId, tenant?.id, enabled, queryClient, queryKey]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<PaygInvoiceData> => {
      if (!rentalId || !tenant?.id) return EMPTY;

      const [accrualsRes, paymentsRes, remindersRes, rentalRes, tenantRes] = await Promise.all([
        supabaseUntyped
          .from("payg_accruals")
          .select(
            "id, accrual_day_index, accrual_window_start, accrual_window_end, daily_rate, tax_amount, service_fee_amount, created_at, invoice_status, paid_at, settling_payment_id, superseded_by_accrual_id",
          )
          .eq("rental_id", rentalId)
          .eq("tenant_id", tenant.id)
          .order("accrual_day_index", { ascending: true }),
        supabaseUntyped
          .from("payments")
          .select(
            "id, amount, refund_amount, status, payment_date, created_at",
          )
          .eq("rental_id", rentalId)
          .eq("tenant_id", tenant.id)
          .order("created_at", { ascending: false }),
        supabaseUntyped
          .from("payg_reminder_log")
          .select(
            "id, sent_at, reminder_number, accrual_id, outstanding_amount, channel, recipient, success",
          )
          .eq("rental_id", rentalId)
          .eq("tenant_id", tenant.id)
          .order("sent_at", { ascending: false }),
        supabaseUntyped
          .from("rentals")
          .select(
            "status, payg_start_ts, payg_last_reminder_sent_at, payg_paused, payg_closed_at, monthly_amount, rental_period_type, payg_reminder_interval_days, payg_auto_reminders_enabled",
          )
          .eq("id", rentalId)
          .eq("tenant_id", tenant.id)
          .maybeSingle(),
        supabaseUntyped
          .from("tenants")
          .select("payg_auto_reminders_enabled, payg_reminder_interval_days")
          .eq("id", tenant.id)
          .maybeSingle(),
      ]);

      if (accrualsRes.error) throw accrualsRes.error;
      if (paymentsRes.error) throw paymentsRes.error;
      if (remindersRes.error) throw remindersRes.error;
      if (rentalRes.error) throw rentalRes.error;
      if (tenantRes.error) throw tenantRes.error;

      const accruals = accrualsRes.data || [];
      const paymentsRaw = paymentsRes.data || [];
      const remindersRaw = remindersRes.data || [];
      const rentalRow: any = rentalRes.data || {};
      const tenantRow: any = tenantRes.data || {};

      // Walk in ascending order to compute cumulative (rolling) amount per invoice.
      // Cumulative resets immediately after an invoice status='paid'.
      const accrualById = new Map<string, any>();
      for (const a of accruals) accrualById.set(a.id, a);

      const invoices: PaygInvoiceRow[] = [];
      let running = 0;
      for (const a of accruals) {
        const dailyRate = round2(Number(a.daily_rate || 0));
        const taxAmount = round2(Number(a.tax_amount || 0));
        const serviceFeeAmount = round2(Number(a.service_fee_amount || 0));
        const dayTotal = round2(dailyRate + taxAmount + serviceFeeAmount);
        running = round2(running + dayTotal);

        let supersededBy: string | null = null;
        if (a.superseded_by_accrual_id) {
          const parent = accrualById.get(a.superseded_by_accrual_id);
          if (parent) supersededBy = invoiceRefFor(parent.accrual_day_index);
        }

        invoices.push({
          id: a.id,
          dayIndex: a.accrual_day_index,
          invoiceRef: invoiceRefFor(a.accrual_day_index),
          createdAt: a.accrual_window_start || a.created_at,
          dayTotal,
          dailyRate,
          taxAmount,
          serviceFeeAmount,
          cumulativeAmount: running,
          status: (a.invoice_status as PaygInvoiceStatus) || "open",
          paidAt: a.paid_at || null,
          settlingPaymentId: a.settling_payment_id || null,
          supersededBy,
        });

        if (a.invoice_status === "paid") {
          running = 0;
        }
      }

      const payments: PaygPaymentRow[] = paymentsRaw.map((p: any) => ({
        id: p.id,
        amount: Number(p.amount || 0),
        refundAmount: Number(p.refund_amount || 0),
        status: p.status ?? null,
        paymentDate: p.payment_date ?? null,
        createdAt: p.created_at,
      }));

      const reminders: PaygReminderRow[] = remindersRaw.map((r: any) => {
        const parent = r.accrual_id ? accrualById.get(r.accrual_id) : null;
        return {
          id: r.id,
          sentAt: r.sent_at,
          reminderNumber: r.reminder_number,
          accrualId: r.accrual_id ?? null,
          invoiceRef: parent ? invoiceRefFor(parent.accrual_day_index) : null,
          outstandingAmount: Number(r.outstanding_amount || 0),
          channel: r.channel,
          recipient: r.recipient,
          success: !!r.success,
        };
      });

      // Totals
      const collected = round2(
        payments
          .filter((p) => p.status === "Completed" || p.status === "Applied")
          .reduce((s, p) => s + p.amount, 0),
      );
      const refunded = round2(payments.reduce((s, p) => s + p.refundAmount, 0));
      const balanceDue = round2(
        invoices.filter((i) => i.status === "open").reduce((s, i) => s + i.dayTotal, 0),
      );
      const netReceived = round2(collected - refunded);

      // Prefer the last accrued daily_rate (what the cron actually billed). If the
      // rental has no accruals yet (just created, cron hasn't fired), fall back to
      // the derived rate from monthly_amount/rental_period_type — same formula as
      // the cron uses, so the displayed "Daily charge" lines up with the first
      // accrual the moment it lands.
      const dailyRate = accruals.length > 0
        ? Number(accruals[accruals.length - 1].daily_rate || 0)
        : round2(computePaygDailyRate(rentalRow?.monthly_amount, rentalRow?.rental_period_type));
      const lastUpdatedAt = accruals.length > 0
        ? accruals[accruals.length - 1].accrual_window_end || accruals[accruals.length - 1].created_at
        : null;

      const openInvoices = invoices.filter((i) => i.status === "open");
      const latestOpenInvoice = openInvoices.length > 0 ? openInvoices[openInvoices.length - 1] : null;

      // Mirror the gates in supabase/functions/send-payg-reminders so the UI explains itself.
      const autoEnabled = tenantRow?.payg_auto_reminders_enabled !== false;
      // Per-rental toggle: operators flip this off from the rental detail page
      // for trusted customers who pay reliably and don't want automated nags.
      // Mirror order matches the cron — tenant gate first, then per-rental.
      const rentalAutoEnabled = rentalRow?.payg_auto_reminders_enabled !== false;
      let blockReason: PaygReminderBlockReason = null;
      if (!autoEnabled) {
        blockReason = "tenant_disabled";
      } else if (!rentalAutoEnabled) {
        blockReason = "rental_reminders_disabled";
      } else if (rentalRow?.payg_closed_at) {
        blockReason = "rental_closed";
      } else if (rentalRow?.payg_paused) {
        blockReason = "rental_paused";
      } else if (rentalRow?.status && rentalRow.status !== "Active") {
        blockReason = "rental_inactive";
      } else if (!latestOpenInvoice) {
        blockReason = "no_open_invoice";
      }

      // Effective cadence: per-rental override → tenant default → built-in
      // fallback. Mirrors the resolution send-payg-reminders does on the cron
      // side so the "Next reminder" UI matches what the cron will actually do.
      const tenantDefaultInterval = Number(tenantRow?.payg_reminder_interval_days) > 0
        ? Number(tenantRow.payg_reminder_interval_days)
        : 4;
      const rentalOverrideInterval = Number(rentalRow?.payg_reminder_interval_days);
      const intervalDays = Number.isFinite(rentalOverrideInterval) && rentalOverrideInterval > 0
        ? rentalOverrideInterval
        : tenantDefaultInterval;
      const isCustomInterval = Number.isFinite(rentalOverrideInterval) && rentalOverrideInterval > 0;

      // Anchor matches cron logic: max(last_sent_at, payg_start_ts) + intervalDays.
      let nextReminderAt: string | null = null;
      const startTsStr: string | null = rentalRow?.payg_start_ts || null;
      const lastSentStr: string | null = rentalRow?.payg_last_reminder_sent_at || null;
      const anchorStr = lastSentStr || startTsStr;
      if (anchorStr) {
        const anchorMs = new Date(anchorStr).getTime();
        if (Number.isFinite(anchorMs)) {
          nextReminderAt = new Date(anchorMs + intervalDays * DAY_MS).toISOString();
        }
      }

      const reminderStatus: PaygReminderStatus = {
        autoEnabled,
        rentalAutoEnabled,
        nextReminderAt,
        intervalDays,
        isCustomInterval,
        blockReason,
      };

      return {
        invoices,
        payments,
        reminders,
        dailyRate,
        lastUpdatedAt,
        totals: { collected, balanceDue, refunded, netReceived },
        latestOpenInvoice,
        reminderStatus,
      };
    },
    enabled: !!rentalId && !!tenant?.id && enabled,
    // Production polling cadence. Realtime subscriptions above handle the
    // hot path (instant updates on new accrual/payment/reminder rows), so
    // this polling is just a safety-net for tabs that lose the websocket.
    // Lower numbers here were a leftover from when a test "day" was 5 min;
    // restored to sane production values to cut Supabase query load ~12x
    // without sacrificing UI freshness.
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  return { data: data || EMPTY, isLoading, error, refetch };
};
