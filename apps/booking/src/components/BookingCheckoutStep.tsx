'use client'

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ChevronLeft, CreditCard, Shield, Calendar, MapPin, Clock, Car, User, Loader2, ArrowDown, CircleDot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useCustomerAuthStore } from "@/stores/customer-auth-store";
import { useBookingStore } from "@/stores/booking-store";
import { format } from "date-fns";
import { isEnquiryBasedTenant } from "@/config/tenant-config";
import { formatCurrency } from "@/lib/format-utils";
import { InvoiceDialog } from "@/components/InvoiceDialog";
import { AuthPromptDialog } from "@/components/booking/AuthPromptDialog";
import { createInvoiceWithFallback, Invoice } from "@/lib/invoiceUtils";
import InstallmentSelector, { InstallmentOption, InstallmentConfig } from "@/components/InstallmentSelector";
import { useDeliveryLocations } from "@/hooks/useDeliveryLocations";

interface PromoDetails {
  code: string;
  type: "percentage" | "fixed_amount";
  value: number;
  id: string;
}

interface BonzahCoverage {
  cdw: boolean;
  rcli: boolean;
  sli: boolean;
  pai: boolean;
}

interface BookingCheckoutStepProps {
  formData: any;
  selectedVehicle: any;
  extras: any[];
  selectedExtras?: Record<string, number>;
  rentalDuration: {
    days: number;
    formatted: string;
  };
  vehicleTotal: number; // Original price before promo discount
  promoDetails?: PromoDetails | null;
  onBack: () => void;
  // Bonzah insurance props
  bonzahPremium?: number;
  bonzahCoverage?: BonzahCoverage;
  // Delivery fee props
  pickupDeliveryFee?: number;
  returnDeliveryFee?: number;
}

export default function BookingCheckoutStep({
  formData,
  selectedVehicle,
  extras,
  selectedExtras = {},
  rentalDuration,
  vehicleTotal,
  promoDetails,
  onBack,
  bonzahPremium = 0,
  bonzahCoverage,
  pickupDeliveryFee = 0,
  returnDeliveryFee = 0,
}: BookingCheckoutStepProps) {
  const router = useRouter();
  const { tenant } = useTenant();
  const { customerUser } = useCustomerAuthStore();
  const { pendingInsuranceFiles, clearPendingInsuranceFiles } = useBookingStore();
  const { locations: allDeliveryLocations } = useDeliveryLocations();
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);

  // Dialog states
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [generatedInvoice, setGeneratedInvoice] = useState<any>(null);
  const [createdRentalData, setCreatedRentalData] = useState<any>(null);
  const [sendingDocuSign, setSendingDocuSign] = useState(false);

  // Bonzah policy ID - created dynamically during checkout
  const [bonzahPolicyId, setBonzahPolicyId] = useState<string | null>(null);

  // Installment state
  const [selectedInstallmentPlan, setSelectedInstallmentPlan] = useState<InstallmentOption | null>(null);
  const installmentsEnabled = tenant?.installments_enabled ?? false;
  const installmentConfig: InstallmentConfig = {
    min_days_for_weekly: 7,
    min_days_for_monthly: 30,
    max_installments_weekly: 4,
    max_installments_monthly: 6,
    charge_first_upfront: true,
    what_gets_split: 'rental_tax',
    grace_period_days: 3,
    max_retry_attempts: 3,
    retry_interval_days: 1,
    ...(tenant?.installment_config || {}),
  };

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

  // Calculate total delivery fees
  const calculateDeliveryFees = (): number => {
    return (pickupDeliveryFee || 0) + (returnDeliveryFee || 0);
  };

  // Calculate extras total from selectedExtras
  const calculateExtrasTotal = (): number => {
    return Object.entries(selectedExtras).reduce((sum, [extraId, qty]) => {
      const extra = extras.find((e: any) => e.id === extraId);
      return sum + (extra ? extra.price * qty : 0);
    }, 0);
  };

  const calculateGrandTotal = () => {
    // Grand total = discounted vehicle price + delivery fees + extras + tax + service fee + security deposit + insurance
    return calculateDiscountedVehicleTotal() + calculateDeliveryFees() + calculateExtrasTotal() + calculateTaxAmount() + calculateServiceFee() + calculateSecurityDeposit() + bonzahPremium;
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

  // Calculate installment breakdown based on what_gets_split setting
  const whatGetsSplit = installmentConfig.what_gets_split || 'rental_tax';
  const { installUpfrontAmount, installableAmount } = (() => {
    let upfront = calculateSecurityDeposit() + calculateServiceFee();
    let installable = 0;
    const discountedVehicle = calculateDiscountedVehicleTotal();
    const extrasTotal = calculateExtrasTotal();
    const taxAmount = calculateTaxAmount();
    const deliveryFees = calculateDeliveryFees();

    switch (whatGetsSplit) {
      case 'rental_only':
        installable = discountedVehicle + extrasTotal;
        upfront += taxAmount + deliveryFees;
        break;
      case 'rental_tax_extras':
        installable = discountedVehicle + extrasTotal + taxAmount + deliveryFees;
        break;
      case 'rental_tax':
      default:
        installable = discountedVehicle + extrasTotal + taxAmount;
        upfront += deliveryFees;
        break;
    }
    return { installUpfrontAmount: upfront, installableAmount: installable };
  })();

  const currencyCode = tenant?.currency_code || 'GBP';
  const fmt = (amount: number) => formatCurrency(amount, currencyCode);

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

  // Function to create Bonzah insurance quote
  const createBonzahQuote = async (
    rentalId: string,
    customerId: string,
    tenantId: string
  ): Promise<string | null> => {
    // Skip if no insurance selected
    if (!bonzahPremium || bonzahPremium <= 0 || !bonzahCoverage) {
      console.log('[Bonzah] No insurance selected, skipping quote creation');
      return null;
    }

    // Check if any coverage is actually selected
    const hasCoverage = bonzahCoverage.cdw || bonzahCoverage.rcli || bonzahCoverage.sli || bonzahCoverage.pai;
    if (!hasCoverage) {
      console.log('[Bonzah] No coverage options selected, skipping quote creation');
      return null;
    }

    try {
      console.log('[Bonzah] Creating insurance quote...');
      console.log('[Bonzah] Coverage:', bonzahCoverage);
      console.log('[Bonzah] Form data:', {
        licenseNumber: formData.licenseNumber,
        licenseState: formData.licenseState,
        driverDOB: formData.driverDOB,
        addressStreet: formData.addressStreet,
        addressCity: formData.addressCity,
        addressState: formData.addressState,
        addressZip: formData.addressZip,
      });

      const { data, error } = await supabase.functions.invoke('bonzah-create-quote', {
        body: {
          rental_id: rentalId,
          customer_id: customerId,
          tenant_id: tenantId,
          trip_dates: {
            start: formData.pickupDate,
            end: formData.dropoffDate,
          },
          pickup_state: formData.addressState || 'FL', // Use customer's state or default to FL
          coverage: bonzahCoverage,
          renter: {
            first_name: formData.customerName.split(' ')[0] || formData.customerName,
            last_name: formData.customerName.split(' ').slice(1).join(' ') || formData.customerName,
            dob: formData.driverDOB,
            email: formData.customerEmail,
            phone: formData.customerPhone,
            address: {
              street: formData.addressStreet,
              city: formData.addressCity,
              state: formData.addressState,
              zip: formData.addressZip,
            },
            license: {
              number: formData.licenseNumber,
              state: formData.licenseState,
            },
          },
        },
      });

      if (error) {
        console.error('[Bonzah] Error creating quote:', error);
        toast.error('Failed to create insurance quote. Insurance will not be included.');
        return null;
      }

      if (data?.policy_record_id) {
        console.log('[Bonzah] Quote created successfully:', data);
        setBonzahPolicyId(data.policy_record_id);
        return data.policy_record_id;
      }

      console.error('[Bonzah] No policy_record_id in response:', data);
      return null;
    } catch (err) {
      console.error('[Bonzah] Exception creating quote:', err);
      toast.error('Failed to create insurance quote. Insurance will not be included.');
      return null;
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
      // For enquiry tenants, only charge the deposit (getPayableAmount handles this)
      const { data, error: functionError } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId: createdRentalData.rental.id,
          customerEmail: formData.customerEmail,
          customerName: formData.customerName,
          totalAmount: getPayableAmount(), // Use payable amount (deposit only for enquiry tenants)
          tenantSlug: tenant?.slug, // Pass tenant slug for Stripe Connect routing
          tenantId: tenant?.id,
          bonzahPolicyId: createdRentalData.bonzahPolicyId || null, // For Bonzah insurance confirmation after payment
        },
      });

      if (functionError) throw functionError;

      if (data?.url) {
        // Redirect to Stripe checkout
        if (typeof window !== 'undefined' && (window as any).gtag) {
          (window as any).gtag('event', 'redirecting_to_stripe', {
            rental_id: createdRentalData.rental.id,
            customer_id: createdRentalData.customer.id,
            total: getPayableAmount(),
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
      // For enquiry tenants, only charge the deposit (getPayableAmount handles this)
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
          totalAmount: getPayableAmount(), // Use payable amount (deposit only for enquiry tenants)
          pickupDate: formData.pickupDate,
          returnDate: formData.dropoffDate,
          tenantId: tenant?.id, // Explicitly pass tenant_id
          // Bonzah insurance data
          insuranceAmount: bonzahPremium,
          bonzahPolicyId: createdRentalData.bonzahPolicyId || null,
        },
      });

      if (functionError) throw functionError;

      if (data?.url) {
        // Redirect to Stripe checkout
        if (typeof window !== 'undefined' && (window as any).gtag) {
          (window as any).gtag('event', 'redirecting_to_stripe_preauth', {
            rental_id: createdRentalData.rental.id,
            customer_id: createdRentalData.customer.id,
            total: getPayableAmount(),
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

  // Function to redirect to installment checkout (Stripe with card saving)
  const redirectToInstallmentCheckout = async () => {
    if (!createdRentalData || !selectedInstallmentPlan) {
      toast.error("Missing rental or installment data");
      return;
    }

    try {
      setIsProcessing(true);

      const { data, error: functionError } = await supabase.functions.invoke('create-installment-checkout', {
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
          tenantId: tenant?.id,
          upfrontAmount: selectedInstallmentPlan.upfrontTotal,
          firstInstallmentAmount: selectedInstallmentPlan.firstInstallmentAmount,
          baseUpfrontAmount: installUpfrontAmount,
          installmentAmount: selectedInstallmentPlan.installmentAmount,
          numberOfInstallments: selectedInstallmentPlan.numberOfInstallments,
          scheduledInstallments: selectedInstallmentPlan.scheduledInstallments,
          planType: selectedInstallmentPlan.type,
          installableAmount: installableAmount,
          pickupDate: formData.pickupDate,
          returnDate: formData.dropoffDate,
          startDate: formData.pickupDate,
          chargeFirstUpfront: installmentConfig.charge_first_upfront ?? true,
          whatGetsSplit: installmentConfig.what_gets_split ?? 'rental_tax',
          gracePeriodDays: installmentConfig.grace_period_days ?? 3,
          maxRetryAttempts: installmentConfig.max_retry_attempts ?? 3,
          retryIntervalDays: installmentConfig.retry_interval_days ?? 1,
        },
      });

      if (functionError) throw functionError;

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error('Failed to create installment checkout session');
      }
    } catch (error: any) {
      console.error("Installment checkout error:", error);
      toast.error(error.message || "Failed to create installment checkout");
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

      // Send agreement for signing via BoldSign
      const response = await fetch('/api/esign', {
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
        console.error("eSign call failed:", error);
        toast.error("Agreement signing unavailable. Agreement will be sent later.");
      } else if (data?.ok) {
        console.log('eSign document created!');
        toast.success("Agreement sent to your email!", { duration: 4000 });
      } else {
        console.warn("eSign returned error:", data);
        toast.error(data?.error || "Agreement failed to send. Will be sent later.");
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

        // Route to installment checkout if an installment plan is selected
        if (selectedInstallmentPlan && selectedInstallmentPlan.type !== 'full' && installmentsEnabled) {
          console.log('💳 Proceeding to installment checkout');
          redirectToInstallmentCheckout();
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
      console.error("eSign exception:", err);
      toast.error("Agreement error. Proceeding...");
      setSendingDocuSign(false);

      setTimeout(async () => {
        const payableAmount = getPayableAmount();

        // For enquiry tenants with no security deposit, skip payment entirely
        if (isEnquiry && payableAmount === 0) {
          console.log('📋 Enquiry booking with no deposit - redirecting to enquiry submitted page');
          window.location.href = `/booking-enquiry-submitted?rental_id=${createdRentalData.rental.id}`;
          return;
        }

        // Route to installment checkout if an installment plan is selected
        if (selectedInstallmentPlan && selectedInstallmentPlan.type !== 'full' && installmentsEnabled) {
          redirectToInstallmentCheckout();
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

  // Actual payment processing - called after auth check
  const proceedWithPayment = async () => {
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
        // Delivery fees
        delivery_fee: pickupDeliveryFee || 0,
        collection_fee: returnDeliveryFee || 0,
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

      // Save selected extras to rental_extras_selections
      if (Object.keys(selectedExtras).length > 0) {
        const extrasInserts = Object.entries(selectedExtras).map(([extraId, qty]) => {
          const extra = extras.find((e: any) => e.id === extraId);
          return {
            rental_id: rental.id,
            extra_id: extraId,
            quantity: qty,
            price_at_booking: extra?.price || 0,
          };
        });
        const { error: extrasError } = await supabase.from("rental_extras_selections").insert(extrasInserts);
        if (extrasError) {
          console.error("Failed to save rental extras:", extrasError);
        }
      }

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

      // Step 4.5: Create Bonzah insurance quote if coverage was selected
      let createdBonzahPolicyId: string | null = null;
      if (bonzahPremium > 0 && bonzahCoverage && tenant?.id) {
        console.log('🛡️ Creating Bonzah insurance quote...');
        createdBonzahPolicyId = await createBonzahQuote(rental.id, customer.id, tenant.id);
        if (createdBonzahPolicyId) {
          console.log('✅ Bonzah quote created:', createdBonzahPolicyId);
        } else {
          console.log('⚠️ Bonzah quote creation failed or skipped');
        }
      }

      // Step 5: Create invoice (with fallback to local if DB fails)
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
        insurance_premium: bonzahPremium || 0,
        delivery_fee: calculateDeliveryFees() || 0,
        extras_total: calculateExtrasTotal() || 0,
        total_amount: calculateGrandTotal(),
        discount_amount: promoDiscount,
        promo_code: promoDetails?.code || null,
        tenant_id: tenant?.id,
      });

      console.log('✅ Invoice ready:', invoice.invoice_number);
      // Augment invoice with discount info (not stored in DB but needed for display)
      const invoiceWithDiscount = {
        ...invoice,
        discount_amount: promoDiscount,
        promo_code: promoDetails?.code || null,
      };
      setGeneratedInvoice(invoiceWithDiscount);

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

      // Store rental and invoice data for later use (including Bonzah policy ID)
      setCreatedRentalData({
        customer,
        rental,
        vehicle: selectedVehicle,
        bonzahPolicyId: createdBonzahPolicyId,
      });

      // Link any existing insurance documents to this rental
      // Insurance is uploaded before rental creation with a temp customer,
      // so we need to update both customer_id and rental_id
      try {
        // Get pending insurance files from Zustand store (stored during upload)
        const pendingFiles = pendingInsuranceFiles || [];

        // Legacy: Check localStorage for old-style pending docs (for backwards compatibility)
        const pendingDocs = typeof window !== 'undefined'
          ? JSON.parse(localStorage.getItem('pending_insurance_docs') || '[]')
          : [];

        console.log('🔍 Found pending insurance docs:', pendingDocs.length, 'pending files:', pendingFiles.length);

        // Handle old-style pending docs (already created in DB, need linking)
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

          // Clear legacy pending docs from localStorage
          localStorage.removeItem('pending_insurance_docs');
          console.log('✅ Legacy insurance documents linked to rental and cleaned up');
        }

        // Handle new-style pending files (only uploaded to storage, need DB insert)
        if (pendingFiles.length > 0) {
          // Deduplicate files by file_path
          const uniqueFiles = Array.from(
            new Map(pendingFiles.map((file: any) => [file.file_path, file])).values()
          ) as any[];

          console.log(`📎 Processing ${uniqueFiles.length} unique insurance files`);

          for (const fileInfo of uniqueFiles) {
            // Check if a document with the same filename already exists for this customer
            // The unique constraint is on (tenant_id, customer_id, document_type, file_name) where rental_id IS NULL
            const { data: existingDoc } = await supabase
              .from('customer_documents')
              .select('id')
              .eq('customer_id', customer.id)
              .eq('document_type', 'Insurance Certificate')
              .eq('file_name', fileInfo.file_name)
              .is('rental_id', null)
              .maybeSingle();

            let insertedDoc: any = null;
            let docError: any = null;

            if (existingDoc) {
              // Update existing document record (allows re-uploading same document)
              console.log('📎 Updating existing document:', fileInfo.file_name);
              const { data, error } = await supabase
                .from('customer_documents')
                .update({
                  rental_id: rental.id,
                  file_url: fileInfo.file_path,
                  file_size: fileInfo.file_size,
                  mime_type: fileInfo.mime_type,
                  ai_scan_status: 'pending',
                  uploaded_at: fileInfo.uploaded_at,
                  status: 'Pending',
                })
                .eq('id', existingDoc.id)
                .select('id, file_url')
                .single();
              insertedDoc = data;
              docError = error;
            } else {
              // Insert new document record
              const docInsertData: any = {
                customer_id: customer.id,
                rental_id: rental.id,
                document_type: 'Insurance Certificate',
                document_name: fileInfo.file_name,
                file_url: fileInfo.file_path,
                file_name: fileInfo.file_name,
                file_size: fileInfo.file_size,
                mime_type: fileInfo.mime_type,
                ai_scan_status: 'pending',
                uploaded_at: fileInfo.uploaded_at,
                status: 'Pending', // Required field with CHECK constraint
              };

              if (tenant?.id) {
                docInsertData.tenant_id = tenant.id;
              }

              console.log('📎 Inserting document:', JSON.stringify(docInsertData));

              const { data, error } = await supabase
                .from('customer_documents')
                .insert(docInsertData)
                .select('id, file_url')
                .single();
              insertedDoc = data;
              docError = error;
            }

            if (docError) {
              console.error('📎 Failed to link insurance document:', docError?.message || docError?.code || JSON.stringify(docError));
            } else {
              console.log('✅ Insurance document created/updated for customer:', customer.id);

              // Trigger AI scanning
              if (insertedDoc?.id) {
                supabase.functions.invoke('scan-insurance-document', {
                  body: {
                    documentId: insertedDoc.id,
                    fileUrl: insertedDoc.file_url
                  }
                }).then(({ error }) => {
                  if (error) console.error('📎 AI scan failed:', error);
                }).catch(e => console.error('📎 AI scan error:', e));
              }
            }
          }

          // Clear pending files from Zustand store
          clearPendingInsuranceFiles();
          console.log('✅ Insurance files processed and cleaned up');
        }

        if (pendingDocs.length === 0 && pendingFiles.length === 0) {
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

  // Handle payment button click - shows auth dialog if not authenticated
  const handlePayment = async () => {
    if (!agreeTerms) {
      toast.error("You must agree to the terms and conditions");
      return;
    }

    // Prevent double submission
    if (isProcessing) {
      return;
    }

    // If user is not authenticated, show auth dialog first
    if (!customerUser) {
      setShowAuthDialog(true);
      return;
    }

    // User is authenticated, proceed directly to payment
    proceedWithPayment();
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
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column - Summary Cards */}
        <div className="lg:col-span-2 space-y-6">
          {/* Rental Summary Card */}
          <Card className="p-6 bg-card border-accent/20">
            <h3 className="text-lg font-semibold mb-5">Rental Summary</h3>
            <div className="space-y-5">
              {/* Vehicle & Duration */}
              <div className="flex items-start gap-3">
                <Car className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                <div className="flex-1">
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
                <Calendar className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">{rentalDuration.formatted}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(formData.pickupDate), 'MMM dd, yyyy')} - {format(new Date(formData.dropoffDate), 'MMM dd, yyyy')}
                  </p>
                </div>
              </div>

              {/* Pickup → Return Timeline */}
              <div className="relative pl-[11px] ml-[9px] border-l-2 border-dashed border-accent/30">
                {/* Pickup */}
                <div className="relative pb-5">
                  <div className="absolute -left-[18px] top-0 w-3.5 h-3.5 rounded-full bg-accent border-2 border-background" />
                  <div className="pl-5">
                    <p className="text-xs font-medium uppercase tracking-wider text-accent mb-1">Pickup</p>
                    <p className="font-medium text-sm">{formData.pickupLocation}</p>
                    {formData.pickupLocationId && (() => {
                      const loc = allDeliveryLocations.find(l => l.id === formData.pickupLocationId);
                      return loc?.description ? <p className="text-xs text-muted-foreground/70 mt-0.5">{loc.description}</p> : null;
                    })()}
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(formData.pickupDate), 'MMM dd, yyyy')} at {formData.pickupTime}
                    </p>
                  </div>
                </div>
                {/* Return */}
                <div className="relative">
                  <div className="absolute -left-[18px] top-0 w-3.5 h-3.5 rounded-full border-2 border-accent bg-background" />
                  <div className="pl-5">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Return</p>
                    <p className="font-medium text-sm">{formData.dropoffLocation}</p>
                    {formData.returnLocationId && (() => {
                      const loc = allDeliveryLocations.find(l => l.id === formData.returnLocationId);
                      return loc?.description ? <p className="text-xs text-muted-foreground/70 mt-0.5">{loc.description}</p> : null;
                    })()}
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(formData.dropoffDate), 'MMM dd, yyyy')} at {formData.dropoffTime}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Selected Extras Card */}
          {Object.keys(selectedExtras).length > 0 && (
            <Card className="p-6 bg-card border-accent/20">
              <h3 className="text-lg font-semibold mb-4">Selected Extras</h3>
              <div className="space-y-2">
                {Object.entries(selectedExtras).map(([extraId, qty]) => {
                  const extra = extras.find((e: any) => e.id === extraId);
                  if (!extra) return null;
                  return (
                    <div key={extraId} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {extra.name}{qty > 1 ? ` x${qty}` : ''}
                      </span>
                      <span className="font-medium">{fmt(extra.price * qty)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

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
                By confirming, you agree to {tenant?.app_name || tenant?.company_name || "our"}'s{" "}
                <a href="/terms" target="_blank" className="text-accent underline">Terms of Service</a> and{" "}
                <a href="/privacy" target="_blank" className="text-accent underline">Privacy Policy</a>.
              </Label>
            </div>
          </Card>

          {/* Installment Payment Options */}
          {rentalDuration.days >= 7 && (
            <InstallmentSelector
              rentalDays={rentalDuration.days}
              installableAmount={installableAmount}
              upfrontAmount={installUpfrontAmount}
              config={installmentConfig}
              enabled={installmentsEnabled}
              onSelectPlan={setSelectedInstallmentPlan}
              selectedPlan={selectedInstallmentPlan}
              formatCurrency={fmt}
            />
          )}
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
                      <span className="font-medium">{fmt(calculateSecurityDeposit())}</span>
                    </div>
                  )}

                  {/* Total Due Now */}
                  <div className="pt-3 border-t border-accent/30">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-semibold">Total Due Now</span>
                      <span className="text-2xl font-bold text-accent">
                        {fmt(getPayableAmount())}
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
                      {fmt(vehicleTotal)}
                    </span>
                  </div>

                  {/* Promo discount line item - only show when applied */}
                  {promoDetails && calculatePromoDiscount() > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>
                        Promo ({promoDetails.code})
                        <span className="text-xs ml-1">
                          ({promoDetails.type === 'percentage' ? `${promoDetails.value}%` : fmt(promoDetails.value)} off)
                        </span>
                      </span>
                      <span className="font-medium">-{fmt(calculatePromoDiscount())}</span>
                    </div>
                  )}

                  {/* Discounted subtotal - show when promo is applied */}
                  {promoDetails && calculatePromoDiscount() > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-medium text-green-600">{fmt(calculateDiscountedVehicleTotal())}</span>
                    </div>
                  )}

                  {/* Delivery fees - only show when > 0 */}
                  {pickupDeliveryFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Pickup Delivery</span>
                      <span className="font-medium">{fmt(pickupDeliveryFee)}</span>
                    </div>
                  )}
                  {returnDeliveryFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Return Collection</span>
                      <span className="font-medium">{fmt(returnDeliveryFee)}</span>
                    </div>
                  )}

                  {/* Extras line items - show each selected extra */}
                  {Object.entries(selectedExtras).map(([extraId, qty]) => {
                    const extra = extras.find((e: any) => e.id === extraId);
                    if (!extra) return null;
                    return (
                      <div key={extraId} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {extra.name}{qty > 1 ? ` x${qty}` : ''}
                        </span>
                        <span className="font-medium">{fmt(extra.price * qty)}</span>
                      </div>
                    );
                  })}

                  {/* Border separator */}
                  <div className="pb-3 border-b border-border" />

                  {/* Tax line item - only show when tax is enabled */}
                  {tenant?.tax_enabled && (tenant?.tax_percentage ?? 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tax ({tenant.tax_percentage}%)</span>
                      <span className="font-medium">{fmt(calculateTaxAmount())}</span>
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
                      <span className="font-medium">{fmt(calculateServiceFee())}</span>
                    </div>
                  )}

                  {/* Security deposit line item - only show when > 0 */}
                  {calculateSecurityDeposit() > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Security Deposit</span>
                      <span className="font-medium">{fmt(calculateSecurityDeposit())}</span>
                    </div>
                  )}

                  {/* Bonzah Insurance line item - only show when > 0 */}
                  {bonzahPremium > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        Bonzah Insurance
                      </span>
                      <span className="font-medium">{fmt(bonzahPremium)}</span>
                    </div>
                  )}

                  {/* Grand Total - Highlighted Section */}
                  <div className="mt-3 bg-accent/10 border-2 border-accent/30 rounded-lg p-4 -mx-2">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="text-xs text-muted-foreground block">Amount Due</span>
                        <span className="text-lg font-semibold">Grand Total</span>
                      </div>
                      <span className="text-3xl font-bold text-accent">
                        {fmt(calculateGrandTotal())}
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
                    Pay Deposit {fmt(getPayableAmount())}
                  </>
                ) : selectedInstallmentPlan && selectedInstallmentPlan.type !== 'full' && installmentsEnabled ? (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Pay {fmt(selectedInstallmentPlan.upfrontTotal)} & Setup Installments
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Confirm & Pay {fmt(calculateGrandTotal())}
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
          promoDetails={promoDetails}
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
          selectedExtras={Object.entries(selectedExtras).map(([extraId, qty]) => {
            const extra = extras.find((e: any) => e.id === extraId);
            return { name: extra?.name || 'Extra', quantity: qty, price: extra?.price || 0 };
          }).filter(e => e.quantity > 0)}
        />
      )}

      {/* Auth Prompt Dialog - shown before payment for unauthenticated users */}
      <AuthPromptDialog
        open={showAuthDialog}
        onOpenChange={setShowAuthDialog}
        prefillEmail={formData.customerEmail}
        customerName={formData.customerName}
        customerPhone={formData.customerPhone}
        onSkip={() => {
          setShowAuthDialog(false);
          proceedWithPayment();
        }}
        onSuccess={() => {
          setShowAuthDialog(false);
          proceedWithPayment();
        }}
      />

    </div>
  );
}
