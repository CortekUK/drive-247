import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Public iCal export for a single Drive247 vehicle. Each vehicle exposes a
 * secret-token URL; the host pastes it into Turo (or any other platform) so
 * Drive247 bookings automatically block the vehicle on the other side.
 *
 * URL shape: /functions/v1/vehicle-ical-export?vehicle_id=<uuid>&token=<token>
 * The token is just the vehicle UUID for now — acts like a shared secret. If
 * we need rotation later we can add a dedicated column.
 */

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatICalDate(date: string): string {
  // Accept YYYY-MM-DD → YYYYMMDD (all-day event per RFC 5545)
  return date.replaceAll("-", "");
}

function buildIcs(params: {
  vehicleReg: string;
  events: Array<{
    uid: string;
    start: string;
    end: string; // exclusive; caller handles +1 day
    summary: string;
  }>;
}): string {
  const now = new Date();
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(
      now.getUTCDate(),
    )}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(
      now.getUTCSeconds(),
    )}Z`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Drive247//Vehicle Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:Drive247 - ${params.vehicleReg}`,
  ];

  for (const e of params.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${formatICalDate(e.start)}`,
      `DTEND;VALUE=DATE:${formatICalDate(e.end)}`,
      `SUMMARY:${e.summary.replace(/[\r\n,;]/g, " ")}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const vehicleId = url.searchParams.get("vehicle_id");
    const token = url.searchParams.get("token");

    if (!vehicleId || !token) {
      return new Response("Missing vehicle_id or token", { status: 400 });
    }
    if (vehicleId !== token) {
      // Simple token check — token must equal vehicle_id.
      return new Response("Invalid token", { status: 403 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select("id, reg")
      .eq("id", vehicleId)
      .maybeSingle();
    if (vErr) throw vErr;
    if (!vehicle) return new Response("Not found", { status: 404 });

    const { data: rentals, error: rErr } = await supabase
      .from("rentals")
      .select("id, rental_number, start_date, end_date, status")
      .eq("vehicle_id", vehicleId)
      .in("status", ["Pending", "Active"]);
    if (rErr) throw rErr;

    const events = (rentals ?? [])
      .filter((r: any) => r.start_date)
      .map((r: any) => {
        // iCal DTEND is exclusive for all-day events; rental end_date is inclusive
        const end = r.end_date ?? r.start_date;
        const endExclusive = new Date(end + "T00:00:00Z");
        endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
        return {
          uid: `drive247-rental-${r.id}@drive-247.com`,
          start: r.start_date,
          end: endExclusive.toISOString().slice(0, 10),
          summary: `Drive247 ${r.rental_number ?? r.id.slice(0, 8)}`,
        };
      });

    const ics = buildIcs({ vehicleReg: vehicle.reg, events });

    return new Response(ics, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="drive247-${vehicle.reg}.ics"`,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(msg, { status: 500 });
  }
});
