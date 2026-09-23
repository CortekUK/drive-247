/**
 * v2 lists: newest added first, no sorting, centred cells, and the customers
 * table's five columns (team lead's review, Sep 2026).
 *
 * The pages are too large to render here, so the decisions that live in named
 * declarations are LIFTED out of the shipped source and run (`edge-source.ts`),
 * and the markup is pinned by reading the source. Every expected order below
 * was worked out by hand from its fixture.
 */
import { describe, expect, it, vi } from 'vitest';

import { getTabTour } from '@/lib/tab-tours';
import { codeOnly, compileExpression, liftDeclaration, readPortalSource } from '../helpers/edge-source';

const CUSTOMERS = 'app/(dashboard)/customers/page.tsx';
const FINES = 'app/(dashboard)/fines/page.tsx';
const PAYMENTS = 'app/(dashboard)/payments/page.tsx';
const INSURANCE = 'app/(dashboard)/insurance/page.tsx';
const INSURANCE_LIST = 'components/insurance-v2/insurance-policy-list-v2.tsx';
const AGREEMENTS = 'app/(dashboard)/agreements/page.tsx';

/** The text between two markers, both required. */
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  if (from === -1) throw new Error(`start marker not found: ${start}`);
  const to = source.indexOf(end, from);
  if (to === -1) throw new Error(`end marker not found: ${end}`);
  return source.slice(from, to);
}

/** Heading labels in order, from `<ListHead …>Label</ListHead>`. */
const headings = (table: string) =>
  [...table.matchAll(/<ListHead\b[^>]*>([^<]*)<\/ListHead>/g)].map((m) => m[1].trim());

describe('customers (v2): five columns, no actions menu', () => {
  const source = readPortalSource(CUSTOMERS);
  const v2Table = codeOnly(between(source, '<ListTable rows={customerRows}', '</ListTable>'));
  const v1Table = codeOnly(between(source, '<Table>', '</Table>'));

  it("shows Name, Email, Type, Verification and Gig driver, in the lead's order", () => {
    expect(headings(v2Table)).toEqual(['Name', 'Email', 'Type', 'Verification', 'Gig driver']);
  });

  it('keeps the tour anchor on the Verification heading', () => {
    expect(v2Table).toContain('<ListHead className="w-[16%]" data-tour="customers-verified-column">Verification</ListHead>');
  });

  it('draws the cells in the same order as the headings', () => {
    const at = (needle: string) => {
      const i = v2Table.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const name = at('{customer.name}');
    const email = at('{customer.email}');
    const type = at("<ListMetaChip>{customer.user_type || 'Guest'}</ListMetaChip>");
    const verification = at('<ListStatusText tone="success">Verified</ListStatusText>');
    const gig = at('(customer as any).is_gig_driver');
    expect([name, email, type, verification, gig]).toEqual([...[name, email, type, verification, gig]].sort((a, b) => a - b));
  });

  it('has no Phone, Balance or actions column, and no row menu', () => {
    for (const gone of ['customer.phone', 'balanceData', 'formatCurrency', 'DropdownMenu', 'sr-only', 'LIST_ROW_ACTION']) {
      expect(v2Table, gone).not.toContain(gone);
    }
  });

  it('fills the window from md up and uses the kit minimum width', () => {
    expect(v2Table).toContain('<ListTable rows={customerRows} fillViewport>');
  });

  it('starts the name cell at the left, button and contact icon together', () => {
    // The flex row needs no `justify-start` (a flex row starts there anyway),
    // but the <button> does need `text-left`: a button centres its own text
    // whatever the cell around it says.
    expect(v2Table).toContain('flex min-w-0 items-center gap-1.5');
    expect(v2Table).toContain('truncate text-left hover:underline');
    expect(v2Table).not.toContain('justify-center');
    expect(v2Table).not.toContain('text-center');
  });

  it('leaves the v1 table as it was: contact, balance, sortable headings and the actions menu', () => {
    expect(v1Table).toContain('<TableHead>Contact</TableHead>');
    expect(v1Table).toContain("onClick={() => handleSort('balance')}");
    expect(v1Table).toContain('<CustomerBalanceChip');
    expect(v1Table).toContain('onClick={() => handleDeleteClick(customer)}');
  });

  it('never sorts on v2, and writes no sort to the URL there', () => {
    const code = codeOnly(source);
    expect(code).toContain('if (sortField && !v2Chrome) {');
    expect(code).toContain("if (sortField && !v2Chrome) params.set('sortBy', sortField);");
    expect(code).toContain("if (sortOrder !== 'asc' && !v2Chrome) params.set('sortOrder', sortOrder);");
    expect(code).toContain('`${debouncedSearchTerm}|${statusFilter}|${userTypeFilter}`');
  });

  it("keeps the CSV export's Phone and Balance columns", () => {
    expect(source).toContain(
      "['Name', 'Email', 'Phone', 'Type', 'User type', 'Status', 'Verified', 'Gig driver', 'Balance', 'Balance status', 'Added']",
    );
  });
});

describe('customers (v1): Delete goes through the shared hook', () => {
  const source = readPortalSource(CUSTOMERS);

  it('no longer deletes on its own', () => {
    const code = codeOnly(source);
    expect(code).toContain('const { deleteCustomer } = useDeleteCustomer();');
    expect(code).not.toContain('revoke-customer-session');
    expect(code).not.toMatch(/from\(['"]customers['"]\)\s*\.delete\(\)/);
    expect(code).not.toContain('logAction');
  });

  it("hands the hook this screen's follow-up: close the dialog, clear the selection, refetch the list", async () => {
    const handleDeleteCustomer = compileExpression<
      (
        selectedCustomer: unknown,
        deleteCustomer: unknown,
        setDeleteDialogOpen: unknown,
        setSelectedCustomer: unknown,
        refetchCustomers: unknown,
      ) => () => Promise<void>
    >(
      ['selectedCustomer', 'deleteCustomer', 'setDeleteDialogOpen', 'setSelectedCustomer', 'refetchCustomers'],
      [liftDeclaration(source, 'handleDeleteCustomer', { tsx: true })],
      'handleDeleteCustomer',
    );

    const calls: string[] = [];
    const customer = { id: 'cust-1', name: 'Jane Doe' };
    const deleteCustomer = vi.fn(async (_c: unknown, options: { onDeleted: () => void }) => {
      calls.push('deleteCustomer');
      options.onDeleted();
      return true;
    });
    const run = handleDeleteCustomer(
      customer,
      deleteCustomer,
      (open: boolean) => calls.push(`setDeleteDialogOpen(${open})`),
      (value: unknown) => calls.push(`setSelectedCustomer(${value})`),
      () => calls.push('refetchCustomers()'),
    );
    await run();

    expect(deleteCustomer).toHaveBeenCalledWith(customer, expect.any(Object));
    expect(calls).toEqual(['deleteCustomer', 'setDeleteDialogOpen(false)', 'setSelectedCustomer(null)', 'refetchCustomers()']);
  });

  it('does nothing with no customer selected', async () => {
    const handleDeleteCustomer = compileExpression<(...args: unknown[]) => () => Promise<void>>(
      ['selectedCustomer', 'deleteCustomer', 'setDeleteDialogOpen', 'setSelectedCustomer', 'refetchCustomers'],
      [liftDeclaration(source, 'handleDeleteCustomer', { tsx: true })],
      'handleDeleteCustomer',
    );
    const deleteCustomer = vi.fn();
    await handleDeleteCustomer(null, deleteCustomer, vi.fn(), vi.fn(), vi.fn())();
    expect(deleteCustomer).not.toHaveBeenCalled();
  });

  it('the v2 record calls the same hook', () => {
    const record = codeOnly(readPortalSource('components/customers-v2/customer-detail/section-account.tsx'));
    expect(record).toContain('import { useDeleteCustomer } from "@/hooks/use-delete-customer";');
    expect(record).toContain('const { deleteCustomer, isDeleting } = useDeleteCustomer();');
  });
});

describe('v2 list headings do not sort', () => {
  for (const file of [CUSTOMERS, FINES, PAYMENTS, INSURANCE_LIST]) {
    it(`${file} passes no sort to a heading`, () => {
      expect(codeOnly(readPortalSource(file))).not.toMatch(/<ListHead\b[^>]*\bsort=/);
    });
  }

  it('the insurance list takes no sort props at all', () => {
    const list = codeOnly(readPortalSource(INSURANCE_LIST));
    for (const gone of ['sortField', 'sortDirection', 'onSort', 'InsurancePolicySortFieldV2']) {
      expect(list, gone).not.toContain(gone);
    }
  });

  it('fines keep their newest-added default, which nothing on v2 can change', () => {
    const code = codeOnly(readPortalSource(FINES));
    expect(code).toContain("const [sortBy, setSortBy] = useState('created_at');");
    expect(code).toContain("const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');");
  });
});

describe('payments (v2): newest added first', () => {
  const source = readPortalSource(PAYMENTS);
  const order = compileExpression<(v2Chrome: boolean, sortBy: string, sortOrder: string) => [string, string]>(
    ['v2Chrome', 'sortBy', 'sortOrder'],
    [liftDeclaration(source, 'listSortBy', { tsx: true }), liftDeclaration(source, 'listSortOrder', { tsx: true })],
    '[listSortBy, listSortOrder]',
  );

  it('asks for created_at descending on v2, whatever the sort state holds', () => {
    expect(order(true, 'payment_date', 'desc')).toEqual(['created_at', 'desc']);
    expect(order(true, 'amount', 'asc')).toEqual(['created_at', 'desc']);
  });

  it("keeps v1's own sort", () => {
    expect(order(false, 'payment_date', 'desc')).toEqual(['payment_date', 'desc']);
    expect(order(false, 'customer', 'asc')).toEqual(['customer', 'asc']);
  });

  it('is the order the data hook is given', () => {
    const code = codeOnly(source);
    expect(code).toContain('sortBy: listSortBy,');
    expect(code).toContain('sortOrder: listSortOrder,');
  });

  it('starts the link buttons at the left and follows the amount stack right', () => {
    const code = codeOnly(source);
    expect(code.match(/block max-w-full truncate text-left hover:underline/g)).toHaveLength(3);
    expect(code).not.toContain('mx-auto block max-w-full truncate');
    // Amount is money, so its cell reads right and the rate line under it
    // follows: `items-end`, because a flex column ignores text-align.
    expect(code).toContain('<ListHead className="w-[13.2%] px-2 text-right">Amount</ListHead>');
    expect(code).toContain('<div className="flex flex-col items-end gap-0.5">');
  });
});

describe('insurance policies (v2): newest added first', () => {
  const source = readPortalSource(INSURANCE);
  const listed = compileExpression<(v2Chrome: boolean, policies: unknown[], sortedPolicies: unknown[]) => any[]>(
    ['v2Chrome', 'policies', 'sortedPolicies'],
    [liftDeclaration(source, 'createdAtMs', { tsx: true }), liftDeclaration(source, 'listedPolicies', { tsx: true })],
    'listedPolicies',
  );

  // In the query's order (soonest expiry first). By creation, newest first:
  // p4 (Sep 10 2026 08:30:00.500), p2 (Sep 10 2026 08:30:00.123456, 377ms
  // earlier), p1 (Mar 1 2026), p5 (Dec 31 2025), then p3, which has no date.
  const policies = [
    { id: 'p1', created_at: '2026-03-01T10:00:00+00:00' },
    { id: 'p2', created_at: '2026-09-10T08:30:00.123456+00:00' },
    { id: 'p3', created_at: null },
    { id: 'p4', created_at: '2026-09-10T08:30:00.5+00:00' },
    { id: 'p5', created_at: '2025-12-31T23:59:59Z' },
  ];

  it('lists by creation, newest first, with an undated policy last', () => {
    expect(listed(true, policies, []).map((p) => p.id)).toEqual(['p4', 'p2', 'p1', 'p5', 'p3']);
  });

  it('does not reorder the array it was given', () => {
    listed(true, policies, []);
    expect(policies.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it("hands v1 its own sorted rows, untouched", () => {
    const sortedPolicies = [policies[2], policies[0]];
    expect(listed(false, policies, sortedPolicies)).toBe(sortedPolicies);
  });

  it('is what the v2 table and the export receive', () => {
    const code = codeOnly(source);
    expect(code).toContain('policies={listedPolicies}');
    expect(code).toContain('exportInsuranceToCSV(listedPolicies,');
  });

  it('centres the expiry stack', () => {
    expect(codeOnly(readPortalSource(INSURANCE_LIST))).toContain('<div className="flex flex-col items-center gap-0.5">');
  });
});

describe('agreements (v2): newest added first across all three sources', () => {
  const source = readPortalSource(AGREEMENTS);
  const newestFirst = compileExpression<(v2Chrome: boolean, filteredAgreements: unknown[]) => any[]>(
    ['v2Chrome', 'filteredAgreements'],
    [liftDeclaration(source, 'createdAtMs', { tsx: true }), liftDeclaration(source, 'agreementsNewestFirst', { tsx: true })],
    'agreementsNewestFirst',
  );

  // As the page builds them: rental agreements, then extensions, then signed
  // documents, each newest first. Across all five: e1 and s2 were created at
  // the same instant (Sep 16 2026 15:45:10.250), so e1 stays ahead of s2 as it
  // was; then s1 (Jan 20 2026), r1 (Nov 2 2025), r2 (Jun 1 2025).
  const agreements = [
    { id: 'r1', created_at: '2025-11-02T09:00:00+00:00' },
    { id: 'r2', created_at: '2025-06-01T12:00:00+00:00' },
    { id: 'e1', created_at: '2026-09-16T15:45:10.25+00:00' },
    { id: 's1', created_at: '2026-01-20T00:00:00+00:00' },
    { id: 's2', created_at: '2026-09-16T15:45:10.25+00:00' },
  ];

  it('interleaves the sources by creation, keeping ties in their original order', () => {
    expect(newestFirst(true, agreements).map((a) => a.id)).toEqual(['e1', 's2', 's1', 'r1', 'r2']);
  });

  it('leaves v1 with the concatenated order', () => {
    expect(newestFirst(false, agreements)).toBe(agreements);
  });

  it('only the v2 table gets the new order; the v1 pager still slices the filtered list', () => {
    const code = codeOnly(source);
    expect(code).toContain('rows={agreementsNewestFirst}');
    expect(code).toContain('const paginatedDocuments = filteredAgreements.slice(startIndex, endIndex);');
  });
});

describe('fines (v2): left-aligned cells, money apart', () => {
  const code = codeOnly(readPortalSource(FINES));

  it('starts the due-date stack at the left and keeps the date truncating', () => {
    expect(code).toContain('<div className="flex flex-col items-start gap-0.5">');
    expect(code).toContain("'block max-w-full truncate',");
  });

  it('leaves both selection checkboxes on the left edge', () => {
    // A checkbox is a block-level flex box, so what puts it on the left is the
    // absence of a centring margin, not the cell's text-align.
    expect(code).not.toContain('<CheckboxV2\n                  className="mx-auto"');
    expect(code).not.toMatch(/<CheckboxV2\s+className="mx-auto"/);
  });

  it('right-aligns the Amount column, heading and cell', () => {
    expect(code).toContain('<ListHead className="w-[11%] text-right">Amount</ListHead>');
    expect(code).toContain('<ListCell className="text-right tabular-nums">');
  });
});

describe('customers tour copy', () => {
  const steps = getTabTour('customers')!.steps;
  const step = (id: string) => steps.find((s) => s.id === id)!;

  it('names the Verification and Gig driver columns as the table now does', () => {
    expect(step('customers.open').notes).toEqual([
      {
        text: 'Verification and Gig driver tell you at a glance who has been checked.',
        anchors: ['[data-tour="customers-verified-column"]'],
      },
    ]);
  });

  it("says where Delete went, only when the record's Delete section is on screen", () => {
    const [note] = step('customers.standing').notes!;
    expect(note).toEqual({
      text: 'Deleting a customer for good is at the bottom of this page.',
      anchors: ['[data-tour="customer-delete"]'],
    });
    expect(note.text.length).toBeLessThan(120);
    expect(codeOnly(readPortalSource('components/customers-v2/customer-detail/section-account.tsx'))).toContain(
      '<div data-tour="customer-delete">',
    );
  });
});
