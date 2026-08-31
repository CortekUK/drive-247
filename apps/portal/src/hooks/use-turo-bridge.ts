/**
 * useTuroBridge — read side of the Drive247 Turo Bridge (PoC).
 *
 * Rows in `public.turo_bridge_reservations` are written ONLY by the
 * `turo-bridge-ingest` edge function (service_role) on behalf of the Chrome
 * extension. The portal never writes here — this hook is read-only by design.
 *
 * Schema verified against the live database (project hviqoaokxvlancmftwuo) on
 * 2026-08-31, not against the migration file: the table exists with RLS ON and
 * exactly one SELECT policy,
 *
 *   turo_bridge_reservations_select_own_tenant
 *     FOR SELECT TO authenticated
 *     USING (tenant_id = get_user_tenant_id() OR is_super_admin())
 *
 * which is the same shape as push_subscriptions. The 15 live columns are the
 * `TuroBridgeReservation` fields below — note there is NO guest_email and NO
 * vehicle_plate column; contact details, the licence plate and Turo's own trip
 * status all live inside `raw`.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

/** One reservation pulled off Turo by the browser extension. */
export interface TuroBridgeReservation {
  id: string;
  tenant_id: string;
  /** Turo's own trip id. TEXT, not a number — Turo returns both shapes. */
  reservation_id: string;
  /**
   * Which path produced this row. 'fixture' means the extension could not reach
   * a real Turo session and fell back to its bundled sample. This is persisted
   * rather than inferred precisely so demo data can never be mistaken for a
   * real booking — the UI must keep labelling it.
   */
  source: "turo" | "fixture";
  guest_name: string | null;
  vehicle_label: string | null;
  starts_at: string | null;
  ends_at: string | null;
  /**
   * OUR sync state, never Turo's trip state. Turo's own status is preserved at
   * `raw.__turo_status` so the two can never fight over one column.
   */
  status: "synced" | "imported" | "failed";
  total_amount: number | string | null;
  currency: string | null;
  /** The untouched Turo trip object, plus our `__drive247_*` provenance stamps. */
  raw: Record<string, unknown> | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

/** Turo's own trip status, which is kept inside `raw`, never in our column. */
export function turoTripStatus(row: TuroBridgeReservation): string | null {
  const raw = row.raw;
  if (!raw) return null;
  const v = raw["__turo_status"] ?? raw["status"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export const TURO_BRIDGE_TABLE = "turo_bridge_reservations";

export function turoBridgeQueryKey(tenantId: string | undefined) {
  return ["turo-bridge-reservations", tenantId] as const;
}

/**
 * Reservations synced from Turo for the current tenant, newest first.
 *
 * LIVENESS — deliberately belt AND braces:
 *
 * `turo_bridge_reservations` is NOT currently a member of the
 * `supabase_realtime` publication (checked against pg_publication_tables on the
 * live project; the query returned zero rows). A realtime subscription on an
 * unpublished table subscribes happily and then never fires, so realtime alone
 * would leave the operator staring at a stale table after clicking Sync — the
 * single worst outcome for this screen, since a freshly-landed row appearing is
 * the entire point of it.
 *
 * So this hook polls on a 10s interval while the tab is focused, and also
 * refetches on window focus — which is what actually makes the demo work today,
 * because the operator's attention physically leaves this tab to go and click
 * the extension, then comes back. `refetchOnWindowFocus` overrides the portal's
 * global `false` (QueryClient default) for exactly that reason.
 *
 * The realtime subscription is wired anyway: it costs one channel, it is
 * correct the moment somebody adds the table to the publication, and it makes
 * the row appear instantly rather than up to 10s later. It is an accelerator,
 * never the mechanism.
 */
export function useTuroBridgeReservations() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const query = useQuery({
    queryKey: turoBridgeQueryKey(tenantId),
    queryFn: async (): Promise<TuroBridgeReservation[]> => {
      // `(supabase as any)`: this table postdates the last
      // `supabase gen types` run, so it has no row in
      // integrations/supabase/types.ts. Same cast as use-vehicle-owners.ts:17.
      const { data, error } = await (supabase as any)
        .from(TURO_BRIDGE_TABLE)
        .select(
          "id, tenant_id, reservation_id, source, guest_name, vehicle_label, starts_at, ends_at, status, total_amount, currency, raw, synced_at, created_at, updated_at",
        )
        .eq("tenant_id", tenantId!)
        .order("synced_at", { ascending: false });

      if (error) throw error;
      return (data || []) as TuroBridgeReservation[];
    },
    enabled: !!tenantId,
    // The row we are waiting for is seconds away, not minutes — override the
    // portal's global 60s staleTime so a focus event actually refetches.
    staleTime: 5_000,
    refetchInterval: 10_000,
    // Background tabs must not poll: the operator is on turo.com at that moment
    // and a ticking query there buys nothing.
    refetchIntervalInBackground: false,
    // Overrides the global `refetchOnWindowFocus: false`. Coming back from the
    // extension IS the signal that something new landed.
    refetchOnWindowFocus: true,
  });

  // Instant append when (and only when) the table is in the realtime
  // publication. Safe to subscribe regardless: RLS is ON with a tenant-scoped
  // SELECT policy, so postgres_changes enforces that policy per subscriber
  // rather than leaning on the channel filter, which is a convenience filter
  // and not an access boundary.
  useRealtimeInvalidate({
    table: TURO_BRIDGE_TABLE,
    tenantId,
    queryKey: turoBridgeQueryKey(tenantId),
  });

  return query;
}
