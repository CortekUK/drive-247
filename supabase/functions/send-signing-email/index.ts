import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { sendResendEmail, getTenantBranding, wrapWithBrandedTemplate } from '../_shared/resend-service.ts';
import { getBoldSignApiKey, getBoldSignBaseUrl } from '../_shared/boldsign-client.ts';
import type { BoldSignMode } from '../_shared/boldsign-client.ts';

interface SigningEmailRequest {
  customerEmail: string;
  customerName: string;
  documentId: string;
  companyName: string;
  rentalRef: string;
  vehicleInfo: string;
  tenantId: string;
  boldsignMode: BoldSignMode;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json() as SigningEmailRequest;

    const {
      customerEmail,
      customerName,
      documentId,
      companyName,
      rentalRef,
      vehicleInfo,
      tenantId,
      boldsignMode = 'test',
    } = body;

    if (!customerEmail || !documentId || !tenantId) {
      return errorResponse('Missing required fields: customerEmail, documentId, tenantId', 400);
    }

    console.log('Sending signing email to:', customerEmail, 'for document:', documentId);

    // Get embedded signing link from BoldSign
    const apiKey = getBoldSignApiKey(boldsignMode);
    const baseUrl = getBoldSignBaseUrl();

    const signLinkResponse = await fetch(
      `${baseUrl}/v1/document/getEmbeddedSignLink?documentId=${documentId}&signerEmail=${encodeURIComponent(customerEmail)}`,
      { headers: { 'X-API-KEY': apiKey } }
    );

    let signingLink = '';
    if (signLinkResponse.ok) {
      const signLinkData = await signLinkResponse.json();
      signingLink = signLinkData.signLink || '';
    }

    if (!signingLink) {
      console.warn('Could not get embedded signing link, email will not include direct link');
    }

    // Get tenant branding
    const branding = await getTenantBranding(tenantId, supabase);

    // Build email content
    const ctaButton = signingLink
      ? `<a href="${signingLink}" style="display: inline-block; background: ${branding.accentColor || '#C5A572'}; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 16px 0;">Review and Sign</a>`
      : '<p style="color: #666;"><em>You will receive a separate signing link shortly.</em></p>';

    const emailContent = `
      <tr>
        <td style="padding: 40px 35px;">
          <h1 style="color: #1a1a1a; margin: 0 0 20px; font-size: 24px;">Rental Agreement Ready to Sign</h1>

          <p style="color: #444; line-height: 1.7; font-size: 15px;">Dear ${customerName},</p>

          <p style="color: #444; line-height: 1.7; font-size: 15px;"><strong>${companyName}</strong> has sent you a rental agreement to review and sign electronically.</p>

          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr>
              <td style="padding: 10px 12px; color: #666; border-bottom: 1px solid #eee; width: 40%;">Booking Reference:</td>
              <td style="padding: 10px 12px; color: #1a1a1a; font-weight: 600; border-bottom: 1px solid #eee;">${rentalRef}</td>
            </tr>
            <tr>
              <td style="padding: 10px 12px; color: #666; border-bottom: 1px solid #eee;">Vehicle:</td>
              <td style="padding: 10px 12px; color: #1a1a1a; font-weight: 600; border-bottom: 1px solid #eee;">${vehicleInfo}</td>
            </tr>
          </table>

          <div style="text-align: center; margin: 28px 0;">
            ${ctaButton}
          </div>

          <p style="color: #666; font-size: 13px; line-height: 1.6;">This document requires your electronic signature. Please review the agreement carefully before signing. If you have any questions, contact ${companyName}.</p>
        </td>
      </tr>`;

    const html = wrapWithBrandedTemplate(emailContent, branding);

    // Send via Resend
    const result = await sendResendEmail(
      {
        to: customerEmail,
        subject: `Rental Agreement Ready to Sign - ${rentalRef} | ${companyName}`,
        html,
        tenantId,
      },
      supabase
    );

    if (!result.success) {
      console.error('Failed to send signing email:', result.error);
      return errorResponse(result.error || 'Failed to send email', 500);
    }

    console.log('Signing email sent successfully, messageId:', result.messageId);
    return jsonResponse({ ok: true, messageId: result.messageId });
  } catch (error) {
    console.error('Error in send-signing-email:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
