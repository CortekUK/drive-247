import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  corsHeaders,
  signedAWSRequest,
  parseXMLValue,
  isAWSConfigured
} from "../_shared/aws-config.ts";
import {
  sendEmail,
  getTenantAdminEmail,
  getTenantBranding,
  TenantBranding,
  wrapWithBrandedTemplate
} from "../_shared/resend-service.ts";

interface NotifyRequest {
  bookingRef: string;
  customerName: string;
  customerEmail: string;
  vehicleName: string;
  vehicleReg?: string;
  amount: number;
  expiresAt: string;
  hoursRemaining: number;
  tenantId?: string;
}

const getEmailContent = (data: NotifyRequest, branding: TenantBranding) => {
  const urgencyColor = data.hoursRemaining <= 24 ? "#dc2626" : "#f59e0b";
  const urgencyBg = data.hoursRemaining <= 24 ? "#fef2f2" : "#fef3c7";
  const urgencyText = data.hoursRemaining <= 24 ? "URGENT" : "ACTION REQUIRED";

  return `
                    <tr>
                        <td style="padding: 30px 30px 0; text-align: center;">
                            <span style="display: inline-block; background: ${urgencyBg}; color: ${urgencyColor}; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                ${urgencyText}: PRE-AUTH EXPIRING
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Pre-Authorization Expiring Soon</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                A pending booking's pre-authorization will expire in <strong style="color: ${urgencyColor};">${data.hoursRemaining} hours</strong>.
                                Action is required to either approve or reject this booking before the hold expires.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Booking Reference:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.bookingRef}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Customer:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.customerName}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleName}</td>
                                            </tr>
                                            ${data.vehicleReg ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Registration:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleReg}</td>
                                            </tr>
                                            ` : ''}
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Amount Held:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">$${data.amount.toLocaleString()}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Expires At:</td>
                                                <td style="padding: 8px 0; color: ${urgencyColor}; font-weight: 600; font-size: 14px; text-align: right;">${data.expiresAt}</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: ${urgencyBg}; border-left: 4px solid ${urgencyColor}; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: ${urgencyColor}; font-size: 14px;">What Happens If No Action Is Taken?</h3>
                                        <p style="margin: 0; color: ${urgencyColor}; font-size: 14px; line-height: 1.6;">
                                            If the pre-authorization expires without action, the hold on the customer's card will be automatically released by Stripe,
                                            and you will not be able to capture the payment. The booking will need to be re-processed.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="text-align: center; padding: 20px 0;">
                                        <a href="https://${branding.slug}.portal.drive-247.com/pending-bookings" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">Review Pending Bookings</a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>`;
};

// sendEmail is now imported from resend-service.ts

async function sendSMS(phoneNumber: string, message: string) {
  if (!isAWSConfigured() || !phoneNumber) {
    console.log('AWS not configured or no phone, simulating SMS send');
    return { success: true, simulated: true };
  }

  let phone = phoneNumber.replace(/[^+\d]/g, '');
  if (!phone.startsWith('+')) {
    phone = '+1' + phone;
  }

  const params: Record<string, string> = {
    'Action': 'Publish',
    'Version': '2010-03-31',
    'PhoneNumber': phone,
    'Message': message,
    'MessageAttributes.entry.1.Name': 'AWS.SNS.SMS.SMSType',
    'MessageAttributes.entry.1.Value.DataType': 'String',
    'MessageAttributes.entry.1.Value.StringValue': 'Transactional',
  };

  const body = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const response = await signedAWSRequest({
    service: 'sns',
    method: 'POST',
    body,
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error('SNS Error:', responseText);
    return { success: false, error: parseXMLValue(responseText, 'Message') };
  }

  return { success: true, messageId: parseXMLValue(responseText, 'MessageId') };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: NotifyRequest = await req.json();
    console.log('Sending pre-auth expiring notification for:', data.bookingRef);

    // Create supabase client for all email operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get tenant branding
    const branding = data.tenantId
      ? await getTenantBranding(data.tenantId, supabase)
      : { companyName: 'Drive 247', logoUrl: null, primaryColor: '#1a1a1a', accentColor: '#C5A572', contactEmail: 'support@drive-247.com', contactPhone: null, slug: 'drive247' };

    const results = {
      adminEmail: null as any,
      adminSMS: null as any,
    };

    // Get tenant-specific admin email, fall back to env variable
    let adminEmail: string | null = null;
    if (data.tenantId) {
      adminEmail = await getTenantAdminEmail(data.tenantId, supabase);
      console.log('Using tenant admin email:', adminEmail);
    }
    if (!adminEmail) {
      adminEmail = Deno.env.get('ADMIN_EMAIL') || null;
      console.log('Falling back to env ADMIN_EMAIL:', adminEmail);
    }

    const urgencyPrefix = data.hoursRemaining <= 24 ? "URGENT: " : "";

    // Build branded admin email HTML
    const adminEmailContent = getEmailContent(data, branding);
    const adminEmailHtml = wrapWithBrandedTemplate(adminEmailContent, branding);

    // Send admin email
    if (adminEmail) {
      results.adminEmail = await sendEmail(
        adminEmail,
        `${urgencyPrefix}Pre-Auth Expiring in ${data.hoursRemaining}h - ${data.bookingRef}`,
        adminEmailHtml,
        supabase,
        data.tenantId
      );
      console.log('Admin email result:', results.adminEmail);
    }

    // Send admin SMS if phone configured (using env variable for now)
    const adminPhone = Deno.env.get('ADMIN_PHONE');
    if (adminPhone) {
      results.adminSMS = await sendSMS(
        adminPhone,
        `${branding.companyName}: Pre-auth for ${data.bookingRef} expires in ${data.hoursRemaining}h. Amount: $${data.amount}. Action required.`
      );
      console.log('Admin SMS result:', results.adminSMS);
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
