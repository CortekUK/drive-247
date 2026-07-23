"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { SUCCESS_LINGER_MS } from "@/components/migration/constants";
import { deriveMigrationView, type MigrationBlockerState } from "@/hooks/migration-view";

export type { MigrationBlockerState };

/**
 * Read-only twin of `useMigrationBlocker` for the SetupReminderDialog interlock —
 * same tenant columns, same shared cache, but WITHOUT the actions or the
 * `?oauth=` return side effect (mounting the full blocker in a second component
 * would fire its OAuth-return toast twice).
 *
 * All the migration derivation lives in `migration-view.ts` and is shared with
 * `use-migration-blocker`, so the two can never disagree off the same row. Keep
 * `MIGRATION_COLUMNS` here identical to the one in `use-migration-blocker.ts` so
 * the shared React Query row (`["migration-blocker", tenantId]`) has the same
 * shape whichever hook populates it first.
 *
 * Exposes exactly what the setup reminder needs:
 *  - `migrationPromptShowing` — the migration dialog (or its post-completion
 *    celebration) is on screen → the reminder must be fully suppressed so it
 *    never overlays the migration flow. Goes false once a soft prompt is
 *    dismissed, which is when the reminder is allowed to take over.
 *  - `hideStripeTask` — the tenant is mid-migration (soft|hard, incomplete), so
 *    the reminder must not offer "Connect Stripe": the migration flow owns that
 *    step, and for a hard block the operator is forced through it anyway.
 */
interface MigrationStatusRow {
  id: string;
  migration_blocker: MigrationBlockerState | null;
  migration_blocker_dismissed_at: string | null;
  migration_blocker_dismiss_count: number | null;
  payment_model: string | null;
  stripe_mode: "test" | "live" | null;
  subscription_account: string | null;
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
  setup_completed_at: string | null;
}

const MIGRATION_COLUMNS =
  "id, migration_blocker, migration_blocker_dismissed_at, migration_blocker_dismiss_count, payment_model, stripe_mode, subscription_account, own_stripe_account_id, own_stripe_test_account_id, setup_completed_at";

export function useMigrationStatus() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["migration-blocker", tenantId] as const,
    queryFn: async (): Promise<MigrationStatusRow | null> => {
      const { data, error } = await supabaseUntyped
        .from("tenants")
        .select(MIGRATION_COLUMNS)
        .eq("id", tenantId!)
        .single();
      if (error) throw error;
      return (data ?? null) as MigrationStatusRow | null;
    },
    enabled: !!tenantId,
    retry: 1,
  });

  const { bothComplete, enrolledIncomplete, promptVisible } =
    deriveMigrationView(data);

  // ── Success-linger interlock ────────────────────────────────────────────────
  // After BOTH migration steps complete, MigrationBlockerDialog keeps a
  // "You're all set" celebration on screen for SUCCESS_LINGER_MS — a transient
  // that lives only in that component's local state and is invisible to this
  // query. Mirror the exact same window here (same trigger: bothComplete flips
  // true after the tenant was enrolled; same duration) so the reminder stays
  // hidden through the celebration instead of flashing in underneath it. This is
  // computed entirely inside the setup dialog's own hook, so there is no
  // cross-component ordering race.
  const wasEnrolledRef = useRef(false);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    if (enrolledIncomplete) wasEnrolledRef.current = true;
  }, [enrolledIncomplete]);

  useEffect(() => {
    if (bothComplete && wasEnrolledRef.current) {
      wasEnrolledRef.current = false;
      setCelebrating(true);
      const t = setTimeout(() => setCelebrating(false), SUCCESS_LINGER_MS);
      return () => clearTimeout(t);
    }
  }, [bothComplete]);

  // Suppress the reminder entirely while the migration prompt (or its success
  // celebration) is on screen. Once a soft prompt is dismissed, `promptVisible`
  // is false and the reminder is free to show (its Stripe task still hidden via
  // `hideStripeTask` below, since the migration is not yet complete).
  const migrationPromptShowing = promptVisible || celebrating;
  const hideStripeTask = enrolledIncomplete;

  return {
    migrationPromptShowing,
    hideStripeTask,
    bothComplete,
    isLoading,
    isError,
    error,
  };
}
