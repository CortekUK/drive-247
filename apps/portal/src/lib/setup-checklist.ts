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

import {
  SAMPLE_EXPLAINER_DURATION_SECONDS,
  SAMPLE_EXPLAINER_URL,
} from './explainers';
import { safeHref } from './safe-href';

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
   * Only a same-origin path or an http(s) URL is ever used — anything else is
   * treated as if it were blank (see `safeChecklistLink` below).
   */
  videoUrl: string | null;
  /**
   * The runtime of `videoUrl` in whole seconds, or `null` when it is not known.
   *
   * Rendered as `m:ss` beside the row's play button and in the video dialog's
   * header, so the operator knows what a walkthrough costs them before they
   * press play. Always `null` when `videoUrl` is: a time with no video behind
   * it is a promise about nothing.
   *
   * The database requires one whenever a video URL is set (a CHECK on
   * `setup_checklist_items`, and the admin form refuses to save without it),
   * but a row can still arrive without one — so the card prints NO time for
   * `null`, never a confident "0:00".
   */
  videoDurationSeconds: number | null;
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
    videoDurationSeconds: null,
    guideUrl: '/settings?tab=auto-extend',
  },
  {
    key: 'installments',
    title: 'Installments',
    description:
      'Splitting a rental into scheduled payments — how the plan is built, what happens when one payment is missed, and how the balance settles.',
    videoUrl: null,
    videoDurationSeconds: null,
    guideUrl: '/settings?tab=installments',
  },
  {
    key: 'payg',
    title: 'Pay as you go',
    description:
      'The settings under pay-as-you-go are the fiddliest in the product. Go through them once with someone rather than guessing.',
    videoUrl: null,
    videoDurationSeconds: null,
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
    videoDurationSeconds: null,
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

/**
 * The longest walkthrough a time is printed for: four hours.
 *
 * Mirrored by hand — the apps share no code — in the CHECK constraint in
 * ops/setup_checklist_items.sql and in the admin form's length parser. A
 * sit-down on one feature is minutes long, so anything past this is a typo (a
 * length in minutes pasted as seconds, say), not a video.
 */
export const MAX_VIDEO_DURATION_SECONDS = 14400;

/**
 * A walkthrough's length as the operator reads it: `m:ss` under an hour,
 * `h:mm:ss` from one.
 *
 * NOT `formatExplainerDuration` from lib/explainers.ts, which only ever writes
 * total minutes — 3725 seconds there is "62:05". The admin form writes a length
 * of an hour or more back as "1:02:05" (`formatVideoLength` in
 * apps/admin/app/admin/(protected)/setup-checklist/page.tsx), so the dashboard
 * has to print it the same way or the super admin and the operator see two
 * different numbers for one video. Under an hour the two formats agree:
 * minutes unpadded, seconds padded to two digits.
 */
export function formatChecklistDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * The link we are willing to hand to an href, a `<video>`, an `<iframe>`, the
 * router or `window.open` — or `null`, which every caller treats as absent.
 *
 * `video_url` and `guide_url` are free text typed by a super admin, so this is
 * the same gate as the dashboard's announcement CTA: `safeHref` from
 * lib/safe-href.ts, which lets through only an absolute http(s) URL or a
 * same-origin path. A `javascript:` link handed to an href or `window.open`
 * runs in the operator's authenticated portal session.
 *
 * Three refusals on top of it, all about a "same-origin path" that is not one.
 * None is added to safe-href.ts itself, because that would change the
 * carousel's behaviour too:
 *  - `/\evil.com`. safe-href.ts records this as a known gap — browsers resolve
 *    a leading `/\` exactly like `//`, i.e. off-origin — and here it would be
 *    handed to `router.push` as an in-portal link.
 *  - Control characters anywhere. The URL parser strips tabs and newlines, so
 *    `/<TAB>/evil.com` passes the prefix check and then becomes `//evil.com`.
 *  - A path whose dot segments collapse to `//`. `/.//evil.com`,
 *    `/..//evil.com`, `/%2e//evil.com` and `/settings/..//evil.com` all pass
 *    the prefix check, but the URL parser removes `.` / `..` / `%2e` segments,
 *    leaving the pathname `//evil.com`. Next's router builds its canonical URL
 *    from `pathname + search + hash`, so that string would reach
 *    `history.pushState` or `location.assign` as a protocol-relative URL.
 *
 * So a same-origin path is resolved against a fixed, never-real origin, and it
 * is refused unless it stays on that origin with a pathname that is not `//…`.
 * What comes back is the RESOLVED `pathname + search + hash`, not the typed
 * string, so the value that is classified (`guideLinkKind`) is exactly the
 * value the router receives. An absolute http(s) URL is returned as trimmed.
 *
 * apps/admin's setup-checklist form mirrors this rule by hand (`usableLink`),
 * so a super admin cannot save a link that this function would then drop.
 */
const PATH_PROBE_ORIGIN = 'https://portal.invalid';

export function safeChecklistLink(url: string | null | undefined): string | null {
  const safe = safeHref(url);
  if (!safe) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(safe)) return null;
  if (!isInPortalLink(safe)) return safe;
  if (safe.startsWith('/\\')) return null;
  let resolved: URL;
  try {
    resolved = new URL(safe, PATH_PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (resolved.origin !== PATH_PROBE_ORIGIN) return null;
  if (resolved.pathname.startsWith('//')) return null;
  return resolved.pathname + resolved.search + resolved.hash;
}

/**
 * Where a guide link goes, which decides the icon beside it:
 *
 *   'settings'  an in-portal path under /settings — the screen the feature is
 *               configured on. What every seeded row points at today.
 *   'portal'    any other in-portal path.
 *   'guide'     an external http(s) page — a written guide.
 *
 * `null` for a link `safeChecklistLink` refuses, so a caller cannot classify
 * (and then render) a link it would not also be allowed to open.
 */
export type GuideLinkKind = 'settings' | 'portal' | 'guide';

export function guideLinkKind(url: string | null | undefined): GuideLinkKind | null {
  const safe = safeChecklistLink(url);
  if (!safe) return null;
  if (!isInPortalLink(safe)) return 'guide';
  // `/settings` itself, or followed by `/`, `?` or `#` — not `/settings-old`.
  return /^\/settings(?:[/?#]|$)/.test(safe) ? 'settings' : 'portal';
}

/**
 * The guide button's accessible name and tooltip, naming the feature.
 *
 * Same honesty as `guideLinkLabel` — the words follow the destination, so a
 * settings screen is never announced as a guide — plus the feature's title,
 * because four icon buttons that are all called "Open in the portal" are
 * indistinguishable to anyone navigating by screen reader.
 */
export function guideLinkText(
  title: string,
  url: string | null | undefined,
): string | null {
  switch (guideLinkKind(url)) {
    case 'settings':
      return `Open ${title} settings`;
    case 'portal':
      return `Open ${title} in the portal`;
    case 'guide':
      return `Read the ${title} guide`;
    default:
      return null;
  }
}

/** The video a row plays, once the rules below have picked one. */
export interface ChecklistVideo {
  url: string;
  /** Whole seconds, or `null` when no time should be printed. Never 0. */
  durationSeconds: number | null;
  /** The shared stand-in clip rather than this feature's own walkthrough. */
  isSample: boolean;
}

/**
 * Which video a row plays, and what length it may claim.
 *
 *  1. A real `videoUrl` wins, once it passes `safeChecklistLink`. Its length is
 *     printed only when it is a positive number — a row that arrived without
 *     one plays with no time beside it rather than "0:00".
 *  2. Otherwise, with `allowSample` — the canary only — the shared sample clip,
 *     with the sample file's own length. That number is true of the clip that
 *     actually plays, and the dialog badges it "Sample", so nobody reads it as
 *     the real walkthrough's runtime.
 *  3. Otherwise nothing: no play target, and the row opens its guide. That is
 *     every other tenant today, because no walkthrough has been recorded.
 */
export function resolveChecklistVideo(
  item: Pick<SetupChecklistItem, 'videoUrl' | 'videoDurationSeconds'>,
  options: { allowSample: boolean },
): ChecklistVideo | null {
  const url = safeChecklistLink(item.videoUrl);
  if (url) {
    const seconds = item.videoDurationSeconds;
    return {
      url,
      durationSeconds:
        typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
          ? seconds
          : null,
      isSample: false,
    };
  }
  if (!options.allowSample) return null;
  return {
    url: SAMPLE_EXPLAINER_URL,
    durationSeconds: SAMPLE_EXPLAINER_DURATION_SECONDS,
    isSample: true,
  };
}
