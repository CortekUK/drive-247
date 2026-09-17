/**
 * PORTAL ANNOUNCEMENTS: SHARED CONTRACT (types, constants, pure validators).
 *
 * This file exists TWICE and the two copies must stay byte-identical:
 *   apps/portal/src/lib/announcements/contract.ts
 *   apps/admin/lib/announcements/contract.ts
 * apps/portal/src/__tests__/lib/announcements-contract.test.ts fails when they differ.
 *
 * Rules for this file:
 * - No imports at all. It compiles under admin `strict: true` (lib ES2022 + DOM) and under
 *   the portal's looser config.
 * - Every limit and pattern here has a SQL twin (a CHECK constraint or function) in
 *   ops/portal_announcements.sql. Change one and you must change the other.
 * - Class strings here are real Tailwind classes. Both apps scan this file for classes
 *   (portal `./src/**`; admin needs `./lib/announcements/**` in its tailwind content).
 *   Only default-palette / arbitrary-value utilities that compile identically in both apps.
 *   Never `font-sans`, `transition-all`, `border-border`, `rounded-4xl`, `bg-gradient-primary`.
 */

// ─── Enumerations ────────────────────────────────────────────────────────────

export const ANNOUNCEMENT_KINDS = ['feature', 'system'] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];

/** System only. Features have no display choice (card + dialog). */
export const SYSTEM_DISPLAYS = ['dialog', 'banner'] as const;
export type SystemDisplay = (typeof SYSTEM_DISPLAYS)[number];

/** Features are always 'soft'. */
export const BLOCKING_LEVELS = ['soft', 'hard'] as const;
export type Blocking = (typeof BLOCKING_LEVELS)[number];

export const AUDIENCES = ['all', 'selected', 'segment'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** NULL (not in this list) means "show once". */
export const REPEAT_AFTER_DAYS = [1, 3, 7] as const;
export type RepeatAfterDays = (typeof REPEAT_AFTER_DAYS)[number];

export const ANNOUNCEMENT_EVENTS = [
  'shown', //           a dialog opened (auto or from the card) or a banner rendered; once per session per id+revision
  'card_opened', //     the feature card was clicked (the dialog opened on demand)
  'dismissed', //       soft dialog/banner closed (X, Esc, outside click, "Got it"); starts the repeat clock
  'dont_show_again', // feature dialog opened automatically: never auto-open again for this user (card stays)
  'cta_clicked', //     button pressed; on a SOFT item it also counts as dismissed
] as const;
export type AnnouncementEvent = (typeof ANNOUNCEMENT_EVENTS)[number];

export const ANNOUNCEMENT_TONES = ['info', 'success', 'warning', 'critical'] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];

export const SEGMENT_KEYS = ['stripe_connect_not_connected', 'bonzah_not_active', 'uae_migration_pending'] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).indexOf(value) !== -1;
}

export function isRepeatAfterDays(value: unknown): value is RepeatAfterDays {
  return value === 1 || value === 3 || value === 7;
}

// ─── Database names ──────────────────────────────────────────────────────────

export const ANNOUNCEMENT_TABLES = {
  content: 'portal_announcements',
  targets: 'portal_announcement_tenants',
  state: 'portal_announcement_user_state',
} as const;

export const ANNOUNCEMENT_RPC = {
  /** portal, authenticated staff: ({ p_tenant_id, p_kinds }) -> PortalAnnouncement[] (already targeted + ordered) */
  read: 'get_portal_announcements',
  /** portal, authenticated staff: ({ p_announcement_id, p_tenant_id, p_event }) -> void */
  event: 'record_portal_announcement_event',
  /** admin, super admin: ({ p_id, p_row, p_tenant_ids, p_reshow }) -> uuid */
  save: 'admin_save_portal_announcement',
  /** admin, super admin: ({ p_kind, p_ids }) -> void. p_ids = EVERY id of that kind, in display order */
  reorder: 'admin_reorder_portal_announcements',
  /** admin, super admin: ({ p_segment_key }) -> SegmentMatchTenant[] ordered by company_name */
  segmentTenants: 'admin_portal_announcement_segment_tenants',
  /** admin, super admin: () -> AdminAnnouncementStats[] */
  stats: 'admin_portal_announcement_stats',
} as const;

export interface ReadAnnouncementsArgs {
  p_tenant_id: string;
  p_kinds: AnnouncementKind[];
}

export interface RecordAnnouncementEventArgs {
  p_announcement_id: string;
  p_tenant_id: string;
  p_event: AnnouncementEvent;
}

export interface ReorderAnnouncementsArgs {
  p_kind: AnnouncementKind;
  p_ids: string[];
}

// ─── Limits (SQL twins in CHECK constraints) ─────────────────────────────────
// Lengths are counted in Unicode code points, like Postgres char_length().

export const LIMITS = {
  featureTitle: 60,
  systemTitle: 80,
  featureSummary: 120,
  systemBodyDialog: 400,
  systemBodyBanner: 200,
  slideHeading: 60,
  slideBody: 400,
  slidesMin: 1,
  slidesMax: 10,
  ctaLabel: 30,
  ctaUrl: 300,
  imageUrl: 500,
} as const;

// ─── Timing ──────────────────────────────────────────────────────────────────

/** Fixed poll. Plus refetch on window focus. No cron, no realtime. */
export const ANNOUNCEMENTS_POLL_MS = 5 * 60 * 1000;
export const ANNOUNCEMENTS_STALE_MS = 60 * 1000;
/** Quiet period after every blocker clears (and after mount / route change) before a dialog may open. */
export const ANNOUNCEMENT_SETTLE_MS = 1500;
/** Feature card deck auto-advance. Off under reduced motion, on hover/focus, and while a dialog is open. */
export const FEATURE_DECK_ROTATE_MS = 7000;
/** The desk band row height. Checklist and Reminders cards are pinned to exactly this. */
export const DESK_CARD_HEIGHT_PX = 352;

// ─── Rows ────────────────────────────────────────────────────────────────────

export interface AnnouncementSlide {
  heading: string;
  body: string;
  image_url: string | null;
}

interface AnnouncementRowBase {
  id: string;
  kind: AnnouncementKind;
  title: string;
  /** feature: the one-line description (required). system: null. */
  summary: string | null;
  /** system: the message (required, plain text, may contain \n). feature: null. */
  body: string | null;
  /** feature: card background illustration (required). system: null. */
  image_url: string | null;
  /** feature: 2..3 slides. system: []. */
  slides: AnnouncementSlide[];
  /** Both null, or both set. cta_url is an in-portal path. */
  cta_label: string | null;
  cta_url: string | null;
  /** system only; null for feature. */
  display: SystemDisplay | null;
  blocking: Blocking;
  /** system only; null for feature. */
  tone: AnnouncementTone | null;
  /** null = show once. Always null when blocking = 'hard'. */
  repeat_after_days: RepeatAfterDays | null;
  sort_order: number;
  /** Bumped only when the admin saves with "show it again to everyone". */
  revision: number;
}

/** One row of get_portal_announcements. Column order = the RPC's RETURNS TABLE order. */
export interface PortalAnnouncement extends AnnouncementRowBase {
  last_shown_at: string | null;
  dismissed_at: string | null;
  dont_show_again_at: string | null;
  /**
   * Server-computed with the server clock:
   *   system+hard -> true; no state row, or state.revision <> revision -> true;
   *   dont_show_again_at set -> false; dismissed_at null -> true; repeat null -> false;
   *   else dismissed_at <= now() - repeat_after_days * 24h.
   */
  is_due: boolean;
}

/** One row of public.portal_announcements as the admin reads it. */
export interface AdminAnnouncementRow extends AnnouncementRowBase {
  audience: Audience;
  segment_key: SegmentKey | null;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One row of admin_portal_announcement_stats. Keys in RETURNS TABLE order. User counts are
 * distinct app_users with that event recorded (any revision).
 */
export interface AdminAnnouncementStats {
  announcement_id: string;
  /** Tenants the audience matches right now, any status. */
  audience_tenants: number;
  /** Of those, tenants with status = 'active' (the only ones whose portal can load). */
  reachable_tenants: number;
  /** Tenant staff only: these six exclude super admins (impersonation / support sessions). */
  shown_users: number;
  shown_tenants: number;
  card_opened_users: number;
  dismissed_users: number;
  dont_show_again_users: number;
  cta_users: number;
  /** Appended Sep 2026. Everyone, super admins included: what the admin list shows. */
  shown_all_users: number;
  shown_all_tenants: number;
  /** The super-admin part of shown_all_users (shown_all_users = shown_users + this). */
  shown_super_admin_users: number;
  card_opened_all_users: number;
  dismissed_all_users: number;
  /** "Button clicks" in the admin list. */
  cta_all_users: number;
  /** The super-admin part of cta_all_users. */
  cta_super_admin_users: number;
  dont_show_again_all_users: number;
}

export interface SegmentMatchTenant {
  tenant_id: string;
  slug: string;
  company_name: string;
  status: string;
  tenant_type: string | null;
}

/** p_row of admin_save_portal_announcement. Already normalised by draftToSaveArgs. */
export interface SaveAnnouncementRow {
  kind: AnnouncementKind;
  title: string;
  summary: string | null;
  body: string | null;
  image_url: string | null;
  slides: AnnouncementSlide[];
  cta_label: string | null;
  cta_url: string | null;
  display: SystemDisplay | null;
  blocking: Blocking;
  tone: AnnouncementTone | null;
  audience: Audience;
  segment_key: SegmentKey | null;
  repeat_after_days: RepeatAfterDays | null;
  is_active: boolean;
}

export interface SaveAnnouncementArgs {
  p_id: string | null;
  p_row: SaveAnnouncementRow;
  /** Non-empty only when audience = 'selected'. */
  p_tenant_ids: string[];
  /** Only honoured on update. */
  p_reshow: boolean;
}

// ─── Text rules ──────────────────────────────────────────────────────────────

/** SQL twin: `!~ '[\x01-\x1F\x7F]'` (Postgres text cannot hold \x00). */
export const SINGLE_LINE_FORBIDDEN_RE = /[ -]/;
/** Same, but \n allowed. SQL twin: `!~ '[\x01-\x09\x0B-\x1F\x7F]'`. */
export const MULTI_LINE_FORBIDDEN_RE = /[ -	-]/;

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

function cleanSingleLine(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Trims, normalises CRLF/CR to LF. */
function cleanMultiLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

// ─── In-portal CTA paths ─────────────────────────────────────────────────────

const PATH_FORBIDDEN_RE = /[ - ]/;
const DOT_SEGMENT_RE = /(^|\/)\.\.?(\/|$)/;

/**
 * An in-portal path: "/", "/insights/expenses", "/settings?tab=payments#stripe".
 * Refuses absolute URLs, protocol-relative "//x", "/\x", any backslash, spaces and
 * control characters, "." / ".." path segments, and anything over LIMITS.ctaUrl.
 * SQL twin (pa_cta_url_valid):
 *   char_length(cta_url) BETWEEN 1 AND 300 AND left(cta_url,1) = '/'
 *   AND substr(cta_url,2,1) NOT IN ('/', E'\\') AND strpos(cta_url, E'\\') = 0
 *   AND cta_url !~ '[\x01-\x20\x7F]'
 *   AND split_part(split_part(cta_url,'#',1),'?',1) !~ '(^|/)\.\.?(/|$)'
 */
export function isInPortalPath(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  if (url.length < 1 || codePointLength(url) > LIMITS.ctaUrl) return false;
  if (url.charAt(0) !== '/') return false;
  const second = url.charAt(1);
  if (second === '/' || second === '\\') return false;
  if (url.indexOf('\\') !== -1) return false;
  if (PATH_FORBIDDEN_RE.test(url)) return false;
  const path = url.split('#')[0].split('?')[0];
  if (DOT_SEGMENT_RE.test(path)) return false;
  return true;
}

export interface ResolvedCta {
  pathname: string;
  search: string;
  hash: string;
  /** pathname + search + hash; what router.push receives. */
  href: string;
}

const RESOLVE_BASE = 'https://portal.invalid';

export function resolveInPortalCta(url: unknown): ResolvedCta | null {
  if (!isInPortalPath(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, RESOLVE_BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== RESOLVE_BASE) return null;
  return {
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    href: parsed.pathname + parsed.search + parsed.hash,
  };
}

/**
 * True when `pathname` is the CTA's page or below it. A HARD system dialog is not shown
 * on its own CTA route, so the tenant can act on it. "/" matches only "/".
 */
export function isOnCtaRoute(pathname: string | null | undefined, ctaUrl: unknown): boolean {
  if (!pathname) return false;
  const cta = resolveInPortalCta(ctaUrl);
  if (!cta) return false;
  const target = cta.pathname.length > 1 && cta.pathname.endsWith('/') ? cta.pathname.slice(0, -1) : cta.pathname;
  if (target === '/') return pathname === '/';
  return pathname === target || pathname.startsWith(target + '/');
}

// ─── Images ──────────────────────────────────────────────────────────────────

export const ANNOUNCEMENT_BUCKET = 'portal-announcement-media';

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AnnouncementImageMime = (typeof IMAGE_MIME_TYPES)[number];

export const IMAGE_EXTENSION: Readonly<Record<AnnouncementImageMime, 'png' | 'jpg' | 'webp'>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Hard limit, also the bucket's file_size_limit. */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Above this the admin shows a non-blocking "large file" warning. */
export const IMAGE_WARN_BYTES = 600 * 1024;

export type ImageSlot = 'card' | 'slide';

export const IMAGE_GUIDANCE: Readonly<
  Record<
    ImageSlot,
    {
      ratioLabel: string;
      recommended: { width: number; height: number };
      minimum: { width: number; height: number };
      note: string;
    }
  >
> = {
  card: {
    ratioLabel: 'Square (1:1)',
    recommended: { width: 1200, height: 1200 },
    minimum: { width: 800, height: 800 },
    note:
      'Paper-style illustration: black-and-white paper texture with one accent colour. The card crops it to fit (from tall to wide depending on screen width), and the heading sits over the bottom 40%, so keep the subject centred in the top half with margin around it. PNG, JPG or WebP, up to 2 MB.',
  },
  slide: {
    ratioLabel: 'Wide (16:9)',
    recommended: { width: 1600, height: 900 },
    minimum: { width: 1200, height: 675 },
    note: 'Optional. Shown full width at the top of the slide. PNG, JPG or WebP, up to 2 MB.',
  },
};

/** Object path inside the bucket. `id` must be a lowercase UUID (crypto.randomUUID()). */
export function announcementImagePath(slot: ImageSlot, id: string, mime: AnnouncementImageMime): string {
  return 'feature/' + slot + '/' + id + '.' + IMAGE_EXTENSION[mime];
}

/**
 * Only public URLs of objects this system uploaded. SQL twin (pa_image_url_valid and
 * portal_announcement_slides_valid) uses the identical pattern.
 */
export const ANNOUNCEMENT_IMAGE_URL_RE =
  /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?\/storage\/v1\/object\/public\/portal-announcement-media\/feature\/(card|slide)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export function isAnnouncementImageUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length <= LIMITS.imageUrl && ANNOUNCEMENT_IMAGE_URL_RE.test(url);
}

/** "feature/card/<uuid>.png" for a valid URL, else null. Used for best-effort storage cleanup. */
export function announcementImageObjectPath(url: unknown): string | null {
  if (!isAnnouncementImageUrl(url)) return null;
  const marker = '/' + ANNOUNCEMENT_BUCKET + '/';
  const at = url.indexOf(marker);
  return at === -1 ? null : url.slice(at + marker.length);
}

// ─── Smart filters (segments) ────────────────────────────────────────────────

export const SEGMENTS: Readonly<
  Record<SegmentKey, { label: string; description: string; clearsWhen: string; hardAllowed: boolean }>
> = {
  stripe_connect_not_connected: {
    label: 'Stripe Connect not connected',
    description:
      'Tenants in Stripe test mode with no Stripe account connected for live payments. These are the tenants who already see the red "Connect Stripe" banner. Square tenants are excluded.',
    clearsWhen: 'A tenant drops out the moment it connects Stripe.',
    hardAllowed: true,
  },
  bonzah_not_active: {
    label: 'Bonzah insurance not active',
    description:
      'Tenants whose renters cannot buy Bonzah cover yet. Their Insurances page says new insurance policies are turned off.',
    clearsWhen: 'A tenant drops out when Bonzah is switched on in live mode, which Drive247 does, so this filter cannot carry a hard blocker.',
    hardAllowed: false,
  },
  uae_migration_pending: {
    label: 'UAE migration pending',
    description:
      'Tenants enrolled in the UAE migration (soft or hard) who have not finished both steps: connect Stripe and confirm the UAE subscription.',
    clearsWhen: 'A tenant drops out when both migration steps are done.',
    hardAllowed: true,
  },
};

export interface SegmentTenantFields {
  payment_provider?: string | null;
  stripe_mode?: string | null;
  own_stripe_account_id?: string | null;
  integration_bonzah?: boolean | null;
  bonzah_mode?: string | null;
  bonzah_sandbox_override?: boolean | null;
  migration_blocker?: string | null;
  subscription_account?: string | null;
}

/**
 * TS twin of public.portal_announcement_segment_match. The database is authoritative;
 * this exists so tests can pin it to the portal's own rules:
 *   stripe_connect_not_connected = connect-stripe-banner.tsx rule, minus Square
 *   bonzah_not_active            = !isBonzahSellable(t)            (lib/bonzah.ts)
 *   uae_migration_pending        = deriveMigrationView(t).enrolledIncomplete (hooks/migration-view.ts)
 */
export function matchesSegment(key: SegmentKey, t: SegmentTenantFields | null | undefined): boolean {
  if (!t) return false;
  switch (key) {
    case 'stripe_connect_not_connected':
      if ((t.payment_provider ?? 'stripe') === 'square') return false;
      return t.stripe_mode === 'test' && !t.own_stripe_account_id;
    case 'bonzah_not_active':
      return !(t.integration_bonzah === true && (t.bonzah_mode === 'live' || t.bonzah_sandbox_override === true));
    case 'uae_migration_pending': {
      const bothComplete = !!t.own_stripe_account_id && t.subscription_account === 'uae';
      return (t.migration_blocker === 'soft' || t.migration_blocker === 'hard') && !bothComplete;
    }
    default:
      return false;
  }
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export const FREQUENCY_OPTIONS: ReadonlyArray<{ value: RepeatAfterDays | null; label: string }> = [
  { value: null, label: 'Show once' },
  { value: 1, label: 'After 1 day' },
  { value: 3, label: 'After 3 days' },
  { value: 7, label: 'After 7 days' },
];

export function frequencyLabel(repeat: RepeatAfterDays | null, blocking: Blocking): string {
  if (blocking === 'hard') return 'Every time (hard)';
  if (repeat === null) return 'Once';
  return repeat === 1 ? 'Again after 1 day' : 'Again after ' + repeat + ' days';
}

export function targetingLabel(audience: Audience, segmentKey: SegmentKey | null, selectedCount: number): string {
  if (audience === 'all') return 'All tenants';
  if (audience === 'selected') return selectedCount + (selectedCount === 1 ? ' tenant' : ' tenants');
  return segmentKey ? 'Smart filter: ' + SEGMENTS[segmentKey].label : 'Smart filter';
}

export const DISPLAY_LABEL: Readonly<Record<SystemDisplay, string>> = { dialog: 'Dialog', banner: 'Banner' };
export const BLOCKING_LABEL: Readonly<Record<Blocking, string>> = { soft: 'Soft', hard: 'Hard' };

// ─── Tones: one colour per use case (Tailwind default palette, NOT theme tokens,
//     because system items also render in v1 chrome where tokens are gold/brand) ──

export const TONE_META: Readonly<
  Record<AnnouncementTone, { label: string; useFor: string; icon: 'Info' | 'CircleCheck' | 'TriangleAlert' | 'OctagonAlert' }>
> = {
  info: { label: 'Information', useFor: 'Maintenance windows, good-to-have notices', icon: 'Info' },
  success: { label: 'Good news', useFor: 'Something was activated or fixed, e.g. a Bonzah account is live', icon: 'CircleCheck' },
  warning: { label: 'Heads-up', useFor: 'Action needed soon, e.g. UAE migration, Stripe not connected', icon: 'TriangleAlert' },
  critical: { label: 'Urgent', useFor: 'Outages on our side, blockers, expired access. Loudest: a solid red banner', icon: 'OctagonAlert' },
};

export interface ToneClasses {
  /** banner root colours (tinted for info/success/warning, SOLID for critical = the louder style) */
  banner: string;
  bannerAction: string;
  bannerDismiss: string;
  /** thin stripe across the top of a system dialog */
  dialogAccent: string;
  /** the round icon holder in a system dialog */
  dialogIcon: string;
  /** primary (CTA) button inside a system dialog */
  dialogAction: string;
  /** admin list chip */
  chip: string;
  /** admin tone picker swatch */
  swatch: string;
}

export const TONE_CLASSES: Readonly<Record<AnnouncementTone, ToneClasses>> = {
  info: {
    banner: 'border-b border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-50',
    bannerAction: 'bg-sky-700 text-white hover:bg-sky-800 dark:bg-sky-300 dark:text-sky-950 dark:hover:bg-sky-200',
    bannerDismiss: 'text-sky-900 hover:bg-sky-100 dark:text-sky-100 dark:hover:bg-sky-900',
    dialogAccent: 'bg-sky-500',
    dialogIcon: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-200',
    dialogAction: 'bg-sky-700 text-white hover:bg-sky-800',
    chip: 'border border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100',
    swatch: 'bg-sky-500',
  },
  success: {
    banner:
      'border-b border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-50',
    bannerAction:
      'bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200',
    bannerDismiss: 'text-emerald-900 hover:bg-emerald-100 dark:text-emerald-100 dark:hover:bg-emerald-900',
    dialogAccent: 'bg-emerald-500',
    dialogIcon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
    dialogAction: 'bg-emerald-700 text-white hover:bg-emerald-800',
    chip:
      'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
    swatch: 'bg-emerald-500',
  },
  warning: {
    banner: 'border-b border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50',
    bannerAction: 'bg-amber-700 text-white hover:bg-amber-800 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200',
    bannerDismiss: 'text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900',
    dialogAccent: 'bg-amber-500',
    dialogIcon: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
    dialogAction: 'bg-amber-700 text-white hover:bg-amber-800',
    chip: 'border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100',
    swatch: 'bg-amber-500',
  },
  critical: {
    banner: 'border-b border-red-700 bg-red-600 text-white dark:border-red-800 dark:bg-red-700 dark:text-white',
    bannerAction: 'bg-red-900 text-white ring-1 ring-inset ring-white/25 hover:bg-red-950 dark:bg-red-950 dark:hover:bg-red-900',
    bannerDismiss: 'text-white hover:bg-red-700 dark:hover:bg-red-800',
    dialogAccent: 'bg-red-600',
    dialogIcon: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200',
    dialogAction: 'bg-red-600 text-white hover:bg-red-700',
    chip: 'border border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100',
    swatch: 'bg-red-600',
  },
};

// ─── Surface class maps (portal renders them; admin preview renders the same) ─

/** Feature card deck on the v2 dashboard desk band. Structure: see spec §3.4. */
export const FEATURE_CARD_UI = {
  root: 'relative isolate h-[352px] w-full min-w-0 overflow-hidden rounded-2xl bg-stone-100 dark:bg-neutral-900',
  slide:
    'group absolute inset-0 flex cursor-pointer flex-col justify-end text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
  image:
    'absolute inset-0 -z-10 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100',
  fallback:
    'absolute inset-0 -z-10 bg-[radial-gradient(circle_at_30%_20%,rgba(99,102,241,0.18),transparent_55%),linear-gradient(180deg,#f7f5f0,#ece8df)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(129,140,248,0.22),transparent_55%),linear-gradient(180deg,#1c1b19,#121110)]',
  scrim:
    'pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[62%] bg-gradient-to-t from-white via-white/85 to-white/0 dark:from-neutral-950 dark:via-neutral-950/80 dark:to-neutral-950/0',
  content: 'relative min-w-0 px-5 pb-5 pt-10',
  title: 'line-clamp-2 break-words text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] text-neutral-950 dark:text-white',
  summary: 'mt-1.5 truncate text-[13px] leading-5 text-neutral-700 dark:text-neutral-300',
  more: 'mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 dark:text-indigo-300',
  dots: 'absolute right-3 top-3 z-10 flex items-center rounded-full bg-black/35 px-1 backdrop-blur-sm',
  dotButton:
    'flex h-6 w-6 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white',
  dot: 'block h-1.5 w-1.5 rounded-full bg-white/55 transition-colors',
  dotActive: 'block h-1.5 w-1.5 rounded-full bg-white',
} as const;

/** Large feature dialog (2..3 slides). Portal: className of ui-v2 DialogContent. Admin: a static stage. */
export const FEATURE_DIALOG_UI = {
  overlay: 'bg-black/30 backdrop-blur-md',
  panel:
    'grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[760px] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[26px] bg-popover p-0 text-popover-foreground sm:w-[92vw] sm:!max-w-[760px]',
  media: 'relative aspect-[16/9] w-full overflow-hidden bg-stone-100 dark:bg-neutral-900',
  mediaImage: 'h-full w-full object-cover',
  close:
    'absolute right-3 top-3 z-10 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
  body: 'flex min-h-0 flex-col gap-3 overflow-y-auto px-6 pb-2 pt-6 sm:px-8 sm:pt-7',
  eyebrow: 'pr-10 text-[12px] font-semibold uppercase tracking-[0.08em] [overflow-wrap:anywhere] text-indigo-600 dark:text-indigo-300',
  heading: 'break-words text-[24px] font-semibold leading-tight tracking-[-0.02em] text-foreground',
  text: 'whitespace-pre-line break-words text-[15px] leading-6 text-muted-foreground',
  footer:
    'flex flex-wrap items-center justify-between gap-3 border-t border-black/5 px-6 py-4 dark:border-white/10 sm:px-8',
  dots: 'flex items-center gap-1.5',
  dot: 'block h-1.5 w-1.5 rounded-full bg-neutral-300 dark:bg-neutral-600',
  dotActive: 'block h-1.5 w-4 rounded-full bg-indigo-500',
  actions: 'ml-auto flex flex-wrap items-center justify-end gap-2',
  secondaryButton:
    'inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-indigo-500/15',
  primaryButton:
    'inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-indigo-600 px-4 text-[13px] font-medium text-white transition-colors hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400',
  linkButton:
    'cursor-pointer text-[12px] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline',
} as const;

/** Full-width system banner. `position` is portal-only; the admin preview uses `relative`. */
export const SYSTEM_BANNER_UI = {
  position: 'fixed inset-x-0 top-0 z-[45]',
  root: 'w-full',
  inner: 'flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:px-6',
  icon: 'h-4 w-4 shrink-0',
  text: 'min-w-0 flex-1 basis-[16rem] break-words text-[13px] leading-5',
  title: 'font-semibold',
  body: 'ml-1.5',
  actions: 'ml-auto flex shrink-0 items-center gap-1.5',
  action:
    'inline-flex h-7 cursor-pointer items-center whitespace-nowrap rounded-full px-3 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current',
  dismiss:
    'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current',
} as const;

/** System dialog (soft or hard). Portal: className of v1 components/ui/dialog DialogContent (both chromes). */
export const SYSTEM_DIALOG_UI = {
  overlaySoft: 'bg-black/30 backdrop-blur-sm',
  overlayHard: 'bg-background/70 backdrop-blur-md',
  panel: 'w-[calc(100vw-2rem)] max-w-[480px] gap-0 overflow-hidden rounded-[22px] border-0 p-0 sm:rounded-[22px]',
  accent: 'h-1.5 w-full',
  close:
    'absolute right-3 top-4 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-indigo-50 hover:text-foreground dark:hover:bg-indigo-500/15',
  body: 'flex max-h-[calc(100dvh-12rem)] flex-col gap-3 overflow-y-auto px-6 pb-2 pt-6',
  icon: 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
  title: 'pr-8 text-[20px] font-semibold leading-tight text-foreground',
  text: 'whitespace-pre-line break-words text-[14px] leading-6 text-muted-foreground',
  helper: 'text-[12px] leading-5 text-muted-foreground',
  footer: 'flex flex-col-reverse gap-2 px-6 pb-6 pt-4 sm:flex-row sm:items-center sm:justify-end',
  action:
    'inline-flex h-10 cursor-pointer items-center justify-center rounded-full px-5 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
  secondaryButton:
    'inline-flex h-10 cursor-pointer items-center justify-center rounded-full px-5 text-[14px] font-medium text-foreground transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-500/15',
} as const;

// ─── Portal-only helpers (harmless in admin) ─────────────────────────────────

/** Desk band grid by visible card count. Full literal strings so Tailwind sees them. */
export const DESK_GRID_CLASSES: Readonly<Record<1 | 2 | 3, string>> = {
  3: 'grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3 md:[&>*:nth-child(3)]:col-span-2 xl:[&>*:nth-child(3)]:col-span-1',
  2: 'grid items-stretch gap-5 md:grid-cols-2',
  1: 'grid items-stretch gap-5 grid-cols-1',
};

export const DESK_BAND_HINT = {
  withFeatures: 'What’s new, what to learn, and what you wrote down',
  withoutFeatures: 'What to learn, and what you wrote down',
} as const;

/** localStorage key (try/catch every access) holding "0" or "1": did this user's desk last show a feature card. */
export function deskFeatureHintKey(tenantId: string, appUserId: string): string {
  return 'd247.desk.featureCount.' + tenantId + '.' + appUserId;
}

// ─── Normalisers ─────────────────────────────────────────────────────────────

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

function normaliseSlides(raw: unknown): AnnouncementSlide[] {
  if (!Array.isArray(raw)) return [];
  const out: AnnouncementSlide[] = [];
  for (const item of raw) {
    const r = asRecord(item);
    if (!r) continue;
    const heading = typeof r.heading === 'string' ? r.heading.trim() : '';
    const body = typeof r.body === 'string' ? r.body.trim() : '';
    if (!heading || !body) continue;
    out.push({ heading, body, image_url: isAnnouncementImageUrl(r.image_url) ? r.image_url : null });
  }
  return out;
}

function normaliseBase(raw: unknown): AnnouncementRowBase | null {
  const r = asRecord(raw);
  if (!r) return null;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (!isOneOf(ANNOUNCEMENT_KINDS, r.kind)) return null;
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  if (!title) return null;

  const cta = resolveInPortalCta(r.cta_url);
  const ctaLabel = typeof r.cta_label === 'string' ? r.cta_label.trim() : '';
  const hasCta = !!cta && !!ctaLabel;

  const base = {
    id: r.id,
    kind: r.kind,
    title,
    cta_label: hasCta ? ctaLabel : null,
    cta_url: hasCta ? (r.cta_url as string) : null,
    sort_order: asFiniteNumber(r.sort_order, 0),
    revision: Math.max(1, asFiniteNumber(r.revision, 1)),
  };

  if (r.kind === 'feature') {
    const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
    const slides = normaliseSlides(r.slides).slice(0, LIMITS.slidesMax);
    if (!summary || slides.length === 0) return null;
    return {
      ...base,
      summary,
      body: null,
      image_url: isAnnouncementImageUrl(r.image_url) ? r.image_url : null,
      slides,
      display: null,
      blocking: 'soft',
      tone: null,
      repeat_after_days: isRepeatAfterDays(r.repeat_after_days) ? r.repeat_after_days : null,
    };
  }

  const body = typeof r.body === 'string' ? r.body.trim() : '';
  if (!body) return null;
  if (!isOneOf(SYSTEM_DISPLAYS, r.display) || !isOneOf(ANNOUNCEMENT_TONES, r.tone)) return null;
  const blocking: Blocking = r.blocking === 'hard' ? 'hard' : 'soft';
  return {
    ...base,
    summary: null,
    body,
    image_url: null,
    slides: [],
    display: r.display,
    blocking,
    tone: r.tone,
    repeat_after_days: blocking === 'soft' && isRepeatAfterDays(r.repeat_after_days) ? r.repeat_after_days : null,
  };
}

/**
 * Defensive client normaliser for one get_portal_announcements row. It never enforces
 * max lengths (the database did). It DROPS rows whose shape is unusable, and DEGRADES
 * unsafe parts: an invalid CTA removes the button, an invalid image becomes null.
 */
export function normalizePortalAnnouncementRow(raw: unknown): PortalAnnouncement | null {
  const base = normaliseBase(raw);
  if (!base) return null;
  const r = raw as Record<string, unknown>;
  return {
    ...base,
    last_shown_at: asNullableString(r.last_shown_at),
    dismissed_at: asNullableString(r.dismissed_at),
    dont_show_again_at: asNullableString(r.dont_show_again_at),
    is_due: base.kind === 'system' && base.blocking === 'hard' ? true : r.is_due === true,
  };
}

/** Lenient admin normaliser for one public.portal_announcements row. Same drop/degrade rules. */
export function normalizeAdminAnnouncementRow(raw: unknown): AdminAnnouncementRow | null {
  const base = normaliseBase(raw);
  if (!base) return null;
  const r = raw as Record<string, unknown>;
  const audience: Audience = isOneOf(AUDIENCES, r.audience) ? r.audience : 'all';
  return {
    ...base,
    audience,
    segment_key: audience === 'segment' && isOneOf(SEGMENT_KEYS, r.segment_key) ? r.segment_key : null,
    is_active: r.is_active === true,
    created_by: asNullableString(r.created_by),
    updated_by: asNullableString(r.updated_by),
    created_at: typeof r.created_at === 'string' ? r.created_at : '',
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : '',
  };
}

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * One admin_portal_announcement_stats row, or null without an announcement_id. Counts that are
 * missing, negative or not numbers become 0. A row from the RPC as it was BEFORE the super-admin
 * columns were appended (the SQL not re-applied yet) has no *_all_* keys: those fall back to the
 * staff-only columns and the super-admin parts to 0, so the list never under-reports what it did.
 */
export function normalizeAdminAnnouncementStats(raw: unknown): AdminAnnouncementStats | null {
  const r = asRecord(raw);
  if (!r || typeof r.announcement_id !== 'string' || !r.announcement_id) return null;
  const either = (appended: string, original: string) => asCount(appended in r ? r[appended] : r[original]);
  return {
    announcement_id: r.announcement_id,
    audience_tenants: asCount(r.audience_tenants),
    reachable_tenants: asCount(r.reachable_tenants),
    shown_users: asCount(r.shown_users),
    shown_tenants: asCount(r.shown_tenants),
    card_opened_users: asCount(r.card_opened_users),
    dismissed_users: asCount(r.dismissed_users),
    dont_show_again_users: asCount(r.dont_show_again_users),
    cta_users: asCount(r.cta_users),
    shown_all_users: either('shown_all_users', 'shown_users'),
    shown_all_tenants: either('shown_all_tenants', 'shown_tenants'),
    shown_super_admin_users: asCount(r.shown_super_admin_users),
    card_opened_all_users: either('card_opened_all_users', 'card_opened_users'),
    dismissed_all_users: either('dismissed_all_users', 'dismissed_users'),
    cta_all_users: either('cta_all_users', 'cta_users'),
    cta_super_admin_users: asCount(r.cta_super_admin_users),
    dont_show_again_all_users: either('dont_show_again_all_users', 'dont_show_again_users'),
  };
}

/** Admin list order within one kind. Identical to the portal RPC's ORDER BY. */
export function compareAdminRows(a: AdminAnnouncementRow, b: AdminAnnouncementRow): number {
  if (a.kind !== b.kind) return a.kind === 'system' ? -1 : 1;
  const ah = a.blocking === 'hard' ? 0 : 1;
  const bh = b.blocking === 'hard' ? 0 : 1;
  if (ah !== bh) return ah - bh;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ─── Admin form: draft, validation, save payload ─────────────────────────────

export interface AnnouncementDraft {
  id: string | null;
  kind: AnnouncementKind;
  title: string;
  summary: string;
  body: string;
  image_url: string | null;
  slides: AnnouncementSlide[];
  cta_label: string;
  cta_url: string;
  display: SystemDisplay;
  blocking: Blocking;
  tone: AnnouncementTone;
  audience: Audience;
  segment_key: SegmentKey | null;
  tenant_ids: string[];
  repeat_after_days: RepeatAfterDays | null;
  is_active: boolean;
  reshow: boolean;
}

export function emptySlide(): AnnouncementSlide {
  return { heading: '', body: '', image_url: null };
}

export function emptyDraft(kind: AnnouncementKind): AnnouncementDraft {
  return {
    id: null,
    kind,
    title: '',
    summary: '',
    body: '',
    image_url: null,
    slides: kind === 'feature' ? [emptySlide(), emptySlide()] : [],
    cta_label: '',
    cta_url: '',
    display: 'dialog',
    blocking: 'soft',
    tone: 'info',
    audience: 'all',
    segment_key: null,
    tenant_ids: [],
    repeat_after_days: null,
    is_active: true,
    reshow: false,
  };
}

export function rowToDraft(row: AdminAnnouncementRow, tenantIds: string[]): AnnouncementDraft {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary ?? '',
    body: row.body ?? '',
    image_url: row.image_url,
    slides: row.slides.map((s) => ({ heading: s.heading, body: s.body, image_url: s.image_url })),
    cta_label: row.cta_label ?? '',
    cta_url: row.cta_url ?? '',
    display: row.display ?? 'dialog',
    blocking: row.blocking,
    tone: row.tone ?? 'info',
    audience: row.audience,
    segment_key: row.segment_key,
    tenant_ids: tenantIds.slice(),
    repeat_after_days: row.repeat_after_days,
    is_active: row.is_active,
    reshow: false,
  };
}

/** Normalises a draft into exactly what the save RPC receives. Validate the RESULT. */
export function draftToSaveArgs(draft: AnnouncementDraft): SaveAnnouncementArgs {
  const isFeature = draft.kind === 'feature';
  const blocking: Blocking = isFeature ? 'soft' : draft.blocking;
  const ctaUrl = cleanSingleLine(draft.cta_url);
  const ctaLabel = cleanSingleLine(draft.cta_label);
  const audience = draft.audience;
  const tenantIds: string[] = [];
  if (audience === 'selected') {
    for (const id of draft.tenant_ids) if (tenantIds.indexOf(id) === -1) tenantIds.push(id);
  }
  return {
    p_id: draft.id,
    p_row: {
      kind: draft.kind,
      title: cleanSingleLine(draft.title),
      summary: isFeature ? cleanSingleLine(draft.summary) || null : null,
      body: isFeature ? null : cleanMultiLine(draft.body) || null,
      image_url: isFeature ? draft.image_url || null : null,
      slides: isFeature
        ? draft.slides.map((s) => ({
            heading: cleanSingleLine(s.heading),
            body: cleanMultiLine(s.body),
            image_url: s.image_url || null,
          }))
        : [],
      cta_label: ctaUrl ? ctaLabel || null : null,
      cta_url: ctaUrl || null,
      display: isFeature ? null : draft.display,
      blocking,
      tone: isFeature ? null : draft.tone,
      audience,
      segment_key: audience === 'segment' ? draft.segment_key : null,
      repeat_after_days: blocking === 'hard' ? null : draft.repeat_after_days,
      is_active: draft.is_active,
    },
    p_tenant_ids: tenantIds,
    p_reshow: draft.id !== null && draft.reshow,
  };
}

export interface SlideErrors {
  heading?: string;
  body?: string;
  image_url?: string;
}

export interface DraftErrors {
  title?: string;
  summary?: string;
  body?: string;
  image_url?: string;
  slides?: string;
  slideErrors?: Array<SlideErrors | null>;
  cta_url?: string;
  cta_label?: string;
  display?: string;
  blocking?: string;
  tone?: string;
  audience?: string;
  segment_key?: string;
  tenant_ids?: string;
  repeat_after_days?: string;
}

function checkSingleLine(value: string | null, max: number, what: string, required: boolean): string | undefined {
  if (!value) return required ? what + ' is required.' : undefined;
  if (codePointLength(value) > max) return what + ' must be ' + max + ' characters or fewer.';
  if (SINGLE_LINE_FORBIDDEN_RE.test(value)) return what + ' cannot contain line breaks or tabs.';
  return undefined;
}

function checkMultiLine(value: string | null, max: number, what: string): string | undefined {
  if (!value) return what + ' is required.';
  if (codePointLength(value) > max) return what + ' must be ' + max + ' characters or fewer.';
  if (MULTI_LINE_FORBIDDEN_RE.test(value)) return what + ' cannot contain tabs or control characters.';
  return undefined;
}

/**
 * Mirrors every CHECK in ops/portal_announcements.sql for a normalised save payload.
 * `valid` true means the database will accept p_row (targets are checked server-side too).
 */
export function validateSaveArgs(args: SaveAnnouncementArgs): { valid: boolean; errors: DraftErrors } {
  const row = args.p_row;
  const errors: DraftErrors = {};
  const isFeature = row.kind === 'feature';

  if (!isOneOf(ANNOUNCEMENT_KINDS, row.kind)) errors.title = 'Unknown announcement kind.';

  const titleErr = checkSingleLine(row.title, isFeature ? LIMITS.featureTitle : LIMITS.systemTitle, 'Title', true);
  if (titleErr) errors.title = titleErr;

  if (isFeature) {
    const summaryErr = checkSingleLine(row.summary, LIMITS.featureSummary, 'One-line description', true);
    if (summaryErr) errors.summary = summaryErr;
    if (!row.image_url) errors.image_url = 'Upload the card illustration.';
    else if (!isAnnouncementImageUrl(row.image_url)) errors.image_url = 'Upload the image again; this link is not from the announcement image store.';
    if (row.slides.length < LIMITS.slidesMin || row.slides.length > LIMITS.slidesMax) {
      errors.slides = 'Add between ' + LIMITS.slidesMin + ' and ' + LIMITS.slidesMax + ' slides.';
    }
    const slideErrors: Array<SlideErrors | null> = row.slides.map((s) => {
      const e: SlideErrors = {};
      const h = checkSingleLine(s.heading, LIMITS.slideHeading, 'Slide heading', true);
      if (h) e.heading = h;
      const b = checkMultiLine(s.body, LIMITS.slideBody, 'Slide text');
      if (b) e.body = b;
      if (s.image_url !== null && !isAnnouncementImageUrl(s.image_url)) e.image_url = 'Upload the image again.';
      return e.heading || e.body || e.image_url ? e : null;
    });
    if (slideErrors.some((e) => e !== null)) errors.slideErrors = slideErrors;
  } else {
    const max = row.display === 'banner' ? LIMITS.systemBodyBanner : LIMITS.systemBodyDialog;
    const bodyErr = checkMultiLine(row.body, max, 'Message');
    if (bodyErr) errors.body = bodyErr;
    if (!isOneOf(SYSTEM_DISPLAYS, row.display)) errors.display = 'Choose dialog or banner.';
    if (!isOneOf(ANNOUNCEMENT_TONES, row.tone)) errors.tone = 'Choose a colour.';
    if (!isOneOf(BLOCKING_LEVELS, row.blocking)) errors.blocking = 'Choose soft or hard.';
    if (row.blocking === 'hard' && row.audience === 'segment' && row.segment_key && !SEGMENTS[row.segment_key].hardAllowed) {
      errors.blocking = 'This smart filter cannot carry a hard blocker: tenants cannot clear it themselves.';
    }
  }

  if (row.cta_url !== null) {
    if (!isInPortalPath(row.cta_url)) {
      errors.cta_url = 'Use a portal path that starts with a single "/", for example /insights/expenses.';
    } else if (!resolveInPortalCta(row.cta_url)) {
      errors.cta_url = 'This path cannot be opened inside the portal.';
    }
    const labelErr = checkSingleLine(row.cta_label, LIMITS.ctaLabel, 'Button label', true);
    if (labelErr) errors.cta_label = labelErr;
  }

  if (!isOneOf(AUDIENCES, row.audience)) errors.audience = 'Choose who sees this.';
  if (row.audience === 'segment' && !isOneOf(SEGMENT_KEYS, row.segment_key)) errors.segment_key = 'Choose a smart filter.';
  if (row.audience === 'selected' && args.p_tenant_ids.length === 0) errors.tenant_ids = 'Choose at least one tenant.';

  if (row.repeat_after_days !== null && !isRepeatAfterDays(row.repeat_after_days)) {
    errors.repeat_after_days = 'Choose once, 1, 3 or 7 days.';
  }

  const valid = Object.keys(errors).length === 0;
  return { valid, errors };
}

export function validateAnnouncementDraft(draft: AnnouncementDraft): { valid: boolean; errors: DraftErrors; args: SaveAnnouncementArgs } {
  const args = draftToSaveArgs(draft);
  const { valid, errors } = validateSaveArgs(args);
  return { valid, errors, args };
}
