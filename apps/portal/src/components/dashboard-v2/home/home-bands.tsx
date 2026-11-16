'use client';

/**
 * The v2 dashboard body: the revenue line chart, with the feature card at the
 * far right whenever there is a feature to show.
 *
 * TENANT ISOLATION: this component issues no query of its own. The revenue
 * chart's hook filters by tenant; `usePortalAnnouncements` reads through
 * `get_portal_announcements`, which resolves the caller's own app user and
 * tenant server-side and returns only what is targeted at that tenant (the
 * dashboard layout already mounts it, so this is the same cache entry).
 */

import { useTenant } from '@/contexts/TenantContext';
import { usePortalAnnouncements } from '@/hooks/use-portal-announcements';
import { FEATURE_CARD_UI } from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth-store';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { RevenueLineCard } from './revenue-line-card';
import { TraxBriefCard } from './admin-cards';
import { RequestsCard } from './requests-card';
import { TodoCard } from './todo-card';
import { SortableCards } from './sortable-cards';

import { BusyDaysCard } from './busy-days-card';
import { BookingSourcesCard } from './booking-sources-card';
import { WebinarPolls } from './webinar-poll-card';
import { buildDemoBookingSources, buildDemoBusyDays } from './mock';
import { useBookingSources, useBusyDays } from '@/hooks/use-dashboard-insights';
import { useSkeletonLoading } from '@/hooks/use-skeleton-loading';
import { useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { FeatureAnnouncementDeck } from '@/components/announcements/feature-announcement-deck';
import { useDeskFeaturePresence } from '@/components/announcements/use-desk-feature-presence';

/**
 * EVERYTHING BELOW THE REVENUE ROW REMOVED (Sep 27 2026), at Ghulam's request:
 * the "Today" band (Attention required now, Money today) and the "This week"
 * band (fleet week, pickups ready). The dashboard is now the revenue chart and
 * the feature card only. Their components and hooks are left in place,
 * unmounted — see git history for how they were wired.
 */
/**
 * The feature card on a phone: a slim strip, not a 230px card (boss, Nov 2026),
 * set from here because its classes live in the announcements contract, which
 * must stay byte-identical with the admin app's copy. Text on the left, one
 * line each, the art fitted into the right-hand side.
 */
const PHONE_STRIP =
  'max-md:order-first max-md:!h-[108px] ' +
  'max-md:[&_[data-feature-slide]>div]:p-4 max-md:[&_[data-feature-slide]>div]:pr-[38%] ' +
  'max-md:[&_h3]:max-w-none max-md:[&_h3]:text-[19px] max-md:[&_h3]:font-extrabold max-md:[&_h3]:leading-[1.15] max-md:[&_h3]:line-clamp-1 max-md:[&_h3_br]:hidden ' +
  'max-md:[&_img]:object-contain max-md:[&_img]:object-right';

export function HomeBands() {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const { canView } = useManagerPermissions();
  const { status: announcementsStatus, features } = usePortalAnnouncements();
  // Real figures by default. Sample busy days and booking sources were ON BY
  // DEFAULT from Sep 27 2026 for the design review, with a note to flip this
  // back before v2 widened. It widened (self-serve signups land on v2), and
  // QA sheet 15.4 found a new operator's dashboard showing an invented 18-car
  // fleet. `?demo-insights=1` still shows the samples for design work.
  const demoInsights = useSearchParams()?.get('demo-insights') === '1';
  const busyQ = useBusyDays();
  const sourcesQ = useBookingSources();
  const demoBusy = useMemo(() => buildDemoBusyDays(), []);
  const demoSources = useMemo(() => buildDemoBookingSources(), []);
  const busy = demoInsights ? demoBusy : busyQ.data ?? null;
  const busyLoading = useSkeletonLoading(!demoInsights && busyQ.isLoading);
  const sources = demoInsights ? demoSources : sourcesQ.data ?? null;
  const sourcesLoading = useSkeletonLoading(!demoInsights && sourcesQ.isLoading);

  const insightsRef = useRef<HTMLElement>(null);
  const deskRowRef = useRef<HTMLDivElement>(null);


  const deskFeature = useDeskFeaturePresence(
    { status: announcementsStatus, features },
    tenant?.id,
    appUser?.id,
  );

  return (
    /* The first screen, then the scroll (Sep 27 2026).
       At lg+ this root is exactly the viewport's worth of <main> (flex-1 of a
       bounded column), and the first block is `h-full` of it: the revenue row
       keeps its natural height and the three cards take the rest, just as
       before. Everything after that block sits below the fold and is reached
       by scrolling <main>. */
    <div className="relative lg:min-h-0 lg:flex-1">
    {/* Ends 70px short of the screen (Sep 27 2026) so the top edge of the
        Busy days card peeks in: the page visibly continues below the cards. */}
    {/* No fixed height any more (boss, Nov 2026): Requests and To do take only
        the room their rows need, so the column is as tall as its content. */}
    <div className="flex flex-col gap-4 md:gap-[30px]">
      {/* Revenue line chart on the left, the feature card at the far right.
          With no feature the chart takes the whole row. */}
      <section aria-label="On your desk" data-desk-band="" className="shrink-0 md:-mt-[15px]">
        {/* The chart takes whatever the feature card leaves. At lg+ the
            card is a fixed 320 × 240 card; below that it runs full width. */}
        {/* Phones (boss, Nov 2026): no swipeable pair. The feature card comes
            FIRST, as a slim strip across the top (PHONE_STRIP), and the chart
            follows straight under it. */}
        <div ref={deskRowRef} className="flex flex-col items-stretch gap-3 md:gap-5 lg:flex-row">
          {/* `lg:` only: below lg the row is a COLUMN, where flex-1 (basis 0)
              squashed the card to its text and the chart drew at 0px. */}
          <RevenueLineCard className="lg:flex-1" />
          {deskFeature === 'deck' && (
            <FeatureAnnouncementDeck features={features} variant="accent" className={cn('shrink-0 lg:mt-[10px] lg:w-[320px]', PHONE_STRIP)} />
          )}
          {deskFeature === 'skeleton' && (
            <div
              aria-hidden="true"
              data-feature-deck-skeleton=""
              className={cn(FEATURE_CARD_UI.root, 'shrink-0 animate-pulse motion-reduce:animate-none lg:mt-[10px] lg:w-[320px]', PHONE_STRIP)}
            />
          )}
        </div>
      </section>

      {/* The three questions after "how is the business doing" (Sep 27 2026):
          what does Trax make of today, who is waiting on me, and my own to-do list. See admin-cards.tsx. */}
      {/* Rearrangeable (Sep 27 2026): each card has a grip at its top centre,
          and this user's order is remembered in the browser. */}
      {/* Requests and To do are as tall as their rows (three at most, then they
          scroll); the Trax card stretches to the row they make. */}
      <section aria-label="Operations">
        <SortableCards
          storageKey={`dashboard-v2:ops-order:${appUser?.id ?? 'anon'}`}
          className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-3 md:gap-5"
          items={[
            {
              id: 'trax',
              label: 'Your business today',
              node: (
                <TraxBriefCard
                  canSeeRentals={canView('rentals')}
                  canSeePayments={canView('payments')}
                  canSeeFleet={canView('vehicles')}
                  canSeeRequests={canView('pending_bookings')}
                />
              ),
            },
            ...(canView('rentals') ? [{ id: 'requests', label: 'Requests', node: <RequestsCard />, fit: true }] : []),
            { id: 'todo', label: 'To do', node: <TodoCard />, fit: true },
          ]}
        />
      </section>
    </div>

      {/* ── Below the fold ─────────────────────────────────────────────────
          The busy-days heatmap (two thirds) beside where bookings come from. */}
      <section
        ref={insightsRef}
        aria-label="Insights"
        className="mt-6 grid grid-cols-1 items-stretch gap-4 pb-4 md:mt-[45px] md:gap-5 lg:mt-[65px] lg:grid-cols-3"
      >
        <BusyDaysCard data={busy} isLoading={busyLoading} />
        <BookingSourcesCard data={sources} isLoading={sourcesLoading} />
      </section>

      {/* ── The very bottom: live webinar polls (renders nothing when none) ── */}
      <section aria-label="Webinar polls" className="pb-4 empty:hidden">
        <WebinarPolls />
      </section>
    </div>
  );
}
