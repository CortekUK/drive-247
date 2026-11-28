import { describe, expect, it } from "vitest";
import {
  buildCallEmail,
  buildCallIcs,
  foldIcsLine,
  isHostKind,
  type CallEmailKind,
  type CallEmailPayload,
} from "../../../../supabase/functions/_shared/onboarding-call-emails";

// One fixed booking: Bryan's 9:00 AM New York on Tue 8 Dec 2026, booked from Karachi.
const base: CallEmailPayload = {
  booking_id: "11111111-2222-3333-4444-555555555555",
  sequence: 2,
  ics_token: "99999999-8888-7777-6666-555555555555",
  name: "Ayesha <Khan>",
  email: "owner@example.com",
  phone: "+92 300 1234567",
  notes: "We have 12 cars & a <b>van</b>",
  starts_at: "2026-12-08T14:00:00Z",
  ends_at: "2026-12-08T14:30:00Z",
  customer_timezone: "Asia/Karachi",
  company_name: "Lahore Rides & Co",
  slug: "lahore-rides",
  host_name: "Bryan Diaz",
  host_email: "bryan@example.com",
  host_timezone: "America/New_York",
  meeting_url: "https://meet.example.com/bryan",
};
const links = { portalRoot: "portal.drive-247.com", functionsBase: "https://ref.supabase.co/functions/v1", adminBase: "https://admin.drive-247.com" };
const kinds: CallEmailKind[] = [
  "booked_company", "booked_host", "moved_company", "moved_host",
  "cancelled_company", "cancelled_host", "reminder_day", "reminder_hour", "missed",
];
const build = (kind: CallEmailKind, extra: Partial<CallEmailPayload> = {}) => buildCallEmail(kind, { ...base, ...extra }, links);

describe("07 the emails and the invites", () => {
  it("07.1 #1 the three host kinds go to Bryan, the rest to the company", () => {
    expect(kinds.filter(isHostKind)).toEqual(["booked_host", "moved_host", "cancelled_host"]);
  });

  it.each([
    [1, "booked_company", "Your onboarding call with Bryan: Tue 8 Dec, 7:00 PM Karachi time"],
    [2, "booked_host", "New onboarding call: Lahore Rides & Co, Tue 8 Dec, 9:00 AM New York time"],
    [3, "moved_company", "Your onboarding call has moved to Tue 8 Dec, 7:00 PM Karachi time"],
    [4, "moved_host", "Onboarding call moved: Lahore Rides & Co, Tue 8 Dec, 9:00 AM New York time"],
    [5, "cancelled_company", "Your onboarding call is cancelled"],
    [6, "cancelled_host", "Onboarding call cancelled: Lahore Rides & Co"],
    [7, "reminder_day", "Tomorrow: your onboarding call with Bryan"],
    [8, "reminder_hour", "In one hour: your onboarding call with Bryan"],
    [9, "missed", "Sorry we missed you"],
  ] as const)("07.2 #%i %s has the subject %s", (_n, kind, subject) => {
    expect(build(kind).subject).toBe(subject);
  });

  it("07.3 #1 a company email gives the time in the booking's zone", () => {
    const html = build("booked_company").html;
    expect(html).toContain("Tuesday, 8 December at 7:00 PM, Karachi time");
    expect(html).not.toContain("New York time");
  });

  it("07.4 #1 Bryan's email gives his time and the company's", () => {
    const html = build("booked_host").html;
    expect(html).toContain("Tue 8 Dec, 9:00 AM New York time");
    expect(html).toContain("Tue 8 Dec, 7:00 PM Karachi time for them");
  });

  it("07.6 #1 every email uses the framed Drive247 look", () => {
    for (const k of kinds) expect(build(k).html, k).toContain('class="d-frame"');
  });

  it("07.7 #1 the confirmation has the date tile, the time, Join, add to calendar and the move line", () => {
    const html = build("booked_company").html;
    expect(html).toContain(">DEC<");
    expect(html).toContain(">8<");
    expect(html).toContain("Join the call");
    expect(html).toContain("https://meet.example.com/bryan");
    expect(html).toContain("calendar.google.com");
    expect(html).toContain("outlook.live.com");
    expect(html).toContain("onboarding-call-ics?t=99999999-8888-7777-6666-555555555555");
    expect(html).toContain("Move or cancel your call");
  });

  it("07.8 #1 with no call link the Join button is replaced by a sentence", () => {
    const html = build("booked_company", { meeting_url: null }).html;
    expect(html).not.toContain("Join the call");
    expect(html).toContain("Bryan will send you the call link before the call.");
  });

  it("07.9 #1 Bryan's email carries the company, the person, contact, note, Join and Open Call Calendar", () => {
    const html = build("booked_host").html;
    for (const s of ["Lahore Rides &amp; Co", "Ayesha &lt;Khan&gt;", "owner@example.com", "+92 300 1234567", "12 cars &amp; a &lt;b&gt;van&lt;/b&gt;", "Join the call", "Open Call Calendar", "https://admin.drive-247.com/admin/call-calendar"]) {
      expect(html).toContain(s);
    }
  });

  it("07.10 #1 a moved email shows the old time struck through", () => {
    const html = build("moved_company", { old_starts_at: "2026-12-07T14:00:00Z" }).html;
    expect(html).toMatch(/<s [^>]*>Monday, 7 December at 7:00 PM, Karachi time<\/s>/);
    expect(html).toContain("Tuesday, 8 December at 7:00 PM, Karachi time");
  });

  it.each([
    [1, "cancelled_company", "operator", "You cancelled your call."],
    [2, "cancelled_company", "admin", "Bryan cancelled your call."],
    [3, "cancelled_host", "operator", "Lahore Rides &amp; Co cancelled."],
    [4, "cancelled_host", "admin", "You cancelled this call."],
  ] as const)("07.11 #%i %s by %s says %s", (_n, kind, actor, words) => {
    expect(build(kind, { actor }).html).toContain(words);
  });

  it("07.11 #5 the reason is shown, and the company gets Book a new time", () => {
    const html = build("cancelled_company", { actor: "admin", reason: "Bryan is ill" }).html;
    expect(html).toContain("Reason: Bryan is ill");
    expect(html).toContain("Book a new time");
    expect(html).toContain("https://lahore-rides.portal.drive-247.com/?book-call=1");
    expect(build("cancelled_host", { actor: "admin" }).html).not.toContain("Book a new time");
  });

  it("07.12 #1 a reminder shows the time and Join", () => {
    for (const k of ["reminder_day", "reminder_hour"] as const) {
      const html = build(k).html;
      expect(html).toContain("Tuesday, 8 December at 7:00 PM, Karachi time");
      expect(html).toContain("Join the call");
    }
  });

  it("07.12 #2 the missed email has one line and Book a new time", () => {
    const html = build("missed").html;
    expect(html).toContain("Sorry we missed you");
    expect(html).toContain("Book a new time");
  });

  it("07.13 #1 no email has an emoji or a long dash", () => {
    for (const k of kinds) {
      const { subject, html } = build(k, { old_starts_at: "2026-12-07T14:00:00Z", reason: "x", actor: "admin" });
      expect(subject + html, k).not.toMatch(/[\u2013\u2014]/);
      expect(subject + html, k).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("07.14 #1 text a person typed is escaped", () => {
    const html = build("booked_host", { notes: "<script>x</script>", reason: "<i>r</i>" }).html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("07.15 #1 the move or cancel link opens the company's own portal on the call", () => {
    expect(build("booked_company").html).toContain("https://lahore-rides.portal.drive-247.com/?call=open");
  });

  it.each([
    [1, "booked_company", "REQUEST"],
    [2, "moved_host", "REQUEST"],
    [3, "cancelled_company", "CANCEL"],
    [4, "cancelled_host", "CANCEL"],
  ] as const)("07.16 #%i %s carries a %s invite", (_n, kind, method) => {
    const e = build(kind);
    expect(e.ics?.method).toBe(method);
    expect(e.ics?.content).toContain(`METHOD:${method}`);
    if (method === "CANCEL") expect(e.ics?.content).toContain("STATUS:CANCELLED");
  });

  it("07.16 #5 reminders and the missed email carry no invite", () => {
    for (const k of ["reminder_day", "reminder_hour", "missed"] as const) expect(build(k).ics).toBeUndefined();
  });

  it("07.17 #1 the company's invite UID is the booking's, so a move updates the same event", () => {
    expect(build("booked_company").ics?.content).toContain("UID:11111111-2222-3333-4444-555555555555@drive-247.com");
    expect(build("moved_company").ics?.content).toContain("UID:11111111-2222-3333-4444-555555555555@drive-247.com");
  });

  it("07.18 #1 the invite's SEQUENCE is the booking's", () => {
    expect(build("moved_company").ics?.content).toContain("SEQUENCE:2");
  });

  it("07.19 #1 the company's invite: Bryan organises, the company attends", () => {
    const ics = build("booked_company").ics!.content.replace(/\r\n /g, "");
    expect(ics).toContain('ORGANIZER;CN="Bryan Diaz":mailto:bryan@example.com');
    expect(ics).toContain('ATTENDEE;CN="Ayesha <Khan>";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:owner@example.com');
  });

  it("07.19 #2 Bryan's invite is its own event, organised by Drive247", () => {
    const ics = build("booked_host").ics!.content.replace(/\r\n /g, "");
    expect(ics).toContain("UID:11111111-2222-3333-4444-555555555555-host@drive-247.com");
    expect(ics).toContain('ORGANIZER;CN="Drive247":mailto:support@drive-247.com');
    expect(ics).toContain("mailto:bryan@example.com");
  });

  it("07.20 #1 the invite has UTC times, a summary, the link as location, and no line over 75 octets", () => {
    const ics = buildCallIcs(base, "REQUEST", false);
    expect(ics).toContain("DTSTART:20261208T140000Z");
    expect(ics).toContain("SUMMARY:Drive247 onboarding call with Bryan Diaz");
    expect(ics).toContain("LOCATION:https://meet.example.com/bryan");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("07.20 #2 a long line is folded with CRLF and a space, and unfolds to itself", () => {
    const long = "DESCRIPTION:" + "é".repeat(60);
    const folded = foldIcsLine(long);
    expect(folded).toContain("\r\n ");
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });

  it("07.21 #1 text in the invite is escaped", () => {
    const ics = buildCallIcs({ ...base, host_name: "Bryan; Diaz, NY" }, "REQUEST", false).replace(/\r\n /g, "");
    expect(ics).toContain("SUMMARY:Drive247 onboarding call with Bryan\\; Diaz\\, NY");
    expect(ics).toContain("DESCRIPTION:Your free onboarding call with Bryan\\; Diaz\\, NY from Drive247.\\nJoin:");
  });

  it("07.24 #1 the emails offer Google, Outlook and Apple or other", () => {
    const html = build("booked_company").html;
    expect(html).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE");
    expect(html).toContain("https://outlook.live.com/calendar/0/deeplink/compose?");
    expect(html).toContain("Apple Calendar");
  });
});
