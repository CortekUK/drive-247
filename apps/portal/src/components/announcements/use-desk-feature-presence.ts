'use client';

import { useEffect, useMemo, useState } from 'react';
import { deskFeatureHintKey, type PortalAnnouncement } from '@/lib/announcements/contract';

/**
 * Should the "On your desk" band hold a feature card, a placeholder for one, or
 * no slot at all?
 *
 * The band is a grid whose column count follows the number of visible cards
 * (`DESK_GRID_CLASSES`): with a feature card it is three across, without one
 * the Checklist and Reminders cards stretch to fill the row. Every row is 352px
 * tall at md+, so this answer only ever changes column WIDTHS. The job here is
 * to make that change at most once, at the moment it is least disruptive:
 *
 *   'deck'      render the feature card (the read settled with features);
 *   'skeleton'  still loading, and this user's desk showed a feature card last
 *               time: hold a 352px placeholder where it will land;
 *   'none'      no slot: nothing to show, the read failed, or still loading
 *               for a user whose desk had no card last time (or no record).
 *
 * THE HINT. A per-user, per-tenant "0"/"1" in localStorage
 * (`deskFeatureHintKey`), written after every settled read. It is a layout
 * hint only, never dismissal state: getting it wrong costs one reflow, and a
 * throwing or absent storage simply behaves as "no record".
 *
 * THE LATCH, for polls and focus refetches while the dashboard stays open:
 *   - a card that disappears (the super admin deactivated the last feature)
 *     is removed at once; showing a feature nobody can open any more is worse
 *     than a reflow;
 *   - a card that appears AFTER the band has settled on 'none' in this mount is
 *     held back until the next time the dashboard mounts, so a new feature
 *     never shoves the checklist sideways mid-read.
 * The first settled read of a mount is not held back: a band that was waiting
 * on 'none' with no hint inserts the card once, which is the one reflow the
 * hint exists to avoid next time.
 *
 * An 'error' read also settles the band on 'none' (and writes no hint, so one
 * failed read does not teach the next visit that there are no features).
 */

export type DeskFeaturePresence = 'deck' | 'skeleton' | 'none';

function readHint(key: string | null): '0' | '1' | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    return value === '1' || value === '0' ? value : null;
  } catch {
    return null;
  }
}

function writeHint(key: string, value: '0' | '1'): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* a full or blocked storage only costs the hint */
  }
}

export function useDeskFeaturePresence(
  state: { status: 'loading' | 'error' | 'ready'; features: PortalAnnouncement[] },
  tenantId?: string,
  appUserId?: string,
): DeskFeaturePresence {
  const key = tenantId && appUserId ? deskFeatureHintKey(tenantId, appUserId) : null;
  // Read once per user; only the loading branch uses it.
  const hint = useMemo(() => readHint(key), [key]);
  const [settledOnNone, setSettledOnNone] = useState(false);

  const hasFeatures = state.features.length > 0;

  let presence: DeskFeaturePresence;
  if (state.status === 'ready') presence = hasFeatures ? 'deck' : 'none';
  else if (state.status === 'error') presence = 'none';
  else presence = hint === '1' ? 'skeleton' : 'none';

  const settled = state.status !== 'loading';
  // Latched during render, not in an effect, so the frame that would have
  // inserted a late card never paints.
  if (settledOnNone && presence === 'deck') presence = 'none';
  if (settled && presence === 'none' && !settledOnNone) setSettledOnNone(true);

  useEffect(() => {
    if (state.status !== 'ready' || !key) return;
    writeHint(key, hasFeatures ? '1' : '0');
  }, [state.status, hasFeatures, key]);

  return presence;
}
