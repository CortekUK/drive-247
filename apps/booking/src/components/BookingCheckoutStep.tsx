'use client'

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ChevronLeft, CreditCard, Shield, Calendar, MapPin, Clock, Car, User, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { format } from "date-fns";
import { isEnquiryBasedTenant } from "@/config/tenant-config";
import { InvoiceDialog } from "@/components/InvoiceDialog";
import { createInvoiceWithFallback, Invoice } from "@/lib/invoiceUtils";

interface PromoDetails {
  code: string;
  type: "percentage" | "fixed_amount";
  value: number;
  id: string;
}

interface BookingCheckoutStepProps {
  formData: any;
  selectedVehicle: any;
  extras: any[];
  rentalDuration: {
    days: number;
    formatted: string;
  };
  vehicleTotal: number; // Original price before promo discount
  promoDetails?: PromoDetails | null;
  onBack: () => void;
}

export default function BookingCheckoutStep({
  formData,
  selectedVehicle,
  extras,
  rentalDuration,
  vehicleTotal,
  promoDetails,
  onBack
}: BookingCheckoutStepProps) {
  const router = useRouter();
  const { tenant } = useTenant();
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Dialog states
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [generatedInvoice, setGeneratedInvoice] = useState<any>(null);
  const [createdRentalData, setCreatedRentalData] = useState<any>(null);
  const [sendingDocuSign, setSendingDocuSign] = useState(false);

  // Calculate rental period type based on duration
  // Pricing tiers: > 30 days = monthly, 7-30 days = weekly, < 7 days = daily
  const calculateRentalPeriodType = (): "Daily" | "Weekly" | "Monthly" => {
    const days = rentalDuration.days;
    if (days > 30) return "Monthly";
    if (days >= 7) return "Weekly";
    return "Daily";
  };

  // Calculate rental amount based on period type and vehicle pricing (pro-rata)
  const calculateMonthlyAmount = (): number => {
    const days = rentalDuration.days;
    const dailyRent = selectedVehicle.daily_rent || 0;
    const weeklyRent = selectedVehicle.weekly_rent || 0;
    const monthlyRent = selectedVehicle.monthly_rent || 0;

    // Pricing tiers (pro-rata):
    // > 30 days: monthly rate (days/30 × monthly_rent)
    // 7-30 days: weekly rate (days/7 × weekly_rent)
    // < 7 days: daily rate (days × daily_rent)
    if (days > 30 && monthlyRent > 0) {
      return (days / 30) * monthlyRent;
    } else if (days >= 7 && days <= 30 && weeklyRent > 0) {
      return (days / 7) * weeklyRent;
    } else if (dailyRent > 0) {
      return days * dailyRent;
    } else if (weeklyRent > 0) {
      return (days / 7) * weeklyRent;
    } else if (monthlyRent > 0) {
      return (days / 30) * monthlyRent;
    }
    return 0;
  };

  // Calculate promo discount amount
  const calculatePromoDiscount = (): number => {
    if (!promoDetails) return 0;

    if (promoDetails.type === 'fixed_amount') {
      // Fixed amount discount, but not more than the vehicle total
      return Math.min(promoDetails.value, vehicleTotal);
    } else if (promoDetails.type === 'percentage') {
      // Percentage discount
      return (vehicleTotal * promoDetails.value) / 100;
    }
    return 0;
  };

  // Calculate discounted vehicle total (after promo code)
  const calculateDiscountedVehicleTotal = (): number => {
    return vehicleTotal - calculatePromoDiscount();
  };

  // Calculate tax amount based on tenant settings (applied to discounted price)
  const calculateTaxAmount = (): number => {
    if (!tenant?.tax_enabled || !tenant?.tax_percentage) {
      return 0;
    }
    // Tax is calculated on the discounted price
    return calculateDiscountedVehicleTotal() * (tenant.tax_percentage / 100);
  };

  // Calculate service fee based on tenant settings (supports both fixed and percentage)
  const calculateServiceFee = (): number => {
    if (!tenant?.service_fee_enabled) {
      return 0;
    }

    // Check for percentage type service fee
    const feeType = (tenant as any)?.service_fee_type || 'fixed_amount';
    const feeValue = (tenant as any)?.service_fee_value ?? tenant?.service_fee_amount ?? 0;

    if (feeType === 'percentage') {
      // Percentage service fee (calculated on discounted vehicle total)
      return (calculateDiscountedVehicleTotal() * feeValue) / 100;
    } else {
      // Fixed amount service fee
      return feeValue;
    }
  };

  // Calculate security deposit based on tenant settings
  const calculateSecurityDeposit = (): number => {
    if (tenant?.deposit_mode === 'per_vehicle') {
      // Per-vehicle deposit: use the vehicle's security_deposit field
      return selectedVehicle?.security_deposit ?? 0;
    }
    // Global deposit mode (default)
    return tenant?.global_deposit_amount ?? 0;
  };

  const calculateGrandTotal = () => {
    // Grand total = discounted vehicle price + tax + service fee + security deposit
    return calculateDiscountedVehicleTotal() + calculateTaxAmount() + calculateServiceFee() + calculateSecurityDeposit();
  };

  // Check if this is an enquiry-based tenant (e.g., Kedic Services)
  // For enquiry tenants: only charge security deposit upfront (if any), rental fees collected later
  const isEnquiry = isEnquiryBasedTenant(tenant?.id);

  // For enquiry-based tenants, only charge security deposit (if any)
  const getPayableAmount = (): number => {
    if (isEnquiry) {
      return calculateSecurityDeposit(); // Only security deposit for enquiry tenants
    }
    return calculateGrandTotal();
  };

  // Function to get booking payment mode
  const getBookingMode = async (): Promise<'manual' | 'auto'> => {
    try {
      const { data, error } = await supabase.functions.invoke('get-booking-mode');
      if (error) {
        console.error('Error fetching booking mode:', error);
        return 'manual'; // Default to manual for safety
      }
      return data?.mode || 'manual';
    } catch (error) {
      console.error('Error fetching booking mode:', error);
      return 'manual';
    }
  };

  // Function to redirect to Stripe payment (auto mode - immediate capture)
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
          tenantSlug: tenant?.slug, // Pass tenant slug for Stripe Connect routing
          tenantId: tenant?.id,
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

  // Function to redirect to Stripe pre-auth payment (manual mode - hold only)
  const redirectToPreAuthPayment = async () => {
    if (!createdRentalData) {
      toast.error("Rental data not found");
      return;
    }

    try {
      setIsProcessing(true);

      // Create Stripe pre-auth checkout session
      const { data, error: functionError } = await supabase.functions.invoke('create-preauth-checkout', {
        body: {
          rentalId: createdRentalData.rental.id,
          customerId: createdRentalData.customer.id,
          customerEmail: formData.customerEmail,
          customerName: formData.customerName,
          customerPhone: formData.customerPhone,
          vehicleId: selectedVehicle.id,
          vehicleName: selectedVehicle.make && selectedVehicle.model
            ? `${selectedVehicle.make} ${selectedVehicle.model}`
            : selectedVehicle.reg,
          totalAmount: calculateGrandTotal(),
          pickupDate: formData.pickupDate,
          returnDate: formData.dropoffDate,
          tenantId: tenant?.id, // Explicitly pass tenant_id
        },
      });

      if (functionError) throw functionError;

      if (data?.url) {
        // Redirect to Stripe checkout
        if (typeof window !== 'undefined' && (window as any).gtag) {
          (window as any).gtag('event', 'redirecting_to_stripe_preauth', {
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
      console.error("Stripe pre-auth redirect error:", error);
      toast.error(error.message || "Failed to redirect to payment");
      setIsProcessing(false);
    }
  };

  const handleSendDocuSign = async () => {
    if (!createdRentalData) {
      console.error('❌ No rental data available');
      toast.error("Rental data not found. Please try again.");
      return;
    }

    setSendingDocuSign(true);

    try {
      console.log('═════════════════════════════════════════════════════════');
      console.log('📄 CREATING DOCUSIGN ENVELOPE (via API route)');
      console.log('═════════════════════════════════════════════════════════');
      console.log('Rental ID:', createdRentalData.rental.id);
      console.log('Customer ID:', createdRentalData.customer.id);
      console.log('Customer Email:', formData.customerEmail);
      console.log('Customer Name:', formData.customerName);

      // Use local API route instead of Supabase Edge Function
      const response = await fetch('/api/docusign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalId: createdRentalData.rental.id,
          customerEmail: formData.customerEmail,
          customerName: formData.customerName,
          tenantId: tenant?.id, // Pass tenant ID for template lookup
          vehicleId: selectedVehicle.id, // Fallback for tenant lookup
        }),
      });

      const data = await response.json();
      const error = response.ok ? null : data;

      console.log('═════════════════════════════════════════════════════════');
      console.log('📨 DOCUSIGN RESPONSE');
      console.log('═════════════════════════════════════════════════════════');
      console.log('Error:', error);
      console.log('Data:', JSON.stringify(data, null, 2));

      if (error) {
        console.error("DocuSign call failed:", error);
        toast.error("DocuSign unavailable. Agreement will be sent later.");
      } else if (data?.ok) {
        console.log('✅ DocuSign envelope created!');
        toast.success("Agreement sent to your email!", { duration: 4000 });
      } else {
        console.warn("DocuSign returned error:", data);
        toast.error(data?.error || "DocuSign failed. Agreement will be sent later.");
      }

      // Proceed based on payable amount
      setSendingDocuSign(false);

      setTimeout(async () => {
        const payableAmount = getPayableAmount();

        // For enquiry tenants with no security deposit, skip payment entirely
        if (isEnquiry && payableAmount === 0) {
          console.log('📋 Enquiry booking with no deposit - redirecting to enquiry submitted page');
          if (typeof window !== 'undefined' && (window as any).gtag) {
            (window as any).gtag('event', 'enquiry_submitted', {
              rental_id: createdRentalData.rental.id,
              customer_id: createdRentalData.customer.id,
            });
          }
          window.location.href = `/booking-enquiry-submitted?rental_id=${createdRentalData.rental.id}`;
          return;
        }

        // Proceed to payment (either full amount or deposit only)
        const bookingMode = await getBookingMode();
        console.log('💳 Proceeding to payment, mode:', bookingMode, 'amount:', payableAmount);
        if (bookingMode === 'manual') {
          redirectToPreAuthPayment();
        } else {
          redirectToStripePayment();
        }
      }, 1500);

    } catch (err: any) {
      console.error("DocuSign exception:", err);
      toast.error("DocuSign error. Proceeding...");
      setSendingDocuSign(false);

      setTimeout(async () => {
        const payableAmount = getPayableAmount();

        // For enquiry tenants with no security deposit, skip payment entirely
        if (isEnquiry && payableAmount === 0) {
          console.log('📋 Enquiry booking with no deposit - redirecting to enquiry submitted page');
          window.location.href = `/booking-enquiry-submitted?rental_id=${createdRentalData.rental.id}`;
          return;
        }

        const bookingMode = await getBookingMode();
        if (bookingMode === 'manual') {
          redirectToPreAuthPayment();
        } else {
          redirectToStripePayment();
        }
      }, 1500);
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
      // Step 1: Find existing customer by email GLOBALLY (without tenant filter)
      // This prevents duplicate key errors when email exists with different tenant_id
      console.log('📝 Checking for existing customer by email (globally)...');

      const { data: existingCustomer } = await supabase
        .from("customers")
        .select("*")
        .eq("email", formData.customerEmail)
        .maybeSingle();

      let customer;

      if (existingCustomer) {
        // Customer exists - update their details and optionally assign to tenant
        console.log('👤 Found existing customer, updating...', existingCustomer.id);

        const updateData: Record<string, unknown> = {
          type: formData.customerType,
          name: formData.customerName,
          phone: formData.customerPhone,
          status: "Active",
        };

        // Also update tenant_id if not already set
        if (tenant?.id && !existingCustomer.tenant_id) {
          updateData.tenant_id = tenant.id;
        }

        const { data: updatedCustomer, error: updateError } = await supabase
          .from("customers")
          .update(updateData)
          .eq("id", existingCustomer.id)
          .select()
          .single();

        if (updateError) {
          console.error('❌ Customer update error:', updateError);
          throw updateError;
        }
        customer = updatedCustomer;
      } else {
        // No existing customer - create new one
        console.log('🆕 Creating new customer...');

        const customerData: Record<string, unknown> = {
          type: formData.customerType,
          name: formData.customerName,
          email: formData.customerEmail,
          phone: formData.customerPhone,
          status: "Active",
          is_blocked: false,
        };

        if (tenant?.id) {
          customerData.tenant_id = tenant.id;
        }

        const { data: newCustomer, error: createError } = await supabase
          .from("customers")
          .insert(customerData as any)
          .select()
          .single();

        if (createError) {
          console.error('❌ Customer create error:', createError);
          throw createError;
        }
        customer = newCustomer;
      }

      console.log('✅ Customer ready:', customer.id);

      // Step 1.5: Link verification to customer if verification was completed
      if (formData.verificationSessionId) {
        console.log('🔗 Linking verification to customer:', formData.verificationSessionId);
        console.log('🔗 Customer ID to link:', customer.id);

        // Query the verification record by session_id first (primary method)
        // If not found, fallback to querying by id for backward compatibility
        let verification: {
          id: string;
          session_id: string | null;
          customer_id: string | null;
          review_result: string | null;
          [key: string]: unknown;
        } | null = null;
        let verificationQueryError: unknown = null;

        // Try session_id first
        const { data: sessionData, error: sessionError } = await supabase
          .from('identity_verifications')
          .select('*')
          .eq('session_id', formData.verificationSessionId)
          .maybeSingle();

        if (sessionData) {
          verification = sessionData;
          console.log('🔍 Found verification by session_id');
        } else {
          // Fallback: try querying by id (for older verifications without session_id)
          console.log('🔍 No match by session_id, trying by id...');
          const { data: idData, error: idError } = await supabase
            .from('identity_verifications')
            .select('*')
            .eq('id', formData.verificationSessionId)
            .maybeSingle();

          if (idData) {
            verification = idData;
            console.log('🔍 Found verification by id (fallback)');
          } else {
            verificationQueryError = sessionError || idError;
          }
        }

        console.log('🔍 Query result - verification:', verification);
        console.log('🔍 Query result - error:', verificationQueryError);

        if (!verificationQueryError && verification) {
          console.log('✅ Found verification record:', {
            id: verification.id,
            session_id: verification.session_id,
            current_customer_id: verification.customer_id,
            review_result: verification.review_result
          });

          // Update verification to link it to the customer and set tenant_id
          const updateData: { customer_id: string; tenant_id?: string } = { customer_id: customer.id };
          if (tenant?.id) {
            updateData.tenant_id = tenant.id;
          }

          const { data: updateResult, error: verificationUpdateError } = await supabase
            .from('identity_verifications')
            .update(updateData)
            .eq('id', verification.id)
            .select();

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

      // Step 2: Get booking mode FIRST (needed for rental creation)
      const bookingMode = await getBookingMode();
      console.log('📋 Booking mode:', bookingMode);

      // Step 3: Create rental in portal DB with Pending status
      const rentalPeriodType = calculateRentalPeriodType();
      const grandTotal = calculateGrandTotal(); // Use grand total (includes taxes/fees) for rental amount

      // For enquiry tenants with no deposit, mark payment as not required
      const enquiryWithNoDeposit = isEnquiry && calculateSecurityDeposit() === 0;

      const rentalData: any = {
        customer_id: customer.id,
        vehicle_id: selectedVehicle.id,
        start_date: formData.pickupDate, // Already in YYYY-MM-DD format from step 1
        end_date: formData.dropoffDate,   // Already in YYYY-MM-DD format from step 1
        rental_period_type: rentalPeriodType,
        monthly_amount: grandTotal, // Store grand total (rental + taxes + fees + protection)
        status: "Pending", // Derived from approval_status + payment_status
        payment_mode: enquiryWithNoDeposit ? 'manual' : bookingMode, // Track payment mode
        approval_status: "pending", // Awaiting admin approval
        payment_status: enquiryWithNoDeposit ? "fulfilled" : "pending", // Enquiry with no deposit: payment already satisfied
        // Location data
        pickup_location: formData.pickupLocation || null,
        pickup_location_id: formData.pickupLocationId || null,
        return_location: formData.dropoffLocation || null,
        return_location_id: formData.returnLocationId || null,
      };

      if (tenant?.id) {
        rentalData.tenant_id = tenant.id;
      }

      const { data: rental, error: rentalError } = await supabase
        .from("rentals")
        .insert(rentalData)
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

      // Step 4: Vehicle status - keep as Available until admin approves (both modes)
      // Vehicle will only be marked as "Rented" when admin clicks Approve
      console.log('⏳ Vehicle status unchanged - awaiting admin approval');

      // Step 4: Create invoice (with fallback to local if DB fails)
      const promoDiscount = calculatePromoDiscount();
      const discountedVehicleTotal = calculateDiscountedVehicleTotal();

      const invoice = await createInvoiceWithFallback({
        rental_id: rental.id,
        customer_id: customer.id,
        vehicle_id: selectedVehicle.id,
        invoice_date: new Date(),
        due_date: new Date(formData.pickupDate),
        subtotal: vehicleTotal, // Original price before discount
        rental_fee: discountedVehicleTotal, // Discounted rental fee
        protection_fee: 0,
        tax_amount: calculateTaxAmount(),
        service_fee: calculateServiceFee(),
        security_deposit: calculateSecurityDeposit(),
        total_amount: calculateGrandTotal(),
        discount_amount: promoDiscount,
        promo_code: promoDetails?.code || null,
        notes: promoDetails ? `Promo code applied: ${promoDetails.code} (${promoDetails.type === 'percentage' ? `${promoDetails.value}%` : `$${promoDetails.value}`} off)` : '',
        tenant_id: tenant?.id,
      });

      console.log('✅ Invoice ready:', invoice.invoice_number);
      setGeneratedInvoice(invoice);

      // Step 5: Store payment details in localStorage for success page
      // Payment record will be created ONLY after Stripe confirms successful payment
      console.log('💳 Storing payment details for success page...');
      const paymentDetails = {
        amount: calculateGrandTotal(),
        customer_id: customer.id,
        rental_id: rental.id,
        vehicle_id: selectedVehicle.id,
        apply_from_date: formData.pickupDate,
        tenant_id: tenant?.id, // Include tenant_id for proper filtering in portal
      };
      localStorage.setItem('pendingPaymentDetails', JSON.stringify(paymentDetails));
      console.log('✅ Payment details stored:', paymentDetails);

      // Store rental and invoice data for later use
      setCreatedRentalData({
        customer,
        rental,
        vehicle: selectedVehicle,
      });

      // Link any existing insurance documents to this rental
      // Insurance is uploaded before rental creation with a temp customer,
      // so we need to update both customer_id and rental_id
      try {
        // Get pending insurance docs from localStorage (stored during upload)
        const pendingDocs = typeof window !== 'undefined'
          ? JSON.parse(localStorage.getItem('pending_insurance_docs') || '[]')
          : [];

        console.log('🔍 Found pending insurance docs:', pendingDocs);

        if (pendingDocs.length > 0) {
          // Update each pending document with real customer_id and rental_id
          for (const doc of pendingDocs) {
            console.log(`📎 Linking document ${doc.document_id} to customer ${customer.id} and rental ${rental.id}`);

            const { error: linkError } = await supabase
              .from('customer_documents')
              .update({
                customer_id: customer.id,
                rental_id: rental.id
              })
              .eq('id', doc.document_id);

            if (linkError) {
              console.warn(`⚠️ Could not link document ${doc.document_id}:`, linkError);
            } else {
              console.log(`✅ Document ${doc.document_id} linked successfully`);
            }

            // Optionally delete the temp customer (cleanup)
            if (doc.temp_customer_id && doc.temp_customer_id !== customer.id) {
              await supabase
                .from('customers')
                .delete()
                .eq('id', doc.temp_customer_id)
                .like('email', 'pending-%@temp.booking')
                .then(({ error }) => {
                  if (error) {
                    console.warn('⚠️ Could not cleanup temp customer:', error);
                  } else {
                    console.log('🧹 Temp customer cleaned up');
                  }
                });
            }
          }

          // Clear pending docs from localStorage
          localStorage.removeItem('pending_insurance_docs');
          console.log('✅ Insurance documents linked to rental and cleaned up');
        } else {
          console.log('ℹ️ No pending insurance documents to link');
        }
      } catch (linkErr) {
        console.warn('⚠️ Error linking insurance documents:', linkErr);
      }

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

  // Show loading state if vehicle is not yet loaded
  if (!selectedVehicle) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-display font-bold text-gradient-metal mb-2">Review & Payment</h2>
          <p className="text-muted-foreground">Loading vehicle details...</p>
        </div>
      </div>
    );
  }

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
            <h3 className="text-lg font-semibold text-gradient-metal mb-4">
              {isEnquiry ? 'Booking Summary' : 'Price Summary'}
            </h3>

            <div className="space-y-3">
              {/* ENQUIRY TENANT: Show info message and only deposit (if any) */}
              {isEnquiry ? (
                <>
                  {/* Info message for enquiry booking */}
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                    <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                      This is an enquiry booking
                    </p>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                      Rental charges will be confirmed after your booking is approved.
                    </p>
                  </div>

                  {/* Only show security deposit if > 0 */}
                  {calculateSecurityDeposit() > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Security Deposit</span>
                      <span className="font-medium">${calculateSecurityDeposit().toFixed(2)}</span>
                    </div>
                  )}

                  {/* Total Due Now */}
                  <div className="pt-3 border-t border-accent/30">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-semibold">Total Due Now</span>
                      <span className="text-2xl font-bold text-accent">
                        ${getPayableAmount().toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground mt-4">
                    {calculateSecurityDeposit() > 0
                      ? "Security deposit will be collected now. Rental charges confirmed after approval."
                      : "No payment required now. You'll be contacted to confirm your booking."}
                  </p>
                </>
              ) : (
                <>
                  {/* STANDARD TENANT: Show full price breakdown */}
                  {/* Original rental price */}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Rental ({rentalDuration.formatted})</span>
                    <span className={`font-medium ${promoDetails ? 'line-through text-muted-foreground' : ''}`}>
                      ${vehicleTotal.toFixed(2)}
                    </span>
                  </div>

                  {/* Promo discount line item - only show when applied */}
                  {promoDetails && calculatePromoDiscount() > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>
                        Promo ({promoDetails.code})
                        <span className="text-xs ml-1">
                          ({promoDetails.type === 'percentage' ? `${promoDetails.value}%` : `$${promoDetails.value}`} off)
                        </span>
                      </span>
                      <span className="font-medium">-${calculatePromoDiscount().toFixed(2)}</span>
                    </div>
                  )}

                  {/* Discounted subtotal - show when promo is applied */}
                  {promoDetails && calculatePromoDiscount() > 0 && (
                    <div className="flex justify-between text-sm pb-3 border-b border-border">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-medium text-green-600">${calculateDiscountedVehicleTotal().toFixed(2)}</span>
                    </div>
                  )}

                  {/* Border when no promo */}
                  {(!promoDetails || calculatePromoDiscount() === 0) && (
                    <div className="pb-3 border-b border-border" />
                  )}

                  {/* Tax line item - only show when tax is enabled */}
                  {tenant?.tax_enabled && (tenant?.tax_percentage ?? 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tax ({tenant.tax_percentage}%)</span>
                      <span className="font-medium">${calculateTaxAmount().toFixed(2)}</span>
                    </div>
                  )}

                  {/* Service fee line item - only show when enabled */}
                  {tenant?.service_fee_enabled && calculateServiceFee() > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Service Fee
                        {(tenant as any)?.service_fee_type === 'percentage' && (
                          <span className="text-xs ml-1">({(tenant as any)?.service_fee_value || 0}%)</span>
                        )}
                      </span>
                      <span className="font-medium">${calculateServiceFee().toFixed(2)}</span>
                    </div>
                  )}

                  {/* Security deposit line item - only show when > 0 */}
                  {calculateSecurityDeposit() > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Security Deposit</span>
                      <span className="font-medium">${calculateSecurityDeposit().toFixed(2)}</span>
                    </div>
                  )}

                  <div className="pt-3 border-t border-accent/30">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-semibold">Total</span>
                      <span className="text-2xl font-bold text-accent">
                        ${calculateGrandTotal().toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground mt-4">
                    You'll receive a digital receipt immediately.
                  </p>
                </>
              )}
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
                ) : isEnquiry && getPayableAmount() === 0 ? (
                  <>
                    Submit Enquiry
                  </>
                ) : isEnquiry ? (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Pay Deposit ${getPayableAmount().toFixed(2)}
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Confirm & Pay ${calculateGrandTotal().toFixed(2)}
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

              {/* Only show Stripe security message if payment is required */}
              {getPayableAmount() > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center pt-2">
                  <Shield className="w-4 h-4" />
                  <span>Secured by Stripe. Card details never stored.</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Invoice Dialog */}
      {generatedInvoice && createdRentalData && (
        <InvoiceDialog
          open={showInvoiceDialog}
          onOpenChange={setShowInvoiceDialog}
          onSignAgreement={handleSendDocuSign}
          invoice={generatedInvoice}
          isEnquiry={isEnquiry}
          payableAmount={getPayableAmount()}
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
