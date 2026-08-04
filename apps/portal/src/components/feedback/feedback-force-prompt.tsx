"use client";

import { useEffect, useRef } from "react";
import { useFeedbackStore } from "@/stores/feedback-store";
import { useFeedbackSettings } from "@/hooks/use-feedback-settings";
import { useFeedbackPromptState } from "@/hooks/use-tenant-feedback";
import { shouldForcePrompt } from "@/lib/feedback-throttle";

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
 *
 * The decision itself lives in `lib/feedback-throttle` and is unit-tested.
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

    const due = shouldForcePrompt({
      formEnabled,
      isResolved: isResolved && promptResolved,
      forceLoginTriggeredAt,
      lastPromptedAt: promptState?.lastPromptedAt,
      suppressed,
    });

    if (!due) return;

    firedRef.current = true;
    // The dialog stamps `feedback_last_prompted_at` on open, so dismissing
    // still satisfies this trigger and it never fires twice for one campaign.
    open({ source: "forced" });
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
