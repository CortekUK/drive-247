import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { toast } from 'sonner';

interface CardInfo {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

interface SetupIntentResponse {
  clientSecret: string;
  setupIntentId: string;
  stripeCustomerId: string;
}

interface PaymentResult {
  success: boolean;
  paymentIntentId?: string;
  paymentId?: string;
  amount?: number;
  message?: string;
  error?: string;
}

// Hook to get current card on file
export function useCurrentCard(installmentPlanId?: string) {
  const { customerUser } = useCustomerAuthStore();
  const [card, setCard] = useState<CardInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCard = async () => {
    if (!customerUser?.customer_id) return null;
    setLoading(true);

    try {
      const params = new URLSearchParams({
        action: 'get-card',
        customerId: customerUser.customer_id,
      });
      if (installmentPlanId) {
        params.set('installmentPlanId', installmentPlanId);
      }

      const { data, error } = await supabase.functions.invoke('update-payment-method', {
        method: 'GET',
        body: null,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Note: Supabase functions don't support GET with query params well
      // We'll use POST with action in body instead
      const response = await supabase.functions.invoke('update-payment-method?action=get-card', {
        body: {
          customerId: customerUser.customer_id,
          installmentPlanId,
        },
      });

      if (response.error) throw new Error(response.error.message);
      setCard(response.data?.card || null);
      return response.data?.card || null;
    } catch (err) {
      console.error('Error fetching card:', err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { card, loading, fetchCard, setCard };
}

// Hook to create SetupIntent for updating payment method
export function useCreateSetupIntent() {
  const { customerUser } = useCustomerAuthStore();

  return useMutation({
    mutationFn: async (params: { installmentPlanId?: string; returnUrl: string }): Promise<SetupIntentResponse> => {
      if (!customerUser?.customer_id) {
        throw new Error('Not authenticated');
      }

      const { data, error } = await supabase.functions.invoke('update-payment-method?action=create-setup', {
        body: {
          customerId: customerUser.customer_id,
          installmentPlanId: params.installmentPlanId,
          returnUrl: params.returnUrl,
        },
      });

      if (error) throw new Error(error.message);
      if (!data?.clientSecret) throw new Error('Failed to create setup intent');

      return data as SetupIntentResponse;
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to initialize payment method update');
    },
  });
}

// Hook to confirm payment method update
export function useConfirmPaymentMethod() {
  const { customerUser } = useCustomerAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { paymentMethodId: string; installmentPlanId?: string }) => {
      if (!customerUser?.customer_id) {
        throw new Error('Not authenticated');
      }

      const { data, error } = await supabase.functions.invoke('update-payment-method?action=confirm', {
        body: {
          customerId: customerUser.customer_id,
          paymentMethodId: params.paymentMethodId,
          installmentPlanId: params.installmentPlanId,
        },
      });

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-installment-plans'] });
      toast.success('Payment method updated successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update payment method');
    },
  });
}

// Hook to pay a single installment early
export function usePayInstallmentEarly() {
  const { customerUser } = useCustomerAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (installmentId: string): Promise<PaymentResult> => {
      if (!customerUser?.customer_id) {
        throw new Error('Not authenticated');
      }

      const { data, error } = await supabase.functions.invoke('pay-installment-early?action=pay-single', {
        body: {
          customerId: customerUser.customer_id,
          installmentId,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      return data as PaymentResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customer-installment-plans'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payment-history'] });
      queryClient.invalidateQueries({ queryKey: ['customer-rentals'] });
      toast.success(data.message || 'Payment successful');
    },
    onError: (error) => {
      toast.error(error.message || 'Payment failed');
    },
  });
}

// Hook to pay all remaining installments
export function usePayRemainingInstallments() {
  const { customerUser } = useCustomerAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (installmentPlanId: string): Promise<PaymentResult> => {
      if (!customerUser?.customer_id) {
        throw new Error('Not authenticated');
      }

      const { data, error } = await supabase.functions.invoke('pay-installment-early?action=pay-remaining', {
        body: {
          customerId: customerUser.customer_id,
          installmentPlanId,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      return data as PaymentResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customer-installment-plans'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payment-history'] });
      queryClient.invalidateQueries({ queryKey: ['customer-rentals'] });
      toast.success(data.message || 'All remaining installments paid');
    },
    onError: (error) => {
      toast.error(error.message || 'Payment failed');
    },
  });
}

// Hook to retry a failed payment
export function useRetryPayment() {
  const { customerUser } = useCustomerAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (installmentId: string): Promise<PaymentResult> => {
      if (!customerUser?.customer_id) {
        throw new Error('Not authenticated');
      }

      // Retry is the same as pay early - just charge the installment
      const { data, error } = await supabase.functions.invoke('pay-installment-early?action=pay-single', {
        body: {
          customerId: customerUser.customer_id,
          installmentId,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      return data as PaymentResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customer-installment-plans'] });
      queryClient.invalidateQueries({ queryKey: ['customer-payment-history'] });
      queryClient.invalidateQueries({ queryKey: ['customer-rentals'] });
      toast.success('Payment retry successful');
    },
    onError: (error) => {
      toast.error(error.message || 'Payment retry failed. Please update your card.');
    },
  });
}
