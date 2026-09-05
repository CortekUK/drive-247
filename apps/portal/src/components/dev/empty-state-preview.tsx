"use client";

import { useMemo, useSyncExternalStore } from "react";
import { ArrowUpRight, LayoutTemplate } from "lucide-react";

import { Button } from "@/components/ui-v2/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui-v2/card";
import { Switch } from "@/components/ui-v2/switch";
import {
  EMPTY_STATE_PAGES,
  parseForcedEmptyPages,
  readForcedEmptyRaw,
  setAllEmptyStatesForced,
  setEmptyStateForced,
  subscribeDevOverrides,
} from "@/lib/dev-overrides";

/**
 * The `/dev` control for the teaching empty states: one switch per listing
 * page, "All on" / "All off", and a link to open the page and look.
 *
 * Self-contained. It reads and writes `lib/dev-overrides.ts` and nothing
 * else — no tenant, no Supabase — because the flag is a per-browser
 * developer preference, not tenant state. The `/dev` page that hosts it
 * already decides WHO sees a switch (local host, northwind); the NODE_ENV
 * guard in the reader decides whether a switch can ever DO anything, and
 * that guard is what keeps a planted key inert everywhere else.
 *
 * Visually secondary to the page's two main actions on purpose: a section
 * heading in the same style, one small card, a compact list.
 */

/**
 * The build gate, and nothing else — no hooks, no other statements, the
 * development branch first — so a production bundle folds this to
 * `return null` and drops the body. Belt and braces: the page that renders
 * this is already folded out the same way.
 */
export function EmptyStatePreview() {
  if (process.env.NODE_ENV === "development") return <EmptyStatePreviewBody />;
  return null;
}

function EmptyStatePreviewBody() {
  // The RAW string is the snapshot — stable between reads, which
  // `useSyncExternalStore` requires — and the set is derived from it.
  const raw = useSyncExternalStore(subscribeDevOverrides, readForcedEmptyRaw, () => "");
  const forced = useMemo(() => parseForcedEmptyPages(raw), [raw]);

  const onCount = forced.size;
  const total = EMPTY_STATE_PAGES.length;

  return (
    <section
      aria-labelledby="dev-section-empty-states"
      data-testid="empty-state-preview"
      className="flex flex-col gap-3"
    >
      <h2
        id="dev-section-empty-states"
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        Empty states
      </h2>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutTemplate className="size-4 text-primary" />
            Preview the teaching empty states
          </CardTitle>
          <CardDescription>
            Switch a page on and it shows its first-time teaching state even though it
            has data. Nothing is deleted. The switch is remembered in this browser only
            and is ignored outside a development build.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {EMPTY_STATE_PAGES.map((page) => {
              const on = forced.has(page.id);
              const switchId = `force-empty-${page.id}`;
              return (
                <li
                  key={page.id}
                  data-empty-state-page={page.id}
                  data-forced={on ? "true" : "false"}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <Switch
                    id={switchId}
                    size="sm"
                    checked={on}
                    onCheckedChange={(next) => setEmptyStateForced(page.id, next)}
                    aria-label={`Force the ${page.label} empty state`}
                  />
                  <label
                    htmlFor={switchId}
                    className="min-w-0 flex-1 cursor-pointer text-sm text-foreground"
                  >
                    {page.label}
                  </label>
                  {/* A plain anchor, not `next/link`: it opens a NEW tab, so
                      there is no client-side transition to make and nothing
                      to prefetch — and the /dev gate test renders this page
                      without a router. */}
                  <a
                    href={page.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Open
                    <ArrowUpRight className="size-3" />
                  </a>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs tabular-nums text-muted-foreground" data-testid="empty-state-preview-count">
              {onCount} of {total} on
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setAllEmptyStatesForced(true)}
                disabled={onCount === total}
              >
                All on
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setAllEmptyStatesForced(false)}
                disabled={onCount === 0}
              >
                All off
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
