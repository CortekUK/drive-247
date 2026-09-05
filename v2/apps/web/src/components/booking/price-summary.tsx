"use client";

import { Gauge, Info } from "lucide-react";

import { useTenantBranding } from "@/hooks/use-tenant-branding";
import type { QuoteResult } from "@/lib/quote/types";
import { cn } from "@/lib/utils";

import { formatIsoDateLabel } from "./time-utils";

/**
 * The live bill.
 *
 * Every number is read straight off `QuoteResult` — this component adds nothing
 * up. That is the whole contract of `compute-quote.ts`: one place does the
 * arithmetic so the figure a customer reads and the figure a payment intent is
 * built from cannot diverge.
 *
 * Two lines behave differently from the rest and both are deliberate:
 *
 *  - The SECURITY DEPOSIT appears either inside the total (the operator really
 *    bills it) or as an uncharged hold beneath it. `depositIsCharged` decides;
 *    showing a hold inside a total would overstate what the card is charged.
 *
 *  - The PER-DAY BREAKDOWN is withheld when the tenant sets
 *    `hide_checkout_price_breakdown`. The totals still show; only the day-level
 *    detail is suppressed.
 */

export interface PriceSummaryProps {
  quote: QuoteResult;
  /** Copy for the empty state, shown until the dates make a real price. */
  emptyHint: string;
  /** True for enquiry tenants, who are shown a value but charged nothing now. */
  collectPaymentUpfront: boolean;
  /** The promo the customer applied, for the discount line's label. */
  promoCode: string | null;
  className?: string;
}

export function PriceSummary({
  quote,
  emptyHint,
  collectPaymentUpfront,
  promoCode,
  className,
}: PriceSummaryProps) {
  const { formatCurrency, distanceLabel } = useTenantBranding();

  if (!quote.ready) {
    return (
      <div
        className={cn(
          "rounded-[14px] border border-dashed border-brand-border bg-brand-cream/60 px-4 py-4 text-center",
          className,
        )}
      >
        <p className="text-xs leading-relaxed text-brand-text-soft">{emptyHint}</p>
      </div>
    );
  }

  const { rentalSummary, mileage } = quote;
  const showGroups =
    !quote.hideBreakdown &&
    rentalSummary.kind === "dynamic" &&
    rentalSummary.groups.length > 0;

  const unitPlural = rentalSummary.quantity === 1 ? "" : "s";
  const rentalCaption = rentalSummary.quantityIsWhole
    ? `${rentalSummary.quantity} ${rentalSummary.unitLabel}${unitPlural} × ${formatCurrency(rentalSummary.unitRate)}`
    : `${rentalSummary.rentalDays} day${rentalSummary.rentalDays === 1 ? "" : "s"} at the ${rentalSummary.tier} rate`;

  return (
    <div
      className={cn(
        "rounded-[14px] border border-brand-border-soft bg-white",
        className,
      )}
    >
      <div className="space-y-2 px-3.5 py-3.5">
        {/* 1. the rental itself */}
        <Row label="Vehicle rental" caption={rentalCaption}>
          {formatCurrency(quote.vehicleTotal)}
        </Row>

        {showGroups ? (
          <ul className="space-y-1 border-l border-brand-border-soft pl-3">
            {rentalSummary.groups.map((group) => (
              <li
                key={`${group.type}-${group.startDate}-${group.endDate}`}
                className="flex items-baseline justify-between gap-3 text-xs text-brand-text-subtle"
              >
                <span className="min-w-0">
                  <span className="text-brand-text-soft">{group.label}</span>{" "}
                  <span className="whitespace-nowrap">
                    {group.days} × {formatCurrency(group.rate)}
                  </span>
                  <span className="block truncate">
                    {formatIsoDateLabel(group.startDate)}
                    {group.startDate === group.endDate
                      ? ""
                      : ` – ${formatIsoDateLabel(group.endDate)}`}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatCurrency(group.amount)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {/* 2. promo */}
        {quote.promoDiscount > 0 ? (
          <Row
            label={promoCode ? `Discount (${promoCode})` : "Discount"}
            tone="positive"
          >
            −{formatCurrency(quote.promoDiscount)}
          </Row>
        ) : null}
        {quote.promoBlockedReason === "installment-plan" ? (
          <Note>
            Your length-of-rental discount does not apply when you pay in
            installments.
          </Note>
        ) : null}

        {/* 3. delivery */}
        {quote.pickupDelivery.fee > 0 ? (
          <Row label="Delivery" caption={quote.pickupDelivery.tiered ? "By distance" : undefined}>
            {formatCurrency(quote.pickupDelivery.fee)}
          </Row>
        ) : null}
        {quote.returnDelivery.fee > 0 ? (
          <Row label="Collection" caption={quote.returnDelivery.tiered ? "By distance" : undefined}>
            {formatCurrency(quote.returnDelivery.fee)}
          </Row>
        ) : null}

        {/* 4. extras */}
        {quote.extraLines.map((line) => (
          <Row
            key={line.id}
            label={line.name ?? "Extra"}
            caption={
              line.perDay
                ? `${line.quantity} × ${formatCurrency(line.unitPrice)} × ${line.billedDays} day${line.billedDays === 1 ? "" : "s"}`
                : `${line.quantity} × ${formatCurrency(line.unitPrice)}`
            }
          >
            {formatCurrency(line.amount)}
          </Row>
        ))}

        {/* 5-7. tax, fee, mileage upgrade */}
        {quote.taxAmount > 0 ? (
          <Row label="Tax" caption={`${quote.taxPercentage}%`}>
            {formatCurrency(quote.taxAmount)}
          </Row>
        ) : null}
        {quote.serviceFee > 0 ? (
          <Row
            label="Service fee"
            caption={
              quote.serviceFeeType === "percentage"
                ? `${quote.serviceFeeValue}%`
                : undefined
            }
          >
            {formatCurrency(quote.serviceFee)}
          </Row>
        ) : null}
        {quote.unlimitedMileage.amount > 0 ? (
          <Row label="Unlimited mileage">
            {formatCurrency(quote.unlimitedMileage.amount)}
          </Row>
        ) : null}
        {quote.insurancePremium > 0 ? (
          <Row label="Insurance">{formatCurrency(quote.insurancePremium)}</Row>
        ) : null}

        {/* 8. deposit — inside the total only when it is really billed */}
        {quote.depositIsCharged && quote.chargedSecurityDeposit > 0 ? (
          <Row label="Security deposit" caption="Refundable">
            {formatCurrency(quote.chargedSecurityDeposit)}
          </Row>
        ) : null}
      </div>

      {/* 9. totals */}
      <div className="border-t border-brand-border-soft px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-brand-text">Total</span>
          <span className="text-lg font-semibold tabular-nums text-brand-text">
            {formatCurrency(quote.grandTotal)}
          </span>
        </div>

        {!collectPaymentUpfront ? (
          <Note>
            This is an enquiry — nothing is charged now. We will confirm and take
            payment separately.
          </Note>
        ) : quote.payableNow !== quote.grandTotal ? (
          <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-brand-text-soft">
            <span>Payable today</span>
            <span className="tabular-nums">{formatCurrency(quote.payableNow)}</span>
          </div>
        ) : null}

        {!quote.depositIsCharged && quote.depositHeldAmount > 0 ? (
          <Note>
            A refundable {formatCurrency(quote.depositHeldAmount)} security
            deposit is held on your card. It is not charged.
          </Note>
        ) : null}
      </div>

      {/* Mileage — not money, but the other number the customer is buying. */}
      <div className="flex items-start gap-2 border-t border-brand-border-soft px-3.5 py-2.5">
        <Gauge
          aria-hidden
          strokeWidth={1.75}
          className="mt-px size-4 shrink-0 text-brand-text-subtle"
        />
        <p className="text-xs leading-relaxed text-brand-text-soft">
          {mileage.unlimited ? (
            <span className="font-medium text-brand-text">
              Unlimited mileage included
            </span>
          ) : mileage.totalAllowance !== null ? (
            <>
              <span className="font-medium text-brand-text">
                {mileage.totalAllowance.toLocaleString()}
                {distanceLabel ? ` ${distanceLabel}` : ""} included
              </span>
              {mileage.excessRate !== null && mileage.excessRate > 0 ? (
                <>
                  {" · "}
                  {formatCurrency(mileage.excessRate)} per extra{" "}
                  {distanceLabel ?? "unit"}
                </>
              ) : null}
            </>
          ) : (
            "Mileage allowance confirmed on collection."
          )}
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  caption,
  tone = "default",
  children,
}: {
  label: string;
  caption?: string;
  tone?: "default" | "positive";
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 text-sm text-brand-text-soft">
        <span className="block truncate">{label}</span>
        {caption ? (
          <span className="block text-xs text-brand-text-subtle">{caption}</span>
        ) : null}
      </span>
      <span
        className={cn(
          "shrink-0 text-sm tabular-nums",
          tone === "positive" ? "text-success" : "text-brand-text",
        )}
      >
        {children}
      </span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-brand-text-subtle">
      <Info aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
