import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { Shield, CreditCard, Mail } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";

interface AddHoldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  customerEmail?: string | null;
  onSuccess?: () => void;
}

// create-hold-checkout returns machine skip codes; show operators plain English.
const HOLD_SKIP_MESSAGES: Record<string, string> = {
  auto_extend_rental:
    "This is an auto-extension rental — deposits are never held on these (the renewal price replaces the deposit).",
  // Legacy code from before the guard was narrowed (Jul 2026); kept for safety.
  auto_extend_or_extended_rental:
    "This is an auto-extension rental — deposits are never held on these (the renewal price replaces the deposit).",
  hold_already_active: "A deposit hold is already active on this rental.",
  deposit_disabled_for_tenant: "Security deposits are disabled in your settings.",
  deposit_amount_is_zero: "The deposit amount is 0 — set a deposit amount in settings or on the rental first.",
};
const describeHoldSkip = (code: string): string => HOLD_SKIP_MESSAGES[code] || `Hold not placed (${code}).`;

export const AddHoldDialog = ({
  open,
  onOpenChange,
  rentalId,
  customerEmail,
  onSuccess,
}: AddHoldDialogProps) => {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const [stripeLoading, setStripeLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);

  const currency = tenant?.currency_code || "USD";
  const holdAmount = Number(tenant?.global_deposit_amount) || 0;
  const busy = stripeLoading || emailLoading;

  // Derive the booking app's origin from the portal origin so local dev hits
  // the local booking app, not production.
  //   test.portal.localhost:3001  -> test.localhost:3000
  //   test.portal.drive-247.com   -> test.drive-247.com
  const getBookingOrigin = (): string => {
    if (typeof window === "undefined") return "";
    const host = window.location.host.replace(".portal.", ".").replace(":3001", ":3000");
    return `${window.location.protocol}//${host}`;
  };

  const handlePlaceViaStripe = async () => {
    setStripeLoading(true);
    try {
      const portalOrigin = window.location.origin;
      const { data, error } = await supabase.functions.invoke("create-hold-checkout", {
        body: {
          rentalId,
          successUrl: `${portalOrigin}/rentals/${rentalId}?hold=placed&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${portalOrigin}/rentals/${rentalId}?hold=cancelled`,
        },
      });
      if (error) throw new Error(error.message || "Failed to create hold checkout");
      if (data?.skipped) {
        toast({ title: "Hold not placed", description: describeHoldSkip(data.skipped), variant: "destructive" });
        return;
      }
      if (!data?.url) throw new Error("No checkout URL returned");

      window.open(data.url, "_blank");
      toast({
        title: "Checkout opened",
        description: "Hold will be placed when the customer completes authorisation.",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed", variant: "destructive" });
    } finally {
      setStripeLoading(false);
    }
  };

  const handleSendEmail = async () => {
    if (!customerEmail) {
      toast({ title: "No email", description: "Customer has no email on file.", variant: "destructive" });
      return;
    }
    setEmailLoading(true);
    try {
      const bookingOrigin = getBookingOrigin();
      // Step 1: Create hold-only checkout session
      const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke("create-hold-checkout", {
        body: {
          rentalId,
          successUrl: `${bookingOrigin}/booking-success?type=hold&status=placed&rental_id=${rentalId}&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${bookingOrigin}/booking-cancelled?rental_id=${rentalId}`,
        },
      });
      if (checkoutError) throw new Error(checkoutError.message || "Failed to create hold session");
      if (checkoutData?.skipped) {
        toast({ title: "Hold not created", description: describeHoldSkip(checkoutData.skipped), variant: "destructive" });
        return;
      }
      if (!checkoutData?.url) throw new Error("No checkout URL returned");

      // Step 2: Email the link (reuse existing invoice email function with overrides)
      const { error: emailError } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          rentalId,
          tenantId: tenant?.id,
          recipientEmail: customerEmail,
          paymentUrl: checkoutData.url,
          overrideAmount: holdAmount,
          overrideDescription: `Security deposit authorisation (hold only — not a charge)`,
        },
      });
      if (emailError) throw new Error(emailError.message || "Failed to send email");

      toast({
        title: "Hold link sent",
        description: `Emailed ${customerEmail}. The hold will appear once the customer completes authorisation.`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed", variant: "destructive" });
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Shield className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <DialogTitle>Place Pre-Auth Hold</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                {formatCurrency(holdAmount, currency)} will be authorised on the customer's card — not captured.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-3 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={handlePlaceViaStripe}
            className="group flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="mt-0.5 h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
              <CreditCard className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {stripeLoading ? "Opening…" : "Place via Stripe"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Opens Stripe Checkout in a new tab. Use this if the customer is with you.
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={busy || !customerEmail}
            onClick={handleSendEmail}
            className="group flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="mt-0.5 h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
              <Mail className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {emailLoading ? "Sending…" : "Send email link"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {customerEmail
                  ? `Emails ${customerEmail} with a hold link. Customer authorises at their convenience.`
                  : "Customer has no email on file."}
              </div>
            </div>
          </button>
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
