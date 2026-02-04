import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export interface InstallmentPlan {
  id: string;
  rental_id: string;
  plan_type: string;
  status: string;
  total_installable_amount: number;
  installment_amount: number;
  number_of_installments: number;
  paid_installments: number | null;
  total_paid: number | null;
  next_due_date: string | null;
  upfront_amount: number;
  upfront_paid: boolean | null;
  stripe_payment_method_id: string | null;
  created_at: string | null;
  rentals: {
    id: string;
    rental_number: string | null;
    start_date: string;
    end_date: string;
    status: string;
    vehicles: {
      id: string;
      make: string | null;
      model: string | null;
      reg: string;
      photo_url: string | null;
    } | null;
  } | null;
  scheduled_installments: ScheduledInstallment[];
}

export interface ScheduledInstallment {
  id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  status: string;
  paid_at: string | null;
  failure_count: number | null;
  last_failure_reason: string | null;
  payment_id: string | null;
}

export interface PaymentHistoryItem {
  id: string;
  amount: number;
  payment_date: string;
  method: string;
  status: string;
  payment_type: string;
  rental_id: string | null;
  rentals: {
    rental_number: string | null;
    vehicles: {
      make: string | null;
      model: string | null;
      reg: string;
    } | null;
  } | null;
}

// Fetch all installment plans for the customer
export function useCustomerInstallmentPlans() {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-installment-plans', customerUser?.customer_id],
    queryFn: async () => {
      if (!customerUser?.customer_id) return [];

      const { data, error } = await supabase
        .from('installment_plans')
        .select(`
          id,
          rental_id,
          plan_type,
          status,
          total_installable_amount,
          installment_amount,
          number_of_installments,
          paid_installments,
          total_paid,
          next_due_date,
          upfront_amount,
          upfront_paid,
          stripe_payment_method_id,
          created_at,
          rentals!installment_plans_rental_id_fkey (
            id,
            rental_number,
            start_date,
            end_date,
            status,
            vehicles (
              id,
              make,
              model,
              reg,
              photo_url
            )
          ),
          scheduled_installments (
            id,
            installment_number,
            amount,
            due_date,
            status,
            paid_at,
            failure_count,
            last_failure_reason,
            payment_id
          )
        `)
        .eq('customer_id', customerUser.customer_id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching installment plans:', error);
        throw error;
      }

      // Sort scheduled_installments by installment_number
      const plansWithSortedInstallments = (data || []).map((plan) => ({
        ...plan,
        scheduled_installments: (plan.scheduled_installments || []).sort(
          (a: ScheduledInstallment, b: ScheduledInstallment) =>
            a.installment_number - b.installment_number
        ),
      }));

      return plansWithSortedInstallments as InstallmentPlan[];
    },
    enabled: !!customerUser?.customer_id,
  });
}

// Get active installment plans only
export function useActiveInstallmentPlans() {
  const { data: allPlans, ...rest } = useCustomerInstallmentPlans();

  const activePlans = (allPlans || []).filter(
    (plan) => plan.status === 'active' || plan.status === 'overdue'
  );

  return { data: activePlans, ...rest };
}

// Get the next upcoming payment across all plans
export function useNextInstallmentPayment() {
  const { data: plans, ...rest } = useCustomerInstallmentPlans();

  const nextPayment = (() => {
    if (!plans || plans.length === 0) return null;

    const today = new Date().toISOString().split('T')[0];
    let earliest: { plan: InstallmentPlan; installment: ScheduledInstallment } | null = null;

    for (const plan of plans) {
      if (plan.status !== 'active' && plan.status !== 'overdue') continue;

      for (const inst of plan.scheduled_installments) {
        if (inst.status === 'scheduled' || inst.status === 'failed') {
          if (!earliest || inst.due_date < earliest.installment.due_date) {
            earliest = { plan, installment: inst };
          }
        }
      }
    }

    return earliest;
  })();

  return { data: nextPayment, ...rest };
}

// Get installment stats
export function useInstallmentStats() {
  const { data: plans, ...rest } = useCustomerInstallmentPlans();

  const stats = (() => {
    if (!plans) return null;

    const activePlans = plans.filter(
      (p) => p.status === 'active' || p.status === 'overdue'
    );
    const completedPlans = plans.filter((p) => p.status === 'completed');

    const totalPaid = plans.reduce((sum, p) => sum + (p.total_paid || 0), 0);
    const totalRemaining = activePlans.reduce(
      (sum, p) => sum + (p.total_installable_amount - (p.total_paid || 0)),
      0
    );

    const today = new Date().toISOString().split('T')[0];
    const overdueInstallments = plans.flatMap((p) =>
      p.scheduled_installments.filter(
        (i) => (i.status === 'scheduled' || i.status === 'failed') && i.due_date < today
      )
    );

    const upcomingInstallments = plans.flatMap((p) =>
      p.scheduled_installments.filter(
        (i) => i.status === 'scheduled' && i.due_date >= today
      )
    );

    return {
      activePlans: activePlans.length,
      completedPlans: completedPlans.length,
      totalPaid,
      totalRemaining,
      overdueCount: overdueInstallments.length,
      upcomingCount: upcomingInstallments.length,
    };
  })();

  return { data: stats, ...rest };
}

// Get payment history for the customer
export function useCustomerPaymentHistory(limit?: number) {
  const { customerUser } = useCustomerAuthStore();

  return useQuery({
    queryKey: ['customer-payment-history', customerUser?.customer_id, limit],
    queryFn: async () => {
      if (!customerUser?.customer_id) return [];

      let query = supabase
        .from('payments')
        .select(`
          id,
          amount,
          payment_date,
          method,
          status,
          payment_type,
          rental_id,
          rentals (
            rental_number,
            vehicles (
              make,
              model,
              reg
            )
          )
        `)
        .eq('customer_id', customerUser.customer_id)
        .order('payment_date', { ascending: false });

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching payment history:', error);
        throw error;
      }

      return (data || []) as PaymentHistoryItem[];
    },
    enabled: !!customerUser?.customer_id,
  });
}

// Get installment plan for a specific rental
export function useRentalInstallmentPlan(rentalId: string | undefined) {
  const { data: plans, ...rest } = useCustomerInstallmentPlans();

  const plan = rentalId
    ? plans?.find((p) => p.rental_id === rentalId)
    : undefined;

  return { data: plan, ...rest };
}

// Helper to format card last 4 digits
export function formatCardLast4(paymentMethodId: string | null): string {
  if (!paymentMethodId) return 'No card on file';
  // Payment method IDs don't contain card info - we'd need to fetch from Stripe
  // For now, just indicate a card is saved
  return 'Card on file';
}

// Helper to get status color
export function getInstallmentStatusColor(status: string): string {
  switch (status) {
    case 'paid':
      return 'text-green-600';
    case 'scheduled':
      return 'text-blue-600';
    case 'processing':
      return 'text-yellow-600';
    case 'failed':
      return 'text-red-600';
    case 'overdue':
      return 'text-red-700';
    default:
      return 'text-gray-600';
  }
}

// Helper to get status badge variant
export function getInstallmentStatusBadge(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'paid':
      return 'default';
    case 'scheduled':
      return 'secondary';
    case 'processing':
      return 'outline';
    case 'failed':
    case 'overdue':
      return 'destructive';
    default:
      return 'secondary';
  }
}
