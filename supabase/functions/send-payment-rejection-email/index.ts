import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders } from "../_shared/aws-config.ts";
import {
  sendEmail,
  getTenantBranding,
  TenantBranding,
  wrapWithBrandedTemplate
} from "../_shared/resend-service.ts";

interface PaymentRejectionRequest {
  paymentId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  reason: string;
  vehicleReg?: string;
  tenantId?: string;
}

// sendEmail is now imported from resend-service.ts

function generateRejectionEmailContent(data: PaymentRejectionRequest, branding: TenantBranding): string {
  return `
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #dc2626; font-size: 16px;">Payment Could Not Be Processed</h3>
                                        <p style="margin: 0; color: #991b1b;">We regret to inform you that your recent payment could not be approved at this time.</p>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-left: 4px solid ${branding.accentColor}; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 15px; color: #1a1a1a; font-size: 16px;">Payment Details</h3>
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Amount:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">$${data.amount.toFixed(2)}</td>
                                            </tr>
                                            ${data.vehicleReg ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleReg}</td>
                                            </tr>
                                            ` : ''}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 15px 20px;">
                                        <p style="margin: 0 0 8px; font-size: 12px; color: #9a3412; text-transform: uppercase; letter-spacing: 0.5px;">Reason</p>
                                        <p style="margin: 0; color: #7c2d12; font-weight: 500;">${data.reason}</p>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h4 style="margin: 0 0 10px; color: #166534; font-size: 14px;">What happens next?</h4>
                                        <ul style="margin: 0; padding-left: 20px; color: #15803d; font-size: 14px;">
                                            <li style="margin: 5px 0;">Your payment has been declined and will not be charged</li>
                                            <li style="margin: 5px 0;">The associated rental booking has been cancelled</li>
                                            <li style="margin: 5px 0;">Please contact us if you have any questions</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0 0 15px; color: #444; line-height: 1.6; font-size: 16px;">
                                If you believe this was made in error or have any questions, please don't hesitate to contact us.
                            </p>
                            <p style="margin: 0; color: #444; font-size: 16px;">Thank you for your understanding.</p>
                        </td>
                    </tr>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const data: PaymentRejectionRequest = await req.json();
    console.log('Sending payment rejection email for payment:', data.paymentId);

    // Get tenant_id from payment if not provided
    let tenantId = data.tenantId;
    if (!tenantId && data.paymentId) {
      const { data: payment } = await supabase
        .from('payments')
        .select('tenant_id')
        .eq('id', data.paymentId)
        .single();
      tenantId = payment?.tenant_id;
    }

    // Get tenant branding
    const branding = tenantId
      ? await getTenantBranding(tenantId, supabase)
      : { companyName: 'Drive 247', logoUrl: null, primaryColor: '#1a1a1a', accentColor: '#C5A572', contactEmail: 'support@drive-247.com', contactPhone: null, slug: 'drive247' };

    // Build branded customer email HTML
    const emailContent = generateRejectionEmailContent(data, branding);
    const html = wrapWithBrandedTemplate(emailContent, branding);

    // Send rejection email to customer
    const subject = `Payment Update - Action Required`;

    const emailResult = await sendEmail(data.customerEmail, subject, html, supabase, tenantId);
    console.log('Rejection email sent:', emailResult);

    console.log('Payment rejection notification completed');

    return new Response(JSON.stringify({
      success: true,
      email: emailResult
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in send-payment-rejection-email:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
