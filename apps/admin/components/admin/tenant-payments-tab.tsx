'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { OperatorPromptCard } from './operator-prompt-card';
import {
  Copy,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Link2,
  CreditCard,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
} from 'lucide-react';

interface PaymentsTenant {
  id: string;
  slug: string;
  company_name: string;
  stripe_mode: 'test' | 'live';
  payment_model: 'managed' | 'own';
  subscription_account: 'uk' | 'uae';
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
  own_stripe_connected_at: string | null;
  own_stripe_test_connected_at: string | null;
  stripe_account_id: string | null;
  stripe_account_status: string | null;
  stripe_onboarding_complete: boolean | null;
}

interface PlanOption {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
  is_active: boolean;
  stripe_account: 'uk' | 'uae';
}

interface ReadinessTrack {
  status: 'ready' | 'warning' | 'blocked';
  reasons: string[];
  details?: Record<string, unknown>;
}

interface Readiness {
  checkedAt: string;
  subscription: ReadinessTrack;
  ownStripe: ReadinessTrack;
}

interface UkHoldRental {
  rental_id?: string;
  id?: string;
  deposit_hold_amount?: number | null;
  deposit_hold_status?: string | null;
  deposit_hold_expires_at?: string | null;
}

interface DepositHoldRow {
  id: string;
  rental_number?: string | null;
  status?: string | null;
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

// A card authorization only truly ends two ways: the money is taken
// (`captured`) or given back (`released`). Everything else is either live
// money on someone's card or a broken hold that needs a human — and every one
// of those was invisible here before, because this tab filtered to
// `held`/`processing` on `platform_account = 'uk'` only. `expired` stays in the
// list on purpose: it is the fingerprint of a refresh that died, and it is
// exactly the row a super admin needs to see.
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

// Statuses that mean the renter's card is still (or is meant to still be)
// reserved. Used only for colour/grouping — never to hide a row.
const LIVE_HOLD_STATUSES = new Set(['held', 'processing', 'refreshing', 'capturing']);

// `place-deposit-hold` resets deposit_hold_status back to NULL on every failure
// path (so the claim can be re-taken) while still writing
// deposit_hold_last_error / _last_error_code. That means a hold that NEVER got
// placed is a NULL status with a non-null error — it matches no status filter
// and used to render as nothing at all, even though it is an unprotected
// rental. We fetch those separately and label them with this synthetic status.
const NOT_PLACED = 'not_placed';

// Rental lifecycles where a dead hold is history rather than a to-do. Note we
// key dormancy on the HOLD too: a `held` row on a Completed rental is still
// live money and stays in the actionable list.
const ENDED_RENTAL_STATUSES = new Set(['Completed', 'Cancelled', 'Canceled', 'Ended', 'Closed']);

// PostgREST silently caps at 1000 rows. Ask for fewer than that explicitly and
// pair it with an exact count so a truncated table says so instead of looking
// complete.
const HOLD_ROW_LIMIT = 200;

const HOLD_COLUMNS =
  'id, rental_number, status, platform_account, deposit_hold_amount, deposit_hold_currency, deposit_hold_status, deposit_hold_expires_at, deposit_hold_status_changed_at, deposit_hold_attempt_seq, deposit_hold_failure_count, deposit_hold_last_error, deposit_hold_last_error_code, deposit_hold_extended_auth, deposit_hold_verified_at, deposit_hold_connect_account_id, deposit_hold_stripe_mode, deposit_hold_card_brand, deposit_hold_card_last4';

const HOLD_STATUS_STYLES: Record<string, { cls: string; label: string }> = {
  held: { cls: 'text-amber-700 border-amber-300 bg-amber-50', label: 'Held' },
  processing: { cls: 'text-blue-700 border-blue-300 bg-blue-50', label: 'Processing' },
  refreshing: { cls: 'text-indigo-700 border-indigo-300 bg-indigo-50', label: 'Refreshing' },
  capturing: { cls: 'text-purple-700 border-purple-300 bg-purple-50', label: 'Capturing' },
  requires_action: { cls: 'text-orange-700 border-orange-300 bg-orange-50', label: 'Needs customer action' },
  [NOT_PLACED]: { cls: 'text-red-700 border-red-300 bg-red-50', label: 'Not placed' },
  failed: { cls: 'text-red-700 border-red-300 bg-red-50', label: 'Failed' },
  needs_review: { cls: 'text-red-700 border-red-300 bg-red-50', label: 'Needs review' },
  disputed: { cls: 'text-red-700 border-red-300 bg-red-50', label: 'Disputed' },
  expired: { cls: 'text-red-700 border-red-300 bg-red-50', label: 'Expired' },
};

function fmtMoney(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(cents / 100);
}

// deposit_hold_amount is stored in MAJOR units (dollars), unlike subscription
// plan amounts which are in cents. Do not route it through fmtMoney.
function fmtHoldAmount(amount?: number | null, currency?: string | null) {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
    }).format(Number(amount));
  } catch {
    return `${Number(amount).toFixed(2)} ${(currency || 'usd').toUpperCase()}`;
  }
}

// Expiry is the whole ballgame for a card authorization — an hour past it and
// the issuer has already released the funds. Render the distance, not just the
// timestamp, and colour it.
function expiryVerdict(iso?: string | null): { text: string; cls: string } {
  if (!iso) {
    // A hold row with no expiry is invisible to the refresh cron's `.lt()`
    // filter (NULL comparisons yield NULL, not true) — it can never be picked up.
    return { text: 'No expiry recorded', cls: 'text-red-600 font-medium' };
  }
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return { text: iso, cls: 'text-muted-foreground' };
  const hours = ms / 3_600_000;
  if (hours <= 0) {
    const overdue = Math.abs(hours);
    return {
      text: overdue < 48 ? `Expired ${Math.round(overdue)}h ago` : `Expired ${Math.round(overdue / 24)}d ago`,
      cls: 'text-red-600 font-medium',
    };
  }
  const text = hours < 48 ? `in ${Math.round(hours)}h` : `in ${Math.round(hours / 24)}d`;
  return { text, cls: hours < 48 ? 'text-amber-600 font-medium' : 'text-muted-foreground' };
}

function HoldTable({ rows }: { rows: DepositHoldRow[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
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
          {rows.map((r) => {
            const status = r.deposit_hold_status || '';
            const style = HOLD_STATUS_STYLES[status] || {
              cls: 'text-muted-foreground border-muted-foreground/30',
              label: status || 'unknown',
            };
            // A hold that was never placed has no expiry to judge — saying
            // "No expiry recorded" there would read as a data fault rather
            // than as "there is no authorization".
            const expiry =
              status === NOT_PLACED
                ? { text: 'Never placed', cls: 'text-red-600 font-medium' }
                : expiryVerdict(r.deposit_hold_expires_at);
            const isLegacy = r.platform_account === 'uk';
            return (
              <TableRow key={r.id} className={isLegacy ? 'bg-amber-50/50' : undefined}>
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {r.rental_number || `${r.id.slice(0, 8)}…`}
                  {r.status && (
                    <span className="block text-muted-foreground normal-case">{r.status}</span>
                  )}
                  {(r.deposit_hold_card_brand || r.deposit_hold_card_last4) && (
                    <span className="block text-muted-foreground normal-case">
                      {r.deposit_hold_card_brand || 'card'} ••{r.deposit_hold_card_last4 || '????'}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={isLegacy ? 'secondary' : 'outline'}
                    className="uppercase"
                    title={
                      r.deposit_hold_connect_account_id
                        ? `Placed on ${r.deposit_hold_connect_account_id}`
                        : 'No Connect account recorded on this hold'
                    }
                  >
                    {r.platform_account || '—'}
                  </Badge>
                  {r.deposit_hold_stripe_mode && r.deposit_hold_stripe_mode !== 'live' && (
                    <Badge variant="outline" className="ml-1 uppercase">
                      {r.deposit_hold_stripe_mode}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {fmtHoldAmount(r.deposit_hold_amount, r.deposit_hold_currency)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1 items-start">
                    <Badge variant="outline" className={style.cls}>
                      {style.label}
                    </Badge>
                    {r.deposit_hold_extended_auth === true && (
                      <Badge
                        variant="outline"
                        className="text-emerald-700 border-emerald-300 bg-emerald-50 text-[10px]"
                      >
                        Extended auth
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  <span className={expiry.cls}>{expiry.text}</span>
                  {status !== NOT_PLACED && r.deposit_hold_expires_at && (
                    <span className="block text-xs text-muted-foreground">
                      {fmtDate(r.deposit_hold_expires_at)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  #{r.deposit_hold_attempt_seq ?? 0}
                  {(r.deposit_hold_failure_count ?? 0) > 0 && (
                    <span className="text-red-600 font-medium">
                      {' '}
                      · {r.deposit_hold_failure_count} failed
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs max-w-[220px]">
                  {r.deposit_hold_last_error_code ? (
                    <>
                      <code className="text-red-600">{r.deposit_hold_last_error_code}</code>
                      {r.deposit_hold_last_error && (
                        <span
                          className="block text-muted-foreground truncate"
                          title={r.deposit_hold_last_error}
                        >
                          {r.deposit_hold_last_error}
                        </span>
                      )}
                    </>
                  ) : r.deposit_hold_last_error ? (
                    <span
                      className="text-muted-foreground block truncate"
                      title={r.deposit_hold_last_error}
                    >
                      {r.deposit_hold_last_error}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {r.deposit_hold_verified_at ? (
                    fmtDate(r.deposit_hold_verified_at)
                  ) : (
                    <span className="text-amber-600">Never</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text);
  toast.success(`${label} copied to clipboard`);
}

function TrackVerdict({ track }: { track: ReadinessTrack }) {
  const cfg =
    track.status === 'ready'
      ? { icon: CheckCircle2, cls: 'text-green-600', label: 'Ready' }
      : track.status === 'warning'
        ? { icon: AlertTriangle, cls: 'text-amber-600', label: 'Ready with warnings' }
        : { icon: XCircle, cls: 'text-red-600', label: 'Not ready' };
  const Icon = cfg.icon;
  return (
    <div>
      <div className={`flex items-center gap-2 font-medium ${cfg.cls}`}>
        <Icon className="h-4 w-4" />
        {cfg.label}
      </div>
      {track.reasons?.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground list-disc pl-5">
          {track.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TenantPaymentsTab({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<PaymentsTenant | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [checking, setChecking] = useState(false);

  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [captureLink, setCaptureLink] = useState<{ url: string; startsBillingAt?: string } | null>(null);
  const [generatingCapture, setGeneratingCapture] = useState(false);

  const [oauthLinks, setOauthLinks] = useState<{ test?: string; live?: string }>({});
  const [generatingOauth, setGeneratingOauth] = useState<'test' | 'live' | null>(null);

  const [ukHolds, setUkHolds] = useState<UkHoldRental[]>([]);
  // The flip gate's read can fail. When it does we know NOTHING about legacy
  // holds, which must block the flip — never silently permit it.
  const [ukHoldsError, setUkHoldsError] = useState<string | null>(null);
  const [holds, setHolds] = useState<DepositHoldRow[]>([]);
  const [holdsError, setHoldsError] = useState<string | null>(null);
  const [holdsTotal, setHoldsTotal] = useState(0);

  const [flipDialogOpen, setFlipDialogOpen] = useState(false);
  const [flipping, setFlipping] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [tenantRes, plansRes, holdsRes, allHoldsRes, notPlacedRes] = await Promise.all([
      supabase
        .from('tenants')
        .select(
          'id, slug, company_name, stripe_mode, payment_model, subscription_account, own_stripe_account_id, own_stripe_test_account_id, own_stripe_connected_at, own_stripe_test_connected_at, stripe_account_id, stripe_account_status, stripe_onboarding_complete'
        )
        .eq('id', tenantId)
        .single(),
      supabase
        .from('subscription_plans')
        .select('id, name, amount, currency, interval, is_active, stripe_account')
        .eq('tenant_id', tenantId)
        .order('amount'),
      // FLIP GATE ONLY — deliberately narrow and deliberately unchanged.
      // It answers one question: "is money still reserved on the LEGACY UK
      // account?" It selects only columns that predate the 90-day-hold schema,
      // so it cannot 400 and silently return zero rows, which would fail the
      // flip guard OPEN. Do not merge it into the health query below.
      supabase
        .from('rentals')
        .select('id, deposit_hold_amount, deposit_hold_status, deposit_hold_expires_at')
        .eq('tenant_id', tenantId)
        .eq('platform_account', 'uk')
        .in('deposit_hold_status', ['held', 'processing']),
      // HOLD HEALTH — every non-terminal hold on BOTH platform accounts.
      supabase
        .from('rentals')
        .select(HOLD_COLUMNS, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .in('deposit_hold_status', NON_TERMINAL_HOLD_STATUSES)
        .order('deposit_hold_status_changed_at', { ascending: false, nullsFirst: false })
        .limit(HOLD_ROW_LIMIT),
      // NEVER PLACED — status is NULL because place-deposit-hold rolled it back,
      // but an error was recorded. These rentals are unprotected and match no
      // status filter, so they need their own read. Kept separate rather than
      // folded into the query above with an `.or(...)` so that a syntax or
      // grant problem on one cannot blank out the other.
      supabase
        .from('rentals')
        .select(HOLD_COLUMNS, { count: 'exact' })
        .eq('tenant_id', tenantId)
        .is('deposit_hold_status', null)
        .not('deposit_hold_last_error', 'is', null)
        .order('created_at', { ascending: false })
        .limit(HOLD_ROW_LIMIT),
    ]);
    setTenant((tenantRes.data as PaymentsTenant) || null);
    setPlans(((plansRes.data as PlanOption[]) || []).filter((p) => p.is_active));
    setUkHolds((holdsRes.data as UkHoldRental[]) || []);
    setUkHoldsError(holdsRes.error ? holdsRes.error.message : null);

    // A NULL status is not a status — label it so the table can say what it is.
    const notPlaced = ((notPlacedRes.data as DepositHoldRow[]) || []).map((r) => ({
      ...r,
      deposit_hold_status: NOT_PLACED,
    }));
    setHolds([...((allHoldsRes.data as DepositHoldRow[]) || []), ...notPlaced]);
    setHoldsTotal((allHoldsRes.count ?? 0) + (notPlacedRes.count ?? 0));
    // Surface the failure instead of rendering an empty, reassuring table.
    setHoldsError(
      [allHoldsRes.error?.message, notPlacedRes.error?.message].filter(Boolean).join(' / ') || null
    );
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const runReadinessCheck = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-migration-readiness', {
        body: { tenantId },
      });
      if (error) throw error;
      setReadiness(data as Readiness);
      toast.success('Readiness check complete');
    } catch (e) {
      toast.error(`Readiness check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChecking(false);
    }
  };

  const generateCaptureLink = async () => {
    if (!selectedPlanId) {
      toast.error('Pick a plan first');
      return;
    }
    setGeneratingCapture(true);
    setCaptureLink(null);
    try {
      const { data, error } = await supabase.functions.invoke('create-uae-subscription-capture', {
        body: { tenantId, planId: selectedPlanId },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'No URL returned');
      setCaptureLink({ url: data.url, startsBillingAt: data.startsBillingAt });
      toast.success('UAE card-capture link generated');
    } catch (e) {
      toast.error(`Could not generate link: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGeneratingCapture(false);
    }
  };

  const generateOauthLink = async (mode: 'test' | 'live') => {
    setGeneratingOauth(mode);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-oauth-start', {
        body: { tenantId, mode, returnTo: 'admin', origin: window.location.origin },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'No URL returned');
      setOauthLinks((prev) => ({ ...prev, [mode]: data.url }));
      toast.success(`OAuth link (${mode}) generated`);
    } catch (e) {
      toast.error(`Could not generate OAuth link: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGeneratingOauth(null);
    }
  };

  const flipPaymentModel = async () => {
    if (!tenant) return;
    setFlipping(true);
    const next = tenant.payment_model === 'own' ? 'managed' : 'own';
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ payment_model: next })
        .eq('id', tenantId);
      if (error) throw error;

      // Saved Stripe customer ids are platform-scoped (created on the UK
      // platform, they don't exist on the operator's own account). Clear them
      // on flip so charge functions transparently recreate customers on the
      // new platform. Readiness blocks flips with active saved-card flows
      // (installment plans / auto-extend), so this is safe.
      if (next === 'own') {
        const { error: custErr } = await supabase
          .from('customers')
          .update({ stripe_customer_id: null })
          .eq('tenant_id', tenantId)
          .not('stripe_customer_id', 'is', null);
        if (custErr) {
          toast.error(`Flipped, but failed to reset saved customer ids: ${custErr.message} — reset them manually before new charges.`);
        }
      }

      toast.success(`Payment model switched to ${next === 'own' ? 'Own Stripe' : 'Managed Stripe'}`);
      setFlipDialogOpen(false);
      await fetchData();
    } catch (e) {
      toast.error(`Flip failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFlipping(false);
    }
  };

  if (loading || !tenant) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const oauthConnected = tenant.stripe_mode === 'live'
    ? !!tenant.own_stripe_account_id
    : !!tenant.own_stripe_test_account_id;
  // FAIL CLOSED: if we could not read the legacy-hold book we do not know
  // whether money is still reserved on the old account, and "unknown" must
  // block the flip exactly as "yes" does. An empty array from a failed read is
  // not evidence of zero holds.
  const flipBlocked =
    tenant.payment_model === 'managed' &&
    (!oauthConnected || ukHolds.length > 0 || !!ukHoldsError);
  const flipBlockReason = !oauthConnected
    ? `OAuth not connected for ${tenant.stripe_mode} mode yet.`
    : ukHoldsError
      ? `Could not check the legacy account for live deposit holds (${ukHoldsError}). Treat this as UNKNOWN, not as zero.`
      : ukHolds.length > 0
        ? `${ukHolds.length} active deposit hold(s) on the old account.`
        : null;

  // Dormant history: a dead hold on a rental that is already over. Nobody can
  // act on it and it accumulates forever, so it is split out rather than left
  // to bury the rows that do need attention. A LIVE hold on an ended rental is
  // deliberately NOT dormant — that is still real money on someone's card.
  const isDormant = (h: DepositHoldRow) =>
    (h.deposit_hold_status === 'expired' || h.deposit_hold_status === NOT_PLACED) &&
    ENDED_RENTAL_STATUSES.has(h.status || '');
  const dormantHolds = holds.filter(isDormant);
  const attentionHolds = holds.filter((h) => !isDormant(h));

  const liveHolds = attentionHolds.filter((h) =>
    LIVE_HOLD_STATUSES.has(h.deposit_hold_status || '')
  );
  // Anything a human has to look at: the hold is broken, stalled, or its
  // deadline has already gone by while we still claim it is alive.
  const brokenHolds = attentionHolds.filter(
    (h) =>
      !LIVE_HOLD_STATUSES.has(h.deposit_hold_status || '') ||
      !h.deposit_hold_expires_at ||
      new Date(h.deposit_hold_expires_at).getTime() <= Date.now()
  );
  const holdsTruncated = holdsTotal > holds.length;

  return (
    <div className="space-y-6">
      {/* ── Status overview ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Payment Migration Status
          </CardTitle>
          <CardDescription>
            Where this tenant&apos;s money flows live today. Flip nothing until the readiness check is green.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Booking payments</p>
              <Badge variant={tenant.payment_model === 'own' ? 'default' : 'secondary'}>
                {tenant.payment_model === 'own' ? 'Own Stripe (UAE)' : 'Managed Stripe (UK)'}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Subscription billing</p>
              <Badge variant={tenant.subscription_account === 'uae' ? 'default' : 'secondary'}>
                {tenant.subscription_account === 'uae' ? 'UAE account' : 'UK account (legacy)'}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Own Stripe OAuth (live)</p>
              {tenant.own_stripe_account_id ? (
                <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {tenant.own_stripe_account_id.slice(0, 14)}…
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Not connected</span>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Own Stripe OAuth (test)</p>
              {tenant.own_stripe_test_account_id ? (
                <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {tenant.own_stripe_test_account_id.slice(0, 14)}…
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Not connected</span>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Stripe mode</p>
              <Badge variant="outline">{tenant.stripe_mode}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Legacy Express account</p>
              <span className="text-sm">
                {tenant.stripe_account_id
                  ? `${tenant.stripe_account_id.slice(0, 14)}… (${tenant.stripe_account_status || 'unknown'})`
                  : 'None'}
              </span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Own connected (live)</p>
              <span className="text-sm">{fmtDate(tenant.own_stripe_connected_at)}</span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Own connected (test)</p>
              <span className="text-sm">{fmtDate(tenant.own_stripe_test_connected_at)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Readiness check ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Migration Readiness
            </CardTitle>
            <CardDescription>
              Live check against both Stripe accounts and the database.
              {readiness && ` Last checked ${fmtDate(readiness.checkedAt)}.`}
            </CardDescription>
          </div>
          <Button onClick={runReadinessCheck} disabled={checking}>
            <RefreshCw className={`h-4 w-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : 'Check Migration Readiness'}
          </Button>
        </CardHeader>
        {readiness && (
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-lg border p-4">
                <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <CreditCard className="h-4 w-4" /> Subscription → UAE
                </p>
                {(() => {
                  const d = readiness.subscription.details as
                    | { renewalDate?: string | null; daysUntilRenewal?: number | null; renewalTooClose?: boolean }
                    | undefined;
                  if (!d?.renewalDate) return null;
                  const days = d.daysUntilRenewal;
                  return (
                    <div
                      className={`mb-3 rounded-md border px-3 py-2 text-sm ${
                        d.renewalTooClose
                          ? 'border-amber-300 bg-amber-50 text-amber-900'
                          : 'border-border bg-muted/40'
                      }`}
                    >
                      <span className="font-medium">Renews {d.renewalDate}</span>
                      {typeof days === 'number' && (
                        <span className="text-muted-foreground">
                          {' '}· {days} day{days === 1 ? '' : 's'} away
                          {!d.renewalTooClose && ` → new subscription shows "${days} days free"`}
                        </span>
                      )}
                      {d.renewalTooClose && (
                        <span className="block mt-1 font-medium">
                          ⚠️ Too close to renewal — wait until after this date to send the capture link.
                        </span>
                      )}
                    </div>
                  );
                })()}
                <TrackVerdict track={readiness.subscription} />
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Link2 className="h-4 w-4" /> Connect → Own Stripe
                </p>
                <TrackVerdict track={readiness.ownStripe} />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Subscription migration ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Step 1 — Capture card on UAE account
          </CardTitle>
          <CardDescription>
            Generates a checkout link for the operator. Their new UAE subscription starts billing
            exactly when the current UK period ends — no double billing. Send the link, they enter
            their card once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tenant.subscription_account === 'uae' ? (
            <p className="text-sm text-green-600 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Subscription already billing on the UAE account.
            </p>
          ) : (
            <>
              <div className="flex items-end gap-3">
                <div className="w-72">
                  <p className="text-xs text-muted-foreground mb-1">Plan</p>
                  <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select the plan to bill on UAE" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} — {fmtMoney(p.amount, p.currency)}/{p.interval}
                          {p.stripe_account === 'uae' ? ' (UAE price ready)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={generateCaptureLink} disabled={generatingCapture || !selectedPlanId}>
                  {generatingCapture ? 'Generating…' : 'Generate UAE card link'}
                </Button>
              </div>
              {plans.length === 0 && (
                <p className="text-sm text-amber-600 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> No active plans for this tenant — create one in
                  the Subscription tab first.
                </p>
              )}
              {captureLink && (
                <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="text-xs break-all flex-1">{captureLink.url}</code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(captureLink.url, 'Card-capture link')}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                    </Button>
                  </div>
                  {captureLink.startsBillingAt && (
                    <p className="text-xs text-muted-foreground">
                      First UAE charge: {fmtDate(captureLink.startsBillingAt)} (when the UK period ends)
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Own Stripe OAuth ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Step 2 — Connect operator&apos;s own Stripe (OAuth)
          </CardTitle>
          <CardDescription>
            Generates the &quot;Connect with Stripe&quot; authorization link. The operator opens it,
            signs into (or creates) their own Stripe account, and approves. Test link connects
            test mode; live link connects live mode.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(['test', 'live'] as const).map((mode) => {
            const connected = mode === 'live' ? tenant.own_stripe_account_id : tenant.own_stripe_test_account_id;
            return (
              <div key={mode} className="flex items-center gap-3">
                <Badge variant="outline" className="w-14 justify-center uppercase">{mode}</Badge>
                {connected ? (
                  <span className="text-sm text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> Connected: {connected}
                  </span>
                ) : oauthLinks[mode] ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <code className="text-xs truncate flex-1">{oauthLinks[mode]}</code>
                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(oauthLinks[mode]!, `OAuth link (${mode})`)}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => window.open(oauthLinks[mode], '_blank')}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={generatingOauth === mode}
                    onClick={() => generateOauthLink(mode)}
                  >
                    {generatingOauth === mode ? 'Generating…' : `Generate OAuth link (${mode})`}
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Deposit hold health (both platform accounts) ─────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              {/* A failed read is never a green tick — we do not know. */}
              {brokenHolds.length > 0 || holdsError || ukHoldsError ? (
                <ShieldX className="h-5 w-5 text-red-600" />
              ) : liveHolds.length > 0 ? (
                <ShieldAlert className="h-5 w-5 text-amber-600" />
              ) : (
                <ShieldCheck className="h-5 w-5 text-green-600" />
              )}
              Deposit holds
            </CardTitle>
            <CardDescription>
              Every hold on this tenant that has not been captured or released, on{' '}
              <strong>both</strong> platform accounts, plus rentals where the hold was never placed
              at all (&ldquo;Not placed&rdquo; — an error was recorded and the status rolled back to
              empty, so the rental is carrying no deposit protection). An authorization is only a
              claim — if its expiry has passed, the issuer has already released the renter&apos;s
              money whatever this row says.
              {ukHoldsError && (
                <span className="block mt-1 text-red-700">
                  The legacy-UK hold check failed ({ukHoldsError}) — the flip is blocked until it
                  succeeds, because &ldquo;unknown&rdquo; is not &ldquo;none&rdquo;.
                </span>
              )}
              {ukHolds.length > 0 && (
                <span className="block mt-1 text-amber-700">
                  {ukHolds.length} of these hold money on the <strong>legacy UK</strong> account.
                  Let them finish (or release/capture) before flipping — never flip a tenant
                  mid-hold blindly.
                </span>
              )}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* An error on either read is shown ALONGSIDE whatever rows did come
              back — never instead of them, and never as an empty table. */}
          {holdsError && (
            <p className="text-sm text-red-600 flex items-start gap-2">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              Could not read part of the hold book: {holdsError}. Treat what is missing as
              &ldquo;unknown&rdquo;, not as &ldquo;no holds&rdquo;.
            </p>
          )}
          {holdsTruncated && (
            <p className="text-sm text-amber-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              Showing {holds.length} of {holdsTotal} holds — the list is capped at{' '}
              {HOLD_ROW_LIMIT} rows per query. Older rows are not displayed.
            </p>
          )}
          {attentionHolds.length === 0 ? (
            !holdsError && (
              <p className="text-sm text-green-600 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> No open deposit holds needing attention on
                either account.
              </p>
            )
          ) : (
            <HoldTable rows={attentionHolds} />
          )}
          {dormantHolds.length > 0 && (
            <details className="rounded-md border bg-muted/30 px-3 py-2">
              <summary className="text-sm cursor-pointer text-muted-foreground">
                {dormantHolds.length} dead hold(s) on rentals that have already ended — history,
                nothing to act on
              </summary>
              <div className="mt-3">
                <HoldTable rows={dormantHolds} />
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* ── The flip ────────────────────────────────────────────────── */}
      <Card className={tenant.payment_model === 'own' ? 'border-green-300' : 'border-amber-300'}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" /> Step 3 — Flip payment model
          </CardTitle>
          <CardDescription>
            {tenant.payment_model === 'own'
              ? 'This tenant runs on Own Stripe. New bookings, deposits and refunds go to their own account.'
              : 'Flipping moves ALL NEW booking payments, deposit holds and refunds to the operator’s own Stripe account. In-flight rentals keep finishing on the old account automatically.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Button
            variant={tenant.payment_model === 'own' ? 'outline' : 'default'}
            onClick={() => setFlipDialogOpen(true)}
          >
            {tenant.payment_model === 'own' ? 'Revert to Managed Stripe' : 'Flip to Own Stripe'}
          </Button>
          {flipBlocked && (
            <p className="text-sm text-amber-600 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              {flipBlockReason}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={flipDialogOpen} onOpenChange={setFlipDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tenant.payment_model === 'own' ? 'Revert to Managed Stripe?' : 'Flip to Own Stripe?'}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-2">
                {tenant.payment_model === 'managed' ? (
                  <>
                    <p>
                      From this moment, every NEW checkout, deposit hold and refund for{' '}
                      <strong>{tenant.company_name}</strong> runs on the operator&apos;s own Stripe
                      account ({tenant.stripe_mode === 'live' ? tenant.own_stripe_account_id || 'NOT CONNECTED' : tenant.own_stripe_test_account_id || 'NOT CONNECTED'}).
                    </p>
                    {flipBlocked && (
                      <p className="text-amber-600 font-medium flex items-start gap-2">
                        <ShieldX className="h-4 w-4 mt-0.5 shrink-0" />
                        Warning:{' '}
                        {!oauthConnected
                          ? 'OAuth is not connected for the current mode. New payments will fail until it is.'
                          : ukHoldsError
                            ? `The legacy deposit-hold check could not be completed (${ukHoldsError}), so we cannot tell whether money is still reserved on the old account. Refresh and let it succeed before flipping.`
                            : 'Active deposit holds exist on the old account. They will still finish there, but double-check the readiness report first.'}
                      </p>
                    )}
                  </>
                ) : (
                  <p>New payments will go back through the legacy managed Express account.</p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlipDialogOpen(false)}>Cancel</Button>
            <Button onClick={flipPaymentModel} disabled={flipping} variant={flipBlocked ? 'destructive' : 'default'}>
              {flipping ? 'Flipping…' : flipBlocked ? 'Flip anyway' : 'Confirm flip'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* What the operator is prompted with (off by default) */}
      <OperatorPromptCard tenantId={tenantId} />

      <Separator />
      <p className="text-xs text-muted-foreground">
        Runbook: ① green readiness → ② card captured on UAE → ③ OAuth connected → ④ flip → watch the
        first booking/deposit land on their account → cancel the old UK subscription if not
        auto-cancelled. In-flight UK rentals settle on the old account automatically.
      </p>
    </div>
  );
}
