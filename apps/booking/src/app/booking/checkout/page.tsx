'use client'

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Check, Shield, CreditCard, Loader2, Truck } from "lucide-react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { z } from "zod";
import BookingConfirmation from "@/components/BookingConfirmation";
import { useTenant } from "@/contexts/TenantContext";
import InstallmentSelector, { InstallmentOption, InstallmentConfig } from "@/components/InstallmentSelector";
import { useBookingStore } from "@/stores/booking-store";
import { formatCurrency as formatCurrencyUtil } from "@/lib/format-utils";
import { useDynamicPricing } from "@/hooks/use-dynamic-pricing";
import { calculateRentalPriceBreakdown, parseDateString } from "@/lib/calculate-rental-price";
import { getUnlimitedMileageOption } from "@/lib/mileage-utils";
import { Infinity as InfinityIcon } from "lucide-react";
const checkoutSchema = z.object({
  customerName: z.string().min(2, "Name must be at least 2 characters"),
  customerEmail: z.string().email("Invalid email address"),
  customerPhone: z.string().min(10, "Phone number must be at least 10 digits"),
  licenseNumber: z.string().min(5, "License number is required"),
  agreeTerms: z.boolean().refine(val => val === true, "You must agree to the Terms & Conditions and Privacy Policy"),
  agreeCharges: z.boolean().refine(val => val === true, "You must authorize post-rental charges")
});

interface DeliveryLocation {
  id: string;
  name: string;
  address: string;
  delivery_fee: number;
  collection_fee: number;
}

interface DeliveryData {
  // New simplified flow
  deliveryOption: 'fixed' | 'location' | 'area' | null;
  selectedLocationId: string | null;
  selectedLocation: DeliveryLocation | null;
  deliveryFee: number;
  // Legacy fields for backward compatibility
  requestDelivery: boolean;
  deliveryLocationId: string | null;
  deliveryLocation: DeliveryLocation | null;
  requestCollection: boolean;
  collectionLocationId: string | null;
  collectionLocation: DeliveryLocation | null;
}

const BookingCheckoutContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { context: bookingContext, pendingInsuranceFiles, clearPendingInsuranceFiles, pendingGigDriverFiles, clearPendingGigDriverFiles } = useBookingStore();
  const [loading, setLoading] = useState(false);
  const submitInFlightRef = useRef(false); // Synchronous re-entrancy lock against double-click duplicate submits
  const [vehicleDetails, setVehicleDetails] = useState<any>(null);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<any>(null);
  const [deliveryData, setDeliveryData] = useState<DeliveryData>({
    deliveryOption: null,
    selectedLocationId: null,
    selectedLocation: null,
    deliveryFee: 0,
    requestDelivery: false,
    deliveryLocationId: null,
    deliveryLocation: null,
    requestCollection: false,
    collectionLocationId: null,
    collectionLocation: null,
  });

  // Dynamic pricing
  const vehicleIdParam = searchParams?.get("vehicle") || "";
  const { holidays, vehicleOverrides, dailyPrices } = useDynamicPricing(vehicleIdParam || undefined);

  // Installment state - read from tenant context
  const [selectedInstallmentPlan, setSelectedInstallmentPlan] = useState<InstallmentOption | null>(null);
  const installmentsEnabled = tenant?.installments_enabled ?? false;
  const installmentConfig: InstallmentConfig = {
    minimum_days_weekly: 7,
    minimum_days_monthly: 30,
    minimum_days_semiweekly: 7,
    weekly_installments_limit: 4,
    monthly_installments_limit: 6,
    semiweekly_installments_limit: 8,
    limiting_amount_per_day_weekly: 0,
    limiting_amount_per_day_monthly: 0,
    limiting_amount_per_day_semiweekly: 0,
    charge_first_upfront: true,
    what_gets_split: 'rental_only',
    grace_period_days: 3,
    max_retry_attempts: 3,
    retry_interval_days: 1,
    ...(tenant?.installment_config || {}),
  };

  const [formData, setFormData] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    licenseNumber: "",
    agreeTerms: false,
    agreeCharges: false
  });

  // Unlimited Mileage upgrade — opt-in at checkout, locked into the rental at booking time.
  // Computed values (option, total) live in calculateCompleteTotal below to avoid TDZ.
  const [addUnlimitedMileage, setAddUnlimitedMileage] = useState(false);

  // Promo code state — read from localStorage (set by MultiStepBookingWidget)
  const [promoDetails, setPromoDetails] = useState<{ code: string; type: 'percentage' | 'fixed_amount'; value: number } | null>(null);
  useEffect(() => {
    try {
      const savedCode = localStorage.getItem('appliedPromoCode');
      const savedDetails = localStorage.getItem('appliedPromoDetails');
      if (savedCode && savedDetails) {
        setPromoDetails(JSON.parse(savedDetails));
      }
    } catch {}
  }, []);

  // Extract booking context
  const pickupDate = searchParams?.get("pickup") || "";
  const returnDate = searchParams?.get("return") || "";
  const pickupLocation = searchParams?.get("pl") || "";
  const returnLocation = searchParams?.get("rl") || "";
  const driverAge = searchParams?.get("age") || "";
  const promoCode = searchParams?.get("promo") || "";
  const vehicleId = searchParams?.get("vehicle") || "";

  useEffect(() => {
    if (!vehicleId || !pickupDate || !returnDate) {
      toast.error("Missing booking details. Redirecting...");
      router.push("/booking");
      return;
    }
    loadData();
  }, []);


  const loadData = async () => {
    try {
      // Load vehicle details (filtered by tenant)
      let vehicleQuery = supabase
        .from("vehicles")
        .select("*")
        .eq("id", vehicleId);

      if (tenant?.id) {
        vehicleQuery = vehicleQuery.eq("tenant_id", tenant.id);
      }

      const { data: vehicle, error: vError } = await vehicleQuery.single();

      if (vError) throw vError;
      setVehicleDetails(vehicle);

      // Load delivery/collection data from Zustand store
      setDeliveryData({
        // New flow fields
        deliveryOption: bookingContext.deliveryOption || null,
        selectedLocationId: bookingContext.selectedLocationId || null,
        selectedLocation: bookingContext.selectedLocation || null,
        deliveryFee: bookingContext.deliveryFee || 0,
        // Legacy fields
        requestDelivery: bookingContext.requestDelivery || false,
        deliveryLocationId: bookingContext.deliveryLocationId || null,
        deliveryLocation: bookingContext.deliveryLocation || null,
        requestCollection: bookingContext.requestCollection || false,
        collectionLocationId: bookingContext.collectionLocationId || null,
        collectionLocation: bookingContext.collectionLocation || null,
      });

    } catch (error: any) {
      toast.error("Failed to load booking details");
      console.error(error);
    }
  };

  const calculateRentalDays = () => {
    // Parse date-only strings as LOCAL dates (parseDateString), not UTC (new Date),
    // so a Denver customer's 4-day rental doesn't slip to 3 days and undercharge.
    const pickup = parseDateString(pickupDate);
    const dropoff = parseDateString(returnDate);
    const diffTime = Math.abs(dropoff.getTime() - pickup.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const calculateVehiclePriceResult = () => {
    if (!vehicleDetails) return { rentalPrice: 0, rentalDays: 0, pricingTier: 'daily' as const, dayBreakdown: [] };
    const weekendConfig = (tenant?.weekend_surcharge_percent && tenant.weekend_surcharge_percent > 0)
      ? { weekend_surcharge_percent: tenant.weekend_surcharge_percent, weekend_days: tenant.weekend_days || [6, 0], stack_surcharges: tenant.stack_surcharges ?? false }
      : null;
    return calculateRentalPriceBreakdown(
      pickupDate,
      returnDate,
      {
        daily_rent: vehicleDetails.daily_rent || 0,
        weekly_rent: vehicleDetails.weekly_rent || 0,
        monthly_rent: vehicleDetails.monthly_rent || 0,
      },
      weekendConfig,
      holidays,
      vehicleOverrides,
      vehicleIdParam,
      tenant?.monthly_tier_days ?? 30,
      false, // skipSurcharges
      false, // stackSurcharges resolved from weekendConfig
      dailyPrices, // Turo-style per-day manual prices
    );
  };

  const calculateVehiclePrice = () => calculateVehiclePriceResult().rentalPrice;

  const calculateTotal = () => {
    return calculateVehiclePrice();
  };

  // Complete total calculation including all fees and promo discount
  const calculateCompleteTotal = () => {
    const vehiclePrice = calculateVehiclePrice();
    const extrasTotal = 0;

    // Promo discount
    let discountAmount = 0;
    if (promoDetails && vehiclePrice > 0) {
      if (promoDetails.type === 'fixed_amount') {
        discountAmount = Math.min(promoDetails.value, vehiclePrice);
      } else if (promoDetails.type === 'percentage') {
        discountAmount = (vehiclePrice * promoDetails.value) / 100;
      }
    }
    const discountedVehiclePrice = vehiclePrice - discountAmount;

    // Delivery fee from new flow (same for delivery and collection)
    let deliveryFee = deliveryData.deliveryFee || 0;

    // Fallback to legacy calculation if deliveryFee not set but legacy fields are
    if (deliveryFee === 0 && deliveryData.requestDelivery && deliveryData.deliveryLocation) {
      deliveryFee = deliveryData.deliveryLocation.delivery_fee || 0;
    }

    const collectionFee = 0;

    // Unlimited mileage upgrade — flat per-tier charge, only counted when the vehicle
    // exposes it for the booking's tier AND the box is ticked.
    const rentalDaysForUnlimited = vehicleDetails ? Math.max(1, calculateRentalDays()) : 0;
    const unlimitedOption = vehicleDetails
      ? getUnlimitedMileageOption(vehicleDetails, rentalDaysForUnlimited, tenant?.monthly_tier_days ?? 30)
      : { available: false, tier: 'daily' as const, flatAmount: 0 };
    const unlimitedMileageEffective = addUnlimitedMileage && unlimitedOption.available;
    const unlimitedMileageTotal = unlimitedMileageEffective ? unlimitedOption.flatAmount : 0;

    const subtotal = discountedVehiclePrice + extrasTotal + deliveryFee + collectionFee + unlimitedMileageTotal;

    // Tax on discounted amount
    const taxPercentage = tenant?.tax_percentage || 0;
    const taxAmount = tenant?.tax_enabled
      ? subtotal * (taxPercentage / 100)
      : 0;

    // Service fee (if enabled)
    const serviceFee = tenant?.service_fee_enabled
      ? (tenant?.service_fee_amount || 0)
      : 0;

    // Security deposit
    const deposit = tenant?.deposit_mode === 'global'
      ? (tenant?.global_deposit_amount || 0)
      : (vehicleDetails?.security_deposit || 0);

    return {
      vehiclePrice,
      discountedVehiclePrice,
      discountAmount,
      extrasTotal,
      deliveryFee,
      collectionFee,
      subtotal,
      taxAmount,
      taxPercentage,
      serviceFee,
      deposit,
      // Unlimited mileage upgrade
      unlimitedMileageAvailable: unlimitedOption.available,
      unlimitedMileageTier: unlimitedOption.tier,
      unlimitedMileageFlat: unlimitedOption.flatAmount,
      unlimitedMileageEffective,
      unlimitedMileageTotal,
      unlimitedMileageDays: rentalDaysForUnlimited,
      grandTotal: subtotal + taxAmount + serviceFee, // Deposit is a hold at pickup, not charged at booking
    };
  };

  const totals = calculateCompleteTotal();

  // Calculate installment breakdown based on what_gets_split setting
  // 'rental_only': Only vehicle price + extras are split
  // 'rental_tax': Vehicle price + extras + tax are split (default)
  // 'rental_tax_extras': Vehicle price + extras + tax + delivery/collection fees are split
  const whatGetsSplit = installmentConfig.what_gets_split || 'rental_only';

  const { upfrontAmount, installableAmount } = (() => {
    // Always upfront: Service Fee (deposit is a hold at pickup, not charged)
    let upfront = totals.serviceFee;
    let installable = 0;

    switch (whatGetsSplit) {
      case 'rental_only':
        // Only rental (vehicle + extras) is split, tax paid upfront
        installable = totals.vehiclePrice + totals.extrasTotal;
        upfront += totals.taxAmount + totals.deliveryFee + totals.collectionFee;
        break;
      case 'rental_tax_extras':
        // Rental + tax + delivery/collection fees are split
        installable = totals.vehiclePrice + totals.extrasTotal + totals.taxAmount + totals.deliveryFee + totals.collectionFee;
        break;
      case 'rental_tax':
      default:
        // Rental + tax is split (delivery/collection paid upfront)
        installable = totals.vehiclePrice + totals.extrasTotal + totals.taxAmount;
        upfront += totals.deliveryFee + totals.collectionFee;
        break;
    }

    return { upfrontAmount: upfront, installableAmount: installable };
  })();

  // Format currency based on tenant settings
  const currencyCode = tenant?.currency_code || 'USD';
  const formatCurrency = (amount: number) => formatCurrencyUtil(amount, currencyCode);

  const validateForm = () => {
    try {
      checkoutSchema.parse(formData);
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: {[key: string]: string} = {};
        error.errors.forEach(err => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleSubmit = async () => {
    // Re-entrancy lock: blocks a double-click from running handleSubmit twice
    // before the `loading` state disables the button.
    if (submitInFlightRef.current) return;
    if (!validateForm()) {
      toast.error("Please fill in all required fields correctly");
      return;
    }

    submitInFlightRef.current = true;
    setLoading(true);
    try {
      // Get customer data from Zustand store (saved in Step 1)
      // Note: bookingContext is already available from useBookingStore hook
      const customerName = (bookingContext as any).customerName;
      const customerEmail = (bookingContext as any).customerEmail;
      const customerPhone = (bookingContext as any).customerPhone;
      // SMS opt-in consent (A2P 10DLC). Only true when the tenant has SMS
      // enabled and the customer ticked the box on the booking form.
      const smsConsent = (bookingContext as any).smsConsent === true;
      const smsConsentAt = smsConsent ? new Date().toISOString() : null;

      if (!customerEmail) {
        throw new Error("Customer information not found. Please restart booking.");
      }

      // Step 1: Create or find customer (filtered by tenant)
      let customer;
      let customerQuery = supabase
        .from("customers")
        .select("*")
        .eq("email", customerEmail);

      if (tenant?.id) {
        customerQuery = customerQuery.eq("tenant_id", tenant.id);
      }

      const { data: existingCustomer, error: findError } = await customerQuery.maybeSingle();

      if (existingCustomer) {
        customer = existingCustomer;
        toast.info("Welcome back! Using your existing account.");

        // Record a freshly given SMS opt-in on the returning customer.
        // Never auto-revoke an existing consent — only upgrade to opted-in.
        if (smsConsent && !(existingCustomer as any).sms_consent) {
          const { data: updatedCustomer } = await supabase
            .from("customers")
            .update({ sms_consent: true, sms_consent_at: smsConsentAt } as any)
            .eq("id", existingCustomer.id)
            .select()
            .single();
          if (updatedCustomer) customer = updatedCustomer;
        }
      } else {
        // Create new customer
        const { data: newCustomer, error: createError } = await supabase
          .from("customers")
          .insert({
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            status: "Active",
            tenant_id: tenant?.id,
            sms_consent: smsConsent,
            sms_consent_at: smsConsentAt,
          } as any)
          .select()
          .single();

        if (createError) throw createError;
        customer = newCustomer;
      }

      // Step 2: Link any pending insurance documents to the customer
      // pendingInsuranceFiles is already available from useBookingStore hook

      // Deduplicate files by file_path to prevent duplicate inserts
      const uniqueFiles = Array.from(
        new Map(pendingInsuranceFiles.map((file: any) => [file.file_path, file])).values()
      ) as any[];

      console.log(`[CHECKOUT] Processing ${uniqueFiles.length} unique insurance documents (${pendingInsuranceFiles.length} total in store)`);

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
          console.log('[CHECKOUT] Updating existing document:', fileInfo.file_name);
          const { data, error } = await supabase
            .from('customer_documents')
            .update({
              file_url: fileInfo.file_path,
              file_size: fileInfo.file_size,
              mime_type: fileInfo.mime_type,
              ai_scan_status: 'pending',
              uploaded_at: fileInfo.uploaded_at
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
            document_type: 'Insurance Certificate',
            document_name: fileInfo.file_name,
            file_url: fileInfo.file_path,
            file_name: fileInfo.file_name,
            file_size: fileInfo.file_size,
            mime_type: fileInfo.mime_type,
            ai_scan_status: 'pending',
            uploaded_at: fileInfo.uploaded_at
          };

          if (tenant?.id) {
            docInsertData.tenant_id = tenant.id;
          }

          const { data, error } = await supabase
            .from('customer_documents')
            .insert(docInsertData)
            .select('id, file_url')
            .single();
          insertedDoc = data;
          docError = error;
        }

        if (docError) {
          console.error('[CHECKOUT] Failed to link insurance document:', docError);
          // Don't throw - continue with booking
        } else {
          console.log('[CHECKOUT] Insurance document linked/updated for customer:', customer.id);

          // Trigger AI scanning for the uploaded document
          if (insertedDoc?.id) {
            try {
              console.log('[CHECKOUT] Triggering AI scan for document:', insertedDoc.id);
              supabase.functions.invoke('scan-insurance-document', {
                body: {
                  documentId: insertedDoc.id,
                  fileUrl: insertedDoc.file_url
                }
              }).then(({ data, error }) => {
                if (error) {
                  console.error('[CHECKOUT] AI scan failed:', error);
                } else {
                  console.log('[CHECKOUT] AI scan completed:', data);
                }
              });
            } catch (scanError) {
              console.error('[CHECKOUT] Failed to trigger AI scan:', scanError);
              // Don't throw - scanning is optional
            }
          }
        }
      }

      // Clear store immediately after processing to prevent duplicates on retry
      clearPendingInsuranceFiles();
      console.log('[CHECKOUT] Cleared pending insurance files from store');

      // Step 2b: Handle gig driver data
      const isGigDriver = (bookingContext as any).isGigDriver === true;
      if (isGigDriver) {
        // Set is_gig_driver on customer
        await supabase
          .from('customers')
          .update({ is_gig_driver: true } as any)
          .eq('id', customer.id);

        // Link pending gig driver images
        const uniqueGigFiles = Array.from(
          new Map(pendingGigDriverFiles.map((file: any) => [file.file_path, file])).values()
        ) as any[];

        console.log(`[CHECKOUT] Processing ${uniqueGigFiles.length} gig driver images`);

        for (const fileInfo of uniqueGigFiles) {
          // Move file from pending/ to proper path
          const finalPath = `${tenant?.id}/${customer.id}/${fileInfo.file_name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
          const { error: moveError } = await supabase.storage
            .from('gig-driver-images')
            .move(fileInfo.file_path, finalPath);

          const imagePath = moveError ? fileInfo.file_path : finalPath;

          // Create DB record
          const { error: imgError } = await (supabase as any)
            .from('gig_driver_images')
            .insert({
              customer_id: customer.id,
              tenant_id: tenant?.id,
              image_url: imagePath,
              file_name: fileInfo.file_name,
              file_size: fileInfo.file_size,
            });

          if (imgError) {
            console.error('[CHECKOUT] Failed to link gig driver image:', imgError);
          } else {
            console.log('[CHECKOUT] Gig driver image linked for customer:', customer.id);
          }
        }

        clearPendingGigDriverFiles();
        console.log('[CHECKOUT] Cleared pending gig driver files from store');
      }

      // Step 3: Check if customer already has active rental
      {
        const { data: activeRentals, error: checkError } = await supabase
          .from("rentals")
          .select("id")
          .eq("customer_id", customer.id)
          .eq("status", "Active");

        if (checkError) throw checkError;
        if (activeRentals && activeRentals.length > 0) {
          throw new Error("You already have an active rental. You can only have one active rental at a time.");
        }
      }

      // Step 3b: Buffer time validation — ensure pickup doesn't fall within buffer period
      {
        const bufferMinutes = tenant?.buffer_time_minutes || 0;
        if (bufferMinutes > 0 && vehicleId && pickupDate) {
          const { data: recentRentals } = await supabase
            .from("rentals")
            .select("end_date, return_time")
            .eq("vehicle_id", vehicleId)
            .in("status", ["Closed", "Active"])
            .order("end_date", { ascending: false })
            .limit(1);

          if (recentRentals && recentRentals.length > 0) {
            const lastRental = recentRentals[0];
            const rentalEnd = new Date(`${lastRental.end_date}T${lastRental.return_time || '23:59'}`);
            const bufferDeadline = new Date(rentalEnd.getTime() + bufferMinutes * 60 * 1000);
            const pickupDateTime = parseDateString(pickupDate);

            if (pickupDateTime < bufferDeadline && pickupDateTime >= rentalEnd) {
              throw new Error(
                `This vehicle has a ${bufferMinutes}-minute buffer period after its last rental. It will be available after ${bufferDeadline.toLocaleString()}.`
              );
            }
          }
        }
      }

      // Step 3c: Vehicle overlap check — must mirror DB trigger check_rental_overlap
      // which blocks any status NOT in Cancelled/Rejected/Closed.
      {
        if (vehicleId && pickupDate && returnDate) {
          const { data: overlapping, error: overlapError } = await supabase
            .from("rentals")
            .select("id")
            .eq("vehicle_id", vehicleId)
            .not("status", "in", "(Cancelled,Rejected,Closed)")
            .lte("start_date", returnDate)
            .or(`end_date.gte.${pickupDate},end_date.is.null`)
            .limit(1);

          if (overlapError) throw overlapError;
          if (overlapping && overlapping.length > 0) {
            throw new Error(
              "This vehicle is no longer available for your selected dates. Another booking was made while you were checking out. Please go back and choose a different vehicle or dates."
            );
          }
        }
      }

      // Step 3d: Manual block check (blocked_dates) — operator marked this vehicle
      // unavailable for the window (e.g. rented out on Turo). Overlap when
      // block.start <= returnDate AND block.end >= pickupDate. A null vehicle_id
      // is a tenant-wide block covering every vehicle.
      if (tenant?.id && vehicleId && pickupDate && returnDate) {
        const { data: blocks, error: blockError } = await supabase
          .from("blocked_dates")
          .select("id")
          .eq("tenant_id", tenant.id)
          .or(`vehicle_id.eq.${vehicleId},vehicle_id.is.null`)
          .lte("start_date", returnDate)
          .gte("end_date", pickupDate)
          .limit(1);

        if (blockError) throw blockError;
        if (blocks && blocks.length > 0) {
          throw new Error(
            "This vehicle is not available for your selected dates. Please go back and choose a different vehicle or dates."
          );
        }
      }

      // Step 3e: Duplicate-request cooldown — block an identical request (same
      // customer + vehicle + dates) submitted within the last 30 minutes. Catches
      // accidental re-submits/refreshes the overlap guard misses once the first
      // request is cancelled/rejected.
      if (tenant?.id && customer?.id && vehicleId && pickupDate && returnDate) {
        const cooldownSince = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data: recentDupes } = await supabase
          .from("rentals")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("customer_id", customer.id)
          .eq("vehicle_id", vehicleId)
          .eq("start_date", pickupDate)
          .eq("end_date", returnDate)
          .gte("created_at", cooldownSince)
          .limit(1);

        if (recentDupes && recentDupes.length > 0) {
          throw new Error(
            "You already submitted this booking request a few minutes ago. Please check your email or contact us instead of submitting again."
          );
        }
      }

      // Step 4: Calculate monthly amount
      const days = calculateRentalDays();
      const monthlyAmount = vehicleDetails.monthly_rent || calculateVehiclePrice();

      // Step 5: Create rental
      // Determine rental period type based on duration
      const mtd = tenant?.monthly_tier_days ?? 30;
      const rentalPeriodType = days >= mtd ? "Monthly" : days >= 7 ? "Weekly" : "Daily";

      // Get current totals for delivery/collection fees
      const currentTotals = calculateCompleteTotal();

      // Snapshot vehicle mileage settings at time of booking (only if vehicle has mileage limits)
      const hasMileageSettings = vehicleDetails.daily_mileage != null ||
        vehicleDetails.weekly_mileage != null ||
        vehicleDetails.monthly_mileage != null ||
        vehicleDetails.excess_mileage_rate != null;

      const mileageOverrides = hasMileageSettings ? {
        daily_mileage_override: vehicleDetails.daily_mileage,
        weekly_mileage_override: vehicleDetails.weekly_mileage,
        monthly_mileage_override: vehicleDetails.monthly_mileage,
        excess_mileage_rate_override: vehicleDetails.excess_mileage_rate,
      } : {};

      const { data: rental, error: rentalError } = await supabase
        .from("rentals")
        .insert({
          customer_id: customer.id,
          vehicle_id: vehicleId,
          start_date: pickupDate,
          end_date: returnDate,
          monthly_amount: monthlyAmount,
          rental_period_type: rentalPeriodType,
          status: "Pending",  // Pending until payment confirmed
          tenant_id: tenant?.id,
          // Delivery data (new simplified flow)
          delivery_option: deliveryData.deliveryOption || 'fixed',
          uses_delivery_service: deliveryData.deliveryOption === 'location' || deliveryData.deliveryOption === 'area',
          pickup_location_id: deliveryData.selectedLocationId || deliveryData.deliveryLocationId || null,
          return_location_id: deliveryData.selectedLocationId || deliveryData.deliveryLocationId || null, // Same location for both
          delivery_location_id: deliveryData.selectedLocationId || deliveryData.deliveryLocationId || null,
          delivery_address: deliveryData.selectedLocation?.address || deliveryData.deliveryLocation?.address || null,
          delivery_fee: currentTotals.deliveryFee,
          collection_location_id: null, // No longer used in new flow
          collection_address: null,
          collection_fee: 0, // Same fee applies for both
          is_gig_driver: isGigDriver,
          // SMS opt-in consent snapshot (A2P 10DLC proof tied to this booking)
          sms_consent: smsConsent,
          sms_consent_at: smsConsentAt,
          // Promo code discount
          promo_code: promoDetails?.code || null,
          discount_applied: currentTotals.discountAmount > 0 ? currentTotals.discountAmount : null,
          // Mileage snapshot from vehicle at time of booking
          ...mileageOverrides,
          // Unlimited mileage upgrade — locked at booking time as a flat per-tier charge
          is_unlimited_mileage: currentTotals.unlimitedMileageEffective,
          unlimited_mileage_tier: currentTotals.unlimitedMileageEffective ? currentTotals.unlimitedMileageTier : null,
          unlimited_mileage_total: currentTotals.unlimitedMileageEffective ? currentTotals.unlimitedMileageTotal : null,
        } as any)
        .select()
        .single();

      if (rentalError) throw rentalError;

      // Step 5b: Insert ledger entry for the unlimited-mileage upgrade so payments and P&L pick it up.
      // Non-fatal — booking completes even if this fails; the rental row still carries the data.
      if (currentTotals.unlimitedMileageEffective && currentTotals.unlimitedMileageTotal > 0) {
        const { error: unlimitedLedgerError } = await supabase.from("ledger_entries").insert({
          customer_id: customer.id,
          rental_id: rental.id,
          vehicle_id: vehicleId,
          tenant_id: tenant?.id,
          entry_date: pickupDate,
          due_date: pickupDate,
          type: "Charge",
          category: "Unlimited Mileage",
          amount: currentTotals.unlimitedMileageTotal,
          remaining_amount: currentTotals.unlimitedMileageTotal,
          reference: `Unlimited mileage (${currentTotals.unlimitedMileageTier} tier): ${formatCurrency(currentTotals.unlimitedMileageTotal)} flat`,
        });
        if (unlimitedLedgerError) {
          console.error("Failed to insert Unlimited Mileage ledger entry:", unlimitedLedgerError);
        }
      }

      // Step 6: Update vehicle status to Rented (filtered by tenant)
      let vehicleUpdateQuery = supabase
        .from("vehicles")
        .update({ status: "Rented" })
        .eq("id", vehicleId);

      if (tenant?.id) {
        vehicleUpdateQuery = vehicleUpdateQuery.eq("tenant_id", tenant.id);
      }

      const { error: vehicleError } = await vehicleUpdateQuery;

      if (vehicleError) {
        console.error("Failed to update vehicle status:", vehicleError);
        // Don't throw - rental is already created
      }

      // Step 7: Generate rental charges (let database triggers handle this)
      await supabase.rpc("backfill_rental_charges_first_month_only").catch(err => {
        console.error("Failed to generate charges:", err);
      });

      // Step 7b: Create invoice (required for payment breakdown to work)
      const vehicleName = vehicleDetails?.name || `${vehicleDetails?.make} ${vehicleDetails?.model}` || "Vehicle";
      const currentTotalsForPayment = calculateCompleteTotal();
      {
        const invoiceNumber = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Date.now().toString(36).toUpperCase()}`;
        const { error: invoiceError } = await supabase.from('invoices').insert({
          rental_id: rental.id,
          customer_id: customer.id,
          vehicle_id: vehicleId,
          invoice_number: invoiceNumber,
          invoice_date: pickupDate,
          due_date: pickupDate,
          subtotal: currentTotalsForPayment.discountedVehiclePrice,
          rental_fee: currentTotalsForPayment.discountedVehiclePrice,
          tax_amount: currentTotalsForPayment.taxAmount,
          service_fee: currentTotalsForPayment.serviceFee,
          security_deposit: 0, // Deposit is a card hold at pickup, not charged at booking
          insurance_premium: 0, // Insurance is handled separately via Bonzah
          delivery_fee: currentTotalsForPayment.deliveryFee,
          extras_total: currentTotalsForPayment.extrasTotal,
          total_amount: currentTotalsForPayment.grandTotal,
          status: 'pending',
          notes: `Booking for ${vehicleName}`,
          tenant_id: tenant?.id,
        });
        if (invoiceError) {
          console.error('Invoice creation failed:', invoiceError);
          throw new Error('Failed to create invoice: ' + invoiceError.message);
        }
      }

      // Step 8: Handle payment based on installment selection

      // Check if installment plan is selected (not "full" payment)
      if (selectedInstallmentPlan && selectedInstallmentPlan.type !== 'full' && installmentsEnabled) {
        console.log("Creating installment checkout for rental:", rental.id);
        console.log("Plan:", selectedInstallmentPlan.type, "Total Installments:", selectedInstallmentPlan.numberOfInstallments);
        console.log("Scheduled Installments:", selectedInstallmentPlan.scheduledInstallments);
        console.log("Upfront Total (deposit + fees + 1st installment):", selectedInstallmentPlan.upfrontTotal);

        // Calculate base upfront (deposit + service fee + delivery/collection)
        const baseUpfront = currentTotalsForPayment.deposit + currentTotalsForPayment.serviceFee +
          (deliveryData.deliveryFee || 0) + (deliveryData.collectionLocation?.collection_fee || 0);

        // Call the installment checkout edge function
        // First installment is paid upfront (if configured), remaining installments are scheduled
        const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke(
          'create-installment-checkout',
          {
            body: {
              rentalId: rental.id,
              customerId: customer.id,
              customerEmail: customerEmail,
              customerName: customerName,
              customerPhone: customerPhone,
              vehicleId: vehicleId,
              vehicleName: vehicleName,
              // Base upfront: deposit + service fee (+ delivery fees if not included in installments)
              baseUpfrontAmount: baseUpfront,
              // First installment amount (paid upfront if charge_first_upfront is true)
              firstInstallmentAmount: selectedInstallmentPlan.firstInstallmentAmount,
              // Total upfront = base + first installment (if applicable)
              upfrontAmount: selectedInstallmentPlan.upfrontTotal,
              // Total installable amount (based on what_gets_split setting)
              installableAmount: selectedInstallmentPlan.totalAmount,
              // Amount per scheduled installment
              installmentAmount: selectedInstallmentPlan.installmentAmount,
              planType: selectedInstallmentPlan.type,
              // Total number of installments
              numberOfInstallments: selectedInstallmentPlan.numberOfInstallments,
              // Number of installments to schedule (excludes first if charged upfront)
              scheduledInstallments: selectedInstallmentPlan.scheduledInstallments,
              pickupDate: pickupDate,
              returnDate: returnDate,
              startDate: pickupDate,
              tenantId: tenant?.id,
              // Pass config settings for storage with the plan
              chargeFirstUpfront: installmentConfig.charge_first_upfront ?? true,
              whatGetsSplit: installmentConfig.what_gets_split ?? 'rental_only',
              gracePeriodDays: installmentConfig.grace_period_days ?? 3,
              maxRetryAttempts: installmentConfig.max_retry_attempts ?? 3,
              retryIntervalDays: installmentConfig.retry_interval_days ?? 1,
            },
          }
        );

        if (checkoutError) {
          console.error("Installment checkout error:", checkoutError);
          throw new Error(checkoutError.message || "Failed to create installment checkout");
        }

        if (checkoutData?.url) {
          // Redirect to Stripe checkout
          toast.success("Redirecting to payment...");
          window.location.href = checkoutData.url;
          return;
        } else {
          throw new Error("No checkout URL returned");
        }
      }

      // Regular flow (full payment or no installments) - show confirmation screen
      setConfirmedBooking({
        pickupLocation,
        dropoffLocation: returnLocation || pickupLocation,
        pickupDate,
        pickupTime: "09:00",
        vehicleName: vehicleName,
        totalPrice: monthlyAmount.toString(),
        customerName,
        customerEmail
      });
      setShowConfirmation(true);

      toast.success("Rental created successfully! Check portal for details.");
    } catch (error: any) {
      console.error("Rental creation error:", error);
      toast.error(error.message || "Failed to create rental");
    } finally {
      setLoading(false);
      submitInFlightRef.current = false;
    }
  };

  if (showConfirmation && confirmedBooking) {
    return (
      <div className="min-h-screen bg-background">
        <SEO
          title="Booking Confirmed | Drive 917"
          description="Your luxury car rental booking has been confirmed"
        />
        <Navigation />
        <div className="pt-24 pb-16 px-4">
          <BookingConfirmation
            bookingDetails={confirmedBooking}
            onClose={() => router.push("/booking")}
          />
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Checkout | Drive 917"
        description="Complete your luxury car rental booking"
      />
      <Navigation />
      
      <div className="pt-24 pb-16 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Progress Bar */}
          <div className="mb-12">
            <div className="flex items-center justify-between max-w-2xl mx-auto mb-8">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center">
                  <Check className="w-4 h-4 text-accent" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Rental Details</span>
              </div>
              <div className="flex-1 h-0.5 bg-accent/30 mx-4" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center">
                  <Check className="w-4 h-4 text-accent" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Vehicle</span>
              </div>
              <div className="flex-1 h-0.5 bg-accent/30 mx-4" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-accent border-2 border-accent flex items-center justify-center text-background font-semibold text-sm">
                  3
                </div>
                <span className="text-sm font-medium">Checkout</span>
              </div>
            </div>
          </div>

          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="mb-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Vehicles
          </Button>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Left Column - Form */}
            <div className="lg:col-span-2 space-y-6">
              {/* Customer Details */}
              <Card className="p-6">
                <h2 className="text-xl font-semibold mb-4">Your Details</h2>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="customerName">Full Name *</Label>
                    <Input
                      id="customerName"
                      value={formData.customerName}
                      onChange={e => setFormData({...formData, customerName: e.target.value})}
                      className={errors.customerName ? "border-destructive" : ""}
                    />
                    {errors.customerName && (
                      <p className="text-xs text-destructive mt-1">{errors.customerName}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="customerEmail">Email Address *</Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      value={formData.customerEmail}
                      onChange={e => setFormData({...formData, customerEmail: e.target.value})}
                      className={errors.customerEmail ? "border-destructive" : ""}
                    />
                    {errors.customerEmail && (
                      <p className="text-xs text-destructive mt-1">{errors.customerEmail}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="customerPhone">Phone Number *</Label>
                    <Input
                      id="customerPhone"
                      type="tel"
                      value={formData.customerPhone}
                      onChange={e => setFormData({...formData, customerPhone: e.target.value})}
                      className={errors.customerPhone ? "border-destructive" : ""}
                    />
                    {errors.customerPhone && (
                      <p className="text-xs text-destructive mt-1">{errors.customerPhone}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="licenseNumber">Driver's License Number *</Label>
                    <Input
                      id="licenseNumber"
                      value={formData.licenseNumber}
                      onChange={e => setFormData({...formData, licenseNumber: e.target.value})}
                      className={errors.licenseNumber ? "border-destructive" : ""}
                    />
                    {errors.licenseNumber && (
                      <p className="text-xs text-destructive mt-1">{errors.licenseNumber}</p>
                    )}
                  </div>

                  <div className="space-y-4 pt-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="checkout-agree-terms"
                        checked={formData.agreeTerms}
                        onCheckedChange={(checked) => setFormData({...formData, agreeTerms: checked as boolean})}
                        className="mt-0.5"
                      />
                      <Label htmlFor="checkout-agree-terms" className="text-sm leading-relaxed cursor-pointer">
                        I agree to the{" "}
                        <a href="/terms" target="_blank" className="text-accent underline">Terms &amp; Conditions</a>
                        {" "}and{" "}
                        <a href="/privacy" target="_blank" className="text-accent underline">Privacy Policy</a>.
                      </Label>
                    </div>
                    {errors.agreeTerms && (
                      <p className="text-xs text-destructive">{errors.agreeTerms}</p>
                    )}
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="checkout-agree-charges"
                        checked={formData.agreeCharges}
                        onCheckedChange={(checked) => setFormData({...formData, agreeCharges: checked as boolean})}
                        className="mt-0.5"
                      />
                      <Label htmlFor="checkout-agree-charges" className="text-sm leading-relaxed cursor-pointer">
                        I authorize <span className="font-semibold">{tenant?.app_name || tenant?.company_name || "the rental company"}</span> to charge my payment method for post-rental charges permitted under the rental agreement, including excess mileage, cleaning, fuel, tolls, damage, late return fees, and other agreed charges.
                      </Label>
                    </div>
                    {errors.agreeCharges && (
                      <p className="text-xs text-destructive">{errors.agreeCharges}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Additional post-rental charges may apply as described in the rental agreement.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Unlimited Mileage Upgrade — only when the vehicle exposes it */}
              {totals.unlimitedMileageAvailable && (
                <Card className="p-6">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 rounded-md bg-accent/10 p-2">
                      <InfinityIcon className="w-5 h-5 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold">Unlimited Mileage</h2>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Drive as far as you'd like — no per-day limit, no excess charges.
                          </p>
                        </div>
                        <Checkbox
                          id="checkout-unlimited-mileage"
                          checked={addUnlimitedMileage}
                          onCheckedChange={(checked) => setAddUnlimitedMileage(checked === true)}
                          className="mt-1"
                        />
                      </div>
                      <div className="mt-3 flex items-baseline justify-between text-sm">
                        <span className="text-muted-foreground capitalize">
                          {totals.unlimitedMileageTier} tier · flat charge
                        </span>
                        <span className="font-semibold">
                          {addUnlimitedMileage
                            ? `+${formatCurrency(totals.unlimitedMileageTotal)}`
                            : formatCurrency(totals.unlimitedMileageFlat)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {/* Installment Payment Options */}
              {calculateRentalDays() >= Math.min(installmentConfig.minimum_days_weekly ?? installmentConfig.min_days_for_weekly ?? 7, installmentConfig.minimum_days_monthly ?? installmentConfig.min_days_for_monthly ?? 30) && (
                <InstallmentSelector
                  rentalDays={calculateRentalDays()}
                  installableAmount={installableAmount}
                  upfrontAmount={upfrontAmount}
                  totalBill={installableAmount + upfrontAmount}
                  config={installmentConfig}
                  enabled={installmentsEnabled}
                  onSelectPlan={setSelectedInstallmentPlan}
                  selectedPlan={selectedInstallmentPlan}
                  formatCurrency={formatCurrency}
                />
              )}
            </div>

            {/* Right Column - Summary */}
            <div className="lg:col-span-1">
              <Card className="p-6 sticky top-24">
                <h3 className="text-lg font-semibold mb-4">Booking Summary</h3>

                {vehicleDetails && (
                  <div className="space-y-3 pb-4 border-b border-border">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Vehicle</span>
                      <span className="font-medium">{vehicleDetails.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium">{calculateRentalDays()} days</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Vehicle Cost</span>
                        <span className="font-medium">{formatCurrency(totals.vehiclePrice)}</span>
                      </div>
                      {(() => {
                        const days = calculateRentalDays();
                        const dailyRent = vehicleDetails.daily_rent || 0;
                        const weeklyRent = vehicleDetails.weekly_rent || 0;
                        const monthlyRent = vehicleDetails.monthly_rent || 0;
                        const priceResult = calculateVehiclePriceResult();
                        const hasDynamicPricing = priceResult.dayBreakdown.length > 0 &&
                          priceResult.dayBreakdown.some(d => d.type !== 'regular');

                        if (hasDynamicPricing) {
                          // Group days by rate type for cleaner display
                          const groups: { type: string; rate: number; count: number; label: string }[] = [];
                          for (const day of priceResult.dayBreakdown) {
                            const last = groups[groups.length - 1];
                            if (last && last.rate === day.effectiveRate && last.type === day.type) {
                              last.count++;
                            } else {
                              const label = (day.appliedSurcharges && day.appliedSurcharges.length > 1)
                                ? day.appliedSurcharges.map(s => s.label).join(' + ')
                                : day.type === 'manual' ? 'Custom price'
                                : day.type === 'holiday' ? (day.holidayName || 'Holiday')
                                : day.type === 'weekend' ? 'Weekend' : 'Weekday';
                              groups.push({ type: day.type, rate: day.effectiveRate, count: 1, label });
                            }
                          }
                          return groups.map((group, i) => (
                            <div key={i} className="flex justify-between text-xs text-muted-foreground/70 pl-1">
                              <span>{group.label} — {formatCurrency(group.rate)}/day × {group.count} day{group.count !== 1 ? 's' : ''}</span>
                              <span>{formatCurrency(group.rate * group.count)}</span>
                            </div>
                          ));
                        }

                        let unitRate = 0;
                        let unitLabel = '';
                        let quantityLabel = '';
                        const _mtd = tenant?.monthly_tier_days ?? 30;
                        if (days >= _mtd && monthlyRent > 0) {
                          unitRate = monthlyRent;
                          unitLabel = '/mo';
                          const months = days / _mtd;
                          quantityLabel = months === Math.floor(months)
                            ? `${Math.floor(months)} month${Math.floor(months) !== 1 ? 's' : ''}`
                            : `${days} days`;
                        } else if (days >= 7 && days < _mtd && weeklyRent > 0) {
                          unitRate = weeklyRent;
                          unitLabel = '/wk';
                          const weeks = days / 7;
                          quantityLabel = weeks === Math.floor(weeks)
                            ? `${Math.floor(weeks)} week${Math.floor(weeks) !== 1 ? 's' : ''}`
                            : `${days} days`;
                        } else {
                          unitRate = dailyRent;
                          unitLabel = '/day';
                          quantityLabel = `${days} day${days !== 1 ? 's' : ''}`;
                        }
                        if (unitRate <= 0) return null;
                        return (
                          <div className="text-xs text-muted-foreground/70 pl-1">
                            {formatCurrency(unitRate)}{unitLabel} × {quantityLabel}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* Delivery Section */}
                {totals.deliveryFee > 0 && (
                  <div className="space-y-2 py-4 border-b border-border">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Truck className="w-4 h-4 text-accent" />
                      Delivery Service
                    </p>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {deliveryData.deliveryOption === 'location' && deliveryData.selectedLocation
                          ? `Delivery to: ${deliveryData.selectedLocation.name}`
                          : deliveryData.deliveryOption === 'area'
                          ? 'Area Delivery'
                          : deliveryData.deliveryLocation?.name
                          ? `Delivery to: ${deliveryData.deliveryLocation.name}`
                          : 'Delivery Fee'}
                      </span>
                      <span className="font-medium">+{formatCurrency(totals.deliveryFee)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Same fee applies for both delivery and collection
                    </p>
                  </div>
                )}

                {/* Unlimited Mileage Upgrade */}
                {totals.unlimitedMileageEffective && (
                  <div className="space-y-1 py-4 border-b border-border">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <InfinityIcon className="w-4 h-4 text-accent" />
                      Unlimited Mileage
                    </p>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground capitalize">
                        {totals.unlimitedMileageTier} tier · flat charge
                      </span>
                      <span className="font-medium">+{formatCurrency(totals.unlimitedMileageTotal)}</span>
                    </div>
                  </div>
                )}

                {/* Subtotal */}
                <div className="py-4 border-b border-border">
                  <div className="flex justify-between text-sm font-medium">
                    <span>Subtotal</span>
                    <span>{formatCurrency(totals.subtotal)}</span>
                  </div>
                </div>

                {/* Tax, Service Fee, Deposit */}
                <div className="space-y-2 py-4 border-b border-border">
                  {totals.taxAmount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tax ({totals.taxPercentage}%)</span>
                      <span className="font-medium">+{formatCurrency(totals.taxAmount)}</span>
                    </div>
                  )}
                  {totals.serviceFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Service Fee</span>
                      <span className="font-medium">+{formatCurrency(totals.serviceFee)}</span>
                    </div>
                  )}
                  {/* Pre-Authorization is shown separately below the Grand Total
                      (refundable card-validation hold, not part of the total). For the
                      installment plan it is instead folded into "Pay Today" below. */}
                </div>

                <div className="pt-4 space-y-4">
                  {/* Grand Total - Highlighted Section */}
                  <div className="bg-accent/10 border-2 border-accent/30 rounded-lg p-4 -mx-2">
                    {selectedInstallmentPlan && selectedInstallmentPlan.type !== 'full' ? (
                      <>
                        <div className="flex justify-between items-center mb-3">
                          <div>
                            <span className="text-sm text-muted-foreground block">Pay Today</span>
                            <span className="text-lg font-semibold">Pre-Auth + Fees + 1st Installment</span>
                          </div>
                          <span className="text-2xl font-bold text-accent">{formatCurrency(selectedInstallmentPlan.upfrontTotal)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mb-3 -mt-1">
                          Includes: Pre-Auth ({formatCurrency(totals.deposit)}) + Fees ({formatCurrency(totals.serviceFee + totals.deliveryFee + totals.collectionFee)}) + 1st installment ({formatCurrency(selectedInstallmentPlan.firstInstallmentAmount)})
                        </div>
                        <div className="border-t border-accent/20 pt-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              Then {selectedInstallmentPlan.scheduledInstallments} {selectedInstallmentPlan.type} payments of
                            </span>
                            <span className="font-medium">{formatCurrency(selectedInstallmentPlan.installmentAmount)}</span>
                          </div>
                          <div className="flex justify-between text-sm mt-1">
                            <span className="text-muted-foreground">Total Contract Value</span>
                            <span className="font-medium">{formatCurrency(totals.grandTotal)}</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-sm text-muted-foreground block">Total Amount Due</span>
                          <span className="text-lg font-semibold">Grand Total</span>
                        </div>
                        <span className="text-3xl font-bold text-accent">{formatCurrency(totals.grandTotal)}</span>
                      </div>
                    )}
                  </div>

                  {/* Pre-Authorization — separate refundable hold shown BELOW the total.
                      Full-payment only; for installments it is already part of "Pay Today". */}
                  {(!selectedInstallmentPlan || selectedInstallmentPlan.type === 'full') && totals.deposit > 0 && (
                    <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="font-medium">Pre-Authorization hold</span>
                        <span className="font-semibold">{formatCurrency(totals.deposit)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        A temporary hold placed on your card to verify it — released after your rental. This is not part of your total.
                      </p>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleSubmit}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : selectedInstallmentPlan && selectedInstallmentPlan.type !== 'full' ? (
                      <>
                        <CreditCard className="w-4 h-4 mr-2" />
                        Pay {formatCurrency(selectedInstallmentPlan.upfrontTotal)} & Setup Installments
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Complete Booking
                      </>
                    )}
                  </Button>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Shield className="w-4 h-4" />
                    <span>Secure booking system</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};
const BookingCheckout = () => {
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
      <BookingCheckoutContent />
    </Suspense>
  );
};

export default BookingCheckout;
