import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { CreditTransaction } from "@/hooks/use-credit-wallet";

/** PostgREST's per-request maximum: the most one request can return. */
export const CREDIT_TRANSACTIONS_V2_LIMIT = 1000;

/**
 * v2 (northwind) only: the credit ledger for the Transaction History table,
 * up to 1,000 rows with the tenant's full count.
 *
 * `useCreditWallet` already loads the newest 100 under
 * `["credit-transactions", tenantId]`, and that list is shared with the top-bar
 * credits pill and every other wallet reader, so it is not changed. This is a
 * separate query. Its key extends that one, so the wallet hook's `refetch()`,
 * which invalidates the shorter key as a prefix (including the post-purchase
 * poll), refreshes this list too.
 *
 * The rows are the same rows v1 lists: the same table, tenant filter and order,
 * with no test-mode filter added.
 */
export function useCreditTransactionsV2(enabled: boolean) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["credit-transactions", tenant?.id, "v2-1000"],
    queryFn: async () => {
      const { data, error, count } = await (supabase as any)
        .from("credit_transactions")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false })
        .range(0, CREDIT_TRANSACTIONS_V2_LIMIT - 1);

      // supabase-js reports failures in `error` and never throws.
      if (error) throw error;
      return {
        rows: (data || []) as CreditTransaction[],
        count: typeof count === "number" ? count : null,
      };
    },
    enabled: !!tenant && enabled,
  });
}
