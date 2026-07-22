"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Banknote, CreditCard, DollarSign, Loader2, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";
import { extractFunctionError } from "@/lib/edge-error";

interface CollectPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
}

const PAYMENT_METHODS = ["Cash", "Card", "Bank Transfer", "Zelle", "Check", "Other"];

/**
 * CollectPaymentDialog — "collect first, decide later".
 *
 * Records money against the CUSTOMER (not a rental) and holds it as unallocated
 * account credit. The operator later steers it with the Allocate dialog. Three
 * collection methods:
 *   - Record manually → inserts a payment + invokes apply-payment with
 *     holdAsCredit so it lands as credit (no FIFO).
 *   - Charge via Stripe / Email Stripe Link → create-checkout-session with
 *     holdAsCredit; the webhook commits it as held credit when the customer pays.
 */
export const CollectPaymentDialog = ({ open, onOpenChange, customerId }: CollectPaymentDialogProps) => {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [paymentDate, setPaymentDate] = useState(() => formatInTimeZone(new Date(), "America/New_York", "yyyy-MM-dd"));
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const inFlight = useRef(false);

  const currencyCode = tenant?.currency_code || "USD";
  const currencySymbol = getCurrencySymbol(currencyCode);

  useEffect(() => {
    if (!open) {
      setAmount("");
      setMethod("Cash");
      setPaymentDate(formatInTimeZone(new Date(), "America/New_York", "yyyy-MM-dd"));
      setReference("");
      setLoading(false);
      setStripeLoading(false);
      setEmailLoading(false);
      inFlight.current = false;
    }
  }, [open]);

  const { data: customer } = useQuery({
    queryKey: ["collect-customer", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, email")
        .eq("id", customerId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: open && !!customerId,
  });

  const parsedAmount = parseFloat(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const busy = loading || stripeLoading || emailLoading;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["customer-payments"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["customer-balance"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["customer-balance-status"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["customers-list"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["customer-balances-enhanced"], refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: ["ledger-entries"], refetchType: "all" }),
    ]);
  };

  // Manual record → hold as credit.
  const handleRecord = async () => {
    if (inFlight.current || !validAmount || busy) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const { data: payment, error: paymentError } = await supabase
        .from("payments")
        .insert({
          customer_id: customerId,
          amount: parsedAmount,
          payment_date: paymentDate,
          method,
          payment_type: "Payment",
          status: "Completed",
          remaining_amount: parsedAmount,
          tenant_id: tenant?.id,
          verification_status: "approved",
          booking_source: "admin",
        })
        .select()
        .single();
      if (paymentError) throw paymentError;

      const { data: applyResult, error: applyError } = await supabase.functions.invoke("apply-payment", {
        body: { paymentId: payment.id, holdAsCredit: true },
      });

      // Roll back both rows if the hold fails, mirroring AddPaymentDialog — an
      // orphan ledger Payment entry would otherwise become phantom credit.
      if (applyError || !applyResult?.ok) {
        let ledgerDelete = supabase.from("ledger_entries").delete().eq("payment_id", payment.id).eq("type", "Payment");
        if (tenant?.id) ledgerDelete = ledgerDelete.eq("tenant_id", tenant.id);
        await ledgerDelete;
        let paymentDelete = supabase.from("payments").delete().eq("id", payment.id);
        if (tenant?.id) paymentDelete = paymentDelete.eq("tenant_id", tenant.id);
        await paymentDelete;
        throw new Error(applyError?.message || applyResult?.error || "Failed to record payment");
      }

      logAction({
        action: "payment_collected_as_credit",
        entityType: "payment",
        entityId: payment.id,
        details: { amount: parsedAmount, method, customer_id: customerId, reference: reference || undefined },
      });
      await invalidate();
      toast({
        title: "Payment recorded",
        description: `${formatCurrency(parsedAmount, currencyCode)} held as account credit. Use Allocate to apply it.`,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to record payment.", variant: "destructive" });
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  };

  const createCreditCheckout = async (opts: { successUrl: string; cancelUrl: string }) => {
    const { data, error } = await supabase.functions.invoke("create-checkout-session", {
      body: {
        customerId,
        customerEmail: customer?.email || undefined,
        customerName: customer?.name || "",
        totalAmount: parsedAmount,
        tenantId: tenant?.id,
        source: "portal",
        holdAsCredit: true,
        successUrl: opts.successUrl,
        cancelUrl: opts.cancelUrl,
      },
    });
    if (error) throw new Error(await extractFunctionError(error, "Failed to create checkout session"));
    if (!data?.url) throw new Error("No checkout URL returned");
    return data as { url: string; sessionId: string };
  };

  // Charge via Stripe → opens checkout; webhook holds the captured money as credit.
  const handleStripe = async () => {
    if (!validAmount || busy) return;
    setStripeLoading(true);
    try {
      const origin = window.location.origin;
      const data = await createCreditCheckout({
        successUrl: `${origin}/customers/${customerId}?payment=success`,
        cancelUrl: `${origin}/customers/${customerId}?payment=cancelled`,
      });
      window.open(data.url, "_blank");
      logAction({ action: "payment_credit_checkout_opened", entityType: "customer", entityId: customerId, details: { amount: parsedAmount } });
      toast({ title: "Stripe Checkout opened", description: "When the customer pays, it lands as account credit to allocate." });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to open Stripe checkout.", variant: "destructive" });
    } finally {
      setStripeLoading(false);
    }
  };

  // Email Stripe link → emails a generic pay link; webhook holds as credit.
  const handleEmail = async () => {
    if (!validAmount || busy) return;
    if (!customer?.email) {
      toast({ title: "No email", description: "This customer has no email address.", variant: "destructive" });
      return;
    }
    setEmailLoading(true);
    try {
      const baseDomain = process.env.NEXT_PUBLIC_BOOKING_BASE_DOMAIN || "drive-247.com";
      const fullOverride = process.env.NEXT_PUBLIC_BOOKING_BASE_URL;
      const bookingOrigin = fullOverride ? fullOverride.replace(/\/+$/, "") : `https://${tenant?.slug || "app"}.${baseDomain}`;

      const checkout = await createCreditCheckout({
        successUrl: `${bookingOrigin}/booking-success?type=invoice&status=paid&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${bookingOrigin}/portal`,
      });

      const { data, error } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          tenantId: tenant?.id,
          recipientEmail: customer.email,
          customerName: customer.name,
          amount: parsedAmount,
          paymentUrl: checkout.url,
          overrideAmount: parsedAmount,
          overrideDescription: "Account payment",
        },
      });
      if (error) throw new Error(error.message || "Failed to send payment email");
      if (data && !data.success) throw new Error(data.error || "Failed to send payment email");

      logAction({ action: "payment_credit_link_emailed", entityType: "customer", entityId: customerId, details: { amount: parsedAmount, email: customer.email } });
      toast({ title: "Payment link sent", description: `Emailed to ${customer.email}. Payment lands as account credit when paid.` });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to send payment email.", variant: "destructive" });
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-primary" />
            Collect Payment
          </DialogTitle>
          <DialogDescription>
            Collect money onto {customer?.name || "the customer"}&apos;s account. It&apos;s held as
            credit — you decide how to apply it afterwards with Allocate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="collect-amount">Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">{currencySymbol}</span>
              <Input
                id="collect-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-7 text-lg font-semibold h-11"
              />
            </div>
          </div>

          {/* Method + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="collect-date">Date</Label>
              <Input id="collect-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="h-9" />
            </div>
          </div>

          {/* Reference */}
          <div className="space-y-1.5">
            <Label htmlFor="collect-ref">Reference</Label>
            <Input id="collect-ref" placeholder="Optional" value={reference} onChange={(e) => setReference(e.target.value)} className="h-9" />
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2 pt-1">
          <Button className="w-full h-11" onClick={handleRecord} disabled={!validAmount || busy}>
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Recording...</> : <><DollarSign className="h-4 w-4 mr-2" /> Record manually</>}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-10 gap-2" onClick={handleStripe} disabled={!validAmount || busy}>
              {stripeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              <span className="text-sm">Charge via Stripe</span>
            </Button>
            <Button variant="outline" className="h-10 gap-2" onClick={handleEmail} disabled={!validAmount || busy || !customer?.email}>
              {emailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              <span className="text-sm">Email link</span>
            </Button>
          </div>
          <button type="button" className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
