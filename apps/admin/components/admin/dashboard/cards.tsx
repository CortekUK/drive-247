'use client';

/**
 * The dashboard's cards. Each answers one question:
 *
 *   SubscriptionsCard  what does the platform earn every month?
 *   NeedsYouCard       who is waiting on me?
 *   NewCompaniesCard   who just signed up, and where are they?
 *   ActivityCard       what just happened across the platform?
 *   PlatformFigures    how big is the platform?
 *
 * Reads come from lib/dashboard/use-admin-dashboard.ts; nothing here queries.
 */

import { useAdminNav } from '@/components/admin/admin-nav';
import {
  useActivity,
  useLiveTenants,
  useNeedsYou,
  usePlatformCounts,
  useSubscriptions,
  type ActivityRow,
} from '@/lib/dashboard/use-admin-dashboard';
import { cn } from '@/lib/utils';
import { ago, Card, CardFooter, Eyebrow, Quiet, Row, RowsSkeleton, usd, type Tone } from './kit';

const tenantHref = (id: string) => `/admin/rentals/${id}`;

/* ─────────────────────────────── subscriptions ─────────────────────────── */

export function SubscriptionsCard({ className }: { className?: string }) {
  const subs = useSubscriptions();
  const s = subs.data;
  const lines: { label: string; value: number | undefined; tone: Tone }[] = [
    { label: 'Paying', value: s?.active, tone: 'clear' },
    { label: 'In trial', value: s?.trialing, tone: 'wait' },
    { label: 'Payment due', value: s?.pastDue.length, tone: s && s.pastDue.length > 0 ? 'late' : 'idle' },
  ];
  return (
    <div className={cn('flex flex-col rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)]', className)}>
      <div className="px-6 pt-5">
        <Eyebrow>Monthly recurring revenue</Eyebrow>
        <p className="mt-3 text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--pv-ink)]">
          {s ? usd(s.mrr) : <span className="inline-block h-7 w-28 animate-pulse rounded-lg bg-[var(--pv-wash)] motion-reduce:animate-none" />}
        </p>
        <p className="mt-1.5 text-[11.5px] text-[var(--pv-ink-3)]">From live companies&rsquo; active plans</p>
      </div>
      <ul className="mt-4 space-y-0.5 px-6 pb-3">
        {lines.map((l) => (
          <li key={l.label} className="flex items-center justify-between py-1 text-[12.5px]">
            <span className="text-[var(--pv-ink-2)]">{l.label}</span>
            <span
              className={cn(
                'font-semibold tabular-nums',
                l.tone === 'late' ? 'text-[var(--pv-late)]' : 'text-[var(--pv-ink)]',
              )}
            >
              {l.value ?? '—'}
            </span>
          </li>
        ))}
      </ul>
      <CardFooter label="Subscriptions" href="/admin/rentals" />
    </div>
  );
}

/* ───────────────────────────────── needs you ───────────────────────────── */

const KIND: Record<string, string> = { stripe_connect: 'Stripe', bonzah: 'Bonzah', boldsign: 'BoldSign' };
const kindWord = (k: string) => KIND[k] ?? (k.replace(/_/g, ' ') || 'an integration');

export function NeedsYouCard() {
  const tenants = useLiveTenants();
  const needs = useNeedsYou();
  const subs = useSubscriptions();
  const { supportCount } = useAdminNav();
  const name = (id: string) => tenants.data?.byId.get(id)?.name ?? 'Unknown company';

  type Item = { key: string; title: string; meta: string; at: string | null; tone: Tone; href: string };
  const items: Item[] = [];
  for (const s of subs.data?.pastDue ?? []) {
    items.push({
      key: `due-${s.tenantId}`,
      title: name(s.tenantId),
      meta: `Payment due${s.planName ? ` · ${s.planName}` : ''}`,
      at: s.periodEnd,
      tone: 'late',
      href: tenantHref(s.tenantId),
    });
  }
  for (const inv of needs.data?.open ?? []) {
    if (items.some((i) => i.key === `due-${inv.tenantId}`)) continue;
    items.push({
      key: `inv-${inv.tenantId}-${inv.dueDate}`,
      title: name(inv.tenantId),
      meta: `${usd(inv.amount, true)} unpaid${inv.attempts > 0 ? ` · ${inv.attempts} failed attempt${inv.attempts === 1 ? '' : 's'}` : ''}`,
      at: inv.dueDate,
      tone: inv.attempts > 0 ? 'late' : 'wait',
      href: tenantHref(inv.tenantId),
    });
  }
  for (const r of needs.data?.requests ?? []) {
    items.push({
      key: `gl-${r.id}`,
      title: name(r.tenantId),
      meta: `Wants to go live on ${kindWord(r.kind)}`,
      at: r.createdAt,
      tone: 'wait',
      href: '/admin/requests',
    });
  }
  // Late before waiting; within each, the longest-waiting first.
  items.sort((a, b) => (a.tone === b.tone ? Date.parse(a.at ?? '') - Date.parse(b.at ?? '') : a.tone === 'late' ? -1 : 1));

  const support = supportCount && supportCount > 0 ? supportCount : 0;
  const total = items.length + (support ? 1 : 0);
  const loading = needs.isLoading || subs.isLoading || tenants.isLoading;

  return (
    <Card title="Needs you" count={loading ? undefined : total}>
      {loading ? (
        <RowsSkeleton />
      ) : total === 0 ? (
        <Quiet>Nothing is waiting on you.</Quiet>
      ) : (
        <div className="py-1">
          {support > 0 && (
            <Row title="Support" meta={`${support} unread message${support === 1 ? '' : 's'}`} clock="" tone="wait" href="/admin/support" newTab />
          )}
          {items.slice(0, support ? 4 : 5).map((i) => (
            <Row key={i.key} title={i.title} meta={i.meta} clock={ago(i.at)} tone={i.tone} href={i.href} />
          ))}
        </div>
      )}
      <CardFooter label={total > 5 ? `${total - 5} more · Mode requests` : 'Mode requests'} href="/admin/requests" />
    </Card>
  );
}

/* ─────────────────────────────── new companies ─────────────────────────── */

export function NewCompaniesCard() {
  const tenants = useLiveTenants();
  const subs = useSubscriptions();
  const monthAgo = Date.now() - 30 * 86_400_000;
  const recent = (tenants.data?.list ?? []).slice(0, 5);
  const newThisMonth = (tenants.data?.list ?? []).filter((t) => Date.parse(t.createdAt) >= monthAgo).length;
  const statusOf = (id: string) => subs.data?.rows.find((r) => r.tenantId === id);

  return (
    <Card title="New companies" count={tenants.data ? `${newThisMonth} this month` : undefined}>
      {tenants.isLoading ? (
        <RowsSkeleton />
      ) : recent.length === 0 ? (
        <Quiet>No companies yet.</Quiet>
      ) : (
        <div className="py-1">
          {recent.map((t) => {
            const s = statusOf(t.id);
            const [meta, tone]: [string, Tone] =
              t.status === 'suspended'
                ? ['Suspended', 'late']
                : !s
                  ? ['No subscription yet', 'wait']
                  : s.status === 'active'
                    ? [`Paying${s.planName ? ` · ${s.planName}` : ''}`, 'clear']
                    : s.status === 'trialing'
                      ? ['In trial', 'wait']
                      : ['Payment due', 'late'];
            return <Row key={t.id} title={t.name} meta={meta} clock={ago(t.createdAt)} tone={tone} href={tenantHref(t.id)} />;
          })}
        </div>
      )}
      <CardFooter label="All rental companies" href="/admin/rentals" />
    </Card>
  );
}

/* ──────────────────────────────── activity ─────────────────────────────── */

function money(p: Record<string, unknown>): string {
  const cents = typeof p.amount === 'number' ? p.amount : Number(p.amount);
  return Number.isFinite(cents) ? usd(cents / 100, cents % 100 !== 0) : '';
}

/** How an event reads in one line, and its state colour. */
function describe(e: ActivityRow): { text: string; tone: Tone } {
  const p = e.payload;
  const plan = typeof p.plan === 'string' && p.plan ? p.plan : 'a plan';
  switch (e.type) {
    case 'account.created':
      return { text: 'Signed up', tone: 'clear' };
    case 'trial.started':
      return { text: `Started a trial on ${plan}`, tone: 'idle' };
    case 'subscription.started':
      return { text: `Subscribed to ${plan}`, tone: 'clear' };
    case 'cancellation.started':
      return { text: 'Asked to cancel', tone: 'wait' };
    case 'cancellation.scheduled':
      return { text: 'Set to cancel', tone: 'wait' };
    case 'cancellation.completed':
      return { text: 'Subscription ended', tone: 'late' };
    case 'billing.payment_succeeded':
      return { text: `Paid ${money(p)}`.trim(), tone: 'clear' };
    case 'billing.payment_failed':
      return { text: `Payment of ${money(p)} failed`, tone: 'late' };
    case 'billing.refunded':
      return { text: `Refunded ${money(p)}`.trim(), tone: 'wait' };
    case 'billing.dispute_created':
      return { text: `Disputed ${money(p)}`.trim(), tone: 'late' };
    case 'onboarding.completed':
      return { text: 'Finished setup', tone: 'clear' };
    case 'golive.requested':
      return { text: `Asked to go live on ${kindWord(String(p.kind ?? ''))}`, tone: 'wait' };
    case 'golive.approved':
      return { text: `Went live on ${kindWord(String(p.kind ?? ''))}`, tone: 'clear' };
    case 'booking.first_completed':
      return { text: 'Completed their first rental', tone: 'clear' };
    case 'milestone.reached':
      return { text: p.threshold === 1 ? 'Took their first booking' : `Reached ${String(p.threshold)} bookings`, tone: 'clear' };
    case 'support.ticket_opened':
      return { text: 'Opened a support ticket', tone: 'idle' };
    case 'feedback.submitted':
      return { text: 'Sent feedback', tone: 'idle' };
    default:
      return { text: e.type.replace(/[._]/g, ' '), tone: 'idle' };
  }
}

export function ActivityCard() {
  const tenants = useLiveTenants();
  const activity = useActivity(5);
  const name = (id: string) => tenants.data?.byId.get(id)?.name ?? 'Unknown company';
  return (
    <Card title="Latest activity">
      {activity.isLoading || tenants.isLoading ? (
        <RowsSkeleton />
      ) : !activity.data?.length ? (
        <Quiet>Nothing has happened yet.</Quiet>
      ) : (
        <div className="py-1">
          {activity.data.map((e) => {
            const d = describe(e);
            return <Row key={e.id} title={name(e.tenantId)} meta={d.text} clock={ago(e.at)} tone={d.tone} href={tenantHref(e.tenantId)} />;
          })}
        </div>
      )}
      <CardFooter label="Audit logs" href="/admin/audit-logs" />
    </Card>
  );
}

/* ─────────────────────────────── the platform ──────────────────────────── */

export function PlatformFigures() {
  const counts = usePlatformCounts();
  const c = counts.data;
  const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('en-US'));
  const figures = [
    { label: 'Live companies', value: n(c?.companies) },
    { label: 'Vehicles', value: n(c?.vehicles) },
    { label: 'Customers', value: n(c?.customers) },
    { label: 'Rentals', value: n(c?.rentals), sub: c ? `+${n(c.rentals30)} in 30 days` : undefined },
  ];
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] md:grid-cols-4">
      {figures.map((f, i) => (
        <div
          key={f.label}
          className={cn(
            'px-6 py-5',
            i > 0 && 'md:border-l md:border-[var(--pv-line)]',
            i % 2 === 1 && 'border-l border-[var(--pv-line)]',
            i >= 2 && 'border-t border-[var(--pv-line)] md:border-t-0',
          )}
        >
          <Eyebrow>{f.label}</Eyebrow>
          <p className="mt-2.5 text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--pv-ink)]">
            {counts.isLoading ? <span className="inline-block h-6 w-16 animate-pulse rounded bg-[var(--pv-wash)] motion-reduce:animate-none" /> : f.value}
          </p>
          {f.sub && <p className="mt-1.5 text-[11.5px] text-[var(--pv-ink-3)]">{f.sub}</p>}
        </div>
      ))}
    </div>
  );
}
