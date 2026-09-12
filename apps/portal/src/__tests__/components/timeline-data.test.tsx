import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineData, TimelineScope } from "@/components/timeline-v2/model";
import { useTimelineData } from "@/components/timeline-v2/use-timeline-data";

const db = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, calls: [] as { table: string; filters: [string, ...any[]][] }[], fail: false, hideRegistration: false }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-a", timezone: "America/New_York", hide_vehicle_registration: db.hideRegistration } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  const call = { table, filters: [] as [string, ...any[]][] };
  db.calls.push(call);
  const query: any = {};
  for (const method of ["select", "eq", "lte", "gte", "or", "order"]) query[method] = (...args: any[]) => { call.filters.push([method, ...args]); return query; };
  query.range = (from: number, through: number) => Promise.resolve({ data: (db.rows[table] || []).slice(from, through + 1), error: db.fail ? new Error("Unavailable") : null });
  return query;
} } }));

// Exercise the actual query function without a DOM renderer or any live requests.
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options }));
function query(scope: TimelineScope, enabled = true) {
  return useTimelineData(scope, "2026-09-08", "2026-09-14", enabled) as unknown as { enabled: boolean; queryFn: () => Promise<TimelineData> };
}
const rawBooking = { id: "rental-a", rental_number: "RNT-A", start_date: "2026-09-08", end_date: "2026-09-12", pickup_time: "13:30", return_time: "11:00", status: "Pending", customers: { id: "customer-a", name: "Customer A" }, vehicles: { id: "vehicle-a", make: "Toyota", model: "RAV4", reg: "ABC", daily_rent: 90, weekly_rent: 500, monthly_rent: null } };

beforeEach(() => { db.calls = []; db.fail = false; db.hideRegistration = false; db.rows = { rentals: [rawBooking], vehicles: [rawBooking.vehicles], blocked_dates: [], rental_extensions: [], vehicle_daily_prices: [{ id: "price-a", date: "2026-09-10", price: 110 }] }; });

describe("tenant and record scoped timeline reads", () => {
  it("respects the existing hide-registration setting across all presentations", async () => {
    db.hideRegistration = true;
    const data = await query({ kind: "vehicle", id: "vehicle-a" }).queryFn();
    expect(data.bookings[0].vehicle.reg).toBe("");
    expect(data.vehicles[0].reg).toBe("");
  });
  it("loads customer history without fleet blocks or unrelated customer data", async () => {
    const data = await query({ kind: "customer", id: "customer-a" }).queryFn();
    expect(db.calls.map(c => c.table)).toEqual(["rentals"]);
    expect(db.calls[0].filters).toContainEqual(["eq", "tenant_id", "tenant-a"]);
    expect(db.calls[0].filters).toContainEqual(["eq", "customer_id", "customer-a"]);
    expect(data?.bookings[0]).toMatchObject({ id: "rental-a", start: "2026-09-08", end: "2026-09-12", pickupTime: "13:30", returnTime: "11:00", status: "Pending" });
    expect(data?.blocks).toEqual([]);
  });
  it("scopes vehicle availability and daily prices to the owning tenant", async () => {
    const data = await query({ kind: "vehicle", id: "vehicle-a" }).queryFn();
    for (const call of db.calls.filter(c => c.table !== "vehicle_daily_prices")) expect(call.filters).toContainEqual(["eq", "tenant_id", "tenant-a"]);
    expect(db.calls.find(c => c.table === "rentals")?.filters).toContainEqual(["eq", "vehicle_id", "vehicle-a"]);
    expect(db.calls.find(c => c.table === "blocked_dates")?.filters).toContainEqual(["or", "vehicle_id.eq.vehicle-a,vehicle_id.is.null"]);
    const priceCall = db.calls.find(c => c.table === "vehicle_daily_prices")!;
    expect(priceCall.filters).toContainEqual(["eq", "vehicle_id", "vehicle-a"]);
    expect(priceCall.filters).toContainEqual(["eq", "vehicles.tenant_id", "tenant-a"]);
    expect(data?.prices["2026-09-10"]).toBe(110);
    expect(data?.vehicles[0]).toMatchObject({ daily: 90, weekly: 500, monthly: null });
  });
  it("keeps fixed rental and extension reads on the selected rental", async () => {
    const data = await query({ kind: "rental", id: "rental-a" }).queryFn();
    expect(db.calls.map(c => c.table)).toEqual(["rentals", "rental_extensions"]);
    expect(db.calls[0].filters).toContainEqual(["eq", "id", "rental-a"]);
    expect(db.calls[1].filters).toContainEqual(["eq", "rental_id", "rental-a"]);
    expect(db.calls[1].filters).toContainEqual(["eq", "tenant_id", "tenant-a"]);
  });
  it("does not truncate a fleet beyond PostgREST's first page", async () => {
    db.rows.rentals = Array.from({ length: 1001 }, (_, n) => ({ ...rawBooking, id: `rental-${n}` }));
    const data = await query({ kind: "all" }).queryFn();
    expect(data?.bookings).toHaveLength(1001);
    const reads = db.calls.filter(c => c.table === "rentals");
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      expect(read.filters).toContainEqual(["eq", "tenant_id", "tenant-a"]);
      expect(read.filters).toContainEqual(["lte", "start_date", "2026-09-14"]);
      expect(read.filters).toContainEqual(["or", "end_date.gte.2026-09-08,end_date.is.null"]);
    }
  });
  it("surfaces query failures and never substitutes fixture data", async () => {
    db.fail = true;
    await expect(query({ kind: "all" }).queryFn()).rejects.toThrow("Unavailable");
  });
  it("makes no reads when the permission gate disables the adapter", () => {
    expect(query({ kind: "all" }, false).enabled).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
});
