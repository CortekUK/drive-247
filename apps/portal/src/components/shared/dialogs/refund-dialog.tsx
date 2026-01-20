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
  onSuccess?: () => void;
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
        throw new Error(`Refund amount cannot exceed $${maxRefundAmount.toFixed(2)}`);
      }

      // Call the process-refund edge function (supports Stripe Connect)
      const { data: result, error } = await supabase.functions.invoke('process-refund', {
        body: {
          rentalId,
          paymentId,
          refundType: data.refundType,
          refundAmount: finalRefundAmount,
          category,
          reason: data.reason,
          processedBy: 'admin', // In real app, get from auth context
          tenantId: tenant?.id,
        }
      });

      if (error) {
        throw new Error(error.message || 'Refund processing failed');
      }

      if (!result?.success) {
        throw new Error(result?.error || 'Refund processing failed');
      }

      toast({
        title: "Refund Processed",
        description: `$${finalRefundAmount.toFixed(2)} has been refunded for ${category}.`,
      });

      // Invalidate queries to refresh data
      const invalidateOptions = { refetchType: 'all' as const };
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rental-totals'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['rental-charges'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['rental-payments'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['rental-invoice'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['payments-data'], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ['rental', rentalId], ...invalidateOptions }),
      ]);

      onSuccess?.();
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
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Refund {category}</DialogTitle>
          <DialogDescription>
            Process a refund for the {category.toLowerCase()} charge.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/50 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Total Charged</p>
              <p className="font-semibold">${totalAmount.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Amount Paid</p>
              <p className="font-semibold text-green-600">${paidAmount.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t">
            <p className="text-muted-foreground text-sm">Maximum Refundable</p>
            <p className="font-bold text-lg">${maxRefundAmount.toFixed(2)}</p>
          </div>
        </div>

        {maxRefundAmount <= 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No refundable amount available. The customer has not made any payments for this charge.
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                        <Label htmlFor="full" className="cursor-pointer">
                          Full Refund (${maxRefundAmount.toFixed(2)})
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="partial" id="partial" />
                        <Label htmlFor="partial" className="cursor-pointer">
                          Partial Refund
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {refundType === "partial" && (
              <>
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
                            <Label htmlFor="fixed" className="cursor-pointer flex items-center gap-1">
                              <DollarSign className="h-4 w-4" />
                              Fixed Amount
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="percentage" id="percentage" />
                            <Label htmlFor="percentage" className="cursor-pointer flex items-center gap-1">
                              <Percent className="h-4 w-4" />
                              Percentage
                            </Label>
                          </div>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {amountType === "fixed" && (
                  <FormField
                    control={form.control}
                    name="refundAmount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Refund Amount ($)</FormLabel>
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
                          Max: ${maxRefundAmount.toFixed(2)}
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
                            Refund Amount: ${((maxRefundAmount * field.value) / 100).toFixed(2)}
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </>
            )}

            {calculatedRefundAmount > 0 && (
              <div className="bg-primary/10 rounded-lg p-3 border border-primary/20">
                <p className="text-sm text-muted-foreground">Refund Amount</p>
                <p className="text-xl font-bold text-primary">${calculatedRefundAmount.toFixed(2)}</p>
              </div>
            )}

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

            <div className="flex justify-end gap-2 pt-4">
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
