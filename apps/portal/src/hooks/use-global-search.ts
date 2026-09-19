import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  searchService,
  emptySearchResults,
  type RecordCategory,
  type SearchInclude,
  type SearchResult,
} from "@/lib/search-service";
import { useTenant } from "@/contexts/TenantContext";
import { usePortalDestinationContext } from "@/hooks/use-portal-destination-context";
import { useSupportClient } from "@/hooks/use-support-messaging";
import { isInsuranceExemptTenant } from "@/config/tenant-config";
import { isAreaHiddenForLean, isSettingsTabHiddenForLean } from "@/lib/lean-areas";
import { searchPortalDestinations, suggestedDestinations, type PortalDestination } from "@/lib/search/portal-destinations";
import { loadRecentSearches, rememberRecentSearch } from "@/lib/search/recent-searches";
import { SUPPORT_ROUTE } from "@/lib/support-route";

export interface SearchGroup {
  key: string;
  title: string;
  items: SearchResult[];
}

export interface SearchFilterOption {
  value: string;
  label: string;
}

/** Record groups, in the order they are listed. `filter` is the dropdown value that shows only that group. */
export const RECORD_GROUPS: readonly { key: RecordCategory; title: string; filter: string }[] = [
  { key: "customers", title: "Customers", filter: "customers" },
  { key: "vehicles", title: "Vehicles", filter: "vehicles" },
  { key: "rentals", title: "Rentals", filter: "rentals" },
  { key: "payments", title: "Payments", filter: "payments" },
  { key: "invoices", title: "Invoices", filter: "invoices" },
  { key: "fines", title: "Fines", filter: "fines" },
  { key: "insurance", title: "Insurance", filter: "insurance" },
  { key: "plates", title: "Plates", filter: "plates" },
  { key: "insurances", title: "Insurances", filter: "insurances" },
  { key: "agreements", title: "Agreements", filter: "agreements" },
  { key: "team", title: "Team", filter: "team" },
  { key: "locations", title: "Locations", filter: "locations" },
  { key: "promos", title: "Promo codes", filter: "promos" },
  { key: "extras", title: "Extras", filter: "extras" },
  { key: "reminders", title: "Reminders", filter: "reminders" },
  { key: "leads", title: "Leads", filter: "leads" },
  { key: "blog", title: "Blog posts", filter: "blog" },
  { key: "owners", title: "Vehicle owners", filter: "owners" },
  { key: "expenses", title: "Expenses", filter: "expenses" },
  { key: "enquiries", title: "Enquiries", filter: "enquiries" },
  { key: "customerDocs", title: "Customer documents", filter: "customerDocs" },
  { key: "vehicleDocs", title: "Vehicle documents", filter: "vehicleDocs" },
  { key: "blockedDates", title: "Blocked dates", filter: "blockedDates" },
  { key: "webPages", title: "Website pages", filter: "webPages" },
  { key: "sitePromos", title: "Website promotions", filter: "sitePromos" },
  { key: "faqs", title: "FAQs", filter: "faqs" },
  { key: "testimonials", title: "Reviews", filter: "testimonials" },
  { key: "emailTemplates", title: "Email templates", filter: "emailTemplates" },
  { key: "agreementTemplates", title: "Agreement templates", filter: "agreementTemplates" },
  { key: "ownerPayouts", title: "Owner payouts", filter: "ownerPayouts" },
  { key: "auditLogs", title: "Audit log", filter: "auditLogs" },
];

const DESTINATION_NOUN: Record<string, string> = { Pages: "Page", Settings: "Setting", Integrations: "Integration" };

const toResult = (d: PortalDestination, category: string): SearchResult => ({
  id: d.id,
  title: d.title,
  subtitle: d.description,
  category,
  url: d.href,
  icon: d.icon,
  badges: [DESTINATION_NOUN[category] ?? category],
  description: d.description,
  details: [{ label: "Opens", value: d.href }],
  openLabel: `Open ${(DESTINATION_NOUN[category] ?? category).toLowerCase()}`,
});

const SUPPORT_STATUS: Record<string, string> = { open: "Open", in_progress: "In progress", closed: "Closed" };

export const useGlobalSearch = () => {
  const { tenant } = useTenant();
  const ctx = usePortalDestinationContext();
  const support = useSupportClient();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Debounce search query (reduced to 250ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setSelectedIndex(-1); // Reset selection when query changes
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  /**
   * Which record groups this user may open — the same page and settings rules
   * the navigation applies. A group left out is never queried or offered.
   */
  const hideInsurance = isInsuranceExemptTenant(tenant?.id);
  const route = ctx.canAccessRoute;
  const settingsTab = (tab: string) => ctx.canViewSettings(tab) && !isSettingsTabHiddenForLean(tab, ctx.lean);
  const area = (a: Parameters<typeof isAreaHiddenForLean>[0]) => !isAreaHiddenForLean(a, ctx.lean);
  const include: SearchInclude = {
    customers: route("/customers"),
    vehicles: route("/vehicles"),
    rentals: route("/rentals"),
    payments: route("/payments"),
    invoices: route("/invoices"),
    fines: route("/fines"),
    insurance: !hideInsurance && route("/insurance"),
    plates: route("/plates"),
    insurances: route("/insurances"),
    agreements: route("/agreements"),
    team: ctx.isHeadAdmin,
    locations: settingsTab("locations"),
    promos: settingsTab("promos"),
    extras: settingsTab("extras"),
    reminders: area("reminders") && route("/reminders"),
    leads: ctx.flags.lead_management_enabled === true && area("leads") && route("/leads"),
    blog: route("/cms"),
    owners: ctx.flags.vehicle_owners_enabled === true && area("owners") && route("/vehicle-owners"),
    expenses: area("expenses") && route("/expenses"),
    enquiries: area("enquiries") && route("/enquiries"),
    customerDocs: route("/customers"),
    vehicleDocs: route("/vehicles"),
    blockedDates: route("/blocked-dates"),
    webPages: route("/cms"),
    sitePromos: route("/cms"),
    faqs: route("/cms"),
    testimonials: route("/cms"),
    emailTemplates: settingsTab("templates"),
    agreementTemplates: settingsTab("templates"),
    ownerPayouts: ctx.flags.vehicle_owners_enabled === true && area("owners") && route("/owner-payouts"),
    auditLogs: route("/audit-logs"),
  };
  const includeKey = RECORD_GROUPS.map((g) => (include[g.key] ? "1" : "0")).join("");

  // Records (database)
  const {
    data: records,
    isLoading: recordsLoading,
    error,
  } = useQuery({
    queryKey: ["global-search", debouncedQuery, entityFilter, tenant?.id, tenant?.currency_code, includeKey],
    queryFn: () => searchService.searchAll(debouncedQuery, entityFilter, tenant?.id, tenant?.currency_code || 'USD', include),
    enabled: debouncedQuery.length > 0 && entityFilter !== "pages" && entityFilter !== "support",
    staleTime: 30000, // 30 seconds
  });

  // Support tickets — through the same messaging endpoint the Support page
  // uses, which applies the user's own permissions. v2 portal only, where
  // Support exists.
  const supportAllowed = ctx.v2Chrome && support.enabled;
  const { data: supportTickets = [], isLoading: supportLoading } = useQuery({
    queryKey: ["global-search-support", debouncedQuery, support.scope],
    queryFn: async (): Promise<SearchResult[]> => {
      const data = await support.call("list", { search: debouncedQuery.trim().slice(0, 120), status: "", offset: 0 });
      return ((data?.tickets ?? []) as { id: string; reference: string; summary: string; status: string; updated_at: string }[])
        .slice(0, 5)
        .map((t) => ({
          id: t.id,
          title: t.summary || t.reference,
          subtitle: [t.reference, SUPPORT_STATUS[t.status] ?? t.status, t.updated_at ? `updated ${t.updated_at.split("T")[0]}` : null]
            .filter(Boolean)
            .join(" • "),
          category: "Support tickets",
          url: `${SUPPORT_ROUTE}?ticket=${encodeURIComponent(t.id)}`,
          icon: "life-buoy",
          badges: ["Support ticket", SUPPORT_STATUS[t.status] ?? t.status].filter(Boolean),
          openLabel: "Open ticket",
          details: [
            { label: "Reference", value: t.reference },
            { label: "Status", value: SUPPORT_STATUS[t.status] ?? t.status },
            ...(t.updated_at ? [{ label: "Updated", value: t.updated_at.split("T")[0] }] : []),
          ],
        }));
    },
    enabled: supportAllowed && debouncedQuery.trim().length >= 3 && (entityFilter === "all" || entityFilter === "support"),
    staleTime: 30000,
    retry: false,
  });

  // Pages, settings and integrations: instant, no network.
  const destinations = useMemo(
    () =>
      entityFilter === "all" || entityFilter === "pages"
        ? searchPortalDestinations(debouncedQuery, ctx)
        : { pages: [], settings: [], integrations: [] },
    // ctx is rebuilt each render; the query and filter are what change results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedQuery, entityFilter, ctx.v2Chrome, ctx.integrationsBoard, ctx.lean, ctx.isHeadAdmin, JSON.stringify(ctx.flags)],
  );

  // Before anything is typed: what you opened last, then where people go most.
  const [recent, setRecent] = useState<SearchResult[]>([]);
  useEffect(() => {
    setRecent(loadRecentSearches());
  }, []);
  const remember = useCallback((result: SearchResult) => {
    setRecent(rememberRecentSearch(result));
  }, []);

  const recordResults = records ?? emptySearchResults();
  const emptyStateGroups: SearchGroup[] = [
    { key: "recent", title: "Recent", items: recent },
    {
      key: "suggested",
      title: "Suggested",
      items: suggestedDestinations(ctx).map((d) => toResult(d, "Pages")).filter((s) => !recent.some((r) => r.url === s.url)),
    },
  ].filter((g) => g.items.length > 0);

  const groups: SearchGroup[] = [
    { key: "pages", title: "Pages", items: destinations.pages.map((d) => toResult(d, "Pages")) },
    { key: "settings", title: "Settings", items: destinations.settings.map((d) => toResult(d, "Settings")) },
    { key: "integrations", title: "Integrations", items: destinations.integrations.map((d) => toResult(d, "Integrations")) },
    { key: "support", title: "Support tickets", items: supportTickets },
    ...RECORD_GROUPS.filter((g) => include[g.key]).map((g) => ({ key: g.key, title: g.title, items: recordResults[g.key] })),
  ].filter((g) => g.items.length > 0);

  /** What the list shows: matches once something is typed, recents and suggestions before that. */
  const visibleGroups = debouncedQuery.length > 0 ? groups : emptyStateGroups;

  // The dropdown offers only what this user can search.
  const filterOptions: SearchFilterOption[] = [
    { value: "all", label: "All" },
    { value: "pages", label: "Pages & settings" },
    ...(supportAllowed ? [{ value: "support", label: "Support tickets" }] : []),
    ...RECORD_GROUPS.filter((g) => include[g.key]).map((g) => ({ value: g.filter, label: g.title })),
  ];

  const isLoading =
    debouncedQuery.length > 0 &&
    ((recordsLoading && entityFilter !== "pages" && entityFilter !== "support") ||
      (supportLoading && supportAllowed && debouncedQuery.trim().length >= 3 && (entityFilter === "all" || entityFilter === "support")));

  const openSearch = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setEntityFilter("all");
    setSelectedIndex(-1);
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    setSelectedIndex(-1);
  }, []);

  // Flattened in exactly the order the groups are shown, so the arrow keys
  // move through the list the user sees.
  const allResults = visibleGroups.flatMap((g) => g.items);
  const totalResults = debouncedQuery.length > 0 ? groups.flatMap((g) => g.items).length : 0;
  // The first row is highlighted until the arrows move, so the panel beside the
  // list always has something to show.
  const activeIndex = allResults.length === 0 ? -1 : Math.min(Math.max(selectedIndex, 0), allResults.length - 1);
  const selectedResult = activeIndex >= 0 ? allResults[activeIndex] : null;

  // Navigation helpers
  const navigateUp = useCallback(() => {
    setSelectedIndex(prev => prev > 0 ? prev - 1 : allResults.length - 1);
  }, [allResults.length]);

  const navigateDown = useCallback(() => {
    setSelectedIndex(prev => prev < allResults.length - 1 ? prev + 1 : 0);
  }, [allResults.length]);

  const getSelectedResult = useCallback(() => {
    if (allResults.length === 0) return null;
    return allResults[Math.min(Math.max(selectedIndex, 0), allResults.length - 1)] ?? null;
  }, [allResults, selectedIndex]);

  return {
    query,
    setQuery,
    groups: visibleGroups,
    filterOptions,
    recent,
    remember,
    selectedResult,
    activeIndex,
    isLoading,
    error,
    isOpen,
    openSearch,
    closeSearch,
    clearSearch,
    totalResults,
    allResults,
    hasQuery: debouncedQuery.length > 0,
    entityFilter,
    setEntityFilter,
    selectedIndex,
    setSelectedIndex,
    navigateUp,
    navigateDown,
    getSelectedResult,
  };
};
