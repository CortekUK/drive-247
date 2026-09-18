/**
 * Deleting a customer (`hooks/use-delete-customer.ts`), shared by the v1
 * customers list and the v2 customer record.
 *
 * The order is the point: the sign-in has to be looked up BEFORE the delete,
 * because the delete cascades to `customer_users`, and the audit entry and the
 * toasts must only follow a delete that worked. Every mock below writes one line
 * to `h.events`, so each test states the whole sequence it expects, written out
 * by hand from the steps in the hook's doc comment.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  events: [] as string[],
  customerUser: null as null | { auth_user_id: string },
  deleteError: null as null | { message?: string },
  invokeFails: false,
  /** When set, the sign-in lookup waits on this before it answers. */
  lookupGate: null as null | Promise<void>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'customer_users') {
        return {
          select: (columns: string) => ({
            eq: (column: string, value: string) => ({
              maybeSingle: async () => {
                if (h.lookupGate) await h.lookupGate;
                h.events.push(`lookup customer_users.${columns} where ${column}=${value}`);
                return { data: h.customerUser, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'customers') {
        return {
          delete: () => ({
            eq: async (column: string, value: string) => {
              h.events.push(`delete customers where ${column}=${value}`);
              return { error: h.deleteError };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    functions: {
      invoke: (name: string, options: { body: unknown }) => {
        h.events.push(`invoke ${name} ${JSON.stringify(options.body)}`);
        return h.invokeFails ? Promise.reject(new Error('network down')) : Promise.resolve({ data: null, error: null });
      },
    },
  },
}));

vi.mock('@/hooks/use-audit-log', () => ({
  useAuditLog: () => ({
    logAction: (params: { action: string; entityType: string; entityId: string; details: unknown }) => {
      h.events.push(`audit ${params.action} ${params.entityType} ${params.entityId} ${JSON.stringify(params.details)}`);
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => h.events.push(`toast.success ${message}`),
    error: (message: string) => h.events.push(`toast.error ${message}`),
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: (filters: { queryKey: unknown }) => h.events.push(`invalidate ${JSON.stringify(filters.queryKey)}`),
  }),
}));

import { useDeleteCustomer } from '@/hooks/use-delete-customer';

const JANE = { id: 'cust-1', name: 'Jane Doe' };

beforeEach(() => {
  h.events = [];
  h.customerUser = null;
  h.deleteError = null;
  h.invokeFails = false;
  h.lookupGate = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function run(options?: { onDeleted?: () => void }) {
  const { result } = renderHook(() => useDeleteCustomer());
  let ok: boolean | undefined;
  await act(async () => {
    ok = await result.current.deleteCustomer(JANE, options);
  });
  return { ok, result };
}

describe('useDeleteCustomer', () => {
  it('looks up the sign-in, deletes, cleans up the sign-in, audits, then tells the caller', async () => {
    h.customerUser = { auth_user_id: 'auth-1' };
    const { ok } = await run({ onDeleted: () => h.events.push('onDeleted') });

    expect(ok).toBe(true);
    expect(h.events).toEqual([
      'lookup customer_users.auth_user_id where customer_id=cust-1',
      'delete customers where id=cust-1',
      'invoke revoke-customer-session {"auth_user_id":"auth-1","delete_auth_user":true}',
      'audit customer_deleted customer cust-1 {"customer_name":"Jane Doe"}',
      'toast.success Jane Doe has been deleted',
      'onDeleted',
      'invalidate ["audit-logs"]',
    ]);
  });

  it('skips the sign-in clean-up for a customer who never signed up', async () => {
    const { ok } = await run();

    expect(ok).toBe(true);
    expect(h.events).toEqual([
      'lookup customer_users.auth_user_id where customer_id=cust-1',
      'delete customers where id=cust-1',
      'audit customer_deleted customer cust-1 {"customer_name":"Jane Doe"}',
      'toast.success Jane Doe has been deleted',
      'invalidate ["audit-logs"]',
    ]);
  });

  it('stops at a refused delete: the reason in a toast, and no clean-up, audit or follow-up', async () => {
    h.customerUser = { auth_user_id: 'auth-1' };
    h.deleteError = { message: 'update or delete on table "customers" violates foreign key constraint' };
    const onDeleted = vi.fn();
    const { ok } = await run({ onDeleted });

    expect(ok).toBe(false);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(h.events).toEqual([
      'lookup customer_users.auth_user_id where customer_id=cust-1',
      'delete customers where id=cust-1',
      'toast.error update or delete on table "customers" violates foreign key constraint',
    ]);
  });

  it('falls back to the list page\'s wording when the refusal carries no message', async () => {
    h.deleteError = {};
    const { ok } = await run();

    expect(ok).toBe(false);
    expect(h.events.at(-1)).toBe(
      'toast.error Failed to delete customer. They may have associated rentals or payments.',
    );
  });

  it('still reports success when only the sign-in clean-up fails, since the customer is gone', async () => {
    h.customerUser = { auth_user_id: 'auth-1' };
    h.invokeFails = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ok } = await run({ onDeleted: () => h.events.push('onDeleted') });

    expect(ok).toBe(true);
    expect(warn).toHaveBeenCalledWith('Failed to clean up auth user — customer data was deleted successfully');
    expect(h.events).toEqual([
      'lookup customer_users.auth_user_id where customer_id=cust-1',
      'delete customers where id=cust-1',
      'invoke revoke-customer-session {"auth_user_id":"auth-1","delete_auth_user":true}',
      'audit customer_deleted customer cust-1 {"customer_name":"Jane Doe"}',
      'toast.success Jane Doe has been deleted',
      'onDeleted',
      'invalidate ["audit-logs"]',
    ]);
  });

  it('is busy while the delete runs and idle once it settles', async () => {
    let open!: () => void;
    h.lookupGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { result } = renderHook(() => useDeleteCustomer());
    expect(result.current.isDeleting).toBe(false);

    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.deleteCustomer(JANE);
    });
    expect(result.current.isDeleting).toBe(true);

    await act(async () => {
      open();
      await pending;
    });
    expect(result.current.isDeleting).toBe(false);
  });
});
