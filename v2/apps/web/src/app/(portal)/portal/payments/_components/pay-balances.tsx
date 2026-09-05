'use client';

/**
 * Paying an outstanding balance, one booking at a time.
 *
 * ── WHAT THIS OWNS ──────────────────────────────────────────────────────────
 * The whole money-moving path on this page: minting a PaymentIntent, mounting
 * the card dialog, and watching for the webhook to settle. The page itself
 * stays a read surface plus this one section, so the arithmetic above and the
 * button below can be read separately.
 *
 * ── WHY ONE BUTTON PER BOOKING ──────────────────────────────────────────────
 * Because `create-booking-payment-intent` prices from a rental and refuses a
 * request without one. There is no endpoint that takes an amount and none that
 * takes an invoice, so "Pay everything" is not a button that exists to be
 * wired — it would be a client-side fan-out across several PaymentIntents with
 * partial-failure states of its own invention. See `PayableBalance` in
 * `use-customer-payments.ts` for the full argument.
 *
 * ── THE DIALOG IS THE BOOKING FLOW'S, DELIBERATELY ──────────────────────────
 * `PaymentPanel` is reused rather than reimplemented. It already carries the
 * Drive247 framing, the "Powered by Stripe" line, the off-session mandate, the
 * 3-D Secure return handling and the failure copy — all of which had to be
 * right once. A second card dialog would be a second place for that to rot.
 * Only the WORDING changes, through the panel's `copy` prop: this customer is
 * settling a charge on an existing booking, not confirming a new one, and
 * telling them "Your booking is confirmed" would be a false statement about
 * what just happened.
 *
 * ── THE INTENT IS MINTED HERE, NOT BY THE PANEL ─────────────────────────────
 * The panel can mint for the booking flow because the request and the dialog
 * open together. Here they must not: if minting fails — the endpoint is down,
 * or the amount moved under us — the customer should see that INLINE next to
 * the balance it failed on, not inside a dialog they then have to dismiss. So
 * the intent is minted first and the dialog opens only when there is a real
 * card form to put in it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CreditCard, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import {
  PaymentPanel,
  type PaymentPanelCopy,
} from '@/components/booking/payment-panel';
// The intent shape lives with the hook that first defined it, not with the
// panel that renders it — same single definition the balance-payment lib parses
// into, so the two paths cannot drift apart.
import type { BookingPaymentIntentResponse } from '@/hooks/use-payment-intent';
import { formatDate, relativeDayLabel } from '@/components/portal/format';
import { Panel, PanelHeader } from '@/components/portal/primitives';
import { Button } from '@/components/ui/button';
import { useTenant } from '@/contexts/TenantContext';
import { useCustomer } from '@/hooks/use-customer';
import type { PayableBalance } from '@/hooks/use-customer-payments';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import {
  createBalancePaymentIntent,
  type BalanceIntentFailure,
} from '@/lib/stripe/create-balance-payment-intent';
import { cn } from '@/lib/utils';

import { SettlementNotice, useSettlementWatch } from './settlement-watch';

/**
 * The panel's wording, for settling a charge rather than confirming a booking.
 *
 * `mandate` is overridden too. The endpoint sets `setup_future_usage:
 * 'off_session'` on every intent it mints, so the card really is vaulted on
 * this path as well and saying nothing would be wrong — but the booking flow's
 * sentence promises the deposit and the instalments, which are not what this
 * customer is agreeing to.
 */
const PORTAL_COPY: Partial<PaymentPanelCopy> = {
  title: 'Pay your balance',
  cancelLabel: 'Back to payments',
  succeededTitle: 'Payment received',
  succeededBody:
    'Thank you — your card has been charged. We are updating your balance now.',
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

/** What is being paid right now, and what it cost — the watch needs both. */
interface ActivePayment {
  target: PayableBalance;
  intent: BookingPaymentIntentResponse;
}

export function PayBalances({
  payable,
  unpayable,
  refetch,
}: {
  payable: PayableBalance[];
  /** The part of the balance with no button. See `CustomerBalance.unpayable`. */
  unpayable: number;
  refetch: () => Promise<void>;
}) {
  const { formatCurrency } = useTenantBranding();
  const { tenant } = useTenant();
  const { customerId, email, displayName } = useCustomer();

  const [minting, setMinting] = useState<string | null>(null);
  const [failure, setFailure] = useState<
    { rentalId: string; failure: BalanceIntentFailure } | null
  >(null);
  const [active, setActive] = useState<ActivePayment | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  /**
   * The booking whose settlement we are waiting on, and the figure that was
   * actually charged.
   *
   * Kept separately from `active` because it must OUTLIVE the dialog: the
   * customer can close the panel the instant it says "Payment received", and
   * the webhook has not landed yet. Clearing this on close would drop the watch
   * exactly when it matters.
   */
  const [watching, setWatching] = useState<
    { rentalId: string; chargedAmount: number } | null
  >(null);

  /**
   * Settlement is OBSERVED, never assumed: the booking's payable balance has
   * either gone (settled in full) or fallen below what we charged. Comparing
   * against the charged figure rather than against zero means a booking that
   * accrued a NEW charge between paying and polling still reads as settled for
   * the payment we made — which it was.
   */
  const current = watching
    ? (payable.find((row) => row.rentalId === watching.rentalId) ?? null)
    : null;
  const settled =
    watching !== null &&
    (current === null || current.amount < watching.chargedAmount);

  const phase = useSettlementWatch(watching !== null, settled, refetch);

  // One toast per watch, so the outcome reaches a customer who has closed the
  // dialog or scrolled away. `toastedFor` guards against the effect re-firing
  // on an unrelated re-render and stacking duplicates.
  const toastedFor = useRef<string | null>(null);
  useEffect(() => {
    if (watching === null) {
      toastedFor.current = null;
      return;
    }
    if (toastedFor.current === watching.rentalId) return;

    if (phase === 'settled') {
      toastedFor.current = watching.rentalId;
      toast.success('Payment settled', {
        description: 'Your balance has been updated.',
      });
    } else if (phase === 'slow') {
      toastedFor.current = watching.rentalId;
      toast.info('Payment received', {
        description:
          'Your balance has not caught up yet. It usually does within a few minutes.',
      });
    }
  }, [phase, watching]);

  const pay = useCallback(
    async (target: PayableBalance) => {
      if (tenant === null || customerId === null) return;

      setFailure(null);
      setMinting(target.rentalId);

      const result = await createBalancePaymentIntent({
        rentalId: target.rentalId,
        tenantSlug: tenant.slug,
        tenantId: tenant.id,
        customerId,
        customerEmail: email ?? '',
        customerName: displayName ?? '',
        // The server re-prices from the ledger and refuses the request if this
        // disagrees by more than a cent — so the figure on the button is the
        // figure charged, or nothing is charged at all.
        expectedAmount: target.amount,
      });

      setMinting(null);

      if (!result.ok) {
        setFailure({ rentalId: target.rentalId, failure: result.failure });
        // `amount_mismatch` and `no_open_charges` both mean this page is
        // showing a stale figure. Re-read so the number the customer sees next
        // is the true one rather than the one that was just rejected.
        void refetch();
        return;
      }

      setActive({ target, intent: result.intent });
      setDialogOpen(true);
    },
    [tenant, customerId, email, displayName, refetch],
  );

  if (payable.length === 0 && unpayable === 0) return null;

  const canPay = tenant !== null && customerId !== null;

  return (
    <>
      <Panel>
        <PanelHeader title="Pay your balance" />

        {payable.length > 0 ? (
          <ul className="divide-y divide-brand-border-soft">
            {payable.map((row) => (
              <li key={row.rentalId}>
                <PayableRow
                  row={row}
                  busy={minting === row.rentalId}
                  disabled={!canPay || minting !== null}
                  failure={
                    failure?.rentalId === row.rentalId ? failure.failure : null
                  }
                  watchPhase={
                    watching?.rentalId === row.rentalId && !dialogOpen
                      ? phase
                      : null
                  }
                  onPay={() => {
                    void pay(row);
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {unpayable > 0 ? (
          <div className="border-t border-brand-border-soft px-4 py-3.5 sm:px-5">
            <p className="text-xs leading-relaxed text-brand-text-subtle">
              {formatCurrency(unpayable)} of your balance is not linked to a
              booking we can bill against, so it cannot be paid from this page.
              Please get in touch and we will take it directly.
            </p>
            <Link
              href="/contact"
              className="mt-1 inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
            >
              Contact us
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        ) : null}
      </Panel>

      <PaymentPanel
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        // The panel mints only when it is handed a `request`; this caller has
        // already minted, so it passes the intent instead.
        request={null}
        prepared={active?.intent ?? null}
        rentalId={active?.target.rentalId ?? null}
        amountLabel={formatCurrency(active?.target.amount ?? 0)}
        vehicleLabel={
          active?.target.rental?.vehicle?.displayName ?? 'Your booking'
        }
        // Never a redirect return: the portal mounts this dialog only from a
        // click. A 3-D Secure hop is handled inside the panel, which stashes
        // and resumes against the same URL.
        resume={null}
        copy={PORTAL_COPY}
        outcomeFooter={
          watching !== null ? (
            <SettlementNotice phase={phase} />
          ) : null
        }
        onSucceeded={(outcome) => {
          if (active === null) return;
          // Only `succeeded` starts the watch. `processing` means the bank has
          // not taken the money yet, so there is no settlement to wait for and
          // a spinner would be claiming otherwise.
          if (outcome.kind !== 'succeeded') return;
          setWatching({
            rentalId: active.target.rentalId,
            chargedAmount: active.target.amount,
          });
        }}
      />
    </>
  );
}

/* ──────────────────────────────── one booking ────────────────────────────── */

function PayableRow({
  row,
  busy,
  disabled,
  failure,
  watchPhase,
  onPay,
}: {
  row: PayableBalance;
  busy: boolean;
  disabled: boolean;
  failure: BalanceIntentFailure | null;
  /** Non-null once the dialog is closed and settlement is still pending. */
  watchPhase: Parameters<typeof SettlementNotice>[0]['phase'] | null;
  onPay: () => void;
}) {
  const { formatCurrency } = useTenantBranding();

  const vehicle = row.rental?.vehicle?.displayName ?? 'Booking';
  const reference = row.rental?.reference ?? null;
  const when = relativeDayLabel(row.nextDueDate);

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full',
            row.isOverdue ? 'bg-danger-light' : 'bg-brand-stone',
          )}
        >
          <CreditCard
            aria-hidden
            strokeWidth={1.75}
            className={cn(
              'size-4',
              row.isOverdue ? 'text-danger' : 'text-brand-text-subtle',
            )}
          />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-sm font-medium text-brand-text">
            {vehicle}
          </p>
          <p className="truncate text-xs text-brand-text-subtle">
            {[reference, row.nextDueDate ? `Due ${formatDate(row.nextDueDate)}` : null]
              .filter((part): part is string => part !== null)
              .join(' · ')}
            {row.isOverdue ? '' : when ? ` (${when})` : ''}
          </p>
        </div>

        <p
          className={cn(
            'shrink-0 text-sm font-medium tabular-nums',
            row.isOverdue ? 'text-danger' : 'text-brand-text',
          )}
        >
          {formatCurrency(row.amount)}
        </p>
      </div>

      {row.blockedReason !== null ? (
        <p className="text-xs leading-relaxed text-brand-text-subtle">
          {row.blockedReason}
        </p>
      ) : watchPhase !== null ? (
        <SettlementNotice phase={watchPhase} />
      ) : (
        <>
          <Button
            type="button"
            variant="brand"
            size="xl"
            className="h-11 w-full sm:h-11"
            disabled={disabled || busy}
            onClick={onPay}
          >
            {busy ? (
              <>
                <Loader2 aria-hidden className="size-4 animate-spin" />
                Starting…
              </>
            ) : (
              <>Pay {formatCurrency(row.amount)}</>
            )}
          </Button>

          {failure !== null ? (
            <div className="flex items-start gap-2.5 rounded-[12px] border border-danger-subtle bg-danger-light px-3 py-2.5">
              <TriangleAlert
                aria-hidden
                strokeWidth={1.75}
                className="mt-px size-4 shrink-0 text-danger"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-relaxed text-brand-text-soft">
                  {failure.message}
                </p>
                {/* No "Try again" button: the Pay button directly above IS the
                    retry, and the endpoint hands back the same in-flight intent
                    rather than minting a second one. A second button would just
                    be two controls doing one thing. */}
                {failure.retryable ? (
                  <p className="mt-1 text-xs text-brand-text-subtle">
                    You can try the button above again.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
