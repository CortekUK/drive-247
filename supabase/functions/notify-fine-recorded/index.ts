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
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  vehicleName: string;
  vehicleReg: string;
  bookingRef: string;
  fineRef: string;
  fineType: string;
  fineAmount: number;
  fineDate: string;
  fineLocation?: string;
  dueDate?: string;
  description?: string;
  tenantId?: string;
}

const getCustomerEmailHtml = (data: NotifyRequest) => {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Traffic Fine Notice</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                            <h1 style="margin: 0; color: #C5A572; font-size: 28px; letter-spacing: 2px;">Traffic Fine Notice</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 30px 0; text-align: center;">
                            <span style="display: inline-block; background: #fef2f2; color: #dc2626; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                TRAFFIC FINE NOTICE
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                We have received notification of a traffic fine incurred during your rental period.
                                As per the rental agreement, you are responsible for any fines incurred while the vehicle was in your possession.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Fine Reference:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.fineRef}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Type:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.fineType}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleName} (${data.vehicleReg})</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Booking Reference:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.bookingRef}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Date of Fine:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.fineDate}</td>
                                            </tr>
                                            ${data.fineLocation ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Location:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.fineLocation}</td>
                                            </tr>
                                            ` : ''}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            ${data.description ? `
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #92400e; font-size: 14px;">Details</h3>
                                        <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">${data.description}</p>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef2f2; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px; text-align: center;">
                                        <p style="margin: 0 0 5px; color: #666; font-size: 14px;">Fine Amount</p>
                                        <p style="margin: 0; color: #dc2626; font-size: 32px; font-weight: 700;">$${data.fineAmount.toLocaleString()}</p>
                                        ${data.dueDate ? `<p style="margin: 10px 0 0; color: #991b1b; font-size: 14px;">Due by: ${data.dueDate}</p>` : ''}
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #0369a1; font-size: 14px;">What Happens Next?</h3>
                                        <p style="margin: 0; color: #0369a1; font-size: 14px; line-height: 1.6;">
                                            This fine will be charged to the card on file. If you wish to dispute this fine or have any questions,
                                            please contact our support team immediately.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background: #f8f9fa; padding: 25px 30px; border-radius: 0 0 12px 12px; text-align: center;">
                            <p style="margin: 0; color: #999; font-size: 12px;">&copy; 2024 All rights reserved.</p>
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
<head><meta charset="utf-8"><title>New Fine Recorded</title></head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f5f5f5;">
    <table style="width: 100%; max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
        <tr>
            <td style="background: #1a1a1a; padding: 20px; text-align: center;">
                <h1 style="margin: 0; color: #C5A572; font-size: 24px;">ADMIN NOTIFICATION</h1>
            </td>
        </tr>
        <tr>
            <td style="padding: 30px;">
                <h2 style="margin: 0 0 20px; color: #dc2626;">New Traffic Fine Recorded</h2>
                <p style="margin: 0 0 20px; color: #444;">A new traffic fine has been recorded against a rental.</p>
                <table style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px;">
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Fine Reference:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${data.fineRef}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Type:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.fineType}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Amount:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-weight: 600;">$${data.fineAmount.toLocaleString()}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Customer:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerName}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Email:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerEmail}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Vehicle:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.vehicleName} (${data.vehicleReg})</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Booking Ref:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.bookingRef}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Fine Date:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.fineDate}</td></tr>
                    ${data.fineLocation ? `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Location:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.fineLocation}</td></tr>` : ''}
                    ${data.dueDate ? `<tr><td style="padding: 12px; color: #666;">Due Date:</td><td style="padding: 12px; color: #dc2626;">${data.dueDate}</td></tr>` : ''}
                </table>
                <p style="margin: 20px 0 0; color: #666; font-size: 14px;">Customer has been notified via email.</p>
            </td>
        </tr>
    </table>
</body>
</html>
`;
};

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
    console.log('Sending fine notification for:', data.fineRef);

    // Create supabase client for all email operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
      adminEmail: null as any,
    };

    // Send customer email (with tenant-specific from address)
    results.customerEmail = await sendEmail(
      data.customerEmail,
      `Traffic Fine Notice - $${data.fineAmount}`,
      getCustomerEmailHtml(data),
      supabase,
      data.tenantId
    );
    console.log('Customer email result:', results.customerEmail);

    // Send customer SMS
    if (data.customerPhone) {
      results.customerSMS = await sendSMS(
        data.customerPhone,
        `A ${data.fineType} fine of $${data.fineAmount} has been recorded for your rental ${data.bookingRef}. Check your email for details.`
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
        `New Fine Recorded - ${data.fineRef} - $${data.fineAmount}`,
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
