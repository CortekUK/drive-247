'use client';

/**
 * The Tour button at the top of a tab, and the menu of that tab's topics.
 *
 * The menu lists the topics in learning order, each with where this person
 * got to (not started, in progress, done). Continue picks up where they left
 * off; Start from the beginning clears this tab's progress and opens topic 1.
 * Progress lives in `lib/tab-tours` and follows the person between devices.
 *
 * Northwind (v2) only: the button renders nothing for any other company, so
 * the shared list pages it sits on look as they always did for them.
 */

import { Check, Compass, Lock, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/stores/auth-store';
import { useV2 } from '@/lib/v2-context';
import { useIsLean } from '@/lib/lean-context';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui-v2/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui-v2/tooltip';
import {
  TAB_TOUR_PROGRESS_EVENT,
  continueTarget,
  getTabTour,
  readEmptyTabs,
  readSampleIds,
  readTabTourProgress,
  resetTabTourProgress,
  runTabTour,
  topicAvailable,
  topicStatus,
  topicStepCount,
  type TabTourId,
  type TabTourProgress,
  type TabTourTopic,
} from '@/lib/tab-tours';

export interface TabTourButtonProps {
  tour: TabTourId;
  /** No longer changes anything: every header control is 32px. Kept for the call sites. */
  size?: 'h-9' | 'h-10';
  className?: string;
}

export function TabTourButton({ tour: tourId, className }: TabTourButtonProps) {
  const { appUser } = useAuth();
  const hasV2Chrome = useV2('chrome');
  const isCanary = useIsLean();
  const appUserId = appUser?.id ?? null;
  const tour = getTabTour(tourId);

  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<TabTourProgress>({ topics: {} });
  // What is on the page decides which topics can run (a car to open, say).
  const [page, setPage] = useState(() => ({ sampleIds: readSampleIds(), emptyTabs: readEmptyTabs() }));

  const refresh = useCallback(() => {
    setProgress(readTabTourProgress(tourId, appUserId));
    setPage({ sampleIds: readSampleIds(), emptyTabs: readEmptyTabs() });
  }, [tourId, appUserId]);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(TAB_TOUR_PROGRESS_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(TAB_TOUR_PROGRESS_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, [refresh]);

  // While the menu is open, re-read the page as it loads, so a topic unlocks once its record shows up.
  useEffect(() => {
    if (!open) return;
    refresh();
    if (typeof MutationObserver === 'undefined') return;
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        setPage((prev) => {
          const next = { sampleIds: readSampleIds(), emptyTabs: readEmptyTabs() };
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, refresh]);

  const available = useCallback((t: TabTourTopic) => topicAvailable(t, page), [page]);
  const counts = useMemo(() => {
    const topics = tour?.topics ?? [];
    const done = topics.filter((t) => topicStatus(progress, t.id) === 'done').length;
    return { done, total: topics.length };
  }, [tour, progress]);
  const target = tour ? continueTarget(tour, progress, available) : null;
  const started = Object.keys(progress.topics).length > 0;

  // Same slug-keyed canary gate as the rest of the tours. Fails closed.
  if (!isCanary || !hasV2Chrome || !tour || tour.topics.length === 0) return null;

  const start = (topicId: string, stepId?: string) => {
    setOpen(false);
    // Let the menu close before the card measures the page.
    requestAnimationFrame(() => runTabTour(tourId, topicId, stepId));
  };
  const restart = () => {
    resetTabTourProgress(tourId, appUserId);
    const first = tour.topics.find(available);
    if (first) start(first.id);
  };
  const targetTopic = target ? tour.topics.find((t) => t.id === target.topicId) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-tour="take-tab-tour"
              aria-label={`${tour.label} tour`}
              className={cn(
                'v2-phone-hit',
                'relative inline-flex size-8 shrink-0 items-center justify-center rounded-full border',
                'transition-colors focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-ring focus-visible:ring-offset-2',
                'border-primary/30 bg-primary/5 text-primary hover:border-primary/50 hover:bg-primary/10 dark:bg-primary/10',
                'dark:border-[hsl(var(--v2-link,var(--primary))_/_0.3)] dark:text-[hsl(var(--v2-link,var(--primary)))] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:hover:border-[hsl(var(--v2-link,var(--primary))_/_0.5)] dark:hover:text-[hsl(var(--v2-link,var(--primary)))]',
                className,
              )}
            >
              <Compass className="size-3.5" aria-hidden />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {tour.label} tour
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        data-tab-tour-menu=""
        // Focus going back to the button would open its tooltip over the first card.
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden p-0"
        style={{ maxHeight: 'min(560px, calc(var(--radix-popover-content-available-height, 100dvh) - 8px))' }}
      >
        <div className="shrink-0 px-4 pb-3 pt-4">
          <p className="text-[15px] font-medium text-foreground">{tour.label} tour</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
            Short topics you can take one at a time. I remember where you got to.
          </p>
          <div className="mt-3 flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${counts.total ? (counts.done / counts.total) * 100 : 0}%` }}
              />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {counts.done} of {counts.total} done
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {targetTopic ? (
              <button
                type="button"
                data-tab-tour-continue=""
                onClick={() => start(targetTopic.id, target?.stepId)}
                className="inline-flex h-9 min-w-0 max-w-full items-center rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 max-sm:h-10"
              >
                <span className="truncate">{started ? `Continue: ${targetTopic.title}` : `Start: ${targetTopic.title}`}</span>
              </button>
            ) : (
              <p className="text-[13px] text-muted-foreground">You have taken every topic here.</p>
            )}
            {started && (
              <button
                type="button"
                data-tab-tour-restart=""
                onClick={restart}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground/10 px-3.5 text-[13px] font-medium text-foreground hover:bg-foreground/5 max-sm:h-10"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Start from the beginning
              </button>
            )}
          </div>
        </div>
        <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-foreground/10 py-1.5" data-tab-tour-topics="">
          {tour.topics.map((topic, i) => {
            const status = topicStatus(progress, topic.id);
            const can = available(topic);
            return (
              <li key={topic.id}>
                <button
                  type="button"
                  disabled={!can}
                  data-topic={topic.id}
                  data-status={can ? status : 'unavailable'}
                  onClick={() => start(topic.id, status === 'in-progress' ? progress.topics[topic.id]?.at : undefined)}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-foreground/[0.04] disabled:cursor-default disabled:hover:bg-transparent max-sm:py-3"
                >
                  <StatusMark status={can ? status : 'unavailable'} n={i + 1} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13.5px] font-medium leading-snug', can ? 'text-foreground' : 'text-muted-foreground')}>
                      {topic.title}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
                      {can ? topic.summary : topic.unavailableText ?? 'Not available yet.'}
                    </span>
                  </span>
                  <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                    {!can ? '' : status === 'done' ? 'Done' : status === 'in-progress' ? 'In progress' : `${topicStepCount(topic, page)} steps`}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </PopoverContent>
    </Popover>
  );
}

function StatusMark({ status, n }: { status: 'not-started' | 'in-progress' | 'done' | 'unavailable'; n: number }) {
  if (status === 'done') {
    return (
      <span className="mt-px inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-label="Done">
        <Check className="size-3.5" strokeWidth={2.6} />
      </span>
    );
  }
  if (status === 'unavailable') {
    return (
      <span className="mt-px inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border border-foreground/10 text-muted-foreground" aria-label="Not available yet">
        <Lock className="size-3" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'mt-px inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums',
        status === 'in-progress' ? 'border-primary bg-primary/10 text-primary' : 'border-foreground/15 text-muted-foreground',
      )}
      aria-label={status === 'in-progress' ? 'In progress' : 'Not started'}
    >
      {n}
    </span>
  );
}
