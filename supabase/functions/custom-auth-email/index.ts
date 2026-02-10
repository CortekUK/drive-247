/**
 * Custom Auth Email Hook
 *
 * Supabase Auth "Send Email" hook that intercepts default auth emails
 * (signup confirmation, password reset, magic link, etc.) and sends
 * tenant-branded versions via Resend.
 *
 * Configure in Supabase Dashboard → Authentication → Hooks → Send Email
 * Set the URI to this function's URL.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getTenantBranding,
  sendResendEmail,
  type TenantBranding,
} from "../_shared/resend-service.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface AuthEmailHookPayload {
  user: {
    id: string;
    email: string;
    user_metadata?: {
      tenant_id?: string;
      tenant_slug?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type:
      | "signup"
      | "recovery"
      | "invite"
      | "magiclink"
      | "email_change";
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

/**
 * Build the Supabase verification URL that users click in the email.
 * After verification, Supabase redirects to the redirect_to URL with auth tokens.
 */
function buildVerificationUrl(
  tokenHash: string,
  type: string,
  redirectTo: string
): string {
  const params = new URLSearchParams({
    token: tokenHash,
    type,
    redirect_to: redirectTo,
  });
  return `${SUPABASE_URL}/auth/v1/verify?${params.toString()}`;
}

/**
 * Build the correct redirect URL for the tenant's booking app.
 * Uses the tenant slug to construct the proper production domain.
 */
function buildRedirectUrl(tenantSlug: string | undefined): string {
  if (!tenantSlug) {
    return "https://drive-247.com/auth/callback";
  }
  return `https://${tenantSlug}.drive-247.com/auth/callback`;
}

/**
 * Generate the full branded HTML email for a given action type.
 * Uses tenant branding colors (primaryColor, accentColor), logo, and company name throughout.
 */
function buildBrandedEmail(
  actionType: string,
  confirmationUrl: string,
  branding: TenantBranding
): { subject: string; html: string } {
  const { companyName, logoUrl, primaryColor, accentColor, contactEmail } =
    branding;
  const currentYear = new Date().getFullYear();

  // Email-specific content per action type
  let heading = "";
  let bodyText = "";
  let buttonLabel = "";
  let footerNote = "";

  switch (actionType) {
    case "signup":
      heading = `Welcome to ${companyName}!`;
      bodyText = `Thanks for signing up. Please confirm your email address to activate your account and get started.`;
      buttonLabel = "Confirm Email Address";
      footerNote = `If you didn't create an account with ${companyName}, you can safely ignore this email.`;
      break;
    case "recovery":
      heading = "Reset Your Password";
      bodyText = `We received a request to reset your password for your ${companyName} account. Click the button below to set a new password.`;
      buttonLabel = "Reset Password";
      footerNote = `If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.`;
      break;
    case "magiclink":
      heading = "Your Login Link";
      bodyText = `Click the button below to log in to your ${companyName} account.`;
      buttonLabel = "Log In";
      footerNote = `If you didn't request this link, you can safely ignore this email.`;
      break;
    case "email_change":
      heading = "Confirm Email Change";
      bodyText = `Please confirm your new email address for your ${companyName} account by clicking the button below.`;
      buttonLabel = "Confirm New Email";
      footerNote = `If you didn't request this change, please contact support immediately.`;
      break;
    default:
      heading = "Action Required";
      bodyText = `Please click the button below to complete the action for your ${companyName} account.`;
      buttonLabel = "Confirm";
      footerNote = "";
      break;
  }

  const subject =
    actionType === "signup"
      ? `Confirm your ${companyName} account`
      : actionType === "recovery"
        ? `Reset your ${companyName} password`
        : actionType === "magiclink"
          ? `Your ${companyName} login link`
          : actionType === "email_change"
            ? `Confirm your new email for ${companyName}`
            : `Action required — ${companyName}`;

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${companyName}" style="max-height: 50px; max-width: 200px;">`
    : `<h1 style="margin: 0; color: ${accentColor}; font-size: 28px; letter-spacing: 2px;">${companyName.toUpperCase()}</h1>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden;">

          <!-- Header with tenant branding -->
          <tr>
            <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #2d2d2d 100%); padding: 30px; text-align: center;">
              ${logoHtml}
            </td>
          </tr>

          <!-- Accent bar -->
          <tr>
            <td style="height: 4px; background: ${accentColor};"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 36px 30px;">
              <h2 style="margin: 0 0 16px; color: ${primaryColor}; font-size: 22px;">${heading}</h2>
              <p style="margin: 0 0 24px; color: #555555; font-size: 15px; line-height: 1.6;">
                ${bodyText}
              </p>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 32px 0;">
                <a href="${confirmationUrl}"
                   style="display: inline-block; background: ${accentColor}; color: #ffffff; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; letter-spacing: 0.5px;">
                  ${buttonLabel}
                </a>
              </div>

              ${
                footerNote
                  ? `<p style="margin: 24px 0 0; color: #999999; font-size: 13px; line-height: 1.5;">${footerNote}</p>`
                  : ""
              }

              <!-- Fallback link -->
              <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #eeeeee;">
                <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.5;">
                  If the button above doesn't work, copy and paste this link into your browser:
                </p>
                <p style="margin: 6px 0 0; word-break: break-all;">
                  <a href="${confirmationUrl}" style="color: ${accentColor}; font-size: 12px; text-decoration: none;">${confirmationUrl}</a>
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: ${primaryColor}; padding: 24px 30px; text-align: center;">
              <p style="margin: 0 0 8px; color: rgba(255,255,255,0.7); font-size: 13px;">
                Questions? Email us at
                <a href="mailto:${contactEmail}" style="color: ${accentColor}; text-decoration: none;">${contactEmail}</a>
              </p>
              <p style="margin: 0; color: rgba(255,255,255,0.4); font-size: 11px;">
                &copy; ${currentYear} ${companyName}. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const payload: AuthEmailHookPayload = await req.json();
    const { user, email_data } = payload;

    console.log(
      "Custom auth email hook triggered:",
      email_data.email_action_type,
      "for",
      user.email
    );

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve tenant from user metadata first
    let tenantId = user.user_metadata?.tenant_id as string | undefined;
    const tenantSlug = user.user_metadata?.tenant_slug as string | undefined;

    // Fallback: look up tenant from customer_users
    if (!tenantId && user.id) {
      const { data: customerUser } = await supabaseAdmin
        .from("customer_users")
        .select("tenant_id")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (customerUser?.tenant_id) {
        tenantId = customerUser.tenant_id;
      }
    }

    // Fallback: look up tenant from app_users (portal staff)
    if (!tenantId && user.id) {
      const { data: appUser } = await supabaseAdmin
        .from("app_users")
        .select("tenant_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (appUser?.tenant_id) {
        tenantId = appUser.tenant_id;
      }
    }

    // Fetch full tenant branding (colors, logo, company name, etc.)
    const branding = tenantId
      ? await getTenantBranding(tenantId, supabaseAdmin)
      : {
          companyName: "Drive 247",
          logoUrl: null,
          primaryColor: "#1a1a1a",
          accentColor: "#C5A572",
          contactEmail: "support@drive-247.com",
          contactPhone: null,
          slug: "drive247",
        };

    // Build proper redirect URL (not localhost) using tenant slug
    const redirectTo = buildRedirectUrl(tenantSlug || branding.slug);

    // Build the Supabase verification URL
    const confirmationUrl = buildVerificationUrl(
      email_data.token_hash,
      email_data.email_action_type,
      redirectTo
    );

    // Build the full branded email
    const { subject, html } = buildBrandedEmail(
      email_data.email_action_type,
      confirmationUrl,
      branding
    );

    // Send via Resend with tenant-specific sender
    const result = await sendResendEmail(
      { to: user.email, subject, html, tenantId },
      supabaseAdmin
    );

    if (!result.success) {
      console.error("Failed to send custom auth email:", result.error);
      return new Response(
        JSON.stringify({ error: result.error || "Failed to send email" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(
      "Custom auth email sent successfully:",
      result.messageId,
      "action:",
      email_data.email_action_type
    );

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Custom auth email hook error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
