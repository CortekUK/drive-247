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
  checkoutUrl?: string;
  requiresCheckout?: boolean;
}

// supabase-js's invoke() throws a FunctionsHttpError on non-2xx with the generic
// message "Edge Function returned a non-2xx status code", swallowing the actual
// `{ error: "..." }` JSON body. This helper unwraps the response and surfaces
// the real message.
async function extractInvokeError(err: unknown): Promise<string> {
  const e = err as { context?: Response; message?: string };
  try {
    const body = await e?.context?.clone().json();
    if (body && typeof body === 'object') {
      if (typeof body.error === 'string') return body.error;
      if (typeof body.message === 'string') return body.message;
    }
  } catch {
    // body wasn't JSON or context unavailable — fall through
  }
  return e?.message ?? 'Unknown error';
}

// Hook to get current card on file
export function useCurrentCard() {
  const { customerUser } = useCustomerAuthStore();
  const [card, setCard] = useState<CardInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCard = async () => {
    if (!customerUser?.customer_id) return null;
    setLoading(true);

    try {
      const response = await supabase.functions.invoke('update-payment-method?action=get-card', {
        body: {
          customerId: customerUser.customer_id,
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
    mutationFn: async (params: { returnUrl: string }): Promise<SetupIntentResponse> => {
      if (!customerUser?.customer_id) {
        throw new Error('Not authenticated');
      }

      const { data, error } = await supabase.functions.invoke('update-payment-method?action=create-setup', {
        body: {
          customerId: customerUser.customer_id,
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
    mutationFn: async (params: { paymentMethodId: string }) => {
      if (!customerUser?.customer_id) {
        throw new Error('Not authenticated');
      }

      const { data, error } = await supabase.functions.invoke('update-payment-method?action=confirm', {
        body: {
          customerId: customerUser.customer_id,
          paymentMethodId: params.paymentMethodId,
        },
      });

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      toast.success('Payment method updated successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update payment method');
    },
  });
}
