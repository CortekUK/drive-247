"use client";

import { Gauge, Info } from "lucide-react-nw";

import {
  extraLineCaption,
  groupDateRange,
  rentalCaption as describeRental,
  showsRentalGroups,
} from "@nw/components/booking/price-lines";
import type { PriceSummaryProps } from "@nw/components/booking/price-summary";
import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import { cn } from "@nw/lib/utils";

export type { PriceSummaryProps } from "@nw/components/booking/price-summary";

/**
 * The live bill, v2 — same props as `components/booking/price-summary`, and
 * the same rule: every number is read straight off `QuoteResult`, nothing is
 * added up here. The captions come from `price-lines.ts`, shared with v1.
 *
 * Drawn as the operator portal's summary rows: muted labels, tabular numbers on
 * the right, a hairline above the total, the total in bold. The deposit sits
 * inside the total only when it is really billed; otherwise it is a note under
 * it (see v1's header for why).
 */
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
          "rounded-[12px] border border-dashed border-pv-border bg-pv-muted/60 px-4 py-5 text-center",
          className,
        )}
      >
        <p className="text-[13px] leading-relaxed text-pv-muted-fg">{emptyHint}</p>
      </div>
    );
  }

  const { rentalSummary, mileage } = quote;
  const showGroups = showsRentalGroups(quote);

  return (
    <div className={cn("text-[14px]", className)}>
      <div className="space-y-2.5">
        <Row label="Vehicle rental" caption={describeRental(quote, formatCurrency)}>
          {formatCurrency(quote.vehicleTotal)}
        </Row>

        {showGroups ? (
          <ul className="space-y-1.5 border-l-2 border-pv-border pl-3">
            {rentalSummary.groups.map((group) => (
              <li
                key={`${group.type}-${group.startDate}-${group.endDate}`}
                className="flex items-baseline justify-between gap-3 text-xs text-pv-muted-fg"
              >
                <span className="min-w-0">
                  <span className="text-pv-fg">{group.label}</span>{" "}
                  <span className="whitespace-nowrap">
                    {group.days} × {formatCurrency(group.rate)}
                  </span>
                  <span className="block truncate">{groupDateRange(group)}</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatCurrency(group.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {quote.promoDiscount > 0 ? (
          <Row label={promoCode ? `Discount (${promoCode})` : "Discount"} tone="positive">
            −{formatCurrency(quote.promoDiscount)}
          </Row>
        ) : null}
        {quote.promoBlockedReason === "installment-plan" ? (
          <Note>Your length-of-rental discount does not apply when you pay in installments.</Note>
        ) : null}

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

        {quote.extraLines.map((line) => (
          <Row key={line.id} label={line.name ?? "Extra"} caption={extraLineCaption(line, formatCurrency)}>
            {formatCurrency(line.amount)}
          </Row>
        ))}

        {quote.taxAmount > 0 ? (
          <Row label="Tax" caption={`${quote.taxPercentage}%`}>
            {formatCurrency(quote.taxAmount)}
          </Row>
        ) : null}
        {quote.serviceFee > 0 ? (
          <Row
            label="Service fee"
            caption={quote.serviceFeeType === "percentage" ? `${quote.serviceFeeValue}%` : undefined}
          >
            {formatCurrency(quote.serviceFee)}
          </Row>
        ) : null}
        {quote.unlimitedMileage.amount > 0 ? (
          <Row label="Unlimited mileage">{formatCurrency(quote.unlimitedMileage.amount)}</Row>
        ) : null}
        {quote.insurancePremium > 0 ? (
          <Row label="Insurance">{formatCurrency(quote.insurancePremium)}</Row>
        ) : null}

        {quote.depositIsCharged && quote.chargedSecurityDeposit > 0 ? (
          <Row label="Security deposit" caption="Refundable">
            {formatCurrency(quote.chargedSecurityDeposit)}
          </Row>
        ) : null}
      </div>

      <div className="mt-4 border-t border-pv-border pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-pv-fg">Total</span>
          <span className="text-[18px] font-bold tabular-nums tracking-[-0.02em] text-pv-fg">
            {formatCurrency(quote.grandTotal)}
          </span>
        </div>

        {!collectPaymentUpfront ? (
          <Note>This is an enquiry — nothing is charged now. We will confirm and take payment separately.</Note>
        ) : quote.payableNow !== quote.grandTotal ? (
          <div className="mt-2 flex items-baseline justify-between gap-3 text-[13px] text-pv-muted-fg">
            <span>Payable today</span>
            <span className="tabular-nums">{formatCurrency(quote.payableNow)}</span>
          </div>
        ) : null}

        {!quote.depositIsCharged && quote.depositHeldAmount > 0 ? (
          <Note>
            A refundable {formatCurrency(quote.depositHeldAmount)} security deposit is held on your card. It is
            not charged.
          </Note>
        ) : null}
      </div>

      {/* Mileage — not money, but the other number the customer is buying. */}
      <div className="mt-4 flex items-start gap-2 rounded-[10px] bg-pv-muted px-3 py-2.5">
        <Gauge aria-hidden strokeWidth={1.75} className="mt-px size-4 shrink-0 text-pv-muted-fg" />
        <p className="text-[13px] leading-relaxed text-pv-muted-fg">
          {mileage.unlimited ? (
            <span className="font-medium text-pv-fg">Unlimited mileage included</span>
          ) : mileage.totalAllowance !== null ? (
            <>
              <span className="font-medium text-pv-fg">
                {mileage.totalAllowance.toLocaleString()}
                {distanceLabel ? ` ${distanceLabel}` : ""} included
              </span>
              {mileage.excessRate !== null && mileage.excessRate > 0 ? (
                <>
                  {" · "}
                  {formatCurrency(mileage.excessRate)} per extra {distanceLabel ?? "unit"}
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
      <span className="min-w-0 text-pv-muted-fg">
        <span className="block truncate">{label}</span>
        {caption ? <span className="block text-xs text-pv-muted-fg/80">{caption}</span> : null}
      </span>
      <span
        className={cn("shrink-0 tabular-nums", tone === "positive" ? "text-pv-success" : "font-medium text-pv-fg")}
      >
        {children}
      </span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-pv-muted-fg">
      <Info aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
