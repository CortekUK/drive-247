"use client";

/**
 * RECORD — Listing.
 *
 * What a customer actually sees, and every reason they might not be seeing it.
 * Produced from Vehicle, Rates, Extras and Availability, which is why it sits
 * in the last group with Money.
 *
 * ── Why there is no Publish button ──────────────────────────────────────
 * The design sandbox had one, plus a snapshot of what the listing was
 * published from and an amber banner when the record moved underneath it. That
 * mechanic is right for a document that was ISSUED — a rental agreement, a
 * quote — and wrong here, because the booking site has no snapshot: it reads
 * `vehicles` live on every page load. A banner claiming "customers still see
 * the old price" would be false the moment it appeared, and a false amber
 * warning is worse than no warning at all — it teaches an operator to ignore
 * the colour everywhere else on this screen, where it IS true.
 *
 * So the tab tells the truth instead, and the truth turns out to be the more
 * reassuring sentence: whatever is on this page is what is live, right now.
 * Whether the car appears at all is derived from the four things that really
 * decide it, each with a way straight to the tab that owns it.
 */

import { ArrowUpRight, CircleCheck, ChevronRight } from "lucide-react";
import {
  Aside,
  DataRow,
  List,
  Panel,
  Pill,
  Section,
  useFmt,
} from "./kit";
import type { Blocker } from "./tab-availability";

export function ListingTab<K extends string>({
  live,
  blockers,
  jumpFor,
  onJump,
  siteUrl,
  name,
  plate,
  hidePlate,
  colour,
  description,
  photoCount,
  daily,
  weekly,
  monthly,
  deposit,
  durations,
  allowance,
  extras,
}: {
  live: boolean;
  /** Everything standing between this car and a customer seeing it. */
  blockers: Blocker[];
  /** Which tab owns a given blocker, so the row can be clicked through. */
  jumpFor: (key: string) => K | null;
  onJump: (target: K) => void;
  siteUrl: string;
  name: string;
  plate: string;
  hidePlate: boolean;
  colour: string | null;
  description: string | null;
  photoCount: number;
  daily: number;
  weekly: number;
  monthly: number;
  deposit: number;
  durations: string;
  allowance: string;
  extras: string;
}) {
  const fmt = useFmt();
  const hard = blockers.filter((b) => b.severity === "hard");

  return (
    <Panel
      title="Listing"
      description="The public page on the booking site, built from Vehicle, Rates and Extras."
      action={
        siteUrl ? (
          <a
            href={`${siteUrl}/fleet`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-opacity hover:opacity-70"
          >
            View the site
            <ArrowUpRight className="size-4" />
          </a>
        ) : undefined
      }
    >
      {hard.length > 0 && (
        <Section
          title="Why customers can't see it"
          hint="Each one is fixed on the tab it came from."
          action={<Pill tone="warning">{hard.length}</Pill>}
        >
          <div className="space-y-1.5">
            {hard.map((b) => {
              const target = jumpFor(b.key);
              const Row = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{b.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{b.detail}</span>
                  </span>
                  {target && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                </>
              );
              return target ? (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => onJump(target)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-3xl bg-warning-light/60 px-5 py-3.5 text-left ring-1 ring-warning/25 transition-colors hover:bg-warning-light"
                >
                  {Row}
                </button>
              ) : (
                <div
                  key={b.key}
                  className="flex w-full items-center gap-3 rounded-3xl bg-warning-light/60 px-5 py-3.5 ring-1 ring-warning/25"
                >
                  {Row}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section
        title={live ? "On the booking site" : "Not on the booking site"}
        hint="Exactly what a customer is shown, as of right now."
        action={
          live ? (
            <Pill tone="success">
              <CircleCheck className="size-3" />
              Live
            </Pill>
          ) : (
            <Pill tone="warning">Hidden</Pill>
          )
        }
      >
        <List>
          <DataRow
            label={name || "Untitled vehicle"}
            sub={[hidePlate ? null : plate, colour].filter(Boolean).join(" · ") || "No plate or colour set"}
          />
          <DataRow
            label={daily > 0 ? `${fmt.money(daily)} per day` : "No daily rate set"}
            sub={[
              weekly > 0 ? `${fmt.money(weekly)} per week` : null,
              monthly > 0 ? `${fmt.money(monthly)} per month` : null,
              deposit > 0 ? `${fmt.money(deposit)} deposit` : "no deposit",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          <DataRow label="Bookable as" sub={durations || "Nothing — no hire length is switched on"} />
          <DataRow label="Mileage" sub={allowance} />
          <DataRow label="Extras" sub={extras || "None offered with this car"} />
          <DataRow
            label="Photos"
            sub={photoCount === 1 ? "1 photo" : `${photoCount} photos`}
            right={photoCount === 0 ? <Pill tone="warning">None</Pill> : undefined}
          />
          {description && <DataRow label="Description" sub={description} />}
        </List>

        <div className="mt-4">
          <Aside>
            The booking site reads this record live — anything changed on the tabs to the left is
            public the moment you change it. There is nothing here to publish.
          </Aside>
        </div>
      </Section>

      {hidePlate && (
        <Aside>
          Registration plates are hidden from customers for this tenant, so the plate above is never
          shown on the site.
        </Aside>
      )}
    </Panel>
  );
}
