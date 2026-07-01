'use client'

import { useEffect, useState, Suspense, useCallback } from "react";
import confetti from "canvas-confetti";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { CheckCircle, Download, Mail, Loader2, User, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";
import { useCustomerAuthStore } from "@/stores/customer-auth-store";
import { useBookingStore } from "@/stores/booking-store";
import { formatCurrency } from "@/lib/format-utils";
import { parseDateOnly } from "@/lib/date-utils";

const InvoicePaymentSuccess = () => {
  const { tenant } = useTenant();
  const [processing, setProcessing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isHoldFlow, setIsHoldFlow] = useState(false);

  useEffect(() => {
    confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });

    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const flowType = params.get('type');
      const sessionParam = params.get('session_id');
      const rentalIdParam = params.get('rental_id');

      // Hold-only flow: customer just authorised a deposit hold, nothing was charged.
      if (flowType === 'hold') {
        setIsHoldFlow(true);
        try {
          if (!sessionParam || !rentalIdParam) {
            throw new Error('Missing session or rental reference');
          }
          const { data, error: syncError } = await supabase.functions.invoke('sync-deposit-hold', {
            body: { sessionId: sessionParam, rentalId: rentalIdParam },
          });
          if (syncError) throw syncError;
          console.log('[HOLD-SUCCESS] Result:', data);
        } catch (err: any) {
          console.error('[HOLD-SUCCESS] Error:', err);
          setError(err.message || 'Could not record the hold');
        } finally {
          setProcessing(false);
        }
        return;
      }

      // Existing invoice-payment flow.
      await processPayment(sessionParam);
    };

    const processPayment = async (sessionParam: string | null) => {
      try {

        // If no session_id in URL, find the most recent pending payment's session
        let checkoutSessionId = sessionParam;
        if (!checkoutSessionId) {
          const { data: pendingPayment } = await supabase
            .from('payments')
            .select('stripe_checkout_session_id')
            .eq('status', 'Pending')
            .not('stripe_checkout_session_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          checkoutSessionId = pendingPayment?.stripe_checkout_session_id || null;
        }

        if (!checkoutSessionId) {
          console.log('[INVOICE-SUCCESS] No checkout session found');
          setProcessing(false);
          return;
        }

        console.log('[INVOICE-SUCCESS] Processing session:', checkoutSessionId);

        // Retry process-pending-payment with backoff. Stripe sometimes hasn't
        // propagated payment_status='paid' by the time the customer is
        // redirected to this page (race between Stripe's HTTP response to the
        // customer and Stripe's internal state). Without retry, we'd ask once,
        // hit notPaidYet, and silently leave the payment row stuck in 'Pending'
        // while showing the customer "Payment Received" — which is exactly the
        // bug Kris's customer hit on R-66a928. Now we retry until the edge
        // function confirms the allocation OR we hit a hard timeout.
        const attempts = [1500, 2500, 4000, 6000, 8000, 12000]; // ~34s total + initial 2s delay
        let lastResult: any = null;
        let lastFnError: any = null;
        let confirmed = false;

        for (let i = 0; i < attempts.length; i++) {
          const { data: result, error: fnError } = await supabase.functions.invoke('process-pending-payment', {
            body: { checkoutSessionId },
          });
          lastResult = result;
          lastFnError = fnError;

          // Allocation confirmed = payment row landed in a post-FIFO state.
          // 'Applied' = fully allocated. 'Partial' / 'Credit' also mean Stripe
          // captured the money (Credit just means there were no matching
          // outstanding charges to apply against — money is on file).
          // 'alreadyProcessed' from the early-return branch is also success.
          if (
            !fnError &&
            result?.ok &&
            (result?.alreadyProcessed === true || ['Applied', 'Partial', 'Credit', 'Completed'].includes(result?.status))
          ) {
            confirmed = true;
            console.log(`[INVOICE-SUCCESS] Confirmed on attempt ${i + 1}: status=${result.status}`);
            break;
          }

          if (i < attempts.length - 1) {
            console.log(`[INVOICE-SUCCESS] Attempt ${i + 1}: notPaidYet — retrying in ${attempts[i]}ms`);
            await new Promise(r => setTimeout(r, attempts[i]));
          }
        }

        if (lastFnError) {
          console.error('[INVOICE-SUCCESS] Error:', lastFnError);
          setError(lastFnError.message);
        } else if (!confirmed) {
          // Stripe didn't confirm within ~34s. Don't lie to the customer.
          // Their card may have been authorised; the webhook will land soon.
          console.warn('[INVOICE-SUCCESS] Could not confirm capture within retry window:', lastResult);
          setError('Your payment is still being verified by Stripe. You\'ll see it reflect on your account shortly. If you don\'t see it within a few minutes, please contact support.');
        } else {
          console.log('[INVOICE-SUCCESS] Final result:', lastResult);

          // Place Stripe deposit hold on the saved card (non-blocking).
          if (lastResult?.rentalId) {
            try {
              const { data: holdData, error: holdError } = await supabase.functions.invoke('place-deposit-hold', {
                body: { rentalId: lastResult.rentalId },
              });
              if (holdError) {
                console.warn('[INVOICE-SUCCESS] Deposit hold failed:', holdError);
              } else {
                console.log('[INVOICE-SUCCESS] Deposit hold placed:', holdData);
              }
            } catch (holdErr) {
              console.warn('[INVOICE-SUCCESS] Deposit hold error (non-blocking):', holdErr);
            }
          }
        }
      } catch (err: any) {
        console.error('[INVOICE-SUCCESS] Error:', err);
        setError(err.message);
      }
      setProcessing(false);
    };

    // Small delay to let Stripe finish processing.
    setTimeout(() => { run(); }, 2000);
  }, [tenant?.id]);

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="pt-24 pb-16 px-4">
        <div className="max-w-lg mx-auto text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
            {processing ? (
              <Loader2 className="w-8 h-8 text-green-600 dark:text-green-400 animate-spin" />
            ) : (
              <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
            )}
          </div>
          <h1 className="text-3xl font-bold">
            {processing
              ? (isHoldFlow ? 'Authorising Card...' : 'Processing Payment...')
              : (isHoldFlow ? 'Hold Placed' : 'Payment Received')}
          </h1>
          <p className="text-muted-foreground text-lg">
            {processing
              ? (isHoldFlow
                  ? 'Authorising a temporary hold on your card — no money is being charged.'
                  : 'Please wait while we confirm your payment.')
              : (isHoldFlow
                  ? 'Your card was authorised successfully. The hold will be released when your rental ends.'
                  : 'Thank you! Your payment has been processed successfully.')}
          </p>
          {!processing && (
            <>
              <p className="text-sm text-muted-foreground">You can close this page now.</p>
              <Link href="/">
                <Button variant="outline" className="mt-4">
                  <Home className="w-4 h-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
};

const BookingSuccessContent = () => {
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { customerUser } = useCustomerAuthStore();
  const { clearBooking } = useBookingStore();
  const [bookingDetails, setBookingDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const sessionId = searchParams?.get("session_id");
  const rentalId = searchParams?.get("rental_id");
  const isInstallment = searchParams?.get("installment") === "true";
  const isInvoicePayment = searchParams?.get("type") === "invoice" || searchParams?.get("type") === "hold";
  const isAuthenticated = !!customerUser;

  // Clear persisted booking form data on successful booking
  useEffect(() => {
    clearBooking();
    // Also clear booking-local localStorage keys
    localStorage.removeItem('booking_isGigDriver');
    localStorage.removeItem('booking_hasInsurance');
    localStorage.removeItem('booking_uploadedDocumentId');
  }, []);

  useEffect(() => {
    const updateRentalStatus = async () => {
      if (!sessionId) {
        setLoading(false);
        return;
      }

      try {
        // If we have a rentalId from URL params (portal integration)
        if (rentalId) {
          // Step 1: Update rental payment_status to fulfilled (payment complete)
          // Note: status stays "Pending" until admin approves (approval_status + payment_status)
          let rentalUpdateQuery = supabase
            .from("rentals")
            .update({
              payment_status: "fulfilled",
              updated_at: new Date().toISOString()
            })
            .eq("id", rentalId);

          if (tenant?.id) {
            rentalUpdateQuery = rentalUpdateQuery.eq("tenant_id", tenant.id);
          }

          const { error: rentalUpdateError } = await rentalUpdateQuery;

          if (rentalUpdateError) {
            console.error("Failed to update rental status:", rentalUpdateError);

            // Provide specific error messages based on error type
            let errorMessage = "Failed to confirm rental. Please contact support.";

            if (rentalUpdateError.code === 'PGRST116') {
              errorMessage = "Rental not found. Please contact support with your payment confirmation.";
            } else if (rentalUpdateError.message?.includes('permission')) {
              errorMessage = "Access denied. Please contact support to complete your rental confirmation.";
            } else if (rentalUpdateError.message?.includes('network') || rentalUpdateError.message?.includes('timeout')) {
              errorMessage = "Network error. Your payment was successful, but confirmation failed. Please refresh the page or contact support.";
            }

            toast.error(errorMessage, { duration: 8000 });
          }

          // Step 1.5: Sync payment with Stripe payment_intent_id
          // The payment record is created by create-checkout-session, we just need to sync the payment_intent_id
          const pendingPaymentDetailsStr = localStorage.getItem('pendingPaymentDetails');

          if (pendingPaymentDetailsStr && sessionId) {
            try {
              const paymentDetails = JSON.parse(pendingPaymentDetailsStr);
              console.log('💳 Syncing payment with Stripe payment_intent_id...');

              // Verify this payment is for the correct rental
              if (paymentDetails.rental_id === rentalId) {
                // First, check if payment already exists (created by create-checkout-session)
                const { data: existingPayment } = await supabase
                  .from("payments")
                  .select("id, stripe_checkout_session_id, stripe_payment_intent_id")
                  .eq("rental_id", rentalId)
                  .not("stripe_checkout_session_id", "is", null)
                  .single();

                let paymentRecord = existingPayment;

                // If no payment exists yet (edge case), create one
                if (!existingPayment) {
                  console.log('⚠️ No existing payment found, creating one...');
                  const today = new Date().toISOString().split('T')[0];

                  const { data: newPayment, error: createError } = await supabase
                    .from("payments")
                    .insert({
                      amount: paymentDetails.amount,
                      customer_id: paymentDetails.customer_id,
                      rental_id: paymentDetails.rental_id,
                      vehicle_id: paymentDetails.vehicle_id,
                      payment_date: today,
                      payment_type: "Payment",
                      method: "Card",
                      status: "Applied",
                      is_early: false,
                      remaining_amount: paymentDetails.amount,
                      apply_from_date: paymentDetails.apply_from_date || today,
                      tenant_id: tenant?.id || paymentDetails.tenant_id,
                      verification_status: "auto_approved",
                      capture_status: "captured",
                      booking_source: "website",
                      stripe_checkout_session_id: sessionId,
                    })
                    .select()
                    .single();

                  if (createError) {
                    console.error("❌ Failed to create payment record:", createError);
                  } else {
                    paymentRecord = newPayment;
                  }
                }

                // Sync payment_intent_id from Stripe if not already set
                if (paymentRecord && !paymentRecord.stripe_payment_intent_id) {
                  console.log('🔄 Syncing payment_intent_id from Stripe...');
                  try {
                    // Get tenant info for Stripe Connect
                    const { data: rentalData } = await supabase
                      .from("rentals")
                      .select("tenant_id")
                      .eq("id", rentalId)
                      .single();

                    // Pass tenantId - the edge function will derive the correct Stripe Connect account
                    const syncBody = {
                      paymentId: paymentRecord.id,
                      checkoutSessionId: paymentRecord.stripe_checkout_session_id || sessionId,
                      tenantId: rentalData?.tenant_id || tenant?.id,
                    };

                    const { data: syncResult, error: syncError } = await supabase.functions.invoke('sync-payment-intent', {
                      body: syncBody
                    });

                    if (syncError) {
                      console.error("❌ Failed to sync payment_intent_id:", syncError);
                    } else {
                      console.log('✅ Payment synced with Stripe:', syncResult);
                      paymentRecord = { ...paymentRecord, stripe_payment_intent_id: syncResult.payment_intent_id };
                    }
                  } catch (syncErr) {
                    console.error("❌ Error syncing payment_intent_id:", syncErr);
                  }
                }

                const paymentError = null; // For compatibility with existing code below

                if (paymentError) {
                  console.error("❌ Failed to create payment record:", paymentError);
                  toast.error("Payment recorded by Stripe but failed to save locally. Please contact support.");
                } else {
                  console.log('✅ Payment record created successfully:', paymentRecord.id);

                  // Apply the payment to charges using edge function
                  try {
                    console.log('🔄 Applying payment to charges...');
                    const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', {
                      body: { paymentId: paymentRecord.id }
                    });

                    if (applyError) {
                      console.error("❌ Failed to apply payment:", applyError);
                    } else {
                      console.log('✅ Payment applied successfully:', applyResult);
                    }
                  } catch (applyErr) {
                    console.error("❌ Error applying payment:", applyErr);
                  }

                  // Place Stripe deposit hold on the saved card (non-blocking — if it
                  // fails, the rental still completes and admin can retry manually).
                  try {
                    console.log('🔒 Placing deposit hold...');
                    const { data: holdData, error: holdError } = await supabase.functions.invoke('place-deposit-hold', {
                      body: { rentalId },
                    });
                    if (holdError) {
                      console.warn('⚠️ Deposit hold failed:', holdError);
                    } else {
                      console.log('✅ Deposit hold placed:', holdData);
                    }
                  } catch (holdErr) {
                    console.warn('⚠️ Deposit hold error (non-blocking):', holdErr);
                  }

                  // Send booking notification emails and create in-app notifications
                  try {
                    // Fetch rental details for notification
                    const { data: rentalForNotify } = await supabase
                      .from("rentals")
                      .select(`
                        id,
                        start_date,
                        end_date,
                        monthly_amount,
                        tenant_id,
                        customer:customers(id, name, email, phone),
                        vehicle:vehicles(id, make, model, reg)
                      `)
                      .eq("id", rentalId)
                      .single();

                    if (rentalForNotify && rentalForNotify.customer && rentalForNotify.vehicle) {
                      const vehicleName = rentalForNotify.vehicle.make && rentalForNotify.vehicle.model
                        ? `${rentalForNotify.vehicle.make} ${rentalForNotify.vehicle.model}`
                        : rentalForNotify.vehicle.reg;

                      console.log('📧 Sending booking notification...');
                      const { data: notifyResult, error: notifyError } = await supabase.functions.invoke('notify-booking-pending', {
                        body: {
                          paymentId: paymentRecord.id,
                          rentalId: rentalId,
                          tenantId: rentalForNotify.tenant_id,
                          customerId: rentalForNotify.customer.id,
                          customerName: rentalForNotify.customer.name,
                          customerEmail: rentalForNotify.customer.email,
                          customerPhone: rentalForNotify.customer.phone,
                          vehicleName: vehicleName,
                          vehicleMake: rentalForNotify.vehicle.make,
                          vehicleModel: rentalForNotify.vehicle.model,
                          vehicleReg: rentalForNotify.vehicle.reg,
                          pickupDate: parseDateOnly(rentalForNotify.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                          returnDate: parseDateOnly(rentalForNotify.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                          amount: rentalForNotify.monthly_amount || paymentDetails.amount,
                          bookingRef: rentalId.substring(0, 8).toUpperCase(),
                        }
                      });

                      if (notifyError) {
                        console.error("❌ Failed to send booking notification:", notifyError);
                      } else {
                        console.log('✅ Booking notification sent:', notifyResult);
                      }
                    }
                  } catch (notifyErr) {
                    console.error("❌ Error sending booking notification:", notifyErr);
                  }
                }

                // Clear localStorage after processing
                localStorage.removeItem('pendingPaymentDetails');
              } else {
                console.warn('⚠️ Payment details rental_id mismatch');
              }
            } catch (parseError) {
              console.error("Error parsing payment details:", parseError);
            }
          }

          // Step 2.5: Activate installment plan if this is an installment checkout
          if (isInstallment) {
            try {
              console.log('📋 Activating installment plan for rental:', rentalId);
              const { data: activateResult, error: activateError } = await supabase.functions.invoke('activate-installment-plan', {
                body: {
                  rentalId,
                  checkoutSessionId: sessionId,
                }
              });

              if (activateError) {
                console.error('❌ Failed to activate installment plan:', activateError);
              } else if (activateResult?.already_active) {
                console.log('✅ Installment plan already active:', activateResult.plan_id);
              } else {
                console.log('✅ Installment plan activated:', activateResult);
              }
            } catch (activateErr) {
              console.error('❌ Error activating installment plan:', activateErr);
            }
          }

          // Step 3: Confirm Bonzah insurance if applicable
          try {
            const { data: rentalForBonzah } = await supabase
              .from("rentals")
              .select("bonzah_policy_id")
              .eq("id", rentalId)
              .single();

            if (rentalForBonzah?.bonzah_policy_id) {
              console.log('🛡️ Confirming Bonzah insurance policy...');
              const { data: bonzahResult, error: bonzahError } = await supabase.functions.invoke('bonzah-confirm-payment', {
                body: {
                  policy_record_id: rentalForBonzah.bonzah_policy_id,
                  stripe_payment_intent_id: `booking-auto-${rentalId}`,
                },
              });

              if (bonzahError) {
                console.error('❌ Failed to confirm Bonzah insurance:', bonzahError);
              } else if (bonzahResult?.already_processed) {
                console.log('✅ Bonzah insurance already confirmed:', bonzahResult.policy_no);
              } else {
                console.log('✅ Bonzah insurance confirmed:', bonzahResult);
              }
            }
          } catch (bonzahErr) {
            console.error('❌ Error confirming Bonzah insurance:', bonzahErr);
          }

          // Step 4: Fetch rental details with customer and vehicle info
          const { data: rental, error: fetchError } = await supabase
            .from("rentals")
            .select(`
              *,
              customer:customers(*),
              vehicle:vehicles(*)
            `)
            .eq("id", rentalId)
            .single();

          if (fetchError) {
            console.error("Failed to fetch rental details:", fetchError);

            // Provide specific error messages
            let errorMessage = "Unable to load rental details.";

            if (fetchError.code === 'PGRST116') {
              errorMessage = "Rental details not found. Your payment was successful. Please contact support.";
            } else if (fetchError.message?.includes('permission')) {
              errorMessage = "Access error loading rental details. Please contact support.";
            }

            toast.error(errorMessage, {
              duration: 8000,
              description: "Your payment was processed successfully. We'll send confirmation details to your email."
            });
          } else if (rental) {
            // Format rental details for display
            const vehicleName = rental.vehicle.make && rental.vehicle.model
              ? `${rental.vehicle.make} ${rental.vehicle.model}`
              : rental.vehicle.reg;

            setBookingDetails({
              rental_id: rental.id,
              booking_ref: rental.id.substring(0, 8).toUpperCase(),
              customer_name: rental.customer.name,
              customer_email: rental.customer.email,
              vehicle_name: vehicleName,
              vehicle_reg: rental.vehicle.reg,
              pickup_date: format(parseDateOnly(rental.start_date), "MMM dd, yyyy"),
              return_date: format(parseDateOnly(rental.end_date), "MMM dd, yyyy"),
              rental_period_type: rental.rental_period_type,
              monthly_amount: rental.monthly_amount,
              status: rental.status,
            });

            // TODO: Send confirmation email if needed
            // await supabase.functions.invoke('send-rental-confirmation-email', {
            //   body: { rentalId: rental.id }
            // });
          }
        } else {
          // Fallback: Try to get from localStorage (legacy bookings)
          const bookingData = localStorage.getItem('pending_booking');
          if (bookingData) {
            const booking = JSON.parse(bookingData);
            setBookingDetails(booking);
            localStorage.removeItem('pending_booking');
          }
        }
      } catch (error) {
        console.error('Error processing booking confirmation:', error);

        // Provide specific error messages based on error type
        let errorMessage = "An error occurred while processing your confirmation.";

        if (error instanceof TypeError && error.message?.includes('fetch')) {
          errorMessage = "Network connection error. Please check your internet connection and refresh the page.";
        } else if (error.message?.includes('JSON')) {
          errorMessage = "Data processing error. Please refresh the page or contact support.";
        } else if (error.message?.includes('session_id')) {
          errorMessage = "Invalid payment session. If your payment was processed, please contact support with your payment confirmation.";
        }

        toast.error(errorMessage, {
          duration: 10000,
          description: "If your payment was successful, your rental will be confirmed. Please contact support if you need assistance."
        });
      } finally {
        setLoading(false);
      }
    };

    updateRentalStatus();
  }, [sessionId, rentalId]);

  // Fire confetti when booking details have loaded
  const fireConfetti = useCallback(() => {
    const duration = 2000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.6 },
        colors: ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#3b82f6'],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.6 },
        colors: ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#3b82f6'],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  }, []);

  useEffect(() => {
    if (!loading && bookingDetails) {
      // Small delay so the UI renders first
      const timer = setTimeout(fireConfetti, 300);
      return () => clearTimeout(timer);
    }
  }, [loading, bookingDetails, fireConfetti]);

  if (isInvoicePayment) {
    return <InvoicePaymentSuccess />;
  }

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center py-16">
        <div className="container mx-auto px-6 max-w-2xl">
          <div className="bg-card rounded-2xl shadow-metal border border-accent/20 p-8 md:p-12">
            {loading ? (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 text-accent mx-auto mb-4 animate-spin" />
                <p className="text-muted-foreground">Processing your booking confirmation...</p>
              </div>
            ) : (
              <>
                <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-12 h-12 text-green-500" />
                </div>

                <h1 className="text-3xl md:text-4xl font-display font-bold text-gradient-metal mb-2 text-center">
                  Rental Confirmed
                </h1>

                {bookingDetails?.booking_ref && (
                  <p className="text-lg text-center mb-6">
                    Reference: <span className="font-semibold text-accent">{bookingDetails.booking_ref}</span>
                  </p>
                )}

                <p className="text-lg text-muted-foreground mb-8 text-center">
                  Thank you for your rental. Your payment has been processed successfully.
                </p>

                {/* Rental Summary */}
                {bookingDetails && (
                  <div className="bg-accent/5 border border-accent/20 rounded-lg p-6 mb-8 text-left space-y-4">
                    <h2 className="text-xl font-semibold mb-4">Rental Summary</h2>

                    <div className="grid gap-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Vehicle:</span>
                        <span className="font-medium">{bookingDetails.vehicle_name}</span>
                      </div>
                      {bookingDetails.vehicle_reg && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Registration:</span>
                          <span className="font-medium">{bookingDetails.vehicle_reg}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Start Date:</span>
                        <span className="font-medium">{bookingDetails.pickup_date || bookingDetails.pickup_date}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">End Date:</span>
                        <span className="font-medium">{bookingDetails.return_date}</span>
                      </div>
                      {bookingDetails.rental_period_type && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Period Type:</span>
                          <span className="font-medium">{bookingDetails.rental_period_type}</span>
                        </div>
                      )}
                      {bookingDetails.monthly_amount && (
                        <div className="flex justify-between pt-3 border-t border-accent/20">
                          <span className="text-muted-foreground font-medium">Rental Amount:</span>
                          <span className="font-bold text-accent text-lg">{formatCurrency(bookingDetails.monthly_amount, tenant?.currency_code || 'USD')}</span>
                        </div>
                      )}
                      {bookingDetails.total && (
                        <div className="flex justify-between pt-3 border-t border-accent/20">
                          <span className="text-muted-foreground font-medium">Amount Paid:</span>
                          <span className="font-bold text-accent text-lg">{formatCurrency(bookingDetails.total, tenant?.currency_code || 'USD')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  {isAuthenticated ? (
                    <>
                      <Link href="/portal/bookings">
                        <Button className="gradient-accent hover-lift w-full sm:w-auto">
                          <User className="w-4 h-4 mr-2" />
                          Go to My Portal
                        </Button>
                      </Link>
                      <Link href="/">
                        <Button variant="outline" className="w-full sm:w-auto">
                          <Home className="w-4 h-4 mr-2" />
                          Return to Home
                        </Button>
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link href="/">
                        <Button className="gradient-accent hover-lift w-full sm:w-auto">
                          <Home className="w-4 h-4 mr-2" />
                          Return to Home
                        </Button>
                      </Link>
                      <Link href="/contact">
                        <Button variant="outline" className="w-full sm:w-auto">
                          Contact Support
                        </Button>
                      </Link>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};
const BookingSuccess = () => {
  return (
    <Suspense fallback={
      <>
        <Navigation />
        <main className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-12 h-12 text-accent animate-spin" />
        </main>
        <Footer />
      </>
    }>
      <BookingSuccessContent />
    </Suspense>
  );
};

export default BookingSuccess;
