"use client";

import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import type { QuoteResult } from "@/lib/quote/types";
import { cn } from "@/lib/utils";

import { PriceSummary } from "./price-summary";
import type { BookingErrors, BookingField } from "./validation";

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

/**
 * Why the button is dead, and whose problem it is.
 *
 * The two kinds are NOT interchangeable and must never share a sentence. A
 * `blocked` reason is ours — a paused vehicle, an undeliverable address,
 * pricing we could not load — and no amount of typing will clear it. An
 * `incomplete` reason is the customer's, is fixable in seconds, and names the
 * fields that are outstanding so a greyed-out button is never a dead end.
 */
export type CheckoutBlock = {
  kind: "blocked" | "incomplete";
  /** Rendered verbatim beneath the button. */
  message: string;
};

export interface CheckoutState {
  quote: QuoteResult;
  /** Enquiry tenants are quoted a value but charged nothing here. */
  collectPaymentUpfront: boolean;
  onCheckout: () => void;
  /** Null when the button is live. Anything else greys it out and says why. */
  block: CheckoutBlock | null;
  /** Transient word from the last attempt. Outlives nothing. */
  checkoutNotice: string | null;
}

/* ─────────────────── naming what is still outstanding ────────────────────── */

/**
 * What is missing, in the customer's words.
 *
 * The driver's four fields are named WITHOUT the possessive so they can share
 * one — "your name, email, phone number and date of birth" rather than four
 * separate "your"s, which is what the same list sounds like read aloud. The two
 * location questions carry their own wording because they are not possessions.
 */
const PERSON_LABELS: ReadonlyArray<readonly [BookingField, string]> = [
  ["customerName", "name"],
  ["customerEmail", "email"],
  ["customerPhone", "phone number"],
  ["driverDOB", "date of birth"],
];

const PLACE_LABELS: ReadonlyArray<readonly [BookingField, string]> = [
  ["pickupLocation", "where you will collect the car"],
  ["returnLocation", "where you will return it"],
];

const DATE_FIELDS: readonly BookingField[] = [
  "pickupDate",
  "pickupTime",
  "dropoffDate",
  "dropoffTime",
];

/** "a", "a and b", "a, b and c" — no serial comma, matching the rest of the copy. */
function joinPhrases(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function labelsFor(
  errors: BookingErrors,
  table: ReadonlyArray<readonly [BookingField, string]>,
): string[] {
  return table.filter(([field]) => errors[field] !== undefined).map(([, label]) => label);
}

/**
 * Turn a live validation result into one short line.
 *
 * Built from the SAME `BookingErrors` the fields render, so it can never drift
 * from what is actually blocking submission — and returns null the instant the
 * form is complete, which is also the instant the button goes live.
 *
 * Date problems get a pointer rather than a name: they are already on screen in
 * red (dates are the one group shown before any submit), and repeating
 * "Minimum rental period is 2 days" under the button says it twice.
 */
export function describeOutstanding(errors: BookingErrors): string | null {
  const clauses: string[] = [];

  if (DATE_FIELDS.some((field) => errors[field] !== undefined)) {
    clauses.push("check the dates above");
  }

  const places = labelsFor(errors, PLACE_LABELS);
  const people = labelsFor(errors, PERSON_LABELS);
  const details = people.length > 0 ? [...places, `your ${joinPhrases(people)}`] : places;
  if (details.length > 0) {
    clauses.push(`add ${joinPhrases(details)}`);
  }

  const needsTerms = errors.agreeTerms !== undefined;
  const needsCharges = errors.agreeCharges !== undefined;
  if (needsTerms && needsCharges) {
    clauses.push("tick both consent boxes below");
  } else if (needsTerms) {
    clauses.push("accept the rental terms");
  } else if (needsCharges) {
    clauses.push("authorise post-rental charges");
  }

  if (clauses.length === 0) return null;

  // One thing outstanding reads as an instruction and takes "to continue".
  // Several read as a short checklist, where a trailing "to continue" after a
  // list that already contains two "and"s is one conjunction too many — the
  // last step gets "then" instead, which is what a person would say.
  const sentence =
    clauses.length === 1
      ? `${clauses[0]} to continue`
      : `${clauses.slice(0, -1).join(", ")}, then ${clauses[clauses.length - 1]}`;

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

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

const DESKTOP_REASON_ID = "checkout-reason-desktop";
const MOBILE_REASON_ID = "checkout-reason-mobile";

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
