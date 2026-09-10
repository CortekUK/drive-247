/**
 * useConnectStripeBanner — the "you're in test mode, connect your Stripe" notice.
 *
 * WHY IT EXISTS
 * -------------
 * A tenant running in Stripe TEST mode with NO connected live account
 * (`own_stripe_account_id` is null) cannot take a single real card payment,
 * place a real deposit hold, or auto-charge anyone — every Stripe action is a
 * sandbox no-op. Several live operators were found using the platform daily in
 * exactly this state (collecting off-platform via cash/Zelle instead), one
 * missed toggle away from silently failing the moment they leaned on Stripe.
 *
 * This surfaces a top-of-app banner that stays until they connect. The
 * "Connect Stripe" action starts the OAuth flow via `stripe-oauth-start`, which
 * is hardwired to the UAE (CORTEKIA) platform OAuth client — so connecting
 * always lands their account on UAE, never the legacy UK platform.
 *
 * NON-DISMISSIBLE BY DESIGN
 * -------------------------
 * No `dismissal` is set, so the stack renders no close control (see
 * banner-types: "Omit entirely => NOT dismissible"). The operator cannot cross
 * it away — the point is that they connect. It auto-hides the instant an
 * `own_stripe_account_id` exists, and on `/settings` where the connect action
 * already lives.
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import type { AppBanner } from "../banner-types";

interface StripeModeRow {
  id: string;
  stripe_mode: "test" | "live" | null;
  own_stripe_account_id: string | null;
}

export function useConnectStripeBanner(): AppBanner[] {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [connecting, setConnecting] = useState(false);

  // Neither field lives on TenantContext (it selects a small admin subset), so
  // fetch them with a tiny tenant-scoped query, mirroring use-migration-blocker.
  const { data } = useQuery({
    queryKey: ["connect-stripe-banner", tenantId],
    queryFn: async (): Promise<StripeModeRow | null> => {
      const { data, error } = await supabaseUntyped
        .from("tenants")
        .select("id, stripe_mode, own_stripe_account_id")
        .eq("id", tenantId!)
        .single();
      if (error) throw error;
      return (data ?? null) as StripeModeRow | null;
    },
    enabled: !!tenantId,
    staleTime: 60_000,
  });

  // Always redirect the operator to Stripe's OAuth authorize page. The link is
  // single-use and short-lived, so it is minted on click rather than up front.
  const connect = useCallback(async () => {
    if (!data?.id || connecting) return;
    setConnecting(true);
    try {
      const { data: res, error } = await supabase.functions.invoke(
        "stripe-oauth-start",
        {
          body: {
            tenantId: data.id,
            // The migration always connects the operator's real (live) account
            // on UAE — stripe-oauth-start uses STRIPE_UAE_OAUTH_CLIENT_ID_LIVE.
            mode: "live",
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
      setConnecting(false);
    }
  }, [data?.id, connecting]);

  return useMemo(() => {
    const inTestMode = data?.stripe_mode === "test";
    const notConnected = !data?.own_stripe_account_id;
    if (!inTestMode || !notConnected) return [];

    return [
      {
        id: "connect-stripe-test-mode",
        severity: "critical",
        scope: "app",
        // The connect action already lives in settings; don't shout there.
        hideOnPathPrefix: ["/settings"],
        title: (
          <>
            <span className="font-medium">Your account is in test mode.</span>{" "}
            <span>
              Real customer payments aren&apos;t being collected. Connect your
              Stripe account to start taking live payments.
            </span>
          </>
        ),
        plainTitle:
          "Your account is in test mode. Connect your Stripe account to start taking live payments.",
        action: {
          label: connecting ? "Connecting…" : "Connect Stripe",
          onClick: connect,
          busy: connecting,
        },
        // No `dismissal` => the operator cannot close it until they connect.
      },
    ];
  }, [data?.stripe_mode, data?.own_stripe_account_id, connecting, connect]);
}
