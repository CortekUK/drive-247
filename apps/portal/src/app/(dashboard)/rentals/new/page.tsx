"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { addMonths, addDays, addWeeks, isAfter, isBefore, subYears, startOfDay, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, FileText, Save, AlertTriangle, MapPin, Clock, Shield, Upload, CheckCircle2, XCircle, Loader2, RefreshCw, QrCode, Smartphone, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";
import { useCustomerActiveRentals } from "@/hooks/use-customer-active-rentals";
import { PAYMENT_TYPES } from "@/constants";
import { ContractSummary } from "@/components/rentals/contract-summary";
import { DatePickerInput } from "@/components/shared/forms/date-picker-input";
import { CurrencyInput } from "@/components/shared/forms/currency-input";
import { InvoiceDialog } from "@/components/shared/dialogs/invoice-dialog";
import { createInvoice, Invoice } from "@/lib/invoice-utils";
import { sendBookingNotification, sendPaymentVerificationNotification } from "@/lib/notifications";
import { useOrgSettings } from "@/hooks/use-org-settings";
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

const rentalSchema = z.object({
  customer_id: z.string().min(1, "Customer is required"),
  vehicle_id: z.string().min(1, "Vehicle is required"),
  start_date: z.date(),
  end_date: z.date(),
  rental_period_type: z.enum(["Daily", "Weekly", "Monthly"]),
  monthly_amount: z.coerce.number().min(1, "Rental amount must be at least $1"),
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
  const { toast } = useToast();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string>("");
  const [showDocuSignDialog, setShowDocuSignDialog] = useState(false);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [createdRentalData, setCreatedRentalData] = useState<any>(null);
  const [generatedInvoice, setGeneratedInvoice] = useState<Invoice | null>(null);
  const [sendingDocuSign, setSendingDocuSign] = useState(false);

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

  // Watch form values for live updates
  const watchedValues = form.watch();
  const selectedCustomerId = watchedValues.customer_id;
  const selectedVehicleId = watchedValues.vehicle_id;

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
        .select("id, name, email, phone, date_of_birth, identity_verification_status")
        .eq("id", selectedCustomerId)
        .eq("tenant_id", tenant.id)
        .single();
      if (error) throw error;
      return data as { id: string; name: string; email?: string; phone?: string; date_of_birth?: string; identity_verification_status?: string } | null;
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
        .select("id, reg, make, model, daily_rent, weekly_rent, monthly_rent")
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
  useEffect(() => {
    if (selectedVehicleId && vehicles) {
      const vehicle = vehicles.find(v => v.id === selectedVehicleId);
      if (vehicle) {
        const periodType = watchedValues.rental_period_type || "Monthly";
        let amount: number | undefined;

        if (periodType === "Daily" && vehicle.daily_rent) {
          amount = vehicle.daily_rent;
        } else if (periodType === "Weekly" && vehicle.weekly_rent) {
          amount = vehicle.weekly_rent;
        } else if (periodType === "Monthly" && vehicle.monthly_rent) {
          amount = vehicle.monthly_rent;
        }

        if (amount !== undefined) {
          form.setValue("monthly_amount", amount);
        }
      }
    }
  }, [selectedVehicleId, watchedValues.rental_period_type, vehicles, form]);

  // Auto-update end date based on rental period type and start date
  useEffect(() => {
    const startDate = watchedValues.start_date;
    const periodType = watchedValues.rental_period_type;

    if (startDate && periodType) {
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

      form.setValue("end_date", newEndDate);
    }
  }, [watchedValues.rental_period_type, watchedValues.start_date, form]);

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
          promo_code: data.promo_code || null,
          insurance_status: data.insurance_status || "pending",
        })
        .select()
        .single();

      if (rentalError) throw rentalError;

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

      // Generate only first month's charge (subsequent charges created monthly)
      await supabase.rpc("backfill_rental_charges_first_month_only");

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
          message: `$${data.monthly_amount.toLocaleString()} payment due for rental of ${selectedVehicle?.make} ${selectedVehicle?.model} (${vehicleReg}). Due date: ${dueDate}.`,
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

        const invoice = await createInvoice({
          rental_id: rental.id,
          customer_id: data.customer_id,
          vehicle_id: data.vehicle_id,
          invoice_date: data.start_date,
          due_date: addMonths(data.start_date, 1),
          subtotal: data.monthly_amount,
          tax_amount: 0,
          total_amount: data.monthly_amount,
          notes: invoiceNotes,
          tenant_id: tenant?.id,
        });

        setGeneratedInvoice(invoice);
        invoiceCreated = true;
      } catch (invoiceError) {
        console.error('Error creating invoice:', invoiceError);
        // If invoice fails, still continue with the flow - skip invoice and go to DocuSign
      }

      // Store rental data for dialogs
      setCreatedRentalData({
        rental,
        customer: selectedCustomer,
        vehicle: selectedVehicle,
        formData: data,
      });

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

      // Auto-trigger DocuSign (required for rental to become Active)
      let docuSignSuccess = false;
      try {
        const { data: docuSignData, error: docuSignError } = await supabase.functions.invoke("create-docusign-envelope", {
          body: {
            rentalId: rental.id,
          },
        });

        if (docuSignError || !docuSignData?.ok) {
          console.error("DocuSign error:", docuSignError || docuSignData);
          toast({
            title: "Rental Created - DocuSign Pending",
            description: `Rental created but DocuSign failed to send. You can retry from the rental details page.`,
            variant: "default",
          });
        } else {
          docuSignSuccess = true;
          // Update rental with envelope ID
          await supabase
            .from("rentals")
            .update({
              docusign_envelope_id: docuSignData.envelopeId,
              document_status: "sent",
              envelope_sent_at: new Date().toISOString(),
            })
            .eq("id", rental.id);

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

      // Show invoice dialog if invoice was generated
      if (invoiceCreated) {
        setShowInvoiceDialog(true);
      } else {
        // Navigate directly to rental detail page
        router.push(`/rentals/${rental.id}`);
      }
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
  const isPastStartDate = watchedValues.start_date && isBefore(watchedValues.start_date, todayAtMidnight);

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
          <h1 className="text-2xl sm:text-3xl font-bold">Create New Rental</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Set up a new rental agreement</p>
        </div>
      </div>

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
                        const periodType = watchedValues.rental_period_type || "Monthly";
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
                                  if (watchedValues.start_date && isBefore(date, getMinEndDate(watchedValues.start_date))) {
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

                  {/* Financial Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="monthly_amount"
                      render={({ field }) => {
                        const periodType = watchedValues.rental_period_type || "Monthly";
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
                                disabled={!!selectedVehicleId}
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

                  {/* Insurance Verification */}
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
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Enter promo code"
                              />
                            </FormControl>
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
<<<<<<< HEAD
                      disabled={loading || !isFormValid}
                      className="bg-gradient-primary text-white hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg"
=======
                      disabled={loading || !isFormValid}
                      className="bg-gradient-primary text-white hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg"
>>>>>>> b7fb88f (UI for mobile mode fixed for booking and portal)
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
<<<<<<< HEAD
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <ContractSummary
              customer={selectedCustomer}
              vehicle={selectedVehicle}
              startDate={watchedValues.start_date}
              endDate={watchedValues.end_date}
              rentalPeriodType={watchedValues.rental_period_type}
              monthlyAmount={watchedValues.monthly_amount}
              initialFee={watchedValues.initial_fee}
            />
          </div>
=======
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <ContractSummary
              customer={selectedCustomer}
              vehicle={selectedVehicle}
              startDate={watchedValues.start_date}
              endDate={watchedValues.end_date}
              rentalPeriodType={watchedValues.rental_period_type}
              monthlyAmount={watchedValues.monthly_amount}
              initialFee={watchedValues.initial_fee}
            />
          </div>
>>>>>>> b7fb88f (UI for mobile mode fixed for booking and portal)
        </div>
      </div>

      {/* Invoice Dialog */}
      {generatedInvoice && createdRentalData && (
        <InvoiceDialog
          open={showInvoiceDialog}
          onOpenChange={(open) => {
            setShowInvoiceDialog(open);
            if (!open) {
              // Navigate to rental detail page after viewing invoice
              // DocuSign is already sent automatically
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
        />
      )}

      {/* Insurance Upload Dialog */}
      <InsuranceUploadDialog
        open={showInsuranceUpload}
        onOpenChange={setShowInsuranceUpload}
        customerId={watchedValues.customer_id}
        onUploadComplete={(documentId) => {
          setInsuranceDocId(documentId);
          form.setValue("insurance_status", "uploaded");
        }}
      />

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
