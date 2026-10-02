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
  // Live — its panel walks the operator through getting started and hands off
  // to the Turo Sync page. It draws its own screens (see `turo-sync.tsx`).
  "Turo Sync": { Panel: TuroSyncPanel, StatusChip: TuroSyncStatus, ownsScreens: true },
  "Stripe Connect": { Panel: StripeConnectPanel, StatusChip: StripeConnectStatus, ownsScreens: true },
  Square: { Panel: SquarePanel, StatusChip: SquareStatus, ownsScreens: true },
  Bonzah: { Panel: BonzahPanel, StatusChip: BonzahStatus },
  Inshur: { Panel: InshurPanel, StatusChip: InshurStatus },
  CheckMyDriver: { Panel: CheckMyDriverPanel, StatusChip: CheckMyDriverStatus },
  BoldSign: { Panel: BoldSignPanel, StatusChip: BoldSignStatus, ownsScreens: true },
  "Twilio Messages": { Panel: TwilioMessagesPanel, StatusChip: TwilioMessagesStatus, ownsScreens: true },
  "Twilio Calling": { Panel: TwilioCallingPanel, StatusChip: TwilioCallingStatus, ownsScreens: true },
  Xero: { Panel: XeroPanel, StatusChip: XeroStatus, ownsScreens: true },
  Zoho: { Panel: ZohoPanel, StatusChip: ZohoStatus, ownsScreens: true },
  Tesla: { Panel: TeslaPanel, StatusChip: TeslaStatus, ownsScreens: true },
  "Custom Domain": { Panel: CustomDomainPanel, StatusChip: CustomDomainStatus, ownsScreens: true },
};

export function panelFor(name: string): IntegrationPanelEntry | undefined {
  return INTEGRATION_PANELS[name];
}
