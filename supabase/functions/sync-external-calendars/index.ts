import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse, errorResponse, handleCors } from "../_shared/cors.ts";

/**
 * Poll every vehicle with external_ical_enabled=true, fetch its iCal feed
 * (Turo / Airbnb / Vrbo / Booking.com all speak the same RFC 5545 format),
 * parse VEVENT blocks, and upsert them into external_bookings. Runs on a
 * 15-minute cron. Idempotent via UNIQUE(vehicle_id, external_uid).
 */

interface VehicleRow {
  id: string;
  tenant_id: string;
  external_ical_url: string;
  external_ical_source: string | null;
}

interface ParsedEvent {
  uid: string;
  summary: string | null;
  start: string;
  end: string;
}

function parseICalDate(value: string): string | null {
  const v = value.trim();
  const basicDate = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (basicDate) return `${basicDate[1]}-${basicDate[2]}-${basicDate[3]}`;
  const dateTime = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (dateTime) return `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}`;
  return null;
}

function unfoldLines(text: string): string[] {
  // RFC 5545 line folding: continuation lines start with a space or tab
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      out[out.length - 1] = (out[out.length - 1] ?? "") + line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseICal(text: string): ParsedEvent[] {
  const lines = unfoldLines(text);
  const events: ParsedEvent[] = [];
  let cur: Partial<ParsedEvent> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur && cur.uid && cur.start && cur.end) {
        events.push({
          uid: cur.uid,
          summary: cur.summary ?? null,
          start: cur.start,
          end: cur.end,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const keyPart = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const key = keyPart.split(";")[0].toUpperCase();

    if (key === "UID") cur.uid = value;
    else if (key === "SUMMARY") cur.summary = value;
    else if (key === "DTSTART") {
      const d = parseICalDate(value);
      if (d) cur.start = d;
    } else if (key === "DTEND") {
      const d = parseICalDate(value);
      if (d) cur.end = d;
    }
  }
  return events;
}

async function syncVehicle(
  supabase: ReturnType<typeof createClient>,
  vehicle: VehicleRow,
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const resp = await fetch(vehicle.external_ical_url, {
      headers: { Accept: "text/calendar" },
    });
    if (!resp.ok) {
      return { ok: false, count: 0, error: `HTTP ${resp.status}` };
    }
    const text = await resp.text();
    const events = parseICal(text);
    const source = vehicle.external_ical_source ?? "turo";

    // Replace strategy: delete existing rows for this vehicle, insert fresh.
    // Bookings in iCal can disappear when canceled — we don't want stale blocks.
    const { error: delErr } = await supabase
      .from("external_bookings")
      .delete()
      .eq("vehicle_id", vehicle.id);
    if (delErr) throw delErr;

    if (events.length > 0) {
      const rows = events.map((e) => {
        // iCal DTEND is exclusive for all-day events — subtract one day so our
        // inclusive end_date matches what a human would call the last booked night.
        const endDate = new Date(e.end + "T00:00:00Z");
        endDate.setUTCDate(endDate.getUTCDate() - 1);
        const inclusiveEnd = endDate.toISOString().slice(0, 10);
        return {
          tenant_id: vehicle.tenant_id,
          vehicle_id: vehicle.id,
          source,
          external_uid: e.uid,
          summary: e.summary,
          start_date: e.start,
          end_date: inclusiveEnd < e.start ? e.start : inclusiveEnd,
          raw: { summary: e.summary, dtstart: e.start, dtend: e.end },
        };
      });

      const { error: insErr } = await supabase
        .from("external_bookings")
        .insert(rows);
      if (insErr) throw insErr;
    }

    await supabase
      .from("vehicles")
      .update({
        external_ical_last_synced_at: new Date().toISOString(),
        external_ical_last_error: null,
      })
      .eq("id", vehicle.id);

    return { ok: true, count: events.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("vehicles")
      .update({
        external_ical_last_synced_at: new Date().toISOString(),
        external_ical_last_error: msg.slice(0, 500),
      })
      .eq("id", vehicle.id);
    return { ok: false, count: 0, error: msg };
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Allow POST {vehicle_id} for one-off manual syncs (e.g. "Sync now" button).
    let vehicleIdFilter: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.vehicle_id) vehicleIdFilter = body.vehicle_id;
      } catch {
        // no body — treat as cron invocation
      }
    }

    let query = supabase
      .from("vehicles")
      .select("id, tenant_id, external_ical_url, external_ical_source")
      .eq("external_ical_enabled", true)
      .not("external_ical_url", "is", null);
    if (vehicleIdFilter) query = query.eq("id", vehicleIdFilter);

    const { data, error } = await query;
    if (error) throw error;

    const vehicles = (data ?? []) as unknown as VehicleRow[];
    const results = await Promise.all(
      vehicles.map((v) => syncVehicle(supabase, v)),
    );

    const summary = {
      total: vehicles.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      events: results.reduce((s, r) => s + r.count, 0),
    };

    return jsonResponse({ success: true, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
});
