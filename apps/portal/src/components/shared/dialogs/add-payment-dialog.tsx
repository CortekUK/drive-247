import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { CalendarIcon, DollarSign, Loader2, Banknote, CreditCard, Building2, Smartphone, FileText, MoreHorizontal, ExternalLink, Mail, ChevronDown, Info } from "lucide-react";
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
  extensionId?: string;
  /**
   * PAYG accrual id of the invoice the customer is paying off. When set, the
   * Charge-via-Stripe and Email-Stripe-Link paths forward it as
   * `paygAccrualId` to `create-checkout-session`, which stamps it on the
   * Stripe Checkout metadata. The Stripe webhook then calls
   * `payg_settle_invoice(payment_id, accrual_id)` to flip the accrual to
   * `paid` (and supersede earlier opens), so PAYG status mirrors the
   * non-PAYG flow where Stripe payments settle automatically.
   */
  paygAccrualId?: string;
  /**
   * scheduled_installments row id the customer is paying off. Same shape as
   * paygAccrualId — Charge-via-Stripe and Email-Stripe-Link paths forward it
   * to `create-checkout-session` which stamps `installment_id` on the Stripe
   * Checkout metadata. The Stripe webhook then calls
   * `installment_settle_invoice(payment_id, installment_id)` to flip the
   * scheduled installment to `paid` and supersede any cumulative
   * predecessors. The manual Record-Payment path settles the installment via
   * `mark-installment-paid` after the payment row commits (handled by the
   * parent's `onPaymentSuccess('recorded')` callback).
   */
  installmentId?: string;
  /**
   * Called after a successful action. The `kind` arg tells the caller whether
   * the payment is already settled in the DB or only initiated:
   *   - 'recorded' — manual Record Payment path; ledger + payment row are committed.
   *     Caller may safely run any "post-settle" logic (e.g. flipping invoice status).
   *   - 'pending'  — Charge-via-Stripe / Email-Stripe-Link path; only a checkout
   *     session was created. The actual Stripe webhook will commit the payment
   *     and run any settlement logic. Callers MUST NOT mark anything as paid here.
   * The arg is optional so existing callers that ignore it keep working.
   */
  onPaymentSuccess?: (kind?: 'recorded' | 'pending') => void;
  breakdownItems?: BreakdownItem[];
  /**
   * Authoritative outstanding balance computed by the caller. Use when the
   * parent has already calculated the rental's true outstanding (e.g. the
   * rental detail page composes ledger + invoice-fill + extension_totals to
   * get the same number as its Balance Due tile). Passing this avoids the
   * dialog's internal hooks under-counting cases where extension charges or
   * invoice fill-ins haven't yet landed in the ledger.
   */
  outstandingBalanceOverride?: number;
  /**
   * When true, the Stripe webhook will place a deposit pre-auth hold off-session
   * after the customer pays the rental — using the card they just used to pay.
   * Set true from the new-rental post-creation flow when the tenant has
   * security_deposit_enabled and global_deposit_amount > 0. The webhook handles
   * the hold via place-deposit-hold; if the rental already has a hold, that
   * edge function no-ops.
   */
  placeDepositHoldAfter?: boolean;
  /**
   * Effective security-deposit amount for THIS rental (the rental's
   * deposit_amount_override if set, otherwise the tenant's
   * global_deposit_amount). Used in the per-mode confirmation popup so the
   * operator sees the actual amount that will be held / quoted to the
   * customer — not just the tenant default.
   */
  depositHoldAmount?: number;
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
  extensionId,
  paygAccrualId,
  installmentId,
  onPaymentSuccess,
  breakdownItems,
  outstandingBalanceOverride,
  placeDepositHoldAfter,
  depositHoldAmount: depositHoldAmountProp,
}: AddPaymentDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  // Pending action awaiting operator confirmation in the deposit-hold popup.
  // Only used when placeDepositHoldAfter+tenant deposit is configured; in every
  // other context the buttons run their handlers immediately as before.
  const [pendingConfirm, setPendingConfirm] = useState<
    | { type: 'record'; data: PaymentFormData }
    | { type: 'stripe' }
    | { type: 'email' }
    | null
  >(null);
  // Bypass flag set just before re-invoking the manual onSubmit after the
  // operator confirms — avoids re-opening the popup in an infinite loop.
  const skipConfirmRef = useRef(false);
  // Synchronous double-submit guards. React `loading` state is async — between
  // a click and the next render, a second click can slip through and create a
  // duplicate payment / duplicate Stripe checkout. Refs update synchronously
  // so they catch rapid double-clicks even within the same event-loop tick.
  const submitInFlight = useRef(false);
  const stripeInFlight = useRef(false);
  const emailInFlight = useRef(false);
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
      else if (defaultAmount) form.setValue("amount", Math.round(defaultAmount * 100) / 100);
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
  const computedOutstanding = rentalId ? Math.max(rentalOutstanding, customerOutstanding) : customerOutstanding;
  // When the parent passes an override (e.g. rental detail page), trust it — it
  // composes ledger + invoice-fill + extension_totals which the dialog's hooks
  // can't see on their own. Falls back to the internal computation otherwise.
  const outstandingBalance = (typeof outstandingBalanceOverride === 'number' && outstandingBalanceOverride > 0)
    ? outstandingBalanceOverride
    : computedOutstanding;

  // Auto-fill amount with outstanding balance when it loads (and no defaultAmount was provided)
  useEffect(() => {
    if (open && outstandingBalance > 0 && !defaultAmount && !form.getValues("amount")) {
      // Round to 2dp — outstandingBalance is a sum of fractional charges and can carry FP noise.
      form.setValue("amount", Math.round(outstandingBalance * 100) / 100);
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
      queryClient.invalidateQueries({ queryKey: ["rental-extension-totals"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-insurance-policies"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-invoice"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["ledger-entries"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["payment-applications"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["outstanding-balance"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["excess-mileage-charge"], ...invalidateOptions }),
      queryClient.invalidateQueries({ queryKey: ["rental-charges-payments"], ...invalidateOptions }),
    ]);

    if (rentalId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-totals", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["rental-charges", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["rental-payments", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["rental", rentalId], ...invalidateOptions }),
        queryClient.invalidateQueries({ queryKey: ["excess-mileage-charge", rentalId], ...invalidateOptions }),
      ]);
    }

    if (finalCustomerId) {
      await queryClient.invalidateQueries({ queryKey: ["customer-balance", finalCustomerId], ...invalidateOptions });
    }
  };

  // True when there's something worth confirming with the operator — i.e. the
  // post-rental-creation flow opened the dialog and the tenant actually has a
  // non-zero security deposit, so the choice of mode meaningfully affects the
  // hold outcome. In any other context (paying down an existing balance, etc.)
  // the popup adds friction with no value, so we bypass it.
  // Effective deposit amount for confirmation copy + downstream API calls:
  // the rental-specific override (passed in from the new-rental page) wins
  // over the tenant default. Without this the popup would show $3 even when
  // the operator set $10 on the Pre-Auth input.
  const effectiveDepositAmount = depositHoldAmountProp && depositHoldAmountProp > 0
    ? depositHoldAmountProp
    : Number(tenant?.global_deposit_amount) || 0;

  const shouldConfirmMode = !!placeDepositHoldAfter
    && !!tenant?.security_deposit_enabled
    && effectiveDepositAmount > 0;

  // Manual payment submit
  const onSubmit = async (data: PaymentFormData) => {
    // Gate: if the operator hasn't yet seen the "Record Payment doesn't auto-hold"
    // confirmation, show it instead of submitting. After they confirm we re-call
    // this with skipConfirmRef set so the gate falls through.
    if (shouldConfirmMode && !skipConfirmRef.current) {
      setPendingConfirm({ type: 'record', data });
      return;
    }
    skipConfirmRef.current = false;
    // Synchronous double-submit guard — see ref declaration for rationale.
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setLoading(true);
    try {
      const finalCustomerId = data.customer_id || customer_id;
      const finalVehicleId = data.vehicle_id || vehicle_id;

      // Block submit if we couldn't resolve a rental for this payment. Without a
      // rental_id the payment row is inserted unlinked and `apply-payment` either
      // FIFOs across the customer's charges (lands on the wrong rental) or
      // becomes a Credit with zero applications — invisible to the intended
      // rental's "Collected" tile. Operator must pick the vehicle (= rental).
      if (!rentalId) {
        toast({
          title: "Select a rental",
          description: customerVehicles.length === 0
            ? "This customer has no active rental to apply the payment to."
            : "Pick the vehicle of the rental this payment applies to.",
          variant: "destructive",
        });
        setLoading(false);
        submitInFlight.current = false;
        return;
      }

      // Duplicate-payment guard. Staff have hit this multiple times — most
      // notably RevTek's R-1ac41d where the same $390.55 was recorded twice
      // (once after the customer paid the Stripe link, then again two days
      // later when no one was sure if the first entry had landed). Catch the
      // common case: same rental, same amount, recorded within the last 14
      // days, status not Cancelled. Applies to all entry paths (including
      // bundled Collect Now flows) because the duplicate is defined by what
      // hits the DB, not how staff got here.
      const recentWindowMs = 14 * 24 * 60 * 60 * 1000;
      const sinceIso = new Date(Date.now() - recentWindowMs).toISOString();
      const { data: recentMatches } = await supabase
        .from('payments')
        .select('id, amount, payment_date, created_at, method, status, booking_source')
        .eq('rental_id', rentalId)
        .eq('amount', data.amount)
        .neq('status', 'Cancelled')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(1);

      if (recentMatches && recentMatches.length > 0) {
        const m = recentMatches[0] as any;
        const when = m.payment_date
          ? new Date(`${m.payment_date}T00:00:00`).toLocaleDateString()
          : new Date(m.created_at).toLocaleDateString();
        const sourceLabel = m.booking_source === 'website' ? 'customer checkout' : (m.method ? `${m.method} payment` : 'payment');
        const confirmDuplicate = window.confirm(
          `A ${sourceLabel} of ${formatCurrency(Number(m.amount), tenant?.currency_code || 'USD')} was already recorded on this rental on ${when}.\n\nThis may be a duplicate. Continue anyway?`
        );
        if (!confirmDuplicate) {
          setLoading(false);
          submitInFlight.current = false;
          return;
        }
      }

      // Skip overpayment/zero-balance checks when defaultAmount is provided (extension payments, targeted payments)
      // The caller already calculated the correct amount
      if (!defaultAmount) {
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
          status: 'Completed',
          remaining_amount: data.amount,
          tenant_id: tenant?.id,
          verification_status: 'approved',
          ...(targetCategories && targetCategories.length > 0 ? { target_categories: targetCategories } : {}),
          ...(extensionId ? { extension_id: extensionId } : {}),
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      const applyBody: any = { paymentId: payment.id };
      if (targetCategories && targetCategories.length > 0) {
        applyBody.targetCategories = targetCategories;
      }
      if (extensionId) {
        applyBody.extensionId = extensionId;
      }
      const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', { body: applyBody });

      // Roll back BOTH the ledger Payment entry AND the payments row when apply-payment
      // fails. Without the ledger delete, the FK fk_ledger_entries_payment_id (ON DELETE
      // SET NULL) leaves an orphan ledger Payment row with payment_id = NULL — and FIFO
      // on subsequent payments will happily drain it against open charges, producing
      // phantom credit. We hit this on one tenant where a $390.55 orphan made a
      // customer appear $390.55 in credit on top of his real payments.
      const rollbackPayment = async () => {
        let ledgerDelete = supabase
          .from('ledger_entries')
          .delete()
          .eq('payment_id', payment.id)
          .eq('type', 'Payment');
        if (tenant?.id) ledgerDelete = ledgerDelete.eq('tenant_id', tenant.id);
        await ledgerDelete;

        let paymentDelete = supabase.from('payments').delete().eq('id', payment.id);
        if (tenant?.id) paymentDelete = paymentDelete.eq('tenant_id', tenant.id);
        await paymentDelete;
      };

      if (applyError) {
        await rollbackPayment();
        throw new Error(applyError.message || 'Payment processing failed');
      }
      if (!applyResult?.ok) {
        await rollbackPayment();
        throw new Error(applyResult?.error || applyResult?.detail || 'Payment processing failed');
      }

      toast({ title: "Payment Recorded", description: `Payment of ${formatCurrency(data.amount, tenant?.currency_code || 'USD')} has been recorded and applied.` });
      logAction({ action: "payment_created", entityType: "payment", entityId: payment.id, details: { amount: data.amount, method: data.method || "manual", customer_id: finalCustomerId } });
      await invalidateAllPaymentQueries(finalCustomerId);
      if (onPaymentSuccess) onPaymentSuccess('recorded');
      form.reset();
      onOpenChange(false);
    } catch (error) {
      console.error("Error adding payment:", error);
      toast({ title: "Error", description: (error as any).message || "Failed to add payment.", variant: "destructive" });
    } finally {
      setLoading(false);
      submitInFlight.current = false;
    }
  };

  // Stripe checkout handler
  const handleStripePayment = async () => {
    if (stripeInFlight.current) return;
    const finalCustomerId = selectedCustomerId || customer_id;
    if (!finalCustomerId) { toast({ title: "Error", description: "Please select a customer first.", variant: "destructive" }); return; }
    if (!rentalId) {
      toast({
        title: "Select a rental",
        description: customerVehicles.length === 0
          ? "This customer has no active rental to apply the payment to."
          : "Pick the vehicle of the rental this payment applies to.",
        variant: "destructive",
      });
      return;
    }

    const amount = form.getValues("amount") || breakdownTotal || defaultAmount || outstandingBalance || rentalDetails?.monthly_amount || latestInvoice?.total_amount || 0;
    if (amount <= 0) { toast({ title: "Error", description: "No outstanding amount to charge.", variant: "destructive" }); return; }

    stripeInFlight.current = true;
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
          ...(extensionId ? { extensionId } : {}),
          // PAYG: stamp the accrual id on the checkout metadata so the Stripe
          // webhook can call payg_settle_invoice once the customer pays.
          ...(paygAccrualId ? { paygAccrualId } : {}),
          // Installments: stamp the scheduled_installments id so the Stripe
          // webhook can call installment_settle_invoice once the customer pays.
          ...(installmentId ? { installmentId } : {}),
          // First-rental flow: after the rental payment captures, the webhook
          // invokes place-deposit-hold to authorise the deposit off-session on
          // the same saved card.
          ...(placeDepositHoldAfter ? { placeDepositHoldAfter: true } : {}),
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
      // 'pending' — Stripe webhook will commit + settle the payment. Caller must NOT
      // flip any local "paid" state here.
      if (onPaymentSuccess) onPaymentSuccess('pending');
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error creating Stripe checkout:", error);
      toast({ title: "Error", description: error.message || "Failed to create Stripe checkout.", variant: "destructive" });
    } finally {
      setStripeLoading(false);
      stripeInFlight.current = false;
    }
  };

  // Email Stripe link handler — creates checkout session first, then emails it
  const handleSendInvoiceEmail = async () => {
    if (emailInFlight.current) return;
    const finalCustomerId = selectedCustomerId || customer_id;
    if (!finalCustomerId) { toast({ title: "Error", description: "Please select a customer first.", variant: "destructive" }); return; }
    if (!customerEmail) { toast({ title: "Error", description: "Customer has no email address.", variant: "destructive" }); return; }
    if (!rentalId || !rentalDetails) { toast({ title: "Error", description: "No rental found.", variant: "destructive" }); return; }

    const invoiceToSend = latestInvoice;

    emailInFlight.current = true;
    setEmailLoading(true);
    try {
      const amount = form.getValues("amount") || breakdownTotal || invoiceToSend?.total_amount || rentalDetails?.monthly_amount || 0;

      // Mirror the PAYG reminder cron's URL strategy: emails go to real
      // customers and must always land on production (or wherever the customer
      // can actually reach). NEVER point at localhost — even when the admin is
      // testing from a local dev portal, the customer reading the email is on
      // their own machine and can't resolve test.localhost:3000.
      //
      // Resolution order (matches send-payg-reminders' deriveBookingOrigin):
      //   1. NEXT_PUBLIC_BOOKING_BASE_URL — explicit override (single-domain
      //      deployments or QA environments)
      //   2. https://{tenant.slug}.{NEXT_PUBLIC_BOOKING_BASE_DOMAIN || drive-247.com}
      //
      // Local DB updates still propagate because production booking-success
      // hits the same shared Supabase project, AND the rental detail page's
      // localStorage polling on the admin's machine fires `process-pending-payment`
      // every 5s for 5min as a safety net even if the customer never lands.
      const fullOverride = process.env.NEXT_PUBLIC_BOOKING_BASE_URL;
      const baseDomain = process.env.NEXT_PUBLIC_BOOKING_BASE_DOMAIN || 'drive-247.com';
      const bookingOrigin = fullOverride
        ? fullOverride.replace(/\/+$/, '')
        : `https://${tenant?.slug || 'app'}.${baseDomain}`;

      // Step 1: Create Stripe checkout session
      const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId,
          customerEmail,
          customerName,
          totalAmount: amount,
          tenantId: tenant?.id,
          successUrl: `${bookingOrigin}/booking-success?type=invoice&status=paid&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${bookingOrigin}/portal/payments`,
          source: 'portal',
          ...(targetCategories && targetCategories.length > 0 ? { targetCategories } : {}),
          ...(extensionId ? { extensionId } : {}),
          // PAYG: stamp the accrual id so when the customer clicks the
          // emailed link and pays, the Stripe webhook settles the right invoice.
          ...(paygAccrualId ? { paygAccrualId } : {}),
          // Installments: stamp the scheduled_installments id so the Stripe
          // webhook can settle the right installment when the customer pays.
          ...(installmentId ? { installmentId } : {}),
          // First-rental flow: after the rental payment captures, the webhook
          // invokes place-deposit-hold to authorise the deposit off-session on
          // the same saved card.
          ...(placeDepositHoldAfter ? { placeDepositHoldAfter: true } : {}),
        },
      });

      if (checkoutError || !checkoutData?.url) {
        throw new Error(checkoutError?.message || 'Failed to create payment link');
      }

      // Step 2: Send email with payment link (works with or without an existing invoice)
      // ALWAYS pass overrideAmount so the email's headline + Pay Now button match
      // the amount Stripe will actually charge. Without this, when the operator
      // is paying down a partial outstanding balance against a rental that has
      // an existing invoice on file, the email would default to showing the
      // INVOICE's total_amount (the full original invoice) instead of the
      // remaining balance the customer actually owes today — confusing the
      // customer with two different numbers (email vs Stripe Checkout).
      const { data, error } = await supabase.functions.invoke('send-invoice-email', {
        body: {
          ...(invoiceToSend ? { invoiceId: invoiceToSend.id } : { rentalId, customerName, amount }),
          tenantId: tenant?.id,
          recipientEmail: customerEmail,
          paymentUrl: checkoutData.url,
          overrideAmount: amount,
          // When the rental payment will also trigger a deposit hold, pass the
          // hold amount so the email template can render the transparency
          // notice for the customer alongside the Pay Now button. Uses the
          // per-rental override when set, falls back to tenant default.
          ...(placeDepositHoldAfter && tenant?.security_deposit_enabled && effectiveDepositAmount > 0
            ? { depositHoldAmount: effectiveDepositAmount }
            : {}),
          ...(targetCategories && targetCategories.length > 0
            ? { overrideDescription: `Payment for: ${targetCategories.join(', ')}` }
            : invoiceToSend && Math.abs(amount - (invoiceToSend.total_amount ?? amount)) > 0.01
              ? { overrideDescription: 'Outstanding balance' }
              : {}),
        },
      });
      if (error) throw new Error(error.message || 'Failed to send payment email');
      if (data && !data.success) throw new Error(data.error || 'Failed to send payment email');

      // Store the checkout session ID so the rental detail page can poll for it
      if (checkoutData.sessionId && rentalId) {
        localStorage.setItem(`pending_email_payment_${rentalId}`, checkoutData.sessionId);
      }

      toast({ title: "Payment Link Sent", description: `Payment link emailed to ${customerEmail}. Payment will be recorded automatically when the customer pays.` });
      // 'pending' — Stripe webhook will commit + settle the payment when the
      // customer clicks the link and completes checkout.
      if (onPaymentSuccess) onPaymentSuccess('pending');
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending payment email:", error);
      toast({ title: "Error", description: error.message || "Failed to send payment email.", variant: "destructive" });
    } finally {
      setEmailLoading(false);
      emailInFlight.current = false;
    }
  };

  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'USD');
  const stripeAmount = breakdownTotal || defaultAmount || outstandingBalance || rentalDetails?.monthly_amount || latestInvoice?.total_amount || 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isAnyLoading) onOpenChange(v); }}>
      <DialogContent className="max-w-[calc(100vw-16px)] sm:max-w-[460px] p-0 gap-0 overflow-hidden max-h-[calc(100dvh-16px)] sm:max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Record Payment</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
              {targetCategories && targetCategories.length > 0
                ? `Paying for: ${targetCategories.join(', ')}`
                : 'Record a payment against outstanding charges.'
              }
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Customer/Vehicle selection when not pre-populated */}
        {(!customer_id || !vehicle_id) && (
          <div className="px-4 sm:px-6 pb-4 space-y-3 border-b">
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

            {!vehicle_id && !propRentalId && (
              <div>
                <Label className="text-sm font-medium">
                  Vehicle <span className="text-red-500">*</span>
                </Label>
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
            <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5">
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
                    ) : defaultAmount !== undefined ? (
                      // Read-only amount display when the caller pre-computed the amount
                      // (individual category, collective selection, Bonzah insurance,
                      // extension payments, etc. — amount is derived from outstanding
                      // and must not be edited by hand).
                      <div className="flex items-center h-12 px-3 rounded-md border bg-muted/50 text-lg font-semibold">
                        <span className="text-muted-foreground text-sm mr-1">{currencySymbol}</span>
                        {formatCurrency(field.value || 0, tenant?.currency_code || 'USD').replace(/^[^\d]*/, '')}
                      </div>
                    ) : (
                      <>
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">{currencySymbol}</span>
                            <Input
                              type="number" step="0.01" placeholder="0.00"
                              className="pl-7 text-lg font-semibold h-12"
                              {...field}
                              value={typeof field.value === 'number' ? Math.round(field.value * 100) / 100 : ''}
                              onChange={(e) => {
                                if (e.target.value === '') {
                                  field.onChange(undefined);
                                  return;
                                }
                                const parsed = parseFloat(e.target.value);
                                field.onChange(Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : undefined);
                              }}
                            />
                          </div>
                        </FormControl>
                        {outstandingBalance !== undefined && outstandingBalance > 0 && field.value !== Math.round(outstandingBalance * 100) / 100 && (
                          <button type="button" className="text-xs text-primary hover:underline" onClick={() => field.onChange(Math.round(outstandingBalance * 100) / 100)}>
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
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t bg-muted/30 space-y-2">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isAnyLoading || stripeAmount <= 0}
                    onClick={() => {
                      if (shouldConfirmMode) {
                        setPendingConfirm({ type: 'stripe' });
                      } else {
                        handleStripePayment();
                      }
                    }}
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
                    onClick={() => {
                      if (shouldConfirmMode) {
                        setPendingConfirm({ type: 'email' });
                      } else {
                        handleSendInvoiceEmail();
                      }
                    }}
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

      {/* Mode confirmation popup — only renders when shouldConfirmMode is true
          and the operator has picked a button. Spells out exactly what will
          happen for THIS specific mode (different copy for record vs Stripe).
          Confirming runs the original handler; cancelling just dismisses. */}
      <Dialog open={!!pendingConfirm} onOpenChange={(open) => { if (!open) setPendingConfirm(null); }}>
        <DialogContent className="sm:max-w-[460px]">
          {pendingConfirm?.type === 'record' && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <Info className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <DialogTitle className="text-base">Record Payment — no automatic hold</DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      You&apos;re recording <strong>{formatCurrency(stripeAmount, tenant?.currency_code || 'USD')}</strong> as a manual payment (cash, bank transfer, etc.). Stripe is not charged.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="text-xs text-muted-foreground leading-relaxed space-y-2 pt-1">
                <p>
                  Because no card is on file, the <strong>{formatCurrency(effectiveDepositAmount, tenant?.currency_code || 'USD')} deposit hold</strong> will <strong>not</strong> be placed automatically.
                </p>
                <p>
                  To still secure the deposit, open the rental after recording this payment and use the <em>Place Pre-Auth Hold</em> button — it sends the customer a Stripe link (or opens one in-person) for the hold only.
                </p>
              </div>
              <div className="flex gap-2 justify-end pt-3">
                <Button variant="outline" onClick={() => setPendingConfirm(null)}>Cancel</Button>
                <Button
                  onClick={() => {
                    const data = pendingConfirm.data;
                    setPendingConfirm(null);
                    skipConfirmRef.current = true;
                    void onSubmit(data);
                  }}
                >
                  Record without hold
                </Button>
              </div>
            </>
          )}

          {pendingConfirm?.type === 'stripe' && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <CreditCard className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                  <div>
                    <DialogTitle className="text-base">Charge via Stripe</DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      Opens a Stripe Checkout in a new tab for the customer.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="text-xs text-muted-foreground leading-relaxed space-y-2 pt-1">
                <p>
                  Customer is charged <strong>{formatCurrency(stripeAmount, tenant?.currency_code || 'USD')}</strong> for rental fees.
                </p>
                <p>
                  Immediately after the charge captures, a separate <strong>{formatCurrency(effectiveDepositAmount, tenant?.currency_code || 'USD')} pre-authorisation hold</strong> (not a charge) is placed on the same card — the customer only enters their card once.
                </p>
              </div>
              <div className="flex gap-2 justify-end pt-3">
                <Button variant="outline" onClick={() => setPendingConfirm(null)}>Cancel</Button>
                <Button
                  onClick={() => {
                    setPendingConfirm(null);
                    void handleStripePayment();
                  }}
                >
                  Open Stripe Checkout
                </Button>
              </div>
            </>
          )}

          {pendingConfirm?.type === 'email' && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <Mail className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <DialogTitle className="text-base">Email Stripe Link</DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      Emails the customer a Stripe payment link they can pay at their convenience.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="text-xs text-muted-foreground leading-relaxed space-y-2 pt-1">
                <p>
                  When the customer pays, they&apos;ll be charged <strong>{formatCurrency(stripeAmount, tenant?.currency_code || 'USD')}</strong> for rental fees.
                </p>
                <p>
                  Immediately after the charge captures, a separate <strong>{formatCurrency(effectiveDepositAmount, tenant?.currency_code || 'USD')} pre-authorisation hold</strong> (not a charge) is placed on the same card — the customer only enters their card once.
                </p>
              </div>
              <div className="flex gap-2 justify-end pt-3">
                <Button variant="outline" onClick={() => setPendingConfirm(null)}>Cancel</Button>
                <Button
                  onClick={() => {
                    setPendingConfirm(null);
                    void handleSendInvoiceEmail();
                  }}
                >
                  Send link
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};
