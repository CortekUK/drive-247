'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { isLeanTenant } from '@/lib/lean-areas';

/**
 * Portal-side reader for `feature_announcements` — the same platform-wide table
 * the booking app already shows to customers, surfaced here for operator staff.
 *
 * TENANT ISOLATION: this is the one query in the v2 dashboard with NO
 * `tenant_id` filter, and that is correct rather than an oversight.
 * `feature_announcements` has no `tenant_id` column (verified against
 * production) — it is platform news written by Drive247 for every operator.
 * It is also one of the tables that DOES have RLS enabled, with a policy
 * restricting `authenticated` to published, active, in-window rows.
 *
 * Two things differ from the customer side, both deliberate:
 *
 * 1. Dismissal is local, not stored. `customer_announcement_views` is keyed to
 *    `customer_user_id`, and portal staff are `app_users` — there is no row for
 *    them and creating one is a migration, which this area does not need. So a
 *    dismissal persists in localStorage per browser, the same approach the
 *    sidebar promo already uses. A staff member who switches machines sees the
 *    card again; that is the accepted cost of not touching the schema.
 *
 *    PER BROWSER, NOT PER USER, and the difference is visible in a real shop.
 *    `STORAGE_KEY` carries no `app_user_id`, and localStorage is per browser
 *    profile — so two staff sharing one login on the front-desk machine share
 *    one dismissal list, and one of them hiding an announcement hides it from
 *    the other. Two staff with SEPARATE logins on that same machine also share
 *    it, because signing out does not clear this key. Defensible only because
 *    of what is being lost: platform-wide product news, re-openable from the
 *    "Show announcements" button on the same card, never anything
 *    operational, per-tenant or personal. Nothing tenant-scoped is written
 *    here, so a shared browser leaks no tenant data — it leaks a preference.
 *    If that ever stops being acceptable, the fix is to key `STORAGE_KEY` on
 *    the signed-in `app_user.id` rather than to add a table.
 *
 * 2. Audience is filtered here. The table is read by both apps, so an
 *    announcement aimed at renters would otherwise appear on an operator's
 *    dashboard. See AUDIENCE below.
 */

export type AnnouncementSeverity = 'major' | 'minor' | 'critical' | 'info';

export interface FeatureAnnouncement {
  id: string;
  title: string;
  summary: string | null;
  body_html: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  severity: AnnouncementSeverity;
  published_at: string | null;
  expires_at: string | null;
  sort_priority: number;
  audience_filter: unknown;
}

const STORAGE_KEY = 'portal:announcements:dismissed';

/**
 * AUDIENCE — an announcement is shown in the portal when its `audience_filter`
 * is null (meaning "everyone", which is how the booking app already treats it)
 * or when its `apps` array names "portal".
 *
 * Tag an announcement as operator-only with:
 *   audience_filter = '{"apps": ["portal"]}'
 * and renter-only with:
 *   audience_filter = '{"apps": ["booking"]}'
 *
 * Untagged rows deliberately fall through to both apps rather than neither, so
 * nothing silently stops being announced. If you would rather the portal show
 * only explicitly-tagged rows, drop the `filter == null` arm below.
 *
 * IN PRACTICE, TODAY, EVERY ROW IS UNTAGGED. The super-admin editor
 * (apps/admin/app/admin/(protected)/announcements/page.tsx) has no
 * `audience_filter` field — it is absent from `emptyForm`, from the form body
 * and from the `payload` object `save()` writes — so nothing a super admin
 * publishes can ever be targeted, and every announcement is shown to portal
 * staff AND to renters. The booking-side reader
 * (apps/booking/src/hooks/use-customer-announcements.ts) does not read the
 * column at all, so it cannot honour a tag even if one were written by hand.
 *
 * This branch is therefore correct but currently inert: it is the portal half
 * of a targeting feature whose other two halves were never built. Finishing it
 * is one `<Select>` in the admin form plus the same `isForPortal` check on the
 * booking side — deliberately NOT done here, because this pass is an audit.
 */
function isForPortal(filter: unknown): boolean {
  if (filter == null) return true;
  const apps = (filter as { apps?: unknown })?.apps;
  if (!Array.isArray(apps)) return true;
  return apps.includes('portal');
}

/**
 * `severity` is a plain `text` column, not an enum — the generated types say
 * `severity: string`. The admin form constrains it to four values, but the
 * column does not, and anything written by hand (a SQL fix-up, a seed, a future
 * fifth value) arrives here unchecked.
 *
 * That matters because the card indexes two `Record<AnnouncementSeverity, …>`
 * tables with it. An unrecognised value made both lookups `undefined`, which
 * rendered the badge as an empty pill with no label and no fill — the one chip
 * that says how urgent this is, silently blank. Unknown now reads as `info`.
 */
const SEVERITIES: readonly AnnouncementSeverity[] = ['critical', 'major', 'minor', 'info'];

function toSeverity(raw: unknown): AnnouncementSeverity {
  return SEVERITIES.includes(raw as AnnouncementSeverity)
    ? (raw as AnnouncementSeverity)
    : 'info';
}

/* ─── Dev-only preview rows ───────────────────────────────────────────────────
 *
 * There is very little in the table, so the carousel has nothing to fan. These
 * exist purely so the component can be looked at with a full deck.
 *
 * They are NOT written to the database — seeding fake announcements would put
 * invented product news in front of real operators. `process.env.NODE_ENV` is
 * inlined by Next at build time, so in a production bundle `PREVIEW_ENABLED` is
 * a literal `false` and the branch that reads this array can never run. The
 * array itself should also be tree-shaken out, being referenced only from that
 * dead branch, but the guarantee that matters is the first one: these never
 * reach a tenant.
 *
 * They now also stand down as soon as the query returns anything — see `pool`
 * below. Before that they led unconditionally, which is why a dashboard
 * screenshot showing a "FLEET CALENDAR" card is NOT evidence that the table
 * has a row in it: that title is `PREVIEW_ANNOUNCEMENTS[0]` on this page, set
 * uppercase by the card's own CSS. Anything seen on a dev server has to be
 * checked against the table before it is believed.
 *
 * Delete this block once there are real rows worth fanning.
 */
const PREVIEW_ENABLED = process.env.NODE_ENV !== 'production';

const PREVIEW_ANNOUNCEMENTS: FeatureAnnouncement[] = [
  {
    id: 'preview-fleet-calendar',
    title: 'Fleet Calendar',
    summary:
      'Every vehicle against every date on one timeline — see the whole fleet at a glance.',
    body_html:
      '<p>Drag across any row to block a range of dates. Weekend and holiday surcharges show inline as a strip above the grid, so you can see what a day is actually priced at before you commit to it.</p><p>Bookings, blocks and maintenance windows all sit on the same row, which means a clash is visible rather than something you find out about at handover.</p>',
    image_url: null,
    cta_label: 'Open the calendar',
    cta_url: '/blocked-dates',
    severity: 'major',
    published_at: null,
    expires_at: null,
    sort_priority: 100,
    audience_filter: null,
  },
  {
    id: 'preview-auto-extension',
    title: 'Auto-Renew',
    summary: 'Weekly renters renew themselves, charged upfront each period.',
    body_html:
      '<p>A rental set to auto-renew charges the next period upfront from the customer’s saved card. If that card fails, they get a pay-link instead and the rental pauses rather than silently lapsing.</p><p>Set the cadence per rental — weekly, fortnightly or monthly — and skip or move any single occurrence without breaking the schedule.</p>',
    image_url: null,
    cta_label: 'See how it works',
    cta_url: '/rentals',
    severity: 'major',
    published_at: null,
    expires_at: null,
    sort_priority: 90,
    audience_filter: null,
  },
  {
    id: 'preview-deposit-holds',
    title: 'Deposit Holds',
    summary: 'Holds now refresh themselves before Stripe expires them.',
    body_html:
      '<p>A Stripe authorisation lapses after seven days. On a longer rental that meant the deposit was quietly gone by the time the car came back.</p><p>Holds are now extended automatically ahead of that deadline, using extended authorisation where the connected account supports it. Nothing to do — but it is worth checking any rental that started before this shipped.</p>',
    image_url: null,
    cta_label: 'Review your holds',
    cta_url: '/payments',
    severity: 'critical',
    published_at: null,
    expires_at: null,
    sort_priority: 80,
    audience_filter: null,
  },
];

function readDismissed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function useFeatureAnnouncements() {
  // Starts empty and hydrates in an effect so server and first client render
  // agree. Nothing renders before the query resolves, so there is no flash of a
  // card that was already dismissed.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
    setHydrated(true);
  }, []);

  /**
   * THE CANARY GATE, and it was missing.
   *
   * V2_PLAN §2 is explicit that every v2 change — "a screen, a QUERY, a column,
   * a trigger, an edge function" — is gated so that northwind sees it and
   * nobody else does. This query had no `enabled` and no tenant in its key, so
   * it was gated only by WHERE THE COMPONENT HAPPENS TO SIT: the carousel is
   * mounted from `home-bands.tsx`, which only renders under `useV2('dashboard')`.
   * That is an accident of composition, not a gate — moving the card into any
   * shared surface, or a v1 page importing it, would have silently put this
   * round trip on all 57 tenants. The same bug was found and fixed in
   * `use-first-run-questions.ts` this week; this is the same fix.
   *
   * Keyed on the SLUG, never the tenant id: the canary has a different primary
   * key in every environment, so an id-keyed gate resolves the wrong way
   * locally with no error and no failed build (portal builds with
   * `ignoreBuildErrors: true`).
   *
   * Fails CLOSED — an unresolved tenant reads nothing and shows nothing, which
   * is the right answer for a card that carries no operational information.
   *
   * WIDENING HAZARD, read this before turning the v2 dashboard on for a second
   * tenant. Two lists have to move together: `V2_AREAS.dashboard` in
   * `lib/v2.ts` decides who is SHOWN this card, and `LEAN_TENANTS` in
   * `lib/lean-areas.ts` decides whose browser is allowed to FETCH for it. Add a
   * tenant to the first only and they get a permanently empty announcements
   * slot with no error anywhere. Add to both.
   */
  const { tenant } = useTenant();
  const isCanary = isLeanTenant(tenant?.slug);

  const { data = [], isLoading } = useQuery({
    // No tenant in the key: `feature_announcements` is platform-wide, so one
    // cache entry serves every tenant in this browser.
    queryKey: ['portal-feature-announcements'],
    enabled: isCanary,
    queryFn: async (): Promise<FeatureAnnouncement[]> => {
      // RLS already restricts this to published, active, in-window rows; the
      // filters are repeated for clarity and so a policy change cannot quietly
      // widen what the dashboard shows.
      const { data, error } = await supabase
        .from('feature_announcements')
        .select(
          'id, title, summary, body_html, image_url, cta_label, cta_url, severity, published_at, expires_at, sort_priority, audience_filter'
        )
        .eq('status', 'published')
        .eq('is_active', true)
        .order('sort_priority', { ascending: false })
        .order('published_at', { ascending: false });

      if (error) {
        /**
         * Was `throw error`, which is wrong twice over.
         *
         * React Query is configured in `app/providers.tsx` with `staleTime` and
         * `refetchOnWindowFocus` only — `retry` keeps its v5 default of 3. So a
         * failure that can NEVER succeed (the table dropped or renamed, a
         * policy refusal, a column removed from the select list above) cost
         * four round trips with backoff on every single dashboard mount, and
         * left an unhandled query error behind each time.
         *
         * Nothing on this card is operational: it is product news. An empty
         * slot is the correct outcome for every one of those failures, so the
         * read is logged and swallowed. `retry: false` below stops the other
         * three attempts.
         */
        console.warn(
          '[announcements] could not read feature_announcements — the ' +
            "what's-new card will render empty.",
          error.message,
        );
        return [];
      }

      const now = Date.now();
      return ((data || []) as any[])
        .filter((a) => {
          if (a.published_at && new Date(a.published_at).getTime() > now) return false;
          if (a.expires_at && new Date(a.expires_at).getTime() <= now) return false;
          return isForPortal(a.audience_filter);
        })
        // A row is only renderable if it has something to put on the poster.
        // `title` is NOT NULL in the table but is not checked for emptiness by
        // the admin form's `form.title?.trim()` guard on the way BACK OUT of an
        // edit — and a blank title renders a blank card with a Read more link.
        .filter((a) => typeof a.title === 'string' && a.title.trim().length > 0)
        .map((a) => ({ ...a, severity: toSeverity(a.severity) })) as FeatureAnnouncement[];
    },
    staleTime: 5 * 60 * 1000,
    // See the error branch above: nothing here is worth a retry storm.
    retry: false,
  });

  /**
   * Preview rows fill the deck ONLY when the database has nothing to show.
   *
   * They used to lead unconditionally, which made the one thing a super admin
   * needs to check locally — "did the announcement I just published actually
   * reach the portal?" — impossible to answer by looking: three invented cards
   * sat in front of the real one, with `sort_priority` 100/90/80 chosen to keep
   * them there. That reads as "the card is hardcoded" even when it is not.
   *
   * The block's own stated purpose is that "there is very little in the table,
   * so the carousel has nothing to fan", so standing down as soon as there IS
   * something is what it already meant. Production is unaffected either way:
   * `PREVIEW_ENABLED` is a literal `false` in a production bundle.
   */
  const pool = useMemo(
    () => (PREVIEW_ENABLED && data.length === 0 ? PREVIEW_ANNOUNCEMENTS : data),
    [data]
  );

  const visible = useMemo(
    () => (hydrated ? pool.filter((a) => !dismissed.includes(a.id)) : []),
    [pool, dismissed, hydrated]
  );

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A full or blocked localStorage must not stop the card going away.
      }
      return next;
    });
  }, []);

  /** Bring every dismissed announcement back — used by the "Show again" action. */
  const restore = useCallback(() => {
    setDismissed([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return {
    announcements: visible,
    hasDismissed: hydrated && dismissed.length > 0 && pool.length > 0,
    /**
     * `isLoading && isCanary`, not bare `isLoading`, and the reason is a
     * library version rather than paranoia.
     *
     * Under React Query v5 (5.90.x here) `isLoading` is `isPending &&
     * isFetching`, and a DISABLED query is pending but never fetching — so it
     * already answers false. Under v4 the same disabled query reports
     * `isLoading: true` FOREVER, because there it is just `status === 'loading'`.
     * The carousel renders its loading shell while this is true, so on a v4
     * upgrade a non-canary tenant would sit on that shell permanently. Making
     * the gate explicit costs nothing and does not depend on which semantics
     * are in force. Same reasoning as `use-first-run-questions.ts`.
     */
    isLoading: (isLoading && isCanary) || !hydrated,
    dismiss,
    restore,
  };
}
