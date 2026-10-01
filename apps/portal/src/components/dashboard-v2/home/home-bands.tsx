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
import { PHONE_CAROUSEL, PageDots } from './phone-carousel';
import { BusyDaysCard } from './busy-days-card';
import { BookingSourcesCard } from './booking-sources-card';
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
export function HomeBands() {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const { canView } = useManagerPermissions();
  const { status: announcementsStatus, features } = usePortalAnnouncements();
  // PREVIEW (Sep 27 2026): sample busy days and booking sources are ON BY
  // DEFAULT while the design is reviewed (northwind has 8 cars and 17 rentals
  // in the window, too few to judge a heatmap by); `?demo-insights=0` shows
  // the real figures. Flip the default back (`=== '1'`) before this widens.
  const demoInsights = useSearchParams()?.get('demo-insights') !== '0';
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
    <div className="flex flex-col gap-[30px] lg:h-[calc(100%-70px)]">
      {/* Revenue line chart on the left, the feature card at the far right.
          With no feature the chart takes the whole row. */}
      <section aria-label="On your desk" data-desk-band="" className={cn('shrink-0 md:-mt-[15px]', PHONE_CAROUSEL)}>
        {/* The chart takes whatever the feature card leaves. At lg+ the
            card is a fixed 320 × 240 card; below that it runs full width.
            On a phone the two are a swipeable pair (PHONE_CAROUSEL, set on the
            section so this row's own classes stay exactly as they were). */}
        <div ref={deskRowRef} className="flex flex-col items-stretch gap-5 lg:flex-row">
          <RevenueLineCard className="flex-1" />
          {deskFeature === 'deck' && (
            <FeatureAnnouncementDeck features={features} variant="accent" className="shrink-0 lg:mt-[10px] lg:w-[320px]" />
          )}
          {deskFeature === 'skeleton' && (
            <div
              aria-hidden="true"
              data-feature-deck-skeleton=""
              className={cn(FEATURE_CARD_UI.root, 'shrink-0 animate-pulse motion-reduce:animate-none lg:mt-[10px] lg:w-[320px]')}
            />
          )}
        </div>
        {deskFeature === 'deck' && <PageDots scroller={deskRowRef} count={2} />}
      </section>

      {/* The three questions after "how is the business doing" (Sep 27 2026):
          what does Trax make of today, who is waiting on me, and my own to-do list. See admin-cards.tsx. */}
      {/* Rearrangeable (Sep 27 2026): each card has a grip at its top centre,
          and this user's order is remembered in the browser. */}
      <section aria-label="Operations" className="lg:-mb-[35px] lg:min-h-0 lg:flex-1">
        <SortableCards
          storageKey={`dashboard-v2:ops-order:${appUser?.id ?? 'anon'}`}
          className="grid h-full grid-cols-1 items-stretch gap-5 md:grid-cols-3"
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
            ...(canView('rentals') ? [{ id: 'requests', label: 'Requests', node: <RequestsCard /> }] : []),
            { id: 'todo', label: 'To do', node: <TodoCard /> },
          ]}
        />
      </section>
    </div>

      {/* ── Below the fold ─────────────────────────────────────────────────
          The busy-days heatmap (two thirds) beside where bookings come from. */}
      <section
        ref={insightsRef}
        aria-label="Insights"
        className="mt-[45px] grid grid-cols-1 items-stretch gap-5 pb-4 lg:mt-[65px] lg:grid-cols-3"
      >
        <BusyDaysCard data={busy} isLoading={busyLoading} />
        <BookingSourcesCard data={sources} isLoading={sourcesLoading} />
      </section>
    </div>
  );
}
