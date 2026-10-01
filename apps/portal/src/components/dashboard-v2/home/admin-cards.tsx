'use client';

/**
 * The three cards under the revenue chart (Sep 27 2026). Each answers the
 * question an operator asks next, after "how is the business doing":
 *
 *   TraxBriefCard    — what does Trax make of the business today?
 *   HandoversCard    — is everything ready for today?
 *   FleetNowCard     — where are my cars?
 *
 * One device runs through all three: a big figure that answers the card's
 * question on its own, one piece of shape under it (a list with a severity
 * rule, a segmented readiness bar, a stacked fleet bar), then only the rows
 * that matter. Flat — no shadows, colour only where something is wrong.
 *
 * DATA: no query of its own. Every hook used here already exists, filters by
 * `tenant_id` and is `enabled` only once a tenant is resolved (V2_PLAN §5):
 * useTodayOperations, useFleetWeek, and useBusinessBrief (which composes
 * the dashboard's KPI, deposit and booking-request hooks).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowUpRight, Check, CornerDownRight, MoveDownLeft, MoveUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTodayOperations } from '@/hooks/use-today-operations';
import { useFleetWeek, type DayUse, type FleetCar, type Pickup, type ReadyCheck } from '@/hooks/use-fleet-week';
import { useAuth } from '@/stores/auth-store';
import { useBusinessBrief, type BusinessBrief } from '@/hooks/use-business-brief';
import { AutoSkeleton } from '@/components/skeleton-v2/auto-skeleton';
import { useSkeletonLoading } from '@/hooks/use-skeleton-loading';
import { skeletonFaker, skeletonRows } from '@/lib/skeleton-data';
import { TraxMark } from '@/components/trax/trax-greeting';
import { useTraxOptional } from '@/components/trax/trax-provider';
import { useTraxSupportOptional } from '@/components/trax/support/trax-support-context';
import { Caret, Emphasis, useTyped } from '@/components/shared/layout/search-trax-brief';
import { CardGrip } from './sortable-cards';
import { Eyebrow } from './ui';

// ── Skeleton placeholders ──────────────────────────────────────────────────
// Rendered through the real cards while their hooks load, so <AutoSkeleton>
// draws the loaded shape. Only their lengths are ever seen.

const SKELETON_BRIEF: BusinessBrief = (() => {
  const f = skeletonFaker(0);
  return {
    headline: `${f.text(4, 5)} ${f.text(3, 4)}`,
    points: skeletonRows(3, (p) => `${p.text(3, 4)} ${p.text(2, 3)}`),
    suggestions: skeletonRows(2, (p) => ({ label: p.text(2, 3), question: '' })),
    question: '',
  };
})();

const SKELETON_PICKUPS: Pickup[] = skeletonRows(3, (f, i) => ({
  rentalId: f.id,
  rentalNumber: null,
  customerName: f.text(2, 2),
  vehicleName: f.text(2, 3),
  startDate: f.date(0),
  daysAway: 0,
  checks: [],
  missing: i === 0 ? [] : [f.pick(['signed', 'paid', 'approved'] as const)],
  ready: i === 0,
}));

const SKELETON_DAYS: DayUse[] = ['booked', 'booked', 'held', 'free', 'free', 'booked'];
const SKELETON_CARS: FleetCar[] = skeletonRows(6, (f, i) => ({
  id: f.id,
  name: f.text(2, 3),
  reg: f.word(6, 8),
  days: [SKELETON_DAYS[i]],
  freeDays: 0,
  flag: null,
  rank: 0,
}));

// ── Shared shell ────────────────────────────────────────────────────────────

function Shell({
  title,
  aside,
  footer,
  onFooter,
  loading = false,
  children,
}: {
  title: string;
  aside?: ReactNode;
  footer?: string;
  onFooter?: () => void;
  /** Placeholder data is showing: draw bones over the body. */
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[387px] flex-col overflow-hidden rounded-2xl lg:min-h-0 border border-[var(--pv-line)] bg-[var(--pv-paper)]">
      <header className="flex items-baseline justify-between gap-3 px-6 pt-5">
        <Eyebrow>{title}</Eyebrow>
        {aside && <span className="text-[11px] font-medium text-[var(--pv-ink-3)]">{aside}</span>}
      </header>
      {/* One stretched grid cell, so the AutoSkeleton wrapper (a plain block)
          still fills the body and `mt-auto` rows keep sitting at the bottom. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-y-auto px-6 pb-5 pt-4">
        <AutoSkeleton loading={loading} className="flex min-h-full flex-col">
          {children}
        </AutoSkeleton>
      </div>
      {footer && (
        <button
          type="button"
          disabled={loading}
          onClick={onFooter}
          className="group flex items-center justify-between border-t border-[var(--pv-line)] px-6 py-3.5 text-[12px] font-medium text-[var(--pv-ink-2)] transition-colors hover:bg-[var(--pv-wash)]"
        >
          {footer}
          <ArrowRight className="size-3.5 text-[var(--pv-ink-3)] transition-transform group-hover:translate-x-0.5" />
        </button>
      )}
    </div>
  );
}

/** The card's answer, big. */
function Hero({ value, label, tone }: { value: ReactNode; label: string; tone?: 'late' | 'clear' }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span
        className={cn(
          'text-[44px] font-semibold leading-none tracking-[-0.035em] tabular-nums',
          tone === 'late' ? 'text-[var(--pv-late)]' : 'text-[var(--pv-ink)]'
        )}
      >
        {value}
      </span>
      <span className="text-[13px] text-[var(--pv-ink-3)]">{label}</span>
    </div>
  );
}

function AllClear({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-full bg-[var(--pv-clear-bg)] text-[var(--pv-clear)]">
        <Check className="size-5" strokeWidth={2.5} />
      </span>
      <div>
        <p className="text-[20px] font-semibold tracking-[-0.02em] text-[var(--pv-ink)]">{title}</p>
        <p className="mt-1 text-[12px] text-[var(--pv-ink-3)]">{meta}</p>
      </div>
    </div>
  );
}

// ── 1 · Trax ────────────────────────────────────────────────────────────────

/**
 * Trax's read on the whole business, in the same shape as the ⌘K search brief:
 * a verdict typed out in accent, the points under it, follow-ups, and a way to
 * carry the conversation on in Trax. Replaced the "Needs you" list (Sep 27
 * 2026): what that card listed are now the brief's first points.
 *
 * The handoff mirrors global-search-v2.tsx: open the panel on a fresh thread,
 * and send the question once the conversation is ready to take it.
 */
export function TraxBriefCard(perms: {
  canSeeRentals: boolean;
  canSeePayments: boolean;
  canSeeFleet: boolean;
  canSeeRequests: boolean;
}) {
  const { appUser } = useAuth();
  const firstName = appUser?.name?.trim().split(/\s+/)[0] || null;
  const { brief: loadedBrief, isLoading: briefLoading } = useBusinessBrief({ ...perms, firstName });
  const isLoading = useSkeletonLoading(briefLoading);
  const brief = isLoading ? SKELETON_BRIEF : loadedBrief;
  const trax = useTraxOptional();
  const traxSupport = useTraxSupportOptional();
  // The placeholder is laid out whole, not typed: nothing types until the real
  // verdict arrives.
  const typedOut = useTyped(isLoading ? '' : brief?.headline ?? '');
  const shown = isLoading ? brief?.headline ?? '' : typedOut;
  const typed = !!brief && (isLoading || typedOut.length >= brief.headline.length);

  // How many points fit whole in the space above the chips.
  const fitRef = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(99);
  useEffect(() => {
    const box = fitRef.current;
    if (!box) return;
    const measure = () => {
      const items = Array.from(box.querySelectorAll('li')) as HTMLElement[];
      let n = 0;
      for (const li of items) {
        if (li.offsetTop + li.offsetHeight <= box.clientHeight + 1) n += 1;
        else break;
      }
      setFits(n);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [typed, brief?.points.length, isLoading]);

  const [handoff, setHandoff] = useState<string | null>(null);
  const ask = (question: string) => {
    if (traxSupport?.support.messages.length) traxSupport.startNew();
    trax?.openSheet();
    setHandoff(question);
  };
  const chat = traxSupport?.support;
  useEffect(() => {
    if (!handoff || !chat || chat.isLoading) return;
    void chat.sendMessage(handoff);
    setHandoff(null);
  }, [handoff, chat]);
  // If the panel never becomes ready, drop the ask rather than send it later out of the blue.
  useEffect(() => {
    if (!handoff) return;
    const t = window.setTimeout(() => setHandoff(null), 15_000);
    return () => window.clearTimeout(t);
  }, [handoff]);

  const canTalk = !!trax && !!traxSupport;
  // The whole card is the way into Trax, carrying the brief's own question.
  const go = () => {
    if (canTalk && brief && !isLoading) ask(brief.question);
  };

  return (
    <div
      role={canTalk ? 'button' : undefined}
      tabIndex={canTalk && !isLoading ? 0 : undefined}
      aria-label={canTalk ? 'Continue with Trax' : undefined}
      onClick={go}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          go();
        }
      }}
      className={cn(
        'group relative flex min-h-[387px] flex-col overflow-hidden rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] outline-none transition-colors lg:min-h-0',
        'border-[var(--pv-accent-30)]',
        canTalk && 'cursor-pointer hover:border-[var(--pv-accent)] focus-visible:border-[var(--pv-accent)]'
      )}
    >
      {/* Always on (Sep 27 2026): the ⌘K search panel's gradient (to-br,
          20% → 10% → 25% of the accent) is this card's own surface. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom right, color-mix(in srgb, var(--pv-accent) 20%, transparent), color-mix(in srgb, var(--pv-accent) 10%, transparent), color-mix(in srgb, var(--pv-accent) 25%, transparent))',
        }}
      />

      <header className="relative flex items-center gap-2 px-6 pt-5">
        <TraxMark size="xs" animated={isLoading || !typed} />
        <Eyebrow>Your business today</Eyebrow>
        <span className="-mr-1.5 ml-auto flex items-center gap-1">
          <CardGrip />
          {canTalk && (
            <ArrowUpRight
              aria-hidden
              className="size-4 stroke-[2.5] text-[var(--pv-accent-ink)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          )}
        </span>
      </header>

      {/* Sized to fit, never scrolled: as many points as fit, and the follow-ups
          pinned to the bottom edge. */}
      {/* One stretched grid cell, so the AutoSkeleton wrapper (a plain block)
          still hands the full height down to the fitting list. */}
      <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden px-6 pb-5 pt-3">
        <AutoSkeleton loading={isLoading} className="flex h-full min-h-0 flex-col">
        {!brief ? (
          <p className="text-[13px] text-[var(--pv-ink-3)]">Looking over the business…</p>
        ) : (
          <div aria-live="polite" className="flex min-h-0 flex-1 flex-col">
            <p className="text-[17px] font-extrabold leading-snug tracking-[-0.02em] text-[var(--pv-accent-ink)]">
              {shown}
              {!typed && <Caret />}
            </p>
            {/* As many whole points as the card has room for: the rest are
                hidden, never cut in half, and nothing scrolls. */}
            <div ref={fitRef} className="relative mt-3 min-h-0 flex-1 overflow-hidden">
            {typed && brief.points.length > 0 && (
              <ul className="space-y-2">
                {brief.points.map((point, i) => (
                  <li
                    key={i}
                    style={{ animationDelay: `${i * 70}ms`, visibility: i < fits ? undefined : 'hidden' }}
                    className="flex animate-in fade-in-0 slide-in-from-bottom-2 gap-2.5 text-[13px] leading-snug text-[var(--pv-ink)] duration-200 ease-out fill-mode-both motion-reduce:animate-none"
                  >
                    <span className="mt-[6px] size-1.5 shrink-0 rounded-full bg-[var(--pv-accent)]" aria-hidden />
                    <span>
                      <Emphasis text={point} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            </div>
            {typed && canTalk && (
              <div className="flex animate-in flex-nowrap gap-1 pt-3 fade-in-0 duration-200 motion-reduce:animate-none max-md:-mx-6 max-md:overflow-x-auto max-md:px-6 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden max-md:[&>button]:shrink-0">
                {brief.suggestions.map((q) => (
                  <button
                    key={q.label}
                    title={q.question}
                    type="button"
                    onClick={(e) => {
                      // Its own question, not the card's.
                      e.stopPropagation();
                      ask(q.question);
                    }}
                    className="flex min-w-0 shrink items-center gap-1 whitespace-nowrap rounded-full border border-[var(--pv-accent-30)] bg-[var(--pv-paper)] px-2 py-1 text-left text-[11px] text-[var(--pv-ink-2)] transition-colors hover:border-[var(--pv-accent-30)] hover:bg-[var(--pv-accent-bg)] hover:text-[var(--pv-ink)]"
                  >
                    <CornerDownRight className="size-2.5 shrink-0 text-[var(--pv-accent-ink)]" aria-hidden />
                    <span className="truncate">{q.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        </AutoSkeleton>
      </div>

    </div>
  );
}

// ── 2 · Today's handovers ───────────────────────────────────────────────────

const CHECK_LABEL: Record<ReadyCheck, string> = {
  approved: 'Not approved',
  signed: 'Unsigned',
  id: 'ID not verified',
  paid: 'Unpaid',
};

export function HandoversCard() {
  const router = useRouter();
  const week = useFleetWeek();
  const { returns: loadedReturns, isLoading: opsLoading } = useTodayOperations();
  const loading = useSkeletonLoading(week.isLoading || opsLoading);
  const pickups = loading ? SKELETON_PICKUPS : week.pickups;
  // Only its length is read, so the placeholder is the pickups again.
  const returns = loading ? SKELETON_PICKUPS.slice(0, 2) : loadedReturns;

  // Today's pickups, plus any from earlier this week that never went out.
  const today = pickups.filter((p) => p.daysAway <= 0);
  const ready = today.filter((p) => p.ready).length;
  const blocked = today.filter((p) => !p.ready);

  return (
    <Shell
      title="Today's handovers"
      aside={!loading && (today.length || returns.length) ? `${today.length} out · ${returns.length} back` : undefined}
      footer="Open the diary"
      onFooter={() => router.push('/rentals')}
      loading={loading}
    >
      {today.length === 0 ? (
        <AllClear
          title="No cars going out"
          meta={returns.length ? `${returns.length} coming back today.` : 'Nothing on the diary today.'}
        />
      ) : (
        <>
          <Hero
            value={
              <>
                {ready}
                <span className="text-[var(--pv-ink-3)]">/{today.length}</span>
              </>
            }
            label="ready to go"
          />

          {/* One segment per pickup: filled when it is ready to drive away. */}
          <div className="mt-4 flex h-2 gap-1" aria-hidden="true">
            {[...today]
              .sort((a, b) => Number(b.ready) - Number(a.ready))
              .map((p) => (
                <span
                  key={p.rentalId}
                  className="flex-1 rounded-full"
                  style={{ background: p.ready ? 'var(--pv-clear)' : 'var(--pv-late)' }}
                />
              ))}
          </div>

          <ul className="mt-4 space-y-1">
            {(blocked.length ? blocked : today).slice(0, 3).map((p) => (
              <li key={p.rentalId}>
                <button
                  type="button"
                  onClick={() => router.push(`/rentals/${p.rentalId}`)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--pv-wash)]"
                >
                  <MoveUpRight className="size-3.5 shrink-0 text-[var(--pv-ink-3)]" strokeWidth={2.5} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[var(--pv-ink)]">{p.customerName}</span>
                    <span className="block truncate text-[11.5px] text-[var(--pv-ink-3)]">{p.vehicleName}</span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-[11.5px] font-medium',
                      p.ready ? 'text-[var(--pv-clear)]' : 'text-[var(--pv-late)]'
                    )}
                  >
                    {p.ready ? 'Ready' : p.missing.map((m) => CHECK_LABEL[m]).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {returns.length > 0 && (
            <p className="mt-auto flex items-center gap-2 pt-3 text-[12px] text-[var(--pv-ink-3)]">
              <MoveDownLeft className="size-3.5" strokeWidth={2.5} />
              {returns.length} coming back today
            </p>
          )}
        </>
      )}
    </Shell>
  );
}

// ── 3 · Fleet now ───────────────────────────────────────────────────────────

export function FleetNowCard() {
  const router = useRouter();
  const week = useFleetWeek();
  const loading = useSkeletonLoading(week.isLoading);
  const cars = loading ? SKELETON_CARS : week.cars;

  // Today is the first day of each car's week strip.
  let onRent = 0;
  let reserved = 0;
  let free = 0;
  for (const car of cars) {
    const d = car.days[0];
    if (d === 'booked' || d === 'late' || d === 'clash') onRent += 1;
    // 'held' = covered by a Pending rental: booked, not yet driven away.
    else if (d === 'held') reserved += 1;
    else free += 1;
  }
  const total = cars.length;
  const earning = total ? Math.round((onRent / total) * 100) : 0;
  const idleAllWeek = cars.filter((c) => c.freeDays === c.days.length).slice(0, 2);

  const parts = [
    { key: 'rent', label: 'On rent', n: onRent, fill: 'var(--pv-accent)' },
    { key: 'reserved', label: 'Reserved', n: reserved, fill: 'color-mix(in srgb, var(--pv-accent) 55%, var(--pv-paper))' },
    { key: 'free', label: 'Available', n: free, fill: 'color-mix(in srgb, var(--pv-accent) 18%, var(--pv-paper))' },
  ];

  return (
    <Shell
      title="Fleet now"
      aside={!loading && total ? `${total} ${total === 1 ? 'car' : 'cars'}` : undefined}
      footer="See the fleet"
      onFooter={() => router.push('/vehicles')}
      loading={loading}
    >
      {total === 0 ? (
        <AllClear title="No cars yet" meta="Add a vehicle to see your fleet here." />
      ) : (
        <>
          <Hero value={`${earning}%`} label="of the fleet earning" />

          {/* The whole fleet as one bar, split by what each car is doing today. */}
          <div className="mt-4 flex h-2 gap-1" aria-hidden="true">
            {parts
              .filter((p) => p.n)
              .map((p) => (
                <span key={p.key} className="rounded-full" style={{ flexGrow: p.n, flexBasis: 0, background: p.fill }} />
              ))}
          </div>

          <dl className="mt-5 grid grid-cols-3 gap-3">
            {parts.map((p) => (
              <div key={p.key}>
                <dt className="flex items-center gap-1.5 text-[11px] text-[var(--pv-ink-3)]">
                  <span className="size-1.5 rounded-full" style={{ background: p.fill }} />
                  {p.label}
                </dt>
                <dd className="mt-1 text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--pv-ink)]">
                  {p.n}
                </dd>
              </div>
            ))}
          </dl>

          {idleAllWeek.length > 0 && (
            <p className="mt-auto truncate pt-4 text-[12px] text-[var(--pv-ink-3)]">
              Free all week:{' '}
              <span className="font-medium text-[var(--pv-ink-2)]">{idleAllWeek.map((c) => c.name).join(', ')}</span>
            </p>
          )}
        </>
      )}
    </Shell>
  );
}
