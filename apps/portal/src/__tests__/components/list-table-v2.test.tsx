/**
 * The shared v2 list table kit (`components/shared/list-table-v2.tsx`).
 *
 * The rentals list is the reference every v2 table copies. These tests keep
 * the kit's class strings in lockstep with that file, so the lists cannot drift
 * apart silently, and pin the infinite-scroll behaviour that replaces the pager,
 * the left-aligned columns, the absence of sorting, and the window-filling body.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Card } from '@/components/ui-v2/card';
import {
  LIST_CLASSES,
  LIST_FILL_MIN_HEIGHT,
  LIST_ROWS_PER_FILL,
  LIST_SETTINGS_SURFACE,
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

/*
 * Line endings normalised, because the assertions below quote multi-line
 * snippets and git hands this file out with CRLF on Windows. Without it the
 * suite passes or fails on the checkout's line endings rather than on anything
 * about the list — which it did, silently, until a file it reads happened to
 * be rewritten with LF and the failure went away on its own.
 */
const rentalsSource = readFileSync(
  resolve(process.cwd(), 'src/components/rentals-v2/rentals-list-v2.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

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

  it('left-aligns all five headings and every cell, like the kit', () => {
    expect(rentalsSource.match(/tracking-wider text-muted-foreground text-left">/g)).toHaveLength(5);
    // Rental #, Customer, Pickup, Return, Status.
    expect(rentalsSource.match(/<TableCell className="py-3 text-left/g)).toHaveLength(5);
    // The two cells that lay their content out with flex have to start too: a
    // flex box ignores the cell's text-align.
    expect(rentalsSource).toContain('<div className="flex flex-col items-start gap-0.5">');
    expect(rentalsSource).toContain('<div className="flex flex-wrap items-center justify-start gap-1.5">');
    // And nothing centred survives anywhere in the reference table.
    expect(rentalsSource).not.toContain('text-center">');
    expect(rentalsSource).not.toContain('justify-center');
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

  it('left-aligns a heading', () => {
    const th = head({ children: 'Phone', className: 'w-[20%]' });
    const classes = th.className.split(/\s+/);
    expect(classes).toContain('text-left');
    expect(classes).not.toContain('text-center');
    expect(classes).toContain('w-[20%]');
  });

  it("lets a money or trailing actions column's text-right win", () => {
    const classes = head({ children: <span className="sr-only">Actions</span>, className: 'text-right' }).className.split(/\s+/);
    expect(classes).toContain('text-right');
    expect(classes).not.toContain('text-left');
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

  it('left-aligns a cell', () => {
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
    expect(classes).toEqual(expect.arrayContaining(['py-3', 'text-left', 'tabular-nums']));
  });

  it("lets a money cell's text-right win over the kit's left", () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <ListCell className="text-right tabular-nums">$12.50</ListCell>
          </tr>
        </tbody>
      </table>,
    );
    const classes = container.querySelector('td')!.className.split(/\s+/);
    expect(classes).toContain('text-right');
    expect(classes).not.toContain('text-left');
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

/**
 * The same cap, measured inside the v2 FIXED FRAME (Sep 23 2026).
 *
 * The window no longer scrolls: `<main>` is the scroll container and carries
 * `data-scrollport`, so `useViewportFillCap` asks it instead of the window
 * (lib/scrollport.ts). Everything above stays the same — the same page, the
 * same 92px of space below the box — so the numbers here can be checked against
 * the window ones by hand.
 */
describe('ListTable fillViewport inside the v2 fixed frame', () => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  /** The bar's 64px, then the port: 900 - 64 = 836 of scrollport. */
  const BAR = 64;
  const PORT_HEIGHT = 836;
  let portScroll = 0;

  const saved = {
    innerHeight: Object.getOwnPropertyDescriptor(window, 'innerHeight'),
    scrollY: Object.getOwnPropertyDescriptor(window, 'scrollY'),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
    scrollTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop'),
  };

  beforeEach(() => {
    portScroll = 0;
    vi.stubGlobal('IntersectionObserver', ResizeObserverStub);
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(min-width: 768px)',
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    // The window is 900 tall and NEVER scrolls, which is the whole point.
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => 900 });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 0 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-scrollport') ? PORT_HEIGHT : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-scrollport') ? portScroll : 0;
      },
      set() {},
    });
    // The SAME layout as the window harness above, now in scrollport-content
    // coordinates: the box at 400-700, its card ending at 724, the count line
    // at 748-776. On screen that is `64 + content - portScroll`.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = (top: number, bottom: number) => {
        const shift = BAR - portScroll;
        return ({ top: top + shift, bottom: bottom + shift, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top + shift, toJSON: () => ({}) }) as DOMRect;
      };
      if (this.hasAttribute('data-scrollport')) {
        // The port's own border box starts at the bar's bottom and never moves.
        return ({ top: BAR, bottom: 900, left: 0, right: 0, width: 0, height: PORT_HEIGHT, x: 0, y: BAR, toJSON: () => ({}) }) as DOMRect;
      }
      if (this.dataset.slot === 'card-content') return box(400, 700);
      if (this.dataset.slot === 'card') return box(376, 724);
      if (this.dataset.testid === 'count-line') return box(748, 776);
      return box(0, 0);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const [key, desc] of Object.entries(saved)) {
      const target = key === 'innerHeight' || key === 'scrollY' ? window : HTMLElement.prototype;
      if (desc) Object.defineProperty(target, key, desc);
      else delete (target as unknown as Record<string, unknown>)[key];
    }
  });

  function Page() {
    const rows = useProgressiveRows([1, 2, 3], 'k');
    return (
      <main data-scrollport="" style={{ paddingBottom: '16px' }}>
        <div style={{ paddingBottom: '24px' }}>
          <ListTable rows={rows} fillViewport>
            <ListBody>
              {rows.visible.map((row) => (
                <ListRow key={row}>
                  <ListCell>{row}</ListCell>
                </ListRow>
              ))}
            </ListBody>
          </ListTable>
          <div data-testid="count-line" />
        </div>
      </main>
    );
  }

  const scrollBox = (container: HTMLElement) =>
    container.querySelector('[data-slot="card-content"]') as HTMLElement;

  // Space below the box is unchanged by the frame — it is read from the
  // elements AFTER the box, and those distances do not move: 52 (count line
  // bottom 776 - card bottom 724) + 24 (the page's padding) + 16 (main's) = 92.
  // The box starts 400 down the scrollport, which is 836 tall, so the cap is
  // 836 - 400 - 92 = 344.
  //
  // HAND-CHECKED AGAINST THE WINDOW: at rest the box sits 464px down a 900px
  // viewport, and 900 - 464 - 92 is the same 344. The frame moved WHERE the
  // room is measured, not how much of it there is.
  it('caps the box at the room left in the scrollport under its top', () => {
    const { container } = render(<Page />);
    expect(scrollBox(container).style.maxHeight).toBe('344px');
  });

  it('measures the same cap however far <main> is scrolled', () => {
    // The failure this replaces: `rect.top + window.scrollY` with a window that
    // never scrolls is just `rect.top`, so a re-measure 250px down the page
    // would have read the box as starting at 150 and grown the cap to 594.
    portScroll = 250;
    const { container } = render(<Page />);
    expect(scrollBox(container).style.maxHeight).toBe('344px');
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

describe('ListFooter hideWhenAllShown (settings tables)', () => {
  const footer = (visible: number, total: number, hasMore: boolean, serverTotal?: number) =>
    render(
      <ListFooter
        rows={{ visible: Array.from({ length: visible }), total, hasMore, showMore: () => {} }}
        one="holiday"
        many="holidays"
        serverTotal={serverTotal}
        hideWhenAllShown
      />,
    );

  it('renders nothing once every row is on screen', () => {
    const { container } = footer(3, 3, false);
    expect(container.innerHTML).toBe('');
  });

  it('still counts, with Show more, while rows are to come', () => {
    footer(25, 30, true);
    expect(screen.getByText('Showing 25 of 30 holidays')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
  });

  it('still says so when a fetch cap left rows on the server', () => {
    footer(1000, 1000, false, 1450);
    expect(
      screen.getByText('Showing the first 1000 of 1450 holidays. Search or filter to narrow them down.'),
    ).toBeInTheDocument();
  });
});

describe('ListTable surface', () => {
  function Table({ surface }: { surface?: 'card' | 'settings' }) {
    const rows = useProgressiveRows([1, 2], 'k');
    return (
      <ListTable rows={rows} surface={surface}>
        <ListTableHeader>
          <ListHead>Name</ListHead>
        </ListTableHeader>
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

  it('a default caller renders exactly what it did: a bare ui-v2 Card around the kit scroll root', () => {
    const { container } = render(<Table />);
    const card = container.firstElementChild as HTMLElement;
    // The same classes a Card with no className gets: ListTable adds none.
    const bare = render(<Card />).container.firstElementChild as HTMLElement;
    expect(card.getAttribute('data-slot')).toBe('card');
    expect(card.className).toBe(bare.className);
    expect(card.hasAttribute('data-list-surface')).toBe(false);
    const scroll = card.firstElementChild as HTMLElement;
    expect(scroll.getAttribute('data-slot')).toBe('card-content');
    expect(scroll.className).toBe(LIST_CLASSES.scrollRoot);
    expect(card.children).toHaveLength(1);
  });

  it("surface='card' is the default, spelled out", () => {
    const a = render(<Table />).container.innerHTML;
    const b = render(<Table surface="card" />).container.innerHTML;
    expect(b).toBe(a);
  });

  it("surface='settings': the flat settings panel, with the same scroll root inside", () => {
    const { container } = render(<Table surface="settings" />);
    const surface = container.firstElementChild as HTMLElement;
    expect(surface.getAttribute('data-list-surface')).toBe('settings');
    expect(surface.className).toBe(LIST_SETTINGS_SURFACE);
    const cls = surface.className.split(/\s+/);
    // Flush, not a card (team lead, Sep 24): a settings list starts on the same
    // letter as the heading above it, so no border, no fill, and the outer
    // cells give up their side padding.
    expect(cls).toEqual(expect.arrayContaining(['overflow-hidden', 'text-sm']));
    for (const box of ['rounded-xl', 'border', 'bg-card']) expect(cls).not.toContain(box);
    expect(cls).toEqual(
      expect.arrayContaining([
        '[&_th:first-child]:pl-0',
        '[&_td:first-child]:pl-0',
        '[&_th:last-child]:pr-0',
        '[&_td:last-child]:pr-0',
      ]),
    );
    // No card padding bands, no shadow or ring, no card radius.
    for (const gone of ['py-[var(--card-spacing)]', 'gap-[var(--card-spacing)]', 'shadow-md', 'ring-1', 'rounded-4xl']) {
      expect(cls).not.toContain(gone);
    }
    // With `border`, this would make the v2 theme repaint it as a shadowed card.
    expect(cls).not.toContain('text-card-foreground');
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
    const scroll = surface.firstElementChild as HTMLElement;
    expect(scroll.getAttribute('data-slot')).toBe('card-content');
    expect(scroll.className).toBe(LIST_CLASSES.scrollRoot);
    expect(scroll.querySelector('table')).not.toBeNull();
  });

  it('keeps the settings surface out of the rentals lockstep set', () => {
    expect(Object.values(LIST_CLASSES)).not.toContain(LIST_SETTINGS_SURFACE);
  });
});
