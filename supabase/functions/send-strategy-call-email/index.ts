import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { sendResendEmail } from "../_shared/resend-service.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ─── Email templates ─── */

const BRAND = {
  name: "Drive247",
  color: "#4f46e5", // indigo-600
  logo: "https://drive247.co/logo-light.png",
  address: "Cortek Ltd, 71-75 Shelton Street, Covent Garden, London, WC2H 9JQ",
  // TODO: Update to UAE address when available
  unsubscribeUrl: "https://drive247.co", // TODO: Add real unsubscribe endpoint
  founderName: "George", // TODO: Set via env var {{ founder_name }}
  meetingLink: "https://calendly.com/georgerclemson/strategy-call-george-clemson",
  rescheduleLink: "https://calendly.com/georgerclemson/strategy-call-george-clemson",
};

function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background-color:#f5f5f5;">
  <table role="presentation" style="width:100%;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" style="width:600px;max-width:100%;border-collapse:collapse;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="padding:24px 30px;border-bottom:1px solid #f0f0f0;">
              <img src="${BRAND.logo}" alt="${BRAND.name}" style="height:28px;width:auto;" />
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:30px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fa;padding:20px 30px;border-radius:0 0 12px 12px;border-top:1px solid #f0f0f0;">
              <p style="margin:0 0 8px;color:#999;font-size:12px;">${BRAND.address}</p>
              <p style="margin:0;color:#999;font-size:12px;">
                <a href="${BRAND.unsubscribeUrl}" style="color:#999;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ─── Email 1: Immediate confirmation ─── */

function confirmationEmail(vars: {
  contact_name: string;
  fleet_size: string;
  current_platform: string;
}): { subject: string; html: string; text: string } {
  const firstName = vars.contact_name.split(" ")[0];

  return {
    subject: "You're booked — here's what to expect",
    html: emailWrapper(`
      <h2 style="margin:0 0 16px;font-size:22px;color:#111;">You're in, ${firstName}.</h2>
      <p style="margin:0 0 20px;color:#555;font-size:15px;line-height:1.6;">
        Your strategy call is confirmed. Here's what we'll cover in 20 minutes:
      </p>
      <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:15px;line-height:1.8;">
        <li><strong>Setup audit</strong> — where your margin is going and what's recoverable</li>
        <li><strong>Live site preview</strong> — what your direct booking site could look like</li>
        <li><strong>7-day launch plan</strong> — concrete steps and pricing for your fleet</li>
      </ul>
      <p style="margin:0 0 8px;color:#111;font-size:15px;font-weight:600;">To make the most of our time, have these ready:</p>
      <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:15px;line-height:1.8;">
        <li>Rough monthly booking volume</li>
        <li>Current platform breakdown (you mentioned: ${vars.current_platform})</li>
        <li>Your biggest operational headache</li>
      </ul>
      <p style="margin:0 0 4px;color:#555;font-size:15px;line-height:1.6;">
        Talk soon,
      </p>
      <p style="margin:0;color:#111;font-size:15px;font-weight:600;">
        ${BRAND.founderName}<br/>
        <span style="color:#555;font-weight:400;font-size:13px;">Drive247 Founding Team</span>
      </p>
    `),
    text: `You're in, ${firstName}.

Your strategy call is confirmed. Here's what we'll cover in 20 minutes:

- Setup audit — where your margin is going and what's recoverable
- Live site preview — what your direct booking site could look like
- 7-day launch plan — concrete steps and pricing for your fleet

To make the most of our time, have these ready:
- Rough monthly booking volume
- Current platform breakdown (you mentioned: ${vars.current_platform})
- Your biggest operational headache

Talk soon,
${BRAND.founderName}
Drive247 Founding Team`,
  };
}

/* ─── Email 2: 24h reminder ─── */

function reminder24hEmail(vars: {
  contact_name: string;
}): { subject: string; html: string; text: string } {
  const firstName = vars.contact_name.split(" ")[0];

  return {
    subject: "Tomorrow's call — quick prep",
    html: emailWrapper(`
      <h2 style="margin:0 0 16px;font-size:22px;color:#111;">Hey ${firstName},</h2>
      <p style="margin:0 0 20px;color:#555;font-size:15px;line-height:1.6;">
        Quick reminder — your strategy call is tomorrow. To make the most of our 20 minutes, here's what we'll cover:
      </p>
      <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:15px;line-height:1.8;">
        <li><strong>Setup audit</strong> — where margin is leaking and what's recoverable</li>
        <li><strong>Live site preview</strong> — your fleet on your own branded booking site</li>
        <li><strong>7-day launch plan</strong> — concrete next steps, tailored to your fleet</li>
      </ul>
      <p style="margin:0 0 24px;">
        <a href="${BRAND.meetingLink}" style="display:inline-block;background:${BRAND.color};color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Join the call</a>
      </p>
      <p style="margin:0 0 20px;color:#999;font-size:13px;">
        Need to reschedule? <a href="${BRAND.rescheduleLink}" style="color:${BRAND.color};text-decoration:underline;">Pick a new time</a>
      </p>
      <p style="margin:0;color:#555;font-size:15px;line-height:1.6;">
        ${BRAND.founderName}<br/>
        <span style="color:#999;font-size:13px;">Drive247 Founding Team</span>
      </p>
    `),
    text: `Hey ${firstName},

Quick reminder — your strategy call is tomorrow. Here's what we'll cover:

- Setup audit — where margin is leaking and what's recoverable
- Live site preview — your fleet on your own branded booking site
- 7-day launch plan — concrete next steps, tailored to your fleet

Join: ${BRAND.meetingLink}

Need to reschedule? ${BRAND.rescheduleLink}

${BRAND.founderName}
Drive247 Founding Team`,
  };
}

/* ─── Email 3: 1h reminder ─── */

function reminder1hEmail(vars: {
  contact_name: string;
}): { subject: string; html: string; text: string } {
  const firstName = vars.contact_name.split(" ")[0];

  return {
    subject: "See you in an hour",
    html: emailWrapper(`
      <h2 style="margin:0 0 16px;font-size:22px;color:#111;">See you soon, ${firstName}.</h2>
      <p style="margin:0 0 24px;">
        <a href="${BRAND.meetingLink}" style="display:inline-block;background:${BRAND.color};color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Join the call</a>
      </p>
      <p style="margin:0;color:#999;font-size:13px;">
        Running late? Reply to this email and we'll wait.
      </p>
    `),
    text: `See you soon, ${firstName}.

Join: ${BRAND.meetingLink}

Running late? Reply to this email and we'll wait.`,
  };
}

/* ─── Email 4a: Post-call follow-up (attended) ─── */

function followupAttendedEmail(vars: {
  contact_name: string;
  fleet_size: string;
  current_platform: string;
}): { subject: string; html: string; text: string } {
  const firstName = vars.contact_name.split(" ")[0];

  return {
    subject: "Your 7-day launch plan — as discussed",
    html: emailWrapper(`
      <h2 style="margin:0 0 16px;font-size:22px;color:#111;">Great speaking with you, ${firstName}.</h2>
      <p style="margin:0 0 20px;color:#555;font-size:15px;line-height:1.6;">
        As discussed, here's a recap of what we covered:
      </p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">
        <tr>
          <td style="padding:8px 0;color:#999;font-size:13px;vertical-align:top;width:120px;">Fleet size</td>
          <td style="padding:8px 0;color:#111;font-size:15px;">${vars.fleet_size}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#999;font-size:13px;vertical-align:top;">Current setup</td>
          <td style="padding:8px 0;color:#111;font-size:15px;">${vars.current_platform}</td>
        </tr>
      </table>
      <p style="margin:0 0 20px;color:#555;font-size:15px;line-height:1.6;">
        Your launch plan and custom pricing are attached to this conversation. If you're ready to move forward, reply to this email and we'll start your 7-day setup.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${BRAND.meetingLink}" style="display:inline-block;background:${BRAND.color};color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Let's get started</a>
      </p>
      <p style="margin:0;color:#555;font-size:15px;line-height:1.6;">
        ${BRAND.founderName}<br/>
        <span style="color:#999;font-size:13px;">Drive247 Founding Team</span>
      </p>
    `),
    text: `Great speaking with you, ${firstName}.

As discussed, here's a recap:

Fleet size: ${vars.fleet_size}
Current setup: ${vars.current_platform}

Your launch plan and custom pricing are attached to this conversation. Reply to this email to start your 7-day setup.

${BRAND.founderName}
Drive247 Founding Team`,
  };
}

/* ─── Email 4b: Post-call follow-up (no-show) ─── */

function followupNoshowEmail(vars: {
  contact_name: string;
}): { subject: string; html: string; text: string } {
  const firstName = vars.contact_name.split(" ")[0];

  return {
    subject: "Missed you — want to reschedule?",
    html: emailWrapper(`
      <h2 style="margin:0 0 16px;font-size:22px;color:#111;">Hey ${firstName},</h2>
      <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6;">
        Looks like we missed each other today. No worries — things come up. Your strategy call slot is still reserved if you'd like to rebook.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${BRAND.rescheduleLink}" style="display:inline-block;background:${BRAND.color};color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Pick a new time</a>
      </p>
      <p style="margin:0;color:#555;font-size:15px;line-height:1.6;">
        ${BRAND.founderName}<br/>
        <span style="color:#999;font-size:13px;">Drive247 Founding Team</span>
      </p>
    `),
    text: `Hey ${firstName},

Looks like we missed each other today. No worries — your strategy call slot is still reserved.

Rebook here: ${BRAND.rescheduleLink}

${BRAND.founderName}
Drive247 Founding Team`,
  };
}

/* ─── Handler ─── */

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json();
    const {
      contact_request_id,
      email_type,
      contact_name,
      email,
      fleet_size,
      current_platform,
      call_time, // ISO string, used for scheduling reminders
    } = body;

    if (!email_type || !email) {
      return errorResponse("Missing required fields: email_type, email");
    }

    // Build the appropriate email
    let emailContent: { subject: string; html: string; text: string };

    switch (email_type) {
      case "confirmation":
        emailContent = confirmationEmail({
          contact_name: contact_name || "there",
          fleet_size: fleet_size || "Not specified",
          current_platform: current_platform || "Not specified",
        });
        break;
      case "reminder_24h":
        emailContent = reminder24hEmail({
          contact_name: contact_name || "there",
        });
        break;
      case "reminder_1h":
        emailContent = reminder1hEmail({
          contact_name: contact_name || "there",
        });
        break;
      case "followup_attended":
        emailContent = followupAttendedEmail({
          contact_name: contact_name || "there",
          fleet_size: fleet_size || "Not specified",
          current_platform: current_platform || "Not specified",
        });
        break;
      case "followup_noshow":
        emailContent = followupNoshowEmail({
          contact_name: contact_name || "there",
        });
        break;
      default:
        return errorResponse(`Unknown email_type: ${email_type}`);
    }

    // Send the email via Resend
    const result = await sendResendEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      from: "support@drive-247.com",
      fromName: "Drive247",
      replyTo: "support@drive-247.com",
    });

    if (!result.success) {
      console.error("Email send failed:", result.error);
      return errorResponse(`Email send failed: ${result.error}`, 500);
    }

    // Track in strategy_call_emails table if we have a contact_request_id
    if (contact_request_id) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Record the sent email
      await supabase.from("strategy_call_emails").upsert(
        {
          contact_request_id,
          email_type,
          scheduled_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          call_time: call_time || null,
        },
        { onConflict: "contact_request_id,email_type" }
      );

      // If this is the confirmation email, schedule the reminder emails
      // TODO: Integrate with a scheduler (e.g., Supabase pg_cron, or
      // Calendly/Cal.com webhook that provides call_time).
      // For now, reminders must be triggered externally when call_time is known.
      // The flow is:
      //   1. Form submit → confirmation email (sent immediately)
      //   2. Calendar booking webhook → provides call_time
      //   3. pg_cron job or external scheduler checks strategy_call_emails
      //      for upcoming calls and fires reminder_24h, reminder_1h
      //   4. Post-call: another cron job fires followup_attended or followup_noshow
      //      based on call_status field
    }

    return jsonResponse({
      success: true,
      messageId: result.messageId,
      simulated: result.simulated || false,
    });
  } catch (error) {
    console.error("Strategy call email error:", error);
    return errorResponse("Internal server error", 500);
  }
});
