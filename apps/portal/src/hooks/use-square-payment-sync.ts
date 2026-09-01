"use client";

import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Keep a Square rental's payment state in step with the BACKEND.
 *
 * WHY THIS EXISTS
 *
 * A Square collection is completed in a DIFFERENT browsing context from the one
 * that started it: "Charge via Square" opens our hosted /checkout/{paymentId}
 * page in a new tab, and an emailed link is paid on the customer's own device.
 * The rental page that opened it therefore never learns that the money arrived.
 *
 * That is not a small window. providers.tsx sets `refetchOnWindowFocus: false`
 * for every query in the portal, so switching back to the rental tab refetches
 * NOTHING — the operator keeps looking at pre-payment state until they reload
 * the page by hand. Two symptoms come straight out of it:
 *
 *   - The Payment Links panel still says "Awaiting payment" for a link the
 *     customer has just paid, while the Payment Breakdown beside it (fed by a
 *     query that happened to refetch) already says Paid. Same rental, two ages
 *     of the same fact.
 *   - Clicking Collect Payment again re-requests a checkout for a debt that is
 *     now settled, and create-checkout-session correctly refuses it
 *     (`square_payment_already_settled`) — so the operator gets an error where
 *     they should simply have seen the payment.
 *
 * WHAT IT DOES
 *
 * Re-reads the payment queries from the database on the two occasions the money
 * can have moved without us hearing about it:
 *
 *   1. The tab becomes visible again — the operator has come back from the
 *      Square checkout tab. This is the "immediately after payment" case.
 *   2. On an interval, while this rental still has an unpaid Square link and the
 *      tab is visible — the "customer paid the emailed link on their phone while
 *      the operator had the rental open" case.
 *
 * It invalidates, it never writes: the row's status, paid_at and Square handles
 * are settled server-side by create-square-card-payment / square-webhook /
 * recover-pending-square-payments. This only stops the UI from showing a cached
 * answer older than theirs.
 *
 * SQUARE-ONLY BY ITS `enabled` FLAG. Stripe tenants keep the existing behaviour
 * exactly — their checkout returns to the portal through a redirect that already
 * remounts the page, so they never had this gap.
 */

/**
 * First segment of every query key that carries rental/customer payment state.
 * Matched by prefix rather than by exact key so a keyed variant
 * (["rental-totals", rentalId]) is caught without listing every id.
 */
const PAYMENT_QUERY_PREFIXES = new Set([
  "rental",
  "rental-totals",
  "rental-charges",
  "rental-payment",
  "rental-payments",
  "rental-payments-total",
  "rental-payment-breakdown",
  "rental-manual-paid-breakdown",
  "rental-refund-breakdown",
  "rental-extension-totals",
  "rental-invoice",
  "rental-payment-links",
  "customer-payment-links",
  "payments",
  "payments-data",
  "payment-applications",
  "outstanding-balance",
  "excess-mileage-charge",
  "ledger-entries",
  "customer-balance",
  "customer-balance-status",
]);

interface SquarePaymentSyncOptions {
  /** Gate. Pass `tenant?.payment_provider === "square"` — false leaves other rails untouched. */
  enabled: boolean;
  /** True while this rental has a Square link the customer could still be paying. */
  hasOpenLink: boolean;
  /** How often to re-read while a link is open. */
  pollMs?: number;
}

export function useSquarePaymentSync({
  enabled,
  hasOpenLink,
  pollMs = 10_000,
}: SquarePaymentSyncOptions): () => void {
  const queryClient = useQueryClient();

  const sync = useCallback(() => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const head = query.queryKey?.[0];
        return typeof head === "string" && PAYMENT_QUERY_PREFIXES.has(head);
      },
    });
  }, [queryClient]);

  // 1. Back from the Square tab.
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled, sync]);

  // 2. Paid somewhere we cannot observe at all. Only while there is something
  //    outstanding to observe, and only while the tab is on screen — a
  //    background tab polling a payments table for hours buys nothing.
  useEffect(() => {
    if (!enabled || !hasOpenLink || typeof document === "undefined") return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") sync();
    }, pollMs);
    return () => clearInterval(timer);
  }, [enabled, hasOpenLink, pollMs, sync]);

  return sync;
}
