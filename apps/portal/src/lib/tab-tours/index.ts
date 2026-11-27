/**
 * Tab tours: one deep tour per tab, launched from the Tour button on that tab.
 *
 * THE RULE (Ghulam, task guide 26 Nov 2026), which replaces the old one
 * ("about ten steps, surface only, no resume"):
 *
 *  - Every tab has a tour, and it teaches the tab properly: the list, adding
 *    one, the record page, every dialog, every status, what happens elsewhere.
 *  - A tour is split into TOPICS, in learning order. A topic is 4 to 8 steps
 *    about one subject, short enough to finish in a minute or two.
 *  - The Tour button opens a menu of the topics. Each shows not started, in
 *    progress or done, with Continue and Start from the beginning at the top.
 *  - Progress is saved per person, per topic, and follows them to another
 *    device (`lib/tour-sync.ts`). They can stop at any step and carry on.
 *  - Optional: a tab tour can always be closed.
 *  - One look: a tab tour is drawn by the quick tour's own card and pointer.
 *
 * A step is a `TourStep` (`lib/first-rental-tour.ts`), so the anchors, the
 * permission rules (`requires`) and the record routes (`routeFor`) work the
 * same way in both kinds of tour.
 */

import { noteTourWrite } from '@/lib/tour-sync';
import type { TourBuildContext, TourRequirement, TourStep } from '@/lib/first-rental-tour';
import { AGREEMENTS_TAB_TOUR } from './agreements';
import { BILLING_TAB_TOUR } from './billing';
import { DASHBOARD_TAB_TOUR } from './dashboard';
import { FINANCES_TAB_TOUR } from './finances';
import { INSIGHTS_TAB_TOUR } from './insights';
import { INSURANCES_TAB_TOUR } from './insurances';
import { INTEGRATIONS_TAB_TOUR } from './integrations';
import { AVAILABILITY_TAB_TOUR } from './availability';
import { CUSTOMERS_TAB_TOUR } from './customers';
import { PAYMENTS_TAB_TOUR } from './payments';
import { RENTALS_TAB_TOUR } from './rentals';
import { VEHICLES_TAB_TOUR } from './vehicles';

/** The tabs that have a tour. */
export const TAB_TOUR_IDS = [
  'dashboard',
  'rentals',
  'customers',
  'vehicles',
  'availability',
  'agreements',
  'finances',
  'payments',
  'insights',
  'insurances',
  'integrations',
  'billing',
] as const;

export type TabTourId = (typeof TAB_TOUR_IDS)[number];

export interface TabTourTopic {
  /** Stable, namespaced: `vehicles.photos`. Saved in progress. */
  id: string;
  /** In the topic menu and above the card's title. */
  title: string;
  /** One line under the title in the menu: what you will learn. */
  summary: string;
  steps: readonly TourStep[];
  /**
   * What the topic needs before it can run (a car to open, say). When it is
   * not met the menu shows the topic with `unavailableText` instead of a start.
   */
  requires?: Pick<TourRequirement, 'record' | 'tabHasData'>;
  /** Shown in the menu when `requires` is not met. */
  unavailableText?: string;
}

export interface TabTour {
  id: TabTourId;
  /** The tab's name, as the menu and the toast say it. */
  label: string;
  /**
   * Where this tour belongs. The Tour button renders on this path and on any
   * path beneath it, so it is present on both `/vehicles` and `/vehicles/<id>`.
   */
  homeRoute: string;
  /** Said when a topic has nothing on screen to point at for this user. */
  emptyMessage: string;
  topics: readonly TabTourTopic[];
}

const TOURS: Partial<Record<TabTourId, TabTour>> = {
  agreements: AGREEMENTS_TAB_TOUR,
  billing: BILLING_TAB_TOUR,
  dashboard: DASHBOARD_TAB_TOUR,
  finances: FINANCES_TAB_TOUR,
  insights: INSIGHTS_TAB_TOUR,
  insurances: INSURANCES_TAB_TOUR,
  integrations: INTEGRATIONS_TAB_TOUR,
  rentals: RENTALS_TAB_TOUR,
  customers: CUSTOMERS_TAB_TOUR,
  vehicles: VEHICLES_TAB_TOUR,
  availability: AVAILABILITY_TAB_TOUR,
  payments: PAYMENTS_TAB_TOUR,
};

/** Look up a tour by id. Returns null for anything unknown, never throws. */
export function getTabTour(id: string | null | undefined): TabTour | null {
  if (!id) return null;
  return (TOURS as Record<string, TabTour | undefined>)[id] ?? null;
}

export function getTopic(tour: TabTour, topicId: string | null | undefined): TabTourTopic | null {
  if (!topicId) return null;
  return tour.topics.find((t) => t.id === topicId) ?? null;
}

/**
 * The tour that belongs to a pathname, or null. Longest match wins, on a path
 * segment boundary: `/customers-archive` is not inside `/customers`. The
 * dashboard (`/`) only matches itself.
 */
export function tabTourForPath(pathname: string | null | undefined): TabTour | null {
  if (!pathname) return null;
  let best: TabTour | null = null;
  for (const id of TAB_TOUR_IDS) {
    const tour = TOURS[id];
    if (!tour) continue;
    const home = tour.homeRoute;
    const inside = home === '/' ? pathname === '/' : pathname === home || pathname.startsWith(`${home}/`);
    if (!inside) continue;
    if (!best || home.length > best.homeRoute.length) best = tour;
  }
  return best;
}

// ── Progress ────────────────────────────────────────────────────────────────

/**
 * Bump when a tour's topics change so much that saved progress would point at
 * the wrong steps. The version is part of the key, so a bump starts everyone
 * fresh. Version 1 was the single-run tour, which kept no progress.
 */
export const TAB_TOUR_VERSION = 2;

export interface TopicProgress {
  /** The step they were on, when the topic is in progress. */
  at?: string;
  done?: boolean;
  updatedAt: string;
}

export interface TabTourProgress {
  topics: Record<string, TopicProgress>;
  /** The topic they last worked on: what Continue opens. */
  last?: string;
}

export type TopicStatus = 'not-started' | 'in-progress' | 'done';

/** Where a tab tour's progress is kept, per user. The `d247.tour.` prefix is synced. */
export function tabTourProgressKey(id: TabTourId, appUserId: string | null | undefined): string {
  const who = appUserId && appUserId.length > 0 ? appUserId : 'anon';
  return `d247.tour.tab.${id}.v${TAB_TOUR_VERSION}.${who}`;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Saved progress, or an empty record. Never throws. */
export function readTabTourProgress(
  id: TabTourId,
  appUserId: string | null | undefined,
  store: StorageLike | null = storage(),
): TabTourProgress {
  const empty: TabTourProgress = { topics: {} };
  if (!store) return empty;
  try {
    const raw = store.getItem(tabTourProgressKey(id, appUserId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<TabTourProgress>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.topics !== 'object' || !parsed.topics) return empty;
    return { topics: parsed.topics as Record<string, TopicProgress>, last: typeof parsed.last === 'string' ? parsed.last : undefined };
  } catch {
    return empty;
  }
}

function writeTabTourProgress(
  id: TabTourId,
  appUserId: string | null | undefined,
  progress: TabTourProgress,
  store: StorageLike | null = storage(),
): void {
  if (!store) return;
  const key = tabTourProgressKey(id, appUserId);
  try {
    store.setItem(key, JSON.stringify(progress));
    noteTourWrite(key);
  } catch {
    /* storage full or blocked: the tour still runs, it just will not remember */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TAB_TOUR_PROGRESS_EVENT));
}

/** Fired after any tab tour progress write, so open menus redraw. */
export const TAB_TOUR_PROGRESS_EVENT = 'd247:tab-tour-progress';

/** They are on `stepId` of `topicId`. A done topic stays done. */
export function saveTopicStep(id: TabTourId, appUserId: string | null | undefined, topicId: string, stepId: string): void {
  const p = readTabTourProgress(id, appUserId);
  const prev = p.topics[topicId];
  p.topics[topicId] = { ...prev, at: stepId, updatedAt: new Date().toISOString() };
  p.last = topicId;
  writeTabTourProgress(id, appUserId, p);
}

/** They reached the end of `topicId`. */
export function markTopicDone(id: TabTourId, appUserId: string | null | undefined, topicId: string): void {
  const p = readTabTourProgress(id, appUserId);
  p.topics[topicId] = { done: true, updatedAt: new Date().toISOString() };
  p.last = topicId;
  writeTabTourProgress(id, appUserId, p);
}

/** Forget this tab's progress ("Start from the beginning"). */
export function resetTabTourProgress(id: TabTourId, appUserId: string | null | undefined): void {
  writeTabTourProgress(id, appUserId, { topics: {} });
}

export function topicStatus(progress: TabTourProgress, topicId: string): TopicStatus {
  const t = progress.topics[topicId];
  if (t?.done) return 'done';
  if (t?.at) return 'in-progress';
  return 'not-started';
}

/**
 * What Continue opens: the topic they were last in, if it is unfinished;
 * otherwise the first topic not yet done (that they can take). Null when
 * every available topic is done.
 */
export function continueTarget(
  tour: TabTour,
  progress: TabTourProgress,
  available: (topic: TabTourTopic) => boolean = () => true,
): { topicId: string; stepId?: string } | null {
  const last = progress.last ? getTopic(tour, progress.last) : null;
  if (last && available(last) && topicStatus(progress, last.id) === 'in-progress') {
    return { topicId: last.id, stepId: progress.topics[last.id]?.at };
  }
  const next = tour.topics.find((t) => available(t) && topicStatus(progress, t.id) !== 'done');
  if (!next) return null;
  return { topicId: next.id, stepId: progress.topics[next.id]?.at };
}

/** The topic after `topicId` that this user can take, or null. */
export function nextTopic(
  tour: TabTour,
  topicId: string,
  available: (topic: TabTourTopic) => boolean = () => true,
): TabTourTopic | null {
  const i = tour.topics.findIndex((t) => t.id === topicId);
  if (i === -1) return null;
  return tour.topics.slice(i + 1).find(available) ?? null;
}

/** Can this topic run with what is on the page now? */
export function topicAvailable(
  topic: TabTourTopic,
  ctx: Pick<TourBuildContext, 'sampleIds' | 'emptyTabs'>,
): boolean {
  const req = topic.requires;
  if (!req) return true;
  if (req.record && !ctx.sampleIds?.[req.record]) return false;
  if (req.tabHasData && (ctx.emptyTabs ?? []).includes(req.tabHasData)) return false;
  return true;
}

/** How many of a topic's steps apply to this page (an empty tab drops the full-tab steps, and back). */
export function topicStepCount(
  topic: TabTourTopic,
  ctx: Pick<TourBuildContext, 'sampleIds' | 'emptyTabs'>,
): number {
  // Same data and screen checks the tour itself runs, so the menu count matches the card counter.
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  const empty = ctx.emptyTabs ?? [];
  return topic.steps.filter((st) => {
    const r = st.requires;
    if (!r) return true;
    if (r.desktop && isMobile) return false;
    if (r.record && !ctx.sampleIds?.[r.record]) return false;
    if (r.noRecord && ctx.sampleIds?.[r.noRecord]) return false;
    if (r.tabHasData && empty.includes(r.tabHasData)) return false;
    if (r.tabIsEmpty && !empty.includes(r.tabIsEmpty)) return false;
    return true;
  }).length;
}

// ── Launching ───────────────────────────────────────────────────────────────

/**
 * Ask the mounted tour machine to run a tab tour topic. One event carrying
 * the ids, because the machine is mounted once.
 */
export const RUN_TAB_TOUR_EVENT = 'run-tab-tour';

export interface RunTabTourDetail {
  tourId: TabTourId;
  topicId: string;
  /** Start on this step (Continue); absent starts the topic at its first step. */
  stepId?: string;
}

export function runTabTour(tourId: TabTourId, topicId: string, stepId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<RunTabTourDetail>(RUN_TAB_TOUR_EVENT, { detail: { tourId, topicId, stepId } }));
}

// ── Reading the page ────────────────────────────────────────────────────────

/** A route inside a record, or null when the tenant has no such record yet. */
export function recordRoute(id: string | null | undefined, base: string, query?: string): string | null {
  if (!id) return null;
  return query ? `${base}/${id}?${query}` : `${base}/${id}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One real record id per tab, read out of what the page has already drawn:
 * a `data-record-id` marker first, then hrefs like `/vehicles/<uuid>`. A
 * record page's own rail links to its sections, so this also works from
 * inside a record. No query: nothing runs for a tenant not looking at the page.
 */
function firstRecordId(base: string): string | null {
  if (typeof document === 'undefined') return null;
  const kind = base.replace(/^\//, '');
  try {
    // Standing inside a record: that record.
    const here = window.location.pathname.split('/');
    if (here[1] === kind && UUID_RE.test(here[2] ?? '')) return here[2];
    const marked = document.querySelectorAll<HTMLElement>(`[data-record-kind="${kind}"][data-record-id]`);
    for (const el of Array.from(marked)) {
      const id = el.getAttribute('data-record-id') ?? '';
      if (UUID_RE.test(id)) return id;
    }
    const links = document.querySelectorAll<HTMLAnchorElement>(`a[href^="${base}/"]`);
    for (const link of Array.from(links)) {
      const href = link.getAttribute('href') ?? '';
      const id = href.slice(base.length + 1).split(/[?#/]/)[0];
      if (UUID_RE.test(id)) return id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Tabs showing their teaching empty state right now (`data-tour="<tab>-empty"`).
 * A list filtered down to nothing shows the ordinary no-results message
 * instead, and correctly does not count as empty.
 */
export function readEmptyTabs(): string[] {
  if (typeof document === 'undefined') return [];
  const out: string[] = [];
  try {
    for (const id of TAB_TOUR_IDS) {
      if (document.querySelector(`[data-tour="${id}-empty"]`)) out.push(id);
    }
  } catch {
    return [];
  }
  return out;
}

/** Sample ids for `TourBuildContext.sampleIds`. Safe to call on any route. */
export function readSampleIds(): {
  vehicleId: string | null;
  customerId: string | null;
  rentalId: string | null;
} {
  return {
    vehicleId: firstRecordId('/vehicles'),
    customerId: firstRecordId('/customers'),
    rentalId: firstRecordId('/rentals'),
  };
}

export type { TourBuildContext, TourStep };
