"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, XCircle } from "lucide-react";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { RentalFilters } from "@/hooks/use-enhanced-rentals";
import { FilterChip } from "@/components/shared/filter-primitives";

/**
 * The two requests a customer can raise against a live rental — an extension
 * and a cancellation — surfaced as filter chips directly above the table.
 *
 * They exist in the filter panel too, and write the same two keys, so the two
 * surfaces are always in step. The point of hoisting them out is that a
 * pending request is work waiting on the operator, and work waiting on the
 * operator should not be behind a disclosure they have to think to open.
 *
 * A chip is shown when it has something to say — a non-zero count — or when it
 * is the filter currently narrowing the list, so there is always a way back
 * out of a filter you turned on.
 */

interface Props {
  filters: RentalFilters;
  onFiltersChange: (next: RentalFilters) => void;
}

/**
 * How many rentals are sitting on each kind of request.
 *
 * ⚠️ TENANT ISOLATION (V2_PLAN §5) — RLS is OFF on `rentals`. `.eq("tenant_id",
 * tenant.id)` on EVERY branch below is the only thing keeping one operator's
 * pending requests out of another's chips, and `enabled: !!tenant` keeps the
 * query from ever running before there is an id to filter on.
 *
 * The two predicates are exactly the ones `useEnhancedRentals` applies for
 * `extensionRequested` / `cancellationRequested`, and the `!inner` joins
 * reproduce its "skip rentals with no customer or vehicle" step — so clicking a
 * chip that reads 4 lands on 4 rows, not 4 minus however many orphans exist.
 *
 * `head: true` means no rows cross the wire at all; this is two COUNT queries.
 */
function useRentalRequestCounts() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-request-counts", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const base = () =>
        supabaseUntyped
          .from("rentals")
          .select(
            "id, customers!rentals_customer_id_fkey!inner(id), vehicles!rentals_vehicle_id_fkey!inner(id)",
            { count: "exact", head: true }
          )
          .eq("tenant_id", tenant.id);

      const [extension, cancellation] = await Promise.all([
        base().eq("is_extended", true),
        base().eq("cancellation_requested", true),
      ]);

      if (extension.error) throw extension.error;
      if (cancellation.error) throw cancellation.error;

      return {
        extension: extension.count ?? 0,
        cancellation: cancellation.count ?? 0,
      };
    },
    enabled: !!tenant,
    // The same 30s the rentals list itself holds, so the chip and the table it
    // sits above cannot disagree about the same tenant for long.
    staleTime: 30000,
  });
}

export function RentalsRequestChips({ filters, onFiltersChange }: Props) {
  const { data } = useRentalRequestCounts();

  // Every filter change resets to page 1 — holding page 7 while narrowing to
  // three rows lands on an empty table.
  const toggle = (key: "extensionRequested" | "cancellationRequested") =>
    onFiltersChange({ ...filters, [key]: filters[key] ? undefined : true, page: 1 });

  const extensionCount = data?.extension ?? 0;
  const cancellationCount = data?.cancellation ?? 0;

  const showExtension = extensionCount > 0 || !!filters.extensionRequested;
  const showCancellation = cancellationCount > 0 || !!filters.cancellationRequested;

  if (!showExtension && !showCancellation) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Requests</span>

      {/* Amber and red are the colours the table already paints these rows
          with, so the chip and the rows it selects read as one thing. */}
      {showExtension && (
        <FilterChip
          active={!!filters.extensionRequested}
          color="#d97706"
          onClick={() => toggle("extensionRequested")}
        >
          <span className="inline-flex items-center gap-1.5">
            <CalendarPlus className="size-3" />
            Extension requested
            <span className="font-semibold tabular-nums">{extensionCount}</span>
          </span>
        </FilterChip>
      )}

      {showCancellation && (
        <FilterChip
          active={!!filters.cancellationRequested}
          color="#dc2626"
          onClick={() => toggle("cancellationRequested")}
        >
          <span className="inline-flex items-center gap-1.5">
            <XCircle className="size-3" />
            Cancellation requested
            <span className="font-semibold tabular-nums">{cancellationCount}</span>
          </span>
        </FilterChip>
      )}
    </div>
  );
}
