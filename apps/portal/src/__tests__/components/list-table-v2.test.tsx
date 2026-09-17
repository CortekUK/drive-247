/**
 * The shared v2 list table kit (`components/shared/list-table-v2.tsx`).
 *
 * The rentals list is the reference every v2 table copies. These tests keep
 * the kit's class strings in lockstep with that file, so the lists cannot drift
 * apart silently, and pin the infinite-scroll behaviour that replaces the pager,
 * the centred columns, the absence of sorting, and the window-filling body.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIST_CLASSES,
  LIST_FILL_MIN_HEIGHT,
  LIST_ROWS_PER_FILL,
  LIST_TONES,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListRow,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from '@/components/shared/list-table-v2';

const rentalsSource = readFileSync(
  resolve(process.cwd(), 'src/components/rentals-v2/rentals-list-v2.tsx'),
  'utf8',
);

describe('list table kit matches the rentals list', () => {
  // Rentals writes each column's width into the middle of its head classes
  // (`h-10 w-[20%] text-[11px] …`); the kit takes widths separately.
  const withoutWidths = rentalsSource.replace(/h-10 w-\[\d+%\] /g, 'h-10 ');

  for (const [name, classes] of Object.entries(LIST_CLASSES)) {
    it(`uses the rentals list's ${name} classes`, () => {
      expect(withoutWidths).toContain(classes);
    });
  }

  for (const [tone, classes] of Object.entries(LIST_TONES)) {
    it(`uses the rentals list's ${tone} status colour`, () => {
      expect(rentalsSource).toContain(classes);
    });
  }

  it('fills the same number of rows at a time', () => {
    expect(rentalsSource).toContain(`const ROWS_PER_FILL = ${LIST_ROWS_PER_FILL};`);
  });

  it('centres all five headings and every cell, like the kit', () => {
    expect(rentalsSource.match(/tracking-wider text-muted-foreground text-center">/g)).toHaveLength(5);
    // Rental #, Customer, Pickup, Return, Status.
    expect(rentalsSource.match(/<TableCell className="py-3 text-center/g)).toHaveLength(5);
    // The two cells that lay their content out with flex centre it themselves.
    expect(rentalsSource).toContain('<div className="flex flex-col items-center gap-0.5">');
    expect(rentalsSource).toContain('<div className="flex flex-wrap items-center justify-center gap-1.5">');
  });

  it('fills the window with the kit hook, on the box that carries the kit classes', () => {
    expect(rentalsSource).toContain('const tableFillCap = useViewportFillCap(scrollRootRef, tableMounted);');
    expect(rentalsSource).toContain(
      'style={tableFillCap !== undefined ? { maxHeight: tableFillCap } : undefined}',
    );
    // The same condition as the table branch, so the box is measured when it mounts.
    expect(rentalsSource).toContain('currentView !== "calendar" && allRentals.length > 0 && !devForceEmptyRentals;');
    expect(rentalsSource).toContain(') : /* Rentals Table */\n      allRentals.length > 0 && !devForceEmptyRentals ? (');
  });

  it('always lists newest added first and ignores a sort in the URL', () => {
    expect(rentalsSource).toContain('sortBy: "created_at",');
    expect(rentalsSource).toContain('sortOrder: "desc",');
    expect(rentalsSource).not.toContain('searchParams.get("sortBy")');
    expect(rentalsSource).not.toContain('searchParams.get("sortOrder")');
  });
});

describe('ListHead and ListCell', () => {
  const head = (props: Parameters<typeof ListHead>[0]) =>
    render(
      <table>
        <ListTableHeader>
          <ListHead {...props} />
        </ListTableHeader>
      </table>,
    ).container.querySelector('th')!;

  it('centres a heading, replacing the ui-v2 TableHead text-left', () => {
    const th = head({ children: 'Phone', className: 'w-[20%]' });
    const classes = th.className.split(/\s+/);
    expect(classes).toContain('text-center');
    expect(classes).not.toContain('text-left');
    expect(classes).toContain('w-[20%]');
  });

  it("lets a trailing actions column's text-right win", () => {
    const classes = head({ children: <span className="sr-only">Actions</span>, className: 'text-right' }).className.split(/\s+/);
    expect(classes).toContain('text-right');
    expect(classes).not.toContain('text-center');
  });

  it('never renders a sort control', () => {
    const th = head({ children: 'Name' });
    expect(th.querySelector('button')).toBeNull();
    expect(th.querySelector('svg')).toBeNull();
    expect(th.hasAttribute('aria-sort')).toBe(false);
    expect(th.textContent).toBe('Name');
  });

  it('no longer takes the deprecated sort prop or exports its direction type', () => {
    const kitSource = readFileSync(resolve(process.cwd(), 'src/components/shared/list-table-v2.tsx'), 'utf8');
    expect(kitSource).not.toContain('ListSortDirection');
    expect(kitSource).not.toMatch(/\bsort\??:/);
    expect(kitSource).not.toContain('_ignoredSort');
  });

  it('centres a cell', () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <ListCell className="tabular-nums">2024</ListCell>
          </tr>
        </tbody>
      </table>,
    );
    const classes = container.querySelector('td')!.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['py-3', 'text-center', 'tabular-nums']));
  });
});

describe('useProgressiveRows', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('starts with one fill and says there is more', () => {
    const { result } = renderHook(() => useProgressiveRows(rows(60), 'a'));
    expect(result.current.visible).toHaveLength(LIST_ROWS_PER_FILL);
    expect(result.current.total).toBe(60);
    expect(result.current.hasMore).toBe(true);
  });

  it('adds a fill on showMore and stops at the end of the set', () => {
    const { result } = renderHook(() => useProgressiveRows(rows(60), 'a'));
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(50);
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(60);
    expect(result.current.hasMore).toBe(false);
  });

  it('goes back to one fill when the result set changes', () => {
    const { result, rerender } = renderHook(({ key }) => useProgressiveRows(rows(60), key), {
      initialProps: { key: 'search=' },
    });
    act(() => result.current.showMore());
    expect(result.current.visible).toHaveLength(50);
    rerender({ key: 'search=smith' });
    expect(result.current.visible).toHaveLength(LIST_ROWS_PER_FILL);
  });

  it('keeps how far the operator scrolled when only the rows array is refetched', () => {
    const { result, rerender } = renderHook(({ data }) => useProgressiveRows(data, 'same'), {
      initialProps: { data: rows(60) },
    });
    act(() => result.current.showMore());
    rerender({ data: rows(60) }); // a new array with the same rows, as a background refetch gives
    expect(result.current.visible).toHaveLength(50);
  });

  it('shows everything with no "more" when the set is smaller than a fill', () => {
    const { result } = renderHook(() => useProgressiveRows(rows(11), 'a'));
    expect(result.current.visible).toHaveLength(11);
    expect(result.current.hasMore).toBe(false);
  });
});

describe('ListTable and ListRow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function Page({ loading = false, resetKey = 'k' }: { loading?: boolean; resetKey?: string }) {
    const rows = useProgressiveRows(Array.from({ length: 60 }, (_, i) => i), resetKey);
    // Same order as the real pages: the hook, THEN the loading early return.
    if (loading) return <p>Loading</p>;
    return (
      <ListTable rows={rows}>
        <ListBody>
          {rows.visible.map((row) => (
            <ListRow key={row}>
              <ListCell>{row}</ListCell>
            </ListRow>
          ))}
        </ListBody>
      </ListTable>
    );
  }

  it('starts watching for more rows when the table mounts after the rows arrived', () => {
    // Vehicles: its list query lands while the page still shows the skeleton
    // for its P&L query, so the table (and the sentinel) mount a render later.
    const observed: Element[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(el: Element) {
          observed.push(el);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const { rerender } = render(<Page loading />);
    expect(observed).toHaveLength(0);
    rerender(<Page loading={false} />);
    expect(observed).toHaveLength(1);
  });

  it('scrolls a new result set back to its first row, and leaves a refetch alone', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const { container, rerender } = render(<Page resetKey="search=" />);
    const root = container.querySelector('[data-slot="card-content"]') as HTMLElement;
    const writes: number[] = [];
    Object.defineProperty(root, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: (value: number) => {
        writes.push(value);
      },
    });
    rerender(<Page resetKey="search=" />);
    expect(writes).toEqual([]);
    rerender(<Page resetKey="search=smith" />);
    expect(writes).toEqual([0]);
  });

  it('does not open the record when the click ends a text selection', () => {
    const onOpen = vi.fn();
    render(
      <table>
        <tbody>
          <ListRow onOpen={onOpen}>
            <td>ops@example.com</td>
          </ListRow>
        </tbody>
      </table>,
    );
    const selection = vi.spyOn(window, 'getSelection');
    selection.mockReturnValue({ toString: () => 'ops@example.com' } as unknown as Selection);
    fireEvent.click(screen.getByText('ops@example.com'));
    expect(onOpen).not.toHaveBeenCalled();
    selection.mockReturnValue({ toString: () => '' } as unknown as Selection);
    fireEvent.click(screen.getByText('ops@example.com'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    selection.mockRestore();
  });
});

describe('ListTable fillViewport', () => {
  /** A constructible stand-in: the shared setup's ResizeObserver mock cannot be `new`ed. */
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  let wide = true;
  let innerHeight = 900;
  let scrollY = 0;
  const jsdomInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const jsdomScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');

  beforeEach(() => {
    wide = true;
    innerHeight = 900;
    scrollY = 0;
    vi.stubGlobal('IntersectionObserver', ResizeObserverStub);
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(min-width: 768px)' && wide,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => innerHeight });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
    // Layout, in page coordinates, shifted into the viewport by scrollY:
    //   scroll box 400-700, its card ends at 724, the count line sits 748-776.
    // A fixed bar and a hidden block after the count line would each push the
    // space below further if they were (wrongly) counted.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = (top: number, bottom: number) =>
        ({ top: top - scrollY, bottom: bottom - scrollY, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top - scrollY, toJSON: () => ({}) }) as DOMRect;
      if (this.dataset.slot === 'card-content') return box(400, 700);
      if (this.dataset.slot === 'card') return box(376, 724);
      if (this.dataset.testid === 'count-line') return box(748, 776);
      if (this.dataset.testid === 'fixed-bar') return box(800, 900);
      if (this.dataset.testid === 'hidden-block') return box(776, 1000);
      return box(0, 0);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // Back to jsdom's own values.
    if (jsdomInnerHeight) Object.defineProperty(window, 'innerHeight', jsdomInnerHeight);
    if (jsdomScrollY) Object.defineProperty(window, 'scrollY', jsdomScrollY);
  });

  function Page({ fill = true }: { fill?: boolean }) {
    const rows = useProgressiveRows([1, 2, 3], 'k');
    return (
      <main style={{ paddingBottom: '16px' }}>
        <div style={{ paddingBottom: '24px' }}>
          <ListTable rows={rows} fillViewport={fill}>
            <ListBody>
              {rows.visible.map((row) => (
                <ListRow key={row}>
                  <ListCell>{row}</ListCell>
                </ListRow>
              ))}
            </ListBody>
          </ListTable>
          <div data-testid="count-line" />
          <div data-testid="fixed-bar" style={{ position: 'fixed' }} />
          <div data-testid="hidden-block" style={{ display: 'none' }} />
        </div>
      </main>
    );
  }

  const scrollBox = (container: HTMLElement) =>
    container.querySelector('[data-slot="card-content"]') as HTMLElement;

  // Space below the box, by hand:
  //   inside the card: nothing after the box, and jsdom computes no padding
  //   from class names, so 0;
  //   in the page: count line bottom 776 - card bottom 724 = 52, plus the
  //   page's inline padding-bottom 24 (the fixed bar and hidden block skipped);
  //   in main: nothing after the page, plus main's padding-bottom 16.
  //   0 + 52 + 24 + 16 = 92.
  // The box's top is 400, so the cap is 900 - 400 - 92 = 408.
  it('caps the box at the room left in the window under its top, keeping the lines below on screen', () => {
    const { container } = render(<Page />);
    expect(scrollBox(container).style.maxHeight).toBe('408px');
    expect(scrollBox(container).className.split(/\s+/)).toContain('md:overscroll-contain');
  });

  it('measures the same cap however far the page is scrolled', () => {
    scrollY = 200;
    const { container } = render(<Page />);
    expect(scrollBox(container).style.maxHeight).toBe('408px');
  });

  it('never goes below the floor on a short window', () => {
    innerHeight = 600; // 600 - 400 - 92 = 108, under the floor
    const { container } = render(<Page />);
    expect(LIST_FILL_MIN_HEIGHT).toBe(320);
    expect(scrollBox(container).style.maxHeight).toBe('320px');
  });

  it('leaves the 520px class alone below md', () => {
    wide = false;
    const { container } = render(<Page />);
    expect(scrollBox(container).style.maxHeight).toBe('');
    expect(scrollBox(container).className.split(/\s+/)).toContain('max-h-[520px]');
  });

  it('does nothing for a list that does not ask to fill', () => {
    const { container } = render(<Page fill={false} />);
    expect(scrollBox(container).style.maxHeight).toBe('');
    expect(scrollBox(container).className.split(/\s+/)).not.toContain('md:overscroll-contain');
  });
});

describe('ListFooter', () => {
  const footer = (visible: number, total: number, hasMore: boolean, serverTotal?: number) =>
    render(
      <ListFooter
        rows={{ visible: Array.from({ length: visible }), total, hasMore, showMore: () => {} }}
        one="fine"
        many="fines"
        serverTotal={serverTotal}
      />,
    );

  it('counts what is on screen while more is coming, and offers Show more', () => {
    footer(25, 60, true);
    expect(screen.getByText('Showing 25 of 60 fines')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });

  it('says everything is shown once it is', () => {
    footer(1, 1, false);
    expect(screen.getByText('All 1 fine shown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('never claims "all" when a fetch cap left rows on the server', () => {
    footer(1000, 1000, false, 1450);
    expect(
      screen.getByText('Showing the first 1000 of 1450 fines. Search or filter to narrow them down.'),
    ).toBeInTheDocument();
  });

  it('counts against the server total while still filling', () => {
    footer(25, 1000, true, 1450);
    expect(screen.getByText('Showing 25 of 1450 fines')).toBeInTheDocument();
  });
});
