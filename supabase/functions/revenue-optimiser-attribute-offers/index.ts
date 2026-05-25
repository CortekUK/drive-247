/**
 * revenue-optimiser-attribute-offers — Phase 4 helper cron.
 *
 * Walks recent offer dispatches and back-fills `converted_at` +
 * `converted_to_rental_id` from leads that have since converted. Runs nightly
 * after the outcome-measurement cron so the outcome screen shows the
 * "N of M contacted leads booked" attribution line.
 *
 * Conservative match window: the lead must have converted AFTER the offer was
 * dispatched. We don't try to credit conversions that happened before we
 * reached out.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Find sent dispatches with no conversion attribution yet, ≤ 30 days old.
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: dispatchesRaw } = await supabase
      .from("revenue_optimiser_offer_dispatches")
      .select("id, lead_id, dispatched_at")
      .eq("dispatch_status", "sent")
      .is("converted_to_rental_id", null)
      .gte("created_at", since);

    const dispatches = (dispatchesRaw ?? []) as Array<{ id: string; lead_id: string; dispatched_at: string | null }>;
    const summary = { scanned: dispatches.length, attributed: 0, errors: [] as string[] };
    if (dispatches.length === 0) return jsonResponse(summary);

    const leadIds = [...new Set(dispatches.map((d) => d.lead_id))];
    const { data: leadsRaw } = await supabase
      .from("leads")
      .select("id, converted_at, converted_to_rental_id")
      .in("id", leadIds)
      .not("converted_to_rental_id", "is", null);
    const convertedLeads = new Map<string, { converted_at: string; converted_to_rental_id: string }>(
      ((leadsRaw ?? []) as Array<{ id: string; converted_at: string; converted_to_rental_id: string }>)
        .map((l) => [l.id, { converted_at: l.converted_at, converted_to_rental_id: l.converted_to_rental_id }]),
    );

    for (const d of dispatches) {
      const conv = convertedLeads.get(d.lead_id);
      if (!conv || !conv.converted_at) continue;
      // Must convert AFTER the offer went out
      if (d.dispatched_at && new Date(conv.converted_at).getTime() < new Date(d.dispatched_at).getTime()) continue;

      try {
        await supabase
          .from("revenue_optimiser_offer_dispatches")
          .update({
            converted_at: conv.converted_at,
            converted_to_rental_id: conv.converted_to_rental_id,
          })
          .eq("id", d.id);
        summary.attributed++;
      } catch (err) {
        summary.errors.push(`${d.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return jsonResponse(summary);
  } catch (err) {
    console.error("revenue-optimiser-attribute-offers error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
