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

interface BookingNotificationRequest {
  rentalId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  vehicleReg: string;
  vehicleMake: string;
  vehicleModel: string;
  startDate: string;
  endDate: string;
  monthlyAmount: number;
  totalAmount: number;
  tenantId?: string;
}

// sendEmail is now imported from resend-service.ts

function generateCustomerEmailContent(data: BookingNotificationRequest, branding: TenantBranding): string {
  return `
                    <tr>
                        <td style="padding: 30px 30px 0; text-align: center;">
                            <span style="display: inline-block; background: #ecfdf5; color: #10b981; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                BOOKING CONFIRMED
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Great news! Your vehicle rental booking has been confirmed.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-left: 4px solid ${branding.accentColor}; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 15px; color: #1a1a1a; font-size: 16px;">Booking Details</h3>
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleMake} ${data.vehicleModel}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Registration:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleReg}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Start Date:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${new Date(data.startDate).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">End Date:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${new Date(data.endDate).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, ${branding.accentColor} 0%, #d4b896 100%); border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px; text-align: center;">
                                        <p style="margin: 0 0 5px; color: rgba(255,255,255,0.9); font-size: 14px;">Monthly Rental Amount</p>
                                        <p style="margin: 0; color: white; font-size: 32px; font-weight: bold;">$${data.monthlyAmount.toLocaleString()}</p>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0 0 15px; color: #444; line-height: 1.6; font-size: 16px;">
                                You will receive the rental agreement via DocuSign shortly. Please review and sign the document to complete your booking.
                            </p>
                            <p style="margin: 0 0 15px; color: #444; line-height: 1.6; font-size: 16px;">
                                If you have any questions, please don't hesitate to contact us.
                            </p>
                            <p style="margin: 0; color: #444; font-size: 16px;">Thank you for choosing ${branding.companyName}!</p>
                        </td>
                    </tr>`;
}

function generateAdminEmailContent(data: BookingNotificationRequest, branding: TenantBranding): string {
  return `
                    <tr>
                        <td style="padding: 30px 30px 0; text-align: center;">
                            <span style="display: inline-block; background: #ecfdf5; color: #10b981; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                NEW BOOKING
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">New Booking Received</h2>
                            <p style="margin: 0 0 20px; color: #444;">A new rental booking has been created:</p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Customer:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.customerName}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Email:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-align: right;">${data.customerEmail}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleMake} ${data.vehicleModel} (${data.vehicleReg})</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Start Date:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-align: right;">${new Date(data.startDate).toLocaleDateString('en-GB')}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">End Date:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-align: right;">${new Date(data.endDate).toLocaleDateString('en-GB')}</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, ${branding.accentColor} 0%, #d4b589 100%); border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px; text-align: center;">
                                        <p style="margin: 0 0 5px; color: rgba(255,255,255,0.9); font-size: 14px;">Monthly Amount</p>
                                        <p style="margin: 0; color: white; font-size: 28px; font-weight: bold;">$${data.monthlyAmount.toLocaleString()}</p>
                                    </td>
                                </tr>
                            </table>
                            <div style="text-align: center;">
                                <a href="https://${branding.slug}.portal.drive-247.com/rentals" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: 600;">View Rental</a>
                            </div>
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

    const data: BookingNotificationRequest = await req.json();
    console.log('Sending booking notifications for rental:', data.rentalId);

    // Get tenant_id from rental if not provided
    let tenantId = data.tenantId;
    if (!tenantId && data.rentalId) {
      const { data: rental } = await supabase
        .from('rentals')
        .select('tenant_id')
        .eq('id', data.rentalId)
        .single();
      tenantId = rental?.tenant_id;
    }

    // Get tenant branding
    const branding = tenantId
      ? await getTenantBranding(tenantId, supabase)
      : { companyName: 'Drive 247', logoUrl: null, primaryColor: '#1a1a1a', accentColor: '#C5A572', contactEmail: 'support@drive-247.com', contactPhone: null, slug: 'drive247' };

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

    // Send customer confirmation email
    const customerSubject = `Booking Confirmed - ${data.vehicleMake} ${data.vehicleModel} (${data.vehicleReg})`;
    const customerEmailContent = generateCustomerEmailContent(data, branding);
    const customerHtml = wrapWithBrandedTemplate(customerEmailContent, branding);

    const customerEmailResult = await sendEmail(data.customerEmail, customerSubject, customerHtml, supabase, tenantId);
    console.log('Customer email sent:', customerEmailResult);

    // Send admin notification email
    let adminEmailResult;
    if (adminEmail) {
      const adminSubject = `New Booking: ${data.customerName} - ${data.vehicleReg}`;
      const adminEmailContent = generateAdminEmailContent(data, branding);
      const adminHtml = wrapWithBrandedTemplate(adminEmailContent, branding);

      adminEmailResult = await sendEmail(adminEmail, adminSubject, adminHtml, supabase, tenantId);
      console.log('Admin email sent:', adminEmailResult);
    }

    // Note: In-app notifications are created by the frontend (src/lib/notifications.ts)
    // This edge function only handles email sending to avoid duplicates

    console.log('Booking email notifications completed');

    return new Response(JSON.stringify({
      success: true,
      customerEmail: customerEmailResult,
      adminEmail: adminEmailResult
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in send-booking-notification:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
