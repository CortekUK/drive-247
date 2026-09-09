'use client';

/**
 * "Take the tour" — the launch button that sits in a tab's header.
 *
 * Ghulam's spec, in his words: a button somewhere on top of each tab, which the
 * operator opens at their convenience; louder before they have taken that tab's
 * tour, quieter afterwards, and still there if they want it again.
 *
 * NOTE ON THE THIRD STATE. He also mused about removing it after a while, then
 * talked himself out of it in the same breath — "we'll see whether to remove
 * it; it's lying there, it's fine." So removal is NOT implemented, and this
 * comment exists so nobody adds it later believing it was asked for. If it is
 * ever wanted, the honest version is a user-dismissed state like the setup
 * guide's, not a countdown: a control that vanishes on its own takes the door
 * with it, and the only other way back in is the user menu.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A RAW <button> AND NOT A ui-v2 <Button>
 *
 * The three tabs this renders on do not agree on a Button primitive. Rentals is
 * v2 and imports from `ui-v2` (h-9, rounded-4xl); Customers and Vehicles are
 * still the shared v1 list pages and import from `ui` (h-10, rounded-md). One
 * component built on either primitive is visibly the wrong height and the wrong
 * radius on two of the three headers.
 *
 * So it draws itself from tokens and takes its height from a prop, the same
 * dodge `TeachingEmptyState` and `ExplainerChip` already use in this codebase.
 *
 * TWO STYLING TRAPS, both of which bite silently:
 *  - `font-sans` maps to Playfair Display (a serif) in this project's Tailwind
 *    config. Headings use `font-heading`; body text inherits from the themed
 *    body and needs no font class at all. Do not add one here.
 *  - CLAUDE.md's "Portal Design System" section is stale — it names #6366f1,
 *    DM Sans and "no shadows", none of which match the v2 tree. Anything
 *    hand-written from it lands off-hue. These classes use semantic tokens
 *    (`primary`, `muted-foreground`, `border`) so they follow the real theme.
 *
 * ---------------------------------------------------------------------------
 * THE BUTTON MUST NOT OUTRANK THE PAGE'S PRIMARY ACTION
 *
 * "Add Customer", "Add Vehicle" and "New Rental" are the filled controls in
 * these headers. A second filled control beside them gives the header two
 * primaries and the operator no idea which is the job. So the loud state is a
 * TINTED OUTLINE — the established "important but secondary" idiom already used
 * in these exact two headers — and the quiet state drops to ghost weight.
 * Neither state is ever a fill.
 */

import { Compass } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/stores/auth-store';
import { useV2 } from '@/lib/v2-context';
import { isLeanTenant } from '@/lib/lean-areas';
import { cn } from '@/lib/utils';
import {
  hasTakenTabTour,
  runTabTour,
  tabTourVariant,
  takenTabTourVariant,
  type TabTourId,
  type TabTourVariant,
} from '@/lib/tab-tours';

export interface TabTourButtonProps {
  tour: TabTourId;
  /**
   * Match the neighbouring controls. `h-10` on the v1 list headers (Customers,
   * Vehicles), `h-9` on the v2 ones (Rentals).
   */
  size?: 'h-9' | 'h-10';
  className?: string;
}

export function TabTourButton({ tour, size = 'h-10', className }: TabTourButtonProps) {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const hasV2Chrome = useV2('chrome');

  /**
   * Whether they have taken it lives in localStorage, which the server cannot
   * see. Reading it during render would produce different markup on the server
   * and the client and hydrate wrong, so the first paint is always the QUIET
   * state and it brightens in an effect if it turns out to be unseen.
   *
   * That direction matters: the quiet state is the one that is safe to show by
   * mistake for a frame. Starting loud and dimming would flash a "new" badge at
   * every operator who has already taken the tour, on every navigation.
   */
  const [taken, setTaken] = useState(true);

  /**
   * Which tour is available right now — the short empty-tab one, or the full
   * walkthrough that can go inside a record.
   *
   * Read from the DOM after paint, not during render, for two reasons: the rows
   * it looks for have not been fetched on the server, and reading them during
   * render would make the server and client markup disagree.
   */
  const [variant, setVariant] = useState<TabTourVariant>('empty');
  /** What they last saw — drives the LABEL, not the brightness. */
  const [seenVariant, setSeenVariant] = useState<TabTourVariant | null>(null);

  const appUserId = appUser?.id ?? null;

  /**
   * Re-checked when the row count changes, not only on mount.
   *
   * The moment that matters is the one right after an operator adds their first
   * customer: seven steps that were dropped a second ago are now real, and the
   * button has to notice without a reload. `pathname` alone would not catch it —
   * adding a customer happens in a dialog and never changes the route.
   */
  useEffect(() => {
    const check = () => {
      const v = tabTourVariant(tour);
      setVariant(v);
      setTaken(hasTakenTabTour(tour, appUserId, v));
      setSeenVariant(takenTabTourVariant(tour, appUserId));
    };
    check();
    // The list re-renders when its query settles; a MutationObserver on the
    // body catches that without this component having to know whose query it
    // was. Cheap: it only reads attributes, and only re-runs the two lookups
    // above when the subtree actually changes.
    if (typeof MutationObserver === 'undefined') return;
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      // Coalesce a burst of mutations into one read per frame.
      requestAnimationFrame(() => {
        queued = false;
        check();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [tour, appUserId]);

  // Same slug-keyed canary gate as the rest of this feature. Keyed on the SLUG
  // and never on the tenant id: the canary has a different primary key in every
  // environment, so an id-keyed gate resolves to the wrong branch locally with
  // no error and no failed build.
  //
  // Two of the three pages this renders on are shared v1 list pages that all 57
  // tenants load, so this gate is the only thing keeping the button off their
  // screens. It fails CLOSED — an unresolved tenant renders nothing.
  if (!isLeanTenant(tenant?.slug) || !hasV2Chrome) return null;

  return (
    <button
      type="button"
      data-tour="take-tab-tour"
      onClick={() => {
        // Dim it immediately rather than waiting for the run to finish. Someone
        // who starts a tour and closes it on step two has still found the door,
        // and the loud treatment has done its job.
        setTaken(true);
        runTabTour(tour);
      }}
      className={cn(
        'inline-flex shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium',
        'transition-colors focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-ring focus-visible:ring-offset-2',
        size,
        taken
          ? 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
          : 'border-primary/30 bg-primary/5 text-primary hover:border-primary/50 hover:bg-primary/10',
        className,
      )}
    >
      <Compass className="size-4" aria-hidden />
      {/* The label says which tour this is. Someone who took the short version
          on an empty tab and comes back after adding their first record is not
          being offered the same thing again, and "Take the tour" would read as
          a repeat rather than the deeper walkthrough it now is. */}
      <span>
        {seenVariant === 'empty' && variant === 'full'
          ? 'See what is inside'
          : 'Take the tour'}
      </span>
    </button>
  );
}
