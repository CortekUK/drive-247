/**
 * The rental company page uses the space it has.
 *
 * Reported Sep 26 2026 with the empty right half of the screen circled in red,
 * and a rule to go with it: what an operator can CHANGE belongs in the main
 * column, what they can only READ belongs in a right-hand rail.
 *
 * Two separate wastes of space were in play, and only one of them is obvious:
 *
 *   1. The header was a `justify-between` row containing a single child. There
 *      was nothing to justify against, so the title sat left and the whole
 *      right side was blank, with the type/suspend/delete buttons stacked on a
 *      second row underneath. Both now share one line.
 *
 *   2. The body was `lg:grid-cols-2` with almost every card marked
 *      `lg:col-span-2`, so in practice it was one column of full-width cards.
 *      It is now a main column and a sticky rail.
 *
 * This reads the source rather than measuring pixels: jsdom has no layout, so
 * a rendered assertion here would prove nothing about where anything sits. The
 * split itself — which card is on which side — is the part worth pinning, and
 * that IS textual.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const page = () => readFileSync(resolve(ROOT, 'app/admin/(protected)/rentals/[id]/page.tsx'), 'utf8');

/** The details tab's two-column body. */
function detailsBody(src: string): string {
  const start = src.indexOf('xl:grid-cols-[minmax(0,1fr)_21rem]');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('</TabsContent>', start));
}

/** Everything inside the rail. */
function rail(src: string): string {
  const body = detailsBody(src);
  const start = body.indexOf('<aside');
  expect(start).toBeGreaterThan(-1);
  return body.slice(start, body.indexOf('</aside>', start));
}

/** Everything in the main column, i.e. the body minus the rail. */
function main(src: string): string {
  const body = detailsBody(src);
  return body.slice(0, body.indexOf('<aside'));
}

describe('the header stops holding empty space open', () => {
  it('puts the title and the actions on one row', () => {
    const s = page();
    // The single-child justify-between is gone.
    expect(s).not.toContain('<div className="space-y-4">\n        <div className="flex items-start justify-between flex-wrap gap-4">');
    const header = s.slice(s.indexOf('{/* Page header'), s.indexOf('{/* Tabs */}'));
    expect(header).toContain('flex flex-wrap items-start justify-between gap-4');
    // Title and every action button live inside that one row.
    for (const control of ['{tenant.company_name}', 'Production', 'Test', 'Delete']) {
      expect(header).toContain(control);
    }
    // And the buttons are no longer on a row of their own.
    expect(header).not.toContain('{/* Action buttons */}');
  });
});

describe('what you can change sits apart from what you can only read', () => {
  it('gives the details tab a main column and a rail', () => {
    const body = detailsBody(page());
    expect(body).toContain('<aside');
    // The rail follows you down the page; the editable side scrolls past it.
    expect(body).toContain('xl:sticky');
    expect(body).toContain('xl:self-start');
    // `minmax(0,1fr)` rather than `1fr`: a bare `1fr` refuses to shrink below
    // its content, so one wide table would push the rail off screen.
    expect(body).toContain('minmax(0,1fr)');
  });

  it('puts the read-only cards in the rail', () => {
    const r = rail(page());
    expect(r).toContain('Access URLs');      // links you copy, never edit
    expect(r).toContain('Recent Activity');  // a log, by definition read-only
  });

  it('keeps the editable and actionable cards in the main column', () => {
    const m = main(page());
    expect(m).toContain('Quick Actions');         // buttons that do things
    expect(m).toContain('Company Information');   // has its own Edit control
    expect(m).toContain('Staff Users');           // accounts you administer
  });

  it('leaves the policy table on the left even though it is read-only', () => {
    // The rule is read-only AND NARROW. Policy acceptances is five columns —
    // user, policy, version, IP, accepted at — and a 21rem rail would crush
    // it. Pinned here so a later tidy-up does not "finish the job" and make
    // the table unreadable.
    const m = main(page());
    const r = rail(page());
    expect(m).toContain('Policy Acceptances');
    expect(r).not.toContain('Policy Acceptances');
  });

  it('drops the col-span hack the old grid needed', () => {
    // Every card used to be `lg:col-span-2` inside a 2-column grid, which is
    // a single column written the long way round.
    const body = detailsBody(page());
    expect(body).not.toContain('lg:col-span-2');
  });
});
