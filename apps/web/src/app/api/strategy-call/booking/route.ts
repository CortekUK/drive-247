import { NextResponse } from "next/server";
import { getStrategyCallBookingSummary } from "@/lib/strategy-call/booking";

export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await getStrategyCallBookingSummary();
  return NextResponse.json(summary, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

