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
  getTenantBranding,
  TenantBranding,
  wrapWithBrandedTemplate
} from "../_shared/resend-service.ts";

interface NotifyRequest {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  vehicleName: string;
  vehicleReg: string;
  vehicleColor?: string;
  bookingRef: string;
  pickupDate: string;
  pickupTime: string;
  pickupLocation: string;
  pickupAddress?: string;
  specialInstructions?: string;
  tenantId?: string;
}

const getEmailContent = (data: NotifyRequest, branding: TenantBranding) => {
  return `
                    <tr>
                        <td style="padding: 30px 30px 0; text-align: center;">
                            <span style="display: inline-block; background: #f0f9ff; color: #0ea5e9; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                PICKUP TOMORROW
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                This is a friendly reminder that your vehicle pickup is scheduled for tomorrow.
                                We're excited to have you drive with us!
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, ${branding.primaryColor} 0%, #2d2d2d 100%); border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 25px; text-align: center;">
                                        <p style="margin: 0 0 5px; color: ${branding.accentColor}; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Your Vehicle</p>
                                        <p style="margin: 0; color: white; font-size: 24px; font-weight: 700;">${data.vehicleName}</p>
                                        <p style="margin: 10px 0 0; color: ${branding.accentColor}; font-size: 16px;">${data.vehicleReg}${data.vehicleColor ? ` • ${data.vehicleColor}` : ''}</p>
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
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Pickup Date:</td>
                                                <td style="padding: 8px 0; color: #0ea5e9; font-weight: 600; font-size: 14px; text-align: right;">${data.pickupDate}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Pickup Time:</td>
                                                <td style="padding: 8px 0; color: #0ea5e9; font-weight: 600; font-size: 14px; text-align: right;">${data.pickupTime}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Location:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.pickupLocation}</td>
                                            </tr>
                                            ${data.pickupAddress ? `
                                            <tr>
                                                <td colspan="2" style="padding: 12px 0 0;">
                                                    <p style="margin: 0; color: #666; font-size: 13px;">${data.pickupAddress}</p>
                                                </td>
                                            </tr>
                                            ` : ''}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            ${data.specialInstructions ? `
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #92400e; font-size: 14px;">Special Instructions</h3>
                                        <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">${data.specialInstructions}</p>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #0369a1; font-size: 14px;">What to Bring</h3>
                                        <ul style="margin: 0; padding-left: 20px; color: #0369a1; font-size: 14px; line-height: 1.8;">
                                            <li>Valid driver's license</li>
                                            <li>Credit/debit card matching the booking</li>
                                            <li>Proof of insurance (if applicable)</li>
                                            <li>Booking confirmation email or reference number</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                If you need to reschedule or have any questions, please contact us as soon as possible.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="text-align: center; padding: 20px 0;">
                                        <a href="mailto:${branding.contactEmail}" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">Contact Support</a>
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
    console.log('Sending pickup reminder for:', data.bookingRef);

    // Create supabase client for tenant-specific email settings
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get tenant branding
    const branding = data.tenantId
      ? await getTenantBranding(data.tenantId, supabase)
      : { companyName: 'Drive 247', logoUrl: null, primaryColor: '#1a1a1a', accentColor: '#C5A572', contactEmail: 'support@drive-247.com', contactPhone: null, slug: 'drive247' };

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
    };

    // Build branded email HTML
    const emailContent = getEmailContent(data, branding);
    const emailHtml = wrapWithBrandedTemplate(emailContent, branding);

    // Send customer email
    results.customerEmail = await sendEmail(
      data.customerEmail,
      `Pickup Tomorrow - ${data.vehicleName}`,
      emailHtml,
      supabase,
      data.tenantId
    );
    console.log('Customer email result:', results.customerEmail);

    // Send customer SMS
    if (data.customerPhone) {
      results.customerSMS = await sendSMS(
        data.customerPhone,
        `${branding.companyName}: Reminder - Your ${data.vehicleName} pickup is tomorrow at ${data.pickupTime}. Location: ${data.pickupLocation}. Ref: ${data.bookingRef}`
      );
      console.log('Customer SMS result:', results.customerSMS);
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
