import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { sendResendEmail } from "../_shared/resend-service.ts";

const EMAIL_TYPES = new Set([
  "confirmation",
  "reminder_24h",
  "reminder_1h",
  "followup_attended",
  "followup_noshow",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0 && left.length === right.length;
}

async function isServiceRequest(request: Request): Promise<boolean> {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");
  if (!serviceRoleKey || !authorization?.startsWith("Bearer ")) return false;
  return constantTimeEqual(authorization.slice(7), serviceRoleKey);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function allowedHosts(): string[] {
  return (Deno.env.get("GHL_STRATEGY_CALL_ALLOWED_URL_HOSTS") ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function safeProviderUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const hosts = allowedHosts();
    if (
      hosts.length === 0 ||
      !hosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safeConfiguredUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatCallTime(startsAt: string, timezone: string | null): string {
  const date = new Date(startsAt);
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: timezone || "UTC",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date) + " UTC";
  }
}

function button(label: string, url: string | null): string {
  if (!url) return "";
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`;
}

function wrapper(content: string): string {
  const logo = safeConfiguredUrl(Deno.env.get("STRATEGY_CALL_EMAIL_LOGO_URL"));
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#111"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td align="center" style="padding:32px 16px"><table role="presentation" style="width:600px;max-width:100%;background:#fff;border-radius:12px;border-collapse:collapse"><tr><td style="padding:24px 30px;border-bottom:1px solid #eee">${logo ? `<img src="${escapeHtml(logo)}" alt="Drive247" style="height:28px">` : '<strong style="font-size:20px">Drive247</strong>'}</td></tr><tr><td style="padding:30px;line-height:1.6">${content}</td></tr><tr><td style="padding:20px 30px;background:#f8f9fa;color:#777;font-size:12px">Drive247 · Questions? Reply to this email.</td></tr></table></td></tr></table></body></html>`;
}

type TemplateInput = {
  emailType: string;
  contactName: string;
  fleetSize: string;
  currentPlatform: string;
  callTime: string;
  meetingUrl: string | null;
  rescheduleUrl: string | null;
  confirmationUrl: string | null;
};

function buildEmail(input: TemplateInput): {
  subject: string;
  html: string;
  text: string;
} | null {
  const firstName = escapeHtml(input.contactName.split(/\s+/)[0] || "there");
  const callTime = escapeHtml(input.callTime);
  const meetingFallback = input.meetingUrl
    ? ""
    : "Use the joining details in your GHL calendar invite.";

  if (input.emailType === "confirmation") {
    return {
      subject: "You're booked — watch these before we meet",
      html: wrapper(`<h2 style="margin:0 0 16px">Your call is booked, ${firstName}.</h2><p><strong>${callTime}</strong></p><p>Before we meet, watch four short videos explaining marketplace dependency, the Drive247 system, common questions, and who the system fits.</p>${button("Watch before the call", input.confirmationUrl)}<p>Bring your fleet details, current process, biggest blocker, and launch goal.</p>`),
      text: `Your call is booked, ${input.contactName.split(/\s+/)[0] || "there"}.\n\n${input.callTime}\n\nBefore we meet, watch the four short preparation videos${input.confirmationUrl ? `: ${input.confirmationUrl}` : "."}\n\nBring your fleet details, current process, biggest blocker, and launch goal.`,
    };
  }
  if (input.emailType === "reminder_24h") {
    return {
      subject: "Tomorrow's strategy call — quick preparation",
      html: wrapper(`<h2 style="margin:0 0 16px">See you tomorrow, ${firstName}.</h2><p><strong>${callTime}</strong></p><p>Have your fleet details, current process, biggest blocker, and launch goal ready.</p>${button("Join the call", input.meetingUrl)}<p>${escapeHtml(meetingFallback)}</p>${button("Reschedule", input.rescheduleUrl)}`),
      text: `See you tomorrow, ${input.contactName.split(/\s+/)[0] || "there"}.\n\n${input.callTime}\n${input.meetingUrl ? `Join: ${input.meetingUrl}` : meetingFallback}${input.rescheduleUrl ? `\nReschedule: ${input.rescheduleUrl}` : ""}`,
    };
  }
  if (input.emailType === "reminder_1h") {
    return {
      subject: "Your Drive247 strategy call starts in one hour",
      html: wrapper(`<h2 style="margin:0 0 16px">See you in an hour, ${firstName}.</h2><p><strong>${callTime}</strong></p>${button("Join the call", input.meetingUrl)}<p>${escapeHtml(meetingFallback)}</p>`),
      text: `See you in an hour, ${input.contactName.split(/\s+/)[0] || "there"}.\n\n${input.callTime}\n${input.meetingUrl ? `Join: ${input.meetingUrl}` : meetingFallback}`,
    };
  }
  if (input.emailType === "followup_attended") {
    return {
      subject: "Your Drive247 launch plan — as discussed",
      html: wrapper(`<h2 style="margin:0 0 16px">Great speaking with you, ${firstName}.</h2><p>We discussed your ${escapeHtml(input.fleetSize)} fleet and current ${escapeHtml(input.currentPlatform)} setup. Reply to this email with any follow-up questions and the team will help with the next steps.</p>`),
      text: `Great speaking with you, ${input.contactName.split(/\s+/)[0] || "there"}.\n\nWe discussed your ${input.fleetSize} fleet and current ${input.currentPlatform} setup. Reply with any follow-up questions.`,
    };
  }
  if (input.emailType === "followup_noshow") {
    return {
      subject: "We missed you — would you like to reschedule?",
      html: wrapper(`<h2 style="margin:0 0 16px">We missed you, ${firstName}.</h2><p>No worries — things come up. Use the verified link below if you would like to pick another time.</p>${button("Pick a new time", input.rescheduleUrl)}${input.rescheduleUrl ? "" : "<p>Reply to this email and our team will help you rebook.</p>"}`),
      text: `We missed you, ${input.contactName.split(/\s+/)[0] || "there"}.${input.rescheduleUrl ? `\n\nReschedule: ${input.rescheduleUrl}` : "\n\nReply to this email and our team will help you rebook."}`,
    };
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  if (!(await isServiceRequest(request))) return response({ error: "Unauthorized" }, 401);

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 2048) return response({ error: "Invalid request" }, 400);
  let body: { email_id?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return response({ error: "Invalid request" }, 400);
  }
  if (typeof body.email_id !== "string" || !UUID_PATTERN.test(body.email_id)) {
    return response({ error: "Invalid request" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response({ error: "Unavailable" }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: emailRow, error: rowError } = await supabase
    .from("strategy_call_emails")
    .select("id, booking_id, contact_request_id, email_type, scheduled_at, delivery_status, attempt_count, idempotency_key")
    .eq("id", body.email_id)
    .maybeSingle();
  if (rowError || !emailRow || !EMAIL_TYPES.has(emailRow.email_type)) {
    return response({ error: "Email job not found" }, 404);
  }
  if (emailRow.delivery_status === "sent" || emailRow.delivery_status === "suppressed") {
    return response({ success: true, duplicate: true });
  }
  if (new Date(emailRow.scheduled_at).getTime() > Date.now() + 30_000) {
    return response({ success: true, pending: true }, 202);
  }
  if (!emailRow.booking_id || emailRow.attempt_count >= 5) {
    return response({ error: "Email job unavailable" }, 409);
  }

  const { data: booking, error: bookingError } = await supabase
    .from("strategy_call_bookings")
    .select("id, status, scheduled_start_at, booking_timezone, meeting_url, reschedule_url, contact_request_id")
    .eq("id", emailRow.booking_id)
    .maybeSingle();
  if (bookingError || !booking || booking.contact_request_id !== emailRow.contact_request_id) {
    return response({ error: "Email job unavailable" }, 409);
  }

  const reminder = emailRow.email_type === "reminder_24h" || emailRow.email_type === "reminder_1h";
  const wrongLifecycle =
    (reminder && !["scheduled", "rescheduled"].includes(booking.status)) ||
    (emailRow.email_type === "followup_attended" && booking.status !== "completed") ||
    (emailRow.email_type === "followup_noshow" && booking.status !== "no_show") ||
    (emailRow.email_type === "confirmation" &&
      !["scheduled", "rescheduled"].includes(booking.status));
  if (wrongLifecycle) {
    const { error: suppressError } = await supabase
      .from("strategy_call_emails")
      .update({ delivery_status: "suppressed", suppressed_at: new Date().toISOString() })
      .eq("id", emailRow.id);
    if (suppressError) return response({ error: "Email state unavailable" }, 500);
    return response({ success: true, suppressed: true });
  }

  const { data: claim, error: claimError } = await supabase
    .from("strategy_call_emails")
    .update({
      delivery_status: "sending",
      attempt_count: emailRow.attempt_count + 1,
      last_attempt_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", emailRow.id)
    .in("delivery_status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (claimError) return response({ error: "Email state unavailable" }, 500);
  if (!claim) return response({ success: true, duplicate: true });

  const { data: contact, error: contactError } = await supabase
    .from("contact_requests")
    .select("contact_name, email, fleet_size, current_platform")
    .eq("id", emailRow.contact_request_id)
    .maybeSingle();
  if (contactError || !contact?.email) {
    const { error: missingRecipientStateError } = await supabase
      .from("strategy_call_emails")
      .update({ delivery_status: "failed", last_error: "recipient_missing" })
      .eq("id", emailRow.id)
      .eq("delivery_status", "sending");
    if (missingRecipientStateError) {
      return response({ error: "Email state unavailable" }, 500);
    }
    return response({ error: "Email job unavailable" }, 500);
  }

  const emailContent = buildEmail({
    emailType: emailRow.email_type,
    contactName: contact.contact_name || "there",
    fleetSize: contact.fleet_size || "current",
    currentPlatform: contact.current_platform || "current",
    callTime: formatCallTime(booking.scheduled_start_at, booking.booking_timezone),
    meetingUrl: safeProviderUrl(booking.meeting_url),
    rescheduleUrl: safeProviderUrl(booking.reschedule_url),
    confirmationUrl: safeConfiguredUrl(Deno.env.get("STRATEGY_CALL_CONFIRMATION_URL")),
  });
  if (!emailContent) return response({ error: "Email job unavailable" }, 409);

  // Recheck immediately before the external side effect. A cancellation or
  // reschedule may have suppressed this job after the initial read/claim.
  const [currentJobResult, currentBookingResult] = await Promise.all([
    supabase
      .from("strategy_call_emails")
      .select("delivery_status")
      .eq("id", emailRow.id)
      .maybeSingle(),
    supabase
      .from("strategy_call_bookings")
      .select("status")
      .eq("id", booking.id)
      .maybeSingle(),
  ]);
  if (currentJobResult.error || currentBookingResult.error) {
    return response({ error: "Email state unavailable" }, 500);
  }
  const currentJob = currentJobResult.data;
  const currentBooking = currentBookingResult.data;
  if (currentJob?.delivery_status !== "sending") {
    return response({ success: true, suppressed: true });
  }
  const noLongerEligible =
    !currentBooking ||
    (reminder && !["scheduled", "rescheduled"].includes(currentBooking.status)) ||
    (emailRow.email_type === "followup_attended" && currentBooking.status !== "completed") ||
    (emailRow.email_type === "followup_noshow" && currentBooking.status !== "no_show") ||
    (emailRow.email_type === "confirmation" &&
      !["scheduled", "rescheduled"].includes(currentBooking.status));
  if (noLongerEligible) {
    const { error: suppressError } = await supabase
      .from("strategy_call_emails")
      .update({ delivery_status: "suppressed", suppressed_at: new Date().toISOString() })
      .eq("id", emailRow.id)
      .eq("delivery_status", "sending");
    if (suppressError) return response({ error: "Email state unavailable" }, 500);
    return response({ success: true, suppressed: true });
  }

  const sendResult = await sendResendEmail({
    to: contact.email,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
    from: Deno.env.get("STRATEGY_CALL_FROM_EMAIL") || "support@drive-247.com",
    fromName: "Drive247",
    replyTo: Deno.env.get("STRATEGY_CALL_REPLY_TO_EMAIL") || "support@drive-247.com",
    idempotencyKey: emailRow.idempotency_key,
  });

  if (!sendResult.success) {
    const { error: failureStateError } = await supabase
      .from("strategy_call_emails")
      .update({
        delivery_status: "failed",
        last_error: "provider_send_failed",
      })
      .eq("id", emailRow.id)
      .eq("delivery_status", "sending");
    if (failureStateError) {
      return response({ error: "Email state unavailable" }, 500);
    }
    console.error("strategy_call_email_failed", {
      emailId: emailRow.id,
      emailType: emailRow.email_type,
    });
    return response({ error: "Email delivery failed" }, 500);
  }

  const { data: sentState, error: sentStateError } = await supabase
    .from("strategy_call_emails")
    .update({
      delivery_status: "sent",
      sent_at: new Date().toISOString(),
      provider_message_id: sendResult.messageId ?? null,
      last_error: null,
    })
    .eq("id", emailRow.id)
    .eq("delivery_status", "sending")
    .select("id")
    .maybeSingle();

  if (sentStateError || !sentState) {
    // Return retryable failure. Resend's Idempotency-Key makes the retry return
    // the original provider result instead of delivering a second email.
    console.error("strategy_call_email_sent_state_failed", {
      emailId: emailRow.id,
      emailType: emailRow.email_type,
    });
    return response({ error: "Email state persistence failed" }, 500);
  }

  return response({ success: true, simulated: sendResult.simulated || false });
});
