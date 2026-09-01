/**
 * /checkout/[paymentId] — our own hosted checkout, for a link sent by email.
 *
 * NOT /pay/[paymentId]: /pay/[token] already exists for installment magic
 * links, and Next.js refuses two different slug names at the same path level.
 * The first attempt collided with it and served the installment page's
 * "Couldn't open payment" instead of this one.
 *
 * WHY WE HOST THIS INSTEAD OF EMAILING SQUARE'S LINK
 *
 * A Square-hosted payment link shows card fields in production but NOT in
 * sandbox: sandbox.square.link 303-redirects to Square's simulator, so the whole
 * emailed-link journey is untestable before go-live. It also hands the customer
 * to a page carrying Square's branding rather than the business they booked with.
 *
 * Stripe's emailed links land on a checkout page with card fields, and the brief
 * is that Square should behave the same way. This is that page: the card fields
 * are Square's Web Payments SDK, so the card still never touches our servers,
 * but the page around them is ours and works identically in both modes.
 *
 * IT SETTLES AN EXISTING ROW. The payments row was written when the link was
 * generated. Paying here charges THAT debt — it does not mint a second one.
 */
"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { SquareCardForm } from "@/components/payments/SquareCardForm";

interface PaymentRequest {
  paymentId: string;
  amount: number;
  currency: string;
  description: string;
  tenantSlug: string | null;
  businessName: string | null;
  settled: boolean;
  status: string | null;
}

export const dynamic = "force-dynamic";

export default function PayPage() {
  const params = useParams<{ paymentId: string }>();
  const paymentId = params?.paymentId;

  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paid, setPaid] = useState<{ receiptUrl: string | null } | null>(null);

  useEffect(() => {
    if (!paymentId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke("get-square-payment-request", {
        body: { paymentId },
      });
      if (cancelled) return;
      if (error) {
        setLoadError(
          "This payment link is not valid any more. Please contact the business for a new one.",
        );
        return;
      }
      setRequest(data as PaymentRequest);
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  const money = (n: number, ccy: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: ccy }).format(n);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}

        {!request && !loadError && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your payment…
          </div>
        )}

        {request && paid && (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <h1 className="text-lg font-semibold">Payment received</h1>
            <p className="text-sm text-muted-foreground">
              Thank you. {money(request.amount, request.currency)} has been paid to{" "}
              {request.businessName ?? "the business"}.
            </p>
            {paid.receiptUrl && (
              <a
                href={paid.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm underline"
              >
                View your receipt
              </a>
            )}
          </div>
        )}

        {/* Already settled is a normal outcome, not a broken link: two people can
            open the same email, or the customer can revisit it after paying. */}
        {request && !paid && request.settled && (
          <div className="space-y-2 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <h1 className="text-lg font-semibold">Already paid</h1>
            <p className="text-sm text-muted-foreground">
              This payment of {money(request.amount, request.currency)} has already been
              received. There is nothing left to pay.
            </p>
          </div>
        )}

        {request && !paid && !request.settled && (
          <>
            <header className="mb-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {request.businessName ?? "Payment"}
              </p>
              <h1 className="mt-1 text-2xl font-semibold">
                {money(request.amount, request.currency)}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{request.description}</p>
            </header>

            <SquareCardForm
              tenantSlug={request.tenantSlug ?? ""}
              amount={request.amount}
              paymentId={request.paymentId}
              submitLabel={`Pay ${money(request.amount, request.currency)}`}
              onSuccess={(r) => setPaid({ receiptUrl: r.receiptUrl })}
            />

            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              Payments are processed by Square.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
