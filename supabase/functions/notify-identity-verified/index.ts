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
  verificationStatus: "approved" | "declined" | "resubmission_requested";
  declineReason?: string;
  bookingRef?: string;
}

const getStatusMessage = (status: string) => {
  switch (status) {
    case "approved":
      return {
        title: "Identity Verified Successfully",
        badge: "VERIFIED",
        badgeColor: "#10b981",
        badgeBg: "#ecfdf5",
        message: "Great news! Your identity has been successfully verified. You can now proceed with your booking.",
        nextSteps: "Your booking will be processed shortly. You'll receive a confirmation email once approved.",
      };
    case "declined":
      return {
        title: "Identity Verification Unsuccessful",
        badge: "DECLINED",
        badgeColor: "#dc2626",
        badgeBg: "#fef2f2",
        message: "Unfortunately, we were unable to verify your identity with the documents provided.",
        nextSteps: "Please contact our support team for assistance or try again with clearer documents.",
      };
    case "resubmission_requested":
      return {
        title: "Additional Documents Required",
        badge: "ACTION REQUIRED",
        badgeColor: "#f59e0b",
        badgeBg: "#fef3c7",
        message: "We need you to resubmit your identity documents. The previous submission couldn't be processed.",
        nextSteps: "Please ensure your documents are clear, well-lit, and all corners are visible.",
      };
    default:
      return {
        title: "Identity Verification Update",
        badge: "UPDATE",
        badgeColor: "#6b7280",
        badgeBg: "#f3f4f6",
        message: "There's an update regarding your identity verification.",
        nextSteps: "Please check your account or contact support for more details.",
      };
  }
};

const getEmailHtml = (data: NotifyRequest) => {
  const status = getStatusMessage(data.verificationStatus);

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${status.title} - DRIVE 247</title>
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
                            <span style="display: inline-block; background: ${status.badgeBg}; color: ${status.badgeColor}; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                ${status.badge}
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                ${status.message}
                            </p>
                            ${data.declineReason ? `
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef2f2; border-left: 4px solid #dc2626; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #991b1b; font-size: 14px;">Reason</h3>
                                        <p style="margin: 0; color: #991b1b; font-size: 14px; line-height: 1.6;">${data.declineReason}</p>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}
                            ${data.bookingRef ? `
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Booking Reference:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.bookingRef}</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            ` : ''}
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #0369a1; font-size: 14px;">Next Steps</h3>
                                        <p style="margin: 0; color: #0369a1; font-size: 14px; line-height: 1.6;">${status.nextSteps}</p>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                If you have any questions, please don't hesitate to contact our support team.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="text-align: center; padding: 20px 0;">
                                        <a href="mailto:support@drive-247.com" style="display: inline-block; background: #C5A572; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">Contact Support</a>
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

async function sendAdminNotification(data: NotifyRequest) {
  if (data.verificationStatus !== "declined") return null;

  const adminEmail = EMAIL_CONFIG.adminEmail;
  const subject = `Identity Verification Failed - ${data.customerName} | DRIVE 247`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Identity Verification Failed</title></head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f5f5f5;">
    <table style="width: 100%; max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
        <tr>
            <td style="background: #1a1a1a; padding: 20px; text-align: center;">
                <h1 style="margin: 0; color: #C5A572; font-size: 24px;">DRIVE 247 ADMIN</h1>
            </td>
        </tr>
        <tr>
            <td style="padding: 30px;">
                <h2 style="margin: 0 0 20px; color: #dc2626;">Identity Verification Failed</h2>
                <p style="margin: 0 0 20px; color: #444;">A customer's identity verification has been declined.</p>
                <table style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px;">
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Customer:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${data.customerName}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Email:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerEmail}</td></tr>
                    ${data.customerPhone ? `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Phone:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerPhone}</td></tr>` : ''}
                    ${data.bookingRef ? `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Booking Ref:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.bookingRef}</td></tr>` : ''}
                    ${data.declineReason ? `<tr><td style="padding: 12px; color: #666;">Decline Reason:</td><td style="padding: 12px; color: #dc2626;">${data.declineReason}</td></tr>` : ''}
                </table>
                <p style="margin: 20px 0 0; color: #666; font-size: 14px;">Action may be required to follow up with this customer.</p>
            </td>
        </tr>
    </table>
</body>
</html>
`;

  return await sendEmail(adminEmail, subject, html);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: NotifyRequest = await req.json();
    console.log('Sending identity verification notification for:', data.customerEmail);

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
      adminEmail: null as any,
    };

    // Send customer email
    const statusText = data.verificationStatus === "approved" ? "Verified"
      : data.verificationStatus === "declined" ? "Declined"
      : "Action Required";

    results.customerEmail = await sendEmail(
      data.customerEmail,
      `Identity Verification ${statusText} | DRIVE 247`,
      getEmailHtml(data)
    );
    console.log('Customer email result:', results.customerEmail);

    // Send customer SMS
    if (data.customerPhone) {
      const smsMessage = data.verificationStatus === "approved"
        ? `DRIVE 247: Your identity has been verified successfully. Your booking will be processed shortly.`
        : data.verificationStatus === "declined"
        ? `DRIVE 247: Your identity verification was unsuccessful. Please contact support for assistance.`
        : `DRIVE 247: We need you to resubmit your identity documents. Please check your email for details.`;

      results.customerSMS = await sendSMS(data.customerPhone, smsMessage);
      console.log('Customer SMS result:', results.customerSMS);
    }

    // Send admin notification for declined verifications
    results.adminEmail = await sendAdminNotification(data);
    if (results.adminEmail) {
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
