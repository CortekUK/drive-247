/**
 * The what's-new card's four load-bearing guarantees, pinned.
 *
 * All four were defects found in an audit of the already-built card, and all
 * four are invisible from the screen: the card looks identical whether it is
 * gated or not, whether it retries a doomed read four times or once, and
 * whether an unknown severity renders a blank chip. So they are pinned here
 * rather than left to review.
 *
 * WHY SOURCE TEXT AND NOT A RENDER
 * --------------------------------
 * `__tests__/helpers/source.ts` records why this workspace cannot mount portal
 * components: apps/portal pins React 18.3.1 while the monorepo root hoists
 * React 19 for admin/web, so root-hoisted packages (@tanstack/react-query,
 * lucide-react, motion) hand React-19 elements to portal's React-18 renderer.
 * `useFeatureAnnouncements` imports the React Query client and the carousel
 * imports motion, so importing either explodes before an assertion runs.
 *
 * Cases 1–3 therefore assert against the real source text — not a copy of it —
 * and case 4 lifts the actual pure helpers out of that text and runs them, the
 * same technique `deposit-hold-*.test.ts` uses.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readAppSource } from '../helpers/source';

const HOOK = 'hooks/use-feature-announcements.ts';
const CARD = 'components/dashboard-v2/announcement-carousel.tsx';

const hookSrc = readAppSource(HOOK);
const cardSrc = readAppSource(CARD);

/**
 * Slice one module-scope declaration out of source text.
 *
 * `const` declarations here terminate on a column-0 `];` or `};`; a `function`
 * terminates on a column-0 `}`. Both forms are needed because `toSeverity`
 * closes over the `SEVERITIES` list beside it.
 */
function slice(source: string, name: string): string {
  const start = source.search(new RegExp(`^(?:const|function) ${name}\\b`, 'm'));
  if (start === -1) throw new Error(`${name} not found`);
  const rest = source.slice(start);
  const end = rest.search(/^(?:\];|\};|\})$/m);
  if (end === -1) throw new Error(`could not find the end of ${name}`);
  return rest.slice(0, end + rest.slice(end).indexOf('\n'));
}

/** Compile sliced declarations and hand back the one named. */
function lift<T>(source: string, names: string[], returns: string): T {
  const js = ts.transpileModule(names.map((n) => slice(source, n)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  // eslint-disable-next-line no-new-func
  return new Function(`${js}; return ${returns};`)() as T;
}

describe('the what’s-new card is gated to the canary', () => {
  /**
   * V2_PLAN §2: every v2 change — "a screen, a QUERY, a column, a trigger, an
   * edge function" — is gated so northwind sees it and nobody else does.
   *
   * This query shipped with no `enabled` at all. It was gated only by where
   * the carousel happens to be mounted, which is not a gate: any reuse of the
   * component puts the round trip on all 57 tenants, against a card that
   * carries no operational information for any of them.
   */
  it('reads the slug, never the tenant id, and passes it to enabled', () => {
    expect(hookSrc).toContain("import { isLeanTenant } from '@/lib/lean-areas'");
    expect(hookSrc).toContain('isLeanTenant(tenant?.slug)');
    expect(hookSrc).toContain('enabled: isCanary');

    // An id-keyed gate resolves the wrong way in whichever environment it was
    // not written against — silently, because the canary has a different
    // primary key per environment and portal builds with ignoreBuildErrors.
    expect(hookSrc).not.toContain('isLeanTenant(tenant?.id');
  });

  /**
   * React Query's `retry` default is 3 and `app/providers.tsx` does not
   * override it, so `throw error` in the queryFn cost FOUR round trips with
   * backoff on every dashboard mount for a failure that can never succeed —
   * a dropped table, a renamed column, a policy refusal.
   */
  it('swallows a failed read instead of throwing it into a retry storm', () => {
    expect(hookSrc).toContain('retry: false');
    // The one remaining `error` branch must log and return, not rethrow.
    expect(hookSrc).not.toMatch(/if \(error\) throw error;/);
    expect(hookSrc).toContain('[announcements] could not read feature_announcements');
  });

  /**
   * The band in home-bands.tsx is `grid … xl:grid-cols-3` and this card is its
   * first child, so returning null did not leave a gap — it removed a column
   * and shifted the two cards after it left. That is the state on first paint
   * of every load and on any empty or failed read.
   */
  it('never returns null into the band’s three-column grid', () => {
    expect(cardSrc).toContain('if (isLoading) return <EmptySlot className={className} />;');
    expect(cardSrc).toContain('if (!hasDismissed) return <EmptySlot className={className} />;');
  });
});

describe('values written by a super admin are treated as untrusted', () => {
  it('drops a cta_url that would execute on click', () => {
    const safeHref = lift<(u: unknown) => string | null>(cardSrc, ['safeHref'], 'safeHref');

    // Allowed: absolute http(s), and same-origin paths (the in-app CTAs).
    expect(safeHref('https://drive-247.com/whats-new')).toBe('https://drive-247.com/whats-new');
    expect(safeHref('http://example.com')).toBe('http://example.com');
    expect(safeHref('/blocked-dates')).toBe('/blocked-dates');
    expect(safeHref('  /payments  ')).toBe('/payments');

    // Refused. `javascript:` and `data:` in an href run in the operator's
    // authenticated session; `//host` is protocol-relative, i.e. off-origin.
    expect(safeHref('javascript:alert(document.cookie)')).toBeNull();
    expect(safeHref('  JavaScript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHref('//evil.example.com/x')).toBeNull();

    // Absent or wrong-typed, straight from PostgREST.
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(42)).toBeNull();
  });

  it('maps an unrecognised severity onto a chip that still renders', () => {
    const toSeverity = lift<(v: unknown) => string>(
      hookSrc,
      ['SEVERITIES', 'toSeverity'],
      'toSeverity',
    );

    expect(toSeverity('critical')).toBe('critical');
    expect(toSeverity('major')).toBe('major');
    expect(toSeverity('minor')).toBe('minor');
    expect(toSeverity('info')).toBe('info');

    // `severity` is a plain `text` column — the generated types say
    // `severity: string` — so the four values are an admin-form convention,
    // not a database constraint. An unknown value used to index two
    // Record<AnnouncementSeverity, …> lookups to `undefined`, rendering the
    // urgency chip as an empty pill with no label and no fill.
    expect(toSeverity('urgent')).toBe('info');
    expect(toSeverity('')).toBe('info');
    expect(toSeverity(null)).toBe('info');
    expect(toSeverity(undefined)).toBe('info');
    expect(toSeverity(7)).toBe('info');
  });
});
