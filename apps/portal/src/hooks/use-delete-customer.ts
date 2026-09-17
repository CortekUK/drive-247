import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuditLog } from "@/hooks/use-audit-log";

/** What deleting needs to know about a customer: the row, and a name for the toast and the audit log. */
export interface DeletableCustomer {
  id: string;
  name: string;
}

export interface DeleteCustomerOptions {
  /**
   * The caller's own follow-up once the row is gone: close its dialog, refresh
   * its list, leave the record. Runs after the success toast and before the
   * audit-log invalidation, which is where the list page always did this.
   */
  onDeleted?: () => void;
}

/**
 * Deleting a customer, in one place.
 *
 * Two screens delete a customer: the v1 customers list (its row menu) and the
 * v2 customer record (Account). Both call this, so the steps and their order
 * cannot drift apart between them:
 *
 *   1. Look up the customer's sign-in (`customer_users.auth_user_id`) FIRST.
 *      Deleting the customer cascades to `customer_users`, so after step 2
 *      there is nothing left to read it from.
 *   2. Delete the customer. An error here stops everything: the toast says why
 *      and nothing else runs. Do NOT assume history blocks the delete: the
 *      2025 baseline schema left rentals, payments, fines and ledger rows
 *      without a cascade, but migration 20260103200000 re-added all four
 *      `*_customer_id_fkey` constraints as ON DELETE CASCADE, so a customer
 *      with history can take it with them. Only a reference still without a
 *      cascade (e.g. a Bonzah policy) makes the database refuse.
 *   3. Clean up the sign-in, only if there was one: the edge function deletes
 *      the auth user when no other tenant links it and otherwise revokes its
 *      sessions. A failure is logged and ignored, since the customer is already
 *      gone.
 *   4. Write the audit log entry.
 *
 * Resolves `true` once the customer is deleted, `false` when it was not (the
 * error toast has already been shown).
 */
export function useDeleteCustomer() {
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteCustomer = useCallback(
    async (customer: DeletableCustomer, options: DeleteCustomerOptions = {}): Promise<boolean> => {
      setIsDeleting(true);
      try {
        // Get the auth_user_id BEFORE deleting (cascade will remove customer_users)
        const { data: customerUser } = await supabase
          .from("customer_users")
          .select("auth_user_id")
          .eq("customer_id", customer.id)
          .maybeSingle();

        const authUserId = customerUser?.auth_user_id;

        // Step 1: Delete the customer (cascade deletes customer_users)
        const { error } = await supabase.from("customers").delete().eq("id", customer.id);

        if (error) throw error;

        // Step 2: Clean up auth user — delete if no other tenant links,
        // otherwise just revoke sessions. Called AFTER customer deletion
        // so the cascade has already removed customer_users for this tenant.
        if (authUserId) {
          await supabase.functions
            .invoke("revoke-customer-session", {
              body: { auth_user_id: authUserId, delete_auth_user: true },
            })
            .catch(() => {
              console.warn("Failed to clean up auth user — customer data was deleted successfully");
            });
        }

        // Audit log for customer deletion
        logAction({
          action: "customer_deleted",
          entityType: "customer",
          entityId: customer.id,
          details: { customer_name: customer.name },
        });

        toast.success(`${customer.name} has been deleted`);
        options.onDeleted?.();
        queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
        return true;
      } catch (error: any) {
        toast.error(error.message || "Failed to delete customer. They may have associated rentals or payments.");
        return false;
      } finally {
        setIsDeleting(false);
      }
    },
    [logAction, queryClient],
  );

  return { deleteCustomer, isDeleting };
}
