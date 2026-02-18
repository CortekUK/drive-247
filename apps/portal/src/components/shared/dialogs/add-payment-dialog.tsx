import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { CalendarIcon, DollarSign, Loader2, Banknote, CreditCard, Building2, Smartphone, FileText, MoreHorizontal, ExternalLink, Mail } from "lucide-react";
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
import { useTenant } from "@/contexts/TenantContext";
import { useCustomerVehicleRental } from "@/hooks/use-customer-vehicle-rental";
import { useCustomerBalanceWithStatus } from "@/hooks/use-customer-balance";
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

interface AddPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer_id?: string;
  vehicle_id?: string;
  rental_id?: string;
  defaultAmount?: number;
  insuranceChargeMode?: boolean;
  targetCategories?: string[];
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
  targetCategories
}: AddPaymentDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const queryClient = useQueryClient();

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

  // Update form values when props change
  useEffect(() => {
    if (open) {
      if (customer_id) form.setValue("customer_id", customer_id);
      if (vehicle_id) form.setValue("vehicle_id", vehicle_id);
      if (defaultAmount) form.setValue("amount", defaultAmount);
    }
  }, [open, customer_id, vehicle_id, defaultAmount, form]);

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

  // Get outstanding balance
  const { data: customerBalanceData } = useCustomerBalanceWithStatus(selectedCustomerId);
  const outstandingBalance = customerBalanceData?.status === 'In Debt' ? customerBalanceData.balance : 0;

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

      if (outstandingBalance !== undefined && data.amount > outstandingBalance && outstandingBalance > 0) {
        const confirmOverpay = window.confirm(
          `The payment amount (${formatCurrency(data.amount, tenant?.currency_code || 'USD')}) exceeds the outstanding balance (${formatCurrency(outstandingBalance, tenant?.currency_code || 'USD')}). ` +
          `The excess ${formatCurrency(data.amount - outstandingBalance, tenant?.currency_code || 'USD')} will remain as credit. Continue?`
        );
        if (!confirmOverpay) { setLoading(false); return; }
      }

      if (outstandingBalance !== undefined && outstandingBalance === 0) {
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

    const amount = defaultAmount || outstandingBalance || rentalDetails?.monthly_amount || latestInvoice?.total_amount || 0;
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

  // Email invoice handler
  const handleSendInvoiceEmail = async () => {
    const finalCustomerId = selectedCustomerId || customer_id;
    if (!finalCustomerId) { toast({ title: "Error", description: "Please select a customer first.", variant: "destructive" }); return; }
    if (!customerEmail) { toast({ title: "Error", description: "Customer has no email address.", variant: "destructive" }); return; }
    if (!rentalId || !rentalDetails) { toast({ title: "Error", description: "No rental found for invoice.", variant: "destructive" }); return; }

    setEmailLoading(true);
    try {
      let invoiceToSend = latestInvoice;
      if (!invoiceToSend) {
        const { data: extras } = await supabase.from('rental_extras_selections').select('quantity, price_at_booking').eq('rental_id', rentalId);
        const extrasTotal = extras?.reduce((sum: number, e: any) => sum + ((e.quantity || 1) * (e.price_at_booking || 0)), 0) || 0;
        const deliveryFee = (rentalDetails as any).delivery_fee || 0;
        const insurancePremium = (rentalDetails as any).insurance_premium || 0;
        const totalAmount = rentalDetails.monthly_amount || 0;
        const subtotal = Math.max(totalAmount - deliveryFee - insurancePremium - extrasTotal, 0);

        const invoice = await createInvoice({
          rental_id: rentalId, customer_id: finalCustomerId, vehicle_id: (rentalDetails as any).vehicle_id,
          invoice_date: new Date(), subtotal, delivery_fee: deliveryFee, insurance_premium: insurancePremium,
          extras_total: extrasTotal, total_amount: totalAmount, tenant_id: tenant?.id,
        });
        invoiceToSend = { id: invoice.id, invoice_number: invoice.invoice_number, total_amount: invoice.total_amount };
        await queryClient.invalidateQueries({ queryKey: ["latest-invoice-for-payment", rentalId, tenant?.id] });
      }

      const { data, error } = await supabase.functions.invoke('send-invoice-email', {
        body: { invoiceId: invoiceToSend.id, tenantId: tenant?.id, recipientEmail: customerEmail },
      });
      if (error) throw new Error(error.message || 'Failed to send invoice email');
      if (data && !data.success) throw new Error(data.error || 'Failed to send invoice email');

      toast({ title: "Invoice Sent", description: `Invoice emailed to ${customerEmail}. Payment will be recorded when the customer pays.` });
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending invoice:", error);
      toast({ title: "Error", description: error.message || "Failed to send invoice email.", variant: "destructive" });
    } finally {
      setEmailLoading(false);
    }
  };

  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'USD');
  const stripeAmount = defaultAmount || outstandingBalance || rentalDetails?.monthly_amount || latestInvoice?.total_amount || 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isAnyLoading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[460px] p-0 gap-0 overflow-hidden">
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
                    <FormControl>
                      <div className="grid grid-cols-6 gap-1.5">
                        {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                          <button
                            key={value} type="button"
                            onClick={() => field.onChange(field.value === value ? "" : value)}
                            className={cn(
                              "flex flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-[11px] font-medium transition-all",
                              field.value === value
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <Icon className="h-4 w-4" />
                            {label}
                          </button>
                        ))}
                      </div>
                    </FormControl>
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
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single" selected={field.value}
                            onSelect={(date) => { if (date) { field.onChange(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0)); } }}
                            fromYear={new Date().getFullYear() - 5} toYear={new Date().getFullYear() + 1}
                            captionLayout="dropdown-buttons" initialFocus className={cn("p-3 pointer-events-auto")}
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

            {/* Footer with all actions */}
            <div className="px-6 py-4 border-t bg-muted/30 space-y-3">
              {/* Primary action row */}
              <div className="flex items-center justify-between">
                <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={isAnyLoading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isAnyLoading} size="sm">
                  {loading ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Recording...</>
                  ) : (
                    <><DollarSign className="w-3.5 h-3.5 mr-1.5" /> Record Payment</>
                  )}
                </Button>
              </div>

              {/* Secondary actions */}
              {selectedCustomerId && (
                <div className="flex items-center justify-center gap-4 pt-1 border-t">
                  <button
                    type="button"
                    disabled={isAnyLoading || stripeAmount <= 0}
                    onClick={handleStripePayment}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none pt-3 transition-colors"
                  >
                    {stripeLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                    Send Stripe Link
                  </button>
                  <div className="w-px h-4 bg-border mt-3" />
                  <button
                    type="button"
                    disabled={isAnyLoading || !customerEmail || (!latestInvoice && !rentalDetails)}
                    onClick={handleSendInvoiceEmail}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none pt-3 transition-colors"
                  >
                    {emailLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                    Email Invoice
                  </button>
                </div>
              )}
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
