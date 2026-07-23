/**
 * How long the migration dialog's "You're all set" confirmation lingers before
 * the modal closes.
 *
 * Shared so the SetupReminderDialog interlock (`useMigrationStatus`) can keep the
 * Bonzah/Connect-Stripe setup nudge suppressed for exactly the same window — the
 * celebration and the interlock must start and end together, or the setup dialog
 * would flash in underneath the celebration.
 */
export const SUCCESS_LINGER_MS = 6000;
