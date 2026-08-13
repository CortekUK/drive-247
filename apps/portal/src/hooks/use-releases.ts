'use client';

/**
 * Tracks which releases this person has already seen.
 *
 * Stored per-user in localStorage rather than in the database, on purpose:
 * "have I read the release note" is a personal, low-stakes fact. Putting it in
 * a table would mean a migration, an RLS policy, a write on every dismissal and
 * a loading state before we can decide whether to show a modal — all to
 * remember something that does not matter if it is occasionally forgotten.
 *
 * The failure mode is deliberately gentle: if storage is unavailable or gets
 * cleared, the worst outcome is that someone sees a release note twice.
 */

import { useCallback, useEffect, useState } from 'react';

import { RELEASES, latestRelease, type Release } from '@/lib/releases';

const SEEN_KEY = 'portal:releases:seen';
const MODAL_KEY = 'portal:releases:modal-shown-week';

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    /* storage disabled — the panel simply keeps showing the dot */
  }
}

/** ISO week key, e.g. "2026-W33". The unit the modal cap is enforced in. */
function currentWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // Thursday of the current week determines the ISO year.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

export function useReleases() {
  const [seen, setSeen] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [modalRelease, setModalRelease] = useState<Release | null>(null);

  useEffect(() => {
    const stored = readSeen();
    setSeen(stored);
    setHydrated(true);

    const latest = latestRelease();
    if (!latest || stored.includes(latest.id)) return;

    // The cap that makes frequent shipping tolerable: at most ONE modal per
    // week, however many times we deploy. Three releases in a week become one
    // combined summary rather than three interruptions.
    let shownWeek: string | null = null;
    try {
      shownWeek = localStorage.getItem(MODAL_KEY);
    } catch {
      /* ignore */
    }

    if (shownWeek !== currentWeekKey(new Date())) {
      setModalRelease(latest);
    }
  }, []);

  const unreadCount = hydrated
    ? RELEASES.filter((release) => !seen.includes(release.id)).length
    : 0;

  const markSeen = useCallback((id: string) => {
    setSeen((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      writeSeen(next);
      return next;
    });
  }, []);

  const markAllSeen = useCallback(() => {
    const all = RELEASES.map((r) => r.id);
    setSeen(all);
    writeSeen(all);
  }, []);

  /**
   * Close the weekly modal. Records the week regardless of *how* it was
   * dismissed — "Later" must not mean "ask me again on the next page load".
   */
  const dismissModal = useCallback((markRead: boolean) => {
    try {
      localStorage.setItem(MODAL_KEY, currentWeekKey(new Date()));
    } catch {
      /* ignore */
    }
    setModalRelease((current) => {
      if (current && markRead) markSeen(current.id);
      return null;
    });
  }, [markSeen]);

  return {
    releases: RELEASES,
    seen,
    unreadCount,
    modalRelease,
    dismissModal,
    markSeen,
    markAllSeen,
  };
}
