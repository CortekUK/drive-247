'use client';

/**
 * A notice that survives this page being torn down and rebuilt.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `supabase.auth.updateUser()` — the call behind BOTH "change password" and
 * "change email" — emits a `USER_UPDATED` event. `customer-auth-store`'s
 * listener responds to every non-`TOKEN_REFRESHED` event by setting
 * `membershipResolved: false` and re-reading the customer row, which flips
 * `useCustomerAuth().isLoading` to true; `(portal)/layout.tsx` then renders
 * `PortalBoot` INSTEAD OF its children until the re-read lands.
 *
 * So this page unmounts a tick after a successful password or email change and
 * comes back a moment later as a fresh component with fresh `useState`. Put the
 * "Password changed" message in state and the customer sees the form vanish,
 * a spinner, and then a settings page that looks exactly as it did before —
 * with no evidence anything happened. Verified in the browser, not reasoned
 * about.
 *
 * `sessionStorage` is the right store for it: the message belongs to this tab
 * and this visit, must not outlive the tab, and must not be shared with any
 * other one. It is read once and deleted, so a reload does not resurrect a
 * stale "Password changed" from ten minutes ago.
 *
 * THE REAL FIX is in the store — `USER_UPDATED` should early-return exactly as
 * `TOKEN_REFRESHED` does, since neither changes which customer is signed in.
 * That file is not this task's to edit; when it lands, this module can go and
 * the page can hold its notices in ordinary state.
 *
 * Every access is wrapped: `sessionStorage` THROWS on access (not returns null)
 * in a browser configured to block site data, and an unhandled throw here would
 * take the whole settings page down over a status message.
 */

const STORAGE_KEY = 'drive247:portal-settings-notice';

export type NoticeTone = 'success' | 'info' | 'danger';

export interface Notice {
  tone: NoticeTone;
  message: string;
}

function isNotice(value: unknown): value is Notice {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === 'string' &&
    (candidate.tone === 'success' ||
      candidate.tone === 'info' ||
      candidate.tone === 'danger')
  );
}

/** Park a notice for the component instance that replaces this one. */
export function parkNotice(notice: Notice): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(notice));
  } catch {
    // Storage unavailable. The notice is lost, which is a worse message but not
    // a broken page — and the caller has already done the work it describes.
  }
}

/**
 * Take the parked notice, if there is one. Reading REMOVES it, so it is shown
 * exactly once.
 */
export function takeNotice(): Notice | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed: unknown = JSON.parse(raw);
    return isNotice(parsed) ? parsed : null;
  } catch {
    // Malformed JSON from a previous version, or storage blocked. Drop it and
    // try to clear it so it cannot fail on every subsequent mount.
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing further to do */
    }
    return null;
  }
}
