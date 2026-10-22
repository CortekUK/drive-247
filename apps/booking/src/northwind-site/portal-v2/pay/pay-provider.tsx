'use client';

/**
 * Paying a booking's outstanding balance, from anywhere in the portal.
 *
 * The customer pays for every rental, including the ones the operator created
 * in the admin portal: they get an email and pay here (owner, Oct 22 2026). So
 * the Pay button is not one section of Finances any more — it sits on the
 * invoice row, in the invoice dialog, on the rental page and in the alert bar.
 * They all call `usePay().pay(rentalId)`, and this provider (mounted once in
 * the shell) owns the one money-moving path behind them.
 *
 * ── WHY A BOOKING IS THE UNIT ───────────────────────────────────────────────
 * `create-booking-payment-intent` prices from a rental's open ledger charges
 * and refuses a request without one. An invoice belongs to one rental, so
 * "pay this invoice" is "pay what is open on its rental".
 *
 * ── THE INTENT IS MINTED HERE, NOT BY THE PANEL ─────────────────────────────
 * If minting fails — the endpoint is down, or the amount moved under us — the
 * customer is told at once (a toast, next to whichever button they pressed),
 * not inside a dialog they then have to dismiss. The card dialog opens only
 * when there is a real card form to put in it.
 *
 * ── THE DIALOG IS THE BOOKING FLOW'S, DELIBERATELY ──────────────────────────
 * `PaymentPanel` carries the Stripe framing, the off-session mandate, 3-D
 * Secure and the failure copy; only its wording changes (PORTAL_COPY): this
 * customer is settling a charge, not confirming a new booking.
 *
 * ── SETTLEMENT IS OBSERVED, NEVER ASSUMED ───────────────────────────────────
 * After the card succeeds the provider watches the ledger until the booking's
 * balance falls below what was charged (useSettlementWatch), and says so.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner-nw';

import { PaymentPanel, type PaymentPanelCopy } from '@nw/components/booking/payment-panel';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerPayments, type PayableBalance } from '@nw/hooks/use-customer-payments';
import type { BookingPaymentIntentResponse } from '@nw/hooks/use-payment-intent';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { createBalancePaymentIntent } from '@nw/lib/stripe/create-balance-payment-intent';
import { cn } from '@nw/lib/utils';

import { SettlementNotice, useSettlementWatch, type SettlementPhase } from './settlement-watch';

const PORTAL_COPY: Partial<PaymentPanelCopy> = {
  title: 'Pay your balance',
  cancelLabel: 'Cancel',
  succeededTitle: 'Payment received',
  succeededBody: 'Thank you — your card has been charged. We are updating your balance now.',
  processingTitle: 'Payment is being confirmed',
  processingBody:
    'Your bank has not settled this yet. Your balance will update on its own once it clears — there is nothing more to do.',
  referencePrefix: 'Booking',
  doneLabel: 'Close',
  mandate:
    'to charge this card for the amount shown above, and to store it securely ' +
    'so it can be used for any charges you have already agreed to on this ' +
    'booking. You can ask us to remove the card once the rental is closed and ' +
    'settled.',
};

interface PayContextValue {
  /** What can be paid on a rental now, or null (nothing open, or not payable here). */
  payableFor: (rentalId: string | null | undefined) => PayableBalance | null;
  /** Start paying a rental's open balance. */
  pay: (rentalId: string) => void;
  /** The rental whose intent is being minted. */
  minting: string | null;
  /** The rental whose settlement is being watched, and how far along. */
  watching: { rentalId: string; phase: SettlementPhase } | null;
}

const PayContext = createContext<PayContextValue | null>(null);

export function usePay(): PayContextValue {
  const value = useContext(PayContext);
  if (!value) throw new Error('usePay must be used inside <PayProvider>');
  return value;
}

export function PayProvider({ children }: { children: React.ReactNode }) {
  const { formatCurrency } = useTenantBranding();
  const { tenant } = useTenant();
  const { customerId, email, displayName } = useCustomer();
  const { payableBalances, refetch } = useCustomerPayments();

  const [minting, setMinting] = useState<string | null>(null);
  const [active, setActive] = useState<{ target: PayableBalance; intent: BookingPaymentIntentResponse } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Outlives the dialog: the customer can close it the instant it says
  // "Payment received", before the webhook has landed.
  const [watched, setWatched] = useState<{ rentalId: string; chargedAmount: number } | null>(null);

  const payableFor = useCallback(
    (rentalId: string | null | undefined) =>
      rentalId ? (payableBalances.find((row) => row.rentalId === rentalId && row.blockedReason === null) ?? null) : null,
    [payableBalances],
  );

  const current = watched ? (payableBalances.find((row) => row.rentalId === watched.rentalId) ?? null) : null;
  const settled = watched !== null && (current === null || current.amount < watched.chargedAmount);
  const phase = useSettlementWatch(watched !== null, settled, refetch);

  const toastedFor = useRef<string | null>(null);
  useEffect(() => {
    if (watched === null) {
      toastedFor.current = null;
      return;
    }
    if (toastedFor.current === watched.rentalId) return;
    if (phase === 'settled') {
      toastedFor.current = watched.rentalId;
      toast.success('Payment settled', { description: 'Your balance has been updated.' });
    } else if (phase === 'slow') {
      toastedFor.current = watched.rentalId;
      toast.info('Payment received', { description: 'Your balance has not caught up yet. It usually does within a few minutes.' });
    }
  }, [phase, watched]);

  const pay = useCallback(
    (rentalId: string) => {
      const target = payableBalances.find((row) => row.rentalId === rentalId && row.blockedReason === null);
      if (!target || tenant === null || customerId === null || minting !== null) return;
      setMinting(rentalId);
      void createBalancePaymentIntent({
        rentalId,
        tenantSlug: tenant.slug,
        tenantId: tenant.id,
        customerId,
        customerEmail: email ?? '',
        customerName: displayName ?? '',
        // The server re-prices from the ledger and refuses the request if this
        // disagrees by more than a cent: the figure on the button is the figure
        // charged, or nothing is charged at all.
        expectedAmount: target.amount,
      }).then((result) => {
        setMinting(null);
        if (!result.ok) {
          toast.error('We could not start the payment', { description: result.failure.message });
          // A stale figure is one cause: re-read so the next number is true.
          void refetch();
          return;
        }
        setActive({ target, intent: result.intent });
        setDialogOpen(true);
      });
    },
    [customerId, displayName, email, minting, payableBalances, refetch, tenant],
  );

  const value = useMemo<PayContextValue>(
    () => ({
      payableFor,
      pay,
      minting,
      watching: watched && !dialogOpen ? { rentalId: watched.rentalId, phase } : null,
    }),
    [dialogOpen, minting, pay, payableFor, phase, watched],
  );

  return (
    <PayContext.Provider value={value}>
      {children}
      <PaymentPanel
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        // Already minted above, so the panel is handed the intent, not a request.
        request={null}
        prepared={active?.intent ?? null}
        rentalId={active?.target.rentalId ?? null}
        amountLabel={formatCurrency(active?.target.amount ?? 0)}
        vehicleLabel={active?.target.rental?.vehicle?.displayName ?? 'Your booking'}
        resume={null}
        copy={PORTAL_COPY}
        outcomeFooter={watched !== null ? <SettlementNotice phase={phase} /> : null}
        onSucceeded={(outcome) => {
          // Only `succeeded` starts the watch; `processing` has no money yet.
          if (active === null || outcome.kind !== 'succeeded') return;
          setWatched({ rentalId: active.target.rentalId, chargedAmount: active.target.amount });
        }}
      />
    </PayContext.Provider>
  );
}

/**
 * The Pay button for a rental, wherever it is drawn: "Pay $390.00" (or just
 * "Pay" when `compact`). Renders nothing when the rental has nothing payable
 * here; "Confirming…" while its settlement is being watched.
 */
export function PayButton({
  rentalId,
  compact = false,
  className,
}: {
  rentalId: string | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const { formatCurrency } = useTenantBranding();
  const { payableFor, pay, minting, watching } = usePay();
  const target = payableFor(rentalId);
  if (!rentalId) return null;
  if (watching?.rentalId === rentalId && watching.phase === 'watching') {
    return <span className="whitespace-nowrap text-[13px] font-medium text-pv-muted-fg">Confirming…</span>;
  }
  if (!target) return null;
  const busy = minting === rentalId;
  return (
    <button
      type="button"
      disabled={minting !== null}
      onClick={(event) => {
        // Inside a clickable row: pay, do not also open the row.
        event.stopPropagation();
        pay(rentalId);
      }}
      className={cn(
        'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold',
        'bg-pv-primary text-pv-primary-fg transition-colors duration-200 hover:bg-pv-primary/85 disabled:cursor-wait disabled:opacity-60',
        'outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none',
        className,
      )}
    >
      {busy ? 'Starting…' : compact ? 'Pay' : `Pay ${formatCurrency(target.amount)}`}
    </button>
  );
}
