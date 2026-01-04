import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  corsHeaders,
  signedAWSRequest,
  parseXMLValue,
  isAWSConfigured
} from "../_shared/aws-config.ts";
import { sendEmail } from "../_shared/resend-service.ts";
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
  pickupDate?: string;
  returnDate?: string;
  reason?: string;
  tenantId?: string;
}

const getRejectionEmailHtml = (data: NotifyRequest) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Booking Update - DRIVE 247</title>
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
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Thank you for your interest in renting with DRIVE 247. Unfortunately, we were unable to approve your booking request at this time.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Reference:</td><td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.bookingRef}</td></tr>
                                            <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td><td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleName}</td></tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #ecfdf5; border-left: 4px solid #10b981; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #047857; font-size: 16px;">✓ No Charge to Your Card</h3>
                                        <p style="margin: 0; color: #047857; font-size: 14px; line-height: 1.6;">
                                            The hold on your card has been released. No payment was captured. The authorization hold will be removed from your statement within 1-3 business days.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            ${data.reason ? `
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef3c7; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #92400e; font-size: 14px;">Additional Information</h3>
                                        <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">${data.reason}</p>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                If you believe this was in error or would like more information, please contact our team. We're here to help!
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="text-align: center; padding: 20px 0;">
                                        <a href="mailto:support@drive-247.com" style="display: inline-block; background: #C5A572; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">Contact Us</a>
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
    console.log('Sending booking rejected notifications for:', data.bookingRef);

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
    };

    // Build customer email using template service if tenantId is provided
    let customerSubject = `Booking Update - Reference: ${data.bookingRef} | DRIVE 247`;
    let customerHtml = getRejectionEmailHtml(data);

    if (data.tenantId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const templateData: EmailTemplateData = {
          customer_name: data.customerName,
          customer_email: data.customerEmail,
          customer_phone: data.customerPhone || '',
          vehicle_make: data.vehicleMake || data.vehicleName.split(' ')[0] || '',
          vehicle_model: data.vehicleModel || data.vehicleName.split(' ').slice(1).join(' ') || '',
          vehicle_reg: data.vehicleReg || '',
          rental_number: data.bookingRef,
          rental_start_date: data.pickupDate || '',
          rental_end_date: data.returnDate || '',
          rejection_reason: data.reason || 'No additional information provided.',
        };

        const rendered = await renderEmail(supabase, data.tenantId, 'booking_rejected', templateData);
        customerSubject = rendered.subject;
        customerHtml = rendered.html;
        console.log('Using custom/default email template for customer');
      } catch (templateError) {
        console.warn('Error rendering email template, using fallback:', templateError);
      }
    }

    // Send customer email
    results.customerEmail = await sendEmail(
      data.customerEmail,
      customerSubject,
      customerHtml
    );
    console.log('Customer email result:', results.customerEmail);

    // Send customer SMS
    if (data.customerPhone) {
      results.customerSMS = await sendSMS(
        data.customerPhone,
        `DRIVE 247: Your booking ${data.bookingRef} was not approved. No charge was made to your card. The hold will be released within 1-3 days. Contact us with questions.`
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
