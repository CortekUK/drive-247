// Proves spec 03's database side (03.1, 03.2, 03.5, 03.11) against staging.
// The wording of times is proved in 03-time-zones.test.ts.
import { statement, run, sql, cleanup, equal, ok } from "../../eval-kit.mjs";
import { admin, book, freeSlots, keepSettings, makeCompany, rpc } from "./lib/fixtures.mjs";

const iso = (t) => new Date(t).toISOString();
const TODAY = {
  is_accepting: true, duration_minutes: 30, buffer_minutes: 0, timezone: "America/New_York",
  weekly_hours: { 1: [["09:00", "17:00"]], 2: [["09:00", "17:00"]], 3: [["09:00", "17:00"]], 4: [["09:00", "17:00"]], 5: [["09:00", "17:00"]] },
  blocked_dates: [], min_notice_hours: 12, max_days_ahead: 30,
};
const NOW = "2026-12-07T12:00:00Z";

let adminToken;
async function check(at, overlay) {
  adminToken ??= await admin();
  const r = await rpc("check_onboarding_call_slot", { p_starts_at: at, p_settings: { ...TODAY, ...overlay }, p_now: NOW }, adminToken);
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.data;
}

statement("03.1", "A call is stored once, as one instant in UTC", async () => {
  const cols = await sql(`select column_name, data_type from information_schema.columns
                          where table_schema = 'public' and table_name = 'onboarding_call_bookings' and column_name in ('starts_at', 'ends_at') order by 1`);
  equal(cols.map((c) => c.data_type), ["timestamp with time zone", "timestamp with time zone"], "column types");
  const co = await makeCompany({ timezone: "Asia/Karachi" });
  const [at] = await freeSlots(co.owner.token);
  const r = await book(co.owner.token, at, { p_timezone: "Australia/Sydney" });
  ok(!r.error, JSON.stringify(r.error));
  const [b] = await sql(`select starts_at, ends_at from public.onboarding_call_bookings where id = '${r.data.id}'`);
  equal(iso(b.starts_at), iso(at), "the instant asked for, whatever zone it was booked in");
  equal(new Date(b.ends_at) - new Date(b.starts_at), 30 * 60_000, "ends 30 minutes later");
});

statement("03.2", "Bryan's hours, days off and grid are read in his settings zone", async () => {
  // Tuesday 8 Dec 2026: 09:00 Karachi is 04:00 UTC, 09:00 New York is 14:00 UTC.
  equal(await check("2026-12-08T14:00:00Z", {}), null, "09:00 New York, with New York hours");
  equal(await check("2026-12-08T04:00:00Z", {}), "outside_hours", "23:00 New York, with New York hours");
  equal(await check("2026-12-08T04:00:00Z", { timezone: "Asia/Karachi" }), null, "09:00 Karachi, with Karachi hours");
  equal(await check("2026-12-08T14:00:00Z", { timezone: "Asia/Karachi" }), "outside_hours", "19:00 Karachi, with Karachi hours");
  equal(await check("2026-12-08T04:07:00Z", { timezone: "Asia/Karachi" }), "off_grid", "the grid starts at 09:00 Karachi");
  // 23:00 UTC on 8 Dec is already 9 Dec in Karachi: the day off is read on Bryan's date.
  equal(await check("2026-12-08T23:00:00Z", { timezone: "Asia/Karachi", blocked_dates: ["2026-12-09"] }), "day_off", "9 Dec off in Karachi");
});

statement("03.5", "The zone a booking was made in is saved and is the zone its company emails use; with none, Bryan's", async () => {
  const co = await makeCompany();
  const [at] = await freeSlots(co.owner.token);
  const r = await book(co.owner.token, at, { p_timezone: "Australia/Sydney" });
  ok(!r.error, JSON.stringify(r.error));
  const [e] = await sql(`select payload from public.onboarding_call_emails where booking_id = '${r.data.id}' and kind = 'booked_company'`);
  equal([e.payload.customer_timezone, e.payload.host_timezone], ["Australia/Sydney", "America/New_York"], "zones in the queued email");
  // A booking with no saved zone (made before this change).
  const [old] = await sql(`insert into public.onboarding_call_bookings (tenant_id, name, email, starts_at, ends_at, status, cancelled_at, cancelled_by)
                           values ('${co.id}', 'Old', 'eval+old@example.com', '2027-06-08T14:00:00Z', '2027-06-08T14:30:00Z', 'cancelled', now(), 'admin') returning id`);
  await sql(`select public.onboarding_call_queue_email('${old.id}', 'cancelled_company')`);
  const [e2] = await sql(`select payload from public.onboarding_call_emails where booking_id = '${old.id}'`);
  equal(e2.payload.customer_timezone, null, "no saved zone");
  equal(e2.payload.host_timezone, "America/New_York", "so the email is written in Bryan's zone (03-time-zones.test.ts 03.5 #2)");
});

statement("03.11", "Bryan changing his settings zone moves no booked call", async () => {
  await keepSettings();
  const token = await admin();
  const co = await makeCompany();
  // Tuesday 8 June 2027, 10:00 New York = 14:00 UTC = 09:00 Chicago.
  const [b] = await sql(`insert into public.onboarding_call_bookings (tenant_id, name, email, starts_at, ends_at)
                         values ('${co.id}', 'Eval', 'eval+tz@example.com', '2027-06-08T14:00:00Z', '2027-06-08T14:30:00Z') returning id`);
  cleanup(() => sql(`delete from public.onboarding_call_bookings where id = '${b.id}'`));
  // Calls the other checks booked at 09:00 New York are 08:00 Chicago: they clash (spec 06.12) and are kept.
  const first = await rpc("admin_save_onboarding_call_settings", { p_settings: { timezone: "America/Chicago" } }, token);
  ok(!first.error, JSON.stringify(first.error));
  ok(!first.data.clashes.some((c) => c.id === b.id), "the June call still fits in Chicago, so it is no clash");
  const keep = Object.fromEntries(first.data.clashes.map((c) => [c.id, "keep"]));
  const r = await rpc("admin_save_onboarding_call_settings", { p_settings: { timezone: "America/Chicago" }, p_decisions: keep }, token);
  ok(!r.error, JSON.stringify(r.error));
  equal(r.data.saved, true, "saved");
  const [s] = await sql(`select timezone from public.onboarding_call_settings`);
  equal(s.timezone, "America/Chicago", "the new zone");
  const [after] = await sql(`select starts_at, ends_at, status from public.onboarding_call_bookings where id = '${b.id}'`);
  equal([iso(after.starts_at), iso(after.ends_at), after.status], ["2027-06-08T14:00:00.000Z", "2027-06-08T14:30:00.000Z", "booked"], "the call");
});

await run(import.meta.url);
