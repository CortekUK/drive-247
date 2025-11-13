import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ChevronLeft, CreditCard, Shield, Calendar, MapPin, Clock, Car, User, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { InvoiceDialog } from "@/components/InvoiceDialog";
import { createInvoice, Invoice } from "@/lib/invoiceUtils";

interface BookingCheckoutStepProps {
  formData: any;
  selectedVehicle: any;
  extras: any[];
  rentalDuration: {
    days: number;
    formatted: string;
  };
  vehicleTotal: number;
  onBack: () => void;
}

export default function BookingCheckoutStep({
  formData,
  selectedVehicle,
  extras,
  rentalDuration,
  vehicleTotal,
  onBack
}: BookingCheckoutStepProps) {
  const navigate = useNavigate();
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Dialog states
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [generatedInvoice, setGeneratedInvoice] = useState<any>(null);
  const [createdRentalData, setCreatedRentalData] = useState<any>(null);
  const [sendingDocuSign, setSendingDocuSign] = useState(false);

  // Calculate rental period type based on duration
  const calculateRentalPeriodType = (): "Daily" | "Weekly" | "Monthly" => {
    const days = rentalDuration.days;
    if (days >= 30) return "Monthly";
    if (days >= 7) return "Weekly";
    return "Daily";
  };

  // Calculate monthly amount based on period type and vehicle pricing
  const calculateMonthlyAmount = (): number => {
    const periodType = calculateRentalPeriodType();
    const days = rentalDuration.days;

    if (periodType === "Monthly") {
      // Use monthly rate if available, otherwise calculate from daily
      return selectedVehicle.monthly_rent || (selectedVehicle.daily_rent || 50) * 30;
    } else if (periodType === "Weekly") {
      // Use weekly rate if available, otherwise calculate from daily
      const weeks = Math.ceil(days / 7);
      return (selectedVehicle.weekly_rent || (selectedVehicle.daily_rent || 50) * 7) * weeks;
    } else {
      // Daily rate
      return (selectedVehicle.daily_rent || 50) * days;
    }
  };

  const calculateTaxesAndFees = () => {
    return (vehicleTotal * 0.10) + 50; // 10% tax + $50 service fee
  };

  const calculateGrandTotal = () => {
    const taxesAndFees = calculateTaxesAndFees();
    return vehicleTotal + taxesAndFees;
  };

  const depositAmount = 500; // Fixed deposit

  // Function to redirect to Stripe payment
  const redirectToStripePayment = async () => {
    if (!createdRentalData) {
      toast.error("Rental data not found");
      return;
    }

    try {
      setIsProcessing(true);

      // Create Stripe checkout session
      const { data, error: functionError } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId: createdRentalData.rental.id,
          customerEmail: formData.customerEmail,
          customerName: formData.customerName,
          totalAmount: calculateGrandTotal(),
        },
      });

      if (functionError) throw functionError;

      if (data?.url) {
        // Redirect to Stripe checkout
        if (typeof window !== 'undefined' && (window as any).gtag) {
          (window as any).gtag('event', 'redirecting_to_stripe', {
            rental_id: createdRentalData.rental.id,
            customer_id: createdRentalData.customer.id,
            total: calculateGrandTotal(),
          });
        }
        window.location.href = data.url;
      } else {
        throw new Error('Failed to create checkout session');
      }
    } catch (error: any) {
      console.error("Stripe redirect error:", error);
      toast.error(error.message || "Failed to redirect to payment");
      setIsProcessing(false);
    }
  };

  // Function to send DocuSign envelope
  const handleSendDocuSign = async () => {
    if (!createdRentalData) return;

    try {
      setSendingDocuSign(true);
      toast.loading("Sending rental agreement via DocuSign...", { id: "docusign-send" });

      const { data, error } = await supabase.functions.invoke('create-docusign-envelope', {
        body: {
          rentalId: createdRentalData.rental.id,
          customerId: createdRentalData.customer.id,
          customerEmail: formData.customerEmail,
          customerName: formData.customerName,
        },
      });

      if (error) throw error;

      if (data?.ok) {
        toast.success("Rental agreement sent successfully!", { id: "docusign-send" });
      } else {
        throw new Error(data?.error || 'Failed to send DocuSign');
      }
    } catch (error: any) {
      console.error("DocuSign error:", error);
      toast.error(error.message || "Failed to send rental agreement", { id: "docusign-send" });
    } finally {
      setSendingDocuSign(false);
      // Proceed to payment regardless of DocuSign success
      redirectToStripePayment();
    }
  };

  const handlePayment = async () => {
    if (!agreeTerms) {
      toast.error("You must agree to the terms and conditions");
      return;
    }

    // Prevent double submission
    if (isProcessing) {
      return;
    }

    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'checkout_submitted', {
        vehicle_id: selectedVehicle.id,
        total: calculateGrandTotal(),
      });
    }

    setIsProcessing(true);

    // DEBUG: Check if verificationSessionId is present
    console.log('🔍 Checkout formData:', formData);
    console.log('🔍 Verification Session ID:', formData.verificationSessionId);

    try {
      // Step 1: Create customer in portal DB
      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .insert({
          type: formData.customerType, // "Individual" or "Company"
          name: formData.customerName,
          email: formData.customerEmail,
          phone: formData.customerPhone,
          status: "Active",
        })
        .select()
        .single();

      if (customerError) throw customerError;

      // Step 1.5: Link verification to customer if verification was completed
      if (formData.verificationSessionId) {
        console.log('🔗 Linking verification to customer:', formData.verificationSessionId);
        console.log('🔗 Customer ID to link:', customer.id);

        // Query the verification record by session_id
        const { data: verification, error: verificationQueryError } = await supabase
          .from('identity_verifications')
          .select('*') // Select all fields to debug
          .eq('session_id', formData.verificationSessionId)
          .maybeSingle(); // Use maybeSingle() in case webhook hasn't created the record yet

        console.log('🔍 Query result - verification:', verification);
        console.log('🔍 Query result - error:', verificationQueryError);

        if (!verificationQueryError && verification) {
          console.log('✅ Found verification record:', {
            id: verification.id,
            session_id: verification.session_id,
            current_customer_id: verification.customer_id,
            review_result: verification.review_result
          });

          // Update verification to link it to the customer
          const { data: updateResult, error: verificationUpdateError } = await supabase
            .from('identity_verifications')
            .update({ customer_id: customer.id })
            .eq('id', verification.id)
            .select(); // Return the updated record

          console.log('📝 Update result - data:', updateResult);
          console.log('📝 Update result - error:', verificationUpdateError);

          if (verificationUpdateError) {
            console.error('❌ Failed to link verification to customer:', verificationUpdateError);
          } else {
            console.log('✅ Successfully linked verification to customer');
            console.log('✅ Updated verification record:', updateResult);

            // Verify the update by querying again
            const { data: verifyUpdate } = await supabase
              .from('identity_verifications')
              .select('id, session_id, customer_id, review_result')
              .eq('id', verification.id)
              .single();

            console.log('🔍 Verification after update:', verifyUpdate);

            // Update customer's identity_verification_status based on verification result
            let verificationStatus = 'pending';
            if (verification.review_result === 'GREEN') {
              verificationStatus = 'verified';
            } else if (verification.review_result === 'RED') {
              verificationStatus = 'rejected';
            }

            const { error: customerStatusError } = await supabase
              .from('customers')
              .update({ identity_verification_status: verificationStatus })
              .eq('id', customer.id);

            if (customerStatusError) {
              console.error('Failed to update customer verification status:', customerStatusError);
            } else {
              console.log('✅ Updated customer verification status to:', verificationStatus);
            }
          }
        } else {
          console.log('❌ Verification not found or still pending');
          console.log('Error details:', verificationQueryError);
        }
      } else {
        console.log('⚠️ No verification session ID in formData');
      }

      // Step 2: Create rental in portal DB with Pending status
      const rentalPeriodType = calculateRentalPeriodType();
      const monthlyAmount = calculateMonthlyAmount();

      const { data: rental, error: rentalError } = await supabase
        .from("rentals")
        .insert({
          customer_id: customer.id,
          vehicle_id: selectedVehicle.id,
          start_date: formData.pickupDate, // Already in YYYY-MM-DD format from step 1
          end_date: formData.dropoffDate,   // Already in YYYY-MM-DD format from step 1
          rental_period_type: rentalPeriodType,
          monthly_amount: monthlyAmount,
          status: "Pending", // Set to Pending until payment succeeds
        })
        .select()
        .single();

      if (rentalError) throw rentalError;

      // Charges are automatically generated by database trigger
      // Backup: Ensure first charge is generated for this specific rental
      // (rental is still in Pending status at this point, before payment)
      console.log('🔄 Generating first charge for rental:', rental.id);
      const { error: chargeError } = await supabase.rpc("generate_first_charge_for_rental", {
        rental_id_param: rental.id
      });

      if (chargeError) {
        console.error('⚠️ Failed to generate first charge:', chargeError);
        // Don't throw - continue with payment flow even if charge generation fails
        // The charge can be manually created later if needed
      } else {
        console.log('✅ First charge generated successfully');
      }

      // Step 3: Update vehicle status to "Rented"
      const { error: vehicleUpdateError } = await supabase
        .from("vehicles")
        .update({ status: "Rented" })
        .eq("id", selectedVehicle.id);

      if (vehicleUpdateError) {
        console.error("Failed to update vehicle status:", vehicleUpdateError);
        // Don't throw - continue with payment flow
      }

      // Step 4: Create invoice in database
      let invoice: Invoice | null = null;
      try {
        invoice = await createInvoice({
          rental_id: rental.id,
          customer_id: customer.id,
          vehicle_id: selectedVehicle.id,
          invoice_date: new Date(),
          due_date: new Date(formData.pickupDate), // Due on pickup date
          subtotal: vehicleTotal,
          tax_amount: calculateTaxesAndFees(),
          total_amount: calculateGrandTotal(),
          notes: `Security deposit of $${depositAmount.toLocaleString()} will be held during the rental period.`,
        });

        console.log('✅ Invoice created successfully:', invoice.invoice_number);
        setGeneratedInvoice(invoice);
      } catch (invoiceError: any) {
        console.error('❌ Failed to create invoice:', invoiceError);
        // Don't throw - continue with payment flow even if invoice creation fails
        // The invoice can be manually created later if needed
      }

      // Store rental and invoice data for later use
      setCreatedRentalData({
        customer,
        rental,
        vehicle: selectedVehicle,
      });

      // Show invoice dialog first (before payment)
      setShowInvoiceDialog(true);
      setIsProcessing(false);
    } catch (error: any) {
      console.error("Payment error:", error);
      toast.error(error.message || "Failed to initiate payment");

      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'payment_failed', {
          error: error.message,
        });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-display font-bold text-gradient-metal mb-2">Review & Payment</h2>
        <p className="text-muted-foreground">Confirm your details and secure your rental below.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column - Summary Cards */}
        <div className="lg:col-span-2 space-y-6">
          {/* Rental Summary Card */}
          <Card className="p-6 bg-card border-accent/20">
            <h3 className="text-lg font-semibold mb-4">Rental Summary</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Car className="w-5 h-5 text-accent mt-0.5" />
                <div>
                  <p className="font-medium">
                    {selectedVehicle.make && selectedVehicle.model
                      ? `${selectedVehicle.make} ${selectedVehicle.model}`
                      : selectedVehicle.reg}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedVehicle.colour ? `${selectedVehicle.colour} • ` : ''}{selectedVehicle.reg}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="w-5 h-5 text-accent mt-0.5" />
                <div>
                  <p className="font-medium">{rentalDuration.formatted}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(formData.pickupDate), 'MMM dd, yyyy')} - {format(new Date(formData.dropoffDate), 'MMM dd, yyyy')}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-accent mt-0.5" />
                <div>
                  <p className="font-medium">Pickup: {formData.pickupLocation}</p>
                  <p className="text-sm text-muted-foreground">Return: {formData.dropoffLocation}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-accent mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    Pickup: {formData.pickupTime} | Return: {formData.dropoffTime}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Customer Details Card */}
          <Card className="p-6 bg-card border-accent/20">
            <h3 className="text-lg font-semibold mb-4">Your Details</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <User className="w-5 h-5 text-accent mt-0.5" />
                <div>
                  <p className="font-medium">{formData.customerName}</p>
                  <p className="text-sm text-muted-foreground">{formData.customerType}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 text-accent mt-0.5 flex items-center justify-center">
                  <span className="text-sm">@</span>
                </div>
                <div>
                  <p className="text-sm">{formData.customerEmail}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 text-accent mt-0.5 flex items-center justify-center">
                  <span className="text-sm">📞</span>
                </div>
                <div>
                  <p className="text-sm">{formData.customerPhone}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Terms & Conditions */}
          <Card className="p-6">
            <div className="flex items-start gap-2">
              <Checkbox
                checked={agreeTerms}
                onCheckedChange={(checked) => setAgreeTerms(checked as boolean)}
                className="mt-1"
              />
              <Label className="text-sm leading-relaxed cursor-pointer">
                By confirming, you agree to Drive 917's{" "}
                <a href="/terms" target="_blank" className="text-accent underline">Rental Agreement</a>,{" "}
                <a href="/terms" target="_blank" className="text-accent underline">Terms of Service</a>, and{" "}
                <a href="/privacy" target="_blank" className="text-accent underline">Privacy Policy</a>.
              </Label>
            </div>
          </Card>
        </div>

        {/* Right Column - Price Summary (Sticky) */}
        <div className="lg:col-span-1">
          <Card className="p-6 bg-gradient-dark border-accent/30 lg:sticky lg:top-24">
            <h3 className="text-lg font-semibold text-gradient-metal mb-4">Price Summary</h3>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Rental ({rentalDuration.days} days)</span>
                <span className="font-medium">${vehicleTotal.toLocaleString()}</span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Taxes & Fees</span>
                <span className="font-medium">${calculateTaxesAndFees().toLocaleString()}</span>
              </div>

              <div className="flex justify-between text-sm pb-3 border-b border-border">
                <span className="text-muted-foreground">Security Deposit (hold)</span>
                <span className="font-medium">${depositAmount.toLocaleString()}</span>
              </div>

              <div className="pt-3 border-t border-accent/30">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold">Total Due Today</span>
                  <span className="text-2xl font-bold text-accent">
                    ${calculateGrandTotal().toLocaleString()}
                  </span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mt-4">
                You'll receive a digital receipt immediately. Deposit is held, not charged.
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <Button
                onClick={handlePayment}
                disabled={isProcessing || sendingDocuSign || !agreeTerms}
                className="w-full gradient-accent hover-lift"
                size="lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : sendingDocuSign ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending Agreement...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Confirm & Pay ${calculateGrandTotal().toLocaleString()}
                  </>
                )}
              </Button>

              <Button
                onClick={onBack}
                variant="outline"
                className="w-full"
                size="lg"
                disabled={isProcessing}
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back to Vehicles
              </Button>

              <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center pt-2">
                <Shield className="w-4 h-4" />
                <span>Secured by Stripe. Card details never stored.</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Invoice Dialog */}
      {generatedInvoice && createdRentalData && (
        <InvoiceDialog
          open={showInvoiceDialog}
          onOpenChange={(open) => {
            setShowInvoiceDialog(open);
            if (!open) {
              // When invoice dialog closes, automatically send DocuSign
              handleSendDocuSign();
            }
          }}
          invoice={generatedInvoice}
          customer={{
            name: formData.customerName,
            email: formData.customerEmail,
            phone: formData.customerPhone,
          }}
          vehicle={{
            reg: selectedVehicle.reg,
            make: selectedVehicle.make,
            model: selectedVehicle.model,
          }}
          rental={{
            start_date: formData.pickupDate,
            end_date: formData.dropoffDate,
            monthly_amount: createdRentalData.rental.monthly_amount,
          }}
        />
      )}

    </div>
  );
}
