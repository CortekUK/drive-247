"use client";

import { useState } from "react";
import { HandCoins } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaymentProvider } from "./finance-data";

/**
 * Where a payment came from, as a small mark.
 *
 * ONLINE: the Stripe or Square logo, from logo.dev — the same CDN and
 * publishable key the Integrations board uses for these two logos, so they are
 * the same marks. If the image cannot load, the provider's initial stands in
 * rather than a broken image.
 *
 * MANUAL: one mark for all of it — a hand with coins, in green — so a row
 * first says WHO took the money (Stripe, Square, or staff by hand) and then, in
 * words, what it was: "Manual · Cash", "Manual · Card", "Manual · Bank
 * transfer".
 */

// logo.dev — publishable key (safe client-side), as integrations-board.tsx.
const LOGO_TOKEN = "pk_EmodMTbiSPiHDa2fIPUo3w";
const LOGO_DOMAIN: Record<Exclude<PaymentProvider, "manual">, string> = {
  stripe: "stripe.com",
  square: "squareup.com",
};
const PROVIDER_LABEL = { stripe: "Stripe", square: "Square" } as const;

/**
 * The ONE mark for money staff recorded by hand — declared the way the Stripe
 * and Square logos declare theirs. What the money actually was (cash, card, a
 * transfer) is written beside it in the row's text, not encoded in the icon.
 */
const MANUAL_MARK = {
  Icon: HandCoins,
  tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  label: "Manual",
};

export function PaymentSourceIcon({
  provider,
  className,
}: {
  provider: PaymentProvider;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (provider === "manual") {
    const { Icon, tone, label } = MANUAL_MARK;
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn("inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px]", tone, className)}
      >
        <Icon className="h-2.5 w-2.5" />
      </span>
    );
  }

  if (failed) {
    return (
      <span
        role="img"
        aria-label={PROVIDER_LABEL[provider]}
        className={cn(
          "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-muted text-[9px] font-bold text-muted-foreground",
          className,
        )}
      >
        {PROVIDER_LABEL[provider][0]}
      </span>
    );
  }

  return (
    <img
      src={`https://img.logo.dev/${LOGO_DOMAIN[provider]}?token=${LOGO_TOKEN}&size=64&format=png`}
      alt={PROVIDER_LABEL[provider]}
      title={PROVIDER_LABEL[provider]}
      className={cn("h-3.5 w-3.5 shrink-0 rounded-[3px] object-contain", className)}
      onError={() => setFailed(true)}
    />
  );
}
