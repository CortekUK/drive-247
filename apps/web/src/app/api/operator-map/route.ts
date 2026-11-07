import { NextResponse } from "next/server";

import { fetchOperatorMap } from "@/lib/operator-map-server";

/**
 * The operator map's refresh: the landing page's map asks for this once a minute while
 * it is on screen, so a new booking grows its operator's tile and a new company appears
 * without a reload. Shares only; the server read is cached for a minute.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const operators = await fetchOperatorMap();
  return NextResponse.json(
    { operators },
    { headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" } },
  );
}
