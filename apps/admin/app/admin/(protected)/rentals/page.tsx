'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  Search,
  Star,
  Building2,
  ArrowLeftRight,
  ChevronDown,
  AlertTriangle,
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
  uk: { label: 'UK', className: 'bg-secondary text-muted-foreground border-border' },
  'partial-sub': { label: 'Partial · Sub UAE', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  'partial-connect': { label: 'Partial · Connect UAE', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  uae: { label: 'UAE', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
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
  /** Set by the webhook when a subscription actually ends — see subscriptionEndedOn. */
  ended_at: string | null;
  created_at: string;
}

interface InvoiceRow {
  /** tenant_subscription_invoices.id — the handle mark-invoice-paid expects. */
  id: string;
  tenant_id: string;
  status: string;
  amount_due: number | null;
  amount_paid: number | null;
  /** Needed so the write-off prompt states the invoice's real currency. */
  currency: string | null;
  period_end: string | null;
  created_at: string;
  /** >0 means Stripe attempted the charge and was declined — the only way to
   *  tell a FAILED invoice from one that is simply not due yet, since Stripe
   *  leaves both at status 'open'. */
  attempt_count: number | null;
  /** Stripe's own invoice date. created_at is our row-insert time. */
  invoice_date: string | null;
  amount_refunded: number | null;
  dispute_status: string | null;
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
/**
 * Live, but with a cancellation already booked.
 *
 * Stripe keeps such a subscription at status 'active' until the paid period
 * lapses, so it was indistinguishable from a renewing customer — same green
 * "Subscribed" badge, same next-invoice date, right up to the day it ended.
 * Scheduled churn is exactly what a super admin needs to see EARLY.
 */
function isEndingSoon(sub: SubscriptionRow | null): boolean {
  if (!sub) return false;
  if (sub.status !== 'active' && sub.status !== 'trialing') return false;
  return !!sub.cancel_at && new Date(sub.cancel_at).getTime() > Date.now();
}

type SubStatus =
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

const SUB_STATUS_META: Record<SubStatus, { label: string; className: string }> = {
  active: { label: 'Subscribed', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  ending: { label: 'Ending', className: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  trialing: { label: 'Trialing', className: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  'past-due': { label: 'Past due', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  // CANCELED vs UNPAID vs EXPIRED are three different situations that used to
  // share one red "Expired" badge, which is wrong on the screen used to decide
  // who to chase:
  //  - canceled: ended deliberately (by us or the tenant). Nothing is owed.
  //    Do not chase — offer to win them back.
  //  - unpaid:   Stripe exhausted its dunning retries and gave up. Money IS
  //    owed. This is the one to chase hardest.
  //  - expired:  anything else terminal (e.g. paused), kept as a catch-all so
  //    a new Stripe status can never silently render as "Subscribed".
  canceled: { label: 'Canceled', className: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  unpaid: { label: 'Unpaid · retries exhausted', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  expired: { label: 'Expired', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  // Stripe 'incomplete' / 'incomplete_expired' means a Checkout was started and
  // a card was attached, but the first payment never cleared (SCA challenge
  // abandoned, declined, or the 23h window lapsed). That is a DIFFERENT problem
  // from a lapsed customer: they tried to pay us and could not. Previously both
  // were swept into red "Expired", hiding exactly the cohort the $1
  // authorization question was aimed at.
  'not-converted': { label: 'Card added · not converted', className: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
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

function getSubStatus(
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

    // TERMINAL from here down. A dead subscription is history; what matters is
    // whether the tenant can be sold to TODAY.
    //
    // If their last plan has been deleted or deactivated there is nothing left
    // to buy, so reporting "Canceled" describes the past while hiding the
    // present: the row silently stopped appearing in "Paywall not set", which is
    // the bucket that says "this tenant needs a plan before anything else can
    // happen". Falling through to the plan-based answer keeps the two questions
    // — did they churn, and can they subscribe — from being answered by one word.
    //
    // Never when money is outstanding: a debtor must not disappear into a
    // configuration bucket just because their plan was tidied away.
    if (!hasActivePlan && !owesMoney) return 'paywall-not-set';

    if (sub.status === 'canceled') return 'canceled';
    if (sub.status === 'unpaid') return 'unpaid';
    return 'expired'; // paused, or any future Stripe status
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
): { date: string | null; overdue: boolean; ending?: boolean } {
  if (!sub || !LIVE_STATUSES.has(sub.status)) return { date: null, overdue: false };

  // SCHEDULED TO CANCEL: there is no next invoice. cancel_at is set when a
  // tenant cancels but keeps the period they have paid for, and the subscription
  // stays 'active' until it lapses — so this cell confidently printed a date on
  // which nothing would ever be charged, and the row read as a healthy renewing
  // customer right up to the day they vanished. Report the ending instead.
  if (isEndingSoon(sub)) {
    return { date: sub.cancel_at, overdue: false, ending: true };
  }

  // PAST DUE: report the date the money was actually owed, not the next cycle.
  // When a charge fails Stripe still advances current_period_end by a full
  // period, so showing it told George "next invoice due 16 Aug" about a tenant
  // who had owed $300 since 16 Jul — the single most misleading cell on the
  // page, on the one row he most needed to act on.
  if (sub.status === 'past_due') {
    // invoice_date before created_at: created_at is our INSERT time, which the
    // reconciler stamps at backfill, so it could date an overdue invoice to the
    // day we happened to import it.
    const owed = unpaid?.period_end || unpaid?.invoice_date || unpaid?.created_at || null;
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
  // ended_at first: the webhook populates it, but it was never selected, so this
  // fell back to canceled_at/cancel_at — both of which Stripe leaves NULL for a
  // subscription that reached 'unpaid' or 'paused' rather than being cancelled.
  // Those rows therefore rendered a blank date.
  if (sub.ended_at) return sub.ended_at;
  if (sub.canceled_at) return sub.canceled_at;
  // cancel_at is a SCHEDULED cancellation and is routinely in the FUTURE, so it
  // must never be printed as "Ended <date>" for a subscription that has not
  // ended yet.
  if (sub.cancel_at && new Date(sub.cancel_at).getTime() <= Date.now()) return sub.cancel_at;
  return null;
}

/**
 * A $1.00 charge is the card-verification hold from the paywall signup flow, not
 * a real subscription payment. Reporting it as "Paid" made six tenants look like
 * they were current when they had never paid a real invoice.
 */
function isVerificationCharge(inv: InvoiceRow | null | undefined): boolean {
  const amt = inv?.amount_due ?? 0;
  // Lower bound matters: a $0.00 invoice (fully discounted, or a proration that
  // nets to nothing) is NOT a card verification, and treating it as one would
  // claim a tenant had entered a card when they had not.
  return amt > 0 && amt <= 100;
}

/**
 * A verification hold only proves a card when it actually SUCCEEDED.
 *
 * Amount alone was the whole test, so a $1 authorisation that Stripe DECLINED
 * still announced "Card verified" — directly contradicting the same row's own
 * "No card entered", and telling an operator a tenant was ready to bill when the
 * card had just been refused.
 */
function verificationChargeSucceeded(inv: InvoiceRow | null | undefined): boolean {
  return isVerificationCharge(inv) && inv?.status === 'paid';
}

export default function RentalCompaniesPage() {
  const router = useRouter();
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
  /** Tenants with ANY paid $0.01-$1.00 invoice — evidence the card was captured. */
  const [cardVerifiedTenants, setCardVerifiedTenants] = useState<Set<string>>(new Set());
  /** Tenants with at least one real (>$1) paid invoice — see MRR note below. */
  const [paidInvoiceTenantIds, setPaidInvoiceTenantIds] = useState<Set<string>>(new Set());
  /** Non-null when the subscription reads failed — the view must say so, not guess. */
  const [subsError, setSubsError] = useState<string | null>(null);
  const [settlingInvoiceId, setSettlingInvoiceId] = useState<string | null>(null);
  /** Click a summary tile to narrow the table to that bucket. */
  const [subStatusFilter, setSubStatusFilter] = useState<SubStatus | null>(null);
  const [subsLoaded, setSubsLoaded] = useState(false);
  /** Live-sync bookkeeping — see the LIVE SYNC block below. */
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [realtimeUp, setRealtimeUp] = useState(false);
  /** Re-renders the freshness label once a second without refetching. */
  const [nowTick, setNowTick] = useState(() => Date.now());
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
  // Extracted so live sync can re-run it WITHOUT touching subsLoaded.
  //
  // subsLoaded does double duty: "has data" and "never fetch again". The table
  // renders skeletons while it is false, so reusing setSubsLoaded(false) as the
  // refresh trigger would blank the whole screen on every realtime event and
  // every poll tick. A silent re-fetch keeps the rendered rows in place and
  // simply swaps the data underneath.
  const loadSubscriptionData = useCallback(async () => {
    {
      try {
        const [subsRes, plansRes, invoicesRes] = await Promise.all([
          supabase
            .from('tenant_subscriptions')
            .select('tenant_id, status, amount, currency, interval, plan_name, current_period_end, trial_end, cancel_at, canceled_at, ended_at, created_at'),
          // A plan is only a usable paywall if it can actually be checked out.
          // create-subscription-checkout rejects a plan with no stripe_price_id
          // ("Plan has no Stripe price configured"), and
          // create-uae-subscription-capture deliberately inserts is_active rows
          // with a NULL price — so is_active alone reported "paywall set" for
          // tenants who physically cannot pay, which is the exact failure the
          // requirement ("ensure paywalls are being set properly") exists to catch.
          supabase
            .from('subscription_plans')
            .select('tenant_id')
            .eq('is_active', true)
            .not('stripe_price_id', 'is', null),
          supabase
            .from('tenant_subscription_invoices')
            // `id` is required to settle an invoice via mark-invoice-paid.
            .select('id, tenant_id, status, amount_due, amount_paid, currency, period_end, created_at, invoice_date, attempt_count, amount_refunded, dispute_status')
            // Stripe's invoice date decides which invoice is "latest". created_at
            // is our row-INSERT time, which the reconciler stamps at backfill —
            // so a backfilled paid invoice sorted above a genuinely newer OPEN
            // one, and the Latest-invoice column reported "Paid" for a tenant
            // with money outstanding. NealCo read Paid while $350 was open.
            .order('invoice_date', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false }),
        ]);

        // supabase-js RESOLVES with an { error } instead of throwing, so a
        // try/catch alone cannot see an RLS denial, a renamed column, or a
        // network 5xx. Ignoring these left all three maps empty while
        // subsLoaded was still set true — so the screen rendered every tenant as
        // "Paywall not set" with $0 volume and no indication anything was wrong.
        // That is worse than an error: it is confident, actionable-looking, and
        // false, on the exact screen used to chase clients about their billing.
        const failed = [subsRes.error, plansRes.error, invoicesRes.error].filter(Boolean);
        if (failed.length > 0) {
          console.error('Subscription view failed to load:', failed);
          setSubsError(
            failed.map((e: any) => e?.message ?? String(e)).join('; ') ||
              'Could not load subscription data.',
          );
          return; // leave subsLoaded false so the table keeps showing skeletons
        }
        setSubsError(null);

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

        // Card capture is proven by the $1 authorization having been PAID at any
        // point — not by it happening to be the most recent invoice. A tenant
        // who verified their card and later received a real invoice still
        // captured a card.
        const verified = new Set<string>();
        for (const inv of (invoicesRes.data as InvoiceRow[] | null) ?? []) {
          if (inv.status === 'paid' && (inv.amount_due ?? 0) > 0 && (inv.amount_due ?? 0) <= 100) {
            verified.add(inv.tenant_id);
          }
        }
        setCardVerifiedTenants(verified);

        // Tenants who have paid us a REAL invoice at some point. Used to tell a
        // genuine new-signup trial (never paid) from a subscription parked at
        // 'trialing' by the late-payment cycle reset (has paid). Excludes the
        // <=$1 card-verification charge, which every migrated tenant has and
        // which is not revenue.
        const everPaid = new Set<string>();
        for (const inv of (invoicesRes.data as InvoiceRow[] | null) ?? []) {
          if (inv.status === 'paid' && (inv.amount_due ?? 0) > 100) {
            everPaid.add(inv.tenant_id);
          }
        }
        setPaidInvoiceTenantIds(everPaid);

        setSubsLoaded(true);
        setLastSyncedAt(Date.now());
      } catch (error: any) {
        console.error('Error loading subscription data:', error);
        setSubsError(error?.message ?? 'Could not load subscription data.');
      }
    }
  }, []);

  /** First open of the subscription view — this one may show skeletons. */
  useEffect(() => {
    if (viewMode !== 'subscription' || subsLoaded) return;
    void loadSubscriptionData();
  }, [viewMode, subsLoaded, loadSubscriptionData]);

  // ── LIVE SYNC ────────────────────────────────────────────────────────────
  //
  // Without this the operator had to keep the Stripe dashboard open: this page
  // fetched once and latched, so a tenant going past_due was invisible until a
  // manual refresh.
  //
  // Two independent mechanisms, because either alone is untrustworthy:
  //  - Realtime push, for instant updates. tenant_subscriptions IS in the
  //    supabase_realtime publication (verified in production).
  //    tenant_subscription_invoices is NOT, so invoice-only changes never push —
  //    the poll below is what catches those, not a nicety.
  //  - A poll, because a Realtime socket can die SILENTLY. We poll faster while
  //    the socket is not confirmed connected, and back off once it is.
  //
  // A super admin watches ALL tenants, so the channel is deliberately
  // unfiltered — unlike the tenant portal, which filters by tenant_id.
  useEffect(() => {
    if (viewMode !== 'subscription') return;

    const channel = supabase
      .channel('admin-subscription-monitor')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tenant_subscriptions' },
        () => { void loadSubscriptionData(); },
      )
      .subscribe((status) => {
        // Reading this callback is the only way to know the socket is alive.
        // Treating .subscribe() as fire-and-forget is how a dashboard ends up
        // confidently showing hours-old data.
        setRealtimeUp(status === 'SUBSCRIBED');
      });

    return () => {
      setRealtimeUp(false);
      supabase.removeChannel(channel);
    };
  }, [viewMode, loadSubscriptionData]);

  useEffect(() => {
    if (viewMode !== 'subscription') return;
    // 10s while the push channel is unconfirmed, 30s once it is carrying events.
    const everyMs = realtimeUp ? 30_000 : 10_000;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void loadSubscriptionData();
    }, everyMs);
    return () => clearInterval(id);
  }, [viewMode, realtimeUp, loadSubscriptionData]);

  /** Refresh the moment the operator returns to the tab. */
  useEffect(() => {
    if (viewMode !== 'subscription') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadSubscriptionData();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [viewMode, loadSubscriptionData]);

  /** Ticks once a second so the "updated Ns ago" label counts up on its own. */
  useEffect(() => {
    if (viewMode !== 'subscription') return;
    const id = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [viewMode]);

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
    // Show the invoice's OWN currency. This prompt is the one place a human
    // authorises writing off real money, and hardcoding 'usd' rendered a £300 or
    // AED 300 invoice as "$300.00" — the admin then confirmed one amount while
    // the audit log recorded another.
    const reason = window.prompt(
      `Mark ${company}'s ${formatMinor(invoice.amount_due, invoice.currency || 'usd')} invoice as paid?\n\n` +
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
      // supabase-js throws FunctionsHttpError with a generic message ("Edge
      // Function returned a non-2xx status code") and puts the REAL reason in
      // the response body. Without reading it, the function's carefully
      // distinguished 403 / 404 / 409 already-paid / 409 void / 502 Stripe
      // errors all surfaced to the admin as the same useless sentence.
      const body = await e?.context?.json?.().catch(() => null);
      alert(`Could not settle this invoice:\n\n${body?.error ?? e?.message ?? e}`);
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
  // Rows shown in the table: search/type/status/favourites, PLUS the bucket
  // chosen from a summary tile. Deliberately a SEPARATE list from the one the
  // tally uses — computing the tally from this would make clicking "Past due"
  // zero every other tile, leaving no way back.
  const visibleTenants =
    subStatusFilter && isSubscriptionView && subsLoaded
      ? filteredTenants.filter((t) => {
          const sub = selectSubscription(subsByTenant.get(t.id));
          return (
            getSubStatus(sub, planTenantIds.has(t.id), !!oldestUnpaidInvoice.get(t.id)) ===
            subStatusFilter
          );
        })
      : filteredTenants;

  const subscriptionSummary = (() => {
    const tally: Record<SubStatus, number> = {
      active: 0, ending: 0, trialing: 0, 'past-due': 0, canceled: 0, unpaid: 0,
      expired: 0, 'not-converted': 0,
      'paywall-set': 0, 'paywall-not-set': 0,
    };
    const mrrByCurrency: Record<string, number> = {};
    const atRiskByCurrency: Record<string, number> = {};
    for (const t of filteredTenants) {
      const sub = selectSubscription(subsByTenant.get(t.id));
      const owesMoney = !!oldestUnpaidInvoice.get(t.id);
      const status = getSubStatus(sub, planTenantIds.has(t.id), owesMoney);
      tally[status] += 1;

      // A tenant who has ALREADY PAID US is revenue, whatever Stripe's status
      // string says. After a late payment the subscription-webhook defers the
      // next charge with trial_end (the "fresh start" in requirement E7), which
      // parks the subscription at status 'trialing' for a full interval. Counting
      // only 'active' meant the headline figure DROPPED at the exact moment a
      // delinquent tenant paid — the same failure this block's own note warns
      // about for past_due, arrived at from the other direction.
      //
      // A paid invoice is the discriminator: a genuine new-signup trial has none.
      const hasPaidBefore = (paidInvoiceTenantIds?.has(t.id) ?? false);
      // 'ending' is still being billed for the period already paid for, so it is
      // real revenue today — but it is leaving, which is why it gets its own
      // badge rather than being folded into 'Subscribed'.
      //
      // It must NOT skip the hasPaidBefore test. 'ending' now absorbs a
      // *trialing* subscription that has been set to cancel, and an unconverted
      // trial has never paid us anything. Counting it unconditionally made MRR
      // GROW at the moment a free trial was cancelled — the figure moving the
      // wrong way on the one event that can only ever reduce it.
      const endingHasRevenue = sub?.status === 'active' || hasPaidBefore;
      const isRevenueBearing =
        status === 'active' ||
        (status === 'ending' && endingHasRevenue) ||
        (status === 'trialing' && hasPaidBefore);

      // Amounts are kept PER CURRENCY. The plan editor offers USD, GBP and EUR,
      // and these were previously summed into one integer and rendered with a
      // hardcoded 'usd' — so a GBP tenant plus a USD tenant produced a single
      // fabricated dollar figure. This is the one number a super-admin quotes,
      // so an invented total is worse than no total.
      //
      // Yearly plans are normalised to a monthly equivalent, since MRR means
      // MONTHLY recurring revenue and a folded-in annual plan overstates it 12x.
      const monthly =
        sub?.amount && sub.interval === 'year' ? Math.round(sub.amount / 12) : sub?.amount ?? 0;
      const cur = (sub?.currency || 'usd').toLowerCase();

      if (isRevenueBearing && monthly) {
        mrrByCurrency[cur] = (mrrByCurrency[cur] ?? 0) + monthly;
      }

      // Past-due revenue is OWED, not lost. Excluding it entirely made a
      // collections problem look like churn: the moment a card failed, the
      // headline figure silently dropped by that tenant's full amount with
      // nothing on screen saying why. Surface it separately instead.
      //
      // 'unpaid' means Stripe exhausted its retries and gave up — strictly MORE
      // owed than past_due, yet it counted toward neither figure, so a tenant
      // who stopped paying $300/mo showed a red badge and $0 everywhere.
      //
      // And because Stripe's default end-of-dunning is to CANCEL, the commonest
      // debtor lands at 'canceled' with an invoice still open. Keyed on the open
      // invoice rather than the status word, so involuntary churn is counted and
      // a genuine voluntary cancellation (nothing outstanding) is not.
      const atRisk =
        status === 'past-due' ||
        status === 'unpaid' ||
        ((status === 'canceled' || status === 'expired') && owesMoney);
      if (atRisk && monthly) {
        atRiskByCurrency[cur] = (atRiskByCurrency[cur] ?? 0) + monthly;
      }
    }
    return { tally, mrrByCurrency, atRiskByCurrency };
  })();

  /** "$1,307.00" or, for a mixed portfolio, "$1,307.00 + £450.00". */
  const formatByCurrency = (totals: Record<string, number>): string => {
    const entries = Object.entries(totals).filter(([, v]) => v > 0);
    if (entries.length === 0) return formatMinor(0, 'usd');
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([cur, v]) => formatMinor(v, cur))
      .join(' + ');
  };

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
                  onValueChange={(v) => { setViewMode(v as ViewMode); setSubStatusFilter(null); }}
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
            {/* FRESHNESS. This screen replaces the Stripe dashboard for
                monitoring, so it must never present stale data as current. The
                age counts up on its own (nowTick) — a frozen "just now" is
                exactly the lie we are guarding against. Amber past 2 minutes
                means both the push channel and the poll have stopped. */}
            {(() => {
              const ageMs = lastSyncedAt ? nowTick - lastSyncedAt : null;
              const stale = ageMs != null && ageMs > 120_000;
              const ageLabel =
                ageMs == null
                  ? 'not yet synced'
                  : ageMs < 10_000
                    ? 'just now'
                    : ageMs < 60_000
                      ? `${Math.floor(ageMs / 1000)}s ago`
                      : `${Math.floor(ageMs / 60_000)}m ago`;
              return (
                <div className="flex items-center gap-2 mb-3 text-xs">
                  <span
                    className={cn(
                      'inline-flex h-2 w-2 rounded-full',
                      stale
                        ? 'bg-amber-500'
                        : realtimeUp
                          ? 'bg-emerald-500 animate-pulse'
                          : 'bg-sky-500',
                    )}
                  />
                  <span className={stale ? 'text-amber-500' : 'text-muted-foreground'}>
                    {stale
                      ? `Not updating — last synced ${ageLabel}`
                      : realtimeUp
                        ? `Live · updated ${ageLabel}`
                        : `Polling · updated ${ageLabel}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadSubscriptionData()}
                    className="ml-1 font-medium text-primary hover:underline"
                  >
                    Sync now
                  </button>
                </div>
              );
            })()}
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              {(
                [
                  ['active', 'Subscribed'],
                  ['ending', 'Ending'],
                  ['trialing', 'Trialing'],
                  ['past-due', 'Past due'],
                  ['unpaid', 'Unpaid'],
                  ['canceled', 'Canceled'],
                  ['expired', 'Expired'],
                  ['not-converted', 'Not converted'],
                  ['paywall-set', 'Not subscribed'],
                  ['paywall-not-set', 'Paywall not set'],
                ] as [SubStatus, string][]
              ).map(([key, label]) => {
                const active = subStatusFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSubStatusFilter(active ? null : key)}
                    title={active ? 'Show all' : `Show only ${label}`}
                    className={cn(
                      'flex flex-col items-start rounded-md px-2 py-1 -mx-2 transition-colors text-left',
                      active ? 'bg-primary/15 ring-1 ring-primary/30' : 'hover:bg-secondary/60'
                    )}
                  >
                    <span className="text-xl font-semibold tabular-nums">
                      {subscriptionSummary.tally[key]}
                    </span>
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </button>
                );
              })}
              {Object.keys(subscriptionSummary.atRiskByCurrency).length > 0 && (
                <div className="flex flex-col ml-auto text-right">
                  <span className="text-xl font-semibold tabular-nums text-amber-400">
                    {formatByCurrency(subscriptionSummary.atRiskByCurrency)}
                  </span>
                  <span className="text-xs text-muted-foreground">At risk (owed)</span>
                </div>
              )}
              <div
                className={cn(
                  'flex flex-col text-right',
                  Object.keys(subscriptionSummary.atRiskByCurrency).length > 0 ? '' : 'ml-auto'
                )}
              >
                <span className="text-xl font-semibold tabular-nums text-emerald-400">
                  {formatByCurrency(subscriptionSummary.mrrByCurrency)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Active subscription volume{' '}
                  <span className="opacity-70">(monthly)</span>
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* The subscription reads failed. Say so loudly: this screen is used to
          chase clients about billing, so silently rendering every tenant as
          "Paywall not set" with $0 volume would send someone after the wrong
          people with total confidence. */}
      {isSubscriptionView && subsError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              {/* Say what is actually true. The old copy claimed the figures
                  "are not shown", but the stat cards and every table row kept
                  rendering underneath it — so the banner reassured the operator
                  that nothing misleading was on screen while the misleading
                  numbers sat directly below it. */}
              <p className="font-medium text-destructive">
                Could not refresh subscription data — anything below may be out of date.
              </p>
              <p className="text-muted-foreground mt-1">{subsError}</p>
              <button
                type="button"
                onClick={() => {
                  setSubsError(null);
                  setSubsLoaded(false);
                }}
                className="mt-2 text-sm font-medium text-primary hover:underline"
              >
                Retry
              </button>
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
              <TableHead>Owner</TableHead>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTenants.map((tenant) => (
              <TableRow
                key={tenant.id}
                onClick={() => router.push(`/admin/rentals/${tenant.id}`)}
                className="cursor-pointer"
              >
                <TableCell className="pr-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(tenant.id); }}
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
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {tenant.admin_name || '—'}
                </TableCell>
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
                  const inv = latestInvoice.get(tenant.id);
                  const unpaid = oldestUnpaidInvoice.get(tenant.id);
                  const due = nextInvoiceDue(sub, unpaid);
                  // Resolved BEFORE the status call — a terminal subscription
                  // with a debt must not fall through to the plan-based bucket.
                  const owesMoney = !!unpaid;
                  const subStatus = getSubStatus(
                    sub,
                    planTenantIds.has(tenant.id),
                    owesMoney,
                  );

                  // A terminal status does NOT mean nothing is owed.
                  //
                  // Stripe's DEFAULT end-of-dunning behaviour is to CANCEL the
                  // subscription, so the most common way a debtor ends up
                  // terminal is status='canceled' with an invoice still open.
                  // Badging that plain grey "Canceled" would hide involuntary
                  // churn behind a label that reads "ended deliberately, nothing
                  // owed" — the opposite of the truth, on the screen used to
                  // decide who to chase. Money owed always outranks the status
                  // word. (owesMoney is resolved above, before getSubStatus.)
                  const meta =
                    owesMoney && (subStatus === 'canceled' || subStatus === 'expired')
                      ? {
                          label: `${SUB_STATUS_META[subStatus].label} · balance owed`,
                          className: 'bg-destructive/15 text-destructive border-destructive/30',
                        }
                      : SUB_STATUS_META[subStatus];

                  // Derived from LIVE_STATUSES rather than a hand-listed set, so
                  // a future SubStatus cannot silently fall through to a blank
                  // date cell — the same silent-omission failure as the bug this
                  // commit set out to fix.
                  const isTerminal = !!sub && !LIVE_STATUSES.has(sub.status);
                  const endedOn = isTerminal ? subscriptionEndedOn(sub) : null;

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
                                cardVerifiedTenants.has(tenant.id)
                                  ? 'text-sky-400'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {cardVerifiedTenants.has(tenant.id)
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
                        {/* The settle-out-of-band escape hatch is gated on the
                            EXISTENCE of an unpaid invoice, not on due.overdue.
                            It used to sit inside the `due.date` branch behind
                            `due.overdue &&`, so it disappeared for precisely the
                            tenants who most need it: nextInvoiceDue returns no
                            date once a subscription lapses to unpaid/canceled,
                            and a tenant sitting behind the hard paywall then had
                            no admin route back in at all. */}
                        <div className="flex flex-col gap-0.5">
                          {endedOn ? (
                            // Expired rows have no "next" invoice — show when it ended.
                            <span className="text-muted-foreground">
                              Ended {formatDay(endedOn)}
                            </span>
                          ) : due.ending && due.date ? (
                            // No invoice will be issued — the subscription is
                            // already booked to cancel. Printing the period end
                            // as a due date promised a charge that never comes.
                            <span className="font-medium text-orange-400">
                              Ends {formatDay(due.date)} · no renewal
                            </span>
                          ) : due.date ? (
                            <span className={due.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                              {due.overdue ? `Overdue since ${formatDay(due.date)}` : formatDay(due.date)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {unpaid && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMarkPaid(unpaid, tenant.company_name); }}
                              disabled={settlingInvoiceId === unpaid.id}
                              className="w-fit text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
                            >
                              {settlingInvoiceId === unpaid.id ? 'Settling…' : 'Mark as paid'}
                            </button>
                          )}
                        </div>
                      </TableCell>
                      {/* Every Stripe invoice status is named explicitly below.
                          The old `: 'Failed'` catch-all meant a DRAFT or VOID
                          invoice — neither of which failed, and neither of which
                          anyone owes — was announced in red as a failed payment.
                          Stripe raises a $0.00 draft as a matter of course when a
                          subscription ends, so this fired on ordinary
                          cancellations. */}
                      <TableCell className="whitespace-nowrap">
                        {inv ? (
                          <span
                            className={cn(
                              'text-[11px] font-medium',
                              verificationChargeSucceeded(inv)
                                ? 'text-muted-foreground'
                                : isVerificationCharge(inv) && inv.status === 'open'
                                ? 'text-destructive'
                                : inv.status === 'paid'
                                ? 'text-emerald-400'
                                : inv.status === 'open'
                                ? ((inv.attempt_count ?? 0) > 0 ? 'text-destructive' : 'text-amber-400')
                                : inv.status === 'uncollectible'
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                            )}
                          >
                            {verificationChargeSucceeded(inv)
                              ? 'Card verified'
                              : isVerificationCharge(inv) && inv.status === 'open'
                              // The $1 hold was attempted and refused — the
                              // opposite of verified.
                              ? ((inv.attempt_count ?? 0) > 0 ? 'Card declined' : 'Card check pending')
                              : inv.status === 'paid'
                              ? 'Paid'
                              : inv.status === 'open'
                              // Stripe keeps a declined invoice at 'open'. Only
                              // attempt_count tells us it was actually tried and
                              // refused, versus simply not due yet.
                              ? ((inv.attempt_count ?? 0) > 0 ? 'Payment failed' : 'Unpaid')
                              : inv.status === 'draft'
                              ? 'Draft'
                              : inv.status === 'void'
                              ? 'Voided'
                              : inv.status === 'uncollectible'
                              ? 'Written off'
                              : inv.status}
                            <span className="text-muted-foreground ml-1">
                              {formatDay(inv.invoice_date || inv.created_at)}
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
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {visibleTenants.length === 0 && (
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
