import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  corsHeaders,
} from "../_shared/aws-config.ts";
import {
  sendEmail,
  getTenantAdminEmail,
  getTenantBranding,
  TenantBranding,
  wrapWithBrandedTemplate
} from "../_shared/resend-service.ts";

interface NotifyRequest {
  customerName: string;
  customerEmail: string;
  vehicleName: string;
  vehicleReg: string;
  bookingRef: string;
  envelopeId: string;
  signedAt: string;
  documentUrl?: string;
  tenantId?: string;
}

const getAdminEmailContent = (data: NotifyRequest, branding: TenantBranding) => {
  return `
                    <tr>
                        <td style="padding: 30px;">
                            <div style="text-align: center; margin-bottom: 25px;">
                                <span style="display: inline-block; background: #ecfdf5; color: #10b981; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                    CONTRACT SIGNED
                                </span>
                            </div>
                            <h2 style="margin: 0 0 20px; color: #10b981;">Rental Agreement Signed</h2>
                            <p style="margin: 0 0 20px; color: #444;">A customer has completed signing their rental agreement.</p>
                            <table style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px;">
                                <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Booking Reference:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${data.bookingRef}</td></tr>
                                <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Customer:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerName}</td></tr>
                                <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Email:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerEmail}</td></tr>
                                <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Vehicle:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.vehicleName} (${data.vehicleReg})</td></tr>
                                <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Signed At:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #10b981;">${data.signedAt}</td></tr>
                                <tr><td style="padding: 12px; color: #666;">Document ID:</td><td style="padding: 12px; font-family: monospace; font-size: 12px;">${data.envelopeId}</td></tr>
                            </table>
                            ${data.documentUrl ? `
                            <div style="text-align: center; margin-top: 25px;">
                                <a href="${data.documentUrl}" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 600;">View Signed Document</a>
                            </div>
                            ` : ''}
                            <p style="margin: 25px 0 0; color: #666; font-size: 14px;">The rental is now ready for pickup. All paperwork is complete.</p>
                        </td>
                    </tr>`;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: NotifyRequest = await req.json();
    console.log('Sending agreement signed notification for:', data.bookingRef);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const branding = data.tenantId
      ? await getTenantBranding(data.tenantId, supabase)
      : { companyName: 'Drive 247', logoUrl: null, primaryColor: '#1a1a1a', accentColor: '#C5A572', contactEmail: 'support@drive-247.com', contactPhone: null, slug: 'drive247' };

    const results = {
      adminEmail: null as any,
    };

    let adminEmail: string | null = null;
    if (data.tenantId) {
      adminEmail = await getTenantAdminEmail(data.tenantId, supabase);
      console.log('Using tenant admin email:', adminEmail);
    }
    if (!adminEmail) {
      adminEmail = Deno.env.get('ADMIN_EMAIL') || null;
      console.log('Falling back to env ADMIN_EMAIL:', adminEmail);
    }

    const adminEmailContent = getAdminEmailContent(data, branding);
    const adminEmailHtml = wrapWithBrandedTemplate(adminEmailContent, branding);

    if (adminEmail) {
      results.adminEmail = await sendEmail(
        adminEmail,
        `Contract Signed - ${data.bookingRef} - ${data.customerName}`,
        adminEmailHtml,
        supabase,
        data.tenantId
      );
      console.log('Admin email result:', results.adminEmail);
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
