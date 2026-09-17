"use client";

/**
 * v2 (northwind): the whole `/settings/blacklist` page. The route returns this
 * inside its `useV2('chrome')` branch, so the other tenants keep the v1 page.
 *
 * Every state has something to show (see `resolveBlacklistView`):
 *   loading      -> table skeleton, stat tiles pulse
 *   read failed  -> "Couldn't load the global blacklist" + Try again; the stat
 *                   tiles read "—" rather than zeros that look like real data
 *   stale + fail -> the rows still in the cache, with a one-line error above
 *   empty        -> explains how a customer gets here; no search box
 *   no match     -> echoes the search, with Clear search
 *   rows         -> the list kit's table
 *
 * The search is the top bar's (the v2 search slot), like every other v2 list.
 */

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { SettingsPageHeader } from "@/components/settings-v2/settings-kit";
import {
  SettingsEmptyState,
  SettingsLoadError,
  SettingsNoMatch,
  SettingsSectionSkeleton,
} from "@/components/settings-v2/section-states";
import {
  isPositiveCount,
  matchesBlacklistSearch,
  resolveBlacklistView,
} from "@/components/settings-v2/settings-shell-state";
import {
  GlobalBlacklistTableV2,
  type GlobalBlacklistEntryRowV2,
} from "@/components/blacklist-v2/global-blacklist-table-v2";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The page's white surfaces (tiles, empty and no-match cards) carry the ui-v2
 * Card's hairline ring: once the app gradient fades to white further down a
 * phone screen, a bare bg-card has no edge and a tile reads as a floating
 * number. `ring-foreground/*`, not `border-border/*`, which is invalid in v2
 * dark (the token already carries an alpha).
 */
const SURFACE = "ring-1 ring-foreground/5 dark:ring-foreground/10";

export function GlobalBlacklistPageV2<T extends GlobalBlacklistEntryRowV2>({
  blacklist,
  isLoading,
  isFetching,
  error,
  refetch,
  searchTerm,
  onSearchChange,
  expandedIds,
  onToggle,
  now = Date.now(),
}: {
  blacklist: T[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => unknown;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  /** For tests: the clock the "last 30 days" tile counts from. */
  now?: number;
}) {
  const rows = blacklist ?? null;
  const filtered = rows ? rows.filter((entry) => matchesBlacklistSearch(entry, searchTerm)) : [];
  const view = resolveBlacklistView({
    isLoading,
    error,
    total: rows ? rows.length : null,
    filtered: filtered.length,
  });

  // Nothing to search until there is at least one row.
  usePageSearch(
    rows && rows.length > 0
      ? { placeholder: "Search by email, company or reason", value: searchTerm, onChange: onSearchChange }
      : null,
  );

  const stats = rows
    ? {
        customers: rows.length,
        // Only real counts: a broken or negative one would pull the total down.
        blocks: rows.reduce((acc, entry) => acc + (isPositiveCount(entry.blocked_tenant_count) ? entry.blocked_tenant_count : 0), 0),
        recent: rows.filter((entry) => {
          if (!entry.last_blocked_at) return false;
          const t = new Date(entry.last_blocked_at).getTime();
          return Number.isFinite(t) && now - t < THIRTY_DAYS_MS;
        }).length,
      }
    : null;

  const statValue = (value: number | undefined) => {
    if (stats && value !== undefined) return value.toLocaleString("en-US");
    if (view === "loading") return <Skeleton className="h-7 w-12" />;
    return <span className="text-muted-foreground">—</span>;
  };

  return (
    // No mx-auto: like the Settings index and every v2 settings page, the page
    // starts on the top bar's search line instead of centring on wide screens.
    // md:pt-[26px]: the 32px title line centres at 50 + 26 + 16 = 92, the
    // sidebar switch's row (as on the Settings index).
    <div className="w-full max-w-[1160px] space-y-6 pb-16 md:pt-[26px]" data-blacklist-view={view}>
      <SettingsPageHeader
        title="Global blacklist"
        description="Customers blocked by 3 or more rental companies across the platform."
      />

      <div role="note" className="flex items-start gap-3 rounded-2xl bg-muted/60 px-4 py-3 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary dark:text-indigo-300" aria-hidden="true" />
        <p className="min-w-0">
          <span className="font-medium text-foreground">Platform-wide protection.</span>{" "}
          <span className="text-muted-foreground">
            When 3 or more rental companies block a customer, they are added here automatically and cannot book with
            any company on the platform.
          </span>
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Blacklisted customers", value: stats?.customers },
          { label: "Total blocks", value: stats?.blocks },
          { label: "Added in the last 30 days", value: stats?.recent },
        ].map((tile) => (
          <div key={tile.label} className={`rounded-2xl bg-card px-4 py-3.5 ${SURFACE}`}>
            <dt className="text-xs text-muted-foreground">{tile.label}</dt>
            <dd className="mt-1 flex h-8 items-center font-heading text-2xl font-semibold tabular-nums text-foreground">
              {statValue(tile.value)}
            </dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3" aria-labelledby="global-blacklist-heading">
        <div>
          <h2 id="global-blacklist-heading" className="font-heading text-lg font-semibold tracking-tight text-foreground">
            Blacklisted customers
          </h2>
          <p className="text-sm text-muted-foreground">
            Open a row to see which companies blocked the customer, and why.
          </p>
        </div>

        {view === "loading" && (
          <SettingsSectionSkeleton variant="table" rows={6} columns={5} label="Loading the global blacklist" />
        )}

        {view === "error" && (
          <SettingsLoadError thing="the global blacklist" error={error} onRetry={refetch} retrying={isFetching} />
        )}

        {view === "empty" && (
          <SettingsEmptyState
            className={SURFACE}
            icon={ShieldCheck}
            headline="No one is on the platform blacklist"
            body="A customer is added here automatically once 3 or more rental companies block them. Until then there is nothing to review."
          />
        )}

        {view === "no-match" && (
          <div className={`rounded-2xl bg-card ${SURFACE}`}>
            <SettingsNoMatch query={searchTerm} noun="customers" onClear={() => onSearchChange("")} />
          </div>
        )}

        {(view === "rows" || view === "error-stale") && (
          <>
            {view === "error-stale" && (
              <SettingsLoadError
                variant="inline"
                thing="the global blacklist"
                error={error}
                onRetry={refetch}
                retrying={isFetching}
              />
            )}
            <GlobalBlacklistTableV2
              entries={filtered}
              resetKey={searchTerm}
              expandedIds={expandedIds}
              onToggle={onToggle}
            />
          </>
        )}
      </section>
    </div>
  );
}
