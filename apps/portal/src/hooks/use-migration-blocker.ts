"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";

export type MigrationBlockerState = "off" | "soft" | "hard";

/**
 * The tenant columns that drive the operator migration prompt. None of these
 * live on TenantContext (which only selects ~40 admin fields), so they are
 * fetched here with a small tenant-scoped query.
 */
interface MigrationBlockerRow {
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

const DISMISS_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Drives the operator-facing "move to your own Stripe account" prompt.
 *
 * Two tasks are DERIVED (never stored):
 *   1. Stripe connected     — the tenant has an own-Stripe account for the mode
 *                             they are currently operating in.
 *   2. Payment confirmed    — their platform subscription is billed on the UAE
 *                             account (`subscription_account === 'uae'`).
 *
 * Once both are true the prompt auto-hides regardless of the stored
 * `migration_blocker` value, so an operator is never stuck staring at a hard
 * block they have already satisfied.
 */
export function useMigrationBlocker() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const queryKey = ["migration-blocker", tenantId] as const;

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey,
    queryFn: async (): Promise<MigrationBlockerRow | null> => {
      const { data, error } = await supabaseUntyped
        .from("tenants")
        .select(MIGRATION_COLUMNS)
        .eq("id", tenantId!)
        .single();
      if (error) throw error;
      return (data ?? null) as MigrationBlockerRow | null;
    },
    enabled: !!tenantId,
    retry: 1,
  });

  // ── Derived task state ────────────────────────────────────────────────────
  const mode = data?.stripe_mode ?? "test";
  const connectedAccountId =
    mode === "test" ? data?.own_stripe_test_account_id : data?.own_stripe_account_id;
  const stripeConnected = !!connectedAccountId;
  const paymentConfirmed = data?.subscription_account === "uae";
  const bothComplete = stripeConnected && paymentConfirmed;

  const dismissedAt = data?.migration_blocker_dismissed_at
    ? new Date(data.migration_blocker_dismissed_at).getTime()
    : null;
  const dismissedRecently =
    dismissedAt !== null && Date.now() - dismissedAt < DISMISS_WINDOW_MS;

  const stored: MigrationBlockerState = (data?.migration_blocker ??
    "off") as MigrationBlockerState;

  let state: MigrationBlockerState = "off";
  if (data && !bothComplete) {
    if (stored === "hard") state = "hard";
    else if (stored === "soft") state = dismissedRecently ? "off" : "soft";
  }

  // ── OAuth return handling (?oauth=ok|error) ───────────────────────────────
  // Mirrors `own-stripe-settings.tsx`. That component only mounts on the
  // settings page; this hook mounts in the dashboard layout, so on the settings
  // page both would fire. Only the settings page carries `?oauth` on a
  // `returnTo: 'settings'` round-trip — the blocker sends `returnTo: 'portal'`,
  // which returns to the dashboard root — so in practice they never collide.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname.startsWith("/settings")) return;

    const params = new URLSearchParams(window.location.search);
    const result = params.get("oauth");
    if (!result) return;

    if (result === "ok") {
      toast({
        title: "Stripe connected",
        description:
          "Your Stripe account is now linked. You can accept payments.",
      });
    } else if (result === "error") {
      toast({
        title: "Stripe connection failed",
        description: "The authorization was not completed. Please try again.",
        variant: "destructive",
      });
    }

    params.delete("oauth");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}`,
    );
    queryClient.invalidateQueries({ queryKey: ["migration-blocker"] });
    queryClient.invalidateQueries({ queryKey: ["own-stripe-status"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────
  // Both of these end in a full-page redirect, so the pending flag is latched
  // rather than reset — the button must keep spinning until the browser leaves.
  const [connectingStripe, setConnectingStripe] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  const connectStripe = useCallback(async () => {
    if (!data?.id) return;
    setConnectingStripe(true);
    try {
      const { data: res, error } = await supabase.functions.invoke(
        "stripe-oauth-start",
        {
          body: {
            tenantId: data.id,
            mode,
            returnTo: "portal",
            origin: window.location.origin,
          },
        },
      );
      if (error) throw error;
      if (!res?.url)
        throw new Error(res?.error || "Could not create the connection link");
      window.location.href = res.url;
    } catch (e) {
      toast({
        title: "Could not start Stripe connection",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
      setConnectingStripe(false);
    }
  }, [data?.id, mode]);

  const confirmPayment = useCallback(async () => {
    setConfirmingPayment(true);
    try {
      // Always send the tenant explicitly: a SUPER ADMIN viewing a tenant's
      // portal has app_users.tenant_id = NULL, so the function cannot infer it
      // (it only derives the tenant for non-super-admin self-serve callers).
      // For a normal operator the function still validates this against their
      // own tenant, so passing it changes nothing security-wise.
      const { data: res, error } = await supabase.functions.invoke(
        "create-uae-subscription-capture",
        { body: { tenantId: data?.id } },
      );
      if (error) throw error;
      if (!res?.url)
        throw new Error(res?.error || "Could not create the payment link");
      window.location.href = res.url;
    } catch (e) {
      toast({
        title: "Could not open payment details",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
      setConfirmingPayment(false);
    }
  }, [data?.id]);

  const dismissMutation = useMutation({
    mutationFn: async () => {
      const { data: res, error } = await supabase.functions.invoke(
        "migration-blocker-dismiss",
        // tenantId is only honoured for super admins (who have no tenant_id of
        // their own); for a normal operator the function ignores it and uses
        // their own tenant.
        { body: { tenantId: data?.id } },
      );
      if (error) throw error;
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["migration-blocker"] });
    },
    onError: (e) => {
      toast({
        title: "Could not dismiss",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const dismiss = useCallback(() => {
    dismissMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissMutation.mutate]);

  return {
    state,
    stripeConnected,
    paymentConfirmed,
    bothComplete,
    connectedAccountId: connectedAccountId ?? null,
    stripeMode: mode,
    connectStripe,
    confirmPayment,
    dismiss,
    connectingStripe,
    confirmingPayment,
    dismissing: dismissMutation.isPending,
    isLoading,
    isError,
    error,
  };
}
