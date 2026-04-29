"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { addMonths, addDays, addWeeks, isAfter, isBefore, subYears, startOfDay, format, differenceInDays, parseISO } from "date-fns";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, FileText, Save, AlertTriangle, MapPin, Clock, Shield, Upload, CheckCircle2, XCircle, Loader2, RefreshCw, QrCode, Smartphone, Copy, Check, Plus, Minus, Receipt, ImageIcon, ExternalLink, Info, CalendarDays, StickyNote, ChevronsUpDown, Link2, Star, ShieldCheck, Lock, Banknote, CreditCard, Zap } from "lucide-react";
import { GenerateInviteDialog } from "@/components/customers/generate-invite-dialog";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";
import BonzahInsuranceSelector from "@/components/rentals/bonzah-insurance-selector";
import type { CoverageOptions } from "@/hooks/use-bonzah-premium";
import { useBonzahVehicleEligibility } from "@/hooks/use-bonzah-vehicle-eligibility";
import { useBonzahBalance } from "@/hooks/use-bonzah-balance";
import { useCustomerActiveRentals } from "@/hooks/use-customer-active-rentals";
import { checkRentalConflicts, type ConflictResult } from "@/hooks/use-rental-conflicts";
import { VehicleConflictDialog } from "@/components/rentals/VehicleConflictDialog";
import { PAYMENT_TYPES } from "@/constants";
import { DatePickerInput } from "@/components/shared/forms/date-picker-input";
import { RentalDateRangePicker } from "@/components/shared/forms/rental-date-picker";
import { CurrencyInput } from "@/components/shared/forms/currency-input";
import { InvoiceDialog } from "@/components/shared/dialogs/invoice-dialog";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { createInvoice, Invoice } from "@/lib/invoice-utils";
import { sendBookingNotification, sendPaymentVerificationNotification } from "@/lib/notifications";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useBlockedDates } from "@/hooks/use-blocked-dates";
import { InsuranceUploadDialog } from "@/components/shared/dialogs/insurance-upload-dialog";
import { AIScanProgress } from "@/components/insurance/ai-scan-progress";
import { LocationPicker, type LocationMethod } from "@/components/ui/location-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { TimePicker } from "@/components/ui/time-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast as sonnerToast } from "sonner";
import { useRentalExtras, type RentalExtra } from "@/hooks/use-rental-extras";
import { formatCurrency, getCurrencySymbol, formatDistance, getDistanceUnitShort, getMileageTierLabel } from "@/lib/format-utils";
import type { DistanceUnit } from "@/lib/format-utils";
import { getMileageTier, getTierMileage, calculateTotalMileageAllowance, isUnlimitedMileage } from "@/lib/mileage-utils";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useCustomerReviewSummary } from "@/hooks/use-customer-review-summary";
import { useCustomerReviews } from "@/hooks/use-customer-reviews";
import { useCustomerInsurance } from "@/hooks/use-customer-insurance";
import { useCustomerDocuments, getDocumentStatus } from "@/hooks/use-customer-documents";
import { useWeekendPricing } from "@/hooks/use-weekend-pricing";
import { useTenantHolidays } from "@/hooks/use-tenant-holidays";
import { useVehiclePricingOverrides } from "@/hooks/use-vehicle-pricing-overrides";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useVehicleBookedDates } from "@/hooks/use-vehicle-booked-dates";
import { RentalProgressOverlay } from "@/components/rentals/rental-progress-overlay";
import { getTimezonesByRegion, findTimezone } from "@/lib/timezones";

// Base schema: end_date and return_location are optional at the schema level
// because PAYG rentals don't have a fixed end date or a return location.
// Regular-mode rentals enforce these in the submit handler via the isPayAsYouGo flag.
const rentalSchema = z.object({
  customer_id: z.string().min(1, "Customer is required"),
  vehicle_id: z.string().min(1, "Vehicle is required"),
  start_date: z.date({ required_error: "Start date is required", invalid_type_error: "Please select a valid start date" }),
  end_date: z.date({ invalid_type_error: "Please select a valid end date" }).optional(),
  rental_period_type: z.enum(["Daily", "Weekly", "Monthly"], { required_error: "Rental period type is required" }),
  monthly_amount: z.coerce.number({ invalid_type_error: "Please enter a valid rental amount" }).min(0.01, "Rental amount is required"),
  // New booking-aligned fields
  pickup_location: z.string().min(1, "Pickup location is required"),
  return_location: z.string().optional(),
  pickup_time: z.string().regex(/^\d{2}:\d{2}$/, "Pickup time is required"),
  // return_time: optional for PAYG (open-ended). Accept empty string OR valid HH:MM.
  // Regular mode enforces return_time in the submit handler.
  return_time: z.union([
    z.string().regex(/^\d{2}:\d{2}$/, "Return time is required"),
    z.literal(''),
  ]).optional(),
  driver_age: z.coerce.number({ invalid_type_error: "Please enter a valid driver age" }).min(1, "Driver age is required").max(200, "Driver age cannot exceed 200"),
  promo_code: z.string().optional(),
  insurance_status: z.enum(["pending", "uploaded", "verified", "bonzah", "not_required"]).optional(),
  notes: z.string().optional(),
});

type RentalFormData = z.infer<typeof rentalSchema>;

const CreateRental = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const renewFromId = searchParams?.get("renew_from");
  const { toast } = useToast();
  const { tenant } = useTenant();
  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'USD');
  const { balanceNumber: bonzahCdBalance, isBonzahConnected, portalUrl: bonzahPortalUrl, bonzahMode } = useBonzahBalance();
  const skipInsurance = !isBonzahConnected;
  const queryClient = useQueryClient();
  const { isManager, canEdit } = useManagerPermissions();
  const { logAction } = useAuditLog();
  const [loading, setLoading] = useState(false);
  const [creationProgress, setCreationProgress] = useState(0);
  const creationSteps = useMemo(() => [
    { label: 'Validating rental details' },
    { label: 'Creating rental record' },
    { label: 'Setting up insurance' },
    { label: 'Configuring pricing & charges' },
    { label: 'Sending agreement for signing' },
    { label: 'Sending notifications' },
    { label: 'Finalising rental' },
  ], []);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [promoCodeOpen, setPromoCodeOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  // Bonzah insurance state
  const [bonzahCoverage, setBonzahCoverage] = useState<CoverageOptions>({
    cdw: false, rcli: false, sli: false, pai: false,
  });
  const [bonzahKey, setBonzahKey] = useState(0);
  const [bonzahPremium, setBonzahPremium] = useState<number>(0);
  const [submitError, setSubmitError] = useState<string>("");
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictResult, setConflictResult] = useState<ConflictResult | null>(null);
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

  // Per-period rate state — admin edits rate, total is derived
  const [perPeriodRate, setPerPeriodRate] = useState<number | null>(null);

  // Fee override state — admin can override per-rental
  const [taxOverride, setTaxOverride] = useState<number | null>(null);
  const [showPricingBreakdown, setShowPricingBreakdown] = useState(false);
  const [serviceFeeOverride, setServiceFeeOverride] = useState<number | null>(null);
  const [depositOverride, setDepositOverride] = useState<number | null>(null);

  // Installment plan state
  const [installmentPlanType, setInstallmentPlanType] = useState<'full' | 'weekly' | 'monthly'>('full');
  const [installmentAmountOverride, setInstallmentAmountOverride] = useState<number | null>(null);

  // Pay As You Go state
  const [isPayAsYouGo, setIsPayAsYouGo] = useState(false);
  // Per-rental reminder interval override. null = use tenant default.
  const [paygReminderInterval, setPaygReminderInterval] = useState<number | null>(null);

  // Lockbox / delivery method state
  const [deliveryMethod, setDeliveryMethod] = useState<'in_person' | 'lockbox'>('in_person');
  const [lockboxCodeInput, setLockboxCodeInput] = useState('');

  // Pickup/Return location method state
  const [pickupMethod, setPickupMethod] = useState<LocationMethod>('fixed');
  const [returnMethod, setReturnMethod] = useState<LocationMethod>('fixed');
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [collectionFee, setCollectionFee] = useState<number>(0);
  const [deliveryFeeOverride, setDeliveryFeeOverride] = useState<number | null>(null);
  const [collectionFeeOverride, setCollectionFeeOverride] = useState<number | null>(null);
  const [pickupOutOfRadius, setPickupOutOfRadius] = useState(false);
  const [returnOutOfRadius, setReturnOutOfRadius] = useState(false);
  const [pickupIsCustom, setPickupIsCustom] = useState(false);
  const [returnIsCustom, setReturnIsCustom] = useState(false);

  // Mileage override state — admin can override per-rental
  const [dailyMileageOverride, setDailyMileageOverride] = useState<number | null>(null);
  const [weeklyMileageOverride, setWeeklyMileageOverride] = useState<number | null>(null);
  const [monthlyMileageOverride, setMonthlyMileageOverride] = useState<number | null>(null);
  const [excessRateOverride, setExcessRateOverride] = useState<number | null>(null);

  // Verification override state — admin can override document type per-rental
  const [verificationDocTypeOverride, setVerificationDocTypeOverride] = useState<string | null>(null);

  // Verification state
  const [creatingVerification, setCreatingVerification] = useState(false);
  const [cancelingVerification, setCancelingVerification] = useState(false);
  const [showCancelVerificationDialog, setShowCancelVerificationDialog] = useState(false);
  const [pendingVerificationAction, setPendingVerificationAction] = useState<"cancel" | "restart">("cancel");
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

  // Service fee calculation helper (supports fixed_amount and percentage)
  const calculateServiceFee = (baseAmount?: number): number => {
    if (!rentalSettings?.service_fee_enabled) return 0;
    const feeType = rentalSettings?.service_fee_type || 'fixed_amount';
    const feeValue = rentalSettings?.service_fee_value ?? rentalSettings?.service_fee_amount ?? 0;
    if (!feeValue) return 0;
    if (feeType === 'percentage') {
      const amount = baseAmount ?? 0;
      return (amount * feeValue) / 100;
    }
    return feeValue;
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
          : `${formatCurrency(data.value, tenant?.currency_code || 'USD')} discount will be applied`,
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

        // Admin portal only enforces global blocks — vehicle-specific blocks are informational only
        if (isGlobal) {
          console.log(`[BlockedDates] Rental blocked: ${startDate.toISOString()} - ${endDate.toISOString()} overlaps with ${block.start_date} - ${block.end_date} (global block)`);
          return {
            blocked: true,
            reason: block.reason || "General blocked period",
            isGlobal: true
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
      start_date: undefined as any,
      end_date: undefined as any,
      rental_period_type: "Monthly",
      monthly_amount: undefined,
      // New booking-aligned fields
      pickup_location: "",
      return_location: "",
      pickup_time: "",
      return_time: "",
      driver_age: undefined,
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

  // Fetch booked dates for the selected vehicle (Pending/Active rentals + 1 buffer day)
  const { bookedDatesArray: vehicleBookedDatesArray, bookedRentals: vehicleBookedRentals, occupancyMap, occupancyModifiers } = useVehicleBookedDates(selectedVehicleId || undefined);

  // Check if a date range would span across a booked rental period
  const wouldSpanBookedPeriod = (startDate: Date, endDate: Date): boolean => {
    if (!vehicleBookedRentals.length) return false;
    const normStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const normEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    for (const rental of vehicleBookedRentals) {
      const [sy, sm, sd] = rental.start_date.split("-").map(Number);
      const rStart = new Date(sy, sm - 1, sd);
      if (!rental.end_date) continue;
      const [ey, em, ed] = rental.end_date.split("-").map(Number);
      const rEnd = new Date(ey, em - 1, ed);
      // If a booked rental falls entirely within the proposed range, it spans across
      if (rStart > normStart && rEnd < normEnd) return true;
      // If the proposed range overlaps with a booked rental
      if (normStart <= rEnd && normEnd >= rStart) return true;
    }
    return false;
  };

  // Buffer time: check if selected vehicle has a recently completed rental still in cooldown
  const bufferMinutes = tenant?.buffer_time_minutes || 0;
  const { data: bufferWarning } = useQuery({
    queryKey: ['vehicle-buffer-check', tenant?.id, selectedVehicleId],
    queryFn: async () => {
      if (!selectedVehicleId || !tenant?.id || bufferMinutes <= 0) return null;

      // Get the most recent completed/closed rental for this vehicle
      const { data } = await supabase
        .from("rentals")
        .select("id, end_date, dropoff_time")
        .eq("tenant_id", tenant.id)
        .eq("vehicle_id", selectedVehicleId)
        .in("status", ["Completed", "Closed"])
        .order("end_date", { ascending: false })
        .limit(1)
        .single();

      if (!data) return null;

      const rentalEnd = new Date(`${data.end_date}T${data.dropoff_time || '23:59'}`);
      const bufferDeadline = new Date(rentalEnd.getTime() + bufferMinutes * 60 * 1000);
      const now = new Date();

      if (now < bufferDeadline) {
        const remainingMs = bufferDeadline.getTime() - now.getTime();
        const remainingMin = Math.ceil(remainingMs / 60000);
        return { inBuffer: true, remainingMin, bufferDeadline };
      }
      return null;
    },
    enabled: !!selectedVehicleId && !!tenant?.id && bufferMinutes > 0,
  });

  // Auto-determine rental period type from date range
  const mtd = tenant?.monthly_tier_days ?? 30;
  useEffect(() => {
    if (watchedStartDate && watchedEndDate) {
      const days = Math.max(1, differenceInDays(watchedEndDate, watchedStartDate));
      let periodType: "Daily" | "Weekly" | "Monthly";
      if (days >= mtd) {
        periodType = "Monthly";
      } else if (days >= 7) {
        periodType = "Weekly";
      } else {
        periodType = "Daily";
      }
      if (periodType !== watchedRentalPeriodType) {
        form.setValue("rental_period_type", periodType, { shouldValidate: true });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedStartDate?.getTime(), watchedEndDate?.getTime()]);
  const watchedInsuranceStatus = form.watch("insurance_status");
  const watchedDriverAge = form.watch("driver_age");

  // Reset insurance selection when customer changes
  const prevCustomerRef = useRef(selectedCustomerId);
  useEffect(() => {
    if (prevCustomerRef.current && prevCustomerRef.current !== selectedCustomerId) {
      setInsuranceDocId(null);
      form.setValue("insurance_status", "pending");
    }
    prevCustomerRef.current = selectedCustomerId;
  }, [selectedCustomerId]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Trigger validation after pre-filling so isValid updates correctly
    setTimeout(() => form.trigger(), 0);

    // If source had different pickup/return, uncheck sameAsPickup
    if (renewalSource.pickup_location && renewalSource.return_location &&
        renewalSource.pickup_location !== renewalSource.return_location) {
      setSameAsPickup(false);
    }
  }, [renewalSource]);

  // Persist form state to localStorage so it survives tab close/refresh
  const PORTAL_RENTAL_STORAGE_KEY = 'portal_new_rental_draft';
  const draftRestoredRef = useRef(false);

  // Restore saved draft on mount (skip if this is a renewal)
  useEffect(() => {
    if (renewFromId || draftRestoredRef.current) return;
    draftRestoredRef.current = true;

    try {
      const saved = localStorage.getItem(PORTAL_RENTAL_STORAGE_KEY);
      if (!saved) return;
      const draft = JSON.parse(saved);

      // Restore form values
      if (draft.customer_id) form.setValue("customer_id", draft.customer_id);
      if (draft.vehicle_id) form.setValue("vehicle_id", draft.vehicle_id);
      if (draft.start_date) {
        const savedStart = new Date(draft.start_date);
        if (!isBefore(savedStart, todayAtMidnight)) {
          form.setValue("start_date", savedStart);
          if (draft.end_date) {
            const savedEnd = new Date(draft.end_date);
            if (isAfter(savedEnd, savedStart)) {
              form.setValue("end_date", savedEnd);
            }
          }
        }
      }
      if (draft.rental_period_type) form.setValue("rental_period_type", draft.rental_period_type);
      if (draft.monthly_amount != null) form.setValue("monthly_amount", draft.monthly_amount);
      if (draft.pickup_location) form.setValue("pickup_location", draft.pickup_location);
      if (draft.return_location) form.setValue("return_location", draft.return_location);
      if (draft.pickup_time) form.setValue("pickup_time", draft.pickup_time);
      if (draft.return_time) form.setValue("return_time", draft.return_time);
      if (draft.driver_age) form.setValue("driver_age", draft.driver_age);
      if (draft.promo_code) form.setValue("promo_code", draft.promo_code);
      if (draft.insurance_status) form.setValue("insurance_status", draft.insurance_status);
      if (draft.notes) form.setValue("notes", draft.notes);

      // Restore non-form state
      if (draft.sameAsPickup === false) setSameAsPickup(false);
      if (draft.selectedExtras) setSelectedExtras(draft.selectedExtras);
      if (draft.pickupLocationId) setPickupLocationId(draft.pickupLocationId);
      if (draft.returnLocationId) setReturnLocationId(draft.returnLocationId);
    } catch {
      // Corrupted data — ignore
    }
  }, [renewFromId]);

  // Save form values to localStorage on change (debounced)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    // Don't save if this is a renewal or form hasn't been restored yet
    if (renewFromId) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const values = form.getValues();
      const draft = {
        customer_id: values.customer_id,
        vehicle_id: values.vehicle_id,
        start_date: null,
        end_date: null,
        rental_period_type: values.rental_period_type,
        monthly_amount: values.monthly_amount,
        pickup_location: values.pickup_location,
        return_location: values.return_location,
        pickup_time: values.pickup_time,
        return_time: values.return_time,
        driver_age: values.driver_age,
        promo_code: values.promo_code,
        insurance_status: values.insurance_status,
        notes: values.notes,
        sameAsPickup,
        selectedExtras,
        pickupLocationId,
        returnLocationId,
      };
      localStorage.setItem(PORTAL_RENTAL_STORAGE_KEY, JSON.stringify(draft));
    }, 500);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [
    selectedCustomerId, selectedVehicleId, watchedStartDate, watchedEndDate,
    watchedRentalPeriodType, watchedMonthlyAmount, watchedPickupLocation,
    watchedPromoCode, watchedInsuranceStatus, watchedDriverAge,
    sameAsPickup, selectedExtras, pickupLocationId, returnLocationId,
    renewFromId,
  ]);

  // Keep return_location synced with pickup_location when sameAsPickup is checked
  useEffect(() => {
    if (sameAsPickup && watchedPickupLocation) {
      form.setValue("return_location", watchedPickupLocation, { shouldValidate: true });
    }
  }, [sameAsPickup, watchedPickupLocation, form]);

  // Get customers and available vehicles
  const { data: customers } = useQuery({
    queryKey: ["customers-for-rental", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("customers")
        .select("id, name, email, phone")
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

  // Customer review summary + insurance for the selected customer
  const { data: reviewSummary } = useCustomerReviewSummary(selectedCustomerId || undefined);
  const { data: customerReviews } = useCustomerReviews(selectedCustomerId || undefined);
  const { data: customerInsurance } = useCustomerInsurance(selectedCustomerId || "");
  const { data: customerDocuments } = useCustomerDocuments(selectedCustomerId || "");

  const existingInsuranceDocs = useMemo(() => {
    if (!customerDocuments) return [];
    return customerDocuments.filter(doc => {
      if (doc.document_type !== 'Insurance Certificate') return false;
      const status = getDocumentStatus(doc.end_date);
      return status === 'Active' || status === 'Expires Soon' || status === 'Unknown';
    });
  }, [customerDocuments]);

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

  // Auto-fill driver age from customer's date of birth
  useEffect(() => {
    if (customerDetails?.date_of_birth) {
      const dob = new Date(customerDetails.date_of_birth);
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
      }
      if (age > 0 && age < 200) {
        form.setValue("driver_age", age, { shouldValidate: true });
      }
    }
  }, [customerDetails?.date_of_birth, form]);

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
  const isCustomerVerified = customerVerification?.review_result === "GREEN" || customerDetails?.identity_verification_status === "verified" || customerDetails?.identity_verification_status === "manually_verified";
  const verificationPending = customerVerification?.status === "pending" || customerVerification?.review_status === "pending";
  const verificationMode = tenant?.integration_veriff !== false ? "veriff" : "ai";

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles-for-rental", tenant?.id],
    queryFn: async () => {
      let query = (supabase as any)
        .from("vehicles")
        .select("id, reg, make, model, status, daily_rent, weekly_rent, monthly_rent, security_deposit, daily_mileage, weekly_mileage, monthly_mileage, excess_mileage_rate, current_mileage, lockbox_code");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Tag vehicles currently in buffer cooldown (admin can still select them)
      const bufferMinutes = (tenant as any)?.buffer_time_minutes || 0;
      if (bufferMinutes > 0 && data?.length > 0 && tenant?.id) {
        const vehicleIds = data.map((v: any) => v.id);
        const { data: recentRentals } = await (supabase as any)
          .from("rentals")
          .select("vehicle_id, end_date, return_time")
          .in("vehicle_id", vehicleIds)
          .in("status", ["Closed", "Active"])
          .order("end_date", { ascending: false });

        if (recentRentals?.length > 0) {
          const now = new Date();
          const bufferMs = bufferMinutes * 60 * 1000;
          const latestByVehicle: Record<string, any> = {};
          for (const r of recentRentals) {
            if (!latestByVehicle[r.vehicle_id]) latestByVehicle[r.vehicle_id] = r;
          }
          return data.map((v: any) => {
            const lastRental = latestByVehicle[v.id];
            if (!lastRental) return v;
            const rentalEnd = new Date(`${lastRental.end_date}T${lastRental.return_time || '23:59'}`);
            const bufferDeadline = new Date(rentalEnd.getTime() + bufferMs);
            return {
              ...v,
              _inBuffer: now < bufferDeadline,
              _bufferUntil: bufferDeadline.toISOString(),
            };
          });
        }
      }

      return data;
    },
    enabled: !!tenant,
  });

  // Fetch available promo codes for this tenant
  const { data: promoCodes } = useQuery({
    queryKey: ["promo-codes", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("promocodes")
        .select("id, code, type, value, expires_at")
        .eq("tenant_id", tenant!.id)
        .order("code", { ascending: true });
      if (error) throw error;
      // Filter out expired codes
      const now = new Date();
      return (data || []).filter((p: any) => !p.expires_at || new Date(p.expires_at) >= now);
    },
    enabled: !!tenant,
  });

  // Bonzah vehicle eligibility check
  const eligibilityVehicle = vehicles?.find(v => v.id === selectedVehicleId);
  const {
    isEligible: isBonzahEligible,
    isLoading: isBonzahEligibilityLoading,
  } = useBonzahVehicleEligibility({
    vehicleMake: eligibilityVehicle?.make || null,
    vehicleModel: eligibilityVehicle?.model || null,
    enabled: !skipInsurance && !!selectedVehicleId,
  });

  // Reset Bonzah state when vehicle is ineligible
  useEffect(() => {
    if (!isBonzahEligible && !isBonzahEligibilityLoading) {
      setBonzahCoverage({ cdw: false, rcli: false, sli: false, pai: false });
      setBonzahPremium(0);
    }
  }, [isBonzahEligible, isBonzahEligibilityLoading]);

  // Auto-populate per-period rate from selected vehicle when vehicle/dates change
  useEffect(() => {
    if (selectedVehicleId && vehicles && watchedStartDate && watchedEndDate) {
      const vehicle = vehicles.find(v => v.id === selectedVehicleId);
      if (!vehicle) return;

      const days = Math.max(1, differenceInDays(watchedEndDate, watchedStartDate));
      const dailyRent = vehicle.daily_rent || 0;
      const weeklyRent = vehicle.weekly_rent || 0;
      const monthlyRent = vehicle.monthly_rent || 0;

      // Determine tier and set the per-period rate from vehicle
      let rate: number | undefined;
      if (days >= mtd && monthlyRent > 0) {
        rate = monthlyRent;
      } else if (days >= 7 && days < mtd && weeklyRent > 0) {
        rate = weeklyRent;
      } else if (dailyRent > 0) {
        rate = dailyRent;
      } else if (weeklyRent > 0) {
        rate = weeklyRent;
      } else if (monthlyRent > 0) {
        rate = monthlyRent;
      }

      if (rate !== undefined) {
        setPerPeriodRate(rate);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId, watchedStartDate?.getTime(), watchedEndDate?.getTime(), vehicles]);

  // Compute total from per-period rate × duration (including dynamic pricing for daily tier)
  useEffect(() => {
    if (perPeriodRate === null || !selectedVehicleId || !vehicles || !watchedStartDate || !watchedEndDate) return;

    const vehicle = vehicles.find(v => v.id === selectedVehicleId);
    if (!vehicle) return;

    const days = Math.max(1, differenceInDays(watchedEndDate, watchedStartDate));
    const dailyRent = vehicle.daily_rent || 0;
    const weeklyRent = vehicle.weekly_rent || 0;
    const monthlyRent = vehicle.monthly_rent || 0;

    // Determine tier
    const tier = days >= mtd && monthlyRent > 0 ? 'monthly'
      : days >= 7 && days < mtd && weeklyRent > 0 ? 'weekly'
      : dailyRent > 0 ? 'daily'
      : weeklyRent > 0 ? 'weekly' : 'monthly';

    let amount: number;

    if (tier === 'monthly') {
      amount = Math.round(((days / mtd) * perPeriodRate) * 100) / 100;
    } else if (tier === 'weekly') {
      amount = Math.round(((days / 7) * perPeriodRate) * 100) / 100;
    } else {
      // Daily tier: use flat rate per day (surcharges not applied when rate is manually set)
      amount = Math.round((days * perPeriodRate) * 100) / 100;
    }

    if (amount !== watchedMonthlyAmount) {
      form.setValue("monthly_amount", amount, { shouldValidate: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perPeriodRate, selectedVehicleId, watchedStartDate?.getTime(), watchedEndDate?.getTime(), vehicles]);

  // Note: End date is no longer auto-calculated from period type since period type
  // is now auto-determined from the date range. The admin picks both start and end dates manually.

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
            ...(verificationDocTypeOverride ? { documentType: verificationDocTypeOverride } : {}),
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

  // Cancel the current pending verification session.
  // Marks the identity_verifications row as "canceled" so verificationPending becomes false,
  // and clears any in-flight AI QR/polling state. Returns true on success.
  const cancelVerificationSession = async (): Promise<boolean> => {
    if (!customerVerification?.id) return true;
    try {
      const { error } = await (supabase as any)
        .from("identity_verifications")
        .update({
          status: "canceled",
          review_status: "canceled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", customerVerification.id);
      if (error) throw error;

      // Stop any in-flight AI session UI
      setIsPolling(false);
      setShowQRModal(false);
      setAiSessionData(null);

      await refetchVerification();
      return true;
    } catch (error: any) {
      console.error("Error canceling verification:", error);
      sonnerToast.error(error.message || "Failed to cancel verification session");
      return false;
    }
  };

  // Handle Cancel button — confirms, then cancels the pending session
  const handleCancelVerification = async () => {
    setCancelingVerification(true);
    try {
      const ok = await cancelVerificationSession();
      if (ok) sonnerToast.success("Verification session canceled");
    } finally {
      setCancelingVerification(false);
      setShowCancelVerificationDialog(false);
    }
  };

  // Handle Restart button — cancels the pending session, then creates a fresh one
  const handleRestartVerification = async () => {
    setCancelingVerification(true);
    try {
      const ok = await cancelVerificationSession();
      if (!ok) return;
      // Kick off a new session (handleCreateVerification manages its own loading state)
      await handleCreateVerification();
    } finally {
      setCancelingVerification(false);
      setShowCancelVerificationDialog(false);
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
    setCreationProgress(1); // Step 1: Validating
    setSubmitError("");
    try {
      // Check customer verification (STRICT — always required)
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

      // PAYG vs regular mode validation
      // Regular rentals require end_date + return_location + return_time; PAYG does not.
      // PAYG requires pickup_time (anchor for the daily accrual window).
      if (!isPayAsYouGo) {
        if (!data.end_date) {
          throw new Error("End date is required");
        }
        const minEndDate = addDays(data.start_date, 1);
        if (!(isAfter(data.end_date, minEndDate) || data.end_date.getTime() === minEndDate.getTime())) {
          throw new Error("End date must be at least 1 day after start date");
        }
        if (!data.return_time || !/^\d{2}:\d{2}$/.test(data.return_time)) {
          throw new Error("Return time is required");
        }
        if (!sameAsPickup && (!data.return_location || data.return_location.trim() === '')) {
          throw new Error("Return location is required");
        }
      } else {
        // PAYG: pickup_time is the accrual anchor and must be present
        if (!data.pickup_time || !/^\d{2}:\d{2}$/.test(data.pickup_time)) {
          throw new Error("Pickup time is required for Pay-As-You-Go rentals");
        }
      }

      // Check for blocked dates (global and vehicle-specific) — fallback for local blocked dates state
      // Use start_date as both bounds for PAYG so we only block the start-day, not an open-ended range.
      const blockCheckEnd = data.end_date ?? data.start_date;
      const blockCheck = checkBlockedDatesOverlap(data.start_date, blockCheckEnd, data.vehicle_id);
      if (blockCheck.blocked) {
        const blockType = blockCheck.isGlobal ? "Global blocked period" : "Vehicle blocked";
        throw new Error(`Cannot create rental: ${blockType}. Reason: ${blockCheck.reason}`);
      }

      // Calculate discount if promo code was applied
      const discountAmount = promoDetails ? calculateDiscount(data.monthly_amount) : 0;

      // Calculate effective delivery/collection fees
      const effectiveDeliveryFee = deliveryFeeOverride !== null ? deliveryFeeOverride : deliveryFee;
      const effectiveCollectionFee = sameAsPickup ? 0 : (collectionFeeOverride !== null ? collectionFeeOverride : collectionFee);

      setCreationProgress(2); // Step 2: Creating rental record

      // Compute PAYG accrual anchor: start_date + pickup_time in the tenant's timezone.
      // R1 design: payg_next_accrual_at is the START timestamp of the day-window currently due
      // to be accrued (NOT start_ts + 24h). So day 1 accrues at start_ts itself (1pm 10 Apr →
      // $30). The cron loops while next_accrual_at <= now() and advances by 24h after each post.
      // This gates day 1 on the rental becoming Active (cron only picks status='Active' rows).
      //
      // CLAMP TO NOW: if the admin enters a backdated start (yesterday's date / past pickup_time),
      // we floor the anchor to the rental creation moment. Otherwise the cron's R2 catch-up loop
      // would post one accrual per missed window since the historical start_ts — fine in 24h prod
      // mode (a day or two of catch-up) but disastrous in 5-min test mode (hundreds of accruals
      // for a rental that was just created). Customers should never be billed for time before the
      // rental record existed; if back-billing is needed, admin records a manual charge instead.
      let paygStartTs: string | null = null;
      let paygNextAccrualAt: string | null = null;
      if (isPayAsYouGo && data.pickup_time) {
        const [hh, mm] = data.pickup_time.split(':').map(Number);
        const tz = tenant?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        // Build a date string in the tenant's timezone and convert to UTC
        const dateStr = data.start_date instanceof Date
          ? data.start_date.toISOString().split('T')[0]
          : String(data.start_date).split('T')[0];
        const localStr = `${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
        // Use Intl to compute the UTC offset for the tenant's timezone at this date/time
        const tentative = new Date(localStr + 'Z'); // treat as UTC first
        const utcFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const parts = utcFmt.formatToParts(tentative);
        const p = (type: string) => parts.find(p => p.type === type)?.value || '00';
        const tzLocal = new Date(`${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}Z`);
        const offsetMs = tzLocal.getTime() - tentative.getTime();
        const computedAnchor = new Date(tentative.getTime() - offsetMs);
        // Floor to "now" — backdated input never produces backdated accrual catch-up.
        const nowMs = Date.now();
        const anchor = new Date(Math.max(computedAnchor.getTime(), nowMs));
        paygStartTs = anchor.toISOString();
        // Day 1 is due at the (clamped) rental start time.
        paygNextAccrualAt = anchor.toISOString();
      }

      // For PAYG rentals we clear end_date + return fields and persist accrual metadata.
      // Use supabaseUntyped because some PAYG columns are not yet in generated types.
      const rentalInsertPayload: any = {
        customer_id: data.customer_id,
        vehicle_id: data.vehicle_id,
        start_date: data.start_date.toISOString().split('T')[0],
        // Regular: use form's end_date. PAYG: null (open-ended).
        end_date: isPayAsYouGo ? null : (data.end_date ? data.end_date.toISOString().split('T')[0] : null),
        rental_period_type: isPayAsYouGo ? "Daily" : data.rental_period_type,
        monthly_amount: data.monthly_amount,
        status: "Pending",
        document_status: "pending",
        source: "portal",
        tenant_id: tenant?.id,
        pickup_location: data.pickup_location || null,
        return_location: isPayAsYouGo ? null : (sameAsPickup ? data.pickup_location : data.return_location || null),
        pickup_location_id: pickupMethod === 'location' ? (pickupLocationId || null) : null,
        return_location_id: isPayAsYouGo
          ? null
          : (!sameAsPickup && returnMethod === 'location' ? (returnLocationId || null) : (sameAsPickup && pickupMethod === 'location' ? (pickupLocationId || null) : null)),
        pickup_time: data.pickup_time || null,
        return_time: isPayAsYouGo ? null : (data.return_time || null),
        driver_age_range: data.driver_age ? (data.driver_age < 25 ? 'under_25' : data.driver_age > 70 ? 'over_70' : '25_70') : null,
        promo_code: promoDetails?.code || null,
        discount_applied: discountAmount > 0 ? discountAmount : null,
        // PAYG: Bonzah insurance is not offered per the product spec; force "pending" if PAYG.
        insurance_status: isPayAsYouGo ? "pending" : (bonzahPremium > 0 ? "bonzah" : (data.insurance_status || "pending")),
        insurance_premium: isPayAsYouGo ? null : (bonzahPremium > 0 ? bonzahPremium : null),
        renewed_from_rental_id: renewFromId || null,
        delivery_method: rentalSettings?.lockbox_enabled ? deliveryMethod : null,
        delivery_fee: effectiveDeliveryFee > 0 ? effectiveDeliveryFee : null,
        collection_fee: isPayAsYouGo ? null : (effectiveCollectionFee > 0 ? effectiveCollectionFee : null),
        delivery_option: pickupMethod,
        daily_mileage_override: dailyMileageOverride,
        weekly_mileage_override: weeklyMileageOverride,
        monthly_mileage_override: monthlyMileageOverride,
        excess_mileage_rate_override: excessRateOverride,
        has_installment_plan: !isPayAsYouGo && installmentPlanType !== 'full' && rentalSettings?.installments_enabled,
        is_pay_as_you_go: isPayAsYouGo,
        // PAYG accrual state (nullable — only set when PAYG)
        payg_start_ts: paygStartTs,
        payg_next_accrual_at: paygNextAccrualAt,
        payg_accrual_day_count: 0,
        payg_reminder_count: 0,
        payg_paused: false,
        // Per-rental reminder interval override (null = use tenant default)
        payg_reminder_interval_days: isPayAsYouGo ? paygReminderInterval : null,
      };

      // Create rental with Pending status (will become Active after DocuSign)
      const { data: rental, error: rentalError } = await supabaseUntyped
        .from("rentals")
        .insert(rentalInsertPayload)
        .select()
        .single();

      if (rentalError) throw rentalError;

      // Save lockbox code to the vehicle if one was entered
      if (deliveryMethod === 'lockbox' && lockboxCodeInput && data.vehicle_id) {
        await (supabase as any)
          .from('vehicles')
          .update({ lockbox_code: lockboxCodeInput })
          .eq('id', data.vehicle_id);
      }

      setCreationProgress(3); // Step 3: Setting up insurance

      // Create Bonzah insurance quote if coverage was selected
      const hasBonzahCoverage = bonzahCoverage.cdw || bonzahCoverage.rcli || bonzahCoverage.sli || bonzahCoverage.pai;
      if (hasBonzahCoverage && bonzahPremium > 0 && tenant?.id) {
        try {
          // Get customer details for the quote
          const customer = customerDetails;

          // Use verification data for accurate name/DOB (matches buy-insurance-dialog flow)
          const verification = customerVerification;
          const nameParts = (customer?.name || 'N/A').split(' ');
          const firstName = verification?.first_name || nameParts[0] || 'N/A';
          const lastName = verification?.last_name || nameParts.slice(1).join(' ') || 'N/A';
          const dob = customer?.date_of_birth;

          if (!dob) {
            toast({
              title: 'Missing Information',
              description: 'Customer must have a date of birth on file before purchasing insurance. Complete identity verification first.',
              variant: 'destructive',
            });
            // Skip insurance but don't fail rental creation
          } else {
            const custState = customer?.address_state || 'FL';
            const { data: quoteResult, error: quoteError } = await supabase.functions.invoke('bonzah-create-quote', {
              body: {
                rental_id: rental.id,
                customer_id: data.customer_id,
                tenant_id: tenant.id,
                trip_dates: {
                  start: (() => {
                    const d = data.start_date.toISOString().split('T')[0];
                    const today = new Date().toISOString().split('T')[0];
                    return d < today ? today : d;
                  })(),
                  end: data.end_date.toISOString().split('T')[0],
                },
                pickup_state: custState,
                coverage: bonzahCoverage,
                renter: {
                  first_name: firstName,
                  last_name: lastName,
                  dob: dob,
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
              let errMsg = quoteError.message || 'Unknown error';
              try {
                if (quoteError.context instanceof Response) {
                  const body = await quoteError.context.json();
                  errMsg = body?.error || body?.message || errMsg;
                }
              } catch { /* ignore */ }
              toast({
                title: 'Insurance Quote Failed',
                description: errMsg.replace(/^Bonzah API error:\s*/gi, ''),
                variant: 'destructive',
              });
              // Don't proceed to confirm if quote failed
            } else {
              // Step 2: Confirm payment to activate the policy
              const policyRecordId = quoteResult?.policy_record_id;
              if (policyRecordId) {
                const { data: confirmResult, error: confirmError } = await supabase.functions.invoke('bonzah-confirm-payment', {
                  body: {
                    policy_record_id: policyRecordId,
                    stripe_payment_intent_id: `portal-admin-${rental.id}`,
                  },
                });
                if (confirmError) {
                  console.error('[Bonzah] Payment confirmation failed:', confirmError);
                  let errMsg = confirmError.message || 'Unknown error';
                  try {
                    if (confirmError.context instanceof Response) {
                      const body = await confirmError.context.json();
                      errMsg = body?.error || body?.message || errMsg;
                    }
                  } catch { /* ignore */ }
                  toast({
                    title: 'Insurance Activation Failed',
                    description: `Quote created but activation failed: ${errMsg.replace(/^Bonzah API error:\s*/gi, '')}. You can retry from the rental detail page.`,
                    variant: 'destructive',
                  });
                } else if (confirmResult?.policy_issued) {
                  console.log('[Bonzah] Policy activated:', confirmResult.policy_no);
                }

                // Step 3: Create ledger entry for insurance charge (matches buy-insurance-dialog).
                // entry_date/due_date must match rental.start_date so the ux_rental_charge_unique
                // index (rental_id, due_date, type, category, extension_id) collides with the
                // Insurance row that generate_first_charge_for_rental inserts a moment later —
                // otherwise two Insurance charges end up on the same rental.
                const insuranceChargeDate = rental.start_date;
                const { error: ledgerError } = await supabase
                  .from('ledger_entries')
                  .insert({
                    type: 'Charge',
                    category: 'Insurance',
                    amount: bonzahPremium,
                    remaining_amount: bonzahPremium,
                    reference: `BONZAH-${policyRecordId}`,
                    rental_id: rental.id,
                    customer_id: data.customer_id,
                    vehicle_id: data.vehicle_id,
                    tenant_id: tenant.id,
                    entry_date: insuranceChargeDate,
                    due_date: insuranceChargeDate,
                  });

                if (ledgerError) {
                  console.error('[Bonzah] Ledger entry error:', ledgerError);
                }
              }
            }
          }
        } catch (bonzahError) {
          console.error('[Bonzah] Error creating quote:', bonzahError);
          // Non-fatal — rental is already created
        }
      }

      setCreationProgress(4); // Step 4: Configuring pricing & charges

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
          message: `${formatCurrency(data.monthly_amount, tenant?.currency_code || 'USD')} payment due for rental of ${selectedVehicle?.make} ${selectedVehicle?.model} (${vehicleReg}). Due date: ${dueDate}.`,
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

      // Calculate pricing — shared by both invoice and installment plan creation
      const discountedAmount = data.monthly_amount - discountAmount;
      const taxAmount = taxOverride !== null ? taxOverride : calculateTaxAmount(discountedAmount);
      const serviceFee = serviceFeeOverride !== null ? serviceFeeOverride : calculateServiceFee(discountedAmount);
      const securityDeposit = depositOverride !== null ? depositOverride : calculateSecurityDeposit(data.vehicle_id);
      const insurancePremium = bonzahPremium > 0 ? bonzahPremium : 0;
      const extrasTotal = Object.entries(selectedExtras).reduce((sum, [id, qty]) => {
        if (qty <= 0) return sum;
        const extra = activeExtras?.find((e: RentalExtra) => e.id === id);
        return sum + (extra ? Number(extra.price) * qty : 0);
      }, 0);
      const totalAmount = discountedAmount + taxAmount + serviceFee + securityDeposit + insurancePremium + effectiveDeliveryFee + effectiveCollectionFee + extrasTotal;

      // Track if this is an installment rental (used for routing after creation)
      const isInstallmentRental = installmentPlanType !== 'full' && rentalSettings?.installments_enabled;

      // Generate invoice — REQUIRED for payment breakdown to work.
      // PAYG rentals skip the upfront invoice entirely: charges are accrued daily by the cron,
      // not pre-billed. Creating an invoice here causes apply-payment to retroactively materialise
      // Tax/Service Fee/Insurance/Delivery/Extras charges from the invoice, which then collide
      // with daily accruals.
      const invoiceNotes = `Monthly rental fee for ${selectedVehicle?.make} ${selectedVehicle?.model} (${vehicleReg})`;

      if (!isPayAsYouGo) {
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
          delivery_fee: effectiveDeliveryFee,
          extras_total: extrasTotal,
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
      }

      // Generate charges split by category (uses invoice breakdown created above).
      // Skip for PAYG — the accrual cron handles daily charge generation instead.
      if (!isPayAsYouGo) {
        const { error: chargeError } = await supabase.rpc("generate_first_charge_for_rental", {
          rental_id_param: rental.id
        });

        if (chargeError) {
          console.error("Error generating charges:", chargeError);
          // Don't throw - rental is already created, charges can be created manually
        }
      }

      // Create installment plan if selected
      if (installmentPlanType !== 'full' && rentalSettings?.installments_enabled && rentalSettings?.installment_config) {
        try {
          const instConfig = rentalSettings.installment_config;
          const whatGetsSplit = instConfig.what_gets_split || 'rental_only';
          const chargeFirst = instConfig.charge_first_upfront !== false;

          let installableAmt = discountedAmount;
          if (whatGetsSplit === 'rental_tax' || whatGetsSplit === 'rental_tax_extras') {
            installableAmt += taxAmount;
          }

          const rentalDaysCalc = differenceInDays(data.end_date, data.start_date);
          let numInstallments = 1;
          if (installmentPlanType === 'weekly') {
            numInstallments = instConfig.weekly_installments_limit ?? instConfig.max_installments_weekly ?? 4;
          } else if (installmentPlanType === 'monthly') {
            numInstallments = instConfig.monthly_installments_limit ?? instConfig.max_installments_monthly ?? 6;
          }

          const autoInstAmt = Math.floor((installableAmt / numInstallments) * 100) / 100;
          const effectiveInstAmt = installmentAmountOverride !== null ? installmentAmountOverride : autoInstAmt;
          const firstAmt = chargeFirst ? effectiveInstAmt : 0;
          const scheduledCount = chargeFirst ? numInstallments - 1 : numInstallments;

          // Create installment plan record
          const { data: plan, error: planError } = await (supabase as any)
            .from('installment_plans')
            .insert({
              rental_id: rental.id,
              tenant_id: tenant?.id,
              customer_id: data.customer_id,
              plan_type: installmentPlanType,
              total_installable_amount: installableAmt,
              number_of_installments: numInstallments,
              installment_amount: effectiveInstAmt,
              upfront_amount: securityDeposit + serviceFee + (whatGetsSplit === 'rental_only' ? taxAmount : 0) + firstAmt,
              upfront_paid: false,
              status: 'pending',
              paid_installments: 0,
              total_paid: 0,
              next_due_date: (installmentPlanType === 'weekly'
                ? addWeeks(data.start_date, 1)
                : addMonths(data.start_date, 1)
              ).toISOString().split('T')[0],
              config: {
                charge_first_upfront: chargeFirst,
                what_gets_split: whatGetsSplit,
                grace_period_days: instConfig.grace_period_days ?? 3,
                max_retry_attempts: instConfig.max_retry_attempts ?? 3,
                retry_interval_days: instConfig.retry_interval_days ?? 1,
              },
            })
            .select()
            .single();

          if (planError) {
            console.error('Error creating installment plan:', planError);
          } else if (plan) {
            // Create scheduled installments
            const installments = Array.from({ length: numInstallments }, (_, i) => {
              const isFirst = i === 0;
              const isLast = i === numInstallments - 1;
              const dueDate = installmentPlanType === 'weekly'
                ? addWeeks(data.start_date, chargeFirst ? i : i + 1)
                : addMonths(data.start_date, chargeFirst ? i : i + 1);
              const lastAmt = Math.round((installableAmt - (effectiveInstAmt * (numInstallments - 1))) * 100) / 100;

              return {
                installment_plan_id: plan.id,
                tenant_id: tenant?.id,
                rental_id: rental.id,
                customer_id: data.customer_id,
                installment_number: i + 1,
                amount: isLast ? lastAmt : effectiveInstAmt,
                due_date: dueDate.toISOString().split('T')[0],
                status: 'scheduled',
                failure_count: 0,
              };
            });

            const { error: schedError } = await (supabase as any)
              .from('scheduled_installments')
              .insert(installments);

            if (schedError) {
              console.error('Error creating scheduled installments:', schedError);
            }

            // Link plan to rental
            await supabase
              .from('rentals')
              .update({ installment_plan_id: plan.id } as any)
              .eq('id', rental.id);

          }
        } catch (installmentError) {
          console.error('Error setting up installment plan:', installmentError);
          // Non-fatal — rental is already created
        }
      }

      setCreationProgress(6); // Step 6: Sending notifications

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

      setCreationProgress(5); // Step 5: Sending agreement

      // Auto-trigger eSign via portal API route (BoldSign)
      let docuSignSuccess = false;
      try {
        const docuSignResponse = await fetch("/api/esign", {
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
          console.warn("eSign error:", docuSignData);
          toast({
            title: "Rental Created - Agreement Pending",
            description: `Rental created but agreement failed to send. You can retry from the rental details page.`,
            variant: "default",
          });
        } else {
          docuSignSuccess = true;
          // The API route already updates the rental with document ID
          toast({
            title: "Rental Created - Agreement Sent",
            description: `Rental created for ${customerName} • ${vehicleReg}. Agreement sent to customer for signing.`,
          });
        }
      } catch (docuSignErr: any) {
        console.warn("Error sending agreement:", docuSignErr);
        toast({
          title: "Rental Created - Agreement Pending",
          description: `Rental created but agreement failed to send. You can retry from the rental details page.`,
          variant: "default",
        });
      }

      setCreationProgress(7); // Step 7: Finalising rental

      // Clear the persisted draft since rental was created successfully
      localStorage.removeItem(PORTAL_RENTAL_STORAGE_KEY);

      logAction({ action: "rental_created", entityType: "rental", entityId: rental.id, details: { rental_number: rental.rental_number, customer_id: data.customer_id, vehicle_id: data.vehicle_id } });

      // Build breakdown items for payment dialog (must match Rental Preview)
      const breakdownForPayment: { label: string; amount: number; type?: 'discount' | 'normal' }[] = [];
      breakdownForPayment.push({ label: 'Rental Amount', amount: data.monthly_amount });
      if (discountAmount > 0) {
        breakdownForPayment.push({ label: `Discount${promoDetails?.code ? ` (${promoDetails.code})` : ''}`, amount: discountAmount, type: 'discount' });
      }
      if (taxAmount > 0) breakdownForPayment.push({ label: `Tax (${rentalSettings?.tax_percentage || 0}%)`, amount: taxAmount });
      if (serviceFee > 0) breakdownForPayment.push({ label: 'Service Fee', amount: serviceFee });
      if (insurancePremium > 0) breakdownForPayment.push({ label: 'Insurance', amount: insurancePremium });
      // Add extras individually
      Object.entries(selectedExtras).forEach(([extraId, qty]) => {
        if (qty <= 0) return;
        const extra = activeExtras.find(e => e.id === extraId);
        if (!extra) return;
        breakdownForPayment.push({ label: `${extra.name}${qty > 1 ? ` ×${qty}` : ''}`, amount: Number(extra.price) * qty });
      });
      if (effectiveDeliveryFee > 0) breakdownForPayment.push({ label: 'Delivery Fee', amount: effectiveDeliveryFee });
      if (!sameAsPickup && effectiveCollectionFee > 0) breakdownForPayment.push({ label: 'Collection Fee', amount: effectiveCollectionFee });
      if (securityDeposit > 0) breakdownForPayment.push({ label: 'Pre-Authorization', amount: securityDeposit });

      // Store rental data for invoice dialog
      setCreatedRentalData({
        rental,
        customer: selectedCustomer,
        vehicle: selectedVehicle,
        formData: data,
        docuSignSuccess,
        breakdownItems: breakdownForPayment,
      });

      // Show completion state briefly
      setCreationProgress(creationSteps.length + 1);
      await new Promise(resolve => setTimeout(resolve, 600));
      setCreationProgress(0);

      // If installment plan was selected, skip payment/invoice dialogs — go straight to rental detail.
      // PAYG also skips: there is no upfront amount to collect — charges accrue daily.
      if (isInstallmentRental) {
        toast({
          title: "Rental Created with Installment Plan",
          description: `${installmentPlanType === 'weekly' ? 'Weekly' : 'Monthly'} installment plan created for ${customerName} • ${vehicleReg}`,
        });
        router.push(`/rentals/${rental.id}`);
      } else if (isPayAsYouGo) {
        toast({
          title: "Pay-As-You-Go Rental Created",
          description: `Daily accrual will start from ${rental.start_date}. View the ledger on the rental detail page.`,
        });
        router.push(`/rentals/${rental.id}`);
      } else {
        // Show payment options dialog for full-payment rentals
        setShowPaymentDialog(true);
      }
    } catch (error: any) {
      console.error("Error creating rental:", error);
      setCreationProgress(0);

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

  // Soft warnings for booking notice & rental duration limits (matching booking-side logic)
  const leadTimeHours = rentalSettings?.booking_lead_time_hours ?? 24;
  const leadTimeUnit = rentalSettings?.booking_lead_time_unit ?? 'hours';
  const minRentalHours = Math.max(1, ((rentalSettings?.min_rental_days ?? 0) * 24) + (rentalSettings?.min_rental_hours ?? 1));
  const maxRentalDays = rentalSettings?.max_rental_days ?? 90;

  // Booking lead time warning
  const leadTimeWarning = (() => {
    if (!watchedStartDate || leadTimeHours <= 0) return null;
    const pickupTime = form.getValues("pickup_time") || "10:00";
    const pickup = new Date(`${format(watchedStartDate, "yyyy-MM-dd")}T${pickupTime}`);
    const now = new Date();
    const hoursUntilPickup = (pickup.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntilPickup < leadTimeHours) {
      const display = leadTimeUnit === 'days'
        ? `${Math.round(leadTimeHours / 24)} day${Math.round(leadTimeHours / 24) !== 1 ? 's' : ''}`
        : `${leadTimeHours} hour${leadTimeHours !== 1 ? 's' : ''}`;
      return `Pickup is within the minimum booking notice of ${display}`;
    }
    return null;
  })();

  // Min rental duration warning
  const minDurationWarning = (() => {
    if (!watchedStartDate || !watchedEndDate) return null;
    const pickupTime = form.getValues("pickup_time") || "10:00";
    const returnTime = form.getValues("return_time") || "10:00";
    const pickup = new Date(`${format(watchedStartDate, "yyyy-MM-dd")}T${pickupTime}`);
    const returnDt = new Date(`${format(watchedEndDate, "yyyy-MM-dd")}T${returnTime}`);
    const hoursDiff = (returnDt.getTime() - pickup.getTime()) / (1000 * 60 * 60);
    if (hoursDiff < minRentalHours) {
      const days = Math.floor(minRentalHours / 24);
      const hours = minRentalHours % 24;
      const parts: string[] = [];
      if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
      if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
      return `Rental duration is below the minimum of ${parts.join(' ')}`;
    }
    return null;
  })();

  // Max rental duration warning
  const maxDurationWarning = (() => {
    if (!watchedStartDate || !watchedEndDate) return null;
    const daysDiff = differenceInDays(watchedEndDate, watchedStartDate);
    if (daysDiff > maxRentalDays) {
      return `Rental duration exceeds the maximum of ${maxRentalDays} day${maxRentalDays !== 1 ? 's' : ''}`;
    }
    return null;
  })();

  // Redirect managers without edit permission
  useEffect(() => {
    if (isManager && !canEdit('rentals')) {
      router.push('/rentals');
    }
  }, [isManager, canEdit, router]);

  if (isManager && !canEdit('rentals')) return null;

  // Dev-only: auto-fill form with test data for quick manual testing
  const handleDevAutoFill = () => {
    if (process.env.NODE_ENV !== 'development') return;

    // Pick test customer by email, fallback to first available
    const customer = customers?.find(c => c.email === 'bscs21028@itu.edu.pk') || customers?.[0];

    // Pick a Bonzah-eligible vehicle (full exclusion list from bonzah-check-vehicle-eligibility)
    const BONZAH_EXCLUDED_BRANDS = [
      'alfa romeo', 'aston martin', 'auburn', 'avanti', 'bentley', 'bertone',
      'bmc/leyland', 'bmw', 'bradley', 'bricklin', 'bugatti', 'clenet',
      'cosworth', 'de lorean', 'excalibre', 'ferrari', 'iso', 'jaguar',
      'jensen healy', 'koenigsegg', 'lamborghini', 'lancia', 'lotus',
      'maserati', 'maybach', 'mclaren', 'mg', 'morgan', 'pagani', 'pantera',
      'panther', 'pininfarina', 'porsche', 'rolls royce', 'rover', 'stutz',
      'sterling', 'triumph', 'tvr',
    ];
    // Model-specific exclusions (brand is allowed but these models are not)
    const isBonzahExcludedModel = (make: string, model: string) => {
      const m = make?.toLowerCase();
      const mod = model?.toLowerCase() || '';
      if (m === 'mercedes' && (mod.includes('amg') || mod.includes('g-wagon') || mod.includes('g-class') || mod.includes('s-class'))) return true;
      if (m === 'chevrolet' && mod.includes('corvette')) return true;
      if (m === 'tesla' && mod.includes('cybertruck')) return true;
      return false;
    };
    const isBonzahEligible = (v: any) =>
      !BONZAH_EXCLUDED_BRANDS.includes((v.make || '').toLowerCase().trim()) &&
      !isBonzahExcludedModel(v.make || '', v.model || '');

    // Prefer safe brands (Toyota, Honda, Ford, etc.) then fall back to any eligible
    const SAFE_BRANDS = ['toyota', 'honda', 'ford', 'hyundai', 'kia', 'volkswagen', 'nissan', 'mazda', 'subaru'];
    const vehicle = vehicles?.find(v =>
      SAFE_BRANDS.includes((v.make || '').toLowerCase().trim())
    ) || vehicles?.find(v => isBonzahEligible(v)) || vehicles?.[0];

    if (!customer || !vehicle) {
      toast({ title: "No data", description: "Need at least 1 customer and 1 vehicle to auto-fill", variant: "destructive" });
      return;
    }

    const startDate = new Date();
    const endDate = addMonths(startDate, 1);

    form.setValue("customer_id", customer.id, { shouldValidate: true });
    form.setValue("vehicle_id", vehicle.id, { shouldValidate: true });
    form.setValue("start_date", startDate, { shouldValidate: true });
    form.setValue("end_date", endDate, { shouldValidate: true });
    form.setValue("rental_period_type", "Monthly", { shouldValidate: true });
    // Location: "Our Location" (fixed) for both, not same as pickup, $20 each
    setPickupMethod('fixed');
    setReturnMethod('fixed');
    setSameAsPickup(false);
    form.setValue("pickup_location", "Office Pickup", { shouldValidate: true });
    form.setValue("return_location", "Office Return", { shouldValidate: true });
    setDeliveryFeeOverride(20);
    setCollectionFeeOverride(20);
    form.setValue("pickup_time", "09:00", { shouldValidate: true });
    form.setValue("return_time", "09:00", { shouldValidate: true });
    form.setValue("driver_age", 30, { shouldValidate: true });
    // Bonzah insurance: CDW only — bump key to force remount with new initialCoverage
    form.setValue("insurance_status", "bonzah", { shouldValidate: true });
    setBonzahCoverage({ cdw: true, rcli: false, sli: false, pai: false });
    setBonzahKey(k => k + 1);

    // Extras: select first available extra with quantity 1
    if (activeExtras && activeExtras.length > 0) {
      setSelectedExtras({ [activeExtras[0].id]: 1 });
    }

    // Mileage overrides: 100 mi/month, $1/mi excess
    setMonthlyMileageOverride(100);
    setExcessRateOverride(1);

    // Notes
    form.setValue("notes", "test note from ghulam", { shouldValidate: true });

    // Auto-apply promo code OFF20
    form.setValue("promo_code", "OFF20", { shouldValidate: true });
    validatePromoCode("OFF20");

    // Set per-period rate after a tick so the vehicle auto-calc effect doesn't overwrite it
    setTimeout(() => {
      setPerPeriodRate(100);
    }, 300);

    toast({ title: "Form auto-filled", description: `${customer.name} → ${vehicle.make} ${vehicle.model} (${vehicle.reg})` });
  };

  // Dev-only: reset form to blank state
  const handleDevClear = () => {
    if (process.env.NODE_ENV !== 'development') return;

    form.reset();
    setSelectedExtras({});
    setBonzahCoverage({ cdw: false, rcli: false, sli: false, pai: false });
    setBonzahPremium(0);
    setBonzahKey(k => k + 1);
    setPerPeriodRate(null);
    setPromoDetails(null);
    setPromoError(null);
    setTaxOverride(null);
    setServiceFeeOverride(null);
    setDepositOverride(null);
    setDeliveryFeeOverride(null);
    setCollectionFeeOverride(null);
    setDailyMileageOverride(null);
    setWeeklyMileageOverride(null);
    setMonthlyMileageOverride(null);
    setExcessRateOverride(null);
    setInstallmentPlanType('full');
    setInstallmentAmountOverride(null);
    setDeliveryMethod('in_person');
    setLockboxCodeInput('');
    setPickupMethod('fixed');
    setReturnMethod('fixed');
    setSameAsPickup(true);
    setPickupIsCustom(false);
    setReturnIsCustom(false);
    setInsuranceDocId(null);

    toast({ title: "Form cleared" });
  };

  return (
    <>
    <RentalProgressOverlay
      isVisible={creationProgress > 0}
      currentStep={creationProgress}
      steps={creationSteps}
    />
    <div className="container mx-auto px-4 py-6 md:px-6 md:py-8 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/rentals")}
          className="shrink-0 rounded-xl h-10 w-10"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {renewalSource ? "Renew Rental" : "New Rental Agreement"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {renewalSource ? "Continue from a previous rental" : "Set up a new rental agreement for a customer"}
          </p>
        </div>
        {process.env.NODE_ENV === 'development' && (
          <div className="flex gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDevAutoFill}
              className="border-dashed border-yellow-500 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-950/20"
            >
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              Auto-fill
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDevClear}
              className="border-dashed border-red-400 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* Renewal Banner */}
      {renewalSource && (
        <Alert className="mb-2 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
          <RefreshCw className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-blue-700 dark:text-blue-400">
            Renewing from rental for <strong>{renewalSource.customers?.name}</strong> — {renewalSource.vehicles?.make} {renewalSource.vehicles?.model} ({renewalSource.vehicles?.reg})
          </AlertDescription>
        </Alert>
      )}

      <div className="lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        <div className="lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
          {/* Submit Error Alert */}
          {submitError && (
            <Alert variant="destructive" className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form className="lg:flex-1 lg:min-h-0 lg:flex lg:flex-col" onSubmit={form.handleSubmit(onSubmit, (errors) => {
              const fieldErrors = Object.entries(errors).map(([key, e]) => ({ key, message: e?.message })).filter(e => e.message);
              toast({
                title: `${fieldErrors.length} missing field${fieldErrors.length > 1 ? 's' : ''}`,
                description: (
                  <ul className="list-disc pl-4 space-y-0.5 mt-1 text-sm">
                    {fieldErrors.map((e, i) => <li key={i}>{e.message}</li>)}
                  </ul>
                ),
                variant: "destructive",
              });
              // Scroll to the first invalid field
              setTimeout(() => {
                const firstInvalid = document.querySelector('[aria-invalid="true"]');
                if (firstInvalid) {
                  firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  if (firstInvalid instanceof HTMLElement) firstInvalid.focus();
                }
              }, 50);
            })}>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:flex-1 lg:min-h-0">
            {/* ── Left: Scrollable Form ─────────────────────── */}
            <div className="lg:col-span-3 lg:overflow-y-auto lg:pr-2 space-y-6 lg:flex lg:flex-col lg:min-h-0">
              {/* ── Section 1: Customer & Vehicle ──────────────────────────── */}
              <div className="rounded-xl border bg-card shadow-sm">
                <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                  <span className="text-2xl font-extrabold text-primary">1.</span>
                  <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">Customer & Vehicle</h2>
                </div>
                <div className="p-5">
                    <FormField
                      control={form.control}
                      name="customer_id"
                      render={({ field }) => {
                        const selectedCustomerOption = customers?.find((c: any) => c.id === field.value);
                        return (
                          <FormItem className="flex flex-col">
                            <div className="flex items-center justify-between">
                              <FormLabel>Customer <span className="text-red-500">*</span></FormLabel>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-auto py-0.5 px-2 text-xs text-primary hover:text-primary/80"
                                onClick={() => setInviteDialogOpen(true)}
                              >
                                <Link2 className="h-3 w-3 mr-1" />
                                Invite Link
                              </Button>
                            </div>
                            <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={customerOpen}
                                    className={cn(
                                      "w-full justify-between font-normal",
                                      !field.value && "text-muted-foreground",
                                      form.formState.errors.customer_id && "border-destructive"
                                    )}
                                  >
                                    {selectedCustomerOption ? (
                                      <span className="truncate">
                                        {selectedCustomerOption.name}
                                      </span>
                                    ) : (
                                      "Select customer"
                                    )}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                <Command>
                                  <CommandInput placeholder="Search by name or email..." />
                                  <CommandList>
                                    <CommandEmpty>No customer found.</CommandEmpty>
                                    <CommandGroup>
                                      {customers?.map((customer: any) => {
                                        const contact = customer.email || customer.phone;
                                        return (
                                          <CommandItem
                                            key={customer.id}
                                            value={`${customer.name} ${customer.email || ''} ${customer.phone || ''}`}
                                            onSelect={() => {
                                              field.onChange(customer.id);
                                              setCustomerOpen(false);
                                            }}
                                          >
                                            <Check
                                              className={cn(
                                                "mr-2 h-4 w-4",
                                                field.value === customer.id ? "opacity-100" : "opacity-0"
                                              )}
                                            />
                                            <div className="flex flex-col gap-0.5">
                                              <span className="font-medium">{customer.name}</span>
                                              {contact && <span className="text-xs text-muted-foreground">{contact}</span>}
                                            </div>
                                          </CommandItem>
                                        );
                                      })}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />

                  {/* Customer Verification */}
                  {selectedCustomerId && (
                    <div className="space-y-4 p-4 border rounded-lg bg-muted/30 mt-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Shield className="h-5 w-5 text-primary" />
                          <h3 className="font-medium">Identity Verification</h3>
                          <span className="text-sm text-muted-foreground">
                            ({verificationMode === "ai" ? "AI Verification" : "Veriff"})
                          </span>
                        </div>
                        {isCustomerVerified ? (
                          <Badge variant="default" className="bg-green-500 hover:bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Verified</Badge>
                        ) : verificationPending ? (
                          <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500 text-amber-600"><AlertTriangle className="h-3 w-3 mr-1" />Not Verified</Badge>
                        )}
                      </div>

                      {/* Document Type Override */}
                      <div className="space-y-2">
                        <Label className="text-xs font-medium text-muted-foreground">Required Document</Label>
                        <Select value={verificationDocTypeOverride || (rentalSettings as any)?.verification_document_type || 'driving_license'} onValueChange={(value) => { const tenantDefault = (rentalSettings as any)?.verification_document_type || 'driving_license'; setVerificationDocTypeOverride(value === tenantDefault ? null : value); }}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="driving_license">Driver&apos;s License</SelectItem>
                            <SelectItem value="passport">Passport</SelectItem>
                            <SelectItem value="id_card">ID Card</SelectItem>
                          </SelectContent>
                        </Select>
                        {verificationDocTypeOverride && (
                          <p className="text-[10px] text-amber-500">Overridden for this rental (default: {{ driving_license: "Driver's License", passport: "Passport", id_card: "ID Card" }[(rentalSettings as any)?.verification_document_type || 'driving_license'] || "Driver's License"})</p>
                        )}
                      </div>

                      {/* DOB Warning */}
                      {customerDetails && !customerDetails.date_of_birth && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">Customer date of birth is not set. This may be required for identity verification.</p>
                      )}

                      {isCustomerVerified ? (
                        <div className="text-sm text-muted-foreground">
                          <p>Customer identity has been verified.</p>
                          {customerVerification?.first_name && customerVerification?.last_name && (<p className="mt-1">Name: {customerVerification.first_name} {customerVerification.last_name}</p>)}
                        </div>
                      ) : verificationPending ? (
                        <div className="space-y-3">
                          <Alert variant="default" className="border-blue-500 bg-blue-50">
                            <Clock className="h-4 w-4 text-blue-600" />
                            <AlertDescription className="text-blue-700">
                              Verification session in progress. If the customer can&apos;t complete it, you can cancel or restart the session.
                            </AlertDescription>
                          </Alert>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="flex-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                              disabled={cancelingVerification || creatingVerification}
                              onClick={() => {
                                setPendingVerificationAction("cancel");
                                setShowCancelVerificationDialog(true);
                              }}
                            >
                              {cancelingVerification && pendingVerificationAction === "cancel" ? (
                                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Canceling...</>
                              ) : (
                                <><XCircle className="h-4 w-4 mr-2" />Cancel Session</>
                              )}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="flex-1 border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
                              disabled={cancelingVerification || creatingVerification}
                              onClick={() => {
                                setPendingVerificationAction("restart");
                                setShowCancelVerificationDialog(true);
                              }}
                            >
                              {(cancelingVerification && pendingVerificationAction === "restart") || creatingVerification ? (
                                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Restarting...</>
                              ) : (
                                <><RefreshCw className="h-4 w-4 mr-2" />Restart Session</>
                              )}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <Alert variant="destructive"><XCircle className="h-4 w-4" /><AlertDescription>Customer must complete identity verification before rental can be created.</AlertDescription></Alert>
                          <Button type="button" onClick={handleCreateVerification} disabled={creatingVerification} className="w-full">
                            {creatingVerification ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating Session...</>) : (<><Shield className="h-4 w-4 mr-2" />Start Verification</>)}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Customer Reviews */}
                  {selectedCustomerId && (
                    <div className="p-4 border rounded-lg bg-muted/30 space-y-3 mt-5">
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4 text-amber-500" />
                        <h3 className="font-medium text-sm">Customer Reviews</h3>
                      </div>

                      {reviewSummary ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              {Array.from({ length: 10 }, (_, i) => (
                                <div
                                  key={i}
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    i < Math.round(reviewSummary.average_rating || 0)
                                      ? "bg-amber-500"
                                      : "bg-muted-foreground/20"
                                  )}
                                />
                              ))}
                            </div>
                            <span className="text-sm font-semibold">
                              {(reviewSummary.average_rating || 0).toFixed(1)}/10
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ({reviewSummary.total_reviews} {reviewSummary.total_reviews === 1 ? 'review' : 'reviews'})
                            </span>
                          </div>
                          {reviewSummary.summary && (
                            <p className="text-xs text-muted-foreground leading-relaxed italic">
                              "{reviewSummary.summary}"
                            </p>
                          )}
                          {customerReviews && customerReviews.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {[...new Set(customerReviews.flatMap(r => r.tags))].slice(0, 6).map(tag => (
                                <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : customerReviews && customerReviews.length > 0 ? (
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">
                            {customerReviews.length} {customerReviews.length === 1 ? 'review' : 'reviews'} — avg{' '}
                            {(customerReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / customerReviews.length).toFixed(1)}/10
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {[...new Set(customerReviews.flatMap(r => r.tags))].slice(0, 6).map(tag => (
                              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No reviews yet. Reviews will appear here after completed rentals are reviewed.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Driver Age — auto-filled from DOB, editable as override */}
                  {selectedCustomerId && (
                    <div className="mt-5">
                      <FormField
                        control={form.control}
                        name="driver_age"
                        render={({ field }) => {
                          const minAge = rentalSettings?.minimum_rental_age || 18;
                          const hasDob = !!customerDetails?.date_of_birth;
                          const belowMinimum = field.value != null && field.value < minAge;
                          return (
                            <FormItem>
                              <FormLabel>Driver Age <span className="text-red-500">*</span></FormLabel>
                              <div className="flex items-center gap-3">
                                <FormControl>
                                  <Input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="Enter driver age"
                                    className="max-w-[200px]"
                                    value={field.value ?? ""}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === "" || /^\d*$/.test(val)) {
                                        field.onChange(val === "" ? undefined : parseInt(val));
                                      }
                                    }}
                                  />
                                </FormControl>
                                {hasDob && (
                                  <span className="text-xs text-muted-foreground">Auto-filled from date of birth</span>
                                )}
                              </div>
                              {belowMinimum && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">
                                  Driver is below the minimum rental age of {minAge}.
                                </p>
                              )}
                              <FormMessage />
                            </FormItem>
                          );
                        }}
                      />
                    </div>
                  )}

                  {/* ── Vehicle ───────────────────────────── */}
                  <div className="border-t mt-5 pt-5">
                    <FormField
                      control={form.control}
                      name="vehicle_id"
                      render={({ field }) => {
                        const selectedVehicleOption = vehicles?.find((v: any) => v.id === field.value);
                        return (
                          <FormItem className="flex flex-col">
                            <FormLabel>Vehicle <span className="text-red-500">*</span></FormLabel>
                            <Popover open={vehicleOpen} onOpenChange={setVehicleOpen}>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={vehicleOpen}
                                    className={cn(
                                      "w-full justify-between font-normal",
                                      !field.value && "text-muted-foreground",
                                      form.formState.errors.vehicle_id && "border-destructive"
                                    )}
                                  >
                                    {selectedVehicleOption ? (
                                      <span className="truncate">
                                        {selectedVehicleOption.reg} — {selectedVehicleOption.make} {selectedVehicleOption.model}
                                      </span>
                                    ) : (
                                      "Select vehicle"
                                    )}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                <Command>
                                  <CommandInput placeholder="Search by make or model..." />
                                  <CommandList>
                                    <CommandEmpty>No vehicle found.</CommandEmpty>
                                    <CommandGroup>
                                      {vehicles?.map((vehicle: any) => (
                                        <CommandItem
                                          key={vehicle.id}
                                          value={`${vehicle.reg} ${vehicle.make} ${vehicle.model}`}
                                          onSelect={() => {
                                            field.onChange(vehicle.id);
                                            setVehicleOpen(false);
                                            setDailyMileageOverride(null);
                                            setWeeklyMileageOverride(null);
                                            setMonthlyMileageOverride(null);
                                            setExcessRateOverride(null);
                                            setLockboxCodeInput(vehicle.lockbox_code || '');
                                            // Reset dates when vehicle changes so user picks dates valid for this vehicle
                                            form.setValue("start_date", undefined as any);
                                            form.setValue("end_date", undefined as any);
                                          }}
                                        >
                                          <Check
                                            className={cn(
                                              "mr-2 h-4 w-4",
                                              field.value === vehicle.id ? "opacity-100" : "opacity-0"
                                            )}
                                          />
                                          <div className="flex flex-col gap-0.5 flex-1">
                                            <div className="flex items-center gap-2">
                                              <span className="font-medium">{vehicle.reg}</span>
                                              {vehicle.status && vehicle.status !== "Available" && vehicle.status !== "Rented" && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">{vehicle.status}</span>
                                              )}
                                              {vehicle._inBuffer && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">Buffer</span>
                                              )}
                                            </div>
                                            <span className="text-xs text-muted-foreground">{vehicle.make} {vehicle.model}</span>
                                          </div>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                            <FormDescription className="flex items-center gap-2">
                              Booked dates will be disabled in the calendar
                            </FormDescription>
                            {bufferWarning?.inBuffer && field.value && (
                              <Alert variant="default" className="mt-2 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                                <AlertTriangle className="h-4 w-4 text-amber-500" />
                                <AlertDescription className="text-amber-700 dark:text-amber-400 text-sm">
                                  Buffer time for this vehicle hasn't ended yet — {bufferWarning.remainingMin} min remaining. Available after {new Date(bufferWarning.bufferDeadline).toLocaleString()}. You can still proceed if needed.
                                </AlertDescription>
                              </Alert>
                            )}
                            {(() => {
                              const selectedVehicle = vehicles?.find(v => v.id === field.value);
                              if (!selectedVehicle) return null;
                              const rates = [
                                { label: "Daily", value: selectedVehicle.daily_rent },
                                { label: "Weekly", value: selectedVehicle.weekly_rent },
                                { label: "Monthly", value: selectedVehicle.monthly_rent },
                              ].filter(r => r.value && r.value > 0);
                              if (rates.length === 0) return null;
                              const cur = tenant?.currency_code || 'USD';
                              return (
                                <div className="flex gap-2 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                  {rates.map(r => (
                                    <div key={r.label} className="flex-1 rounded-lg border bg-muted/40 px-3 py-2 text-center">
                                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{r.label}</p>
                                      <p className="text-sm font-bold text-foreground mt-0.5">{formatCurrency(r.value!, cur)}</p>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </FormItem>
                        );
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* ── Payment Mode: Regular vs Pay As You Go (positioned after Customer & Vehicle) ──────── */}
              {rentalSettings?.pay_as_you_go_enabled && selectedVehicleId && (
                <div className="rounded-xl border bg-card shadow-sm">
                  <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                    <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/20 text-primary">
                      <CreditCard className="h-4 w-4" />
                    </div>
                    <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">Payment Mode</h2>
                  </div>
                  <div className="p-5 space-y-4">
                    <RadioGroup
                      value={isPayAsYouGo ? 'payg' : 'regular'}
                      onValueChange={(val) => {
                        setIsPayAsYouGo(val === 'payg');
                        if (val === 'payg') {
                          setInstallmentPlanType('full');
                          setInstallmentAmountOverride(null);
                          // R6: clear any promo state — promo codes are not used for PAYG
                          form.setValue('promo_code', '');
                          setPromoDetails(null);
                          setPromoError(null);
                          // Clear end_date and return_time for PAYG (open-ended)
                          form.setValue('end_date', undefined as any);
                          form.setValue('return_time', undefined as any);
                          form.setValue('return_location', '');
                          form.setValue('rental_period_type', 'Daily');
                          // PAYG bills only the daily rental rate (+ tax/service fee on it) via the accrual cron.
                          // Bonzah insurance, extras, delivery/collection fees, and uploaded insurance docs
                          // do not belong on a PAYG rental — clear any state the user may have set so it
                          // never leaks into the rental insert payload or the (skipped) invoice.
                          setBonzahCoverage({ cdw: false, rcli: false, sli: false, pai: false });
                          setBonzahPremium(0);
                          setSelectedExtras({});
                          setDeliveryFeeOverride(0);
                          setCollectionFeeOverride(0);
                          setInsuranceDocId(null);
                          // Auto-fill per-period rate with daily_rent from the selected vehicle
                          const vehicle = vehicles?.find((v: any) => v.id === selectedVehicleId);
                          if (vehicle) {
                            setPerPeriodRate(vehicle.daily_rent || 0);
                          }
                        }
                      }}
                      className="space-y-2"
                    >
                      <label className={cn("flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors", !isPayAsYouGo ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                        <RadioGroupItem value="regular" />
                        <div>
                          <span className="text-sm font-medium">Regular</span>
                          <p className="text-xs text-muted-foreground">Standard payment — pay upfront or via installments</p>
                        </div>
                      </label>
                      <label className={cn("flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors", isPayAsYouGo ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                        <RadioGroupItem value="payg" />
                        <div>
                          <span className="text-sm font-medium">Pay As You Go</span>
                          <p className="text-xs text-muted-foreground">Rental amount, tax, and percentage-based service fees are paid incrementally</p>
                        </div>
                      </label>
                    </RadioGroup>

                    {isPayAsYouGo && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Reminder Interval (days)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          placeholder={`Default: ${(rentalSettings as any)?.payg_reminder_interval_days ?? 4}`}
                          value={paygReminderInterval ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setPaygReminderInterval(null);
                            } else {
                              const n = parseInt(val);
                              setPaygReminderInterval(isNaN(n) ? null : Math.max(1, Math.min(365, n)));
                            }
                          }}
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave empty to use the tenant default (
                          {(rentalSettings as any)?.payg_reminder_interval_days ?? 4} days).
                          Reminders fire after a {(rentalSettings as any)?.payg_grace_period_days ?? 2}-day grace period, then every N days while there is an outstanding balance.
                        </p>
                      </div>
                    )}

                    {isPayAsYouGo && (() => {
                      const currency = tenant?.currency_code || 'USD';
                      const rentalAmount = watchedMonthlyAmount || 0;
                      const discountAmt = promoDetails ? calculateDiscount(rentalAmount) : 0;
                      const discounted = rentalAmount - discountAmt;
                      const tax = taxOverride !== null ? taxOverride : calculateTaxAmount(discounted);
                      const serviceFee = serviceFeeOverride !== null ? serviceFeeOverride : calculateServiceFee(discounted);
                      const deposit = depositOverride !== null ? depositOverride : calculateSecurityDeposit(form.getValues("vehicle_id"));
                      const isServiceFeePercentage = rentalSettings?.service_fee_type === 'percentage';
                      const isServiceFeeEnabled = rentalSettings?.service_fee_enabled && serviceFee > 0;

                      const paygItems: { label: string; amount: number }[] = [
                        { label: 'Rental Amount', amount: discounted },
                      ];
                      if (rentalSettings?.tax_enabled && tax > 0) {
                        paygItems.push({ label: `Tax (${rentalSettings.tax_percentage}%)`, amount: tax });
                      }
                      if (isServiceFeeEnabled && isServiceFeePercentage) {
                        paygItems.push({ label: `Service Fee (${rentalSettings?.service_fee_value}%)`, amount: serviceFee });
                      }
                      const paygTotal = paygItems.reduce((s, i) => s + i.amount, 0);

                      const normalItems: { label: string; amount: number }[] = [];
                      if (isServiceFeeEnabled && !isServiceFeePercentage) {
                        normalItems.push({ label: 'Service Fee (fixed)', amount: serviceFee });
                      }
                      if (rentalSettings?.security_deposit_enabled && deposit > 0) {
                        normalItems.push({ label: 'Pre-Authorization', amount: deposit });
                      }

                      return (
                        <div className="mt-3 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 space-y-3">
                          <div className="flex items-start gap-2">
                            <Info className="h-4 w-4 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">How Pay As You Go works</p>
                              <p className="text-xs text-muted-foreground">
                                The customer pays the rental charges incrementally over time instead of upfront. You record each payment as it comes in from the rental detail page.
                              </p>
                            </div>
                          </div>

                          {discounted > 0 && (
                            <div className="space-y-2 pt-2 border-t border-indigo-200/60 dark:border-indigo-800/60">
                              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">Paid Incrementally (PAYG)</p>
                              {paygItems.map(item => (
                                <div key={item.label} className="flex justify-between text-sm">
                                  <span className="text-muted-foreground">{item.label}</span>
                                  <span className="font-medium">{formatCurrency(item.amount, currency)}</span>
                                </div>
                              ))}
                              <div className="flex justify-between text-sm font-semibold border-t border-indigo-200/60 dark:border-indigo-800/60 pt-1.5">
                                <span className="text-indigo-700 dark:text-indigo-300">PAYG Total</span>
                                <span className="text-indigo-700 dark:text-indigo-300">{formatCurrency(paygTotal, currency)}</span>
                              </div>

                              {normalItems.length > 0 && (
                                <>
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Charged Separately</p>
                                  {normalItems.map(item => (
                                    <div key={item.label} className="flex justify-between text-sm">
                                      <span className="text-muted-foreground">{item.label}</span>
                                      <span className="font-medium">{formatCurrency(item.amount, currency)}</span>
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* ── Section 2: Rental Period & Pricing ────────────── */}
              <div className="rounded-xl border bg-card shadow-sm">
                <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                  <span className="text-2xl font-extrabold text-primary">2.</span>
                  <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">Rental Period & Pricing</h2>
                </div>
                <div className="p-5 space-y-5">
                  {/* Dates first — period type is auto-determined from date range */}
                  <div className="space-y-2">
                    <FormLabel>Rental Dates <span className="text-red-500">*</span></FormLabel>
                    <RentalDateRangePicker
                      startDate={watchedStartDate}
                      endDate={watchedEndDate}
                      onStartDateChange={(date) => {
                        form.setValue("start_date", date as Date, { shouldValidate: true });
                        // If end date is now before or equal to new start date, reset it
                        const currentEnd = form.getValues("end_date");
                        if (date && currentEnd && !isAfter(currentEnd, addDays(date, 1)) && currentEnd.getTime() !== addDays(date, 1).getTime()) {
                          form.setValue("end_date", addDays(date, 1), { shouldValidate: true });
                        }
                      }}
                      onEndDateChange={(date) => {
                        form.setValue("end_date", date as Date, { shouldValidate: true });
                      }}
                      disableDate={(date) => {
                        if (isBefore(date, yearAgo)) return true;
                        return false;
                      }}
                      occupancyMap={occupancyMap}
                      occupancyModifiers={occupancyModifiers}
                      error={!!form.formState.errors.start_date || !!form.formState.errors.end_date}
                    />
                    {isPastStartDate && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">
                        Start date is in the past
                      </p>
                    )}
                    {leadTimeWarning && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">
                        {leadTimeWarning}. Admin override allowed.
                      </p>
                    )}
                    {watchedStartDate && watchedEndDate && (
                      <p className="text-xs text-muted-foreground">
                        {Math.max(1, differenceInDays(watchedEndDate, watchedStartDate))} days
                      </p>
                    )}
                    {minDurationWarning && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">
                        {minDurationWarning}. Admin override allowed.
                      </p>
                    )}
                    {maxDurationWarning && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">
                        {maxDurationWarning}. Admin override allowed.
                      </p>
                    )}
                    {form.formState.errors.start_date && (
                      <p className="text-sm text-destructive">{form.formState.errors.start_date.message}</p>
                    )}
                    {form.formState.errors.end_date && (
                      <p className="text-sm text-destructive">{form.formState.errors.end_date.message}</p>
                    )}
                  </div>

                  {/* Times */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="pickup_time"
                      render={({ field }) => (
                        <FormItem className={isPayAsYouGo ? 'md:col-span-2' : ''}>
                          <FormLabel>Pickup Time <span className="text-red-500">*</span></FormLabel>
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
                    {!isPayAsYouGo && <FormField
                      control={form.control}
                      name="return_time"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Return Time <span className="text-red-500">*</span></FormLabel>
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
                    />}
                  </div>

                  {/* Rental Period Type — auto-determined, read-only display */}
                  <div className="grid grid-cols-1 gap-4">
                    <FormField
                      control={form.control}
                      name="rental_period_type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Rental Period Type</FormLabel>
                          <FormControl>
                            <div className={cn(
                              "flex h-10 w-full items-center rounded-md border border-input bg-muted/50 px-3 py-2 text-sm cursor-not-allowed",
                            )}>
                              <Badge variant="outline" className="font-medium">
                                {field.value}
                              </Badge>
                              <span className="ml-2 text-muted-foreground text-xs">
                                Auto-determined from date range
                              </span>
                            </div>
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Blocked period warning - check full date range overlap */}
                  {watchedStartDate && watchedEndDate && selectedVehicleId && (() => {
                    const blockCheck = checkBlockedDatesOverlap(watchedStartDate, watchedEndDate, selectedVehicleId);
                    if (!blockCheck.blocked) return null;
                    return (
                      <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-1.5">
                        <span className="font-medium">{blockCheck.isGlobal ? 'Global blocked period' : 'Vehicle blocked'}:</span>{' '}
                        {blockCheck.reason}. Please choose different dates.
                      </p>
                    );
                  })()}
                </div>
              </div>

              {/* ── Section 2b: Pricing & Fees (combined) ────────────── */}
              {(() => {
                const rentalAmount = watchedMonthlyAmount || 0;
                const discountAmt = promoDetails ? calculateDiscount(rentalAmount) : 0;
                const discountedAmount = rentalAmount - discountAmt;

                const autoTax = Math.round(calculateTaxAmount(discountedAmount) * 100) / 100;
                const autoServiceFee = Math.round(calculateServiceFee(discountedAmount) * 100) / 100;
                const autoDeposit = calculateSecurityDeposit(form.getValues("vehicle_id"));

                const showTax = rentalSettings?.tax_enabled && (rentalSettings?.tax_percentage ?? 0) > 0;
                const showServiceFee = rentalSettings?.service_fee_enabled && autoServiceFee > 0;
                const showDeposit = autoDeposit > 0;

                const effDeliveryFee = deliveryFeeOverride !== null ? deliveryFeeOverride : deliveryFee;
                const effCollectionFee = sameAsPickup ? 0 : (collectionFeeOverride !== null ? collectionFeeOverride : collectionFee);
                const showDeliveryFees = effDeliveryFee > 0 || effCollectionFee > 0;
                const hasFees = showTax || showServiceFee || showDeposit || showDeliveryFees;

                const effectiveTax = taxOverride !== null ? taxOverride : autoTax;
                const effectiveServiceFee = serviceFeeOverride !== null ? serviceFeeOverride : autoServiceFee;
                const effectiveDeposit = depositOverride !== null ? depositOverride : autoDeposit;
                const feesTotal = (showTax ? effectiveTax : 0) + (showServiceFee ? effectiveServiceFee : 0) + (showDeposit ? effectiveDeposit : 0) + effDeliveryFee + (sameAsPickup ? 0 : effCollectionFee);
                const grandTotal = discountedAmount + feesTotal + bonzahPremium;
                const currency = tenant?.currency_code || 'USD';
                const feeType = rentalSettings?.service_fee_type || 'fixed_amount';
                const feeValue = rentalSettings?.service_fee_value ?? rentalSettings?.service_fee_amount ?? 0;
                const hasOverrides = taxOverride !== null || serviceFeeOverride !== null || depositOverride !== null || deliveryFeeOverride !== null || collectionFeeOverride !== null;

                const periodType = watchedRentalPeriodType || "Monthly";
                const rateLabel = periodType === "Daily" ? "Daily Rate" :
                  periodType === "Weekly" ? "Weekly Rate" : "Monthly Rate";

                return (
                  <div className="rounded-xl border bg-card shadow-sm">
                    <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/20 text-primary">
                        <Banknote className="h-4 w-4" />
                      </div>
                      <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">Pricing & Fees</h2>
                    </div>
                    <div className="p-5 space-y-5">
                      {/* Rate + Total side by side */}
                      <FormField
                        control={form.control}
                        name="monthly_amount"
                        render={({ field }) => {
                          const vehicle = vehicles?.find(v => v.id === selectedVehicleId);
                          const days = watchedStartDate && watchedEndDate
                            ? Math.max(1, differenceInDays(watchedEndDate, watchedStartDate))
                            : 0;

                          return (
                          <FormItem className="space-y-3">
                          <div className="grid grid-cols-2 gap-4">
                            <FormItem>
                              <FormLabel>{rateLabel} <span className="text-red-500">*</span></FormLabel>
                              <FormControl>
                                <CurrencyInput
                                  value={perPeriodRate ?? 0}
                                  onChange={(val: number) => setPerPeriodRate(val)}
                                  placeholder="Rate per period"
                                  min={0.01}
                                  step={0.01}
                                  error={!!form.formState.errors.monthly_amount}
                                  currencySymbol={currencySymbol}
                                  disabled={false}
                                />
                              </FormControl>
                              <FormDescription>
                                Auto-filled from vehicle rates.
                              </FormDescription>
                            </FormItem>
                            <div>
                              <label className="text-sm font-medium leading-none">
                                Total Amount
                              </label>
                              <div className="mt-2">
                                <CurrencyInput
                                  value={watchedMonthlyAmount || 0}
                                  onChange={() => {}}
                                  placeholder="Total amount"
                                  currencySymbol={currencySymbol}
                                  disabled={true}
                                />
                              </div>
                              <p className="text-[0.8rem] text-muted-foreground mt-1.5">
                                {rateLabel.toLowerCase()} &times; duration
                              </p>
                            </div>
                          </div>
                          {vehicle && days > 0 && (
                            <button
                              type="button"
                              onClick={() => setShowPricingBreakdown(!showPricingBreakdown)}
                              className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
                            >
                              <Info className="h-3 w-3" />
                              {showPricingBreakdown ? 'Hide' : 'How is this calculated?'}
                            </button>
                          )}
                            {showPricingBreakdown && vehicle && days > 0 && (() => {
                              const dailyRent = vehicle.daily_rent || 0;
                              const weeklyRent = vehicle.weekly_rent || 0;
                              const monthlyRent = vehicle.monthly_rent || 0;
                              const tier = days >= mtd && monthlyRent > 0 ? 'monthly'
                                : days >= 7 && days < mtd && weeklyRent > 0 ? 'weekly'
                                : dailyRent > 0 ? 'daily'
                                : weeklyRent > 0 ? 'weekly' : 'monthly';

                              // Count weekend/holiday days for daily tier
                              let weekendDays = 0;
                              let holidayDays = 0;
                              let regularDays = 0;
                              if (tier === 'daily' && watchedStartDate) {
                                for (let i = 0; i < days; i++) {
                                  const currentDate = addDays(watchedStartDate, i);
                                  const dayOfWeek = currentDate.getDay();
                                  const holiday = tenantHolidays.find(h => {
                                    const dateStr = format(currentDate, 'yyyy-MM-dd');
                                    if (h.excluded_vehicle_ids?.includes(selectedVehicleId!)) return false;
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
                                    holidayDays++;
                                  } else if (weekendPricingSettings.weekend_surcharge_percent > 0 && weekendPricingSettings.weekend_days?.includes(dayOfWeek)) {
                                    weekendDays++;
                                  } else {
                                    regularDays++;
                                  }
                                }
                              }

                              return (
                                <div className="mt-2 p-3 rounded-lg bg-muted/50 border text-xs space-y-2 animate-in slide-in-from-top-2 duration-200">
                                  <p className="font-medium text-foreground text-sm">Pricing Breakdown</p>
                                  <div className="space-y-1.5 text-muted-foreground">
                                    <div className="flex justify-between">
                                      <span>Vehicle</span>
                                      <span className="font-medium text-foreground">{vehicle.make} {vehicle.model} ({vehicle.reg})</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Duration</span>
                                      <span className="font-medium text-foreground">{days} day{days !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Pricing Tier</span>
                                      <Badge variant="outline" className="text-[10px] h-5 capitalize">{tier}</Badge>
                                    </div>
                                    <div className="border-t my-1.5" />
                                    {tier === 'monthly' && (
                                      <>
                                        <div className="flex justify-between">
                                          <span>Monthly Rate</span>
                                          <span>{formatCurrency(monthlyRent, currency)}/month</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>Formula</span>
                                          <span>({days} days &divide; 30) &times; {formatCurrency(monthlyRent, currency)}</span>
                                        </div>
                                      </>
                                    )}
                                    {tier === 'weekly' && (
                                      <>
                                        <div className="flex justify-between">
                                          <span>Weekly Rate</span>
                                          <span>{formatCurrency(weeklyRent, currency)}/week</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span>Formula</span>
                                          <span>({days} days &divide; 7) &times; {formatCurrency(weeklyRent, currency)}</span>
                                        </div>
                                      </>
                                    )}
                                    {tier === 'daily' && (
                                      <>
                                        <div className="flex justify-between">
                                          <span>Daily Rate</span>
                                          <span>{formatCurrency(dailyRent, currency)}/day</span>
                                        </div>
                                        {regularDays > 0 && (
                                          <div className="flex justify-between">
                                            <span>Regular days</span>
                                            <span>{regularDays} &times; {formatCurrency(dailyRent, currency)} = {formatCurrency(regularDays * dailyRent, currency)}</span>
                                          </div>
                                        )}
                                        {weekendDays > 0 && (
                                          <div className="flex justify-between text-amber-600 dark:text-amber-400">
                                            <span>Weekend days (+{weekendPricingSettings.weekend_surcharge_percent}%)</span>
                                            <span>{weekendDays} &times; {formatCurrency(dailyRent * (1 + weekendPricingSettings.weekend_surcharge_percent / 100), currency)} = {formatCurrency(weekendDays * dailyRent * (1 + weekendPricingSettings.weekend_surcharge_percent / 100), currency)}</span>
                                          </div>
                                        )}
                                        {holidayDays > 0 && (
                                          <div className="flex justify-between text-orange-600 dark:text-orange-400">
                                            <span>Holiday days (surcharge applied)</span>
                                            <span>{holidayDays} day{holidayDays !== 1 ? 's' : ''} with holiday pricing</span>
                                          </div>
                                        )}
                                      </>
                                    )}
                                    <div className="border-t my-1.5" />
                                    {(() => {
                                      // Compute the auto-calculated amount to compare with field value
                                      let autoTotal = 0;
                                      if (tier === 'daily' && dailyRent > 0) {
                                        let t = 0;
                                        const s = new Date(watchedStartDate!);
                                        for (let i = 0; i < days; i++) {
                                          const d = new Date(s);
                                          d.setDate(d.getDate() + i);
                                          const dow = d.getDay();
                                          const isWeekend = weekendPricingSettings.weekend_surcharge_percent > 0 && weekendPricingSettings.weekend_days?.includes(dow);
                                          t += isWeekend ? dailyRent * (1 + weekendPricingSettings.weekend_surcharge_percent / 100) : dailyRent;
                                        }
                                        autoTotal = Math.round(t * 100) / 100;
                                      } else if (tier === 'weekly' && weeklyRent > 0) {
                                        autoTotal = Math.round(((days / 7) * weeklyRent) * 100) / 100;
                                      } else if (tier === 'monthly' && monthlyRent > 0) {
                                        autoTotal = Math.round(((days / mtd) * monthlyRent) * 100) / 100;
                                      }
                                      const isOverridden = autoTotal > 0 && Math.abs((field.value || 0) - autoTotal) > 0.01;
                                      return (
                                        <>
                                          <div className="flex justify-between font-medium text-foreground">
                                            <span>Auto-Calculated</span>
                                            <span className={isOverridden ? 'line-through text-muted-foreground' : ''}>{formatCurrency(autoTotal, currency)}</span>
                                          </div>
                                          {isOverridden && (
                                            <div className="flex justify-between font-medium text-amber-600 dark:text-amber-400">
                                              <span>Admin Override</span>
                                              <span>{formatCurrency(field.value || 0, currency)}</span>
                                            </div>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>
                              );
                            })()}
                            <FormMessage />
                          </FormItem>
                          );
                        }}
                      />

                      {/* Promo Code (hidden for PAYG — R6: open-ended rentals can't meaningfully apply discounts) */}
                      {!isPayAsYouGo && <FormField
                        control={form.control}
                        name="promo_code"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel>Promo Code</FormLabel>
                            <div className="flex gap-2">
                              <Popover open={promoCodeOpen} onOpenChange={setPromoCodeOpen}>
                                <PopoverTrigger asChild>
                                  <FormControl>
                                    <Button
                                      variant="outline"
                                      role="combobox"
                                      aria-expanded={promoCodeOpen}
                                      className={cn(
                                        "flex-1 justify-between font-normal",
                                        !field.value && "text-muted-foreground",
                                        promoError ? "border-destructive" : promoDetails ? "border-green-500" : ""
                                      )}
                                    >
                                      {field.value || "Select promo code"}
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                  </FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-[300px] p-0" align="start">
                                  <Command>
                                    <CommandInput placeholder="Search promo codes..." />
                                    <CommandList>
                                      <CommandEmpty>No promo codes found</CommandEmpty>
                                      <CommandGroup>
                                        {promoCodes?.map((promo: any) => (
                                          <CommandItem
                                            key={promo.id}
                                            value={promo.code}
                                            onSelect={() => {
                                              field.onChange(promo.code);
                                              setPromoCodeOpen(false);
                                              setPromoError(null);
                                              setPromoDetails(null);
                                              // Auto-validate the selected promo code
                                              validatePromoCode(promo.code);
                                            }}
                                          >
                                            <div className="flex flex-col">
                                              <span className="font-medium">{promo.code}</span>
                                              <span className="text-xs text-muted-foreground">
                                                {promo.type === 'percentage'
                                                  ? `${promo.value}% off`
                                                  : `${formatCurrency(promo.value, tenant?.currency_code || 'USD')} off`}
                                                {promo.expires_at && ` · Expires ${format(new Date(promo.expires_at), "MMM d, yyyy")}`}
                                              </span>
                                            </div>
                                            <Check
                                              className={cn(
                                                "ml-auto h-4 w-4",
                                                field.value === promo.code ? "opacity-100" : "opacity-0"
                                              )}
                                            />
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                              {field.value && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  onClick={() => {
                                    field.onChange("");
                                    setPromoDetails(null);
                                    setPromoError(null);
                                  }}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                            {promoLoading && (
                              <p className="text-sm text-muted-foreground flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Validating...
                              </p>
                            )}
                            {promoError && <p className="text-sm text-destructive">{promoError}</p>}
                            {promoDetails && (
                              <p className="text-sm text-green-600 font-medium flex items-center gap-1">
                                <Check className="w-4 h-4" />
                                Code applied: {promoDetails.type === 'percentage' ? `${promoDetails.value}% off` : `${formatCurrency(promoDetails.value, tenant?.currency_code || 'USD')} off`}
                              </p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />}

                      {/* Fee breakdown */}
                      {hasFees && (
                        <>
                          <div className="border-t" />

                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-muted-foreground">Fee Breakdown</p>
                            <p className="text-xs text-muted-foreground">Override for this rental only</p>
                          </div>

                          <div className="space-y-3">
                            {/* Promo discount lines */}
                            {discountAmt > 0 && (
                              <>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-muted-foreground">Rental Amount</span>
                                  <span className="font-medium">{formatCurrency(rentalAmount, currency)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm text-green-600">
                                  <span>Promo Discount ({promoDetails?.type === 'percentage' ? `${promoDetails.value}%` : 'fixed'})</span>
                                  <span className="font-medium">-{formatCurrency(discountAmt, currency)}</span>
                                </div>
                              </>
                            )}
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">{discountAmt > 0 ? 'After Discount' : 'Rental Amount'}</span>
                              <span className="font-medium">{formatCurrency(discountedAmount, currency)}</span>
                            </div>

                            {/* Tax row */}
                            {showTax && (
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <Label className="text-sm">Tax ({rentalSettings?.tax_percentage}%)</Label>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Auto: {formatCurrency(autoTax, currency)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-36">
                                    <CurrencyInput
                                      value={taxOverride !== null ? taxOverride : autoTax}
                                      onChange={(val) => {
                                        const numVal = typeof val === 'string' ? parseFloat(val) : val;
                                        if (numVal === autoTax || (isNaN(numVal) && autoTax === 0)) {
                                          setTaxOverride(null);
                                        } else {
                                          setTaxOverride(isNaN(numVal) ? 0 : numVal);
                                        }
                                      }}
                                      placeholder="Tax amount"
                                      min={0}
                                      step={0.01}
                                      currencySymbol={currencySymbol}
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className={cn("text-xs px-2 h-8 w-14 shrink-0", taxOverride === null && "invisible")}
                                    onClick={() => setTaxOverride(null)}
                                  >
                                    Reset
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Service fee row */}
                            {showServiceFee && (
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <Label className="text-sm">
                                    Service Fee{feeType === 'percentage' ? ` (${feeValue}%)` : ''}
                                  </Label>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Auto: {formatCurrency(autoServiceFee, currency)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-36">
                                    <CurrencyInput
                                      value={serviceFeeOverride !== null ? serviceFeeOverride : autoServiceFee}
                                      onChange={(val) => {
                                        const numVal = typeof val === 'string' ? parseFloat(val) : val;
                                        if (numVal === autoServiceFee || (isNaN(numVal) && autoServiceFee === 0)) {
                                          setServiceFeeOverride(null);
                                        } else {
                                          setServiceFeeOverride(isNaN(numVal) ? 0 : numVal);
                                        }
                                      }}
                                      placeholder="Service fee"
                                      min={0}
                                      step={0.01}
                                      currencySymbol={currencySymbol}
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className={cn("text-xs px-2 h-8 w-14 shrink-0", serviceFeeOverride === null && "invisible")}
                                    onClick={() => setServiceFeeOverride(null)}
                                  >
                                    Reset
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Deposit row */}
                            {showDeposit && (
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <Label className="text-sm">Pre-Authorization</Label>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Auto: {formatCurrency(autoDeposit, currency)}{rentalSettings?.deposit_mode === 'per_vehicle' ? ' (per-vehicle)' : ' (global)'}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-36">
                                    <CurrencyInput
                                      value={depositOverride !== null ? depositOverride : autoDeposit}
                                      onChange={(val) => {
                                        const numVal = typeof val === 'string' ? parseFloat(val) : val;
                                        if (numVal === autoDeposit || (isNaN(numVal) && autoDeposit === 0)) {
                                          setDepositOverride(null);
                                        } else {
                                          setDepositOverride(isNaN(numVal) ? 0 : numVal);
                                        }
                                      }}
                                      placeholder="Deposit"
                                      min={0}
                                      step={0.01}
                                      currencySymbol={currencySymbol}
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className={cn("text-xs px-2 h-8 w-14 shrink-0", depositOverride === null && "invisible")}
                                    onClick={() => setDepositOverride(null)}
                                  >
                                    Reset
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Grand Total */}
                          <div className="border-t pt-3 flex items-center justify-between">
                            <span className="font-semibold text-sm">Estimated Total</span>
                            <span className="font-semibold text-base">{formatCurrency(grandTotal, currency)}</span>
                          </div>

                          {hasOverrides && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">
                              Custom fees applied — changes only affect this rental.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Installment Plan ──────────────────────────────── */}
              {!isPayAsYouGo && (() => {
                const installmentConfig = rentalSettings?.installment_config;
                const installmentsEnabled = rentalSettings?.installments_enabled && installmentConfig;
                if (!installmentsEnabled) return null;

                if (!watchedStartDate || !watchedEndDate) return null;

                const rentalDays = differenceInDays(watchedEndDate, watchedStartDate);
                if (rentalDays < 1) return null;

                // Calculate what gets split (same as booking side)
                const rentalAmount = watchedMonthlyAmount || 0;
                const discountAmt = promoDetails ? calculateDiscount(rentalAmount) : 0;
                const discountedAmount = rentalAmount - discountAmt;
                const autoTax = calculateTaxAmount(discountedAmount);
                const autoServiceFee = calculateServiceFee(discountedAmount);
                const autoDeposit = calculateSecurityDeposit(form.getValues("vehicle_id"));
                const effectiveTax = taxOverride !== null ? taxOverride : autoTax;
                const effectiveServiceFee = serviceFeeOverride !== null ? serviceFeeOverride : autoServiceFee;
                const effectiveDeposit = depositOverride !== null ? depositOverride : autoDeposit;

                const whatGetsSplit = installmentConfig.what_gets_split || 'rental_only';
                let installableAmount = discountedAmount;
                let upfrontOnlyAmount = effectiveDeposit + effectiveServiceFee;

                if (whatGetsSplit === 'rental_tax' || whatGetsSplit === 'rental_tax_extras') {
                  installableAmount += effectiveTax;
                } else {
                  upfrontOnlyAmount += effectiveTax;
                }

                const chargeFirstUpfront = installmentConfig.charge_first_upfront !== false;
                const currency = tenant?.currency_code || 'USD';

                // Calculate installments helper
                const calcInstallments = (total: number, count: number) => {
                  const base = Math.floor((total / count) * 100) / 100;
                  const last = Math.round((total - (base * (count - 1))) * 100) / 100;
                  return { base, last };
                };

                // Build available plans
                type PlanOption = { type: 'full' | 'weekly' | 'monthly'; count: number; amount: number; scheduled: number; firstAmount: number; upfrontTotal: number; label: string };
                const plans: PlanOption[] = [
                  { type: 'full', count: 1, amount: installableAmount + upfrontOnlyAmount, scheduled: 0, firstAmount: installableAmount + upfrontOnlyAmount, upfrontTotal: installableAmount + upfrontOnlyAmount, label: 'Pay in Full' }
                ];

                // Weekly — dual-gate: days + per-day amount
                const minDaysWeekly = installmentConfig.minimum_days_weekly ?? installmentConfig.min_days_for_weekly ?? 7;
                const weeklyLimit = installmentConfig.weekly_installments_limit ?? installmentConfig.max_installments_weekly ?? 4;
                const limitPerDayWeekly = installmentConfig.limiting_amount_per_day_weekly ?? 0;
                const perDayRate = rentalDays > 0 ? (installableAmount + upfrontOnlyAmount) / rentalDays : 0;

                if (rentalDays >= minDaysWeekly && (limitPerDayWeekly <= 0 || perDayRate >= limitPerDayWeekly) && weeklyLimit >= 2) {
                  const { base } = calcInstallments(installableAmount, weeklyLimit);
                  const first = chargeFirstUpfront ? base : 0;
                  const sched = chargeFirstUpfront ? weeklyLimit - 1 : weeklyLimit;
                  plans.push({ type: 'weekly', count: weeklyLimit, amount: base, scheduled: sched, firstAmount: first, upfrontTotal: upfrontOnlyAmount + first, label: `Weekly (${weeklyLimit} payments)` });
                }

                // Monthly — dual-gate: days + per-day amount
                const minDaysMonthly = installmentConfig.minimum_days_monthly ?? installmentConfig.min_days_for_monthly ?? 30;
                const monthlyLimit = installmentConfig.monthly_installments_limit ?? installmentConfig.max_installments_monthly ?? 6;
                const limitPerDayMonthly = installmentConfig.limiting_amount_per_day_monthly ?? 0;

                if (rentalDays >= minDaysMonthly && (limitPerDayMonthly <= 0 || perDayRate >= limitPerDayMonthly) && monthlyLimit >= 2) {
                  const { base } = calcInstallments(installableAmount, monthlyLimit);
                  const first = chargeFirstUpfront ? base : 0;
                  const sched = chargeFirstUpfront ? monthlyLimit - 1 : monthlyLimit;
                  plans.push({ type: 'monthly', count: monthlyLimit, amount: base, scheduled: sched, firstAmount: first, upfrontTotal: upfrontOnlyAmount + first, label: `Monthly (${monthlyLimit} payments)` });
                }

                if (plans.length <= 1) {
                  // Show reason why installment options aren't available
                  const reasons: string[] = [];
                  const minPerDay = Math.min(
                    limitPerDayWeekly > 0 ? limitPerDayWeekly : Infinity,
                    limitPerDayMonthly > 0 ? limitPerDayMonthly : Infinity
                  );
                  if (minPerDay !== Infinity && perDayRate < minPerDay) {
                    reasons.push(`Minimum rate of ${formatCurrency(minPerDay, currency)}/day required (this rental is ${formatCurrency(Math.round(perDayRate * 100) / 100, currency)}/day)`);
                  }
                  const minDays = Math.min(minDaysWeekly, minDaysMonthly);
                  if (rentalDays < minDays) {
                    reasons.push(`Minimum ${minDays} ${minDays === 1 ? 'day' : 'days'} required (this rental is ${rentalDays} ${rentalDays === 1 ? 'day' : 'days'})`);
                  }
                  if (reasons.length > 0) {
                    return (
                      <div className="rounded-xl border bg-card shadow-sm">
                        <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                          <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/20 text-primary">
                            <CreditCard className="h-4 w-4" />
                          </div>
                          <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">Payment Plan</h2>
                        </div>
                        <div className="px-6 py-4">
                          <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Info className="h-4 w-4 flex-shrink-0" />
                            Installment plans not available for this rental. {reasons.join('. ')}.
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }

                const selectedPlan = plans.find(p => p.type === installmentPlanType) || plans[0];
                const effectiveInstallmentAmount = installmentAmountOverride !== null ? installmentAmountOverride : selectedPlan.amount;

                return (
                  <div className="rounded-xl border bg-card shadow-sm">
                    <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/20 text-primary">
                        <CreditCard className="h-4 w-4" />
                      </div>
                      <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">Payment Plan</h2>
                      <span className="ml-auto text-xs text-muted-foreground">Admin can adjust installment amounts per-rental.</span>
                    </div>
                    <div className="p-5 space-y-4">
                      <RadioGroup
                        value={installmentPlanType}
                        onValueChange={(val) => {
                          setInstallmentPlanType(val as 'full' | 'weekly' | 'monthly');
                          setInstallmentAmountOverride(null); // reset override on plan change
                        }}
                        className="space-y-2"
                      >
                        {plans.map((plan) => (
                          <label
                            key={plan.type}
                            className={cn(
                              "flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                              installmentPlanType === plan.type ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                            )}
                          >
                            <RadioGroupItem value={plan.type} id={`plan-${plan.type}`} />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium">{plan.label}</span>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {plan.type === 'full'
                                  ? `Pay ${formatCurrency(plan.upfrontTotal, currency)} now`
                                  : chargeFirstUpfront
                                    ? `Pay ${formatCurrency(plan.upfrontTotal, currency)} today, then ${formatCurrency(plan.amount, currency)}/${plan.type === 'weekly' ? 'week' : 'month'} × ${plan.scheduled}`
                                    : `Pay ${formatCurrency(upfrontOnlyAmount, currency)} today, then ${formatCurrency(plan.amount, currency)}/${plan.type === 'weekly' ? 'week' : 'month'} × ${plan.scheduled}`
                                }
                              </p>
                            </div>
                          </label>
                        ))}
                      </RadioGroup>

                      {/* Installment amount override (only for weekly/monthly) */}
                      {selectedPlan.type !== 'full' && (
                        <div className="border-t pt-4 space-y-3">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <Label className="text-sm">Installment Amount</Label>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Auto: {formatCurrency(selectedPlan.amount, currency)} × {selectedPlan.count} installments
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-36">
                                <CurrencyInput
                                  value={effectiveInstallmentAmount}
                                  onChange={(val) => {
                                    const numVal = typeof val === 'string' ? parseFloat(val) : val;
                                    if (numVal === selectedPlan.amount || (isNaN(numVal) && selectedPlan.amount === 0)) {
                                      setInstallmentAmountOverride(null);
                                    } else {
                                      setInstallmentAmountOverride(isNaN(numVal) ? 0 : numVal);
                                    }
                                  }}
                                  placeholder="Amount"
                                  min={0}
                                  step={0.01}
                                  currencySymbol={currencySymbol}
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className={cn("text-xs px-2 h-8 w-14 shrink-0", installmentAmountOverride === null && "invisible")}
                                onClick={() => setInstallmentAmountOverride(null)}
                              >
                                Reset
                              </Button>
                            </div>
                          </div>

                          {/* Schedule preview */}
                          <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1.5">
                            <p className="font-medium text-sm mb-2">Payment Schedule</p>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Today (pre-auth + fees{chargeFirstUpfront ? ' + 1st installment' : ''})</span>
                              <span className="font-medium">
                                {formatCurrency(
                                  chargeFirstUpfront ? upfrontOnlyAmount + effectiveInstallmentAmount : upfrontOnlyAmount,
                                  currency
                                )}
                              </span>
                            </div>
                            {Array.from({ length: selectedPlan.scheduled }, (_, i) => {
                              const dueDate = selectedPlan.type === 'weekly'
                                ? addWeeks(watchedStartDate, chargeFirstUpfront ? i + 1 : i + 1)
                                : addMonths(watchedStartDate, chargeFirstUpfront ? i + 1 : i + 1);
                              const isLast = i === selectedPlan.scheduled - 1;
                              // Last installment absorbs rounding difference
                              const amt = isLast && installmentAmountOverride === null
                                ? Math.round((installableAmount - (selectedPlan.amount * (selectedPlan.count - 1))) * 100) / 100
                                : effectiveInstallmentAmount;
                              return (
                                <div key={i} className="flex justify-between">
                                  <span className="text-muted-foreground">
                                    {selectedPlan.type === 'weekly' ? `Week ${chargeFirstUpfront ? i + 2 : i + 1}` : `Month ${chargeFirstUpfront ? i + 2 : i + 1}`} — {format(dueDate, 'MMM d, yyyy')}
                                  </span>
                                  <span>{formatCurrency(amt, currency)}</span>
                                </div>
                              );
                            })}
                          </div>

                          {installmentAmountOverride !== null && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">
                              Custom installment amount — applies only to this rental.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Section 2c: Mileage Info ─────────────────────── */}
              {selectedVehicleId && watchedStartDate && watchedEndDate && (() => {
                const vehicle = vehicles?.find((v: any) => v.id === selectedVehicleId);
                if (!vehicle) return null;
                const distUnit: DistanceUnit = (tenant?.distance_unit as DistanceUnit) || 'miles';
                const unitShort = getDistanceUnitShort(distUnit);
                const mCurrency = tenant?.currency_code || 'USD';
                const days = Math.max(1, differenceInDays(watchedEndDate, watchedStartDate));
                const tier = getMileageTier(days, mtd);
                const currentMileage = vehicle.current_mileage;
                const effDaily = dailyMileageOverride !== null ? dailyMileageOverride : vehicle.daily_mileage;
                const effWeekly = weeklyMileageOverride !== null ? weeklyMileageOverride : vehicle.weekly_mileage;
                const effMonthly = monthlyMileageOverride !== null ? monthlyMileageOverride : vehicle.monthly_mileage;
                const effExcessRate = excessRateOverride !== null ? excessRateOverride : vehicle.excess_mileage_rate;
                const effVehicle = { daily_mileage: effDaily, weekly_mileage: effWeekly, monthly_mileage: effMonthly };
                const perUnit = getTierMileage(effVehicle, tier);
                const totalAllowance = calculateTotalMileageAllowance(effVehicle, days, mtd);
                const unlimited = isUnlimitedMileage(effVehicle);
                const tierMultiplier = tier === 'daily' ? days : tier === 'weekly' ? Math.ceil(days / 7) : Math.ceil(days / mtd);
                const tierUnitLabel = tier === 'daily' ? 'day' : tier === 'weekly' ? 'week' : 'month';
                const hasMileageOverrides = dailyMileageOverride !== null || weeklyMileageOverride !== null || monthlyMileageOverride !== null || excessRateOverride !== null;
                const tierItems: { key: 'daily' | 'weekly' | 'monthly'; label: string; vehicleVal: number | null; override: number | null; setOverride: (v: number | null) => void }[] = [
                  { key: 'daily', label: 'Daily', vehicleVal: vehicle.daily_mileage, override: dailyMileageOverride, setOverride: setDailyMileageOverride },
                  { key: 'weekly', label: 'Weekly', vehicleVal: vehicle.weekly_mileage, override: weeklyMileageOverride, setOverride: setWeeklyMileageOverride },
                  { key: 'monthly', label: 'Monthly', vehicleVal: vehicle.monthly_mileage, override: monthlyMileageOverride, setOverride: setMonthlyMileageOverride },
                ];
                return (
                  <div className="rounded-xl border bg-card shadow-sm">
                    <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                      <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/20 text-primary"><Clock className="h-4 w-4" /></div>
                      <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">Mileage</h2>
                    </div>
                    <div className="p-5 space-y-4">
                      {currentMileage != null && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Current Odometer</span>
                          <span className="text-sm font-semibold">{formatDistance(currentMileage, distUnit)}</span>
                        </div>
                      )}
                      {(() => {
                        const activeTier = tierItems.find(t => t.key === tier);
                        if (!activeTier) return null;
                        const { key, label, vehicleVal, override, setOverride } = activeTier;
                        const effVal = override !== null ? override : vehicleVal;
                        const isOverridden = override !== null;
                        return (
                          <div className="flex items-center gap-4">
                            <div className="flex-1 min-w-0">
                              <Label className="text-sm">{label} Mileage Allowance</Label>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {effVal != null ? `${getMileageTierLabel(key, distUnit)} per ${tierUnitLabel}` : 'Unlimited — no limit set'}
                                {isOverridden && <span className="text-amber-500 ml-1">(overridden)</span>}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Input type="text" inputMode="numeric" placeholder="∞" value={effVal != null ? effVal : ''}
                                onChange={(e) => { const raw = e.target.value; if (raw !== '' && !/^\d*$/.test(raw)) return; if (raw === '') { if (vehicleVal == null) setOverride(null); else setOverride(0); } else { const num = parseInt(raw, 10); if (!isNaN(num)) { if (num === (vehicleVal ?? -1)) setOverride(null); else setOverride(num); } } }}
                                className={cn("w-24 h-9 text-center font-semibold", isOverridden && "border-amber-400 dark:border-amber-600")}
                              />
                              <span className="text-xs text-muted-foreground whitespace-nowrap">{unitShort}</span>
                              {isOverridden && <button type="button" className="text-xs text-amber-500 hover:text-amber-600 underline whitespace-nowrap" onClick={() => setOverride(null)}>Reset</button>}
                            </div>
                          </div>
                        );
                      })()}
                      {(effExcessRate != null || vehicle.excess_mileage_rate != null || !unlimited) && (
                        <div className="flex items-center gap-3">
                          <Label className="text-sm text-muted-foreground whitespace-nowrap">Excess Rate</Label>
                          <CurrencyInput value={effExcessRate ?? 0} onChange={(val) => { const num = typeof val === 'string' ? parseFloat(val) : val; if (num === (vehicle.excess_mileage_rate ?? 0)) setExcessRateOverride(null); else setExcessRateOverride(isNaN(num) ? 0 : num); }} currencySymbol={currencySymbol} className="w-28" />
                          <span className="text-xs text-muted-foreground">/{unitShort}</span>
                          {excessRateOverride !== null && <button type="button" className="text-xs text-amber-500 hover:text-amber-600 underline" onClick={() => setExcessRateOverride(null)}>Reset</button>}
                        </div>
                      )}
                      {!unlimited && (
                        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">This Rental ({days} days — {tier} tier)</p>
                          {perUnit != null ? (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">{perUnit.toLocaleString()} {unitShort}/{tierUnitLabel} × {tierMultiplier} {tierUnitLabel}{tierMultiplier !== 1 ? 's' : ''}</span>
                              <span className="text-sm font-bold">{formatDistance(totalAllowance!, distUnit)}</span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Mileage allowance</span><span className="text-sm font-bold">Unlimited</span></div>
                          )}
                          {effExcessRate != null && effExcessRate > 0 && totalAllowance != null && (
                            <div className="flex items-center justify-between border-t pt-2">
                              <span className="text-xs text-muted-foreground">Excess charge</span>
                              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">{formatCurrency(effExcessRate, mCurrency)}/{unitShort} over {formatDistance(totalAllowance, distUnit)}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {unlimited && <p className="text-sm text-muted-foreground text-center py-2">Unlimited mileage — no excess charges apply.</p>}
                      {hasMileageOverrides && <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">* Custom mileage — applies only to this rental, not saved to vehicle settings.</p>}
                    </div>
                  </div>
                );
              })()}

              {/* ── Section 3: Pickup & Return ────────────────────── */}
              <div className="rounded-xl border bg-card shadow-sm">
                <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                  <span className="text-2xl font-extrabold text-primary">3.</span>
                  <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">{isPayAsYouGo ? 'Pickup' : 'Pickup & Return'}</h2>
                </div>
                <div className="p-5 space-y-5">
                  <FormField control={form.control} name="pickup_location" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pickup Location <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <LocationPicker type="pickup" value={field.value || ''} locationId={pickupLocationId} method={pickupMethod}
                          onMethodChange={(m) => { setPickupMethod(m); setDeliveryFee(0); setDeliveryFeeOverride(null); setPickupOutOfRadius(false); setPickupIsCustom(false); }}
                          onChange={(address, locId, fee, outOfRadius) => { field.onChange(address); setPickupLocationId(locId); if (fee !== undefined) setDeliveryFee(fee); setPickupOutOfRadius(outOfRadius || false); if (!address) { setTimeout(() => { form.clearErrors("pickup_location"); if (sameAsPickup) form.clearErrors("return_location"); }, 0); } if (sameAsPickup) { form.setValue("return_location", address, { shouldValidate: !!address }); setReturnLocationId(locId); if (fee !== undefined) setCollectionFee(fee); setReturnOutOfRadius(outOfRadius || false); } }}
                          onCustomAddressChange={(isCustom) => setPickupIsCustom(isCustom)}
                          placeholder="Enter pickup address" currency={tenant?.currency_code || 'USD'} distanceUnit={(tenant?.distance_unit as 'km' | 'miles') || 'miles'}
                        />
                      </FormControl>
                      {pickupOutOfRadius && <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />Address is outside the configured service radius. Proceeding as admin override.</p>}
                      <FormMessage />
                    </FormItem>
                  )} />

                  {(pickupIsCustom || (pickupMethod !== 'fixed' && (deliveryFee > 0 || deliveryFeeOverride !== null))) && (
                    <div className="flex items-center gap-3">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">Delivery Fee</Label>
                      <CurrencyInput value={deliveryFeeOverride !== null ? deliveryFeeOverride : deliveryFee} onChange={(val) => setDeliveryFeeOverride(val)} currencySymbol={currencySymbol} className="w-32" />
                      {deliveryFeeOverride !== null && <button type="button" className="text-xs text-amber-500 hover:text-amber-600 underline" onClick={() => setDeliveryFeeOverride(null)}>Reset to {formatCurrency(deliveryFee, tenant?.currency_code || 'USD')}</button>}
                    </div>
                  )}

                  {!isPayAsYouGo && <div className="border-t" />}

                  {!isPayAsYouGo && <FormField control={form.control} name="return_location" render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Return Location <span className="text-red-500">*</span></FormLabel>
                        <div className="flex items-center gap-2">
                          <Checkbox id="sameAsPickup" checked={sameAsPickup} onCheckedChange={(checked) => {
                            setSameAsPickup(checked === true);
                            if (checked) { form.setValue("return_location", form.getValues("pickup_location"), { shouldValidate: true }); setReturnLocationId(pickupLocationId); setReturnMethod(pickupMethod); setCollectionFee(deliveryFee); setCollectionFeeOverride(deliveryFeeOverride); setReturnOutOfRadius(pickupOutOfRadius); }
                            else { form.setValue("return_location", "", { shouldValidate: true }); setReturnLocationId(undefined); setCollectionFee(0); setCollectionFeeOverride(null); setReturnOutOfRadius(false); }
                          }} />
                          <label htmlFor="sameAsPickup" className="text-sm text-muted-foreground cursor-pointer">Same as pickup</label>
                        </div>
                      </div>
                      {!sameAsPickup ? (
                        <>
                          <FormControl>
                            <LocationPicker type="return" value={field.value || ''} locationId={returnLocationId} method={returnMethod}
                              onMethodChange={(m) => { setReturnMethod(m); setCollectionFee(0); setCollectionFeeOverride(null); setReturnOutOfRadius(false); setReturnIsCustom(false); }}
                              onChange={(address, locId, fee, outOfRadius) => { field.onChange(address); setReturnLocationId(locId); if (fee !== undefined) setCollectionFee(fee); setReturnOutOfRadius(outOfRadius || false); if (!address) { setTimeout(() => form.clearErrors("return_location"), 0); } }}
                              onCustomAddressChange={(isCustom) => setReturnIsCustom(isCustom)}
                              placeholder="Enter return address" currency={tenant?.currency_code || 'USD'} distanceUnit={(tenant?.distance_unit as 'km' | 'miles') || 'miles'}
                            />
                          </FormControl>
                          {returnOutOfRadius && <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />Address is outside the configured service radius. Proceeding as admin override.</p>}
                        </>
                      ) : (
                        <div className="flex items-center gap-2 px-3 h-10 border rounded-md bg-muted/50 text-foreground">
                          <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="flex-1 truncate text-sm text-muted-foreground">{form.getValues("pickup_location") || 'Same as pickup location'}</span>
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )} />}

                  {!isPayAsYouGo && !sameAsPickup && (returnIsCustom || (returnMethod !== 'fixed' && (collectionFee > 0 || collectionFeeOverride !== null))) && (
                    <div className="flex items-center gap-3">
                      <Label className="text-sm text-muted-foreground whitespace-nowrap">Collection Fee</Label>
                      <CurrencyInput value={collectionFeeOverride !== null ? collectionFeeOverride : collectionFee} onChange={(val) => setCollectionFeeOverride(val)} currencySymbol={currencySymbol} className="w-32" />
                      {collectionFeeOverride !== null && <button type="button" className="text-xs text-amber-500 hover:text-amber-600 underline" onClick={() => setCollectionFeeOverride(null)}>Reset to {formatCurrency(collectionFee, tenant?.currency_code || 'USD')}</button>}
                    </div>
                  )}

                  {/* Lockbox / Delivery Method */}
                  {rentalSettings?.lockbox_enabled && (
                    <div className="border-t pt-4">
                      <Label className="text-sm font-medium mb-3 block">Key Handover Method</Label>
                      <RadioGroup value={deliveryMethod} onValueChange={(val) => setDeliveryMethod(val as 'in_person' | 'lockbox')} className="flex gap-4">
                        <label className={cn("flex items-center gap-2.5 rounded-lg border p-3 flex-1 cursor-pointer transition-colors", deliveryMethod === 'in_person' ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                          <RadioGroupItem value="in_person" id="handover-in-person" />
                          <div><span className="text-sm font-medium">In Person</span><p className="text-xs text-muted-foreground">Hand keys directly to customer</p></div>
                        </label>
                        <label className={cn("flex items-center gap-2.5 rounded-lg border p-3 flex-1 cursor-pointer transition-colors", deliveryMethod === 'lockbox' ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                          <RadioGroupItem value="lockbox" id="handover-lockbox" />
                          <div className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-muted-foreground" /><div><span className="text-sm font-medium">Lockbox</span><p className="text-xs text-muted-foreground">Keys placed in secure lockbox</p></div></div>
                        </label>
                      </RadioGroup>
                      {deliveryMethod === 'lockbox' && (
                        <div className="mt-3 space-y-2">
                          <Label className="text-xs text-muted-foreground">Lockbox Code</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="Enter lockbox code"
                              value={lockboxCodeInput}
                              onChange={(e) => setLockboxCodeInput(e.target.value)}
                              className="w-40 font-mono text-center tracking-widest"
                            />
                            {!lockboxCodeInput && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const length = rentalSettings?.lockbox_code_length || 4;
                                  const max = Math.pow(10, length);
                                  setLockboxCodeInput(Math.floor(Math.random() * max).toString().padStart(length, '0'));
                                }}
                              >
                                Generate
                              </Button>
                            )}
                            {lockboxCodeInput && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setLockboxCodeInput('')}
                              >
                                Clear
                              </Button>
                            )}
                          </div>
                          {!lockboxCodeInput && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              A lockbox code is required for the auto-send timer to work.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Section 4: Insurance (hidden for PAYG — Bonzah not offered on PAYG rentals) ─── */}
              {!isPayAsYouGo && (
                <div className="rounded-xl border bg-card shadow-sm">
                  <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                    <span className="text-2xl font-extrabold text-primary">4.</span>
                    <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">Insurance</h2>
                  </div>
                  <div className="p-5 space-y-5">
                  {/* Customer's Uploaded Insurance Policies (non-expired only) */}
                  {(() => {
                    const activePolicies = selectedCustomerId && customerInsurance
                      ? customerInsurance.filter(p => p.status !== "Expired")
                      : [];
                    if (!selectedCustomerId) return null;
                    return (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Customer Insurance Policies</p>
                        {activePolicies.length > 0 ? (
                          <div className="rounded-lg border overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-muted/50 border-b">
                                  <th className="text-left font-medium text-muted-foreground px-3 py-2">Policy No.</th>
                                  <th className="text-left font-medium text-muted-foreground px-3 py-2">Provider</th>
                                  <th className="text-left font-medium text-muted-foreground px-3 py-2">Vehicle</th>
                                  <th className="text-left font-medium text-muted-foreground px-3 py-2">Expiry</th>
                                  <th className="text-left font-medium text-muted-foreground px-3 py-2">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {activePolicies.map((policy, idx) => (
                                  <tr key={policy.id} className={cn(idx < activePolicies.length - 1 && "border-b")}>
                                    <td className="px-3 py-2 font-medium">{policy.policy_number}</td>
                                    <td className="px-3 py-2 text-muted-foreground">{policy.provider || "—"}</td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {policy.vehicles ? `${policy.vehicles.reg}` : "—"}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {policy.expiry_date ? format(parseISO(policy.expiry_date), "MMM dd, yyyy") : "—"}
                                    </td>
                                    <td className="px-3 py-2">
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "text-[10px] px-1.5 py-0",
                                          policy.status === "Active" && "border-emerald-500/30 text-emerald-600",
                                          policy.status === "Suspended" && "border-amber-500/30 text-amber-600"
                                        )}
                                      >
                                        {policy.status}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No active insurance policies on record for this customer.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                    {/* Existing Insurance Documents */}
                    {selectedCustomerId && existingInsuranceDocs.length > 0 && (
                      <div className="space-y-2.5">
                        <div className="border-t" />
                        <p className="text-sm font-medium">Existing Insurance Certificates</p>
                        <div className="space-y-2">
                          {existingInsuranceDocs.map((doc) => {
                            const status = getDocumentStatus(doc.end_date);
                            const isSelected = insuranceDocId === doc.id;
                            return (
                              <button
                                key={doc.id}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setInsuranceDocId(null);
                                    form.setValue("insurance_status", "pending");
                                  } else {
                                    setInsuranceDocId(doc.id);
                                    form.setValue("insurance_status", "uploaded");
                                  }
                                }}
                                className={cn(
                                  "w-full text-left rounded-lg border p-3 transition-colors",
                                  isSelected
                                    ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                                    : "hover:bg-muted/50"
                                )}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className={cn(
                                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                                      isSelected
                                        ? "border-green-500 bg-green-500 text-white"
                                        : "border-muted-foreground/30"
                                    )}>
                                      {isSelected && <Check className="h-3 w-3" />}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium truncate">{doc.document_name}</p>
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                        {doc.insurance_provider && <span>{doc.insurance_provider}</span>}
                                        {doc.insurance_provider && doc.policy_number && <span>·</span>}
                                        {doc.policy_number && <span>{doc.policy_number}</span>}
                                        {doc.end_date && (
                                          <>
                                            <span>·</span>
                                            <span>Expires {format(parseISO(doc.end_date), "MMM dd, yyyy")}</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <Badge
                                    variant={status === 'Active' ? 'default' : 'secondary'}
                                    className={cn(
                                      "shrink-0",
                                      status === 'Active' && "bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400",
                                      status === 'Expires Soon' && "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400"
                                    )}
                                  >
                                    {status}
                                  </Badge>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <div className="relative">
                          <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                          </div>
                          <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-card px-2 text-muted-foreground">or upload new</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <p className="text-sm text-muted-foreground">
                        {selectedCustomerId
                          ? "Upload customer\u2019s insurance certificate for verification"
                          : "Select a customer first to upload insurance"}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowInsuranceUpload(true)}
                          disabled={!selectedCustomerId}
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

                    {/* AI Insurance Scan Results */}
                    {insuranceDocId && (
                      <AIScanProgress documentId={insuranceDocId} />
                    )}

                    {/* Bonzah Insurance — eligibility message shows as soon as vehicle is selected */}
                    {!skipInsurance && selectedVehicleId && isBonzahEligibilityLoading && (
                      <div className="flex items-center gap-2 py-3">
                        <Loader2 className="h-4 w-4 animate-spin text-[#CC004A]" />
                        <span className="text-sm text-muted-foreground">Checking Bonzah insurance eligibility...</span>
                      </div>
                    )}
                    {!skipInsurance && selectedVehicleId && !isBonzahEligibilityLoading && !isBonzahEligible && (
                      <div className="rounded-lg border border-[#CC004A]/30 bg-[#CC004A]/5 p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <img src="/bonzah-logo.svg" alt="Bonzah" className="h-4 w-auto mt-0.5 flex-shrink-0 dark:hidden" />
                          <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="h-4 w-auto mt-0.5 flex-shrink-0 hidden dark:block" />
                          <p className="text-sm text-muted-foreground">
                            <span className="font-medium">{eligibilityVehicle?.make} {eligibilityVehicle?.model}</span> is not covered by Bonzah&apos;s insurance program. This vehicle type is excluded from their coverage.
                          </p>
                        </div>
                        <a
                          href="https://bonzah.com/included-and-restricted-vehicle-types"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#CC004A]/70 hover:text-[#CC004A] underline ml-6"
                        >
                          View Bonzah vehicle restrictions
                        </a>
                      </div>
                    )}
                    {/* Bonzah coverage selector — requires dates */}
                    {!skipInsurance && watchedStartDate && watchedEndDate && isBonzahEligible && !isBonzahEligibilityLoading && (
                      <div className="space-y-4">
                            {(() => {
                              const startStr = watchedStartDate ? watchedStartDate.toISOString().split('T')[0] : null;
                              const endStr = watchedEndDate ? watchedEndDate.toISOString().split('T')[0] : null;
                              const todayStr = new Date().toISOString().split('T')[0];
                              const effectiveStart = startStr && startStr < todayStr ? todayStr : startStr;
                              const warnings: string[] = [];
                              if (startStr && startStr < todayStr) {
                                warnings.push(`Rental starts ${new Date(startStr + 'T00:00:00').toLocaleDateString('en-US')} which is in the past. Insurance coverage will begin from today.`);
                              }
                              if (effectiveStart && endStr) {
                                const s = new Date(effectiveStart + 'T00:00:00');
                                const maxEnd = new Date(s);
                                maxEnd.setDate(maxEnd.getDate() + 30);
                                if (new Date(endStr + 'T00:00:00') > maxEnd) {
                                  const totalDays = Math.ceil((new Date(endStr + 'T00:00:00').getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
                                  const policyCount = Math.ceil(totalDays / 30);
                                  warnings.push(`${policyCount} insurance policies will be created to cover the full rental (Bonzah max 30 days per policy).`);
                                }
                              }
                              if (warnings.length === 0) return null;
                              return (
                                <div className="space-y-1.5">
                                  {warnings.map((w, i) => (
                                    <p key={i} className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5">
                                      {w}
                                    </p>
                                  ))}
                                </div>
                              );
                            })()}
                            <BonzahInsuranceSelector
                              key={bonzahKey}
                              tripStartDate={(() => {
                                const d = watchedStartDate ? watchedStartDate.toISOString().split('T')[0] : null;
                                if (!d) return null;
                                const today = new Date().toISOString().split('T')[0];
                                return d < today ? today : d;
                              })()}
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
                              customerDetails={customerDetails}
                            />
                            {bonzahPremium > 0 && (
                              <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-3 space-y-2">
                                <div className="flex items-start gap-2">
                                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                                  <p className="text-sm text-muted-foreground">
                                    Insurance premium: <span className="font-medium">${bonzahPremium.toFixed(2)}</span>.
                                    {bonzahCdBalance != null && <> {bonzahMode === 'live' ? 'Bonzah Live Balance' : 'Allocated Balance'}: <span className="font-medium">${bonzahCdBalance.toFixed(2)}</span>.</>}
                                    {' '}The policy will only activate if your Bonzah <strong>allocated {bonzahMode === 'live' ? 'live' : 'test'} balance</strong> is sufficient. If not, the policy will be quoted and you can retry after allocating more funds.
                                  </p>
                                </div>
                                <a
                                  href={bonzahPortalUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline ml-6"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Check Allocated Balance
                                </a>
                              </div>
                            )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Section 5: Optional Extras ────────────────────── */}
              {activeExtras.length > 0 && (
                <div className="rounded-xl border bg-card shadow-sm">
                  <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                    <span className="text-2xl font-extrabold text-primary">5.</span>
                    <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">Optional Extras</h2>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                </div>
              )}

              {/* ── Notes ─────────────────────────── */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium flex items-center gap-1.5">
                      <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                      Notes
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Add any notes about this rental (optional)"
                        className="resize-none min-h-[60px]"
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* ── Submit ─────────────────────────── */}
              <div className="flex justify-end gap-3 pt-4 lg:!mt-auto lg:pt-2 border-t lg:border-t-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/rentals")}
                  className="px-6"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  className="bg-gradient-primary text-white hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg px-8"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {loading ? "Creating..." : !isCustomerVerified ? "Verification Required" : "Create Rental"}
                </Button>
              </div>
            </div>

            {/* ── Right: Static Preview ─────────────────────── */}
            <div className="hidden lg:block lg:col-span-2 lg:overflow-y-auto lg:min-h-0">
              <div className="space-y-5">
                <div className="rounded-xl border bg-card shadow-sm sticky top-0">
                  <div className="flex items-center gap-1.5 px-6 py-3.5 border-b bg-primary/15 rounded-t-xl">
                    <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/20 text-primary"><FileText className="h-4 w-4" /></div>
                    <h2 className="font-extrabold text-xl text-foreground uppercase tracking-wider">Rental Preview</h2>
                  </div>
                  <div className="p-5 space-y-4">
                    {/* Customer & Vehicle */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Customer</p>
                        {selectedCustomer ? (
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                            <p className="text-sm font-medium truncate">{selectedCustomer.name}</p>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Not selected</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Vehicle</p>
                        {selectedVehicle ? (
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                            <p className="text-sm font-medium truncate">{selectedVehicle.make} {selectedVehicle.model}</p>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Not selected</p>
                        )}
                      </div>
                    </div>

                    {/* Badges row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {selectedVehicle && (
                        <Badge variant="outline" className="text-[10px]">{selectedVehicle.reg}</Badge>
                      )}
                      {selectedCustomerId && (
                        isCustomerVerified ? (
                          <Badge variant="default" className="bg-green-500 hover:bg-green-600 text-[10px]">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Verified
                          </Badge>
                        ) : verificationPending ? (
                          <Badge variant="secondary" className="text-[10px]">
                            <Clock className="h-3 w-3 mr-1" /> Pending
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500 text-amber-600 text-[10px]">
                            <AlertTriangle className="h-3 w-3 mr-1" /> Not Verified
                          </Badge>
                        )
                      )}
                      {deliveryMethod === 'lockbox' && rentalSettings?.lockbox_enabled && (
                        <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-600">
                          <Lock className="h-3 w-3 mr-1" /> Lockbox
                        </Badge>
                      )}
                    </div>

                    {/* Rental Details */}
                    <div className="border-t pt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">Period</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{watchedRentalPeriodType || "—"}</Badge>
                          {watchedStartDate && watchedEndDate && (
                            differenceInDays(watchedEndDate, watchedStartDate) <= 0 ? (
                              <span className="text-[10px] text-red-500 font-medium">Invalid dates</span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">
                                ({differenceInDays(watchedEndDate, watchedStartDate)} days)
                              </span>
                            )
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">Start</p>
                        <p className="text-xs font-medium">
                          {watchedStartDate ? format(watchedStartDate, "MMM dd, yyyy") : "—"}
                          {form.watch("pickup_time") ? ` at ${form.watch("pickup_time")}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">End</p>
                        <p className={cn("text-xs font-medium", watchedStartDate && watchedEndDate && !isAfter(watchedEndDate, watchedStartDate) && "text-red-500")}>
                          {watchedEndDate ? format(watchedEndDate, "MMM dd, yyyy") : "—"}
                          {form.watch("return_time") ? ` at ${form.watch("return_time")}` : ""}
                        </p>
                      </div>
                      {watchedPickupLocation && (
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">Pickup</p>
                          <p className="text-xs font-medium truncate max-w-[180px]">{watchedPickupLocation}</p>
                        </div>
                      )}
                      {!sameAsPickup && form.watch("return_location") && (
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">Return</p>
                          <p className="text-xs font-medium truncate max-w-[180px]">{form.watch("return_location")}</p>
                        </div>
                      )}
                    </div>

                    {/* Financial Summary — Full Breakdown */}
                    {(() => {
                      const currency = tenant?.currency_code || 'USD';
                      const rentalAmount = watchedMonthlyAmount || 0;
                      const discountAmt = promoDetails ? calculateDiscount(rentalAmount) : 0;
                      const discountedAmount = rentalAmount - discountAmt;

                      const showTax = rentalSettings?.tax_enabled && (rentalSettings?.tax_percentage ?? 0) > 0;
                      const showServiceFee = rentalSettings?.service_fee_enabled;
                      const autoTax = showTax ? Math.round(calculateTaxAmount(discountedAmount) * 100) / 100 : 0;
                      const autoServiceFee = showServiceFee ? Math.round(calculateServiceFee(discountedAmount) * 100) / 100 : 0;
                      const autoDeposit = calculateSecurityDeposit(form.getValues("vehicle_id"));

                      const effectiveTax = taxOverride !== null ? taxOverride : autoTax;
                      const effectiveServiceFee = serviceFeeOverride !== null ? serviceFeeOverride : autoServiceFee;
                      const effectiveDeposit = depositOverride !== null ? depositOverride : autoDeposit;
                      const prevDeliveryFee = deliveryFeeOverride !== null ? deliveryFeeOverride : deliveryFee;
                      const prevCollectionFee = sameAsPickup ? 0 : (collectionFeeOverride !== null ? collectionFeeOverride : collectionFee);

                      const extrasTotal = Object.entries(selectedExtras).reduce((sum, [id, qty]) => {
                        const extra = activeExtras?.find((e: RentalExtra) => e.id === id);
                        return sum + (extra ? Number(extra.price) * qty : 0);
                      }, 0);

                      const subtotal = discountedAmount + (showTax ? effectiveTax : 0) + (showServiceFee && autoServiceFee > 0 ? effectiveServiceFee : 0) + bonzahPremium + extrasTotal + prevDeliveryFee + (sameAsPickup ? 0 : prevCollectionFee);
                      const grandTotal = subtotal + (effectiveDeposit > 0 ? effectiveDeposit : 0);

                      return (
                        <div className="border-t pt-3 space-y-2">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Financial Summary</p>

                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">Rental Amount</p>
                            <p className="text-xs font-semibold">{rentalAmount > 0 ? formatCurrency(rentalAmount, currency) : "—"}</p>
                          </div>

                          {promoDetails && discountAmt > 0 && (
                            <div className="flex items-center justify-between text-green-600 dark:text-green-400">
                              <p className="text-xs">Discount ({promoDetails.type === 'percentage' ? `${promoDetails.value}%` : 'fixed'})</p>
                              <p className="text-xs font-medium">−{formatCurrency(discountAmt, currency)}</p>
                            </div>
                          )}

                          {showTax && effectiveTax > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-muted-foreground">
                                Tax ({rentalSettings?.tax_percentage}%)
                                {taxOverride !== null && <span className="text-amber-500 ml-1">*</span>}
                              </p>
                              <p className="text-xs font-medium">{formatCurrency(effectiveTax, currency)}</p>
                            </div>
                          )}

                          {showServiceFee && autoServiceFee > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-muted-foreground">
                                Service Fee
                                {serviceFeeOverride !== null && <span className="text-amber-500 ml-1">*</span>}
                              </p>
                              <p className="text-xs font-medium">{formatCurrency(effectiveServiceFee, currency)}</p>
                            </div>
                          )}

                          {bonzahPremium > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <img src="/bonzah-logo.svg" alt="" className="h-3 w-auto dark:hidden" />
                                <img src="/bonzah-logo-dark.svg" alt="" className="h-3 w-auto hidden dark:block" />
                                Insurance
                              </p>
                              <p className="text-xs font-medium">{formatCurrency(bonzahPremium, currency)}</p>
                            </div>
                          )}

                          {extrasTotal > 0 && (
                            <div className="space-y-1">
                              {Object.entries(selectedExtras).map(([id, qty]) => {
                                if (qty <= 0) return null;
                                const extra = activeExtras?.find((e: RentalExtra) => e.id === id);
                                if (!extra) return null;
                                return (
                                  <div key={id} className="flex items-center justify-between">
                                    <p className="text-xs text-muted-foreground">{extra.name}{qty > 1 ? ` ×${qty}` : ''}</p>
                                    <p className="text-xs font-medium">{formatCurrency(Number(extra.price) * qty, currency)}</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {prevDeliveryFee > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-muted-foreground">Delivery Fee{deliveryFeeOverride !== null && <span className="text-amber-500 ml-1">*</span>}</p>
                              <p className="text-xs font-medium">{formatCurrency(prevDeliveryFee, currency)}</p>
                            </div>
                          )}
                          {!sameAsPickup && prevCollectionFee > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-muted-foreground">Collection Fee{collectionFeeOverride !== null && <span className="text-amber-500 ml-1">*</span>}</p>
                              <p className="text-xs font-medium">{formatCurrency(prevCollectionFee, currency)}</p>
                            </div>
                          )}

                          {effectiveDeposit > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-muted-foreground">
                                Pre-Authorization
                                {depositOverride !== null && <span className="text-amber-500 ml-1">*</span>}
                              </p>
                              <p className="text-xs font-medium">{formatCurrency(effectiveDeposit, currency)}</p>
                            </div>
                          )}

                          {(taxOverride !== null || serviceFeeOverride !== null || depositOverride !== null || deliveryFeeOverride !== null || collectionFeeOverride !== null) && (
                            <p className="text-[10px] text-amber-500">* Manually adjusted</p>
                          )}

                          <div className="border-t pt-2 mt-1 flex items-center justify-between">
                            <p className="text-sm font-semibold">Total</p>
                            <p className="text-base font-bold text-primary">
                              {grandTotal > 0 ? formatCurrency(Math.max(0, grandTotal), currency) : "—"}
                            </p>
                          </div>
                          {effectiveDeposit > 0 && grandTotal > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] text-muted-foreground">Excl. deposit</p>
                              <p className="text-[10px] text-muted-foreground">{formatCurrency(Math.max(0, grandTotal - effectiveDeposit), currency)}</p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Notes */}
                    {form.watch("notes") && (
                      <div className="border-t pt-3 space-y-1">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Notes</p>
                        <p className="text-xs text-muted-foreground line-clamp-3">{form.watch("notes")}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            </div>
            </form>
          </Form>
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
        breakdownItems={createdRentalData?.breakdownItems}
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
            end_date: createdRentalData.formData.end_date?.toISOString() || createdRentalData.formData.start_date.toISOString(),
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
            queryClient.invalidateQueries({ queryKey: ["customer-documents"] });
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

      {/* Generate Invite Link Dialog */}
      <GenerateInviteDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
      />

      <VehicleConflictDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        rentalConflicts={conflictResult?.rentalConflicts || []}
        externalConflicts={conflictResult?.externalConflicts || []}
        onRetry={() => {
          setShowConflictDialog(false);
          setConflictResult(null);
          form.handleSubmit(onSubmit)();
        }}
        isRetrying={loading}
      />

      {/* Cancel/Restart verification confirmation */}
      <AlertDialog open={showCancelVerificationDialog} onOpenChange={setShowCancelVerificationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingVerificationAction === "restart" ? "Restart verification session?" : "Cancel verification session?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingVerificationAction === "restart"
                ? "This will cancel the current in-progress session and immediately start a new one. The customer's previous QR code or link will no longer work."
                : "This will mark the current session as canceled. The customer's QR code or verification link will no longer work. You can start a new session afterwards."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelingVerification || creatingVerification}>Keep Session</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelingVerification || creatingVerification}
              onClick={(e) => {
                e.preventDefault();
                if (pendingVerificationAction === "restart") {
                  handleRestartVerification();
                } else {
                  handleCancelVerification();
                }
              }}
              className={pendingVerificationAction === "restart" ? "" : "bg-red-600 hover:bg-red-700"}
            >
              {cancelingVerification || creatingVerification ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Working...</>
              ) : pendingVerificationAction === "restart" ? (
                "Yes, Restart"
              ) : (
                "Yes, Cancel"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </>
  );
};

export default CreateRental;
