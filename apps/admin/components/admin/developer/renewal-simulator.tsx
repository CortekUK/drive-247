'use client';

/**
 * Renewal reminder test — move Northwind's payment date and watch the emails.
 *
 * The renewal countdown sends "3 days left", "2 days left" and "1 day left"
 * before a subscription payment. Waiting three real days to see that work is
 * not a test, so this sets a PRETEND payment date for the scope tenant
 * (`test_renewal_date`). The runner then uses it in place of Northwind's real
 * subscription date, under exactly the production rules — so "3 days from
 * now" produces the real 3-day email on the next cron tick, and moving the
 * date to 2 days produces the next one.
 *
 * Nothing here writes to the billing tables: Northwind's real subscription,
 * its portal and its Stripe charges are untouched. The sends are logged as
 * test rows keyed apart from production, so a test never uses up a real
 * reminder. Clear the date and Northwind is back on its real one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock, Loader2, MailCheck, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';

import {
  loadSends,
  loadSubscriptionsFor,
  setSimulatedRenewalDate,
  type TenantSubscriptionSnapshot,
} from '@/lib/customer-management/api';
import {
  daysText,
  isoDay,
  nextBillingDate,
  selectSubscription,
} from '@/lib/customer-management/schedule';
import type {
  CustomerManagementSendRow,
  CustomerManagementSettings,
  CustomerManagementStep,
} from '@/lib/customer-management/types';

const DAY_MS = 86_400_000;
const REFRESH_MS = 10_000;

/**
 * Twin of `simRunId` in customer-management-run/index.ts: each pretend date
 * gets its own run id, so the log rows for one date can be found again.
 */
function simRunId(date: Date): string {
  return `sim-${Math.floor(date.getTime() / 60_000)}`;
}

/** `<input type="datetime-local">` wants local time without a zone. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatWhen(date: Date): string {
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RenewalSimulator({
  settings,
  steps,
  onChange,
}: {
  settings: CustomerManagementSettings;
  steps: CustomerManagementStep[];
  onChange: (next: CustomerManagementSettings) => void;
}) {
  const slug = settings.scope_tenant_slug;
  const [subs, setSubs] = useState<TenantSubscriptionSnapshot[] | null>(null);
  const [sends, setSends] = useState<CustomerManagementSendRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(() => toLocalInput(new Date(Date.now() + 3 * DAY_MS)));
  const [now, setNow] = useState(() => Date.now());

  const renewalSteps = useMemo(
    () =>
      steps
        .filter((s) => s.automation === 'renewal' && s.enabled)
        .sort((a, b) => b.offset_days - a.offset_days),
    [steps],
  );

  const refresh = useCallback(async () => {
    setNow(Date.now());
    try {
      const [nextSubs, nextSends] = await Promise.all([
        loadSubscriptionsFor(slug),
        loadSends({ automation: 'renewal', limit: 20 }),
      ]);
      setSubs(nextSubs);
      setSends(nextSends.filter((r) => r.tenant_slug === slug && r.cycle_key.startsWith('test:sim-')));
    } catch {
      /* The card stays usable; the next refresh tries again. */
    }
  }, [slug]);

  // The email arrives on the next cron tick (every 30 seconds), so poll
  // rather than make anyone reload to see it.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const realSub = selectSubscription(subs || []);
  const real = nextBillingDate(realSub, new Date(now));
  const simDate = settings.test_renewal_date ? new Date(settings.test_renewal_date) : null;

  const apply = async (date: Date | null) => {
    setBusy(true);
    try {
      onChange(await setSimulatedRenewalDate(date));
      toast.success(
        date
          ? `Northwind's payment date is now ${formatWhen(date)}. Any email due goes out within 30 seconds.`
          : 'Simulation off — Northwind is back on its real payment date.',
      );
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const inDays = (days: number) => apply(new Date(Date.now() + days * DAY_MS));

  const applyCustom = () => {
    const date = new Date(custom);
    if (Number.isNaN(date.getTime())) {
      toast.error('Pick a valid date and time.');
      return;
    }
    void apply(date);
  };

  /* What each reminder will do for the current pretend date. */
  const plan = simDate
    ? renewalSteps.map((step) => {
        const dueAt = new Date(simDate.getTime() - step.offset_days * DAY_MS);
        const cycle = `test:${simRunId(simDate)}:${isoDay(simDate)}`;
        const row = sends.find((r) => r.step_key === step.step_key && r.cycle_key === cycle);
        return { step, dueAt, row };
      })
    : [];

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4" />
          Renewal reminder test — {slug}
          {simDate && <Badge variant="secondary">Simulating</Badge>}
        </p>
        <p className="text-sm text-muted-foreground">
          Pretend {slug}&apos;s subscription payment is due on a date you choose. The system then
          sends the matching reminder by itself, exactly as it would for a real tenant: 3 days left,
          2 days left, 1 day left. Northwind&apos;s real subscription and billing are not touched.
        </p>
      </div>

      {settings.test_mode && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
          Developer test mode is on, so renewal reminders are playing the fast one-minute countdown
          instead. Switch test mode off to test with a real payment date here.
        </p>
      )}
      {!settings.renewal_enabled && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
          Renewal Reminders are switched off on the Customer Management page, so nothing will send.
        </p>
      )}

      <div className="grid gap-1 text-sm">
        <p>
          <span className="text-muted-foreground">Real payment date: </span>
          {subs === null
            ? '…'
            : real.date
              ? `${formatWhen(real.date)} (${realSub?.status})`
              : `none (${(real.skip || 'no_subscription').replace(/_/g, ' ')})`}
        </p>
        <p>
          <span className="text-muted-foreground">Test payment date: </span>
          {simDate ? (
            <span className="font-medium">{formatWhen(simDate)}</span>
          ) : (
            'not set — using the real one'
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Set the payment date to</Label>
        <div className="flex flex-wrap gap-2">
          {[3, 2, 1].map((days) => (
            <Button key={days} variant="outline" size="sm" disabled={busy} onClick={() => inDays(days)}>
              {daysText(days)} from now
            </Button>
          ))}
          {simDate && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => apply(null)}>
              Stop simulating
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="datetime-local"
            className="w-auto"
            value={custom}
            disabled={busy}
            onChange={(e) => setCustom(e.target.value)}
            aria-label="Custom payment date"
          />
          <Button size="sm" disabled={busy} onClick={applyCustom}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Set date
          </Button>
        </div>
      </div>

      {simDate && (
        <ul className="space-y-1.5">
          {plan.map(({ step, dueAt, row }) => {
            const due = dueAt.getTime() <= now;
            return (
              <li key={step.id} className="flex items-center justify-between gap-4 text-xs">
                <span className="flex items-center gap-2">
                  {row?.status === 'sent' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  ) : row?.status === 'failed' ? (
                    <XCircle className="h-3.5 w-3.5 text-red-600" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  {daysText(step.offset_days)} left
                </span>
                <span className="text-muted-foreground">
                  {row
                    ? row.status === 'sent'
                      ? `sent ${row.sent_at ? formatWhen(new Date(row.sent_at)) : ''} → ${row.to_email}`
                      : `${row.status}: ${(row.detail || '').replace(/_/g, ' ')}`
                    : due
                      ? 'due now — sending within 30 seconds'
                      : `sends ${formatWhen(dueAt)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {sends.length > 0 && (
        <div className="space-y-1 border-t pt-3">
          <p className="flex items-center gap-2 text-xs font-medium">
            <MailCheck className="h-3.5 w-3.5" />
            Recent test reminders
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {sends.slice(0, 6).map((r) => (
              <li key={r.id}>
                {new Date(r.created_at).toLocaleTimeString()} · {r.subject || r.step_key} · {r.status}
                {r.to_email ? ` → ${r.to_email}` : ''}
                {r.detail ? ` · ${r.detail.replace(/_/g, ' ')}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
