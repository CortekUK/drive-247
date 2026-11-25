"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { useIsLean } from "@/lib/lean-context";
import { isStripeConnectUsable, type StripeConnectTenant } from "@/lib/stripe-connect-status";
import { useOnboardingCall, type OnboardingCallState } from "@/hooks/use-onboarding-call";
import { useFakeQuickTourProfile } from "@/lib/fake-quick-tour";

/**
 * A new company's first steps, as ONE answer for every place that talks about
 * them: the quick tour, the Stripe banner on the home, and the call button
 * beside Help in the top bar.
 *
 *   Stripe   the only thing a company MUST do before a real rental. Read from
 *            the tenant row through `isStripeConnectUsable`, the same rule the
 *            New Rental gate uses. Not through `useRentalCreationGate().blocked`:
 *            that one also turns false once the operator waves the gate away
 *            for a visit, which would make the card say "connected" when it
 *            is not.
 *   The call the free 30-minute onboarding call with Bryan. On offer, booked
 *            (with its time, when the calendar sent one), or not on offer
 *            (done, hidden, not eligible, or this login is not the owner).
 *
 * On a `/fake-quick-tour` run, northwind answers as the pretend new company
 * its profile describes, so every version can be looked at. Nothing about the
 * fake answer is written anywhere.
 *
 * Canary (lean) tenants only; for everyone else both reads stay off.
 */

export type CallStatus = "offer" | "booked" | "none";

export interface FirstSteps {
  /** Both reads have answered (or are off). Callers wait for this. */
  ready: boolean;
  /** This answer is the fake link's pretend company. */
  fake: boolean;
  stripeConnected: boolean;
  call: CallStatus;
  /** "Wednesday, 26 November at 3:00 PM", when the call is booked with a time. */
  callTime: string | null;
  /** The call row as the card reads it; synthesised on a fake run. */
  callState: OnboardingCallState | null;
  /** Writes for the call row. Never used on a fake run. */
  mark: ReturnType<typeof useOnboardingCall>["mark"];
}

export function useFirstSteps({ poll = false }: { poll?: boolean } = {}): FirstSteps {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const lean = useIsLean();
  const fake = useFakeQuickTourProfile();

  const stripe = useQuery({
    queryKey: ["first-steps-stripe", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("stripe_onboarding_complete, stripe_account_status, own_stripe_account_id, own_stripe_test_account_id, payment_provider")
        .eq("id", tenant!.id)
        .single();
      if (error) throw error;
      return data as StripeConnectTenant;
    },
    enabled: !!tenant?.id && lean,
    staleTime: 15_000,
    // Coming back from Stripe's own pages should tick it straight away.
    refetchOnWindowFocus: true,
  });

  const { state, isLoading: callLoading, mark } = useOnboardingCall({ poll, enabled: lean });

  if (fake) {
    const booked = fake.call === "booked";
    // Tomorrow at 3pm: a believable slot for looking at the booked version.
    const when = new Date();
    when.setDate(when.getDate() + 1);
    when.setHours(15, 0, 0, 0);
    const iso = when.toISOString();
    return {
      ready: true,
      fake: true,
      stripeConnected: fake.stripe === "connected",
      call: fake.call,
      callTime: booked ? formatCallTime(iso, tenant?.timezone) : null,
      callState:
        fake.call === "none"
          ? null
          : {
              eligible: true,
              callBookedAt: booked ? new Date().toISOString() : null,
              callScheduledFor: booked ? iso : null,
              callCompletedAt: null,
              sitePreviewedAt: null,
              dismissedAt: null,
              // The real counts, so the checklist still ticks as you work.
              vehicleCount: state?.vehicleCount ?? 0,
              hasLogo: state?.hasLogo ?? false,
            },
      mark,
    };
  }

  // The owner's decision, not every staff login's.
  const isOwner = appUser?.role === "head_admin" || appUser?.role === "admin";
  const onOffer = isOwner && !!state && state.eligible && !state.dismissedAt && !state.callCompletedAt;
  const call: CallStatus = !onOffer ? "none" : state!.callBookedAt ? "booked" : "offer";

  return {
    ready: !lean || (!stripe.isLoading && !callLoading),
    fake: false,
    // Unknown counts as connected: never nag about Stripe on a failed read.
    // A Square company takes payments through Square, so "connect Stripe" is
    // never a step for it (Rentalkingdom, 2026-11-26).
    stripeConnected: stripe.data
      ? (stripe.data as StripeConnectTenant).payment_provider === "square" || isStripeConnectUsable(stripe.data)
      : true,
    call,
    callTime: call === "booked" && state?.callScheduledFor ? formatCallTime(state.callScheduledFor, tenant?.timezone) : null,
    callState: onOffer ? state : null,
    mark,
  };
}

/** "Wednesday, 26 November at 3:00 PM" in the tenant's timezone, else the browser's. */
export function formatCallTime(iso: string, timeZone: string | null | undefined): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  };
  try {
    return new Date(iso).toLocaleString(undefined, timeZone ? { ...options, timeZone } : options);
  } catch {
    // An unknown timezone name throws; fall back to the browser's own.
    return new Date(iso).toLocaleString(undefined, options);
  }
}

/** Ask the top bar's call button to open Bryan's calendar (the tour's last card does). */
export const OPEN_ONBOARDING_CALL_EVENT = "d247:open-onboarding-call";

export function openOnboardingCall(): void {
  window.dispatchEvent(new Event(OPEN_ONBOARDING_CALL_EVENT));
}

/** Where "Connect Stripe" goes: the Integrations board, Stripe's panel open. */
export const CONNECT_STRIPE_HREF = "/integrations?open=Stripe%20Connect";
