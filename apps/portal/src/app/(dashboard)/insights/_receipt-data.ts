'use client';

/**
 * Insights — the one thing the receipt cannot get from the ledger.
 *
 * Every figure on the receipt, and every line inside every dialog, comes out of
 * the single `useInsights` read. This file exists for one gap in that: a cost
 * row in `pnl_entries` does not say what it was FOR.
 *
 * The ledger's only handle is `reference`, and it is a pointer rather than a
 * description:
 *
 *     Service   →  "service:8d3d2804-4da6-4ae6-ac93-239af462167f"
 *     Expenses  →  "vexp:86065bf4-f79c-4fc2-8bee-0f40e6f651a7"
 *     Disposal  →  "dispose:21fd6ec7-d78d-40bd-b680-c8b788081aba"
 *
 * The first two resolve to rows that DO carry a description — "Tyre rotation +
 * alignment", a vendor, a note. "Your Model 3 cost you $7,720" is a fact; "your
 * Model 3 cost you $7,720, and $2,900 of it was tyres" is a decision. So the
 * "money you spent" dialog resolves them.
 *
 * ── Why this is a separate, lazy read ───────────────────────────────────────
 *
 * It is only ever needed once someone opens one dialog, it is worthless to the
 * headline figure, and it is bounded by what that dialog can actually show. It
 * has no business being in the hook that renders the page. `enabled` is the
 * dialog's open state, so a tenant who never opens it never pays for it.
 *
 * ── Tenant isolation ────────────────────────────────────────────────────────
 *
 * `service_records` and `vehicle_expenses` both have RLS ON, which is the
 * exception on this platform and is NOT what this file relies on. Both queries
 * carry `.eq('tenant_id', tenant.id)` like every other read on this page. See
 * `_data.ts`'s header and V2_PLAN.md §5.
 *
 * A miss is not an error. If a lookup returns nothing — the record was deleted,
 * a policy denies it, the reference was never resolvable — the dialog falls
 * back to the category name. Losing the detail is a smaller failure than
 * refusing to show the operator what their cars cost.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

/** `<kind>:<uuid>`. Anything else is not a resolvable reference. */
const REFERENCE = /^(service|vexp):([0-9a-f-]{36})$/i;

/**
 * How many references to resolve at most.
 *
 * The dialog lists 100 lines, so resolving materially more than that would be
 * fetching rows nobody will read. It is also the ceiling on the `.in()` URL
 * length — see `IN_CHUNK` in `_data.ts` for the same concern.
 */
const MAX_REFERENCES = 200;

type ServiceRow = { id: string; description: string | null; service_type: string | null };
type ExpenseRow = { id: string; category: string | null; notes: string | null; vendor: string | null };

/** Split a set of ledger references into the two tables that can answer them. */
export function splitReferences(references: (string | null)[]): {
  serviceIds: string[];
  expenseIds: string[];
} {
  const serviceIds = new Set<string>();
  const expenseIds = new Set<string>();

  for (const reference of references) {
    const match = reference?.match(REFERENCE);
    if (!match) continue;
    const [, kind, id] = match;
    (kind.toLowerCase() === 'service' ? serviceIds : expenseIds).add(id);
  }

  return {
    serviceIds: [...serviceIds].slice(0, MAX_REFERENCES),
    expenseIds: [...expenseIds].slice(0, MAX_REFERENCES),
  };
}

/** The first non-empty of its arguments, trimmed. Null when there is none. */
function firstOf(...parts: (string | null | undefined)[]): string | null {
  for (const part of parts) {
    const trimmed = part?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Resolve ledger cost references to a human description.
 *
 * Returns a map keyed by the FULL reference string (`service:<uuid>`), so a
 * caller looks up exactly what it read off the ledger row and never has to
 * re-parse the prefix itself.
 */
export function useCostDescriptions(references: (string | null)[], enabled: boolean) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const { serviceIds, expenseIds } = splitReferences(references);

  return useQuery<Map<string, string>>({
    // Keyed on the ids themselves rather than the period, because two periods
    // that happen to cover the same costs should share one cached answer — and
    // because a period whose ids changed must not read a stale one.
    queryKey: ['insights', 'cost-descriptions', tenantId, serviceIds, expenseIds],
    enabled: enabled && !!tenantId && serviceIds.length + expenseIds.length > 0,
    // These describe a service that has already happened. They do not change.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const descriptions = new Map<string, string>();

      const [services, expenses] = await Promise.all([
        serviceIds.length
          ? supabase
              .from('service_records')
              .select('id, description, service_type')
              .eq('tenant_id', tenantId!)
              .in('id', serviceIds)
          : Promise.resolve({ data: [] as ServiceRow[], error: null }),
        expenseIds.length
          ? supabase
              .from('vehicle_expenses')
              .select('id, category, notes, vendor')
              .eq('tenant_id', tenantId!)
              .in('id', expenseIds)
          : Promise.resolve({ data: [] as ExpenseRow[], error: null }),
      ]);

      if (services.error) throw services.error;
      if (expenses.error) throw expenses.error;

      for (const row of (services.data ?? []) as ServiceRow[]) {
        const label = firstOf(row.service_type, row.description);
        if (label) descriptions.set(`service:${row.id}`, label);
      }

      for (const row of (expenses.data ?? []) as ExpenseRow[]) {
        // Category first: "Insurance" beats a free-text note that may be blank,
        // and the vendor is added only when it says something the category
        // does not.
        const label = firstOf(row.category, row.notes);
        const vendor = row.vendor?.trim();
        if (label) descriptions.set(`vexp:${row.id}`, vendor ? `${label} · ${vendor}` : label);
        else if (vendor) descriptions.set(`vexp:${row.id}`, vendor);
      }

      return descriptions;
    },
  });
}
