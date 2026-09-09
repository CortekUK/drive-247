/**
 * The receiving half of the demo signup handoff.
 *
 * apps/web's journey ends by sending the browser to
 * `https://<tenant>.portal.…/?tenant=<slug>&firstrun=1`. This module reads that
 * `firstrun` flag and re-arms the first-run experience — wizard, walkthrough,
 * setup checklist — so the tester arrives as a brand-new operator would.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL, GIVEN /dev ALREADY RESETS
 *
 * It does, and for the documented route it is enough: open
 * `northwind.portal.localhost:4002/dev`, run the journey, come back. The clear
 * and the return happen on one origin.
 *
 * localStorage is per-ORIGIN, though, and `localhost:4002` and
 * `northwind.portal.localhost:4002` are two different origins that look the
 * same in the address bar. Starting from the bare host — the natural thing to
 * type — clears the flags on an origin the handoff never returns to. The
 * operator then lands on a dashboard that still believes it has already shown
 * the wizard and the tour.
 *
 * That is the "sometimes I get the form, sometimes the dashboard" the team lead
 * reported, and why it read as random: it depends on which hostname the run
 * started from, which nobody thinks of as state.
 *
 * Putting the intent in the URL makes the ARRIVING page responsible for its own
 * state. The loop then works from any origin, from a cold browser, and from a
 * fresh profile — which is what "a tester can re-run this freely" requires.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RELOADS RATHER THAN JUST CLEARING
 *
 * By the time this runs the dashboard layout has already mounted the wizard and
 * the tour, and both have decided what they are. Clearing storage underneath
 * them changes nothing: the wizard's query has settled, the tour's one-shot
 * autostart ref is latched. So this clears, then does a HARD load of the same
 * URL with `firstrun` removed.
 *
 * That is the identical discipline `/dev`'s "First-time operator" action uses,
 * and its comment explains why a soft navigation is not good enough: it carries
 * over mounted component state and cached queries, which makes the second run
 * subtly unlike the first — and "subtly unlike the first" is precisely what
 * this whole loop exists to avoid.
 *
 * Stripping the parameter matters as much as the reload. Left in place, every
 * refresh would reset again, so an operator who reloaded mid-wizard would be
 * thrown back to the start with no idea why.
 */

import {
  clearChecklistState,
  clearTourSeenFlags,
  resetFirstRunRow,
  type FirstRunClient,
} from '@/lib/dev-actions';

/** The query parameter apps/web sets on the final handoff. */
export const FIRST_RUN_PARAM = 'firstrun';

/**
 * Does this URL ask for a first run?
 *
 * Accepts only `1`. A bare `?firstrun` or `?firstrun=0` is not an instruction —
 * being strict here keeps a stray parameter from wiping an operator's progress.
 */
export function wantsFirstRun(search: string | null | undefined): boolean {
  if (!search) return false;
  try {
    return new URLSearchParams(search).get(FIRST_RUN_PARAM) === '1';
  } catch {
    return false;
  }
}

/**
 * The same URL with the flag removed, for the reload.
 *
 * `tenant` is deliberately left alone: it is inert, it documents which
 * workspace the handoff was about, and removing it would make the address the
 * operator ends up on differ from the one the journey sent them to for no
 * benefit.
 */
export function urlWithoutFirstRun(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.delete(FIRST_RUN_PARAM);
    // Drop a trailing '?' so the reloaded address is the clean one.
    const query = url.searchParams.toString();
    url.search = query ? `?${query}` : '';
    return url.toString();
  } catch {
    return href;
  }
}

export interface FirstRunHandoffResult {
  /** Storage keys cleared, for the /dev status line and for tests. */
  tourFlags: number;
  checklistKeys: number;
  /** True when `tenant_first_run` does not exist in this database. */
  absent: boolean;
  /** True when RLS let us read the row but not delete it. */
  blocked: boolean;
}

/**
 * Clear every trace of a completed first run for this tenant.
 *
 * Storage first, deliberately. It is synchronous and it is what actually gates
 * the walkthrough, so if the database call is slow or fails the visible half of
 * the reset has still happened.
 *
 * Never throws. This runs on arrival from a signup journey, and an operator who
 * has just paid should not meet an error boundary because a dev-only table is
 * missing — a missing table is not a failure here, it is the normal state of
 * production (`tenant_first_run` has only ever been applied to staging).
 *
 * `blocked` is kept distinct from `absent` for the reason `resetFirstRunRow`
 * spells out: a missing table means the flag cannot exist, while RLS refusing
 * the delete means the flag DOES exist and will still suppress the wizard.
 * Collapsing them would report a successful reset that silently did nothing.
 */
export async function performFirstRunHandoff(
  client: FirstRunClient | null,
  tenantId: string | null | undefined,
): Promise<FirstRunHandoffResult> {
  const tourFlags = clearTourSeenFlags();
  const checklistKeys = tenantId ? clearChecklistState(tenantId) : 0;

  if (!client || !tenantId) {
    return { tourFlags, checklistKeys, absent: false, blocked: false };
  }

  try {
    const result = await resetFirstRunRow(client, tenantId);
    // `=== false`, not `!result.ok`: portal compiles with strictNullChecks off,
    // and under that flag TypeScript narrows a discriminated union only on an
    // equality check, never on truthiness.
    if (result.ok === false) {
      return { tourFlags, checklistKeys, absent: false, blocked: result.reason === 'blocked' };
    }
    return { tourFlags, checklistKeys, absent: result.absent === true, blocked: false };
  } catch {
    // The storage half already succeeded, which is the half the tour reads.
    return { tourFlags, checklistKeys, absent: false, blocked: false };
  }
}
