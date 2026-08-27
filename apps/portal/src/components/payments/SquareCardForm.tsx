/**
 * SquareCardForm — card entry inside the portal, for an operator taking payment.
 *
 * A SIBLING of the booking app's component, not a shared module: the two apps do
 * not share code, and the audience differs. There, a renter pays for their own
 * booking. Here, an operator types a card the customer is reading out or
 * handing over at the desk — so the copy is about the customer's card, not
 * "your" card.
 *
 * WHY THIS EXISTS ALONGSIDE THE HOSTED PAYMENT LINK
 *
 * A Square-hosted link shows card fields in production, but in SANDBOX it does
 * not exist at all: sandbox.square.link 303-redirects to Square's simulator, so
 * no card number can ever be typed. Verified against the live endpoint and
 * documented by Square. That makes the hosted link untestable end to end before
 * go-live, and leaves the renter on a page we do not control.
 *
 * This renders Square's Web Payments SDK card fields inline. The card number
 * never reaches our servers — the SDK exchanges it for a single-use token in the
 * browser, and only that token is posted. Same trust model as Stripe Elements.
 *
 * SANDBOX ACCEPTS TEST CARDS HERE. 4111 1111 1111 1111, any future expiry, any
 * CVV, and a valid postcode (GBP/USD/CAD require one).
 */
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

/** Square serves different SDK builds per environment; they are not interchangeable. */
const SDK_SRC = {
  test: "https://sandbox.web.squarecdn.com/v1/square.js",
  live: "https://web.squarecdn.com/v1/square.js",
} as const;

interface SquareConfig {
  applicationId: string;
  locationId: string;
  mode: "test" | "live";
  currency: string;
  tenantId: string;
}

export interface SquareCardFormProps {
  tenantSlug: string;
  /** Major units, as displayed to the renter. */
  amount: number;
  rentalId?: string;
  bookingId?: string;
  customerId?: string;
  /**
   * Settle an EXISTING payments row rather than create one.
   *
   * Used by the emailed-link page: the row was written when the link was
   * generated, so paying must close that debt instead of opening a second.
   */
  paymentId?: string;
  /** Separates two genuinely different charges that share a reference + amount. */
  idempotencyScope?: string;
  onSuccess: (result: { paymentId: string | null; squarePaymentId: string; receiptUrl: string | null }) => void;
  onError?: (message: string) => void;
  submitLabel?: string;
}

/**
 * Load the SDK once per document.
 *
 * React StrictMode mounts effects twice in development, and two <script> tags
 * for the same SDK race to define window.Square — the second can clobber a
 * half-initialised first. Keyed on the resolved src so switching modes still
 * loads the right build.
 */
const sdkPromises = new Map<string, Promise<void>>();
function loadSquareSdk(src: string): Promise<void> {
  const existing = sdkPromises.get(src);
  if (existing) return existing;

  const p = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("no document"));
    const already = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (already) {
      already.addEventListener("load", () => resolve());
      already.addEventListener("error", () => reject(new Error("Square SDK failed to load")));
      if ((window as any).Square) resolve();
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Square SDK failed to load"));
    document.head.appendChild(el);
  });

  sdkPromises.set(src, p);
  return p;
}

export function SquareCardForm({
  tenantSlug,
  amount,
  rentalId,
  bookingId,
  customerId,
  paymentId,
  idempotencyScope,
  onSuccess,
  onError,
  submitLabel,
}: SquareCardFormProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<any>(null);
  const paymentsRef = useRef<any>(null);

  const [config, setConfig] = useState<SquareConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards a double-submit at the source. The token is single-use, so a second
  // tokenize would fail confusingly rather than double-charge — but the renter
  // should never see that.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error: cfgError } = await supabase.functions.invoke("get-square-config", {
          body: { tenantSlug },
        });
        if (cfgError) throw new Error(cfgError.message || "Could not load payment settings");
        if (!data?.applicationId || !data?.locationId) throw new Error("Payment settings are incomplete");
        if (cancelled) return;

        const cfg = data as SquareConfig;
        setConfig(cfg);

        await loadSquareSdk(SDK_SRC[cfg.mode === "live" ? "live" : "test"]);
        if (cancelled) return;

        const Square = (window as any).Square;
        if (!Square) throw new Error("Square could not start on this page");

        const payments = Square.payments(cfg.applicationId, cfg.locationId);
        paymentsRef.current = payments;

        const card = await payments.card();
        if (cancelled) {
          // Mounting into a container React has already unmounted throws; and an
          // un-destroyed card leaks an iframe on every remount.
          await card.destroy?.();
          return;
        }
        await card.attach(containerRef.current);
        cardRef.current = card;
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        onError?.(message);
      }
    })();

    return () => {
      cancelled = true;
      cardRef.current?.destroy?.();
      cardRef.current = null;
    };
    // tenantSlug is the only input that should rebuild the card element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug]);

  async function handlePay() {
    if (!cardRef.current || !config || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const result = await cardRef.current.tokenize();
      if (result.status !== "OK") {
        // Square's own field-level messages are better than anything generic:
        // "Card declined", "Invalid postal code", "Card expired".
        const detail = Array.isArray(result.errors) && result.errors.length
          ? result.errors.map((e: any) => e.message).join(" ")
          : "Please check your card details and try again.";
        throw new Error(detail);
      }

      // Square's anti-fraud signal. Optional, and never worth failing over —
      // a payment without it is still valid, one blocked by an SDK hiccup is not.
      let verificationToken: string | undefined;
      try {
        const v = await paymentsRef.current?.verifyBuyer(result.token, {
          amount: String(amount),
          currencyCode: config.currency,
          intent: "CHARGE",
          billingContact: {},
        });
        verificationToken = v?.token;
      } catch {
        /* proceed without it */
      }

      const { data, error: payError } = await supabase.functions.invoke("create-square-card-payment", {
        body: {
          tenantId: config.tenantId,
          sourceId: result.token,
          verificationToken,
          totalAmount: amount,
          rentalId,
          bookingId,
          customerId,
          paymentId,
          idempotencyScope,
        },
      });

      if (payError) throw new Error(payError.message || "Payment could not be completed");
      if (!data?.squarePaymentId) throw new Error("Payment did not complete");

      onSuccess({
        paymentId: data.paymentId ?? null,
        squarePaymentId: data.squarePaymentId,
        receiptUrl: data.receiptUrl ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onError?.(message);
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
  }

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="min-h-[90px] rounded-md border border-border bg-background p-3"
      />

      {!ready && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading secure card form…
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={!ready || submitting}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {submitting ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing…
          </span>
        ) : (
          submitLabel ?? `Pay ${config?.currency ?? ""} ${amount.toFixed(2)}`
        )}
      </button>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        Card details go straight to Square. Neither you nor this portal sees or stores them.
      </p>

      {config?.mode === "test" && (
        <p className="text-center text-xs text-amber-600 dark:text-amber-400">
          Sandbox — 4111 1111 1111 1111, any future expiry, any CVV, postcode SW1A 1AA. No real money moves.
        </p>
      )}
    </div>
  );
}

export default SquareCardForm;
