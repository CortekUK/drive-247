import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export interface ScheduledInstallment {
  id: string;
  installment_plan_id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  status: 'scheduled' | 'processing' | 'paid' | 'failed' | 'overdue' | 'cancelled';
  stripe_payment_intent_id: string | null;
  payment_id: string | null;
  failure_count: number;
  last_failure_reason: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface InstallmentPlan {
  id: string;
  rental_id: string;
  tenant_id: string;
  customer_id: string;
  plan_type: 'full' | 'weekly' | 'monthly';
  total_installable_amount: number;
  number_of_installments: number;
  installment_amount: number;
  upfront_amount: number;
  upfront_paid: boolean;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  status: 'pending' | 'active' | 'completed' | 'cancelled' | 'overdue';
  paid_installments: number;
  total_paid: number;
  next_due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstallmentPlanWithSchedule extends InstallmentPlan {
  scheduled_installments: ScheduledInstallment[];
}

/**
 * Hook to fetch and manage installment plans for a rental
 */
export const useInstallmentPlan = (rentalId: string | null) => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // Fetch installment plan and scheduled installments
  const {
    data: plan,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['installment-plan', rentalId, tenant?.id],
    queryFn: async (): Promise<InstallmentPlanWithSchedule | null> => {
      if (!rentalId || !tenant?.id) return null;

      // Fetch installment plan
      const { data: planData, error: planError } = await supabase
        .from('installment_plans')
        .select('*')
        .eq('rental_id', rentalId)
        .eq('tenant_id', tenant.id)
        .single();

      if (planError) {
        if (planError.code === 'PGRST116') {
          // No plan found - not an error
          return null;
        }
        throw planError;
      }

      if (!planData) return null;

      // Fetch scheduled installments
      const { data: installments, error: installmentsError } = await supabase
        .from('scheduled_installments')
        .select('*')
        .eq('installment_plan_id', planData.id)
        .order('installment_number', { ascending: true });

      if (installmentsError) {
        console.error('Error fetching scheduled installments:', installmentsError);
      }

      return {
        ...planData,
        scheduled_installments: installments || [],
      } as InstallmentPlanWithSchedule;
    },
    enabled: !!rentalId && !!tenant?.id,
    staleTime: 30 * 1000,
  });

  // Retry a failed installment payment
  const retryPaymentMutation = useMutation({
    mutationFn: async (installmentId: string) => {
      if (!tenant?.id) throw new Error('No tenant ID');

      // Reset the installment status to scheduled so it gets picked up by the processor
      const { error } = await supabase
        .from('scheduled_installments')
        .update({
          status: 'scheduled',
          last_failure_reason: null,
        })
        .eq('id', installmentId)
        .eq('tenant_id', tenant.id);

      if (error) throw error;

      // Optionally trigger the payment processor immediately
      // This could be a separate edge function call if you want immediate retry

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installment-plan', rentalId] });
      toast({
        title: 'Retry Scheduled',
        description: 'The payment will be retried in the next processing cycle.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Retry Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Cancel installment plan
  const cancelPlanMutation = useMutation({
    mutationFn: async (reason: string = 'Cancelled by admin') => {
      if (!plan?.id || !tenant?.id) throw new Error('No plan ID');

      const { error } = await supabase.rpc('cancel_installment_plan', {
        p_plan_id: plan.id,
        p_reason: reason,
      });

      if (error) throw error;

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installment-plan', rentalId] });
      queryClient.invalidateQueries({ queryKey: ['rental', rentalId] });
      toast({
        title: 'Plan Cancelled',
        description: 'The installment plan has been cancelled.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Cancellation Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mark installment as manually paid (cash payment)
  const markPaidMutation = useMutation({
    mutationFn: async ({
      installmentId,
      paymentId,
    }: {
      installmentId: string;
      paymentId?: string;
    }) => {
      if (!tenant?.id) throw new Error('No tenant ID');

      const { error } = await supabase.rpc('mark_installment_paid', {
        p_installment_id: installmentId,
        p_payment_id: paymentId || null,
      });

      if (error) throw error;

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installment-plan', rentalId] });
      toast({
        title: 'Installment Marked Paid',
        description: 'The installment has been marked as paid.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Update Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    plan,
    isLoading,
    error,
    refetch,
    retryPayment: retryPaymentMutation.mutateAsync,
    isRetrying: retryPaymentMutation.isPending,
    cancelPlan: cancelPlanMutation.mutateAsync,
    isCancelling: cancelPlanMutation.isPending,
    markPaid: markPaidMutation.mutateAsync,
    isMarkingPaid: markPaidMutation.isPending,
    hasInstallmentPlan: !!plan,
  };
};
