/**
 * The ALL-TENANTS confirmation, and the frequency note in each list row's stats tooltip.
 *
 * Why (Sep 17 2026): a test banner ("maintenanec") went live for All tenants and real
 * customers' staff saw it. Saving or switching on any ACTIVE SYSTEM announcement whose
 * audience is All tenants now asks first, whatever its display (dialog or banner) and
 * blocking (soft or hard). The older hard + All tenants question ("Block every tenant?")
 * is the same dialog with a harder title. Features are canary-only, so they never ask.
 *
 * RELATIVE imports only: the scratchpad node tests bundle this file without the app's
 * `@/` alias.
 */

import type {
  AdminAnnouncementRow,
  AdminAnnouncementStats,
  AnnouncementKind,
  Audience,
  Blocking,
  SystemDisplay,
} from './contract';
import { SHOW_AGAIN_CONFIRM_DESCRIPTION, showAgainConfirmTitle } from './row-actions';

// ─── When to ask ─────────────────────────────────────────────────────────────

export interface AllTenantsSubject {
  kind: AnnouncementKind;
  audience: Audience;
  /** The state the write would leave it in (for the Active switch: the NEW value). */
  is_active: boolean;
  blocking: Blocking;
  display: SystemDisplay | null;
}

/**
 * True when a write leaves a SYSTEM announcement ACTIVE for ALL tenants: saving one from the
 * editor, switching one on in the list, or showing one again. Switching one off never asks.
 */
export function needsAllTenantsConfirm(row: Pick<AllTenantsSubject, 'kind' | 'audience' | 'is_active'>): boolean {
  return row.kind === 'system' && row.audience === 'all' && row.is_active === true;
}

/**
 * What the admin agreed to. A confirmation only covers the save it was asked for: if the
 * draft changed in a way that changes the question (blocking, display, audience, active)
 * before the confirmed save runs, it asks again.
 */
export function allTenantsConfirmKey(row: AllTenantsSubject): string {
  return [row.kind, row.audience, row.is_active ? 'on' : 'off', row.blocking, row.display ?? '-'].join('|');
}

// ─── N active tenants ────────────────────────────────────────────────────────

/**
 * The number of ACTIVE tenants (status 'active': the only portals that load) from the stats
 * already on the page. For an All tenants row, `reachable_tenants` counts exactly those, and
 * it is the same for every All tenants row, so any one of them will do. Both shapes of the
 * stats function return it (the old nine-column one still in production, and the new one).
 * null when stats are unavailable or no All tenants row has a stats row yet.
 */
export function activeTenantCountFromStats(
  rows: ReadonlyArray<Pick<AdminAnnouncementRow, 'id' | 'audience'>>,
  statsById: Readonly<Record<string, AdminAnnouncementStats>> | null,
): number | null {
  if (!statsById) return null;
  for (const row of rows) {
    if (row.audience !== 'all') continue;
    const stats = statsById[row.id];
    if (stats && typeof stats.reachable_tenants === 'number' && isFinite(stats.reachable_tenants) && stats.reachable_tenants >= 0) {
      return Math.floor(stats.reachable_tenants);
    }
  }
  return null;
}

/** The fallback: the tenants the picker already loads, counted the way the stats count them. */
export function countActiveTenants(tenants: ReadonlyArray<{ status: string | null }>): number {
  let n = 0;
  for (const t of tenants) if (t.status === 'active') n += 1;
  return n;
}

// ─── Wording ─────────────────────────────────────────────────────────────────

export type AllTenantsAction = 'save' | 'activate';

export interface ConfirmCopy {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
}

/** "This shows on every tenant's portal, including customers (N active tenants)." */
export function allTenantsReachSentence(count: number | null): string {
  const n = count === null || !isFinite(count) || count < 0 ? null : Math.floor(count);
  return (
    "This shows on every tenant's portal, including customers" +
    (n === null ? '' : ' (' + n + (n === 1 ? ' active tenant' : ' active tenants') + ')') +
    '.'
  );
}

/**
 * The one confirmation for an active system announcement for All tenants.
 * - soft (dialog or banner): the reach sentence, "Continue?"
 * - hard dialog: titled "Block every tenant?", says it blocks every portal, destructive button
 * - hard banner: says nobody can close it, destructive button
 */
export function allTenantsConfirmCopy(
  subject: Pick<AllTenantsSubject, 'blocking' | 'display'>,
  action: AllTenantsAction,
  count: number | null,
): ConfirmCopy {
  const hard = subject.blocking === 'hard';
  const hardDialog = hard && subject.display !== 'banner';
  const extra = !hard
    ? ''
    : hardDialog
      ? ' It blocks every portal until you turn it off.'
      : ' Nobody can close it; it stays until you turn it off.';
  return {
    title: hardDialog ? 'Block every tenant?' : "Show on every tenant's portal?",
    description: allTenantsReachSentence(count) + extra + ' Continue?',
    confirmLabel:
      action === 'save'
        ? hardDialog
          ? 'Save and block'
          : 'Save for all tenants'
        : hardDialog
          ? 'Turn on and block'
          : 'Turn on for all tenants',
    destructive: hard,
  };
}

// ─── Show again ──────────────────────────────────────────────────────────────

/**
 * The Show again confirmation. Show again re-saves the row, so for an active system
 * announcement for All tenants the same question is folded into it (one dialog, never two).
 */
export function showAgainConfirmCopy(
  row: Pick<AdminAnnouncementRow, 'title' | 'kind' | 'audience' | 'is_active'>,
  count: number | null,
): { title: string; description: string; confirmLabel: string } {
  const everyTenant = needsAllTenantsConfirm(row);
  return {
    title: showAgainConfirmTitle(row.title),
    description: SHOW_AGAIN_CONFIRM_DESCRIPTION + (everyTenant ? ' ' + allTenantsReachSentence(count) + ' Continue?' : ''),
    confirmLabel: 'Show again',
  };
}

// ─── The frequency note in every row's stats tooltip ─────────────────────────

export interface FrequencyNote {
  /** What happens after someone closes it. */
  lead: string;
  /**
   * The pointer to the row's Show again button, split around its name so the tooltip can
   * draw the button's icon beside it. null for hard items (nothing to show again).
   */
  showAgain: { before: string; after: string } | null;
}

/**
 * Every row's tooltip says what its frequency means. The one that matters most is "Once":
 * people who closed it never see it again (the user's "only two of them are showing"), and
 * the Show again button is how to bring it back for them.
 */
export function frequencyNote(
  row: Pick<AdminAnnouncementRow, 'kind' | 'blocking' | 'repeat_after_days' | 'is_active'>,
): FrequencyNote {
  const isFeature = row.kind === 'feature';
  if (!isFeature && row.blocking === 'hard') {
    return { lead: 'Hard: it shows every time and nobody can close it, so there is nothing to show again.', showAgain: null };
  }
  const days = row.repeat_after_days;
  const lead =
    days === null
      ? isFeature
        ? 'Once: people who closed the dialog will not see it open again (the card stays on their dashboard).'
        : 'Once: people who closed it will not see it again.'
      : (isFeature ? 'The dialog opens again ' : 'It shows again ') +
        (days === 1 ? '1 day' : days + ' days') +
        ' after someone closes it.';
  const before =
    (days === null ? 'To show it to them again, ' : 'To show it to everyone who closed it sooner, ') +
    (row.is_active ? 'use ' : 'turn it on, then use ');
  return { lead, showAgain: { before, after: ' on this row.' } };
}

/** The note as plain text ("… use Show again on this row."). */
export function frequencyNoteText(note: FrequencyNote): string {
  return note.lead + (note.showAgain ? ' ' + note.showAgain.before + 'Show again' + note.showAgain.after : '');
}
