"use client";

// ── Inshur — preview only ─────────────────────────────────────────────────────
//
// A DESCRIPTION, not a connection. This panel reads nothing, writes nothing,
// and calls no edge function; it exists so an operator opening the card learns
// what Inshur is and that it is not available yet.
//
// That is deliberate and it is what makes the card safe to show. Inshur is a
// gated area (`inshur` in LEAN_HIDDEN_AREAS) — the seven `inshur-*` edge
// functions, the `inshur_*` columns and the v1 Settings panel all stay exactly
// where they are, closed to the canary. A panel that only describes the
// integration cannot open any of it, so there is nothing here for the gate to
// hide. If this file ever grows a connect flow, that reasoning stops holding
// and the card has to go back behind `isAreaHidden("inshur", tenantSlug)`.
//
// Nothing is read from `tenants` on purpose. A preview that rendered
// `inshur_mode: mock` or a half-set policy number would describe plumbing the
// operator cannot act on, and would imply the integration is further along
// than it is.

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
import { PanelLink, PanelNote, PanelSection, StatusChip } from "./_kit";
import { CalendarClock, MapPin, Receipt, ShieldCheck } from "lucide-react";

/**
 * Always the same neutral chip.
 *
 * `disconnected` rather than `attention`: nothing is wrong, and an amber chip
 * on a card the operator cannot act on is noise that trains them to ignore the
 * colour on the cards where it matters.
 */
export function InshurStatus(_props: { tenant: PanelTenant }) {
  return <StatusChip state="disconnected" label="Coming soon" />;
}

/** What the integration will give the operator, drawn from the real implementation. */
const CAPABILITIES: Array<{ Icon: typeof ShieldCheck; title: string; body: string }> = [
  {
    Icon: CalendarClock,
    title: "Cover between rentals, not just during them",
    body:
      "Coverage starts and ends with the vehicle's own timeline rather than a booking, so a car sitting on your lot is insured the same as one that is out.",
  },
  {
    Icon: MapPin,
    title: "Per-state availability",
    body:
      "Inshur is licensed state by state. Drive247 will keep the list of states you can write cover in up to date for you.",
  },
  {
    Icon: Receipt,
    title: "You absorb it, or the renter pays",
    body:
      "Choose whether the premium is a cost of doing business or a line the renter is charged — set once, applied automatically.",
  },
  {
    Icon: ShieldCheck,
    title: "Eligibility checked before you commit",
    body:
      "Vehicles are checked against Inshur's rules before cover is created, so you find out up front rather than at claim time.",
  },
];

export default function InshurPanel(_props: IntegrationPanelProps) {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Inshur is fleet insurance for the vehicles themselves. Where{" "}
        <span className="font-medium text-foreground">Bonzah</span> covers a single rental while
        the renter has the car, Inshur is the policy underneath your whole fleet — the cover that
        applies when a vehicle is parked, being moved, or between bookings.
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

      {/* No date. The integration is in commercial discussion, not in a release
          queue, and a month named here becomes a promise the operator repeats
          to their own customers. */}
      <PanelNote>
        Inshur is not available to connect yet. We will let you know as soon as it is — there is
        nothing you need to do in the meantime, and your Bonzah cover is unaffected.
      </PanelNote>

      <PanelLink href="https://www.inshur.com">Learn more about Inshur</PanelLink>
    </div>
  );
}
