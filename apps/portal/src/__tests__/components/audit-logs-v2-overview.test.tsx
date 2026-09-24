/**
 * The Audit Logs hero row (components/admin-v2/audit-logs-overview.tsx): the
 * series it hands the chart, the period it opens on, and what it says about
 * the rows it could not load.
 *
 * Every number below is worked out by hand from the fixture, not read off a
 * run. "Today" is Tue 15 Sep 2026, 14:00 local, and the fixture holds 7 entries
 * on 4 days:
 *
 *   Sep 15  l1 rental_created, l2 customer_form_dialog_shown   2 entries, 1 view
 *   Sep 14  l3 rental_created                                  1 entry
 *   Sep 12  l4 + l5 rental_delete_warning_shown, l6 vehicle_updated
 *                                                              3 entries, 2 warnings
 *   Sep  8  l7 login_success                                   1 entry
 *
 * so 7 entries in all, 3 of them views or warnings.
 *
 * LAST 30 DAYS is Aug 17 .. Sep 15, bucket i being Aug 17 + i, so Sep 8 is
 * bucket 22, Sep 12 is 26, Sep 14 is 28 and Sep 15 is 29. The lines are running
 * totals inside the window:
 *   entries    0 up to b21, 1 at b22..b25, 4 at b26, 4 at b27, 5 at b28, 7 at b29
 *   views      0 up to b25, 2 at b26..b28, 3 at b29
 * The previous 30 days (Jul 18 .. Aug 16) hold nothing, so every `previous` is
 * 0 and there is no change chip (a percentage of 0 has no meaning).
 *
 * LAST 7 DAYS is Sep 9 .. Sep 15, bucket i being Sep 9 + i, so Sep 12 is b3,
 * Sep 14 is b5 and Sep 15 is b6; Sep 8 drops into the PREVIOUS week
 * (Sep 2 .. Sep 8, its last bucket):
 *   entries    0, 0, 0, 3, 3, 4, 6      total 6
 *   views      0, 0, 0, 2, 2, 2, 3      total 3
 *   previous   0, 0, 0, 0, 0, 0, 1      total 1   → (6 − 1) / 1 = 500% up
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {}, supabaseUntyped: {} }));

// The drawn points never reach jsdom's zero-sized chart, so the LineChart is
// wrapped to record the data it is handed — the same trick hero-chart-v2's own
// test uses.
const drawn = vi.hoisted(() => ({ data: null as null | Record<string, number | null>[] }));
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  const LineChart = (props: React.ComponentProps<typeof actual.LineChart>) => {
    drawn.data = (props.data as Record<string, number | null>[]) ?? null;
    return <actual.LineChart {...props} />;
  };
  return { ...actual, LineChart };
});

import {
  AuditLogsOverview,
  auditDefaultRange,
  isViewOrWarningAction,
  oldestLoadedDay,
} from '@/components/admin-v2/audit-logs-overview';
import type { AuditLog } from '@/hooks/use-audit-logs';

// recharts' ResponsiveContainer constructs one, and the shared setup installs a
// `vi.fn()`, which is not constructible under Vitest 4.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const TODAY = new Date(2026, 8, 15, 14, 0);
/** Local noon, so the row lands on the same calendar day in any timezone. */
const on = (month: number, day: number) => new Date(2026, month - 1, day, 12).toISOString();

const log = (id: string, created_at: string, action: string): AuditLog =>
  ({
    id,
    created_at,
    action,
    entity_type: 'rental',
    entity_id: null,
    actor_id: null,
    target_user_id: null,
    details: null,
    actor: null,
  }) as AuditLog;

const LOGS: AuditLog[] = [
  log('l1', on(9, 15), 'rental_created'),
  log('l2', on(9, 15), 'customer_form_dialog_shown'),
  log('l3', on(9, 14), 'rental_created'),
  log('l4', on(9, 12), 'rental_delete_warning_shown'),
  log('l5', on(9, 12), 'rental_delete_warning_shown'),
  log('l6', on(9, 12), 'vehicle_updated'),
  log('l7', on(9, 8), 'login_success'),
];

const summary = () => document.querySelector('p.sr-only')?.textContent;
const chip = () => document.querySelector('[data-change]');
const period = () => screen.getByRole('button', { name: /^Period:/ }).textContent;
const line = (key: 'current' | 'secondary' | 'previous') => (drawn.data ?? []).map((p) => p[key]);
/** The capped caption, with its whitespace normalised (JSX wraps it over three lines). */
const caption = () => {
  const p = Array.from(document.querySelectorAll('p')).find((el) => el.textContent?.includes('Only the most recent'));
  return p?.textContent?.replace(/\s+/g, ' ').trim();
};

afterEach(() => {
  cleanup();
  drawn.data = null;
});

describe('what the two lines count', () => {
  it('calls an entry a view or warning only when it records something being SHOWN', () => {
    expect(isViewOrWarningAction('customer_form_dialog_shown')).toBe(true);
    expect(isViewOrWarningAction('rental_delete_warning_shown')).toBe(true);
    expect(isViewOrWarningAction('rental_created')).toBe(false);
    expect(isViewOrWarningAction('login_success')).toBe(false);
    // The substrings `getActionColor` tests first, so a made-up future
    // `*_dialog_shown` action is counted without a new rule being written.
    expect(isViewOrWarningAction('some_new_thing_dialog_shown')).toBe(true);
  });

  it('draws the whole loaded period as running totals, and the period before it flat', () => {
    render(<AuditLogsOverview logs={LOGS} filtered={false} capped={false} today={TODAY} />);
    expect(period()).toContain('Last 30 days');
    expect(drawn.data).toHaveLength(30);

    const entries = line('current');
    expect(entries.slice(0, 22)).toEqual(Array(22).fill(0));
    expect(entries.slice(22, 26)).toEqual([1, 1, 1, 1]);
    expect(entries.slice(26)).toEqual([4, 4, 5, 7]);

    const views = line('secondary');
    expect(views.slice(0, 26)).toEqual(Array(26).fill(0));
    expect(views.slice(26)).toEqual([2, 2, 2, 3]);

    expect(line('previous')).toEqual(Array(30).fill(0));
  });

  it('reads out the two totals, and draws no change chip against an empty period', () => {
    render(<AuditLogsOverview logs={LOGS} filtered={false} capped={false} today={TODAY} />);
    expect(summary()).toBe(
      'Log entries, last 30 days: 7. Previous 30 days: 0. Views & warnings, last 30 days: 3.',
    );
    expect(chip()).toBeNull();
  });

  it('says "Filtered" only when the list below it is narrowed', () => {
    const { rerender } = render(<AuditLogsOverview logs={LOGS} filtered={false} capped={false} today={TODAY} />);
    expect(screen.queryByText('Filtered')).toBeNull();
    rerender(<AuditLogsOverview logs={LOGS} filtered capped={false} today={TODAY} />);
    expect(screen.getByText('Filtered')).toBeTruthy();
  });

  it('places nothing for a row with no date or a date after today', () => {
    render(
      <AuditLogsOverview
        logs={[...LOGS, log('x1', '', 'rental_created'), log('x2', on(12, 25), 'rental_created')]}
        filtered={false}
        capped={false}
        today={TODAY}
      />,
    );
    // Still 7 in the window: the undated row cannot be placed and a
    // future-dated one is not history yet.
    expect(summary()).toContain('last 30 days: 7.');
  });
});

describe('the graph takes the whole row', () => {
  it('draws no featured card, so the chart spans all four columns', () => {
    render(<AuditLogsOverview logs={LOGS} filtered={false} capped={false} today={TODAY} />);
    expect(document.querySelector('[data-hero-card]')).toBeNull();
    expect(document.querySelector('[data-hero-chart]')?.className).toContain('lg:col-span-4');
  });
});

describe('honesty about the fetch cap', () => {
  it('opens on a period the loaded rows cover, and never wider than every other tab', () => {
    // Not capped: we hold everything that matched, so a quiet 30 days is a real
    // quiet 30 days.
    expect(auditDefaultRange(false, 3)).toBe('30d');
    expect(auditDefaultRange(false, undefined)).toBe('30d');
    // Capped: step down only when the rows do not reach back 30 days.
    expect(auditDefaultRange(true, 30)).toBe('30d');
    expect(auditDefaultRange(true, 400)).toBe('30d');
    expect(auditDefaultRange(true, 29)).toBe('7d');
    expect(auditDefaultRange(true, 1)).toBe('7d');
    // Nothing loaded says nothing about the span.
    expect(auditDefaultRange(true, undefined)).toBe('30d');
  });

  it('finds the oldest loaded entry, whatever order the rows arrived in', () => {
    // The fixture's oldest is Sep 8; `startOfDay` of it is Sep 8 00:00 local.
    expect(oldestLoadedDay(LOGS)?.getTime()).toBe(new Date(2026, 8, 8).getTime());
    expect(oldestLoadedDay([])).toBeUndefined();
    expect(oldestLoadedDay([log('x', '', 'rental_created')])).toBeUndefined();
  });

  it('says nothing about a cap when the fetch was not capped', () => {
    render(<AuditLogsOverview logs={LOGS} filtered={false} capped={false} today={TODAY} />);
    expect(caption()).toBeUndefined();
  });

  it('names the oldest entry it holds, and opens on a week it can actually draw', () => {
    render(<AuditLogsOverview logs={LOGS} filtered={false} capped today={TODAY} />);
    // Sep 8 through Sep 15 is 8 calendar days, short of 30, so the graph opens
    // on the week it covers rather than 23 days of flat line it does not.
    expect(period()).toContain('Last 7 days');
    expect(caption()).toBe(
      'Only the most recent 1,000 entries are loaded, back to Sep 8, 2026 — earlier days are not counted here. Filter to look further back.',
    );
  });

  it('draws that week by hand: 6 entries against 1 the week before, 500% up', () => {
    render(<AuditLogsOverview logs={LOGS} filtered={false} capped today={TODAY} />);
    expect(drawn.data).toHaveLength(7);
    expect(line('current')).toEqual([0, 0, 0, 3, 3, 4, 6]);
    expect(line('secondary')).toEqual([0, 0, 0, 2, 2, 2, 3]);
    expect(line('previous')).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(summary()).toBe('Log entries, last 7 days: 6. Previous 7 days: 1. Views & warnings, last 7 days: 3.');
    expect(chip()?.getAttribute('data-change')).toBe('up');
    expect(chip()?.textContent).toBe('500%');
  });
});
