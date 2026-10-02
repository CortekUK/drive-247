"use client";

/**
 * The Extras stage's line in the rail — "2 add-ons · 1 driver", and under it
 * what they are ("Child seat ×2, Toll pass · Daniel Reyes").
 *
 * A read of its own rather than a widening of `use-rental-detail-v2`: the two
 * tables it needs (`rental_extras_selections`, `rental_additional_drivers`) are
 * this stage's alone, and the shared read stays the rental row plus its two
 * joins. The query keys are the Extras stage's own, so saving an extra or
 * adding a driver there refreshes this line too.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export function useExtrasOverview(rentalId: string | null | undefined) {
  const { tenant } = useTenant();

  const extras = useQuery({
    queryKey: ["rental-extra-selections-v2", rentalId],
    queryFn: async () => {
      // No tenant column on this table: the rental id is the scope, and the
      // rail only ever holds a rental it read under a tenant-scoped query.
      const { data, error } = await supabase
        .from("rental_extras_selections")
        .select("id, quantity, price_at_booking, billing_type_at_booking, extra_id, rental_extras(name, description, image_urls)")
        .eq("rental_id", rentalId!);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!rentalId,
  });

  const drivers = useQuery({
    queryKey: ["rental-extras-overview-drivers-v2", tenant?.id, rentalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_additional_drivers")
        .select("id, name")
        .eq("rental_id", rentalId!)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    enabled: !!rentalId && !!tenant?.id,
  });

  const e = extras.data ?? [];
  const d = drivers.data ?? [];
  if (!extras.data && !drivers.data) return { value: null, note: null };
  if (e.length === 0 && d.length === 0) return { value: null, note: null };

  const value = [
    e.length ? `${e.length} add-on${e.length === 1 ? "" : "s"}` : null,
    d.length ? `${d.length} driver${d.length === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const note = [
    e.map((s) => `${s.rental_extras?.name ?? "Extra"}${s.quantity > 1 ? ` ×${s.quantity}` : ""}`).join(", ") || null,
    d.map((x) => x.name).join(", ") || null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { value, note: note || null };
}
