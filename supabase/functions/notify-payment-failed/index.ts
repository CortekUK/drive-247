import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  corsHeaders,
  signedAWSRequest,
  parseXMLValue,
  isAWSConfigured
} from "../_shared/aws-config.ts";
import { sendEmail, getTenantAdminEmail } from "../_shared/resend-service.ts";
import { renderEmail, EmailTemplateData } from "../_shared/email-template-service.ts";

interface NotifyRequest {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  vehicleName: string;
  vehicleReg?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  bookingRef: string;
  amount: number;
  failureReason?: string;
  last4?: string;
  retryUrl?: string;
  tenantId?: string;
}

const getCustomerEmailHtml = (data: NotifyRequest) => {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Payment Issue - DRIVE 247</title>
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
                            <span style="display: inline-block; background: #fef2f2; color: #dc2626; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                PAYMENT ISSUE
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                We were unable to process your payment for your booking. Don't worry - no charge has been made to your card.
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
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleName}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Amount:</td>
                                                <td style="padding: 8px 0; color: #dc2626; font-weight: 600; font-size: 14px; text-align: right;">$${data.amount.toLocaleString()}</td>
                                            </tr>
                                            ${data.last4 ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Card:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">**** **** **** ${data.last4}</td>
                                            </tr>
                                            ` : ''}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            ${data.failureReason ? `
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef2f2; border-left: 4px solid #dc2626; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #991b1b; font-size: 14px;">Reason</h3>
                                        <p style="margin: 0; color: #991b1b; font-size: 14px; line-height: 1.6;">${data.failureReason}</p>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #0369a1; font-size: 14px;">What You Can Do</h3>
                                        <ul style="margin: 0; padding-left: 20px; color: #0369a1; font-size: 14px; line-height: 1.8;">
                                            <li>Check that your card details are correct</li>
                                            <li>Ensure sufficient funds are available</li>
                                            <li>Contact your bank if the issue persists</li>
                                            <li>Try a different payment method</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Please try again or contact us for assistance. Your vehicle reservation is being held temporarily.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="text-align: center; padding: 20px 0;">
                                        ${data.retryUrl ? `
                                        <a href="${data.retryUrl}" style="display: inline-block; background: #C5A572; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px; margin-right: 10px;">Try Again</a>
                                        ` : ''}
                                        <a href="mailto:support@drive-247.com" style="display: inline-block; background: #1a1a1a; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">Contact Support</a>
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

const getAdminEmailHtml = (data: NotifyRequest) => {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Payment Failed</title></head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f5f5f5;">
    <table style="width: 100%; max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
        <tr>
            <td style="background: #1a1a1a; padding: 20px; text-align: center;">
                <h1 style="margin: 0; color: #C5A572; font-size: 24px;">DRIVE 247 ADMIN</h1>
            </td>
        </tr>
        <tr>
            <td style="padding: 30px;">
                <div style="text-align: center; margin-bottom: 25px;">
                    <span style="display: inline-block; background: #fef2f2; color: #dc2626; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                        PAYMENT FAILED
                    </span>
                </div>
                <h2 style="margin: 0 0 20px; color: #dc2626;">Payment Processing Failed</h2>
                <p style="margin: 0 0 20px; color: #444;">A customer's payment failed to process. They have been notified.</p>
                <table style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px;">
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Booking Reference:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${data.bookingRef}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Customer:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerName}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Email:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerEmail}</td></tr>
                    ${data.customerPhone ? `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Phone:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerPhone}</td></tr>` : ''}
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Vehicle:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.vehicleName}${data.vehicleReg ? ` (${data.vehicleReg})` : ''}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Amount:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-weight: 600;">$${data.amount.toLocaleString()}</td></tr>
                    ${data.last4 ? `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Card:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">**** ${data.last4}</td></tr>` : ''}
                    ${data.failureReason ? `<tr><td style="padding: 12px; color: #666;">Failure Reason:</td><td style="padding: 12px; color: #dc2626;">${data.failureReason}</td></tr>` : ''}
                </table>
                <p style="margin: 20px 0 0; color: #666; font-size: 14px;">The customer has been notified and asked to retry payment or contact support.</p>
            </td>
        </tr>
    </table>
</body>
</html>
`;
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
    console.log('Sending payment failed notification for:', data.bookingRef);

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
      adminEmail: null as any,
    };

    // Create supabase client for all email operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Build customer email using template service if tenantId is provided
    let customerSubject = `Payment Issue - Action Required | DRIVE 247`;
    let customerHtml = getCustomerEmailHtml(data);

    if (data.tenantId) {
      try {
        const templateData: EmailTemplateData = {
          customer_name: data.customerName,
          customer_email: data.customerEmail,
          customer_phone: data.customerPhone || '',
          vehicle_make: data.vehicleMake || data.vehicleName.split(' ')[0] || '',
          vehicle_model: data.vehicleModel || data.vehicleName.split(' ').slice(1).join(' ') || '',
          vehicle_reg: data.vehicleReg || '',
          rental_number: data.bookingRef,
          payment_amount: `$${data.amount.toLocaleString()}`,
        };

        const rendered = await renderEmail(supabase, data.tenantId, 'payment_failed', templateData);
        customerSubject = rendered.subject;
        customerHtml = rendered.html;
        console.log('Using custom/default email template for customer');
      } catch (templateError) {
        console.warn('Error rendering email template, using fallback:', templateError);
      }
    }

    // Send customer email (with tenant-specific from address)
    results.customerEmail = await sendEmail(
      data.customerEmail,
      customerSubject,
      customerHtml,
      supabase,
      data.tenantId
    );
    console.log('Customer email result:', results.customerEmail);

    // Send customer SMS
    if (data.customerPhone) {
      results.customerSMS = await sendSMS(
        data.customerPhone,
        `We couldn't process your payment for booking ${data.bookingRef}. Please check your email or contact support.`
      );
      console.log('Customer SMS result:', results.customerSMS);
    }

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

    // Send admin email
    if (adminEmail) {
      results.adminEmail = await sendEmail(
        adminEmail,
        `Payment Failed - ${data.bookingRef} - $${data.amount}`,
        getAdminEmailHtml(data),
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
