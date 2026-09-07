"use client";

// ── Turo Sync — preview only ──────────────────────────────────────────────────
//
// A DESCRIPTION, not a connection. This panel reads nothing, writes nothing,
// calls no edge function and imports no hook — exactly like `inshur.tsx` and
// `checkmydriver.tsx`, and for the same reason: a card that only describes an
// integration cannot reach any part of it, so it is safe to show on the board
// before the feature exists.
//
// ⚠️ THAT IS LOAD-BEARING HERE MORE THAN ANYWHERE ELSE ON THIS BOARD.
//
// Turo Sync is real work in progress on `feat/turo-extension` — four
// `turo-bridge-*` edge functions, the `turo_bridge_*` and `turo_vehicle_map`
// tables, a `/turo-bridge` route and a Chrome extension. NONE of it is on
// `main`, and this file must not become the thing that pulls it in. If this
// panel ever grows a connect flow, a pairing token, or a single read of
// `turo_bridge_*`, it stops being a preview and needs a tenant gate of its own
// in the same commit.
//
// NAME SPLIT, DELIBERATE. The operator-facing name is "Turo Sync" — that is
// what the card, this panel and any future settings toggle say. Everything
// internal on that branch stays `turo_bridge_*` (the route, the tables, the
// columns, the hooks). The split is cheap and it is written down in both
// places so the next person meets it as a decision rather than as a mystery.
//
// Nothing is read from `tenants` on purpose. There is no state to show: the
// integration has no connected/disconnected condition yet, and rendering a
// half-set column would imply it is further along than it is.
//
// COPY PROVENANCE. Every claim below is drawn from `turo-bridge-poc/
// BLUEPRINT.md` and `turo-bridge-poc/FIELD-MAPPING.md` on that branch. Nothing
// here promises a date, and nothing here says it is live.

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
import { PanelLink, PanelNote, PanelSection, StatusChip } from "./_kit";
import { CalendarCheck, CarFront, KeyRound, RefreshCw, UserRoundCheck } from "lucide-react";

/**
 * Always the same neutral chip.
 *
 * `disconnected` rather than `attention`: nothing is wrong, and an amber chip
 * on a card the operator cannot act on trains them to ignore the colour on the
 * cards where it does mean something.
 */
export function TuroSyncStatus(_props: { tenant: PanelTenant }) {
  return <StatusChip state="disconnected" label="Coming soon" />;
}

/** Drawn from the real proof-of-concept — the blueprint and the field mapping. */
const CAPABILITIES: Array<{ Icon: typeof KeyRound; title: string; body: string }> = [
  {
    Icon: KeyRound,
    title: "It never asks for your Turo password",
    body:
      "There is nothing to hand over. A Drive247 Chrome extension reads the Turo session you are already signed into, and only ever reads — every request it makes to Turo is a GET, and no Drive247 value is ever written back to your listings.",
  },
  {
    Icon: CalendarCheck,
    title: "A Turo trip blocks the car here too",
    body:
      "Each trip arrives as a real reservation against a real vehicle and holds its dates, so the same car stops being sellable on two platforms at once. A trip missing an end date is rejected rather than guessed — a guessed end frees a car that is still out.",
  },
  {
    Icon: CarFront,
    title: "Turo bookings become ordinary Drive247 rentals",
    body:
      "Promote a trip and it turns into a rental, a customer and a booked date range carrying a Turo marker — records that live in your fleet, your calendar and your reports, not in a second system you have to remember to check.",
  },
  {
    Icon: RefreshCw,
    title: "Sync as often as you like",
    body:
      "Re-running a sync updates the trip you already have instead of adding a second copy of it. There is no wrong number of times to click it, and no clean-up afterwards.",
  },
  {
    Icon: UserRoundCheck,
    title: "Two calls stay yours",
    body:
      "Which car on your fleet a Turo listing actually is, and whether a trip that stopped appearing was really cancelled. Both are matched for you and neither is ever decided for you, because getting either one wrong blocks the wrong car's calendar.",
  },
];

export default function TuroSyncPanel(_props: IntegrationPanelProps) {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Turo Sync brings your Turo calendar into Drive247 &mdash; the trips, the guests and the
        dates &mdash; so one fleet stops living in two places.{" "}
        <span className="font-medium text-foreground">Turo publishes no API at all</span>, so it
        works the only way it can: a Drive247 Chrome extension that reads the Turo session already
        open in your own browser. Every tool in this space does it this way; this one is built to
        say so.
      </p>

      <PanelSection title="What it will do">
        <div className="space-y-3.5">
          {CAPABILITIES.map(({ Icon, title, body }) => (
            <div key={title} className="flex gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium leading-snug text-foreground">{title}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </PanelSection>

      {/* No date, and no install instructions. The extension is not published
          and there is nothing an operator can usefully do today, so the note
          says what pairing will be and states the one constraint that is
          permanent rather than a work item — reading a browser session means
          nothing syncs while that browser is shut. Better said here than
          discovered later. */}
      <PanelNote>
        Turo Sync is not available to connect yet &mdash; there is nothing to install or pair, and
        we will let you know the moment there is. Pairing will be one token you paste into the
        extension: no Turo password, and no account details typed anywhere. One thing worth knowing
        up front &mdash; because Turo has no API, syncing happens in your browser, so it runs while
        you have it open and pauses when you close it.
      </PanelNote>

      <PanelLink href="https://turo.com">Learn more about Turo</PanelLink>
    </div>
  );
}
