/**
 * Team lead review, Sep 17 2026 (v2 canary only): headings AND cells are
 * centred in every v2 list table, money columns included. The trailing sr-only
 * actions column stays right-aligned, and the global blacklist's expanded
 * details stay left. The row "..." menus are the ui-v2 menu.
 *
 * The kit's `LIST_CLASSES.head` / `.cell` carry `text-center`; these tests pin
 * what the kit alone cannot reach: a call site's own `text-right`, and content
 * that does not inherit text-align (a block-level flex row, or a <button>,
 * which is only as wide as its content).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A table helper module imports the Supabase client; no test here talks to it,
// and a real client starts an auth refresh timer that jsdom's storage breaks.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {}, supabaseUntyped: {} }));

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

describe('credit transactions: Amount and Balance centre like the rest', () => {
  it('has no right-aligned heading or cell left', () => {
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
    for (const h of heads) {
      expect(classes(h)).toContain('text-center');
      expect(classes(h)).not.toContain('text-right');
    }
    const cells = Array.from(container.querySelectorAll('tbody tr:first-child td'));
    expect(cells).toHaveLength(6);
    expect(cells[4].textContent).toBe('+50');
    expect(cells[5].textContent).toBe('150');
    for (const td of cells) {
      expect(classes(td)).toContain('text-center');
      expect(classes(td)).not.toContain('text-right');
    }
  });
});

describe('global blacklist: the visible Details column centres, the expanded details stay left', () => {
  it('centres the Show button and left-aligns the colSpan details cell', () => {
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
    for (const h of heads) expect(classes(h)).not.toContain('text-right');

    const toggle = container.querySelector('button[aria-controls="global-blacklist-details-g1"]');
    const wrapper = toggle!.parentElement!;
    expect(classes(wrapper)).toContain('justify-center');
    expect(classes(wrapper)).not.toContain('justify-end');
    expect(classes(wrapper.parentElement)).not.toContain('text-right');

    const details = container.querySelector('#global-blacklist-details-g1 td');
    expect(details!.getAttribute('colspan')).toBe('5');
    // tailwind-merge replaces the kit's text-center with the call site's text-left.
    expect(classes(details)).toContain('text-left');
    expect(classes(details)).not.toContain('text-center');
  });
});

describe('plates: row buttons are centred as boxes, and the actions column stays right', () => {
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

  it('copy, vehicle and document buttons carry mx-auto, justify-center and text-center, never text-left', () => {
    const { container } = render(<PlatesTableV2 {...props} plates={[plate]} isLoading={false} />);
    const buttons = [
      container.querySelector('button[title="Click to copy"]'),
      container.querySelector('button[title="XY70 ABC • Ford Focus"]'),
      container.querySelector('button[title="Plate document"]'),
    ];
    for (const b of buttons) {
      const cls = classes(b);
      expect(cls).toEqual(expect.arrayContaining(['mx-auto', 'justify-center', 'text-center']));
      expect(cls).not.toContain('text-left');
    }
    const heads = headings(container);
    expect(heads).toHaveLength(9);
    heads.slice(0, 8).forEach((h) => expect(classes(h)).not.toContain('text-right'));
    expect(classes(heads[8])).toContain('text-right');
    expect(classes(container.querySelector('button[aria-label="Actions for plate AB12 CDE"]'))).toContain('ml-auto');
  });

  it('loading bars sit centred, except the actions bar, which sits right', () => {
    const { container } = render(<PlatesTableV2 {...props} plates={[]} isLoading />);
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      const bars = Array.from(row.querySelectorAll('td > div'));
      expect(bars).toHaveLength(9);
      bars.slice(0, 8).forEach((bar) => expect(classes(bar)).toContain('mx-auto'));
      expect(classes(bars[8])).toContain('ml-auto');
      expect(classes(bars[8])).not.toContain('mx-auto');
    }
  });
});

describe('promo codes: the code button centres in the table and stays left on the phone list', () => {
  it('centres only the table copy', () => {
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
    expect(inTable).toEqual(expect.arrayContaining(['mx-auto', 'justify-center', 'text-center']));
    expect(inTable).not.toContain('text-left');
    const onPhone = classes(container.querySelector('ul button[aria-label="Copy promo code SUMMER10"]'));
    expect(onPhone).toContain('text-left');
    expect(onPhone).not.toContain('mx-auto');
  });
});

describe('extras: the name column reads left, everything else still centres', () => {
  /**
   * Sep 20 2026: the Extra name column was deliberately turned back to the left
   * ("a list of names", matching Locations), so the Sep 17 "every cell centres"
   * rule now has one documented exception. This pins BOTH halves — the name
   * reads left, and no other heading or cell drifted with it — instead of the
   * source-text needle that used to stand here, which only said "centred".
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

  it('left-aligns only the Extra heading and its cell', () => {
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
      'Extra',
      'Description',
      'Price',
      'Pricing',
      'Type',
      'Stock',
      'Status',
      'Actions',
    ]);
    // The name column, and only it, reads left.
    expect(classes(heads[0])).toContain('text-left');
    expect(classes(heads[0])).not.toContain('text-center');
    heads.slice(1, 7).forEach((h) => {
      expect(classes(h)).toContain('text-center');
      expect(classes(h)).not.toContain('text-left');
    });
    // The trailing sr-only actions column stays right, as everywhere else.
    expect(classes(heads[7])).toContain('text-right');

    const cells = Array.from(container.querySelectorAll('tbody tr:first-child td'));
    expect(cells).toHaveLength(8);
    expect(cells[0].textContent).toContain('Child seat');
    expect(classes(cells[0])).toContain('text-left');
    expect(classes(cells[0])).not.toContain('text-center');
    // The name's own flex row has to start too: a centred flex row ignores text-left.
    const nameRow = cells[0].querySelector('div')!;
    expect(classes(nameRow)).toContain('justify-start');
    expect(classes(nameRow)).not.toContain('justify-center');
    cells.slice(1, 7).forEach((td) => {
      expect(classes(td)).toContain('text-center');
      expect(classes(td)).not.toContain('text-left');
    });
  });
});

describe('blocked customers: the name button is centred as a box', () => {
  it('uses mx-auto and text-center', () => {
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
    expect(cls).toEqual(expect.arrayContaining(['mx-auto', 'block', 'text-center']));
    expect(cls).not.toContain('text-left');
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

describe('the other v2 tables: content that does not inherit text-align is centred at the source', () => {
  // Source-read: these tables need page hooks to render, and jsdom has no
  // layout anyway. Each needle is the edited class list, verbatim.
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

  it.each([
    ['components/cms-v2/blog-posts-table-v2.tsx', ['<div className="flex min-w-0 items-center justify-center gap-1.5">', '${LIST_CLASSES.identifier} truncate text-center hover:underline']],
    // Team (Settings walkthrough, Sep 2026): the status stack (Active plus its
    // flag lines) is a flex column centred on its cross axis, and the row menu
    // is a block button centred under the visible Actions heading. The rendered
    // check is in users-team-lane-v2.test.tsx.
    ['components/admin-v2/users-table-v2.tsx', ['<UserStatus user={user} className="items-center" />', '<UserRowMenu user={user} {...actions} className="mx-auto flex" />']],
    ['components/admin-v2/audit-logs-table-v2.tsx', ['<div className="flex h-5 min-w-0 items-center justify-center gap-2">']],
    ['components/fleet-v2/pending-bookings-table-v2.tsx', ['<span className="flex max-w-full items-center justify-center gap-1.5" title={`${reg} • ${makeModel}`}>']],
    [
      'components/insurance-v2/insurance-policies-table-v2.tsx',
      [
        '<div className="flex min-w-0 flex-col items-center gap-0.5">',
        '<div className="flex min-w-0 max-w-full items-center justify-center gap-1.5">',
        '<ListHead className="w-[9.5%]">Premium</ListHead>',
      ],
    ],
    ['components/invoices-v2/payment-requests-table-v2.tsx', ['<ListHead className="w-[14%]">Amount</ListHead>']],
  ] as const)('%s', (file, needles) => {
    const src = read(file);
    for (const needle of needles) expect(src, needle).toContain(needle);
    expect(src).not.toMatch(/\btext-left\b/);
  });

  it('money cells in insurance policies and payment requests are not right-aligned any more', () => {
    expect(read('components/insurance-v2/insurance-policies-table-v2.tsx')).not.toContain('text-right tabular-nums');
    expect(read('components/invoices-v2/payment-requests-table-v2.tsx')).not.toContain('text-right');
  });

  it("insurance verifications: Attach loses the left-edge nudge that would push it off centre", () => {
    const src = read('components/insurance-v2/insurance-verifications-table-v2.tsx');
    expect(src).toContain('className="-my-1.5 text-muted-foreground"');
    expect(src).not.toContain('-ml-2.5');
  });
});
