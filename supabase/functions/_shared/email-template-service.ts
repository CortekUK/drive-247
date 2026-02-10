/**
 * Email Template Service
 * Fetches custom tenant email templates from the database and renders them with variable replacement
 */

// Default email templates (same as portal/src/lib/default-email-templates.ts)
const DEFAULT_EMAIL_TEMPLATES: Record<string, { subject: string; content: string }> = {
  booking_pending: {
    subject: 'Booking Received - {{rental_number}} | {{company_name}}',
    content: `<h1>Thank You for Your Booking Request</h1>

<p>Dear {{customer_name}},</p>

<p>Thank you for choosing <strong>{{company_name}}</strong> for your vehicle rental needs. We have successfully received your booking request and our team is currently reviewing it.</p>

<p>You can expect to receive a confirmation email within <strong>24 hours</strong> once your booking has been approved.</p>

<hr>

<h2>Booking Summary</h2>

<table>
  <tr>
    <td><strong>Booking Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Registration:</strong></td>
    <td>{{vehicle_reg}}</td>
  </tr>
  <tr>
    <td><strong>Pickup Date:</strong></td>
    <td>{{rental_start_date}}</td>
  </tr>
  <tr>
    <td><strong>Return Date:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
  <tr>
    <td><strong>Rental Amount:</strong></td>
    <td>{{rental_amount}}</td>
  </tr>
</table>

<hr>

<h2>What Happens Next?</h2>

<ol>
  <li>Our team will review your booking details and verify availability</li>
  <li>You will receive a confirmation email once approved</li>
  <li>A rental agreement will be sent via DocuSign for your signature</li>
  <li>Bring your valid driving licence and booking confirmation on pickup day</li>
</ol>

<p><strong>Please Note:</strong> A temporary hold has been placed on your payment card. This will only be charged once your booking is confirmed.</p>

<hr>

<h2>Need Help?</h2>

<p>If you have any questions about your booking or need to make changes, please don't hesitate to contact us:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>We look forward to serving you!</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  booking_approved: {
    subject: 'Booking Confirmed - {{rental_number}} | {{company_name}}',
    content: `<h1>Your Booking is Confirmed!</h1>

<p>Dear {{customer_name}},</p>

<p>Great news! Your booking with <strong>{{company_name}}</strong> has been <strong>approved and confirmed</strong>. Your vehicle is reserved and ready for collection on your scheduled pickup date.</p>

<hr>

<h2>Booking Confirmation</h2>

<table>
  <tr>
    <td><strong>Confirmation Number:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Registration:</strong></td>
    <td>{{vehicle_reg}}</td>
  </tr>
  <tr>
    <td><strong>Pickup Date:</strong></td>
    <td>{{rental_start_date}}</td>
  </tr>
  <tr>
    <td><strong>Return Date:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
  <tr>
    <td><strong>Total Amount:</strong></td>
    <td>{{rental_amount}}</td>
  </tr>
</table>

<hr>

<h2>Before Your Pickup</h2>

<p>Please ensure you complete the following before collecting your vehicle:</p>

<ol>
  <li><strong>Sign Your Rental Agreement</strong> - You will receive a separate email from DocuSign with your rental agreement. Please review and sign it electronically before pickup.</li>
  <li><strong>Prepare Your Documents</strong> - Bring a valid driving licence (held for minimum 1 year) and a secondary form of ID.</li>
  <li><strong>Payment Card</strong> - Bring the same card used for booking for verification purposes.</li>
</ol>

<hr>

<h2>Contact Us</h2>

<p>If you have any questions or need to make changes to your booking:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for choosing {{company_name}}. We look forward to seeing you!</p>

<p>Safe travels,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  booking_rejected: {
    subject: 'Booking Update - {{rental_number}} | {{company_name}}',
    content: `<h1>Booking Update</h1>

<p>Dear {{customer_name}},</p>

<p>Thank you for your interest in renting with <strong>{{company_name}}</strong>. Unfortunately, we were unable to approve your booking request at this time.</p>

<hr>

<h2>Booking Details</h2>

<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle Requested:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Requested Dates:</strong></td>
    <td>{{rental_start_date}} - {{rental_end_date}}</td>
  </tr>
</table>

<hr>

<h2>Reason</h2>

<p>{{rejection_reason}}</p>

<hr>

<h2>No Charges Applied</h2>

<p>Please be assured that <strong>no payment has been taken</strong> from your card. Any temporary authorisation hold will be automatically released within 3-5 business days, depending on your bank.</p>

<hr>

<h2>Questions?</h2>

<p>If you believe this decision was made in error or would like more information, please contact our team:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>We appreciate your understanding and hope to serve you in the future.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  booking_cancelled: {
    subject: 'Booking Cancelled - {{rental_number}} | {{company_name}}',
    content: `<h1>Booking Cancellation Confirmation</h1>

<p>Dear {{customer_name}},</p>

<p>This email confirms that your booking with <strong>{{company_name}}</strong> has been cancelled.</p>

<hr>

<h2>Cancelled Booking Details</h2>

<table>
  <tr>
    <td><strong>Booking Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Original Rental Period:</strong></td>
    <td>{{rental_start_date}} - {{rental_end_date}}</td>
  </tr>
</table>

<hr>

<h2>Refund Information</h2>

<p>Any applicable refunds will be processed according to our cancellation policy. If a refund is due, it will be credited to your original payment method within 5-10 business days.</p>

<hr>

<h2>Contact Us</h2>

<p>If you have any questions about your cancellation or refund:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for considering {{company_name}}.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  rental_started: {
    subject: 'Your Rental Has Begun - {{rental_number}} | {{company_name}}',
    content: `<h1>Your Rental Has Started!</h1>

<p>Dear {{customer_name}},</p>

<p>Welcome aboard! Your rental with <strong>{{company_name}}</strong> has officially begun. We hope you enjoy your driving experience.</p>

<hr>

<h2>Your Rental Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Registration:</strong></td>
    <td>{{vehicle_reg}}</td>
  </tr>
  <tr>
    <td><strong>Rental Start:</strong></td>
    <td>{{rental_start_date}}</td>
  </tr>
  <tr>
    <td><strong>Rental End:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
</table>

<hr>

<h2>Important Reminders</h2>

<ul>
  <li><strong>Drive Safely</strong> - Always follow traffic laws and drive responsibly</li>
  <li><strong>Fuel Policy</strong> - Please return the vehicle with the same fuel level as pickup</li>
  <li><strong>Cleanliness</strong> - Please keep the vehicle clean during your rental</li>
  <li><strong>Smoking</strong> - Smoking is strictly prohibited in all our vehicles</li>
</ul>

<hr>

<h2>24/7 Support</h2>

<p>We're here to help throughout your rental period:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Have a safe and enjoyable journey!</p>

<p>Best wishes,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  rental_reminder: {
    subject: 'Payment Reminder - {{rental_number}} | {{company_name}}',
    content: `<h1>Payment Reminder</h1>

<p>Dear {{customer_name}},</p>

<p>This is a friendly reminder about an upcoming payment for your rental with <strong>{{company_name}}</strong>.</p>

<hr>

<h2>Payment Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Amount Due:</strong></td>
    <td>{{payment_amount}}</td>
  </tr>
  <tr>
    <td><strong>Due Date:</strong></td>
    <td>{{due_date}}</td>
  </tr>
</table>

<hr>

<h2>Need Assistance?</h2>

<p>If you're experiencing any difficulties or need to discuss payment options, please contact us:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for your prompt attention to this matter.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  rental_completed: {
    subject: 'Thank You for Renting With Us - {{rental_number}} | {{company_name}}',
    content: `<h1>Thank You!</h1>

<p>Dear {{customer_name}},</p>

<p>Thank you for choosing <strong>{{company_name}}</strong>! Your rental has been successfully completed and the vehicle has been returned.</p>

<hr>

<h2>Rental Summary</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Rental Period:</strong></td>
    <td>{{rental_start_date}} - {{rental_end_date}}</td>
  </tr>
</table>

<hr>

<h2>We Value Your Feedback</h2>

<p>Your opinion matters to us! We would love to hear about your experience.</p>

<hr>

<h2>Stay Connected</h2>

<p>For any questions about your completed rental or to book again:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for choosing {{company_name}}. We look forward to seeing you again!</p>

<p>Warm regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  return_due: {
    subject: 'Vehicle Return Reminder - {{rental_number}} | {{company_name}}',
    content: `<h1>Vehicle Return Reminder</h1>

<p>Dear {{customer_name}},</p>

<p>This is a friendly reminder that your vehicle rental with <strong>{{company_name}}</strong> is coming to an end soon.</p>

<hr>

<h2>Return Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Registration:</strong></td>
    <td>{{vehicle_reg}}</td>
  </tr>
  <tr>
    <td><strong>Return Date:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
</table>

<hr>

<h2>Return Checklist</h2>

<ul>
  <li><strong>Fuel Level</strong> - Return the vehicle with the same fuel level as at pickup</li>
  <li><strong>Personal Belongings</strong> - Check all compartments and remove your personal items</li>
  <li><strong>Keys & Accessories</strong> - Return all keys, fobs, and any accessories provided</li>
</ul>

<hr>

<h2>Need to Extend?</h2>

<p>If you would like to extend your rental, please contact us before your scheduled return date.</p>

<hr>

<h2>Contact Us</h2>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for renting with {{company_name}}!</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  payment_failed: {
    subject: 'Action Required: Payment Issue - {{rental_number}} | {{company_name}}',
    content: `<h1>Payment Issue - Action Required</h1>

<p>Dear {{customer_name}},</p>

<p>We were unable to process your recent payment for your rental with <strong>{{company_name}}</strong>. Please don't worry - we're here to help you resolve this quickly.</p>

<hr>

<h2>Payment Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Amount:</strong></td>
    <td>{{payment_amount}}</td>
  </tr>
</table>

<hr>

<h2>What You Need to Do</h2>

<ol>
  <li><strong>Check Your Card Details</strong> - Ensure your card number, expiry date, and CVV are correct</li>
  <li><strong>Verify Available Funds</strong> - Make sure sufficient funds are available in your account</li>
  <li><strong>Contact Your Bank</strong> - Your bank may have blocked the transaction for security reasons</li>
</ol>

<hr>

<h2>Need Help?</h2>

<p>If you're experiencing difficulties or need assistance, our team is ready to help:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Please resolve this issue promptly to avoid any impact on your rental service.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  refund_processed: {
    subject: 'Refund Processed - {{rental_number}} | {{company_name}}',
    content: `<h1>Refund Confirmation</h1>

<p>Dear {{customer_name}},</p>

<p>Good news! We have successfully processed a refund to your account from <strong>{{company_name}}</strong>.</p>

<hr>

<h2>Refund Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Refund Amount:</strong></td>
    <td>{{refund_amount}}</td>
  </tr>
</table>

<hr>

<h2>When Will I Receive My Refund?</h2>

<p>The refund has been submitted to your original payment method. Please allow 5-10 business days for the refund to appear on your statement.</p>

<hr>

<h2>Questions?</h2>

<p>If you have any questions about this refund, please contact us:</p>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for your patience and for choosing {{company_name}}.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
  rental_extended: {
    subject: 'Rental Extended - {{rental_number}} | {{company_name}}',
    content: `<h1>Your Rental Has Been Extended</h1>

<p>Dear {{customer_name}},</p>

<p>Your rental with <strong>{{company_name}}</strong> has been extended. Below are the updated details:</p>

<hr>

<h2>Extension Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Previous End Date:</strong></td>
    <td>{{previous_end_date}}</td>
  </tr>
  <tr>
    <td><strong>New End Date:</strong></td>
    <td>{{new_end_date}}</td>
  </tr>
  <tr>
    <td><strong>Extension:</strong></td>
    <td>{{extension_days}} day(s)</td>
  </tr>
  <tr>
    <td><strong>Extension Cost:</strong></td>
    <td>{{extension_amount}}</td>
  </tr>
</table>

<hr>

<h2>Payment</h2>

<p>Please complete the extension payment at your earliest convenience. If a payment link has been provided, you can pay securely online.</p>

<hr>

<h2>Important Reminders</h2>

<ul>
  <li>Your insurance coverage may need to be reviewed for the extended period</li>
  <li>Please ensure your driving licence remains valid for the extended duration</li>
  <li>The vehicle must be returned by the new end date to avoid late fees</li>
</ul>

<hr>

<h2>Contact Us</h2>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for continuing to rent with {{company_name}}.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
  },
};

export interface EmailTemplateData {
  // Customer
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  // Vehicle
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_reg?: string;
  vehicle_year?: string;
  // Rental
  rental_number?: string;
  rental_start_date?: string;
  rental_end_date?: string;
  rental_amount?: string;
  monthly_amount?: string;
  rental_period_type?: string;
  // Company
  company_name?: string;
  company_email?: string;
  company_phone?: string;
  // Email-specific
  rejection_reason?: string;
  payment_amount?: string;
  refund_amount?: string;
  due_date?: string;
  // Extension-specific
  previous_end_date?: string;
  new_end_date?: string;
  extension_days?: string;
  extension_amount?: string;
  payment_url?: string;
}

interface EmailTemplate {
  subject: string;
  content: string;
  isCustom: boolean;
}

/**
 * Fetch custom email template from database, or fall back to default
 */
export async function getEmailTemplate(
  supabaseClient: any,
  tenantId: string,
  templateKey: string
): Promise<EmailTemplate> {
  try {
    // Try to fetch custom template
    const { data: customTemplate, error } = await supabaseClient
      .from('email_templates')
      .select('subject, template_content')
      .eq('tenant_id', tenantId)
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .maybeSingle();

    if (!error && customTemplate) {
      console.log(`Using custom email template for ${templateKey}`);
      return {
        subject: customTemplate.subject,
        content: customTemplate.template_content,
        isCustom: true,
      };
    }
  } catch (err) {
    console.warn(`Error fetching custom template ${templateKey}:`, err);
  }

  // Fall back to default template
  const defaultTemplate = DEFAULT_EMAIL_TEMPLATES[templateKey];
  if (defaultTemplate) {
    console.log(`Using default email template for ${templateKey}`);
    return {
      subject: defaultTemplate.subject,
      content: defaultTemplate.content,
      isCustom: false,
    };
  }

  // If no template found at all, return empty
  console.error(`No template found for key: ${templateKey}`);
  return {
    subject: '',
    content: '',
    isCustom: false,
  };
}

/**
 * Replace template variables with actual data
 */
export function replaceTemplateVariables(
  template: string,
  data: EmailTemplateData
): string {
  let result = template;

  // Replace all {{variable_name}} patterns
  Object.entries(data).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value || '');
  });

  // Clean up any remaining unreplaced variables
  result = result.replace(/\{\{[^}]+\}\}/g, '');

  return result;
}

interface EmailWrapOptions {
  companyName?: string;
  accentColor?: string;
  primaryColor?: string;
  logoUrl?: string | null;
  contactEmail?: string;
}

/**
 * Wrap email content in standard HTML email layout
 */
export function wrapEmailHtml(
  content: string,
  options: EmailWrapOptions = {}
): string {
  const {
    companyName = 'DRIVE 247',
    accentColor = '#C5A572',
    primaryColor = '#1a1a1a',
    logoUrl = null,
    contactEmail = 'support@drive-247.com',
  } = options;

  const headerContent = logoUrl
    ? `<img src="${logoUrl}" alt="${companyName}" style="max-height: 50px; max-width: 200px;">`
    : `<h1 style="margin: 0; color: ${accentColor}; font-size: 28px; letter-spacing: 2px;">${companyName.toUpperCase()}</h1>`;

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${companyName}</title>
    <style>
      body { margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f5f5; }
      table { border-collapse: collapse; }
      td { padding: 8px 12px; }
      h1 { color: #1a1a1a; margin: 0 0 20px; font-size: 26px; }
      h2 { color: #1a1a1a; margin: 24px 0 12px; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid ${accentColor}; padding-bottom: 8px; }
      h3 { color: #1a1a1a; margin: 20px 0 12px; font-size: 16px; }
      p { color: #444; line-height: 1.7; margin: 0 0 16px; font-size: 15px; }
      ul, ol { color: #444; padding-left: 24px; margin: 0 0 16px; }
      li { margin-bottom: 10px; line-height: 1.6; }
      hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
      table td { color: #444; font-size: 14px; border-bottom: 1px solid #eee; }
      table td:first-child { color: #666; width: 40%; }
      table td:last-child { color: #1a1a1a; font-weight: 600; }
      strong { color: #1a1a1a; }
      a { color: ${accentColor}; }
    </style>
</head>
<body>
    <table role="presentation" style="width: 100%; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="width: 600px; max-width: 100%; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, ${primaryColor} 0%, #2d2d2d 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                            ${headerContent}
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 35px;">
                            ${content}
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background: #f8f9fa; padding: 25px 30px; border-radius: 0 0 12px 12px; text-align: center;">
                            <p style="margin: 0 0 10px; color: #666; font-size: 14px;">
                                Questions? Email us at <a href="mailto:${contactEmail}" style="color: ${accentColor}; text-decoration: none;">${contactEmail}</a>
                            </p>
                            <p style="margin: 0; color: #999; font-size: 12px;">&copy; ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

/**
 * Get tenant information for email template data
 */
export async function getTenantInfo(
  supabaseClient: any,
  tenantId: string
): Promise<{ company_name: string; company_email: string; company_phone: string; primary_color: string; accent_color: string; logo_url: string | null; currency_code: string }> {
  try {
    const { data, error } = await supabaseClient
      .from('tenants')
      .select('company_name, contact_email, contact_phone, primary_color, accent_color, logo_url, currency_code')
      .eq('id', tenantId)
      .single();

    if (error) throw error;

    return {
      company_name: data.company_name || 'DRIVE 247',
      company_email: data.contact_email || 'support@drive-247.com',
      company_phone: data.contact_phone || '',
      primary_color: data.primary_color || '#1a1a1a',
      accent_color: data.accent_color || '#C5A572',
      logo_url: data.logo_url || null,
      currency_code: data.currency_code || 'GBP',
    };
  } catch (err) {
    console.warn('Error fetching tenant info:', err);
    return {
      company_name: 'DRIVE 247',
      company_email: 'support@drive-247.com',
      company_phone: '',
      primary_color: '#1a1a1a',
      accent_color: '#C5A572',
      logo_url: null,
      currency_code: 'GBP',
    };
  }
}

/**
 * Main function to render a complete email
 */
export async function renderEmail(
  supabaseClient: any,
  tenantId: string,
  templateKey: string,
  data: EmailTemplateData
): Promise<{ subject: string; html: string }> {
  // Get tenant info (always fetch to get branding colors)
  const tenantInfo = await getTenantInfo(supabaseClient, tenantId);

  // Merge tenant info with provided data
  data.company_name = data.company_name || tenantInfo.company_name;
  data.company_email = data.company_email || tenantInfo.company_email;
  data.company_phone = data.company_phone || tenantInfo.company_phone;

  // Get template (custom or default)
  const template = await getEmailTemplate(supabaseClient, tenantId, templateKey);

  // Replace variables in subject and content
  const subject = replaceTemplateVariables(template.subject, data);
  const content = replaceTemplateVariables(template.content, data);

  // Wrap in standard email HTML layout with tenant branding
  const html = wrapEmailHtml(content, {
    companyName: data.company_name,
    accentColor: tenantInfo.accent_color,
    primaryColor: tenantInfo.primary_color,
    logoUrl: tenantInfo.logo_url,
    contactEmail: data.company_email,
  });

  return { subject, html };
}
