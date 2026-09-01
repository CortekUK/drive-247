"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { useTenantSubscriptionRealtime } from "@/hooks/use-tenant-subscription-realtime";
import { useSessionGuard } from "@/hooks/use-session-guard";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useSubscriptionGateDisabled } from "@/hooks/use-subscription-gate-disabled";
import { SubscriptionGateDialog } from "@/components/subscription/subscription-gate-dialog";
import { SubscriptionActivatedDialog } from "@/components/subscription/subscription-activated-dialog";
import { SetupReminderDialog } from "@/components/dashboard/setup-reminder-dialog";
import { MigrationBlockerDialog } from "@/components/migration/migration-blocker-dialog";
import { TenantSuspendedScreen } from "@/components/tenant/tenant-suspended-screen";
import { ThemeToggle } from "@/components/shared/layout/theme-toggle";
import { HeaderSearch } from "@/components/shared/layout/header-search";
import { UserMenu } from "@/components/shared/layout/user-menu";
import { AppSidebar } from "@/components/shared/layout/app-sidebar";
import { NotificationBell } from "@/components/shared/layout/notification-bell";
import { CreditBalance } from "@/components/shared/layout/credit-balance";
import { BonzahBalance } from "@/components/shared/layout/bonzah-balance";
import { DynamicThemeProvider } from "@/components/shared/layout/dynamic-theme-provider";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { MaintenanceBanner } from "@/components/dashboard/maintenance-banner";
import { AppBannerStack } from "@/components/banners/app-banner-stack";
import { GlobalVoiceCallProvider } from "@/components/voice/global-voice-call-provider";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { FeedbackForcePrompt } from "@/components/feedback/feedback-force-prompt";

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-16 items-center justify-between px-6 border-b">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <div className="p-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border p-6">
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="rounded-lg border p-6">
              <Skeleton className="h-6 w-32 mb-4" />
              <div className="space-y-2">
                {[...Array(5)].map((_, j) => (
                  <Skeleton key={j} className="h-4 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, appUser, loading, profileUnavailable, refetchAppUser, signOut } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const {
    isSubscribed,
    hasExpiredSubscription,
    isGraceExpired,
    owesOutstandingInvoice,
    isResolved: subscriptionResolved,
  } = useTenantSubscription();
  const { isManager, canAccessRoute, isLoading: permissionsLoading } = useManagerPermissions();
  const {
    data: plans,
    isSuccess: plansSuccess,
    isError: plansErrored,
  } = useSubscriptionPlans();

  // Global super-admin kill-switch: when on, never show the subscription
  // blocker to any tenant (everything else stays as-is).
  const subscriptionGateDisabled = useSubscriptionGateDisabled();

  // Keep subscription state fresh via Supabase realtime — webhook updates
  // invalidate the query immediately instead of waiting for a refresh.
  useTenantSubscriptionRealtime();

  // Bulletproof force-logout: sign the operator out the instant a super admin
  // revokes their session — immediately via realtime broadcast, and on tab
  // focus / reopen via a server-authoritative session check.
  useSessionGuard();

  // Pages where the user MUST be able to reach even without a subscription —
  // otherwise they'd have no way to subscribe or contact us.
  const isSubscriptionPage =
    pathname === "/subscription" ||
    pathname === "/credits" ||
    pathname?.startsWith("/settings");

  const hasActivePlans = !!plans && plans.length > 0;

  // Every reason the blocker must stay hidden, in one place.
  //
  // Deliberately NO super-admin bypass. An earlier version exempted super
  // admins so support could inspect a tenant's portal, but that made the
  // paywall invisible from the exact account staff test with — it repeatedly
  // read as "the paywall is broken" when the tenant was simply unpaid. The
  // gate must look identical for everyone. When staff genuinely need to get
  // inside an unpaid tenant, use the per-tenant "Hide subscription blocker"
  // toggle in the admin panel (tenants.subscription_gate_disabled), which is
  // explicit, auditable and scoped to one tenant.
  const gateSuppressed =
    subscriptionGateDisabled || tenant?.subscription_gate_disabled === true;

  // A query that errored IS resolved — we are never getting an answer by
  // waiting longer. Keying off `isSuccess` alone wedged this flag at `false`
  // forever whenever the plans query failed, which silently disabled the
  // paywall (and the expired-subscription blocker, which doesn't even depend
  // on plans) for the rest of the session.
  const plansResolved = plansSuccess || plansErrored;

  // Plans only ever decide the never-subscribed "Finish Setup" gate. A tenant
  // with an active subscription is never blocked, and an expired one is always
  // blocked — in both cases the plans query is irrelevant, so don't make the
  // first paint wait on a second round-trip that cannot change the outcome.
  const plansNeededForGate = !isSubscribed && !hasExpiredSubscription;

  const gateStateKnown =
    !!tenant &&
    !tenantLoading &&
    subscriptionResolved &&
    (!plansNeededForGate || plansResolved);

  // Expired/canceled subscription — same hard modal, different copy.
  const showExpiredGate =
    gateStateKnown && hasExpiredSubscription && !isSubscriptionPage;

  // Never-subscribed — Finish Setup modal. We gate when the tenant either has a
  // plan to buy OR when we could not load their plans at all: an errored plans
  // query means "unknown", and treating unknown as "nothing to sell" left the
  // paywall bypassable by blocking a single request (or by a transient 5xx).
  // Only a plans query that genuinely SUCCEEDED with zero rows leaves a tenant
  // un-gated, so an operator with no plan configured is never locked out of a
  // product they cannot buy. With no plans loaded the dialog falls back to its
  // contact-support copy, and the sign-out escape still applies.
  const showSetupGate =
    gateStateKnown &&
    !isSubscribed &&
    !hasExpiredSubscription &&
    (hasActivePlans || plansErrored) &&
    !isSubscriptionPage;

  const gateOpen = (showSetupGate || showExpiredGate) && !gateSuppressed;

  // A latched gate with nothing left to sell is a dead end: if a super admin
  // deactivates the tenant's last plan, there is no longer anything the tenant
  // could buy to clear it. Release the latch in that case — `gateOpen` still
  // wins below, so an expired subscription (which blocks regardless of plans)
  // keeps its modal.
  //
  // Deliberately `plansSuccess`, not `plansResolved`: an errored plans query
  // means "unknown", which must stay gated rather than unlatch the paywall.
  // NOTE: nothing invalidates or refetches the plans query mid-session, so in
  // practice this releases on the tenant's next page load, not live.
  const nothingToBuy = plansSuccess && !hasActivePlans;

  // Once a session has been blocked it stays blocked until the tenant
  // actually subscribes. Without this latch a background refetch that
  // momentarily flips a query back to `pending` (or a realtime invalidation)
  // would drop `gateStateKnown` and hand the dashboard back mid-session.
  const [gateLatched, setGateLatched] = useState(false);
  useEffect(() => {
    if (gateOpen) setGateLatched(true);
    else if (isSubscribed || gateSuppressed || nothingToBuy)
      setGateLatched(false);
  }, [gateOpen, isSubscribed, gateSuppressed, nothingToBuy]);

  const showGate =
    !gateSuppressed && !isSubscriptionPage && (gateOpen || gateLatched);

  // Has this session ever rendered the dashboard with a *trustworthy* gate
  // decision? Only the very first paint may be held back; after that the page
  // stays mounted no matter what the billing queries do. A webhook flipping an
  // active subscription to null mid-session momentarily returns the gate state
  // to "unknown", and swapping the whole dashboard for a skeleton at that
  // point destroys unsaved form state — the modal goes over the live page
  // instead (via `gateOpen` / `gateLatched`, which don't unmount anything).
  const authReady = !loading && !!user && !!appUser?.is_active;
  const [hasPaintedOnce, setHasPaintedOnce] = useState(false);
  useEffect(() => {
    // `gateStateKnown` implies the hold below is false, i.e. this render did
    // paint the real dashboard rather than the skeleton.
    if (!hasPaintedOnce && authReady && gateStateKnown) setHasPaintedOnce(true);
  }, [hasPaintedOnce, authReady, gateStateKnown]);

  // Fail-CLOSED first paint. Previously the dashboard rendered fully
  // interactive while the billing queries were still in flight (and forever
  // if one of them errored), because every gate condition was ANDed with
  // `gateStateKnown`. Hold the skeleton instead until we actually know.
  // Applies while the tenant is still loading AND once it has resolved, so the
  // dashboard never paints ungated in the window before TenantContext lands
  // (which also removed a dashboard -> skeleton -> dashboard flash). If tenant
  // lookup itself FAILED (null, not loading) we deliberately do not hold, since
  // there is nothing to gate on and holding would strand the user forever.
  // Only until the first known-good paint (see `hasPaintedOnce`). The queries
  // it waits on are all capped at retry <= 1, so an outage settles the hold in
  // one round-trip instead of hanging the skeleton on exponential backoff.
  const holdForGateState =
    !hasPaintedOnce &&
    !gateSuppressed &&
    !isSubscriptionPage &&
    (!!tenant || tenantLoading) &&
    !gateStateKnown;

  useEffect(() => {
    if (!loading) {
      // Signed out — go to login.
      if (!user) {
        router.replace(`/login?from=${encodeURIComponent(pathname)}`);
        return;
      }

      // Session is valid but the profile could not be LOADED (network/server
      // blip). Do NOT redirect: the login page would see the valid session and
      // send us straight back, producing an endless dashboard<->login bounce
      // that no amount of retrying by the user escapes. Show a retry screen.
      if (!appUser && profileUnavailable) {
        return;
      }

      // Valid session, and the profile genuinely does not exist.
      if (!appUser) {
        router.replace(`/login?from=${encodeURIComponent(pathname)}`);
        return;
      }

      // Account deactivated - redirect to login
      if (!appUser.is_active) {
        router.replace("/login");
        return;
      }
    }
  }, [user, appUser, profileUnavailable, loading, router, pathname]);

  // Self-heal a stale profile. When the lookup fails but we still hold a
  // profile, the dashboard keeps rendering with the pinned copy — deliberately,
  // so a blip doesn't eject anyone — but the retry button lives on the
  // no-profile screen and is unreachable from here. Re-check quietly until it
  // succeeds, so role/active changes can't stay stale indefinitely.
  useEffect(() => {
    if (!profileUnavailable || !user) return;
    const id = setInterval(() => { void refetchAppUser(); }, 60_000);
    return () => clearInterval(id);
  }, [profileUnavailable, user, refetchAppUser]);

  // Manager route protection
  useEffect(() => {
    if (!loading && !permissionsLoading && isManager && !canAccessRoute(pathname)) {
      router.replace('/');
    }
  }, [loading, permissionsLoading, isManager, canAccessRoute, pathname, router]);

  // Show loading skeleton while checking auth
  if (loading) {
    return <LoadingSkeleton />;
  }

  // Signed in, but we could not load the profile. Offer a way out instead of
  // silently bouncing to login (which used to loop forever).
  if (user && !appUser && profileUnavailable) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 text-center space-y-4">
          <h2 className="text-lg font-semibold">We couldn&apos;t load your account</h2>
          <p className="text-sm text-muted-foreground">
            You&apos;re signed in, but we couldn&apos;t reach the server to load your
            profile. This is usually a temporary connection problem.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
            <Button onClick={() => refetchAppUser()}>Try again</Button>
            <Button variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated - show nothing while redirecting
  if (!user || !appUser || !appUser.is_active) {
    return <LoadingSkeleton />;
  }

  // Billing state not yet known — do not paint an unprotected dashboard.
  if (holdForGateState) {
    return <LoadingSkeleton />;
  }

  // Suspended tenants are frozen: no dashboard, no way past this screen. Only a
  // Drive247 super admin flipping status back to 'active' restores access.
  if (tenant?.status === "suspended") {
    return <TenantSuspendedScreen />;
  }

  return (
    <DynamicThemeProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="overflow-x-hidden">
          <header className="flex h-16 shrink-0 items-center gap-1 sm:gap-2 border-b px-2 sm:px-4">
            <SidebarTrigger className="-ml-1 flex-shrink-0" />
            <div className="min-w-0 w-auto sm:w-56 lg:w-64 shrink-0 sm:shrink">
              <HeaderSearch />
            </div>
            <div className="ml-auto flex items-center gap-0.5 sm:gap-2 flex-shrink-0">
              <div className="hidden min-[420px]:flex items-center gap-1 sm:gap-2">
                <BonzahBalance />
                <CreditBalance />
              </div>
              <NotificationBell />
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <MaintenanceBanner />
          {/*
            Deposit-hold alerts, and the mount point every future banner should
            move into. Kept BELOW the two legacy bars rather than replacing them:
            those render themselves and manage their own visibility, so folding
            them in is a separate migration. The stack emits at most one deposit
            banner (plus a compact chip row), so this cannot become a wall.
          */}
          <AppBannerStack scope="app" />

          <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
            {children}
          </main>
        </SidebarInset>

        {/* Global voice call — always listening for inbound calls */}
        <GlobalVoiceCallProvider />

        {/* Confirms a subscription that was paid OUTSIDE the portal — a sales
            link. Purely reassurance: dismissible, blocks nothing, and renders
            only when a live subscription exists, which is exactly when the gate
            below does not. */}
        <SubscriptionActivatedDialog />

        {/* Hard gate modal. Same component for both states — different copy
            via `variant`. Dialog stays mounted; visibility is driven by
            `open` so we avoid Radix mount/unmount races that previously
            caused the modal to fail to appear without a page refresh. */}
        <SubscriptionGateDialog
          open={showGate}
          variant={
            // Money still owed wins over "your subscription ended", whichever
            // way the subscription got here. Stripe's default at the end of
            // dunning is to CANCEL, which moves the row off past_due — so a
            // debtor stopped matching isGraceExpired and was shown the
            // "expired" gate: pricing cards inviting them to subscribe again,
            // with no mention of the invoice they still owe and no way to pay
            // it. The past_due variant is the one carrying the pay link.
            isGraceExpired || (hasExpiredSubscription && owesOutstandingInvoice)
              ? "past_due"
              : hasExpiredSubscription
                ? "expired"
                : "setup"
          }
        />

        {/* Recurring post-subscription nudge for outstanding setup tasks.
            Self-gates on `isSubscribed`, so it never shows while the hard
            paywall above is up. */}
        <SetupReminderDialog />

        {/* Stripe migration prompt — soft reminder or hard full-screen block,
            driven entirely by `tenants.migration_blocker` + the two derived
            operator tasks. Self-gates (renders nothing when `state === 'off'`)
            and auto-hides the moment both tasks are complete. Mounted last so
            it sits above the dashboard; the subscription paywall above still
            renders on top when both happen to be up. */}
        <MigrationBlockerDialog />

        {/* Staff feedback channel. The dialog is mounted once here and driven
            from three places (sidebar button, rental-completion follow-up,
            forced prompt) via `useFeedbackStore`. The force prompt is
            suppressed while the paywall owns the screen — a dismissible
            feedback modal stacked on a non-dismissible one leaves the operator
            unable to act on either. */}
        <FeedbackDialog />
        <FeedbackForcePrompt suppressed={showGate} />
      </SidebarProvider>
    </DynamicThemeProvider>
  );
}
