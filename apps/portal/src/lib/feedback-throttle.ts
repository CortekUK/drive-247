/**
 * Pure decision logic for the two automatic feedback prompts.
 *
 * Kept out of the hooks deliberately: these are the rules that decide whether
 * an operator gets interrupted, and getting them wrong is either a dialog that
 * nags on every rental close or one that never appears at all. Pure functions
 * so both are covered by tests rather than by clicking around.
 */

/** Days between rental-completion feedback prompts for the same user. */
export const FEEDBACK_PROMPT_COOLDOWN_DAYS = 7;

export interface RentalCompletionPromptInput {
  /** Platform kill switch (`tenant_feedback_settings.form_enabled`). */
  formEnabled: boolean;
  /** False while settings or the user's stamp are still loading. */
  isResolved: boolean;
  /** `app_users.feedback_last_prompted_at`, ISO string or null. */
  lastPromptedAt: string | null | undefined;
  /** Current time, injected so tests don't depend on the wall clock. */
  now?: Date;
}

/**
 * Should we show the software-feedback dialog after a rental was closed?
 *
 * Never fires before the config and the user's stamp have loaded — acting on
 * defaults would prompt every operator on their first paint.
 */
export function shouldPromptAfterRentalCompletion({
  formEnabled,
  isResolved,
  lastPromptedAt,
  now = new Date(),
}: RentalCompletionPromptInput): boolean {
  if (!isResolved) return false;
  if (!formEnabled) return false;
  if (!lastPromptedAt) return true;

  const last = new Date(lastPromptedAt).getTime();
  // An unparseable stamp must not permanently suppress the prompt.
  if (Number.isNaN(last)) return true;

  const daysSince = (now.getTime() - last) / (1000 * 60 * 60 * 24);
  return daysSince > FEEDBACK_PROMPT_COOLDOWN_DAYS;
}

export interface ForcePromptInput {
  formEnabled: boolean;
  isResolved: boolean;
  /** `tenant_feedback_settings.force_login_triggered_at`, or null when no campaign. */
  forceLoginTriggeredAt: string | null | undefined;
  lastPromptedAt: string | null | undefined;
  /** True while a hard gate (paywall, suspension) owns the screen. */
  suppressed?: boolean;
}

/**
 * Should the super admin's "ask everyone" campaign prompt THIS user?
 *
 * The comparison is stamp-vs-campaign, not a boolean flag: that is what makes
 * the campaign fire exactly once per user and lets a user who was already
 * prompted during it be skipped, without any per-user bookkeeping.
 */
export function shouldForcePrompt({
  formEnabled,
  isResolved,
  forceLoginTriggeredAt,
  lastPromptedAt,
  suppressed = false,
}: ForcePromptInput): boolean {
  if (suppressed) return false;
  if (!isResolved) return false;
  if (!formEnabled) return false;
  if (!forceLoginTriggeredAt) return false;
  if (!lastPromptedAt) return true;

  const last = new Date(lastPromptedAt).getTime();
  const campaign = new Date(forceLoginTriggeredAt).getTime();
  if (Number.isNaN(last)) return true;
  if (Number.isNaN(campaign)) return false;

  return last < campaign;
}
