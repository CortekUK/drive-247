import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export type PaygInvoiceStatus = "open" | "paid" | "superseded";

export interface PaygInvoiceRow {
  id: string;
  dayIndex: number;
  invoiceRef: string; // pg-001
  createdAt: string; // accrual_window_start
  dayTotal: number; // this invoice's own day charge (rental + tax + service_fee)
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
}

const EMPTY: PaygInvoiceData = {
  invoices: [],
  payments: [],
  reminders: [],
  dailyRate: 0,
  lastUpdatedAt: null,
  totals: { collected: 0, balanceDue: 0, refunded: 0, netReceived: 0 },
  latestOpenInvoice: null,
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function invoiceRefFor(dayIndex: number): string {
  return `pg-${String(dayIndex).padStart(3, "0")}`;
}

export const usePaygInvoices = (rentalId: string | undefined, enabled: boolean) => {
  const { tenant } = useTenant();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["payg-invoices", tenant?.id, rentalId],
    queryFn: async (): Promise<PaygInvoiceData> => {
      if (!rentalId || !tenant?.id) return EMPTY;

      const [accrualsRes, paymentsRes, remindersRes] = await Promise.all([
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
      ]);

      if (accrualsRes.error) throw accrualsRes.error;
      if (paymentsRes.error) throw paymentsRes.error;
      if (remindersRes.error) throw remindersRes.error;

      const accruals = accrualsRes.data || [];
      const paymentsRaw = paymentsRes.data || [];
      const remindersRaw = remindersRes.data || [];

      // Walk in ascending order to compute cumulative (rolling) amount per invoice.
      // Cumulative resets immediately after an invoice status='paid'.
      const accrualById = new Map<string, any>();
      for (const a of accruals) accrualById.set(a.id, a);

      const invoices: PaygInvoiceRow[] = [];
      let running = 0;
      for (const a of accruals) {
        const dayTotal = round2(
          Number(a.daily_rate || 0) + Number(a.tax_amount || 0) + Number(a.service_fee_amount || 0),
        );
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

      const dailyRate = accruals.length > 0 ? Number(accruals[accruals.length - 1].daily_rate || 0) : 0;
      const lastUpdatedAt = accruals.length > 0
        ? accruals[accruals.length - 1].accrual_window_end || accruals[accruals.length - 1].created_at
        : null;

      const openInvoices = invoices.filter((i) => i.status === "open");
      const latestOpenInvoice = openInvoices.length > 0 ? openInvoices[openInvoices.length - 1] : null;

      return {
        invoices,
        payments,
        reminders,
        dailyRate,
        lastUpdatedAt,
        totals: { collected, balanceDue, refunded, netReceived },
        latestOpenInvoice,
      };
    },
    enabled: !!rentalId && !!tenant?.id && enabled,
    staleTime: 15_000,
  });

  return { data: data || EMPTY, isLoading, error, refetch };
};
