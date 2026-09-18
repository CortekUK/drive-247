"use client";

import { Fragment, useEffect, useState } from "react";
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
import { PaymentDueBar } from "@/components/subscription/payment-due-bar";
import { SetupReminderDialog } from "@/components/dashboard/setup-reminder-dialog";
import { MigrationBlockerDialog } from "@/components/migration/migration-blocker-dialog";
import { TenantSuspendedScreen } from "@/components/tenant/tenant-suspended-screen";
import { ThemeToggle } from "@/components/shared/layout/theme-toggle";
import { HeaderSearch } from "@/components/shared/layout/header-search";
import { UserMenu } from "@/components/shared/layout/user-menu";
import { AppSidebar } from "@/components/shared/layout/app-sidebar";
import { useV2 } from "@/lib/v2-context";
import { AppSidebarV2 } from "@/components/shared/layout/app-sidebar-v2";
import { TopBarV2 } from "@/components/shared/layout/top-bar-v2";
import { TraxV2Provider } from "@/components/trax/support/trax-support-context";
import { TraxPanel } from "@/components/trax/trax-panel";
import { PageSearchProvider } from "@/components/shared/layout/page-search-slot";
import { NotificationBell } from "@/components/shared/layout/notification-bell";
import { CreditBalance } from "@/components/shared/layout/credit-balance";
import { BonzahBalance } from "@/components/shared/layout/bonzah-balance";
import { DynamicThemeProvider } from "@/components/shared/layout/dynamic-theme-provider";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import {
  SidebarProvider as SidebarProviderV2,
  SidebarTrigger as SidebarTriggerV2,
  SidebarInset as SidebarInsetV2,
} from "@/components/ui-v2/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { TraxAIDialog } from "@/components/chat";
import { MaintenanceBanner } from "@/components/dashboard/maintenance-banner";
import { AppBannerStack } from "@/components/banners/app-banner-stack";
import { GlobalVoiceCallProvider } from "@/components/voice/global-voice-call-provider";
import { DevBillingStatePill } from "@/components/dev/dev-billing-escape";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { FeedbackForcePrompt } from "@/components/feedback/feedback-force-prompt";
import { WelcomePackPrompt } from "@/components/welcome/welcome-pack-prompt";
import { FirstRunWizard } from "@/components/onboarding/first-run-wizard";
import { FirstRunHandoffGate } from "@/components/onboarding/first-run-handoff-gate";
import { FirstRentalTour } from "@/components/onboarding/first-rental-tour";
import { usePortalAnnouncements } from "@/hooks/use-portal-announcements";
import { SystemAnnouncementBanner } from "@/components/announcements/system-announcement-banner";
import { AnnouncementDialogHost } from "@/components/announcements/announcement-dialog-host";

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
  // v2 chrome gate, resolved on the server in the root layout (V2_PLAN §3).
  // A plain context read: no query, no effect, no flash. Falls back to v1.
  const v2Chrome = useV2("chrome");
  // The v2 page tint. Separate from `chrome` on purpose: the wash is a THEME
  // surface, not navigation furniture, and `.v2-theme` on <body> is what
  // actually defines `.bg-app-gradient` (styles/v2-theme.css). Reading the
  // matching gate keeps the class and its definition switched by the same flag.
  const v2Theme = useV2("theme");
  // The sidebar primitives carry a React CONTEXT, and ui/ and ui-v2/ each
  // define their own. AppSidebarV2 calls useSidebar() from ui-v2, so it must
  // sit inside ui-v2's SidebarProvider — pairing it with v1's provider throws
  // "useSidebar must be used within a SidebarProvider" at runtime, which no
  // amount of typechecking catches because both modules export the same names.
  // Provider, inset and trigger therefore switch together, as one set.
  const Provider = v2Chrome ? SidebarProviderV2 : SidebarProvider;
  const Inset = v2Chrome ? SidebarInsetV2 : SidebarInset;
  const Trigger = v2Chrome ? SidebarTriggerV2 : SidebarTrigger;
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

  // Announcements from the super admin (system notices for every tenant, feature
  // cards for the v2 dashboard). Called here, above every early return, so the read
  // starts while the skeleton below is still held; the banner, the dialog host and
  // the dashboard's desk band all read this same cached query.
  usePortalAnnouncements();

  // Pages where the user MUST be able to reach even without a subscription —
  // otherwise they'd have no way to subscribe or contact us.
  //
  // `/dev` joins them IN DEVELOPMENT ONLY. The blocked state is mockable from
  // that page, and `/dev` lives inside this same dashboard — so selecting
  // "Grace expired" put the blocker over the switch that turns it off, and
  // signing out did not help because the flag is in localStorage and survives
  // it. The literal comparison is folded away in a production build, so this
  // adds no bypass anywhere a real tenant can reach; the dialog also carries
  // its own exit (see dev-billing-escape.tsx).
  const isSubscriptionPage =
    pathname === "/subscription" ||
    pathname === "/credits" ||
    pathname?.startsWith("/settings") ||
    (process.env.NODE_ENV === "development" && pathname === "/dev");

  /**
   * Messages is a FULL-BLEED WORKSPACE — it takes the whole window, navigation
   * sidebar included.
   *
   * Every other page is content inside the app chrome. Messages is not: it is
   * three columns that each need real width (conversation list, thread,
   * customer overview), and with the 256px nav rail also on screen the thread —
   * the one column that actually carries the work — was the narrowest thing on
   * a 1520px display. So on this route only, the sidebar is not rendered and
   * `main` gives up its padding.
   *
   * Scoped to the route rather than the component: nothing about the sidebar
   * changes, it simply is not mounted here, so leaving Messages brings it back
   * with no state to restore and no other page affected. The rail's header
   * carries a way out (see `conversation-rail.tsx`) since the nav is gone.
   */
  const isMessagesWorkspace =
    pathname === "/messages" || !!pathname?.startsWith("/messages/");

  /* Trax's full-screen page. It needs the same HEIGHT treatment as Messages — a
     conversation must scroll inside itself rather than growing the document —
     but NOT the same chrome treatment: Messages hides the sidebar, whereas on
     Trax the sidebar stays and BECOMES the conversation rail (AppSidebarV2 →
     TraxRail), with Back at its top. Hence a second flag rather than widening
     the first. */
  const isTraxWorkspace = pathname === "/trax" || !!pathname?.startsWith("/trax/");

  /* Support is the third one: a ticket list and a conversation that scroll
     inside themselves, so the reply box stays on screen instead of sitting at
     the bottom of a long page. Like Trax it keeps the sidebar, and unlike Trax
     it keeps the top bar — hence a third flag rather than widening either. */
  const isSupportWorkspace = pathname === "/support" || !!pathname?.startsWith("/support/");

  /* Routes that bound their own height instead of letting the document scroll. */
  const isBoundedHeight = isMessagesWorkspace || isTraxWorkspace || isSupportWorkspace;

  /* Trax's shared conversation, provided to the top bar, the floating panel and
     the full page so all three are the SAME thread. v2 only: for v1 this is a
     Fragment, so the other 56 tenants do not mount a chat hook and fire a
     conversations query for a surface they cannot reach. A context provider
     emits no DOM either way, so the flex row above is unaffected. */
  const TraxWrap = v2Chrome ? TraxV2Provider : Fragment;

  /* Lets a LIST page lend the top bar its own search field and filter button —
     the one part of the bar that changes per page. Must sit above BOTH the bar
     and `{children}`: the page registers on mount and the bar reads it. v2 only,
     for the same reason as TraxWrap. */
  const SearchSlotWrap = v2Chrome ? PageSearchProvider : Fragment;

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

  /* ── does the tenant's BILLING STATE block them? ──────────────────────────
   *
   * Route-independent, and the pair below is the whole answer: no
   * `isSubscriptionPage` anywhere in them. `showExpiredGate` / `showSetupGate`
   * are then these two minus the exempt routes, so the gate DIALOG behaves
   * exactly as it did.
   *
   * The split exists because `showGate` was doing two different jobs. It says
   * "the gate dialog is on screen", which is correctly false on /subscription
   * and /settings — those routes stay reachable so a blocked tenant can always
   * pay. But it was also the only suppression signal handed to the four
   * full-screen onboarding prompts below, and on exactly those routes it
   * suppressed nothing: a hard-blocked operator who had not finished onboarding
   * was shown the first-run wizard on top of the one screen that takes money.
   * `gateWouldBlock` is the signal those prompts actually wanted — "this tenant
   * is blocked", regardless of which route they are standing on.
   */
  const expiredGateApplies = gateStateKnown && hasExpiredSubscription;

  // Expired/canceled subscription — same hard modal, different copy.
  const showExpiredGate = expiredGateApplies && !isSubscriptionPage;

  // Never-subscribed — Finish Setup modal. We gate when the tenant either has a
  // plan to buy OR when we could not load their plans at all: an errored plans
  // query means "unknown", and treating unknown as "nothing to sell" left the
  // paywall bypassable by blocking a single request (or by a transient 5xx).
  // Only a plans query that genuinely SUCCEEDED with zero rows leaves a tenant
  // un-gated, so an operator with no plan configured is never locked out of a
  // product they cannot buy. With no plans loaded the dialog falls back to its
  // contact-support copy, and the sign-out escape still applies.
  const setupGateApplies =
    gateStateKnown &&
    !isSubscribed &&
    !hasExpiredSubscription &&
    (hasActivePlans || plansErrored);

  const showSetupGate = setupGateApplies && !isSubscriptionPage;

  const gateOpen = (showSetupGate || showExpiredGate) && !gateSuppressed;

  /* The same question with the route exemption taken out — see the note above
     `expiredGateApplies`. Feeds `gateWouldBlock` only; nothing about when the
     gate dialog opens, when the skeleton is held, or when the latch is set
     reads this. */
  const gateWouldOpen = (setupGateApplies || expiredGateApplies) && !gateSuppressed;

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

  /**
   * "This tenant is blocked" — the same decision as `showGate`, minus the route
   * exemption. Only the four full-screen onboarding prompts read it.
   *
   * `gateLatched` is ORed in exactly as `showGate` does, so a tenant who met the
   * gate on a normal route and then walked to /subscription keeps the prompts
   * suppressed. The latch itself is still set from `gateOpen` (route-dependent)
   * on purpose: this fix changes what the PROMPTS see, and nothing about when
   * the gate dialog appears or when the first paint is held.
   */
  const gateWouldBlock = !gateSuppressed && (gateWouldOpen || gateLatched);

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
      {/* The full-width system announcement banner, for every tenant in both
          chromes. It is `position: fixed` across the top of the viewport and
          renders its own in-flow spacer, so it sits OUTSIDE the sidebar wrapper
          below and spans the sidebar column and the top bar end to end. It also
          publishes `html[data-system-banner]` + `--system-banner-h`, which the
          offsets in global.css use to move the fixed sidebars, the sticky top bar
          and the docked Trax panel down. Renders nothing (no spacer, no attribute)
          when there is no active banner, which is every tenant by default. */}
      <SystemAnnouncementBanner />
      {/* The v2 page tint lives HERE, on the sidebar wrapper, exactly as it
          does on `improv/portal-side` — `<SidebarProvider className="bg-background
          bg-app-gradient">`. It is not a token: `--background` is plain white in
          both trees, and the wash is four radial gradients painted by the
          `.bg-app-gradient` utility. The port brought the utility across into
          styles/v2-theme.css but nothing ever applied the class, so the canary
          had the definition and no consumer — cards on flat white instead of
          floating on lavender, which is the single biggest visual gap.
          `bg-background` is carried across verbatim from the branch even though
          tailwind-merge resolves the pair down to `bg-app-gradient` alone: the
          wash needs an opaque ground under it, and `body` already paints one
          (`.v2-theme body { @apply bg-background }`), so the composite is the
          same on both trees. `undefined` outside the gate leaves the element's
          class list byte-for-byte what it was for the other 56 tenants. */}
      <Provider
        /* The floating Trax panel's size is NOT set here. It lives in
           styles/v2-theme.css as `--trax-width`/`--trax-height` (plus
           `--trax-offset`), keyed on the `data-trax-panel` attribute TraxPanel
           puts on <html>. It has to be at the root: the panel portals to
           <body>, and so does the setup guide, which keeps clear of it. v1
           never mounts TraxPanel, so no v1 page gets any of those variables. */
        className={
          [
            v2Theme ? "bg-background bg-app-gradient" : "",
            /* Messages is the ONE route where the app itself must not scroll.
               The bound has to be here, at the top of the chain: this wrapper
               is `min-h-svh`, a floor and not a ceiling, so anything taller
               inside pushed the whole page — all three columns together —
               rather than scrolling within itself. Measured, not assumed: with
               only the floor, `main` came out 4250px tall in an 820px window
               and the document scrolled 3430px. */
            isBoundedHeight ? "h-svh overflow-hidden" : "",
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        /* Marks the bounded-height routes for global.css, which shortens the
           wrapper by the system banner's height while one is showing (otherwise
           Messages and Trax would scroll the document by exactly that much).
           No attribute at all on every other route. */
        data-bounded-height={isBoundedHeight ? "" : undefined}
      >
        <TraxWrap>
        <SearchSlotWrap>
        {isMessagesWorkspace ? null : v2Chrome ? <AppSidebarV2 /> : <AppSidebar />}

        {/* The floating left-edge SidebarTrigger that used to live here is gone:
            it existed only because "v2 has no top bar — and the SidebarTrigger
            lived in it". There is a top bar now, so the phone-only opener sits
            in it (see TopBarV2), which is both its normal home and one less
            floating artifact over the page. Desktop is unchanged — the sidebar
            still collapses via the `SidebarRail` hairline and ⌘B. */}

        {/* `bg-transparent` is load-bearing, and the branch carries it for the
            same reason: SidebarInset's own base class is `bg-background`, an
            opaque white pane that covers the whole content column — so without
            this the wash above would be visible only in the 8px gutter and the
            screen would still read as white. Gated, so the other 56 tenants
            keep the opaque inset they have today. */}
        {/* `overflow-x-hidden` is dropped for v2 CHROME specifically, and that is
            what makes the top bar able to pin. `overflow-x: hidden` forces
            `overflow-y` to compute to `auto` (CSS Overflow 3), which turns this
            element into a scroll container — and a `sticky` child resolves
            against the nearest scroll container, not the viewport. Since the
            Inset's height grows with its content it never actually scrolls, so
            the bar would have scrolled away with the page. Horizontal overflow is
            still clamped: `html, body { overflow-x: hidden }` in global.css
            covers it for every tenant. The other 56 keep the class they have. */}
        {/* `min-w-0` (v2) is what lets the Trax panel DOCK. A flex item's
            default `min-width: auto` floors it at its content width, so without
            it the Inset could not give up room to the panel's flow gap: the row
            ran past the viewport and `body.v2-theme`'s `overflow-x: clip` cut
            the page's right edge off. With the floor gone, `flex-1` narrows the
            whole column — top bar included — and wide content scrolls inside
            its own card as designed. */}
        <Inset
          className={
            [v2Chrome ? "min-w-0" : "overflow-x-hidden", v2Theme ? "bg-transparent" : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          {/* v2 only — the Stripe-style chrome row: search, messages,
              notifications. Sits in exactly the slot v1's <header> occupies, as a
              `shrink-0` flex sibling ABOVE the banners and <main>, so the flex
              pass subtracts its height the same way it already does for v1 —
              which is what keeps the /messages `h-svh` scroll bound intact. */}
          {/* Not on /trax: the full page is laid out like Claude's — the rail
              carries Back and the conversations, the page is one conversation
              column — and the bar's Trax button would only toggle a panel that
              route never shows. */}
          {v2Chrome && !isTraxWorkspace && <TopBarV2 showNavTrigger={!isMessagesWorkspace} />}
          {/* v1 only. v2 renders TopBarV2 above instead, so the two never
              coexist. Where each of this row's controls went for v2: SEARCH and
              NOTIFICATIONS are in the top bar (they were briefly in the sidebar
              and the right-edge dock respectively, which is what the bar
              replaced); the user menu, carrying the theme switch, is in the
              sidebar; Trax opens from the rental and vehicle rails and the setup
              guide; credits have their own nav entry; and the Bonzah balance is
              in Settings → Insurance and the dashboard's balance widget. */}
          {!v2Chrome && (
            <header className="flex h-16 shrink-0 items-center gap-1 sm:gap-2 border-b px-2 sm:px-4">
              <Trigger className="-ml-1 flex-shrink-0" />
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
          )}
          {/* The dunning warning FOR A PHONE, and nothing else on the screen
              carries it there.
              During grace the only billing surface is the chip in the sidebar
              footer, and below `md` both sidebars live inside a closed Sheet —
              so the chip is not off-screen, it is absent, and an operator on a
              phone was warned about nothing for the whole window before meeting
              a non-dismissible paywall. `md:hidden` inside the component, so
              desktop keeps the chip and only the chip.
              HERE, in flow, deliberately: `SystemAnnouncementBanner` is the
              fixed bar at the top of the viewport and global.css offsets the
              chrome by its height, and a second fixed bar would have to join
              that arithmetic. It renders nothing at all in every other state,
              which is what keeps main's `md:[header+&]` alignment intact for
              healthy tenants — the same contract MaintenanceBanner and
              AppBannerStack already honour. Route-independent on purpose: on
              /subscription and /settings, which the hard gate leaves reachable,
              this bar is a phone user's only route to the hosted invoice. */}
          <PaymentDueBar />
          <MaintenanceBanner />
          {/*
            Deposit-hold alerts, and the mount point every future banner should
            move into. Kept BELOW the two legacy bars rather than replacing them:
            those render themselves and manage their own visibility, so folding
            them in is a separate migration. The stack emits at most one deposit
            banner (plus a compact chip row), so this cannot become a wall.
          */}
          <AppBannerStack scope="app" />

          {/* `pt-0` exists because the v1 header already supplies the top
              gap. With the header gone, v2 needs its own — the source's main
              is a plain `p-4`. */}
          {/* `min-h-0` is the whole fix, and it is not decoration: a flex item
              defaults to `min-height: auto`, which floors it at its CONTENT
              height. That floor beat both `flex-1` and an explicit `h-svh`, so
              a long conversation made this element as tall as the thread and
              the document scrolled instead of the history. With the floor
              removed, `flex-1` distributes the wrapper's bounded height and no
              viewport arithmetic is needed anywhere — v1's 4rem header is a
              sibling above, so the flex pass subtracts it on its own. */}
          {/* v2: THE PAGE HEADER SITS ON THE SIDEBAR SWITCH'S ROW. The user asked
              for the page title row (Rentals, Customers, Vehicles and every page
              like them) to line up with the Portal / Website switch in the
              sidebar. Measured in headless Chrome on the real AppSidebarV2 and
              TopBarV2: the switch is centred 92px from the top at every desktop
              width, collapsed or not, and a page header (a 24px page padding,
              then a 36px title row) was centred at 122px, so 30px low. Dropping
              main's 16px top padding and pulling main up 14px under the
              transparent top bar puts it at 92px. Desktop only (md, where the
              sidebar is on screen). `[header+&]` applies it only when main sits
              directly under the top bar: with a maintenance or deposit banner
              showing in between, main keeps today's spacing instead of sliding
              under the banner. The v1 branch is unchanged. */}
          <main
            className={
              isBoundedHeight
                ? `flex min-h-0 flex-1 flex-col overflow-hidden p-0${v2Chrome ? " min-w-0" : ""}`
                : `flex flex-1 flex-col gap-4 p-4${v2Chrome ? " min-w-0 md:[header+&]:pt-0 md:[header+&]:-mt-3.5" : " pt-0"}`
            }
          >
            {children}
          </main>
        </Inset>

        {/* Trax, FLOATING. Mounted here for its context (the conversation and
            the panel state both live above this row), but it renders itself
            through a portal to <body> and is `fixed` there, so it takes no room
            from this row and never narrows the page. Nothing about the layout
            changes when it opens. See the header of trax-panel.tsx. */}
        <TraxPanel />
        </SearchSlotWrap>
        </TraxWrap>

        {/* The v2 right-edge QuickDock is no longer mounted. Its two remaining
            affordances — Messages and Notifications — moved into TopBarV2, which
            is where an operator looks for them. The component is deliberately
            NOT deleted: it is the only record of the dock design, and a revert
            here is one line rather than a rebuild. */}

        {/* Global voice call — always listening for inbound calls */}
        <GlobalVoiceCallProvider />

        {/* A standing "this is not real" marker, and the exit from wherever you
            are. It matters most for the states that only WARN: a red chip in
            the sidebar looks identical whether a card really failed or somebody
            left a preview switched on an hour ago. Renders nothing unless the
            build is development, the tenant is the canary, and a state is
            actually selected. */}
        <DevBillingStatePill />

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
        <FeedbackForcePrompt suppressed={gateWouldBlock} />

        {/* First-login nudge toward the welcome pack. Dismissible, and
            suppressed while the paywall owns the screen — this is the fifth
            dialog mounted here, and a new operator can already meet the
            subscription gate, the policy gate and the setup reminder before
            seeing a single screen. Same rule as FeedbackForcePrompt above. */}
        <WelcomePackPrompt suppressed={gateWouldBlock} />

        {/* First-run onboarding wizard — step 5 of the signup flow, between
            "Go to portal" and the dashboard. Full screen, shown exactly once,
            and gated to the northwind canary INSIDE the component (on the
            resolved tenant's slug, never its id) so no other tenant can meet
            it. Mounted last so it sits above the dashboard, and suppressed
            while the paywall owns the screen for the same reason the two
            prompts above are: a new operator can already meet the subscription
            gate, the policy gate and the setup reminder before seeing a single
            screen, and two non-dismissible full-screen surfaces stacked on each
            other leave them unable to act on either. */}
        {/* The demo signup journey's landing pad. Renders nothing; it exists to
            catch `?firstrun=1` on arrival from apps/web, clear the wizard, tour
            and checklist state for this tenant, and hard-reload onto the clean
            URL so the sequence below runs exactly as it would for a genuinely
            new operator.

            ABOVE the wizard on purpose — it has to act before anything else has
            decided what it is. See `lib/first-run-handoff.ts` for why the URL
            carries the intent rather than /dev's reset being trusted to have
            stuck: localStorage is per-origin, and the journey returns to a
            different origin than the one /dev was usually opened on. */}
        <FirstRunHandoffGate />

        <FirstRunWizard suppressed={gateWouldBlock} />

        {/* First-rental walkthrough — step 7, immediately after the wizard
            above. Eleven steps across six pages (dashboard, Vehicles,
            Customers, New Rental, Payments, Settings) and roughly a minute;
            it shows a brand-new operator the house on the way to the one
            thing it is for — their first rental. Cross-route: it persists
            its step, navigates itself, waits for each page's anchor and
            skips a step whose anchor never mounts; wandering off pauses it
            and the dashboard offers to resume.

            Gated to the northwind canary INSIDE the hook, on the resolved
            tenant's SLUG and never its id, and additionally on the v2 chrome —
            every anchor it points at lives in `app-sidebar-v2.tsx`, so under v1
            chrome there is nothing to point at and it stays dark.

            `suppressed` carries the same paywall signal the four prompts above
            take. Unlike them this one is a coach mark rather than a blocking
            surface — its dimming layer takes no clicks — but a tour spotlighting
            the sidebar behind a non-dismissible paywall is still nonsense the
            operator cannot act on. It also self-gates on the first-run wizard
            having settled, so the two can never share the screen. */}
        <FirstRentalTour suppressed={gateWouldBlock} />

        {/* Announcement dialogs: system notices (soft or hard) for every tenant,
            and the v2 dashboard's feature dialog. Mounted LAST, and it opens
            nothing while any surface above owns the screen: it takes the same
            paywall signal as the prompts above, and reads the migration,
            wizard, tour, feedback and open-modal state itself (see
            hooks/use-announcement-blocked.ts). One dialog at a time; a hard
            blocker is not shown on the pages `isSubscriptionPage` keeps
            reachable. */}
        <AnnouncementDialogHost
          showGate={showGate}
          isSubscriptionPage={!!isSubscriptionPage}
          pathname={pathname ?? "/"}
        />
      </Provider>
    </DynamicThemeProvider>
  );
}
