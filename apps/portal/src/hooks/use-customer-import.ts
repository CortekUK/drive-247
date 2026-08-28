import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";
import type { ParsedCustomer } from "@/lib/customers-csv";

/**
 * Rows are sent in batches so a 5000-row file does not become one enormous
 * request. On a batch failure we retry that batch row by row, because a single
 * unlucky row (a licence number already used by another operator, say) would
 * otherwise take 199 good customers down with it.
 */
const BATCH_SIZE = 200;

export interface ImportFailure {
  line: number;
  name: string;
  reason: string;
}

export interface ImportOutcome {
  inserted: number;
  failed: ImportFailure[];
}

/** Postgres codes we can explain in words the operator will understand. */
function explain(error: { code?: string; message?: string } | null): string {
  const code = error?.code ?? "";
  const msg = error?.message ?? "Unknown error";
  if (code === "23505") {
    if (msg.includes("email")) return "A customer with this email already exists";
    if (msg.includes("license")) return "This licence number is already recorded on the platform";
    return "This customer already exists";
  }
  if (code === "23514") return "A value was rejected by a database rule";
  if (code === "23502") return "A required field was empty";
  if (code === "22001") return "A value was too long for its field";
  return msg;
}

export function useCustomerImport() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  return useMutation({
    mutationFn: async (rows: ParsedCustomer[]): Promise<ImportOutcome> => {
      if (!tenant?.id) throw new Error("No tenant context available");
      if (rows.length === 0) return { inserted: 0, failed: [] };

      // A blank cell is null, never "". Empty strings would defeat COALESCE and,
      // for email, every blank row would collide under the unique index.
      const toRecord = (r: ParsedCustomer) => ({
        tenant_id: tenant.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        address_street: r.addressStreet,
        address_city: r.addressCity,
        address_state: r.addressState,
        address_zip: r.addressZip,
        license_number: r.licenseNumber,
        date_of_birth: r.dateOfBirth,
        status: r.status,
        // `type` is NOT NULL with no default, so it must be supplied explicitly.
        type: "Individual",
        customer_type: "Individual",
        // Always emit the key. Conditionally spreading it made the object shape
        // vary between rows, and PostgREST rejects a mixed-shape batch with
        // PGRST102 — which is the normal shape of a migrated export, where only
        // some customers carry a Date Created. Falling back to now() keeps list
        // ordering sane; a null here would sort those rows to the bottom forever.
        created_at: r.createdAt ?? new Date().toISOString(),
      });

      let inserted = 0;
      const failed: ImportFailure[] = [];

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const slice = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from("customers").insert(slice.map(toRecord));

        if (!error) {
          inserted += slice.length;
          continue;
        }

        // Retry individually so the good rows in this batch still land.
        for (const row of slice) {
          const { error: rowErr } = await supabase.from("customers").insert(toRecord(row));
          if (rowErr) {
            failed.push({ line: row.line, name: row.name, reason: explain(rowErr) });
          } else {
            inserted++;
          }
        }
      }

      return { inserted, failed };
    },

    onSuccess: (outcome) => {
      queryClient.invalidateQueries({ queryKey: ["customers-list"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balances-enhanced"] });
      void logAction({
        action: "customer_created",
        entityType: "customer",
        entityId: null,
        details: {
          source: "csv_import",
          tenant_id: tenant?.id,
          inserted: outcome.inserted,
          failed: outcome.failed.length,
        },
      });
    },
  });
}
