/**
 * The setup checklist's compiled default — the rows the card shows when the
 * database has nothing to give it.
 *
 * These four features are the ones that cannot be explained in passing:
 * auto-extension, installments, pay-as-you-go and Bonzah. They are not needed
 * for the main booking flow, but every operator has to sit down with each of
 * them once. Recording that once, instead of walking every new client through
 * it live, is the whole reason the card exists.
 *
 * WHY A COMPILED COPY AT ALL. `public.setup_checklist_items` is applied by hand
 * (ops/setup_checklist_items.sql) and does not exist yet. `useSetupChecklist()`
 * falls back to this list on ANY failure — missing table, RLS refusal, an
 * outage, rows that do not parse — so the card is never blank and never an
 * error. Same contract as `FIRST_RUN_QUESTIONS` in lib/first-run-questions.ts.
 *
 * KEEP THIS IN STEP WITH THE SEED at the bottom of ops/setup_checklist_items.sql.
 * They are the same four rows, deliberately duplicated: one of them is what
 * ships in the bundle and one is what lands in the database, and applying the
 * migration must not change what an operator sees. `item_key` is what lines
 * them up, so treat a key as permanent once shipped.
 *
 * ⚠️ THE LINKS BELOW ARE PLACEHOLDERS, and the SQL says so too. No walkthrough
 * has been recorded and no written guide has been written yet, so each row
 * points at the screen where the feature is actually configured — real,
 * reachable today, and where the operator would end up anyway. The moment a
 * real video or a real written guide exists, a super admin swaps it in from
 * /admin/setup-checklist and this constant stops being read.
 */

export interface SetupChecklistItem {
  /** Stable key. Matches `item_key` in the database; permanent once shipped. */
  key: string;
  /** The feature's name, as an operator would say it. */
  title: string;
  /** One or two lines on why this one needs sitting down with. */
  description: string;
  /**
   * The recorded walkthrough, or `null` when none exists yet.
   *
   * A leading `/` is an in-portal route; anything else opens in a new tab.
   */
  videoUrl: string | null;
  /**
   * The written guide with screenshots, or `null`.
   *
   * AT LEAST ONE OF `videoUrl` / `guideUrl` IS ALWAYS PRESENT. That is the
   * product rule — "yahan par koi na koi ek link laazimi hoga" — and it is
   * enforced in three places: a CHECK constraint on the table, a refusal in
   * the admin form, and `toItem()` in use-setup-checklist.ts dropping any row
   * that arrives without one. A row with no link names a hard feature and then
   * offers nothing, which is worse than not listing it at all.
   */
  guideUrl: string | null;
}

export const SETUP_CHECKLIST_ITEMS: readonly SetupChecklistItem[] = [
  {
    key: 'auto_extension',
    title: 'Auto-extension',
    description:
      'Rentals that renew themselves each period, charged upfront. Worth understanding what happens when a card fails and the rental pauses rather than lapsing.',
    videoUrl: null,
    guideUrl: '/settings?tab=auto-extend',
  },
  {
    key: 'installments',
    title: 'Installments',
    description:
      'Splitting a rental into scheduled payments — how the plan is built, what happens when one payment is missed, and how the balance settles.',
    videoUrl: null,
    guideUrl: '/settings?tab=installments',
  },
  {
    key: 'payg',
    title: 'Pay as you go',
    description:
      'The settings under pay-as-you-go are the fiddliest in the product. Go through them once with someone rather than guessing.',
    videoUrl: null,
    guideUrl: '/settings?tab=payg',
  },
  // BONZAH IS ALSO NAMED BY THE SETUP GUIDE, on the same dashboard. The two are
  // not duplicates and the difference is which job each does:
  //
  //   The guide (hooks/use-setup-guide.ts, the "Protect your rentals" group)
  //   owns the TASK — "Add your Bonzah credentials", with a tick beside it and
  //   `hasOwnCredentials` behind the tick. It is transient: it vanishes once
  //   the operator has finished setting up.
  //
  //   This row owns the LESSON — the sit-down that made the card exist. No
  //   tick, because understanding something is not a state this table can
  //   record, and it stays on the desk forever.
  //
  // That is why the guide's row was renamed off the feature's name and onto its
  // action: this row is the one called "Bonzah insurance". Keep it that way — if
  // this title ever becomes an instruction ("Turn on…", "Connect…") the two
  // collide again. The full argument is in the comment on the guide's row.
  //
  // The strings below are frozen for a second reason: they are duplicated
  // verbatim in the seed at the bottom of ops/setup_checklist_items.sql, and
  // applying that file must not change what an operator sees.
  {
    key: 'bonzah',
    title: 'Bonzah insurance',
    description:
      'Connecting Bonzah, what the quote actually covers, and how the balance and the low-balance alerts work.',
    videoUrl: null,
    guideUrl: '/settings?tab=insurance',
  },
];

/** An in-portal route rather than somewhere else on the internet. */
export function isInPortalLink(url: string): boolean {
  return url.startsWith('/');
}

/**
 * What the guide link should be CALLED.
 *
 * The seeded rows point at the screen the feature is configured on, because no
 * written guide exists yet. Calling that "Read the guide" would be a small lie
 * told four times on the first screen an operator sees, so the label follows
 * the destination: an external document reads as a guide, an in-portal path
 * reads as what it is.
 */
export function guideLinkLabel(url: string): string {
  return isInPortalLink(url) ? 'Open in the portal' : 'Read the guide';
}
