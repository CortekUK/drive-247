// Proves spec 01 (the data) against staging.
import { statement, run, sql, rest, equal, ok } from "../../eval-kit.mjs";
import { admin, book, freeSlots, makeCompany, rpc, northwind } from "./lib/fixtures.mjs";

const fails = async (query) => {
  try {
    await sql(query);
    return null;
  } catch (e) {
    return String(e.message);
  }
};

let co, nw, adminToken, slots, b1;

async function setup() {
  if (co) return;
  co = await makeCompany();
  nw = await northwind();
  adminToken = await admin();
  slots = await freeSlots(co.owner.token);
  ok(slots.length >= 6, "staging has at least 6 free times");
  const r = await book(co.owner.token, slots[0], { p_timezone: "Asia/Karachi" });
  ok(!r.error, `a booking for the test company: ${JSON.stringify(r.error)}`);
  b1 = r.data.id;
}

statement("01.1", "There is exactly one row of Bryan's settings; a second cannot be inserted", async () => {
  const [{ n }] = await sql(`select count(*)::int as n from public.onboarding_call_settings`);
  equal(n, 1, "settings rows");
  ok(await fails(`insert into public.onboarding_call_settings (id) values (true)`), "a second row was refused");
  ok(await fails(`insert into public.onboarding_call_settings (id) values (false)`), "a false id was refused");
});

statement("01.2", "Staging has the settings row with today's values", async () => {
  const [s] = await sql(`select duration_minutes, buffer_minutes, timezone, weekly_hours, min_notice_hours, max_days_ahead, is_accepting from public.onboarding_call_settings`);
  equal(s.duration_minutes, 30, "call length");
  equal(s.buffer_minutes, 0, "gap");
  equal(s.timezone, "America/New_York", "zone");
  equal(s.min_notice_hours, 12, "notice");
  equal(s.max_days_ahead, 30, "days ahead");
  equal(s.is_accepting, true, "taking calls");
  for (const d of ["1", "2", "3", "4", "5"]) equal(s.weekly_hours[d], [["09:00", "17:00"]], `day ${d}`);
  equal(s.weekly_hours["0"] ?? null, null, "Sunday off");
  equal(s.weekly_hours["6"] ?? null, null, "Saturday off");
});

statement("01.3", "A settings time zone that is not real is refused", async () => {
  const why = await fails(`update public.onboarding_call_settings set timezone = 'Mars/Olympus' where id`);
  ok(why && why.includes("Unknown time zone"), `refused with Unknown time zone, got ${why}`);
});

statement("01.4", "A weekly window that ends before it starts is refused", async () => {
  const why = await fails(`update public.onboarding_call_settings set weekly_hours = '{"1":[["10:00","09:00"]]}' where id`);
  ok(why && why.includes("A window must end after it starts"), `got ${why}`);
  const same = await fails(`update public.onboarding_call_settings set weekly_hours = '{"1":[["10:00","10:00"]]}' where id`);
  ok(same, "a window that ends when it starts is refused");
});

statement("01.5", "Call length, gap, notice and days ahead out of range are refused", async () => {
  for (const [col, v] of [["duration_minutes", 9], ["duration_minutes", 181], ["buffer_minutes", -1], ["buffer_minutes", 121],
                          ["min_notice_hours", -1], ["min_notice_hours", 337], ["max_days_ahead", 0], ["max_days_ahead", 181]]) {
    ok(await fails(`update public.onboarding_call_settings set ${col} = ${v} where id`), `${col} = ${v} refused`);
  }
});

statement("01.6", "A booking stores the company's zone, and a zone that is not real is refused", async () => {
  await setup();
  const [b] = await sql(`select customer_timezone from public.onboarding_call_bookings where id = '${b1}'`);
  equal(b.customer_timezone, "Asia/Karachi", "saved zone");
  const r = await book(co.owner.token, slots[1], { p_timezone: "Mars/Olympus" });
  ok(r.error && String(r.error.message).includes("Unknown time zone"), `refused, got ${JSON.stringify(r.error)}`);
});

statement("01.7", "A booking stores how it was made", async () => {
  await setup();
  const [b] = await sql(`select booked_via from public.onboarding_call_bookings where id = '${b1}'`);
  equal(b.booked_via, "portal", "booked_via");
  ok(await fails(`update public.onboarding_call_bookings set booked_via = 'phone' where id = '${b1}'`), "another value is refused");
});

statement("01.9", "A moved booking keeps its id and its sequence goes up by one; a cancel raises it again", async () => {
  await setup();
  const [before] = await sql(`select sequence from public.onboarding_call_bookings where id = '${b1}'`);
  const r = await book(co.owner.token, slots[2]);
  ok(!r.error, `move: ${JSON.stringify(r.error)}`);
  equal(r.data.id, b1, "the same booking");
  const [after] = await sql(`select sequence, starts_at from public.onboarding_call_bookings where id = '${b1}'`);
  equal(after.sequence, before.sequence + 1, "sequence after a move");
  equal(new Date(after.starts_at).toISOString(), new Date(slots[2]).toISOString(), "the new start");
});

statement("01.8", "A cancelled booking stores who cancelled it and the reason; a reason over 500 is refused", async () => {
  await setup();
  const long = await rpc("cancel_my_onboarding_call", { p_reason: "x".repeat(501) }, co.owner.token);
  ok(long.error, "501 characters refused");
  const [before] = await sql(`select sequence from public.onboarding_call_bookings where id = '${b1}'`);
  const r = await rpc("cancel_my_onboarding_call", { p_reason: "Travelling that week" }, co.owner.token);
  ok(!r.error, `cancel: ${JSON.stringify(r.error)}`);
  const [b] = await sql(`select status, cancelled_by, cancel_reason, sequence from public.onboarding_call_bookings where id = '${b1}'`);
  equal(b.status, "cancelled", "status");
  equal(b.cancelled_by, "operator", "cancelled_by");
  equal(b.cancel_reason, "Travelling that week", "reason");
  equal(b.sequence, before.sequence + 1, "sequence after a cancel");
  ok(await fails(`update public.onboarding_call_bookings set cancelled_by = 'robot' where id = '${b1}'`), "another canceller is refused");
});

statement("01.10", "Every booking has its own unguessable ics_token", async () => {
  await setup();
  const r = await book(co.owner.token, slots[3]);
  ok(!r.error, `book again: ${JSON.stringify(r.error)}`);
  const rows = await sql(`select ics_token from public.onboarding_call_bookings where tenant_id = '${co.id}'`);
  ok(rows.length >= 2, "two bookings");
  ok(rows.every((x) => /^[0-9a-f-]{36}$/.test(x.ics_token)), "each is a uuid");
  equal(new Set(rows.map((x) => x.ics_token)).size, rows.length, "all different");
});

statement("01.11", "Two live bookings can never share a start time", async () => {
  await setup();
  const [live] = await sql(`select starts_at from public.onboarding_call_bookings where tenant_id = '${co.id}' and status = 'booked'`);
  const why = await fails(`insert into public.onboarding_call_bookings (tenant_id, name, email, starts_at, ends_at)
                           values ('${nw.id}', 'Eval', 'eval+dup@example.com', '${new Date(live.starts_at).toISOString()}', '${new Date(new Date(live.starts_at).getTime() + 1800000).toISOString()}')`);
  ok(why && why.includes("onboarding_call_bookings_one_per_slot"), `refused by the one-per-slot index, got ${why}`);
});

statement("01.12", "A company can never hold two live bookings", async () => {
  await setup();
  const why = await fails(`insert into public.onboarding_call_bookings (tenant_id, name, email, starts_at, ends_at)
                           values ('${co.id}', 'Eval', 'eval+dup2@example.com', '${slots[5]}', '${new Date(new Date(slots[5]).getTime() + 1800000).toISOString()}')`);
  ok(why && why.includes("onboarding_call_bookings_one_per_tenant"), `refused by the one-per-company index, got ${why}`);
});

statement("01.13", "Every action writes one history row saying what, who, and when", async () => {
  await setup();
  const rows = await sql(`select kind, actor, from_starts_at, to_starts_at, reason from public.onboarding_call_history where booking_id = '${b1}' order by created_at`);
  equal(rows.map((r) => r.kind), ["booked", "moved", "cancelled"], "kinds in order");
  ok(rows.every((r) => r.actor === "operator"), "all by the company");
  equal(new Date(rows[1].from_starts_at).toISOString(), new Date(slots[0]).toISOString(), "move from");
  equal(new Date(rows[1].to_starts_at).toISOString(), new Date(slots[2]).toISOString(), "move to");
  equal(rows[2].reason, "Travelling that week", "cancel reason");
});

statement("01.14", "A blocked period that ends before it starts is refused, and a label over 80 too", async () => {
  ok(await fails(`insert into public.onboarding_call_blocks (starts_at, ends_at) values ('2027-01-05 20:00Z', '2027-01-05 19:00Z')`), "end before start");
  ok(await fails(`insert into public.onboarding_call_blocks (starts_at, ends_at, label) values ('2027-01-05 19:00Z', '2027-01-05 20:00Z', '${"x".repeat(81)}')`), "long label");
});

statement("01.15", "The same email can never be queued twice", async () => {
  await setup();
  const [e] = await sql(`select dedupe_key from public.onboarding_call_emails where booking_id = '${b1}' limit 1`);
  ok(e, "the booking queued emails");
  const why = await fails(`insert into public.onboarding_call_emails (booking_id, kind, recipient, dedupe_key) values ('${b1}', 'booked_company', 'x@example.com', '${e.dedupe_key}')`);
  ok(why && why.includes("dedupe_key"), `refused by the unique key, got ${why}`);
});

const TABLES = ["onboarding_call_bookings", "onboarding_call_history", "onboarding_call_blocks", "onboarding_call_emails", "onboarding_call_settings"];

statement("01.16", "A company member reads none of the tables directly", async () => {
  await setup();
  for (const t of TABLES) {
    for (const [who, token] of [["northwind owner", nw.token], ["test owner", co.owner.token], ["team member", co.member.token]]) {
      const r = await rest(`${t}?select=*`, { as: token });
      ok(r.status === 200 && Array.isArray(r.data) && r.data.length === 0, `${who} reads ${t}: got ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
    }
  }
});

statement("01.17", "A super admin reads bookings, history, the ledger and the settings", async () => {
  await setup();
  for (const t of ["onboarding_call_bookings", "onboarding_call_history", "onboarding_call_emails"]) {
    const r = await rest(`${t}?select=id&booking_id=eq.${b1}`.replace("onboarding_call_bookings?select=id&booking_id", "onboarding_call_bookings?select=id&id"), { as: adminToken });
    ok(r.status === 200 && r.data.length >= 1, `admin reads ${t}: ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`);
  }
  const s = await rest(`onboarding_call_settings?select=timezone`, { as: adminToken });
  equal(s.data?.length, 1, "admin reads the settings");
  const b = await rest(`onboarding_call_blocks?select=id`, { as: adminToken });
  equal(b.status, 200, "admin reads blocks");
});

statement("01.18", "Nobody signed in writes these tables directly", async () => {
  await setup();
  for (const [who, token] of [["owner", co.owner.token], ["super admin", adminToken]]) {
    const ins = await rest(`onboarding_call_bookings`, { method: "POST", as: token, body: { tenant_id: co.id, name: "x", email: "x@example.com", starts_at: slots[4], ends_at: slots[4] } });
    ok(ins.status >= 400, `${who} insert booking refused (${ins.status})`);
    const upd = await rest(`onboarding_call_settings?id=eq.true`, { method: "PATCH", as: token, body: { is_accepting: false } });
    ok(upd.status >= 400 || (Array.isArray(upd.data) && upd.data.length === 0), `${who} update settings refused (${upd.status})`);
    for (const t of ["onboarding_call_history", "onboarding_call_blocks", "onboarding_call_emails"]) {
      const del = await rest(`${t}?id=not.is.null`, { method: "DELETE", as: token });
      ok(del.status >= 400 || (Array.isArray(del.data) && del.data.length === 0), `${who} delete ${t} refused (${del.status})`);
    }
  }
  const [s] = await sql(`select is_accepting from public.onboarding_call_settings`);
  equal(s.is_accepting, true, "settings unchanged");
  const [{ n }] = await sql(`select count(*)::int as n from public.onboarding_call_history where booking_id = '${b1}'`);
  equal(n, 3, "history unchanged");
});

statement("01.19", "A visitor with no login reads nothing and calls none of the functions", async () => {
  for (const t of TABLES) {
    const r = await rest(`${t}?select=*`);
    ok(r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0), `anon reads ${t}: ${r.status}`);
  }
  for (const f of ["get_onboarding_call_calendar", "book_onboarding_call", "cancel_my_onboarding_call", "get_my_onboarding_call",
                   "admin_list_onboarding_calls", "admin_onboarding_call_counts", "admin_save_onboarding_call_settings", "preview_onboarding_call_slots"]) {
    const r = await rpc(f, {}, "anon");
    ok(r.status === 401 || r.status === 403 || r.status === 404, `anon calls ${f}: ${r.status}`);
  }
});

statement("01.20", "A booking made before this change keeps its values and gets the new defaults", async () => {
  await setup();
  // A row written with only the columns the old functions wrote.
  const start = new Date(new Date(slots[slots.length - 1]).getTime() + 86_400_000 * 3).toISOString();
  const [b] = await sql(`insert into public.onboarding_call_bookings (tenant_id, name, email, phone, notes, starts_at, ends_at)
                         values ('${nw.id}', 'Old Booking', 'eval+old@example.com', '+1 555', 'note', '${start}', '${start}'::timestamptz + interval '30 minutes')
                         returning *`);
  equal(b.name, "Old Booking", "name kept");
  equal(b.notes, "note", "note kept");
  equal(b.customer_timezone, null, "zone empty");
  equal(b.booked_via, "portal", "booked_via");
  equal(b.sequence, 0, "sequence");
  ok(/^[0-9a-f-]{36}$/.test(b.ics_token), "an ics_token");
  await sql(`delete from public.onboarding_call_bookings where id = '${b.id}'`);
});

statement("01.21", "Bookings are in the realtime publication", async () => {
  const rows = await sql(`select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'onboarding_call_bookings'`);
  equal(rows.length, 1, "published");
});

await run(import.meta.url);
