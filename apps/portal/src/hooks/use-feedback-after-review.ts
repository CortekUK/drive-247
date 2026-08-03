import { useCallback } from "react";
import { useFeedbackStore } from "@/stores/feedback-store";
import { useFeedbackSettings } from "@/hooks/use-feedback-settings";
import { useFeedbackPromptState } from "@/hooks/use-tenant-feedback";
import { shouldPromptAfterRentalCompletion } from "@/lib/feedback-throttle";

export { FEEDBACK_PROMPT_COOLDOWN_DAYS } from "@/lib/feedback-throttle";

/**
 * The rental-completion follow-up: after staff close a rental and deal with the
 * customer review, ask them how the SOFTWARE is doing.
 *
 * Two rules make this a nudge rather than a nag:
 *  - it is SEQUENCED behind the review dialog, never stacked on top of it
 *  - the cooldown is stamped when the dialog is SHOWN, not when it is
 *    submitted, so dismissing buys the same 7 days as answering
 *
 * The decision itself lives in `lib/feedback-throttle` and is unit-tested.
 */
export const useFeedbackAfterReview = () => {
  const open = useFeedbackStore((s) => s.open);
  const { formEnabled, isResolved } = useFeedbackSettings();
  const { data: promptState, isSuccess: promptResolved } = useFeedbackPromptState();

  return useCallback(() => {
    const shouldPrompt = shouldPromptAfterRentalCompletion({
      formEnabled,
      isResolved: isResolved && promptResolved,
      lastPromptedAt: promptState?.lastPromptedAt,
    });

    if (!shouldPrompt) return false;

    open({ source: "rental-completed" });
    return true;
  }, [formEnabled, isResolved, promptResolved, promptState?.lastPromptedAt, open]);
};
