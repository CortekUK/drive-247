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
 *      It briefly became a main column and a sticky rail; the rail's cards
 *      were later removed, so it is now honestly one column.
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

/** The details tab body. */
function detailsBody(src: string): string {
  const start = src.indexOf('<TabsContent value="details"');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('</TabsContent>', start));
}

/** Markup only: comments mention removed things by name and must not count. */
/**
 * Source with every comment stripped.
 *
 * Comments count as matches, and this has already produced one test that
 * passed on a comment explaining the very thing it was asserting was gone.
 *
 * BOTH forms, which is the part that caught me a second time: JSX comments
 * are `{/* … *\/}`, but a comment inside a plain expression — an entry in an
 * array, say — is a bare `/* … *\/` with no braces, and stripping only the
 * first form leaves it behind.
 */
const markup = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

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

  it('offers none of the tenant controls in the header any more', () => {
    // Sep 26 2026, take two. They were briefly removed outright; the follow-up
    // brief, with an arrow drawn from the buttons to the account row, moved
    // them into the account menu instead. So they are gone from HERE, and the
    // test below proves they are somewhere.
    const markup = headerMarkup(page());
    expect(markup).not.toContain('handleUpdateType');
    expect(markup).not.toContain('handleUpdateStatus');
    expect(markup).not.toContain('setShowDeleteConfirm');
  });

  it('carries no back link above the title', () => {
    const s = page();
    expect(s).not.toContain('Back button');
    // The one surviving "Back to Rental Companies" is on the "Tenant not
    // found" screen — error recovery, the only way off a dead page, and the
    // brief's "remove breadcrumbs" did not mean strand people on an error.
    const backLinks = s.match(/Back to Rental Companies/g) ?? [];
    expect(backLinks).toHaveLength(1);
    expect(s.slice(s.indexOf('Back to Rental Companies') - 400, s.indexOf('Back to Rental Companies')))
      .toContain('Tenant not found');
  });
});

describe('the tenant controls moved into the account menu', () => {
  function registration(src: string): string {
    const start = src.indexOf('useRegisterSidebarSections(');
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('if (loading)', start));
  }

  it('registers all four, so none was lost in the move', () => {
    const reg = registration(page());
    for (const id of ['production', 'test', 'status', 'delete']) {
      expect(reg, `action '${id}' missing`).toContain(`id: '${id}'`);
    }
  });

  it('marks the type currently in force, so the pair reads as a choice', () => {
    const reg = registration(page());
    expect(reg).toContain("tenant?.tenant_type === 'production' ? 'active'");
    expect(reg).toContain("tenant?.tenant_type === 'test' ? 'active'");
  });

  it('labels the status action by what pressing it will do', () => {
    // "Suspend company" on a live one, "Activate company" on a suspended one.
    expect(registration(page())).toContain("tenant?.status === 'active' ? 'Suspend company' : 'Activate company'");
  });

  it('keeps the handlers and the confirm dialog they drive', () => {
    const s = page();
    for (const kept of ['handleUpdateType', 'handleUpdateStatus', 'handleDelete', 'showDeleteConfirm']) {
      expect(s, `${kept} missing`).toMatch(new RegExp(`\\b${kept}\\b`));
    }
    // Deleting a company still demands its name typed back.
    expect(s).toContain('deleteConfirmName !== tenant.company_name');
  });
});

describe('the details tab is one column with no read-only rail', () => {
  /*
   * Sep 26 2026: the Access URLs and Recent Activity cards were circled in red
   * and removed. They were the whole right-hand rail, so the rail went with
   * them and the grid collapsed to one column — otherwise the `21rem` track
   * would sit empty beside the cards.
   */
  it('has no rail and no two-column grid left behind', () => {
    const body = markup(detailsBody(page()));
    expect(body).not.toContain('<aside');
    expect(body).not.toContain('xl:grid-cols-');
    expect(body).not.toContain('lg:col-span-2');
  });

  it('drops the Access URLs and Recent Activity cards', () => {
    const s = page();
    const body = markup(detailsBody(s));
    expect(body).not.toContain('Access URLs');
    expect(body).not.toContain('Recent Activity');
    // And the fetch that fed the activity card, so it no longer runs for nothing.
    for (const sym of ['loadRecentActivity', 'recentActivity', 'formatActionLabel', 'copyToClipboard']) {
      expect(s, `${sym} still present`).not.toContain(sym);
    }
  });

  it('keeps Company Information', () => {
    expect(markup(detailsBody(page()))).toContain('Company Information');
  });
});

describe('staff users are gone and consent has its own tab', () => {
  /*
   * Sep 26 2026: Staff Users was circled in red and removed; Policy
   * Acceptances was circled in green and moved to a new "Consent" section.
   */
  const consentBody = (src: string) => {
    const start = src.indexOf('<TabsContent value="consent"');
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('</TabsContent>', start));
  };

  it('drops the Staff Users card and the list query that fed it', () => {
    const s = page();
    expect(markup(s)).not.toContain('Staff Users');
    for (const sym of ['loadStaffUsers', 'setStaffUsers', 'staffLoading', 'interface StaffUser']) {
      expect(s, `${sym} still present`).not.toContain(sym);
    }
  });

  it('registers Consent in the rail', () => {
    const s = page();
    const reg = s.slice(s.indexOf('useRegisterSidebarSections('), s.indexOf('if (loading)'));
    expect(reg).toContain("{ id: 'consent', label: 'Consent' }");
  });

  it('renders Policy Acceptances in Consent and nowhere in Details', () => {
    const s = page();
    expect(markup(consentBody(s))).toContain('Policy Acceptances');
    expect(markup(consentBody(s))).toContain('policyAcceptances.map');
    expect(markup(detailsBody(s))).not.toContain('Policy Acceptances');
  });
});

describe('quick actions', () => {
  it('drops Email Contact and Maintenance Banner, dialog included', () => {
    const s = page();
    expect(markup(detailsBody(s))).not.toContain('Email Contact');
    // With its button gone the dialog was unreachable, so it went too.
    for (const sym of ['Maintenance Banner', 'showBannerDialog', 'handleSaveBanner', 'tenantBannerEnabled']) {
      expect(markup(s), `${sym} still present`).not.toContain(sym);
    }
  });

  it('is gone entirely, heading and all', () => {
    // Its last two links moved to the header and Force Logout into Rental
    // Settings, leaving a card whose only remaining job was to hold a
    // heading. Sep 26 2026.
    const s = page();
    expect(markup(s)).not.toContain('Quick Actions');
    // And the icon that titled it, so the import does not linger.
    expect(s).not.toMatch(/\bZap\b/);
  });

  it('puts the two links in the header, without the word "Open"', () => {
    const s = page();
    const header = markup(s.slice(s.indexOf('{/* Page header'), s.indexOf('{/* Tabs */}')));
    expect(header).toContain('Portal');
    expect(header).toContain('Booking Site');
    expect(header).toContain('tenantPortalUrl(tenant.slug)');
    expect(header).toContain('tenantBookingUrl(tenant.slug)');
    // The arrow-out-of-box icon already says the link leaves the app.
    expect(header).toContain('ExternalLink');
    expect(header).not.toContain('Open Portal');
    expect(header).not.toContain('Open Booking Site');
  });

  it('moves Force Logout into the registered actions, dialog intact', () => {
    const s = page();
    const reg = s.slice(s.indexOf('useRegisterSidebarSections('), s.indexOf('if (loading)'));
    expect(reg).toContain("id: 'force-logout'");
    expect(reg).toContain('Force Logout All Users');
    expect(reg).toContain('setShowForceLogoutConfirm(true)');
    // The confirm dialog it opens is unchanged and still reachable.
    expect(s).toContain('open={showForceLogoutConfirm}');
  });

  it('leaves the details body with no action buttons at its top', () => {
    // Company Information is the first card now: the page leads with what it
    // is about, not with a row of buttons.
    const body = markup(detailsBody(page()));
    expect(body.indexOf('Company Information')).toBeGreaterThan(-1);
    expect(body).not.toContain('Force Logout All Users');
  });
});

describe('the rail carries three sections, not six', () => {
  /*
   * Payments, Analytics, Finance Sync and Todos were removed from Super Admin
   * on Sep 26 2026. Removing the rail rows alone would not have been enough:
   * `Tabs` honours a `?tab=` query and a programmatic `value` even with no
   * trigger rendered, so the panels had to go too or they stayed reachable to
   * anyone who had bookmarked the URL. The old Finance Sync gate carried that
   * exact warning in its own comment, which is where the reasoning came from.
   */
  const GONE = ['payments', 'analytics', 'finance', 'todos'];

  it('registers only Details, Management and Consent', () => {
    const s = page();
    const reg = s.slice(s.indexOf('useRegisterSidebarSections('), s.indexOf('if (loading)'));
    expect(reg).toContain("id: 'details'");
    expect(reg).toContain("id: 'management'");
    expect(reg).toContain("id: 'consent'");
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
