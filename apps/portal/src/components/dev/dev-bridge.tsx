"use client";

/**
 * The Northwind end of the super-admin Developer page (apps/admin
 * /admin/developer), which replaced this portal's `/dev` page.
 *
 * The admin app is a different site, so it cannot touch this portal's browser
 * storage. Instead it writes to `public.dev_signup_rehearsal`, and this
 * component — mounted in the v2 top bar, rendering nothing — reads that row
 * every few seconds while the tab is visible and carries it out here:
 *
 *   portal_command   one-shot: `first_run` (clear the tour + checklist state,
 *                    then a hard reload of the dashboard — the server already
 *                    deleted the first-run row) or `quick_tour` (replay it).
 *                    Run once per command id, and only within ten minutes of
 *                    being sent, so an old command never fires on a tab opened
 *                    days later.
 *   portal_previews  copied into lib/dev-overrides.ts's storage. Those setters
 *                    are no-ops outside `next dev`, so on the live portal this
 *                    half does nothing at all.
 *
 * THE GATE is `tenant.slug === NORTHWIND`, the row that actually came back —
 * the same gate the old page used. Every other tenant renders nothing and
 * never queries. The table's RLS also limits reads to northwind staff and
 * super admins.
 */

import { useEffect } from "react";

import { useTenant } from "@/contexts/TenantContext";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { NORTHWIND } from "@/lib/v2";
import { clearChecklistState, clearTourSeenFlags, replayTour } from "@/lib/dev-actions";
import {
  BILLING_SCENARIOS,
  EMPTY_STATE_PAGES,
  MESSAGE_SCENARIOS,
  isEmptyStatePageId,
  setAllEmptyStatesForced,
  setBillingSampleData,
  setBillingScenario,
  setEmptyStateForced,
  setHoldSkeletons,
  setMessagesScenario,
  type BillingScenarioId,
  type MessagesScenarioId,
} from "@/lib/dev-overrides";

const POLL_MS = 5_000;
const COMMAND_TTL_MS = 10 * 60 * 1000;
const LAST_COMMAND_KEY = "d247.dev.lastCommand";
const LAST_PREVIEWS_KEY = "d247.dev.lastPreviews";
const REPLAY_ON_LOAD_KEY = "d247.dev.replayTourOnLoad";
/** Long enough for the dashboard's tour to mount and find its anchors. */
const REPLAY_DELAY_MS = 1_500;

type Command = { id?: unknown; action?: unknown; at?: unknown } | null;
type Previews = {
  holdSkeletons?: unknown;
  messagesScenario?: unknown;
  billingScenario?: unknown;
  billingSampleData?: unknown;
  emptyStates?: unknown;
} | null;

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function applyCommand(command: Command, tenantId: string): void {
  if (!command || typeof command.id !== "string") return;
  const local = storage("local");
  if (!local || local.getItem(LAST_COMMAND_KEY) === command.id) return;
  // Recorded BEFORE acting: the first-run action reloads the page, and an
  // unrecorded command would run again on the reload, for ever.
  local.setItem(LAST_COMMAND_KEY, command.id);

  const sentAt = typeof command.at === "string" ? Date.parse(command.at) : NaN;
  if (!Number.isFinite(sentAt) || Date.now() - sentAt > COMMAND_TTL_MS) return;

  if (command.action === "first_run") {
    clearTourSeenFlags();
    clearChecklistState(tenantId);
    window.location.assign("/");
  } else if (command.action === "quick_tour") {
    if (window.location.pathname === "/") {
      replayTour();
    } else {
      storage("session")?.setItem(REPLAY_ON_LOAD_KEY, "1");
      window.location.assign("/");
    }
  }
}

function applyPreviews(previews: Previews): void {
  if (process.env.NODE_ENV !== "development") return;
  const local = storage("local");
  const p = previews ?? {};
  const snapshot = JSON.stringify(p);
  if (!local || local.getItem(LAST_PREVIEWS_KEY) === snapshot) return;
  local.setItem(LAST_PREVIEWS_KEY, snapshot);

  const messageIds: readonly string[] = MESSAGE_SCENARIOS.map((s) => s.id);
  const billingIds: readonly string[] = BILLING_SCENARIOS.map((s) => s.id);

  setHoldSkeletons(p.holdSkeletons === true);
  setMessagesScenario(
    (typeof p.messagesScenario === "string" && messageIds.includes(p.messagesScenario)
      ? p.messagesScenario
      : "off") as MessagesScenarioId,
  );
  setBillingScenario(
    (typeof p.billingScenario === "string" && billingIds.includes(p.billingScenario)
      ? p.billingScenario
      : "off") as BillingScenarioId,
  );
  setBillingSampleData(p.billingSampleData === true);

  const wanted = Array.isArray(p.emptyStates) ? p.emptyStates.filter(isEmptyStatePageId) : [];
  if (wanted.length === EMPTY_STATE_PAGES.length) {
    setAllEmptyStatesForced(true);
  } else {
    setAllEmptyStatesForced(false);
    for (const id of wanted) setEmptyStateForced(id, true);
  }
}

export function DevBridge() {
  const { tenant } = useTenant();
  const tenantId = tenant?.slug === NORTHWIND ? tenant.id : null;

  useEffect(() => {
    if (!tenantId) return;

    const session = storage("session");
    if (session?.getItem(REPLAY_ON_LOAD_KEY)) {
      session.removeItem(REPLAY_ON_LOAD_KEY);
      window.setTimeout(() => replayTour(), REPLAY_DELAY_MS);
    }

    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const { data, error } = await supabaseUntyped
          .from("dev_signup_rehearsal")
          .select("portal_command, portal_previews")
          .eq("id", 1)
          .maybeSingle();
        if (stopped || error || !data) return;
        applyPreviews(data.portal_previews as Previews);
        applyCommand(data.portal_command as Command, tenantId);
      } catch {
        // A developer convenience; never let it surface on the page.
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [tenantId]);

  return null;
}
