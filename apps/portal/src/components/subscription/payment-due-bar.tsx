"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";

/**
 * The dunning warning, for a PHONE.
 *
 * ── why this exists ────────────────────────────────────────────────────────
 *
 * During the grace window the only billing surface in the product is the chip
 * in the sidebar footer (`app-sidebar-v2.tsx`, and v1's `app-sidebar.tsx`).
 * Below `md` both sidebars live inside a CLOSED Radix `Sheet`, which means the
 * chip is not merely off-screen — it is not in the DOM. So an operator working
 * on a phone was warned about nothing at all for the whole window, and then met
 * a non-dismissible paywall with no prior warning. Measured at 360px across
 * D0–D7 with the real layout (scratchpad/ann/subsim).
 *
 * This bar is that chip's phone-only counterpart, and it covers BOTH chromes:
 * v1's sidebar is a Sheet on phones too, and 56 tenants are still on v1.
 *
 * ── the rules it follows ───────────────────────────────────────────────────
 *
 * `md:hidden`, so it can never double up with the sidebar chip. It is the CSS
 * that hides it rather than a width hook: a JS measurement would need an effect
 * and would flash the bar on every desktop load.
 *
 * Nothing rendered in any other state — no wrapper, no spacer, no DOM. That is
 * what keeps `main`'s `md:[header+&]` alignment rules (see the note in
 * `(dashboard)/layout.tsx`) intact for every healthy tenant: they only hold
 * while the banners between the header and `main` render nothing, exactly as
 * `MaintenanceBanner` and `AppBannerStack` already do.
 *
 * IN FLOW, never `position: fixed`. `SystemAnnouncementBanner` is the fixed bar
 * at the top of the viewport and it publishes `html[data-system-banner]` +
 * `--system-banner-h`, which global.css uses to push the sidebars, the sticky
 * top bar and the Trax panel down. A second fixed bar would have to join that
 * arithmetic; a flow element inside `<Inset>` simply takes its own height, and
 * it can neither cover content nor trap scroll.
 *
 * It is a WARNING, not a gate: there is no dismiss. The state persists until the
 * invoice is paid, and a dismissed warning on a phone would put us straight back
 * to the defect above. The action is the whole point — on the routes the hard
 * gate deliberately leaves reachable (`/subscription`, `/settings`) this bar is
 * a phone user's only route to the hosted invoice.
 *
 * The wording is the sidebar chip's, verbatim, and there is NO COUNTDOWN: see
 * the note at `app-sidebar-v2.tsx:293-300` for why one was deliberately
 * removed. The colour pairs are copied from the same chip rather than imported,
 * because that file belongs to the chrome and this one does not — if they are
 * ever restyled, they must be restyled together.
 */
export interface PaymentDueBarProps {
  /**
   * Show at EVERY width, not just below `md`.
   *
   * For the routes that do not mount the sidebar at all — `/messages` replaces
   * it with null and `/trax` swaps `AppSidebarV2` for `TraxRail` — the chip this
   * bar defers to does not exist, so `md:hidden` left a desktop operator who
   * spends the grace window in Messages or Trax with NO warning anywhere, then a
   * paywall on day 7. Passed by `(dashboard)/layout.tsx`, which is the only
   * place that knows which chrome a route mounts; it must stay false everywhere
   * the chip IS on screen, or the two surfaces double up.
   */
  allWidths?: boolean;
}

export function PaymentDueBar({ allWidths = false }: PaymentDueBarProps) {
  const {
    isInGracePeriod,
    isGraceExpired,
    graceSeverity,
    outstandingInvoiceUrl,
  } = useTenantSubscription();

  // Same condition as the chip, including the EXPIRED state: the moment the
  // window closes the tenant still owes money, and on an exempt route this bar
  // is the only thing on screen that can take them to pay it.
  const paymentDue = isInGracePeriod || isGraceExpired;
  if (!paymentDue) return null;

  // `graceSeverity` is "none" outside the window (it is derived from
  // isInGracePeriod), so expiry has to carry the escalation itself.
  const critical = graceSeverity === "critical" || isGraceExpired;

  const label = "Your payment is due.";
  const detail = isGraceExpired ? "Overdue" : "Action needed";

  // Copied verbatim from `app-sidebar-v2.tsx` / `app-sidebar.tsx` (`paymentDueClass`).
  const tint = critical
    ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
    : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";

  const className = `${allWidths ? "" : "md:hidden "}flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium ${tint}`;

  const body = (
    <>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
      <span className="opacity-70">{detail}</span>
      <span className="ml-auto shrink-0 underline underline-offset-2">
        Pay now
      </span>
    </>
  );

  // The whole bar is the link, so a thumb cannot miss it.
  //
  // The hosted invoice when we have one — that is the document that actually
  // settles the debt, and a new subscription cannot. Otherwise /subscription,
  // which carries the pay link and the plan list; never a dead end.
  return outstandingInvoiceUrl ? (
    <a
      data-payment-due-bar=""
      href={outstandingInvoiceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {body}
    </a>
  ) : (
    <Link data-payment-due-bar="" href="/subscription" className={className}>
      {body}
    </Link>
  );
}
