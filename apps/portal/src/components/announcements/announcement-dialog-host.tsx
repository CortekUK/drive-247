"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/stores/auth-store";
import { usePortalAnnouncements } from "@/hooks/use-portal-announcements";
import {
  readAnnouncementDomBlocked,
  useAnnouncementBlocked,
} from "@/hooks/use-announcement-blocked";
import { pickAnnouncementDialog, type DialogPick } from "@/lib/announcements/queue";
import { ANNOUNCEMENT_SETTLE_MS, type PortalAnnouncement } from "@/lib/announcements/contract";
import { SystemAnnouncementDialog } from "@/components/announcements/system-announcement-dialog";
import { FeatureAnnouncementDialog } from "@/components/announcements/feature-announcement-dialog";

type OpenPick = NonNullable<DialogPick>;

const pickKey = (pick: DialogPick) =>
  pick ? `${pick.variant}:${pick.announcement.id}:${pick.announcement.revision}` : null;

/**
 * The one place an announcement DIALOG opens by itself. At most one at a time, in
 * both chromes, mounted once at the end of the dashboard layout.
 *
 * WHAT OPENS is `pickAnnouncementDialog` (lib/announcements/queue.ts): a hard system
 * blocker first, then a due soft system dialog, then (dashboard only, v2 only) a due
 * feature. This component only decides WHEN.
 *
 * WHEN.
 *   - Never while anything else owns the screen (`useAnnouncementBlocked`: the paywall,
 *     the migration blocker, the first-run wizard and tours, feedback, any other
 *     modal). Code-driven gates always win.
 *   - Only after a quiet ANNOUNCEMENT_SETTLE_MS once nothing blocks, measured again
 *     after mount, after every route change and after every blocker clears. That
 *     gives the gates and the tour (700ms autostart) time to claim the screen first,
 *     and re-checks the DOM right before opening.
 *   - Soft dialogs do not chain: once a soft or feature dialog has opened in this
 *     "moment" (app load, or a client route change), the next one waits for the next
 *     moment. Three dialogs in a row on login is exactly what the meeting ruled out.
 *     Hard blockers are not limited.
 *
 * WHILE OPEN it yields, with NO event recorded (the user never acknowledged it):
 *   - to a gate, tour or modal that appears (it comes back after the settle);
 *   - when its row goes away (deactivated, tenant left the smart filter), stops being
 *     due, or a hard one becomes exempt (/settings, /subscription, /credits, or its own
 *     button's page);
 *   - a soft or feature dialog also yields to a hard blocker that arrives mid-session.
 * An open hard blocker swaps to a different hard one that now ranks first.
 *
 * Events: `shown` on open; soft close `dismissed`; the button `cta_clicked` (on a soft
 * item that also counts as closing); "Don't show again" `dont_show_again`.
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
  const { system, features, featuresEnabled, recordEvent } = usePortalAnnouncements();

  const [current, setCurrent] = useState<OpenPick | null>(null);
  const [moment, setMoment] = useState(0);
  const [softMoment, setSoftMoment] = useState<number | null>(null);

  const blocked = useAnnouncementBlocked({ showGate, ownDialogOpen: current !== null });

  // A new moment on mount and on every client route change.
  useEffect(() => {
    setMoment((m) => m + 1);
  }, [pathname]);

  const softMomentAvailable = softMoment !== moment;

  const input = {
    system,
    features,
    featuresEnabled,
    pathname,
    isSubscriptionPage,
    blocked,
    softMomentAvailable,
  };
  const latest = useRef(input);
  latest.current = input;

  const open = useCallback(
    (pick: OpenPick) => {
      setCurrent(pick);
      if (pick.variant !== "system-hard") setSoftMoment(moment);
      recordEvent(pick.announcement, "shown");
    },
    [moment, recordEvent],
  );
  const openRef = useRef(open);
  openRef.current = open;

  // ── Opening: settle, then re-check and re-pick ────────────────────────────────
  const candidate = current || blocked || moment === 0 ? null : pickAnnouncementDialog(input);
  const candidateKey = pickKey(candidate);

  useEffect(() => {
    if (!candidateKey) return;
    const timer = setTimeout(() => {
      const now = latest.current;
      if (now.blocked || readAnnouncementDomBlocked(false)) return;
      const pick = pickAnnouncementDialog({ ...now, blocked: false });
      if (pick) openRef.current(pick);
    }, ANNOUNCEMENT_SETTLE_MS);
    return () => clearTimeout(timer);
    // `pathname` and `blocked` restart the quiet period even when the pick is unchanged.
  }, [candidateKey, pathname, blocked]);

  // ── While open: yield, drop, or swap ──────────────────────────────────────────
  useEffect(() => {
    if (!current) return;
    const yieldSoft = () => {
      setCurrent(null);
      if (current.variant !== "system-hard") setSoftMoment(null);
    };

    if (blocked) {
      yieldSoft();
      return;
    }

    const hardPick = pickAnnouncementDialog({
      system,
      features,
      featuresEnabled,
      pathname,
      isSubscriptionPage,
      blocked: false,
      softMomentAvailable: false,
    });
    const anyHard = system.some((a) => a.display === "dialog" && a.blocking === "hard");

    if (current.variant === "system-hard") {
      if (!hardPick) {
        setCurrent(null);
      } else if (hardPick.announcement.id !== current.announcement.id) {
        setCurrent(hardPick);
        recordEvent(hardPick.announcement, "shown");
      } else if (hardPick.announcement !== current.announcement) {
        setCurrent(hardPick); // same row, refreshed content
      }
      return;
    }

    if (anyHard) {
      yieldSoft();
      return;
    }

    const rows = current.variant === "feature" ? features : system;
    const row = rows.find((a) => a.id === current.announcement.id);
    const stillDue =
      !!row &&
      row.is_due &&
      (current.variant === "feature"
        ? featuresEnabled && pathname === "/" && row.dont_show_again_at === null
        : row.display === "dialog" && row.blocking === "soft");
    if (!stillDue) {
      setCurrent(null);
    } else if (row !== current.announcement) {
      setCurrent({ ...current, announcement: row });
    }
  }, [current, blocked, system, features, featuresEnabled, pathname, isSubscriptionPage, recordEvent]);

  // ── Callbacks ─────────────────────────────────────────────────────────────────
  const close = (a: PortalAnnouncement, event: "dismissed" | "dont_show_again") => {
    recordEvent(a, event);
    setCurrent(null);
  };

  const goTo = (a: PortalAnnouncement, href: string, closeIt: boolean) => {
    recordEvent(a, "cta_clicked");
    if (closeIt) setCurrent(null);
    router.push(href);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  if (!current) return null;
  const a = current.announcement;

  if (current.variant === "feature") {
    return (
      <FeatureAnnouncementDialog
        announcement={a}
        source="auto"
        onClose={() => close(a, "dismissed")}
        onDontShowAgain={() => close(a, "dont_show_again")}
        onCta={(href) => goTo(a, href, true)}
      />
    );
  }

  const hard = current.variant === "system-hard";
  return (
    <SystemAnnouncementDialog
      announcement={a}
      open
      onClose={() => {
        if (!hard) close(a, "dismissed");
      }}
      // A hard blocker stays until its CTA route makes it exempt (it closes itself there).
      onCta={(href) => goTo(a, href, !hard)}
      onSignOut={() => {
        void handleSignOut();
      }}
    />
  );
}
