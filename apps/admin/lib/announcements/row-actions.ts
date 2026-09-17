/**
 * Pure logic behind the list row's "Show again" and "Duplicate" buttons and its
 * reach line. The storage and RPC calls live in ./api.ts.
 *
 * RELATIVE imports only: the scratchpad node tests bundle this file without the
 * app's `@/` alias.
 */

import {
  IMAGE_EXTENSION,
  IMAGE_MIME_TYPES,
  LIMITS,
  announcementImageObjectPath,
  codePointLength,
  draftToSaveArgs,
  isAnnouncementImageUrl,
  rowToDraft,
  type AdminAnnouncementRow,
  type AdminAnnouncementStats,
  type AnnouncementDraft,
  type AnnouncementImageMime,
  type AnnouncementKind,
  type ImageSlot,
  type SaveAnnouncementArgs,
} from './contract';
import { newAnnouncementImagePath } from './image-upload';

// ─── Show again ──────────────────────────────────────────────────────────────

/**
 * Soft items only (features and soft system notices), whatever the frequency.
 * Hard items ignore frequency and always show, so there is nothing to re-show.
 */
export function canShowAgain(row: Pick<AdminAnnouncementRow, 'kind' | 'blocking'>): boolean {
  return row.kind === 'feature' || row.blocking !== 'hard';
}

/**
 * What is in flight for one row: a write from the inline Active switch or Show again, or ('asking')
 * the tenant count its All tenants question waits for (at most a few seconds).
 */
export type RowPending = 'active' | 'show-again' | 'asking';

/** Why "Show again" is unavailable right now, or null when it can be pressed. */
export function showAgainBlockedReason(
  row: Pick<AdminAnnouncementRow, 'is_active'>,
  pending: RowPending | null | undefined,
): string | null {
  if (pending === 'show-again') return 'Showing it again…';
  if (pending === 'asking') return 'Reading the tenant count…';
  if (pending) return 'Wait for the current change to finish.';
  if (!row.is_active) return 'Turn it on first. Inactive announcements are hidden from every tenant.';
  return null;
}

/**
 * The save RPC arguments that re-show `row` to everyone who closed it: the row's
 * current content, targets and settings exactly as they are, plus p_reshow. The
 * RPC bumps `revision`, so every older dismissal counts as never dismissed.
 * `tenantIds` are the row's portal_announcement_tenants (audience 'selected').
 */
export function showAgainSaveArgs(row: AdminAnnouncementRow, tenantIds: readonly string[]): SaveAnnouncementArgs {
  return draftToSaveArgs({ ...rowToDraft(row, tenantIds.slice()), reshow: true });
}

export function showAgainConfirmTitle(title: string): string {
  return 'Show “' + title + '” again?';
}

export const SHOW_AGAIN_CONFIRM_DESCRIPTION =
  'Everyone who already closed it will see it again the next time their portal checks, within about 5 minutes.';

// ─── Duplicate ───────────────────────────────────────────────────────────────

export const DUPLICATE_TITLE_PREFIX = 'Copy of ';

export const DUPLICATE_INACTIVE_NOTE =
  'Duplicates start inactive so tenants don’t see two copies. Turn Active on when ready.';

export function titleLimit(kind: AnnouncementKind): number {
  return kind === 'feature' ? LIMITS.featureTitle : LIMITS.systemTitle;
}

interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>;
}

function graphemeSegmenter(): GraphemeSegmenter | null {
  const Seg = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter })
    .Segmenter;
  if (typeof Seg !== 'function') return null;
  try {
    return new Seg(undefined, { granularity: 'grapheme' });
  } catch {
    return null;
  }
}

/**
 * "Copy of <title>", cut to the kind's title limit. The limit is in code points
 * (like Postgres char_length and the contract), and the cut never splits a
 * character: not a surrogate pair, and (where the browser can segment text) not
 * an emoji sequence or a letter with its combining marks either.
 */
export function duplicateTitle(title: string, kind: AnnouncementKind): string {
  const full = DUPLICATE_TITLE_PREFIX + title.trim();
  const max = titleLimit(kind);
  if (codePointLength(full) <= max) return full;
  let out = '';
  const seg = graphemeSegmenter();
  if (seg) {
    let used = 0;
    for (const { segment } of seg.segment(full)) {
      const n = codePointLength(segment);
      if (used + n > max) break;
      out += segment;
      used += n;
    }
  } else {
    // No segmenter: whole code points, and never end on a joiner or variation selector.
    out = Array.from(full).slice(0, max).join('').replace(/[\u200D\uFE0E\uFE0F]+$/, '');
  }
  return out.trimEnd();
}

/** Where one of the source row's images sits: the card, or slide N (0-based). */
export type ImageTarget = { kind: 'card' } | { kind: 'slide'; index: number };

export interface ImageCopyJob {
  target: ImageTarget;
  /** The slot the COPY is stored under (card image -> card, slide image -> slide). */
  slot: ImageSlot;
  sourceUrl: string;
}

/** Every image the row references, card first, then slides in order. */
export function imageCopyJobs(row: Pick<AdminAnnouncementRow, 'kind' | 'image_url' | 'slides'>): ImageCopyJob[] {
  if (row.kind !== 'feature') return [];
  const jobs: ImageCopyJob[] = [];
  if (row.image_url) jobs.push({ target: { kind: 'card' }, slot: 'card', sourceUrl: row.image_url });
  row.slides.forEach((s, index) => {
    if (s.image_url) jobs.push({ target: { kind: 'slide', index }, slot: 'slide', sourceUrl: s.image_url });
  });
  return jobs;
}

function mimeForExtension(ext: string): AnnouncementImageMime | null {
  for (const mime of IMAGE_MIME_TYPES) if (IMAGE_EXTENSION[mime] === ext) return mime;
  return null;
}

/**
 * The bucket object path of the source image and a NEW path for its copy:
 * `feature/<slot>/<new uuid>.<same extension>`. null when the source is not an
 * object this system uploaded (then there is nothing it may copy).
 */
export function duplicateImagePaths(sourceUrl: string, slot: ImageSlot, newId: string): { from: string; to: string } | null {
  const from = announcementImageObjectPath(sourceUrl);
  if (!from) return null;
  const dot = from.lastIndexOf('.');
  const mime = dot === -1 ? null : mimeForExtension(from.slice(dot + 1));
  if (!mime) return null;
  const to = newAnnouncementImagePath(slot, mime, newId);
  if (to === from) return null;
  return { from, to };
}

export interface ImageCopyResult {
  job: ImageCopyJob;
  /** Public URL of the copy, or null when the copy failed. */
  url: string | null;
}

/** What the editor opens with for a duplicate. */
export interface DuplicateSeed {
  draft: AnnouncementDraft;
  /** Copies made for this draft: the editor treats them as its own uploads (Cancel deletes them). */
  uploads: string[];
  /** The images that could not be copied (empty in the draft), card first, then slides in order. */
  missingImages: ImageTarget[];
}

/** The note shown at an image whose copy failed (and in the editor's summary at the top). */
export function missingImageNote(target: ImageTarget): string {
  return target.kind === 'card'
    ? 'The card image could not be copied. Upload it again.'
    : 'The image on slide ' + (target.index + 1) + ' could not be copied. Upload it again.';
}

/**
 * The CREATE-mode draft for a duplicate of `row`: same kind, content, slides,
 * button, display, tone, blocking, audience, smart filter, tenants and
 * frequency; title "Copy of …"; inactive. Every image is replaced by its COPY;
 * an image whose copy failed (or came back as anything but a new announcement
 * image) is left empty and listed in `missingImages`, so the duplicate never
 * points at the original's object.
 */
export function buildDuplicateSeed(
  row: AdminAnnouncementRow,
  tenantIds: readonly string[],
  copies: readonly ImageCopyResult[],
): DuplicateSeed {
  const base = rowToDraft(row, tenantIds.slice());
  const uploads: string[] = [];
  const missingImages: ImageTarget[] = [];
  // No image of the source row may end up in the duplicate, under any target.
  const originals = new Set<string>(imageCopyJobs(row).map((j) => j.sourceUrl));
  const isOwnCopy = (url: string | null): url is string => !!url && !originals.has(url) && isAnnouncementImageUrl(url);
  const copyFor = (target: ImageTarget, sourceUrl: string): string | null => {
    const hit = copies.find(
      (c) =>
        c.job.sourceUrl === sourceUrl &&
        c.job.target.kind === target.kind &&
        (target.kind === 'card' || (c.job.target.kind === 'slide' && c.job.target.index === target.index)),
    );
    const url = hit?.url ?? null;
    if (isOwnCopy(url)) {
      if (uploads.indexOf(url) === -1) uploads.push(url);
      return url;
    }
    missingImages.push(target);
    return null;
  };

  const isFeature = row.kind === 'feature';
  const image_url = isFeature && base.image_url ? copyFor({ kind: 'card' }, base.image_url) : null;
  const slides = base.slides.map((s, index) => ({
    heading: s.heading,
    body: s.body,
    image_url: isFeature && s.image_url ? copyFor({ kind: 'slide', index }, s.image_url) : null,
  }));
  // A copy that no target claimed (should not happen) still belongs to this draft's session, so Cancel removes it.
  for (const c of copies) if (isOwnCopy(c.url) && uploads.indexOf(c.url) === -1) uploads.push(c.url);

  return {
    draft: {
      ...base,
      id: null,
      title: duplicateTitle(row.title, row.kind),
      image_url,
      slides,
      is_active: false,
      reshow: false,
    },
    uploads,
    missingImages,
  };
}

// ─── Duplicate: images still missing while the editor is open ───────────────

/**
 * The images of a duplicate that could not be copied and have not been
 * uploaded again yet. Slides are tracked by their editor KEY, not their index,
 * so a note follows its slide when slides move and goes away with the slide.
 */
export interface MissingImages {
  card: boolean;
  slideKeys: string[];
}

export const NO_MISSING_IMAGES: MissingImages = { card: false, slideKeys: [] };

/** The seed's failed targets, with each slide index turned into that slide's key. */
export function missingImagesFromSeed(targets: readonly ImageTarget[], slideKeys: readonly string[]): MissingImages {
  const out: MissingImages = { card: false, slideKeys: [] };
  for (const t of targets) {
    if (t.kind === 'card') out.card = true;
    else {
      const key = slideKeys[t.index];
      if (key !== undefined && out.slideKeys.indexOf(key) === -1) out.slideKeys.push(key);
    }
  }
  return out.card || out.slideKeys.length > 0 ? out : NO_MISSING_IMAGES;
}

/**
 * Drops, for good, every entry whose field has an image again (whatever put it
 * there) and every slide that no longer exists. Returns `missing` itself when
 * nothing changed, so it can be compared by identity.
 */
export function pruneMissingImages(
  missing: MissingImages,
  draft: Pick<AnnouncementDraft, 'image_url' | 'slides'>,
  slideKeys: readonly string[],
): MissingImages {
  const card = missing.card && !draft.image_url;
  const keep = missing.slideKeys.filter((key) => {
    const index = slideKeys.indexOf(key);
    return index !== -1 && index < draft.slides.length && !draft.slides[index].image_url;
  });
  if (card === missing.card && keep.length === missing.slideKeys.length) return missing;
  return card || keep.length > 0 ? { card, slideKeys: keep } : NO_MISSING_IMAGES;
}

/** The entries as targets at the slides' CURRENT positions: card first, then slides in order. */
export function missingImageTargets(missing: MissingImages, slideKeys: readonly string[]): ImageTarget[] {
  const targets: ImageTarget[] = missing.card ? [{ kind: 'card' }] : [];
  const indexes = missing.slideKeys
    .map((key) => slideKeys.indexOf(key))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b);
  for (const index of indexes) targets.push({ kind: 'slide', index });
  return targets;
}

function joinList(items: string[]): string {
  return items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/**
 * The question Save asks before it saves a duplicate that still has images
 * whose copy failed (a missing card image never gets here: validation stops
 * it first). Cancel goes back to upload them.
 */
export function missingImagesSaveConfirm(targets: readonly ImageTarget[]): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  const card = targets.some((t) => t.kind === 'card');
  const slides = targets.flatMap((t) => (t.kind === 'slide' ? [t.index + 1] : []));
  const one = targets.length === 1;
  const parts: string[] = [];
  if (card) parts.push('the card image');
  if (slides.length === 1) parts.push('the image on slide ' + slides[0]);
  else if (slides.length > 1) parts.push('the images on slides ' + joinList(slides.map(String)));
  const what = parts.join(' and ');
  return {
    title: one ? 'Save without ' + what + '?' : 'Save without ' + targets.length + ' images?',
    description:
      what.charAt(0).toUpperCase() + what.slice(1) + (one ? ' was' : ' were') +
      ' not copied from the original, so this duplicate has ' + (one ? 'no image there' : 'none there') +
      '. Cancel to upload ' + (one ? 'it' : 'them') + ' first.',
    confirmLabel: one ? 'Save without it' : 'Save without them',
  };
}

// ─── Reach line ──────────────────────────────────────────────────────────────

function plural(n: number, one: string, many: string): string {
  return n + ' ' + (n === 1 ? one : many);
}

/**
 * Whether the stats rows came from the stats function that counts super admins (the
 * *_all_* columns appended on Sep 17 2026). The OLDER nine-column function, which a
 * database keeps until the SQL is re-applied, returns staff-only counts: the list still
 * works (the contract falls back to those counts) and its tooltip then says super admins
 * are not counted. No rows: nothing to caveat.
 */
export function statsCountSuperAdmins(raws: readonly unknown[]): boolean {
  if (raws.length === 0) return true;
  return raws.some((r) => typeof r === 'object' && r !== null && 'shown_all_users' in r);
}

export const SUPER_ADMINS_NOT_COUNTED = 'Super admins are not counted.';

export interface ReachSummary {
  /** "Seen by 3 users in 2 tenants · 1 button click" (super admins included when counted). */
  headline: string;
  /** "(incl. 1 super admin)" when any of those users were super admins, else null. */
  superAdminNote: string | null;
  /** Tooltip lines. */
  details: string[];
  /** The last tooltip line is a footnote about who is counted (drawn muted). */
  endsWithFootnote: boolean;
}

/**
 * The admin row's reach line. Counts include super admins and say so: the
 * headline adds "(incl. N super admin)" and the tooltip gives the split. Card
 * opens and "don't show again" exist only for features; hard items cannot be
 * closed, so they have no "closed" line. With the older stats function
 * (`superAdminsCounted` false) the counts are staff only, and the tooltip says so.
 */
export function reachSummary(
  row: Pick<AdminAnnouncementRow, 'kind' | 'blocking'>,
  stats: AdminAnnouncementStats | undefined,
  superAdminsCounted = true,
): ReachSummary {
  const n = (k: keyof AdminAnnouncementStats): number => {
    const v = stats?.[k];
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
  };
  const seen = n('shown_all_users');
  const tenants = n('shown_all_tenants');
  const clicks = n('cta_all_users');
  const superSeen = n('shown_super_admin_users');
  const superClicks = n('cta_super_admin_users');
  const superAdmins = Math.max(superSeen, superClicks);

  const details: string[] = [];
  const isFeature = row.kind === 'feature';
  if (isFeature) details.push('Card opened by ' + plural(n('card_opened_all_users'), 'user', 'users'));
  if (isFeature || row.blocking !== 'hard') details.push('Closed by ' + plural(n('dismissed_all_users'), 'user', 'users'));
  if (isFeature) details.push('“Don’t show again”: ' + plural(n('dont_show_again_all_users'), 'user', 'users'));
  details.push('Button clicked by ' + plural(clicks, 'user', 'users'));
  details.push('Audience: ' + plural(n('audience_tenants'), 'tenant', 'tenants') + ' (' + n('reachable_tenants') + ' reachable)');
  if (superAdmins > 0) {
    details.push(
      'Includes super admins: ' + plural(superSeen, 'viewer', 'viewers') + ' and ' +
        plural(superClicks, 'button click', 'button clicks') + '.',
    );
  } else if (!superAdminsCounted) {
    details.push(SUPER_ADMINS_NOT_COUNTED);
  }

  return {
    headline:
      'Seen by ' + plural(seen, 'user', 'users') + ' in ' + plural(tenants, 'tenant', 'tenants') + ' · ' +
      plural(clicks, 'button click', 'button clicks'),
    superAdminNote: superAdmins > 0 ? '(incl. ' + plural(superAdmins, 'super admin', 'super admins') + ')' : null,
    details,
    endsWithFootnote: superAdmins > 0 || !superAdminsCounted,
  };
}
