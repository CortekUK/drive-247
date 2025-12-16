import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  signedAWSRequest,
  parseXMLValue,
  isAWSConfigured
} from "../_shared/aws-config.ts";
import { sendEmail } from "../_shared/resend-service.ts";

interface NotifyRequest {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  vehicleName: string;
  vehicleReg: string;
  bookingRef: string;
  startDate: string;
  endDate: string;
  totalAmount: number;
  additionalCharges?: number;
  chargesDescription?: string;
  feedbackUrl?: string;
}

const getEmailHtml = (data: NotifyRequest) => {
  const hasAdditionalCharges = data.additionalCharges && data.additionalCharges > 0;

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Rental Completed - DRIVE 247</title>
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
                            <span style="display: inline-block; background: #ecfdf5; color: #10b981; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                RENTAL COMPLETED
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Thank you for returning your rental vehicle! We hope you had a great experience with DRIVE 247.
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
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Registration:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleReg}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Rental Period:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.startDate} - ${data.endDate}</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 15px; color: #1a1a1a; font-size: 16px;">Payment Summary</h3>
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Rental Total:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">$${data.totalAmount.toLocaleString()}</td>
                                            </tr>
                                            ${hasAdditionalCharges ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Additional Charges:</td>
                                                <td style="padding: 8px 0; color: #dc2626; font-weight: 600; font-size: 14px; text-align: right;">$${data.additionalCharges?.toLocaleString()}</td>
                                            </tr>
                                            <tr>
                                                <td colspan="2" style="padding: 8px 0 0;">
                                                    <p style="margin: 0; color: #666; font-size: 12px; font-style: italic;">${data.chargesDescription || 'Additional charges applied'}</p>
                                                </td>
                                            </tr>
                                            <tr>
                                                <td colspan="2" style="padding: 15px 0 0;">
                                                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;">
                                                </td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 12px 0; color: #1a1a1a; font-size: 16px; font-weight: 600;">Total:</td>
                                                <td style="padding: 12px 0; color: #1a1a1a; font-weight: 700; font-size: 18px; text-align: right;">$${((data.totalAmount || 0) + (data.additionalCharges || 0)).toLocaleString()}</td>
                                            </tr>
                                            ` : ''}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #0369a1; font-size: 14px;">We Value Your Feedback!</h3>
                                        <p style="margin: 0; color: #0369a1; font-size: 14px; line-height: 1.6;">
                                            We'd love to hear about your experience. Your feedback helps us improve our service for you and other customers.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Thank you for choosing DRIVE 247. We look forward to serving you again!
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="text-align: center; padding: 20px 0;">
                                        ${data.feedbackUrl ? `
                                        <a href="${data.feedbackUrl}" style="display: inline-block; background: #C5A572; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px; margin-right: 10px;">Leave Feedback</a>
                                        ` : ''}
                                        <a href="https://drive-247.com" style="display: inline-block; background: #1a1a1a; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">Book Again</a>
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
    console.log('Sending rental completed notification for:', data.bookingRef);

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
    };

    // Send customer email
    results.customerEmail = await sendEmail(
      data.customerEmail,
      `Rental Completed - Thank You! | DRIVE 247`,
      getEmailHtml(data)
    );
    console.log('Customer email result:', results.customerEmail);

    // Send customer SMS
    if (data.customerPhone) {
      results.customerSMS = await sendSMS(
        data.customerPhone,
        `DRIVE 247: Thank you for returning your ${data.vehicleName}! We hope you enjoyed your rental. Book again at drive-247.com`
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
