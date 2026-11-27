// The onboarding call's own emails and calendar invites (feat-001 spec 07).
// Pure: no network and no Deno, so Vitest builds every kind from a fixed
// booking. The mailer (onboarding-call-mailer) sends what this returns.

import { emailLink, escapeHtml, renderDrive247Email, SUPPORT_EMAIL } from "./drive247-email.ts";
import { dateTile, formatCallFull, formatCallShort, zoneLabel } from "./onboarding-call-time.ts";

export type CallEmailKind =
  | "booked_company"
  | "booked_host"
  | "moved_company"
  | "moved_host"
  | "cancelled_company"
  | "cancelled_host"
  | "reminder_day"
  | "reminder_hour"
  | "missed";

/** The ledger row's payload (onboarding_call_queue_email). */
export interface CallEmailPayload {
  booking_id: string;
  sequence: number;
  ics_token: string;
  name: string;
  email: string;
  phone?: string | null;
  notes?: string | null;
  starts_at: string;
  ends_at: string;
  customer_timezone?: string | null;
  company_name: string;
  slug: string;
  host_name: string;
  host_email?: string | null;
  host_timezone: string;
  meeting_url?: string | null;
  old_starts_at?: string | null;
  reason?: string | null;
  actor?: "operator" | "admin" | "system" | null;
}

export interface CallEmailLinks {
  /** "portal.drive-247.com" */
  portalRoot: string;
  /** The functions base, "https://<ref>.supabase.co/functions/v1". */
  functionsBase: string;
  /** "https://admin.drive-247.com" */
  adminBase: string;
}

export interface BuiltCallEmail {
  subject: string;
  html: string;
  ics?: { method: "REQUEST" | "CANCEL"; content: string; filename: string };
}

const HOST_KINDS: CallEmailKind[] = ["booked_host", "moved_host", "cancelled_host"];

export function isHostKind(kind: CallEmailKind): boolean {
  return HOST_KINDS.includes(kind);
}

export function companyZone(p: CallEmailPayload): string {
  return p.customer_timezone || p.host_timezone;
}

export function portalCallLink(slug: string, portalRoot: string): string {
  return `https://${slug}.${portalRoot}/?call=open`;
}

export function portalBookLink(slug: string, portalRoot: string): string {
  return `https://${slug}.${portalRoot}/?book-call=1`;
}

export function icsLink(token: string, functionsBase: string): string {
  return `${functionsBase.replace(/\/+$/, "")}/onboarding-call-ics?t=${encodeURIComponent(token)}`;
}

function title(p: CallEmailPayload): string {
  return `Drive247 onboarding call with ${p.host_name}`;
}

function stamp(iso: string | Date): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function googleCalendarLink(p: CallEmailPayload): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: title(p),
    dates: `${stamp(p.starts_at)}/${stamp(p.ends_at)}`,
    details: inviteDescription(p),
  });
  if (p.meeting_url) q.set("location", p.meeting_url);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export function outlookCalendarLink(p: CallEmailPayload): string {
  const q = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: title(p),
    startdt: new Date(p.starts_at).toISOString(),
    enddt: new Date(p.ends_at).toISOString(),
    body: inviteDescription(p),
  });
  if (p.meeting_url) q.set("location", p.meeting_url);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q.toString()}`;
}

function inviteDescription(p: CallEmailPayload): string {
  return [
    `Your free onboarding call with ${p.host_name} from Drive247.`,
    p.meeting_url ? `Join: ${p.meeting_url}` : "The call link will follow by email.",
  ].join("\n");
}

// ── The invite (RFC 5545) ───────────────────────────────────────────────────

function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsParam(s: string): string {
  return `"${s.replace(/["\r\n]/g, "")}"`;
}

/** Lines over 75 octets are folded: CRLF, then a space. */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildCallIcs(
  p: CallEmailPayload,
  method: "REQUEST" | "CANCEL",
  forHost: boolean,
  now: Date = new Date(),
): string {
  const organizerEmail = forHost ? SUPPORT_EMAIL : p.host_email || SUPPORT_EMAIL;
  const organizerName = forHost ? "Drive247" : p.host_name;
  const attendee = forHost
    ? { name: p.host_name, email: p.host_email || SUPPORT_EMAIL }
    : { name: p.name, email: p.email };
  const summary = forHost ? `Drive247 onboarding call: ${p.company_name}` : title(p);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Drive247//Onboarding call//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    // Bryan's copy is its own event, so his and the company's never collide.
    `UID:${p.booking_id}${forHost ? "-host" : ""}@drive-247.com`,
    `SEQUENCE:${p.sequence}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(p.starts_at)}`,
    `DTEND:${stamp(p.ends_at)}`,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText(inviteDescription(p))}`,
    `LOCATION:${icsText(p.meeting_url || "Video call, link to follow")}`,
    `ORGANIZER;CN=${icsParam(organizerName)}:mailto:${organizerEmail}`,
    `ATTENDEE;CN=${icsParam(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee.email}`,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

// ── The emails ─────────────────────────────────────────────────────────────

function tile(at: string, ends: string, tz: string): string {
  const t = dateTile(at, tz);
  const mins = Math.round((new Date(ends).getTime() - new Date(at).getTime()) / 60_000);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr>
    <td style="width:64px;border:1px solid #ddd6fe;border-radius:12px;text-align:center;padding:8px 0;font-family:Arial,sans-serif;">
      <div style="font-size:11px;letter-spacing:1px;font-weight:700;color:#4f46e5;">${t.month}</div>
      <div style="font-size:26px;line-height:30px;font-weight:700;color:#111827;">${t.day}</div>
    </td>
    <td style="padding-left:14px;font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111827;">
      <strong>${escapeHtml(formatCallFull(at, tz))}</strong><br><span style="color:#6b7280;">${mins} minutes, video call</span>
    </td></tr></table>`;
}

function para(html: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4a4a5c;">${html}</p>`;
}

function noLinkLine(): string {
  return para("Bryan will send you the call link before the call.");
}

function calendarLine(p: CallEmailPayload, links: CallEmailLinks): string {
  return para(
    `Add it to ${emailLink(escapeHtml(googleCalendarLink(p)), "Google")}, ${emailLink(escapeHtml(outlookCalendarLink(p)), "Outlook")} or ${emailLink(escapeHtml(icsLink(p.ics_token, links.functionsBase)), "Apple Calendar")}.`,
  );
}

function whoCancelled(p: CallEmailPayload, forHost: boolean): string {
  if (p.actor === "admin" || p.actor === "system") return forHost ? "You cancelled this call." : "Bryan cancelled your call.";
  return forHost ? `${escapeHtml(p.company_name)} cancelled.` : "You cancelled your call.";
}

export function callEmailSubject(kind: CallEmailKind, p: CallEmailPayload): string {
  const cz = companyZone(p);
  switch (kind) {
    case "booked_company":
      return `Your onboarding call with Bryan: ${formatCallShort(p.starts_at, cz)}`;
    case "booked_host":
      return `New onboarding call: ${p.company_name}, ${formatCallShort(p.starts_at, p.host_timezone)}`;
    case "moved_company":
      return `Your onboarding call has moved to ${formatCallShort(p.starts_at, cz)}`;
    case "moved_host":
      return `Onboarding call moved: ${p.company_name}, ${formatCallShort(p.starts_at, p.host_timezone)}`;
    case "cancelled_company":
      return "Your onboarding call is cancelled";
    case "cancelled_host":
      return `Onboarding call cancelled: ${p.company_name}`;
    case "reminder_day":
      return "Tomorrow: your onboarding call with Bryan";
    case "reminder_hour":
      return "In one hour: your onboarding call with Bryan";
    case "missed":
      return "Sorry we missed you";
  }
}

export function buildCallEmail(kind: CallEmailKind, p: CallEmailPayload, links: CallEmailLinks): BuiltCallEmail {
  const forHost = isHostKind(kind);
  const tz = forHost ? p.host_timezone : companyZone(p);
  const cz = companyZone(p);
  const subject = callEmailSubject(kind, p);
  const join = p.meeting_url ? { label: "Join the call", href: escapeHtml(p.meeting_url) } : undefined;
  const moveLine = para(`Need another time? ${emailLink(escapeHtml(portalCallLink(p.slug, links.portalRoot)), "Move or cancel your call")}.`);
  const bookAgain = { label: "Book a new time", href: escapeHtml(portalBookLink(p.slug, links.portalRoot)) };
  const calendarHref = escapeHtml(`${links.adminBase.replace(/\/+$/, "")}/admin/call-calendar`);
  const bothTimes = `${escapeHtml(formatCallShort(p.starts_at, p.host_timezone))}<br><span style="color:#6b7280;">${escapeHtml(formatCallShort(p.starts_at, cz))} for them</span>`;
  const oldTime = p.old_starts_at
    ? para(`<s style="color:#9ca3af;">${escapeHtml(formatCallFull(p.old_starts_at, tz))}</s>`)
    : "";
  const reason = p.reason ? para(`Reason: ${escapeHtml(p.reason)}`) : "";

  let html: string;
  let ics: BuiltCallEmail["ics"];
  const invite = (method: "REQUEST" | "CANCEL") => ({
    method,
    content: buildCallIcs(p, method, forHost),
    filename: method === "CANCEL" ? "cancel.ics" : "invite.ics",
  });

  switch (kind) {
    case "booked_company":
    case "moved_company":
      html = renderDrive247Email({
        framed: true,
        preheader: `${kind === "moved_company" ? "Your call has moved to" : "You are booked for"} ${formatCallFull(p.starts_at, cz)}`,
        eyebrow: kind === "moved_company" ? "Call moved" : "Call booked",
        title: kind === "moved_company" ? "Your call has a new time" : "You are booked with Bryan",
        bodyHtml: oldTime + tile(p.starts_at, p.ends_at, cz) + (join ? "" : noLinkLine()) + calendarLine(p, links) + moveLine,
        cta: join,
      });
      ics = invite("REQUEST");
      break;
    case "booked_host":
    case "moved_host":
      html = renderDrive247Email({
        framed: true,
        preheader: `${p.company_name}, ${formatCallFull(p.starts_at, p.host_timezone)}`,
        eyebrow: kind === "moved_host" ? "Call moved" : "New onboarding call",
        title: escapeHtml(p.company_name),
        bodyHtml: oldTime,
        details: {
          rows: [
            { label: "When", value: bothTimes },
            { label: "Person", value: escapeHtml(p.name) },
            { label: "Email", value: escapeHtml(p.email) },
            ...(p.phone ? [{ label: "Phone", value: escapeHtml(p.phone) }] : []),
            ...(p.notes ? [{ label: "Their note", value: escapeHtml(p.notes).replace(/\n/g, "<br>") }] : []),
          ],
        },
        cta: join,
        secondaryCta: { label: "Open Call Calendar", href: calendarHref },
      });
      ics = invite("REQUEST");
      break;
    case "cancelled_company":
    case "cancelled_host":
      html = renderDrive247Email({
        framed: true,
        preheader: whoCancelled(p, forHost).replace(/&amp;/g, "&"),
        eyebrow: "Call cancelled",
        title: forHost ? escapeHtml(p.company_name) : "Your call is cancelled",
        bodyHtml:
          para(whoCancelled(p, forHost)) +
          para(`<s style="color:#9ca3af;">${escapeHtml(formatCallFull(p.starts_at, tz))}</s>`) +
          reason +
          (forHost ? "" : para("The time is free again. You can book a new one whenever suits you.")),
        cta: forHost ? undefined : bookAgain,
      });
      ics = invite("CANCEL");
      break;
    case "reminder_day":
    case "reminder_hour":
      html = renderDrive247Email({
        framed: true,
        preheader: formatCallFull(p.starts_at, cz),
        eyebrow: kind === "reminder_day" ? "Tomorrow" : "In one hour",
        title: "Your onboarding call with Bryan",
        bodyHtml: tile(p.starts_at, p.ends_at, cz) + (join ? "" : noLinkLine()) + moveLine,
        cta: join,
      });
      break;
    case "missed":
      html = renderDrive247Email({
        framed: true,
        preheader: "Pick a new time for your free onboarding call.",
        eyebrow: "Onboarding call",
        title: "Sorry we missed you",
        intro: ["Bryan was ready for your call, but we could not connect. Pick a new time that suits you and he will set you up."],
        cta: bookAgain,
      });
      break;
  }

  return { subject, html, ...(ics ? { ics } : {}) };
}

export { zoneLabel };
