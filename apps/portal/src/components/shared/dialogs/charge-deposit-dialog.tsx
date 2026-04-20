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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, AlertCircle } from "lucide-react";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";

interface ChargeDepositDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  holdAmount: number;
  onSuccess?: () => void;
}

export const ChargeDepositDialog = ({
  open,
  onOpenChange,
  rentalId,
  holdAmount,
  onSuccess,
}: ChargeDepositDialogProps) => {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const currency = tenant?.currency_code || "USD";
  const symbol = getCurrencySymbol(currency);

  const schema = z.object({
    amount: z
      .number({ invalid_type_error: "Enter a valid amount" })
      .min(0.01, "Amount must be greater than 0")
      .max(holdAmount, `Cannot exceed hold of ${formatCurrency(holdAmount, currency)}`),
    reason: z.string().min(1, "Reason is required"),
  });

  type FormData = z.infer<typeof schema>;

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { amount: holdAmount, reason: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset({ amount: holdAmount, reason: "" });
    }
  }, [open, holdAmount, form]);

  const amount = form.watch("amount") || 0;
  const remaining = Math.max(0, holdAmount - amount);

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("capture-deposit-hold", {
        body: {
          rentalId,
          tenantId: tenant?.id,
          amount: data.amount,
          reason: data.reason,
        },
      });
      if (error) throw new Error(error.message || "Capture failed");

      queryClient.invalidateQueries({ queryKey: ["rental", rentalId] });
      queryClient.invalidateQueries({ queryKey: ["rental-totals"] });
      queryClient.invalidateQueries({ queryKey: ["rental-payment-breakdown"] });
      queryClient.invalidateQueries({ queryKey: ["rental-charges"] });
      queryClient.invalidateQueries({ queryKey: ["payments-data"] });

      toast({
        title: "Hold charged",
        description:
          remaining > 0
            ? `Charged ${formatCurrency(data.amount, currency)}. ${formatCurrency(remaining, currency)} remains on hold.`
            : `Charged ${formatCurrency(data.amount, currency)}. Hold fully captured.`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast({
        title: "Failed to charge hold",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Shield className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <DialogTitle>Charge Pre-Auth Hold</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                Capture from the {formatCurrency(holdAmount, currency)} hold
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount to charge</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {symbol}
                      </span>
                      <Input
                        {...field}
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={holdAmount}
                        className="pl-8"
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? "" : parseFloat(e.target.value))
                        }
                        autoFocus
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={2}
                      placeholder="e.g. damage to rear bumper, excess mileage, cleaning fee"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {remaining > 0 && amount > 0 && (
              <Alert className="border-amber-500/30 bg-amber-500/5">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <AlertDescription className="text-xs">
                  {formatCurrency(remaining, currency)} will remain as an active hold on the card.
                </AlertDescription>
              </Alert>
            )}

            {remaining === 0 && amount > 0 && (
              <Alert className="border-red-500/30 bg-red-500/5">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <AlertDescription className="text-xs">
                  The full hold will be captured. No amount will remain on hold.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Charging…" : `Charge ${formatCurrency(amount || 0, currency)}`}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
