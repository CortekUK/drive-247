'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Cross-tenant security-deposit hold health.
//
// The per-tenant view (`tenant-payments-tab.tsx`) answers "how is THIS tenant
// doing?" — you have to already suspect a tenant to look. Nothing answered
// "which of the 28 tenants has money stranded on a card right now?", so a
// chain that stopped refreshing was only ever discovered by the operator
// phoning in. This component is that missing view.
//
// Three rules it exists to enforce, each of which a previous surface broke:
//
//   1. NO PLATFORM FILTER. The migration-era reads were pinned to
//      `platform_account = 'uk'`, so every hold placed on the UAE account was
//      invisible. A hold is money on a renter's card regardless of which
//      platform account it was authorised under, and `platform_account` is
//      rendered as a COLUMN here rather than used as a filter.
//
//   2. THE NULL-STATUS COHORT IS REAL. `place-deposit-hold` rolls
//      `deposit_hold_status` back to NULL on every failure path (so the claim
//      can be re-taken) while still writing `deposit_hold_last_error`. A hold
//      that NEVER got placed is therefore a NULL status — it matches no
//      `.in(status, …)` filter and rendered nowhere at all, even though it
//      means an unsecured rental. On production that is 4 of GMT's 10 active
//      rentals. It is fetched separately and labelled `not_placed`.
//
//   3. FAILURE OUTRANKS HEALTH. Rows are sorted worst-first by an explicit
//      severity ladder, not by recency — the whole point is that the one
//      broken chain is on the first screen.
//
// Read-only by construction: this component issues SELECTs only. Every
// remediation lives on the tenant/rental pages that own it, so there is no way
// to fire a destructive Stripe call by mis-clicking in a monitoring view.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
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
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  ShieldOff,
} from 'lucide-react';

// ── Domain constants ────────────────────────────────────────────────────────

// A card authorization only truly ends two ways: the money is taken
// (`captured`) or given back (`released`). Everything else is either live money
// on someone's card or a broken hold that needs a human. `expired` stays in the
// list on purpose — it is the fingerprint of a refresh that died.
//
// Deliberately duplicated from tenant-payments-tab rather than imported: that
// file does not export it, and this view must not be able to break by editing
// the other. If they ever diverge, THIS list is the cross-tenant contract.
const NON_TERMINAL_HOLD_STATUSES = [
  'processing',
  'refreshing',
  'capturing',
  'held',
  'requires_action',
  'failed',
  'needs_review',
  'disputed',
  'expired',
];

/** Synthetic status for the NULL-status-with-an-error cohort (see header). */
const NOT_PLACED = 'not_placed';

/** Statuses meaning the renter's card is (or is meant to be) reserved. */
const LIVE_HOLD_STATUSES = new Set(['held', 'processing', 'refreshing', 'capturing']);

/**
 * Rental lifecycles where a dead hold is history rather than a to-do. Dormancy
 * is keyed on the HOLD as well as the rental: a `held` row on a Completed
 * rental is still live money and stays in the actionable list.
 *
 * Mirrors TERMINAL_RENTAL_STATUSES in `_shared/deposit-hold-refresh.ts` — the
 * refresh driver will never touch these rentals again, so a broken hold on one
 * is by definition not something the chain is going to fix. 'Ended' is not in
 * the engine's list but appears in older data, and both spellings of
 * cancel(l)ed exist.
 */
const ENDED_RENTAL_STATUSES = new Set([
  'Completed',
  'Cancelled',
  'Canceled',
  'Rejected',
  'Ended',
  'Closed',
]);

/**
 * The warning window. Three days is the last point at which an operator can
 * still act before a weekend swallows the deadline — the same threshold the
 * portal's rental page uses, so the two surfaces agree about what "soon" means.
 */
const EXPIRY_WARN_MS = 3 * 24 * 3_600_000;

/** A verification older than this tells you nothing about today. */
const STALE_VERIFY_MS = 7 * 24 * 3_600_000;

/**
 * PostgREST silently caps at 1000 rows. Ask for fewer than that explicitly and
 * pair it with an exact count, so a truncated table says so instead of looking
 * complete.
 */
const ROW_LIMIT = 500;

const HOLD_COLUMNS =
  'id, tenant_id, rental_number, status, end_date, platform_account, ' +
  'deposit_hold_amount, deposit_hold_currency, deposit_hold_status, deposit_hold_expires_at, ' +
  'deposit_hold_status_changed_at, deposit_hold_attempt_seq, deposit_hold_failure_count, ' +
  'deposit_hold_last_error, deposit_hold_last_error_code, deposit_hold_extended_auth, ' +
  'deposit_hold_verified_at, deposit_hold_connect_account_id, deposit_hold_stripe_mode, ' +
  'deposit_hold_card_brand, deposit_hold_card_last4';

export interface DepositHoldHealthRow {
  id: string;
  tenant_id?: string | null;
  rental_number?: string | null;
  status?: string | null;
  end_date?: string | null;
  platform_account?: string | null;
  deposit_hold_amount?: number | null;
  deposit_hold_currency?: string | null;
  deposit_hold_status?: string | null;
  deposit_hold_expires_at?: string | null;
  deposit_hold_status_changed_at?: string | null;
  deposit_hold_attempt_seq?: number | null;
  deposit_hold_failure_count?: number | null;
  deposit_hold_last_error?: string | null;
  deposit_hold_last_error_code?: string | null;
  deposit_hold_extended_auth?: boolean | null;
  deposit_hold_verified_at?: string | null;
  deposit_hold_connect_account_id?: string | null;
  deposit_hold_stripe_mode?: string | null;
  deposit_hold_card_brand?: string | null;
  deposit_hold_card_last4?: string | null;
}

interface TenantLabel {
  id: string;
  slug: string | null;
  company_name: string | null;
}

const HOLD_STATUS_STYLES: Record<
  string,
  { variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'; label: string }
> = {
  held: { variant: 'warning', label: 'Held' },
  processing: { variant: 'info', label: 'Processing' },
  refreshing: { variant: 'info', label: 'Refreshing' },
  capturing: { variant: 'default', label: 'Capturing' },
  requires_action: { variant: 'warning', label: 'Needs customer action' },
  [NOT_PLACED]: { variant: 'destructive', label: 'Never placed' },
  failed: { variant: 'destructive', label: 'Failed' },
  needs_review: { variant: 'destructive', label: 'Needs review' },
  disputed: { variant: 'destructive', label: 'Disputed' },
  expired: { variant: 'destructive', label: 'Expired' },
};

// ── Formatting ──────────────────────────────────────────────────────────────

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  const ts = new Date(d);
  if (Number.isNaN(ts.getTime())) return d;
  return ts.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * deposit_hold_amount is stored in MAJOR units (dollars), unlike subscription
 * plan amounts which are in cents. Do not divide by 100.
 */
function fmtHoldAmount(amount?: number | null, currency?: string | null) {
  if (amount == null) return '—';
  const code = (currency || 'usd').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${code}`;
  }
}

function relativeAge(iso?: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const hours = ms / 3_600_000;
  if (hours < 1) return 'just now';
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Expiry is the whole ballgame for a card authorization: an hour past it and
 * the issuer has already released the funds. Render the distance, not just the
 * timestamp.
 */
function expiryVerdict(
  row: DepositHoldHealthRow,
): { text: string; cls: string; warn: boolean } {
  if (row.deposit_hold_status === NOT_PLACED) {
    return { text: 'Never placed', cls: 'text-red-400 font-medium', warn: true };
  }
  const iso = row.deposit_hold_expires_at;
  if (!iso) {
    // A hold row with no expiry is invisible to a `.lt()` deadline filter (NULL
    // comparisons yield NULL, not true). The refresh driver sorts these first
    // precisely because nothing else can find them.
    return { text: 'No expiry recorded', cls: 'text-red-400 font-medium', warn: true };
  }
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return { text: iso, cls: 'text-muted-foreground', warn: false };
  if (ms <= 0) {
    const overdue = Math.abs(ms) / 3_600_000;
    return {
      text: overdue < 48 ? `Expired ${Math.round(overdue)}h ago` : `Expired ${Math.round(overdue / 24)}d ago`,
      cls: 'text-red-400 font-medium',
      warn: true,
    };
  }
  const hours = ms / 3_600_000;
  const text = hours < 48 ? `in ${Math.round(hours)}h` : `in ${Math.round(hours / 24)}d`;
  const soon = ms <= EXPIRY_WARN_MS;
  return {
    text,
    cls: soon ? 'text-amber-400 font-medium' : 'text-muted-foreground',
    warn: soon,
  };
}

// ── Severity ────────────────────────────────────────────────────────────────

export type HoldSeverity = 'critical' | 'warning' | 'ok' | 'dormant';

interface Verdict {
  /** Lower sorts first. */
  rank: number;
  level: HoldSeverity;
  reason: string;
}

/**
 * The sort order IS the product here. A super admin scanning this table must
 * hit the unsecured rentals before the healthy ones, so severity is an explicit
 * ladder rather than "most recently changed".
 *
 * Dormant rows — a dead hold on a rental that already ended — are ranked last
 * and excluded from the attention counters. Nobody can act on them and they
 * accumulate forever, so leaving them in the main ordering would bury the rows
 * that do need a human. A LIVE hold on an ended rental is deliberately NOT
 * dormant: that is still real money on someone's card.
 */
export function classifyHold(row: DepositHoldHealthRow, now: number = Date.now()): Verdict {
  const status = row.deposit_hold_status || '';
  const isLive = LIVE_HOLD_STATUSES.has(status);
  const rentalEnded = ENDED_RENTAL_STATUSES.has(row.status || '');

  if (!isLive && rentalEnded) {
    return { rank: 90, level: 'dormant', reason: 'Rental has ended — history, not a to-do' };
  }

  if (status === NOT_PLACED) {
    return { rank: 0, level: 'critical', reason: 'Hold was never placed — this rental is unsecured' };
  }
  if (status === 'needs_review' || status === 'disputed') {
    return { rank: 1, level: 'critical', reason: 'The chain stopped and asked for a human' };
  }
  if (status === 'failed') {
    return { rank: 2, level: 'critical', reason: 'Last authorization attempt failed' };
  }
  if (status === 'expired') {
    return { rank: 3, level: 'critical', reason: 'Authorization lapsed and was not replaced' };
  }

  const expiresAt = row.deposit_hold_expires_at ? new Date(row.deposit_hold_expires_at).getTime() : NaN;

  if (isLive && (!row.deposit_hold_expires_at || Number.isNaN(expiresAt))) {
    return {
      rank: 4,
      level: 'critical',
      reason: 'We claim this hold is alive but recorded no expiry — the refresh cron cannot see it',
    };
  }
  if (isLive && expiresAt <= now) {
    return {
      rank: 5,
      level: 'critical',
      reason: 'Deadline has passed while we still show the hold as alive',
    };
  }
  if (status === 'requires_action') {
    return { rank: 6, level: 'warning', reason: 'Waiting on the cardholder to authenticate' };
  }
  if (isLive && expiresAt - now <= EXPIRY_WARN_MS) {
    return { rank: 7, level: 'warning', reason: 'Expires within three days' };
  }
  if ((row.deposit_hold_failure_count ?? 0) > 0) {
    return { rank: 8, level: 'warning', reason: 'Recovered, but this chain has failed before' };
  }
  if (isLive) {
    return { rank: 9, level: 'ok', reason: 'Live hold, deadline comfortably ahead' };
  }
  // An unrecognised status must never be scored as healthy — a status nobody
  // enumerated is exactly the kind of thing worth looking at.
  return { rank: 6, level: 'warning', reason: `Unrecognised hold status "${status || 'none'}"` };
}

/** Sortable expiry. Unknown deadlines sort FIRST within their severity band. */
function expiryKey(row: DepositHoldHealthRow): number {
  if (!row.deposit_hold_expires_at) return Number.NEGATIVE_INFINITY;
  const t = new Date(row.deposit_hold_expires_at).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

type FilterKey = 'attention' | 'critical' | 'live' | 'all';

// ── Component ───────────────────────────────────────────────────────────────

export function DepositHoldHealth() {
  const [rows, setRows] = useState<DepositHoldHealthRow[]>([]);
  const [tenantsById, setTenantsById] = useState<Record<string, TenantLabel>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('attention');

  const load = useCallback(async () => {
    // Three independent reads rather than one embedded join. A PostgREST embed
    // 400s the ENTIRE query if the relationship can't be resolved (two FKs to
    // `tenants` already exist through views), which would blank the table over
    // a naming problem. Splitting them means a failure degrades to "hold rows
    // without tenant names" instead of "no hold rows".
    const [activeRes, notPlacedRes, tenantsRes] = await Promise.all([
      // Every non-terminal hold, on EVERY tenant, on BOTH platform accounts.
      supabase
        .from('rentals')
        .select(HOLD_COLUMNS, { count: 'exact' })
        .in('deposit_hold_status', NON_TERMINAL_HOLD_STATUSES)
        .order('deposit_hold_expires_at', { ascending: true, nullsFirst: true })
        .limit(ROW_LIMIT),
      // NEVER PLACED — status is NULL because place-deposit-hold rolled it
      // back, but an error was recorded. Kept as its own read so a grant or
      // syntax problem on one query cannot blank out the other.
      supabase
        .from('rentals')
        .select(HOLD_COLUMNS, { count: 'exact' })
        .is('deposit_hold_status', null)
        .not('deposit_hold_last_error', 'is', null)
        .order('created_at', { ascending: false })
        .limit(ROW_LIMIT),
      supabase.from('tenants').select('id, slug, company_name'),
    ]);

    const active = (activeRes.data as DepositHoldHealthRow[] | null) ?? [];
    // A NULL status is not a status — label it so the table can say what it is.
    const notPlaced = ((notPlacedRes.data as DepositHoldHealthRow[] | null) ?? []).map((r) => ({
      ...r,
      deposit_hold_status: NOT_PLACED,
    }));

    // The two reads are mutually exclusive by predicate, but they are issued in
    // parallel: a row whose status flips from NULL to 'processing' between them
    // comes back in both. De-duplicate on id (the real status wins over the
    // synthetic `not_placed`) so the table cannot render duplicate React keys or
    // double-count the same rental in the stat cards.
    const byId = new Map<string, DepositHoldHealthRow>();
    for (const r of notPlaced) byId.set(r.id, r);
    for (const r of active) byId.set(r.id, r);
    const merged = [...byId.values()];

    setRows(merged);
    // Discount the overlap from the server-side counts too, or a single
    // duplicated row would make `total > rows.length` and the table would
    // announce it was truncated when it is complete.
    const overlap = active.length + notPlaced.length - merged.length;
    setTotal(
      Math.max(
        merged.length,
        (activeRes.count ?? active.length) + (notPlacedRes.count ?? notPlaced.length) - overlap,
      ),
    );
    // Surface failures instead of rendering an empty, reassuring table.
    setLoadError(
      [activeRes.error?.message, notPlacedRes.error?.message].filter(Boolean).join(' · ') || null,
    );

    const labels: Record<string, TenantLabel> = {};
    for (const t of ((tenantsRes.data as TenantLabel[] | null) ?? [])) labels[t.id] = t;
    setTenantsById(labels);
    setTenantsError(tenantsRes.error ? tenantsRes.error.message : null);

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Classify once per load, not once per render pass, so every counter, filter
  // and row badge is reading the SAME verdict — a row cannot be counted as
  // critical in the stat card and rendered as healthy in the table.
  const classified = useMemo(() => {
    const now = Date.now();
    return rows
      .map((row) => ({ row, verdict: classifyHold(row, now) }))
      .sort((a, b) => {
        if (a.verdict.rank !== b.verdict.rank) return a.verdict.rank - b.verdict.rank;
        const ax = expiryKey(a.row);
        const bx = expiryKey(b.row);
        if (ax !== bx) return ax - bx;
        // More failures first — a chain that has fallen over eight times is a
        // worse row than one that fell over once.
        const aFails = a.row.deposit_hold_failure_count ?? 0;
        const bFails = b.row.deposit_hold_failure_count ?? 0;
        if (aFails !== bFails) return bFails - aFails;
        return a.row.id.localeCompare(b.row.id);
      });
  }, [rows]);

  const counts = useMemo(() => {
    let critical = 0;
    let warning = 0;
    let live = 0;
    let dormant = 0;
    for (const { row, verdict } of classified) {
      if (verdict.level === 'critical') critical++;
      else if (verdict.level === 'warning') warning++;
      else if (verdict.level === 'dormant') dormant++;
      if (LIVE_HOLD_STATUSES.has(row.deposit_hold_status || '')) live++;
    }
    return { critical, warning, live, dormant };
  }, [classified]);

  // Multi-currency by construction (UK and UAE tenants both appear here), so
  // there is no single total to show. One figure per currency is the honest
  // rendering; a summed number would be a lie in two currencies at once.
  const liveByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const { row } of classified) {
      if (!LIVE_HOLD_STATUSES.has(row.deposit_hold_status || '')) continue;
      const code = (row.deposit_hold_currency || 'usd').toUpperCase();
      totals[code] = (totals[code] ?? 0) + (Number(row.deposit_hold_amount) || 0);
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
  }, [classified]);

  const tenantLabel = useCallback(
    (tenantId?: string | null) => {
      if (!tenantId) return { name: 'Unknown tenant', slug: null as string | null };
      const t = tenantsById[tenantId];
      return {
        name: t?.company_name || t?.slug || `${tenantId.slice(0, 8)}…`,
        slug: t?.slug ?? null,
      };
    },
    [tenantsById],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classified.filter(({ row, verdict }) => {
      if (filter === 'critical' && verdict.level !== 'critical') return false;
      if (filter === 'attention' && verdict.level !== 'critical' && verdict.level !== 'warning') return false;
      if (filter === 'live' && !LIVE_HOLD_STATUSES.has(row.deposit_hold_status || '')) return false;
      if (!q) return true;
      const { name, slug } = tenantLabel(row.tenant_id);
      return (
        name.toLowerCase().includes(q) ||
        (slug ?? '').toLowerCase().includes(q) ||
        (row.rental_number ?? '').toLowerCase().includes(q) ||
        row.id.toLowerCase().includes(q) ||
        (row.deposit_hold_last_error_code ?? '').toLowerCase().includes(q) ||
        (row.deposit_hold_status ?? '').toLowerCase().includes(q)
      );
    });
  }, [classified, filter, query, tenantLabel]);

  const truncated = total > rows.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <ShieldAlert className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Deposit Hold Health</h2>
            <p className="text-sm text-muted-foreground">
              Every live and broken security-deposit authorization, across all tenants and both
              platform accounts ·{' '}
              <span className="tabular-nums">{rows.length}</span> hold{rows.length === 1 ? '' : 's'}
              {liveByCurrency.length > 0 && (
                <>
                  {' '}· reserved:{' '}
                  <span className="tabular-nums">
                    {liveByCurrency.map(([code, amount]) => fmtHoldAmount(amount, code)).join(' + ')}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            load();
          }}
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* A failed read must never look like a clean board. */}
      {loadError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-red-400">
          Could not load deposit holds ({loadError}). Treat this list as UNKNOWN, not as empty.
        </div>
      )}
      {tenantsError && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-amber-400">
          Tenant names unavailable ({tenantsError}). Hold rows below are complete; only the labels
          fell back to tenant IDs.
        </div>
      )}
      {truncated && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-amber-400">
          Showing {rows.length} of {total} holds — the list is capped at {ROW_LIMIT} per query. Narrow
          it with the search box; the worst rows are already at the top.
        </div>
      )}

      {/* Stat cards double as filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Critical"
          value={counts.critical}
          icon={ShieldOff}
          tone="critical"
          active={filter === 'critical'}
          onClick={() => setFilter(filter === 'critical' ? 'all' : 'critical')}
        />
        <StatCard
          label="Needs attention"
          value={counts.critical + counts.warning}
          icon={AlertTriangle}
          tone="warning"
          active={filter === 'attention'}
          onClick={() => setFilter(filter === 'attention' ? 'all' : 'attention')}
        />
        <StatCard
          label="Live holds"
          value={counts.live}
          icon={CheckCircle2}
          tone="ok"
          active={filter === 'live'}
          onClick={() => setFilter(filter === 'live' ? 'all' : 'live')}
        />
        <StatCard
          label="All holds"
          value={rows.length}
          icon={Clock}
          tone="neutral"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          hint={counts.dormant > 0 ? `${counts.dormant} on ended rentals` : undefined}
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search tenant, rental number, status or Stripe error code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Rental</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Last error</TableHead>
                  <TableHead>Verified vs Stripe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                      {rows.length === 0
                        ? 'No deposit holds on any tenant.'
                        : 'No holds match this filter.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map(({ row, verdict }) => (
                    <HoldRow
                      key={row.id}
                      row={row}
                      verdict={verdict}
                      tenant={tenantLabel(row.tenant_id)}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default DepositHoldHealth;

// ── Pieces ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
  hint,
}: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  tone: 'critical' | 'warning' | 'ok' | 'neutral';
  active: boolean;
  onClick: () => void;
  hint?: string;
}) {
  const toneCls =
    tone === 'critical'
      ? { ring: 'border-destructive/40 bg-destructive/5', chip: 'bg-destructive/15', icon: 'text-red-400' }
      : tone === 'warning'
        ? { ring: 'border-warning/40 bg-warning/5', chip: 'bg-warning/15', icon: 'text-warning' }
        : tone === 'ok'
          ? { ring: 'border-success/40 bg-success/5', chip: 'bg-success/15', icon: 'text-success' }
          : { ring: 'border-primary/40 bg-primary/5', chip: 'bg-primary/15', icon: 'text-primary' };

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn('cursor-pointer transition-all', active && toneCls.ring)}
    >
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
          </div>
          <div className={cn('flex items-center justify-center h-10 w-10 rounded-lg', toneCls.chip)}>
            <Icon className={cn('h-5 w-5', toneCls.icon)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HoldRow({
  row,
  verdict,
  tenant,
}: {
  row: DepositHoldHealthRow;
  verdict: Verdict;
  tenant: { name: string; slug: string | null };
}) {
  const status = row.deposit_hold_status || '';
  const style = HOLD_STATUS_STYLES[status] || { variant: 'outline' as const, label: status || 'unknown' };
  const expiry = expiryVerdict(row);
  const verifiedAge = relativeAge(row.deposit_hold_verified_at);
  const verifyStale =
    !row.deposit_hold_verified_at ||
    Date.now() - new Date(row.deposit_hold_verified_at).getTime() > STALE_VERIFY_MS;

  return (
    <TableRow
      className={cn(
        verdict.level === 'critical' && 'bg-destructive/[0.05]',
        verdict.level === 'warning' && 'bg-warning/[0.04]',
        verdict.level === 'dormant' && 'opacity-60',
      )}
    >
      <TableCell className="whitespace-nowrap">
        {row.tenant_id ? (
          <Link href={`/admin/rentals/${row.tenant_id}`} className="group inline-flex flex-col">
            <span className="font-medium group-hover:text-primary transition-colors">{tenant.name}</span>
            {tenant.slug && <span className="text-xs text-muted-foreground">{tenant.slug}</span>}
          </Link>
        ) : (
          <span className="text-muted-foreground">No tenant on rental</span>
        )}
      </TableCell>

      <TableCell className="font-mono text-xs whitespace-nowrap">
        <span title={row.id}>{row.rental_number || `${row.id.slice(0, 8)}…`}</span>
        {row.status && <span className="block text-muted-foreground normal-case">{row.status}</span>}
        {(row.deposit_hold_card_brand || row.deposit_hold_card_last4) && (
          <span className="block text-muted-foreground normal-case">
            {row.deposit_hold_card_brand || 'card'} ••{row.deposit_hold_card_last4 || '????'}
          </span>
        )}
      </TableCell>

      <TableCell className="whitespace-nowrap">
        {/* Rendered, never filtered on: a hold is money regardless of which
            platform account authorised it. The Connect account it was actually
            placed on is what any remediation must reuse, so it is in the title. */}
        <Badge
          variant={row.platform_account === 'uk' ? 'secondary' : 'outline'}
          className="uppercase"
          title={
            row.deposit_hold_connect_account_id
              ? `Placed on ${row.deposit_hold_connect_account_id}`
              : 'No Connect account recorded on this hold'
          }
        >
          {row.platform_account || '—'}
        </Badge>
        {row.deposit_hold_stripe_mode && row.deposit_hold_stripe_mode !== 'live' && (
          <Badge variant="warning" className="ml-1 uppercase">
            {row.deposit_hold_stripe_mode}
          </Badge>
        )}
      </TableCell>

      <TableCell className="whitespace-nowrap tabular-nums">
        {fmtHoldAmount(row.deposit_hold_amount, row.deposit_hold_currency)}
      </TableCell>

      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Badge variant={style.variant} title={verdict.reason}>
            {style.label}
          </Badge>
          {/* `null` means UNKNOWN, not false — an account without extended
              authorization is capped at the ~5-7 day network default, which is
              the difference between a 4-link chain and an 18-link one. */}
          {row.deposit_hold_extended_auth === true ? (
            <Badge variant="success" className="text-[10px]">
              Extended auth
            </Badge>
          ) : row.deposit_hold_extended_auth === false ? (
            <span className="text-[10px] text-muted-foreground">Standard auth</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">Auth window unknown</span>
          )}
        </div>
      </TableCell>

      <TableCell className="text-sm whitespace-nowrap">
        <span className={cn('inline-flex items-center gap-1', expiry.cls)}>
          {expiry.warn && <AlertTriangle className="h-3 w-3 shrink-0" />}
          {expiry.text}
        </span>
        {status !== NOT_PLACED && row.deposit_hold_expires_at && (
          <span className="block text-xs text-muted-foreground">
            {fmtDateTime(row.deposit_hold_expires_at)}
          </span>
        )}
      </TableCell>

      <TableCell className="text-sm whitespace-nowrap tabular-nums">
        #{row.deposit_hold_attempt_seq ?? 0}
        {(row.deposit_hold_failure_count ?? 0) > 0 && (
          <span className="text-red-400 font-medium"> · {row.deposit_hold_failure_count} failed</span>
        )}
      </TableCell>

      <TableCell className="text-xs max-w-[240px]">
        {row.deposit_hold_last_error_code ? (
          <>
            <code className="text-red-400">{row.deposit_hold_last_error_code}</code>
            {row.deposit_hold_last_error && (
              <span className="block text-muted-foreground truncate" title={row.deposit_hold_last_error}>
                {row.deposit_hold_last_error}
              </span>
            )}
          </>
        ) : row.deposit_hold_last_error ? (
          <span className="block text-muted-foreground truncate" title={row.deposit_hold_last_error}>
            {row.deposit_hold_last_error}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell className="text-xs whitespace-nowrap">
        {row.deposit_hold_verified_at ? (
          <>
            <span className={cn(verifyStale ? 'text-amber-400' : 'text-muted-foreground')}>
              {verifiedAge}
            </span>
            <span className="block text-muted-foreground">
              {fmtDateTime(row.deposit_hold_verified_at)}
            </span>
          </>
        ) : (
          <span className="text-amber-400" title="This row has never been reconciled against Stripe">
            Never
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
