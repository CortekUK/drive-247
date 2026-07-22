'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Megaphone,
  CheckCircle2,
  Mail,
  Eye,
  Gift,
  BellOff,
  Bell,
  Lock,
  Send,
} from 'lucide-react';

type BlockerState = 'off' | 'soft' | 'hard';

interface PromptTenant {
  id: string;
  company_name: string | null;
  stripe_mode: 'test' | 'live';
  subscription_account: 'uk' | 'uae';
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
  migration_blocker: BlockerState;
  migration_blocker_dismissed_at: string | null;
  migration_blocker_dismiss_count: number | null;
  migration_reward_granted_at: string | null;
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function relTime(d?: string | null) {
  if (!d) return null;
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

const OPTIONS: { value: BlockerState; label: string; hint: string; icon: typeof BellOff }[] = [
  { value: 'off', label: 'Off', hint: 'Nothing shown', icon: BellOff },
  { value: 'soft', label: 'Soft · 24h', hint: 'Dismissible, returns in 24h', icon: Bell },
  { value: 'hard', label: 'Hard', hint: 'Full block until done', icon: Lock },
];

export function OperatorPromptCard({ tenantId }: { tenantId: string }) {
  const [tenant, setTenant] = useState<PromptTenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<BlockerState>('off');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const fetchTenant = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('tenants')
      .select(
        'id, company_name, stripe_mode, subscription_account, own_stripe_account_id, own_stripe_test_account_id, migration_blocker, migration_blocker_dismissed_at, migration_blocker_dismiss_count, migration_reward_granted_at'
      )
      .eq('id', tenantId)
      .single();
    if (data) {
      setTenant(data as PromptTenant);
      setSelected((data as PromptTenant).migration_blocker ?? 'off');
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { fetchTenant(); }, [fetchTenant]);

  const save = async () => {
    setSaving(true);
    try {
      // Saving only changes the mode — the operator's 24h dismissal cycle is
      // deliberately left untouched. Use "Show now" to override it manually.
      const { error } = await supabase
        .from('tenants')
        .update({ migration_blocker: selected })
        .eq('id', tenantId);
      if (error) throw error;
      toast.success(
        selected === 'off'
          ? 'Prompt turned off — operator sees nothing'
          : `Prompt set to ${selected === 'soft' ? 'Soft (24h)' : 'Hard (full block)'}`
      );
      await fetchTenant();
    } catch (e) {
      toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const resetDismissal = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ migration_blocker_dismissed_at: null })
        .eq('id', tenantId);
      if (error) throw error;
      toast.success('Dismissal cleared — the prompt shows again on their next page load');
      await fetchTenant();
    } catch (e) {
      toast.error(`Could not reset: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const openEmail = async () => {
    setEmailOpen(true);
    setEmailLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-migration-email', {
        body: { action: 'preview', tenantId },
      });
      if (error) throw error;
      setEmailTo(data?.to ?? '');
      setEmailSubject(data?.subject ?? '');
      setEmailBody(data?.body ?? '');
    } catch (e) {
      toast.error(`Could not load template: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEmailLoading(false);
    }
  };

  const sendEmail = async () => {
    if (!emailTo.trim()) { toast.error('Add a recipient email'); return; }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-migration-email', {
        body: { action: 'send', tenantId, to: emailTo, subject: emailSubject, body: emailBody },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Email sent to ${data?.to ?? emailTo}`);
      setEmailOpen(false);
    } catch (e) {
      toast.error(`Send failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  if (loading || !tenant) {
    return <Card><CardContent className="py-8"><Skeleton className="h-28 w-full" /></CardContent></Card>;
  }

  // Matches the prompt + reward rule: the operator's task is connecting their
  // LIVE account. (A test connection is rehearsal only and is shown separately
  // in the Payments status card above.)
  const stripeConnected = !!tenant.own_stripe_account_id;
  const paymentConfirmed = tenant.subscription_account === 'uae';
  const bothDone = stripeConnected && paymentConfirmed;
  // How long a soft prompt stays hidden after the operator dismissed it (24h).
  const suppressedHoursLeft =
    tenant.migration_blocker === 'soft' && tenant.migration_blocker_dismissed_at && !bothDone
      ? Math.max(
          0,
          Math.ceil(
            (new Date(tenant.migration_blocker_dismissed_at).getTime() +
              24 * 3600 * 1000 -
              Date.now()) / 3600000
          )
        )
      : 0;
  const dirty = selected !== tenant.migration_blocker;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" /> Operator Prompt
          </CardTitle>
          <CardDescription>
            Controls what this operator sees about completing their payment setup.
            Off by default — nothing is shown until you enable it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Blocker selector */}
          <div className="grid gap-2 sm:grid-cols-3">
            {OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = selected === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelected(opt.value)}
                  className={`rounded-lg border p-3 text-left transition ${
                    active
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Icon className="h-4 w-4" /> {opt.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{opt.hint}</span>
                </button>
              );
            })}
          </div>

          {bothDone && (
            <p className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Operator has completed both steps — the prompt auto-hides regardless of this setting.
            </p>
          )}

          {/* Progress */}
          <div className="rounded-lg border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Operator progress</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>Stripe connected</span>
                {stripeConnected ? (
                  <span className="flex items-center gap-1.5 text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <code className="text-xs">
                      {tenant.own_stripe_account_id?.slice(0, 16)}…
                    </code>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not yet</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Payment details confirmed</span>
                {paymentConfirmed
                  ? <span className="flex items-center gap-1.5 text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /> Done</span>
                  : <span className="text-muted-foreground">Not yet</span>}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5"><Gift className="h-3.5 w-3.5" /> 100 credits granted</span>
                {tenant.migration_reward_granted_at
                  ? <span className="text-green-600">{fmtDate(tenant.migration_reward_granted_at)}</span>
                  : <span className="text-muted-foreground">Pending</span>}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Soft prompt dismissed</span>
                <span className="text-muted-foreground">
                  {(tenant.migration_blocker_dismiss_count ?? 0)} time
                  {(tenant.migration_blocker_dismiss_count ?? 0) === 1 ? '' : 's'}
                  {tenant.migration_blocker_dismissed_at
                    ? ` · last ${relTime(tenant.migration_blocker_dismissed_at)}`
                    : ''}
                  {suppressedHoursLeft > 0 && (
                    <span className="text-amber-600">
                      {' '}· hidden for {suppressedHoursLeft}h more
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                <Eye className="mr-2 h-4 w-4" /> Preview dialog
              </Button>
              <Button variant="outline" size="sm" onClick={openEmail}>
                <Mail className="mr-2 h-4 w-4" /> Compose email
              </Button>
              {tenant.migration_blocker === 'soft' && !bothDone && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetDismissal}
                  disabled={saving}
                  title={
                    suppressedHoursLeft > 0
                      ? `Currently hidden for ${suppressedHoursLeft}h — show it on their next page load`
                      : 'Prompt is already showing on their next page load'
                  }
                >
                  <Bell className="mr-2 h-4 w-4" />
                  Show now
                  {suppressedHoursLeft > 0 ? ` (hidden ${suppressedHoursLeft}h)` : ''}
                </Button>
              )}
            </div>
            <Button onClick={save} disabled={saving || !dirty}>
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview of what the operator sees */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selected === 'hard' ? 'Action required' : 'Payment upgrade — action needed'}
            </DialogTitle>
            <DialogDescription>
              Preview of the {selected === 'off' ? '(disabled)' : selected} prompt the operator sees.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p>
              Stripe now requires rental platforms in our region to settle payments through a
              Stripe account that you own and control directly — rather than one managed on
              your behalf.
            </p>
            <ul className="space-y-1.5">
              {[
                'Customer payments land straight in your own account',
                'Full Stripe Dashboard — every payout and fee visible',
                'You control your payout schedule and bank details',
                'Faster access to your money',
              ].map((b) => (
                <li key={b} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              {selected === 'hard'
                ? 'This takes about 3 minutes. Complete both steps to restore full access to your dashboard.'
                : 'Complete both steps below to keep your payments running without interruption.'}
            </p>
            <div className="space-y-2">
              <div className="rounded-lg border p-3">1. Connect your Stripe account</div>
              <div className="rounded-lg border p-3">2. Confirm your payment details</div>
            </div>
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              🎁 Complete both and we&apos;ll add 100 free credits to your account — on us.
            </p>
            {selected === 'hard' && (
              <p className="text-xs text-muted-foreground">
                Non-dismissible: no close button, Esc and outside-click disabled.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual email composer */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send migration email</DialogTitle>
            <DialogDescription>
              Prefilled from the tenant&apos;s branding contact. Edit anything before sending —
              nothing sends automatically.
            </DialogDescription>
          </DialogHeader>
          {emailLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="mig-to">To</Label>
                <Input
                  id="mig-to"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="operator@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mig-subject">Subject</Label>
                <Input
                  id="mig-subject"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mig-body">Message</Label>
                <Textarea
                  id="mig-body"
                  rows={16}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button>
            <Button onClick={sendEmail} disabled={sending || emailLoading}>
              <Send className="mr-2 h-4 w-4" />
              {sending ? 'Sending…' : 'Send email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
