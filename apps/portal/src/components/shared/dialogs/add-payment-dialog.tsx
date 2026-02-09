import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { CalendarIcon, DollarSign, CreditCard, Mail, Loader2, ExternalLink } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useTenant } from "@/contexts/TenantContext";
import { useCustomerVehicleRental } from "@/hooks/use-customer-vehicle-rental";
import { useCustomerBalanceWithStatus } from "@/hooks/use-customer-balance";
import { cn } from "@/lib/utils";

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
}

export const AddPaymentDialog = ({
  open,
  onOpenChange,
  customer_id,
  vehicle_id,
  rental_id: propRentalId
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

  // Update form values when props change (e.g., when dialog opens with a selected rental)
  useEffect(() => {
    if (open) {
      if (customer_id) {
        form.setValue("customer_id", customer_id);
      }
      if (vehicle_id) {
        form.setValue("vehicle_id", vehicle_id);
      }
    }
  }, [open, customer_id, vehicle_id, form]);

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

  // Auto-infer rental ID for the selected customer+vehicle combination (if not passed as prop)
  const { data: inferredRentalId } = useCustomerVehicleRental(selectedCustomerId, selectedVehicleId);
  const rentalId = propRentalId || inferredRentalId;

  // Get outstanding balance for the selected customer using the same calculation as CustomerDetail
  const { data: customerBalanceData } = useCustomerBalanceWithStatus(selectedCustomerId);
  const outstandingBalance = customerBalanceData?.status === 'In Debt' ? customerBalanceData.balance : 0;

  // Simplified vehicle lookup for the selected customer
  const { data: activeRentals } = useQuery({
    queryKey: ["active-rentals", selectedCustomerId, tenant?.id],
    queryFn: async () => {
      if (!selectedCustomerId) return [];

      let query = supabase
        .from("rentals")
        .select("vehicle_id, vehicles!rentals_vehicle_id_fkey(id, reg, make, model)")
        .eq("status", "Active")
        .eq("customer_id", selectedCustomerId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Deduplicate vehicles by ID (customer may have multiple rentals for same vehicle)
      const vehicles = data?.map(r => r.vehicles).filter(Boolean) || [];
      const uniqueVehicles = vehicles.reduce((acc: any[], vehicle: any) => {
        if (!acc.find(v => v.id === vehicle.id)) {
          acc.push(vehicle);
        }
        return acc;
      }, []);
      return uniqueVehicles;
    },
    enabled: !!selectedCustomerId,
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-for-payment", tenant?.id],
    queryFn: async () => {
      let query = supabase.from("customers").select("id, name, email");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Fetch the latest invoice for the rental (for email option)
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

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query.maybeSingle();
      if (error) {
        console.error("Error fetching invoice:", error);
        return null;
      }
      return data;
    },
    enabled: !!rentalId && open,
  });

  // Fetch rental details for Stripe checkout (customer email, amount)
  const { data: rentalDetails } = useQuery({
    queryKey: ["rental-for-payment", rentalId],
    queryFn: async () => {
      if (!rentalId) return null;

      const { data, error } = await supabase
        .from("rentals")
        .select("id, monthly_amount, customer_id, customers!rentals_customer_id_fkey(name, email)")
        .eq("id", rentalId)
        .single();

      if (error) return null;
      return data;
    },
    enabled: !!rentalId && open,
  });

  // Auto-infer vehicle from active rental when customer is selected
  const customerVehicles = activeRentals || [];

  // Get customer email from various sources
  const selectedCustomer = customers?.find(c => c.id === selectedCustomerId);
  const customerEmail = selectedCustomer?.email || (rentalDetails?.customers as any)?.email;
  const customerName = selectedCustomer?.name || (rentalDetails?.customers as any)?.name || '';

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

  const createAndApplyPayment = async (amount: number, method: string, customerId: string, vehicleId?: string) => {
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        customer_id: customerId,
        vehicle_id: vehicleId || null,
        rental_id: rentalId,
        amount,
        payment_date: new Date().toISOString().split('T')[0],
        method,
        payment_type: 'Payment',
        tenant_id: tenant?.id,
        verification_status: 'approved',
      })
      .select()
      .single();

    if (paymentError) throw paymentError;

    const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', {
      body: { paymentId: payment.id }
    });

    if (applyError) {
      let deleteQuery = supabase.from('payments').delete().eq('id', payment.id);
      if (tenant?.id) {
        deleteQuery = deleteQuery.eq('tenant_id', tenant.id);
      }
      await deleteQuery;
      throw new Error(applyError.message || 'Payment processing failed');
    }

    if (!applyResult?.ok) {
      let deleteQuery = supabase.from('payments').delete().eq('id', payment.id);
      if (tenant?.id) {
        deleteQuery = deleteQuery.eq('tenant_id', tenant.id);
      }
      await deleteQuery;
      throw new Error(applyResult?.error || applyResult?.detail || 'Payment processing failed');
    }

    return payment;
  };

  // Manual payment submit handler
  const onSubmit = async (data: PaymentFormData) => {
    setLoading(true);
    try {
      const finalCustomerId = data.customer_id || customer_id;
      const finalVehicleId = data.vehicle_id || vehicle_id;

      // Prevent overpayment - warn if paying more than outstanding
      if (outstandingBalance !== undefined && data.amount > outstandingBalance && outstandingBalance > 0) {
        const confirmOverpay = window.confirm(
          `The payment amount ($${data.amount.toFixed(2)}) exceeds the outstanding balance ($${outstandingBalance.toFixed(2)}). ` +
          `The excess $${(data.amount - outstandingBalance).toFixed(2)} will remain as credit. Continue?`
        );
        if (!confirmOverpay) {
          setLoading(false);
          return;
        }
      }

      // Prevent payment when nothing is owed
      if (outstandingBalance !== undefined && outstandingBalance === 0) {
        toast({
          title: "No Outstanding Balance",
          description: "This customer has no outstanding balance to pay.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      // Create generic payment record - FIFO allocation will be handled by edge function
      // Manual payments recorded by staff are automatically approved (not auto_approved)
      const { data: payment, error: paymentError } = await supabase
        .from("payments")
        .insert({
          customer_id: finalCustomerId,
          vehicle_id: finalVehicleId,
          rental_id: rentalId, // Auto-inferred rental ID
          amount: data.amount,
          payment_date: formatInTimeZone(data.payment_date, 'America/New_York', 'yyyy-MM-dd'),
          method: data.method,
          payment_type: 'Payment', // All customer payments are generic
          tenant_id: tenant?.id,
          verification_status: 'approved', // Manual payments are staff-verified
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      // Apply payment using edge function
      const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', {
        body: { paymentId: payment.id }
      });

      if (applyError) {
        console.error('Payment application error:', applyError);
        // Delete the payment record since processing failed
        let deleteQuery = supabase.from('payments').delete().eq('id', payment.id);
        if (tenant?.id) {
          deleteQuery = deleteQuery.eq('tenant_id', tenant.id);
        }
        await deleteQuery;

        throw new Error(applyError.message || 'Payment processing failed');
      }

      if (!applyResult?.ok) {
        // Delete the payment record since processing failed
        let deleteQuery = supabase.from('payments').delete().eq('id', payment.id);
        if (tenant?.id) {
          deleteQuery = deleteQuery.eq('tenant_id', tenant.id);
        }
        await deleteQuery;
        throw new Error(applyResult?.error || applyResult?.detail || 'Payment processing failed');
      }

      toast({
        title: "Payment Recorded",
        description: `Payment of $${data.amount} has been recorded and applied.`,
      });

      logAction({
        action: "payment_created",
        entityType: "payment",
        entityId: payment.id,
        details: { amount: data.amount, method: data.method || "manual", customer_id: finalCustomerId },
      });

      await invalidateAllPaymentQueries(finalCustomerId);

      // Reset form and close dialog AFTER invalidations
      form.reset();
      onOpenChange(false);
    } catch (error) {
      console.error("Error adding payment:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to add payment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Stripe payment handler
  const handleStripePayment = async () => {
    const finalCustomerId = selectedCustomerId || customer_id;
    if (!finalCustomerId) {
      toast({ title: "Error", description: "Please select a customer first.", variant: "destructive" });
      return;
    }

    setStripeLoading(true);
    try {
      const amount = outstandingBalance || rentalDetails?.monthly_amount || latestInvoice?.total_amount || 0;
      if (amount <= 0) {
        toast({ title: "Error", description: "No outstanding amount to charge.", variant: "destructive" });
        return;
      }

      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId: rentalId || undefined,
          customerEmail: customerEmail || undefined,
          customerName: customerName,
          totalAmount: amount,
          tenantId: tenant?.id,
        },
      });

      if (error) throw new Error(error.message || 'Failed to create checkout session');
      if (!data?.url) throw new Error('No checkout URL returned');

      window.open(data.url, '_blank');

      // Record payment as fulfilled
      await createAndApplyPayment(amount, 'Card', finalCustomerId, selectedVehicleId || vehicle_id);
      await invalidateAllPaymentQueries(finalCustomerId);

      toast({
        title: "Stripe Checkout Opened",
        description: "Stripe checkout opened in a new tab. Payment has been marked as fulfilled.",
      });

      logAction({
        action: "payment_created",
        entityType: "payment",
        entityId: finalCustomerId,
        details: { amount, method: "Card (Stripe)", customer_id: finalCustomerId },
      });

      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating Stripe checkout:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create Stripe checkout.",
        variant: "destructive",
      });
    } finally {
      setStripeLoading(false);
    }
  };

  // Email invoice handler
  const handleSendInvoiceEmail = async () => {
    if (!latestInvoice?.id) {
      toast({ title: "Error", description: "No invoice found for this rental.", variant: "destructive" });
      return;
    }
    if (!customerEmail) {
      toast({ title: "Error", description: "Customer does not have an email address.", variant: "destructive" });
      return;
    }

    const finalCustomerId = selectedCustomerId || customer_id;
    if (!finalCustomerId) {
      toast({ title: "Error", description: "Please select a customer first.", variant: "destructive" });
      return;
    }

    setEmailLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-invoice-email', {
        body: {
          invoiceId: latestInvoice.id,
          tenantId: tenant?.id,
          recipientEmail: customerEmail,
        },
      });

      if (error) throw new Error(error.message || 'Failed to send invoice email');
      if (data && !data.success) throw new Error(data.error || 'Failed to send invoice email');

      // Record payment as fulfilled
      const amount = latestInvoice.total_amount || outstandingBalance || 0;
      if (amount > 0) {
        await createAndApplyPayment(amount, 'Other', finalCustomerId, selectedVehicleId || vehicle_id);
        await invalidateAllPaymentQueries(finalCustomerId);
      }

      toast({
        title: "Invoice Sent",
        description: `Invoice emailed to ${customerEmail}. Payment has been marked as fulfilled.`,
      });

      logAction({
        action: "payment_created",
        entityType: "payment",
        entityId: finalCustomerId,
        details: { amount, method: "Invoice Email", customer_id: finalCustomerId, invoiceId: latestInvoice.id },
      });

      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending invoice email:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to send invoice email.",
        variant: "destructive",
      });
    } finally {
      setEmailLoading(false);
    }
  };

  const isAnyLoading = loading || stripeLoading || emailLoading;
  const stripeAmount = outstandingBalance || rentalDetails?.monthly_amount || latestInvoice?.total_amount || 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isAnyLoading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Payment</DialogTitle>
          <DialogDescription>Choose how to collect or record a payment.</DialogDescription>
        </DialogHeader>

        {/* Customer/Vehicle selection when not pre-populated */}
        {(!customer_id || !vehicle_id) && (
          <div className="space-y-3 pb-3 border-b">
            {!customer_id && (
              <div>
                <Label className="text-sm font-medium">Customer <span className="text-red-500">*</span></Label>
                <Select
                  onValueChange={(val) => form.setValue("customer_id", val)}
                  value={form.watch("customer_id")}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select Customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers?.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!vehicle_id && (
              <div>
                <Label className="text-sm font-medium">Vehicle</Label>
                <Select
                  onValueChange={(val) => form.setValue("vehicle_id", val)}
                  value={form.watch("vehicle_id")}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select Vehicle" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedCustomerId ? (
                      customerVehicles?.length > 0 ? (
                        customerVehicles.map((vehicle: { id: string; reg: string; make?: string; model?: string }) => (
                          <SelectItem key={vehicle.id} value={vehicle.id}>
                            {vehicle.make && vehicle.model
                              ? `${vehicle.make} ${vehicle.model} (${vehicle.reg})`
                              : vehicle.reg}
                          </SelectItem>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No Vehicles Found for This Customer
                        </div>
                      )
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Select Customer First
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Outstanding balance info */}
        {selectedCustomerId && outstandingBalance > 0 && (
          <div className="text-sm px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
            Outstanding balance: <span className="font-semibold">${outstandingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </div>
        )}

        <Tabs defaultValue="manual" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="manual" className="text-xs">
              <DollarSign className="w-3 h-3 mr-1" />
              Manual
            </TabsTrigger>
            <TabsTrigger value="stripe" className="text-xs">
              <CreditCard className="w-3 h-3 mr-1" />
              Stripe
            </TabsTrigger>
            <TabsTrigger value="email" className="text-xs">
              <Mail className="w-3 h-3 mr-1" />
              Invoice Email
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Manual Payment */}
          <TabsContent value="manual" className="mt-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Amount ($)</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Enter amount"
                            {...field}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                          />
                          {outstandingBalance !== undefined && outstandingBalance > 0 && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                Outstanding: <span className="font-medium text-foreground">${outstandingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => field.onChange(outstandingBalance)}
                              >
                                Pay Full Amount
                              </Button>
                            </div>
                          )}
                          {outstandingBalance !== undefined && outstandingBalance === 0 && selectedCustomerId && (
                            <p className="text-sm text-green-600">No Outstanding Balance</p>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="payment_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Date <span className="text-red-500">*</span></FormLabel>
                      <Popover modal={true}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                formatInTimeZone(field.value, 'America/New_York', "MM/dd/yyyy")
                              ) : (
                                <span>Pick a Date</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={(date) => {
                              if (date) {
                                const adjustedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
                                field.onChange(adjustedDate);
                              }
                            }}
                            fromYear={new Date().getFullYear() - 5}
                            toYear={new Date().getFullYear() + 1}
                            captionLayout="dropdown-buttons"
                            initialFocus
                            className={cn("p-3 pointer-events-auto")}
                          />
                        </PopoverContent>
                      </Popover>
                      <FormDescription className="text-sm text-muted-foreground">
                        Payments are automatically applied to outstanding charges.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="method"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Method</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Cash">Cash</SelectItem>
                          <SelectItem value="Card">Card</SelectItem>
                          <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                          <SelectItem value="Zelle">Zelle</SelectItem>
                          <SelectItem value="Check">Check</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Payment reference or notes"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isAnyLoading}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isAnyLoading}>
                    {loading ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Recording...</>
                    ) : (
                      <><DollarSign className="w-4 h-4 mr-1.5" /> Record Payment</>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          {/* Tab 2: Stripe Payment */}
          <TabsContent value="stripe" className="mt-4">
            <Card className="p-4">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <CreditCard className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">Pay via Stripe</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Opens a Stripe checkout page in a new tab for card payment.
                      {stripeAmount > 0 && (
                        <> Amount: <span className="font-medium">${stripeAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></>
                      )}
                    </p>
                  </div>
                </div>

                {!selectedCustomerId && (
                  <p className="text-xs text-amber-600">Please select a customer first.</p>
                )}
                {selectedCustomerId && stripeAmount <= 0 && (
                  <p className="text-xs text-green-600">No outstanding amount to charge.</p>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isAnyLoading}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleStripePayment}
                    disabled={isAnyLoading || !selectedCustomerId || stripeAmount <= 0}
                  >
                    {stripeLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Creating checkout...</>
                    ) : (
                      <><ExternalLink className="w-4 h-4 mr-1.5" /> Open Stripe Checkout</>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          </TabsContent>

          {/* Tab 3: Email Invoice */}
          <TabsContent value="email" className="mt-4">
            <Card className="p-4">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">Send Invoice via Email</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {customerEmail
                        ? <>Email the invoice to <span className="font-medium">{customerEmail}</span> with a PDF attachment.</>
                        : 'Send the invoice to the customer via email with a PDF attachment.'
                      }
                    </p>
                  </div>
                </div>

                {!selectedCustomerId && (
                  <p className="text-xs text-amber-600">Please select a customer first.</p>
                )}
                {selectedCustomerId && !customerEmail && (
                  <p className="text-xs text-amber-600">Customer has no email address on file.</p>
                )}
                {selectedCustomerId && !latestInvoice && !rentalId && (
                  <p className="text-xs text-amber-600">No invoice found. Select a vehicle to locate the rental invoice.</p>
                )}
                {rentalId && !latestInvoice && (
                  <p className="text-xs text-amber-600">No invoice found for this rental.</p>
                )}
                {latestInvoice && (
                  <p className="text-xs text-muted-foreground">
                    Invoice: <span className="font-medium">{latestInvoice.invoice_number}</span> — ${latestInvoice.total_amount?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isAnyLoading}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSendInvoiceEmail}
                    disabled={isAnyLoading || !selectedCustomerId || !customerEmail || !latestInvoice}
                  >
                    {emailLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Sending...</>
                    ) : (
                      <><Mail className="w-4 h-4 mr-1.5" /> Send Invoice Email</>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
