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

describe('the header carries the title and its state, and nothing else', () => {
  /**
   * Comments count as matches, so read the header with them stripped.
   *
   * This bit me: the controls were removed and the explanatory comment left
   * behind mentions "Production", "Test" and "Delete" by name — so an
   * assertion looking for those words in the header kept passing after the
   * buttons were gone. A test that a comment can satisfy is not a test.
   */
  function headerMarkup(src: string): string {
    const header = src.slice(src.indexOf('{/* Page header'), src.indexOf('{/* Tabs */}'));
    return header.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  }

  it('is one row, not a stack with an empty half', () => {
    const s = page();
    expect(s).not.toContain('<div className="space-y-4">\n        <div className="flex items-start justify-between flex-wrap gap-4">');
    expect(headerMarkup(s)).toContain('flex flex-wrap items-start justify-between gap-4');
  });

  it('still names the company and reports its type and status', () => {
    const markup = headerMarkup(page());
    expect(markup).toContain('{tenant.company_name}');
    // The badges REPORT these; only the controls that changed them are gone.
    expect(markup).toContain('{tenant.tenant_type');
    expect(markup).toContain('{tenant.status}');
  });

  it('no longer offers the controls that were removed from Super Admin', () => {
    // Sep 26 2026: the Production/Test switch, Suspend and Delete were taken
    // off this page. The operator's own portal is a separate app and keeps
    // everything it had.
    const markup = headerMarkup(page());
    expect(markup).not.toContain('handleUpdateType');
    expect(markup).not.toContain('handleUpdateStatus');
    expect(markup).not.toContain('setShowDeleteConfirm');
  });

  it('leaves nothing behind that could still reach them', () => {
    // A dialog with no way to open it is dead code that reads as a feature.
    //
    // Whole-word matching, because `handleDeletePlan` — which deletes a
    // SUBSCRIPTION PLAN in Management and is staying — contains
    // `handleDelete` as a substring. A plain `toContain` failed on it and
    // would have had me deleting the wrong function.
    const s = page();
    for (const gone of ['handleDelete', 'showDeleteConfirm', 'handleUpdateType', 'handleUpdateStatus']) {
      expect(s, `${gone} still present`).not.toMatch(new RegExp(`\\b${gone}\\b`));
    }
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

describe('the rail carries two sections, not six', () => {
  /*
   * Payments, Analytics, Finance Sync and Todos were removed from Super Admin
   * on Sep 26 2026. Removing the rail rows alone would not have been enough:
   * `Tabs` honours a `?tab=` query and a programmatic `value` even with no
   * trigger rendered, so the panels had to go too or they stayed reachable to
   * anyone who had bookmarked the URL. The old Finance Sync gate carried that
   * exact warning in its own comment, which is where the reasoning came from.
   */
  const GONE = ['payments', 'analytics', 'finance', 'todos'];

  it('registers only Details and Management', () => {
    const s = page();
    const reg = s.slice(s.indexOf('useRegisterSidebarSections('), s.indexOf('if (loading)'));
    expect(reg).toContain("id: 'details'");
    expect(reg).toContain("id: 'management'");
    for (const id of GONE) expect(reg).not.toContain(`id: '${id}'`);
  });

  it('renders no panel for the removed sections', () => {
    const s = page();
    for (const id of GONE) {
      expect(s, `<TabsContent value="${id}"> still rendered`).not.toContain(`<TabsContent value="${id}"`);
    }
  });

  it('imports none of the components they used', () => {
    // Left behind, these would be dead imports that still ship in the bundle.
    const s = page();
    for (const c of ['TenantPaymentsTab', 'FinanceEventsTab', 'AdminTodosTab', 'KPICard']) {
      expect(s, `${c} still imported`).not.toContain(c);
    }
  });

  it('drops the analytics chart machinery that fed the removed tab', () => {
    const s = page();
    for (const sym of ['loadChartData', 'handlePeriodChange', 'analyticsFromDate', 'MonthlyData']) {
      expect(s, `${sym} still present`).not.toContain(sym);
    }
  });

  it('leaves the tenant portal alone, which is a different app entirely', () => {
    // The ask was explicit: remove from Super Admin, not from the operator's
    // own site. They are separate Next apps, so this is true by construction —
    // asserted anyway, because "separate app" is the whole reason this removal
    // was safe to make.
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    const { resolve } = require('node:path') as typeof import('node:path');
    expect(existsSync(resolve(ROOT, '../portal/src/app'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'app/admin'))).toBe(true);
  });
});
