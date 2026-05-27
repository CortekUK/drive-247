import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";

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

  // Partial captures are temporarily disabled until Stripe approves
  // multicapture for the platform's Connect accounts. Without multicapture,
  // a partial capture would release the uncaptured remainder back to the
  // customer (Stripe's default for single-capture PaymentIntents) and we'd
  // have to spin up a fresh authorisation for the remainder — which the
  // customer sees as the original hold dropping off and a new hold appearing
  // on their card. To avoid that surprise, the dialog locks to a FULL hold
  // capture for now. Re-enable the amount input once multicapture is granted.
  const schema = z.object({
    reason: z.string().min(1, "Reason is required"),
  });

  type FormData = z.infer<typeof schema>;

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { reason: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset({ reason: "" });
    }
  }, [open, form]);

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("capture-deposit-hold", {
        body: {
          rentalId,
          tenantId: tenant?.id,
          amount: holdAmount,
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
        description: `Charged ${formatCurrency(holdAmount, currency)}. Hold fully captured.`,
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
            {/* Loud, up-front notice that partial captures are temporarily off.
                Goes ABOVE the amount + reason so the operator reads it before
                anything else and there's no surprise after they click charge. */}
            <Alert className="border-amber-500/60 bg-amber-500/10">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="space-y-1.5 pl-1">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                  Partial pre-auth charging is not available right now.
                </p>
                <p className="text-xs leading-relaxed text-amber-900/85 dark:text-amber-100/85">
                  Charging this hold will capture the <strong>full {formatCurrency(holdAmount, currency)}</strong>.
                  <br />
                  <strong>Coming soon:</strong> we&apos;re enabling partial charges as soon as Stripe approves
                  the <em>multicapture</em> feature for your account — you&apos;ll then be able to charge any
                  amount and keep the rest on hold automatically.
                </p>
              </AlertDescription>
            </Alert>

            {/* Full-hold capture only — see comment block above the schema for
                why. Showing the amount as static text instead of an input makes
                it impossible to accidentally submit a partial value. */}
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Amount to charge</span>
              <span className="text-base font-semibold">{formatCurrency(holdAmount, currency)}</span>
            </div>

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
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                {submitting ? "Charging…" : `Charge ${formatCurrency(holdAmount, currency)}`}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
