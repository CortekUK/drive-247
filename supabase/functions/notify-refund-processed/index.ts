import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { getTenantTwilioCredentials, sendTenantSMS, normalizePhoneNumber } from '../_shared/twilio-sms-client.ts';
import { sendEmail, getTenantBranding, wrapWithBrandedTemplate } from "../_shared/resend-service.ts";
import { notifyOperatorsInApp } from "../_shared/notify-inapp.ts";
import { renderEmail, resolveEmailData } from "../_shared/email-template-service.ts";
import { formatCurrency } from "../_shared/format-utils.ts";

interface NotifyRequest {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  bookingRef: string;
  refundAmount: number;
  refundType: "full" | "partial";
  originalAmount?: number;
  refundReason?: string;
  expectedDays?: number;
  last4?: string;
  rentalId?: string;
  tenantId?: string;

  // --- added for captured security deposits -------------------------------
  /** Ledger category refunded, e.g. 'Security Deposit'. Drives the copy. */
  category?: string;
  /** What Stripe ACTUALLY sent back. May be less than refundAmount when the
   *  PaymentIntent had less headroom left; the customer must be told the real
   *  figure, not the requested one. */
  stripeRefundAmount?: number;
  stripeRefundId?: string;
  /** Running total refunded for this category on this rental. */
  totalRefunded?: number;
  /** Still held / still refundable for this category. */
  remainingHeld?: number;
  /** True when the payments status-change trigger already raised the operator
   *  bell for this refund. That trigger fires ONLY on the first transition into
   *  a refunded status and dedupes forever on payment_id, so every SUBSEQUENT
   *  partial refund is silent unless we raise the bell here. */
  operatorBellAlreadyRaised?: boolean;
}

// Escapes into HTML text context. Refund reasons are operator free-text and go
// straight into the customer's email.
const escapeHtml = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const getEmailHtml = (data: NotifyRequest, currencyCode: string) => {
  const expectedDays = data.expectedDays || 5;

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Refund Processed - DRIVE 247</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                            <h1 style="margin: 0; color: #C5A572; font-size: 28px; letter-spacing: 2px;">DRIVE 247</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 30px 0; text-align: center;">
                            <span style="display: inline-block; background: #ecfdf5; color: #10b981; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                REFUND PROCESSED
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Good news! We have processed a ${data.refundType} refund for your booking.
                                The funds should appear in your account within ${expectedDays}-10 business days.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #ecfdf5; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 25px; text-align: center;">
                                        <p style="margin: 0 0 5px; color: #047857; font-size: 14px;">Refund Amount</p>
                                        <p style="margin: 0; color: #10b981; font-size: 36px; font-weight: 700;">${formatCurrency(data.refundAmount, currencyCode)}</p>
                                        ${data.last4 ? `<p style="margin: 10px 0 0; color: #047857; font-size: 14px;">To card ending in ${data.last4}</p>` : ''}
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Booking Reference:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.bookingRef}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Refund Type:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.refundType === "full" ? "Full Refund" : "Partial Refund"}</td>
                                            </tr>
                                            ${data.originalAmount ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Original Amount:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${formatCurrency(data.originalAmount, currencyCode)}</td>
                                            </tr>
                                            ` : ''}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            ${data.refundReason ? `
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #0369a1; font-size: 14px;">Refund Reason</h3>
                                        <p style="margin: 0; color: #0369a1; font-size: 14px; line-height: 1.6;">${data.refundReason}</p>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #92400e; font-size: 14px;">Processing Time</h3>
                                        <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
                                            Refunds typically take ${expectedDays}-10 business days to appear on your statement, depending on your bank.
                                            If you don't see the refund after 10 business days, please contact your bank or our support team.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Thank you for choosing DRIVE 247. We hope to serve you again in the future.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="text-align: center; padding: 20px 0;">
                                        <a href="mailto:support@drive-247.com" style="display: inline-block; background: #C5A572; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">Contact Support</a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background: #f8f9fa; padding: 25px 30px; border-radius: 0 0 12px 12px; text-align: center;">
                            <p style="margin: 0 0 10px; color: #666; font-size: 14px;">
                                Questions? Email us at <a href="mailto:support@drive-247.com" style="color: #C5A572; text-decoration: none;">support@drive-247.com</a>
                            </p>
                            <p style="margin: 0; color: #999; font-size: 12px;">&copy; 2024 DRIVE 247. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;
};

// sendEmail is now imported from resend-service.ts

async function sendSMS(phoneNumber: string, message: string, supabaseClient?: any, tenantId?: string) {
  if (!phoneNumber) {
    console.log('[SMS] No phone number provided, skipping');
    return { success: true, skipped: true };
  }
  if (!supabaseClient || !tenantId) {
    console.log('[SMS] No supabase client or tenantId, skipping SMS');
    return { success: true, skipped: true };
  }
  try {
    const creds = await getTenantTwilioCredentials(supabaseClient, tenantId);
    if (!creds.isConfigured) {
      console.log(`[SMS] Twilio not configured for tenant ${tenantId}, skipping`);
      return { success: true, skipped: true };
    }
    const normalized = normalizePhoneNumber(phoneNumber);
    return await sendTenantSMS(creds, normalized, message);
  } catch (err: any) {
    console.error('[SMS] Error sending via Twilio:', err.message);
    return { success: false, error: err.message };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: NotifyRequest = await req.json();
    console.log('Sending refund notification for:', data.bookingRef);

    // Create supabase client for tenant-specific operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch tenant currency code
    let currencyCode = 'USD';
    if (data.tenantId) {
      const { data: tenantInfo } = await supabase
        .from('tenants')
        .select('currency_code')
        .eq('id', data.tenantId)
        .single();
      currencyCode = tenantInfo?.currency_code || 'USD';
    }

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
    };

    // Build customer email using template service if tenantId is provided
    let customerSubject = `Refund Processed - ${formatCurrency(data.refundAmount, currencyCode)} | DRIVE 247`;
    let customerHtml = getEmailHtml(data, currencyCode);
    let resolvedEmail = data.customerEmail;
    let resolvedPhone = data.customerPhone;

    if (data.tenantId) {
      try {
        const templateData = await resolveEmailData(supabase, {
          rentalId: data.rentalId,
          tenantId: data.tenantId,
          overrides: {
            customer_name: data.customerName,
            customer_email: data.customerEmail,
            rental_number: data.bookingRef,
            refund_amount: formatCurrency(data.refundAmount, currencyCode),
          },
        });

        // Use resolved data for sending if caller didn't provide them
        resolvedEmail = resolvedEmail || templateData.customer_email || '';
        resolvedPhone = resolvedPhone || templateData.customer_phone || '';

        const rendered = await renderEmail(supabase, data.tenantId, 'refund_processed', templateData);
        customerSubject = rendered.subject;
        customerHtml = rendered.html;
        console.log('Using custom/default email template for customer');
      } catch (templateError) {
        console.warn('Error rendering email template, using fallback:', templateError);
      }
    }

    // A deposit refund cannot be expressed by the shared `refund_processed`
    // template: it has only {{rental_number}} and {{refund_amount}}, so a
    // partial refund reads exactly like a full one and the customer is never
    // told how much was kept. Build it properly instead, branded per tenant.
    const isDeposit = (data.category || '').toLowerCase() === 'security deposit';
    // Quote what Stripe ACTUALLY returned. When the PaymentIntent had less
    // headroom than requested, refundAmount is the recorded figure and
    // stripeRefundAmount is the money that really moved — telling the customer
    // the larger number would be a false promise.
    const actualAmount = typeof data.stripeRefundAmount === 'number'
      ? data.stripeRefundAmount
      : data.refundAmount;

    if (isDeposit && data.tenantId) {
      try {
        const branding = await getTenantBranding(data.tenantId, supabase);
        const kept = typeof data.remainingHeld === 'number' ? data.remainingHeld : null;
        const rows = `
          <tr><td style="padding:0 0 16px 0;font-size:16px;color:#333;">
            Hi ${escapeHtml(data.customerName || 'there')},
          </td></tr>
          <tr><td style="padding:0 0 16px 0;font-size:15px;color:#555;line-height:1.6;">
            We&#39;ve returned <strong>${formatCurrency(actualAmount, currencyCode)}</strong> of your
            security deposit for booking <strong>${escapeHtml(data.bookingRef || '')}</strong>.
          </td></tr>
          <tr><td style="padding:0 0 16px 0;">
            <table width="100%" cellpadding="8" cellspacing="0" style="border:1px solid #eee;border-radius:6px;font-size:14px;color:#444;">
              <tr><td style="color:#777;">Refunded now</td><td align="right"><strong>${formatCurrency(actualAmount, currencyCode)}</strong></td></tr>
              ${typeof data.totalRefunded === 'number'
                ? `<tr><td style="color:#777;">Returned in total</td><td align="right">${formatCurrency(data.totalRefunded, currencyCode)}</td></tr>`
                : ''}
              ${kept !== null && kept > 0
                ? `<tr><td style="color:#777;">Still held</td><td align="right">${formatCurrency(kept, currencyCode)}</td></tr>`
                : ''}
            </table>
          </td></tr>
          ${data.refundReason ? `<tr><td style="padding:0 0 16px 0;font-size:14px;color:#555;line-height:1.6;">
            <strong>Reason:</strong> ${escapeHtml(data.refundReason)}
          </td></tr>` : ''}
          <tr><td style="padding:0 0 8px 0;font-size:14px;color:#777;line-height:1.6;">
            It usually reaches your account in ${data.expectedDays || 5}&ndash;10 business days, depending on your bank.
            ${kept !== null && kept > 0 ? 'Any remaining balance is returned once your rental is fully settled.' : ''}
          </td></tr>`;
        customerHtml = wrapWithBrandedTemplate(rows, branding);
        customerSubject = `Deposit refund of ${formatCurrency(actualAmount, currencyCode)} — ${branding.companyName}`;
        console.log('Using deposit-specific branded email');
      } catch (e) {
        console.warn('Deposit email build failed, falling back to template:', e);
      }
    }

    // Send customer email
    if (resolvedEmail) {
      results.customerEmail = await sendEmail(
        resolvedEmail,
        customerSubject,
        customerHtml
      );
      console.log('Customer email result:', results.customerEmail);
    } else {
      console.warn('No customer email available, skipping email send');
    }

    // Send customer SMS
    if (resolvedPhone) {
      results.customerSMS = await sendSMS(
        resolvedPhone,
        `Your refund of ${formatCurrency(actualAmount, currencyCode)} for booking ${data.bookingRef} has been processed. Please allow 5-10 business days.`,
        supabase,
        data.tenantId
      );
      console.log('Customer SMS result:', results.customerSMS);
    }

    // Operator side. The bell is unconditional (never gated on a tenant toggle)
    // and inserting it is what triggers notify-operator-email, so this single
    // call covers both the in-app bell and the branded operator email. We do NOT
    // also send an explicit operator email — that is the notify-fine-recorded
    // double-send bug.
    //
    // dedupeKey is the STRIPE REFUND ID, not the payment id: each refund is its
    // own event. The payments trigger dedupes on payment_id forever, which is
    // why every partial refund after the first is otherwise silent.
    if (data.tenantId && !data.operatorBellAlreadyRaised) {
      const label = data.category ? `${data.category} refund` : 'Refund';
      await notifyOperatorsInApp({
        tenantId: data.tenantId,
        type: 'refund_processed',
        title: `${label} processed`,
        message:
          `${formatCurrency(actualAmount, currencyCode)} refunded to ${data.customerName || 'the customer'}` +
          (data.bookingRef ? ` for booking ${data.bookingRef}` : '') +
          (typeof data.remainingHeld === 'number' && data.remainingHeld > 0
            ? `. ${formatCurrency(data.remainingHeld, currencyCode)} still held.`
            : '.'),
        link: data.rentalId ? `/rentals/${data.rentalId}` : '/payments',
        metadata: {
          rental_id: data.rentalId ?? null,
          category: data.category ?? null,
          amount: actualAmount,
          total_refunded: data.totalRefunded ?? null,
          remaining_held: data.remainingHeld ?? null,
          stripe_refund_id: data.stripeRefundId ?? null,
        },
        dedupeKey: data.stripeRefundId || undefined,
      });
      (results as Record<string, unknown>).operatorBell = true;
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error sending notifications:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
