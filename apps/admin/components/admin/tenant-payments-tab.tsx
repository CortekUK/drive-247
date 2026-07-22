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

function fmtMoney(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(cents / 100);
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

  const [flipDialogOpen, setFlipDialogOpen] = useState(false);
  const [flipping, setFlipping] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [tenantRes, plansRes, holdsRes] = await Promise.all([
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
      supabase
        .from('rentals')
        .select('id, deposit_hold_amount, deposit_hold_status, deposit_hold_expires_at')
        .eq('tenant_id', tenantId)
        .eq('platform_account', 'uk')
        .in('deposit_hold_status', ['held', 'processing']),
    ]);
    setTenant((tenantRes.data as PaymentsTenant) || null);
    setPlans(((plansRes.data as PlanOption[]) || []).filter((p) => p.is_active));
    setUkHolds((holdsRes.data as UkHoldRental[]) || []);
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
  const flipBlocked =
    tenant.payment_model === 'managed' && (!oauthConnected || ukHolds.length > 0);

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

      {/* ── Active UK deposit holds ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {ukHolds.length > 0 ? (
              <ShieldAlert className="h-5 w-5 text-amber-600" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-green-600" />
            )}
            Active deposit holds on the OLD account
          </CardTitle>
          <CardDescription>
            {ukHolds.length > 0
              ? 'These rentals hold money on the legacy account. Let them finish (or release/capture) before flipping — never flip a tenant mid-hold blindly.'
              : 'No live deposit holds on the legacy account. Safe from the holds side.'}
          </CardDescription>
        </CardHeader>
        {ukHolds.length > 0 && (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rental</TableHead>
                  <TableHead>Hold amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ukHolds.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.id?.slice(0, 8)}…</TableCell>
                    <TableCell>{r.deposit_hold_amount != null ? `$${r.deposit_hold_amount}` : '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.deposit_hold_status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{fmtDate(r.deposit_hold_expires_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
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
            <p className="text-sm text-amber-600 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {!oauthConnected
                ? `OAuth not connected for ${tenant.stripe_mode} mode yet.`
                : `${ukHolds.length} active deposit hold(s) on the old account.`}
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
                        Warning: {!oauthConnected ? 'OAuth is not connected for the current mode. New payments will fail until it is.' : 'Active deposit holds exist on the old account. They will still finish there, but double-check the readiness report first.'}
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
