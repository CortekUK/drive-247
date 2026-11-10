import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";

import type { MapOperator } from "./operator-map";

/**
 * Every operator on Drive247 right now, with their share of the bookings, for the
 * landing page's operator map. Server only: it reads with the service role, and only
 * the shares (never the counts, ids or anything else) leave this module.
 *
 * Who is on the wall: every production tenant that has ever run on Drive247, whatever
 * its plan or status today. A company that signs up appears on its own. Test tenants
 * (northwind) are not production and never show.
 *
 * Read at most once a minute (the page is rendered per request). A failed read throws
 * inside the cache, so it is never stored: the page hides the section for that one
 * request and the next request reads again. (Caching an empty result used to keep the
 * map off the page for a minute or more after a single failure.)
 */

const NOT_A_BOOKING = '("Cancelled","Canceled","Rejected")';

/** Every operator counts as this many bookings, so a new one still gets a real tile. */
const BASE_WEIGHT = 4;

/** Internal accounts that are production rows but not customers. */
const NOT_A_CUSTOMER = new Set(["ghulam"]);

/**
 * Uploads that are not a logo: an icon, a phone screenshot, a mock-up sheet and another
 * company's mark. These operators show their name until they upload a real one.
 */
const NAME_INSTEAD_OF_LOGO = new Set(["hezkee", "kedic-services", "condello-car-rentals", "prestige-rentalz"]);

const PAGE_SIZE = 1000;

async function readOperators(): Promise<MapOperator[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  // Logos are only ever loaded from our own public storage, never from a URL a tenant typed.
  const storage = `${new URL(url).origin}/storage/v1/object/public/`;

  const { data: tenants, error: tenantError } = await db
    .from("tenants")
    .select("id, slug, company_name, logo_url")
    .eq("tenant_type", "production");
  if (tenantError) throw tenantError;
  if (!tenants?.length) return [];

  const operators = tenants.filter((tenant) => !NOT_A_CUSTOMER.has(tenant.slug));
  if (!operators.length) return [];

  // Counted here rather than by the database so no new SQL is needed. Paged, because
  // a select stops at 1,000 rows without saying so.
  const bookings = new Map<string, number>();
  const ids = operators.map((operator) => operator.id);
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: rows, error } = await db
      .from("rentals")
      .select("tenant_id")
      .in("tenant_id", ids)
      .not("status", "in", NOT_A_BOOKING)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of rows ?? []) {
      const tenantId = row.tenant_id as string;
      bookings.set(tenantId, (bookings.get(tenantId) ?? 0) + 1);
    }
    if (!rows || rows.length < PAGE_SIZE) break;
  }

  const weighted = operators.map((operator) => ({
    operator,
    weight: (bookings.get(operator.id) ?? 0) + BASE_WEIGHT,
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  return weighted
    .sort((a, b) => b.weight - a.weight || String(a.operator.slug).localeCompare(String(b.operator.slug)))
    .map(({ operator, weight }) => {
      const logo = typeof operator.logo_url === "string" ? operator.logo_url : "";
      return {
        slug: operator.slug as string,
        name: String(operator.company_name ?? operator.slug).trim(),
        logo: !NAME_INSTEAD_OF_LOGO.has(operator.slug) && logo.startsWith(storage) ? logo : null,
        share: Math.round((weight / total) * 10_000) / 10_000,
      };
    });
}

const readCached = unstable_cache(readOperators, ["operator-map-v3"], { revalidate: 60 });

export async function fetchOperatorMap(): Promise<MapOperator[]> {
  try {
    return await readCached();
  } catch (error) {
    console.error("[operator-map] read failed, hiding the section for this request:", error);
    return [];
  }
}
