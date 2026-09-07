"use client";

// ── CheckMyDriver — preview only ──────────────────────────────────────────────
//
// A DESCRIPTION, not a connection. This panel reads nothing, writes nothing,
// and calls no edge function.
//
// ⚠️ THIS IS WHY THE CARD IS ALLOWED ON THE CANARY'S BOARD AT ALL.
//
// CheckMyDriver is a gated area (`cmd` in LEAN_HIDDEN_AREAS): for a lean
// tenant `use-cmd-verification` issues no reads, the dashboard checklist rows
// are dropped, and the rental-page verification dialog is hidden. The board
// used to filter this card away too. It no longer does — because a panel that
// only describes the integration cannot reach any of it.
//
// So this file must NOT import `use-cmd-verification`, must NOT import the
// verification dialog or any `components/…/cmd*` surface, and must NOT call
// any of the six `cmd-*` edge functions. If it ever needs to, the card belongs
// back behind `isAreaHidden("cmd", tenantSlug)` in the same commit — the gate
// and the board must move together, never one without the other.

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
import { PanelLink, PanelNote, PanelSection, StatusChip } from "./_kit";
import { BadgeCheck, IdCard, Send, Timer } from "lucide-react";

/**
 * Always the same neutral chip.
 *
 * `disconnected` rather than `attention`: nothing is wrong, and an amber chip
 * on a card the operator cannot act on trains them to ignore the colour on the
 * cards where it does mean something.
 */
export function CheckMyDriverStatus(_props: { tenant: PanelTenant }) {
  return <StatusChip state="disconnected" label="Coming soon" />;
}

/** Drawn from the real implementation — the six `cmd-*` functions and the hook. */
const CAPABILITIES: Array<{ Icon: typeof IdCard; title: string; body: string }> = [
  {
    Icon: Send,
    title: "The renter does the work, not you",
    body:
      "A secure link goes out by email or SMS. They photograph their licence on their own phone; you never handle the document or type anything in.",
  },
  {
    Icon: IdCard,
    title: "Confirms the licence is real and current",
    body:
      "Comes back as Valid, Invalid or Expired, with the licence number, expiry date, holder name and address read straight off the document.",
  },
  {
    Icon: Timer,
    title: "Chases itself",
    body:
      "The link stays live for seven days and can be re-sent in one click. Results arrive on their own — you are not left refreshing a page.",
  },
  {
    Icon: BadgeCheck,
    title: "The answer sits on the rental",
    body:
      "The verdict shows against the customer and their booking, so whoever hands over the keys can see it without going looking.",
  },
];

export default function CheckMyDriverPanel(_props: IntegrationPanelProps) {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-muted-foreground">
        CheckMyDriver verifies that a renter&rsquo;s driving licence is genuine, still valid, and
        belongs to the person in front of you &mdash; before the keys change hands. It replaces
        eyeballing a licence at the counter with a checked answer you can keep on file.
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

      {/* Stated because it decides whether the feature is any use to a given
          operator, and it is cheaper to say here than to discover after
          switching it on. The provider's checks are US licences. */}
      <PanelNote>
        Not available to connect yet &mdash; we will let you know when it is. CheckMyDriver
        verifies US driving licences; renters on a licence issued outside the US will still need
        checking the way you do today.
      </PanelNote>

      <PanelLink href="https://www.checkmydriver.com">Learn more about CheckMyDriver</PanelLink>
    </div>
  );
}
