// The free onboarding call journey: which email is due, what it says, and what a
// calendar event does to a tenant's row. Pure, so it can be tested without Deno.

import { emailLink, renderDrive247Email } from "./drive247-email.ts";

export const ONBOARDING_BOOKING_URL = "https://api.leadconnectorhq.com/widget/bookings/drive247-onboarding-call";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A welcome older than this is stale: it must not reach existing customers at launch. */
export const WELCOME_WINDOW_MS = 6 * HOUR;
export const REMINDER_AFTER_MS = DAY;
export const FOLLOW_UP_AFTER_MS = 2 * DAY;
/** Ends the 48-72h follow-up, with a day's slack if a run is missed. */
export const FOLLOW_UP_UNTIL_MS = 4 * DAY;
export const JOURNEY_ENDS_MS = 14 * DAY;

export type JourneyEmail = "welcome" | "reminder" | "follow_up";

export const SENT_COLUMN: Record<JourneyEmail, string> = {
  welcome: "welcome_sent_at",
  reminder: "reminder_sent_at",
  follow_up: "follow_up_sent_at",
};

export interface JourneyState {
  tenantCreatedAt: string;
  subscriptionStatus?: string | null;
  callBookedAt?: string | null;
  callCompletedAt?: string | null;
  dismissedAt?: string | null;
  /** A cancelled or missed call has its own "book again" email (feat-001). */
  callCancelledAt?: string | null;
  callMissedAt?: string | null;
  welcomeSentAt?: string | null;
  reminderSentAt?: string | null;
  followUpSentAt?: string | null;
}

/** The one email this tenant is due now, or null. Booking stops all of them, for good. */
export function nextJourneyEmail(s: JourneyState, now: number = Date.now()): JourneyEmail | null {
  if (s.callCompletedAt || s.callBookedAt || s.dismissedAt) return null;
  if (s.callCancelledAt || s.callMissedAt) return null;
  if (s.subscriptionStatus !== "trialing" && s.subscriptionStatus !== "active") return null;

  const age = now - new Date(s.tenantCreatedAt).getTime();
  if (age < 0 || age >= JOURNEY_ENDS_MS) return null;

  if (!s.welcomeSentAt && s.subscriptionStatus === "trialing" && age < WELCOME_WINDOW_MS) return "welcome";
  if (!s.reminderSentAt) return age >= REMINDER_AFTER_MS ? "reminder" : null;

  const sinceReminder = now - new Date(s.reminderSentAt).getTime();
  if (!s.followUpSentAt && age >= FOLLOW_UP_AFTER_MS && age < FOLLOW_UP_UNTIL_MS && sinceReminder >= DAY) {
    return "follow_up";
  }
  return null;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/**
 * Where "Book Your Free Onboarding Call" goes: the company's own portal, which
 * opens Bryan's calendar on arrival (`?book-call=1`). Since 23 Nov 2026 the
 * calendar is our own (onboarding_call_bookings), not the GoHighLevel widget.
 */
export function portalBookingLink(slug: string): string {
  return `https://${slug}.portal.drive-247.com/?book-call=1`;
}

/**
 * The old GoHighLevel calendar, pre-filled with the address the booking
 * webhook matches a tenant by. Kept for anything still on it; the journey
 * emails use `portalBookingLink`.
 */
export function bookingLink(email: string): string {
  const url = new URL(ONBOARDING_BOOKING_URL);
  if (email) url.searchParams.set("email", email);
  return url.toString();
}

const COPY: Record<JourneyEmail, { eyebrow: string; subject: string; preheader: string; title: (company: string) => string; body: string[] }> = {
  welcome: {
    eyebrow: "Welcome to Drive247",
    subject: "Welcome to Drive247: your 14-day free trial has started",
    preheader: "Your trial includes a free 30-minute onboarding call with Bryan.",
    title: (company) => `Welcome aboard, ${company}`,
    body: [
      "Your 14-day free trial has started, and your account is ready to use right now.",
      "Your trial includes a complimentary 30-minute onboarding session with Bryan, so you get the most out of the platform from day one.",
    ],
  },
  reminder: {
    eyebrow: "Free onboarding call",
    subject: "Your free onboarding call with Bryan is waiting",
    preheader: "Pick a time for your free 30-minute setup call.",
    title: (company) => `Let&rsquo;s get ${company} set up`,
    body: [
      "Your Drive247 trial includes a complimentary 30-minute onboarding session with Bryan. He will walk you through the platform and help get your business ready to take bookings.",
      "Pick any time that suits you:",
    ],
  },
  follow_up: {
    eyebrow: "Free onboarding call",
    subject: "Still time to book your free session with Bryan",
    preheader: "Bryan can set up the essentials with you in 30 minutes.",
    title: (company) => `Make the most of your trial, ${company}`,
    body: [
      "You have not booked your complimentary onboarding session yet. In 30 minutes, Bryan can set up the essentials with you, so you can start taking bookings sooner.",
      "It is free as part of your trial. Choose a time here:",
    ],
  },
};

export function journeySubject(step: JourneyEmail): string {
  return COPY[step].subject;
}

export function buildJourneyHtml(step: JourneyEmail, t: { slug: string; companyName: string; email: string }): string {
  const copy = COPY[step];
  const company = esc(t.companyName || "your rental business");
  const portal = esc(`https://${t.slug}.portal.drive-247.com`);
  return renderDrive247Email({
    preheader: copy.preheader,
    eyebrow: copy.eyebrow,
    title: copy.title(company),
    intro: copy.body,
    cta: { label: "Book Your Free Onboarding Call", href: esc(portalBookingLink(t.slug)) },
    steps: {
      heading: "In 30 minutes, Bryan will help you",
      items: [
        "Configure your account and <strong>add your vehicles</strong>",
        "See how bookings reach you from your booking site",
        "Choose how you get paid and <strong>set up payments</strong>",
      ],
    },
    note: `The call is optional and free. You can start using Drive247 straight away from ${emailLink(portal, "your portal")}.`,
  });
}

export type CallEventKind = "booked" | "cancelled" | "noshow" | "showed";

/** What a calendar event writes to the tenant's row. */
export function callEventValues(
  kind: CallEventKind,
  row: { call_booked_at?: string | null; call_completed_at?: string | null } | null,
  startsAt: string | null,
  nowIso: string,
): Record<string, unknown> {
  if (kind === "booked") {
    return {
      call_booked_at: row?.call_booked_at ?? nowIso,
      call_booked_via: "calendar",
      call_scheduled_for: startsAt,
      call_cancelled_at: null,
      call_missed_at: null,
    };
  }
  if (kind === "showed") {
    return { call_completed_at: row?.call_completed_at ?? nowIso, call_cancelled_at: null, call_missed_at: null };
  }
  // Clearing the booking is what lets the customer book again.
  return {
    call_booked_at: null,
    call_booked_via: null,
    call_scheduled_for: null,
    booking_notified_for: null,
    ...(kind === "noshow" ? { call_missed_at: nowIso } : { call_cancelled_at: nowIso }),
  };
}

export interface BookingNotice {
  companyName: string;
  /** "City and state" from the signup, so the business can be looked up online. */
  cityState?: string | null;
  slug: string;
  bookerName: string;
  bookerEmail: string;
  phone?: string | null;
  startsAt: string;
  timezone?: string | null;
  subscriptionStatus?: string | null;
  trialEnd?: string | null;
  plan?: string | null;
  signedUpAt: string;
  vehicleCount: number;
  hasLogo: boolean;
  heardAbout?: string | null;
  /** "How many cars do you rent out?" from the signup: "1-5" | "6-20" | "21+". */
  fleetSize?: string | null;
  /** When the card step's "Not ready just yet?" 20% offer was shown, if it was. */
  exitOfferSeenAt?: string | null;
}

/** "6-20" -> "6–20 cars", for people rather than databases. */
export function fleetSizeLabel(fleetSize: string | null | undefined): string {
  if (!fleetSize) return "Not answered";
  return `${fleetSize.replace("-", "–")} cars`;
}

function formatCallTime(iso: string, timezone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  };
  try {
    return new Date(iso).toLocaleString("en-US", { ...options, timeZone: timezone || "UTC" });
  } catch {
    return new Date(iso).toLocaleString("en-US", { ...options, timeZone: "UTC" });
  }
}

const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Bryan's email about a new or moved booking: who it is and where their account stands. */
export function buildBookingNoticeHtml(n: BookingNotice): string {
  const rows: [string, string][] = [
    ["Call time", formatCallTime(n.startsAt, n.timezone)],
    ["Company", n.companyName],
    ["City and state", n.cityState?.trim() || "Not given"],
    ["Booked by", [n.bookerName, n.bookerEmail].filter(Boolean).join(" · ")],
    ["Phone", n.phone || "Not given"],
    ["Plan", [n.plan, n.subscriptionStatus].filter(Boolean).join(" · ") || "Unknown"],
    ["Trial ends", n.trialEnd ? dateOnly(n.trialEnd) : "Not on a trial"],
    ["Signed up", dateOnly(n.signedUpAt)],
    ["Vehicles added", String(n.vehicleCount)],
    ["Logo uploaded", n.hasLogo ? "Yes" : "No"],
    ["Heard about us", n.heardAbout || "Not answered"],
    ["Fleet size", fleetSizeLabel(n.fleetSize)],
    ["20% offer", n.exitOfferSeenAt ? `Shown ${dateOnly(n.exitOfferSeenAt)}` : "Not shown"],
    ["Portal", `${n.slug}.portal.drive-247.com`],
  ];
  const cells = rows
    .map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;font-size:13px;color:#737373;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:8px 0;font-size:13px;color:#080812;font-weight:500;">${esc(v)}</td></tr>`)
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="margin:0 0 16px;font-size:20px;color:#080812;">New onboarding call: ${esc(n.companyName)}</h1>
    <table role="presentation" cellpadding="0" cellspacing="0">${cells}</table>
  </div>`;
}
