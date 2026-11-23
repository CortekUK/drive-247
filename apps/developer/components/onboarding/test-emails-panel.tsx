'use client';

/**
 * The Onboarding tab: the test emails list, and the way back to a clean slate.
 *
 *   Test emails   Each address signs up on TEST Stripe, on drive-247.com and on
 *                 localhost alike, while its switch is on. Read once, when a
 *                 signup starts (supabase/functions/_shared/signup-rehearsal.ts),
 *                 so flip it before signing up, not halfway through.
 *   Reset         Removes what that address left behind on our side: its
 *                 company, an unfinished test payment, its attempt limits and
 *                 its login. The server works out the list first and refuses,
 *                 changing nothing, if anything on it is live or shared
 *                 (supabase/functions/dev-signup-rehearsal/test-emails.ts).
 *   Start fresh   The browser keeps its own copy of a half-finished signup,
 *                 which no server can clear. These links clear it.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  FlaskConical,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
  FRESH_START_LINKS,
  readSteps,
  readTestEmails,
  type ProgressTone,
  type ResetStep,
  type TestEmail,
} from '@/lib/developer-api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TONE_DOT: Record<ProgressTone, string> = {
  clean: 'bg-success',
  progress: 'bg-warning',
  done: 'bg-primary',
  error: 'bg-destructive',
};

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
          <span className="min-w-0">
            <span className="font-medium">{s.step}</span>
            <span className="text-muted-foreground">: {s.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function FreshStartLinks({ compact = false }: { compact?: boolean }) {
  const copy = async (href: string) => {
    try {
      await navigator.clipboard.writeText(href);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };
  return (
    <div className={cn('flex flex-col gap-2', !compact && 'sm:flex-row sm:flex-wrap')}>
      {FRESH_START_LINKS.map((link) => (
        <div key={link.href} className="flex items-center gap-1">
          <Button variant="outline" size="sm" asChild>
            <a href={link.href} target="_blank" rel="noreferrer">
              <Sparkles />
              Start fresh on {link.label}
              <ExternalLink className="opacity-60" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => void copy(link.href)}
            aria-label={`Copy the ${link.label} link`}
            title="Copy link"
          >
            <Copy />
          </Button>
        </div>
      ))}
    </div>
  );
}

function EmailRow({
  item,
  busy,
  onToggle,
  onReset,
  onRemove,
}: {
  item: TestEmail;
  busy: boolean;
  onToggle: (next: boolean) => void;
  onReset: () => void;
  onRemove: () => void;
}) {
  const login = item.login;
  return (
    <li className="flex flex-col gap-3 border-t py-4 first:border-t-0 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-semibold">{item.email}</p>
        <p className="flex items-center gap-2 text-sm">
          <span className={cn('size-2 shrink-0 rounded-full', TONE_DOT[item.progress.tone])} aria-hidden />
          <span className="min-w-0">{item.progress.label}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {login.exists ? (
            <span>
              Login since {formatWhen(login.createdAt)}
              {login.providers.includes('google') ? ' (Google)' : ''}
              {login.stripeMode ? ` · signed up on ${login.stripeMode} Stripe` : ''}
            </span>
          ) : (
            <span>No login</span>
          )}
          {item.companies.map((c) => (
            <Badge
              key={c.slug}
              variant={c.stripeMode === 'live' && c.subscription ? 'destructive' : 'outline'}
              title={c.keepReason ? `Kept by a reset: ${c.keepReason}` : 'Deleted by a reset'}
            >
              {c.slug} · {c.stripeMode}
              {c.subscription ? ` · ${c.subscription.status}` : ''}
              {!c.remove ? ' · kept' : ''}
            </Badge>
          ))}
          {item.lastResetAt && (
            <span>
              · Last reset {formatWhen(item.lastResetAt)}
              {item.lastResetResult && !item.lastResetResult.success ? ' (stopped)' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <label className="mr-1 flex cursor-pointer items-center gap-2 text-sm">
          <Switch
            checked={item.enabled}
            disabled={busy}
            onCheckedChange={onToggle}
            aria-label={`Test mode for ${item.email}`}
          />
          <span className={cn('w-10', item.enabled ? 'text-foreground' : 'text-muted-foreground')}>
            {item.enabled ? 'Test' : 'Live'}
          </span>
        </label>
        <Button variant="outline" size="sm" onClick={onReset} disabled={busy}>
          <RotateCcw />
          Reset
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove ${item.email} from the list`}
          title="Remove from the list"
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-5">
      {[0, 1].map((i) => (
        <li key={i} className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-9 w-48" />
        </li>
      ))}
    </ul>
  );
}

export function TestEmailsPanel() {
  const [items, setItems] = useState<TestEmail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const [resetTarget, setResetTarget] = useState<TestEmail | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ ok: boolean; steps: ResetStep[] } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TestEmail | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const res = await callDeveloper({ action: 'test_emails' });
    setRefreshing(false);
    if (!res.ok) {
      setLoadError(res.error ?? 'Could not load the test emails');
      return;
    }
    setLoadError(null);
    setItems(readTestEmails(res.body));
  }, []);

  useEffect(() => {
    void load();
    // Signups happen in another tab; coming back here shows where they got to.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const normalised = newEmail.trim().toLowerCase();
  const canAdd = EMAIL_RE.test(normalised) && !adding;

  const add = async () => {
    if (!canAdd) return;
    setAdding(true);
    const res = await callDeveloper({ action: 'test_email_add', email: normalised });
    setAdding(false);
    if (!res.ok) {
      toast.error('Could not add it', { description: res.error ?? undefined });
      return;
    }
    toast.success(`${normalised} now signs up on test Stripe`);
    setNewEmail('');
    await load();
  };

  const toggle = async (item: TestEmail, next: boolean) => {
    setBusyEmail(item.email);
    const res = await callDeveloper({ action: 'test_email_set', email: item.email, enabled: next });
    setBusyEmail(null);
    if (!res.ok) {
      toast.error('Could not save', { description: res.error ?? undefined });
      return;
    }
    if (next) toast.success(`${item.email} signs up on test Stripe`);
    else toast.warning(`${item.email} now signs up on live Stripe, with a real card`);
    await load();
  };

  const remove = async () => {
    if (!removeTarget) return;
    const target = removeTarget;
    setBusyEmail(target.email);
    const res = await callDeveloper({ action: 'test_email_remove', email: target.email });
    setBusyEmail(null);
    setRemoveTarget(null);
    if (!res.ok) {
      toast.error('Could not remove it', { description: res.error ?? undefined });
      return;
    }
    toast.success(`${target.email} is off the list`);
    await load();
  };

  const reset = async () => {
    if (!resetTarget) return;
    setResetting(true);
    const res = await callDeveloper({ action: 'test_email_reset', email: resetTarget.email });
    setResetting(false);
    setResetResult({ ok: res.ok, steps: readSteps(res.body) });
    if (res.ok) toast.success(`${resetTarget.email} is clean. Sign up again whenever you like`);
    else toast.error('The reset stopped', { description: res.error ?? undefined });
    await load();
  };

  const closeReset = () => {
    if (resetting) return;
    setResetTarget(null);
    setResetResult(null);
  };

  const blockers = resetTarget?.reset.blockers ?? [];

  return (
    <div className="max-w-4xl space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FlaskConical className="size-5" />
              Test emails
            </CardTitle>
            <CardDescription>
              A signup that starts with one of these addresses pays on test Stripe (card 4242 4242 4242 4242, any
              future date, any CVC), on drive-247.com and on localhost. Everyone else signs up as normal.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={() => void load()}
            disabled={refreshing}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} />
          </Button>
        </CardHeader>

        <CardContent className="space-y-6">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="you+test1@gmail.com"
              aria-label="Test email to add"
              disabled={adding}
              className="sm:max-w-sm"
            />
            <Button type="submit" disabled={!canAdd}>
              {adding ? <Loader2 className="animate-spin" /> : <Plus />}
              Add
            </Button>
          </form>

          {loadError && (
            <p className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {loadError}
            </p>
          )}

          {items === null && !loadError ? (
            <ListSkeleton />
          ) : items && items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No test emails yet. Add one above, then sign up with it.
            </p>
          ) : items ? (
            <ul>
              {items.map((item) => (
                <EmailRow
                  key={item.email}
                  item={item}
                  busy={busyEmail === item.email}
                  onToggle={(next) => void toggle(item, next)}
                  onReset={() => {
                    setResetResult(null);
                    setResetTarget(item);
                  }}
                  onRemove={() => setRemoveTarget(item)}
                />
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="size-5" />
            Start fresh in the browser
          </CardTitle>
          <CardDescription>
            The browser keeps its own copy of a half-finished signup: the form, the code screen, the chosen plan
            and the sign-in. Open a link in the browser you tested in. It clears all of that, signs you out and
            opens a new signup. The localhost one also switches off the pretend signup there.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FreshStartLinks />
        </CardContent>
      </Card>

      {/* ---------- Reset ---------- */}
      <Dialog open={!!resetTarget} onOpenChange={(open) => !open && closeReset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {resetResult ? (resetResult.ok ? 'Reset done' : 'Reset stopped') : `Reset ${resetTarget?.email}?`}
            </DialogTitle>
            <DialogDescription>
              {resetResult
                ? resetResult.ok
                  ? 'Our side is clean. Now clear the browser you tested in:'
                  : 'Here is how far it got.'
                : blockers.length
                  ? 'This one cannot be reset from here. Nothing will be changed:'
                  : 'This is removed, in this order:'}
            </DialogDescription>
          </DialogHeader>

          {resetResult ? (
            <div className="space-y-4">
              <StepList steps={resetResult.steps} />
              {resetResult.ok && <FreshStartLinks compact />}
            </div>
          ) : blockers.length ? (
            <ul className="space-y-1.5 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {blockers.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              {(resetTarget?.reset.removes ?? []).map((line) => (
                <li key={line}>{line}</li>
              ))}
              {(resetTarget?.companies ?? [])
                .filter((c) => !c.remove)
                .map((c) => (
                  <li key={c.slug} className="list-none -ml-5 text-xs">
                    Kept: {c.slug} ({c.keepReason})
                  </li>
                ))}
            </ul>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {resetResult ? (
              <Button onClick={closeReset}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeReset} disabled={resetting}>
                  Cancel
                </Button>
                {!blockers.length && (
                  <Button variant="destructive" onClick={() => void reset()} disabled={resetting}>
                    {resetting ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    Reset
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Remove from the list ---------- */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => !open && !busyEmail && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.email} from the list?</DialogTitle>
            <DialogDescription>
              Its next signup pays on live Stripe, like everyone else. Its login and company stay as they are, so
              reset it first if you want those gone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRemoveTarget(null)} disabled={!!busyEmail}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={!!busyEmail}>
              {busyEmail ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
