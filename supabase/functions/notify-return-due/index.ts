import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  signedAWSRequest,
  parseXMLValue,
  isAWSConfigured
} from "../_shared/aws-config.ts";
import { sendEmail } from "../_shared/resend-service.ts";

interface RentalInfo {
  bookingRef: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  vehicleName: string;
  vehicleReg: string;
  returnDate: string;
  returnTime?: string;
  returnLocation?: string;
  status: "due_today" | "overdue";
  daysOverdue?: number;
}

interface NotifyRequest {
  rentals: RentalInfo[];
}

const getAdminEmailHtml = (rentals: RentalInfo[]) => {
  const dueToday = rentals.filter(r => r.status === "due_today");
  const overdue = rentals.filter(r => r.status === "overdue");

  const renderRentalRow = (rental: RentalInfo) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${rental.bookingRef}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${rental.customerName}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${rental.vehicleName}<br><span style="color: #666; font-size: 12px;">${rental.vehicleReg}</span></td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${rental.returnDate}${rental.returnTime ? `<br><span style="color: #666; font-size: 12px;">${rental.returnTime}</span>` : ''}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${rental.status === "overdue" ? `<span style="color: #dc2626; font-weight: 600;">${rental.daysOverdue} day(s) overdue</span>` : '<span style="color: #f59e0b;">Due today</span>'}</td>
    </tr>
  `;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Returns Due - DRIVE 247 Admin</title></head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f5f5f5;">
    <table style="width: 100%; max-width: 800px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
        <tr>
            <td style="background: #1a1a1a; padding: 20px; text-align: center;">
                <h1 style="margin: 0; color: #C5A572; font-size: 24px;">DRIVE 247 ADMIN</h1>
            </td>
        </tr>
        <tr>
            <td style="padding: 30px;">
                <h2 style="margin: 0 0 20px; color: #1a1a1a;">Daily Returns Summary</h2>
                <p style="margin: 0 0 25px; color: #444;">Here's your daily summary of vehicle returns that need attention.</p>

                ${overdue.length > 0 ? `
                <div style="margin-bottom: 30px;">
                    <h3 style="margin: 0 0 15px; color: #dc2626; display: flex; align-items: center;">
                        <span style="display: inline-block; background: #fef2f2; color: #dc2626; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-right: 10px;">${overdue.length}</span>
                        OVERDUE RETURNS
                    </h3>
                    <table style="width: 100%; border-collapse: collapse; background: #fef2f2; border-radius: 8px;">
                        <thead>
                            <tr style="background: #fee2e2;">
                                <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">REF</th>
                                <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">CUSTOMER</th>
                                <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">VEHICLE</th>
                                <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">DUE DATE</th>
                                <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">STATUS</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${overdue.map(renderRentalRow).join('')}
                        </tbody>
                    </table>
                </div>
                ` : ''}

                ${dueToday.length > 0 ? `
                <div style="margin-bottom: 30px;">
                    <h3 style="margin: 0 0 15px; color: #f59e0b; display: flex; align-items: center;">
                        <span style="display: inline-block; background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-right: 10px;">${dueToday.length}</span>
                        DUE TODAY
                    </h3>
                    <table style="width: 100%; border-collapse: collapse; background: #fef3c7; border-radius: 8px;">
                        <thead>
                            <tr style="background: #fde68a;">
                                <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">REF</th>
                                <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">CUSTOMER</th>
                                <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">VEHICLE</th>
                                <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">RETURN TIME</th>
                                <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">STATUS</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${dueToday.map(renderRentalRow).join('')}
                        </tbody>
                    </table>
                </div>
                ` : ''}

                ${rentals.length === 0 ? `
                <div style="text-align: center; padding: 40px; background: #ecfdf5; border-radius: 8px;">
                    <p style="margin: 0; color: #10b981; font-size: 18px;">All caught up! No returns due today.</p>
                </div>
                ` : ''}

                <div style="text-align: center; margin-top: 25px;">
                    <a href="https://drive247-admin.vercel.app/rentals" style="display: inline-block; background: #C5A572; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 600;">View All Rentals</a>
                </div>
            </td>
        </tr>
        <tr>
            <td style="background: #f8f9fa; padding: 20px; text-align: center;">
                <p style="margin: 0; color: #999; font-size: 12px;">&copy; 2024 DRIVE 247 Admin Portal</p>
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
    console.log('Sending return due notification for', data.rentals.length, 'rentals');

    const results = {
      adminEmail: null as any,
      adminSMS: null as any,
    };

    const overdue = data.rentals.filter(r => r.status === "overdue");
    const dueToday = data.rentals.filter(r => r.status === "due_today");

    // Send admin email
    const adminEmail = EMAIL_CONFIG.adminEmail;
    let subject = "Daily Returns Summary";
    if (overdue.length > 0) {
      subject = `URGENT: ${overdue.length} Overdue Return${overdue.length > 1 ? 's' : ''} | DRIVE 247`;
    } else if (dueToday.length > 0) {
      subject = `${dueToday.length} Return${dueToday.length > 1 ? 's' : ''} Due Today | DRIVE 247`;
    }

    results.adminEmail = await sendEmail(
      adminEmail,
      subject,
      getAdminEmailHtml(data.rentals)
    );
    console.log('Admin email result:', results.adminEmail);

    // Send admin SMS if there are overdue rentals
    const adminPhone = EMAIL_CONFIG.adminPhone;
    if (adminPhone && overdue.length > 0) {
      results.adminSMS = await sendSMS(
        adminPhone,
        `DRIVE 247 URGENT: ${overdue.length} rental(s) overdue. Check admin portal for details.`
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
