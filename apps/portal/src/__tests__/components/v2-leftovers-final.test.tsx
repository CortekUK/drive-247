/**
 * The last v2 review leftovers:
 *  - Fines and Payments: the v2 row menu is the ui-v2 menu; v1's stays as it was.
 *  - Custom pricing: the holiday name cell centres its flex row.
 *  - The list table kit: the deprecated `sort` prop and its type are gone.
 *  - The sidebar search scene and Trax's two exits ask the leave guard first.
 *
 * The pages are too large to mount, so their parts read the source. The guard
 * wiring is exercised for real: a guard is installed and the navigation must
 * wait for it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cn } from '@/lib/utils';
import { setLeaveGuard } from '@/lib/leave-guard';

const nav = vi.hoisted(() => ({ push: (_href: string) => {}, pathname: '/settings', search: 'tab=general' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
// A plain anchor: Next's Link prefetches through an IntersectionObserver the
// jsdom setup only stubs as a function.
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _prefetch, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/contexts/TenantContext',() => ({ useTenant: () => ({ tenant: { id: 'tenant-1', currency_code: 'USD' } }) }));
vi.mock('@/lib/search-service', () => ({
  searchService: {
    searchAll: vi.fn(async () => ({
      customers: [{ id: 'c1', title: 'Jordan Lee', subtitle: 'jordan@example.com', category: 'customers', url: '/customers/c1' }],
      vehicles: [], rentals: [], fines: [], payments: [], plates: [], insurance: [], invoices: [], insurances: [], agreements: [],
    })),
  },
}));

import { SidebarSearchScene } from '@/components/shared/layout/sidebar-search-scene';
import { TraxProvider, useTrax } from '@/components/trax/trax-provider';

const SRC = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');

/** The text between two markers, each found once, in order. */
function between(src: string, start: string, end: string) {
  const from = src.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  const to = src.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return src.slice(from, to);
}

const V2_MENU_IMPORT =
  'import {\n  DropdownMenu as DropdownMenuV2,\n  DropdownMenuContent as DropdownMenuContentV2,\n  DropdownMenuItem as DropdownMenuItemV2,\n  DropdownMenuTrigger as DropdownMenuTriggerV2,\n} from "@/components/ui-v2/dropdown-menu";';

describe('fines (v2): the row menu is the ui-v2 menu', () => {
  const page = read('app/(dashboard)/fines/page.tsx');
  const v1Row = between(page, 'const renderFineRow = (fine: EnhancedFine) => {', 'const renderFinesTable = (fines: EnhancedFine[]) =>');
  const v2Table = between(page, '<ListTable', '<ListFooter');

  it('imports the ui-v2 menu under V2 names and keeps the v1 import', () => {
    expect(page).toContain(V2_MENU_IMPORT);
    expect(page).toContain('import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";');
  });

  it('the v2 table uses only the V2 menu, sized to its labels, with no doubled icon gap', () => {
    expect(v2Table).toContain('<DropdownMenuV2>');
    expect(v2Table).toContain('<DropdownMenuTriggerV2 asChild>');
    expect(v2Table).toContain('<DropdownMenuContentV2 align="end" className="w-auto">');
    expect(v2Table.match(/<DropdownMenuItemV2\b/g)).toHaveLength(2);
    expect(v2Table).not.toMatch(/<DropdownMenu(Content|Item|Trigger)?[\s>]/);
    expect(v2Table).not.toMatch(/\bmr-2\b/);
    expect(v2Table).toContain('<DollarSign className="h-4 w-4" />');
    expect(v2Table).toContain('<Ban className="h-4 w-4" />');
  });

  it('the v1 row keeps its menu byte for byte', () => {
    expect(v1Row).toContain('<DropdownMenu>\n              <DropdownMenuTrigger asChild>\n                <Button variant="ghost" size="sm">');
    expect(v1Row).toContain('<DropdownMenuContent align="end">');
    expect(v1Row).toContain('<DollarSign className="h-4 w-4 mr-2" />');
    expect(v1Row).toContain('<Ban className="h-4 w-4 mr-2" />');
    expect(v1Row).not.toContain('V2');
  });
});

describe('payments (v2): the row menu is the ui-v2 menu', () => {
  const page = read('app/(dashboard)/payments/page.tsx');
  const v2Table = between(page, '<ListTable rows={paymentRows}', '<ListFooter');
  // The v1 table follows the v2 branch's `) : (`.
  const v1Table = between(page, '<Card>\n            <CardContent className="p-0">', '</Card>');

  it('imports the ui-v2 menu under V2 names and keeps the v1 import', () => {
    expect(page).toContain(V2_MENU_IMPORT);
    expect(page).toContain('import {\n  DropdownMenu,\n  DropdownMenuContent,\n  DropdownMenuItem,\n  DropdownMenuTrigger\n} from "@/components/ui/dropdown-menu";');
  });

  it('the v2 table uses only the V2 menu, sized to its labels, with no doubled icon gap', () => {
    expect(v2Table).toContain('<DropdownMenuV2>');
    expect(v2Table).toContain('<DropdownMenuTriggerV2 asChild>');
    expect(v2Table).toContain('<DropdownMenuContentV2 align="end" className="w-auto">');
    // View Ledger, Remove payment link, Reverse Payment.
    expect(v2Table.match(/<DropdownMenuItemV2\b/g)).toHaveLength(3);
    expect(v2Table).not.toMatch(/<DropdownMenu(Content|Item|Trigger)?[\s>]/);
    expect(v2Table).not.toMatch(/\bmr-2\b/);
    // The tour anchor stays on the trigger.
    expect(v2Table).toContain('data-tour="payments-row-actions"');
  });

  it('the v1 table keeps its menu byte for byte', () => {
    expect(v1Table).toContain('<Button variant="ghost" size="sm" data-tour="payments-row-actions" className="h-8 w-8 p-0">');
    expect(v1Table).toContain('<DropdownMenuContent align="end">');
    expect(v1Table).toContain('<FileText className="h-4 w-4 mr-2" />');
    expect(v1Table).toContain('<Link2Off className="h-4 w-4 mr-2" />');
    expect(v1Table).toContain('<Undo2 className="h-4 w-4 mr-2" />');
    expect(v1Table).not.toContain('V2');
  });

  it('w-auto replaces the ui-v2 content width taken from the trigger', () => {
    // The ui-v2 content is as wide as its trigger (a 32px icon button) and at
    // least min-w-48; `w-auto` drops the trigger width and keeps the minimum.
    const merged = cn('w-[var(--radix-dropdown-menu-trigger-width)] min-w-48 rounded-3xl', 'w-auto').split(' ');
    expect(merged).toEqual(['min-w-48', 'rounded-3xl', 'w-auto']);
  });
});

describe('custom pricing (v2): the holiday table', () => {
  it('reads the holiday name from the left, and keeps the actions on the right', () => {
    // Since Sep 23 2026 the whole table reads left, so the name column needs no
    // override of its own: it inherits the kit, and nothing here re-centres it.
    // (This table carries no money column — Surcharge is a percentage.)
    const src = read('components/settings-v2/pricing-rules-v2.tsx');
    expect(src).toContain('<div className="flex min-w-0 items-center gap-2">');
    expect(src).toContain('<ListHead>Holiday</ListHead>');
    expect(src).not.toContain('<div className="flex min-w-0 items-center justify-center gap-2">');
    expect(src).not.toContain('<ListHead className="text-left">Holiday</ListHead>');
    // The actions cell stays right-aligned.
    expect(src).toContain('<div className="flex justify-end gap-0.5">');
  });
});

describe('list table kit: no sort prop left', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  it('the kit has no sort prop, and no source outside tests names its type', () => {
    const kit = read('components/shared/list-table-v2.tsx');
    expect(kit).not.toContain('ListSortDirection');
    expect(kit).not.toContain('_ignoredSort');
    expect(kit).not.toMatch(/\bsort\??:/);
    const offenders = walk(SRC)
      .filter((path) => !path.includes(`${join('src', '__tests__')}`))
      .filter((path) => readFileSync(path, 'utf8').includes('ListSortDirection'));
    expect(offenders).toEqual([]);
  });
});

describe('the leave guard catches the sidebar search scene and Trax', () => {
  let releaseGuard: (() => void) | null = null;
  let asked: { href: string; proceed: () => void }[] = [];
  const installGuard = () => {
    releaseGuard = setLeaveGuard((href, proceed) => {
      asked.push({ href, proceed });
      return true;
    });
  };

  beforeEach(() => {
    nav.push = vi.fn();
    nav.pathname = '/settings';
    nav.search = 'tab=general';
    asked = [];
  });
  afterEach(() => {
    releaseGuard?.();
    releaseGuard = null;
  });

  describe('sidebar search scene: Enter on the top hit', () => {
    const renderScene = (onClose = vi.fn()) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <SidebarSearchScene query="jordan" onQueryChange={vi.fn()} onClose={onClose} />
        </QueryClientProvider>,
      );
      return onClose;
    };

    it('with no guard installed (every v1 tenant) it navigates at once', async () => {
      const onClose = renderScene();
      await screen.findByText('1 result');
      fireEvent.keyDown(screen.getByLabelText('Search anything'), { key: 'Enter' });
      expect(nav.push).toHaveBeenCalledTimes(1);
      expect(nav.push).toHaveBeenCalledWith('/customers/c1');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('with unsaved edits the guard is asked first, and the push waits for its answer', async () => {
      installGuard();
      renderScene();
      await screen.findByText('1 result');
      fireEvent.keyDown(screen.getByLabelText('Search anything'), { key: 'Enter' });
      expect(asked.map((a) => a.href)).toEqual(['/customers/c1']);
      expect(nav.push).not.toHaveBeenCalled();
      act(() => asked[0].proceed());
      expect(nav.push).toHaveBeenCalledWith('/customers/c1');
    });
  });

  describe('Trax full page: minimise and leave', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <TraxProvider>{children}</TraxProvider>;
    /** Mount on a settings page so the return path is recorded, then go to /trax. */
    const onTraxPage = () => {
      const hook = renderHook(() => useTrax(), { wrapper });
      nav.pathname = '/trax';
      nav.search = '';
      hook.rerender();
      return hook;
    };

    it('with no guard installed both exits navigate at once, as before', () => {
      const { result } = onTraxPage();
      expect(result.current.returnPath).toBe('/settings?tab=general');
      act(() => result.current.leaveFullPage());
      expect(nav.push).toHaveBeenCalledWith('/settings?tab=general');
      expect(result.current.sheetOpen).toBe(false);
      act(() => result.current.minimiseToPanel());
      expect(nav.push).toHaveBeenCalledTimes(2);
      expect(result.current.sheetOpen).toBe(true);
    });

    it('leaveFullPage asks the guard with the return path and waits', () => {
      const { result } = onTraxPage();
      installGuard();
      act(() => result.current.leaveFullPage());
      expect(asked.map((a) => a.href)).toEqual(['/settings?tab=general']);
      expect(nav.push).not.toHaveBeenCalled();
      act(() => asked[0].proceed());
      expect(nav.push).toHaveBeenCalledWith('/settings?tab=general');
    });

    it('minimiseToPanel opens the panel only once leaving is agreed', () => {
      const { result } = onTraxPage();
      installGuard();
      act(() => result.current.minimiseToPanel());
      expect(asked.map((a) => a.href)).toEqual(['/settings?tab=general']);
      expect(nav.push).not.toHaveBeenCalled();
      // Staying (the dialog's Escape) never calls proceed: the panel stays shut.
      expect(result.current.sheetOpen).toBe(false);
      act(() => asked[0].proceed());
      expect(result.current.sheetOpen).toBe(true);
      expect(nav.push).toHaveBeenCalledWith('/settings?tab=general');
    });
  });
});
