'use client';

/**
 * What the team wants to know about a company, on its page.
 *
 *   TenantInsights  two header buttons, each opening a dialog:
 *     Health        the customer health score (lib/customer-health), and how
 *                   it is made — the same score Customer Management shows.
 *     Onboarding    their answers to the first-run questions
 *                   (tenant_first_run, labelled from first_run_questions).
 *   FeedbackPanel   what the company sent through the portal (tenant_feedback).
 *
 * FeedbackPanel sits in the page's right column; the notes are in
 * tenant-notes.tsx.
 *
 * MOCK (Ghulam, Oct 19 2026): a company with no feedback or no onboarding
 * answers shows sample ones, marked "Sample", so the UI can be reviewed.
 * Delete MOCK_FEEDBACK and MOCK_ONBOARDING once signed off.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Area, AreaChart, YAxis } from 'recharts';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { loadHealthTrend, loadScoredTenants } from '@/lib/customer-health/load';
import type { HealthResult } from '@/lib/customer-health/score';
import { BAND, HealthBreakdown } from '@/components/admin/customer-management/health-parts';
import { CATEGORY_META, type Category } from '@/components/admin/feedback-category';

/* ------------------------------------------------------------------ types */

interface FeedbackItem {
  id: string;
  category: string;
  message: string;
  submitter_name: string | null;
  submitter_email: string | null;
  status: string;
  rating: number | null;
  created_at: string;
}

interface Question {
  question_key: string;
  kind: string;
  prompt: string;
  options: { label: string; value: string }[] | null;
}

interface FirstRun {
  answers: Record<string, unknown>;
  was_skipped: boolean;
  completed_at: string | null;
}

/* ------------------------------------------------------------------ mocks */

const MOCK_FEEDBACK: FeedbackItem[] = [
  { id: 'mock-1', category: 'bug', message: 'The calendar does not refresh after I extend a rental. I have to reload the page.', submitter_name: 'Sarah (Owner)', submitter_email: null, status: 'open', rating: 3, created_at: '2026-10-14T10:12:00Z' },
  { id: 'mock-2', category: 'feature_request', message: 'Could we send the agreement by SMS as well as email?', submitter_name: 'Sarah (Owner)', submitter_email: null, status: 'open', rating: 4, created_at: '2026-10-08T16:40:00Z' },
  { id: 'mock-3', category: 'improvement', message: 'Love the new dashboard. Faster to find today’s pickups.', submitter_name: 'Mike (Ops)', submitter_email: null, status: 'resolved', rating: 5, created_at: '2026-09-29T09:05:00Z' },
];

const MOCK_ONBOARDING: FirstRun = {
  answers: {
    fleet_size: '6-10',
    primary_location: 'Miami, FL',
    vehicle_types: ['suv', 'luxury'],
    takes_payments_today: 'other_processor',
    referral_source: 'word_of_mouth',
  },
  was_skipped: false,
  completed_at: '2026-09-04T12:00:00Z',
};

/* ---------------------------------------------------------------- helpers */

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** A first-run answer as words: option values become their labels. */
function answerText(q: Question | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const label = (v: unknown) => q?.options?.find((o) => o.value === v)?.label ?? String(v);
  return Array.isArray(value) ? value.map(label).join(', ') : label(value);
}

function SampleTag() {
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sample</span>
  );
}

/* ------------------------------------------------------------------ main */

/** Their first-run answers, inline (a tab of the company page's right column). */
export function OnboardingAnswers({ tenantId, companyName }: { tenantId: string; companyName: string }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [firstRun, setFirstRun] = useState<FirstRun | null | undefined>(undefined);

  useEffect(() => {
    const db = supabase as any;
    db.from('first_run_questions')
      .select('question_key, kind, prompt, options')
      .order('sort_order')
      .then(({ data }: { data: Question[] | null }) => setQuestions(data ?? []));
    db.from('tenant_first_run')
      .select('answers, was_skipped, completed_at')
      .eq('tenant_id', tenantId)
      .maybeSingle()
      .then(({ data }: { data: FirstRun | null }) => setFirstRun(data));
  }, [tenantId]);

  if (firstRun === undefined) return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  const shown = firstRun ?? MOCK_ONBOARDING;

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        {shown.was_skipped
          ? `${companyName} skipped the first-run questions.`
          : shown.completed_at
            ? `Answered ${day(shown.completed_at)}, the first time they opened the portal.`
            : `${companyName} hasn't answered yet.`}
      </p>
      {!shown.was_skipped && (
        <dl className="divide-y divide-border/60">
          {/* Every question asked, in order, then any answer to a question
              that has since been removed. */}
          {[
            ...questions.map((q) => ({ key: q.question_key, q })),
            ...Object.keys(shown.answers)
              .filter((k) => !questions.some((q) => q.question_key === k))
              .map((k) => ({ key: k, q: undefined })),
          ].map(({ key, q }) => (
            <div key={key} className="py-2.5">
              <dt className="text-xs text-muted-foreground">{q?.prompt ?? key.replace(/_/g, ' ')}</dt>
              <dd className="mt-0.5 text-sm font-medium text-foreground">{answerText(q, shown.answers[key])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- panels */

/** A right-column card: title (and a count), then a body that scrolls. */
function Panel({
  title,
  count,
  children,
  className,
  onOpen,
}: {
  title: string;
  count?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Makes the whole card a button. */
  onOpen?: () => void;
}) {
  return (
    <section
      {...(onOpen && {
        role: 'button',
        tabIndex: 0,
        onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        },
      })}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-3xl bg-card p-5 shadow-sm ring-1 ring-foreground/10',
        onOpen &&
          'cursor-pointer text-left outline-none transition-all duration-200 hover:ring-primary/30 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      <h2 className="mb-3 flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight">
        {title}
        {count}
      </h2>
      {children}
    </section>
  );
}

/** A 1–5 star rating, drawn as five stars (halves for an average). */
function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn('relative inline-flex leading-none', className)} aria-label={`${value.toFixed(1)} out of 5 stars`}>
      <span className="text-muted-foreground/30">★★★★★</span>
      <span className="absolute inset-y-0 left-0 overflow-hidden text-amber-400" style={{ width: `${(value / 5) * 100}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

/** One feedback item, as a card. */
function FeedbackCard({ f }: { f: FeedbackItem }) {
  const meta = CATEGORY_META[f.category as Category] ?? CATEGORY_META.note;
  const Icon = meta.icon;
  return (
    <div className="rounded-2xl border border-border/70 p-3">
      <div className="flex items-center gap-1.5 text-xs">
        <Icon className="size-3.5" style={{ color: meta.color }} />
        <span className="font-semibold" style={{ color: meta.color }}>{meta.label}</span>
        {f.rating !== null && <Stars value={f.rating} className="ml-1 text-[11px]" />}
        <span className={cn('ml-auto font-medium', f.status === 'open' ? 'text-warning' : 'text-success')}>
          {f.status === 'open' ? 'Open' : 'Resolved'}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-sm text-foreground">{f.message}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {f.submitter_name || f.submitter_email || 'Someone at the company'} · {day(f.created_at)}
      </p>
    </div>
  );
}

/**
 * shadcn's "Area Chart - Linear", stripped down: a value over time as a
 * line over a soft fill in one colour, no axes, no grid. Used for the weekly
 * health score and the running star rating.
 */
function TrendLine({
  points,
  color,
  domain,
  id,
}: {
  points: { date: string; value: number }[];
  color: string;
  domain: [number, number];
  id: string;
}) {
  return (
    <AreaChart width={150} height={64} data={points} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.35} />
          <stop offset="95%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <YAxis hide domain={domain} />
      <Area dataKey="value" type="monotone" stroke={color} strokeWidth={2} fill={`url(#${id})`} dot={false} isAnimationActive />
    </AreaChart>
  );
}

/**
 * The average star rating as it moved: one point per rating, oldest first,
 * each the average of every rating up to and including it.
 */
function ratingTrend(items: FeedbackItem[]): { date: string; value: number }[] {
  const rated = items
    .filter((f) => f.rating !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  let sum = 0;
  return rated.map((f, i) => {
    sum += f.rating ?? 0;
    return { date: f.created_at, value: sum / (i + 1) };
  });
}

const TILE =
  'group flex min-w-0 flex-col rounded-2xl p-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50';

/**
 * How the company is doing, at a glance: its health score as a ring and
 * the part of it that is weakest, and what they think of us — the average
 * star rating, how their stars spread, and how much is still open. Each
 * half opens its own dialog: the score's breakdown, or everything they sent.
 */
export function HealthFeedbackPanel({ tenantId, className }: { tenantId: string; className?: string }) {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [trend, setTrend] = useState<{ date: string; score: number }[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[] | null>(null);
  const [open, setOpen] = useState<'health' | 'feedback' | null>(null);

  useEffect(() => {
    loadScoredTenants(tenantId)
      .then((rows) => setHealth(rows[0]?.health ?? null))
      .catch(() => setHealthError(true));
    loadHealthTrend(tenantId)
      .then(setTrend)
      .catch(() => setTrend([]));
    (supabase as any)
      .from('tenant_feedback')
      .select('id, category, message, submitter_name, submitter_email, status, rating, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .then(({ data }: { data: FeedbackItem[] | null }) => setFeedback(data ?? []));
  }, [tenantId]);

  const isSample = feedback !== null && feedback.length === 0;
  const shown = isSample ? MOCK_FEEDBACK : feedback ?? [];
  const openCount = shown.filter((f) => f.status === 'open').length;
  const rated = shown.filter((f) => f.rating !== null);
  const average = rated.length ? rated.reduce((sum, f) => sum + (f.rating ?? 0), 0) / rated.length : null;
  const ratingPoints = ratingTrend(shown);


  return (
    <>
      {/* Two graphs, no words: the score ring, and the star rating with how
          the stars spread. Each opens its dialog. */}
      <section className={cn('grid grid-cols-2 gap-1', className)}>
        <button
          type="button"
          className={TILE}
          onClick={() => setOpen('health')}
          disabled={!health}
          title={health ? `Health ${health.score} · ${BAND[health.band].label}, over the last 8 weeks` : 'Health'}
          aria-label="Health score"
        >
          <span className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums leading-none text-foreground">{health ? health.score : healthError ? '—' : '…'}</span>
            <span className="text-[13px] text-muted-foreground">/ 100</span>
          </span>
          <span className="mt-2 block h-16">
            {health && trend.length > 1 && (
              <TrendLine id="trend-health" points={trend.map((p) => ({ date: p.date, value: p.score }))} color="hsl(var(--primary))" domain={[0, 100]} />
            )}
          </span>
          <span className="mt-auto pt-2 text-[11px] text-muted-foreground">
            Health{health && <span className={BAND[health.band].text}> · {BAND[health.band].label}</span>}
          </span>
        </button>

        <button
          type="button"
          className={TILE}
          onClick={() => setOpen('feedback')}
          disabled={shown.length === 0}
          title={average !== null ? `Feedback ${average.toFixed(1)} from ${rated.length} ratings` : 'Feedback'}
          aria-label="Feedback"
        >
          <span className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums leading-none text-foreground">{average !== null ? average.toFixed(1) : '—'}</span>
            <Stars value={average ?? 0} className="text-[13px]" />
          </span>
          <span className="mt-2 block h-16">
            {ratingPoints.length > 1 && <TrendLine id="trend-rating" points={ratingPoints} color="hsl(var(--primary))" domain={[1, 5]} />}
          </span>
          <span className="mt-auto pt-2 text-[11px] text-muted-foreground">
            Feedback · {shown.length} {shown.length === 1 ? 'reply' : 'replies'}
            {openCount > 0 && <span className="text-warning"> · {openCount} open</span>}
          </span>
        </button>
      </section>

      <Dialog open={open === 'health'} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-lg rounded-3xl p-7">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Health score
              {health && <span className={cn('tabular-nums', BAND[health.band].text)}>{health.score}</span>}
            </DialogTitle>
            <DialogDescription>Worked out from logins, bookings, payment and setup, the same way Customer Health does.</DialogDescription>
          </DialogHeader>
          {health && (
            <div className="space-y-4 text-sm">
              <HealthBreakdown health={health} />
              <Link href="/admin/customer-management?section=health" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                All companies&rsquo; health <ArrowRight className="size-3.5" />
              </Link>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'feedback'} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-0 rounded-3xl p-7">
          <DialogHeader className="mb-4">
            <DialogTitle>Feedback</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {average !== null && (
                  <span className="inline-flex items-center gap-1.5">
                    <Stars value={average} className="text-[13px]" />
                    <span className="font-medium text-foreground">{average.toFixed(1)}</span>
                    from {rated.length} {rated.length === 1 ? 'rating' : 'ratings'}
                  </span>
                )}
                <span>
                  {shown.length} sent{openCount > 0 && <span className="text-warning"> · {openCount} open</span>}
                </span>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1">
            {shown.map((f) => (
              <FeedbackCard key={f.id} f={f} />
            ))}
          </div>
          <Link href="/admin/feedbacks" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            All companies&rsquo; feedback <ArrowRight className="size-3.5" />
          </Link>
        </DialogContent>
      </Dialog>
    </>
  );
}
