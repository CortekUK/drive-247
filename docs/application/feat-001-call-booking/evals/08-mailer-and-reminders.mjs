// Proves spec 08 (the email ledger, reminders and the mailer) and 07.5 against staging.
// Staging's ONBOARDING_CALL_ONLY_TO lets through only Resend's test inbox (delivered@resend.dev,
// which is nobody's) and "not-an-email", which Resend refuses, to prove a failed send.
import { statement, run, sql, fn, cleanup, equal, ok } from "../../eval-kit.mjs";
import { admin, book, freeSlots, keepSettings, makeCompany, rpc } from "./lib/fixtures.mjs";

const SINK = "delivered@resend.dev";
const iso = (t) => new Date(t).toISOString();
let adminToken;
const A = async () => (adminToken ??= await admin());
const ledger = async (id) => sql(`select id, kind, recipient, dedupe_key, status, error, attempts, sent_at, payload from public.onboarding_call_emails where booking_id = '${id}' order by kind`);
const flush = async (token) => fn("onboarding-call-mailer", { flush: true }, { as: token });

/** A booking put straight in the table, with when it was booked. */
async function place(tenant, startsAt, bookedAt, status = "booked") {
  const [b] = await sql(`insert into public.onboarding_call_bookings (tenant_id, name, email, starts_at, ends_at, status, created_at, rescheduled_at, cancelled_at, cancelled_by)
                         values ('${tenant}', 'Eval', '${SINK}', '${startsAt}', '${startsAt}'::timestamptz + interval '30 minutes', '${status}', '${bookedAt}', '${bookedAt}',
                                 ${status === "cancelled" ? "now(), 'admin'" : "null, null"}) returning id`);
  return b.id;
}
const due = async (id, now) => (await sql(`select kind::text from public.onboarding_call_due_reminders('${now}') where booking_id = '${id}' order by 1`)).map((r) => r.kind);

statement("08.1", "Emails are queued with the change, and a change that fails queues nothing", async () => {
  const co = await makeCompany();
  const slots = await freeSlots(co.owner.token);
  const bad = await book(co.owner.token, new Date(new Date(slots[0]).getTime() + 7 * 60_000).toISOString());
  ok(bad.error, "an off-grid time is refused");
  const [n] = await sql(`select count(*)::int as n from public.onboarding_call_emails e join public.onboarding_call_bookings b on b.id = e.booking_id where b.tenant_id = '${co.id}'`);
  equal(n.n, 0, "nothing queued for the refused booking");
  const r = await book(co.owner.token, slots.at(-1));
  const rows = await ledger(r.data.id);
  equal(rows.map((x) => [x.kind, x.status]), [["booked_company", "pending"], ["booked_host", "pending"]], "queued with the booking");
});

statement("08.2", "The key is id:kind:sequence, or id:kind:epoch for reminders, and the same email is never queued twice", async () => {
  const co = await makeCompany();
  const r = await book(co.owner.token, (await freeSlots(co.owner.token)).at(-2));
  const [b] = await sql(`select id, sequence, extract(epoch from starts_at)::bigint as e from public.onboarding_call_bookings where id = '${r.data.id}'`);
  await sql(`select public.onboarding_call_queue_email('${b.id}', 'reminder_hour')`);
  await sql(`select public.onboarding_call_queue_email('${b.id}', 'reminder_hour')`);
  await sql(`select public.onboarding_call_queue_email('${b.id}', 'booked_company')`);
  const keys = (await ledger(b.id)).map((x) => x.dedupe_key).sort();
  equal(keys, [`${b.id}:booked_company:${b.sequence}`, `${b.id}:booked_host:${b.sequence}`, `${b.id}:reminder_hour:${b.e}`].sort(), "keys, each once");
});

statement("08.3", "A queued email keeps the snapshot it was queued with", async () => {
  const co = await makeCompany();
  const slots = await freeSlots(co.owner.token);
  const r = await book(co.owner.token, slots.at(-3));
  await book(co.owner.token, slots.at(-4));
  const rows = await ledger(r.data.id);
  const first = rows.find((x) => x.kind === "booked_company");
  const moved = rows.find((x) => x.kind === "moved_company");
  equal(iso(first.payload.starts_at), iso(slots.at(-3)), "the booked email still has the first time");
  equal([iso(moved.payload.starts_at), iso(moved.payload.old_starts_at)], [iso(slots.at(-4)), iso(slots.at(-3))], "the moved email has both");
});

// The worked table under 08.8. Dates in 2027, where no real booking can sit.
statement("08.4", "The day reminder is due from 24 hours to 1 hour before, if booked at least 24 hours ahead", async () => {
  const co = await makeCompany();
  const id = await place(co.id, "2027-12-08T14:00:00Z", "2027-12-01T10:00:00Z");
  equal(await due(id, "2027-12-07T13:55:00Z"), [], "24h 5m before: none");
  equal(await due(id, "2027-12-07T14:00:00Z"), ["reminder_day"], "24h before");
  equal(await due(id, "2027-12-08T12:59:00Z"), ["reminder_day"], "61 minutes before");
});

statement("08.5", "The hour reminder is due from 1 hour before the start until the start", async () => {
  const co = await makeCompany();
  const id = await place(co.id, "2027-12-10T14:00:00Z", "2027-12-01T10:00:00Z");
  equal(await due(id, "2027-12-10T13:00:00Z"), ["reminder_hour"], "1 hour before");
  equal(await due(id, "2027-12-10T13:59:00Z"), ["reminder_hour"], "a minute before");
  equal(await due(id, "2027-12-10T14:00:00Z"), [], "started: none");
});

statement("08.6", "A booking made 10 hours before its start gets only the hour reminder", async () => {
  const co = await makeCompany();
  const id = await place(co.id, "2027-12-11T14:00:00Z", "2027-12-11T04:00:00Z");
  equal(await due(id, "2027-12-11T04:05:00Z"), [], "10 hours ahead: no day reminder");
  equal(await due(id, "2027-12-11T13:05:00Z"), ["reminder_hour"], "the hour reminder");
});

statement("08.7", "A cancelled, done or missed call gets no reminder, and one already queued is skipped", async () => {
  const co = await makeCompany();
  for (const s of ["cancelled", "completed", "missed"]) {
    const id = await place(co.id, "2027-12-09T14:00:00Z", "2027-12-01T10:00:00Z", s);
    equal(await due(id, "2027-12-09T13:30:00Z"), [], s);
  }
  const live = await makeCompany();
  const r = await book(live.owner.token, (await freeSlots(live.owner.token)).at(-5), { p_email: SINK });
  await sql(`select public.onboarding_call_queue_email('${r.data.id}', 'reminder_day')`);
  await rpc("cancel_my_onboarding_call", {}, live.owner.token);
  await flush(live.owner.token);
  const rem = (await ledger(r.data.id)).find((x) => x.kind === "reminder_day");
  equal([rem.status, rem.error], ["skipped", "The call is no longer booked at this time"], "the queued reminder");
});

statement("08.8", "A moved call's reminders follow the new start; one queued for the old start is skipped", async () => {
  const co = await makeCompany();
  const slots = await freeSlots(co.owner.token);
  const r = await book(co.owner.token, slots.at(-6), { p_email: SINK });
  await sql(`select public.onboarding_call_queue_email('${r.data.id}', 'reminder_hour')`);
  await book(co.owner.token, slots.at(-7), { p_email: SINK });
  const [b] = await sql(`select starts_at from public.onboarding_call_bookings where id = '${r.data.id}'`);
  equal(await due(r.data.id, new Date(new Date(slots.at(-6)).getTime() - 30 * 60_000).toISOString()), [], "nothing due at the old time");
  equal(await due(r.data.id, new Date(new Date(b.starts_at).getTime() - 30 * 60_000).toISOString()), ["reminder_hour"], "due at the new time");
  await sql(`select public.onboarding_call_queue_email('${r.data.id}', 'reminder_hour')`);
  const hours = (await ledger(r.data.id)).filter((x) => x.kind === "reminder_hour");
  equal(hours.length, 2, "one key per start");
  await flush(co.owner.token);
  const after = (await ledger(r.data.id)).filter((x) => x.kind === "reminder_hour");
  const old = after.find((x) => iso(x.payload.starts_at) === iso(slots.at(-6)));
  const now = after.find((x) => iso(x.payload.starts_at) === iso(b.starts_at));
  equal([old.status, old.error], ["skipped", "The call is no longer booked at this time"], "the old start's reminder");
  equal(now.status, "sent", "the new start's reminder");
});

statement("08.9", "Two mailer runs at once never send the same row", async () => {
  const cos = [];
  for (let i = 0; i < 3; i++) cos.push(await makeCompany());
  const slots = await freeSlots(cos[0].owner.token);
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await book(cos[i].owner.token, slots.at(-10 - i), { p_email: SINK })).data.id);
  // Bryan's copies go to the same test inbox, so all six rows are sendable.
  await sql(`update public.onboarding_call_emails set recipient = '${SINK}' where booking_id in (${ids.map((x) => `'${x}'`).join(",")})`);
  const [x, y] = await Promise.all([flush(cos[0].owner.token), flush(cos[1].owner.token)]);
  const rows = (await Promise.all(ids.map(ledger))).flat();
  ok(rows.length === 6 && rows.every((r) => r.status === "sent"), `all sent: ${rows.map((r) => r.status)}`);
  ok(x.data.sent + y.data.sent >= 6, "both runs together sent them");
  const [claim] = await sql(`select pg_get_functiondef('public.onboarding_call_claim_emails(integer)'::regprocedure) ~* 'for update skip locked' as y`);
  equal(claim.y, true, "rows are claimed with for update skip locked");
});

statement("08.10", "A sent row is sent with its time; a failed one goes back with attempts up, and is failed after 5", async () => {
  const co = await makeCompany();
  const r = await book(co.owner.token, (await freeSlots(co.owner.token)).at(-14), { p_email: SINK });
  await sql(`update public.onboarding_call_emails set recipient = 'not-an-email' where booking_id = '${r.data.id}' and kind = 'booked_host'`);
  await flush(co.owner.token);
  let rows = await ledger(r.data.id);
  const ok1 = rows.find((x) => x.kind === "booked_company");
  equal(ok1.status, "sent", "the good one");
  ok(ok1.sent_at, "sent_at");
  let bad = rows.find((x) => x.kind === "booked_host");
  equal([bad.status, bad.attempts], ["pending", 1], "the refused one, after one try");
  ok(bad.error, "with the error");
  await sql(`update public.onboarding_call_emails set attempts = 4 where id = '${bad.id}'`);
  await flush(co.owner.token);
  bad = (await ledger(r.data.id)).find((x) => x.kind === "booked_host");
  equal([bad.status, bad.attempts], ["failed", 5], "after the fifth try");
});

statement("08.11", "A row left sending for more than 10 minutes is taken as pending again", async () => {
  const co = await makeCompany();
  const r = await book(co.owner.token, (await freeSlots(co.owner.token)).at(-15), { p_email: SINK });
  await sql(`update public.onboarding_call_emails set status = 'sending', claimed_at = now() - interval '11 minutes' where booking_id = '${r.data.id}' and kind = 'booked_company'`);
  await sql(`update public.onboarding_call_emails set status = 'sending', claimed_at = now() - interval '5 minutes' where booking_id = '${r.data.id}' and kind = 'booked_host'`);
  await flush(co.owner.token);
  const rows = await ledger(r.data.id);
  equal(rows.find((x) => x.kind === "booked_company").status, "sent", "11 minutes: taken again and sent");
  equal(rows.find((x) => x.kind === "booked_host").status, "sending", "5 minutes: left alone");
  await sql(`update public.onboarding_call_emails set status = 'skipped' where booking_id = '${r.data.id}' and status = 'sending'`);
});

statement("08.12", "With the test list set, any other recipient is skipped as Not on the test list", async () => {
  const co = await makeCompany();
  const r = await book(co.owner.token, (await freeSlots(co.owner.token)).at(-16), { p_email: "eval+real-company@example.com" });
  await flush(co.owner.token);
  const c = (await ledger(r.data.id)).find((x) => x.kind === "booked_company");
  equal([c.status, c.error], ["skipped", "Not on the test list"], "a company address");
});

statement("08.13", "dry_run lists what is due and pending, and sends and changes nothing", async () => {
  const co = await makeCompany();
  const r = await book(co.owner.token, (await freeSlots(co.owner.token)).at(-17), { p_email: SINK });
  const before = await ledger(r.data.id);
  const d = await fn("onboarding-call-mailer", { dry_run: true }, { as: await A() });
  equal(d.status, 200, "status");
  const pendingIds = d.data.pending.map((p) => p.id);
  ok(before.every((x) => pendingIds.includes(x.id)), "lists the pending rows");
  ok(Array.isArray(d.data.due), "lists what is due");
  equal((await ledger(r.data.id)).map((x) => x.status), before.map((x) => x.status), "nothing changed");
  equal((await fn("onboarding-call-mailer", { dry_run: true }, { as: co.owner.token })).status, 401, "a company cannot dry run");
  equal((await fn("onboarding-call-mailer", {})).status, 401, "a visitor gets nothing");
  await flush(co.owner.token);
});

statement("07.5", "With no host email, Bryan's copies are skipped as No host email set, and the company's still go", async () => {
  await keepSettings();
  await sql(`update public.onboarding_call_settings set host_email = null where id`);
  const co = await makeCompany();
  const r = await book(co.owner.token, (await freeSlots(co.owner.token)).at(-18), { p_email: SINK });
  await flush(co.owner.token);
  const rows = await ledger(r.data.id);
  const host = rows.find((x) => x.kind === "booked_host");
  equal([host.recipient, host.status, host.error], ["", "skipped", "No host email set"], "Bryan's copy");
  equal(rows.find((x) => x.kind === "booked_company").status, "sent", "the company's");
});

await run(import.meta.url);
