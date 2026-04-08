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
  signingLink?: string; // Pre-fetched signing link (legacy support)
  agreementId?: string; // Agreement ID for building portal signing URL
  rentalId?: string; // Rental ID fallback for signing URL
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
      signingLink: preFetchedSigningLink,
      agreementId,
      rentalId,
    } = body;

    if (!customerEmail || !documentId || !tenantId) {
      return errorResponse('Missing required fields: customerEmail, documentId, tenantId', 400);
    }

    console.log('Sending signing email to:', customerEmail, 'for document:', documentId);

    // Use pre-fetched signing link if provided, otherwise fetch from BoldSign
    let signingLink = preFetchedSigningLink || '';

    if (!signingLink) {
      const apiKey = getBoldSignApiKey(boldsignMode);
      const baseUrl = getBoldSignBaseUrl();

      // BoldSign needs ~3-5s to process a document after creation.
      // The esign route calls us immediately after /v1/document/send,
      // so we must wait before the signing link becomes available.
      // Try up to 3 times: at 3s, 4.5s, and 6s after function start.
      for (let attempt = 0; attempt < 3 && !signingLink; attempt++) {
        await new Promise(r => setTimeout(r, attempt === 0 ? 3000 : 1500));

        try {
          // Use properties endpoint — returns the direct browser signing URL
          const propsResponse = await fetch(
            `${baseUrl}/v1/document/properties?documentId=${documentId}`,
            { headers: { 'X-API-KEY': apiKey } }
          );

          if (propsResponse.ok) {
            const propsData = await propsResponse.json();
            const signer = propsData.signerDetails?.find(
              (s: any) => s.signerEmail?.toLowerCase() === customerEmail.toLowerCase()
            );
            if (signer?.signLink) {
              signingLink = signer.signLink;
              console.log(`Got signing link from properties on attempt ${attempt + 1}`);
            } else {
              console.warn(`Attempt ${attempt + 1}: properties OK but no signLink for ${customerEmail}`);
            }
          } else {
            console.warn(`Attempt ${attempt + 1}: properties failed:`, propsResponse.status);
          }
        } catch (e) {
          console.warn(`Attempt ${attempt + 1} error:`, e);
        }
      }

      if (!signingLink) {
        console.warn('Could not get signing link from BoldSign after 3 attempts');
      }
    }

    // Get tenant branding
    const branding = await getTenantBranding(tenantId, supabase);

    // Build email content
    const ctaButton = signingLink
      ? `<a href="${signingLink}" style="display: inline-block; background: ${branding.accentColor || '#C5A572'}; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 16px 0;">Review and Sign</a>`
      : '<p style="color: #666;"><em>You will receive a separate signing link shortly.</em></p>';

    const testBanner = boldsignMode === 'test'
      ? `<tr><td style="padding: 0;"><div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; margin: 0 35px; padding: 10px 16px; text-align: center;"><span style="color: #1e40af; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;">&#9679; Test Mode</span><span style="color: #3b82f6; font-size: 12px; display: block; margin-top: 2px;">This is a test document and is not legally binding.</span></div></td></tr>`
      : '';

    const emailContent = `
      ${testBanner}
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
