"use client";

import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
// The source worktree draws this sidebar in `@phosphor-icons/react`, which is
// not a dependency here and is not being added for a canary. Every icon below
// is the closest lucide equivalent; the aliases keep the source's own names so
// the markup reads the same:
//   SquaresFour→LayoutGrid  CalendarDots→CalendarDays  Prohibit→Ban
//   WarningCircle→BadgeAlert  ChartBar→BarChart3  ClockCounterClockwise→History
//   Gear→Settings  House→Home  EnvelopeSimple→Mail  Article→Newspaper
//   CaretRight→ChevronRight  MagnifyingGlass→Search  Tray→Inbox  Money→Banknote
//   ChatCircle→MessageSquare  Buildings→Building2  Plugs→Plug
//   CurrencyCircleDollar→CircleDollarSign  TrendUp→TrendingUp  Lightning→Zap/Bolt
//   Signature→FileSignature  ShieldSlash→ShieldX  FlowArrow→Workflow
import {
  Clock,
  ChevronRight,
  CircleDollarSign,
  Zap,
  Bolt,
  FileSignature,
  ArrowLeft,
  Building2,
  MapPin,
  Palette,
  Car,
  TrendingUp,
  Package,
  CreditCard,
  Bell,
  BellRing,
  FileText,
  Shield,
  Crown,
  Lock,
  Receipt,
  Banknote,
  MessageSquare,
  ShieldX,
  Search,
  X,
  Wallet,
  AlertTriangle,
  BookOpen,
  Wrench,
  UserPlus,
  Workflow,
  Sparkles,
  LayoutGrid,
  CalendarDays,
  Users,
  BadgeAlert,
  BarChart3,
  Settings,
  Globe,
  Home,
  Info,
  Star,
  Megaphone,
  Mail,
  Newspaper,
  Plug,
} from "lucide-react";
// CRITICAL: `ui/sidebar` and `ui-v2/sidebar` each define their OWN React
// context. The dashboard layout pairs this component with ui-v2's
// SidebarProvider, so `useSidebar` MUST come from ui-v2 or every render throws
// "useSidebar must be used within a SidebarProvider".
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarRail,
  useSidebar,
} from "@/components/ui-v2/sidebar";
import { Input } from "@/components/ui-v2/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { useReminderStats } from "@/hooks/use-reminders";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useFleetHealthStats } from "@/hooks/use-fleet-health";
import { useTenant } from "@/contexts/TenantContext";
import { isAreaHidden, isLeanTenant, isSettingsTabHidden } from "@/lib/lean-areas";
import { usePendingBookingsCount } from "@/hooks/use-pending-bookings";
import { useAuthStore } from "@/stores/auth-store";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useCMSPages } from "@/hooks/use-cms-pages";
import { useCmsOutline } from "@/stores/cms-outline-store";
import { ROUTE_TO_TAB } from "@/lib/permissions";
import { GlobalSearch } from "@/components/shared/layout/global-search";
import { UserMenuV2 } from "@/components/shared/layout/user-menu-v2";
import { OrgSwitcher } from "@/components/shared/layout/org-switcher";
import { SidebarPromo } from "@/components/shared/layout/sidebar-promo";
import { DevSection } from "@/components/shared/layout/dev-section";
import { SidebarSearchScene, useTypedHint } from "@/components/shared/layout/sidebar-search-scene";
import { SidebarCustomizerDialog } from "@/components/shared/layout/sidebar-customizer-dialog";
import { useNavPreferences } from "@/hooks/use-nav-preferences";
import { applyNavPreferences } from "@/lib/nav-preferences";
import { TraxIcon } from "@/components/chat/TraxIcon";
// The rental control centre's stage rail. The sidebar becomes it on a rental
// detail page, the same way it becomes the Settings rail on /settings — see
// `isRentalDetailPage` below.
import { useV2 } from "@/lib/v2-context";
import { useRentalDetailV2 } from "@/components/rentals-v2/rental-detail/use-rental-detail-v2";
import {
  STAGES,
  readStage,
  stageHref,
  stageValues,
} from "@/components/rentals-v2/rental-detail/stages";
import { StageItem, HeroChip } from "@/components/rentals-v2/rental-detail/_kit";
// The vehicle record's section rail — the third scoped rail this sidebar
// becomes, after Settings and the rental control centre. See
// `isVehicleDetailPage` below.
import {
  SECTION_GROUPS,
  SECTIONS,
  readSection,
  sectionHref,
  vehicleIdFromPath,
} from "@/components/vehicles-v2/sections";
import { useVehicleRecord } from "@/components/vehicles-v2/use-vehicle-record";
// The customer record's section rail — the fourth scoped rail this sidebar
// becomes, after Settings, the rental control centre and the vehicle record.
// Aliased on import because the vehicle rail above already owns the unaliased
// names, and both records live behind the same `?section=` param with DIFFERENT
// id sets — so each has to read that param through its own `readSection`, or a
// vehicle's section name would resolve on a customer and land on the wrong tab.
// See `isCustomerDetailPage` below.
import {
  SECTION_GROUPS as CUSTOMER_SECTION_GROUPS,
  SECTIONS as CUSTOMER_SECTIONS,
  customerIdFromPath,
  readSectionFrom as readCustomerSection,
  sectionHref as customerSectionHref,
} from "@/components/customers-v2/customer-detail/sections";
import { useCustomerRailHeader } from "@/components/customers-v2/customer-detail/use-customer-detail-v2";

/**
 * The search field's specular sweep.
 *
 * The source worktree keeps this in its own `global.css`; that file is out of
 * scope for this port, and an `animate-[shine-sweep_…]` class with no matching
 * @keyframes silently leaves the band parked across the middle of the field.
 * Declaring it here keeps the animation self-contained in the one component
 * that uses it. Values are the source's, unchanged: it crosses in the first
 * 14% of the cycle and idles for the rest, so it glints once every four
 * seconds rather than pulsing like a loading bar.
 */
const SHINE_KEYFRAMES = `
@keyframes shine-sweep {
  0% { transform: translateX(-120%); }
  14% { transform: translateX(120%); }
  100% { transform: translateX(120%); }
}
`;

/** Website nav order — matches the order the pages appear on the live site. */
const CMS_PAGE_ORDER = [
  "home",
  "about",
  "fleet",
  "reviews",
  "promotions",
  "contact",
  "blog",
  "privacy",
  "terms",
];

const CMS_PAGE_ICONS: Record<string, any> = {
  home: Home,
  about: Info,
  fleet: Car,
  reviews: Star,
  promotions: Megaphone,
  contact: Mail,
  blog: Newspaper,
  privacy: Shield,
  terms: FileText,
};

interface NavItem {
  name: string;
  href: string;
  icon: any;
  badge?: number;
  /** Defaults to `destructive`. See BADGE_TONE_CLASS. */
  badgeTone?: "destructive" | "amber";
  headAdminOnly?: boolean;
  superAdminOnly?: boolean;
}

/**
 * Every other count in this sidebar is red because it reports something wrong or
 * unread. Fleet Health's count reports scheduled work that has come due, which the
 * design system renders in the status orange (#d97706 ≡ amber-600). Red here would
 * put routine servicing at the same visual weight as an unpaid invoice.
 */
const BADGE_TONE_CLASS: Record<NonNullable<NavItem["badgeTone"]>, string> = {
  destructive: "text-white bg-destructive",
  amber: "text-white bg-amber-600",
};

interface NavGroup {
  label: string;
  icon: any;
  items: NavItem[];
}

/**
 * Settings sidebar tab definitions.
 *
 * Taken from the v1 sidebar, NOT from the source worktree — the source's copy
 * predates Push Notifications and Accounting and still calls `payments`
 * "Stripe Connect". Shipping the source's list would have quietly removed two
 * settings tabs from the canary and mislabelled a third.
 */
const settingsTabGroups = [
  {
    label: "Business",
    items: [
      { value: 'general', icon: Building2, label: 'General' },
      { value: 'locations', icon: MapPin, label: 'Locations' },
      { value: 'branding', icon: Palette, label: 'Branding' },
    ],
  },
  {
    label: "Booking Rules",
    items: [
      { value: 'requirements', icon: Shield, label: 'Requirements' },
      { value: 'duration', icon: Clock, label: 'Duration & Timing' },
      { value: 'lockbox', icon: Lock, label: 'Delivery & Lockbox' },
    ],
  },
  {
    label: "Pricing & Money",
    items: [
      { value: 'pricing', icon: TrendingUp, label: 'Pricing Rules' },
      { value: 'fees', icon: Receipt, label: 'Fees & Tax' },
      { value: 'preauth', icon: CreditCard, label: 'Deposit' },
      { value: 'installments', icon: Banknote, label: 'Installments' },
      { value: 'payg', icon: Clock, label: 'Pay As You Go' },
      { value: 'promos', icon: Zap, label: 'Promo Codes' },
      { value: 'extras', icon: Package, label: 'Extras' },
      // Provider-neutral: this tab holds whichever processor the tenant settled
      // on, and they now choose that themselves. A hard-coded "Stripe Connect"
      // sent a Square operator hunting for a menu item that does not describe
      // what they would find behind it.
      { value: 'payments', icon: CreditCard, label: 'Payments' },
    ],
  },
  {
    label: "Communication",
    items: [
      { value: 'reminders', icon: Bell, label: 'Notifications' },
      { value: 'push', icon: BellRing, label: 'Push Notifications' },
      { value: 'templates', icon: FileText, label: 'Templates' },
    ],
  },
  {
    label: "Integrations",
    items: [
      { value: 'accounting', icon: Banknote, label: 'Accounting' },
      { value: 'messaging', icon: MessageSquare, label: 'Messaging' },
      { value: 'insurance', icon: Shield, label: 'Insurance' },
      { value: 'esign', icon: FileSignature, label: 'E-Signatures' },
      { value: 'tesla', icon: Bolt, label: 'Tesla Fleet' },
      { value: 'blacklist', icon: ShieldX, label: 'Blacklist' },
    ],
  },
  {
    label: "Account",
    items: [
      { value: 'subscription', icon: Crown, label: 'Subscription' },
    ],
  },
];

/**
 * The settings groups this tenant sees.
 *
 * Returns the module constant BY REFERENCE for every non-lean tenant, so the
 * other 56 get a byte-identical list and this function cannot cost them a
 * re-render or a reordering.
 *
 * For a lean tenant it moves ONE item. Once Payments, Messaging, Insurance,
 * E-Signatures, Accounting and Tesla Fleet are filtered out by
 * `isSettingsTabHidden`, the "Integrations" group holds only Blacklist — and a
 * settings group called "Integrations" containing one unrelated row, sitting in
 * the same sidebar as a real Integrations page, reads as a bug. The Global
 * Blacklist is not an integration in the first place: it is a booking/risk rule
 * (block a customer that three or more operators have blocked), it connects to
 * no third party and it has no card on the board. So it joins Booking Rules
 * next to Requirements, and the emptied group disappears through the
 * `.filter(group => group.items.length > 0)` that is already there.
 *
 * The tab itself is untouched — same `value`, same `?tab=blacklist` URL, same
 * body, same `permissions.ts` mapping. Only which heading it sits under moves.
 */
function settingsGroupsFor(tenantSlug: string | null | undefined) {
  if (!isLeanTenant(tenantSlug)) return settingsTabGroups;
  return settingsTabGroups.map(group => {
    if (group.label === "Booking Rules") {
      const blacklist = settingsTabGroups
        .find(g => g.label === "Integrations")
        ?.items.find(i => i.value === 'blacklist');
      return blacklist ? { ...group, items: [...group.items, blacklist] } : group;
    }
    if (group.label === "Integrations") {
      return { ...group, items: group.items.filter(i => i.value !== 'blacklist') };
    }
    return group;
  });
}

/**
 * v2 sidebar. A NEW file beside `app-sidebar.tsx` — the v1 sidebar keeps
 * serving the other 56 tenants byte for byte (V2_PLAN §3). The only edit to v1
 * is the single branch in `(dashboard)/layout.tsx`.
 *
 * `onAskAI` is optional and currently unused by the layout: the header keeps
 * its own Trax button, so this row renders only when a caller supplies an
 * opener. Two openers into two Trax instances would mean two conversations.
 */
export function AppSidebarV2({ onAskAI }: { onAskAI?: () => void } = {}) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Close the mobile sheet immediately on nav tap — gives instant perceived
  // feedback while the destination page/tab is still rendering.
  const closeMobileOnNav = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const { data: reminderStats } = useReminderStats();
  const { settings } = useOrgSettings();
  const { tenant, tenantSlug } = useTenant();
  // Website rail + its publish switches. React Query dedupes this against the
  // /cms dashboard's own read, so the extra mount costs nothing.
  const {
    pages: cmsPages,
    publishPage,
    unpublishPage,
    isPublishing,
    isUnpublishing,
  } = useCMSPages();
  const leadManagementEnabled = (tenant as { lead_management_enabled?: boolean } | null)?.lead_management_enabled === true;
  const automationsEnabled = (tenant as { automations_enabled?: boolean } | null)?.automations_enabled === true;
  const vehicleOwnersEnabled = (tenant as { vehicle_owners_enabled?: boolean } | null)?.vehicle_owners_enabled === true;
  // `fleet_health_enabled` is not in TenantContext's explicit column list, so it is
  // read from the rental-settings row (a SELECT * on `tenants`) — which is also the
  // cache the settings toggle writes through, so flipping it moves this entry with
  // no refetch. `=== true` keeps the item hidden while that query is still in flight
  // rather than flashing a nav entry the tenant has not turned on.
  const { settings: rentalSettings } = useRentalSettings();
  // The lean gate is applied here as well as in useFleetHealthEnabled(): both
  // sidebars compute this inline from the rental-settings row rather than calling
  // that hook, so the hook's choke point does not reach them. Northwind renders
  // app-sidebar-v2; the other 35 render app-sidebar. Gating one proves nothing
  // about the other.
  const fleetHealthEnabled =
    (rentalSettings as unknown as { fleet_health_enabled?: boolean }).fleet_health_enabled === true &&
    !isAreaHidden("fleet-health", tenantSlug);
  // Fleet Health alerting is pull-only by design — nothing is emailed or pushed —
  // so this badge is the only standing signal that work has come due.
  const { needsAttention: fleetNeedsAttention } = useFleetHealthStats();
  const { data: pendingBookingsCount } = usePendingBookingsCount();
  const { appUser } = useAuthStore();
  const {
    isInGracePeriod,
    isGraceExpired,
    graceSeverity,
  } = useTenantSubscription();
  const { isManager, canView, canViewSettings } = useManagerPermissions();

  // A failed payment outranks everything else in the footer badge: it is the
  // one state that needs the operator to DO something, and it escalates
  // amber → red as the 7-day grace window runs out.
  //
  // Covers the EXPIRED state too. Gating on isInGracePeriod alone meant that the
  // moment the window closed the badge fell back to a green "Live" chip sitting
  // behind a modal telling the operator their access had been canceled — the two
  // surfaces flatly contradicting each other at the worst possible moment.
  const paymentDue = isInGracePeriod || isGraceExpired;
  const paymentDueCritical = graceSeverity === "critical" || isGraceExpired;
  // The client's wording, verbatim.
  const paymentDueLabel = "Your payment is due.";
  /**
   * NO COUNTDOWN. This used to read "4d left", and the decision was taken to
   * stop showing one: a countdown invites an operator to wait it out, it turns
   * a fixable card problem into a deadline to manage, and the window itself is
   * now a super admin setting that can change under them mid-count. The state
   * is what matters, so the chip says which state they are in and the action
   * stays one click away.
   */
  const paymentDueDetail = isGraceExpired ? "Overdue" : "Action needed";
  const paymentDueClass = paymentDueCritical
    ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400"
    : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";

  // Feedback is no longer a sidebar row — its entry point lives in the user
  // menu now (`user-menu-v2.tsx`), which also carries v1's `formEnabled` gate.

  const showPendingBookings = settings?.payment_mode === 'manual';
  const collapsed = state === "collapsed";

  const [searchOpen, setSearchOpen] = useState(false);
  /** What was typed into the sidebar field. Seeds and drives the search scene. */
  const [searchSeed, setSearchSeed] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  /** Search mode: the rail becomes the result list instead of the nav. */
  const [searchScene, setSearchScene] = useState(false);
  const typedHint = useTypedHint(!collapsed && !searchScene && !searchSeed);
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const { preferences: navPreferences } = useNavPreferences();
  // The open page's sections, published by the CMS visual editor. Empty
  // whenever that editor is not mounted, so this costs the rest of the portal
  // nothing — see stores/cms-outline-store.ts.
  const outlineSections = useCmsOutline((s) => s.sections);
  const outlineActiveId = useCmsOutline((s) => s.activeId);
  const outlineDirtyIds = useCmsOutline((s) => s.dirtyIds);
  const outlinePick = useCmsOutline((s) => s.pick);

  const [activeView, setActiveView] = useState<"admin" | "cms">(
    pathname?.startsWith("/cms") ? "cms" : "admin"
  );
  const [drillGroup, setDrillGroup] = useState<NavGroup | null>(null);

  // /cms maps to the `cms` tab key, so the Website view is behind the same
  // manager grant that hides "Website Content" from the v1 sidebar. Without
  // this a restricted manager would reach every CMS page from the section tabs.
  const canSeeCms = !isManager || canView("cms");
  const view = canSeeCms ? activeView : "admin";

  /**
   * Switching side always lands on that side's dashboard. Flipping the rail
   * without moving left the nav describing one half of the product while the
   * page still showed the other.
   */
  const switchView = useCallback(
    (next: "admin" | "cms") => {
      if (next === "cms" && !canSeeCms) return;
      setActiveView(next);
      closeMobileOnNav();
      router.push(next === "cms" ? "/cms" : "/");
    },
    [router, closeMobileOnNav, canSeeCms]
  );

  // Keyboard shortcuts to switch sidebar tabs (Alt+1 / Alt+2 — avoids the
  // browser's Cmd/Ctrl+number tab switching).
  useEffect(() => {
    if (!canSeeCms) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.code === "Digit1") {
        e.preventDefault();
        switchView("admin");
      } else if (e.code === "Digit2") {
        e.preventDefault();
        switchView("cms");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSeeCms, switchView]);

  // Opened from the user menu at the foot of the rail. The dialog needs the
  // computed nav, which only exists here, so the trigger and the dialog are
  // joined by an event rather than by threading props through UserMenuV2.
  useEffect(() => {
    const openCustomizer = () => setCustomizerOpen(true);
    window.addEventListener("open-sidebar-customizer", openCustomizer);
    return () =>
      window.removeEventListener("open-sidebar-customizer", openCustomizer);
  }, []);

  // NOTE — no `open-global-search` / ⌘K listener here, unlike the source
  // worktree. That worktree deleted the top header; this branch keeps it, and
  // `HeaderSearch` already registers its own ⌘K handler while `providers.tsx`
  // separately dispatches `open-global-search` on the same chord. A listener
  // here would therefore open two dialogs at once. The ⌘K badge on the field
  // still tells the truth — the header answers it.

  // Settings mode: when on /settings path, show settings sidebar
  const isSettingsPage = pathname?.startsWith("/settings") || false;
  const activeSettingsTab = searchParams.get('tab') || 'general';
  const [settingsSearch, setSettingsSearch] = useState("");

  /* ── rental control centre mode ────────────────────────────────────────
   *
   * The v2 rental detail screen is three columns, and the leftmost of them is
   * this sidebar. The prototype drew its own rail because it was a full-screen
   * page with no app chrome; inside `(dashboard)/layout.tsx` that would stack
   * two sidebars side by side. So the sidebar BECOMES the stage rail while a
   * rental is open, exactly as it becomes the Settings rail on /settings.
   *
   * Matched on a UUID rather than "anything after /rentals/", because
   * `/rentals`, `/rentals/new` and `/rentals/analytics` are all real routes and
   * every one of them still wants the ordinary nav. A stricter test is also the
   * safe one: an unrecognised path falls through to the normal sidebar, which
   * is a working screen, whereas a false positive is a rail with no rental
   * behind it.
   */
  const rentalDetailId =
    pathname?.match(
      /^\/rentals\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/
    )?.[1] ?? null;
  // Gated on the SAME area flag the page reads. Without this, a tenant with v2
  // chrome but v1 rentals would get a stage rail alongside the v1 detail page —
  // a sidebar navigating stages that screen does not have.
  const rentalsV2 = useV2("rentals");
  // `/insights` 404s for any tenant not on the v2 area, so the nav entry has to
  // ask the same gate the route does. The v2 sidebar is northwind-only today,
  // which makes this look redundant — it stops being redundant the moment
  // `chrome` widens ahead of `insights`, and a nav item that leads to a 404 is
  // exactly the kind of quiet breakage this ordering produces.
  const isRentalDetailPage = !!rentalDetailId && rentalsV2;
  const activeStage = readStage(searchParams.get("stage"));
  // Called unconditionally (hooks may not be conditional) but fetches nothing
  // off a rental page: `enabled` is false without an id. On a rental page it
  // shares a query key with the screen itself, so the two read one request.
  const { detail: rentalDetail } = useRentalDetailV2(isRentalDetailPage ? rentalDetailId : null);
  const rentalStageValues = stageValues(rentalDetail);

  /* ── vehicle record mode ───────────────────────────────────────────────
   *
   * The same move as the rental rail above, for the same reason: the v2 vehicle
   * screen wants a scoped left rail, and inside `(dashboard)/layout.tsx` drawing
   * its own would stack two sidebars side by side. So the sidebar BECOMES the
   * section rail while a car is open.
   *
   * The path test lives in `sections.ts` (`vehicleIdFromPath`) rather than here,
   * because it is a fact about the vehicle route and both this file and anything
   * else that needs it should read one copy. It matches a UUID only, so
   * `/vehicles` and `/vehicles/analytics` — both real routes — keep the ordinary
   * nav.
   *
   * Unlike the rental rail, this one shows no per-section values: a vehicle's
   * sections are PLACES on a record, not decisions with answers, so the rail
   * stays identical on every car and is learned by position. See `sections.ts`.
   */
  const vehicleDetailId = vehicleIdFromPath(pathname);
  // Gated on the SAME area flag the page reads. Without it a tenant on v2 chrome
  // but v1 vehicles would get a rail navigating sections their screen does not
  // have.
  const vehiclesV2 = useV2("vehicles");
  const isVehicleDetailPage = !!vehicleDetailId && vehiclesV2;
  const activeSection = readSection(searchParams.get("section"));
  // Called unconditionally (hooks may not be conditional) but fetches nothing
  // off a vehicle page: `enabled` is false without an id. On a vehicle page it
  // shares a query key with the screen itself, so the two read one request. This
  // instance never calls `patch`, so its write path is inert.
  const { vehicle: railVehicle } = useVehicleRecord(isVehicleDetailPage ? vehicleDetailId : "");

  /* ── customer record mode ──────────────────────────────────────────────
   *
   * The same move again, for the same reason. Nothing new here except what the
   * rail is allowed to say: a customer's sections are PLACES on a record that
   * already exists, so the rail shows a label and an icon and nothing else, and
   * looks identical on every customer — which is what makes it findable by
   * position. The verdict an operator actually wants ("can I hand this person
   * keys, and what is stopping it") is a whole column of its own on the far side
   * of the screen, and restating a thinner version of it here would give the
   * screen two summaries that drift apart.
   */
  const customerDetailId = customerIdFromPath(pathname);
  // Gated on the SAME area flag the page reads. Without it a tenant on v2 chrome
  // but v1 customers would get a rail navigating sections their screen does not
  // have.
  const customersV2 = useV2("customers");
  const isCustomerDetailPage = !!customerDetailId && customersV2;
  const activeCustomerSection = readCustomerSection(searchParams.get("section"), searchParams.get("tab"));
  // Called unconditionally (hooks may not be conditional) but fetches nothing off
  // a customer page: it is handed null and `useCustomerRow` is `enabled` on a
  // truthy id. On a customer page it shares that query's key with the screen, so
  // the two read one request — and it reads the ROW, not the assembled record,
  // because a rail needs a name and a line of contact, not twelve subscriptions.
  const customerRail = useCustomerRailHeader(isCustomerDetailPage ? customerDetailId : null);

  // Clear the search when leaving settings so it doesn't linger on return.
  useEffect(() => {
    if (!isSettingsPage && settingsSearch) setSettingsSearch("");
  }, [isSettingsPage, settingsSearch]);

  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    return pathname?.startsWith(path) || false;
  };

  /**
   * Role + manager visibility filter applied to EVERY nav item, in every list.
   *
   * This is v1's filter, restated as a predicate instead of a `.map().filter()`
   * chain. All three rules are carried across unchanged: `superAdminOnly`,
   * `headAdminOnly`, and the `ROUTE_TO_TAB` → `canView` lookup that decides
   * what a manager may see. A route missing from ROUTE_TO_TAB is allowed for
   * everyone, exactly as `getTabKeyForRoute` treats it.
   */
  const filterItem = (item: NavItem) => {
    if (item.superAdminOnly && !appUser?.is_super_admin) return false;
    if (item.headAdminOnly && appUser?.role !== "head_admin") return false;
    if (isManager) {
      const tabKey = ROUTE_TO_TAB[item.href];
      if (tabKey && !canView(tabKey)) return false;
    }
    return true;
  };

  // --- Section 2: the three things the job is actually made of ---
  //
  // Customer, then vehicle, then rental — the order a booking happens in, not
  // alphabetical and not by how often each is clicked. These three stay alone
  // up here; everything else lives under "More" below.
  const rawTopLevel: NavItem[] = ([
    { name: "Customers", href: "/customers", icon: Users },
    { name: "Vehicles", href: "/vehicles", icon: Car },
    { name: "Rentals", href: "/rentals", icon: FileText },
  ] as NavItem[]).filter(filterItem);

  // --- Section 3: "More", flat ---
  //
  // These were pulled out of the "Bookings", "Finance" and "Records"
  // drill-downs. They are daily work — take a payment, chase an invoice, check
  // whether a car is free this weekend — and a drill-down was costing a click
  // every time. They are NOT promoted to section 2: that section is deliberately
  // three items, and diluting it to eleven made it an unscannable column.
  //
  // So they render flat inside "More", above the groups that remain. Visible
  // without a click, without crowding the three that matter most.
  //
  const rawMoreItems: NavItem[] = ([
    // Insights, Insurances and Agreements are OFF the canary's rail, at the
    // user's request, and this is the SECOND time they have been removed: they
    // were taken out of the "Records" group, then a later restructure promoted
    // them to top level and so reinstated them. If you are moving nav entries
    // around, they do not come with you.
    //
    // Each is a decision that now has a home on the rental itself — its
    // Insurance, Agreement and Payments stages — so a second, rental-agnostic
    // list of the same records is two places to look for one answer. The three
    // PAGES are untouched and their routes still resolve.
    // `/blocked-dates` is the route; "Availability" is what the page is FOR,
    // which is why the two do not match.
    { name: "Availability", href: "/blocked-dates", icon: CalendarDays },
    { name: "Payments", href: "/payments", icon: CreditCard },
    { name: "Invoices", href: "/invoices", icon: Receipt },
    { name: "Fines", href: "/fines", icon: BadgeAlert },
    // NOTE: Credits is deliberately NOT here. `/credits` reads
    // `tenant_credit_wallets` — platform credit this tenant BUYS FROM US, with
    // its own packages and checkout. It is not renter money like the four
    // above, and listing it beside them read as if it were. It sits with
    // Subscription in the account section at the top of the rail.
  ] as NavItem[]).filter(filterItem);

  // --- Second-level groups (drilled into on click) ---
  //
  // Every gate and badge below is v1's, unchanged: the pages are all still
  // live, and without an entry here they are reachable only by typing the URL —
  // Pending Bookings especially, where an unseen queue means bookings nobody
  // approves. Rentals, Vehicles and Customers stay top-level, so these groups
  // hold what v1 nested under "Fleet & Bookings" and "Customers".
  const rawGroups: NavGroup[] = ([
    {
      label: "Bookings",
      icon: CalendarDays,
      items: [
        ...(isAreaHidden("quotes", tenantSlug)
          ? []
          : [{ name: "Fleet Quotes", href: "/quotes", icon: CircleDollarSign }]),
        ...(showPendingBookings
          ? [{ name: "Pending Bookings", href: "/pending-bookings", icon: Clock, badge: pendingBookingsCount || 0 }]
          : []),
        // Availability was lifted to top level; see `rawTopLevel`. Both entries
        // left here are conditional, so this group can empty out entirely — the
        // `.filter(g => g.items.length > 0)` below then drops the "Bookings"
        // row rather than leaving a dead one.
      ],
    },
    // Kept from v1: the source worktree dropped Fleet Health entirely. It is
    // still behind the same `fleet_health_enabled` flag and keeps its amber
    // badge tone — the page exists and its queue is pull-only.
    ...(fleetHealthEnabled
      ? [{
          label: "Fleet",
          icon: Wrench,
          items: [
            {
              name: "Fleet Health",
              href: "/fleet-health",
              icon: Wrench,
              badge: fleetNeedsAttention || 0,
              badgeTone: "amber" as const,
            },
          ],
        } as NavGroup]
      : []),
    {
      // Blocked Customers and Messages used to live here. Blocked Customers is
      // now a button in the header of /customers itself — it is a view OF the
      // customer list, not a separate place, and a second "Customers" entry in
      // the sidebar to reach it was one level of nesting too many. Messages was
      // dropped outright.
      //
      // Inquiries was the last entry here and has been removed from the portal
      // flow. THE GROUP IS THEREFORE ALWAYS EMPTY, and an empty group must not
      // render as a dead "Customers" row sitting under the real one. It does
      // not: the `.filter(g => g.items.length > 0)` below removes it — the same
      // filter that already handled the case where Inquiries was conditionally
      // absent. That filter is load-bearing, which is why it is called out here
      // as well as at its own definition.
      //
      // The group is kept rather than deleted because it is the anchor the
      // sibling comments above refer to, and because whatever replaces
      // Inquiries under Customers belongs here. /enquiries itself still exists
      // as a route and the data behind it is untouched; what went is the way in.
      label: "Customers",
      icon: Users,
      items: [] as NavItem[],
    },
    ...(leadManagementEnabled && !isAreaHidden("leads", tenantSlug)
      ? [{
          label: "Pipeline",
          icon: Users,
          items: [
            { name: "Leads", href: "/leads", icon: UserPlus },
            ...(automationsEnabled && !isAreaHidden("automations", tenantSlug)
              ? [{ name: "Automations", href: "/automations", icon: Workflow }]
              : []),
          ],
        } as NavGroup]
      : []),
    // Vehicle Owners + Owner Payouts. The `vehicle_owners_enabled` flag is the
    // tenant's own switch and stays first; the lean gate is the second half and
    // must stay, because the canary can flip that switch on from
    // Settings -> Features. Nothing is removed -- the 7 tenants with the flag
    // on, Global Motion Transport among them (3 owners, 15 payouts), are
    // untouched.
    ...(vehicleOwnersEnabled && !isAreaHidden("owners", tenantSlug)
      ? [{
          label: "Owners",
          icon: Users,
          items: [
            { name: "Vehicle Owners", href: "/vehicle-owners", icon: Users },
            { name: "Owner Payouts", href: "/owner-payouts", icon: Banknote },
          ],
        } as NavGroup]
      : []),
    {
      // Payments, Invoices, Fines and Credits were promoted to top level; see
      // `rawTopLevel`. Expenses is what is left, and it is lean-gated, so this
      // group empties on any tenant with expenses hidden — the
      // `.filter(g => g.items.length > 0)` below then drops the "Finance" row
      // rather than leaving a dead one.
      label: "Finance",
      icon: CreditCard,
      items: [
        ...(isAreaHidden("expenses", tenantSlug)
          ? []
          : [{ name: "Expenses", href: "/expenses", icon: Wallet }]),
      ],
    },
    {
      label: "Records",
      icon: BarChart3,
      items: [
        // Insurances, Agreements and Insights are not missing — they were
        // promoted to top level; see `rawTopLevel` above. What is left here is
        // genuine filing.
        //
        // On the canary that is Reminders alone, since Reports and P&L are
        // lean-hidden. If Reminders is hidden too this group empties, and the
        // `.filter(g => g.items.length > 0)` below drops the whole "Records"
        // row rather than leaving a dead one.
        ...(isAreaHidden("reminders", tenantSlug)
          ? []
          : [{ name: "Reminders", href: "/reminders", icon: Bell, badge: reminderStats?.due || 0 }]),
        ...(isAreaHidden("reports", tenantSlug)
          ? []
          : [{ name: "Reports", href: "/reports", icon: BarChart3 }]),
        ...(isAreaHidden("pl-dashboard", tenantSlug)
          ? []
          : [{ name: "P&L Dashboard", href: "/pl-dashboard", icon: TrendingUp }]),
      ],
    },
  ] as NavGroup[])
    .map((g) => ({ ...g, items: g.items.filter(filterItem) }))
    .filter((g) => g.items.length > 0);

  // The user's own arrangement, laid over the nav the app just computed.
  // Deliberately applied AFTER `filterItem`: a stored href for a page this
  // user may not see then matches nothing, so customisation can only ever
  // hide or reorder — never reveal.
  const arrangedNav = applyNavPreferences({
    topLevel: rawTopLevel,
    groups: rawGroups,
    preferences: navPreferences,
  });
  const topLevel = arrangedNav.topLevel as NavItem[];
  const groups = arrangedNav.groups as NavGroup[];
  // Not passed through `applyNavPreferences`: that helper understands two
  // buckets (top level and groups) and reordering a third through it would
  // need its stored shape to change. These render in declaration order, which
  // is fine — they are the section a user reaches for less often, and the
  // customisation UI has never offered to reorder them.
  const moreItems = rawMoreItems;

  // --- Website view: the site's pages, and nothing else ---
  // Driven off the `cms_pages` rows rather than a hardcoded list, so the rail
  // can never drift from what actually exists.
  const cmsPageNav = useMemo(() => {
    return [...(cmsPages ?? [])]
      // Site Settings is configuration, not a page a visitor can land on, and
      // it has no publish state worth toggling — it gets its own static row
      // below instead (v1 offers that route, so it must stay reachable).
      .filter((p: any) => p.slug !== "site-settings")
      .sort((a: any, b: any) => {
        const ia = CMS_PAGE_ORDER.indexOf(a.slug);
        const ib = CMS_PAGE_ORDER.indexOf(b.slug);
        return (
          (ia === -1 ? CMS_PAGE_ORDER.length : ia) - (ib === -1 ? CMS_PAGE_ORDER.length : ib)
        );
      })
      .map((p: any) => ({
        id: p.id as string,
        slug: p.slug as string,
        name: p.name as string,
        href: `/cms/${p.slug}`,
        icon: CMS_PAGE_ICONS[p.slug] || FileText,
        published: p.status === "published",
      }));
  }, [cmsPages]);

  const isCmsActive = (href: string) =>
    href === "/cms" ? pathname === "/cms" : (pathname?.startsWith(href) ?? false);

  // --- Rental Control Centre Mode ---
  //
  // Deliberately built from the Settings branch below rather than beside it:
  // the h-11 back-link row, the title block, the footer slot and the collapsed
  // behaviour are all its markup, so the two scoped rails read as the same
  // piece of furniture wearing different contents. What differs is the body —
  // Settings lists tabs, this lists DECISIONS, and each row shows the rental's
  // answer where it has one and the stage's question where it does not.
  /* Messages HAS NO BACK RAIL, and that is deliberate.
     Settings and rental detail replace this sidebar because each is a
     destination you go into and come out of. Messages is not: it is a
     persistent three-column workspace (see app/(dashboard)/messages/layout.tsx)
     where the conversation list is always on screen, so there is nothing to go
     "back" to — and replacing the nav would strand somebody inside an inbox
     with no way to reach the rest of the portal. */

  if (isRentalDetailPage && rentalDetailId) {
    const heroTitle = rentalDetail
      ? (rentalDetail.customerName ?? rentalDetail.rentalNumber ?? "Rental")
      : "Rental";
    const heroSubtitle = rentalDetail
      ? [rentalDetail.rentalNumber, rentalDetail.vehicleLabel].filter(Boolean).join(" · ")
      : "Loading…";

    return (
      <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
        <SidebarHeader className="h-16">
          <div className="flex items-center w-full h-full px-2 transition-all duration-300 ease-in-out">
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/rentals" className="flex items-center justify-center w-full h-8 rounded-md hover:bg-muted/50 transition-colors">
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">Back to rentals</TooltipContent>
              </Tooltip>
            ) : (
              <Link href="/rentals" className="flex items-center gap-2 h-8 px-1 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 shrink-0" />
                <span className="text-[13px]">All rentals</span>
              </Link>
            )}
          </div>
        </SidebarHeader>

        {/* Who this rental is for, and which car. The identity of the record,
            in the same slot Settings puts its own title. */}
        {!collapsed && (
          <div className="px-4 pt-4 pb-1">
            <h2 className="truncate text-sm font-semibold text-foreground">{heroTitle}</h2>
            {heroSubtitle && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{heroSubtitle}</p>
            )}
          </div>
        )}

        <SidebarContent className="transition-all duration-300 ease-in-out gap-0">
          {collapsed ? (
            // Collapsed, a stage has no room for its answer — so it falls back
            // to its icon with the label in a tooltip, which is what the rest
            // of this sidebar does at this width.
            <SidebarGroup className="p-1.5">
              <SidebarMenu>
                {STAGES.map((s) => (
                  <SidebarMenuItem key={s.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SidebarMenuButton
                          asChild
                          isActive={activeStage === s.id}
                          className="h-8 transition-all duration-200 ease-in-out"
                        >
                          <Link
                            href={stageHref(rentalDetailId, s.id)}
                            replace
                            scroll={false}
                            prefetch={false}
                            onClick={closeMobileOnNav}
                          >
                            <s.icon className="h-4 w-4 shrink-0" />
                          </Link>
                        </SidebarMenuButton>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {rentalStageValues[s.id] ? `${s.label} — ${rentalStageValues[s.id]}` : s.label}
                      </TooltipContent>
                    </Tooltip>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ) : (
            <div className="space-y-2 p-3">
              {STAGES.map((s, i) => (
                <StageItem
                  key={s.id}
                  index={i}
                  label={s.label}
                  value={rentalStageValues[s.id]}
                  prompt={s.prompt}
                  active={activeStage === s.id}
                  href={stageHref(rentalDetailId, s.id)}
                  onClick={closeMobileOnNav}
                />
              ))}
            </div>
          )}
        </SidebarContent>

        {/* Status lives in the footer — the same slot the ordinary sidebar uses
            for its billing chip, and the same slot the prototype used. */}
        <SidebarFooter className="p-3">
          {!collapsed && rentalDetail && (
            <div className="flex flex-wrap gap-1.5">
              <HeroChip tone={rentalDetail.status.tone}>{rentalDetail.status.label}</HeroChip>
              {rentalDetail.dateRangeShort && (
                <HeroChip tone="muted" dot={false}>
                  {rentalDetail.dateRangeShort}
                </HeroChip>
              )}
            </div>
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    );
  }

  // --- Vehicle Record Mode ---
  //
  // The third scoped rail, built from the Settings branch below like the rental
  // one above it — same h-16 back-link header, same title block, same grouped
  // nav, same collapsed popover behaviour — so all three read as one piece of
  // furniture wearing different contents.
  //
  // It is closer to Settings than to the rental rail on purpose. A rental's rail
  // lists decisions and shows each one's answer; a vehicle's lists nine PLACES
  // on a record that already exists, with no answer to show. So this rail reads
  // no record state beyond the car's own identity, and looks identical on every
  // vehicle — which is what makes it findable by position.
  if (isVehicleDetailPage && vehicleDetailId) {
    // Registration is hidden for operators who have turned it off fleet-wide, so
    // the subtitle falls back to the make and model rather than leaking a plate
    // into a rail that is on screen all day.
    const hidePlate =
      (tenant as { hide_vehicle_registration?: boolean } | null)?.hide_vehicle_registration === true;
    const modelLine = railVehicle
      ? [railVehicle.year, railVehicle.make, railVehicle.model].filter(Boolean).join(" ").trim()
      : "";
    // The plate leads when there is one — it is what an operator says out loud —
    // and the model line leads when there is not. Never a placeholder for a car
    // that has neither; "Vehicle" is honest, an invented name would not be.
    const heroTitle = railVehicle
      ? (hidePlate ? modelLine : railVehicle.reg) || modelLine || railVehicle.reg || "Vehicle"
      : "Vehicle";
    const heroSubtitle = railVehicle
      ? heroTitle === modelLine
        ? ""
        : modelLine
      : "Loading…";

    return (
      <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
        <SidebarHeader className="h-16">
          <div className="flex items-center w-full h-full px-2 transition-all duration-300 ease-in-out">
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/vehicles" className="flex items-center justify-center w-full h-8 rounded-md hover:bg-muted/50 transition-colors">
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">Back to vehicles</TooltipContent>
              </Tooltip>
            ) : (
              <Link href="/vehicles" className="flex items-center gap-2 h-8 px-1 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 shrink-0" />
                <span className="text-[13px]">All vehicles</span>
              </Link>
            )}
          </div>
        </SidebarHeader>

        {/* Which car this is — the identity of the record, in the same slot
            Settings puts its own title and the rental rail puts the customer. */}
        {!collapsed && (
          <div className="px-4 pt-4 pb-1">
            <h2 className="truncate text-sm font-semibold text-foreground">{heroTitle}</h2>
            {heroSubtitle && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{heroSubtitle}</p>
            )}
          </div>
        )}

        <SidebarContent className="transition-all duration-300 ease-in-out gap-0">
          {collapsed ? (
            // Collapsed there is no room for group headings, so the nine
            // sections flatten into one icon list with labels in tooltips —
            // what the rest of this sidebar does at this width.
            <SidebarGroup className="p-1.5">
              <SidebarMenu>
                {SECTIONS.map((s) => (
                  <SidebarMenuItem key={s.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SidebarMenuButton
                          asChild
                          isActive={activeSection === s.id}
                          className="h-8 transition-all duration-200 ease-in-out"
                        >
                          <Link
                            href={sectionHref(vehicleDetailId, s.id)}
                            replace
                            scroll={false}
                            prefetch={false}
                            onClick={closeMobileOnNav}
                          >
                            <s.icon className="h-4 w-4 shrink-0" />
                          </Link>
                        </SidebarMenuButton>
                      </TooltipTrigger>
                      <TooltipContent side="right">{s.label}</TooltipContent>
                    </Tooltip>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ) : (
            SECTION_GROUPS.map((group, groupIndex) => (
              <SidebarGroup key={group.label} className="p-1.5 pb-0">
                <SidebarGroupContent>
                  {groupIndex > 0 && <div className="mx-2.5 mb-1.5 border-t" />}
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-2.5 pt-0.5 pb-1">
                    {group.label}
                  </p>
                  <SidebarMenu>
                    {group.items.map((s) => (
                      <SidebarMenuItem key={s.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={activeSection === s.id}
                          className="h-8 transition-all duration-200 ease-in-out"
                        >
                          <Link
                            href={sectionHref(vehicleDetailId, s.id)}
                            replace
                            scroll={false}
                            prefetch={false}
                            onClick={closeMobileOnNav}
                            className="flex items-center gap-2.5"
                          >
                            <s.icon className="h-4 w-4 shrink-0" />
                            <span className="text-[13px]">{s.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))
          )}
        </SidebarContent>

        {/* The footer carries only what stops a car being booked, and only when
            it is true. Both facts are columns on the vehicle row itself, so
            neither asserts that some other record exists — everything richer
            (blockers, compliance, utilisation) is computed on the screen and
            belongs in its right rail, not in 280px an operator reads at a
            glance. Nothing shows on a healthy car, which is the point. */}
        {/* `pb-14`, not `p-3`: the v2 chrome floats its account button over the
            bottom-left corner of the sidebar, and at `p-3` this chip sits
            directly underneath it — visible enough to notice, not enough to
            read. The clearance is on this branch alone so the ordinary nav and
            the other two rails are untouched. */}
        <SidebarFooter className="p-3 pb-14">
          {!collapsed && railVehicle && (railVehicle.is_disposed || railVehicle.is_paused) && (
            <div className="flex flex-wrap gap-1.5">
              {railVehicle.is_disposed ? (
                <HeroChip tone="muted">Disposed</HeroChip>
              ) : (
                <HeroChip tone="warning">Paused</HeroChip>
              )}
            </div>
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    );
  }

  // --- Customer Record Mode ---
  //
  // The fourth scoped rail, and built from the same markup as the three above —
  // h-16 back-link header, title block, grouped nav, collapsed popover-free icon
  // list — so all four read as one piece of furniture wearing different
  // contents.
  if (isCustomerDetailPage && customerDetailId) {
    return (
      <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
        <SidebarHeader className="h-16">
          <div className="flex items-center w-full h-full px-2 transition-all duration-300 ease-in-out">
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/customers" className="flex items-center justify-center w-full h-8 rounded-md hover:bg-muted/50 transition-colors">
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">Back to customers</TooltipContent>
              </Tooltip>
            ) : (
              <Link href="/customers" className="flex items-center gap-2 h-8 px-1 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 shrink-0" />
                <span className="text-[13px]">All customers</span>
              </Link>
            )}
          </div>
        </SidebarHeader>

        {/* Who this record is — the identity of it, in the same slot Settings
            puts its own title. A name and a line of contact, never a status:
            the status has a column of its own on the far side of the screen. */}
        {!collapsed && (
          <div className="px-4 pt-4 pb-1">
            <h2 className="truncate text-sm font-semibold text-foreground">{customerRail.title}</h2>
            {customerRail.subtitle && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{customerRail.subtitle}</p>
            )}
          </div>
        )}

        <SidebarContent className="transition-all duration-300 ease-in-out gap-0">
          {collapsed ? (
            // Collapsed there is no room for group headings, so the eleven
            // sections flatten into one icon list with labels in tooltips —
            // what the rest of this sidebar does at this width.
            <SidebarGroup className="p-1.5">
              <SidebarMenu>
                {CUSTOMER_SECTIONS.map((s) => (
                  <SidebarMenuItem key={s.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SidebarMenuButton
                          asChild
                          isActive={activeCustomerSection === s.id}
                          className="h-8 transition-all duration-200 ease-in-out"
                        >
                          <Link
                            href={customerSectionHref(customerDetailId, s.id)}
                            replace
                            scroll={false}
                            prefetch={false}
                            onClick={closeMobileOnNav}
                          >
                            <s.icon className="h-4 w-4 shrink-0" />
                          </Link>
                        </SidebarMenuButton>
                      </TooltipTrigger>
                      <TooltipContent side="right">{s.label}</TooltipContent>
                    </Tooltip>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ) : (
            CUSTOMER_SECTION_GROUPS.map((group, groupIndex) => (
              <SidebarGroup key={group.label} className="p-1.5 pb-0">
                <SidebarGroupContent>
                  {groupIndex > 0 && <div className="mx-2.5 mb-1.5 border-t" />}
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-2.5 pt-0.5 pb-1">
                    {group.label}
                  </p>
                  <SidebarMenu>
                    {group.items.map((s) => (
                      <SidebarMenuItem key={s.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={activeCustomerSection === s.id}
                          className="h-8 transition-all duration-200 ease-in-out"
                        >
                          <Link
                            href={customerSectionHref(customerDetailId, s.id)}
                            replace
                            scroll={false}
                            prefetch={false}
                            onClick={closeMobileOnNav}
                            className="flex items-center gap-2.5"
                          >
                            <s.icon className="h-4 w-4 shrink-0" />
                            <span className="text-[13px]">{s.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))
          )}
        </SidebarContent>

        {/* The footer carries only what stops this person renting, and only when
            it is true — `customers.is_blocked`, a column on the row itself, so
            it asserts nothing about any other record. Everything richer (the
            global blocklist, an expired licence, an unpaid balance) is computed
            on the screen and belongs in its overview column, not in 280px an
            operator reads at a glance. Nothing shows on a customer in good
            standing, which is the point. */}
        <SidebarFooter className="p-3">
          {!collapsed && customerRail.blocked && (
            <div className="flex flex-wrap gap-1.5">
              <HeroChip tone="destructive">Blocked</HeroChip>
            </div>
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    );
  }

  // --- Settings Sidebar Mode ---
  if (isSettingsPage) {
    return (
      <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
        {/* Settings Header with Back Button */}
        <SidebarHeader className="h-16">
          <div className="flex items-center w-full h-full px-2 transition-all duration-300 ease-in-out">
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/" className="flex items-center justify-center w-full h-8 rounded-md hover:bg-muted/50 transition-colors">
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">Back to Dashboard</TooltipContent>
              </Tooltip>
            ) : (
              <Link href="/" className="flex items-center gap-2 h-8 px-1 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 shrink-0" />
                <span className="text-[13px]">Back</span>
              </Link>
            )}
          </div>
        </SidebarHeader>

        {/* Settings Title */}
        {!collapsed && (
          <div className="px-4 pt-4 pb-1">
            <h2 className="text-sm font-semibold text-foreground">Settings</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Configure your system</p>
          </div>
        )}

        {/* Search — hidden when sidebar is collapsed */}
        {!collapsed && (
          <div className="px-3 pt-2 pb-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={settingsSearch}
                onChange={(e) => setSettingsSearch(e.target.value)}
                placeholder="Search settings..."
                className="h-8 pl-8 pr-7 text-[12px]"
              />
              {settingsSearch && (
                <button
                  type="button"
                  onClick={() => setSettingsSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Settings Navigation */}
        <SidebarContent className="transition-all duration-300 ease-in-out gap-0">
          {(() => {
            const query = settingsSearch.trim().toLowerCase();
            const groupsWithMatches = settingsGroupsFor(tenantSlug)
              .map(group => ({
                ...group,
                items: group.items.filter(item =>
                  canViewSettings(item.value) &&
                  // Every settings tab the Integrations board now owns leaves
                  // this nav for the lean canary and that tenant alone —
                  // Payments, Messaging, Insurance, E-Signatures, Accounting,
                  // Tesla Fleet and INSHUR. Presentation only. Each of those
                  // tabs stays on main and stays the ONLY route by which the
                  // other 56 tenants can connect the thing behind it, because
                  // `/integrations` is notFound() for all of them.
                  //
                  // One shared predicate with the settings page's own mobile
                  // trigger row, on purpose: this list and that one drifting
                  // apart is what left E-Signatures clickable here while its
                  // body was already blanked.
                  !isSettingsTabHidden(item.value, tenantSlug) &&
                  (query === "" || item.label.toLowerCase().includes(query))
                ),
              }))
              .filter(group => group.items.length > 0);

            if (!collapsed && query !== "" && groupsWithMatches.length === 0) {
              return (
                <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
                  No settings match “{settingsSearch}”.
                </div>
              );
            }

            return groupsWithMatches.map((group, groupIndex) => {
              const visibleItems = group.items;
              const GroupIcon = visibleItems[0].icon;

              return (
                <SidebarGroup key={group.label} className={`p-1.5 pb-0 ${groupIndex === settingsTabGroups.length - 1 ? 'pb-16' : ''}`}>
                  {collapsed ? (
                    <Popover>
                      <SidebarMenu>
                        <SidebarMenuItem>
                          <PopoverTrigger asChild>
                            <SidebarMenuButton className="h-8 w-full transition-all duration-200 ease-in-out">
                              <GroupIcon className="h-4 w-4 shrink-0" />
                            </SidebarMenuButton>
                          </PopoverTrigger>
                        </SidebarMenuItem>
                      </SidebarMenu>
                      <PopoverContent side="right" align="start" sideOffset={8} className="w-52 p-1.5">
                        <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group.label}</p>
                        <div className="space-y-0.5">
                          {visibleItems.map(item => (
                            <Link
                              key={item.value}
                              href={`/settings?tab=${item.value}`}
                              replace
                              scroll={false}
                              prefetch={false}
                              onClick={closeMobileOnNav}
                              className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors hover:bg-accent ${
                                activeSettingsTab === item.value ? "bg-accent text-accent-foreground font-medium" : "text-foreground"
                              }`}
                            >
                              <item.icon className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{item.label}</span>
                            </Link>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <SidebarGroupContent>
                      {groupIndex > 0 && (
                        <div className="mx-2.5 mb-1.5 border-t" />
                      )}
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-2.5 pt-0.5 pb-1">{group.label}</p>
                      <SidebarMenu>
                        {visibleItems.map(item => (
                          <SidebarMenuItem key={item.value}>
                            <SidebarMenuButton
                              asChild
                              isActive={activeSettingsTab === item.value}
                              className="h-8 transition-all duration-200 ease-in-out"
                            >
                              <Link
                                href={`/settings?tab=${item.value}`}
                                replace
                                scroll={false}
                                prefetch={false}
                                onClick={closeMobileOnNav}
                                // A stable, tour-addressable handle on every
                                // settings nav row. The walkthrough needs to
                                // point at ONE row — "this is Branding" — and
                                // the only alternative was Radix's generated
                                // `[id$="-trigger-branding"]`, which belongs to
                                // the v1 TabsList this sidebar replaced and so
                                // matches nothing here. That dead selector is
                                // why the Booking-site step fell through to its
                                // other anchor: the whole Brand Identity card.
                                data-tour={`settings-tab-${item.value}`}
                                className="flex items-center gap-2.5"
                              >
                                <item.icon className="h-4 w-4 shrink-0" />
                                <span className="text-[13px]">{item.label}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  )}
                </SidebarGroup>
              );
            });
          })()}
        </SidebarContent>

        {/* Footer — dunning only */}
        <SidebarFooter className="p-1.5">
          <SidebarMenu>
            {/* The "Setup Mode · Nd left" and "Live" chips are gone by request.
                What stays is the dunning warning that shared the same slot: it
                is the only place a tenant inside the grace window is told their
                payment is due, and grace expiry is a pure clock event nothing
                else announces. Removing this branch would stop chasing tenants
                who owe money, and no visual review would catch it. */}
            {paymentDue && (
              <SidebarMenuItem>
                {collapsed ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-center h-8">
                        <AlertTriangle
                          className={`h-4 w-4 ${paymentDueCritical ? "text-red-500" : "text-amber-500"}`}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {`${paymentDueLabel} ${paymentDueDetail}`}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium ${paymentDueClass}`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>{paymentDueLabel}</span>
                    <span className="opacity-70">{paymentDueDetail}</span>
                  </div>
                )}
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    );
  }

  // --- Main Sidebar Mode ---
  return (
    <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
      {/* Organization switcher at the very top */}
      <SidebarHeader className="p-1.5 pt-4">
        <OrgSwitcher collapsed={collapsed} />
      </SidebarHeader>

      {/* Search mode takes the whole rail: the results land where the field
          that produced them is, instead of behind a modal over the page. */}
      {searchScene && !collapsed ? (
        <SidebarContent className="gap-0 pt-1">
          <SidebarSearchScene
            query={searchSeed}
            onQueryChange={setSearchSeed}
            onClose={() => {
              setSearchScene(false);
              setSearchSeed("");
            }}
          />
        </SidebarContent>
      ) : (
      /* Navigation — fingertip items + drill-in groups */
      <SidebarContent className="gap-0 pt-1 transition-all duration-300 ease-in-out">
        {/* Search — prominent field at the very top */}
        <SidebarGroup className="p-1.5 pb-1">
          <SidebarGroupContent>
            {collapsed ? (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setSearchOpen(true)}
                    tooltip="Search"
                    className="h-8 transition-colors"
                  >
                    <Search className="h-4 w-4 shrink-0" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            ) : (
              /* A real field, not a button that opens one. The first keystroke
                 swaps the rail for the search scene and is carried across in
                 `searchSeed`, so nothing typed here is lost. */
              <div
                className={[
                  "relative flex h-8 w-full items-center gap-2 overflow-hidden rounded-lg px-2.5",
                  // A real border rather than a ring, so the inner glass layers
                  // below can be inset by a pixel and leave the edge intact.
                  "border border-primary/25 bg-primary/[0.07] backdrop-blur-[2px]",
                  // The depth, in one shadow: a lit inner top edge, a shaded
                  // inner floor, a tight contact shadow and a soft lift beneath.
                  // Together they read as a raised pane rather than a flat tint.
                  "shadow-[inset_0_1px_0_rgba(255,255,255,0.65),inset_0_-1px_0_rgba(0,0,0,0.05),0_1px_1px_rgba(0,0,0,0.04),0_6px_14px_-8px_rgba(0,0,0,0.20)]",
                  "transition-colors focus-within:border-primary/50 focus-within:bg-primary/10 hover:bg-primary/10",
                ].join(" ")}
              >
                <style>{SHINE_KEYFRAMES}</style>
                {/* The glass itself: a sheen resting in the upper half, and a
                    blurred specular band crossing every four seconds. Both are
                    inset a pixel to keep off the border, take no clicks, and the
                    moving one drops out entirely under reduced motion. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-px top-px h-1/2 rounded-t-lg bg-gradient-to-b from-white/30 to-transparent dark:from-white/[0.07]"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-px left-px w-full -skew-x-[18deg] animate-[shine-sweep_4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent blur-[3px] motion-reduce:hidden dark:via-white/20"
                />
                {/* Trax's own mark rather than a magnifier: the field is the
                    portal's one "ask it anything" control, and its face says
                    that faster than any label could. `currentColor` because
                    TraxIcon paints through SVG presentation attributes, where a
                    var() would never resolve. */}
                <span className="flex shrink-0 items-center justify-center text-primary">
                  <TraxIcon size={16} color="currentColor" />
                </span>
                <div className="relative min-w-0 flex-1 overflow-hidden">
                  <input
                    type="text"
                    value={searchSeed}
                    onChange={(e) => {
                      setSearchSeed(e.target.value);
                      setSearchScene(true);
                    }}
                    onFocus={() => {
                      setSearchFocused(true);
                      // Clicking the field is the whole gesture — the rail
                      // swaps to results rather than a modal opening over it.
                      setSearchScene(true);
                    }}
                    onBlur={() => setSearchFocused(false)}
                    /* The visible hint is the overlay below — a native
                       placeholder can't carry a caret of its own. */
                    placeholder=""
                    aria-label="Search"
                    className="w-full bg-transparent text-[13px] text-foreground outline-none"
                  />
                  {!searchSeed && (
                    <span
                      aria-hidden
                      /* Clipped by the wrapper and faded over the last 14px, so a
                         long hint dissolves rather than running into the ⌘K badge. */
                      className="pointer-events-none absolute inset-y-0 left-0 flex items-center whitespace-nowrap pr-2 text-[13px] leading-none text-muted-foreground [mask-image:linear-gradient(to_right,black_calc(100%-14px),transparent)]"
                    >
                      {typedHint}
                      {!searchFocused && (
                        <span className="ml-0.5 inline-block h-3 w-px animate-pulse bg-muted-foreground/80" />
                      )}
                    </span>
                  )}
                </div>
                <kbd className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">⌘K</kbd>
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Section tabs: Portal / Website. Hidden entirely from a manager
            without the `cms` grant — v1 hides "Website Content" from them too. */}
        {canSeeCms && !collapsed && (
          <div className="px-1.5 pb-1 pt-0.5">
            <div className="relative grid grid-cols-2 rounded-lg p-1">
              {/* Sliding active pill */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-md bg-background shadow-sm ring-1 ring-primary/20 transition-transform duration-300 ease-out"
                style={{ transform: view === "cms" ? "translateX(100%)" : "translateX(0)" }}
              />
              {([
                { key: "admin", label: "Portal", kbd: "⌥1" },
                { key: "cms", label: "Website", kbd: "⌥2" },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => switchView(tab.key)}
                  className={`relative z-10 flex items-center justify-between gap-1.5 cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    view === tab.key
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{tab.label}</span>
                  <kbd
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors ${
                      view === tab.key
                        ? "bg-primary/15 text-primary"
                        : "bg-foreground/10 text-foreground/70"
                    }`}
                  >
                    {tab.kbd}
                  </kbd>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Collapsed rail equivalent of the tab strip. Without it the whole
            Website section — v1's "Website Content" entry — is unreachable from
            the rail, since the strip above needs the full width. */}
        {canSeeCms && collapsed && (
          <SidebarGroup className="p-1.5 pb-1">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => switchView(view === "cms" ? "admin" : "cms")}
                    isActive={view === "cms"}
                    tooltip={view === "cms" ? "Back to Portal" : "Website"}
                    className="h-8 transition-colors"
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* The collapsed rail's search dialog. Mounted unconditionally; its
            underlying query is `enabled: debouncedQuery.length > 0`, so a
            closed one costs nothing. */}
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />

        {view === "cms" ? (
          /* Website — the site's pages, each with its live/off switch. Anything
             that is not a page (blog posts, promos, branding, SEO) is managed
             from the Website dashboard instead. */
          <SidebarGroup className="p-1.5 pb-0">
            <SidebarGroupContent>
              <SidebarMenu>
                {/* The one non-page row: everything that isn't a page — blog
                    posts, promos, branding, SEO — is managed from here. */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === "/cms"}
                    tooltip={collapsed ? "Dashboard" : undefined}
                    className="h-8 transition-colors"
                  >
                    <Link href="/cms" onClick={closeMobileOnNav}>
                      <LayoutGrid className="h-4 w-4 shrink-0" />
                      <span
                        className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}
                      >
                        Dashboard
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {!collapsed && <div className="mx-2 my-1.5 h-px bg-sidebar-border/60" />}

                {cmsPageNav.map((item) => {
                  const editing = isCmsActive(item.href);
                  return (
                  <Fragment key={item.id}>
                  <SidebarMenuItem className="flex items-center gap-1">
                    <SidebarMenuButton
                      asChild
                      isActive={isCmsActive(item.href)}
                      tooltip={collapsed ? item.name : undefined}
                      className="h-8 min-w-0 flex-1 transition-colors"
                    >
                      <Link href={item.href} onClick={closeMobileOnNav}>
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span
                          className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"} ${
                            !collapsed && !item.published ? "text-muted-foreground" : ""
                          }`}
                        >
                          {item.name}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                    {/* Trailing status button — green when the page is live on
                        the website, grey when it is not. Kept outside the Link
                        so toggling a page never also navigates to it. */}
                    {!collapsed && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={item.published}
                            aria-label={`${item.published ? "Unpublish" : "Publish"} ${item.name}`}
                            disabled={isPublishing || isUnpublishing}
                            onClick={() =>
                              item.published ? unpublishPage(item.id) : publishPage(item.id)
                            }
                            className={`mr-1 h-3.5 w-3.5 shrink-0 cursor-pointer rounded-full ring-offset-1 ring-offset-sidebar transition-all hover:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                              item.published
                                ? "bg-green-500 hover:ring-green-500/40"
                                : "bg-muted-foreground/25 hover:ring-muted-foreground/30"
                            }`}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {item.published ? "Live — click to unpublish" : "Off — click to publish"}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </SidebarMenuItem>

                  {/* The page's own sections, dropped under it while you are
                      editing it. They are reported by the embedded website
                      rather than guessed from a spec, so the list is always
                      exactly what is on the screen — and it replaces a second
                      rail that used to sit inside the editor, repeating this
                      nav a few pixels to its right. */}
                  {editing && !collapsed && outlineSections.length > 0 && (
                    <SidebarMenuItem className="block">
                      <div className="mb-1 ml-[19px] border-l border-sidebar-border pl-2">
                        {outlineSections.map((section) => (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => outlinePick?.(section.id)}
                            className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1 text-left text-[12px] leading-tight transition-colors ${
                              outlineActiveId === section.id
                                ? "font-medium text-primary"
                                : "text-sidebar-foreground/55 hover:text-foreground"
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate">{section.label}</span>
                            {outlineDirtyIds.includes(section.id) && (
                              <span className="size-1 shrink-0 rounded-full bg-amber-500" />
                            )}
                          </button>
                        ))}
                      </div>
                    </SidebarMenuItem>
                  )}
                  </Fragment>
                  );
                })}

                {/* Site Settings, kept from v1's Website list. The source
                    worktree filters it out of the page rail because it has no
                    publish state, but `/cms/site-settings` is a real route this
                    branch already offers — dropping the row would strand it. */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isCmsActive("/cms/site-settings")}
                    tooltip={collapsed ? "Site Settings" : undefined}
                    className="h-8 transition-colors"
                  >
                    <Link href="/cms/site-settings" onClick={closeMobileOnNav}>
                      <Settings className="h-4 w-4 shrink-0" />
                      <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                        Site Settings
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Apply form — the public "apply to rent" form on the website.
                    Its editor is a settings route (`/settings/apply-form`) and
                    STAYS one; only the way in moves here, because what it
                    configures is a page on the site, not a portal preference.
                    Until now it had no entry point anywhere in either sidebar:
                    the route answered a typed URL and nothing linked to it.

                    Gated on the same predicate the page itself uses. The apply
                    form feeds Leads, `/settings/apply-form` calls notFound()
                    when `leads` is hidden, and the form is only rendered by the
                    v1 booking site — so a row here for a lean tenant would be a
                    link to a 404. That makes it dark for `northwind` today,
                    which is the only tenant on this rail; it lights up on its
                    own for the next tenant that has Leads. A row that 404s
                    would be worse than a row that waits. */}
                {!isAreaHidden("leads", tenantSlug) && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === "/settings/apply-form"}
                      tooltip={collapsed ? "Apply form" : undefined}
                      className="h-8 transition-colors"
                    >
                      <Link href="/settings/apply-form" onClick={closeMobileOnNav}>
                        <UserPlus className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                          Apply form
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            {/* Dashboard + always-available utilities */}
            <SidebarGroup className="p-1.5 pb-0">
              <SidebarGroupContent>
                <SidebarMenu>
                  {/* Dashboard */}
                  <SidebarMenuItem className="relative">
                    <SidebarMenuButton
                      asChild
                      isActive={isActive("/")}
                      tooltip={collapsed ? "Dashboard" : undefined}
                      className="h-8 transition-colors"
                    >
                      <Link href="/" onClick={closeMobileOnNav}>
                        <LayoutGrid className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Dashboard</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Integrations — from the source worktree. Not in
                      ROUTE_TO_TAB, so unmapped means allowed for every role,
                      exactly as `getTabKeyForRoute` treats it. */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive("/integrations")}
                      tooltip={collapsed ? "Integrations" : undefined}
                      className="h-8 transition-colors"
                    >
                      <Link href="/integrations" onClick={closeMobileOnNav}>
                        <Plug className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Integrations</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Billing — one row for the tenant's whole account with
                      Drive247: the plan, its invoices, and the credit wallet.

                      These were two rail entries and are now one. They are the
                      same question asked twice ("what do I owe / what have I
                      got left"), and `/subscription` already rendered a Tabs
                      strip, so Credits joins Plan and Invoices as a third tab
                      rather than living somewhere else entirely.

                      Credits was previously under Finance, beside Payments,
                      Invoices and Fines. That was wrong in a way worth naming:
                      those are money between the operator and their RENTERS,
                      while `/credits` is `tenant_credit_wallets` — credit the
                      operator buys FROM US. Same word, opposite direction.

                      `/credits` still resolves; it is not orphaned. This row
                      just stops being the way in. */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive("/subscription") || isActive("/credits")}
                      tooltip={collapsed ? "Billing" : undefined}
                      className="h-8 transition-colors"
                    >
                      <Link href="/subscription" onClick={closeMobileOnNav}>
                        <Crown className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Billing</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Welcome pack, kept from v1 — the source worktree dropped
                      it, but `/welcome` is a live route this branch's v1 rail
                      links to, so removing the row would strand it.
                      Deliberately NOT in ROUTE_TO_TAB: unmapped routes are
                      allowed for every role, so a `viewer` or a restricted
                      `manager` keeps it. They hit the same confusion as a head
                      admin — gating the guide would silence exactly the people
                      most likely to need it.

                      Hidden from the lean canary only. This is the rail
                      northwind actually renders, so this is the gate the owner
                      sees; the v1 rail below carries the identical predicate so
                      the two cannot drift. Everyone else keeps the row — 16
                      operators across 14 tenants have read the pack. */}
                  {!isAreaHidden("welcome", tenantSlug) && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive("/welcome")}
                      tooltip={collapsed ? "Welcome Pack" : undefined}
                      className="h-8 transition-colors"
                    >
                      <Link href="/welcome" onClick={closeMobileOnNav}>
                        <BookOpen className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Welcome Pack</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  )}

                  {/* Ask AI — only when the caller owns a Trax instance to open. */}
                  {onAskAI && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={onAskAI}
                        tooltip={collapsed ? "Ask AI" : undefined}
                        className="h-8 transition-colors"
                      >
                        <Sparkles className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>Ask AI</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* Separator — divides quick actions from the main navigation */}
            <div className="mx-3 my-1.5 h-px bg-sidebar-border/60" />

            {drillGroup ? (
              /* Drill-in view — replaces the nav with the selected section */
              <SidebarGroup className="p-1.5 pb-0">
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        onClick={() => setDrillGroup(null)}
                        tooltip={collapsed ? "Back" : undefined}
                        className="h-8 transition-colors"
                      >
                        <ArrowLeft className="h-4 w-4 shrink-0" />
                        <span className={`text-[13px] font-medium ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                          {drillGroup.label}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    {drillGroup.items.map((item) => (
                      <SidebarMenuItem key={item.href} className="relative">
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.href)}
                          tooltip={collapsed ? item.name : undefined}
                          className="h-8 transition-colors"
                        >
                          <Link href={item.href} onClick={closeMobileOnNav} className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2 min-w-0">
                              <item.icon className="h-4 w-4 shrink-0" />
                              <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                                {item.name}
                              </span>
                            </div>
                            {!collapsed && item.badge !== undefined && item.badge > 0 && (
                              <span className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none rounded-full shrink-0 ${BADGE_TONE_CLASS[item.badgeTone ?? "destructive"]}`}>
                                {item.badge}
                              </span>
                            )}
                            {collapsed && item.badge !== undefined && item.badge > 0 && (
                              <span className={`absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none rounded-full ${BADGE_TONE_CLASS[item.badgeTone ?? "destructive"]}`}>
                                {item.badge > 9 ? '9+' : item.badge}
                              </span>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : (
              <>
                {/* Top-level fingertip items — always visible */}
                <SidebarGroup className="p-1.5 pb-0">
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {topLevel.map((item) => (
                        // `data-tour` is the first-rental tour's anchor (see
                        // `lib/first-rental-tour.ts`). An attribute rather than a
                        // wrapper element, so it changes nothing about layout,
                        // and derived from the href so it cannot drift from the
                        // route: /vehicles → nav-vehicles. The tour also carries
                        // an href-based fallback selector, so losing this line
                        // degrades it rather than breaking it.
                        <SidebarMenuItem
                          key={item.href}
                          className="relative"
                          data-tour={`nav-${item.href.replace(/^\//, "")}`}
                        >
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.href)}
                            tooltip={collapsed ? item.name : undefined}
                            className="h-8 transition-colors"
                          >
                            <Link href={item.href} onClick={closeMobileOnNav} className="flex items-center justify-between w-full">
                              <div className="flex items-center gap-2 min-w-0">
                                <item.icon className="h-4 w-4 shrink-0" />
                                <span className={`text-[13px] transition-all duration-200 ease-in-out ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                                  {item.name}
                                </span>
                              </div>
                              {!collapsed && item.badge !== undefined && item.badge > 0 && (
                                <span className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold leading-none rounded-full shrink-0 animate-in fade-in ${BADGE_TONE_CLASS[item.badgeTone ?? "destructive"]}`}>
                                  {item.badge}
                                </span>
                              )}
                              {collapsed && item.badge !== undefined && item.badge > 0 && (
                                <span className={`absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none rounded-full animate-in fade-in ${BADGE_TONE_CLASS[item.badgeTone ?? "destructive"]}`}>
                                  {item.badge > 9 ? '9+' : item.badge}
                                </span>
                              )}
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>

                {/* Second-level groups — drill into the section on click */}
                {(groups.length > 0 || moreItems.length > 0) && (
                  <SidebarGroup className="p-1.5 pt-1 pb-2">
                    {!collapsed && (
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-2.5 pb-1">
                        More
                      </p>
                    )}
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {/* Flat rows first, then the drill-downs. These are
                            ordinary links, not groups — they were lifted out of
                            Bookings, Finance and Records so they cost no click,
                            but they are not important enough to dilute the
                            three items above. Same `data-tour` scheme as the
                            top-level items. */}
                        {moreItems.map((item) => (
                          <SidebarMenuItem
                            key={item.href}
                            className="relative"
                            data-tour={`nav-${item.href.replace(/^\//, "")}`}
                          >
                            <SidebarMenuButton
                              asChild
                              isActive={isActive(item.href)}
                              tooltip={collapsed ? item.name : undefined}
                              className="h-8 transition-colors"
                            >
                              <Link href={item.href} onClick={closeMobileOnNav}>
                                <item.icon className="h-4 w-4 shrink-0" />
                                <span className={`text-[13px] ${collapsed ? "sr-only opacity-0 w-0" : "truncate opacity-100"}`}>
                                  {item.name}
                                </span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                        {groups.map((group) => {
                          const GroupIcon = group.icon;
                          const hasActive = group.items.some((i) => isActive(i.href));
                          const totalBadge = group.items.reduce((s, i) => s + (i.badge || 0), 0);
                          return (
                            // See the `data-tour` note on the top-level items
                            // above; same idea, derived from the group label —
                            // "Records" → nav-group-records. Nothing in the
                            // first-rental tour points here TODAY (its three
                            // stops are Vehicles, Customers and Rentals), but
                            // any future coach mark that wants to name a section
                            // needs a handle on it, and `resolveStops` drops a
                            // step or a note whose anchor is absent — so a
                            // manager whose permissions hide a group is never
                            // told to look somewhere they cannot go.
                            <SidebarMenuItem
                              key={group.label}
                              className="relative"
                              data-tour={`nav-group-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                            >
                              <SidebarMenuButton
                                onClick={() => setDrillGroup(group)}
                                isActive={hasActive}
                                tooltip={collapsed ? group.label : undefined}
                                className="h-8 w-full transition-colors"
                              >
                                {collapsed ? (
                                  <GroupIcon className="h-4 w-4 shrink-0" />
                                ) : (
                                  <>
                                    <div className="flex items-center gap-2 min-w-0">
                                      <GroupIcon className="h-4 w-4 shrink-0" />
                                      <span className="text-[13px] truncate">{group.label}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {totalBadge > 0 && <span className="w-1.5 h-1.5 rounded-full bg-destructive" />}
                                      <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                                    </div>
                                  </>
                                )}
                              </SidebarMenuButton>
                              {collapsed && totalBadge > 0 && (
                                <span className="absolute -top-1 -right-1 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold leading-none text-white bg-destructive rounded-full pointer-events-none">
                                  {totalBadge > 9 ? "9+" : totalBadge}
                                </span>
                              )}
                            </SidebarMenuItem>
                          );
                        })}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                )}
              </>
            )}
          </>
        )}
      </SidebarContent>
      )}

      {/* Pinned Footer */}
      <SidebarFooter className="p-1.5">
        {/* Dunning warning. Same slot, same wording and same escalation as v1 —
            see the settings-mode footer above for why this one branch stays
            when the "Setup Mode" and "Live" chips went. */}
        {paymentDue && (
          <SidebarMenu>
            <SidebarMenuItem>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-center h-8">
                      <AlertTriangle
                        className={`h-4 w-4 ${paymentDueCritical ? "text-red-500" : "text-amber-500"}`}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {`${paymentDueLabel} ${paymentDueDetail}`}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium ${paymentDueClass}`}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>{paymentDueLabel}</span>
                  <span className="opacity-70">{paymentDueDetail}</span>
                </div>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        )}

        {/* Promo / announcement slot (feature releases, training, promotions) */}
        {!collapsed && (
          <div className="px-0.5 pb-1.5">
            <SidebarPromo />
          </div>
        )}

        {/* Local-only dev affordance: a link to the /dev page. Self-gating:
            NODE_ENV, then localhost, then the northwind slug — see
            dev-section.tsx. Renders null in every other case, and is dropped
            from a production build entirely. */}
        {!collapsed && <DevSection />}

        <SidebarMenu>
          {/* Profile row — whole row opens the user menu, and carries the
              customiser trigger beside it. */}
          <SidebarMenuItem>
            {collapsed ? (
              <div className="flex justify-center py-1">
                <UserMenuV2 />
              </div>
            ) : (
              <UserMenuV2 variant="row" />
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />

      {/* Given the RAW nav, not the arranged one — the customiser has to show
          the user everything they could have, including what they've hidden. */}
      <SidebarCustomizerDialog
        open={customizerOpen}
        onOpenChange={setCustomizerOpen}
        topLevel={rawTopLevel}
        groups={rawGroups}
      />
    </Sidebar>
  );
}
