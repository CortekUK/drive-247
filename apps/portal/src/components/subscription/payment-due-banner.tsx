"use client";

import { AlertTriangle, AlertOctagon, ArrowRight } from "lucide-react";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";

/**
 * Top-of-screen dunning banner.
 *
 * WHY THIS EXISTS
 * The requirement is "show a banner at the top of their screen stating: 'Your
 * payment is due.'" for the whole 7-day grace window. That message previously
 * lived ONLY as a chip in the sidebar footer. On mobile the sidebar is a closed
 * Sheet, so an operator on a phone got no warning whatsoever for all 7 days and
 * was then hard-blocked with no notice — the single most likely support
 * escalation in the whole dunning flow. With the sidebar collapsed on desktop it
 * degraded to a bare icon.
 *
 * The sidebar chip is deliberately kept as a secondary indicator; this is the
 * primary one, and it is rendered in the dashboard layout so it appears on every
 * page rather than on one route.
 *
 * COPY IS THE CLIENT'S, VERBATIM
 * "Your payment is due." — do not reword. The countdown and the pay link are
 * additive context around it, not a replacement for it.
 */
export function PaymentDueBanner() {
  const {
    isInGracePeriod,
    isGraceExpired,
    graceDaysRemaining,
    graceSeverity,
    outstandingInvoiceUrl,
    isResolved,
  } = useTenantSubscription();

  // Wait for the subscription + invoice queries to settle. Rendering early would
  // flash a payment warning at a tenant who is perfectly up to date.
  if (!isResolved) return null;
  if (!isInGracePeriod && !isGraceExpired) return null;

  // Expired outruns the grace styling — at that point the paywall is already up
  // and this strip is the explanation sitting above it.
  const critical = isGraceExpired || graceSeverity === "critical";

  const tone = critical
    ? {
        bg: "bg-red-50 dark:bg-red-950/40",
        text: "text-red-800 dark:text-red-200",
        icon: AlertOctagon,
        iconColor: "text-red-500 dark:text-red-400",
        link: "text-red-900 dark:text-red-100",
      }
    : {
        bg: "bg-amber-50 dark:bg-amber-950/40",
        text: "text-amber-800 dark:text-amber-200",
        icon: AlertTriangle,
        iconColor: "text-amber-500 dark:text-amber-400",
        link: "text-amber-900 dark:text-amber-100",
      };

  const Icon = tone.icon;

  /** Plain-language urgency. Singular/plural matters on a message this visible. */
  const detail = isGraceExpired
    ? "Your access has been suspended."
    : graceDaysRemaining <= 0
      ? "Today is the last day before access is suspended."
      : `${graceDaysRemaining} day${graceDaysRemaining === 1 ? "" : "s"} left before access is suspended.`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full ${tone.bg} px-4 py-2.5`}
    >
      {/* flex-wrap + centred so it stays readable on a narrow phone rather than
          truncating the countdown or pushing the pay link off-screen. */}
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <Icon className={`h-4 w-4 shrink-0 ${tone.iconColor}`} />
        <p className={`text-sm font-medium ${tone.text} text-center`}>
          Your payment is due.{" "}
          <span className="font-normal opacity-90">{detail}</span>
        </p>
        {outstandingInvoiceUrl && (
          <a
            href={outstandingInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-2 ${tone.link}`}
          >
            Pay now
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
