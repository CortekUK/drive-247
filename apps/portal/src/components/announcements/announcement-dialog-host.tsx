"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/stores/auth-store";
import { usePortalAnnouncements } from "@/hooks/use-portal-announcements";
import {
  readAnnouncementDomBlocked,
  useAnnouncementBlocked,
  type AnnouncementBlocked,
} from "@/hooks/use-announcement-blocked";
import {
  hasHardSystemDialog,
  pickAnnouncementDialogs,
  pickSystemDialogs,
  type DialogQueueInput,
  type DialogSlotPick,
} from "@/lib/announcements/queue";
import { ANNOUNCEMENT_SETTLE_MS, type PortalAnnouncement } from "@/lib/announcements/contract";
import {
  setSystemAnnouncementPriority,
  type SystemAnnouncementPriority,
} from "@/lib/announcements/system-priority";
import { SystemAnnouncementDialog } from "@/components/announcements/system-announcement-dialog";
import { FeatureAnnouncementDialog } from "@/components/announcements/feature-announcement-dialog";

/**
 * How long onboarding that opens by itself waits for the FIRST announcements read, so a
 * system dialog due on arrival goes first instead of the wizard or the tour flashing up
 * and stepping aside a moment later. A read that takes longer than this (or fails) no
 * longer holds onboarding: it steps aside if a system dialog turns out to be due.
 */
export const ANNOUNCEMENT_READ_WAIT_MS = 4000;

type SlotInput = Omit<DialogQueueInput, "blocked">;

/** What is open: the system pager (its pages are derived from the live rows), or one feature. */
type OpenDialog = { variant: "system" } | { variant: "feature"; announcement: PortalAnnouncement };

interface PagePosition {
  /** The page showing, by id, so a poll that adds or re-orders rows never moves it. */
  id: string | null;
  /** Where it was: after it leaves (closed, deactivated), the item now at this place takes over. */
  index: number;
  /** The pages' ids (newline-joined) then. A list sharing none of them starts from page 1. */
  ids: string;
  /** The HARD pages' ids then. A hard item that arrives while open takes the page. */
  hard: string;
}

// The layout is a client component that still server-renders.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const FIRST_PAGE: PagePosition = { id: null, index: 0, ids: "", hard: "" };
const splitIds = (joined: string) => (joined ? joined.split("\n") : []);
const tagOf = (a: PortalAnnouncement) => `${a.id}:${a.revision}`;

/**
 * The slot, with each kind of dialog held to its OWN blockers: the system pager waits
 * only for what outranks it (code gates, the operator's own modals, a tour they are
 * running), a feature dialog also waits for every onboarding surface.
 */
function pickUnblocked(i: SlotInput, blocked: AnnouncementBlocked): DialogSlotPick {
  const pick = pickAnnouncementDialogs({ ...i, blocked: blocked.system });
  return pick && pick.variant === "feature" && blocked.feature ? null : pick;
}

const slotKey = (pick: DialogSlotPick) =>
  !pick
    ? null
    : pick.variant === "system"
      ? `system:${pick.items.map(tagOf).join("|")}`
      : `feature:${tagOf(pick.announcement)}`;

/**
 * The one place an announcement DIALOG opens by itself. At most one modal at a time,
 * in both chromes, mounted once at the end of the dashboard layout.
 *
 * WHAT OPENS is `pickAnnouncementDialogs` (lib/announcements/queue.ts):
 *   - SYSTEM dialogs as ONE dialog with a pager: every hard one (not exempt on this
 *     route) first, then every due soft one, each in drag order. It opens on page 1 and
 *     never pages by itself. A soft page's Got it / X / Escape / outside click records
 *     `dismissed` for THAT item and the next remaining item takes the page; the dialog
 *     closes only when nothing remains. A hard page cannot be closed (Sign out, as
 *     before); while any hard item remains the dialog stays, but the operator can page
 *     to the soft items and dismiss those. A hard item that arrives while it is open
 *     takes the page. One item looks exactly as it always did (no pager).
 *   - otherwise (dashboard only, v2 only) a due FEATURE, on its own, and only if no
 *     soft dialog has opened in this "moment" (app load or client route change), so
 *     features never chain behind a notice. System dialogs are not limited by moments:
 *     the pager replaces chaining.
 *
 * WHEN (strict priority, team lead + user, Sep 17 2026):
 *   1. code gates: the subscription gate, the migration blocker, the feedback dialog, a
 *      modal the operator opened (`useAnnouncementBlocked().system`). Nothing opens over
 *      them; an open dialog yields to them;
 *   2. SYSTEM dialogs;
 *   3. onboarding that opens by itself (the tour's autostart, silent resume and resume
 *      prompt, its transit pill, the first-run wizard and its arrival, the setup
 *      reminder, the welcome-pack prompt). A tour the operator is actively running, or
 *      a wizard they are answering, is not interrupted: the system dialog waits;
 *   4. FEATURE dialogs, which also wait for every onboarding surface
 *      (`useAnnouncementBlocked().feature`) and yield to any system dialog.
 *
 * SYSTEM PRIORITY SIGNAL. So that onboarding can step aside, this host publishes whether
 * a system dialog wants the screen (lib/announcements/system-priority.ts): 'pending'
 * while the first announcements read is still out (at most ANNOUNCEMENT_READ_WAIT_MS)
 * and as soon as the read says one is due (or any hard one applies, even exempt here),
 * 'open' while the pager is on screen, 'idle' otherwise. Onboarding reads it, does not
 * open, and hides (recording nothing) if it was up untouched; it comes back after the
 * close.
 *
 * SETTLE. A dialog opens only after a quiet ANNOUNCEMENT_SETTLE_MS once nothing blocks,
 * measured again after mount, after every route change and after every blocker clears,
 * and the DOM is re-checked right before opening. Onboarding hides in the same commit
 * the signal flips, so the quiet period is spent on an empty screen.
 *
 * WHILE OPEN it yields, with NO event recorded (the user never acknowledged it), to
 * whatever outranks it (it comes back after the settle), and closes by itself when
 * nothing is left to show: every row gone or no longer due, or every hard item exempt
 * on this route (/settings, /subscription, /credits, or its own button's page).
 *
 * Events: `shown` for each page when it is displayed (the data hook counts one per page
 * load); a soft close `dismissed`; the button `cta_clicked` and navigation (a soft item
 * is hidden by the click; the pager stays for whatever remains); "Don't show again"
 * `dont_show_again` (features).
 */
export function AnnouncementDialogHost({
  showGate,
  isSubscriptionPage,
  pathname,
}: {
  showGate: boolean;
  isSubscriptionPage: boolean;
  pathname: string;
}): JSX.Element | null {
  const router = useRouter();
  const { signOut } = useAuth();
  const { status, system, features, featuresEnabled, recordEvent } = usePortalAnnouncements();

  const [current, setCurrent] = useState<OpenDialog | null>(null);
  const [moment, setMoment] = useState(0);
  const [softMoment, setSoftMoment] = useState<number | null>(null);
  const [page, setPage] = useState<PagePosition>(FIRST_PAGE);
  const [turn, setTurn] = useState<1 | -1>(1);

  const blocked = useAnnouncementBlocked({ showGate, ownDialogOpen: current !== null });
  const { system: blockedSystem, feature: blockedFeature } = blocked;

  // A new moment on mount and on every client route change.
  useEffect(() => {
    setMoment((m) => m + 1);
  }, [pathname]);

  const input: SlotInput = {
    system,
    features,
    featuresEnabled,
    pathname,
    isSubscriptionPage,
    softMomentAvailable: softMoment !== moment,
  };
  const latest = useRef({ input, blocked });
  latest.current = { input, blocked };

  /** The system pager's pages right now, blockers aside. */
  const systemItems = pickSystemDialogs(input);
  const anyHardSystem = hasHardSystemDialog(system);

  // ── The system priority signal ────────────────────────────────────────────────
  // The first read, bounded: onboarding does not start before we know.
  const [readWaitOver, setReadWaitOver] = useState(false);
  const firstReadOut = status === "loading" && !readWaitOver;
  useEffect(() => {
    if (status !== "loading" || readWaitOver) return;
    const timer = setTimeout(() => setReadWaitOver(true), ANNOUNCEMENT_READ_WAIT_MS);
    return () => clearTimeout(timer);
  }, [status, readWaitOver]);

  // Published before paint (a layout effect), so an onboarding surface that rendered in
  // the same commit as the rows arriving re-renders hidden before it is ever painted.
  const priority: SystemAnnouncementPriority =
    current?.variant === "system"
      ? "open"
      : firstReadOut || anyHardSystem || systemItems.length > 0
        ? "pending"
        : "idle";

  useIsomorphicLayoutEffect(() => {
    setSystemAnnouncementPriority(priority);
  }, [priority]);
  useIsomorphicLayoutEffect(() => () => setSystemAnnouncementPriority("idle"), []);

  // ── Opening: settle, then re-check and re-pick ────────────────────────────────
  const open = useCallback(
    (pick: NonNullable<DialogSlotPick>) => {
      if (pick.variant === "system") {
        setPage(FIRST_PAGE);
        setTurn(1);
        setCurrent({ variant: "system" });
        return;
      }
      setCurrent({ variant: "feature", announcement: pick.announcement });
      setSoftMoment(moment);
      recordEvent(pick.announcement, "shown");
    },
    [moment, recordEvent],
  );
  const openRef = useRef(open);
  openRef.current = open;

  const candidateKey = current || moment === 0 ? null : slotKey(pickUnblocked(input, blocked));

  useEffect(() => {
    if (!candidateKey) return;
    const timer = setTimeout(() => {
      const now = latest.current;
      const pick = pickUnblocked(now.input, now.blocked);
      if (!pick) return;
      if (readAnnouncementDomBlocked(false, pick.variant)) return;
      openRef.current(pick);
    }, ANNOUNCEMENT_SETTLE_MS);
    return () => clearTimeout(timer);
    // `pathname` and the blockers restart the quiet period even when the pick is unchanged.
  }, [candidateKey, pathname, blockedSystem]);

  // ── While open: yield or close ────────────────────────────────────────────────
  const systemOpen = current?.variant === "system";
  const systemCount = systemItems.length;
  useEffect(() => {
    if (!current) return;

    if (current.variant === "system") {
      // Yields to a gate or modal (comes back after the settle); closes when nothing is left.
      if (blockedSystem || systemCount === 0) setCurrent(null);
      return;
    }

    // A feature yields to anything above it, with no event: every onboarding surface,
    // and any system dialog that wants the screen (hard or soft).
    if (blockedFeature || anyHardSystem || systemCount > 0) {
      setCurrent(null);
      setSoftMoment(null);
      return;
    }
    const row = features.find((a) => a.id === current.announcement.id);
    const stillDue =
      !!row && row.is_due && featuresEnabled && pathname === "/" && row.dont_show_again_at === null;
    if (!stillDue) {
      setCurrent(null);
    } else if (row !== current.announcement) {
      setCurrent({ variant: "feature", announcement: row });
    }
  }, [current, blockedSystem, blockedFeature, anyHardSystem, systemCount, features, featuresEnabled, pathname]);

  // ── The page showing ──────────────────────────────────────────────────────────
  const pageIds = systemItems.map((a) => a.id).join("\n");
  const pageHardIds = systemItems.filter((a) => a.blocking === "hard").map((a) => a.id);
  const pageHard = pageHardIds.join("\n");
  let pageIndex = -1;
  if (systemOpen && systemCount > 0) {
    if (page.id !== null) {
      const hardBefore = splitIds(page.hard);
      const arrived = pageHardIds.find((id) => !hardBefore.includes(id));
      pageIndex = systemItems.findIndex((a) => a.id === (arrived ?? page.id));
    }
    if (pageIndex === -1) {
      const before = splitIds(page.ids);
      const sameList = systemItems.some((a) => before.includes(a.id));
      pageIndex = sameList && page.index < systemCount ? page.index : 0;
    }
    const at = systemItems[pageIndex];
    // Adjusting state from the rows during render: the next render derives the same page.
    if (page.id !== at.id || page.index !== pageIndex || page.ids !== pageIds || page.hard !== pageHard) {
      setPage({ id: at.id, index: pageIndex, ids: pageIds, hard: pageHard });
    }
  }
  const pageItem = pageIndex >= 0 ? systemItems[pageIndex] : null;
  const pageTag = pageItem ? tagOf(pageItem) : null;

  // `shown` for each page as it is displayed: once per item (id + revision) however often
  // it is paged back to. The data hook also de-duplicates per page load.
  const shownRef = useRef<{ recorder: unknown; tags: Set<string> }>({ recorder: null, tags: new Set() });
  useEffect(() => {
    if (!pageItem || !pageTag) return;
    const seen = shownRef.current;
    if (seen.recorder !== recordEvent) {
      // A different tenant or staff user: a fresh session of impressions.
      seen.recorder = recordEvent;
      seen.tags = new Set();
    }
    if (!seen.tags.has(pageTag)) {
      seen.tags.add(pageTag);
      recordEvent(pageItem, "shown");
    }
    // A soft notice was on screen in this moment: a feature waits for the next one.
    if (pageItem.blocking !== "hard") setSoftMoment(moment);
    // `pageItem` is keyed by `pageTag`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageTag, recordEvent]);

  const turnPage = (delta: 1 | -1) => {
    if (systemCount < 2 || pageIndex < 0) return;
    const next = (((pageIndex + delta) % systemCount) + systemCount) % systemCount;
    setTurn(delta);
    setPage({ id: systemItems[next].id, index: next, ids: pageIds, hard: pageHard });
  };

  // ── Callbacks ─────────────────────────────────────────────────────────────────
  const closeFeature = (a: PortalAnnouncement, event: "dismissed" | "dont_show_again") => {
    recordEvent(a, event);
    setCurrent(null);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  if (!current) return null;

  if (current.variant === "feature") {
    const a = current.announcement;
    return (
      <FeatureAnnouncementDialog
        announcement={a}
        source="auto"
        onClose={() => closeFeature(a, "dismissed")}
        onDontShowAgain={() => closeFeature(a, "dont_show_again")}
        onCta={(href) => {
          recordEvent(a, "cta_clicked");
          setCurrent(null);
          router.push(href);
        }}
      />
    );
  }

  if (!pageItem) return null;
  const hard = pageItem.blocking === "hard";
  return (
    <SystemAnnouncementDialog
      announcement={pageItem}
      open
      onClose={() => {
        // A soft page closes THAT item: the data hook hides it at once, and the next
        // remaining item slides into its place (or, with nothing left, the dialog closes).
        if (hard) return;
        setTurn(1);
        recordEvent(pageItem, "dismissed");
      }}
      // A hard item stays until its CTA route makes it exempt; a soft one is hidden by
      // the click, and the next remaining item takes the page.
      onCta={(href) => {
        if (!hard) setTurn(1);
        recordEvent(pageItem, "cta_clicked");
        router.push(href);
      }}
      onSignOut={() => {
        void handleSignOut();
      }}
      pager={
        systemCount > 1
          ? {
              items: systemItems,
              index: pageIndex,
              turn,
              onPrevious: () => turnPage(-1),
              onNext: () => turnPage(1),
            }
          : null
      }
    />
  );
}
