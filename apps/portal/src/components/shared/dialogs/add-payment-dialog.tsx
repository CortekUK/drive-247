import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { CalendarIcon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  
  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      customer_id: customer_id || "",
      vehicle_id: vehicle_id || "",
      amount: 0,
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
        amount: 0,
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
        .select("vehicle_id, vehicles(id, reg, make, model)")
        .eq("status", "Active")
        .eq("customer_id", selectedCustomerId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data?.map(r => r.vehicles).filter(Boolean) || [];
    },
    enabled: !!selectedCustomerId,
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-for-payment", tenant?.id],
    queryFn: async () => {
      let query = supabase.from("customers").select("id, name");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Auto-infer vehicle from active rental when customer is selected
  const customerVehicles = activeRentals || [];

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

      // Invalidate queries BEFORE closing the dialog to ensure data refreshes
      // Use refetchType: 'all' to force immediate refetch of active queries
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

      // Invalidate rental-specific queries
      if (rentalId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["rental-totals", rentalId], ...invalidateOptions }),
          queryClient.invalidateQueries({ queryKey: ["rental-charges", rentalId], ...invalidateOptions }),
          queryClient.invalidateQueries({ queryKey: ["rental-payments", rentalId], ...invalidateOptions }),
          queryClient.invalidateQueries({ queryKey: ["rental", rentalId], ...invalidateOptions }),
        ]);
      }

      // Additional specific queries
      if (finalCustomerId) {
        await queryClient.invalidateQueries({ queryKey: ["customer-balance", finalCustomerId], ...invalidateOptions });
      }

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Payment</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!customer_id && (
              <FormField
                control={form.control}
                name="customer_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer <span className="text-red-500">*</span></FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select Customer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customers?.map((customer) => (
                          <SelectItem key={customer.id} value={customer.id}>
                            {customer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {!vehicle_id && (
              <FormField
                control={form.control}
                name="vehicle_id" 
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vehicle <span className="text-red-500">*</span></FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select Vehicle" />
                        </SelectTrigger>
                      </FormControl>
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
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}


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
                  <Popover>
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
                            // Set time to noon to avoid timezone edge cases
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
                    Payments are automatically applied to outstanding charges. Any remaining credit will auto-apply to the next due charges.
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
                  <FormLabel>Payment Method (Optional)</FormLabel>
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


            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Recording..." : "Record Payment"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};