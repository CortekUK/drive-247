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
  vehicleReg?: string;
  bookingRef: string;
  reminderType: "return_24h" | "return_today" | "overdue";
  returnDate: string;
  returnTime?: string;
  returnLocation?: string;
  daysOverdue?: number;
  tenantId?: string;
}

const getReminderContent = (type: string, daysOverdue?: number) => {
  switch (type) {
    case "return_24h":
      return {
        title: "Rental Return Reminder - 24 Hours",
        badge: "REMINDER",
        badgeColor: "#0ea5e9",
        badgeBg: "#f0f9ff",
        subject: "Rental Return Tomorrow",
        message: "This is a friendly reminder that your rental is due to be returned tomorrow.",
        urgency: "normal",
      };
    case "return_today":
      return {
        title: "Rental Return Due Today",
        badge: "DUE TODAY",
        badgeColor: "#f59e0b",
        badgeBg: "#fef3c7",
        subject: "Rental Return Due Today",
        message: "Your rental is due to be returned today. Please ensure the vehicle is returned on time.",
        urgency: "high",
      };
    case "overdue":
      return {
        title: "Rental Return Overdue",
        badge: "OVERDUE",
        badgeColor: "#dc2626",
        badgeBg: "#fef2f2",
        subject: `Rental ${daysOverdue} Day${daysOverdue !== 1 ? 's' : ''} Overdue`,
        message: `Your rental is now ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue. Please return the vehicle immediately to avoid additional charges.`,
        urgency: "critical",
      };
    default:
      return {
        title: "Rental Reminder",
        badge: "REMINDER",
        badgeColor: "#6b7280",
        badgeBg: "#f3f4f6",
        subject: "Rental Reminder",
        message: "This is a reminder about your rental.",
        urgency: "normal",
      };
  }
};

const getEmailContent = (data: NotifyRequest, branding: TenantBranding) => {
  const content = getReminderContent(data.reminderType, data.daysOverdue);

  return `
                    <tr>
                        <td style="padding: 30px 30px 0; text-align: center;">
                            <span style="display: inline-block; background: ${content.badgeBg}; color: ${content.badgeColor}; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                ${content.badge}
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                ${content.message}
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
                                            ${data.vehicleReg ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Registration:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleReg}</td>
                                            </tr>
                                            ` : ''}
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Return Date:</td>
                                                <td style="padding: 8px 0; color: ${content.badgeColor}; font-weight: 600; font-size: 14px; text-align: right;">${data.returnDate}</td>
                                            </tr>
                                            ${data.returnTime ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Return Time:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.returnTime}</td>
                                            </tr>
                                            ` : ''}
                                            ${data.returnLocation ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Return Location:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.returnLocation}</td>
                                            </tr>
                                            ` : ''}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            ${data.reminderType === "overdue" ? `
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef2f2; border-left: 4px solid #dc2626; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #991b1b; font-size: 14px;">Important Notice</h3>
                                        <p style="margin: 0; color: #991b1b; font-size: 14px; line-height: 1.6;">
                                            Late returns may incur additional daily charges. Please contact us immediately if you need to extend your rental.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            ` : `
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #0369a1; font-size: 14px;">Return Checklist</h3>
                                        <ul style="margin: 0; padding-left: 20px; color: #0369a1; font-size: 14px; line-height: 1.8;">
                                            <li>Fill the fuel tank to the same level as pickup</li>
                                            <li>Remove all personal belongings</li>
                                            <li>Return all keys and documents</li>
                                            <li>Note any new damage on the inspection form</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>
                            `}
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                If you need to extend your rental or have any questions, please contact us.
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
    console.log('Sending rental reminder for:', data.bookingRef, 'Type:', data.reminderType);

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

    const content = getReminderContent(data.reminderType, data.daysOverdue);

    // Build branded email HTML
    const emailContent = getEmailContent(data, branding);
    const emailHtml = wrapWithBrandedTemplate(emailContent, branding);

    // Send customer email
    results.customerEmail = await sendEmail(
      data.customerEmail,
      `${content.subject} - ${data.bookingRef}`,
      emailHtml,
      supabase,
      data.tenantId
    );
    console.log('Customer email result:', results.customerEmail);

    // Send customer SMS
    if (data.customerPhone) {
      let smsMessage = "";
      switch (data.reminderType) {
        case "return_24h":
          smsMessage = `${branding.companyName}: Reminder - Your rental ${data.bookingRef} is due for return tomorrow, ${data.returnDate}. Please ensure timely return.`;
          break;
        case "return_today":
          smsMessage = `${branding.companyName}: Your rental ${data.bookingRef} is due for return TODAY. Please return ${data.vehicleName} by ${data.returnTime || 'end of day'}.`;
          break;
        case "overdue":
          smsMessage = `${branding.companyName} URGENT: Your rental ${data.bookingRef} is ${data.daysOverdue} day(s) overdue. Please return immediately to avoid additional charges.`;
          break;
        default:
          smsMessage = `${branding.companyName}: Reminder about your rental ${data.bookingRef}. Please check your email for details.`;
      }

      results.customerSMS = await sendSMS(data.customerPhone, smsMessage);
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
