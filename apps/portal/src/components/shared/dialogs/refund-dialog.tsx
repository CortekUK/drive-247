import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { DollarSign, Percent, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";
import { useAuditLog } from "@/hooks/use-audit-log";

const refundSchema = z.object({
  refundType: z.enum(["full", "partial"]),
  amountType: z.enum(["fixed", "percentage"]).optional(),
  refundAmount: z.number().min(0.01, "Amount must be greater than 0").optional(),
  refundPercentage: z.number().min(0.01, "Percentage must be greater than 0").max(100, "Percentage cannot exceed 100").optional(),
  reason: z.string().min(1, "Reason is required"),
}).refine((data) => {
  if (data.refundType === "partial") {
    return data.amountType && (data.refundAmount || data.refundPercentage);
  }
  return true;
}, {
  message: "Please specify refund amount or percentage for partial refund",
  path: ["refundAmount"],
});

type RefundFormData = z.infer<typeof refundSchema>;

interface RefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  paymentId?: string;
  category: string; // Tax, Service Fee, Security Deposit, Rental
  totalAmount: number;
  paidAmount: number;
  onSuccess?: (refundAmount: number) => void;
}

export const RefundDialog = ({
  open,
  onOpenChange,
  rentalId,
  paymentId,
  category,
  totalAmount,
  paidAmount,
  onSuccess,
}: RefundDialogProps) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  useAuditLogOnOpen({
    open,
    action: "payment_refund_warning_shown",
    entityType: "payment",
    entityId: rentalId,
    details: { category, totalAmount, paidAmount },
  });

  const maxRefundAmount = Math.min(paidAmount, totalAmount);

  const form = useForm<RefundFormData>({
    resolver: zodResolver(refundSchema),
    defaultValues: {
      refundType: "full",
      amountType: "fixed",
      refundAmount: undefined,
      refundPercentage: undefined,
      reason: "",
    },
  });

  const refundType = form.watch("refundType");
  const amountType = form.watch("amountType");
  const refundPercentage = form.watch("refundPercentage");
  const refundAmount = form.watch("refundAmount");

  // Calculate the actual refund amount based on inputs
  const calculatedRefundAmount = refundType === "full"
    ? maxRefundAmount
    : amountType === "percentage" && refundPercentage
      ? (maxRefundAmount * refundPercentage) / 100
      : refundAmount || 0;

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      form.reset({
        refundType: "full",
        amountType: "fixed",
        refundAmount: undefined,
        refundPercentage: undefined,
        reason: "",
      });
    }
  }, [open, form]);

  const onSubmit = async (data: RefundFormData) => {
    setLoading(true);
    try {
      const finalRefundAmount = data.refundType === "full"
        ? maxRefundAmount
        : data.amountType === "percentage" && data.refundPercentage
          ? (maxRefundAmount * data.refundPercentage) / 100
          : data.refundAmount || 0;

      if (finalRefundAmount <= 0) {
        throw new Error("Invalid refund amount");
      }

      if (finalRefundAmount > maxRefundAmount) {
        throw new Error(`Refund amount cannot exceed ${formatCurrency(maxRefundAmount, tenant?.currency_code || 'USD')}`);
      }

      if (category === 'Fine') {
        // Fine refunds are handled client-side since fine ledger entries
        // may not have rental_id (the edge function filters by rental_id)
        const { data: rental } = await supabase
          .from('rentals')
          .select('customer_id, vehicle_id, tenant_id')
          .eq('id', rentalId)
          .single();
        if (!rental) throw new Error('Rental not found');

        // Count existing Fine refunds for this rental to generate a unique due_date
        // (ux_rental_charge_unique constrains on rental_id + due_date + type + category)
        const { count: existingRefunds } = await supabase
          .from('ledger_entries')
          .select('id', { count: 'exact', head: true })
          .eq('rental_id', rentalId)
          .eq('type', 'Refund')
          .eq('category', 'Fine');

        const today = new Date();
        // Offset the due_date by the number of existing refunds to ensure uniqueness
        if (existingRefunds && existingRefunds > 0) {
          today.setDate(today.getDate() + existingRefunds);
        }
        const dueDateStr = today.toISOString().split('T')[0];

        // Create a refund ledger entry
        const insertData: Record<string, any> = {
          rental_id: rentalId,
          customer_id: rental.customer_id,
          tenant_id: rental.tenant_id || tenant?.id,
          entry_date: new Date().toISOString().split('T')[0],
          due_date: dueDateStr,
          type: 'Refund',
          category: 'Fine',
          amount: -Math.abs(finalRefundAmount),
          remaining_amount: 0,
          reference: `Fine Refund: ${data.reason}`,
        };
        if (rental.vehicle_id) {
          insertData.vehicle_id = rental.vehicle_id;
        }

        const { error: ledgerError } = await supabase
          .from('ledger_entries')
          .insert(insertData);
        if (ledgerError) {
          console.error('Ledger insert error:', ledgerError);
          throw new Error(`Failed to create refund ledger entry: ${ledgerError.message}`);
        }
      } else {
        // Call the process-refund edge function for all other categories
        const { data: result, error } = await supabase.functions.invoke('process-refund', {
          body: {
            rentalId,
            paymentId,
            refundType: data.refundType,
            refundAmount: finalRefundAmount,
            category,
            reason: data.reason,
            processedBy: 'admin',
            tenantId: tenant?.id,
          }
        });

        if (error) {
          throw new Error(error.message || 'Refund processing failed');
        }

        if (!result?.success) {
          throw new Error(result?.error || 'Refund processing failed');
        }
      }

      toast({
        title: "Refund Processed",
        description: `${formatCurrency(finalRefundAmount, tenant?.currency_code || 'USD')} has been refunded for ${category}.`,
      });

      logAction({ action: "payment_refunded", entityType: "payment", entityId: rentalId, details: { category, refund_amount: finalRefundAmount, reason: data.reason } });

      // Invalidate queries to refresh data
      const invalidateOptions = { refetchType: 'all' as const };
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rental-totals'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['rental-charges'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['rental-payments'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['rental-invoice'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['rental-refund-breakdown'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['payments-data'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['rental', rentalId], ...invalidateOptions }),
      ]);

      onSuccess?.(finalRefundAmount);
      form.reset();
      onOpenChange(false);
    } catch (error: any) {
      console.error("Refund error:", error);
      toast({
        title: "Refund Failed",
        description: error.message || "Failed to process refund. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Refund {category}</DialogTitle>
          <DialogDescription>
            Process a refund for the {category.toLowerCase()} charge.
          </DialogDescription>
        </DialogHeader>

        {maxRefundAmount <= 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No refundable amount available. The customer has not made any payments for this charge.
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {/* Summary Row */}
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Total Charged</p>
                  <p className="font-semibold mt-0.5">{formatCurrency(totalAmount, tenant?.currency_code || 'USD')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Amount Paid</p>
                  <p className="font-semibold text-green-600 mt-0.5">{formatCurrency(paidAmount, tenant?.currency_code || 'USD')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Maximum Refundable</p>
                  <p className="font-bold text-lg">{formatCurrency(maxRefundAmount, tenant?.currency_code || 'USD')}</p>
                </div>
              </div>
            </div>

            {/* Refund Type & Partial Options */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <FormField
                control={form.control}
                name="refundType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Refund Type</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex gap-4"
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="full" id="full" />
                          <Label htmlFor="full" className="cursor-pointer text-sm">
                            Full ({formatCurrency(maxRefundAmount, tenant?.currency_code || 'USD')})
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="partial" id="partial" />
                          <Label htmlFor="partial" className="cursor-pointer text-sm">
                            Partial
                          </Label>
                        </div>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {refundType === "partial" && (
                <FormField
                  control={form.control}
                  name="amountType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Specify Amount By</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="flex gap-4"
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="fixed" id="fixed" />
                            <Label htmlFor="fixed" className="cursor-pointer flex items-center gap-1 text-sm">
                              <DollarSign className="h-3.5 w-3.5" />
                              Fixed
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="percentage" id="percentage" />
                            <Label htmlFor="percentage" className="cursor-pointer flex items-center gap-1 text-sm">
                              <Percent className="h-3.5 w-3.5" />
                              Percentage
                            </Label>
                          </div>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {/* Partial Amount Input */}
            {refundType === "partial" && (
              <div className="grid grid-cols-2 gap-x-6">
                {amountType === "fixed" && (
                  <FormField
                    control={form.control}
                    name="refundAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Refund Amount ({getCurrencySymbol(tenant?.currency_code || 'USD')})</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              type="number"
                              step="0.01"
                              max={maxRefundAmount}
                              placeholder="Enter amount"
                              className="pl-9"
                              {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                            />
                          </div>
                        </FormControl>
                        <FormDescription>
                          Max: {formatCurrency(maxRefundAmount, tenant?.currency_code || 'USD')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {amountType === "percentage" && (
                  <FormField
                    control={form.control}
                    name="refundPercentage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Refund Percentage (%)</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type="number"
                              step="any"
                              min="0.01"
                              max="100"
                              placeholder="Enter percentage"
                              className="pr-9"
                              {...field}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                            />
                            <Percent className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          </div>
                        </FormControl>
                        {field.value && (
                          <FormDescription>
                            = {formatCurrency((maxRefundAmount * field.value) / 100, tenant?.currency_code || 'USD')}
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}

            {/* Reason */}
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for Refund <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter the reason for this refund..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Refund Amount Preview */}
            {calculatedRefundAmount > 0 && (
              <div className="bg-primary/10 rounded-lg p-3 border border-primary/20 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Refund Amount</p>
                <p className="text-xl font-bold text-primary">{formatCurrency(calculatedRefundAmount, tenant?.currency_code || 'USD')}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading || maxRefundAmount <= 0}
                variant="destructive"
              >
                {loading ? "Processing..." : "Process Refund"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
