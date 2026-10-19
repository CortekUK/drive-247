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
import Link from 'next/link';
import { ArrowRight, HeartPulse, ListChecks } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { loadScoredTenants } from '@/lib/customer-health/load';
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

/** A header button: icon, then a short value. */
function HeaderButton({ icon, children, onClick, title }: { icon: ReactNode; children: ReactNode; onClick: () => void; title: string }) {
  return (
    <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg px-3 text-[13px] [&_svg]:size-3.5" onClick={onClick} title={title}>
      {icon}
      {children}
    </Button>
  );
}

/* ------------------------------------------------------------------ main */

export function TenantInsights({ tenantId, companyName }: { tenantId: string; companyName: string }) {
  const [open, setOpen] = useState<'health' | 'onboarding' | null>(null);

  const [health, setHealth] = useState<HealthResult | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [firstRun, setFirstRun] = useState<FirstRun | null | undefined>(undefined);

  useEffect(() => {
    const db = supabase as any;
    loadScoredTenants(tenantId)
      .then((rows) => setHealth(rows[0]?.health ?? null))
      .catch(() => setHealthError(true));
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

  const onboardingIsSample = firstRun === null;
  const onboardingShown = onboardingIsSample ? MOCK_ONBOARDING : firstRun ?? null;

  return (
    <>
      <HeaderButton icon={<HeartPulse />} title="Health score" onClick={() => setOpen('health')}>
        {health ? (
          <span className={cn('tabular-nums', BAND[health.band].text)}>Health {health.score}</span>
        ) : (
          <span className="text-muted-foreground">Health {healthError ? '—' : '…'}</span>
        )}
      </HeaderButton>
      <Button
        size="icon"
        variant="outline"
        className="size-8 rounded-lg"
        onClick={() => setOpen('onboarding')}
        title={onboardingShown?.was_skipped ? 'Onboarding answers (skipped)' : 'Onboarding answers'}
        aria-label="Onboarding answers"
      >
        <ListChecks className="size-3.5" />
      </Button>

      {/* Health */}
      <Dialog open={open === 'health'} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-lg rounded-3xl p-7">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Health score
              {health && <span className={cn('tabular-nums', BAND[health.band].text)}>{health.score}</span>}
            </DialogTitle>
            <DialogDescription>Worked out from logins, bookings, payment and setup, the same way Customer Health does.</DialogDescription>
          </DialogHeader>
          {health ? (
            <div className="space-y-4 text-sm">
              <HealthBreakdown health={health} />
              <Link href="/admin/customer-management?section=health" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                All companies&rsquo; health <ArrowRight className="size-3.5" />
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{healthError ? 'The score could not be worked out right now.' : 'Working it out…'}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Onboarding answers */}
      <Dialog open={open === 'onboarding'} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-0 rounded-3xl p-7">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2">Onboarding answers {onboardingIsSample && <SampleTag />}</DialogTitle>
            <DialogDescription>
              {onboardingShown?.was_skipped
                ? `${companyName} skipped the first-run questions.`
                : onboardingShown?.completed_at
                  ? `What ${companyName} told us the first time they opened the portal, on ${day(onboardingShown.completed_at)}.`
                  : `${companyName} hasn't answered the first-run questions yet.`}
            </DialogDescription>
          </DialogHeader>
          {onboardingShown && !onboardingShown.was_skipped && (
            <dl className="-mx-1 min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto px-1">
              {/* Every question asked, in order, then any answer to a question
                  that has since been removed. */}
              {[
                ...questions.map((q) => ({ key: q.question_key, q })),
                ...Object.keys(onboardingShown.answers)
                  .filter((k) => !questions.some((q) => q.question_key === k))
                  .map((k) => ({ key: k, q: undefined })),
              ].map(({ key, q }) => (
                <div key={key} className="py-3">
                  <dt className="text-xs text-muted-foreground">{q?.prompt ?? key.replace(/_/g, ' ')}</dt>
                  <dd className="mt-0.5 text-sm font-medium text-foreground">{answerText(q, onboardingShown.answers[key])}</dd>
                </div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </>
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
 * The latest thing the company told us, their average star rating, and
 * All, which opens everything they sent in a dialog.
 */
export function FeedbackPanel({ tenantId, className }: { tenantId: string; className?: string }) {
  const [feedback, setFeedback] = useState<FeedbackItem[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    (supabase as any)
      .from('tenant_feedback')
      .select('id, category, message, submitter_name, submitter_email, status, rating, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .then(({ data }: { data: FeedbackItem[] | null }) => setFeedback(data ?? []));
  }, [tenantId]);

  const isSample = feedback !== null && feedback.length === 0;
  const shown = isSample ? MOCK_FEEDBACK : feedback ?? [];
  const open = shown.filter((f) => f.status === 'open').length;
  const rated = shown.filter((f) => f.rating !== null);
  const average = rated.length ? rated.reduce((sum, f) => sum + (f.rating ?? 0), 0) / rated.length : null;

  const summary = average !== null && (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={`Average of ${rated.length} ${rated.length === 1 ? 'rating' : 'ratings'}`}>
      <Stars value={average} className="text-[13px]" />
      <span className="font-medium tabular-nums text-foreground">{average.toFixed(1)}</span>
    </span>
  );

  // The whole card opens everything; the dialog sits outside it so a click
  // inside the dialog never bubbles back into the card and reopens it.
  return (
    <>
    <Panel
      title="Feedback"
      className={className}
      onOpen={shown.length > 0 ? () => setShowAll(true) : undefined}
      count={
        <>
          {summary}
          {shown.length > 0 && <span className="ml-auto text-xs font-medium text-muted-foreground">All {shown.length}</span>}
        </>
      }
    >
      {feedback === null ? (
        <p className="py-3 text-center text-sm text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">Nothing sent yet.</p>
      ) : (
        <FeedbackCard f={shown[0]} />
      )}
    </Panel>

      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent className="flex max-h-[85vh] max-w-xl flex-col gap-0 rounded-3xl p-7">
          <DialogHeader className="mb-4">
            <DialogTitle>Feedback</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {summary && (
                  <span className="inline-flex items-center gap-1.5">
                    {summary}
                    <span className="text-xs">from {rated.length} {rated.length === 1 ? 'rating' : 'ratings'}</span>
                  </span>
                )}
                <span className="text-xs">
                  {shown.length} sent{open > 0 && <span className="text-warning"> · {open} open</span>}
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
