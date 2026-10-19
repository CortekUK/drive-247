"use client";

import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react-nw";

import {
  DESKTOP_REASON_ID,
  MOBILE_REASON_ID,
  type CheckoutState,
} from "@nw/components/booking/checkout-logic";
import { PriceSummary } from "./price-summary";
import { Button } from "@nw/components/ui/button";
import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import type { QuoteResult } from "@nw/lib/quote/types";
import { cn } from "@nw/lib/utils";
import { CARD } from "@nw/site-v2/kit";

/**
 * The money, v2 — the same three pieces as v1's `components/booking/
 * booking-checkout.tsx`, with the same exports and props:
 *
 *  - `PriceBlock`        — the itemised bill, a calm card of its own.
 *  - `CheckoutTotal`     — the total and the pill CTA that close the desktop rail.
 *  - `MobileCheckoutBar` — the same two as one fixed line on a phone.
 *
 * What the button says when it is dead (`describeOutstanding`) and the
 * `CheckoutState` contract come from v1's `checkout-logic.ts`, re-exported here
 * so a v2 page can import everything checkout-shaped from one place.
 *
 * The itemised rows are the v2 `PriceSummary` (./price-summary).
 */

export {
  describeOutstanding,
  type CheckoutBlock,
  type CheckoutState,
} from "@nw/components/booking/checkout-logic";

/* ───────────────────────────── the itemised bill ─────────────────────── */

export function PriceBlock({
  quote,
  quoteLoading,
  collectPaymentUpfront,
  promoCode,
  pricingRulesDegraded,
  vehicleIsPaused,
  className,
}: {
  quote: QuoteResult;
  quoteLoading: boolean;
  collectPaymentUpfront: boolean;
  promoCode: string | null;
  /** Pricing rules failed to load — the total may understate. Blocks checkout. */
  pricingRulesDegraded: boolean;
  vehicleIsPaused: boolean;
  className?: string;
}) {
  return (
    <section className={cn(CARD, "p-5", className)} aria-busy={quoteLoading || undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-pv-fg">Price</h2>
          <p className="mt-0.5 text-[13px] text-pv-muted-fg">
            Every charge, before you commit to anything.
          </p>
        </div>
        {quoteLoading ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-pv-muted px-2.5 py-1 text-[11px] font-medium text-pv-muted-fg">
            <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
            Updating
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          "mt-4 space-y-3 transition-opacity duration-200 ease-out motion-reduce:transition-none",
          quoteLoading && "opacity-60",
        )}
      >
        <PriceSummary
          quote={quote}
          emptyHint="Choose your pickup and return dates to see the full price."
          collectPaymentUpfront={collectPaymentUpfront}
          promoCode={promoCode}
          className="rounded-xl border-pv-border"
        />

        {pricingRulesDegraded ? (
          <Warning>
            We could not load this operator&apos;s seasonal pricing, so the total
            above may be incomplete. Please try again shortly.
          </Warning>
        ) : null}
        {quote.deliveryBlocked ? (
          <Warning>
            That address is outside our delivery area. Choose another arrangement
            to continue.
          </Warning>
        ) : null}
        {vehicleIsPaused ? (
          <Warning>
            This vehicle is temporarily unavailable to book. Please choose another
            from the fleet.
          </Warning>
        ) : null}
      </div>
    </section>
  );
}

/* ──────────────────────── the desktop commitment ─────────────────────── */

/**
 * The bottom of the sticky rail: what it costs, and the button. Flat like every
 * other card (v1 lifted it with a shadow; v2 has none outside dialogs).
 */
export function CheckoutTotal({
  quote,
  collectPaymentUpfront,
  onCheckout,
  block,
  checkoutNotice,
  className,
}: CheckoutState & { className?: string }) {
  const { formatCurrency } = useTenantBranding();

  return (
    <div className={cn(CARD, "p-5", className)}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-pv-muted-fg">
          {quote.ready ? "Total" : "Total to pay"}
        </span>
        <span className="text-[26px] font-bold leading-none tracking-[-0.03em] tabular-nums text-pv-fg">
          {quote.ready ? formatCurrency(quote.grandTotal) : "—"}
        </span>
      </div>

      <Button
        type="button"
        variant="brand"
        size="xl"
        className="h-12 w-full"
        disabled={block !== null}
        aria-describedby={block !== null ? DESKTOP_REASON_ID : undefined}
        onClick={onCheckout}
      >
        {collectPaymentUpfront ? "Continue to payment" : "Send enquiry"}
        <ArrowRight strokeWidth={2} />
      </Button>

      {/* `role="status"` so the reason is announced — a disabled button is skipped. */}
      {block !== null ? (
        <p
          id={DESKTOP_REASON_ID}
          role="status"
          className={cn(
            "mt-3 text-center text-xs leading-relaxed",
            block.kind === "blocked" ? "text-pv-warning" : "text-pv-muted-fg",
          )}
        >
          {block.message}
        </p>
      ) : null}

      {checkoutNotice ? (
        <p className="mt-2 text-center text-xs leading-relaxed text-pv-muted-fg">
          {checkoutNotice}
        </p>
      ) : null}
    </div>
  );
}

/* ───────────────────────── the mobile commitment ─────────────────────── */

/**
 * One fixed line at the foot of a phone screen: total, then button. The page
 * reserves matching bottom padding; `env(safe-area-inset-bottom)` clears the
 * iOS home indicator.
 */
export function MobileCheckoutBar({
  quote,
  collectPaymentUpfront,
  onCheckout,
  block,
  checkoutNotice,
}: CheckoutState) {
  const { formatCurrency } = useTenantBranding();

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-pv-border bg-pv-card/95 backdrop-blur-sm lg:hidden">
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        {block !== null ? (
          <p
            id={MOBILE_REASON_ID}
            role="status"
            className={cn(
              "mb-2 line-clamp-2 text-[11px] leading-relaxed",
              block.kind === "blocked" ? "text-pv-warning" : "text-pv-muted-fg",
            )}
          >
            {block.message}
          </p>
        ) : null}

        {checkoutNotice ? (
          <p className="mb-2 line-clamp-2 text-[11px] leading-relaxed text-pv-muted-fg">
            {checkoutNotice}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium leading-none text-pv-muted-fg">
              {quote.ready ? "Total" : "Total to pay"}
            </p>
            <p className="mt-1.5 text-lg font-bold leading-none tracking-[-0.02em] tabular-nums text-pv-fg">
              {quote.ready ? formatCurrency(quote.grandTotal) : "—"}
            </p>
          </div>

          <Button
            type="button"
            variant="brand"
            size="lg"
            className="ml-auto h-11 shrink-0 whitespace-nowrap px-5"
            disabled={block !== null}
            aria-describedby={block !== null ? MOBILE_REASON_ID : undefined}
            onClick={onCheckout}
          >
            {collectPaymentUpfront ? (
              <>
                <span className="sm:hidden">Continue</span>
                <span className="hidden sm:inline">Continue to payment</span>
              </>
            ) : (
              "Send enquiry"
            )}
            <ArrowRight strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-xl bg-pv-warning-light px-3.5 py-2.5 text-xs leading-relaxed text-pv-fg">
      <AlertTriangle
        aria-hidden
        strokeWidth={1.75}
        className="mt-px size-3.5 shrink-0 text-pv-warning"
      />
      <span>{children}</span>
    </p>
  );
}
