/**
 * TenantTimelineTab — the account timeline from RETENTION_PLAN.md step 1.
 *
 * Everything that has happened to this rental company's ACCOUNT, newest first:
 * signup, subscription, every bill paid or failed, refunds and disputes, setup
 * finished, first booking and booking milestones, go-live requests, support
 * tickets, feedback, team follow-ups, cancellation.
 *
 * Reads `tenant_lifecycle_events` (super-admin RLS). Those rows are derived from
 * the source tables every 15 minutes by `lifecycle_derive_events()`, so this
 * view can trail reality by up to that long. Read-only.
 */
'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface LifecycleEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  source: 'derived' | 'app' | 'staff';
  payload: Record<string, unknown>;
}

type Group = 'billing' | 'subscription' | 'setup' | 'bookings' | 'support';

const GROUPS: { id: Group | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'billing', label: 'Billing' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'setup', label: 'Setup' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'support', label: 'Support' },
];

type Tone = 'good' | 'bad' | 'warn' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  good: 'text-green-600',
  bad: 'text-red-600',
  warn: 'text-amber-600',
  neutral: 'text-foreground',
};

/** One entry per event type: its group, its colour, and how it reads. */
const EVENTS: Record<string, { group: Group; tone: Tone; title: (p: Payload) => string }> = {
  'account.created': { group: 'subscription', tone: 'neutral', title: () => 'Account created' },
  'trial.started': { group: 'subscription', tone: 'neutral', title: (p) => `Started on ${plan(p)}` },
  'subscription.started': { group: 'subscription', tone: 'good', title: (p) => `Subscribed to ${plan(p)}` },
  'cancellation.started': { group: 'subscription', tone: 'warn', title: () => 'Asked to cancel' },
  'cancellation.scheduled': { group: 'subscription', tone: 'warn', title: (p) => `Set to cancel on ${date(p.cancel_at)}` },
  'cancellation.completed': { group: 'subscription', tone: 'bad', title: (p) => `Subscription ended (${plan(p)})` },
  'billing.payment_succeeded': { group: 'billing', tone: 'good', title: (p) => `Paid ${money(p)}` },
  'billing.payment_failed': { group: 'billing', tone: 'bad', title: (p) => `Payment of ${money(p)} failed (attempt ${p.attempt ?? '?'})` },
  'billing.refunded': { group: 'billing', tone: 'warn', title: (p) => `Refunded ${money(p)}` },
  'billing.dispute_created': { group: 'billing', tone: 'bad', title: (p) => `Disputed ${money(p)}` },
  'billing.charge_upcoming': { group: 'billing', tone: 'neutral', title: (p) => `Renews ${date(p.charge_at)} for ${money(p)}` },
  'onboarding.completed': { group: 'setup', tone: 'good', title: () => 'Finished setup' },
  'golive.requested': { group: 'setup', tone: 'neutral', title: (p) => `Requested go-live: ${kind(p)}` },
  'golive.approved': { group: 'setup', tone: 'good', title: (p) => `Go-live approved: ${kind(p)}` },
  'booking.first_completed': { group: 'bookings', tone: 'good', title: () => 'First rental completed' },
  'milestone.reached': {
    group: 'bookings',
    tone: 'good',
    title: (p) => (p.threshold === 1 ? 'First booking taken' : `${String(p.threshold)}th booking taken`),
  },
  'support.ticket_opened': { group: 'support', tone: 'neutral', title: (p) => `Support ticket ${str(p.reference)}`.trim() },
  'feedback.submitted': { group: 'support', tone: 'neutral', title: (p) => `Sent feedback${p.category ? ` (${str(p.category)})` : ''}` },
  'staff.contacted': { group: 'support', tone: 'neutral', title: (p) => `Team contacted them${p.channel ? ` by ${str(p.channel)}` : ''}` },
};

type Payload = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function plan(p: Payload): string {
  return str(p.plan) || 'a plan';
}

function kind(p: Payload): string {
  const k = str(p.kind);
  if (k === 'stripe_connect') return 'Stripe';
  if (k === 'bonzah') return 'Bonzah';
  return k.replace(/_/g, ' ') || 'integration';
}

function money(p: Payload): string {
  const cents = typeof p.amount === 'number' ? p.amount : Number(p.amount);
  if (!Number.isFinite(cents)) return '—';
  const currency = (str(p.currency) || 'usd').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function date(v: unknown): string {
  const s = str(v);
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A short second line, where the event carries something worth reading. */
function detail(e: LifecycleEvent): string | null {
  const p = e.payload;
  if (e.event_type === 'billing.payment_succeeded' && p.period_start && p.period_end) {
    return `${date(p.period_start)} – ${date(p.period_end)}${p.invoice_number ? ` · ${str(p.invoice_number)}` : ''}`;
  }
  if (e.event_type === 'billing.payment_failed' && p.next_attempt) return `Next retry ${date(p.next_attempt)}`;
  if (e.event_type === 'support.ticket_opened') return str(p.summary) || null;
  if (e.event_type === 'feedback.submitted') {
    const rated = p.rating != null ? `Rated ${str(p.rating)}` : '';
    return [rated, str(p.message)].filter(Boolean).join(' · ') || null;
  }
  if (e.event_type === 'staff.contacted' || e.event_type === 'cancellation.started') {
    return str(p.note) || null;
  }
  return null;
}

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function TenantTimelineTab({ tenantId }: { tenantId: string }) {
  const [group, setGroup] = useState<Group | 'all'>('all');

  const query = useQuery({
    queryKey: ['tenant-lifecycle-events', tenantId],
    queryFn: async (): Promise<LifecycleEvent[]> => {
      const { data, error } = await supabase
        .from('tenant_lifecycle_events')
        .select('id, event_type, occurred_at, source, payload')
        .eq('tenant_id', tenantId)
        .order('occurred_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as LifecycleEvent[];
    },
    staleTime: 60_000,
  });

  const events = query.data ?? [];

  const visible = useMemo(
    () => (group === 'all' ? events : events.filter((e) => EVENTS[e.event_type]?.group === group)),
    [events, group],
  );

  const months = useMemo(() => {
    const out: { label: string; items: LifecycleEvent[] }[] = [];
    for (const e of visible) {
      const label = monthLabel(e.occurred_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [visible]);

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-red-600">
          Couldn&apos;t load the timeline: {(query.error as Error).message}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Timeline</CardTitle>
        <CardDescription>
          Everything that has happened to this account, newest first. Updated every 15 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter timeline">
          {GROUPS.map((g) => {
            const count = g.id === 'all' ? events.length : events.filter((e) => EVENTS[e.event_type]?.group === g.id).length;
            const active = group === g.id;
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setGroup(g.id)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs transition-colors duration-200 ease-out motion-reduce:transition-none',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {g.label} <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {months.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          months.map((m) => (
            <section key={m.label} className="space-y-1">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.label}</h3>
              <ul className="divide-y divide-border">
                {m.items.map((e) => {
                  const def = EVENTS[e.event_type];
                  const sub = detail(e);
                  return (
                    <li key={e.id} className="flex items-start justify-between gap-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm', TONE_CLASS[def?.tone ?? 'neutral'])}>
                          {def ? def.title(e.payload) : e.event_type}
                        </p>
                        {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
                      </div>
                      <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={e.occurred_at}>
                        {timeLabel(e.occurred_at)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}
