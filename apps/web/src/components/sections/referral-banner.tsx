import { Gift } from "lucide-react";
import { offerHeadline, type PromoOffer } from "@/lib/promo-offer";
import { RememberReferralCode } from "./remember-referral-code";

/**
 * "Sunset Rentals invited you: 20% off for your first 3 months." Shown at the
 * top of the landing page when the visitor arrived with a usable Drive247
 * promo / referral code (cookie from /r/{code}). The code is already
 * remembered and is applied at checkout.
 */
export function ReferralBanner({ offer }: { offer: PromoOffer }) {
  return (
    <div className="border-b border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
      <RememberReferralCode code={offer.displayCode} />
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-3 text-center text-sm sm:px-6">
        <p className="flex items-center gap-2 font-medium">
          <Gift className="h-4 w-4 shrink-0" aria-hidden="true" />
          {offerHeadline(offer)}
        </p>
        <p className="text-emerald-800 dark:text-emerald-200/80">
          Your code <span className="font-mono font-semibold">{offer.displayCode}</span> is applied at checkout.{" "}
          <a href="#pricing" className="underline underline-offset-2">See plans</a>
        </p>
      </div>
    </div>
  );
}
