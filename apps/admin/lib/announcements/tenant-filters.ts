/**
 * Tenant picker filters for the Announcements "Specific tenants" audience.
 *
 * The picker must answer "who am I choosing?" exactly the way the Rental
 * Companies list does, so every predicate here mirrors that page
 * (apps/admin/app/admin/(protected)/rentals/page.tsx). It filters client-side
 * over one read, which is what makes "Select all matching" exact and instant.
 *
 * Pure and RELATIVE imports only: the scratchpad node tests bundle this file
 * without the app's `@/` alias.
 */

// ─── Rows ────────────────────────────────────────────────────────────────────

/** The only tenant columns the picker reads (tenants has ~270 columns). */
export const PICKER_TENANT_COLUMNS = 'id, slug, company_name, admin_name, contact_email, status, tenant_type, created_at';

export interface PickerTenant {
  id: string;
  slug: string;
  company_name: string;
  admin_name: string | null;
  contact_email: string | null;
  /** 'active' | 'suspended' | 'trial' (tenants.valid_status). */
  status: string;
  /** 'production' | 'test' | null. */
  tenant_type: string | null;
  created_at: string;
}

// ─── Subscription buckets: VERBATIM copy ─────────────────────────────────────
// Code copied verbatim (comments abridged) from
// apps/admin/app/admin/(protected)/rentals/page.tsx:113-126 (SubscriptionRow)
// and :167-261 (isEndingSoon, SubStatus, SUB_STATUS_META, LIVE_STATUSES,
// selectSubscription, getSubStatus), Sep 16 2026. That page is billing-critical
// and exports nothing, so it is copied rather than extracted. The scratchpad
// test re-extracts the originals from the page source and compares them on a
// fixture table; if that page changes, change this copy too.

export interface SubscriptionRow {
  tenant_id: string;
  status: string;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  plan_name: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  /** Set by the webhook when a subscription actually ends — see subscriptionEndedOn. */
  ended_at: string | null;
  created_at: string;
}

/**
 * Live, but with a cancellation already booked.
 *
 * Stripe keeps such a subscription at status 'active' until the paid period
 * lapses, so it was indistinguishable from a renewing customer — same green
 * "Subscribed" badge, same next-invoice date, right up to the day it ended.
 * Scheduled churn is exactly what a super admin needs to see EARLY.
 */
export function isEndingSoon(sub: SubscriptionRow | null): boolean {
  if (!sub) return false;
  if (sub.status !== 'active' && sub.status !== 'trialing') return false;
  return !!sub.cancel_at && new Date(sub.cancel_at).getTime() > Date.now();
}

export type SubStatus =
  | 'active'
  | 'ending'
  | 'trialing'
  | 'past-due'
  | 'expired'
  | 'not-converted'
  | 'canceled'
  | 'unpaid'
  | 'paywall-set'
  | 'paywall-not-set';

export const SUB_STATUS_META: Record<SubStatus, { label: string; className: string }> = {
  active: { label: 'Subscribed', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  ending: { label: 'Ending', className: 'bg-orange-500/15 text-orange-600 border-orange-500/30' },
  trialing: { label: 'Trialing', className: 'bg-sky-500/15 text-sky-600 border-sky-500/30' },
  'past-due': { label: 'Past due', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  canceled: { label: 'Canceled', className: 'bg-slate-500/15 text-slate-600 border-slate-500/30' },
  unpaid: { label: 'Unpaid · retries exhausted', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  expired: { label: 'Expired', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  'not-converted': { label: 'Card added · not converted', className: 'bg-orange-500/15 text-orange-600 border-orange-500/30' },
  'paywall-set': { label: 'Not subscribed', className: 'bg-secondary text-muted-foreground border-border' },
  'paywall-not-set': { label: 'Paywall not set', className: 'bg-fuchsia-500/15 text-fuchsia-600 border-fuchsia-500/30' },
};

/** Statuses Stripe considers a live billing relationship. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Pick the one subscription that represents a tenant today.
 * A migrated tenant keeps a retired UK row alongside the live UAE one, so
 * prefer a live status and fall back to the most recent row.
 */
export function selectSubscription(rows: SubscriptionRow[] | undefined): SubscriptionRow | null {
  if (!rows || rows.length === 0) return null;
  const live = rows.filter((r) => LIVE_STATUSES.has(r.status));
  const pool = live.length > 0 ? live : rows;
  return pool.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
}

export function getSubStatus(
  sub: SubscriptionRow | null,
  hasActivePlan: boolean,
  owesMoney = false,
): SubStatus {
  if (sub) {
    // Before 'active': a booked cancellation keeps Stripe's status at 'active'
    // until the period lapses, so checking status alone hid scheduled churn.
    if (isEndingSoon(sub)) return 'ending';
    if (sub.status === 'active') return 'active';
    if (sub.status === 'trialing') return 'trialing';
    if (sub.status === 'past_due') return 'past-due';
    if (sub.status === 'incomplete' || sub.status === 'incomplete_expired') return 'not-converted';

    // TERMINAL from here down (see the original for the full rationale): a
    // dead subscription whose plan is gone reads as "Paywall not set", unless
    // money is still owed.
    if (!hasActivePlan && !owesMoney) return 'paywall-not-set';

    if (sub.status === 'canceled') return 'canceled';
    if (sub.status === 'unpaid') return 'unpaid';
    return 'expired'; // paused, or any future Stripe status
  }
  return hasActivePlan ? 'paywall-set' : 'paywall-not-set';
}

// ─── Billing index (same three reads as rentals/page.tsx:408-470) ────────────

export interface BillingIndex {
  subsByTenant: Map<string, SubscriptionRow[]>;
  /** Tenants with an active plan that has a Stripe price (a usable paywall). */
  planTenantIds: Set<string>;
  /** Tenants with an open or uncollectible invoice (rentals' oldestUnpaidInvoice). */
  unpaidTenantIds: Set<string>;
}

export function buildBillingIndex(
  subs: readonly SubscriptionRow[],
  plans: ReadonlyArray<{ tenant_id: string }>,
  invoices: ReadonlyArray<{ tenant_id: string; status: string }>,
): BillingIndex {
  const subsByTenant = new Map<string, SubscriptionRow[]>();
  for (const row of subs) {
    const list = subsByTenant.get(row.tenant_id);
    if (list) list.push(row);
    else subsByTenant.set(row.tenant_id, [row]);
  }
  const planTenantIds = new Set(plans.map((p) => p.tenant_id));
  const unpaidTenantIds = new Set<string>();
  for (const inv of invoices) {
    if (inv.status === 'open' || inv.status === 'uncollectible') unpaidTenantIds.add(inv.tenant_id);
  }
  return { subsByTenant, planTenantIds, unpaidTenantIds };
}

/** The rentals list's classification for one tenant. */
export function subStatusFor(index: BillingIndex, tenantId: string): SubStatus {
  return getSubStatus(
    selectSubscription(index.subsByTenant.get(tenantId)),
    index.planTenantIds.has(tenantId),
    index.unpaidTenantIds.has(tenantId),
  );
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export type TenantTypeFilter = 'all' | 'production' | 'test';
export type TenantStatusFilter = 'all' | 'active' | 'suspended';
export type SubscriptionFilter = 'any' | SubStatus;

export interface TenantPickerFilters {
  search: string;
  favoritesOnly: boolean;
  type: TenantTypeFilter;
  status: TenantStatusFilter;
  subscription: SubscriptionFilter;
}

export const DEFAULT_PICKER_FILTERS: TenantPickerFilters = {
  search: '',
  favoritesOnly: false,
  type: 'all',
  status: 'all',
  subscription: 'any',
};

export const TYPE_FILTER_OPTIONS: ReadonlyArray<{ value: TenantTypeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'production', label: 'Production' },
  { value: 'test', label: 'Test' },
];

/** "Any status" exactly as the list page labels it; 'trial' rows show only under it, as there. */
export const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: TenantStatusFilter; label: string }> = [
  { value: 'all', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

export const SUBSCRIPTION_FILTER_OPTIONS: ReadonlyArray<{ value: SubscriptionFilter; label: string }> = [
  { value: 'any', label: 'Any subscription' },
  { value: 'active', label: 'Subscribed' },
  { value: 'ending', label: 'Ending' },
  { value: 'trialing', label: 'Trialing' },
  { value: 'past-due', label: 'Past due' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'expired', label: 'Expired' },
  { value: 'not-converted', label: 'Not converted' },
  { value: 'paywall-set', label: 'Not subscribed' },
  { value: 'paywall-not-set', label: 'Paywall not set' },
];

/** rentals/page.tsx:689-696: lowercase `includes` over the same four fields; empty query matches all. */
export function matchesTenantSearch(t: PickerTenant, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return !!(
    t.company_name?.toLowerCase().includes(q) ||
    t.slug?.toLowerCase().includes(q) ||
    t.contact_email?.toLowerCase().includes(q) ||
    t.admin_name?.toLowerCase().includes(q)
  );
}

/** The list applies these server-side as `eq`, so a NULL tenant_type only shows under "All". */
export function matchesTenantType(t: PickerTenant, type: TenantTypeFilter): boolean {
  return type === 'all' || t.tenant_type === type;
}

export function matchesTenantStatus(t: PickerTenant, status: TenantStatusFilter): boolean {
  return status === 'all' || t.status === status;
}

export const FAVORITES_STORAGE_KEY = 'admin_favorite_tenants';

/** Read-only view of the list page's favourites. Never throws; anything unexpected is "no favourites". */
export function readFavoriteTenantIds(storage: { getItem(key: string): string | null } | null | undefined): Set<string> {
  try {
    const raw = storage?.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

/**
 * Matching tenants, favourites first and otherwise in the given order (the read
 * is created_at DESC, like the list). `subStatusOf` is null when the billing
 * reads failed: the Subscription filter is then disabled and ignored.
 */
export function filterPickerTenants(
  tenants: readonly PickerTenant[],
  filters: TenantPickerFilters,
  favorites: ReadonlySet<string>,
  subStatusOf: ((tenantId: string) => SubStatus) | null,
): PickerTenant[] {
  const out = tenants.filter((t) => {
    if (filters.favoritesOnly && !favorites.has(t.id)) return false;
    if (!matchesTenantType(t, filters.type)) return false;
    if (!matchesTenantStatus(t, filters.status)) return false;
    if (subStatusOf && filters.subscription !== 'any' && subStatusOf(t.id) !== filters.subscription) return false;
    return matchesTenantSearch(t, filters.search);
  });
  // Array.prototype.sort is stable (ES2019), so non-favourites keep their order.
  return out.sort((a, b) => (favorites.has(a.id) ? 0 : 1) - (favorites.has(b.id) ? 0 : 1));
}

export function hasActiveFilters(filters: TenantPickerFilters): boolean {
  return (
    filters.search !== '' ||
    filters.favoritesOnly ||
    filters.type !== 'all' ||
    filters.status !== 'all' ||
    filters.subscription !== 'any'
  );
}

// ─── Selection math ──────────────────────────────────────────────────────────

/** Adds every matching id; selections hidden by the filters are kept. */
export function selectAllMatching(selected: ReadonlySet<string>, matchingIds: readonly string[]): Set<string> {
  const next = new Set(selected);
  for (const id of matchingIds) next.add(id);
  return next;
}

/** Removes only the matching ids; selections hidden by the filters are kept. */
export function clearMatching(selected: ReadonlySet<string>, matchingIds: readonly string[]): Set<string> {
  const next = new Set(selected);
  for (const id of matchingIds) next.delete(id);
  return next;
}

export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export interface SelectionSummary {
  selectedCount: number;
  matchingCount: number;
  matchingSelectedCount: number;
  /** Selected tenants the current filters hide. */
  hiddenSelectedCount: number;
  /** The "Select all {m} matching" checkbox. */
  headerState: boolean | 'mixed';
}

export function summarizeSelection(selected: ReadonlySet<string>, matchingIds: readonly string[]): SelectionSummary {
  const matching = new Set(matchingIds);
  let matchingSelectedCount = 0;
  for (const id of matching) if (selected.has(id)) matchingSelectedCount += 1;
  const hiddenSelectedCount = selected.size - matchingSelectedCount;
  const headerState: boolean | 'mixed' =
    matching.size > 0 && matchingSelectedCount === matching.size ? true : matchingSelectedCount > 0 ? 'mixed' : false;
  return {
    selectedCount: selected.size,
    matchingCount: matching.size,
    matchingSelectedCount,
    hiddenSelectedCount,
    headerState,
  };
}
