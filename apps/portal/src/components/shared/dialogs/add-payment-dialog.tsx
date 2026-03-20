import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { CalendarIcon, DollarSign, Loader2, Banknote, CreditCard, Building2, Smartphone, FileText, MoreHorizontal, ExternalLink, Mail, ChevronDown } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";
import { useTenant } from "@/contexts/TenantContext";
import { useCustomerVehicleRental } from "@/hooks/use-customer-vehicle-rental";
import { useCustomerBalanceWithStatus, useRentalChargesAndPayments } from "@/hooks/use-customer-balance";
import { createInvoice } from "@/lib/invoice-utils";
import { cn } from "@/lib/utils";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";

const paymentSchema = z.object({
  customer_id: z.string().min(1, "Customer is required"),
  vehicle_id: z.string().optional(),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  payment_date: z.date({
    required_error: "Payment date is required",
  }),
  method: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface BreakdownItem {
  label: string;
  amount: number;
  type?: 'discount' | 'normal';
}

interface AddPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer_id?: string;
  vehicle_id?: string;
  rental_id?: string;
  defaultAmount?: number;
  insuranceChargeMode?: boolean;
  targetCategories?: string[];
  onPaymentSuccess?: () => void;
  breakdownItems?: BreakdownItem[];
}

const PAYMENT_METHODS = [
  { value: "Cash", label: "Cash", icon: Banknote },
  { value: "Card", label: "Card", icon: CreditCard },
  { value: "Bank Transfer", label: "Transfer", icon: Building2 },
  { value: "Zelle", label: "Zelle", icon: Smartphone },
  { value: "Check", label: "Check", icon: FileText },
  { value: "Other", label: "Other", icon: MoreHorizontal },
];

export const AddPaymentDialog = ({
  open,
  onOpenChange,
  customer_id,
  vehicle_id,
  rental_id: propRentalId,
  defaultAmount,
  insuranceChargeMode,
  targetCategories,
  onPaymentSuccess,
  breakdownItems
}: AddPaymentDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const queryClient = useQueryClient();

  useAuditLogOnOpen({
    open,
    action: "payment_create_dialog_shown",
    entityType: "payment",
    entityId: propRentalId || customer_id || "unknown",
    details: { rental_id: propRentalId, customer_id, defaultAmount },
  });

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      customer_id: customer_id || "",
      vehicle_id: vehicle_id || "",
      amount: undefined,
      payment_date: toZonedTime(new Date(), 'America/New_York'),
      method: "",
      notes: "",
    },
  });

  // Calculate breakdown total when breakdown items are provided
  const breakdownTotal = breakdownItems && breakdownItems.length > 0
    ? breakdownItems.reduce((sum, item) => sum + (item.type === 'discount' ? -Math.abs(item.amount) : item.amount), 0)
    : null;

  // Update form values when props change
  useEffect(() => {
    if (open) {
      if (customer_id) form.setValue("customer_id", customer_id);
      if (vehicle_id) form.setValue("vehicle_id", vehicle_id);
      // Prefer breakdown total > defaultAmount > outstanding
      if (breakdownTotal && breakdownTotal > 0) form.setValue("amount", Math.round(breakdownTotal * 100) / 100);
      else if (defaultAmount) form.setValue("amount", defaultAmount);
    }
  }, [open, customer_id, vehicle_id, defaultAmount, breakdownTotal, form]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      form.reset({
        customer_id: "",
        vehicle_id: "",
        amount: undefined,
        payment_date: toZonedTime(new Date(), 'America/New_York'),
        method: "",
        notes: "",
      });
    }
  }, [open, form]);

  const selectedCustomerId = form.watch("customer_id") || customer_id;
  const selectedVehicleId = form.watch("vehicle_id") || vehicle_id;

  // Auto-infer rental ID
  const { data: inferredRentalId } = useCustomerVehicleRental(selectedCustomerId, selectedVehicleId);
  const rentalId = propRentalId || inferredRentalId;

  // Get outstanding balance — use rental-specific when rental_id is available, fall back to customer-wide
  const { data: customerBalanceData } = useCustomerBalanceWithStatus(selectedCustomerId);
  const { data: rentalChargesData } = useRentalChargesAndPayments(rentalId);
  const customerOutstanding = customerBalanceData?.status === 'In Debt' ? customerBalanceData.balance : 0;
  const rentalOutstanding = rentalChargesData?.outstanding || 0;
  // Use the higher of rental-specific or customer-wide outstanding (rental charges may have future due dates filtered out in customer balance)
  const outstandingBalance = rentalId ? Math.max(rentalOutstanding, customerOutstanding) : customerOutstanding;

  // Auto-fill amount with outstanding balance when it loads (and no defaultAmount was provided)
  useEffect(() => {
    if (open && outstandingBalance > 0 && !defaultAmount && !form.getValues("amount")) {
      form.setValue("amount", outstandingBalance);
    }
  }, [open, outstandingBalance, defaultAmount]);

  // Vehicle lookup for selected customer
  const { data: activeRentals } = useQuery({
    queryKey: ["active-rentals", selectedCustomerId, tenant?.id],
    queryFn: async () => {
      if (!selectedCustomerId) return [];
      let query = supabase
        .from("rentals")
        .select("vehicle_id, vehicles!rentals_vehicle_id_fkey(id, reg, make, model)")
        .eq("status", "Active")
        .eq("customer_id", selectedCustomerId);
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query;
      if (error) throw error;
      const vehicles = data?.map(r => r.vehicles).filter(Boolean) || [];
      return vehicles.reduce((acc: any[], vehicle: any) => {
        if (!acc.find(v => v.id === vehicle.id)) acc.push(vehicle);
        return acc;
      }, []);
    },
    enabled: !!selectedCustomerId,
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-for-payment", tenant?.id],
    queryFn: async () => {
      let query = supabase.from("customers").select("id, name, email");
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Fetch latest invoice for the rental
  const { data: latestInvoice } = useQuery({
    queryKey: ["latest-invoice-for-payment", rentalId, tenant?.id],
    queryFn: async () => {
      if (!rentalId) return null;
      let query = supabase
        .from("invoices")
        .select("id, invoice_number, total_amount")
        .eq("rental_id", rentalId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (tenant?.id) query = query.eq("tenant_id", tenant.id);
      const { data, error } = await query.maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: !!rentalId && open,
  });

  // Fetch rental details for Stripe / Email
  const { data: rentalDetails } = useQuery({
    queryKey: ["rental-for-payment", rentalId],
    queryFn: async () => {
      if (!rentalId) return null;
      const { data, error } = await supabase
        .from("rentals")
        .select("id, monthly_amount, customer_id, vehicle_id, delivery_fee, insurance_premium, customers!rentals_customer_id_fkey(name, email)")
        .eq("id", rentalId)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!rentalId && open,
  });

  const customerVehicles = activeRentals || [];
  const selectedCustomer = customers?.find(c => c.id === selectedCustomerId);
  const customerEmail = selectedCustomer?.email || (rentalDetails?.customers as any)?.email;
  const customerName = selectedCustomer?.name || (rentalDetails?.customers as any)?.name || '';

  const isAnyLoading = loading || stripeLoading || emailLoading;

  const invalidateAllPaymentQueries = async (finalCustomerId?: string) => {
    const invalidateOptions = { refetchType: 'all' as const };

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['payments-data'], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ['payment-summary'], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ['customers'], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ['rentals'], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ['pnl'], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-totals"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-charges"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-payments"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-payment-breakdown"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-refund-breakdown"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-invoice"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["ledger-entries"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["payment-applications"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["outstanding-balance"], ...invalidateOptions }),
    ]);

    if (rentalId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-totals", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["rental-charges", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["rental-payments", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["rental", rentalId], ...invalidateOptions }),
      ]);
    }

    if (finalCustomerId) {
      await queryClient.invalidateQueries({ queryKey: ["customer-balance", finalCustomerId], ...invalidateOptions });
    }
  };

  // Manual payment submit
  const onSubmit = async (data: PaymentFormData) => {
    setLoading(true);
    try {
      const finalCustomerId = data.customer_id || customer_id;
      const finalVehicleId = data.vehicle_id || vehicle_id;

      if (!breakdownItems && outstandingBalance !== undefined && data.amount > outstandingBalance && outstandingBalance > 0) {
        const confirmOverpay = window.confirm(
          `The payment amount (${formatCurrency(data.amount, tenant?.currency_code || 'USD')}) exceeds the outstanding balance (${formatCurrency(outstandingBalance, tenant?.currency_code || 'USD')}). ` +
          `The excess ${formatCurrency(data.amount - outstandingBalance, tenant?.currency_code || 'USD')} will remain as credit. Continue?`
        );
        if (!confirmOverpay) { setLoading(false); return; }
      }

      if (!breakdownItems && outstandingBalance !== undefined && outstandingBalance === 0) {
        toast({ title: "No Outstanding Balance", description: "This customer has no outstanding balance to pay.", variant: "destructive" });
        setLoading(false);
        return;
      }

      const { data: payment, error: paymentError } = await supabase
        .from("payments")
        .insert({
          customer_id: finalCustomerId,
          vehicle_id: finalVehicleId,
          rental_id: rentalId,
          amount: data.amount,
          payment_date: formatInTimeZone(data.payment_date, 'America/New_York', 'yyyy-MM-dd'),
          method: data.method,
          payment_type: 'Payment',
          tenant_id: tenant?.id,
          verification_status: 'approved',
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      const applyBody: any = { paymentId: payment.id };
      if (targetCategories && targetCategories.length > 0) {
        applyBody.targetCategories = targetCategories;
      }
      const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', { body: applyBody });

      if (applyError) {
        let deleteQuery = supabase.from('payments').delete().eq('id', payment.id);
        if (tenant?.id) deleteQuery = deleteQuery.eq('tenant_id', tenant.id);
        await deleteQuery;
        throw new Error(applyError.message || 'Payment processing failed');
      }
      if (!applyResult?.ok) {
        let deleteQuery = supabase.from('payments').delete().eq('id', payment.id);
        if (tenant?.id) deleteQuery = deleteQuery.eq('tenant_id', tenant.id);
        await deleteQuery;
        throw new Error(applyResult?.error || applyResult?.detail || 'Payment processing failed');
      }

      toast({ title: "Payment Recorded", description: `Payment of ${formatCurrency(data.amount, tenant?.currency_code || 'USD')} has been recorded and applied.` });
      logAction({ action: "payment_created", entityType: "payment", entityId: payment.id, details: { amount: data.amount, method: data.method || "manual", customer_id: finalCustomerId } });
      await invalidateAllPaymentQueries(finalCustomerId);
      if (onPaymentSuccess) onPaymentSuccess();
      form.reset();
      onOpenChange(false);
    } catch (error) {
      console.error("Error adding payment:", error);
      toast({ title: "Error", description: (error as any).message || "Failed to add payment.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Stripe checkout handler
  const handleStripePayment = async () => {
    const finalCustomerId = selectedCustomerId || customer_id;
    if (!finalCustomerId) { toast({ title: "Error", description: "Please select a customer first.", variant: "destructive" }); return; }

    const amount = form.getValues("amount") || breakdownTotal || defaultAmount || outstandingBalance || rentalDetails?.monthly_amount || latestInvoice?.total_amount || 0;
    if (amount <= 0) { toast({ title: "Error", description: "No outstanding amount to charge.", variant: "destructive" }); return; }

    setStripeLoading(true);
    try {
      const portalOrigin = window.location.origin;
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId: rentalId || undefined,
          customerEmail: customerEmail || undefined,
          customerName,
          totalAmount: amount,
          tenantId: tenant?.id,
          successUrl: rentalId ? `${portalOrigin}/rentals/${rentalId}?payment=success` : portalOrigin,
          cancelUrl: rentalId ? `${portalOrigin}/rentals/${rentalId}?payment=cancelled` : portalOrigin,
          source: 'portal',
          ...(targetCategories && targetCategories.length > 0 ? { targetCategories } : {}),
        },
      });

      if (error) throw new Error(error.message || 'Failed to create checkout session');
      if (!data?.url) throw new Error('No checkout URL returned');

      // Store targetCategories in localStorage so the fallback handler can use them
      if (targetCategories && targetCategories.length > 0 && rentalId) {
        localStorage.setItem(`payment_target_categories_${rentalId}`, JSON.stringify(targetCategories));
      }

      window.open(data.url, '_blank');

      toast({ title: "Stripe Checkout Opened", description: "Payment link opened in a new tab. Payment will be recorded automatically when the customer completes checkout." });
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating Stripe checkout:", error);
      toast({ title: "Error", description: error.message || "Failed to create Stripe checkout.", variant: "destructive" });
    } finally {
      setStripeLoading(false);
    }
  };

  // Email Stripe link handler — creates checkout session first, then emails it
  const handleSendInvoiceEmail = async () => {
    const finalCustomerId = selectedCustomerId || customer_id;
    if (!finalCustomerId) { toast({ title: "Error", description: "Please select a customer first.", variant: "destructive" }); return; }
    if (!customerEmail) { toast({ title: "Error", description: "Customer has no email address.", variant: "destructive" }); return; }
    if (!rentalId || !rentalDetails) { toast({ title: "Error", description: "No rental found for invoice.", variant: "destructive" }); return; }

    const invoiceToSend = latestInvoice;
    if (!invoiceToSend) { toast({ title: "Error", description: "No invoice found for this rental.", variant: "destructive" }); return; }

    setEmailLoading(true);
    try {
      const amount = form.getValues("amount") || breakdownTotal || invoiceToSend.total_amount || 0;

      // Step 1: Create Stripe checkout session (same as "Charge via Stripe" — uses the working webhook flow)
      const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId,
          customerEmail,
          customerName,
          totalAmount: amount,
          tenantId: tenant?.id,
          successUrl: `https://${tenant?.slug || 'app'}.drive-247.com/booking-success?type=invoice&status=paid&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `https://${tenant?.slug || 'app'}.drive-247.com/portal/payments`,
          source: 'portal',
        },
      });

      if (checkoutError || !checkoutData?.url) {
        throw new Error(checkoutError?.message || 'Failed to create payment link');
      }

      // Step 2: Send invoice email with the Stripe link
      const { data, error } = await supabase.functions.invoke('send-invoice-email', {
        body: { invoiceId: invoiceToSend.id, tenantId: tenant?.id, recipientEmail: customerEmail, paymentUrl: checkoutData.url },
      });
      if (error) throw new Error(error.message || 'Failed to send invoice email');
      if (data && !data.success) throw new Error(data.error || 'Failed to send invoice email');

      // Store the checkout session ID so the rental detail page can poll for it
      if (checkoutData.sessionId && rentalId) {
        localStorage.setItem(`pending_email_payment_${rentalId}`, checkoutData.sessionId);
      }

      toast({ title: "Invoice Sent", description: `Invoice with payment link emailed to ${customerEmail}. Payment will be recorded automatically when the customer pays.` });
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending invoice:", error);
      toast({ title: "Error", description: error.message || "Failed to send invoice email.", variant: "destructive" });
    } finally {
      setEmailLoading(false);
    }
  };

  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'USD');
  const stripeAmount = breakdownTotal || defaultAmount || outstandingBalance || rentalDetails?.monthly_amount || latestInvoice?.total_amount || 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isAnyLoading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[460px] p-0 gap-0 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle className="text-lg">Record Payment</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {targetCategories && targetCategories.length > 0
                ? `Paying for: ${targetCategories.join(', ')}`
                : 'Record a payment against outstanding charges.'
              }
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Customer/Vehicle selection when not pre-populated */}
        {(!customer_id || !vehicle_id) && (
          <div className="px-6 pb-4 space-y-3 border-b">
            {!customer_id && (
              <div>
                <Label className="text-sm font-medium">Customer <span className="text-red-500">*</span></Label>
                <Select onValueChange={(val) => form.setValue("customer_id", val)} value={form.watch("customer_id")}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select Customer" /></SelectTrigger>
                  <SelectContent>
                    {customers?.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!vehicle_id && (
              <div>
                <Label className="text-sm font-medium">Vehicle</Label>
                <Select onValueChange={(val) => form.setValue("vehicle_id", val)} value={form.watch("vehicle_id")}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select Vehicle" /></SelectTrigger>
                  <SelectContent>
                    {selectedCustomerId ? (
                      customerVehicles?.length > 0 ? (
                        customerVehicles.map((vehicle: { id: string; reg: string; make?: string; model?: string }) => (
                          <SelectItem key={vehicle.id} value={vehicle.id}>
                            {vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model} (${vehicle.reg})` : vehicle.reg}
                          </SelectItem>
                        ))
                      ) : <div className="px-3 py-2 text-sm text-muted-foreground">No Vehicles Found</div>
                    ) : <div className="px-3 py-2 text-sm text-muted-foreground">Select Customer First</div>}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="px-6 py-5 space-y-5">
              {/* Amount */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Amount</FormLabel>
                    {breakdownItems && breakdownItems.length > 0 ? (
                      <>
                        {/* Read-only amount display for breakdown mode */}
                        <div className="flex items-center h-12 px-3 rounded-md border bg-muted/50 text-lg font-semibold">
                          <span className="text-muted-foreground text-sm mr-1">{currencySymbol}</span>
                          {formatCurrency(field.value || 0, tenant?.currency_code || 'USD').replace(/^[^\d]*/, '')}
                        </div>
                        {/* Collapsible breakdown */}
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={() => setShowBreakdown(!showBreakdown)}
                        >
                          <ChevronDown className={cn("h-3 w-3 transition-transform", showBreakdown && "rotate-180")} />
                          {showBreakdown ? 'Hide breakdown' : 'View breakdown'}
                        </button>
                        {showBreakdown && (
                          <div className="rounded-lg border px-3 py-2 space-y-1 text-xs">
                            {breakdownItems.map((item, i) => (
                              <div key={i} className={cn(
                                "flex items-center justify-between",
                                item.type === 'discount' && "text-green-600 dark:text-green-400"
                              )}>
                                <span className="text-muted-foreground">{item.label}</span>
                                <span className="font-medium">
                                  {item.type === 'discount' ? '−' : ''}{formatCurrency(Math.abs(item.amount), tenant?.currency_code || 'USD')}
                                </span>
                              </div>
                            ))}
                            <div className="border-t pt-1 flex items-center justify-between font-semibold text-sm">
                              <span>Total</span>
                              <span>{formatCurrency(
                                breakdownItems.reduce((sum, item) => sum + (item.type === 'discount' ? -Math.abs(item.amount) : item.amount), 0),
                                tenant?.currency_code || 'USD'
                              )}</span>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">{currencySymbol}</span>
                            <Input
                              type="number" step="0.01" placeholder="0.00"
                              className="pl-7 text-lg font-semibold h-12"
                              {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                            />
                          </div>
                        </FormControl>
                        {outstandingBalance !== undefined && outstandingBalance > 0 && field.value !== outstandingBalance && (
                          <button type="button" className="text-xs text-primary hover:underline" onClick={() => field.onChange(outstandingBalance)}>
                            Use full outstanding: {formatCurrency(outstandingBalance, tenant?.currency_code || 'USD')}
                          </button>
                        )}
                        {outstandingBalance !== undefined && outstandingBalance === 0 && selectedCustomerId && (
                          <p className="text-xs text-emerald-500">No outstanding balance</p>
                        )}
                      </>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Payment method */}
              <FormField
                control={form.control}
                name="method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Method</FormLabel>
                    <Select
                      value={field.value?.startsWith('Other:') ? 'Other' : (field.value || '')}
                      onValueChange={(val) => {
                        if (val === 'Other') {
                          field.onChange('Other:');
                        } else {
                          field.onChange(val);
                        }
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select payment method" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                          <SelectItem key={value} value={value}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <span>{label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {field.value?.startsWith('Other:') && (
                      <Input
                        placeholder="Specify payment method"
                        className="h-9 mt-2"
                        value={field.value.replace('Other:', '').trim()}
                        onChange={(e) => field.onChange(`Other: ${e.target.value}`)}
                      />
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Date + Reference */}
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="payment_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">Date</FormLabel>
                      <Popover modal={true}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button variant="outline" className={cn("w-full pl-3 text-left font-normal h-9", !field.value && "text-muted-foreground")}>
                              {field.value ? formatInTimeZone(field.value, 'America/New_York', "MM/dd/yyyy") : <span>Pick date</span>}
                              <CalendarIcon className="ml-auto h-3.5 w-3.5 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 z-[60]" align="start">
                          <Calendar
                            mode="single" selected={field.value}
                            onSelect={(date) => { if (date) { field.onChange(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0)); } }}
                            initialFocus className={cn("p-3 pointer-events-auto")}
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">Reference</FormLabel>
                      <FormControl>
                        <Input placeholder="Optional" className="h-9" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t bg-muted/30 space-y-2">
              {/* Primary: Record manual payment */}
              <Button type="submit" disabled={isAnyLoading} className="w-full h-11">
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Recording...</>
                ) : (
                  <><DollarSign className="w-4 h-4 mr-2" /> Record Payment</>
                )}
              </Button>

              {/* Stripe options row */}
              {selectedCustomerId && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isAnyLoading || stripeAmount <= 0}
                    onClick={handleStripePayment}
                    className="w-full h-10 gap-2"
                  >
                    {stripeLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="#635BFF">
                        <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
                      </svg>
                    )}
                    <span className="text-sm">Charge via Stripe</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isAnyLoading || !customerEmail || (!latestInvoice && !rentalDetails)}
                    onClick={handleSendInvoiceEmail}
                    className="w-full h-10 gap-2"
                  >
                    {emailLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="#635BFF">
                          <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
                        </svg>
                        <Mail className="w-3.5 h-3.5 shrink-0 -ml-1" />
                      </>
                    )}
                    <span className="text-sm">Email Stripe Link</span>
                  </Button>
                </div>
              )}

              <button type="button" className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 transition-colors" onClick={() => onOpenChange(false)} disabled={isAnyLoading}>
                Cancel
              </button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
