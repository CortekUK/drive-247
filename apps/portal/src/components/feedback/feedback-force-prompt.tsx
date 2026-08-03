"use client";

import { useEffect, useRef } from "react";
import { useFeedbackStore } from "@/stores/feedback-store";
import { useFeedbackSettings } from "@/hooks/use-feedback-settings";
import { useFeedbackPromptState } from "@/hooks/use-tenant-feedback";

interface FeedbackForcePromptProps {
  /**
   * True while a hard gate (paywall, suspension) owns the screen. Two
   * non-dismissible-looking modals fighting over the same Radix focus trap is
   * how you end up with an operator who can neither pay nor close anything.
   */
  suppressed?: boolean;
}

/**
 * "Force show on next login" — a super admin sets
 * `tenant_feedback_settings.force_login_triggered_at`, and every operator gets
 * the feedback dialog once the next time they land in the dashboard.
 *
 * Deliberately NOT a gate: it opens a dismissible dialog over a fully usable
 * dashboard. Nothing here blocks rendering.
 */
export function FeedbackForcePrompt({ suppressed = false }: FeedbackForcePromptProps) {
  const open = useFeedbackStore((s) => s.open);
  const { formEnabled, forceLoginTriggeredAt, isResolved } = useFeedbackSettings();
  const { data: promptState, isSuccess: promptResolved } = useFeedbackPromptState();

  // Once per mounted session. The dashboard layout persists across every route
  // change in the App Router, so without this the effect would re-evaluate on
  // each navigation and re-open the dialog the moment it was dismissed.
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (suppressed) return;
    // Never act on defaults — wait until both the settings and the user's own
    // last-prompted stamp have actually loaded, or the first paint would prompt
    // everyone every time.
    if (!isResolved || !promptResolved) return;
    if (!formEnabled || !forceLoginTriggeredAt) return;

    const lastPrompted = promptState?.lastPromptedAt;
    const dueForPrompt =
      !lastPrompted ||
      new Date(lastPrompted).getTime() < new Date(forceLoginTriggeredAt).getTime();

    if (!dueForPrompt) return;

    firedRef.current = true;
    // The dialog stamps `feedback_last_prompted_at` on open, so dismissing
    // still satisfies this trigger and it never fires twice for one campaign.
    open({ source: "forced-login" });
  }, [
    suppressed,
    isResolved,
    promptResolved,
    formEnabled,
    forceLoginTriggeredAt,
    promptState?.lastPromptedAt,
    open,
  ]);

  return null;
}
