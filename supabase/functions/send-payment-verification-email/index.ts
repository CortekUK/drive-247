import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders } from "../_shared/aws-config.ts";
import {
  sendEmail,
  getTenantAdminEmail,
  getTenantBranding,
  TenantBranding,
  wrapWithBrandedTemplate
} from "../_shared/resend-service.ts";
import { formatCurrency } from "../_shared/format-utils.ts";

interface PaymentVerificationRequest {
  paymentId: string;
  customerId: string;
  customerName: string;
  amount: number;
  vehicleReg?: string;
  tenantId?: string;
}

// sendEmail is now imported from resend-service.ts

function generateVerificationEmailContent(data: PaymentVerificationRequest, branding: TenantBranding, currencyCode: string = 'GBP'): string {
  return `
                    <tr>
                        <td style="padding: 30px 30px 0; text-align: center;">
                            <span style="display: inline-block; background: #fff7ed; color: #f97316; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                ACTION REQUIRED
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Payment Verification Required</h2>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fff7ed; border-left: 4px solid #f97316; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <p style="margin: 0; color: #9a3412;"><strong>A new payment requires your approval.</strong> Please review and approve or reject this payment to proceed with the rental.</p>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Customer:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.customerName}</td>
                                            </tr>
                                            ${data.vehicleReg ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleReg}</td>
                                            </tr>
                                            ` : `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Payment ID:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.paymentId.substring(0, 8)}...</td>
                                            </tr>
                                            `}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, #f97316 0%, #fb923c 100%); border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px; text-align: center;">
                                        <p style="margin: 0 0 5px; color: rgba(255,255,255,0.9); font-size: 14px;">Payment Amount</p>
                                        <p style="margin: 0; color: white; font-size: 32px; font-weight: bold;">${formatCurrency(data.amount, currencyCode)}</p>
                                    </td>
                                </tr>
                            </table>
                            <div style="text-align: center;">
                                <a href="https://${branding.slug}.portal.drive-247.com/payments?status=pending" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: 600;">Review Payment</a>
                            </div>
                            <p style="margin: 20px 0 0; color: #666; font-size: 14px; text-align: center;">
                                Log in to the dashboard to approve or reject this payment.
                            </p>
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

    const data: PaymentVerificationRequest = await req.json();
    console.log('Sending payment verification email for payment:', data.paymentId);

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

    // Get tenant branding and currency
    const branding = tenantId
      ? await getTenantBranding(tenantId, supabase)
      : { companyName: 'Drive 247', logoUrl: null, primaryColor: '#1a1a1a', accentColor: '#C5A572', contactEmail: 'support@drive-247.com', contactPhone: null, slug: 'drive247' };

    let currencyCode = 'GBP';
    if (tenantId) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('currency_code')
        .eq('id', tenantId)
        .single();
      if (tenant?.currency_code) {
        currencyCode = tenant.currency_code;
      }
    }

    // Get tenant-specific admin email, fall back to env variable
    let adminEmail: string | null = null;
    if (tenantId) {
      adminEmail = await getTenantAdminEmail(tenantId, supabase);
      console.log('Using tenant admin email:', adminEmail);
    }
    if (!adminEmail) {
      adminEmail = Deno.env.get('ADMIN_EMAIL') || null;
      console.log('Falling back to env ADMIN_EMAIL:', adminEmail);
    }

    // Build branded admin email HTML
    const emailContent = generateVerificationEmailContent(data, branding, currencyCode);
    const html = wrapWithBrandedTemplate(emailContent, branding);

    // Send verification email to admin
    const subject = `Payment Verification Required - ${formatCurrency(data.amount, currencyCode)} from ${data.customerName}`;

    let emailResult;
    if (adminEmail) {
      emailResult = await sendEmail(adminEmail, subject, html, supabase, tenantId);
      console.log('Verification email sent to admin:', emailResult);
    }

    console.log('Payment verification notification completed');

    return new Response(JSON.stringify({
      success: true,
      email: emailResult
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in send-payment-verification-email:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
