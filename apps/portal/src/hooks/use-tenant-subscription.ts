import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";
import { toast } from "sonner";

export interface TenantSubscription {
  id: string;
  tenant_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  status: string;
  plan_name: string;
  amount: number;
  currency: string;
  interval: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  trial_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantSubscriptionInvoice {
  id: string;
  tenant_id: string;
  subscription_id: string | null;
  stripe_invoice_id: string;
  stripe_invoice_pdf: string | null;
  stripe_hosted_invoice_url: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  paid_at: string | null;
  invoice_number: string | null;
  base_amount: number | null;
  usage_amount: number | null;
  usage_quantity: number | null;
  created_at: string;
  updated_at: string;
}

export function useTenantSubscription() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  // See the long note in use-subscription-plans.ts. `tenant` resolves before
  // anyone is signed in (TenantProvider sits above AuthInitializer and `tenants`
  // is anon-readable), so gating only on `!!tenant` let these three billing
  // queries run with the anon key. RLS filters instead of erroring, so the
  // signed-out answer ("no subscription") was cached as a success and reused
  // after login — the same class of bug that hid the paywall. The user id is
  // appended to each key so one identity's billing state is never served to
  // another; it goes last so the prefix invalidations in `refetch()` below and
  // in use-tenant-subscription-realtime.ts keep matching.
  const { session, user } = useAuth();
  const authed = !!tenant && !!session;
  const userKey = user?.id ?? "anon";

  const subscriptionQuery = useQuery({
    queryKey: ["tenant-subscription", tenant?.id, userKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_subscriptions")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .in("status", ["active", "trialing", "past_due"])
        .maybeSingle();

      if (error) throw error;
      return data as TenantSubscription | null;
    },
    enabled: authed,
    staleTime: 30_000,
    retry: false,
    // Grace expiry is a pure CLOCK event — no row changes when the window
    // closes, so Realtime never fires and nothing would re-render. Without a
    // poll, a tab left open across the boundary keeps showing a stale day count
    // AND keeps full dashboard access indefinitely. One minute is well inside
    // the smallest meaningful unit here (a day).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const invoicesQuery = useQuery({
    queryKey: ["tenant-subscription-invoices", tenant?.id, userKey],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_subscription_invoices")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as TenantSubscriptionInvoice[];
    },
    enabled: authed,
    staleTime: 30_000,
    retry: false,
    // The grace clock is anchored on the OLDEST OPEN INVOICE, so this query is
    // not just display data — it decides whether the tenant is warned or blocked.
    // There is no Realtime channel on tenant_subscription_invoices, and "Pay now"
    // opens Stripe in a NEW TAB, so the dashboard tab stays mounted and
    // unfocused while the payment happens (refetchOnWindowFocus is off
    // globally). Without this the tenant pays, comes back, and still sees the
    // dunning banner and an "open" invoice until a hard reload. Matches the
    // subscription query's cadence so the two cannot disagree for long.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Check for past subscriptions (expired trials / canceled)
  const pastSubscriptionQuery = useQuery({
    queryKey: ["tenant-past-subscription", tenant?.id, userKey],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("tenant_subscriptions")
        .select("id, status, trial_end, ended_at, canceled_at")
        .eq("tenant_id", tenant!.id)
        .in("status", ["canceled", "incomplete_expired", "unpaid"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: authed && !subscriptionQuery.data,
    staleTime: 60_000,
    // The dashboard gate blocks on this query resolving — don't sit through
    // three exponential-backoff retries before the paywall can render.
    retry: false,
  });

  const createCheckoutSession = useMutation({
    mutationFn: async ({
      planId,
      successUrl,
      cancelUrl,
    }: {
      planId: string;
      successUrl: string;
      cancelUrl: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "create-subscription-checkout",
        {
          body: {
            tenantId: tenant!.id,
            planId,
            successUrl,
            cancelUrl,
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { sessionId: string; url: string };
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create checkout session");
    },
  });

  const createPortalSession = useMutation({
    mutationFn: async ({ returnUrl }: { returnUrl: string }) => {
      const { data, error } = await supabase.functions.invoke(
        "create-subscription-portal-session",
        {
          body: {
            tenantId: tenant!.id,
            returnUrl,
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { url: string };
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to open billing portal");
    },
  });

  // Deliberately invalidated by BARE prefix, with no tenant id.
  //
  // `refetch` is recreated every render and closes over `tenant?.id`. The
  // post-Stripe-checkout poll on /subscription captures it ONCE (its effect deps
  // are [searchParams], which is identity-stable for a fixed URL) and then calls
  // that same closure every 2s for 15s. /subscription is exempt from the layout's
  // gate hold, so the page can mount while `tenant` is still null — in which case
  // the captured closure invalidates ["tenant-subscription", undefined], and
  // TanStack's partialMatchKey fails at index 1, matching NOTHING. The poll then
  // silently refetches nothing and the freshly-paid tenant keeps seeing the
  // paywall until they reload — the same "only a refresh fixes it" complaint.
  // A bare prefix matches regardless of tenant/user suffix, and the portal only
  // ever holds one tenant per session, so there is nothing else to over-match.
  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ["tenant-subscription"] });
    queryClient.invalidateQueries({ queryKey: ["tenant-subscription-invoices"] });
  };

  // ── Dunning / grace period ────────────────────────────────────────────────
  // A declined card must NOT lock an operator out of their business on day one.
  // Stripe moves the subscription to `past_due` and keeps retrying; we give the
  // tenant 7 days to fix it, warning with escalating urgency, and only hard-block
  // once that window closes.
  //
  // ANCHOR: the oldest still-open invoice, NOT current_period_end. When a charge
  // fails Stripe still rolls current_period_end forward to the next cycle, so
  // anchoring on it would put the deadline a month in the future and the block
  // would never fire. The unpaid invoice is the thing that is actually overdue.
  const GRACE_DAYS = 7;
  const isPastDue = subscriptionQuery.data?.status === "past_due";

  const openInvoice = (() => {
    const rows = invoicesQuery.data || [];
    const unpaid = rows.filter(
      (i) => i.status === "open" || i.status === "uncollectible"
    );
    if (unpaid.length === 0) return null;
    // Oldest unpaid — that is the one whose clock started first.
    return unpaid.reduce((a, b) =>
      new Date(a.created_at).getTime() <= new Date(b.created_at).getTime() ? a : b
    );
  })();

  const graceStartedAt = (() => {
    if (!isPastDue) return null;
    const anchor =
      openInvoice?.period_end || openInvoice?.created_at || subscriptionQuery.data?.current_period_start;
    if (!anchor) return null;
    const t = new Date(anchor).getTime();
    return Number.isNaN(t) ? null : t;
  })();

  const graceEndsAt =
    graceStartedAt != null ? graceStartedAt + GRACE_DAYS * 86_400_000 : null;

  /** Whole days left in the window; 0 on the final day. Never negative. */
  const graceDaysRemaining =
    graceEndsAt != null
      ? Math.max(0, Math.ceil((graceEndsAt - Date.now()) / 86_400_000))
      : 0;

  /** Inside the 7 days — warn, do not block. */
  const isInGracePeriod = isPastDue && graceEndsAt != null && Date.now() < graceEndsAt;

  /**
   * Past the window — hard block. Fails SAFE: if we cannot establish an anchor
   * (graceEndsAt null, e.g. the invoice never synced) we treat the tenant as
   * still in grace rather than locking them out on missing data.
   */
  const isGraceExpired = isPastDue && graceEndsAt != null && Date.now() >= graceEndsAt;

  /** Escalate the warning's urgency over the window. */
  const graceSeverity: "none" | "warning" | "critical" = !isInGracePeriod
    ? "none"
    : graceDaysRemaining <= 3
      ? "critical"
      : "warning";

  /** Where to actually pay the outstanding invoice (not a new checkout). */
  const outstandingInvoiceUrl =
    openInvoice?.stripe_hosted_invoice_url || openInvoice?.stripe_invoice_pdf || null;

  // A tenant inside the grace window keeps full access — they are still a
  // customer with a payment problem, not a stranger who must "finish setup".
  const isSubscribed =
    subscriptionQuery.data?.status === "active" ||
    subscriptionQuery.data?.status === "trialing" ||
    isInGracePeriod ||
    // Fail-open: past_due with no resolvable anchor must not lock anyone out.
    (isPastDue && graceEndsAt == null);

  // Tenant had a subscription that's no longer active (expired trial or canceled),
  // or blew through the grace window on an unpaid invoice.
  const hasExpiredSubscription =
    (!isSubscribed && !!pastSubscriptionQuery.data) || isGraceExpired;

  // A trial whose end date has already passed is NOT actively trialing — the
  // subscription has (or should have) converted to active. Guard against a
  // stale `status = 'trialing'` row left behind by a missed Stripe webhook so
  // we never render a nonsensical "Trial · 0 days left". isSubscribed already
  // covers the "trialing" status, so portal access is preserved regardless.
  const trialEndMs = subscriptionQuery.data?.trial_end
    ? new Date(subscriptionQuery.data.trial_end).getTime()
    : null;
  const trialExpired =
    subscriptionQuery.data?.status === "trialing" &&
    trialEndMs != null &&
    trialEndMs <= Date.now();

  // A tenant that already completed setup / went live is NOT a "new signup in
  // trial". During the UK→UAE migration the new UAE subscription is created with
  // a future trial_end (to defer the first charge to the UK period end), so it
  // sits at status='trialing' for weeks even though the operator has been live
  // for a long time. Treating that as an active trial wrongly re-triggers the
  // Setup Mode UI. setup_completed_at is only ever set once a tenant goes live,
  // so it reliably distinguishes a migrated live operator from a genuine trial.
  const tenantAlreadyLive = !!tenant?.setup_completed_at;

  const isTrialing =
    subscriptionQuery.data?.status === "trialing" && !trialExpired && !tenantAlreadyLive;

  const trialDaysRemaining = (() => {
    if (!isTrialing || !subscriptionQuery.data?.trial_end) return 0;
    const now = new Date();
    const trialEnd = new Date(subscriptionQuery.data.trial_end);
    const diff = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  })();

  // Only consider "loading" when actually fetching, not when errored
  const isLoading = subscriptionQuery.isLoading && !subscriptionQuery.isError;

  // True once the subscription query has actually resolved at least once
  // (even with null data). Use this for gate decisions instead of !isLoading,
  // because isLoading is also false while the query is disabled (no tenant yet).
  //
  // The past-subscription query only runs when there is no active subscription
  // (see `enabled` above), so it only has to be waited on in that case — a
  // tenant WITH an active subscription is resolved the moment the main query
  // settles, even though the past query sits at `pending` (disabled) forever.
  // `pastSubscriptionNeeded` is therefore gated on the main query having
  // settled: while it is still in flight `data` is `undefined`, which must not
  // be read as "no subscription, go wait on the past query".
  const subscriptionSettled =
    subscriptionQuery.isSuccess || subscriptionQuery.isError;
  const pastSubscriptionNeeded = subscriptionSettled && !subscriptionQuery.data;
  const pastSubscriptionSettled =
    pastSubscriptionQuery.isSuccess || pastSubscriptionQuery.isError;
  // The grace decision is driven by the OPEN INVOICE, which lives in the
  // invoices query. Resolving before it lands makes the blocker render its
  // "contact support" fallback instead of the working Pay button, purely
  // because the URL had not arrived yet. So when the tenant is past_due, wait
  // for invoices too.
  const invoicesSettled = invoicesQuery.isSuccess || invoicesQuery.isError;

  const isResolved =
    authed &&
    subscriptionSettled &&
    (!pastSubscriptionNeeded || pastSubscriptionSettled) &&
    (!isPastDue || invoicesSettled);

  return {
    subscription: subscriptionQuery.data,
    isSubscribed,
    hasExpiredSubscription,
    isTrialing,
    trialDaysRemaining,
    // Dunning / grace
    isPastDue,
    isInGracePeriod,
    isGraceExpired,
    graceDaysRemaining,
    graceSeverity,
    graceEndsAt,
    openInvoice,
    outstandingInvoiceUrl,
    isLoading,
    isResolved,
    invoices: invoicesQuery.data || [],
    invoicesLoading: invoicesQuery.isLoading,
    createCheckoutSession,
    createPortalSession,
    refetch,
  };
}
