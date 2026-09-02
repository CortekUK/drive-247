'use client';

import { useState, useEffect } from 'react';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { stripePromise } from '@/config/stripe';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CreditCard, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useCreateSetupIntent, useConfirmPaymentMethod } from '@/hooks/use-payment-actions';
import { cn } from '@/lib/utils';

interface UpdatePaymentMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installmentPlanId?: string;
  onSuccess?: () => void;
}

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: '16px',
      color: '#424770',
      '::placeholder': {
        color: '#aab7c4',
      },
      fontFamily: 'system-ui, -apple-system, sans-serif',
    },
    invalid: {
      color: '#9e2146',
    },
  },
  hidePostalCode: false,
};

function CardForm({
  clientSecret,
  installmentPlanId,
  onSuccess,
  onCancel,
}: {
  clientSecret: string;
  installmentPlanId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const confirmPaymentMethod = useConfirmPaymentMethod();

  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      setError('Payment system not ready. Please try again.');
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setError('Card element not found.');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Confirm the SetupIntent with the card details
      const { setupIntent, error: stripeError } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: {
          card: cardElement,
        },
      });

      if (stripeError) {
        throw new Error(stripeError.message || 'Failed to save card');
      }

      if (!setupIntent || setupIntent.status !== 'succeeded') {
        throw new Error('Card setup did not complete');
      }

      // Confirm with our backend to update the installment plan
      if (setupIntent.payment_method) {
        await confirmPaymentMethod.mutateAsync({
          paymentMethodId: setupIntent.payment_method as string,
          installmentPlanId,
        });
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to update payment method');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="p-4 border rounded-lg bg-muted/30">
        <CardElement
          options={CARD_ELEMENT_OPTIONS}
          onChange={(e) => {
            setCardComplete(e.complete);
            if (e.error) {
              setError(e.error.message);
            } else {
              setError(null);
            }
          }}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={processing}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!stripe || !cardComplete || processing}
          className="flex-1"
        >
          {processing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <CreditCard className="h-4 w-4 mr-2" />
              Save Card
            </>
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Your card details are securely processed by Stripe.
      </p>
    </form>
  );
}

export function UpdatePaymentMethodDialog({
  open,
  onOpenChange,
  installmentPlanId,
  onSuccess,
}: UpdatePaymentMethodDialogProps) {
  const createSetupIntent = useCreateSetupIntent();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setClientSecret(null);
      setSuccess(false);
    }
  }, [open]);

  // Create SetupIntent when dialog opens
  useEffect(() => {
    if (open && !clientSecret && !createSetupIntent.isPending) {
      createSetupIntent.mutate(
        {
          installmentPlanId,
          returnUrl: window.location.href,
        },
        {
          onSuccess: (data) => {
            setClientSecret(data.clientSecret);
          },
        }
      );
    }
  }, [open, clientSecret, installmentPlanId]);

  const handleSuccess = () => {
    setSuccess(true);
    setTimeout(() => {
      onOpenChange(false);
      onSuccess?.();
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Update Payment Method
          </DialogTitle>
          <DialogDescription>
            Enter your new card details below. This card will be used for future installment payments.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <p className="font-semibold text-lg">Card Updated Successfully</p>
            <p className="text-muted-foreground">Your new card has been saved.</p>
          </div>
        ) : createSetupIntent.isPending || !clientSecret ? (
          <div className="py-8 flex flex-col items-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Preparing secure form...</p>
          </div>
        ) : createSetupIntent.isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {createSetupIntent.error?.message || 'Failed to initialize. Please try again.'}
            </AlertDescription>
          </Alert>
        ) : (
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <CardForm
              clientSecret={clientSecret}
              installmentPlanId={installmentPlanId}
              onSuccess={handleSuccess}
              onCancel={() => onOpenChange(false)}
            />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}
