/**
 * /audit-logs after the filter bar moved into the top bar and the overview flip
 * (app/(dashboard)/audit-logs/page.tsx).
 *
 * The page hands the bar its search and a filters config, and the five filters
 * that used to sit in a row under the title now live on the BACK face of the
 * overview. Everything else on the page — the 25-per-page v1 pager, the fetch
 * cap and its server count, Export CSV, the empty state, and v1's inline bar —
 * has to behave exactly as it did.
 *
 * `useAuditLogs` is faked rather than stubbed: it applies the same clauses the
 * real query applies (`eq` on entity_type / action / actor_id, `gte` dateFrom,
 * `lte` dateTo + "T23:59:59") to a fixture. So "this filter narrows the rows"
 * is checked end to end — the panel writes a value, the page puts it in the
 * filters object, the query drops the rows that do not match — rather than
 * stopping at "the page called something".
 *
 * Expected values are worked out by hand from the fixture below:
 *   - entity "rental": l1, l3, l4, l5 (4 of the 7 rows).
 *   - action `rental_created`: l1 and l3.
 *   - actor u1: l1, l4, l5.
 *   - from 2026-09-14: l1, l2, l3 — a pure string compare against the raw
 *     timestamps, so it holds in any timezone.
 *   - search "ada": l1 and l6 carry `details.customer_name` "Ada Lovelace".
 *   - active count: entity + action + actor = 3, and a from/to pair is 2.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditLog } from '@/hooks/use-audit-logs';

// A real client starts an auth refresh timer that jsdom's storage breaks, and
// nothing here talks to Supabase.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {}, supabaseUntyped: {} }));

const env = vi.hoisted(() => ({
  v2: true,
  rows: [] as unknown[],
  /** Every filters object `useAuditLogs` was called with, in order. */
  filterCalls: [] as unknown[],
  /** `[filters, enabled]` for every server-count call. */
  countCalls: [] as [unknown, boolean][],
  serverCount: undefined as number | undefined,
  toast: vi.fn(),
  /** What the page registered with the top bar (null when it registered nothing). */
  reg: undefined as any,
  /** The props the v2 table was given on its last render. */
  table: null as any,
  /** The props the overview was given on its last render. */
  overview: null as any,
}));

vi.mock('@/lib/v2-context', () => ({ useV2: () => env.v2 }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: { id: 't1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: env.toast }) }));
vi.mock('@/components/shared/layout/page-search-slot', () => ({
  usePageSearch: (reg: any) => {
    env.reg = reg;
  },
}));
// The flip's own turning is presentation and has its own home; here it only has
// to show one face at a time so the panel can be driven.
vi.mock('@/components/shared/layout/overview-flip', () => ({
  OverviewFlip: ({ front, back, flipped }: any) => <div>{flipped ? back : front}</div>,
}));
vi.mock('@/components/admin-v2/audit-logs-table-v2', () => ({
  AuditLogsTableV2: (props: any) => {
    env.table = props;
    return (
      <ul data-testid="v2-table">
        {props.logs.map((l: AuditLog) => (
          <li key={l.id}>{l.id}</li>
        ))}
      </ul>
    );
  },
}));
// The graph is checked in audit-logs-v2-overview.test.tsx; here we only care
// which rows and which flags the page hands it.
vi.mock('@/components/admin-v2/audit-logs-overview', () => ({
  AuditLogsOverview: (props: any) => {
    env.overview = props;
    return <div data-testid="overview" />;
  },
}));

vi.mock('@/hooks/use-audit-logs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-audit-logs')>();
  return {
    ...actual,
    useAuditLogs: (filters: any) => {
      env.filterCalls.push(filters);
      const rows = (env.rows as AuditLog[]).filter((log) => {
        if (filters?.entityType && filters.entityType !== 'all' && log.entity_type !== filters.entityType) return false;
        if (filters?.action && filters.action !== 'all' && log.action !== filters.action) return false;
        if (filters?.actorId && filters.actorId !== 'all' && log.actor_id !== filters.actorId) return false;
        if (filters?.dateFrom && log.created_at < filters.dateFrom) return false;
        if (filters?.dateTo && log.created_at > `${filters.dateTo}T23:59:59`) return false;
        return true;
      });
      return { data: rows, isLoading: false };
    },
    useAuditLogsServerCount: (filters: any, enabled: boolean) => {
      env.countCalls.push([filters, enabled]);
      return { data: enabled ? env.serverCount : undefined };
    },
    useAuditLogActions: () => ({ data: ['rental_created', 'vehicle_updated', 'login_success'] }),
    useAdminUsers: () => ({
      data: [
        { id: 'u1', name: 'Ada Admin', email: 'ada@example.com' },
        { id: 'u2', name: null, email: 'ops@example.com' },
      ],
    }),
  };
});

import AuditLogs from '@/app/(dashboard)/audit-logs/page';
import { AuditLogsFilterPanel, countActiveAuditLogFilters } from '@/components/admin-v2/audit-logs-filter-panel';
import { auditLogSearchText, filterAuditLogs } from '@/hooks/use-audit-logs';

const log = (
  id: string,
  created_at: string,
  action: string,
  entity_type: string,
  actor_id: string | null,
  details: Record<string, unknown> | null,
  actor: { name: string | null; email: string } | null = actor_id
    ? { name: actor_id === 'u1' ? 'Ada Admin' : null, email: actor_id === 'u1' ? 'ada@example.com' : 'ops@example.com' }
    : null,
): AuditLog =>
  ({
    id,
    created_at,
    action,
    entity_type,
    entity_id: null,
    actor_id,
    target_user_id: null,
    details,
    actor,
  }) as AuditLog;

const ROWS: AuditLog[] = [
  log('l1', '2026-09-15T10:00:00Z', 'rental_created', 'rental', 'u1', { customer_name: 'Ada Lovelace' }),
  log('l2', '2026-09-15T09:00:00Z', 'customer_form_dialog_shown', 'customer', 'u2', { customer_name: 'Grace Hopper' }),
  log('l3', '2026-09-14T08:00:00Z', 'rental_created', 'rental', 'u2', { reason: 'Late return' }),
  log('l4', '2026-09-12T07:00:00Z', 'rental_delete_warning_shown', 'rental', 'u1', null),
  log('l5', '2026-09-12T06:00:00Z', 'rental_delete_warning_shown', 'rental', 'u1', {
    previous_status: 'Active',
    new_status: 'Closed',
  }),
  log('l6', '2026-09-12T05:00:00Z', 'vehicle_updated', 'vehicle', null, { customer_name: 'Ada Lovelace' }),
  log('l7', '2026-09-08T05:00:00Z', 'login_success', 'user', 'u2', {}),
];

/** The ids the v2 table was handed, in order. */
const shownIds = () => (env.table?.logs ?? []).map((l: AuditLog) => l.id);
/** A filter section on the panel's back face, by its mini-label. */
const section = (title: string) => screen.getByText(title).closest('.space-y-2') as HTMLElement;
const chip = (sectionTitle: string, label: string) =>
  within(section(sectionTitle)).getByRole('button', { name: label });
const openFilters = () => act(() => env.reg.filters.onOpenChange(true));
const search = (term: string) => act(() => env.reg.onChange(term));

beforeEach(() => {
  env.v2 = true;
  env.rows = ROWS;
  env.filterCalls = [];
  env.countCalls = [];
  env.serverCount = undefined;
  env.reg = undefined;
  env.table = null;
  env.overview = null;
  env.toast.mockReset();
});

afterEach(cleanup);

describe('v2: what the page lends the top bar', () => {
  it('registers its own search and filter button, with nothing active yet', () => {
    render(<AuditLogs />);
    expect(env.reg.placeholder).toBe('Search log entries…');
    expect(env.reg.value).toBe('');
    expect(env.reg.filters.open).toBe(false);
    expect(env.reg.filters.activeCount).toBe(0);
  });

  it('counts each filter it is given, dates one apiece', () => {
    // Nothing, and the "no filter" value, count for nothing.
    expect(countActiveAuditLogFilters({})).toBe(0);
    expect(countActiveAuditLogFilters({ entityType: 'all', action: 'all', actorId: 'all' })).toBe(0);
    expect(countActiveAuditLogFilters({ entityType: '', action: undefined })).toBe(0);
    // One each.
    expect(countActiveAuditLogFilters({ entityType: 'rental' })).toBe(1);
    expect(countActiveAuditLogFilters({ action: 'rental_created' })).toBe(1);
    expect(countActiveAuditLogFilters({ actorId: 'u1' })).toBe(1);
    // Half-open ranges count 1, a closed one counts 2 — each date is its own
    // clause, and a badge of 1 over a range would hide the other bound.
    expect(countActiveAuditLogFilters({ dateFrom: '2026-09-01' })).toBe(1);
    expect(countActiveAuditLogFilters({ dateTo: '2026-09-15' })).toBe(1);
    expect(countActiveAuditLogFilters({ dateFrom: '2026-09-01', dateTo: '2026-09-15' })).toBe(2);
    // All five.
    expect(
      countActiveAuditLogFilters({
        entityType: 'rental',
        action: 'rental_created',
        actorId: 'u1',
        dateFrom: '2026-09-01',
        dateTo: '2026-09-15',
      }),
    ).toBe(5);
  });

  it('re-registers the count as filters go on, and the open flag as the panel turns', () => {
    render(<AuditLogs />);
    openFilters();
    expect(env.reg.filters.open).toBe(true);

    act(() => chip('Entity', 'Rental').click());
    expect(env.reg.filters.activeCount).toBe(1);
    act(() => chip('Action', 'Rental Add').click());
    expect(env.reg.filters.activeCount).toBe(2);
    act(() => chip('Performed by', 'Ada Admin').click());
    expect(env.reg.filters.activeCount).toBe(3);
  });
});

describe('v2: the panel on the back of the overview', () => {
  it('shows the graph until it is flipped, then the five filters', () => {
    render(<AuditLogs />);
    expect(screen.getByTestId('overview')).toBeTruthy();
    expect(screen.queryByText('Performed by')).toBeNull();

    openFilters();
    expect(screen.queryByTestId('overview')).toBeNull();
    for (const title of ['Entity', 'Action', 'Performed by', 'Date range']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it.each([
    ['Entity', 'Rental', ['l1', 'l3', 'l4', 'l5']],
    ['Action', 'Rental Add', ['l1', 'l3']],
    ['Performed by', 'Ada Admin', ['l1', 'l4', 'l5']],
  ])('%s → %s narrows the rows to the ones that match', (sectionTitle, label, expected) => {
    render(<AuditLogs />);
    openFilters();
    act(() => chip(sectionTitle, label).click());
    expect(shownIds()).toEqual(expected);
  });

  it('writes the same values the query expects, and "all" writes nothing at all', () => {
    render(<AuditLogs />);
    openFilters();
    act(() => chip('Entity', 'Rental').click());
    act(() => chip('Action', 'Rental Add').click());
    expect(env.filterCalls.at(-1)).toEqual({ entityType: 'rental', action: 'rental_created' });

    act(() => chip('Entity', 'All').click());
    expect(env.filterCalls.at(-1)).toEqual({ entityType: undefined, action: 'rental_created' });
    expect(shownIds()).toEqual(['l1', 'l3']);
  });

  it('Reset clears every filter AND the search, and takes the badge back to 0', () => {
    render(<AuditLogs />);
    openFilters();
    act(() => chip('Entity', 'Rental').click());
    search('ada');
    // Rentals are l1, l3, l4, l5. "ada" is on l1 (the customer Ada Lovelace AND
    // the actor Ada Admin) and on l4 and l5 (Ada Admin); l3's actor is the
    // unnamed ops@example.com and its only detail is "Late return".
    expect(shownIds()).toEqual(['l1', 'l4', 'l5']);
    expect(env.reg.value).toBe('ada');

    act(() => screen.getByRole('button', { name: /Reset/ }).click());
    expect(env.reg.filters.activeCount).toBe(0);
    expect(env.reg.value).toBe('');
    expect(shownIds()).toEqual(ROWS.map((r) => r.id));
  });

  it('offers Reset only once something is on, and ✕ turns the card back', () => {
    render(<AuditLogs />);
    openFilters();
    expect(screen.queryByRole('button', { name: /Reset/ })).toBeNull();

    act(() => chip('Entity', 'Rental').click());
    expect(screen.getByRole('button', { name: /Reset/ })).toBeTruthy();

    act(() => screen.getByRole('button', { name: 'Close filters' }).click());
    expect(env.reg.filters.open).toBe(false);
  });

  it('reads a stored date back on the local calendar day, and Clear dates drops both', () => {
    // Panel on its own: the dates are held as bare `yyyy-MM-dd` strings, which
    // `new Date` would read as UTC midnight and print as the day before west of
    // Greenwich. This is the one assertion that would fail if that regressed.
    const onChange = vi.fn();
    render(
      <AuditLogsFilterPanel
        filters={{ entityType: 'rental', dateFrom: '2026-09-01', dateTo: '2026-09-15' }}
        actions={[]}
        users={[]}
        onChange={onChange}
        onClear={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Sep 1, 2026')).toBeTruthy();
    expect(screen.getByText('Sep 15, 2026')).toBeTruthy();

    fireEvent.click(screen.getByText('Clear dates'));
    expect(onChange).toHaveBeenCalledWith({ entityType: 'rental', dateFrom: undefined, dateTo: undefined });
  });
});

describe('v2: the search box', () => {
  it('matches the action label, the raw key, the entity, the customer, the actor and the details', () => {
    const row = ROWS[0]; // rental_created / rental / Ada Lovelace / Ada Admin
    const text = auditLogSearchText(row);
    for (const needle of ['rental add', 'rental_created', 'rental', 'ada lovelace', 'ada admin', 'ada@example.com']) {
      expect(text, needle).toContain(needle);
    }
    // A row with no actor is searchable by the word the table prints for it.
    expect(auditLogSearchText(ROWS[5])).toContain('system');
    // The details are matched as the tooltip shows them, values and all.
    expect(auditLogSearchText(ROWS[2])).toContain('late return');
    expect(auditLogSearchText(ROWS[4])).toContain('"previous_status":"active"');
    // The date is not matched: From/To are the way to narrow by date.
    expect(auditLogSearchText(row)).not.toContain('2026-09-15');
  });

  it('is case-insensitive, trims, and an empty term hands back the same array', () => {
    expect(filterAuditLogs(ROWS, '  ADA lovelace ').map((l) => l.id)).toEqual(['l1', 'l6']);
    expect(filterAuditLogs(ROWS, 'grace').map((l) => l.id)).toEqual(['l2']);
    expect(filterAuditLogs(ROWS, 'no such thing')).toEqual([]);
    expect(filterAuditLogs(ROWS, '')).toBe(ROWS);
    expect(filterAuditLogs(ROWS, '   ')).toBe(ROWS);
  });

  it('narrows the table, and stacks with a filter', () => {
    render(<AuditLogs />);
    search('ada lovelace');
    expect(shownIds()).toEqual(['l1', 'l6']);

    openFilters();
    act(() => chip('Entity', 'Vehicle').click());
    expect(shownIds()).toEqual(['l6']);
  });

  it('goes in the table\'s reset key, so the 25-row fill starts again on a new result set', () => {
    render(<AuditLogs />);
    const before = env.table.resetKey;
    search('ada');
    expect(env.table.resetKey).not.toBe(before);
    expect(env.table.resetKey.endsWith('|ada')).toBe(true);
  });

  it('falls through to the empty state, which offers a way out', () => {
    render(<AuditLogs />);
    search('no such thing');
    expect(screen.queryByTestId('v2-table')).toBeNull();
    expect(screen.getByText('No audit logs found')).toBeTruthy();
    expect(screen.getByText('Try adjusting your filter criteria')).toBeTruthy();

    act(() => screen.getByRole('button', { name: /Clear Filters/ }).click());
    expect(env.reg.value).toBe('');
    expect(shownIds()).toEqual(ROWS.map((r) => r.id));
  });

  it('tells the graph it is looking at a narrowed list', () => {
    render(<AuditLogs />);
    expect(env.overview.filtered).toBe(false);
    search('ada');
    expect(env.overview.filtered).toBe(true);
    // Ada Admin performed l1, l4 and l5; Ada Lovelace is the customer on l1 and l6.
    expect(env.overview.logs.map((l: AuditLog) => l.id)).toEqual(['l1', 'l4', 'l5', 'l6']);
  });
});

describe('the fetch cap', () => {
  it('asks for the server count only once the fetch came back full, and says so to the graph', () => {
    render(<AuditLogs />);
    // 7 rows is nowhere near the cap.
    expect(env.countCalls.at(-1)![1]).toBe(false);
    expect(env.overview.capped).toBe(false);
    expect(env.table.serverCount).toBeUndefined();

    cleanup();
    env.rows = Array.from({ length: 1000 }, (_, i) =>
      log(`c${i}`, '2026-09-15T10:00:00Z', 'rental_created', 'rental', 'u1', null),
    );
    env.serverCount = 4210;
    render(<AuditLogs />);
    expect(env.countCalls.at(-1)![1]).toBe(true);
    expect(env.overview.capped).toBe(true);
    expect(env.table.serverCount).toBe(4210);
  });

  it('is a v1 page\'s business too: v1 never asks for a count', () => {
    env.v2 = false;
    env.rows = Array.from({ length: 1000 }, (_, i) =>
      log(`c${i}`, '2026-09-15T10:00:00Z', 'rental_created', 'rental', 'u1', null),
    );
    render(<AuditLogs />);
    expect(env.countCalls.every(([, enabled]) => enabled === false)).toBe(true);
  });
});

describe('Export CSV', () => {
  // jsdom's Blob has no `text()`, so the parts are captured as they are handed
  // to the constructor — which is the string the export actually builds.
  let captured: string | null;
  const RealBlob = globalThis.Blob;
  beforeEach(() => {
    captured = null;
    (globalThis as any).Blob = class {
      constructor(parts: unknown[]) {
        captured = parts.join('');
      }
    };
    (URL as any).createObjectURL = vi.fn(() => 'blob:audit');
    (URL as any).revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    (globalThis as any).Blob = RealBlob;
  });

  const csv = () => (captured === null ? [] : captured.split('\n'));

  it('exports every loaded row, header first', () => {
    render(<AuditLogs />);
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    const lines = csv();
    // The header row is joined unquoted while the data rows are quoted — v1's
    // own quirk, pinned here so the move cannot quietly change the file format.
    expect(lines[0]).toBe('Date & Time,Action,Entity Type,Entity Name,Details,Performed By');
    expect(lines).toHaveLength(8); // 1 header + 7 rows
    // l3's reason and l5's status change, worded as the table words them.
    expect(lines[3]).toContain('"Reason: Late return"');
    expect(lines[5]).toContain('"Status: Active → Closed"');
    // A row with no actor exports the word the table prints.
    expect(lines[6].endsWith('"System"')).toBe(true);
    expect(env.toast).toHaveBeenCalledWith({ title: 'CSV exported successfully' });
  });

  it('exports what the table is showing once a search narrows it', () => {
    render(<AuditLogs />);
    search('grace');
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    const lines = csv();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Grace Hopper"');
  });

  it('refuses when there is nothing on screen', () => {
    render(<AuditLogs />);
    search('no such thing');
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(env.toast).toHaveBeenCalledWith({ title: 'No data to export', variant: 'destructive' });
    expect(captured).toBeNull();
  });
});

describe('v1 is untouched', () => {
  beforeEach(() => {
    env.v2 = false;
  });

  it('keeps its inline bar — three dropdowns and two date buttons — and lends the bar nothing', () => {
    render(<AuditLogs />);
    expect(env.reg).toBeNull();
    expect(screen.queryByTestId('overview')).toBeNull();
    expect(screen.queryByTestId('v2-table')).toBeNull();
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    expect(screen.getByText('From date')).toBeTruthy();
    expect(screen.getByText('To date')).toBeTruthy();
    expect(screen.getByText('to')).toBeTruthy();
    // The v1 table, with its own header row.
    expect(screen.getByText('Date & Time')).toBeTruthy();
    expect(screen.getByText('Performed By')).toBeTruthy();
  });

  it('still pages 25 at a time', () => {
    env.rows = Array.from({ length: 30 }, (_, i) =>
      log(`p${i}`, '2026-09-15T10:00:00Z', 'rental_created', 'rental', 'u1', null),
    );
    render(<AuditLogs />);
    // 30 rows over a page size of 25: two pages, 25 then 5.
    expect(screen.getByText('Showing 1-25 of 30 log entries')).toBeTruthy();
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(25);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Showing 26-30 of 30 log entries')).toBeTruthy();
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(5);
  });

  it('shows the empty state with no rows at all', () => {
    env.rows = [];
    render(<AuditLogs />);
    expect(screen.getByText('No audit logs found')).toBeTruthy();
    expect(screen.getByText('Activity logs will appear here as actions are performed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clear Filters/ })).toBeNull();
  });
});
