// Proves spec 05 (what Bryan can do from his Call Calendar) against staging.
import { randomUUID } from "node:crypto";
import { statement, run, sql, equal, ok } from "../../eval-kit.mjs";
import { admin, book, freeSlots, keepSettings, makeCompany, rpc } from "./lib/fixtures.mjs";

const RUN = randomUUID().slice(0, 6);
const iso = (t) => new Date(t).toISOString();
const minutesFromNow = (m) => new Date(Date.now() + m * 60_000).toISOString();
let adminToken;
const A = async () => (adminToken ??= await admin());
const call = async (name, args) => rpc(name, args, await A());
const card = async (token) => (await rpc("get_my_onboarding_call", {}, token)).data;
const history = async (id) => sql(`select kind, actor, from_starts_at, to_starts_at, reason from public.onboarding_call_history where booking_id = '${id}' order by created_at`);
const kinds = async (id) => (await sql(`select kind from public.onboarding_call_emails where booking_id = '${id}' order by kind`)).map((e) => e.kind);
const row = async (id) => (await sql(`select * from public.onboarding_call_bookings where id = '${id}'`))[0];

/** A booking put straight in the table: any time, any status. */
async function place(tenant, startsAt, status = "booked", extra = {}) {
  const cols = { tenant_id: tenant, name: extra.name ?? "Eval", email: extra.email ?? `eval+${RUN}@example.com`, phone: extra.phone ?? null,
                 starts_at: startsAt, status, customer_timezone: extra.tz ?? "Asia/Karachi" };
  if (status === "cancelled") Object.assign(cols, { cancelled_at: new Date().toISOString(), cancelled_by: "admin" });
  const keys = Object.keys(cols);
  const vals = keys.map((k) => (cols[k] === null ? "null" : `'${String(cols[k]).replace(/'/g, "''")}'`));
  const [b] = await sql(`insert into public.onboarding_call_bookings (${keys.join(", ")}, ends_at)
                         values (${vals.join(", ")}, '${startsAt}'::timestamptz + interval '30 minutes') returning id`);
  return b.id;
}

/** Bryan open every hour of every day for one check, so "2 hours from now" is always a time he has. */
async function openAllHours() {
  const restore = await keepSettings();
  const all = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [["00:00", "24:00"]]]));
  await sql(`update public.onboarding_call_settings set weekly_hours = '${JSON.stringify(all)}', blocked_dates = '{}', is_accepting = true where id`);
  return restore;
}
/** The first half hour mark at least two hours from now. */
const twoHoursAway = () => {
  const t = Date.now() + 2 * 3600_000;
  return new Date(Math.ceil(t / 1800_000) * 1800_000).toISOString();
};

statement("05.1", "Every one of Bryan's functions refuses a company owner", async () => {
  const co = await makeCompany();
  const id = await place(co.id, minutesFromNow(60 * 24 * 3));
  const calls = [
    ["admin_set_onboarding_call_booking", { p_id: id, p_status: "completed" }],
    ["admin_note_onboarding_call", { p_id: id, p_admin_notes: "x" }],
    ["admin_cancel_onboarding_call", { p_id: id, p_reason: "x" }],
    ["admin_move_onboarding_call", { p_id: id, p_starts_at: minutesFromNow(60 * 24 * 4) }],
    ["admin_book_onboarding_call", { p_tenant_id: co.id, p_starts_at: minutesFromNow(60 * 24 * 4), p_name: "x", p_email: "eval@example.com" }],
    ["admin_onboarding_call_free_slots", {}],
    ["admin_onboarding_call_counts", {}],
    ["admin_list_onboarding_calls", {}],
    ["admin_onboarding_call_detail", { p_id: id }],
    ["admin_save_onboarding_call_settings", { p_settings: { is_accepting: false } }],
    ["preview_onboarding_call_slots", {}],
  ];
  for (const [name, args] of calls) {
    for (const [who, token] of [["owner", co.owner.token], ["team member", co.member.token]]) {
      const r = await rpc(name, args, token);
      equal([r.status, r.error?.message], [403, "Super admin access required"], `${name} as ${who}`);
    }
  }
  const b = await row(id);
  equal([b.status, b.admin_notes], ["booked", null], "the booking is untouched");
});

statement("05.2", "Marking done sets it completed, writes a completed row by admin, and the card goes away", async () => {
  const co = await makeCompany();
  const id = await place(co.id, minutesFromNow(-45));
  const r = await call("admin_set_onboarding_call_booking", { p_id: id, p_status: "completed" });
  ok(!r.error, JSON.stringify(r.error));
  equal((await row(id)).status, "completed", "status");
  equal((await history(id)).map((h) => [h.kind, h.actor]), [["completed", "admin"]], "history");
  const [j] = await sql(`select call_completed_at from public.tenant_onboarding_calls where tenant_id = '${co.id}'`);
  ok(j.call_completed_at, "the company's call is completed");
  equal((await card(co.owner.token)).call_state, "none", "the card");
  equal(await kinds(id), [], "no email");
});

statement("05.3", "Marking missed sets it missed, writes the row, queues the missed email, and the card is back on offer", async () => {
  const co = await makeCompany();
  const id = await place(co.id, minutesFromNow(-45));
  ok(!(await call("admin_set_onboarding_call_booking", { p_id: id, p_status: "missed" })).error, "marked");
  equal((await row(id)).status, "missed", "status");
  equal((await history(id)).map((h) => [h.kind, h.actor]), [["missed", "admin"]], "history");
  const [e] = await sql(`select kind, recipient from public.onboarding_call_emails where booking_id = '${id}'`);
  equal([e.kind, e.recipient], ["missed", `eval+${RUN}@example.com`], "the email to the company");
  equal((await card(co.owner.token)).call_state, "offer", "the card");
});

statement("05.4", "Only a call whose start has passed can be marked done or missed", async () => {
  const co = await makeCompany();
  const id = await place(co.id, minutesFromNow(60 * 24 * 3));
  for (const s of ["completed", "missed"]) {
    const r = await call("admin_set_onboarding_call_booking", { p_id: id, p_status: s });
    equal(r.error?.message, "This call has not happened yet.", s);
  }
  equal((await row(id)).status, "booked", "still booked");
});

statement("05.5", "Marking missed twice queues the missed email once", async () => {
  const co = await makeCompany();
  const id = await place(co.id, minutesFromNow(-45));
  await call("admin_set_onboarding_call_booking", { p_id: id, p_status: "missed" });
  await call("admin_set_onboarding_call_booking", { p_id: id, p_status: "missed" });
  equal(await kinds(id), ["missed"], "emails");
  equal((await history(id)).length, 1, "history rows");
});

statement("05.6", "A done or missed call can be put back to booked, with a reopened row, and completed is cleared", async () => {
  for (const s of ["completed", "missed"]) {
    const co = await makeCompany();
    const id = await place(co.id, minutesFromNow(-45));
    await call("admin_set_onboarding_call_booking", { p_id: id, p_status: s });
    const r = await call("admin_set_onboarding_call_booking", { p_id: id, p_status: "booked" });
    ok(!r.error, `${s}: ${JSON.stringify(r.error)}`);
    equal((await row(id)).status, "booked", `${s} put back`);
    equal((await history(id)).map((h) => h.kind), [s, "reopened"], `${s} history`);
    const [j] = await sql(`select call_completed_at, call_scheduled_for, call_missed_at from public.tenant_onboarding_calls where tenant_id = '${co.id}'`);
    equal([j.call_completed_at, j.call_missed_at, iso(j.call_scheduled_for)], [null, null, iso((await row(id)).starts_at)], `${s} journey row`);
    equal((await card(co.owner.token)).call_state, "waiting", `${s} card: booked, and its time has passed`);
  }
});

statement("05.7", "A cancelled call is put back only if its time still passes the check and the company has no other call", async () => {
  const co = await makeCompany();
  const [t1, t2] = (await freeSlots(co.owner.token)).slice(-2);
  const a = await book(co.owner.token, t1);
  await call("admin_cancel_onboarding_call", { p_id: a.data.id, p_reason: "Eval" });
  ok(!(await call("admin_set_onboarding_call_booking", { p_id: a.data.id, p_status: "booked" })).error, "its time is still free");
  equal((await row(a.data.id)).status, "booked", "put back");
  // The time taken by another company meanwhile.
  await call("admin_cancel_onboarding_call", { p_id: a.data.id, p_reason: "Eval" });
  const other = await makeCompany();
  ok(!(await book(other.owner.token, t1)).error, "another company takes the time");
  const taken = await call("admin_set_onboarding_call_booking", { p_id: a.data.id, p_status: "booked" });
  equal(taken.error?.details, "taken", "taken");
  // The company has booked again in the meantime.
  ok(!(await book(co.owner.token, t2)).error, "the company books another time");
  const second = await call("admin_set_onboarding_call_booking", { p_id: a.data.id, p_status: "booked" });
  equal(second.error?.message, "That company already has another call booked.", "another call");
  // A cancelled call whose time has passed.
  const co2 = await makeCompany();
  const past = await place(co2.id, minutesFromNow(-90), "cancelled");
  equal((await call("admin_set_onboarding_call_booking", { p_id: past, p_status: "booked" })).error?.details, "past", "its time has passed");
  // A cancelled call on what is now a day off.
  const co3 = await makeCompany();
  const [t3] = await freeSlots(co3.owner.token);
  const c = await book(co3.owner.token, t3);
  await call("admin_cancel_onboarding_call", { p_id: c.data.id, p_reason: "Eval" });
  await keepSettings();
  const day = (await sql(`select ('${t3}'::timestamptz at time zone timezone)::date::text as d from public.onboarding_call_settings`))[0].d;
  await sql(`update public.onboarding_call_settings set blocked_dates = array['${day}']::date[] where id`);
  equal((await call("admin_set_onboarding_call_booking", { p_id: c.data.id, p_status: "booked" })).error?.details, "day_off", "now a day off");
  equal((await row(c.data.id)).status, "cancelled", "stays cancelled");
});

statement("05.8", "Bryan's note is saved on any booking without changing its state", async () => {
  const co = await makeCompany();
  for (const s of ["booked", "cancelled", "completed"]) {
    const id = await place(co.id, minutesFromNow(s === "booked" ? 60 * 24 * 3 : -60 * 24), s);
    ok(!(await call("admin_note_onboarding_call", { p_id: id, p_admin_notes: "  Wants fleet import  " })).error, s);
    const b = await row(id);
    equal([b.admin_notes, b.status], ["Wants fleet import", s], s);
  }
});

statement("05.9", "Bryan's cancel needs a reason of 1 to 500 characters", async () => {
  const co = await makeCompany();
  const id = await place(co.id, minutesFromNow(60 * 24 * 3));
  for (const [why, reason] of [["none", null], ["empty", ""], ["spaces", "   "], ["501", "x".repeat(501)]]) {
    equal((await call("admin_cancel_onboarding_call", { p_id: id, p_reason: reason })).error?.message, "Please give a reason.", why);
  }
  equal((await row(id)).status, "booked", "still booked");
  ok(!(await call("admin_cancel_onboarding_call", { p_id: id, p_reason: "x".repeat(500) })).error, "500 characters");
});

statement("05.10", "Bryan's cancel sets cancelled by admin, frees the time, writes the row, queues both emails, offers the call again", async () => {
  const co = await makeCompany();
  const [at] = (await freeSlots(co.owner.token)).slice(-3);
  const r = await book(co.owner.token, at);
  const seq = (await row(r.data.id)).sequence;
  ok(!(await call("admin_cancel_onboarding_call", { p_id: r.data.id, p_reason: "Bryan is ill" })).error, "cancelled");
  const b = await row(r.data.id);
  equal([b.status, b.cancelled_by, b.cancel_reason, b.sequence], ["cancelled", "admin", "Bryan is ill", seq + 1], "the row");
  ok((await freeSlots(co.owner.token)).map(iso).includes(iso(at)), "the time is free");
  equal((await history(r.data.id)).map((h) => [h.kind, h.actor, h.reason]).at(-1), ["cancelled", "admin", "Bryan is ill"], "history");
  equal((await kinds(r.data.id)).filter((k) => k.startsWith("cancelled")), ["cancelled_company", "cancelled_host"], "emails");
  equal((await card(co.owner.token)).call_state, "offer", "the card");
});

statement("05.11", "Cancelling a booking that is not live is refused", async () => {
  const co = await makeCompany();
  for (const s of ["cancelled", "completed", "missed"]) {
    const id = await place(co.id, minutesFromNow(-60 * 24), s);
    equal((await call("admin_cancel_onboarding_call", { p_id: id, p_reason: "x" })).error?.message, "This call is not booked.", s);
  }
});

statement("05.12", "Bryan moves a call to a time 2 hours away, which a company may not", async () => {
  const restore = await openAllHours();
  try {
    const co = await makeCompany();
    const id = await place(co.id, minutesFromNow(60 * 24 * 3));
    const at = twoHoursAway();
    equal((await book(co.owner.token, at)).error?.details, "too_soon", "from the company");
    const r = await call("admin_move_onboarding_call", { p_id: id, p_starts_at: at });
    ok(!r.error, `from Bryan: ${JSON.stringify(r.error)}`);
    equal(iso((await row(id)).starts_at), iso(at), "moved");
    // Moving onto its own time slot (overlapping itself) is fine.
    ok(!(await call("admin_move_onboarding_call", { p_id: id, p_starts_at: at })).error, "onto its own time");
  } finally {
    await restore();
  }
});

statement("05.13", "Bryan's move keeps the id, sets the new times, raises the sequence, writes the row and queues both emails", async () => {
  const co = await makeCompany();
  const [from, to] = (await freeSlots(co.owner.token)).slice(-5, -3);
  const r = await book(co.owner.token, from);
  const seq = (await row(r.data.id)).sequence;
  const m = await call("admin_move_onboarding_call", { p_id: r.data.id, p_starts_at: to });
  ok(!m.error, JSON.stringify(m.error));
  const b = await row(r.data.id);
  equal([iso(b.starts_at), new Date(b.ends_at) - new Date(b.starts_at), b.sequence, b.status], [iso(to), 30 * 60_000, seq + 1, "booked"], "the row");
  const h = (await history(r.data.id)).at(-1);
  equal([h.kind, h.actor, iso(h.from_starts_at), iso(h.to_starts_at)], ["moved", "admin", iso(from), iso(to)], "history");
  equal((await kinds(r.data.id)).filter((k) => k.startsWith("moved")), ["moved_company", "moved_host"], "emails");
});

statement("05.14", "Bryan cannot move a call to a time that has passed", async () => {
  const co = await makeCompany();
  const id = await place(co.id, minutesFromNow(60 * 24 * 3));
  equal((await call("admin_move_onboarding_call", { p_id: id, p_starts_at: minutesFromNow(-60) })).error?.details, "past", "past");
});

statement("05.15", "Bryan books for any company, offered or not, in the company's zone unless he gives one", async () => {
  const old = await makeCompany({ createdDaysAgo: 90, timezone: "Asia/Karachi" });
  const [t1, t2] = (await freeSlots(old.owner.token)).slice(-7, -5);
  const r = await call("admin_book_onboarding_call", { p_tenant_id: old.id, p_starts_at: t1, p_name: "Eval Person", p_email: "Eval@Example.com", p_phone: "+92 1", p_notes: "Note" });
  ok(!r.error, `a company past its 30 days: ${JSON.stringify(r.error)}`);
  const b = await row(r.data.id);
  equal([b.customer_timezone, b.email, b.phone, b.notes], ["Asia/Karachi", "eval@example.com", "+92 1", "Note"], "saved, in the company's zone");
  const other = await makeCompany({ timezone: "Europe/London" });
  const r2 = await call("admin_book_onboarding_call", { p_tenant_id: other.id, p_starts_at: t2, p_name: "Eval", p_email: "eval@example.com", p_timezone: "America/Chicago" });
  equal((await row(r2.data.id)).customer_timezone, "America/Chicago", "the zone Bryan gave");
  const nozone = await makeCompany();
  await sql(`update public.tenants set timezone = null where id = '${nozone.id}'`);
  const [t3] = (await freeSlots(nozone.owner.token)).slice(-8);
  const r3 = await call("admin_book_onboarding_call", { p_tenant_id: nozone.id, p_starts_at: t3, p_name: "Eval", p_email: "eval@example.com" });
  ok(!r3.error, JSON.stringify(r3.error));
  const [s] = await sql(`select timezone from public.onboarding_call_settings`);
  equal((await row(r3.data.id)).customer_timezone, s.timezone, "with no company zone, Bryan's");
});

statement("05.16", "Bryan's booking skips the notice, is saved as admin, writes a booked row and queues both emails", async () => {
  const restore = await openAllHours();
  try {
    const co = await makeCompany();
    // Half an hour after 05.12's time, which that check's call now holds.
    const at = new Date(new Date(twoHoursAway()).getTime() + 30 * 60_000).toISOString();
    const r = await call("admin_book_onboarding_call", { p_tenant_id: co.id, p_starts_at: at, p_name: "Eval", p_email: "eval@example.com" });
    ok(!r.error, `2 hours away: ${JSON.stringify(r.error)}`);
    equal((await row(r.data.id)).booked_via, "admin", "booked_via");
    equal((await history(r.data.id)).map((h) => [h.kind, h.actor]), [["booked", "admin"]], "history");
    equal(await kinds(r.data.id), ["booked_company", "booked_host"], "emails");
    const off = await call("admin_book_onboarding_call", { p_tenant_id: (await makeCompany()).id, p_starts_at: new Date(new Date(at).getTime() + 7 * 60_000).toISOString(), p_name: "Eval", p_email: "eval@example.com" });
    equal(off.error?.details, "off_grid", "the other rules still apply");
  } finally {
    await restore();
  }
});

statement("05.17", "Bryan cannot book for a company that already has a live call", async () => {
  const co = await makeCompany();
  const [t1, t2] = (await freeSlots(co.owner.token)).slice(-10, -8);
  await book(co.owner.token, t1);
  const r = await call("admin_book_onboarding_call", { p_tenant_id: co.id, p_starts_at: t2, p_name: "Eval", p_email: "eval@example.com" });
  equal(r.error?.message, "That company already has another call booked.", "refused");
});

statement("05.18", "After Bryan books, the company's card shows the call as booked", async () => {
  const co = await makeCompany();
  const [at] = (await freeSlots(co.owner.token)).slice(-11);
  const r = await call("admin_book_onboarding_call", { p_tenant_id: co.id, p_starts_at: at, p_name: "Eval", p_email: "eval@example.com" });
  const c = await card(co.owner.token);
  equal([c.call_state, c.booking?.id, iso(c.call_scheduled_for)], ["booked", r.data.id, iso(at)], "the card");
});

statement("05.19", "The counts: today not cancelled, live this week, waiting to be marked, missed this month", async () => {
  // Wednesday 9 June 2027, 08:00 New York. Far enough ahead that only these rows count.
  const now = "2027-06-09T12:00:00Z";
  const counts = async () => (await call("admin_onboarding_call_counts", { p_now: now })).data;
  const before = await counts();
  const [c1, c2, c3] = [await makeCompany(), await makeCompany(), await makeCompany()];
  await place(c1.id, "2027-06-09T14:00:00Z");                 // today, this week
  await place(c1.id, "2027-06-09T16:00:00Z", "completed");    // today
  await place(c1.id, "2027-06-09T15:00:00Z", "cancelled");    // not counted
  await place(c2.id, "2027-06-07T14:00:00Z");                 // Monday: this week, and waiting
  await place(c2.id, "2027-06-02T14:00:00Z", "missed");       // missed this month
  await place(c2.id, "2027-05-31T14:00:00Z", "missed");       // missed last month
  await place(c3.id, "2027-06-14T14:00:00Z");                 // next Monday: not this week
  const after = await counts();
  equal([after.today - before.today, after.week - before.week, after.needs_marking - before.needs_marking, after.missed_month - before.missed_month],
        [2, 2, 1, 1], "today, week, waiting, missed this month");
});

// A small world for the list, found again by its run tag.
let world;
async function listWorld() {
  if (world) return world;
  const [a, b, c, d] = [await makeCompany(), await makeCompany(), await makeCompany(), await makeCompany()];
  const tag = (s) => ({ email: `eval+${RUN}-${s}@example.com` });
  const [today] = await sql(`select ((now() at time zone 'America/New_York')::date + time '12:00') at time zone 'America/New_York' as t`);
  world = {
    a, b, c, d,
    u1: await place(a.id, minutesFromNow(60 * 24 * 3), "booked", tag("u1")),
    u2: await place(b.id, minutesFromNow(60 * 24 * 5), "booked", tag("u2")),
    w1: await place(c.id, minutesFromNow(-120), "booked", tag("w1")),
    w2: await place(d.id, minutesFromNow(-60 * 24), "booked", tag("w2")),
    done: await place(a.id, minutesFromNow(-60 * 24 * 3), "completed", tag("done")),
    missed: await place(a.id, minutesFromNow(-60 * 24 * 4), "missed", tag("missed")),
    cancelled: await place(b.id, minutesFromNow(60 * 24 * 6), "cancelled", tag("cancelled")),
    todayDone: await place(a.id, iso(today.t), "completed", tag("today")),
  };
  return world;
}
const list = async (args) => {
  const r = await call("admin_list_onboarding_calls", { p_search: `eval+${RUN}-`, ...args });
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.data;
};
const ids = (rows) => rows.map((r) => r.id);

statement("05.20", "The list's views pick and order the calls as the spec says", async () => {
  const w = await listWorld();
  equal(ids((await list({})).rows), [w.u1, w.u2], "upcoming by default, soonest first");
  equal(ids((await list({ p_view: "needs_marking" })).rows), [w.w2, w.w1], "needs marking, oldest first");
  const done = (await list({ p_view: "done" })).rows;
  equal(ids(done).sort(), [w.done, w.todayDone].sort(), "done");
  ok(new Date(done[0].starts_at) > new Date(done[1].starts_at), "done, newest first");
  equal(ids((await list({ p_view: "missed" })).rows), [w.missed], "missed");
  equal(ids((await list({ p_view: "cancelled" })).rows), [w.cancelled], "cancelled");
  ok(ids((await list({ p_view: "today" })).rows).includes(w.todayDone), "today has today's done call");
  ok(!ids((await list({ p_view: "today" })).rows).includes(w.cancelled), "today has no cancelled call");
  const all = (await list({ p_view: "all" })).rows;
  equal(all.length, 8, "all");
  ok(all.every((r, i) => i === 0 || new Date(all[i - 1].starts_at) >= new Date(r.starts_at)), "all, newest first");
  equal((await call("admin_list_onboarding_calls", { p_view: "soon" })).error?.message, "Unknown view soon", "an unknown view");
});

statement("05.21", "The list's date range is whole days in Bryan's zone, inclusive", async () => {
  const co = await makeCompany();
  // 23:30 New York on Tue 8 June 2027 is 03:30 UTC on Wed 9 June.
  const late = await place(co.id, "2027-06-09T03:30:00Z", "completed", { email: `eval+${RUN}-late@example.com` });
  const r = async (from, to) => ids((await list({ p_view: "all", p_from: from, p_to: to })).rows).includes(late);
  equal(await r("2027-06-08", "2027-06-08"), true, "on 8 June in New York");
  equal(await r("2027-06-09", "2027-06-09"), false, "not on 9 June, its UTC date");
  equal(await r("2027-06-01", "2027-06-08"), true, "the last day counts");
  equal(await r("2027-06-08", null), true, "from only");
});

statement("05.22", "The search matches company name, person, email and phone, without case", async () => {
  const co = await makeCompany();
  const [t] = await sql(`select company_name from public.tenants where id = '${co.id}'`);
  const id = await place(co.id, minutesFromNow(-60 * 24 * 9), "completed", { name: `Zed Quill ${RUN}`, email: `eval+${RUN}-search@example.com`, phone: `+44 ${RUN}99` });
  for (const [why, q] of [["company name", t.company_name.toUpperCase()], ["person", `zed QUILL ${RUN}`], ["email", `EVAL+${RUN}-SEARCH`], ["phone", `${RUN}99`]]) {
    const r = await call("admin_list_onboarding_calls", { p_view: "all", p_search: q });
    ok(ids(r.data.rows).includes(id), `by ${why}`);
  }
  const none = await call("admin_list_onboarding_calls", { p_view: "all", p_search: `nothing-${RUN}` });
  equal(none.data.total, 0, "no match");
});

statement("05.23", "The list returns a page of at most the size asked, 25 by default, 100 at most, with the total", async () => {
  const co = await makeCompany();
  await sql(`insert into public.onboarding_call_bookings (tenant_id, name, email, starts_at, ends_at, status)
             select '${co.id}', 'Eval', 'eval+${RUN}-page@example.com', t, t + interval '30 minutes', 'completed'
               from generate_series(now() - interval '120 days', now() - interval '1 day', interval '1 day') t`);
  const p = async (args) => (await list({ p_view: "all", p_search: `eval+${RUN}-page`, ...args }));
  const first = await p({});
  equal([first.total, first.rows.length], [120, 25], "the default page");
  equal((await p({ p_limit: 1000 })).rows.length, 100, "at most 100");
  equal((await p({ p_limit: 25, p_offset: 100 })).rows.length, 20, "the last page");
  const pages = [];
  for (let o = 0; o < 120; o += 25) pages.push(...ids((await p({ p_offset: o })).rows));
  equal(new Set(pages).size, 120, "every booking once across the pages");
});

statement("05.24", "Each row carries the company, the person, the times, both zones, the state and who cancelled", async () => {
  const w = await listWorld();
  const rows = (await list({ p_view: "all" })).rows;
  const waiting = rows.find((r) => r.id === w.w1);
  const [t] = await sql(`select company_name, slug from public.tenants where id = '${w.c.id}'`);
  const [s] = await sql(`select timezone from public.onboarding_call_settings`);
  equal([waiting.company_name, waiting.slug, waiting.name, waiting.host_timezone, waiting.customer_timezone, waiting.state, waiting.status],
        [t.company_name, t.slug, "Eval", s.timezone, "Asia/Karachi", "waiting", "booked"], "a waiting call");
  ok(waiting.starts_at && waiting.ends_at, "its times");
  const c = rows.find((r) => r.id === w.cancelled);
  equal([c.state, c.cancelled_by], ["cancelled", "admin"], "a cancelled call");
  equal(rows.find((r) => r.id === w.u1).state, "booked", "an upcoming call");
});

statement("05.25", "The details carry the row plus email, phone, note, Bryan's note, the call link and the history in order", async () => {
  const co = await makeCompany();
  const list2 = await freeSlots(co.owner.token);
  const r = await book(co.owner.token, list2.at(-12), { p_email: "eval+detail@example.com", p_phone: "+1 555", p_notes: "Two vans" });
  await book(co.owner.token, list2.at(-13), { p_email: "eval+detail@example.com", p_phone: "+1 555", p_notes: "Two vans" });
  await call("admin_note_onboarding_call", { p_id: r.data.id, p_admin_notes: "Call back" });
  await call("admin_cancel_onboarding_call", { p_id: r.data.id, p_reason: "Eval" });
  const d = (await call("admin_onboarding_call_detail", { p_id: r.data.id })).data;
  const [s] = await sql(`select meeting_url from public.onboarding_call_settings`);
  equal([d.email, d.phone, d.notes, d.admin_notes, d.meeting_url, d.state, d.cancel_reason], ["eval+detail@example.com", "+1 555", "Two vans", "Call back", s.meeting_url, "cancelled", "Eval"], "details");
  equal(d.history.map((h) => [h.kind, h.actor]), [["booked", "operator"], ["moved", "operator"], ["cancelled", "admin"]], "history in order");
  ok(d.history[0].actor_name === "Eval Owner", "the history names who did it");
});

await run(import.meta.url);
