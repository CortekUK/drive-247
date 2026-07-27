'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import CreateTenantDialog from '@/components/admin/CreateTenantDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  ArrowRight,
  Search,
  Star,
  Building2,
  ArrowLeftRight,
  ChevronDown,
  CreditCard,
} from 'lucide-react';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  admin_name: string | null;
  status: string;
  contact_email: string;
  created_at: string;
  tenant_type: 'production' | 'test' | null;
  subscription_account: 'uk' | 'uae' | null;
  payment_model: 'managed' | 'own' | null;
  own_stripe_account_id: string | null;
  migration_blocker: 'off' | 'soft' | 'hard' | null;
}

/**
 * Derives a tenant's UK→UAE migration picture from its raw fields.
 *
 * Two independent axes move from UK to UAE:
 *   - Subscription: subscription_account  ('uk' | 'uae')
 *   - Connect:      payment_model         ('managed' = UK Express | 'own' = UAE)
 *
 * A tenant on payment_model='own' is counted as UAE on the Connect axis even
 * before they OAuth a real account — the model routes them to UAE the moment
 * they connect ("configured for UAE"). own_stripe_account_id only refines the
 * push status (Done vs Auto/UAE-ready), not the state chip.
 */
type MigrationState = 'uk' | 'partial-sub' | 'partial-connect' | 'uae';
type PushStatus = 'hard' | 'soft' | 'done' | 'ready' | 'auto' | 'not-started';

function getMigrationState(t: Tenant): MigrationState {
  const subUae = t.subscription_account === 'uae';
  const payUae = t.payment_model === 'own';
  if (subUae && payUae) return 'uae';
  if (!subUae && !payUae) return 'uk';
  return subUae ? 'partial-sub' : 'partial-connect';
}

function getPushStatus(t: Tenant, state: MigrationState): PushStatus {
  // Fully migrated (both axes UAE + own account actually connected) is Done,
  // regardless of any leftover blocker value the DB hasn't cleared yet.
  if (state === 'uae' && t.own_stripe_account_id) return 'done';
  if (t.migration_blocker === 'hard') return 'hard';
  if (t.migration_blocker === 'soft') return 'soft';
  // Flags point to UAE but nothing is actually connected/subscribed yet
  // (e.g. a brand-new empty tenant) → "UAE-ready", not "Done".
  if (state === 'uae') return 'ready';
  if (state === 'uk') return 'not-started';
  return 'auto';
}

const MIGRATION_STATE_META: Record<MigrationState, { label: string; className: string }> = {
  uk: { label: '🇬🇧 UK', className: 'bg-secondary text-muted-foreground border-border' },
  'partial-sub': { label: '🟡 Partial · Sub UAE', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  'partial-connect': { label: '🟡 Partial · Connect UAE', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  uae: { label: '🇦🇪 UAE', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

const PUSH_STATUS_META: Record<PushStatus, { label: string; className: string }> = {
  hard: { label: 'Hard blocker', className: 'text-destructive' },
  soft: { label: 'Soft blocker', className: 'text-amber-400' },
  done: { label: 'Done', className: 'text-emerald-400' },
  ready: { label: 'UAE-ready', className: 'text-sky-400' },
  auto: { label: 'In progress', className: 'text-sky-400' },
  'not-started': { label: 'Not started', className: 'text-muted-foreground' },
};

// ─── Subscription view ───────────────────────────────────────────────────────
// Deliberately independent of the migration axes above: a tenant can be fully
// migrated to UAE and still have never subscribed, and vice versa.

/** Which extra column set the listing is focused on. Mutually exclusive. */
type ViewMode = 'default' | 'migration' | 'subscription';

interface SubscriptionRow {
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
  created_at: string;
}

interface InvoiceRow {
  /** tenant_subscription_invoices.id — the handle mark-invoice-paid expects. */
  id: string;
  tenant_id: string;
  status: string;
  amount_due: number | null;
  amount_paid: number | null;
  period_end: string | null;
  created_at: string;
}

/**
 * Two-level taxonomy.
 *   Level 2 (has a subscription): active | trialing | past_due | expired
 *   Level 1 (no subscription):    paywall-set (a plan exists, they just never
 *                                 subscribed) | paywall-not-set (nothing to
 *                                 subscribe TO — the paywall was never built).
 * The level-1 split is the point: it separates "chase the client" from
 * "we haven't done our own setup yet".
 */
type SubStatus =
  | 'active'
  | 'trialing'
  | 'past-due'
  | 'expired'
  | 'paywall-set'
  | 'paywall-not-set';

const SUB_STATUS_META: Record<SubStatus, { label: string; className: string }> = {
  active: { label: 'Subscribed', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  trialing: { label: 'Trialing', className: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  'past-due': { label: 'Past due', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  expired: { label: 'Expired', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  'paywall-set': { label: 'Not subscribed', className: 'bg-secondary text-muted-foreground border-border' },
  'paywall-not-set': { label: 'Paywall not set', className: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30' },
};

/** Statuses Stripe considers a live billing relationship. */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * Pick the one subscription that represents a tenant today.
 * A migrated tenant keeps a retired UK row alongside the live UAE one, so
 * prefer a live status and fall back to the most recent row.
 */
function selectSubscription(rows: SubscriptionRow[] | undefined): SubscriptionRow | null {
  if (!rows || rows.length === 0) return null;
  const live = rows.filter((r) => LIVE_STATUSES.has(r.status));
  const pool = live.length > 0 ? live : rows;
  return pool.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
}

function getSubStatus(sub: SubscriptionRow | null, hasActivePlan: boolean): SubStatus {
  if (sub) {
    if (sub.status === 'active') return 'active';
    if (sub.status === 'trialing') return 'trialing';
    if (sub.status === 'past_due') return 'past-due';
    return 'expired'; // canceled | unpaid | incomplete_expired | paused | incomplete
  }
  return hasActivePlan ? 'paywall-set' : 'paywall-not-set';
}

/** Minor units → display. Amounts are stored in cents (verified in prod). */
function formatMinor(amount: number | null, currency: string | null): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(amount / 100);
}

function formatDay(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * When the next invoice falls due. NOTE: tenant_subscription_invoices.due_date
 * is NULL for every row in production because these subscriptions all bill
 * charge_automatically — Stripe charges at period end rather than issuing a
 * dated invoice. current_period_end is therefore the authoritative "next
 * payment" date; a trial that has not yet converted bills at trial_end.
 */
function nextInvoiceDue(
  sub: SubscriptionRow | null,
  unpaid?: InvoiceRow | null
): { date: string | null; overdue: boolean } {
  if (!sub || !LIVE_STATUSES.has(sub.status)) return { date: null, overdue: false };

  // PAST DUE: report the date the money was actually owed, not the next cycle.
  // When a charge fails Stripe still advances current_period_end by a full
  // period, so showing it told George "next invoice due 16 Aug" about a tenant
  // who had owed $300 since 16 Jul — the single most misleading cell on the
  // page, on the one row he most needed to act on.
  if (sub.status === 'past_due') {
    const owed = unpaid?.period_end || unpaid?.created_at || null;
    return { date: owed ?? sub.current_period_end, overdue: true };
  }

  if (sub.status === 'trialing' && sub.trial_end) return { date: sub.trial_end, overdue: false };
  return { date: sub.current_period_end, overdue: false };
}

/**
 * When a lapsed subscription actually ended — so a tenant that churned in March
 * is visibly different from one that churned last week.
 */
function subscriptionEndedOn(sub: SubscriptionRow | null): string | null {
  if (!sub) return null;
  return sub.canceled_at || sub.cancel_at || null;
}

/**
 * A $1.00 charge is the card-verification hold from the paywall signup flow, not
 * a real subscription payment. Reporting it as "Paid" made six tenants look like
 * they were current when they had never paid a real invoice.
 */
function isVerificationCharge(inv: InvoiceRow | null | undefined): boolean {
  return !!inv && (inv.amount_due ?? 0) <= 100;
}

export default function RentalCompaniesPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'production' | 'test'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [subsByTenant, setSubsByTenant] = useState<Map<string, SubscriptionRow[]>>(new Map());
  const [planTenantIds, setPlanTenantIds] = useState<Set<string>>(new Set());
  const [latestInvoice, setLatestInvoice] = useState<Map<string, InvoiceRow>>(new Map());
  const [oldestUnpaidInvoice, setOldestUnpaidInvoice] = useState<Map<string, InvoiceRow>>(new Map());
  const [settlingInvoiceId, setSettlingInvoiceId] = useState<string | null>(null);
  const [subsLoaded, setSubsLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('admin_favorite_tenants');
        return saved ? new Set(JSON.parse(saved)) : new Set();
      } catch { return new Set(); }
    }
    return new Set();
  });

  useEffect(() => {
    loadTenants();
  }, [typeFilter, statusFilter]);

  // Subscription data is fetched lazily the first time the subscription view is
  // opened, and kept thereafter. It is deliberately NOT part of loadTenants():
  // that reruns on every type/status filter change, and these three tables do
  // not depend on those filters. Reads are global (no tenant filter) — the
  // super-admin dashboard already does the same, so RLS permits it.
  useEffect(() => {
    if (viewMode !== 'subscription' || subsLoaded) return;

    (async () => {
      try {
        const [subsRes, plansRes, invoicesRes] = await Promise.all([
          supabase
            .from('tenant_subscriptions')
            .select('tenant_id, status, amount, currency, interval, plan_name, current_period_end, trial_end, cancel_at, canceled_at, created_at'),
          supabase.from('subscription_plans').select('tenant_id').eq('is_active', true),
          supabase
            .from('tenant_subscription_invoices')
            // `id` is required to settle an invoice via mark-invoice-paid.
            .select('id, tenant_id, status, amount_due, amount_paid, period_end, created_at')
            .order('created_at', { ascending: false }),
        ]);

        const subs = new Map<string, SubscriptionRow[]>();
        for (const row of (subsRes.data as SubscriptionRow[] | null) ?? []) {
          const list = subs.get(row.tenant_id);
          if (list) list.push(row);
          else subs.set(row.tenant_id, [row]);
        }
        setSubsByTenant(subs);

        setPlanTenantIds(
          new Set(((plansRes.data as { tenant_id: string }[] | null) ?? []).map((p) => p.tenant_id))
        );

        // Rows arrive newest-first, so the first hit per tenant is the latest.
        // Separately track the OLDEST still-unpaid invoice: for a past_due
        // tenant that, not current_period_end, is what is actually overdue.
        const latest = new Map<string, InvoiceRow>();
        const oldestUnpaid = new Map<string, InvoiceRow>();
        for (const inv of (invoicesRes.data as InvoiceRow[] | null) ?? []) {
          if (!latest.has(inv.tenant_id)) latest.set(inv.tenant_id, inv);
          if (inv.status === 'open' || inv.status === 'uncollectible') {
            // Iterating newest-first means each later hit is older, so
            // overwriting always leaves the oldest unpaid invoice.
            oldestUnpaid.set(inv.tenant_id, inv);
          }
        }
        setLatestInvoice(latest);
        setOldestUnpaidInvoice(oldestUnpaid);

        setSubsLoaded(true);
      } catch (error) {
        console.error('Error loading subscription data:', error);
      }
    })();
  }, [viewMode, subsLoaded]);

  const loadTenants = async () => {
    try {
      let query = supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false });

      // Type (production/test) and status (active/suspended) are independent
      // axes and combine with AND, so e.g. "Production + Suspended" works.
      if (typeFilter !== 'all') {
        query = query.eq('tenant_type', typeFilter);
      }
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setTenants(data || []);
    } catch (error) {
      console.error('Error loading tenants:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Settle an overdue invoice that was paid outside Stripe.
   *
   * Deliberately routed through the mark-invoice-paid edge function rather than
   * updating the row here: Stripe is the authority and the reconciler rewrites
   * this table from it, so a client-side status write would be reverted within
   * the hour while the tenant carried on being dunned.
   */
  const handleMarkPaid = async (invoice: InvoiceRow, company: string) => {
    const reason = window.prompt(
      `Mark ${company}'s ${formatMinor(invoice.amount_due, 'usd')} invoice as paid?\n\n` +
        `This settles it in Stripe as paid out of band and is recorded against your account.\n` +
        `Give a reason (min 10 characters) — e.g. "paid by bank transfer ref 12345":`,
    );
    if (reason === null) return;
    if (reason.trim().length < 10) {
      alert('A reason of at least 10 characters is required.');
      return;
    }

    setSettlingInvoiceId(invoice.id);
    try {
      const { data, error } = await supabase.functions.invoke('mark-invoice-paid', {
        body: { invoiceId: invoice.id, reason: reason.trim() },
      });
      if (error) throw error;
      alert(
        `Settled in Stripe (${data?.stripeStatus ?? 'paid'}).\n\n` +
          `The dashboard updates once Stripe's invoice.paid webhook lands.`,
      );
      // Force a refetch of subscription data on next open.
      setSubsLoaded(false);
    } catch (e: any) {
      alert(`Could not settle this invoice:\n\n${e?.message ?? e}`);
    } finally {
      setSettlingInvoiceId(null);
    }
  };

  const toggleFavorite = (tenantId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(tenantId)) next.delete(tenantId);
      else next.add(tenantId);
      localStorage.setItem('admin_favorite_tenants', JSON.stringify([...next]));
      return next;
    });
  };

  const filteredTenants = tenants
    .filter((t) => {
      if (showFavoritesOnly && !favorites.has(t.id)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        t.company_name?.toLowerCase().includes(q) ||
        t.slug?.toLowerCase().includes(q) ||
        t.contact_email?.toLowerCase().includes(q) ||
        t.admin_name?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      // Favorites first
      const aFav = favorites.has(a.id) ? 0 : 1;
      const bFav = favorites.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return 0; // preserve original order otherwise
    });

  const isSubscriptionView = viewMode === 'subscription';

  /**
   * Roll-up across the tenants currently in view (so it respects search and the
   * type/status filters). MRR counts only genuinely-billing subscriptions —
   * trialing tenants are not paying yet and expired ones never will, so folding
   * either into the headline number would overstate revenue.
   */
  const subscriptionSummary = (() => {
    const tally: Record<SubStatus, number> = {
      active: 0, trialing: 0, 'past-due': 0, expired: 0,
      'paywall-set': 0, 'paywall-not-set': 0,
    };
    let mrrMinor = 0;
    let atRiskMinor = 0;
    for (const t of filteredTenants) {
      const sub = selectSubscription(subsByTenant.get(t.id));
      const status = getSubStatus(sub, planTenantIds.has(t.id));
      tally[status] += 1;
      if (status === 'active' && sub?.amount) mrrMinor += sub.amount;
      // Past-due revenue is OWED, not lost. Excluding it entirely made a
      // collections problem look like churn: the moment a card failed, the
      // headline figure silently dropped by that tenant's full amount with
      // nothing on screen saying why. Surface it separately instead.
      if (status === 'past-due' && sub?.amount) atRiskMinor += sub.amount;
    }
    return { tally, mrrMinor, atRiskMinor };
  })();

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80 mt-2" />
          </div>
          <Skeleton className="h-10 w-44" />
        </div>
        <Skeleton className="h-10 w-60" />
        <Card>
          <CardContent className="p-0">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b last:border-0">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-24 ml-auto" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Rental Companies</h1>
            <p className="text-sm text-muted-foreground">
              Manage all rental companies · {tenants.length} total
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" />
          Add New Rental
        </Button>
      </div>

      {/* Search & Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, slug, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Favorites toggle */}
            <button
              onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all border',
                showFavoritesOnly
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 glow-amber'
                  : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
              )}
            >
              <Star className={cn('h-4 w-4', showFavoritesOnly && 'fill-amber-400')} />
              Favorites{favorites.size > 0 && ` (${favorites.size})`}
            </button>

            {/* Type pills (production/test) */}
            <div className="flex items-center gap-1.5">
              {(['all', 'production', 'test'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type)}
                  className={cn(
                    'px-3 py-2 rounded-md text-xs font-semibold transition-all capitalize border',
                    typeFilter === type
                      ? type === 'production'
                        ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                        : type === 'test'
                        ? 'bg-warning/15 text-amber-400 border-warning/30'
                        : 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
                  )}
                >
                  {type}
                </button>
              ))}
            </div>

            {/* Divider between the two independent filter axes */}
            <div className="hidden sm:block w-px self-stretch bg-border" />

            {/* Status pills (active/suspended) — combines with type via AND */}
            <div className="flex items-center gap-1.5">
              {(['all', 'active', 'suspended'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    'px-3 py-2 rounded-md text-xs font-semibold transition-all capitalize border',
                    statusFilter === status
                      ? status === 'active'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : status === 'suspended'
                        ? 'bg-destructive/15 text-destructive border-destructive/30'
                        : 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
                  )}
                >
                  {status === 'all' ? 'Any status' : status}
                </button>
              ))}
            </div>

            {/* Divider before the view-mode picker */}
            <div className="hidden sm:block w-px self-stretch bg-border" />

            {/* View focus — migration and subscription are separate concerns and
                are mutually exclusive, so a radio group rather than two toggles. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all border whitespace-nowrap',
                    viewMode !== 'default'
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-secondary text-muted-foreground border-transparent hover:bg-secondary/80'
                  )}
                >
                  {viewMode === 'subscription' ? (
                    <CreditCard className="h-4 w-4" />
                  ) : (
                    <ArrowLeftRight className="h-4 w-4" />
                  )}
                  {viewMode === 'migration'
                    ? 'Migration status'
                    : viewMode === 'subscription'
                    ? 'Subscription status'
                    : 'Show status'}
                  <ChevronDown className="h-4 w-4 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuRadioGroup
                  value={viewMode}
                  onValueChange={(v) => setViewMode(v as ViewMode)}
                >
                  <DropdownMenuRadioItem value="default">None</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="migration">
                    Show migration status
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="subscription">
                    Show Subscription Status
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      {/* Subscription roll-up — the numbers George is chasing, before he
          starts reading rows. Only rendered in the subscription view. */}
      {isSubscriptionView && subsLoaded && (
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              {(
                [
                  ['active', 'Subscribed'],
                  ['trialing', 'Trialing'],
                  ['past-due', 'Past due'],
                  ['expired', 'Expired'],
                  ['paywall-set', 'Not subscribed'],
                  ['paywall-not-set', 'Paywall not set'],
                ] as [SubStatus, string][]
              ).map(([key, label]) => (
                <div key={key} className="flex flex-col">
                  <span className="text-xl font-semibold tabular-nums">
                    {subscriptionSummary.tally[key]}
                  </span>
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              ))}
              {subscriptionSummary.atRiskMinor > 0 && (
                <div className="flex flex-col ml-auto text-right">
                  <span className="text-xl font-semibold tabular-nums text-amber-400">
                    {formatMinor(subscriptionSummary.atRiskMinor, 'usd')}
                  </span>
                  <span className="text-xs text-muted-foreground">At risk (past due)</span>
                </div>
              )}
              <div
                className={cn(
                  'flex flex-col text-right',
                  subscriptionSummary.atRiskMinor > 0 ? '' : 'ml-auto'
                )}
              >
                <span className="text-xl font-semibold tabular-nums text-emerald-400">
                  {formatMinor(subscriptionSummary.mrrMinor, 'usd')}
                </span>
                <span className="text-xs text-muted-foreground">
                  Active subscription volume
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow className="bg-primary/5 hover:bg-primary/5">
              <TableHead className="w-10"></TableHead>
              <TableHead>Company</TableHead>
              {/* Subscription view drops Type/Status/Created: when you are
                  chasing billing, "production / active / created 3 months ago"
                  is noise. The middle belongs entirely to subscription data. */}
              {!isSubscriptionView && <TableHead>Type</TableHead>}
              {!isSubscriptionView && <TableHead>Status</TableHead>}
              {viewMode === 'migration' && <TableHead>Migration</TableHead>}
              {isSubscriptionView && (
                <>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Next invoice due</TableHead>
                  <TableHead>Last invoice</TableHead>
                </>
              )}
              {!isSubscriptionView && <TableHead>Created</TableHead>}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="pr-0">
                  <button
                    onClick={() => toggleFavorite(tenant.id)}
                    className="p-1 rounded hover:bg-accent transition-colors"
                    title={favorites.has(tenant.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star
                      className={cn(
                        'h-4 w-4 transition-colors',
                        favorites.has(tenant.id)
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-muted-foreground/40 hover:text-muted-foreground'
                      )}
                    />
                  </button>
                </TableCell>
                <TableCell className="font-medium">{tenant.company_name}</TableCell>
                {!isSubscriptionView && (
                  <TableCell>
                    {tenant.tenant_type ? (
                      <Badge variant={tenant.tenant_type === 'production' ? 'info' : 'warning'} className="capitalize whitespace-nowrap">
                        {tenant.tenant_type}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
                {!isSubscriptionView && (
                  <TableCell>
                    <Badge variant={tenant.status === 'active' ? 'success' : 'destructive'} className="capitalize whitespace-nowrap">
                      {tenant.status}
                    </Badge>
                  </TableCell>
                )}
                {viewMode === 'migration' && (() => {
                  const state = getMigrationState(tenant);
                  const push = getPushStatus(tenant, state);
                  const sm = MIGRATION_STATE_META[state];
                  const pm = PUSH_STATUS_META[push];
                  return (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', sm.className)}>
                          {sm.label}
                        </span>
                        <span className={cn('text-[11px] font-medium whitespace-nowrap', pm.className)}>
                          {pm.label}
                        </span>
                      </div>
                    </TableCell>
                  );
                })()}
                {isSubscriptionView && (() => {
                  const sub = selectSubscription(subsByTenant.get(tenant.id));
                  const subStatus = getSubStatus(sub, planTenantIds.has(tenant.id));
                  const meta = SUB_STATUS_META[subStatus];
                  const inv = latestInvoice.get(tenant.id);
                  const unpaid = oldestUnpaidInvoice.get(tenant.id);
                  const due = nextInvoiceDue(sub, unpaid);
                  const endedOn = subStatus === 'expired' ? subscriptionEndedOn(sub) : null;

                  // Until the fetch lands, render placeholders rather than
                  // "Paywall not set" — an absent Map would otherwise libel
                  // every tenant as unconfigured for a frame.
                  if (!subsLoaded) {
                    return (
                      <>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <TableCell key={i}><Skeleton className="h-5 w-20" /></TableCell>
                        ))}
                      </>
                    );
                  }

                  return (
                    <>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className={cn('inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', meta.className)}>
                            {meta.label}
                          </span>
                          {/* For a tenant with a paywall but no subscription, the
                              question is "did they ever enter a card?". The $1
                              authorization leaves a paid verification invoice, so
                              its presence is real evidence of card capture rather
                              than an inference from the missing subscription row. */}
                          {subStatus === 'paywall-set' && (
                            <span
                              className={cn(
                                'text-[10px] font-medium whitespace-nowrap',
                                isVerificationCharge(inv) && inv?.status === 'paid'
                                  ? 'text-sky-400'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {isVerificationCharge(inv) && inv?.status === 'paid'
                                ? 'Card captured · did not convert'
                                : 'No card entered'}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {sub?.plan_name || '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {sub ? (
                          <>
                            {formatMinor(sub.amount, sub.currency)}
                            <span className="text-muted-foreground text-xs">
                              /{sub.interval || 'month'}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums whitespace-nowrap">
                        {endedOn ? (
                          // Expired rows have no "next" invoice — show when it ended.
                          <span className="text-muted-foreground">
                            Ended {formatDay(endedOn)}
                          </span>
                        ) : due.date ? (
                          <div className="flex flex-col gap-0.5">
                            <span className={due.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                              {due.overdue ? `Overdue since ${formatDay(due.date)}` : formatDay(due.date)}
                            </span>
                            {/* Settle-out-of-band escape hatch, only where there
                                is genuinely an unpaid invoice to settle. */}
                            {due.overdue && unpaid && (
                              <button
                                onClick={() => handleMarkPaid(unpaid, tenant.company_name)}
                                disabled={settlingInvoiceId === unpaid.id}
                                className="w-fit text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                              >
                                {settlingInvoiceId === unpaid.id ? 'Settling…' : 'Mark as paid'}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {inv ? (
                          <span
                            className={cn(
                              'text-[11px] font-medium',
                              isVerificationCharge(inv)
                                ? 'text-muted-foreground'
                                : inv.status === 'paid'
                                ? 'text-emerald-400'
                                : inv.status === 'open'
                                ? 'text-amber-400'
                                : 'text-destructive'
                            )}
                          >
                            {isVerificationCharge(inv)
                              ? 'Card verified'
                              : inv.status === 'paid'
                              ? 'Paid'
                              : inv.status === 'open'
                              ? 'Unpaid'
                              : 'Failed'}
                            <span className="text-muted-foreground ml-1">
                              {formatDay(inv.created_at)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </>
                  );
                })()}
                {!isSubscriptionView && (
                  <TableCell className="text-muted-foreground tabular-nums">
                    {new Date(tenant.created_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/admin/rentals/${tenant.id}`}>
                      View Details
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredTenants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              {showFavoritesOnly
                ? 'No favorite companies yet. Star a company to add it here.'
                : searchQuery
                ? 'No companies match your search.'
                : 'No rental companies yet. Create one to get started.'}
            </p>
          </div>
        )}
      </Card>

      <CreateTenantDialog
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreated={loadTenants}
      />
    </div>
  );
}
