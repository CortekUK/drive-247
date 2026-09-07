// ── Integration panel registry ────────────────────────────────────────────────
//
// Maps a board card's `name` to the pair of components that own it. This file
// and `_kit.tsx` are the only two under `_panels/` that more than one piece of
// work touches, which is why both are written once, up front, and left alone:
// V2_PLAN §2 forbids two in-flight changes sharing a file, and seven panels
// being built in parallel is exactly that hazard.
//
// Statically imported rather than `lazy()`-loaded on purpose. The board renders
// every card's `StatusChip` on first paint, so a lazy panel would suspend the
// whole grid to answer a question each chip can answer for itself.
//
// A card with no entry here keeps the board's generic body — an absent entry
// is a card without a manager, never a broken one. Today every card has one.

import type { IntegrationPanelEntry } from "./_kit";

import TuroSyncPanel, { TuroSyncStatus } from "./turo-sync";
import StripeConnectPanel, { StripeConnectStatus } from "./stripe-connect";
import SquarePanel, { SquareStatus } from "./square";
import BonzahPanel, { BonzahStatus } from "./bonzah";
import InshurPanel, { InshurStatus } from "./inshur";
import CheckMyDriverPanel, { CheckMyDriverStatus } from "./checkmydriver";
import BoldSignPanel, { BoldSignStatus } from "./boldsign";
import TwilioMessagesPanel, { TwilioMessagesStatus } from "./twilio-messages";
import TwilioCallingPanel, { TwilioCallingStatus } from "./twilio-calling";
import XeroPanel, { XeroStatus } from "./xero";
import ZohoPanel, { ZohoStatus } from "./zoho";
import TeslaPanel, { TeslaStatus } from "./tesla";
import CustomDomainPanel, { CustomDomainStatus } from "./custom-domain";

/** Keyed by the exact `name` on the board's `integrations` list. */
export const INTEGRATION_PANELS: Record<string, IntegrationPanelEntry> = {
  // Preview only — describes the integration and connects nothing. See the
  // header of `turo-sync.tsx` for why that is what makes the card safe to ship
  // while the feature itself is still on a branch.
  "Turo Sync": { Panel: TuroSyncPanel, StatusChip: TuroSyncStatus },
  "Stripe Connect": { Panel: StripeConnectPanel, StatusChip: StripeConnectStatus },
  Square: { Panel: SquarePanel, StatusChip: SquareStatus },
  Bonzah: { Panel: BonzahPanel, StatusChip: BonzahStatus },
  Inshur: { Panel: InshurPanel, StatusChip: InshurStatus },
  CheckMyDriver: { Panel: CheckMyDriverPanel, StatusChip: CheckMyDriverStatus },
  BoldSign: { Panel: BoldSignPanel, StatusChip: BoldSignStatus },
  "Twilio Messages": { Panel: TwilioMessagesPanel, StatusChip: TwilioMessagesStatus },
  "Twilio Calling": { Panel: TwilioCallingPanel, StatusChip: TwilioCallingStatus },
  Xero: { Panel: XeroPanel, StatusChip: XeroStatus },
  Zoho: { Panel: ZohoPanel, StatusChip: ZohoStatus },
  Tesla: { Panel: TeslaPanel, StatusChip: TeslaStatus },
  "Custom Domain": { Panel: CustomDomainPanel, StatusChip: CustomDomainStatus },
};

export function panelFor(name: string): IntegrationPanelEntry | undefined {
  return INTEGRATION_PANELS[name];
}
