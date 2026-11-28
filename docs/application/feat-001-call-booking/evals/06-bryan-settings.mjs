// Proves spec 06 (Bryan's settings, blocked times and the clash check) against staging.
// Staging's settings and blocked times are put back after every check.
import { statement, run, sql, rest, equal, ok } from "../../eval-kit.mjs";
import { admin, freeSlots, keepSettings, makeCompany, rpc, book } from "./lib/fixtures.mjs";

const iso = (t) => new Date(t).toISOString();
let adminToken;
const A = async () => (adminToken ??= await admin());
const save = async (args, as) => rpc("admin_save_onboarding_call_settings", args, as ?? (await A()));
const settings = async () => (await sql(`select * from public.onboarding_call_settings`))[0];
const blocks = async () => sql(`select starts_at, ends_at, label from public.onboarding_call_blocks order by starts_at`);
const row = async (id) => (await sql(`select * from public.onboarding_call_bookings where id = '${id}'`))[0];

// Calls a check booked, removed when that check ends so the next one finds the times free.
const made = [];

/** Runs a check with staging's settings put back, and its calls removed, straight after it. */
const withSettings = (check) => async () => {
  const restore = await keepSettings();
  try { await check(); } finally {
    await restore();
    if (made.length) await sql(`delete from public.onboarding_call_bookings where id in (${made.splice(0).map((id) => `'${id}'`).join(", ")})`);
  }
};
const sorted = (o) => Object.fromEntries(Object.entries(o).sort());

/** A New York wall time on a date, as an instant. */
async function ny(date, hhmm) {
  const [r] = await sql(`select ('${date} ${hhmm}'::timestamp at time zone 'America/New_York') as t`);
  return iso(r.t);
}

/** A weekday ahead with all 16 times free, and a company. */
let day;
async function freeDay() {
  if (day) return day;
  const co = await makeCompany();
  const slots = (await freeSlots(co.owner.token)).map(iso);
  const byDay = {};
  for (const s of slots) {
    const d = new Date(s).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    (byDay[d] ??= []).push(s);
  }
  const d = Object.keys(byDay).filter((k) => byDay[k].length === 16)[3];
  ok(d, "a free weekday ahead");
  day = { date: d, co };
  return day;
}

/** A live booking for a new company, at a New York time on the free day. */
async function bookAt(hhmm) {
  const { date } = await freeDay();
  const co = await makeCompany();
  const r = await book(co.owner.token, await ny(date, hhmm));
  ok(!r.error, `book ${hhmm}: ${JSON.stringify(r.error)}`);
  made.push(r.data.id);
  return { co, id: r.data.id };
}

const weekdays = (from, to) => Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, [[from, to]]]));
const dow = (date) => String(new Date(`${date}T12:00:00Z`).getUTCDay());

statement("06.1", "Settings change only through the save function; a direct update is refused", withSettings(async () => {
  const before = await settings();
  for (const [who, token] of [["super admin", await A()], ["company owner", (await freeDay()).co.owner.token]]) {
    const r = await rest(`onboarding_call_settings?id=eq.true`, { method: "PATCH", as: token, body: { host_name: "Hacked" } });
    ok(r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0), `${who}: ${r.status}`);
  }
  equal((await settings()).host_name, before.host_name, "unchanged");
  const r = await save({ p_settings: { host_title: "Eval title" } });
  equal([r.error, r.data?.saved], [null, true], "the save function");
  equal((await settings()).host_title, "Eval title", "saved");
}));

statement("06.2", "Only a super admin can save", withSettings(async () => {
  const co = (await freeDay()).co;
  for (const [who, token] of [["owner", co.owner.token], ["team member", co.member.token], ["visitor", "anon"]]) {
    const r = await save({ p_settings: { host_title: "Nope" } }, token);
    ok(r.error, `${who} refused`);
    if (token !== "anon") equal(r.error.message, "Super admin access required", who);
  }
  ok((await settings()).host_title !== "Nope", "unchanged");
}));

statement("06.3", "The save takes every setting and the full list of blocked times", withSettings(async () => {
  const want = {
    host_name: "Eval Host", host_title: "Eval Title", host_email: "eval+host@example.com", host_photo_url: "https://example.com/p.png",
    meeting_url: "https://meet.example.com/x", duration_minutes: 45, buffer_minutes: 10, timezone: "America/Chicago",
    weekly_hours: { 1: [["08:00", "12:00"], ["13:00", "18:00"]] }, blocked_dates: ["2027-07-05"],
    min_notice_hours: 24, max_days_ahead: 60, is_accepting: false,
  };
  let r = await save({ p_settings: want, p_blocks: [{ date: "2027-07-06", from: "09:00", to: "10:00", label: "Dentist" }] });
  if (r.data && !r.data.saved) {
    // Calls on staging that the new hours no longer fit: keep them.
    r = await save({ p_settings: want, p_blocks: [{ date: "2027-07-06", from: "09:00", to: "10:00", label: "Dentist" }],
                     p_decisions: Object.fromEntries(r.data.clashes.map((c) => [c.id, "keep"])) });
  }
  equal([r.error, r.data?.saved], [null, true], "saved");
  const s = await settings();
  for (const [k, v] of Object.entries(want)) equal(s[k], v, k);
  equal((await blocks()).map((b) => b.label), ["Dentist"], "blocked times");
}));

statement("06.4", "A blocked time is sent as a date and times in Bryan's zone and stored as two instants", withSettings(async () => {
  const r = await save({ p_blocks: [{ date: "2026-12-03", from: "14:00", to: "16:00", label: "Thursday" }] });
  equal(r.data?.saved, true, "saved");
  const [b] = await blocks();
  equal([iso(b.starts_at), iso(b.ends_at), b.label], ["2026-12-03T19:00:00.000Z", "2026-12-03T21:00:00.000Z", "Thursday"], "New York 14:00 to 16:00 = 19:00 to 21:00 UTC");
  ok(!(await save({ p_blocks: [{ date: "2026-12-03", from: "22:00", to: "24:00" }] })).error, "a block to midnight");
  const [m] = await blocks();
  equal(iso(m.ends_at), "2026-12-04T05:00:00.000Z", "24:00 is the next midnight");
  ok(!(await save({ p_blocks: [] })).error, "an empty list");
  equal((await blocks()).length, 0, "clears them");
}));

statement("06.5", "A blocked time that does not end after it starts is refused", withSettings(async () => {
  await save({ p_blocks: [{ date: "2027-07-06", from: "09:00", to: "10:00", label: "Keep me" }] });
  for (const [from, to] of [["10:00", "09:00"], ["10:00", "10:00"]]) {
    const r = await save({ p_blocks: [{ date: "2027-07-07", from, to }] });
    equal(r.error?.message, "A blocked time must end after it starts", `${from} to ${to}`);
  }
  equal((await blocks()).map((b) => b.label), ["Keep me"], "the list is unchanged");
}));

statement("06.6", "A bad zone, window or number is refused and nothing is saved", withSettings(async () => {
  const before = await settings();
  for (const [why, bad] of [
    ["zone", { timezone: "Mars/Olympus" }],
    ["window", { weekly_hours: { 1: [["12:00", "09:00"]] } }],
    ["call length", { duration_minutes: 5 }],
    ["notice", { min_notice_hours: 999 }],
    ["an unknown setting", { colour: "red" }],
  ]) {
    const r = await save({ p_settings: { host_title: "Should not save", ...bad } });
    ok(r.error, `${why} refused`);
  }
  equal((await save({ p_settings: { colour: "red" } })).error?.message, "Unknown setting colour", "the unknown setting's message");
  const after = await settings();
  equal([after.host_title, after.timezone, after.duration_minutes], [before.host_title, before.timezone, before.duration_minutes], "nothing saved");
}));

statement("06.7", "The save lists every live future call the new settings no longer allow, and only those", withSettings(async () => {
  const { date } = await freeDay();
  const early = await bookAt("09:00");
  const late = await bookAt("16:30");
  const mid = await bookAt("12:00");
  const problems = async (args) => {
    const r = await save(args);
    ok(!r.error, JSON.stringify(r.error));
    equal(r.data.saved, false, "not saved");
    return sorted(Object.fromEntries(r.data.clashes.filter((c) => [early.id, late.id, mid.id].includes(c.id)).map((c) => [c.id, c.problem])));
  };
  equal(await problems({ p_settings: { blocked_dates: [date] } }), sorted({ [early.id]: "day_off", [late.id]: "day_off", [mid.id]: "day_off" }), "a new day off");
  equal(await problems({ p_settings: { weekly_hours: { ...weekdays("09:00", "17:00"), [dow(date)]: [["10:00", "16:00"]] } } }), sorted({ [early.id]: "outside_hours", [late.id]: "outside_hours" }), "shorter hours");
  equal(await problems({ p_blocks: [{ date, from: "11:30", to: "12:30", label: "x" }] }), { [mid.id]: "blocked" }, "a new block");
  const r = await save({ p_settings: { timezone: "America/Los_Angeles" } });
  const c = r.data.clashes.find((x) => x.id === early.id);
  equal([c?.problem, c?.tenant_id, c?.customer_timezone], ["outside_hours", early.co.id, "Asia/Karachi"], "a zone where 09:00 New York is 06:00, with the company and its zone");
  ok(r.data.clashes.every((x) => x.company_name && x.name && x.starts_at), "each clash names the company, the person and the time");
}));

statement("06.8", "With clashes and no choices, nothing is saved and the list comes back", withSettings(async () => {
  const { date } = await freeDay();
  const b = await bookAt("10:00");
  const before = await settings();
  const r = await save({ p_settings: { blocked_dates: [date], host_title: "Not saved" } });
  equal(r.data.saved, false, "saved");
  ok(r.data.clashes.some((c) => c.id === b.id), "the list");
  const after = await settings();
  equal([after.host_title, after.blocked_dates], [before.host_title, before.blocked_dates], "nothing saved");
  equal((await row(b.id)).status, "booked", "the call is untouched");
}));

statement("06.9", "A clash with no choice, or a choice for a call that is not a clash, is refused", withSettings(async () => {
  const { date } = await freeDay();
  const a = await bookAt("10:30");
  const b = await bookAt("11:00");
  const first = await save({ p_settings: { blocked_dates: [date] } });
  const all = Object.fromEntries(first.data.clashes.map((c) => [c.id, "keep"]));
  const missing = { ...all };
  delete missing[a.id];
  equal((await save({ p_settings: { blocked_dates: [date] }, p_decisions: missing })).error?.message, "Choose what to do with each booked call", "one clash with no choice");
  equal((await save({ p_settings: { blocked_dates: [date] }, p_decisions: { ...all, [a.id]: "maybe" } })).error?.message, "Choose what to do with each booked call", "a choice that is not keep or cancel");
  const other = await makeCompany();
  const far = await book(other.owner.token, (await freeSlots(other.owner.token)).at(-1));
  made.push(far.data.id);
  equal((await save({ p_settings: { blocked_dates: [date] }, p_decisions: { ...all, [far.data.id]: "keep" } })).error?.message, "Choose what to do with each booked call", "a choice for a call that does not clash");
  equal((await save({ p_settings: { host_title: "x" }, p_decisions: { [b.id]: "keep" } })).error?.message, "Choose what to do with each booked call", "choices when nothing clashes");
  equal((await settings()).blocked_dates.includes(date), false, "nothing saved");
}));

statement("06.10", "With every choice made: saved, cancel calls cancelled by admin with emails, keep calls left as they are", withSettings(async () => {
  const { date } = await freeDay();
  const gone = await bookAt("13:00");
  const kept = await bookAt("13:30");
  const first = await save({ p_settings: { blocked_dates: [date] } });
  const choices = Object.fromEntries(first.data.clashes.map((c) => [c.id, c.id === gone.id ? "cancel" : "keep"]));
  const r = await save({ p_settings: { blocked_dates: [date] }, p_decisions: choices });
  equal([r.error, r.data?.saved], [null, true], "saved");
  ok((await settings()).blocked_dates.includes(date), "the day off is saved");
  const g = await row(gone.id);
  equal([g.status, g.cancelled_by, g.cancel_reason], ["cancelled", "admin", "Bryan is no longer available at this time."], "the cancelled call");
  const e = await sql(`select kind from public.onboarding_call_emails where booking_id = '${gone.id}' and kind::text like 'cancelled%' order by kind`);
  equal(e.map((x) => x.kind), ["cancelled_company", "cancelled_host"], "its emails");
  equal((await row(kept.id)).status, "booked", "the kept call");
  equal((await sql(`select count(*)::int as n from public.onboarding_call_emails where booking_id = '${kept.id}' and kind::text like 'cancelled%'`))[0].n, 0, "no email for the kept call");
}));

statement("06.11", "Switching taking calls off is never a clash: booked calls stay, new bookings are refused", withSettings(async () => {
  const b = await bookAt("14:00");
  const r = await save({ p_settings: { is_accepting: false } });
  equal([r.error, r.data?.saved, r.data?.clashes.length], [null, true, 0], "saved with no clashes");
  equal((await row(b.id)).status, "booked", "the booked call stays");
  const co = await makeCompany();
  const x = await book(co.owner.token, await ny((await freeDay()).date, "15:00"));
  equal(x.error?.details, "not_accepting", "a new booking");
}));

statement("06.12", "Changing the zone moves no call, and a call outside the hours in the new zone is a clash", withSettings(async () => {
  const fits = await bookAt("11:30");     // 10:30 Chicago: fits
  const outside = await bookAt("09:30");  // 08:30 Chicago: outside
  const before = iso((await row(fits.id)).starts_at);
  const first = await save({ p_settings: { timezone: "America/Chicago" } });
  const ids = first.data.clashes.map((c) => c.id);
  ok(ids.includes(outside.id) && !ids.includes(fits.id), "only the call outside the hours clashes");
  const r = await save({ p_settings: { timezone: "America/Chicago" }, p_decisions: Object.fromEntries(ids.map((id) => [id, "keep"])) });
  equal(r.data?.saved, true, "saved");
  equal(iso((await row(fits.id)).starts_at), before, "the call did not move");
}));

statement("06.13", "Changing the call length is not a clash for calls that still fit; booked calls keep their own end", withSettings(async () => {
  const b = await bookAt("16:00"); // 16:00 to 16:30; at 45 minutes it would run to 16:45, still inside
  const last = await bookAt("16:30"); // 16:30 to 17:00; at 45 minutes it would run past 17:00
  const r = await save({ p_settings: { duration_minutes: 45 } });
  ok(!r.error, JSON.stringify(r.error));
  ok(!r.data.clashes.some((c) => [b.id, last.id].includes(c.id)), "neither call clashes");
  for (const x of [b, last]) {
    const k = await row(x.id);
    equal(new Date(k.ends_at) - new Date(k.starts_at), 30 * 60_000, "keeps its 30 minutes");
  }
}));

statement("06.14", "After a save the free times follow at once: a block 14:00 to 16:00 removes 14:00, 14:30, 15:00 and 15:30", withSettings(async () => {
  const { date, co } = await freeDay();
  const before = (await freeSlots(co.owner.token)).map(iso);
  const at = async (h) => ny(date, h);
  for (const h of ["13:30", "14:00", "15:30", "16:00"]) ok(before.includes(await at(h)), `${h} free before`);
  const r = await save({ p_blocks: [{ date, from: "14:00", to: "16:00", label: "Eval" }] });
  equal(r.data?.saved, true, "saved");
  const after = (await freeSlots(co.owner.token)).map(iso);
  for (const h of ["14:00", "14:30", "15:00", "15:30"]) ok(!after.includes(await at(h)), `${h} gone`);
  for (const h of ["13:30", "16:00"]) ok(after.includes(await at(h)), `${h} still free`);
}));

await run(import.meta.url);
