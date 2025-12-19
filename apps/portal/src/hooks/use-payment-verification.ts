import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { sendPaymentRejectionNotification } from '@/lib/notifications';
import { useTenant } from '@/contexts/TenantContext';

export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved';

export interface PaymentVerification {
  verification_status: VerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  is_manual_mode: boolean;
}

// Hook to get pending payments count
export const usePendingPaymentsCount = () => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['pending-payments-count', tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('verification_status', 'pending');

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { count, error } = await query;

      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
};

// Hook for payment verification actions
export const usePaymentVerificationActions = () => {
  const queryClient = useQueryClient();

  // Approve payment mutation
  const approvePayment = useMutation({
    mutationFn: async (paymentId: string) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Get app_user id
      const { data: appUser, error: appUserError } = await supabase
        .from('app_users')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (appUserError) throw appUserError;

      // Call the approve function
      const { data, error } = await supabase.rpc('approve_payment', {
        p_payment_id: paymentId,
        p_approved_by: appUser.id
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to approve payment');

      // Now apply the payment to allocate it to charges
      console.log('Applying approved payment to charges:', paymentId);
      try {
        const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', {
          body: { paymentId }
        });

        if (applyError) {
          console.error('Error applying payment:', applyError);
          // Don't throw - the payment is approved, allocation can be retried
        } else {
          console.log('Payment applied successfully:', applyResult);
        }
      } catch (applyErr) {
        console.error('Exception applying payment:', applyErr);
      }

      return data;
    },
    onSuccess: () => {
      toast({
        title: 'Payment Approved',
        description: 'The payment has been approved and allocated to charges.',
      });

      // Invalidate all related queries for immediate UI update
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['payments-list'] });
      queryClient.invalidateQueries({ queryKey: ['payments-data'] });
      queryClient.invalidateQueries({ queryKey: ['pending-payments-count'] });
      queryClient.invalidateQueries({ queryKey: ['rentals'] });
      queryClient.invalidateQueries({ queryKey: ['rental'] });
      queryClient.invalidateQueries({ queryKey: ['charges'] });
      queryClient.invalidateQueries({ queryKey: ['customer-charges'] });
      queryClient.invalidateQueries({ queryKey: ['rental-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
      queryClient.invalidateQueries({ queryKey: ['rental-payments'] });
      queryClient.invalidateQueries({ queryKey: ['rental-totals'] });
      queryClient.invalidateQueries({ queryKey: ['customer-net-position'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['payment-applications'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: `Failed to approve payment: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  // Reject payment mutation
  const rejectPayment = useMutation({
    mutationFn: async ({ paymentId, reason }: { paymentId: string; reason: string }) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Get app_user id
      const { data: appUser, error: appUserError } = await supabase
        .from('app_users')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (appUserError) throw appUserError;

      // Get payment details for notification
      const { data: payment, error: paymentError } = await supabase
        .from('payments')
        .select(`
          id,
          amount,
          customer_id,
          customers:customer_id (
            id,
            name,
            email
          ),
          vehicles:vehicle_id (
            reg
          )
        `)
        .eq('id', paymentId)
        .single();

      if (paymentError) throw paymentError;

      // Call the reject function
      const { data, error } = await supabase.rpc('reject_payment', {
        p_payment_id: paymentId,
        p_rejected_by: appUser.id,
        p_reason: reason
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to reject payment');

      // Send rejection notification to customer
      if (payment && payment.customers) {
        const customer = payment.customers as any;
        const vehicle = payment.vehicles as any;

        try {
          await sendPaymentRejectionNotification({
            paymentId: payment.id,
            customerId: customer.id,
            customerName: customer.name || 'Customer',
            customerEmail: customer.email || '',
            amount: payment.amount,
            reason: reason,
            vehicleReg: vehicle?.reg,
          });
          console.log('Payment rejection notification sent to customer');
        } catch (notificationError) {
          console.error('Error sending rejection notification:', notificationError);
        }
      }

      return data;
    },
    onSuccess: (data) => {
      const vehicleReleased = (data as any)?.vehicle_released;
      toast({
        title: 'Payment Rejected',
        description: vehicleReleased
          ? 'The payment has been rejected, rental closed, and vehicle released.'
          : 'The payment has been rejected and the rental has been closed.',
      });

      // Invalidate all related queries for immediate UI update
      const options = { refetchType: 'all' as const };
      queryClient.invalidateQueries({ queryKey: ['payments'], ...options });
      queryClient.invalidateQueries({ queryKey: ['payments-list'], ...options });
      queryClient.invalidateQueries({ queryKey: ['payments-data'], ...options });
      queryClient.invalidateQueries({ queryKey: ['pending-payments-count'], ...options });
      queryClient.invalidateQueries({ queryKey: ['rentals'], ...options });
      queryClient.invalidateQueries({ queryKey: ['rentals-list'], ...options });
      queryClient.invalidateQueries({ queryKey: ['rental'], ...options });
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'], ...options });
      queryClient.invalidateQueries({ queryKey: ['charges'], ...options });
      queryClient.invalidateQueries({ queryKey: ['customer-charges'], ...options });
      queryClient.invalidateQueries({ queryKey: ['rental-ledger'], ...options });
      queryClient.invalidateQueries({ queryKey: ['rental-charges'], ...options });
      queryClient.invalidateQueries({ queryKey: ['rental-payments'], ...options });
      queryClient.invalidateQueries({ queryKey: ['rental-totals'], ...options });
      queryClient.invalidateQueries({ queryKey: ['customer-net-position'], ...options });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'], ...options });
      queryClient.invalidateQueries({ queryKey: ['payment-applications'], ...options });
      queryClient.invalidateQueries({ queryKey: ['vehicles'], ...options });
      queryClient.invalidateQueries({ queryKey: ['vehicles-list'], ...options });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: `Failed to reject payment: ${error.message}`,
        variant: 'destructive',
      });
    },
  });

  return {
    approvePayment,
    rejectPayment,
    isLoading: approvePayment.isPending || rejectPayment.isPending,
  };
};

// Get verification status badge info
export const getVerificationStatusInfo = (status: VerificationStatus) => {
  switch (status) {
    case 'pending':
      return {
        label: 'Pending Review',
        variant: 'warning' as const,
        className: 'bg-orange-100 text-orange-800 border-orange-200',
      };
    case 'approved':
      return {
        label: 'Approved',
        variant: 'success' as const,
        className: 'bg-green-100 text-green-800 border-green-200',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        variant: 'destructive' as const,
        className: 'bg-red-100 text-red-800 border-red-200',
      };
    case 'auto_approved':
      return {
        label: 'Auto-Approved',
        variant: 'secondary' as const,
        className: 'bg-gray-100 text-gray-800 border-gray-200',
      };
    default:
      return {
        label: 'Unknown',
        variant: 'secondary' as const,
        className: 'bg-gray-100 text-gray-800 border-gray-200',
      };
  }
};
