/**
 * Delete on the v2 customer record (customers-v2/customer-detail/section-account).
 *
 * The v2 customers list lost its row menu (team lead, Sep 2026), which was the
 * only place a customer could be deleted, so Account gained a Delete section.
 * It runs the same shared hook as the v1 list (`hooks/use-delete-customer`,
 * tested on its own), so here the hook is a stub and these tests pin what the
 * record does around it: who sees it, the confirmation, and what happens after.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  invalidateQueries: vi.fn(),
  deleteCustomer: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidateQueries }),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 'tenant-1' } }),
}));

vi.mock('@/hooks/use-customer-blocking', () => ({
  useCustomerBlockingActions: () => ({
    blockCustomer: { mutate: vi.fn() },
    unblockCustomer: { mutate: vi.fn() },
    addBlockedIdentity: { mutate: vi.fn() },
    removeBlockedIdentity: { mutate: vi.fn() },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/use-delete-customer', () => ({
  useDeleteCustomer: () => ({ deleteCustomer: h.deleteCustomer, isDeleting: false }),
}));

import { SectionAccount } from '@/components/customers-v2/customer-detail/section-account';

const record = {
  id: 'cust-1',
  identity: { name: 'Jane Doe', email: 'jane@example.com' },
  licence: { number: 'D123', idNumber: null },
  account: { status: 'Active', rejection: null, blockedHere: null, globalBlocks: [] },
  rentals: [],
} as any;

function renderSection(canEdit: boolean) {
  return render(
    <SectionAccount c={record} set={vi.fn()} onJump={vi.fn()} canEdit={canEdit} currency="USD" />,
  );
}

beforeEach(() => {
  h.replace.mockReset();
  h.invalidateQueries.mockReset();
  h.deleteCustomer.mockReset();
});

describe('Delete on the v2 customer record', () => {
  it('is not offered to someone who cannot edit Customers', () => {
    const { container } = renderSection(false);
    expect(screen.queryByRole('button', { name: 'Delete customer' })).toBeNull();
    // The tour's note anchors on this, so a viewer is never told about it either.
    expect(container.querySelector('[data-tour="customer-delete"]')).toBeNull();
  });

  it('warns that history can go with the customer, never that history blocks the delete', () => {
    // The repo's migration 20260103200000 made the rentals, payments, fines and
    // ledger `customer_id` foreign keys ON DELETE CASCADE, so promising that a
    // customer with rentals "cannot be deleted" would talk an operator into
    // wiping that history.
    renderSection(true);
    expect(
      screen.getByText(
        'Removes this customer for good, and their sign-in if nothing else uses it. Their rentals, payments and fines can go with them, so to keep that history set them to Inactive instead.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cannot be deleted/)).toBeNull();
  });

  it('asks first, naming the customer, and deletes nothing until confirmed', () => {
    const { container } = renderSection(true);
    expect(container.querySelector('[data-tour="customer-delete"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete customer' }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Delete Jane Doe?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'This cannot be undone. The customer and all their data will be permanently removed.',
      ),
    ).toBeInTheDocument();
    expect(h.deleteCustomer).not.toHaveBeenCalled();
  });

  it('"Keep them" closes the question without deleting', () => {
    renderSection(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete customer' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep them' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(h.deleteCustomer).not.toHaveBeenCalled();
  });

  it('on confirm runs the shared delete for this customer, then refreshes the list and leaves the record', async () => {
    // The hook calls `onDeleted` once the row is gone; the stub does the same.
    h.deleteCustomer.mockImplementation(async (_customer, options) => {
      options?.onDeleted?.();
      return true;
    });
    renderSection(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete customer' }));

    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete customer' }));
    });

    expect(h.deleteCustomer).toHaveBeenCalledTimes(1);
    expect(h.deleteCustomer.mock.calls[0][0]).toEqual({ id: 'cust-1', name: 'Jane Doe' });
    expect(h.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['customers-list'] });
    // `replace`: Back must not return to a record that no longer exists.
    expect(h.replace).toHaveBeenCalledWith('/customers');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('keeps the question open and stays on the record when the delete is refused', async () => {
    // A refusal: the hook shows its own toast, never calls `onDeleted`.
    h.deleteCustomer.mockResolvedValue(false);
    renderSection(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete customer' }));

    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete customer' }));
    });

    expect(h.deleteCustomer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['customers-list'] });
  });
});
