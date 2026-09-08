import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Which of the tenant's REAL vehicles appear on their customer website.
 *
 * ── configuration, not content ──────────────────────────────────────────────
 *
 * This reads the operator's actual fleet and writes ONE boolean per row. It
 * deliberately does not copy a vehicle's name, photos, pricing or features
 * anywhere: the website already reads those from `vehicles`, so duplicating
 * them into a CMS record would create a second copy to keep in sync and a
 * second thing to get wrong.
 *
 * ── what hiding a vehicle does NOT do ───────────────────────────────────────
 *
 * `show_on_website` is customer-facing only. A hidden vehicle:
 *   - still appears everywhere in the operator Portal
 *   - can still be rented, blocked, serviced and reported on
 *   - keeps every existing rental, agreement and invoice that names it
 *   - is not deleted, archived, paused or made unavailable
 *
 * The Portal's own vehicle queries are untouched, which is the point: an
 * operator hiding a car from their marketing site has not taken it off the
 * road.
 *
 * ── why every existing vehicle starts visible ───────────────────────────────
 *
 * The column is `not null default true`, and the backfill left all 495
 * existing rows visible. Tenants already have vehicles on their websites; a
 * default of false would have emptied every fleet page on deploy.
 */

export interface WebsiteVehicle {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  reg: string | null;
  status: string | null;
  daily_rent: number | null;
  photo_url: string | null;
  show_on_website: boolean;
}

const KEY = "website-vehicles";

export function useWebsiteVehicles() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const queryKey = [KEY, tenant?.id];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!tenant?.id) return [] as WebsiteVehicle[];

      /* The operator's whole fleet, including the hidden ones — this screen is
         where hidden vehicles are turned back on, so filtering them out here
         would make that impossible. Disposed vehicles are excluded because
         they are gone, not hidden. */
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, make, model, year, reg, status, daily_rent, photo_url, show_on_website")
        .eq("tenant_id", tenant.id)
        .not("status", "in", '("Disposed","Sold")')
        .order("make", { ascending: true })
        .order("model", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as WebsiteVehicle[];
    },
    enabled: !!tenant?.id,
    staleTime: 30_000,
  });

  const setVisibility = useMutation({
    mutationFn: async ({ id, visible }: { id: string; visible: boolean }) => {
      if (!tenant?.id) throw new Error("No tenant context");

      /* Scoped by tenant as well as id. RLS is currently disabled on
         `vehicles`, so this filter is the only thing keeping a stale id from
         reaching another tenant's row. */
      const { error } = await supabase
        .from("vehicles")
        .update({ show_on_website: visible } as never)
        .eq("id", id)
        .eq("tenant_id", tenant.id);

      if (error) throw error;
    },
    /* Optimistic, because a toggle that waits on a round trip feels broken when
       an operator flips six of them. Rolled back on failure so the switch can
       never end up disagreeing with the database. */
    onMutate: async ({ id, visible }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<WebsiteVehicle[]>(queryKey);
      queryClient.setQueryData<WebsiteVehicle[]>(queryKey, (old) =>
        (old ?? []).map((v) => (v.id === id ? { ...v, show_on_website: visible } : v)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const vehicles = query.data ?? [];

  return {
    vehicles,
    visibleCount: vehicles.filter((v) => v.show_on_website).length,
    isLoading: query.isLoading,
    error: query.error,
    setVisibility,
  };
}
