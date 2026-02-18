"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { addMonths, addDays, addWeeks, isAfter, isBefore, subYears, startOfDay, format, differenceInDays, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, FileText, Save, AlertTriangle, MapPin, Clock, Shield, Upload, CheckCircle2, XCircle, Loader2, RefreshCw, QrCode, Smartphone, Copy, Check, Plus, Minus, Receipt, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";
import BonzahInsuranceSelector from "@/components/rentals/bonzah-insurance-selector";
import type { CoverageOptions } from "@/hooks/use-bonzah-premium";
import { useBonzahBalance } from "@/hooks/use-bonzah-balance";
import { useCustomerActiveRentals } from "@/hooks/use-customer-active-rentals";
import { PAYMENT_TYPES } from "@/constants";
import { ContractSummary } from "@/components/rentals/contract-summary";
import { DatePickerInput } from "@/components/shared/forms/date-picker-input";
import { CurrencyInput } from "@/components/shared/forms/currency-input";
import { InvoiceDialog } from "@/components/shared/dialogs/invoice-dialog";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { createInvoice, Invoice } from "@/lib/invoice-utils";
import { sendBookingNotification, sendPaymentVerificationNotification } from "@/lib/notifications";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useBlockedDates } from "@/hooks/use-blocked-dates";
import { InsuranceUploadDialog } from "@/components/shared/dialogs/insurance-upload-dialog";
import { LocationPicker } from "@/components/ui/location-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { TimePicker } from "@/components/ui/time-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast as sonnerToast } from "sonner";
import { useRentalExtras, type RentalExtra } from "@/hooks/use-rental-extras";
import { formatCurrency } from "@/lib/format-utils";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useWeekendPricing } from "@/hooks/use-weekend-pricing";
import { useTenantHolidays } from "@/hooks/use-tenant-holidays";
import { useVehiclePricingOverrides } from "@/hooks/use-vehicle-pricing-overrides";

const rentalSchema = z.object({
  customer_id: z.string().min(1, "Customer is required"),
  vehicle_id: z.string().min(1, "Vehicle is required"),
  start_date: z.date(),
  end_date: z.date(),
  rental_period_type: z.enum(["Daily", "Weekly", "Monthly"]),
  monthly_amount: z.coerce.number().min(1, "Rental amount must be at least 1"),
  // New booking-aligned fields
  pickup_location: z.string().optional(),
  return_location: z.string().optional(),
  pickup_time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format").optional().or(z.literal("")),
  return_time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format").optional().or(z.literal("")),
  driver_age_range: z.enum(["under_25", "25_70", "over_70"]).optional(),
  promo_code: z.string().optional(),
  insurance_status: z.enum(["pending", "uploaded", "verified", "bonzah", "not_required"]).optional(),
  notes: z.string().optional(),
}).refine((data) => {
  let minEndDate: Date;

  // Calculate minimum end date based on rental period type
  switch (data.rental_period_type) {
    case "Daily":
      minEndDate = addDays(data.start_date, 1);
      break;
    case "Weekly":
      minEndDate = addWeeks(data.start_date, 1);
      break;
    case "Monthly":
    default:
      minEndDate = addMonths(data.start_date, 1);
      break;
  }

  return isAfter(data.end_date, minEndDate) || data.end_date.getTime() === minEndDate.getTime();
}, {
  message: "End date must be at least the minimum rental period after start date",
  path: ["end_date"],
});

type RentalFormData = z.infer<typeof rentalSchema>;

const CreateRental = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const renewFromId = searchParams?.get("renew_from");
  const { toast } = useToast();
  const { tenant } = useTenant();
  const skipInsurance = !tenant?.integration_bonzah;
  const { balanceNumber: bonzahCdBalance } = useBonzahBalance();
  const queryClient = useQueryClient();
  const { isManager, canEdit } = useManagerPermissions();
  const [loading, setLoading] = useState(false);

  // Bonzah insurance state
  const [bonzahCoverage, setBonzahCoverage] = useState<CoverageOptions>({
    cdw: false, rcli: false, sli: false, pai: false,
  });
  const [bonzahPremium, setBonzahPremium] = useState<number>(0);
  const [submitError, setSubmitError] = useState<string>("");
  const [showDocuSignDialog, setShowDocuSignDialog] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [createdRentalData, setCreatedRentalData] = useState<any>(null);
  const [generatedInvoice, setGeneratedInvoice] = useState<Invoice | null>(null);
  const [sendingDocuSign, setSendingDocuSign] = useState(false);

  // Extras state
  const { activeExtras } = useRentalExtras();
  const [selectedExtras, setSelectedExtras] = useState<Record<string, number>>({});

  // Promo code state
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoDetails, setPromoDetails] = useState<{
    code: string;
    type: 'percentage' | 'fixed_amount';
    value: number;
    id: string;
  } | null>(null);

  // Verification state
  const [creatingVerification, setCreatingVerification] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [aiSessionData, setAiSessionData] = useState<{ sessionId: string; qrUrl: string; expiresAt: Date } | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Get payment mode from org settings
  const { settings: orgSettings } = useOrgSettings();
  const isManualPaymentMode = orgSettings?.payment_mode === 'manual';

  // Get rental settings for tax configuration
  const { settings: rentalSettings } = useRentalSettings();

  // Dynamic pricing hooks
  const { settings: weekendPricingSettings } = useWeekendPricing();
  const { holidays: tenantHolidays } = useTenantHolidays();

  // Tax calculation helper
  const calculateTaxAmount = (amount: number): number => {
    if (!rentalSettings?.tax_enabled || !rentalSettings?.tax_percentage) {
      return 0;
    }
    return amount * (rentalSettings.tax_percentage / 100);
  };

  // Service fee calculation helper
  const calculateServiceFee = (): number => {
    if (!rentalSettings?.service_fee_enabled || !rentalSettings?.service_fee_amount) {
      return 0;
    }
    return rentalSettings.service_fee_amount;
  };

  // Security deposit calculation helper
  const calculateSecurityDeposit = (vehicleId?: string): number => {
    if (rentalSettings?.deposit_mode === 'per_vehicle' && vehicleId) {
      // Per-vehicle deposit mode: get deposit from the selected vehicle
      const vehicle = vehicles?.find(v => v.id === vehicleId);
      return (vehicle as any)?.security_deposit ?? 0;
    }
    // Global deposit mode
    return rentalSettings?.global_deposit_amount ?? 0;
  };

  // Promo code validation function
  const validatePromoCode = async (code: string) => {
    if (!code || !tenant?.id) return;

    setPromoLoading(true);
    setPromoError(null);
    setPromoDetails(null);

    try {
      // Use type assertion since promocodes table may not be in generated types
      const { data, error } = await (supabase as any)
        .from('promocodes')
        .select('*')
        .eq('code', code.trim())
        .eq('tenant_id', tenant.id)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setPromoError("Invalid promo code");
        return;
      }

      // Check expiry
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        setPromoError("Promo code has expired");
        return;
      }

      setPromoDetails({
        code: data.code,
        type: data.type === 'value' ? 'fixed_amount' : 'percentage',
        value: data.value,
        id: data.id
      });
      toast({
        title: "Promo code applied!",
        description: data.type === 'percentage'
          ? `${data.value}% discount will be applied`
          : `${formatCurrency(data.value, tenant?.currency_code || 'GBP')} discount will be applied`,
      });

    } catch (err) {
      console.error("Promo validation error:", err);
      setPromoError("Failed to validate promo code");
    } finally {
      setPromoLoading(false);
    }
  };

  // Calculate discount amount based on promo details
  const calculateDiscount = (rentalAmount: number): number => {
    if (!promoDetails) return 0;

    if (promoDetails.type === 'fixed_amount') {
      // Fixed amount discount - only apply if rental price > discount value
      return rentalAmount > promoDetails.value ? promoDetails.value : 0;
    } else {
      // Percentage discount
      return (rentalAmount * promoDetails.value) / 100;
    }
  };

  // Get all blocked dates (global and vehicle-specific)
  const { blockedDates } = useBlockedDates();

  // Helper to parse YYYY-MM-DD to local date at midnight (avoids UTC timezone issues)
  const parseLocalDate = (dateStr: string): Date => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  // Helper to normalize a Date to midnight local time for comparison
  const normalizeDate = (date: Date): Date => {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  };

  // Helper function to check if rental dates overlap with blocked dates
  const checkBlockedDatesOverlap = (startDate: Date, endDate: Date, vehicleId: string): { blocked: boolean; reason?: string; isGlobal?: boolean } => {
    if (!blockedDates || blockedDates.length === 0) return { blocked: false };

    // Normalize input dates to midnight for proper comparison
    const normalizedStart = normalizeDate(startDate);
    const normalizedEnd = normalizeDate(endDate);

    for (const block of blockedDates) {
      const blockStart = parseLocalDate(block.start_date);
      const blockEnd = parseLocalDate(block.end_date);

      // Check if there's any overlap
      const hasOverlap = normalizedStart <= blockEnd && normalizedEnd >= blockStart;

      if (hasOverlap) {
        const isGlobal = !block.vehicle_id;
        const isVehicleSpecific = block.vehicle_id === vehicleId;

        // Block if it's a global block OR if it's for this specific vehicle
        if (isGlobal || isVehicleSpecific) {
          console.log(`[BlockedDates] Rental blocked: ${startDate.toISOString()} - ${endDate.toISOString()} overlaps with ${block.start_date} - ${block.end_date} (vehicle: ${block.vehicle_id || 'global'})`);
          return {
            blocked: true,
            reason: block.reason || (isGlobal ? "General blocked period" : "Vehicle maintenance/blocked"),
            isGlobal
          };
        }
      }
    }

    return { blocked: false };
  };

  // Get dates to disable in calendar (global blocks only)
  const getGlobalBlockedDates = (): Date[] => {
    if (!blockedDates) return [];

    const dates: Date[] = [];
    const globalBlocks = blockedDates.filter(b => !b.vehicle_id);

    for (const block of globalBlocks) {
      const start = parseLocalDate(block.start_date);
      const end = parseLocalDate(block.end_date);
      const current = new Date(start);

      while (current <= end) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
    }

    return dates;
  };

  const globalBlockedDatesArray = getGlobalBlockedDates();

  // Get vehicle-specific blocked dates for a given vehicle
  const getVehicleBlockedDates = (vehicleId: string): Date[] => {
    if (!blockedDates || !vehicleId) return [];

    const dates: Date[] = [];
    const vehicleBlocks = blockedDates.filter(b => b.vehicle_id === vehicleId);

    for (const block of vehicleBlocks) {
      const start = parseLocalDate(block.start_date);
      const end = parseLocalDate(block.end_date);
      const current = new Date(start);

      while (current <= end) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
    }

    return dates;
  };

  const today = new Date();
  const todayAtMidnight = startOfDay(today);
  const defaultEndDate = addMonths(today, 1); // 1 month from today (matches default Monthly period)

  const form = useForm<RentalFormData>({
    resolver: zodResolver(rentalSchema),
    defaultValues: {
      customer_id: "",
      vehicle_id: "",
      start_date: today,
      end_date: defaultEndDate,
      rental_period_type: "Monthly",
      monthly_amount: undefined,
      // New booking-aligned fields
      pickup_location: "",
      return_location: "",
      pickup_time: "",
      return_time: "",
      driver_age_range: undefined,
      promo_code: "",
      insurance_status: "pending",
      notes: "",
    },
    mode: "onChange", // Validate on change for real-time feedback
  });

  // Insurance document state
  const [insuranceDocId, setInsuranceDocId] = useState<string | null>(null);
  const [showInsuranceUpload, setShowInsuranceUpload] = useState(false);
  const [sameAsPickup, setSameAsPickup] = useState(true);

  // Location ID states for 'multiple' location mode
  const [pickupLocationId, setPickupLocationId] = useState<string | undefined>(undefined);
  const [returnLocationId, setReturnLocationId] = useState<string | undefined>(undefined);

  // Watch specific form values for live updates - watching individual fields prevents infinite loops
  // Using form.watch() without arguments returns a new object on every render, causing infinite loops
  const selectedCustomerId = form.watch("customer_id");
  const selectedVehicleId = form.watch("vehicle_id");
  const watchedStartDate = form.watch("start_date");
  const watchedEndDate = form.watch("end_date");
  const watchedRentalPeriodType = form.watch("rental_period_type");
  const watchedMonthlyAmount = form.watch("monthly_amount");
  const watchedPickupLocation = form.watch("pickup_location");
  const watchedPromoCode = form.watch("promo_code");
  const watchedInsuranceStatus = form.watch("insurance_status");
  const watchedDriverAgeRange = form.watch("driver_age_range");

  // Dynamic pricing: vehicle-specific overrides
  const { overrides: vehiclePricingOverrides } = useVehiclePricingOverrides(selectedVehicleId || undefined);

  // Fetch source rental for renewal
  const { data: renewalSource } = useQuery({
    queryKey: ["renewal-source", renewFromId, tenant?.id],
    queryFn: async () => {
      if (!renewFromId || !tenant?.id) return null;
      const { data, error } = await supabase
        .from("rentals")
        .select(`
          id, customer_id, vehicle_id, start_date, end_date,
          rental_period_type, monthly_amount,
          pickup_location, return_location, pickup_time, return_time,
          customers!rentals_customer_id_fkey(id, name),
          vehicles!rentals_vehicle_id_fkey(id, reg, make, model, status)
        `)
        .eq("id", renewFromId)
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (error || !data) return null;
      return data as any;
    },
    enabled: !!renewFromId && !!tenant?.id,
  });

  // Pre-fill form when renewal source loads
  const renewalAppliedRef = useRef(false);
  useEffect(() => {
    if (!renewalSource || renewalAppliedRef.current) return;
    renewalAppliedRef.current = true;

    const sourceDuration = differenceInDays(
      parseISO(renewalSource.end_date),
      parseISO(renewalSource.start_date)
    );
    const sourceEndDate = parseISO(renewalSource.end_date);
    const newStart = sourceEndDate > today ? addDays(sourceEndDate, 1) : today;
    const newEnd = addDays(newStart, sourceDuration);

    form.setValue("customer_id", renewalSource.customer_id || "");
    // Only pre-fill vehicle if still available
    if (renewalSource.vehicles?.status === "Available") {
      form.setValue("vehicle_id", renewalSource.vehicle_id || "");
    }
    form.setValue("start_date", newStart);
    form.setValue("end_date", newEnd);
    form.setValue("rental_period_type", renewalSource.rental_period_type || "Monthly");
    form.setValue("monthly_amount", renewalSource.monthly_amount);
    form.setValue("pickup_location", renewalSource.pickup_location || "");
    form.setValue("return_location", renewalSource.return_location || "");
    form.setValue("pickup_time", renewalSource.pickup_time || "");
    form.setValue("return_time", renewalSource.return_time || "");
    form.setValue("insurance_status", "pending");

    // If source had different pickup/return, uncheck sameAsPickup
    if (renewalSource.pickup_location && renewalSource.return_location &&
        renewalSource.pickup_location !== renewalSource.return_location) {
      setSameAsPickup(false);
    }
  }, [renewalSource]);

  // Get customers and available vehicles
  const { data: customers } = useQuery({
    queryKey: ["customers-for-rental", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("customers")
        .select("id, name, customer_type, email, phone")
        .eq("status", "Active");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!tenant,
  });

  // Get active rentals count for selected customer to enforce rules
  const { data: activeRentalsCount } = useCustomerActiveRentals(selectedCustomerId);

  // Get customer details including DOB for verification
  const { data: customerDetails } = useQuery({
    queryKey: ["customer-details-for-rental", tenant?.id, selectedCustomerId],
    queryFn: async () => {
      if (!selectedCustomerId || !tenant?.id) return null;
      const { data, error } = await (supabase as any)
        .from("customers")
        .select("id, name, email, phone, date_of_birth, identity_verification_status, address_street, address_city, address_state, address_zip, license_number, license_state")
        .eq("id", selectedCustomerId)
        .eq("tenant_id", tenant.id)
        .single();
      if (error) throw error;
      return data as { id: string; name: string; email?: string; phone?: string; date_of_birth?: string; identity_verification_status?: string; address_street?: string; address_city?: string; address_state?: string; address_zip?: string; license_number?: string; license_state?: string } | null;
    },
    enabled: !!selectedCustomerId && !!tenant?.id,
  });

  // Get customer's latest verification status
  const { data: customerVerification, refetch: refetchVerification } = useQuery({
    queryKey: ["customer-verification-for-rental", tenant?.id, selectedCustomerId],
    queryFn: async () => {
      if (!selectedCustomerId || !tenant?.id) return null;
      const { data, error } = await supabase
        .from("identity_verifications")
        .select("id, status, review_result, review_status, first_name, last_name, document_number, verification_provider, created_at")
        .eq("customer_id", selectedCustomerId)
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!selectedCustomerId && !!tenant?.id,
  });

  // Derive verification state
  const isCustomerVerified = customerVerification?.review_result === "GREEN";
  const verificationPending = customerVerification?.status === "pending" || customerVerification?.review_status === "pending";
  const verificationMode = tenant?.integration_veriff !== false ? "veriff" : "ai";

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles-for-rental", tenant?.id],
    queryFn: async () => {
      let query = (supabase as any)
        .from("vehicles")
        .select("id, reg, make, model, daily_rent, weekly_rent, monthly_rent, security_deposit")
        .eq("status", "Available");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!tenant,
  });

  // Auto-populate rental amount based on selected vehicle and period type
  // For Daily rentals with dates, applies dynamic pricing (weekend/holiday surcharges)
  useEffect(() => {
    if (selectedVehicleId && vehicles) {
      const vehicle = vehicles.find(v => v.id === selectedVehicleId);
      if (vehicle) {
        const periodType = watchedRentalPeriodType || "Monthly";
        let amount: number | undefined;

        if (periodType === "Daily" && vehicle.daily_rent) {
          // Apply dynamic pricing for daily rentals when dates are available
          if (watchedStartDate && watchedEndDate) {
            const startStr = format(watchedStartDate, 'yyyy-MM-dd');
            const endStr = format(watchedEndDate, 'yyyy-MM-dd');
            const days = Math.max(1, differenceInDays(watchedEndDate, watchedStartDate));
            const baseDaily = vehicle.daily_rent;

            // Only apply dynamic pricing for < 7 days (daily tier)
            if (days < 7) {
              const weekendConfig = weekendPricingSettings.weekend_surcharge_percent > 0
                ? weekendPricingSettings : null;
              let total = 0;

              for (let i = 0; i < days; i++) {
                const currentDate = addDays(watchedStartDate, i);
                const dayOfWeek = currentDate.getDay();
                let dayRate = baseDaily;

                // 1. Check holiday match (priority over weekend)
                const holiday = tenantHolidays.find(h => {
                  const dateStr = format(currentDate, 'yyyy-MM-dd');
                  if (h.excluded_vehicle_ids?.includes(selectedVehicleId)) return false;
                  if (h.recurs_annually) {
                    const hStart = new Date(h.start_date + 'T00:00:00');
                    const hEnd = new Date(h.end_date + 'T00:00:00');
                    const m = currentDate.getMonth(), d = currentDate.getDate();
                    return (m === hStart.getMonth() && d >= hStart.getDate() && (hStart.getMonth() === hEnd.getMonth() ? d <= hEnd.getDate() : true))
                      || (m === hEnd.getMonth() && d <= hEnd.getDate() && hStart.getMonth() !== hEnd.getMonth())
                      || (m > hStart.getMonth() && m < hEnd.getMonth());
                  }
                  return dateStr >= h.start_date && dateStr <= h.end_date;
                });

                if (holiday) {
                  const override = vehiclePricingOverrides.find(
                    o => o.rule_type === 'holiday' && o.holiday_id === holiday.id
                  );
                  if (override?.override_type === 'excluded') {
                    dayRate = baseDaily;
                  } else if (override?.override_type === 'fixed_price' && override.fixed_price != null) {
                    dayRate = override.fixed_price;
                  } else if (override?.override_type === 'custom_percent' && override.custom_percent != null) {
                    dayRate = baseDaily * (1 + override.custom_percent / 100);
                  } else {
                    dayRate = baseDaily * (1 + holiday.surcharge_percent / 100);
                  }
                } else if (weekendConfig && weekendConfig.weekend_days?.includes(dayOfWeek)) {
                  // 2. Weekend match
                  const override = vehiclePricingOverrides.find(o => o.rule_type === 'weekend');
                  if (override?.override_type === 'excluded') {
                    dayRate = baseDaily;
                  } else if (override?.override_type === 'fixed_price' && override.fixed_price != null) {
                    dayRate = override.fixed_price;
                  } else if (override?.override_type === 'custom_percent' && override.custom_percent != null) {
                    dayRate = baseDaily * (1 + override.custom_percent / 100);
                  } else {
                    dayRate = baseDaily * (1 + weekendConfig.weekend_surcharge_percent / 100);
                  }
                }

                total += dayRate;
              }
              amount = Math.round(total * 100) / 100;
            } else {
              amount = vehicle.daily_rent;
            }
          } else {
            amount = vehicle.daily_rent;
          }
        } else if (periodType === "Weekly" && vehicle.weekly_rent) {
          amount = vehicle.weekly_rent;
        } else if (periodType === "Monthly" && vehicle.monthly_rent) {
          amount = vehicle.monthly_rent;
        }

        if (amount !== undefined && amount !== watchedMonthlyAmount) {
          form.setValue("monthly_amount", amount);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId, watchedRentalPeriodType, watchedStartDate?.getTime(), watchedEndDate?.getTime(), vehicles, weekendPricingSettings.weekend_surcharge_percent, tenantHolidays.length, vehiclePricingOverrides.length]);

  // DEV MODE: Listen for dev panel fill events (only in development)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    const handleDevFillRental = (e: CustomEvent<{
      customer_id: string;
      vehicle_id: string;
      start_date: Date;
      end_date: Date;
      rental_period_type: string;
      monthly_amount: number;
      pickup_location?: string;
      return_location?: string;
      pickup_time?: string;
      return_time?: string;
    }>) => {
      const data = e.detail;
      console.log('🔧 DEV MODE: Filling rental form with:', data);

      // Set form values
      form.setValue('customer_id', data.customer_id);
      form.setValue('vehicle_id', data.vehicle_id);
      form.setValue('start_date', new Date(data.start_date));
      form.setValue('end_date', new Date(data.end_date));
      form.setValue('rental_period_type', data.rental_period_type as "Daily" | "Weekly" | "Monthly");
      form.setValue('monthly_amount', data.monthly_amount);

      if (data.pickup_location) {
        form.setValue('pickup_location', data.pickup_location);
      }
      if (data.return_location) {
        form.setValue('return_location', data.return_location);
      }
      if (data.pickup_time) {
        form.setValue('pickup_time', data.pickup_time);
      }
      if (data.return_time) {
        form.setValue('return_time', data.return_time);
      }

      // Trigger form validation
      form.trigger();

      sonnerToast.success('Rental form auto-filled by Dev Panel');
    };

    window.addEventListener('dev-fill-rental-form', handleDevFillRental as EventListener);
    return () => window.removeEventListener('dev-fill-rental-form', handleDevFillRental as EventListener);
  }, [form]);

  // Auto-update end date based on rental period type and start date
  // Use a ref to track previous values and prevent unnecessary updates
  const prevStartDateRef = useRef<Date | null>(null);
  const prevPeriodTypeRef = useRef<string | null>(null);

  useEffect(() => {
    const startDate = watchedStartDate;
    const periodType = watchedRentalPeriodType;

    if (startDate && periodType) {
      // Check if values actually changed to prevent infinite loops
      const startDateChanged = !prevStartDateRef.current ||
        startDate.getTime() !== prevStartDateRef.current.getTime();
      const periodTypeChanged = prevPeriodTypeRef.current !== periodType;

      if (startDateChanged || periodTypeChanged) {
        let newEndDate: Date;

        switch (periodType) {
          case "Daily":
            newEndDate = addDays(startDate, 1);
            break;
          case "Weekly":
            newEndDate = addWeeks(startDate, 1);
            break;
          case "Monthly":
          default:
            newEndDate = addMonths(startDate, 1);
            break;
        }

        // If auto-calculated end date would span a blocked period, find the next valid end date
        if (selectedVehicleId) {
          const blockCheck = checkBlockedDatesOverlap(startDate, newEndDate, selectedVehicleId);
          if (blockCheck.blocked) {
            // Find the first blocked date after start and set end date to day before it
            const allBlocked = [...globalBlockedDatesArray, ...(selectedVehicleId ? getVehicleBlockedDates(selectedVehicleId) : [])];
            const blockedAfterStart = allBlocked
              .filter(d => d > startDate)
              .sort((a, b) => a.getTime() - b.getTime());
            if (blockedAfterStart.length > 0) {
              const dayBeforeBlock = new Date(blockedAfterStart[0]);
              dayBeforeBlock.setDate(dayBeforeBlock.getDate() - 1);
              if (dayBeforeBlock > startDate) {
                newEndDate = dayBeforeBlock;
              }
            }
          }
        }

        prevStartDateRef.current = startDate;
        prevPeriodTypeRef.current = periodType;
        form.setValue("end_date", newEndDate);
      }
    }
  }, [watchedRentalPeriodType, watchedStartDate, form]);

  const selectedCustomer = customers?.find(c => c.id === selectedCustomerId);
  const selectedVehicle = vehicles?.find(v => v.id === selectedVehicleId);

  // Handle creating verification session
  const handleCreateVerification = async () => {
    if (!selectedCustomerId || !tenant) return;

    setCreatingVerification(true);
    try {
      if (verificationMode === "ai") {
        // AI verification flow
        const { data, error } = await supabase.functions.invoke("create-ai-verification-session", {
          body: {
            customerId: selectedCustomerId,
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
          },
        });

        if (error) throw error;
        if (!data.ok) {
          throw new Error(data.detail || data.error || "Failed to create AI verification session");
        }

        sonnerToast.success("AI verification session created");
        setAiSessionData({
          sessionId: data.sessionId,
          qrUrl: data.qrUrl,
          expiresAt: new Date(data.expiresAt),
        });
        setShowQRModal(true);
        setIsPolling(true);
        await refetchVerification();
      } else {
        // Veriff flow
        const { data, error } = await supabase.functions.invoke("create-veriff-session", {
          body: { customerId: selectedCustomerId },
        });

        if (error) throw error;
        if (!data.ok) {
          throw new Error(data.detail || data.error || "Failed to create verification session");
        }

        sonnerToast.success("Verification session created successfully");

        // Open Veriff verification in new window
        if (data.sessionUrl) {
          window.open(data.sessionUrl, "_blank");
        }

        await refetchVerification();
      }
    } catch (error: any) {
      console.error("Error creating verification:", error);
      sonnerToast.error(error.message || "Failed to create verification session");
    } finally {
      setCreatingVerification(false);
    }
  };

  // Timer for QR expiry countdown
  useEffect(() => {
    if (!showQRModal || !aiSessionData) return;

    const updateTime = () => {
      const now = new Date();
      const remaining = Math.max(0, Math.floor((aiSessionData.expiresAt.getTime() - now.getTime()) / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0) {
        setShowQRModal(false);
        setIsPolling(false);
        setAiSessionData(null);
        sonnerToast.error("QR code expired. Please try again.");
      }
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [showQRModal, aiSessionData]);

  // Poll for AI verification completion
  const checkAIVerificationStatus = useCallback(async () => {
    if (!isPolling || !aiSessionData) return;

    try {
      const { data, error } = await supabase
        .from("identity_verifications")
        .select("status, review_status, review_result")
        .eq("id", aiSessionData.sessionId)
        .single();

      if (error) {
        console.error("Status check error:", error);
        return;
      }

      if (data.status === "completed") {
        setIsPolling(false);
        setShowQRModal(false);
        setAiSessionData(null);
        await refetchVerification();

        if (data.review_result === "GREEN") {
          sonnerToast.success("Identity verified successfully!");
        } else if (data.review_result === "RED") {
          sonnerToast.error("Identity verification failed");
        } else {
          sonnerToast.info("Verification needs manual review");
        }
      }
    } catch (err) {
      console.error("Status check error:", err);
    }
  }, [aiSessionData, isPolling, refetchVerification]);

  // Set up polling
  useEffect(() => {
    if (isPolling && aiSessionData) {
      const initialTimeout = setTimeout(checkAIVerificationStatus, 5000);
      pollIntervalRef.current = setInterval(checkAIVerificationStatus, 3000);

      return () => {
        clearTimeout(initialTimeout);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }
  }, [isPolling, aiSessionData, checkAIVerificationStatus]);

  // Format time remaining
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const onSubmit = async (data: RentalFormData) => {
    setLoading(true);
    setSubmitError("");
    try {
      // Check customer verification first (STRICT blocking)
      if (!isCustomerVerified) {
        throw new Error("Customer must complete identity verification before rental can be created.");
      }

      // Validate form data
      if (!data.customer_id || !data.vehicle_id) {
        throw new Error("Customer and Vehicle must be selected");
      }

      if (data.monthly_amount <= 0) {
        throw new Error("Monthly amount must be greater than 0");
      }

      // Enforce rental rules based on customer type
      const customerType = selectedCustomer?.customer_type;
      if (customerType === "Individual" && activeRentalsCount && activeRentalsCount > 0) {
        throw new Error("This customer already has an active rental. Individuals can only have one active rental at a time.");
      }

      // Check for blocked dates (global and vehicle-specific)
      const blockCheck = checkBlockedDatesOverlap(data.start_date, data.end_date, data.vehicle_id);
      if (blockCheck.blocked) {
        const blockType = blockCheck.isGlobal ? "Global blocked period" : "Vehicle blocked";
        throw new Error(`Cannot create rental: ${blockType}. Reason: ${blockCheck.reason}`);
      }

      // Calculate discount if promo code was applied
      const discountAmount = promoDetails ? calculateDiscount(data.monthly_amount) : 0;

      // Create rental with Pending status (will become Active after DocuSign)
      const { data: rental, error: rentalError } = await supabase
        .from("rentals")
        .insert({
          customer_id: data.customer_id,
          vehicle_id: data.vehicle_id,
          start_date: data.start_date.toISOString().split('T')[0],
          end_date: data.end_date.toISOString().split('T')[0],
          rental_period_type: data.rental_period_type,
          monthly_amount: data.monthly_amount,
          status: "Pending", // Start as Pending, will become Active after DocuSign signed
          document_status: "pending", // Track DocuSign state
          source: "portal", // Track rental origin
          tenant_id: tenant?.id,
          // Booking-aligned fields
          pickup_location: data.pickup_location || null,
          return_location: sameAsPickup ? data.pickup_location : data.return_location || null,
          pickup_location_id: pickupLocationId || null,
          return_location_id: sameAsPickup ? pickupLocationId : returnLocationId || null,
          pickup_time: data.pickup_time || null,
          return_time: data.return_time || null,
          driver_age_range: data.driver_age_range || null,
          promo_code: promoDetails?.code || null,
          discount_applied: discountAmount > 0 ? discountAmount : null,
          insurance_status: bonzahPremium > 0 ? "bonzah" : (data.insurance_status || "pending"),
          insurance_premium: bonzahPremium > 0 ? bonzahPremium : null,
          renewed_from_rental_id: renewFromId || null,
        })
        .select()
        .single();

      if (rentalError) throw rentalError;

      // Create Bonzah insurance quote if coverage was selected
      const hasBonzahCoverage = bonzahCoverage.cdw || bonzahCoverage.rcli || bonzahCoverage.sli || bonzahCoverage.pai;
      if (hasBonzahCoverage && bonzahPremium > 0 && tenant?.id) {
        try {
          // Get customer details for the quote
          const customer = customerDetails;
          const nameParts = (customer?.name || 'N/A').split(' ');
          const firstName = nameParts[0] || 'N/A';
          const lastName = nameParts.slice(1).join(' ') || 'N/A';
          const custState = customer?.address_state || 'FL';
          const { error: quoteError } = await supabase.functions.invoke('bonzah-create-quote', {
            body: {
              rental_id: rental.id,
              customer_id: data.customer_id,
              tenant_id: tenant.id,
              trip_dates: {
                start: data.start_date.toISOString().split('T')[0],
                end: data.end_date.toISOString().split('T')[0],
              },
              pickup_state: custState,
              coverage: bonzahCoverage,
              renter: {
                first_name: firstName,
                last_name: lastName,
                dob: customer?.date_of_birth || '1990-01-01',
                email: customer?.email || '',
                phone: customer?.phone || '',
                address: {
                  street: customer?.address_street || '',
                  city: customer?.address_city || '',
                  state: custState,
                  zip: customer?.address_zip || '',
                },
                license: {
                  number: customer?.license_number || '',
                  state: customer?.license_state || custState,
                },
              },
            },
          });
          if (quoteError) {
            console.error('[Bonzah] Quote creation failed:', quoteError);
            // Non-fatal - rental is already created
          }
        } catch (bonzahError) {
          console.error('[Bonzah] Error creating quote:', bonzahError);
          // Non-fatal
        }
      }

      // Save selected extras
      if (Object.keys(selectedExtras).length > 0) {
        const extrasInserts = Object.entries(selectedExtras).map(([extraId, qty]) => {
          const extra = activeExtras.find(e => e.id === extraId);
          return {
            rental_id: rental.id,
            extra_id: extraId,
            quantity: qty,
            price_at_booking: extra ? Number(extra.price) : 0,
          };
        });
        const { error: extrasError } = await supabase
          .from("rental_extras_selections")
          .insert(extrasInserts);
        if (extrasError) {
          console.error("Error saving rental extras:", extrasError);
          // Don't throw - rental is already created
        }
      }

      // Update vehicle status to Rented immediately (even for pending rentals)
      const { error: vehicleError } = await supabase
        .from("vehicles")
        .update({ status: "Rented" })
        .eq("id", data.vehicle_id)
        .eq("tenant_id", tenant?.id);

      if (vehicleError) {
        console.error("Error updating vehicle status:", vehicleError);
        // Don't throw - rental is already created
      }

      // Charges are automatically generated by database trigger
      // No need to manually call rental_create_charge here

      // Link insurance document if uploaded
      if (insuranceDocId) {
        const { error: docLinkError } = await supabase
          .from("customer_documents")
          .update({
            rental_id: rental.id,
            customer_id: data.customer_id,
          })
          .eq("id", insuranceDocId);

        if (docLinkError) {
          console.error("Error linking insurance document:", docLinkError);
          // Don't throw - rental is already created, just log the error
        }
      }

      // Generate first charge for this specific rental (works for Pending status)
      const { error: chargeError } = await supabase.rpc("generate_first_charge_for_rental", {
        rental_id_param: rental.id
      });

      if (chargeError) {
        console.error("Error generating first charge:", chargeError);
        // Don't throw - rental is already created, charge can be created manually
      }

      const customerName = selectedCustomer?.name || "Customer";
      const vehicleReg = selectedVehicle?.reg || "Vehicle";

      // Create a payment reminder for the new rental (so it shows in Reminders tab)
      try {
        const dueDate = data.start_date.toISOString().split('T')[0];
        const reminderContext = {
          rental_id: rental.id,
          customer_id: data.customer_id,
          customer_name: customerName,
          vehicle_id: data.vehicle_id,
          reg: vehicleReg,
          make: selectedVehicle?.make,
          model: selectedVehicle?.model,
          amount: data.monthly_amount,
          due_date: dueDate,
        };

        await supabase.from('reminders').insert({
          rule_code: 'PAYMENT_DUE',
          object_type: 'Rental',
          object_id: rental.id,
          title: `Payment due — ${customerName} (${vehicleReg})`,
          message: `${formatCurrency(data.monthly_amount, tenant?.currency_code || 'GBP')} payment due for rental of ${selectedVehicle?.make} ${selectedVehicle?.model} (${vehicleReg}). Due date: ${dueDate}.`,
          due_on: dueDate,
          remind_on: dueDate,
          severity: 'warning',
          context: reminderContext,
          status: 'pending',
          tenant_id: tenant?.id,
        });
        console.log('Payment reminder created for rental:', rental.id);
      } catch (reminderError) {
        console.error('Error creating payment reminder:', reminderError);
        // Don't throw - rental is already created, just log the error
      }

      // Generate invoice
      let invoiceCreated = false;
      try {
        const invoiceNotes = `Monthly rental fee for ${selectedVehicle?.make} ${selectedVehicle?.model} (${vehicleReg})`;
        // Apply discount to the rental amount
        const discountedAmount = data.monthly_amount - discountAmount;
        const taxAmount = calculateTaxAmount(discountedAmount);
        const serviceFee = calculateServiceFee();
        const securityDeposit = calculateSecurityDeposit(data.vehicle_id);
        const insurancePremium = bonzahPremium > 0 ? bonzahPremium : 0;
        const totalAmount = discountedAmount + taxAmount + serviceFee + securityDeposit + insurancePremium;

        const invoice = await createInvoice({
          rental_id: rental.id,
          customer_id: data.customer_id,
          vehicle_id: data.vehicle_id,
          invoice_date: data.start_date,
          due_date: addMonths(data.start_date, 1),
          subtotal: discountedAmount,
          tax_amount: taxAmount,
          service_fee: serviceFee,
          security_deposit: securityDeposit,
          insurance_premium: insurancePremium,
          total_amount: totalAmount,
          notes: invoiceNotes,
          tenant_id: tenant?.id,
        });

        // Add discount info to invoice for display
        setGeneratedInvoice({
          ...invoice,
          discount_amount: discountAmount > 0 ? discountAmount : undefined,
          promo_code: promoDetails?.code,
        } as any);
        invoiceCreated = true;
      } catch (invoiceError) {
        console.error('Error creating invoice:', invoiceError);
        // If invoice fails, still continue with the flow - skip invoice and go to DocuSign
      }

      // Send booking notification emails
      try {
        await sendBookingNotification({
          rentalId: rental.id,
          customerId: data.customer_id,
          customerName: selectedCustomer?.name || customerName,
          customerEmail: selectedCustomer?.email || '',
          vehicleReg: vehicleReg,
          vehicleMake: selectedVehicle?.make || '',
          vehicleModel: selectedVehicle?.model || '',
          startDate: data.start_date.toISOString(),
          endDate: data.end_date.toISOString(),
          monthlyAmount: data.monthly_amount,
          totalAmount: data.monthly_amount,
        });
        console.log('Booking notification emails sent');
      } catch (notificationError) {
        console.error('Error sending booking notifications:', notificationError);
      }

      // Refresh queries
      queryClient.invalidateQueries({ queryKey: ["rentals-list"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["customer-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["customer-net-position"] });
      queryClient.invalidateQueries({ queryKey: ["reminders"] });
      queryClient.invalidateQueries({ queryKey: ["reminder-stats"] });

      // Auto-trigger DocuSign via portal API route (uses Node.js crypto, same as booking app)
      let docuSignSuccess = false;
      try {
        const docuSignResponse = await fetch("/api/docusign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rentalId: rental.id,
            customerEmail: selectedCustomer?.email || "",
            customerName: selectedCustomer?.name || customerName,
            tenantId: tenant?.id,
          }),
        });

        const docuSignData = await docuSignResponse.json();

        if (!docuSignResponse.ok || !docuSignData?.ok) {
          console.error("DocuSign error:", docuSignData);
          toast({
            title: "Rental Created - DocuSign Pending",
            description: `Rental created but DocuSign failed to send. You can retry from the rental details page.`,
            variant: "default",
          });
        } else {
          docuSignSuccess = true;
          // The API route already updates the rental with envelope ID
          toast({
            title: "Rental Created - Agreement Sent",
            description: `Rental created for ${customerName} • ${vehicleReg}. DocuSign agreement sent to customer.`,
          });
        }
      } catch (docuSignErr: any) {
        console.error("Error sending DocuSign:", docuSignErr);
        toast({
          title: "Rental Created - DocuSign Pending",
          description: `Rental created but DocuSign failed. You can retry from the rental details page.`,
          variant: "default",
        });
      }

      // Store rental data for invoice dialog
      setCreatedRentalData({
        rental,
        customer: selectedCustomer,
        vehicle: selectedVehicle,
        formData: data,
        docuSignSuccess,
      });

      // Show payment options dialog after rental creation
      setShowPaymentDialog(true);
    } catch (error: any) {
      console.error("Error creating rental:", error);

      // Surface full Postgres error
      const errorMessage = error?.message || "Failed to create rental agreement. Please try again.";
      const errorDetails = error?.details || error?.hint || "";
      const fullError = errorDetails ? `${errorMessage}\n\nDetails: ${errorDetails}` : errorMessage;

      console.error("Full rental creation error:", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        error
      });

      setSubmitError(fullError);
      toast({
        title: "Error Creating Rental",
        description: fullError,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Form validation state
  const isFormValid = form.formState.isValid;
  const yearAgo = subYears(new Date(), 1);

  // Check if start date is in the past
  const isPastStartDate = watchedStartDate && isBefore(watchedStartDate, todayAtMidnight);

  // Redirect managers without edit permission
  useEffect(() => {
    if (isManager && !canEdit('rentals')) {
      router.push('/rentals');
    }
  }, [isManager, canEdit, router]);

  if (isManager && !canEdit('rentals')) return null;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <Button 
          variant="outline" 
          onClick={() => router.push("/rentals")} 
          className="w-fit border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Rentals
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">
            {renewalSource ? "Renew Rental" : "Create New Rental"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {renewalSource ? "Create a new rental from a completed one" : "Set up a new rental agreement"}
          </p>
        </div>
      </div>

      {/* Renewal Banner */}
      {renewalSource && (
        <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
          <RefreshCw className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-blue-700 dark:text-blue-400">
            Renewing from rental for <strong>{renewalSource.customers?.name}</strong> — {renewalSource.vehicles?.make} {renewalSource.vehicles?.model} ({renewalSource.vehicles?.reg})
          </AlertDescription>
        </Alert>
      )}

      {/* Two-column layout: Form + Contract Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="lg:col-span-2">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <FileText className="h-5 w-5 text-primary flex-shrink-0" />
                Rental Agreement Details
              </CardTitle>
              <CardDescription className="text-sm">
                Fill in the details to create a new rental agreement. Monthly charges will be automatically generated.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Submit Error Alert */}
              {submitError && (
                <Alert variant="destructive" className="mb-6">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              )}

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  {/* Customer and Vehicle Selection */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="customer_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Customer <span className="text-red-500">*</span></FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className={form.formState.errors.customer_id ? "border-destructive" : ""}>
                                <SelectValue placeholder="Select customer" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="max-w-[calc(100vw-2rem)]">
                              {customers?.map((customer) => {
                                const customerType = customer.customer_type;
                                const contact = customer.email || customer.phone;
                                return (
                                  <SelectItem key={customer.id} value={customer.id} className="whitespace-normal break-words">
                                    <div className="flex flex-col gap-0.5">
                                      <span className="font-medium">{customer.name}</span>
                                      <span className="text-xs text-muted-foreground">{contact || customerType}</span>
                                    </div>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="vehicle_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Vehicle <span className="text-red-500">*</span></FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className={form.formState.errors.vehicle_id ? "border-destructive" : ""}>
                                <SelectValue placeholder="Select vehicle" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="max-w-[calc(100vw-2rem)]">
                              {vehicles?.map((vehicle) => (
                                <SelectItem key={vehicle.id} value={vehicle.id} className="whitespace-normal break-words">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-medium">{vehicle.reg}</span>
                                    <span className="text-xs text-muted-foreground">{vehicle.make} {vehicle.model}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                          <FormDescription>
                            Only available vehicles are shown
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Customer Verification Section */}
                  {selectedCustomerId && (
                    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Shield className="h-5 w-5 text-primary" />
                          <h3 className="font-medium">Identity Verification</h3>
                          <span className="text-sm text-muted-foreground">
                            ({verificationMode === "ai" ? "AI Verification" : "Veriff"})
                          </span>
                        </div>
                        {isCustomerVerified ? (
                          <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        ) : verificationPending ? (
                          <Badge variant="secondary">
                            <Clock className="h-3 w-3 mr-1" />
                            Pending
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500 text-amber-600">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Not Verified
                          </Badge>
                        )}
                      </div>

                      {/* DOB Warning */}
                      {customerDetails && !customerDetails.date_of_birth && (
                        <Alert variant="default" className="border-amber-500 bg-amber-50">
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                          <AlertDescription className="text-amber-700">
                            Customer date of birth is not set. This may be required for identity verification.
                          </AlertDescription>
                        </Alert>
                      )}

                      {isCustomerVerified ? (
                        <div className="text-sm text-muted-foreground">
                          <p>Customer identity has been verified.</p>
                          {customerVerification?.first_name && customerVerification?.last_name && (
                            <p className="mt-1">
                              Name: {customerVerification.first_name} {customerVerification.last_name}
                            </p>
                          )}
                          {customerVerification?.document_number && (
                            <p>Document: {customerVerification.document_number}</p>
                          )}
                          {customerVerification?.created_at && (
                            <p>Verified on: {format(new Date(customerVerification.created_at), "MMM d, yyyy")}</p>
                          )}
                        </div>
                      ) : verificationPending ? (
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-muted-foreground">
                            Verification is in progress. Please wait for the customer to complete verification.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => refetchVerification()}
                          >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Refresh
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <Alert variant="destructive">
                            <XCircle className="h-4 w-4" />
                            <AlertDescription>
                              Customer must complete identity verification before rental can be created.
                            </AlertDescription>
                          </Alert>
                          <Button
                            type="button"
                            onClick={handleCreateVerification}
                            disabled={creatingVerification}
                            className="w-full"
                          >
                            {creatingVerification ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Creating Session...
                              </>
                            ) : (
                              <>
                                <Shield className="h-4 w-4 mr-2" />
                                Start Verification
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Rental Period Type */}
                  <div className="grid grid-cols-1 gap-4">
                    <FormField
                      control={form.control}
                      name="rental_period_type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Rental Period Type <span className="text-red-500">*</span></FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select rental period" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Daily">Daily</SelectItem>
                              <SelectItem value="Weekly">Weekly</SelectItem>
                              <SelectItem value="Monthly">Monthly</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                          <FormDescription>
                            Choose how often the rental will be charged
                          </FormDescription>
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="start_date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start Date <span className="text-red-500">*</span></FormLabel>
                          <FormControl>
                            <DatePickerInput
                              date={field.value}
                              onSelect={field.onChange}
                              placeholder="Select start date"
                              disabled={(date) => {
                                // Disable dates more than a year ago
                                if (isBefore(date, yearAgo)) return true;
                                // Disable globally blocked dates
                                if (globalBlockedDatesArray.some(
                                  blockedDate => blockedDate.toDateString() === date.toDateString()
                                )) return true;
                                // Disable vehicle-specific blocked dates if vehicle is selected
                                if (selectedVehicleId) {
                                  const vehicleBlockedDates = getVehicleBlockedDates(selectedVehicleId);
                                  if (vehicleBlockedDates.some(
                                    blockedDate => blockedDate.toDateString() === date.toDateString()
                                  )) return true;
                                }
                                return false;
                              }}
                              error={!!form.formState.errors.start_date}
                              className="w-full"
                            />
                          </FormControl>
                          {isPastStartDate && (
                            <div className="flex items-center gap-1 text-amber-600 text-sm">
                              <AlertTriangle className="h-3 w-3" />
                              Warning: Start date is in the past
                            </div>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="end_date"
                      render={({ field }) => {
                        const periodType = watchedRentalPeriodType || "Monthly";
                        const getMinEndDate = (startDate: Date) => {
                          switch (periodType) {
                            case "Daily":
                              return addDays(startDate, 1);
                            case "Weekly":
                              return addWeeks(startDate, 1);
                            case "Monthly":
                            default:
                              return addMonths(startDate, 1);
                          }
                        };
                        const descriptionText = periodType === "Daily"
                          ? "Must be at least 1 day after start date"
                          : periodType === "Weekly"
                            ? "Must be at least 1 week after start date"
                            : "Must be at least 1 month after start date";

                        return (
                          <FormItem>
                            <FormLabel>End Date <span className="text-red-500">*</span></FormLabel>
                            <FormControl>
                              <DatePickerInput
                                date={field.value}
                                onSelect={field.onChange}
                                placeholder="Select end date"
                                disabled={(date) => {
                                  // Disable dates before minimum end date
                                  if (watchedStartDate && isBefore(date, getMinEndDate(watchedStartDate))) {
                                    return true;
                                  }
                                  // Disable globally blocked dates
                                  if (globalBlockedDatesArray.some(
                                    blockedDate => blockedDate.toDateString() === date.toDateString()
                                  )) return true;
                                  // Disable vehicle-specific blocked dates if vehicle is selected
                                  if (selectedVehicleId) {
                                    const vehicleBlockedDates = getVehicleBlockedDates(selectedVehicleId);
                                    if (vehicleBlockedDates.some(
                                      blockedDate => blockedDate.toDateString() === date.toDateString()
                                    )) return true;
                                  }
                                  // Disable end dates that would span across a blocked period
                                  if (watchedStartDate && selectedVehicleId) {
                                    const blockCheck = checkBlockedDatesOverlap(watchedStartDate, date, selectedVehicleId);
                                    if (blockCheck.blocked) return true;
                                  }
                                  return false;
                                }}
                                error={!!form.formState.errors.end_date}
                                className="w-full"
                              />
                            </FormControl>
                            <FormMessage />
                            <FormDescription>
                              {descriptionText}
                            </FormDescription>
                          </FormItem>
                        );
                      }}
                    />
                  </div>

                  {/* Blocked period warning - check full date range overlap */}
                  {watchedStartDate && watchedEndDate && selectedVehicleId && (() => {
                    const blockCheck = checkBlockedDatesOverlap(watchedStartDate, watchedEndDate, selectedVehicleId);
                    if (!blockCheck.blocked) return null;
                    return (
                      <Alert variant="destructive" className="border-red-500/50 bg-red-500/10">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          <span className="font-medium">
                            {blockCheck.isGlobal ? 'Global blocked period' : 'Vehicle blocked'}:
                          </span>{' '}
                          {blockCheck.reason}. Please choose different dates.
                        </AlertDescription>
                      </Alert>
                    );
                  })()}

                  {/* Financial Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="monthly_amount"
                      render={({ field }) => {
                        const periodType = watchedRentalPeriodType || "Monthly";
                        const label = periodType === "Daily" ? "Daily Amount *" :
                          periodType === "Weekly" ? "Weekly Amount *" :
                            "Monthly Amount *";
                        const placeholder = periodType === "Daily" ? "Daily rental amount" :
                          periodType === "Weekly" ? "Weekly rental amount" :
                            "Monthly rental amount";
                        return (
                          <FormItem>
                            <FormLabel>{label}</FormLabel>
                            <FormControl>
                              <CurrencyInput
                                value={field.value}
                                onChange={field.onChange}
                                placeholder={placeholder}
                                min={1}
                                step={1}
                                error={!!form.formState.errors.monthly_amount}
                                disabled={false}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />

                  </div>

                  {/* Pickup/Return Locations */}
                  <div className="space-y-4 pt-4 border-t">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <h3 className="font-medium">Pickup & Return Locations</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="pickup_location"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Pickup Location</FormLabel>
                            <FormControl>
                              <LocationPicker
                                type="pickup"
                                value={field.value || ''}
                                locationId={pickupLocationId}
                                onChange={(address, locId) => {
                                  field.onChange(address);
                                  setPickupLocationId(locId);
                                  // Sync return location if "Same as pickup" is checked
                                  if (sameAsPickup) {
                                    form.setValue("return_location", address);
                                    setReturnLocationId(locId);
                                  }
                                }}
                                placeholder="Enter pickup address"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="return_location"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel>Return Location</FormLabel>
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id="sameAsPickup"
                                  checked={sameAsPickup}
                                  onCheckedChange={(checked) => {
                                    setSameAsPickup(checked === true);
                                    if (checked) {
                                      form.setValue("return_location", form.getValues("pickup_location"));
                                      setReturnLocationId(pickupLocationId);
                                    }
                                  }}
                                />
                                <label
                                  htmlFor="sameAsPickup"
                                  className="text-sm text-muted-foreground cursor-pointer"
                                >
                                  Same as pickup
                                </label>
                              </div>
                            </div>
                            <FormControl>
                              <LocationPicker
                                type="return"
                                value={sameAsPickup ? form.getValues("pickup_location") || '' : field.value || ''}
                                locationId={sameAsPickup ? pickupLocationId : returnLocationId}
                                onChange={(address, locId) => {
                                  field.onChange(address);
                                  setReturnLocationId(locId);
                                }}
                                placeholder="Enter return address"
                                disabled={sameAsPickup}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Pickup/Return Times */}
                  <div className="space-y-4 pt-4 border-t">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <h3 className="font-medium">Pickup & Return Times</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="pickup_time"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Pickup Time</FormLabel>
                            <FormControl>
                              <TimePicker
                                id="pickup_time"
                                value={field.value}
                                onChange={field.onChange}
                                placeholder="Select pickup time"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="return_time"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Return Time</FormLabel>
                            <FormControl>
                              <TimePicker
                                id="return_time"
                                value={field.value}
                                onChange={field.onChange}
                                placeholder="Select return time"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  {/* Insurance Verification - Hidden for insurance-exempt tenants like Kedic Services */}
                  {!skipInsurance && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <h3 className="font-medium">Insurance Verification</h3>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setShowInsuranceUpload(true)}
                            className="whitespace-nowrap"
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            <span className="hidden sm:inline">{insuranceDocId ? "Certificate Uploaded" : "Upload Certificate"}</span>
                            <span className="sm:hidden">{insuranceDocId ? "Uploaded" : "Upload"}</span>
                          </Button>
                          {insuranceDocId && (
                            <span className="text-sm text-green-600 whitespace-nowrap">✓ Uploaded</span>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">Upload customer's insurance certificate for verification</p>
                    </div>
                  )}

                  {/* Bonzah Insurance Selection */}
                  {!skipInsurance && watchedStartDate && watchedEndDate && (
                    <div className="space-y-4 pt-4 border-t">
                      <BonzahInsuranceSelector
                        tripStartDate={watchedStartDate ? watchedStartDate.toISOString().split('T')[0] : null}
                        tripEndDate={watchedEndDate ? watchedEndDate.toISOString().split('T')[0] : null}
                        pickupState={customerDetails?.address_state || "FL"}
                        onCoverageChange={(coverage, premium) => {
                          setBonzahCoverage(coverage);
                          setBonzahPremium(premium);
                        }}
                        onSkipInsurance={() => {
                          setBonzahCoverage({ cdw: false, rcli: false, sli: false, pai: false });
                          setBonzahPremium(0);
                        }}
                        initialCoverage={bonzahCoverage}
                      />
                      {bonzahPremium > 0 && bonzahCdBalance != null && bonzahPremium > bonzahCdBalance && (
                        <div className="rounded-lg border border-[#CC004A]/30 bg-[#CC004A]/5 p-3 flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-[#CC004A] mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-muted-foreground">
                            Insurance premium (<span className="font-medium text-[#CC004A]">${bonzahPremium.toFixed(2)}</span>) exceeds your current Bonzah balance (<span className="font-medium">${bonzahCdBalance.toFixed(2)}</span>). The rental can still be created, but the policy won't activate until you top up.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Rental Extras */}
                  {activeExtras.length > 0 && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-muted-foreground" />
                        <h3 className="font-medium">Optional Extras</h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {activeExtras.map((extra) => {
                          const isSelected = !!selectedExtras[extra.id];
                          const isToggle = extra.max_quantity === null;
                          const qty = selectedExtras[extra.id] || 0;

                          return (
                            <div
                              key={extra.id}
                              className={cn(
                                "rounded-lg border p-3 transition-all",
                                isSelected
                                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                  : "border-border hover:border-primary/40 cursor-pointer"
                              )}
                              onClick={() => {
                                if (isToggle) {
                                  setSelectedExtras(prev => {
                                    const next = { ...prev };
                                    if (next[extra.id]) delete next[extra.id];
                                    else next[extra.id] = 1;
                                    return next;
                                  });
                                }
                              }}
                            >
                              <div className="flex items-start gap-3">
                                {extra.image_urls && extra.image_urls.length > 0 ? (
                                  <img
                                    src={extra.image_urls[0]}
                                    alt={extra.name}
                                    className="w-12 h-12 rounded object-cover flex-shrink-0"
                                  />
                                ) : (
                                  <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
                                    <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-medium text-sm truncate">{extra.name}</span>
                                    <span className="text-sm font-semibold text-primary whitespace-nowrap">
                                      {formatCurrency(Number(extra.price), tenant?.currency_code || 'USD')}
                                    </span>
                                  </div>
                                  {extra.description && (
                                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{extra.description}</p>
                                  )}
                                  {isToggle ? (
                                    <div className="mt-2">
                                      {isSelected ? (
                                        <Badge variant="default" className="text-xs"><Check className="h-3 w-3 mr-1" /> Selected</Badge>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">Click to add</span>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => {
                                          setSelectedExtras(prev => {
                                            const curr = prev[extra.id] || 0;
                                            if (curr <= 1) {
                                              const next = { ...prev };
                                              delete next[extra.id];
                                              return next;
                                            }
                                            return { ...prev, [extra.id]: curr - 1 };
                                          });
                                        }}
                                        disabled={qty === 0}
                                      >
                                        <Minus className="h-3 w-3" />
                                      </Button>
                                      <span className="w-6 text-center text-sm font-medium">{qty}</span>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => {
                                          setSelectedExtras(prev => {
                                            const curr = prev[extra.id] || 0;
                                            const max = extra.remaining_stock ?? extra.max_quantity ?? 99;
                                            return { ...prev, [extra.id]: Math.min(curr + 1, max) };
                                          });
                                        }}
                                        disabled={qty >= (extra.remaining_stock ?? extra.max_quantity ?? 99)}
                                      >
                                        <Plus className="h-3 w-3" />
                                      </Button>
                                      {qty > 0 && (
                                        <span className="text-xs text-muted-foreground ml-1">
                                          = {formatCurrency(Number(extra.price) * qty, tenant?.currency_code || 'USD')}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {Object.keys(selectedExtras).length > 0 && (
                        <div className="text-sm text-right font-medium">
                          Extras Total: {formatCurrency(Object.entries(selectedExtras).reduce((sum, [id, qty]) => {
                            const extra = activeExtras.find(e => e.id === id);
                            return sum + (extra ? Number(extra.price) * qty : 0);
                          }, 0), tenant?.currency_code || 'USD')}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Optional Details */}
                  <div className="space-y-4 pt-4 border-t">
                    <h3 className="font-medium text-muted-foreground">Optional Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="driver_age_range"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Driver Age Range</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select age range" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="under_25">Under 25</SelectItem>
                                <SelectItem value="25_70">25 - 70</SelectItem>
                                <SelectItem value="over_70">Over 70</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="promo_code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Promo Code</FormLabel>
                            <div className="flex gap-2">
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="Enter promo code"
                                  className={cn(
                                    promoError ? "border-destructive" : promoDetails ? "border-green-500" : ""
                                  )}
                                  onChange={(e) => {
                                    field.onChange(e);
                                    setPromoError(null);
                                    if (!e.target.value) setPromoDetails(null);
                                  }}
                                />
                              </FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => validatePromoCode(field.value || "")}
                                disabled={promoLoading || !field.value}
                              >
                                {promoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                              </Button>
                            </div>
                            {promoError && <p className="text-sm text-destructive">{promoError}</p>}
                            {promoDetails && (
                              <p className="text-sm text-green-600 font-medium flex items-center gap-1">
                                <Check className="w-4 h-4" />
                                Code applied: {promoDetails.type === 'percentage' ? `${promoDetails.value}% off` : `${formatCurrency(promoDetails.value, tenant?.currency_code || 'GBP')} off`}
                              </p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    {/* Notes / Special Requests */}
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes / Special Requests</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              placeholder="Any special requirements or notes for this rental"
                              rows={3}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Helper Info */}
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      <strong>Note:</strong> Rental will start as &quot;Pending&quot;. It becomes &quot;Active&quot; once approved and key handover is completed.
                      The vehicle will be marked as &quot;Rented&quot; immediately.
                    </p>
                  </div>

                  {/* Submit */}
                  <div className="flex justify-end gap-2 pt-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => router.push("/rentals")}
                      className="border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/50 transition-all duration-200"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={loading || !isFormValid}
                      className="bg-gradient-primary text-white hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {loading ? "Creating..." : !isCustomerVerified ? "Verification Required" : "Create Rental"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* Contract Summary Panel */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <ContractSummary
              customer={selectedCustomer}
              vehicle={selectedVehicle}
              startDate={watchedStartDate}
              endDate={watchedEndDate}
              rentalPeriodType={watchedRentalPeriodType}
              monthlyAmount={watchedMonthlyAmount}
            />
          </div>
        </div>
      </div>

      {/* Post-Creation Payment Dialog — always mounted so Radix Dialog transitions correctly */}
      <AddPaymentDialog
        open={showPaymentDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowPaymentDialog(false);
            // After payment dialog closes, show invoice dialog if available, otherwise navigate
            if (generatedInvoice) {
              setShowInvoiceDialog(true);
            } else if (createdRentalData?.rental?.id) {
              router.push(`/rentals/${createdRentalData.rental.id}`);
            }
          }
        }}
        customer_id={createdRentalData?.rental?.customer_id || createdRentalData?.formData?.customer_id}
        vehicle_id={createdRentalData?.rental?.vehicle_id || createdRentalData?.formData?.vehicle_id}
        rental_id={createdRentalData?.rental?.id}
      />

      {/* Invoice Dialog */}
      {generatedInvoice && createdRentalData && (
        <InvoiceDialog
          open={showInvoiceDialog}
          onOpenChange={(open) => {
            setShowInvoiceDialog(open);
            if (!open) {
              // Navigate to rental detail page after viewing invoice
              if (createdRentalData?.rental?.id) {
                router.push(`/rentals/${createdRentalData.rental.id}`);
              }
            }
          }}
          invoice={generatedInvoice}
          customer={{
            name: createdRentalData.customer?.name || "",
            email: createdRentalData.customer?.email,
            phone: createdRentalData.customer?.phone,
          }}
          vehicle={{
            reg: createdRentalData.vehicle?.reg || "",
            make: createdRentalData.vehicle?.make || "",
            model: createdRentalData.vehicle?.model || "",
          }}
          rental={{
            start_date: createdRentalData.formData.start_date.toISOString(),
            end_date: createdRentalData.formData.end_date.toISOString(),
            monthly_amount: createdRentalData.formData.monthly_amount,
          }}
          protectionPlan={bonzahPremium > 0 ? {
            name: [
              bonzahCoverage.cdw ? 'CDW' : '',
              bonzahCoverage.rcli ? 'RCLI' : '',
              bonzahCoverage.sli ? 'SLI' : '',
              bonzahCoverage.pai ? 'PAI' : '',
            ].filter(Boolean).join(' + ') + ' Coverage',
            cost: bonzahPremium,
            rentalFee: createdRentalData.formData.monthly_amount - (generatedInvoice?.discount_amount || 0),
          } : undefined}
          selectedExtras={Object.entries(selectedExtras).map(([extraId, qty]) => {
            const extra = activeExtras.find(e => e.id === extraId);
            return { name: extra?.name || 'Extra', quantity: qty, price: extra?.price || 0 };
          }).filter(e => e.quantity > 0)}
        />
      )}

      {/* Insurance Upload Dialog - Hidden for insurance-exempt tenants */}
      {!skipInsurance && (
        <InsuranceUploadDialog
          open={showInsuranceUpload}
          onOpenChange={setShowInsuranceUpload}
          customerId={selectedCustomerId}
          onUploadComplete={(documentId) => {
            setInsuranceDocId(documentId);
            form.setValue("insurance_status", "uploaded");
          }}
        />
      )}

      {/* AI Verification QR Modal */}
      <Dialog
        open={showQRModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowQRModal(false);
            setIsPolling(false);
            setAiSessionData(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" />
              Identity Verification
            </DialogTitle>
            <DialogDescription>
              Have the customer scan this QR code with their phone camera.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center space-y-6 py-6">
            {/* QR Code Display */}
            {aiSessionData && (
              <div
                className="rounded-xl shadow-lg border-2 border-gray-200"
                style={{
                  backgroundColor: "#FFFFFF",
                  padding: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <img
                  src={`https://quickchart.io/qr?text=${encodeURIComponent(aiSessionData.qrUrl)}&size=300&margin=3&dark=000000&light=ffffff&ecLevel=M&format=png`}
                  alt="Scan QR code to verify identity"
                  width={300}
                  height={300}
                  style={{ display: "block", imageRendering: "pixelated" }}
                />
              </div>
            )}

            {/* Timer with progress bar */}
            <div className="w-full space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  Time remaining
                </span>
                <span
                  className={`font-mono font-medium ${timeRemaining < 60 ? "text-destructive" : "text-foreground"}`}
                >
                  {formatTime(timeRemaining)}
                </span>
              </div>
              <Progress value={(timeRemaining / 900) * 100} className="h-2" />
            </div>

            {/* Status indicator */}
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Waiting for customer to complete verification...</span>
            </div>

            {/* Manual URL with copy button */}
            {aiSessionData && (
              <div className="w-full space-y-2">
                <p className="text-xs text-center text-muted-foreground">
                  Can&apos;t scan? Share this link with the customer:
                </p>
                <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                  <input
                    type="text"
                    readOnly
                    value={aiSessionData.qrUrl}
                    className="flex-1 bg-transparent text-xs truncate border-none focus:outline-none"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(aiSessionData.qrUrl);
                      sonnerToast.success("Link copied to clipboard");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowQRModal(false);
                setIsPolling(false);
                setAiSessionData(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreateRental;
