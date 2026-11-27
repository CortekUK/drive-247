// Proves spec 04 (what a company can do: read, book, move, cancel) against staging.
import { statement, run, sql, cleanup, equal, ok } from "../../eval-kit.mjs";
import { admin, book, freeSlots, keepSettings, makeCompany, makeUser, northwind, rpc } from "./lib/fixtures.mjs";

const iso = (t) => new Date(t).toISOString();
const minutesFromNow = (m) => new Date(Date.now() + m * 60_000).toISOString();
const details = { p_name: "Eval Person", p_timezone: "Asia/Karachi" };
const card = async (token) => (await rpc("get_my_onboarding_call", {}, token)).data;
const live = async (tenant) => sql(`select * from public.onboarding_call_bookings where tenant_id = '${tenant}' and status = 'booked'`);
const emails = async (booking) => (await sql(`select kind, recipient, payload from public.onboarding_call_emails where booking_id = '${booking}' order by created_at, kind`));
const history = async (booking) => sql(`select kind, actor, from_starts_at, to_starts_at, reason from public.onboarding_call_history where booking_id = '${booking}' order by created_at`);

/** A live booking put straight in the table, at any time (in the past too). */
async function placeBooking(tenant, startsAt) {
  const [b] = await sql(`insert into public.onboarding_call_bookings (tenant_id, name, email, starts_at, ends_at, customer_timezone)
                         values ('${tenant}', 'Eval', 'eval+placed@example.com', '${startsAt}', '${startsAt}'::timestamptz + interval '30 minutes', 'Asia/Karachi') returning id`);
  return b.id;
}

let slots;
const free = async (token) => (slots ??= await freeSlots(token));

statement("04.1", "An owner is a head admin or an admin of the company", async () => {
  const co = await makeCompany();
  const [at, at2] = (await free(co.owner.token)).slice(-2);
  const r = await book(co.owner.token, at);
  ok(!r.error, `head admin: ${JSON.stringify(r.error)}`);
  const adm = await makeUser({ tenantId: co.id, role: "admin", name: "Eval Admin" });
  const r2 = await book(adm.token, at2);
  ok(!r2.error, `admin: ${JSON.stringify(r2.error)}`);
  equal(r2.data.moved, true, "the admin moved the company's call");
  for (const role of ["manager", "viewer"]) {
    const u = await makeUser({ tenantId: co.id, role, name: `Eval ${role}` });
    const x = await book(u.token, at);
    equal(x.error?.message, "Only the account owner can book the onboarding call", role);
  }
  await sql(`update public.app_users set is_active = false where auth_user_id = '${adm.authId}'`);
  const x = await book(adm.token, at);
  equal(x.error?.message, "Only the account owner can book the onboarding call", "an admin who is switched off");
});

statement("04.2", "A company is offered the call on v2 in its first 30 days or trialing, or when it is Northwind", async () => {
  const offered = async (id) => (await sql(`select public.onboarding_call_on_offer('${id}') as o`))[0].o;
  const young = await makeCompany({ createdDaysAgo: 29 });
  equal(await offered(young.id), true, "v2, 29 days old");
  const old = await makeCompany({ createdDaysAgo: 31 });
  equal(await offered(old.id), false, "v2, 31 days old, no trial");
  await sql(`insert into public.tenant_subscriptions (tenant_id, stripe_subscription_id, stripe_customer_id, status, amount)
             values ('${old.id}', 'sub_eval_${old.id.slice(0, 8)}', 'cus_eval', 'trialing', 0)`);
  cleanup(() => sql(`delete from public.tenant_subscriptions where tenant_id = '${old.id}'`));
  equal(await offered(old.id), true, "v2, 31 days old, trialing");
  await sql(`update public.tenants set portal_experience = 'v1' where id = '${young.id}'`);
  equal(await offered(young.id), false, "not on v2");
  const nw = await northwind();
  equal(await offered(nw.id), true, "Northwind");
});

statement("04.3", "A company holding a live booking keeps the call on offer after its 30 days", async () => {
  const co = await makeCompany({ createdDaysAgo: 40 });
  equal((await card(co.owner.token)).call_state, "none", "40 days old with nothing booked");
  await placeBooking(co.id, minutesFromNow(60 * 24 * 3));
  const c = await card(co.owner.token);
  equal([c.eligible, c.call_state], [true, "booked"], "with a booking");
});

statement("04.4", "A login with no company is refused by book and cancel", async () => {
  const token = await admin();
  const r = await book(token, (await free((await makeCompany()).owner.token))[0]);
  equal(r.error?.message, "There is no company on this login to book for", "book");
  const c = await rpc("cancel_my_onboarding_call", {}, token);
  equal(c.error?.message, "There is no company on this login to book for", "cancel");
});

statement("04.5", "A company not offered the call is refused", async () => {
  const co = await makeCompany({ createdDaysAgo: 45 });
  const r = await book(co.owner.token, (await free(co.owner.token))[0]);
  equal(r.error?.message, "The onboarding call is not available for this account", "book");
  equal((await live(co.id)).length, 0, "nothing saved");
});

statement("04.6", "A team member who is not an owner is refused by book and cancel, on the server", async () => {
  const co = await makeCompany();
  const at = (await free(co.owner.token))[0];
  const r = await book(co.member.token, at);
  equal(r.error?.message, "Only the account owner can book the onboarding call", "book");
  equal((await live(co.id)).length, 0, "nothing saved");
  ok(!(await book(co.owner.token, at)).error, "the owner books");
  const c = await rpc("cancel_my_onboarding_call", {}, co.member.token);
  equal(c.error?.message, "Only the account owner can book the onboarding call", "cancel");
  equal((await live(co.id)).length, 1, "the call is still booked");
});

statement("04.7", "The calendar returns Bryan's details, the free times as instants, and the company's own booking", async () => {
  const co = await makeCompany();
  const r = await rpc("get_onboarding_call_calendar", {}, co.owner.token);
  const [s] = await sql(`select host_name, host_title, host_photo_url, duration_minutes, timezone, is_accepting from public.onboarding_call_settings`);
  for (const k of Object.keys(s)) equal(r.data[k], s[k], k);
  ok(Array.isArray(r.data.slots) && r.data.slots.length > 0, "free times");
  ok(r.data.slots.every((x) => !Number.isNaN(Date.parse(x)) && /(Z|[+-]00:00)$/.test(x)), "each is an instant in UTC");
  equal(r.data.mine, null, "nothing booked yet");
  const b = await book(co.owner.token, r.data.slots[0]);
  const after = (await rpc("get_onboarding_call_calendar", {}, co.owner.token)).data;
  equal([after.mine.id, iso(after.mine.starts_at), after.mine.waiting], [b.data.id, iso(r.data.slots[0]), false], "its own booking");
  ok(after.slots.map(iso).includes(iso(r.data.slots[0])), "its own time stays listed, so it can stay put when moving");
});

statement("04.8", "The calendar never shows another company's booking", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const at = (await free(a.owner.token)).at(-3);
  const r = await book(a.owner.token, at, { p_name: "Secret Person", p_email: "eval+secret@example.com", p_phone: "+44 7000 000000", p_notes: "Secret note" });
  ok(!r.error, JSON.stringify(r.error));
  const cal = (await rpc("get_onboarding_call_calendar", {}, b.owner.token)).data;
  const text = JSON.stringify(cal);
  for (const s of ["Secret Person", "eval+secret@example.com", "+44 7000 000000", "Secret note", r.data.id]) ok(!text.includes(s), `does not carry ${s}`);
  equal(cal.mine, null, "no booking of its own");
  ok(!cal.slots.map(iso).includes(iso(at)), "the time is simply not free");
});

statement("04.9", "The call link is returned only once the company holds a live booking", async () => {
  await keepSettings();
  await sql(`update public.onboarding_call_settings set meeting_url = 'https://meet.example.com/eval' where id`);
  const co = await makeCompany();
  equal((await rpc("get_onboarding_call_calendar", {}, co.owner.token)).data.meeting_url, null, "before booking");
  const r = await book(co.owner.token, (await free(co.owner.token)).at(-4));
  equal(r.data.meeting_url, "https://meet.example.com/eval", "in the booking's answer");
  equal((await rpc("get_onboarding_call_calendar", {}, co.owner.token)).data.meeting_url, "https://meet.example.com/eval", "after booking");
});

statement("04.10", "A good booking is saved trimmed, the email lower-cased, empty phone and note as none", async () => {
  const co = await makeCompany();
  const before = Date.now();
  const r = await rpc("book_onboarding_call", { p_starts_at: (await free(co.owner.token)).at(-5), p_name: "  Ayesha Khan  ", p_email: "  Eval+Upper@Example.COM ", p_phone: "   ", p_notes: "  ", p_timezone: "Asia/Karachi" }, co.owner.token);
  ok(!r.error, JSON.stringify(r.error));
  const [b] = await sql(`select * from public.onboarding_call_bookings where id = '${r.data.id}'`);
  equal([b.name, b.email, b.phone, b.notes, b.customer_timezone, b.booked_via], ["Ayesha Khan", "eval+upper@example.com", null, null, "Asia/Karachi", "portal"], "saved");
  ok(new Date(b.rescheduled_at).getTime() >= before - 60_000, "rescheduled_at is now");
  const r2 = await rpc("book_onboarding_call", { p_starts_at: (await free(co.owner.token)).at(-5), p_name: "Ayesha", p_email: "eval@example.com", p_phone: " +92 300 ", p_notes: " Two vans ", p_timezone: "Asia/Karachi" }, co.owner.token);
  ok(!r2.error, JSON.stringify(r2.error));
  const [b2] = await sql(`select phone, notes from public.onboarding_call_bookings where id = '${r.data.id}'`);
  equal([b2.phone, b2.notes], ["+92 300", "Two vans"], "phone and note trimmed");
});

statement("04.11", "Details at their limits are accepted; anything past them is refused with Please check your details", async () => {
  const co = await makeCompany();
  const at = (await free(co.owner.token)).at(-6);
  const email254 = `eval+${"a".repeat(254 - "eval+@example.com".length)}@example.com`;
  equal(email254.length, 254, "a 254 character email");
  const okr = await rpc("book_onboarding_call", { p_starts_at: at, p_name: "n".repeat(120), p_email: email254, p_phone: "1".repeat(40), p_notes: "x".repeat(1000), p_timezone: "UTC" }, co.owner.token);
  ok(!okr.error, `at the limits: ${JSON.stringify(okr.error)}`);
  for (const [why, args] of [
    ["an empty name", { p_name: "   " }],
    ["a 121 character name", { p_name: "n".repeat(121) }],
    ["an email with no @", { p_email: "eval.example.com" }],
    ["an email starting with @", { p_email: "@example.com" }],
    ["a 255 character email", { p_email: `a${email254}` }],
    ["a 41 character phone", { p_phone: "1".repeat(41) }],
    ["a 1001 character note", { p_notes: "x".repeat(1001) }],
  ]) {
    const r = await rpc("book_onboarding_call", { p_starts_at: at, p_name: "Eval", p_email: "eval@example.com", p_timezone: "UTC", ...args }, co.owner.token);
    equal(r.error?.message, "Please check your details", why);
  }
});

statement("04.12", "Every rule of spec 02 is applied to a company, with notice", async () => {
  const co = await makeCompany();
  for (const [why, at, code] of [
    ["2 hours ahead", minutesFromNow(120), "too_soon"],
    ["40 days ahead", minutesFromNow(60 * 24 * 40), "too_far"],
    ["in the past", minutesFromNow(-60), "past"],
    ["off the grid", new Date(new Date((await free(co.owner.token))[0]).getTime() + 7 * 60_000).toISOString(), "off_grid"],
  ]) {
    const r = await book(co.owner.token, at);
    equal(r.error?.details, code, why);
  }
  equal((await live(co.id)).length, 0, "nothing saved");
});

statement("04.13", "A booking writes a booked history row by operator and queues booked_company and booked_host", async () => {
  const co = await makeCompany();
  const r = await book(co.owner.token, (await free(co.owner.token)).at(-7), { p_email: "eval+who@example.com" });
  const h = await history(r.data.id);
  equal(h.map((x) => [x.kind, x.actor]), [["booked", "operator"]], "history");
  const [s] = await sql(`select coalesce(host_email, '') as e from public.onboarding_call_settings`);
  const e = await emails(r.data.id);
  equal(e.map((x) => [x.kind, x.recipient]).sort(), [["booked_company", "eval+who@example.com"], ["booked_host", s.e]], "queued");
});

statement("04.14", "Booking sets the company's call state: booked, scheduled for the time, cancelled and missed cleared", async () => {
  const co = await makeCompany();
  await sql(`insert into public.tenant_onboarding_calls (tenant_id, call_cancelled_at, call_missed_at) values ('${co.id}', now(), now())`);
  const at = (await free(co.owner.token)).at(-8);
  ok(!(await book(co.owner.token, at)).error, "booked");
  const [j] = await sql(`select * from public.tenant_onboarding_calls where tenant_id = '${co.id}'`);
  ok(j.call_booked_at, "booked at");
  equal([iso(j.call_scheduled_for), j.call_cancelled_at, j.call_missed_at], [iso(at), null, null], "the journey row");
});

statement("04.15", "Booking again moves the call: the same row, new times, sequence up by one, the old time free", async () => {
  const co = await makeCompany();
  const list = await free(co.owner.token);
  const [from, to] = [list.at(-9), list.at(-10)];
  const r = await book(co.owner.token, from);
  const [b0] = await sql(`select sequence, rescheduled_at from public.onboarding_call_bookings where id = '${r.data.id}'`);
  const m = await book(co.owner.token, to);
  ok(!m.error, JSON.stringify(m.error));
  equal([m.data.id, m.data.moved], [r.data.id, true], "the same booking, moved");
  const [b] = await sql(`select starts_at, ends_at, sequence, rescheduled_at from public.onboarding_call_bookings where id = '${r.data.id}'`);
  equal([iso(b.starts_at), new Date(b.ends_at) - new Date(b.starts_at), b.sequence], [iso(to), 30 * 60_000, b0.sequence + 1], "the row");
  ok(new Date(b.rescheduled_at) >= new Date(b0.rescheduled_at), "rescheduled_at moved on");
  const other = await makeCompany();
  ok((await freeSlots(other.owner.token)).map(iso).includes(iso(from)), "the old time is free for others");
});

statement("04.16", "A move needs 12 hours' notice for the new time, and can be made up to the moment the call starts", async () => {
  const co = await makeCompany();
  await placeBooking(co.id, minutesFromNow(60)); // starts in an hour
  const soon = await book(co.owner.token, minutesFromNow(180));
  equal(soon.error?.details, "too_soon", "a new time 3 hours ahead");
  const m = await book(co.owner.token, (await free(co.owner.token)).at(-11));
  ok(!m.error, JSON.stringify(m.error));
  equal(m.data.moved, true, "moved an hour before the call");
});

statement("04.17", "A move writes a moved history row with both starts, and queues moved_company and moved_host", async () => {
  const co = await makeCompany();
  const list = await free(co.owner.token);
  const r = await book(co.owner.token, list.at(-12));
  await book(co.owner.token, list.at(-13));
  const h = await history(r.data.id);
  equal(h.map((x) => x.kind), ["booked", "moved"], "kinds");
  equal([iso(h[1].from_starts_at), iso(h[1].to_starts_at), h[1].actor], [iso(list.at(-12)), iso(list.at(-13)), "operator"], "the move");
  const moved = (await emails(r.data.id)).filter((e) => e.kind.startsWith("moved"));
  equal(moved.map((e) => e.kind).sort(), ["moved_company", "moved_host"], "queued");
  ok(moved.every((e) => iso(e.payload.old_starts_at) === iso(list.at(-12))), "each carries the old time");
});

statement("04.18", "After a move the company still holds exactly one live booking", async () => {
  const co = await makeCompany();
  const list = await free(co.owner.token);
  await book(co.owner.token, list.at(-14));
  await book(co.owner.token, list.at(-15));
  await book(co.owner.token, list.at(-16));
  equal((await live(co.id)).length, 1, "live bookings");
  const [n] = await sql(`select count(*)::int as n from public.onboarding_call_bookings where tenant_id = '${co.id}'`);
  equal(n.n, 1, "rows");
});

statement("04.19", "A live booking whose start has passed is waiting, not booked", async () => {
  const co = await makeCompany();
  await placeBooking(co.id, minutesFromNow(-10));
  equal((await card(co.owner.token)).call_state, "waiting", "the card");
  equal((await rpc("get_onboarding_call_calendar", {}, co.owner.token)).data.mine.waiting, true, "the calendar");
});

statement("04.20", "Booking while waiting closes the old call as missed by system, with no email, and saves a new one", async () => {
  const co = await makeCompany();
  const old = await placeBooking(co.id, minutesFromNow(-10));
  const r = await book(co.owner.token, (await free(co.owner.token)).at(-17));
  ok(!r.error, JSON.stringify(r.error));
  ok(r.data.id !== old && r.data.moved === false, "a new booking");
  const [o] = await sql(`select status from public.onboarding_call_bookings where id = '${old}'`);
  equal(o.status, "missed", "the old call");
  equal((await history(old)).map((x) => [x.kind, x.actor]), [["missed", "system"]], "its history");
  equal((await emails(old)).length, 0, "no email for the old call");
  equal((await live(co.id)).map((b) => b.id), [r.data.id], "the one live booking");
});

statement("04.21", "A company cannot cancel a waiting call", async () => {
  const co = await makeCompany();
  const id = await placeBooking(co.id, minutesFromNow(-10));
  const r = await rpc("cancel_my_onboarding_call", {}, co.owner.token);
  equal(r.error?.message, "This call has already started.", "refused");
  const [b] = await sql(`select status from public.onboarding_call_bookings where id = '${id}'`);
  equal(b.status, "booked", "still waiting");
});

let cancelled;
async function cancelOne() {
  if (cancelled) return cancelled;
  const co = await makeCompany();
  const at = (await free(co.owner.token)).at(-18);
  const r = await book(co.owner.token, at);
  const [b0] = await sql(`select sequence from public.onboarding_call_bookings where id = '${r.data.id}'`);
  const c = await rpc("cancel_my_onboarding_call", { p_reason: "  Travelling  " }, co.owner.token);
  ok(!c.error, JSON.stringify(c.error));
  cancelled = { co, at, id: r.data.id, seq: b0.sequence };
  return cancelled;
}

statement("04.22", "Cancel takes a reason up to 500, sets cancelled by operator, raises the sequence and frees the time", async () => {
  const x = await cancelOne();
  const [b] = await sql(`select status, cancelled_by, cancel_reason, sequence, cancelled_at from public.onboarding_call_bookings where id = '${x.id}'`);
  equal([b.status, b.cancelled_by, b.cancel_reason, b.sequence], ["cancelled", "operator", "Travelling", x.seq + 1], "the row");
  ok(b.cancelled_at, "cancelled_at");
  ok((await freeSlots(x.co.owner.token)).map(iso).includes(iso(x.at)), "the time is free again");
  const co = await makeCompany();
  await book(co.owner.token, (await free(co.owner.token)).at(-19));
  const long = await rpc("cancel_my_onboarding_call", { p_reason: "x".repeat(501) }, co.owner.token);
  equal(long.error?.message, "Please keep the reason under 500 characters", "501 characters");
  equal((await live(co.id)).length, 1, "still booked");
  ok(!(await rpc("cancel_my_onboarding_call", { p_reason: "x".repeat(500) }, co.owner.token)).error, "500 characters");
  ok(!(await rpc("cancel_my_onboarding_call", { p_reason: null }, co.owner.token)).error, "no reason, nothing booked");
});

statement("04.23", "Cancel writes a cancelled history row and queues cancelled_company and cancelled_host", async () => {
  const x = await cancelOne();
  const h = await history(x.id);
  equal(h.map((r) => [r.kind, r.actor, r.reason]), [["booked", "operator", null], ["cancelled", "operator", "Travelling"]], "history");
  const c = (await emails(x.id)).filter((e) => e.kind.startsWith("cancelled"));
  equal(c.map((e) => e.kind).sort(), ["cancelled_company", "cancelled_host"], "queued");
  ok(c.every((e) => e.payload.reason === "Travelling" && e.payload.actor === "operator"), "with the reason and who");
});

statement("04.24", "After a cancel the card offers the call again", async () => {
  const x = await cancelOne();
  const c = await card(x.co.owner.token);
  equal([c.call_state, c.booking], ["offer", null], "the card");
});

statement("04.25", "Cancel with no live booking does nothing and returns no error", async () => {
  const co = await makeCompany();
  const r = await rpc("cancel_my_onboarding_call", {}, co.owner.token);
  equal([r.status, r.error], [204, null], "no error");
  const [n] = await sql(`select (select count(*) from public.onboarding_call_bookings where tenant_id = '${co.id}')::int as b,
                                (select count(*) from public.onboarding_call_history where tenant_id = '${co.id}')::int as h`);
  equal([n.b, n.h], [0, 0], "nothing written");
});

statement("04.26", "A cancelled call leaves the book your call emails stopped", async () => {
  const x = await cancelOne();
  const [j] = await sql(`select call_cancelled_at, call_booked_at from public.tenant_onboarding_calls where tenant_id = '${x.co.id}'`);
  ok(j.call_cancelled_at, "call_cancelled_at is set, which the journey reads (04-company-actions.test.ts)");
  equal(j.call_booked_at, null, "no longer booked");
});

statement("04.27", "The card's state is offer, booked, waiting or none", async () => {
  const co = await makeCompany();
  equal((await card(co.owner.token)).call_state, "offer", "fresh");
  const r = await book(co.owner.token, (await free(co.owner.token)).at(-20));
  equal((await card(co.owner.token)).call_state, "booked", "booked");
  await sql(`update public.onboarding_call_bookings set starts_at = now() - interval '5 minutes', ends_at = now() + interval '25 minutes' where id = '${r.data.id}'`);
  equal((await card(co.owner.token)).call_state, "waiting", "waiting");
  await sql(`update public.tenant_onboarding_calls set dismissed_at = now() where tenant_id = '${co.id}'`);
  equal((await card(co.owner.token)).call_state, "none", "hidden");
  const old = await makeCompany({ createdDaysAgo: 45 });
  equal((await card(old.owner.token)).call_state, "none", "not on offer");
  equal((await rpc("get_my_onboarding_call", {}, await admin())).data, null, "no company");
});

statement("04.28", "With booked or waiting the card returns the booking's id, start, end, zone and call link", async () => {
  await keepSettings();
  await sql(`update public.onboarding_call_settings set meeting_url = 'https://meet.example.com/eval' where id`);
  const co = await makeCompany();
  const r = await book(co.owner.token, (await free(co.owner.token)).at(-21), { p_timezone: "Europe/London" });
  const b = (await card(co.owner.token)).booking;
  equal([b.id, iso(b.starts_at), iso(b.ends_at), b.customer_timezone, b.meeting_url], [r.data.id, iso(r.data.starts_at), iso(r.data.ends_at), "Europe/London", "https://meet.example.com/eval"], "booking");
  ok(/^[0-9a-f-]{36}$/.test(b.ics_token), "and its invite token");
});

statement("04.29", "Marking done makes the card none for good", async () => {
  const co = await makeCompany();
  const id = await placeBooking(co.id, minutesFromNow(-40));
  const r = await rpc("admin_set_onboarding_call_booking", { p_id: id, p_status: "completed" }, await admin());
  ok(!r.error, JSON.stringify(r.error));
  equal((await card(co.owner.token)).call_state, "none", "after done");
  // The screen offers no way back, and even a booking made straight through the API leaves it done.
  await book(co.owner.token, (await free(co.owner.token)).at(-22));
  equal((await card(co.owner.token)).call_state, "none", "still none after another booking");
});

statement("04.30", "Marking missed makes the card offer again", async () => {
  const co = await makeCompany();
  const id = await placeBooking(co.id, minutesFromNow(-40));
  const r = await rpc("admin_set_onboarding_call_booking", { p_id: id, p_status: "missed" }, await admin());
  ok(!r.error, JSON.stringify(r.error));
  equal((await card(co.owner.token)).call_state, "offer", "after missed");
});

await run(import.meta.url);
