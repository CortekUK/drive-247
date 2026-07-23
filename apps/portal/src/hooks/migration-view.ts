/**
 * Single source of truth for the operator Stripe UK→UAE migration "view".
 *
 * Both `use-migration-blocker` (which drives the MigrationBlockerDialog) and
 * `use-migration-status` (which drives the SetupReminderDialog interlock) derive
 * their state from THIS function, off the same shared React Query row. They MUST
 * agree — an earlier version duplicated the derivation in each hook and they
 * drifted (one checked `own_stripe_account_id` always-live, the other checked it
 * mode-dependently), which let the setup dialog render on top of the migration
 * dialog. Keeping the logic here, once, makes that class of bug impossible.
 */

export type MigrationBlockerState = "off" | "soft" | "hard";

/** How long a soft-prompt dismissal suppresses the migration dialog. */
export const MIGRATION_DISMISS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The subset of tenant columns the migration view is derived from. */
export interface MigrationViewRow {
  migration_blocker: MigrationBlockerState | null;
  migration_blocker_dismissed_at: string | null;
  subscription_account: string | null;
  own_stripe_account_id: string | null;
}

export interface MigrationView {
  /** Raw `tenants.migration_blocker` enrollment value. */
  stored: MigrationBlockerState;
  /**
   * The operator has connected their own real (LIVE) Stripe account. The
   * migration ALWAYS connects the live account regardless of `stripe_mode`; a
   * test-mode rehearsal connection (`own_stripe_test_account_id`) does NOT count.
   */
  stripeConnected: boolean;
  /** Platform subscription is billed on the UAE account. */
  paymentConfirmed: boolean;
  /** Both migration steps done — the prompt auto-hides once this is true. */
  bothComplete: boolean;
  /** The soft prompt was dismissed within the last 24h. */
  dismissedRecently: boolean;
  /**
   * The VISIBLE prompt state that drives MigrationBlockerDialog: `hard` blocks,
   * `soft` is a dismissible nudge (becomes `off` for 24h once dismissed), `off`
   * shows nothing.
   */
  state: MigrationBlockerState;
  /** The migration prompt is currently on screen (hard, or soft not dismissed). */
  promptVisible: boolean;
  /**
   * Enrolled in the migration (soft|hard) and not yet finished — regardless of
   * whether the soft prompt is currently dismissed. Anything that must stay
   * suppressed "until migration is complete" (e.g. the setup dialog's Stripe
   * task) keys off this, not off `promptVisible`.
   */
  enrolledIncomplete: boolean;
}

/**
 * Derive the full migration view from a tenant row. Pure apart from reading the
 * wall clock for the 24h dismissal window (matches the dialog's own behaviour;
 * recomputed each render).
 */
export function deriveMigrationView(
  row: MigrationViewRow | null | undefined,
): MigrationView {
  const stripeConnected = !!row?.own_stripe_account_id;
  const paymentConfirmed = row?.subscription_account === "uae";
  const bothComplete = stripeConnected && paymentConfirmed;

  const dismissedAt = row?.migration_blocker_dismissed_at
    ? new Date(row.migration_blocker_dismissed_at).getTime()
    : null;
  const dismissedRecently =
    dismissedAt !== null &&
    Date.now() - dismissedAt < MIGRATION_DISMISS_WINDOW_MS;

  const stored: MigrationBlockerState = (row?.migration_blocker ??
    "off") as MigrationBlockerState;

  let state: MigrationBlockerState = "off";
  if (row && !bothComplete) {
    if (stored === "hard") state = "hard";
    else if (stored === "soft") state = dismissedRecently ? "off" : "soft";
  }

  const promptVisible = state === "soft" || state === "hard";
  const enrolledIncomplete =
    !!row && !bothComplete && (stored === "soft" || stored === "hard");

  return {
    stored,
    stripeConnected,
    paymentConfirmed,
    bothComplete,
    dismissedRecently,
    state,
    promptVisible,
    enrolledIncomplete,
  };
}
