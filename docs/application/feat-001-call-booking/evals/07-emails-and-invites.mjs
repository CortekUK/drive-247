// Proves spec 07.22 and 07.23 (the invite link) against staging's onboarding-call-ics function.
// The emails' content is proved in 07-emails-and-invites.test.ts; 07.5 in 08-mailer-and-reminders.mjs.
import { statement, run, sql, STAGING_URL, equal, ok } from "../../eval-kit.mjs";
import { book, freeSlots, makeCompany, rpc } from "./lib/fixtures.mjs";

const ics = (t) => fetch(`${STAGING_URL}/functions/v1/onboarding-call-ics?t=${encodeURIComponent(t)}`);
let booking;
async function booked() {
  if (booking) return booking;
  const co = await makeCompany();
  const r = await book(co.owner.token, (await freeSlots(co.owner.token)).at(-1));
  ok(!r.error, JSON.stringify(r.error));
  const [b] = await sql(`select id, ics_token, starts_at, sequence from public.onboarding_call_bookings where id = '${r.data.id}'`);
  booking = { co, ...b };
  return booking;
}
const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

statement("07.22", "The invite link returns the booking's invite as text/calendar, inline, with its file name", async () => {
  const b = await booked();
  const res = await ics(b.ics_token);
  equal(res.status, 200, "status");
  ok((res.headers.get("content-type") || "").startsWith("text/calendar"), `content type: ${res.headers.get("content-type")}`);
  equal(res.headers.get("content-disposition"), 'inline; filename="drive247-onboarding-call.ics"', "disposition");
  const body = (await res.text()).replace(/\r\n /g, "");
  for (const s of ["BEGIN:VCALENDAR", "METHOD:REQUEST", `UID:${b.id}@drive-247.com`, `DTSTART:${stamp(b.starts_at)}`, `SEQUENCE:${b.sequence}`, "END:VCALENDAR"]) {
    ok(body.includes(s), `has ${s}`);
  }
});

statement("07.23", "An unknown or malformed token gets 404 with no body; a cancelled booking returns a CANCEL invite", async () => {
  for (const t of ["00000000-0000-0000-0000-000000000000", "nope", ""]) {
    const res = await ics(t);
    equal([res.status, await res.text()], [404, ""], `token "${t}"`);
  }
  const b = await booked();
  ok(!(await rpc("cancel_my_onboarding_call", { p_reason: "Eval" }, b.co.owner.token)).error, "cancelled");
  const body = await (await ics(b.ics_token)).text();
  ok(body.includes("METHOD:CANCEL") && body.includes("STATUS:CANCELLED"), "a CANCEL invite");
  ok(body.includes(`UID:${b.id}@drive-247.com`), "for the same event");
});

await run(import.meta.url);
