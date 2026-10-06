'use client';

/**
 * Signup rehearsal — run the REAL self-serve signup again and again with one
 * email address.
 *
 * The three settings are read by the signup edge functions for that address
 * only (supabase/functions/_shared/signup-rehearsal.ts), once, when a signup
 * STARTS — so change them before signing up, not halfway through.
 *
 * "Delete me and start again" is the `reset` action of `dev-signup-rehearsal`;
 * the list of what it may touch is at the top of that function.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RotateCcw, UserRound, XCircle } from 'lucide-react';

import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  callDeveloper,
  devUrls,
  readSteps,
  type DeveloperStatus,
  type ResetStep,
  type StripeMode,
} from './developer-api';

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function StepList({ steps }: { steps: ResetStep[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {steps.map((s, i) => (
        <li key={`${s.step}-${i}`} className="flex items-start gap-2">
          {s.ok ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}
          <span>
            <span className="font-medium">{s.step}</span>
            <span className="text-muted-foreground"> — {s.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 max-w-xl">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function RehearsalCard({
  status,
  onChanged,
}: {
  status: DeveloperStatus | null;
  onChanged: () => Promise<void>;
}) {
  const settings = status?.settings ?? null;
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetSteps, setResetSteps] = useState<ResetStep[] | null>(null);
  const [resetOk, setResetOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (settings) setEmail(settings.email);
  }, [settings?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (key: string, patch: Record<string, unknown>, done: string) => {
    setSaving(key);
    const res = await callDeveloper({ action: 'save', ...patch });
    setSaving(null);
    if (!res.ok) {
      toast.error('Could not save', { description: res.error ?? undefined });
      return;
    }
    toast.success(done);
    await onChanged();
  };

  const saveEmail = () => {
    const next = email.trim().toLowerCase();
    if (!settings || next === settings.email) return;
    void save('email', { email: next }, `Rehearsal email is now ${next}`);
  };

  const reset = async () => {
    setResetting(true);
    setResetSteps(null);
    const res = await callDeveloper({ action: 'reset' });
    setResetting(false);
    setConfirmOpen(false);
    setResetSteps(readSteps(res.body));
    setResetOk(res.ok);
    if (res.ok) toast.success('Done — you can sign up again');
    else toast.error('The reset stopped part way', { description: res.error ?? undefined });
    await onChanged();
  };

  const urls = devUrls();
  const account = status?.account;
  const live = settings?.stripeMode === 'live';
  const linked = settings?.linkToNorthwind === true;
  const nwSub = status?.northwind?.subscriptions.find((s) =>
    ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'].includes(s.status),
  );
  const lastSteps = settings?.lastResetResult?.steps ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <UserRound className="size-5" />
          Signup rehearsal
        </CardTitle>
        <CardDescription>
          Sign up through the real landing page as often as you like with one email. Each signup
          reads these settings once, when it starts. Every other signup ignores them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Row label="Test email" hint="The only address these settings apply to.">
            <div className="flex items-center gap-2">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={saveEmail}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEmail();
                }}
                disabled={!settings || saving === 'email'}
                className="w-64"
                type="email"
                aria-label="Test email"
              />
              {saving === 'email' && <Loader2 className="size-4 animate-spin" />}
            </div>
          </Row>

          <Row
            label="Link to Northwind"
            hint={
              linked
                ? 'On: the signup ends in Northwind. Its address and test data stay; the business details you type replace its name, phone and branding.'
                : 'Off: the signup creates a brand-new company, exactly as a customer would.'
            }
          >
            <Switch
              checked={linked}
              disabled={!settings || saving === 'link'}
              onCheckedChange={(next) =>
                void save('link', { linkToNorthwind: next }, next ? 'Signups will land in Northwind' : 'Signups will create a new company')
              }
              aria-label="Link to Northwind"
            />
          </Row>

          <Row
            label="Stripe mode"
            hint={
              live
                ? 'Live: a real card and real money.'
                : 'Test: pay with 4242 4242 4242 4242, any future date, any CVC. No money moves.'
            }
          >
            <div className="inline-flex rounded-lg border p-0.5">
              {(['test', 'live'] as StripeMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={!settings || saving === 'mode'}
                  onClick={() => {
                    if (settings && settings.stripeMode !== mode) {
                      void save('mode', { stripeMode: mode }, `Rehearsal payments are now in ${mode} mode`);
                    }
                  }}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                    settings?.stripeMode === mode
                      ? mode === 'live'
                        ? 'bg-destructive text-destructive-foreground'
                        : 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </Row>

          {live && linked && (
            <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Live and linked: the next signup charges a real card and attaches a real subscription to
              Northwind.
            </p>
          )}
        </div>

        <div className="rounded-xl border p-4">
          <p className="text-sm font-medium">Right now</p>
          {!status ? (
            <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[140px_1fr]">
              <dt className="text-muted-foreground">Login</dt>
              <dd>
                {account && account.exists ? (
                  <>
                    Exists since {formatWhen(account.createdAt)} ({account.providers.join(', ') || 'email'})
                    {account.signup?.status && (
                      <Badge variant="outline" className="ml-2">
                        signup {account.signup.status}
                        {account.signup.mode ? ` · ${account.signup.mode}` : ''}
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="text-success">None — ready to sign up</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Staff records</dt>
              <dd>
                {status.memberships.length === 0
                  ? 'None'
                  : status.memberships.map((m) => (
                      <span key={m.tenantId} className="mr-3 inline-flex items-center gap-1.5">
                        {m.slug ?? m.tenantId}
                        <Badge variant={m.linked ? 'success' : 'outline'}>{m.linked ? 'signed in' : 'no login'}</Badge>
                      </span>
                    ))}
              </dd>
              <dt className="text-muted-foreground">Northwind billing</dt>
              <dd>{nwSub ? `${nwSub.plan_name ?? 'Plan'} · ${nwSub.status}` : 'Not subscribed'}</dd>
              <dt className="text-muted-foreground">Northwind first run</dt>
              <dd>{status.northwind?.firstRunDone ? 'Done' : 'Not done yet — the wizard will show'}</dd>
            </dl>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={!settings || resetting}>
            {resetting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RotateCcw className="mr-2 size-4" />}
            Delete me and start again
          </Button>
          <Button variant="outline" asChild>
            <a href={urls.landing} target="_blank" rel="noreferrer">
              Open the landing page
              <ExternalLink className="ml-2 size-4" />
            </a>
          </Button>
        </div>

        {resetSteps && resetSteps.length > 0 && (
          <div
            className={cn(
              'rounded-xl border p-4',
              resetOk ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5',
            )}
          >
            <p className="mb-2 text-sm font-medium">{resetOk ? 'Reset complete' : 'Reset stopped'}</p>
            <StepList steps={resetSteps} />
          </div>
        )}

        {!resetSteps && settings?.lastResetAt && lastSteps.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Last reset {formatWhen(settings.lastResetAt)} —{' '}
              {settings.lastResetResult?.success ? 'completed' : 'stopped part way'}
            </summary>
            <div className="mt-2">
              <StepList steps={lastSteps} />
            </div>
          </details>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={(open) => !resetting && setConfirmOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {settings?.email} and start again?</DialogTitle>
            <DialogDescription>This is what happens, in this order:</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Any company a previous unlinked rehearsal created is deleted, after its billing is canceled.</li>
            <li>Northwind&apos;s subscription is canceled in Stripe and its billing records are cleared.</li>
            <li>Northwind&apos;s first-run wizard is reset.</li>
            <li>The signup attempt limits for this email are cleared.</li>
            <li>
              The login is deleted. Northwind keeps its staff record and all its data, but has no owner
              login until you sign up again with Link to Northwind on.
            </li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={resetting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void reset()} disabled={resetting}>
              {resetting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete and reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
