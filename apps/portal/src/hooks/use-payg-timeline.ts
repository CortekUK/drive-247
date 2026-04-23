import { useQuery } from '@tanstack/react-query';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export type PaygEventKind =
  | 'accrual'
  | 'payment'
  | 'refund'
  | 'reminder'
  | 'next_accrual'
  | 'next_reminder';

export type PaygPaidStatus = 'paid' | 'partial' | 'unpaid';

export interface PaygAccrualEvent {
  kind: 'accrual';
  at: string;
  dayIndex: number;
  windowStart: string;
  windowEnd: string;
  isPartial: boolean;
  hoursCovered: number;
  charges: Array<{
    id: string;
    category: string;
    amount: number;
    remainingAmount: number;
    appliedPaymentIds: string[];
  }>;
  total: number;
  remaining: number;
  status: PaygPaidStatus;
}

export interface PaygPaymentEvent {
  kind: 'payment';
  at: string;
  paymentId: string;
  amount: number;
  remaining: number;
  method: string | null;
  status: string | null;
  appliedToDayIndices: number[];
  totalApplied: number;
}

export interface PaygRefundEvent {
  kind: 'refund';
  at: string;
  paymentId: string;
  amount: number;
  status: string | null;
  stripeRefundId: string | null;
}

export interface PaygReminderEvent {
  kind: 'reminder';
  at: string;
  reminderNumber: number;
  outstandingAmount: number;
  daysActive: number;
  daysOverdue: number;
  channel: string;
  recipient: string;
  success: boolean;
  errorMessage: string | null;
}

export interface PaygProjectionEvent {
  kind: 'next_accrual' | 'next_reminder';
  at: string;
  /** For next_reminder: the reminder cap and current count, so the UI can warn at limit. */
  meta?: {
    reminderCount?: number;
    maxReminders?: number;
    capReached?: boolean;
  };
}

export type PaygTimelineEvent =
  | PaygAccrualEvent
  | PaygPaymentEvent
  | PaygRefundEvent
  | PaygReminderEvent
  | PaygProjectionEvent;

export interface PaygTimelineData {
  events: PaygTimelineEvent[];
  /** Counts and totals derived from the events. */
  totals: {
    daysAccrued: number;
    daysPaid: number;
    daysUnpaid: number;
    daysPartial: number;
    totalCharged: number;
    totalPaid: number;
    totalRefunded: number;
    totalOutstanding: number;
    remindersSent: number;
    remindersSuccessful: number;
    maxReminders: number;
    reminderIntervalDays: number;
    graceDays: number;
  };
  next: {
    accrualAt: string | null;
    /**
     * Computed reminder time mirroring send-payg-reminders cron logic:
     *   - If no reminder has been sent yet: payg_start_ts + grace_days
     *   - Else: last_reminder_sent_at + interval_days
     *   - Null if max reached, rental closed, paused, or no outstanding balance
     */
    reminderAt: string | null;
    reminderCapReached: boolean;
    paused: boolean;
    closed: boolean;
  };
}

const EMPTY_TIMELINE: PaygTimelineData = {
  events: [],
  totals: {
    daysAccrued: 0,
    daysPaid: 0,
    daysUnpaid: 0,
    daysPartial: 0,
    totalCharged: 0,
    totalPaid: 0,
    totalRefunded: 0,
    totalOutstanding: 0,
    remindersSent: 0,
    remindersSuccessful: 0,
    maxReminders: 10,
    reminderIntervalDays: 4,
    graceDays: 2,
  },
  next: {
    accrualAt: null,
    reminderAt: null,
    reminderCapReached: false,
    paused: false,
    closed: false,
  },
};

/**
 * Fetches a chronological timeline for a PAYG rental:
 *   - Daily accruals (payg_accruals + their backing ledger Charge entries)
 *   - Customer payments (payments + payment_applications)
 *   - Refunds (payments with refund_amount > 0)
 *   - Reminders (payg_reminder_log)
 *   - Projected next accrual + next reminder (countdown anchors)
 *
 * Mirrors the cron-side reminder scheduling logic so the UI countdown matches what
 * send-payg-reminders will actually do.
 */
export const usePaygTimeline = (
  rentalId: string | undefined,
  isPayg: boolean,
  rental?: {
    payg_start_ts?: string | null;
    payg_next_accrual_at?: string | null;
    payg_last_reminder_sent_at?: string | null;
    payg_reminder_count?: number | null;
    payg_reminder_interval_days?: number | null;
    payg_paused?: boolean | null;
    payg_closed_at?: string | null;
  } | null,
) => {
  const { tenant } = useTenant();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['payg-timeline', tenant?.id, rentalId, rental?.payg_reminder_count, rental?.payg_last_reminder_sent_at, rental?.payg_next_accrual_at, rental?.payg_paused, rental?.payg_closed_at],
    queryFn: async (): Promise<PaygTimelineData> => {
      if (!rentalId || !tenant?.id) return EMPTY_TIMELINE;

      const [accrualsRes, ledgerRes, paymentsRes, appsRes, remindersRes, tenantRes] = await Promise.all([
        supabaseUntyped
          .from('payg_accruals')
          .select('id, accrual_day_index, accrual_window_start, accrual_window_end, daily_rate, tax_amount, service_fee_amount, is_partial, hours_covered, ledger_entry_ids, created_at')
          .eq('rental_id', rentalId)
          .eq('tenant_id', tenant.id)
          .order('accrual_day_index', { ascending: true }),
        supabaseUntyped
          .from('ledger_entries')
          .select('id, type, category, amount, remaining_amount, due_date, entry_date, created_at, payment_id')
          .eq('rental_id', rentalId)
          .eq('tenant_id', tenant.id)
          .order('created_at', { ascending: true }),
        supabaseUntyped
          .from('payments')
          .select('id, amount, remaining_amount, status, method, payment_date, payment_type, created_at, refund_amount, refund_status, refund_processed_at, stripe_refund_id')
          .eq('rental_id', rentalId)
          .eq('tenant_id', tenant.id)
          .order('created_at', { ascending: true }),
        supabaseUntyped
          .from('payment_applications')
          .select('payment_id, charge_entry_id, amount_applied')
          .eq('tenant_id', tenant.id),
        supabaseUntyped
          .from('payg_reminder_log')
          .select('id, sent_at, reminder_number, outstanding_amount, days_active, days_overdue, channel, recipient, success, error_message')
          .eq('rental_id', rentalId)
          .eq('tenant_id', tenant.id)
          .order('sent_at', { ascending: true }),
        supabaseUntyped
          .from('tenants')
          .select('payg_reminder_interval_days, payg_grace_period_days, payg_max_reminders')
          .eq('id', tenant.id)
          .single(),
      ]);

      if (accrualsRes.error) throw accrualsRes.error;
      if (ledgerRes.error) throw ledgerRes.error;
      if (paymentsRes.error) throw paymentsRes.error;
      if (appsRes.error) throw appsRes.error;
      if (remindersRes.error) throw remindersRes.error;

      const accruals = accrualsRes.data || [];
      const ledgerEntries = ledgerRes.data || [];
      const payments = paymentsRes.data || [];
      const apps = appsRes.data || [];
      const reminders = remindersRes.data || [];
      const tenantConfig = tenantRes.data || {};

      // Map ledger_entries by id for fast lookup; also a per-charge applied-payment-ids list.
      const ledgerById = new Map<string, any>();
      for (const le of ledgerEntries) ledgerById.set(le.id, le);

      const appliedPaymentIdsByCharge = new Map<string, string[]>();
      const appliedAmountByCharge = new Map<string, number>();
      for (const a of apps) {
        if (!a.charge_entry_id || !a.payment_id) continue;
        const arr = appliedPaymentIdsByCharge.get(a.charge_entry_id) || [];
        arr.push(a.payment_id);
        appliedPaymentIdsByCharge.set(a.charge_entry_id, arr);
        appliedAmountByCharge.set(
          a.charge_entry_id,
          (appliedAmountByCharge.get(a.charge_entry_id) || 0) + Number(a.amount_applied || 0),
        );
      }

      // For every payment, figure out which day-indices it touched (via the charges it applied to).
      // First: charge_id -> day_index, derived from payg_accruals.ledger_entry_ids.
      const chargeIdToDayIndex = new Map<string, number>();
      for (const acc of accruals) {
        for (const lid of (acc.ledger_entry_ids || []) as string[]) {
          chargeIdToDayIndex.set(lid, acc.accrual_day_index as number);
        }
      }
      const paymentDayIndices = new Map<string, Set<number>>();
      const paymentTotalApplied = new Map<string, number>();
      for (const a of apps) {
        if (!a.charge_entry_id || !a.payment_id) continue;
        const day = chargeIdToDayIndex.get(a.charge_entry_id);
        if (day != null) {
          const set = paymentDayIndices.get(a.payment_id) || new Set<number>();
          set.add(day);
          paymentDayIndices.set(a.payment_id, set);
        }
        paymentTotalApplied.set(
          a.payment_id,
          (paymentTotalApplied.get(a.payment_id) || 0) + Number(a.amount_applied || 0),
        );
      }

      // Build accrual events
      const events: PaygTimelineEvent[] = [];
      let daysPaid = 0;
      let daysUnpaid = 0;
      let daysPartial = 0;
      let totalCharged = 0;
      let totalOutstanding = 0;

      for (const acc of accruals) {
        const ledgerIds = (acc.ledger_entry_ids || []) as string[];
        const charges = ledgerIds
          .map((lid) => {
            const le = ledgerById.get(lid);
            if (!le || le.type !== 'Charge') return null;
            return {
              id: le.id,
              category: le.category as string,
              amount: Number(le.amount || 0),
              remainingAmount: Number(le.remaining_amount || 0),
              appliedPaymentIds: appliedPaymentIdsByCharge.get(le.id) || [],
            };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);

        const total = charges.reduce((s, c) => s + c.amount, 0);
        const remaining = charges.reduce((s, c) => s + c.remainingAmount, 0);
        const status: PaygPaidStatus = remaining <= 0.001
          ? 'paid'
          : remaining < total - 0.001
            ? 'partial'
            : 'unpaid';

        if (status === 'paid') daysPaid++;
        else if (status === 'partial') daysPartial++;
        else daysUnpaid++;
        totalCharged += total;
        totalOutstanding += remaining;

        events.push({
          kind: 'accrual',
          at: acc.accrual_window_start,
          dayIndex: acc.accrual_day_index,
          windowStart: acc.accrual_window_start,
          windowEnd: acc.accrual_window_end,
          isPartial: !!acc.is_partial,
          hoursCovered: Number(acc.hours_covered || 0),
          charges,
          total: Math.round(total * 100) / 100,
          remaining: Math.round(remaining * 100) / 100,
          status,
        });
      }

      // Build payment events
      let totalPaid = 0;
      let totalRefunded = 0;
      for (const p of payments) {
        const applied = paymentTotalApplied.get(p.id) || 0;
        totalPaid += Number(p.amount || 0) - Number(p.remaining_amount || 0);
        const dayIndices = Array.from(paymentDayIndices.get(p.id) || []).sort((a, b) => a - b);
        events.push({
          kind: 'payment',
          at: p.created_at || p.payment_date,
          paymentId: p.id,
          amount: Number(p.amount || 0),
          remaining: Number(p.remaining_amount || 0),
          method: p.method || null,
          status: p.status || null,
          appliedToDayIndices: dayIndices,
          totalApplied: Math.round(applied * 100) / 100,
        });

        // Refund event derived from the same row
        const refundAmount = Number(p.refund_amount || 0);
        if (refundAmount > 0 || p.refund_status === 'completed' || p.refund_status === 'processing') {
          totalRefunded += refundAmount;
          events.push({
            kind: 'refund',
            at: p.refund_processed_at || p.created_at,
            paymentId: p.id,
            amount: refundAmount,
            status: p.refund_status || null,
            stripeRefundId: p.stripe_refund_id || null,
          });
        }
      }

      // Build reminder events
      for (const r of reminders) {
        events.push({
          kind: 'reminder',
          at: r.sent_at,
          reminderNumber: r.reminder_number,
          outstandingAmount: Number(r.outstanding_amount || 0),
          daysActive: r.days_active,
          daysOverdue: r.days_overdue,
          channel: r.channel,
          recipient: r.recipient,
          success: !!r.success,
          errorMessage: r.error_message,
        });
      }

      // Compute next accrual + next reminder, mirroring the cron logic
      const intervalDays =
        rental?.payg_reminder_interval_days ??
        tenantConfig.payg_reminder_interval_days ??
        4;
      const graceDays = tenantConfig.payg_grace_period_days ?? 2;
      const maxReminders = tenantConfig.payg_max_reminders ?? 10;
      const reminderCount = rental?.payg_reminder_count ?? reminders.length;
      const paused = !!rental?.payg_paused;
      const closed = !!rental?.payg_closed_at;
      const capReached = reminderCount >= maxReminders;

      const nextAccrualAt = closed || paused ? null : (rental?.payg_next_accrual_at || null);

      let nextReminderAt: string | null = null;
      if (!closed && !paused && !capReached && totalOutstanding > 0.001) {
        if (rental?.payg_last_reminder_sent_at) {
          const last = new Date(rental.payg_last_reminder_sent_at).getTime();
          nextReminderAt = new Date(last + intervalDays * 86400000).toISOString();
        } else if (rental?.payg_start_ts) {
          const start = new Date(rental.payg_start_ts).getTime();
          nextReminderAt = new Date(start + graceDays * 86400000).toISOString();
        }
      }

      if (nextAccrualAt) events.push({ kind: 'next_accrual', at: nextAccrualAt });
      if (nextReminderAt) {
        events.push({
          kind: 'next_reminder',
          at: nextReminderAt,
          meta: { reminderCount, maxReminders, capReached: false },
        });
      } else if (capReached && totalOutstanding > 0.001) {
        // Surface the cap-reached state as a synthetic event so the UI can show it.
        events.push({
          kind: 'next_reminder',
          at: new Date().toISOString(),
          meta: { reminderCount, maxReminders, capReached: true },
        });
      }

      // Sort chronologically; projection events keep their natural future position.
      events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

      return {
        events,
        totals: {
          daysAccrued: accruals.length,
          daysPaid,
          daysUnpaid,
          daysPartial,
          totalCharged: Math.round(totalCharged * 100) / 100,
          totalPaid: Math.round(totalPaid * 100) / 100,
          totalRefunded: Math.round(totalRefunded * 100) / 100,
          totalOutstanding: Math.round(totalOutstanding * 100) / 100,
          remindersSent: reminders.length,
          remindersSuccessful: reminders.filter((r) => r.success).length,
          maxReminders,
          reminderIntervalDays: intervalDays,
          graceDays,
        },
        next: {
          accrualAt: nextAccrualAt,
          reminderAt: nextReminderAt,
          reminderCapReached: capReached,
          paused,
          closed,
        },
      };
    },
    enabled: !!rentalId && !!tenant?.id && isPayg,
    staleTime: 15_000,
  });

  return {
    timeline: data || EMPTY_TIMELINE,
    isLoading,
    error,
    refetch,
  };
};
