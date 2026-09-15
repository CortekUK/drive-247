/**
 * The shared v2 list table kit (`components/shared/list-table-v2.tsx`).
 *
 * The rentals list is the reference every v2 table copies. These tests keep
 * the kit's class strings in lockstep with that file, so the lists cannot drift
 * apart silently, and pin the infinite-scroll behaviour that replaces the pager.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIST_CLASSES,
  LIST_ROWS_PER_FILL,
  LIST_TONES,
  ListBody,
  ListCell,
  ListFooter,
  ListRow,
  ListTable,
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
