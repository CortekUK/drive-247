// Proves spec 02 (what makes a time free, and the list of free times) against staging.
// Every check passes Bryan's settings in full, so his real settings never change the answer.
import { statement, run, sql, cleanup, equal, ok } from "../../eval-kit.mjs";
import { admin, book, freeSlots, makeCompany, rpc, q } from "./lib/fixtures.mjs";

// Bryan's calendar today (the table at the top of spec 02).
const TODAY = {
  is_accepting: true,
  duration_minutes: 30,
  buffer_minutes: 0,
  timezone: "America/New_York",
  weekly_hours: { 1: [["09:00", "17:00"]], 2: [["09:00", "17:00"]], 3: [["09:00", "17:00"]], 4: [["09:00", "17:00"]], 5: [["09:00", "17:00"]] },
  blocked_dates: [],
  min_notice_hours: 12,
  max_days_ahead: 30,
};
const NOW = "2026-12-07T12:00:00Z"; // Monday 7 December 2026, 07:00 New York
const iso = (t) => new Date(t).toISOString();

let adminToken;
const token = async () => (adminToken ??= await admin());

/** The check, as the super admin calls it. */
async function check(at, overlay = {}, now = NOW, skipNotice = false) {
  const r = await rpc("check_onboarding_call_slot", { p_starts_at: at, p_settings: { ...TODAY, ...overlay }, p_now: now, p_skip_notice: skipNotice }, await token());
  if (r.error) throw new Error(`check: ${JSON.stringify(r.error)}`);
  return r.data;
}

/** The free times, as the super admin previews them. */
async function preview(overlay = {}, now = NOW) {
  const r = await rpc("preview_onboarding_call_slots", { p_settings: { ...TODAY, ...overlay }, p_now: now }, await token());
  if (r.error) throw new Error(`preview: ${JSON.stringify(r.error)}`);
  return r.data.slots.map(iso);
}

const onDay = (slots, day) => slots.filter((s) => s.startsWith(day));

// A company and a booked call far ahead, where no real booking can sit:
// Tuesday 8 June 2027, 10:00 to 10:30 New York (14:00 to 14:30 UTC).
let co, farBooking;
async function far() {
  if (farBooking) return farBooking;
  co = await makeCompany();
  const [b] = await sql(`insert into public.onboarding_call_bookings (tenant_id, name, email, starts_at, ends_at)
                         values ('${co.id}', 'Eval', 'eval+far@example.com', '2027-06-08T14:00:00Z', '2027-06-08T14:30:00Z') returning id`);
  cleanup(() => sql(`delete from public.onboarding_call_bookings where id = '${b.id}'`));
  farBooking = b.id;
  return farBooking;
}
const JUNE_NOW = "2027-06-01T12:00:00Z";

statement("02.1", "Taking calls switched off refuses every time as not_accepting, with its message", async () => {
  equal(await check("2026-12-08T14:00:00Z", { is_accepting: false }), "not_accepting", "Tue 09:00 NY");
  const [m] = await sql(`select public.onboarding_call_message('not_accepting') as m`);
  equal(m.m, "Bryan is not taking new calls right now", "message");
});

statement("02.2", "A time at or before now is past", async () => {
  equal(await check(NOW), "past", "exactly now");
  equal(await check("2026-12-07T11:30:00Z"), "past", "half an hour ago");
  const [m] = await sql(`select public.onboarding_call_message('past') as m`);
  equal(m.m, "That time has passed. Please pick another.", "message");
});

statement("02.3", "A time inside the notice is too_soon, and Bryan's own moves skip the notice", async () => {
  equal(await check("2026-12-07T18:00:00Z"), "too_soon", "Mon 18:00 UTC, 6 hours ahead");
  equal(await check("2026-12-07T18:00:00Z", {}, NOW, true), null, "the same time with the notice skipped");
  const [m] = await sql(`select public.onboarding_call_message('too_soon') as m`);
  equal(m.m, "That time is too soon. Please pick a later one.", "message");
});

statement("02.4", "A time past the days ahead is too_far", async () => {
  equal(await check("2027-01-08T14:00:00Z"), "too_far", "Fri 8 Jan 2027, 32 days ahead");
  const [m] = await sql(`select public.onboarding_call_message('too_far') as m`);
  equal(m.m, "That time is too far ahead. Please pick an earlier one.", "message");
});

statement("02.5", "A time on one of Bryan's days off is day_off", async () => {
  equal(await check("2026-12-08T14:00:00Z", { blocked_dates: ["2026-12-08"] }), "day_off", "Tue 8 Dec off");
  equal(await check("2026-12-09T14:00:00Z", { blocked_dates: ["2026-12-08"] }), null, "the next day is free");
  const [m] = await sql(`select public.onboarding_call_message('day_off') as m`);
  equal(m.m, "Bryan is not available then. Please pick another time.", "message");
});

statement("02.6", "A call that does not sit wholly inside a window, or runs past midnight, is outside_hours", async () => {
  equal(await check("2026-12-08T21:30:00Z"), null, "Tue 16:30 NY ends 17:00, inside");
  equal(await check("2026-12-08T22:00:00Z"), "outside_hours", "Tue 17:00 NY ends 17:30");
  equal(await check("2026-12-12T15:00:00Z"), "outside_hours", "Saturday");
  // A late window: 23:30 to 24:00 New York on Tuesday (Wed 04:30 UTC).
  const late = { weekly_hours: { 2: [["23:30", "24:00"]] } };
  equal(await check("2026-12-09T04:30:00Z", late), null, "a 30 minute call ending at midnight fits");
  equal(await check("2026-12-09T04:30:00Z", { ...late, duration_minutes: 60 }), "outside_hours", "an hour from 23:30 runs past midnight");
});

statement("02.7", "A time off the grid of window start plus call lengths is off_grid", async () => {
  equal(await check("2026-12-08T14:07:00Z"), "off_grid", "09:07 NY");
  equal(await check("2026-12-08T14:15:00Z"), "off_grid", "09:15 NY");
  equal(await check("2026-12-08T14:30:00Z"), null, "09:30 NY is on the grid");
});

statement("02.8", "A call that overlaps a blocked period is blocked", async () => {
  // Tuesday 8 June 2027, 11:00 to 12:00 New York (15:00 to 16:00 UTC).
  const [k] = await sql(`insert into public.onboarding_call_blocks (starts_at, ends_at, label) values ('2027-06-08T15:00:00Z', '2027-06-08T16:00:00Z', 'Eval block') returning id`);
  const unblock = () => sql(`delete from public.onboarding_call_blocks where id = '${k.id}'`);
  cleanup(unblock);
  equal(await check("2027-06-08T15:00:00Z", {}, JUNE_NOW), "blocked", "11:00 NY");
  equal(await check("2027-06-08T15:30:00Z", {}, JUNE_NOW), "blocked", "11:30 NY");
  equal(await check("2027-06-08T14:30:00Z", {}, JUNE_NOW), null, "10:30 NY ends as the block starts");
  equal(await check("2027-06-08T16:00:00Z", {}, JUNE_NOW), null, "12:00 NY starts as the block ends");
  await unblock();
  equal(await check("2027-06-08T15:00:00Z", {}, JUNE_NOW), null, "11:00 NY once the block is removed");
});

statement("02.9", "A call that overlaps another live booking is taken, with its message", async () => {
  await far();
  equal(await check("2027-06-08T14:00:00Z", {}, JUNE_NOW), "taken", "the booked 10:00");
  await sql(`update public.onboarding_call_bookings set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now() where id = '${farBooking}'`);
  equal(await check("2027-06-08T14:00:00Z", {}, JUNE_NOW), null, "free again once it is cancelled");
  await sql(`update public.onboarding_call_bookings set status = 'booked', cancelled_by = null, cancelled_at = null where id = '${farBooking}'`);
  const [m] = await sql(`select public.onboarding_call_message('taken') as m`);
  equal(m.m, "Someone has just taken that time. Please pick another.", "message");
});

statement("02.10", "With a 15 minute gap and a call at 10:00 to 10:30, 09:30 and 10:30 are taken; 09:00 and 11:00 are free", async () => {
  await far();
  const gap = { buffer_minutes: 15 };
  equal(await check("2027-06-08T13:30:00Z", gap, JUNE_NOW), "taken", "09:30 NY");
  equal(await check("2027-06-08T14:30:00Z", gap, JUNE_NOW), "taken", "10:30 NY");
  equal(await check("2027-06-08T13:00:00Z", gap, JUNE_NOW), null, "09:00 NY");
  equal(await check("2027-06-08T15:00:00Z", gap, JUNE_NOW), null, "11:00 NY");
});

statement("02.11", "A booking being moved does not count as taken against itself", async () => {
  await far();
  const s = `public.onboarding_call_settings_row(${q(JSON.stringify({ ...TODAY, buffer_minutes: 15 }))}::jsonb)`;
  const [r] = await sql(`select public.onboarding_call_slot_problem(${s}, '2027-06-08T14:30:00Z', '${JUNE_NOW}', false, null) as other,
                                public.onboarding_call_slot_problem(${s}, '2027-06-08T14:30:00Z', '${JUNE_NOW}', false, '${farBooking}') as itself`);
  equal(r.other, "taken", "for anyone else");
  equal(r.itself, null, "for the booking itself");
});

statement("02.12", "A refusal reaches the caller as the message, with the code in the error's details", async () => {
  const c = await makeCompany();
  const slots = await freeSlots(c.owner.token);
  ok(slots.length > 0, "staging offers free times");
  const offGrid = new Date(new Date(slots[0]).getTime() + 7 * 60_000).toISOString();
  const r = await book(c.owner.token, offGrid);
  ok(r.error, "refused");
  equal(r.error.message, "Bryan is not available then. Please pick another time.", "message");
  equal(r.error.details, "off_grid", "details");
  const past = await book(c.owner.token, "2020-01-06T14:00:00Z");
  equal([past.error?.message, past.error?.details], ["That time has passed. Please pick another.", "past"], "a past time");
});

let dec;
const decSlots = async () => (dec ??= await preview());

statement("02.13", "The free times are every grid start with no problem, from today to the last day ahead, earliest first", async () => {
  const slots = await decSlots();
  equal(slots[0], "2026-12-08T14:00:00.000Z", "first: Tue 8 Dec 09:00 NY (Monday is all too soon)");
  equal(slots[slots.length - 1], "2027-01-05T21:30:00.000Z", "last: Tue 5 Jan 16:30 NY (Wed 6 Jan ends the 30 days at 07:00)");
  equal([...slots].sort().join(), slots.join(), "earliest first");
  // 21 weekdays (Tue 8 Dec to Tue 5 Jan) x 16 times.
  equal(slots.length, 336, "how many");
});

statement("02.14", "Every listed time passes the check, and every time the check accepts is listed", async () => {
  const s = `public.onboarding_call_settings_row(${q(JSON.stringify(TODAY))}::jsonb)`;
  // Every minute of the 31 days, checked one by one.
  const [r] = await sql(`
    with listed as (select x from public.onboarding_call_free_slots(${s}, '${NOW}') x),
         minutes as (select m from generate_series('${NOW}'::timestamptz, '${NOW}'::timestamptz + interval '31 days', interval '1 minute') m),
         accepted as (select m from minutes where public.onboarding_call_slot_problem(${s}, m, '${NOW}') is null)
    select (select count(*) from listed)::int as listed,
           (select count(*) from accepted)::int as accepted,
           (select count(*) from listed where public.onboarding_call_slot_problem(${s}, x, '${NOW}') is not null)::int as listed_refused,
           (select count(*) from accepted where m not in (select x from listed))::int as accepted_unlisted`);
  equal(r.listed_refused, 0, "listed times the check refuses");
  equal(r.accepted_unlisted, 0, "accepted times not listed");
  equal(r.accepted, r.listed, "the same count");
  equal(r.listed, (await decSlots()).length, "the preview gives the same list");
  // The company's own list comes from the same calculator (no second one in the browser).
  const c = await makeCompany();
  const [mine] = await sql(`select coalesce(json_agg(x order by x), '[]') as l from public.onboarding_call_free_slots(public.onboarding_call_settings_row(), now()) x`);
  const theirs = await freeSlots(c.owner.token);
  equal(theirs.map(iso).slice(0, 20), mine.l.map(iso).slice(0, 20), "the company's calendar is the server's list");
});

statement("02.15", "A weekday with today's settings offers 16 times, 09:00 to 16:30 New York", async () => {
  const tue = onDay(await decSlots(), "2026-12-08");
  const want = Array.from({ length: 16 }, (_, i) => new Date(Date.UTC(2026, 11, 8, 14, 0) + i * 30 * 60_000).toISOString());
  equal(tue, want, "Tue 8 Dec");
});

statement("02.16", "A 45 minute call offers 09:00, 09:45 ... 15:45 (10 times), and a booked 30 minute call keeps its own end", async () => {
  const tue = onDay(await preview({ duration_minutes: 45 }), "2026-12-08");
  const want = Array.from({ length: 10 }, (_, i) => new Date(Date.UTC(2026, 11, 8, 14, 0) + i * 45 * 60_000).toISOString());
  equal(tue, want, "Tue 8 Dec at 45 minutes");
  // June 2027: grid 09:00, 09:45, 10:30 NY = 13:00, 13:45, 14:30 UTC. The booking is 14:00 to 14:30.
  await far();
  const june = onDay(await preview({ duration_minutes: 45 }, JUNE_NOW), "2027-06-08");
  ok(!june.includes("2027-06-08T13:45:00.000Z"), "09:45 overlaps the booked call");
  ok(june.includes("2027-06-08T14:30:00.000Z"), "10:30 is free, because the booked call still ends at 10:30");
  const [b] = await sql(`select ends_at from public.onboarding_call_bookings where id = '${farBooking}'`);
  equal(iso(b.ends_at), "2027-06-08T14:30:00.000Z", "the booked call's end");
});

const SUNDAY_NIGHT = { weekly_hours: { 0: [["01:00", "04:00"]] } };

statement("02.17", "A local time that does not exist (02:xx on 14 March 2027 New York) is never offered", async () => {
  const sun = onDay(await preview(SUNDAY_NIGHT, "2027-03-01T00:00:00Z"), "2027-03-14");
  equal(sun, ["2027-03-14T06:00:00.000Z", "2027-03-14T06:30:00.000Z", "2027-03-14T07:00:00.000Z", "2027-03-14T07:30:00.000Z"], "01:00, 01:30 EST, 03:00, 03:30 EDT");
  equal(await check("2027-03-14T06:30:00Z", SUNDAY_NIGHT, "2027-03-01T00:00:00Z"), null, "01:30 EST is free");
  equal(await check("2027-03-14T07:00:00Z", SUNDAY_NIGHT, "2027-03-01T00:00:00Z"), null, "03:00 EDT is free");
  const [h] = await sql(`select count(*)::int as n from jsonb_array_elements_text(${q(JSON.stringify(sun))}::jsonb) x
                         where extract(hour from (x::timestamptz at time zone 'America/New_York')) = 2`);
  equal(h.n, 0, "no offered time reads as 02:xx");
});

statement("02.18", "A local time that happens twice (01:xx on 7 November 2027) is offered once, at its second occurrence", async () => {
  const now = "2027-11-01T00:00:00Z";
  const sun = onDay(await preview(SUNDAY_NIGHT, now), "2027-11-07");
  // 01:00 EST = 06:00 UTC; the first 01:00 (EDT, 05:00 UTC) is not offered.
  equal(sun, ["2027-11-07T06:00:00.000Z", "2027-11-07T06:30:00.000Z", "2027-11-07T07:00:00.000Z", "2027-11-07T07:30:00.000Z", "2027-11-07T08:00:00.000Z", "2027-11-07T08:30:00.000Z"], "offered");
  equal(await check("2027-11-07T05:00:00Z", SUNDAY_NIGHT, now), "off_grid", "the first 01:00");
  equal(await check("2027-11-07T05:30:00Z", SUNDAY_NIGHT, now), "off_grid", "the first 01:30");
  equal(await check("2027-11-07T06:00:00Z", SUNDAY_NIGHT, now), null, "the second 01:00");
});

statement("02.19", "The calculator takes now as an input, so a check can stand on any date", async () => {
  equal(await check("2026-12-08T14:00:00Z", {}, NOW), null, "free on 7 December");
  equal(await check("2026-12-08T14:00:00Z", {}, "2026-12-08T13:00:00Z"), "too_soon", "too soon an hour before");
  equal(await check("2026-12-08T14:00:00Z", {}, "2026-12-09T00:00:00Z"), "past", "past the next day");
  equal(await check("2026-12-08T14:00:00Z", {}, "2026-11-01T00:00:00Z"), "too_far", "too far from 1 November");
  // Only the super admin can preview or check.
  const c = await makeCompany();
  const r = await rpc("check_onboarding_call_slot", { p_starts_at: "2026-12-08T14:00:00Z" }, c.owner.token);
  equal([r.status, r.error?.message], [403, "Super admin access required"], "a company owner");
});

statement("02.20", "Two companies booking the same time at the same moment: one is saved, the other gets taken", async () => {
  const a = await makeCompany();
  const b = await makeCompany();
  const [at] = (await freeSlots(a.owner.token)).slice(-1);
  const [ra, rb] = await Promise.all([book(a.owner.token, at), book(b.owner.token, at)]);
  const won = [ra, rb].filter((r) => !r.error);
  const lost = [ra, rb].filter((r) => r.error);
  equal(won.length, 1, "saved");
  equal(lost.map((r) => r.error.details), ["taken"], "the other");
  const [n] = await sql(`select count(*)::int as n from public.onboarding_call_bookings where status = 'booked' and starts_at = '${at}'`);
  equal(n.n, 1, "live bookings at that time");
});

await run(import.meta.url);
