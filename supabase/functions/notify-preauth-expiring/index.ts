import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  corsHeaders,
  signedAWSRequest,
  parseXMLValue,
  isAWSConfigured
} from "../_shared/aws-config.ts";
import { sendEmail, getTenantAdminEmail } from "../_shared/resend-service.ts";

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

const getEmailHtml = (data: NotifyRequest) => {
  const urgencyColor = data.hoursRemaining <= 24 ? "#dc2626" : "#f59e0b";
  const urgencyBg = data.hoursRemaining <= 24 ? "#fef2f2" : "#fef3c7";
  const urgencyText = data.hoursRemaining <= 24 ? "URGENT" : "ACTION REQUIRED";

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Pre-Authorization Expiring - DRIVE 247 Admin</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                            <h1 style="margin: 0; color: #C5A572; font-size: 28px; letter-spacing: 2px;">DRIVE 247 ADMIN</h1>
                        </td>
                    </tr>
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
                                        <a href="https://drive247-admin.vercel.app/pending-bookings" style="display: inline-block; background: #C5A572; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">Review Pending Bookings</a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background: #f8f9fa; padding: 25px 30px; border-radius: 0 0 12px 12px; text-align: center;">
                            <p style="margin: 0; color: #999; font-size: 12px;">&copy; 2024 DRIVE 247 Admin Portal. All rights reserved.</p>
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

    const results = {
      adminEmail: null as any,
      adminSMS: null as any,
    };

    const adminEmail = EMAIL_CONFIG.adminEmail;
    const urgencyPrefix = data.hoursRemaining <= 24 ? "URGENT: " : "";

    // Send admin email
    results.adminEmail = await sendEmail(
      adminEmail,
      `${urgencyPrefix}Pre-Auth Expiring in ${data.hoursRemaining}h - ${data.bookingRef} | DRIVE 247`,
      getEmailHtml(data)
    );
    console.log('Admin email result:', results.adminEmail);

    // Send admin SMS if phone configured
    const adminPhone = EMAIL_CONFIG.adminPhone;
    if (adminPhone) {
      results.adminSMS = await sendSMS(
        adminPhone,
        `DRIVE 247: Pre-auth for ${data.bookingRef} expires in ${data.hoursRemaining}h. Amount: $${data.amount}. Action required.`
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
