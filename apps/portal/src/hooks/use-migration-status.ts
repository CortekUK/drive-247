"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { SUCCESS_LINGER_MS } from "@/components/migration/constants";

export type MigrationBlockerState = "off" | "soft" | "hard";

/**
 * Read-only twin of `useMigrationBlocker` — same tenant columns, same derived
 * "am I mid-migration?" answer, but WITHOUT the actions or the `?oauth=` return
 * side effect.
 *
 * Why a separate hook rather than reusing `useMigrationBlocker`:
 *   1. `useMigrationBlocker` runs a `?oauth=` effect that fires a toast on the
 *      dashboard root. Mounting it in a second component (the setup-reminder
 *      dialog) would fire that toast twice on a Stripe-connect return.
 *   2. `useMigrationBlocker` is the live driver of the in-progress operator
 *      migration, so it is deliberately left untouched.
 *
 * Both hooks use the SAME React Query key (`["migration-blocker", tenantId]`)
 * and select the SAME columns, so this shares the cache — no extra request, and
 * no risk of a smaller SELECT clobbering the row shape the migration dialog
 * needs. Keep `MIGRATION_COLUMNS` here identical to the one in
 * `use-migration-blocker.ts`.
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

  // Mirror use-migration-blocker.ts EXACTLY — these two derivations run off the
  // SAME shared cache row and MUST agree, or the setup dialog and migration
  // dialog fall out of sync. The migration prompt ALWAYS connects the operator's
  // real (LIVE) account (`own_stripe_account_id`), regardless of stripe_mode; a
  // test-mode rehearsal connection (`own_stripe_test_account_id`) does NOT count
  // as migrated. Deriving this mode-dependently (as an earlier version here did)
  // made this hook report migration "complete" off a test connection — dropping
  // `migrationInProgress` to false — while the migration dialog, correctly keyed
  // on the live account, stayed open, so the setup nudge rendered on top of it.
  // If use-migration-blocker.ts changes this derivation, change it here too.
  const connectedAccountId = data?.own_stripe_account_id;
  const stripeConnected = !!connectedAccountId;
  const paymentConfirmed = data?.subscription_account === "uae";
  const bothComplete = stripeConnected && paymentConfirmed;
  const stored: MigrationBlockerState = (data?.migration_blocker ??
    "off") as MigrationBlockerState;

  // Enrolled in the migration (soft OR hard) and not yet finished both steps.
  // Deliberately NOT keyed off the migration dialog's `state`: a soft blocker
  // dismissed within the last 24h shows `state === "off"` while the migration
  // is still pending, and anything that must wait "until migration is complete"
  // has to stay hidden through that window too.
  const enrolledAndUnfinished =
    !!data && !bothComplete && (stored === "soft" || stored === "hard");

  // ── Success-linger interlock ────────────────────────────────────────────────
  // After BOTH migration steps complete, MigrationBlockerDialog keeps a
  // "You're all set" celebration on screen for SUCCESS_LINGER_MS — a transient
  // that lives only in that component's local state and is invisible to this
  // query. Mirror the exact same window here (same trigger: bothComplete flips
  // true after the tenant was enrolled; same duration) so the setup nudge stays
  // hidden through the celebration instead of flashing in underneath it. This is
  // computed entirely inside the setup dialog's own hook, so there is no
  // cross-component ordering race. It is a superset of the dialog's own trigger
  // (enrolled ⊇ visibly-open), so it can never fail to suppress while the dialog
  // celebrates — at worst it holds the setup nudge back a few extra seconds.
  const wasEnrolledRef = useRef(false);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    if (enrolledAndUnfinished) wasEnrolledRef.current = true;
  }, [enrolledAndUnfinished]);

  useEffect(() => {
    if (bothComplete && wasEnrolledRef.current) {
      wasEnrolledRef.current = false;
      setCelebrating(true);
      const t = setTimeout(() => setCelebrating(false), SUCCESS_LINGER_MS);
      return () => clearTimeout(t);
    }
  }, [bothComplete]);

  const migrationInProgress = enrolledAndUnfinished || celebrating;

  return { migrationInProgress, bothComplete, isLoading, isError, error };
}
