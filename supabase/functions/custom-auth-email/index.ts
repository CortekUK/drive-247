/**
 * Custom Auth Email Hook
 *
 * Supabase Auth "Send Email" hook that intercepts default auth emails
 * (signup confirmation, password reset, magic link, etc.) and sends
 * tenant-branded versions via Resend.
 *
 * Configure in Supabase Dashboard → Authentication → Hooks → Send Email
 * Set the URI to this function's URL.
 *
 * SIGNED CALLS ONLY. `verify_jwt = false` makes this URL public, so every call
 * must carry Supabase Auth's Standard Webhooks signature, checked against
 * SEND_EMAIL_HOOK_SECRET. Without that check anyone could make Drive247 send a
 * branded "reset your password" email with a link of their choosing to any
 * address. A missing secret refuses every call rather than skipping the check.
 *
 * RECOVERY IS SENT. Portal staff reset their password with
 * `supabase.auth.resetPasswordForEmail`, which reaches this hook as `recovery`;
 * skipping it (as this used to, "handled via OTP") left staff with no way back
 * in — the OTP reset only exists on the booking site. Only `signup` is skipped:
 * accounts are created confirmed (signup-begin / admin API, autoconfirm on).
 *
 * CODES OR LINKS. A request whose `redirect_to` carries `otp=1` gets a
 * six-digit code instead of a button (the v2 portal: profile email change,
 * password-change check, v2 login's forgot password). The code is Supabase's
 * own OTP — the app checks it with `auth.verifyOtp`, nothing here verifies
 * anything. Every other caller (v1 portal, booking site) keeps its links.
 * The marker only picks the FORMAT; it never decides where a link goes.
 *
 * EMAIL CHANGE GOES TO BOTH ADDRESSES. With "Secure email change" on, Supabase
 * needs the change confirmed from the current address AND the new one. This
 * used to send one email, to the current address only, so the new address
 * never got anything and no change could finish. Note Supabase's naming:
 * `token` / `token_hash` belong to the NEW address, `token_new` /
 * `token_hash_new` to the CURRENT one.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import {
  getTenantBranding,
  sendResendEmail,
  type TenantBranding,
} from "../_shared/resend-service.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOOK_SECRET = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace("v1,whsec_", "");

/** Characters that would break out of the HTML they are interpolated into. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only our own domains may receive the auth tokens a verify link redirects with. */
function isAllowedRedirect(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:") return false;
    return (
      hostname === "drive-247.com" ||
      hostname.endsWith(".drive-247.com") ||
      hostname.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
}

/** Is this the project's site URL itself, with no path of its own? */
function isBareSiteUrl(url: string | undefined, siteUrl: string | undefined): boolean {
  if (!url) return false;
  try {
    const target = new URL(url);
    const site = new URL(siteUrl || "https://drive-247.com");
    return target.origin === site.origin && (target.pathname === "/" || target.pathname === "") && !target.search;
  } catch {
    return false;
  }
}

interface AuthEmailHookPayload {
  user: {
    id: string;
    email: string;
    new_email?: string;
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
function buildRedirectUrl(
  tenantSlug: string | undefined,
  isStaff: boolean,
  actionType: string,
): string {
  if (isStaff) {
    // Staff live on the portal; a reset lands on its reset-password page.
    const path = actionType === "recovery" ? "/reset-password" : "/";
    return tenantSlug
      ? `https://${tenantSlug}.portal.drive-247.com${path}`
      : `https://admin.drive-247.com/admin/login`;
  }
  if (!tenantSlug) {
    return "https://drive-247.com/auth/callback";
  }
  return `https://${tenantSlug}.drive-247.com/auth/callback`;
}

/**
 * Generate the full branded HTML email for a given action type.
 * Uses tenant branding colors (primaryColor, accentColor), logo, and company name throughout.
 */
/** Was this email asked for as a six-digit code? See the header. */
function wantsCode(redirectTo: string | undefined): boolean {
  if (!redirectTo) return false;
  try {
    return new URL(redirectTo).searchParams.get("otp") === "1";
  } catch {
    return false;
  }
}

/**
 * Who is this email-change message going to? `new` is the address being
 * moved TO, `current` the one being moved FROM. Only email_change uses it.
 */
type ChangeLeg = "new" | "current";

function buildBrandedEmail(
  actionType: string,
  confirmationUrl: string,
  branding: TenantBranding,
  code?: string,
  leg?: ChangeLeg,
): { subject: string; html: string } {
  const companyName = escapeHtml(branding.companyName);
  const { logoUrl, primaryColor, accentColor, contactEmail } = branding;
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

  if (code) {
    buttonLabel = "";
    switch (actionType) {
      case "recovery":
        heading = "Reset Your Password";
        bodyText = `Use this code to reset the password for your ${companyName} account.`;
        footerNote = `If you didn't ask to reset your password, you can ignore this email. Your password stays the same.`;
        break;
      case "magiclink":
        heading = "Confirm It's You";
        bodyText = `Use this code to confirm it's you on your ${companyName} account.`;
        footerNote = `If you didn't ask for this code, you can ignore this email. Nothing changes without it.`;
        break;
      case "email_change":
        heading = leg === "current" ? "Confirm Your Email Change" : "Confirm Your New Email";
        bodyText =
          leg === "current"
            ? `Someone asked to move your ${companyName} account to a new email address. Use this code to confirm it was you.`
            : `Use this code to confirm this as the new email address for your ${companyName} account.`;
        footerNote = `If you didn't ask for this change, don't share this code and contact support right away.`;
        break;
    }
  }

  const subject = code
    ? actionType === "recovery"
      ? `Your ${companyName} password reset code`
      : actionType === "email_change"
        ? `Your ${companyName} email change code`
        : `Your ${companyName} verification code`
    : actionType === "signup"
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

              ${
                code
                  ? `<!-- Code -->
              <div style="text-align: center; margin: 32px 0;">
                <div style="display: inline-block; background: #f5f5f5; border-radius: 10px; padding: 16px 28px; font-family: 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 10px; color: ${primaryColor};">${escapeHtml(code)}</div>
                <p style="margin: 14px 0 0; color: #999999; font-size: 13px;">This code expires in 1 hour.</p>
              </div>
              ${footerNote ? `<p style="margin: 24px 0 0; color: #999999; font-size: 13px; line-height: 1.5;">${footerNote}</p>` : ""}`
                  : `<!-- CTA Button -->
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
              </div>`
              }
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

  if (!HOOK_SECRET) {
    console.error("custom-auth-email: SEND_EMAIL_HOOK_SECRET is not set; refusing");
    return new Response(JSON.stringify({ error: "Hook not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: AuthEmailHookPayload;
  try {
    const raw = await req.text();
    payload = new Webhook(HOOK_SECRET).verify(
      raw,
      Object.fromEntries(req.headers),
    ) as AuthEmailHookPayload;
  } catch {
    console.warn("custom-auth-email: rejected a call with a missing or invalid signature");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { user, email_data } = payload;

    console.log(
      "Custom auth email hook triggered:",
      email_data.email_action_type,
      "for",
      user.email
    );

    /*
     * Signup confirmation is skipped; RECOVERY is not, and that distinction is
     * the whole of this block.
     *
     * Signup genuinely is handled elsewhere: `signup-begin` issues its own code
     * and `signup-verify-otp` checks it, so a second confirmation email from
     * here would be a duplicate.
     *
     * Recovery was skipped on the same reasoning — "handled via OTP flow
     * (send-verification-otp / verify-otp / reset-password-with-otp)" — but
     * nothing ever called that flow. Grepping apps/portal and apps/admin for
     * those three functions finds one COMMENT and no code. So both login
     * screens called `supabase.auth.resetPasswordForEmail`, Supabase asked this
     * hook to send the recovery mail, and this branch threw it away. The
     * request succeeded, the UI said "Check your email", and nothing was ever
     * sent — for every operator, on every tenant, since the hook shipped.
     *
     * It is also the safer of the two routes, not merely the quicker. Supabase
     * mints a single-use recovery token it verifies itself, which is what
     * proves control of the mailbox. `reset-password-with-otp` does not verify
     * anything: it takes { email, new_password }, finds the auth user and sets
     * the password, with no check of the code it is named after. Wiring the
     * portal to that would have re-created the hole the login screen's own
     * comment describes.
     */
    if (email_data.email_action_type === "signup") {
      console.log(
        `Skipping signup email for ${user.email} — handled by signup-begin's own OTP`
      );
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

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

    // Portal staff and super admins live in app_users. Checked even when the
    // tenant is already known: it decides where the link sends them.
    let isStaff = false;
    if (user.id) {
      const { data: appUser } = await supabaseAdmin
        .from("app_users")
        .select("tenant_id")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (appUser) {
        isStaff = true;
        if (!tenantId && appUser.tenant_id) tenantId = appUser.tenant_id;
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

    // Use the client-provided redirect URL if it's a valid production URL,
    // otherwise build one from the tenant slug (covers localhost/missing cases)
    //
    // A recovery link that comes back as the bare site URL was SWAPPED, not
    // asked for: Supabase replaces a redirect_to missing from the auth allow
    // list with the site URL (drive-247.com, the sales page). That is how the
    // custom-domain tenants' reset links landed staff on the sales page (Oct 21
    // 2026, Posh2Lux at portal.posh2luxcars.com). Their domains are on the list
    // now; a domain added later and not listed falls back to the tenant's
    // *.portal.drive-247.com address, which always is.
    const clientRedirect = email_data.redirect_to;
    const swappedForSiteUrl =
      email_data.email_action_type === "recovery" && isBareSiteUrl(clientRedirect, email_data.site_url);
    const redirectTo = isAllowedRedirect(clientRedirect) && !swappedForSiteUrl
      ? clientRedirect
      : buildRedirectUrl(
          tenantSlug || (tenantId ? branding.slug : undefined),
          isStaff,
          email_data.email_action_type,
        );

    const actionType = email_data.email_action_type;
    /*
     * Code or link. The `otp=1` marker is not enough on its own: Supabase
     * replaces a redirect_to that is not on the project's allow list with the
     * site URL, so from localhost the marker never arrives. So portal STAFF
     * always get codes for the two actions only the v2 profile triggers for
     * them — email change and the password-change check (magiclink). Recovery
     * stays marker-only: v1's login still sends staff a reset LINK, and a code
     * there would leave them nowhere to type it. Customers keep their links.
     */
    const asCode =
      wantsCode(clientRedirect) ||
      (isStaff && (actionType === "email_change" || actionType === "magiclink"));

    /*
     * One message per recipient. Everything but email_change is one message to
     * the account's address. email_change is one to the NEW address and — when
     * Supabase issued a second token, i.e. Secure email change is on — one to
     * the CURRENT address. See the header for which token belongs to which.
     */
    const messages: { to: string; token: string; tokenHash: string; leg?: ChangeLeg }[] = [];
    if (actionType === "email_change") {
      const newAddress = user.new_email;
      if (newAddress && email_data.token_hash) {
        messages.push({ to: newAddress, token: email_data.token, tokenHash: email_data.token_hash, leg: "new" });
      }
      if (email_data.token_hash_new) {
        messages.push({ to: user.email, token: email_data.token_new ?? "", tokenHash: email_data.token_hash_new, leg: "current" });
      }
      if (!messages.length) {
        // No new address in the payload: keep the old behaviour rather than send nothing.
        messages.push({ to: user.email, token: email_data.token, tokenHash: email_data.token_hash });
      }
    } else {
      messages.push({ to: user.email, token: email_data.token, tokenHash: email_data.token_hash });
    }

    for (const message of messages) {
      const confirmationUrl = buildVerificationUrl(message.tokenHash, actionType, redirectTo);
      const { subject, html } = buildBrandedEmail(
        actionType,
        confirmationUrl,
        branding,
        asCode && message.token ? message.token : undefined,
        message.leg,
      );

      // Send via Resend with tenant-specific sender
      const result = await sendResendEmail(
        { to: message.to, subject, html, tenantId },
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
        actionType,
        asCode ? "(code)" : "(link)",
        message.leg ?? ""
      );
    }

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
