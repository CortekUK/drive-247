"use client";

import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react-nw";

import { Button } from "@nw/components/ui/button";
import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import type { QuoteResult } from "@nw/lib/quote/types";
import { cn } from "@nw/lib/utils";

import {
  DESKTOP_REASON_ID,
  MOBILE_REASON_ID,
  type CheckoutState,
} from "./checkout-logic";
import { PriceSummary } from "./price-summary";

/**
 * The money, in three pieces that share one set of numbers.
 *
 *  - `PriceBlock`   — the itemised bill. Sits in the left rail on a desktop and
 *                     after the form on a phone, where showing a total before
 *                     any dates are chosen would be noise.
 *  - `CheckoutTotal`— the pinned total-and-CTA that closes the desktop rail.
 *  - `MobileCheckoutBar` — the same two things as one fixed line at the bottom
 *                     of a phone screen, so the price and the button are always
 *                     reachable without scrolling to the end of the form.
 *
 * The desktop and mobile CTAs are two elements rather than one repositioned
 * element because they are genuinely different shapes — a stacked block against
 * a single 44px line — and only one of them is ever in the layout at a time.
 */

/*
  `CheckoutBlock`, `CheckoutState` and `describeOutstanding` live in
  `./checkout-logic` so the v2 checkout shares them. Re-exported here so every
  existing importer keeps its path.
*/
export {
  describeOutstanding,
  type CheckoutBlock,
  type CheckoutState,
} from "./checkout-logic";

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
    <section
      className={cn(
        "rounded-[18px] border border-brand-border-soft bg-white p-4",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-brand-text-subtle">
          Price
        </h2>
        {quoteLoading ? (
          <Loader2
            aria-label="Updating price"
            className="size-3.5 animate-spin text-brand-text-subtle"
          />
        ) : null}
      </div>

      <div className="mt-3 space-y-3">
        <PriceSummary
          quote={quote}
          emptyHint="Choose your pickup and return dates to see the full price."
          collectPaymentUpfront={collectPaymentUpfront}
          promoCode={promoCode}
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
 * The bottom of the sticky rail: what it costs, and the button.
 *
 * It sits OUTSIDE the rail's scrolling region, so however tall the car's
 * details and the itemised bill grow, the total and the CTA stay on screen.
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
    <div
      className={cn(
        "rounded-[18px] border border-brand-border-soft bg-white px-4 py-3.5 shadow-[0_-4px_18px_rgba(0,0,0,0.06)]",
        className,
      )}
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-xs text-brand-text-subtle">
          {quote.ready ? "Total" : "Total to pay"}
        </span>
        <span className="text-xl font-semibold tabular-nums text-brand-text">
          {quote.ready ? formatCurrency(quote.grandTotal) : "—"}
        </span>
      </div>

      <Button
        type="button"
        variant="brand"
        size="xl"
        className="w-full"
        disabled={block !== null}
        aria-describedby={block !== null ? DESKTOP_REASON_ID : undefined}
        onClick={onCheckout}
      >
        {collectPaymentUpfront ? "Continue to payment" : "Send enquiry"}
        <ArrowRight strokeWidth={2} />
      </Button>

      {/*
        The reason the button is grey, in the one place a customer is already
        looking. `role="status"` so it is ANNOUNCED as it changes: a `disabled`
        control is skipped by a screen reader, so without this the button simply
        vanishes from the page as far as assistive tech is concerned. Only one of
        the desktop and mobile copies is ever displayed (the other is
        `display:none`, so it is out of the accessibility tree too) — hence two
        ids rather than one shared one.
      */}
      {block !== null ? (
        <p
          id={DESKTOP_REASON_ID}
          role="status"
          className={cn(
            "mt-2 text-center text-xs leading-relaxed",
            block.kind === "blocked" ? "text-warning" : "text-brand-text-soft",
          )}
        >
          {block.message}
        </p>
      ) : null}

      {checkoutNotice ? (
        <p className="mt-2 text-center text-xs leading-relaxed text-brand-text-subtle">
          {checkoutNotice}
        </p>
      ) : null}
    </div>
  );
}


/* ───────────────────────── the mobile commitment ─────────────────────── */

/**
 * One fixed line at the foot of a phone screen: total, then button.
 *
 * Deliberately a single row rather than the stacked block the desktop rail
 * uses — a two-line pinned panel eats a fifth of a small screen, which is the
 * scrolling complaint in a different costume. The button label shortens below
 * `sm` so the row still fits a 360px viewport without wrapping.
 *
 * `env(safe-area-inset-bottom)` keeps it clear of the iOS home indicator; the
 * page reserves matching bottom padding so the last section is never hidden
 * behind it.
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
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-border-soft bg-white/95 backdrop-blur-sm lg:hidden">
      <div className="mx-auto w-full max-w-7xl px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-6">
        {/*
          Clamped to two lines: this bar is pinned over the page, and a reason
          that grows to four lines is a bar that eats a third of a phone screen.
          The same sentence is never the ONLY telling — every field it names is
          also marked in the form itself.
        */}
        {block !== null ? (
          <p
            id={MOBILE_REASON_ID}
            role="status"
            className={cn(
              "mb-2 line-clamp-2 text-[11px] leading-relaxed",
              block.kind === "blocked" ? "text-warning" : "text-brand-text-soft",
            )}
          >
            {block.message}
          </p>
        ) : null}

        {checkoutNotice ? (
          <p className="mb-2 line-clamp-2 text-[11px] leading-relaxed text-brand-text-subtle">
            {checkoutNotice}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-[11px] leading-none text-brand-text-subtle">
              {quote.ready ? "Total" : "Total to pay"}
            </p>
            <p className="mt-1.5 text-base font-semibold leading-none tabular-nums text-brand-text">
              {quote.ready ? formatCurrency(quote.grandTotal) : "—"}
            </p>
          </div>

          <Button
            type="button"
            variant="brand"
            size="lg"
            className="ml-auto h-11 shrink-0 whitespace-nowrap"
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
    <p className="flex items-start gap-2 rounded-[10px] border border-warning-med bg-warning-light px-3 py-2 text-xs leading-relaxed text-brand-text">
      <AlertTriangle
        aria-hidden
        strokeWidth={1.75}
        className="mt-px size-3.5 shrink-0 text-warning"
      />
      <span>{children}</span>
    </p>
  );
}
