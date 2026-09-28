"use client";

import { useCallback, useEffect, useState } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";

/**
 * SOFT SUBSCRIPTION BLOCK — the tenant keeps their dashboard, and is reminded.
 *
 * ── what this is ───────────────────────────────────────────────────────────
 *
 * The subscription gate has exactly one outcome today: `SubscriptionGateDialog`
 * with no Esc, no outside-click and no close button, covering the whole product
 * until an invoice is paid. That is right for most debtors and wrong for the
 * case it was never designed for — an operator whose ABILITY TO PAY is the
 * thing that broke. Avery's Rentals is the live example: Stripe rejected her
 * Connect account, so she cannot take money in, cannot pay the invoice, and the
 * hard gate then removes the only system she could have used to earn it back.
 *
 * Soft mode keeps the debt visible and the door open: a dismissible dialog that
 * returns every 24h, plus a "payment due" bar that never dismisses at all.
 *
 * ── which switch drives it ─────────────────────────────────────────────────
 *
 * `tenants.subscription_gate_disabled` — the existing per-tenant toggle in the
 * Super Admin record ("Subscription blocker"). It used to mean "show this
 * tenant nothing"; it now means "soft, not hard". Nothing else changed about
 * where it is read: `(dashboard)/layout.tsx` still suppresses the hard modal on
 * exactly the same condition, so a tenant with the toggle off sees precisely
 * what they saw before.
 *
 * The GLOBAL switch (`admin_settings.subscription_gate_disabled`, read by
 * use-subscription-gate-disabled.ts) is deliberately NOT read here and keeps
 * its old meaning — a platform-wide emergency silence. A flag that exists to
 * stop every tenant seeing a paywall must not start showing all of them a
 * reminder instead.
 *
 * ── why localStorage for the dismissal ─────────────────────────────────────
 *
 * The migration blocker stores its dismissal in three tenant columns behind an
 * edge function. This one deliberately does not: the window is a per-person
 * convenience, not a business fact, and matching that design would mean a
 * schema change to ship a reminder. Per-device is the right grain anyway — the
 * operator who dismissed it on their phone should still meet it on the desk
 * machine. Nothing here is a permission: `active` alone decides whether money
 * is owed, and that is read from the database every time.
 */

/** How long a dismissal suppresses the reminder. Mirrors the migration prompt. */
export const SOFT_BLOCK_DISMISS_WINDOW_MS = 24 * 60 * 60 * 1000;

export const softBlockDismissKey = (tenantId: string) =>
  `d247.soft-block-dismissed.${tenantId}`;

export interface SoftSubscriptionBlock {
  /**
   * This tenant is in soft mode AND actually owes money — the state the bar and
   * the dialog both describe. False for every healthy tenant, and false for a
   * debtor whose toggle is off (they get the hard gate, unchanged).
   */
  active: boolean;
  /** The dismissible dialog should be on screen right now. */
  reminderVisible: boolean;
  /** Suppress the dialog for the next 24h on this device. */
  dismiss: () => void;
  /** Where to actually settle the debt; null when no invoice has synced. */
  invoiceUrl: string | null;
}

export function useSoftSubscriptionBlock(): SoftSubscriptionBlock {
  const { tenant } = useTenant();
  const {
    hasExpiredSubscription,
    owesOutstandingInvoice,
    outstandingInvoiceUrl,
    isResolved,
  } = useTenantSubscription();

  const softMode =
    (tenant as { subscription_gate_disabled?: boolean | null } | null)
      ?.subscription_gate_disabled === true;

  // Only once the billing queries have actually answered. Without this the
  // reminder flashes on every load for a paid tenant, because `undefined` data
  // reads as "no subscription" for the instant before the query lands.
  const active =
    softMode && isResolved && (hasExpiredSubscription || owesOutstandingInvoice);

  /* `undefined` = localStorage not read yet. Deliberately three-valued: reading
     storage during render would differ between the server pass and the client
     one, and defaulting to "not dismissed" would flash the dialog at someone
     who closed it a minute ago. Nothing shows until the effect has run. */
  const [dismissedAt, setDismissedAt] = useState<number | null | undefined>(
    undefined,
  );

  const tenantId = tenant?.id ?? null;

  useEffect(() => {
    if (!tenantId) return;
    try {
      const raw = window.localStorage.getItem(softBlockDismissKey(tenantId));
      const parsed = raw ? Number(raw) : NaN;
      setDismissedAt(Number.isFinite(parsed) ? parsed : null);
    } catch {
      // Private mode, blocked storage, quota — a reminder is not worth an
      // exception. Treat it as never dismissed.
      setDismissedAt(null);
    }
  }, [tenantId]);

  const dismiss = useCallback(() => {
    const now = Date.now();
    setDismissedAt(now);
    if (!tenantId) return;
    try {
      window.localStorage.setItem(softBlockDismissKey(tenantId), String(now));
    } catch {
      // Dismissal then lasts for this mount only, which is still better than
      // throwing inside a click handler.
    }
  }, [tenantId]);

  const dismissedRecently =
    typeof dismissedAt === "number" &&
    Date.now() - dismissedAt < SOFT_BLOCK_DISMISS_WINDOW_MS;

  return {
    active,
    reminderVisible: active && dismissedAt !== undefined && !dismissedRecently,
    dismiss,
    invoiceUrl: outstandingInvoiceUrl,
  };
}
