/**
 * The shared Rentals table (shared/portal-v2/rentals-table.tsx), drawn by the
 * operator Rentals tab and the customer portal's Rentals page.
 *
 * Pins the hover behaviour both portals share: headings are plain text with no
 * hover tint, pointer or sort control; a row tints on hover and shows its open
 * chevron at the row's end only then (or while focused), never at rest; the
 * whole row opens the rental, by click or from the keyboard.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RentalsTable, type RentalsTableRow } from '../../../../../shared/portal-v2/rentals-table';

const ROWS: RentalsTableRow[] = [
  { id: 'a', reference: 'R-936c59', party: 'Ford Explorer', start: '2026-09-28', end: '2026-10-28', status: 'Active' },
  { id: 'b', reference: 'R-d34f08', party: 'Chevrolet Malibu', start: '2026-11-12', end: '2026-11-26', status: 'Pending' },
];

const classes = (el: Element) => el.getAttribute('class')!.split(/\s+/);

describe('shared Rentals table', () => {
  it('names the second column for the side it is on', () => {
    const { container } = render(<RentalsTable partyLabel="Vehicle" rows={ROWS} onOpen={() => {}} />);
    expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Rental #', 'Vehicle', 'Pickup', 'Return', 'Status']);
    expect(screen.getByText('Ford Explorer')).toBeInTheDocument();
  });

  it('keeps the headings plain: no tint, pointer or sort control', () => {
    const { container } = render(<RentalsTable partyLabel="Customer" rows={ROWS} onOpen={() => {}} />);
    const headerRow = container.querySelector('thead tr')!;
    expect(classes(headerRow)).toContain('hover:bg-transparent');
    for (const th of container.querySelectorAll('th')) {
      expect(classes(th)).toEqual(expect.arrayContaining(['h-10', 'text-[11px]', 'font-semibold', 'uppercase', 'tracking-wider', 'text-left']));
      expect(classes(th)).not.toContain('cursor-pointer');
      expect(th.querySelector('button, svg')).toBeNull();
      expect(th.hasAttribute('aria-sort')).toBe(false);
    }
  });

  it('shows the open chevron at the row end only on hover or focus', () => {
    const { container } = render(<RentalsTable partyLabel="Customer" rows={ROWS} onOpen={() => {}} />);
    const rows = container.querySelectorAll('tbody tr');
    for (const row of rows) {
      expect(classes(row)).toEqual(expect.arrayContaining(['group/row', 'cursor-pointer']));
      const cells = row.querySelectorAll('td');
      const chevron = cells[cells.length - 1].querySelector('svg')!;
      expect(chevron).not.toBeNull();
      expect(chevron.getAttribute('aria-hidden')).toBe('true');
      const c = classes(chevron);
      expect(c).toEqual(expect.arrayContaining(['opacity-0', 'group-hover/row:opacity-100', 'group-focus-visible/row:opacity-100', 'absolute', 'right-3']));
      // Only the last cell carries one.
      for (const cell of [...cells].slice(0, -1)) expect(cell.querySelector('svg')).toBeNull();
    }
  });

  it('opens the rental from anywhere on the row, and from the keyboard', () => {
    const onOpen = vi.fn();
    render(<RentalsTable partyLabel="Customer" rows={ROWS} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Chevrolet Malibu'));
    expect(onOpen).toHaveBeenLastCalledWith('b');
    const row = screen.getByText('R-936c59').closest('tr')!;
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpen).toHaveBeenLastCalledWith('a');
  });
});
