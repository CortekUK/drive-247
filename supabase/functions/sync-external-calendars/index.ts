import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { jsonResponse, errorResponse, handleCors } from "../_shared/cors.ts";

/**
 * Pull external calendars on a 15-min cron and write blocks into
 * external_bookings so the rentals calendar / conflict checks don't double-book.
 *
 * Two modes:
 *
 *  - TENANT-LEVEL (Turo): Turo gives hosts ONE account-wide iCal feed at
 *      https://turo.com/reservations/subscribe/ical.ics?driverId=...&key=...
 *    containing reservations for every car they own. We fetch once per
 *    tenant, then match each VEVENT to a Drive247 vehicle by parsing its
 *    SUMMARY (reg substring → make+model substring → otherwise skipped).
 *
 *  - PER-VEHICLE (Airbnb, Vrbo, Booking.com, etc.): these platforms expose
 *    one feed per listing. We keep the original behavior here for that path.
 */

interface VehicleRow {
  id: string;
  tenant_id: string;
  reg: string | null;
  make: string | null;
  model: string | null;
  external_ical_url: string | null;
  external_ical_source: string | null;
}

interface TenantRow {
  id: string;
  turo_ical_url: string | null;
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

/**
 * Match a Turo VEVENT SUMMARY to one of the tenant's vehicles.
 * Strategy (in order):
 *   1. Exact reg substring (case-insensitive) — most specific
 *   2. make AND model both appear in the summary
 * Returns null if no confident match.
 */
function matchVehicleFromSummary(
  summary: string | null,
  vehicles: VehicleRow[],
): VehicleRow | null {
  if (!summary) return null;
  const hay = summary.toLowerCase();

  for (const v of vehicles) {
    if (v.reg && v.reg.length >= 3 && hay.includes(v.reg.toLowerCase())) {
      return v;
    }
  }
  for (const v of vehicles) {
    const make = v.make?.toLowerCase();
    const model = v.model?.toLowerCase();
    if (make && model && hay.includes(make) && hay.includes(model)) {
      return v;
    }
  }
  return null;
}

function inclusiveEndDate(end: string, start: string): string {
  // iCal DTEND is exclusive for all-day events — subtract one day so our
  // inclusive end_date matches what a human would call the last booked night.
  const endDate = new Date(end + "T00:00:00Z");
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const inclusive = endDate.toISOString().slice(0, 10);
  return inclusive < start ? start : inclusive;
}

async function syncTenantTuro(
  supabase: ReturnType<typeof createClient>,
  tenant: TenantRow,
): Promise<{
  ok: boolean;
  total: number;
  matched: number;
  unmatched: number;
  error?: string;
}> {
  try {
    const resp = await fetch(tenant.turo_ical_url!, {
      headers: { Accept: "text/calendar" },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} from Turo iCal feed`);
    }
    const text = await resp.text();
    const events = parseICal(text);

    const { data: vehicleData, error: vErr } = await supabase
      .from("vehicles")
      .select("id, tenant_id, reg, make, model")
      .eq("tenant_id", tenant.id);
    if (vErr) throw vErr;
    const vehicles = (vehicleData ?? []) as unknown as VehicleRow[];

    let matched = 0;
    let unmatched = 0;
    const rowsByVehicle = new Map<string, any[]>();

    for (const ev of events) {
      const v = matchVehicleFromSummary(ev.summary, vehicles);
      if (!v) {
        unmatched++;
        continue;
      }
      matched++;
      const list = rowsByVehicle.get(v.id) ?? [];
      list.push({
        tenant_id: tenant.id,
        vehicle_id: v.id,
        source: "turo",
        external_uid: ev.uid,
        summary: ev.summary,
        start_date: ev.start,
        end_date: inclusiveEndDate(ev.end, ev.start),
        raw: { summary: ev.summary, dtstart: ev.start, dtend: ev.end },
      });
      rowsByVehicle.set(v.id, list);
    }

    // Replace strategy per (tenant, source=turo): drop all existing turo rows
    // for this tenant first, then insert fresh. Bookings can disappear from
    // Turo (cancellations) and we don't want stale blocks.
    const { error: delErr } = await supabase
      .from("external_bookings")
      .delete()
      .eq("tenant_id", tenant.id)
      .eq("source", "turo");
    if (delErr) throw delErr;

    const allRows = Array.from(rowsByVehicle.values()).flat();
    if (allRows.length > 0) {
      const { error: insErr } = await supabase
        .from("external_bookings")
        .insert(allRows);
      if (insErr) throw insErr;
    }

    await supabase
      .from("tenants")
      .update({
        turo_ical_last_synced_at: new Date().toISOString(),
        turo_ical_last_error: unmatched > 0
          ? `${unmatched} of ${events.length} reservations could not be matched to a vehicle by name — check that vehicle reg / make / model appears in Turo's listing title`
          : null,
      })
      .eq("id", tenant.id);

    return { ok: true, total: events.length, matched, unmatched };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("tenants")
      .update({
        turo_ical_last_synced_at: new Date().toISOString(),
        turo_ical_last_error: msg.slice(0, 500),
      })
      .eq("id", tenant.id);
    return { ok: false, total: 0, matched: 0, unmatched: 0, error: msg };
  }
}

async function syncVehicle(
  supabase: ReturnType<typeof createClient>,
  vehicle: VehicleRow,
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const resp = await fetch(vehicle.external_ical_url!, {
      headers: { Accept: "text/calendar" },
    });
    if (!resp.ok) {
      return { ok: false, count: 0, error: `HTTP ${resp.status}` };
    }
    const text = await resp.text();
    const events = parseICal(text);
    const source = vehicle.external_ical_source ?? "airbnb";

    const { error: delErr } = await supabase
      .from("external_bookings")
      .delete()
      .eq("vehicle_id", vehicle.id)
      .neq("source", "turo"); // Turo blocks are managed at the tenant level
    if (delErr) throw delErr;

    if (events.length > 0) {
      const rows = events.map((e) => ({
        tenant_id: vehicle.tenant_id,
        vehicle_id: vehicle.id,
        source,
        external_uid: e.uid,
        summary: e.summary,
        start_date: e.start,
        end_date: inclusiveEndDate(e.end, e.start),
        raw: { summary: e.summary, dtstart: e.start, dtend: e.end },
      }));

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

    // Allow targeted sync via POST { tenant_id } or { vehicle_id }.
    let tenantIdFilter: string | null = null;
    let vehicleIdFilter: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.tenant_id) tenantIdFilter = body.tenant_id;
        if (body?.vehicle_id) vehicleIdFilter = body.vehicle_id;
      } catch {
        // no body — treat as cron invocation
      }
    }

    // 1. Tenant-level Turo sync
    let tenantResults: Awaited<ReturnType<typeof syncTenantTuro>>[] = [];
    if (!vehicleIdFilter) {
      let tenantQuery = supabase
        .from("tenants")
        .select("id, turo_ical_url")
        .not("turo_ical_url", "is", null);
      if (tenantIdFilter) tenantQuery = tenantQuery.eq("id", tenantIdFilter);

      const { data: tenantData, error: tenantErr } = await tenantQuery;
      if (tenantErr) throw tenantErr;
      const tenants = (tenantData ?? []) as unknown as TenantRow[];

      tenantResults = await Promise.all(
        tenants.map((t) => syncTenantTuro(supabase, t)),
      );
    }

    // 2. Per-vehicle sync (Airbnb / Vrbo / Booking.com / other)
    let vehicleResults: Awaited<ReturnType<typeof syncVehicle>>[] = [];
    if (!tenantIdFilter) {
      let vehicleQuery = supabase
        .from("vehicles")
        .select("id, tenant_id, reg, make, model, external_ical_url, external_ical_source")
        .eq("external_ical_enabled", true)
        .not("external_ical_url", "is", null)
        .neq("external_ical_source", "turo");
      if (vehicleIdFilter) vehicleQuery = vehicleQuery.eq("id", vehicleIdFilter);

      const { data: vehicleData, error: vehicleErr } = await vehicleQuery;
      if (vehicleErr) throw vehicleErr;
      const vehicles = (vehicleData ?? []) as unknown as VehicleRow[];

      vehicleResults = await Promise.all(
        vehicles.map((v) => syncVehicle(supabase, v)),
      );
    }

    return jsonResponse({
      success: true,
      tenants: {
        total: tenantResults.length,
        succeeded: tenantResults.filter((r) => r.ok).length,
        failed: tenantResults.filter((r) => !r.ok).length,
        events: tenantResults.reduce((s, r) => s + r.total, 0),
        matched: tenantResults.reduce((s, r) => s + r.matched, 0),
        unmatched: tenantResults.reduce((s, r) => s + r.unmatched, 0),
      },
      vehicles: {
        total: vehicleResults.length,
        succeeded: vehicleResults.filter((r) => r.ok).length,
        failed: vehicleResults.filter((r) => !r.ok).length,
        events: vehicleResults.reduce((s, r) => s + r.count, 0),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
  }
});
