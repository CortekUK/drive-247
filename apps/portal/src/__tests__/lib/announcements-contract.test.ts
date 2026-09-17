/**
 * The announcements contract (lib/announcements/contract.ts), pinned.
 *
 * The contract is the one file the database, the super admin and the portal all
 * agree on: limits with SQL CHECK twins, the in-portal CTA rule, the image URL
 * shape, the smart-filter predicates, the row normaliser and the admin's
 * validator. It exists twice (apps/admin has no test runner and cannot import
 * across apps), so the first thing pinned is that both copies are the same bytes.
 *
 * The smart-filter section runs the TS twin against the portal's OWN rules on every
 * fixture of the segment investigation (copied to fixtures/): a filter that picks
 * tenants the portal does not already warn is a filter nobody can reason about.
 */

import { describe, it, expect } from 'vitest';

import {
  ANNOUNCEMENTS_POLL_MS,
  ANNOUNCEMENTS_STALE_MS,
  ANNOUNCEMENT_SETTLE_MS,
  LIMITS,
  announcementImageObjectPath,
  draftToSaveArgs,
  emptyDraft,
  isAnnouncementImageUrl,
  isInPortalPath,
  isOnCtaRoute,
  matchesSegment,
  normalizeAdminAnnouncementStats,
  normalizePortalAnnouncementRow,
  resolveInPortalCta,
  validateAnnouncementDraft,
  type AnnouncementDraft,
  type SegmentKey,
} from '@/lib/announcements/contract';
import { isBonzahSellable } from '@/lib/bonzah';
import { deriveMigrationView } from '@/hooks/migration-view';
import { compileExpression, liftDeclaration, readPortalSource, readRepoSource } from '../helpers/edge-source';
import segmentFixtures from '../fixtures/announcement-segment-fixtures.json';

const UUID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const IMG = (slot: 'card' | 'slide', ext = 'png', host = 'hviqoaokxvlancmftwuo.supabase.co') =>
  `https://${host}/storage/v1/object/public/portal-announcement-media/feature/${slot}/${UUID}.${ext}`;

describe('the two contract copies', () => {
  it('are byte-identical (apps/admin cannot import from apps/portal)', () => {
    const portal = readRepoSource('apps/portal/src/lib/announcements/contract.ts');
    const admin = readRepoSource('apps/admin/lib/announcements/contract.ts');
    expect(portal.length).toBeGreaterThan(1000);
    expect(admin).toBe(portal);
  });

  it('keeps the timing constants the spec fixed', () => {
    expect(ANNOUNCEMENTS_POLL_MS).toBe(300_000);
    expect(ANNOUNCEMENTS_STALE_MS).toBe(60_000);
    expect(ANNOUNCEMENT_SETTLE_MS).toBe(1500);
  });
});

describe('isInPortalPath', () => {
  const accepted = [
    '/',
    '/insights/expenses',
    '/settings?tab=payments#stripe',
    '/rentals/',
    '/x?y=../z',
    '/files/report.v2',
    '/a#../b',
    '/' + 'a'.repeat(LIMITS.ctaUrl - 1),
  ];
  const refused: unknown[] = [
    '',
    'rentals',
    '//evil.example',
    '/\\evil.example',
    '/a\\b',
    'javascript:alert(1)',
    'https://drive-247.com/rentals',
    'http://localhost:3001/',
    '/a b',
    '/a/../b',
    '/./a',
    '/a/..',
    '/..',
    '/a/.?x=1',
    '/a\tb',
    '/a\nb',
    '/ab',
    '/' + 'a'.repeat(LIMITS.ctaUrl),
    null,
    undefined,
    42,
    ['/'],
  ];

  it.each(accepted)('accepts %j', (url) => {
    expect(isInPortalPath(url)).toBe(true);
  });

  it.each(refused)('refuses %j', (url) => {
    expect(isInPortalPath(url)).toBe(false);
  });
});

describe('resolveInPortalCta', () => {
  it('splits a path into pathname, search and hash, and rebuilds the href', () => {
    expect(resolveInPortalCta('/settings?tab=payments#stripe')).toEqual({
      pathname: '/settings',
      search: '?tab=payments',
      hash: '#stripe',
      href: '/settings?tab=payments#stripe',
    });
    expect(resolveInPortalCta('/insights/expenses')).toEqual({
      pathname: '/insights/expenses',
      search: '',
      hash: '',
      href: '/insights/expenses',
    });
  });

  it('returns null for anything isInPortalPath refuses', () => {
    for (const url of ['//evil.example', 'https://x.test/a', '/a b', '', null]) {
      expect(resolveInPortalCta(url)).toBeNull();
    }
  });
});

describe('isOnCtaRoute', () => {
  const table: Array<[string | null, unknown, boolean]> = [
    ['/settings', '/settings?tab=payments', true],
    ['/settings/integrations', '/settings', true],
    ['/settingsx', '/settings', false],
    ['/', '/', true],
    ['/rentals', '/', false],
    ['/rentals', '/rentals/', true],
    ['/rentals/abc', '/rentals/', true],
    ['/customers', '/rentals', false],
    [null, '/rentals', false],
    ['/rentals', null, false],
    ['/rentals', 'https://evil.example/rentals', false],
  ];

  it.each(table)('pathname %j, cta %j -> %j', (pathname, cta, expected) => {
    expect(isOnCtaRoute(pathname, cta)).toBe(expected);
  });
});

describe('isAnnouncementImageUrl', () => {
  it('accepts only public objects this system uploaded', () => {
    expect(isAnnouncementImageUrl(IMG('card'))).toBe(true);
    expect(isAnnouncementImageUrl(IMG('slide', 'jpg'))).toBe(true);
    expect(isAnnouncementImageUrl(IMG('slide', 'webp', '127.0.0.1:54321'))).toBe(true);
  });

  it('refuses everything else', () => {
    const bad: unknown[] = [
      IMG('card').replace('https://', 'http://'),
      IMG('card', 'svg'),
      IMG('card', 'jpeg'),
      IMG('card').replace(UUID, UUID.toUpperCase()),
      IMG('card').replace('portal-announcement-media', 'announcement-media'),
      IMG('card').replace('/feature/card/', '/feature/hero/'),
      IMG('card') + '?download=1',
      IMG('card', 'png', 'a'.repeat(LIMITS.imageUrl) + '.test'),
      'javascript:alert(1)',
      null,
      123,
    ];
    for (const url of bad) expect(isAnnouncementImageUrl(url)).toBe(false);
  });

  it('maps a valid URL to its object path for storage cleanup', () => {
    expect(announcementImageObjectPath(IMG('slide', 'webp'))).toBe(`feature/slide/${UUID}.webp`);
    expect(announcementImageObjectPath('https://x.test/nope.png')).toBeNull();
  });
});

// ─── Admin validation ───────────────────────────────────────────────────────

function featureDraft(over: Partial<AnnouncementDraft> = {}): AnnouncementDraft {
  return {
    ...emptyDraft('feature'),
    title: 'Expense tracker',
    summary: 'Log every cost against the car it belongs to.',
    image_url: IMG('card'),
    slides: [
      { heading: 'Open a vehicle', body: 'Every car has an Expenses tab.', image_url: IMG('slide') },
      { heading: 'Add a cost', body: 'Pick a category and attach the receipt.', image_url: null },
    ],
    ...over,
  };
}

function systemDraft(over: Partial<AnnouncementDraft> = {}): AnnouncementDraft {
  return {
    ...emptyDraft('system'),
    title: 'Scheduled maintenance',
    body: 'The portal is read-only on Sunday from 02:00 to 03:00 UTC.',
    tone: 'info',
    display: 'dialog',
    ...over,
  };
}

const errorsOf = (d: AnnouncementDraft) => validateAnnouncementDraft(d).errors;

describe('validateAnnouncementDraft', () => {
  it('accepts a complete feature and a complete system notice', () => {
    expect(validateAnnouncementDraft(featureDraft()).valid).toBe(true);
    expect(validateAnnouncementDraft(systemDraft()).valid).toBe(true);
    expect(validateAnnouncementDraft(systemDraft({ display: 'banner', tone: 'critical', blocking: 'hard' })).valid).toBe(true);
  });

  it('title: required, single line, 60 for a feature and 80 for a system notice, in code points', () => {
    expect(errorsOf(featureDraft({ title: '   ' })).title).toBe('Title is required.');
    expect(errorsOf(featureDraft({ title: 'a'.repeat(60) })).title).toBeUndefined();
    expect(errorsOf(featureDraft({ title: 'a'.repeat(61) })).title).toBe('Title must be 60 characters or fewer.');
    expect(errorsOf(featureDraft({ title: '\u{1F697}'.repeat(60) })).title).toBeUndefined();
    expect(errorsOf(featureDraft({ title: '\u{1F697}'.repeat(61) })).title).toMatch(/60 characters/);
    expect(errorsOf(systemDraft({ title: 'a'.repeat(80) })).title).toBeUndefined();
    expect(errorsOf(systemDraft({ title: 'a'.repeat(81) })).title).toBe('Title must be 80 characters or fewer.');
    expect(errorsOf(systemDraft({ title: 'two\tparts' })).title).toBe('Title cannot contain line breaks or tabs.');
    expect(errorsOf(systemDraft({ title: 'two\nlines' })).title).toBe('Title cannot contain line breaks or tabs.');
  });

  it('feature: one-line description required, up to 120', () => {
    expect(errorsOf(featureDraft({ summary: '' })).summary).toBe('One-line description is required.');
    expect(errorsOf(featureDraft({ summary: 'a'.repeat(120) })).summary).toBeUndefined();
    expect(errorsOf(featureDraft({ summary: 'a'.repeat(121) })).summary).toMatch(/120 characters/);
  });

  it('feature: the card illustration is required and must come from the image store', () => {
    expect(errorsOf(featureDraft({ image_url: null })).image_url).toBe('Upload the card illustration.');
    expect(errorsOf(featureDraft({ image_url: 'https://cdn.example/card.png' })).image_url).toMatch(/Upload the image again/);
  });

  it('feature: 1 to 10 slides, added and removed freely, each with a heading and text; images optional', () => {
    const d = featureDraft();
    const many = (n: number) => Array.from({ length: n }, (_, i) => d.slides[i % d.slides.length]);
    expect(errorsOf({ ...d, slides: [] }).slides).toBe('Add between 1 and 10 slides.');
    expect(errorsOf({ ...d, slides: many(1) }).slides).toBeUndefined();
    expect(errorsOf({ ...d, slides: many(4) }).slides).toBeUndefined();
    expect(errorsOf({ ...d, slides: many(10) }).slides).toBeUndefined();
    expect(errorsOf({ ...d, slides: many(11) }).slides).toBe('Add between 1 and 10 slides.');

    const blankHeading = errorsOf({ ...d, slides: [{ ...d.slides[0], heading: ' ' }, d.slides[1]] });
    expect(blankHeading.slideErrors?.[0]?.heading).toBe('Slide heading is required.');
    expect(blankHeading.slideErrors?.[1]).toBeNull();

    const longBody = errorsOf({ ...d, slides: [d.slides[0], { ...d.slides[1], body: 'a'.repeat(401) }] });
    expect(longBody.slideErrors?.[1]?.body).toBe('Slide text must be 400 characters or fewer.');

    expect(errorsOf({ ...d, slides: [{ ...d.slides[0], body: 'line one\nline two' }, d.slides[1]] }).slideErrors).toBeUndefined();
    expect(errorsOf({ ...d, slides: [{ ...d.slides[0], body: 'tab\there' }, d.slides[1]] }).slideErrors?.[0]?.body).toMatch(/tabs/);
    expect(errorsOf({ ...d, slides: [{ ...d.slides[0], image_url: 'https://x.test/a.png' }, d.slides[1]] }).slideErrors?.[0]?.image_url).toBe(
      'Upload the image again.',
    );
  });

  it('system: message required, 400 in a dialog and 200 in a banner', () => {
    expect(errorsOf(systemDraft({ body: '\n \n' })).body).toBe('Message is required.');
    expect(errorsOf(systemDraft({ body: 'a'.repeat(400) })).body).toBeUndefined();
    expect(errorsOf(systemDraft({ body: 'a'.repeat(401) })).body).toMatch(/400 characters/);
    expect(errorsOf(systemDraft({ display: 'banner', body: 'a'.repeat(200) })).body).toBeUndefined();
    expect(errorsOf(systemDraft({ display: 'banner', body: 'a'.repeat(201) })).body).toMatch(/200 characters/);
  });

  it('system: the Bonzah filter cannot carry a hard blocker; the others can', () => {
    const bonzah = errorsOf(systemDraft({ blocking: 'hard', audience: 'segment', segment_key: 'bonzah_not_active' }));
    expect(bonzah.blocking).toMatch(/cannot carry a hard blocker/);
    expect(errorsOf(systemDraft({ blocking: 'soft', audience: 'segment', segment_key: 'bonzah_not_active' })).blocking).toBeUndefined();
    expect(errorsOf(systemDraft({ blocking: 'hard', audience: 'segment', segment_key: 'uae_migration_pending' })).blocking).toBeUndefined();
  });

  it('CTA: an in-portal path with a label, both or neither', () => {
    expect(errorsOf(systemDraft({ cta_url: 'https://drive-247.com', cta_label: 'Open' })).cta_url).toMatch(/single "\/"/);
    expect(errorsOf(systemDraft({ cta_url: '/settings', cta_label: '' })).cta_label).toBe('Button label is required.');
    expect(errorsOf(systemDraft({ cta_url: '/settings', cta_label: 'a'.repeat(31) })).cta_label).toMatch(/30 characters/);
    // A label with no URL is dropped by normalisation, not flagged.
    expect(validateAnnouncementDraft(systemDraft({ cta_url: '', cta_label: 'Orphan label' })).valid).toBe(true);
  });

  it('audience: a smart filter needs a key, specific tenants need at least one', () => {
    expect(errorsOf(systemDraft({ audience: 'segment', segment_key: null })).segment_key).toBe('Choose a smart filter.');
    expect(errorsOf(systemDraft({ audience: 'selected', tenant_ids: [] })).tenant_ids).toBe('Choose at least one tenant.');
    expect(errorsOf(systemDraft({ audience: 'selected', tenant_ids: ['t1'] })).tenant_ids).toBeUndefined();
  });

  it('frequency: once, 1, 3 or 7 only', () => {
    expect(errorsOf(systemDraft({ repeat_after_days: 3 })).repeat_after_days).toBeUndefined();
    expect(errorsOf(systemDraft({ repeat_after_days: 2 as never })).repeat_after_days).toBe('Choose once, 1, 3 or 7 days.');
  });
});

describe('draftToSaveArgs', () => {
  it('normalises a feature: trims, forces soft, nulls system-only fields, LF line breaks', () => {
    const args = draftToSaveArgs(
      featureDraft({
        title: '  Expense tracker  ',
        summary: ' One line. ',
        blocking: 'hard',
        display: 'banner',
        tone: 'critical',
        body: 'ignored',
        slides: [
          { heading: ' Open a vehicle ', body: '  first\r\nsecond\rthird  ', image_url: '' as never },
          { heading: 'Add a cost', body: 'Text', image_url: IMG('slide') },
        ],
      }),
    );
    expect(args.p_row).toMatchObject({
      kind: 'feature',
      title: 'Expense tracker',
      summary: 'One line.',
      body: null,
      display: null,
      tone: null,
      blocking: 'soft',
    });
    expect(args.p_row.slides[0]).toEqual({ heading: 'Open a vehicle', body: 'first\nsecond\nthird', image_url: null });
    expect(args.p_row.slides[1].image_url).toBe(IMG('slide'));
  });

  it('normalises a system notice: no feature fields, hard drops the frequency', () => {
    const args = draftToSaveArgs(systemDraft({ blocking: 'hard', repeat_after_days: 7, summary: 'x', image_url: IMG('card') }));
    expect(args.p_row).toMatchObject({ kind: 'system', summary: null, image_url: null, slides: [], repeat_after_days: null });
    expect(draftToSaveArgs(systemDraft({ blocking: 'soft', repeat_after_days: 7 })).p_row.repeat_after_days).toBe(7);
  });

  it('CTA both-or-neither and audience-specific fields', () => {
    expect(draftToSaveArgs(systemDraft({ cta_url: '  ', cta_label: 'Label' })).p_row).toMatchObject({ cta_url: null, cta_label: null });
    expect(draftToSaveArgs(systemDraft({ cta_url: ' /settings ', cta_label: ' Go ' })).p_row).toMatchObject({ cta_url: '/settings', cta_label: 'Go' });

    const all = draftToSaveArgs(systemDraft({ audience: 'all', segment_key: 'bonzah_not_active', tenant_ids: ['t1'] }));
    expect(all.p_row.segment_key).toBeNull();
    expect(all.p_tenant_ids).toEqual([]);

    const selected = draftToSaveArgs(systemDraft({ audience: 'selected', tenant_ids: ['t1', 't2', 't1'], segment_key: 'bonzah_not_active' }));
    expect(selected.p_tenant_ids).toEqual(['t1', 't2']);
    expect(selected.p_row.segment_key).toBeNull();
  });

  it('asks for a re-show only on an update', () => {
    expect(draftToSaveArgs(systemDraft({ id: null, reshow: true })).p_reshow).toBe(false);
    expect(draftToSaveArgs(systemDraft({ id: 'a1', reshow: true })).p_reshow).toBe(true);
    expect(draftToSaveArgs(systemDraft({ id: 'a1', reshow: false })).p_reshow).toBe(false);
  });
});

// ─── Portal normaliser ──────────────────────────────────────────────────────

const rawSystem = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  kind: 'system',
  title: 'Maintenance',
  summary: null,
  body: 'Read-only on Sunday.',
  image_url: null,
  slides: [],
  cta_label: null,
  cta_url: null,
  display: 'banner',
  blocking: 'soft',
  tone: 'info',
  repeat_after_days: null,
  sort_order: 10,
  revision: 1,
  last_shown_at: null,
  dismissed_at: null,
  dont_show_again_at: null,
  is_due: true,
  ...over,
});

const rawFeature = (over: Record<string, unknown> = {}) => ({
  ...rawSystem(),
  id: 'f1',
  kind: 'feature',
  title: 'Expense tracker',
  summary: 'Log every cost.',
  body: null,
  image_url: IMG('card'),
  slides: [
    { heading: 'One', body: 'First', image_url: IMG('slide') },
    { heading: 'Two', body: 'Second', image_url: null },
  ],
  display: null,
  tone: null,
  ...over,
});

describe('normalizeAdminAnnouncementStats', () => {
  // One admin_portal_announcement_stats row as PostgREST returns it: the original nine columns
  // (super admins excluded), then the eight appended in round 4 (super admins included / their part).
  const statsRow = {
    announcement_id: UUID,
    audience_tenants: 4,
    reachable_tenants: 2,
    shown_users: 3,
    shown_tenants: 2,
    card_opened_users: 2,
    dismissed_users: 3,
    dont_show_again_users: 1,
    cta_users: 1,
    shown_all_users: 5,
    shown_all_tenants: 3,
    shown_super_admin_users: 2,
    card_opened_all_users: 3,
    dismissed_all_users: 4,
    cta_all_users: 2,
    cta_super_admin_users: 1,
    dont_show_again_all_users: 2,
  };

  it('passes a full row through with every column, in RETURNS TABLE order', () => {
    const out = normalizeAdminAnnouncementStats(statsRow);
    expect(out).toEqual(statsRow);
    expect(Object.keys(out!)).toEqual(Object.keys(statsRow));
  });

  it('reads the RPC as it was before the columns were appended: everyone = the staff counts, super-admin parts 0', () => {
    const legacy = {
      announcement_id: UUID, audience_tenants: 12, reachable_tenants: 10, shown_users: 41, shown_tenants: 9,
      card_opened_users: 18, dismissed_users: 30, dont_show_again_users: 4, cta_users: 7,
    };
    expect(normalizeAdminAnnouncementStats(legacy)).toEqual({
      ...legacy,
      shown_all_users: 41,
      shown_all_tenants: 9,
      shown_super_admin_users: 0,
      card_opened_all_users: 18,
      dismissed_all_users: 30,
      cta_all_users: 7,
      cta_super_admin_users: 0,
      dont_show_again_all_users: 4,
    });
  });

  it('a row seen only by super admins keeps its real counts (the production "Seen by 0 users" case)', () => {
    const out = normalizeAdminAnnouncementStats({
      ...statsRow, shown_users: 0, shown_tenants: 0, card_opened_users: 0, dismissed_users: 0, dont_show_again_users: 0, cta_users: 0,
      shown_all_users: 1, shown_all_tenants: 1, shown_super_admin_users: 1, card_opened_all_users: 0, dismissed_all_users: 1,
      cta_all_users: 0, cta_super_admin_users: 0, dont_show_again_all_users: 0,
    });
    expect([out!.shown_users, out!.shown_all_users, out!.shown_super_admin_users, out!.dismissed_all_users]).toEqual([0, 1, 1, 1]);
  });

  it('coerces numeric strings, and turns missing, negative, fractional or non-numeric counts into safe integers', () => {
    const out = normalizeAdminAnnouncementStats({
      ...statsRow, audience_tenants: '7', reachable_tenants: -3, shown_users: 'many', shown_tenants: null, card_opened_users: 2.9,
      dismissed_users: Infinity, cta_all_users: undefined, shown_all_users: '',
    });
    expect([out!.audience_tenants, out!.reachable_tenants, out!.shown_users, out!.shown_tenants, out!.card_opened_users,
      out!.dismissed_users, out!.cta_all_users, out!.shown_all_users]).toEqual([7, 0, 0, 0, 2, 0, 0, 0]);
  });

  it('drops rows without an announcement id', () => {
    for (const raw of [null, undefined, 'x', 42, [], {}, { ...statsRow, announcement_id: '' }, { ...statsRow, announcement_id: 7 }]) {
      expect(normalizeAdminAnnouncementStats(raw)).toBeNull();
    }
  });
});

describe('normalizePortalAnnouncementRow', () => {
  it('passes a well-formed row through', () => {
    expect(normalizePortalAnnouncementRow(rawSystem())).toEqual(rawSystem());
    expect(normalizePortalAnnouncementRow(rawFeature())).toEqual(rawFeature());
  });

  it('drops rows it cannot render', () => {
    const dropped: unknown[] = [
      null,
      'row',
      [rawSystem()],
      rawSystem({ id: '' }),
      rawSystem({ kind: 'promo' }),
      rawSystem({ title: '   ' }),
      rawSystem({ body: ' ' }),
      rawSystem({ display: 'toast' }),
      rawSystem({ tone: 'purple' }),
      rawFeature({ summary: null }),
      rawFeature({ slides: [{ heading: '', body: 'x' }, 'nope'] }),
    ];
    for (const raw of dropped) expect(normalizePortalAnnouncementRow(raw)).toBeNull();
  });

  it('degrades unsafe parts instead of dropping the row', () => {
    const offsite = normalizePortalAnnouncementRow(rawSystem({ cta_url: 'https://evil.example', cta_label: 'Pay now' }))!;
    expect([offsite.cta_url, offsite.cta_label]).toEqual([null, null]);

    const blankLabel = normalizePortalAnnouncementRow(rawSystem({ cta_url: '/settings', cta_label: '  ' }))!;
    expect([blankLabel.cta_url, blankLabel.cta_label]).toEqual([null, null]);

    const feature = normalizePortalAnnouncementRow(
      rawFeature({
        image_url: 'https://cdn.example/x.png',
        slides: [
          { heading: 'One', body: 'First', image_url: 'https://cdn.example/y.png' },
          { heading: '', body: 'no heading' },
          { heading: 'Two', body: 'Second' },
          { heading: 'Three', body: 'Third' },
          { heading: 'Four', body: 'Fourth' },
        ],
      }),
    )!;
    expect(feature.image_url).toBeNull();
    // Invalid slides are dropped; valid ones are kept up to LIMITS.slidesMax (10).
    expect(feature.slides.map((s) => s.heading)).toEqual(['One', 'Two', 'Three', 'Four']);
    expect(feature.slides[0].image_url).toBeNull();

    const tooMany = normalizePortalAnnouncementRow(
      rawFeature({ slides: Array.from({ length: 12 }, (_, i) => ({ heading: 'S' + (i + 1), body: 'Body' })) }),
    )!;
    expect(tooMany.slides.map((s) => s.heading)).toEqual(Array.from({ length: 10 }, (_, i) => 'S' + (i + 1)));
  });

  it('forces the server rules the UI relies on', () => {
    const hard = normalizePortalAnnouncementRow(rawSystem({ blocking: 'hard', is_due: false, repeat_after_days: 3 }))!;
    expect(hard.is_due).toBe(true);
    expect(hard.repeat_after_days).toBeNull();

    expect(normalizePortalAnnouncementRow(rawSystem({ blocking: 'weird' }))!.blocking).toBe('soft');
    expect(normalizePortalAnnouncementRow(rawSystem({ repeat_after_days: 2 }))!.repeat_after_days).toBeNull();
    expect(normalizePortalAnnouncementRow(rawSystem({ is_due: 'yes' }))!.is_due).toBe(false);
    expect(normalizePortalAnnouncementRow(rawSystem({ revision: 0 }))!.revision).toBe(1);
    expect(normalizePortalAnnouncementRow(rawSystem({ sort_order: 'x' }))!.sort_order).toBe(0);
    expect(normalizePortalAnnouncementRow(rawFeature({ blocking: 'hard', display: 'dialog', tone: 'info' }))).toMatchObject({
      blocking: 'soft',
      display: null,
      tone: null,
    });
  });
});

// ─── Smart filters: TS twin === the portal's own rules ──────────────────────

// connect-stripe-banner.tsx decides the red "Connect Stripe" banner inside a hook,
// so the two real declarations are lifted and compiled rather than copied.
const bannerSource = readPortalSource('components/banners/sources/connect-stripe-banner.tsx');
const bannerShows = compileExpression<(data: Record<string, unknown>) => boolean>(
  ['data'],
  [liftDeclaration(bannerSource, 'inTestMode', { tsx: true }), liftDeclaration(bannerSource, 'notConnected', { tsx: true })],
  'inTestMode && notConnected',
);

type Fixture = {
  id: string;
  why: string;
  relaxed?: boolean;
  set: Record<string, unknown>;
  expect: { stripe: boolean; bonzah: boolean; migration: boolean };
};

const fx = segmentFixtures as unknown as { defaults: Record<string, unknown>; rows: Fixture[] };
const nowMinus1h = new Date(Date.now() - 3600_000).toISOString();
const rowOf = (f: Fixture) => {
  const r: Record<string, unknown> = { ...fx.defaults, ...f.set };
  for (const k of Object.keys(r)) if (r[k] === '__NOW_MINUS_1H__') r[k] = nowMinus1h;
  return r;
};

describe('matchesSegment against the portal', () => {
  it('has the full fixture set', () => {
    expect(fx.rows.length).toBe(37);
  });

  it.each(fx.rows.map((f) => [f.id, f] as const))('%s', (_id, f) => {
    const r = rowOf(f);
    const t = r as Parameters<typeof matchesSegment>[1];
    const keys: Record<keyof Fixture['expect'], SegmentKey> = {
      stripe: 'stripe_connect_not_connected',
      bonzah: 'bonzah_not_active',
      migration: 'uae_migration_pending',
    };

    // Hand-derived expectation first, so a twin and a portal rule that drift
    // together still fail.
    expect(matchesSegment(keys.stripe, t)).toBe(f.expect.stripe);
    expect(matchesSegment(keys.bonzah, t)).toBe(f.expect.bonzah);
    expect(matchesSegment(keys.migration, t)).toBe(f.expect.migration);

    // The portal's own rules.
    expect(matchesSegment(keys.stripe, t)).toBe(r.payment_provider === 'square' ? false : bannerShows(r));
    expect(matchesSegment(keys.bonzah, t)).toBe(!isBonzahSellable(r as never));
    expect(matchesSegment(keys.migration, t)).toBe(deriveMigrationView(r as never).enrolledIncomplete);
  });

  it('differs from the red banner only for Square tenants', () => {
    const differing = fx.rows.filter((f) => {
      const r = rowOf(f);
      return bannerShows(r) !== matchesSegment('stripe_connect_not_connected', r as never);
    });
    expect(differing.length).toBeGreaterThan(0);
    for (const f of differing) expect(rowOf(f).payment_provider).toBe('square');
  });

  it('never matches a missing tenant', () => {
    for (const key of ['stripe_connect_not_connected', 'bonzah_not_active', 'uae_migration_pending'] as const) {
      expect(matchesSegment(key, null)).toBe(false);
      expect(matchesSegment(key, undefined)).toBe(false);
    }
  });
});
