'use client'

import { useState, useEffect, Suspense } from "react";
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

const checkoutSchema = z.object({
  customerName: z.string().min(2, "Name must be at least 2 characters"),
  customerEmail: z.string().email("Invalid email address"),
  customerPhone: z.string().min(10, "Phone number must be at least 10 digits"),
  licenseNumber: z.string().min(5, "License number is required"),
  agreeTerms: z.boolean().refine(val => val === true, "You must agree to terms")
});

interface PricingExtra {
  id: string;
  extra_name: string;
  price: number;
  description: string | null;
}

interface DeliveryLocation {
  id: string;
  name: string;
  address: string;
  delivery_fee: number;
  collection_fee: number;
}

interface DeliveryData {
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
  const [loading, setLoading] = useState(false);
  const [extras, setExtras] = useState<PricingExtra[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [vehicleDetails, setVehicleDetails] = useState<any>(null);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<any>(null);
  const [deliveryData, setDeliveryData] = useState<DeliveryData>({
    requestDelivery: false,
    deliveryLocationId: null,
    deliveryLocation: null,
    requestCollection: false,
    collectionLocationId: null,
    collectionLocation: null,
  });

  // Installment state
  const [selectedInstallmentPlan, setSelectedInstallmentPlan] = useState<InstallmentOption | null>(null);
  const [installmentConfig, setInstallmentConfig] = useState<InstallmentConfig>({
    min_days_for_weekly: 7,
    min_days_for_monthly: 30,
    max_installments_weekly: 4,
    max_installments_monthly: 6,
  });
  const [installmentsEnabled, setInstallmentsEnabled] = useState(false);

  const [formData, setFormData] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    licenseNumber: "",
    agreeTerms: false
  });

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

      // Load delivery/collection data from localStorage
      const bookingContext = localStorage.getItem("booking_context");
      if (bookingContext) {
        try {
          const ctx = JSON.parse(bookingContext);
          setDeliveryData({
            requestDelivery: ctx.requestDelivery || false,
            deliveryLocationId: ctx.deliveryLocationId || null,
            deliveryLocation: ctx.deliveryLocation || null,
            requestCollection: ctx.requestCollection || false,
            collectionLocationId: ctx.collectionLocationId || null,
            collectionLocation: ctx.collectionLocation || null,
          });
        } catch (e) {
          console.error("Failed to parse booking context for delivery data:", e);
        }
      }

      // Load installment configuration from tenant
      if (tenant?.id) {
        const { data: tenantData } = await supabase
          .from("tenants")
          .select("installments_enabled, installment_config")
          .eq("id", tenant.id)
          .single();

        if (tenantData) {
          setInstallmentsEnabled(tenantData.installments_enabled || false);
          if (tenantData.installment_config) {
            setInstallmentConfig(tenantData.installment_config as InstallmentConfig);
          }
        }
      }
    } catch (error: any) {
      toast.error("Failed to load booking details");
      console.error(error);
    }
  };

  const calculateRentalDays = () => {
    const pickup = new Date(pickupDate);
    const dropoff = new Date(returnDate);
    const diffTime = Math.abs(dropoff.getTime() - pickup.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const calculateVehiclePrice = () => {
    if (!vehicleDetails) return 0;
    const days = calculateRentalDays();
    if (days >= 28) return vehicleDetails.monthly_rent || 0;
    if (days >= 7) return Math.floor((days / 7) * (vehicleDetails.weekly_rent || 0));
    return days * (vehicleDetails.daily_rent || 50); // Fallback to $50/day
  };

  const calculateExtrasTotal = () => {
    return selectedExtras.reduce((sum, extraId) => {
      const extra = extras.find(e => e.id === extraId);
      return sum + (extra?.price || 0);
    }, 0);
  };

  const calculateTotal = () => {
    return calculateVehiclePrice() + calculateExtrasTotal();
  };

  // Complete total calculation including all fees
  const calculateCompleteTotal = () => {
    const vehiclePrice = calculateVehiclePrice();
    const extrasTotal = calculateExtrasTotal();

    // Delivery/Collection fees
    const deliveryFee = deliveryData.requestDelivery && deliveryData.deliveryLocation
      ? deliveryData.deliveryLocation.delivery_fee || 0
      : 0;
    const collectionFee = deliveryData.requestCollection && deliveryData.collectionLocation
      ? deliveryData.collectionLocation.collection_fee || 0
      : 0;

    const subtotal = vehiclePrice + extrasTotal + deliveryFee + collectionFee;

    // Tax (if enabled)
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
      extrasTotal,
      deliveryFee,
      collectionFee,
      subtotal,
      taxAmount,
      taxPercentage,
      serviceFee,
      deposit,
      grandTotal: subtotal + taxAmount + serviceFee + deposit,
    };
  };

  const totals = calculateCompleteTotal();

  // Calculate installment breakdown
  // Upfront: Deposit + Service Fee + Delivery Fee + Collection Fee (paid immediately)
  // Installable: Vehicle Price + Extras + Tax (split into installments)
  const upfrontAmount = totals.deposit + totals.serviceFee + totals.deliveryFee + totals.collectionFee;
  const installableAmount = totals.vehiclePrice + totals.extrasTotal + totals.taxAmount; // Rental costs only

  // Format currency based on tenant settings
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: tenant?.currency_code || 'GBP',
    }).format(amount);
  };

  const handleExtraToggle = (extraId: string) => {
    setSelectedExtras(prev =>
      prev.includes(extraId)
        ? prev.filter(id => id !== extraId)
        : [...prev, extraId]
    );
  };

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
    if (!validateForm()) {
      toast.error("Please fill in all required fields correctly");
      return;
    }

    setLoading(true);
    try {
      // Get customer data from localStorage (saved in Step 1)
      const bookingContext = localStorage.getItem("booking_context");
      if (!bookingContext) {
        throw new Error("Customer information not found. Please restart booking.");
      }

      const context = JSON.parse(bookingContext);
      const { customerName, customerEmail, customerPhone, customerType } = context;

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
      } else {
        // Create new customer
        const { data: newCustomer, error: createError } = await supabase
          .from("customers")
          .insert({
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            customer_type: customerType || "Individual",
            status: "Active",
            tenant_id: tenant?.id
          })
          .select()
          .single();

        if (createError) throw createError;
        customer = newCustomer;
      }

      // Step 2: Link any pending insurance documents to the customer
      const pendingInsuranceFiles = JSON.parse(localStorage.getItem('pending_insurance_files') || '[]');

      // Deduplicate files by file_path to prevent duplicate inserts
      const uniqueFiles = Array.from(
        new Map(pendingInsuranceFiles.map((file: any) => [file.file_path, file])).values()
      ) as any[];

      console.log(`[CHECKOUT] Processing ${uniqueFiles.length} unique insurance documents (${pendingInsuranceFiles.length} total in localStorage)`);

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

      // Clear localStorage immediately after processing to prevent duplicates on retry
      localStorage.removeItem('pending_insurance_files');
      console.log('[CHECKOUT] Cleared pending_insurance_files from localStorage');

      // Step 3: Check if Individual customer already has active rental
      if (customer.customer_type === "Individual") {
        const { data: activeRentals, error: checkError } = await supabase
          .from("rentals")
          .select("id")
          .eq("customer_id", customer.id)
          .eq("status", "Active");

        if (checkError) throw checkError;
        if (activeRentals && activeRentals.length > 0) {
          throw new Error("You already have an active rental. Individuals can only have one active rental at a time.");
        }
      }

      // Step 4: Calculate monthly amount
      const days = calculateRentalDays();
      const monthlyAmount = vehicleDetails.monthly_rent || calculateVehiclePrice();

      // Step 5: Create rental
      // Determine rental period type based on duration
      const rentalPeriodType = days >= 28 ? "Monthly" : days >= 7 ? "Weekly" : "Daily";

      // Get current totals for delivery/collection fees
      const currentTotals = calculateCompleteTotal();

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
          // Delivery/Collection data
          uses_delivery_service: deliveryData.requestDelivery || deliveryData.requestCollection,
          delivery_location_id: deliveryData.deliveryLocationId || null,
          delivery_address: deliveryData.deliveryLocation?.address || null,
          delivery_fee: currentTotals.deliveryFee,
          collection_location_id: deliveryData.collectionLocationId || null,
          collection_address: deliveryData.collectionLocation?.address || null,
          collection_fee: currentTotals.collectionFee,
        })
        .select()
        .single();

      if (rentalError) throw rentalError;

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
        // Don't throw - rental is created
      });

      // Step 8: Handle payment based on installment selection
      const vehicleName = vehicleDetails?.name || `${vehicleDetails?.make} ${vehicleDetails?.model}` || "Vehicle";
      const currentTotalsForPayment = calculateCompleteTotal();

      // Check if installment plan is selected (not "full" payment)
      if (selectedInstallmentPlan && selectedInstallmentPlan.type !== 'full' && installmentsEnabled) {
        console.log("Creating installment checkout for rental:", rental.id);
        console.log("Plan:", selectedInstallmentPlan.type, "Installments:", selectedInstallmentPlan.numberOfInstallments);

        // Call the installment checkout edge function
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
              upfrontAmount: currentTotalsForPayment.deposit + currentTotalsForPayment.serviceFee,
              installableAmount: currentTotalsForPayment.subtotal + currentTotalsForPayment.taxAmount,
              planType: selectedInstallmentPlan.type,
              numberOfInstallments: selectedInstallmentPlan.numberOfInstallments,
              pickupDate: pickupDate,
              returnDate: returnDate,
              startDate: pickupDate, // First installment due on rental start
              tenantId: tenant?.id,
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
              {/* Extras */}
              <Card className="p-6">
                <h2 className="text-xl font-semibold mb-4">Optional Extras</h2>
                {extras.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No extras available</p>
                ) : (
                  <div className="space-y-3">
                    {extras.map(extra => (
                      <div key={extra.id} className="flex items-start gap-3 p-3 rounded border border-border hover:bg-muted/50 transition-colors">
                        <Checkbox
                          checked={selectedExtras.includes(extra.id)}
                          onCheckedChange={() => handleExtraToggle(extra.id)}
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <Label className="font-medium cursor-pointer">{extra.extra_name}</Label>
                            <span className="text-sm font-semibold">${extra.price}</span>
                          </div>
                          {extra.description && (
                            <p className="text-xs text-muted-foreground mt-1">{extra.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

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

                  <div className="flex items-start gap-2 pt-4">
                    <Checkbox
                      checked={formData.agreeTerms}
                      onCheckedChange={(checked) => setFormData({...formData, agreeTerms: checked as boolean})}
                    />
                    <Label className="text-sm leading-relaxed cursor-pointer">
                      I agree to the{" "}
                      <a href="/terms" target="_blank" className="text-accent underline">Terms & Conditions</a>
                      {" "}and{" "}
                      <a href="/privacy" target="_blank" className="text-accent underline">Privacy Policy</a>
                    </Label>
                  </div>
                  {errors.agreeTerms && (
                    <p className="text-xs text-destructive">{errors.agreeTerms}</p>
                  )}
                </div>
              </Card>

              {/* Installment Payment Options */}
              {calculateRentalDays() >= 7 && (
                <InstallmentSelector
                  rentalDays={calculateRentalDays()}
                  installableAmount={installableAmount}
                  upfrontAmount={upfrontAmount}
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
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Vehicle Cost</span>
                      <span className="font-medium">{formatCurrency(totals.vehiclePrice)}</span>
                    </div>
                  </div>
                )}

                {selectedExtras.length > 0 && (
                  <div className="space-y-2 py-4 border-b border-border">
                    <p className="text-sm font-medium">Extras</p>
                    {selectedExtras.map(extraId => {
                      const extra = extras.find(e => e.id === extraId);
                      return extra ? (
                        <div key={extraId} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{extra.extra_name}</span>
                          <span className="font-medium">{formatCurrency(extra.price)}</span>
                        </div>
                      ) : null;
                    })}
                  </div>
                )}

                {/* Delivery & Collection Section */}
                {(totals.deliveryFee > 0 || totals.collectionFee > 0) && (
                  <div className="space-y-2 py-4 border-b border-border">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Truck className="w-4 h-4 text-accent" />
                      Delivery & Collection
                    </p>
                    {totals.deliveryFee > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Delivery to: {deliveryData.deliveryLocation?.name}
                        </span>
                        <span className="font-medium">+{formatCurrency(totals.deliveryFee)}</span>
                      </div>
                    )}
                    {totals.collectionFee > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          Collection from: {deliveryData.collectionLocation?.name}
                        </span>
                        <span className="font-medium">+{formatCurrency(totals.collectionFee)}</span>
                      </div>
                    )}
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
                  {totals.deposit > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Security Deposit</span>
                      <span className="font-medium">+{formatCurrency(totals.deposit)}</span>
                    </div>
                  )}
                </div>

                <div className="pt-4 space-y-4">
                  {/* Grand Total - Highlighted Section */}
                  <div className="bg-accent/10 border-2 border-accent/30 rounded-lg p-4 -mx-2">
                    {selectedInstallmentPlan && selectedInstallmentPlan.type !== 'full' ? (
                      <>
                        <div className="flex justify-between items-center mb-3">
                          <div>
                            <span className="text-sm text-muted-foreground block">Pay Today</span>
                            <span className="text-lg font-semibold">Upfront Amount</span>
                          </div>
                          <span className="text-2xl font-bold text-accent">{formatCurrency(upfrontAmount)}</span>
                        </div>
                        <div className="border-t border-accent/20 pt-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                              Then {selectedInstallmentPlan.numberOfInstallments} {selectedInstallmentPlan.type} payments of
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
                        Pay {formatCurrency(upfrontAmount)} & Setup Installments
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
