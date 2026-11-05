// @ts-nocheck — Deno edge function helper.
//
// Opens an ID-verification session for one driver on a rental and emails them
// the link. Used by send-additional-driver-invite (staff) and
// customer-secondary-driver (renters). The caller has already checked that the
// person asking may do this.
//
// Mirrors what create-ai-verification-session does for primary customers, but:
//   - identity_verifications.customer_id is NULL (these drivers are not customers).
//   - external_user_id is "additional_driver_<driver_id>" so the completion
//     handler in process-ai-verification can route results back to the
//     rental_additional_drivers row.

import { sendEmail, getTenantBranding, wrapWithBrandedTemplate } from "./resend-service.ts";

// QR session lives 3 hours (matches create-ai-verification-session).
const QR_TTL_MS = 3 * 60 * 60 * 1000;

export interface InviteDriver {
  id: string;
  tenant_id: string;
  rental_id: string;
  name: string;
  email: string | null;
  listing_only?: boolean | null;
}

export type InviteResult =
  | { ok: true; verificationUrl: string; verificationId: string; emailSent: boolean }
  | { ok: false; error: string };

function generateQRToken(): string {
  const uuid = crypto.randomUUID();
  const ts = Date.now().toString(36);
  return `${uuid}-${ts}`;
}

function buildVerifyUrl(tenantSlug: string, qrToken: string): string {
  const explicit = Deno.env.get("BOOKING_APP_URL");
  if (explicit) return `${explicit}/verify/${qrToken}`;
  return `https://${tenantSlug}.drive-247.com/verify/${qrToken}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function verifyButton(verificationUrl: string): string {
  return `
    <p style="text-align:center;margin:24px 0;">
      <a href="${verificationUrl}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">
        Verify Your Licence
      </a>
    </p>`;
}

function fallbackLink(verificationUrl: string): string {
  return `<p style="color:#737373;font-size:12px;">If the button doesn't work, copy and paste this URL into your browser:<br/>${verificationUrl}</p>`;
}

function inviteEmailHtml(driverName: string, verificationUrl: string, companyName: string): string {
  return `
    <p>Hi ${escapeHtml(driverName)},</p>
    <p>You have been added as an additional driver on a vehicle rental with <strong>${escapeHtml(companyName)}</strong>.</p>
    <p>To complete the process, please verify your driving licence using the secure link below. The link works on mobile and desktop and is valid for 3 hours — your operator can resend if it expires.</p>
    ${verifyButton(verificationUrl)}
    <p>You will also receive a separate email shortly to sign the rental agreement.</p>
    ${fallbackLink(verificationUrl)}
  `;
}

function secondaryDriverEmailHtml(driverName: string, verificationUrl: string, companyName: string): string {
  return `
    <p>Hi ${escapeHtml(driverName)},</p>
    <p>You have been named as a secondary driver on a vehicle rental with <strong>${escapeHtml(companyName)}</strong>.</p>
    <p>Please verify your driving licence using the secure link below. The link works on mobile and desktop and is valid for 3 hours. If it expires, ask the person who added you to send a new one.</p>
    ${verifyButton(verificationUrl)}
    <p>Verifying your licence does not add you to the rental agreement or the insurance policy. Both cover the primary driver only, and you are not authorized to drive this vehicle under the agreement.</p>
    ${fallbackLink(verificationUrl)}
  `;
}

export async function sendAdditionalDriverInvite(supabase: any, driver: InviteDriver): Promise<InviteResult> {
  if (!driver.email) {
    return { ok: false, error: "Cannot send email — driver has no email address" };
  }

  // Tenant slug is needed for the verify URL; company_name + branding for the
  // email shell.
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("slug, company_name")
    .eq("id", driver.tenant_id)
    .single();
  if (tenantErr || !tenant?.slug) {
    return { ok: false, error: "Tenant slug not found — cannot build verification URL" };
  }

  // Build the QR session.
  const qrToken = generateQRToken();
  const verifyUrl = buildVerifyUrl(tenant.slug, qrToken);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + QR_TTL_MS);
  const externalUserId = `additional_driver_${driver.id}`;

  // Only the newest link may open. An older one is dead the moment a new one is sent.
  const { error: retireErr } = await supabase
    .from("identity_verifications")
    .update({ qr_session_token: null })
    .eq("external_user_id", externalUserId)
    .not("qr_session_token", "is", null);
  if (retireErr) console.error("[SendInvite] retiring old links failed:", retireErr);

  // Insert verification record. customer_id is NULL because this driver is NOT
  // a `customers` row — they live in rental_additional_drivers. The
  // process-ai-verification handler reads external_user_id to figure out where
  // to route the completion.
  const { data: verification, error: vErr } = await supabase
    .from("identity_verifications")
    .insert({
      tenant_id: driver.tenant_id,
      rental_id: driver.rental_id,
      provider: "ai",
      verification_provider: "ai",
      external_user_id: externalUserId,
      session_id: sessionId,
      status: "pending",
      review_status: "pending",
      qr_session_token: qrToken,
      qr_session_expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();
  if (vErr) {
    console.error("[SendInvite] identity_verifications insert failed:", vErr);
    return { ok: false, error: `Verification insert failed: ${vErr.message}` };
  }

  // Stamp the driver row with the linkage + URL so the rental detail page can
  // show "Resend" / "Open Verification URL" buttons.
  const { error: drvUpdErr } = await supabase
    .from("rental_additional_drivers")
    .update({
      identity_verification_id: verification.id,
      verification_url: verifyUrl,
      verification_status: "pending",
    })
    .eq("id", driver.id);
  if (drvUpdErr) {
    console.error("[SendInvite] driver row update failed:", drvUpdErr);
    // Non-fatal — verification row exists; the URL can be retrieved by joining
    // on identity_verification_id from another query.
  }

  // Send the invite email. If it fails the verification row is still good, so
  // the link can be resent; the caller decides what to tell the person asking.
  let emailSent = false;
  try {
    const branding = await getTenantBranding(driver.tenant_id, supabase);
    const companyName = tenant.company_name || (branding as any)?.company_name || "Drive247";
    const body = driver.listing_only
      ? secondaryDriverEmailHtml(driver.name, verifyUrl, companyName)
      : inviteEmailHtml(driver.name, verifyUrl, companyName);
    const result = await sendEmail(
      driver.email,
      `Verify your driving licence for the upcoming rental`,
      wrapWithBrandedTemplate(body, branding),
      supabase,
      driver.tenant_id,
    );
    emailSent = result?.success === true;
    if (!emailSent) console.error("[SendInvite] email not sent:", result?.error);
  } catch (mailErr) {
    console.error("[SendInvite] email send failed:", mailErr);
  }

  return { ok: true, verificationUrl: verifyUrl, verificationId: verification.id, emailSent };
}
