import { supabase } from '@/lib/supabase';

/**
 * How many cars a rental company has, split the way its own operators see it.
 *
 * "In the fleet" leaves retired cars out — retiring sets `is_disposed` and the
 * status 'Disposed' (or 'Sold' on older rows), and the operator's dashboard and
 * vehicle list stop counting them. Super admin used to show the raw row count,
 * so Northwind read "42 cars" here while its own portal said 41. Retired cars
 * are reported separately rather than hidden, so nothing is lost.
 *
 * Both reads are scoped to the one tenant id passed in.
 */
export type FleetCounts = { inFleet: number; retired: number };

export async function loadFleetCounts(tenantId: string): Promise<FleetCounts | null> {
  const [all, retired] = await Promise.all([
    (supabase as any).from('vehicles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    (supabase as any)
      .from('vehicles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .or('is_disposed.is.true,status.in.(Disposed,Sold)'),
  ]);
  if (all.error || retired.error || all.count == null || retired.count == null) return null;
  return { inFleet: all.count - retired.count, retired: retired.count };
}

/** "41 cars · 1 retired", "1 car", "0 cars". */
export function describeFleet(c: FleetCounts): string {
  const cars = `${c.inFleet} ${c.inFleet === 1 ? 'car' : 'cars'}`;
  return c.retired > 0 ? `${cars} · ${c.retired} retired` : cars;
}
