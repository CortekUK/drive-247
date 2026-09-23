/**
 * Team lead review, Sep 23 2026 (v2 canary only): headings AND cells read LEFT
 * in every v2 list table, reversing the Sep 17 review that centred them — a
 * centred heading over a left-ish column left a band of dead space down the
 * left of every list. Money is the one exception: it reads right, heading
 * included, so a run of figures stacks and can be scanned. The trailing
 * actions column stays right, and the row "..." menus are the ui-v2 menu.
 *
 * The kit's `LIST_CLASSES.head` / `.cell` carry `text-left`; these tests pin
 * what the kit alone cannot reach: a call site's own `text-right` (money, and
 * the actions column), and content that does not inherit text-align — a
 * block-level flex row, or a <button>, whose UA default is `text-align: center`
 * however the cell around it is set.
 *
 * (This file was `v2-list-tables-centred.test.tsx` until the reversal.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A table helper module imports the Supabase client; no test here talks to it,
// and a real client starts an auth refresh timer that jsdom's storage breaks.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {}, supabaseUntyped: {} }));

import { LIST_CLASSES } from '@/components/shared/list-table-v2';
import { GlobalBlacklistTableV2 } from '@/components/blacklist-v2/global-blacklist-table-v2';
import { BlogCategoriesTableV2 } from '@/components/cms-v2/blog-categories-table-v2';
import { CreditTransactionsTableV2 } from '@/components/credits-v2/credit-transactions-table-v2';
import { BlockedCustomersTableV2 } from '@/components/customers-v2/blocked-customers-tables-v2';
import { PlatesTableV2 } from '@/components/fleet-v2/plates-table-v2';
import { ExtrasTableV2 } from '@/components/settings-v2/extras-table-v2';
import { PromoCodesTableV2 } from '@/components/settings-v2/promo-codes-table-v2';

afterEach(cleanup);

const classes = (el: Element | null) => {
  expect(el).not.toBeNull();
  return Array.from(el!.classList);
};
const headings = (root: ParentNode) => Array.from(root.querySelectorAll('thead th'));
const noop = () => {};

describe('the kit is the one place the alignment is set', () => {
  it('left-aligns headings and cells, with nothing centred left in the strings', () => {
    expect(LIST_CLASSES.head).toContain('text-left');
    expect(LIST_CLASSES.head).not.toContain('text-center');
    expect(LIST_CLASSES.cell).toContain('text-left');
    expect(LIST_CLASSES.cell).not.toContain('text-center');
  });

  it('keeps the alignment LAST in each string, so tailwind-merge resolves it predictably', () => {
    // Both strings are fed to `cn(LIST_CLASSES.x, className)`, so a call site's
    // own alignment already wins. Position matters only against anything else
    // the kit might one day put in the same string.
    expect(LIST_CLASSES.head.trim().endsWith('text-left')).toBe(true);
    expect(LIST_CLASSES.cell.trim().endsWith('text-left')).toBe(true);
  });
});

describe('credit transactions: the ledger reads right, the rest reads left', () => {
  it('right-aligns Amount and Balance, heading and cell, and leaves the rest left', () => {
    const tx = {
      id: 'tx1',
      tenant_id: 't1',
      wallet_id: 'w1',
      type: 'purchase',
      amount: 50,
      balance_after: 150,
      category: null,
      description: 'Top up',
      reference_id: null,
      reference_type: null,
      package_id: null,
      stripe_payment_id: null,
      created_at: '2026-09-01T10:00:00Z',
    } as any;
    const { container } = render(<CreditTransactionsTableV2 transactions={[tx]} resetKey="t1" />);

    const heads = headings(container);
    expect(heads.map((h) => h.textContent)).toEqual(['Date', 'Type', 'Description', 'Category', 'Amount', 'Balance']);
    for (const h of heads.slice(0, 4)) {
      expect(classes(h)).toContain('text-left');
      expect(classes(h)).not.toContain('text-right');
    }
    for (const h of heads.slice(4)) {
      expect(classes(h)).toContain('text-right');
      expect(classes(h)).not.toContain('text-left');
    }

    const cells = Array.from(container.querySelectorAll('tbody tr:first-child td'));
    expect(cells).toHaveLength(6);
    expect(cells[4].textContent).toBe('+50');
    expect(cells[5].textContent).toBe('150');
    for (const td of cells.slice(0, 4)) {
      expect(classes(td)).toContain('text-left');
      expect(classes(td)).not.toContain('text-right');
    }
    for (const td of cells.slice(4)) {
      expect(classes(td)).toContain('text-right');
      expect(classes(td)).not.toContain('text-left');
    }
  });
});

describe('global blacklist: the Details column trails right, everything else reads left', () => {
  it('right-aligns the Show button and lets the expanded details inherit the kit', () => {
    const entry = {
      id: 'g1',
      email: 'jane@example.com',
      blocked_tenant_count: 2,
      first_blocked_at: '2026-01-02T12:00:00Z',
      last_blocked_at: '2026-02-03T12:00:00Z',
      blocking_tenants: [{ tenant_name: 'Acme Rentals', reason: 'Fraud', blocked_at: null }],
    };
    const { container } = render(
      <GlobalBlacklistTableV2 entries={[entry]} resetKey="k" expandedIds={new Set(['g1'])} onToggle={noop} />,
    );

    const heads = headings(container);
    expect(heads.map((h) => h.textContent)).toEqual(['Email', 'Status', 'First blocked', 'Last blocked', 'Details']);
    for (const h of heads.slice(0, 4)) expect(classes(h)).toContain('text-left');
    // Details is this table's action column, so it trails right like every other.
    expect(classes(heads[4])).toContain('text-right');

    const toggle = container.querySelector('button[aria-controls="global-blacklist-details-g1"]');
    const wrapper = toggle!.parentElement!;
    expect(classes(wrapper)).toContain('justify-end');
    expect(classes(wrapper)).not.toContain('justify-center');

    const details = container.querySelector('#global-blacklist-details-g1 td');
    expect(details!.getAttribute('colspan')).toBe('5');
    // No override any more: the kit already left-aligns it.
    expect(classes(details)).toContain('text-left');
    expect(classes(details)).not.toContain('text-center');
  });
});

describe('plates: row buttons start at the left, Cost and the actions column do not', () => {
  const plate = {
    id: 'p1',
    plate_number: 'AB12 CDE',
    vehicle_id: 'v1',
    status: 'received',
    document_url: 'https://files.example.com/p1.pdf',
    document_name: 'p1.pdf',
    vehicles: { id: 'v1', reg: 'XY70 ABC', make: 'Ford', model: 'Focus' },
  };
  const props = {
    resetKey: 'k',
    hasActiveFilters: false,
    currencyCode: 'USD',
    documentTitle: () => 'Plate document',
    onCopyPlateNumber: noop,
    onOpenVehicle: noop,
    onOpenDocument: noop,
    onEdit: noop,
    onViewHistory: noop,
    onAssign: noop,
    onUnassign: noop,
    onMarkExpired: noop,
    onDelete: noop,
    onClearFilters: noop,
    onAddPlate: noop,
  };

  it('gives copy, vehicle and document buttons text-left and no centring margin', () => {
    const { container } = render(<PlatesTableV2 {...props} plates={[plate]} isLoading={false} />);
    const buttons = [
      container.querySelector('button[title="Click to copy"]'),
      container.querySelector('button[title="XY70 ABC • Ford Focus"]'),
      container.querySelector('button[title="Plate document"]'),
    ];
    for (const b of buttons) {
      const cls = classes(b);
      // A <button> centres its own text unless told otherwise, so `text-left`
      // here is load-bearing — the cell's alignment does not reach inside it.
      expect(cls).toContain('text-left');
      expect(cls).not.toEqual(expect.arrayContaining(['mx-auto']));
      expect(cls).not.toEqual(expect.arrayContaining(['justify-center']));
      expect(cls).not.toContain('text-center');
    }
    const heads = headings(container);
    expect(heads).toHaveLength(9);
    expect(heads.map((h) => h.textContent)).toEqual([
      'Plate number',
      'Vehicle',
      'Supplier',
      'Order date',
      'Cost',
      'Status',
      'Notes',
      'Document',
      'Actions',
    ]);
    // Cost is money and the last column is the actions menu; the other seven read left.
    for (const i of [0, 1, 2, 3, 5, 6, 7]) expect(classes(heads[i])).toContain('text-left');
    expect(classes(heads[4])).toContain('text-right');
    expect(classes(heads[8])).toContain('text-right');
    const cost = Array.from(container.querySelectorAll('tbody tr:first-child td'))[4];
    expect(classes(cost)).toContain('text-right');
    expect(classes(container.querySelector('button[aria-label="Actions for plate AB12 CDE"]'))).toContain('ml-auto');
  });

  it('starts the loading bars at the left, except the actions bar, which sits right', () => {
    const { container } = render(<PlatesTableV2 {...props} plates={[]} isLoading />);
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      const bars = Array.from(row.querySelectorAll('td > div'));
      expect(bars).toHaveLength(9);
      // A bar is a block div: text-align cannot move it, so the absence of a
      // margin is what leaves it on the left edge.
      bars.slice(0, 8).forEach((bar) => expect(classes(bar)).not.toContain('mx-auto'));
      expect(classes(bars[8])).toContain('ml-auto');
      expect(classes(bars[8])).not.toContain('mx-auto');
    }
  });
});

describe('promo codes: the code button reads left in the table and on the phone list', () => {
  it('uses one treatment for both copies, and right-aligns Value', () => {
    const promo = {
      id: 'pr1',
      name: 'Summer',
      code: 'SUMMER10',
      type: 'percentage',
      value: 10,
      created_at: '2026-06-01',
      expires_at: '2099-01-01',
      max_users: 5,
      min_duration_days: null,
    };
    const { container } = render(
      <PromoCodesTableV2 promos={[promo]} resetKey="k" currencyCode="USD" canEdit onCopy={noop} onEdit={noop} onDelete={noop} />,
    );
    const inTable = classes(container.querySelector('table button[aria-label="Copy promo code SUMMER10"]'));
    expect(inTable).toContain('text-left');
    expect(inTable).not.toEqual(expect.arrayContaining(['mx-auto']));
    expect(inTable).not.toEqual(expect.arrayContaining(['justify-center']));
    const onPhone = classes(container.querySelector('ul button[aria-label="Copy promo code SUMMER10"]'));
    expect(onPhone).toContain('text-left');
    expect(onPhone).not.toContain('mx-auto');

    const heads = headings(container);
    expect(heads.map((h) => h.textContent)).toEqual([
      'Name',
      'Code',
      'Value',
      'Created',
      'Expires',
      'Max users',
      'Auto-apply',
      'Actions',
    ]);
    // Value is the money column; Max users is a count and stays left with the rest.
    expect(classes(heads[2])).toContain('text-right');
    expect(classes(heads[5])).toContain('text-left');
    expect(classes(heads[7])).toContain('text-right');
    const cells = Array.from(container.querySelectorAll('tbody tr:first-child td'));
    expect(classes(cells[2])).toContain('text-right');
    expect(classes(cells[5])).toContain('text-left');
  });
});

describe('extras: the whole table reads left, and only Price leaves the left edge', () => {
  /**
   * The Sep 20 2026 review turned the name column back to the left on its own
   * ("a list of names", matching Locations) while everything around it was
   * still centred; Sep 23 made that the rule, so the column carries no override
   * of its own any more and simply inherits the kit.
   *
   * The SAME Sep 20 review cut the table down to Name, Price, Pricing, Stock,
   * Status (plus the trailing actions column, which only someone who can edit
   * gets): Image, Description and Type were removed on purpose — the picture is
   * the row's hover card, the description is in the Edit dialog, and Stock
   * already says what Type said. The heading list is compared exactly so a
   * removed column cannot creep back, and the header reads "Name", not "Extra".
   */
  const extra = {
    id: 'e1',
    tenant_id: 't1',
    name: 'Child seat',
    description: 'Group 1 seat',
    price: 15,
    pricing_type: 'per_day',
    extra_type: 'countable',
    stock_quantity: 4,
    is_active: true,
    sort_order: 1,
    created_at: '2026-09-01T10:00:00Z',
    image_urls: [],
  } as any;

  it('inherits the kit everywhere but Price and Actions, and lists no column that was cut', () => {
    const { container } = render(
      <ExtrasTableV2
        extras={[extra]}
        resetKey="t1"
        currencyCode="USD"
        canEdit
        isLowStock={() => false}
        onEdit={noop}
        onUpdateStock={noop}
        onToggleActive={noop}
        onDelete={noop}
      />,
    );

    const heads = headings(container);
    expect(heads.map((h) => h.textContent)).toEqual([
      'Name',
      'Price',
      'Pricing',
      'Stock',
      'Status',
      'Actions',
    ]);
    // Name, Pricing, Stock and Status read left; Stock is a count, not money.
    for (const i of [0, 2, 3, 4]) {
      expect(classes(heads[i])).toContain('text-left');
      expect(classes(heads[i])).not.toContain('text-center');
    }
    expect(classes(heads[1])).toContain('text-right');
    // The trailing sr-only actions column stays right, as everywhere else.
    expect(classes(heads[5])).toContain('text-right');

    const cells = Array.from(container.querySelectorAll('tbody tr:first-child td'));
    expect(cells).toHaveLength(6);
    expect(cells[0].textContent).toContain('Child seat');
    expect(classes(cells[0])).toContain('text-left');
    expect(classes(cells[1])).toContain('text-right');
    for (const i of [2, 3, 4]) expect(classes(cells[i])).toContain('text-left');
    // The name's own flex row starts too: a flex row ignores the cell's text-align.
    const nameRow = cells[0].querySelector('div')!;
    expect(classes(nameRow)).not.toContain('justify-center');
  });
});

describe('blocked customers: the name button is a block that starts at the left', () => {
  it('drops the centring margin and says text-left', () => {
    const customer = {
      id: 'c1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: null,
      license_number: null,
      id_number: null,
      blocked_at: null,
      blocked_reason: null,
    };
    const { container } = render(
      <BlockedCustomersTableV2 customers={[customer]} resetKey="k" canUnblock isLoading={false} onOpen={noop} onUnblock={noop} />,
    );
    const name = Array.from(container.querySelectorAll('tbody button')).find((b) => b.textContent === 'Jane Doe')!;
    const cls = classes(name);
    expect(cls).toEqual(expect.arrayContaining(['block', 'text-left']));
    expect(cls).not.toContain('mx-auto');
    expect(cls).not.toContain('text-center');
  });
});

describe('row menus are the ui-v2 menu', () => {
  /** Radix menus measure with a constructible ResizeObserver, which the shared setup mock is not. */
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  it('opens the ui-v2 content (data-slot), sized to its labels, and its items still act', () => {
    (globalThis as any).ResizeObserver = ResizeObserverStub;
    const onDelete = vi.fn();
    const category = { id: 'cat1', name: 'News', slug: 'news', description: null, display_order: 1, post_count: 3 } as any;
    render(<BlogCategoriesTableV2 categories={[category]} resetKey="k" canEdit onEdit={noop} onDelete={onDelete} />);

    const trigger = document.body.querySelector('button[aria-label="Actions for News"]')!;
    act(() => {
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    });
    const content = document.body.querySelector('[data-slot="dropdown-menu-content"]');
    const cls = classes(content);
    expect(cls).toContain('w-auto');
    expect(cls).not.toContain('w-[var(--radix-dropdown-menu-trigger-width)]');
    const items = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'));
    expect(items.map((i) => i.textContent)).toEqual(['Edit', 'Delete']);
    for (const item of items) expect(item.querySelector('svg')!.getAttribute('class')).not.toMatch(/\bmr-2\b/);

    act(() => (items[1] as HTMLElement).click());
    expect(onDelete).toHaveBeenCalledWith(category);
  });
});

describe('the other v2 tables: content that does not inherit text-align starts at the source', () => {
  // Source-read: these tables need page hooks to render, and jsdom has no
  // layout anyway. Each needle is the edited class list, verbatim. The
  // "gone" list is the Sep 17 centring, so it cannot creep back in.
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

  it.each([
    [
      'components/cms-v2/blog-posts-table-v2.tsx',
      ['<div className="flex min-w-0 items-center gap-1.5">', '${LIST_CLASSES.identifier} truncate text-left hover:underline'],
      ['justify-center', 'truncate text-center'],
    ],
    // Team (Settings walkthrough, Sep 2026): the status stack (Active plus its
    // flag lines) and the row menu sit under a VISIBLE Actions heading here,
    // not an sr-only one. The menu follows that heading to the right edge, as
    // it does on every other v2 list. The rendered check is in
    // users-team-lane-v2.test.tsx.
    [
      'components/admin-v2/users-table-v2.tsx',
      ['<UserStatus user={user} />', '<UserRowMenu user={user} {...actions} className="ml-auto flex" />', '<ListHead className="w-[14%] text-right">Actions</ListHead>'],
      ['className="items-center"', 'mx-auto flex'],
    ],
    [
      'components/admin-v2/audit-logs-table-v2.tsx',
      ['<div className="flex h-5 min-w-0 items-center gap-2">'],
      ['items-center justify-center gap-2'],
    ],
    [
      'components/fleet-v2/pending-bookings-table-v2.tsx',
      [
        '<span className="flex max-w-full items-center gap-1.5" title={`${reg} • ${makeModel}`}>',
        '<ListHead className="w-[10.5%] px-2 text-right">Amount</ListHead>',
        '<ListCell className="px-2 text-right tabular-nums">',
      ],
      ['items-center justify-center gap-1.5'],
    ],
    [
      'components/insurance-v2/insurance-policies-table-v2.tsx',
      [
        '<div className="flex min-w-0 flex-col items-start gap-0.5">',
        '<div className="flex min-w-0 max-w-full items-center gap-1.5">',
        '<ListHead className="w-[9.5%] text-right">Premium</ListHead>',
        '<ListCell className="text-right tabular-nums">',
      ],
      ['flex-col items-center', 'items-center justify-center gap-1.5'],
    ],
    [
      'components/invoices-v2/payment-requests-table-v2.tsx',
      ['<ListHead className="w-[14%] text-right">Amount</ListHead>', '<ListCell className="text-right tabular-nums">'],
      [],
    ],
    [
      'components/invoices-v2/invoices-table-v2.tsx',
      ['<ListHead className="w-[14%] text-right">Amount</ListHead>', '<ListCell className="text-right tabular-nums">'],
      ['text-center', 'justify-center', 'mx-auto'],
    ],
    [
      'components/insurance-v2/insurance-policy-list-v2.tsx',
      ['<div className="flex flex-col items-start gap-0.5">'],
      ['flex-col items-center'],
    ],
  ] as const)('%s', (file, needles, gone) => {
    const src = read(file);
    for (const needle of needles) expect(src, needle).toContain(needle);
    for (const needle of gone) expect(src, needle).not.toContain(needle);
  });

  it('money in insurance policies and payment requests is right-aligned again', () => {
    expect(read('components/insurance-v2/insurance-policies-table-v2.tsx')).toContain('text-right tabular-nums');
    expect(read('components/invoices-v2/payment-requests-table-v2.tsx')).toContain('text-right tabular-nums');
  });

  it('insurance verifications: Attach gets its left-edge nudge back', () => {
    // The ghost button's own left padding would otherwise start "Attach" a few
    // pixels in from the rental link that stands in its place on other rows.
    const src = read('components/insurance-v2/insurance-verifications-table-v2.tsx');
    expect(src).toContain('className="-my-1.5 -ml-2.5 text-muted-foreground"');
  });

  it('the v2 branch of the shared rentals, payments, fines and vehicles pages centres nothing', () => {
    // These pages render v1 AND v2, so only the classes the v2 table owns are
    // checked: the kit strings and the identifier links it builds on.
    expect(read('components/rentals-v2/rentals-list-v2.tsx')).not.toContain('text-muted-foreground text-center');
    expect(read('app/(dashboard)/payments/page.tsx')).not.toContain('mx-auto block max-w-full truncate text-center');
    expect(read('app/(dashboard)/fines/page.tsx')).not.toContain('<CheckboxV2\n                        className="mx-auto"');
    expect(read('app/(dashboard)/customers/page.tsx')).not.toContain('truncate text-center hover:underline');
    expect(read('app/(dashboard)/vehicles/page.tsx')).not.toContain('flex min-w-0 items-center justify-center');
  });
});
