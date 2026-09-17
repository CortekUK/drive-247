import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useIsLean } from '@/lib/lean-context';
import {
  MAX_VIDEO_DURATION_SECONDS,
  SETUP_CHECKLIST_ITEMS,
  safeChecklistLink,
  type SetupChecklistItem,
} from '@/lib/setup-checklist';

/**
 * The setup checklist — from the database, falling back to the compiled list.
 *
 * A super admin authors these in apps/admin (Configuration → Setup Checklist).
 * `public.setup_checklist_items` is platform-wide, not per-tenant: the same
 * four features are hard for everybody, so there is no `tenant_id` here and no
 * tenant filter to get wrong (V2_PLAN §5). It follows `feature_announcements`
 * and `first_run_questions` in that respect.
 *
 * THE FALLBACK IS NOT A NICETY, and it is why this can ship before the table
 * exists. `ops/setup_checklist_items.sql` is applied by hand and has not been
 * applied yet, so the read below fails with "table does not exist" today.
 * `SETUP_CHECKLIST_ITEMS` in `lib/setup-checklist.ts` is the compiled default
 * and ANY failure — missing table, RLS refusal, an outage, a row that does not
 * parse — resolves to it. This card sits in the dashboard's top band; a read
 * failure must cost it its content at worst, never the dashboard.
 */

/** A row as it comes back from PostgREST. Every field is treated as untrusted. */
interface ChecklistRow {
  item_key: unknown;
  title: unknown;
  description: unknown;
  video_url: unknown;
  video_duration_seconds: unknown;
  guide_url: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * A trimmed link, or `null` for anything blank, not a string, or unsafe.
 *
 * Unsafe means anything `safeChecklistLink` refuses — a `javascript:` or
 * `data:` URL, a protocol-relative `//host`, a path like `/.//host` whose dot
 * segment collapses to `//host`. A same-origin path comes back resolved
 * (`/settings/../rentals` is `/rentals`), so what is stored on the item is what
 * the card classifies and routes. Unsafe links are dropped HERE, before
 * the link rule below runs, so a row whose only link is one of them counts as
 * a row with no link and is dropped too. The card checks again before it uses
 * a link; this is the reader keeping its own promise that every row it returns
 * has something behind it.
 */
function toLink(v: unknown): string | null {
  return isNonEmptyString(v) ? safeChecklistLink(v.trim()) : null;
}

/**
 * `video_duration_seconds` to whole seconds, or `null`.
 *
 * The column is an `integer`, so PostgREST sends a JSON number; a numeric
 * string ("90") is accepted as well, because not every path that writes or
 * proxies a row keeps it a number, and a card that quietly stops printing
 * times over a representation change is the failure worth avoiding.
 *
 * Anything that is not a finite, positive, whole number of seconds up to
 * MAX_VIDEO_DURATION_SECONDS (the same ceiling as the table's CHECK) is
 * `null`, and the card then prints no time at all rather than a wrong one.
 */
function toDurationSeconds(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\s*\d+(?:\.0+)?\s*$/.test(v)) n = Number(v);
  else return null;
  if (!Number.isInteger(n) || n < 1 || n > MAX_VIDEO_DURATION_SECONDS) return null;
  return n;
}

/**
 * One row to a `SetupChecklistItem`, or `null` if it cannot be rendered.
 *
 * THE LINK RULE IS RE-CHECKED HERE, deliberately, even though a CHECK
 * constraint on the table already enforces it and the admin form refuses to
 * save without one. Those two guard the writers; this guards the reader, and
 * the reader is the one that has to cope with a row written before the
 * constraint existed, by a service_role script, or by hand in psql. A row
 * naming a hard feature with nothing behind it is worse than no row: the
 * operator clicks it, nothing happens, and the card has taught them it is
 * decoration.
 */
function toItem(row: ChecklistRow): SetupChecklistItem | null {
  if (!isNonEmptyString(row.item_key)) return null;
  if (!isNonEmptyString(row.title)) return null;

  const videoUrl = toLink(row.video_url);
  const guideUrl = toLink(row.guide_url);
  if (!videoUrl && !guideUrl) return null;

  return {
    key: row.item_key,
    title: row.title,
    description: isNonEmptyString(row.description) ? row.description : '',
    videoUrl,
    // Only meaningful beside a video. A length on a row whose video was blank
    // or refused as unsafe would be a time printed for nothing.
    videoDurationSeconds: videoUrl ? toDurationSeconds(row.video_duration_seconds) : null,
    guideUrl,
  };
}

export interface SetupChecklistState {
  items: readonly SetupChecklistItem[];
  /** True while the first read is in flight. */
  isLoading: boolean;
  /** True when these came from the compiled fallback rather than the database. */
  isFallback: boolean;
}

export function useSetupChecklist(): SetupChecklistState {
  const { tenant } = useTenant();

  /**
   * The canary gate, and the reason it is not optional.
   *
   * This is authored copy for a v2 surface, and V2_PLAN §2 is explicit that
   * "every v2 change — a screen, a QUERY, a column, a trigger, an edge
   * function — is gated so that northwind sees it and nobody else does".
   *
   * Ungated, this would fire on EVERY dashboard mount for ALL 57 tenants,
   * against a table that does not exist in production — so 56 operators would
   * pay a failing round trip and a console warning on every load, for a card
   * they never see. That exact bug was found in `use-first-run-questions.ts`
   * this week; the fallback is what made it invisible, and invisible is why it
   * survived review.
   *
   * Keyed on the SLUG, never the tenant id: the canary has a different primary
   * key in every environment, so an id-keyed gate resolves the wrong way
   * locally with no error and no failed build.
   *
   * Fails CLOSED — an unresolved tenant reads nothing and takes the compiled
   * list, which is the same set the table is seeded with.
   */
  const isCanary = useIsLean();

  const { data, isLoading } = useQuery({
    // No tenant in the key: the set is platform-wide, so one cache entry serves
    // every tenant in this browser.
    queryKey: ['setup-checklist-items'],
    enabled: isCanary,
    queryFn: async (): Promise<readonly SetupChecklistItem[] | null> => {
      const { data: rows, error } = await (supabase as any)
        .from('setup_checklist_items')
        .select('item_key,title,description,video_url,video_duration_seconds,guide_url')
        .eq('is_published', true)
        .order('sort_order', { ascending: true });

      if (error) {
        // Includes "table does not exist" until ops/setup_checklist_items.sql
        // is applied. Logged rather than thrown: the caller falls back, and the
        // dashboard must not lose a card to a read that failed.
        console.warn(
          '[setup-checklist] could not read setup_checklist_items — using the ' +
            'compiled list.',
          error.message,
        );
        return null;
      }

      const parsed = (rows ?? [])
        .map((r: ChecklistRow) => toItem(r))
        .filter((i: SetupChecklistItem | null): i is SetupChecklistItem => i !== null);

      // An empty table is not an instruction to show nothing. It is far more
      // likely to be an unseeded database — or every row dropped by `toItem`
      // above — than a deliberate choice to stop explaining these four
      // features, so it falls back too.
      return parsed.length > 0 ? parsed : null;
    },
    // Authored once in a while, read on every dashboard mount. A long stale
    // time keeps this off the critical path of the operator's first screen.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    items: data ?? SETUP_CHECKLIST_ITEMS,
    /**
     * `&& isCanary` is belt and braces, and it is here because the honest
     * answer depends on a library version.
     *
     * Under React Query v5 (5.90.x here) `isLoading` is `isPending &&
     * isFetching`, and a DISABLED query is pending but never fetching — so it
     * already reports false and a non-canary tenant falls straight through to
     * the compiled list. Under v4 the same query reports `isLoading: true`
     * FOREVER, because there `isLoading` is just `status === 'loading'`.
     *
     * The card renders a skeleton while loading, so on a v4 upgrade that
     * difference would freeze it as a skeleton for all 56 non-canary tenants —
     * silently, on the dashboard. Making the gate explicit costs nothing and
     * does not depend on which of those two semantics is in force.
     */
    isLoading: isLoading && isCanary,
    isFallback: !data,
  };
}
