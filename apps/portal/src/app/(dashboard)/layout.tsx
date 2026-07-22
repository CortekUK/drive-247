"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSubscriptionPlans } from "@/hooks/use-subscription-plans";
import { useTenantSubscriptionRealtime } from "@/hooks/use-tenant-subscription-realtime";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useSubscriptionGateDisabled } from "@/hooks/use-subscription-gate-disabled";
import { SubscriptionGateDialog } from "@/components/subscription/subscription-gate-dialog";
import { SetupReminderDialog } from "@/components/dashboard/setup-reminder-dialog";
import { MigrationBlockerDialog } from "@/components/migration/migration-blocker-dialog";
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
import { TraxAIDialog } from "@/components/chat";
import { MaintenanceBanner } from "@/components/dashboard/maintenance-banner";
import { GlobalVoiceCallProvider } from "@/components/voice/global-voice-call-provider";

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
  const { user, appUser, loading } = useAuth();
  const { tenant, loading: tenantLoading } = useTenant();
  const {
    isSubscribed,
    hasExpiredSubscription,
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
      // Not authenticated - redirect to login
      if (!user || !appUser) {
        router.replace(`/login?from=${encodeURIComponent(pathname)}`);
        return;
      }

      // Account deactivated - redirect to login
      if (!appUser.is_active) {
        router.replace("/login");
        return;
      }
    }
  }, [user, appUser, loading, router, pathname]);

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

  // Not authenticated - show nothing while redirecting
  if (!user || !appUser || !appUser.is_active) {
    return <LoadingSkeleton />;
  }

  // Billing state not yet known — do not paint an unprotected dashboard.
  if (holdForGateState) {
    return <LoadingSkeleton />;
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
            <TraxAIDialog />
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

          <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
            {children}
          </main>
        </SidebarInset>

        {/* Global voice call — always listening for inbound calls */}
        <GlobalVoiceCallProvider />

        {/* Hard gate modal. Same component for both states — different copy
            via `variant`. Dialog stays mounted; visibility is driven by
            `open` so we avoid Radix mount/unmount races that previously
            caused the modal to fail to appear without a page refresh. */}
        <SubscriptionGateDialog
          open={showGate}
          variant={hasExpiredSubscription ? "expired" : "setup"}
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
      </SidebarProvider>
    </DynamicThemeProvider>
  );
}
