/**
 * Email Template Service
 * Fetches custom tenant email templates from the database and renders them with variable replacement
 */

// Default email templates (same as portal/src/lib/default-email-templates.ts)
const DEFAULT_EMAIL_TEMPLATES: Record<string, { subject: string; content: string }> = {
  booking_pending: {
    subject: 'Booking Received - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Thank you for choosing {{company_name}}! We've received your booking request and our team is reviewing it.</p>

<p>You'll receive a confirmation email within <strong>24 hours</strong> once your booking is approved.</p>

<h3>Booking Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
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
    <td><strong>Amount:</strong></td>
    <td>{{rental_amount}}</td>
  </tr>
</table>

<p>If you have any questions, please don't hesitate to contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  booking_approved: {
    subject: 'Booking Confirmed - {{rental_number}}',
    content: `<h2>Great news, {{customer_name}}!</h2>

<p>Your booking has been <strong>approved</strong> and confirmed. We're excited to have you as our customer!</p>

<h3>Booking Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
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
    <td><strong>Amount:</strong></td>
    <td>{{rental_amount}}</td>
  </tr>
</table>

<h3>Next Steps</h3>
<ul>
  <li>You'll receive a rental agreement to sign via DocuSign</li>
  <li>Please bring a valid driver's license on pickup day</li>
  <li>Contact us if you need to make any changes</li>
</ul>

<p>If you have any questions, please contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  booking_rejected: {
    subject: 'Booking Update - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Unfortunately, we were unable to approve your booking request at this time.</p>

<h3>Booking Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}}</td>
  </tr>
  <tr>
    <td><strong>Requested Dates:</strong></td>
    <td>{{rental_start_date}} - {{rental_end_date}}</td>
  </tr>
</table>

<p><strong>Reason:</strong> {{rejection_reason}}</p>

<p>Any pre-authorization on your card will be released within 5-7 business days.</p>

<p>We'd love to help you find an alternative. Please browse our available vehicles or contact us for assistance.</p>

<p>Contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  booking_cancelled: {
    subject: 'Booking Cancelled - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Your booking has been cancelled as requested.</p>

<h3>Cancelled Booking Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Original Dates:</strong></td>
    <td>{{rental_start_date}} - {{rental_end_date}}</td>
  </tr>
</table>

<p>Any applicable refunds will be processed according to our cancellation policy.</p>

<p>We hope to serve you again in the future. If you'd like to make a new booking, please visit our website or contact us.</p>

<p>Contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  rental_started: {
    subject: 'Your Rental Has Started - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Your rental has officially started. We hope you enjoy your driving experience!</p>

<h3>Rental Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Start Date:</strong></td>
    <td>{{rental_start_date}}</td>
  </tr>
  <tr>
    <td><strong>Return Date:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
</table>

<h3>Important Reminders</h3>
<ul>
  <li>Drive safely and follow all traffic laws</li>
  <li>Keep the vehicle clean and report any issues immediately</li>
  <li>Return the vehicle with the same fuel level</li>
  <li>Contact us immediately in case of an accident or emergency</li>
</ul>

<p>If you need any assistance during your rental, please contact us at {{company_email}} or {{company_phone}}.</p>

<p>Enjoy your ride!<br>{{company_name}} Team</p>`,
  },
  rental_reminder: {
    subject: 'Reminder - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>This is a friendly reminder about your rental with {{company_name}}.</p>

<h3>Rental Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
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

<p>Please ensure your payment is made on time to avoid any interruption to your rental.</p>

<p>If you have any questions or concerns, please contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  rental_completed: {
    subject: 'Thank You - Rental Complete {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Thank you for renting with {{company_name}}! Your rental has been successfully completed.</p>

<h3>Rental Summary</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
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

<p>We hope you had a great experience with us. We'd love to have you back for your next rental!</p>

<p>If you have any feedback or questions, please don't hesitate to contact us at {{company_email}}.</p>

<p>Thank you for choosing {{company_name}}!<br>{{company_name}} Team</p>`,
  },
  return_due: {
    subject: 'Return Reminder - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>This is a friendly reminder that your vehicle return is coming up soon.</p>

<h3>Rental Details</h3>
<table>
  <tr>
    <td><strong>Reference:</strong></td>
    <td>{{rental_number}}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>{{vehicle_make}} {{vehicle_model}} ({{vehicle_reg}})</td>
  </tr>
  <tr>
    <td><strong>Return Date:</strong></td>
    <td>{{rental_end_date}}</td>
  </tr>
</table>

<h3>Return Checklist</h3>
<ul>
  <li>Return the vehicle with the same fuel level</li>
  <li>Remove all personal belongings</li>
  <li>Ensure the vehicle is clean</li>
  <li>Return keys and all accessories</li>
</ul>

<p>Need to extend your rental? Contact us as soon as possible at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  payment_failed: {
    subject: 'Payment Issue - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>We were unable to process your recent payment.</p>

<h3>Payment Details</h3>
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

<p><strong>Action Required:</strong> Please update your payment method or contact us to resolve this issue as soon as possible to avoid any interruption to your rental.</p>

<p>Contact us at {{company_email}} or {{company_phone}} for assistance.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
  },
  refund_processed: {
    subject: 'Refund Processed - {{rental_number}}',
    content: `<h2>Hello {{customer_name}},</h2>

<p>Your refund has been processed successfully.</p>

<h3>Refund Details</h3>
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

<p>The refund will be credited to your original payment method within 5-10 business days, depending on your bank.</p>

<p>If you have any questions, please contact us at {{company_email}} or {{company_phone}}.</p>

<p>Best regards,<br>{{company_name}} Team</p>`,
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

/**
 * Wrap email content in standard HTML email layout
 */
export function wrapEmailHtml(
  content: string,
  companyName: string = 'DRIVE 247',
  primaryColor: string = '#C5A572'
): string {
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
      h2 { color: #1a1a1a; margin: 0 0 16px; font-size: 22px; }
      h3 { color: #1a1a1a; margin: 20px 0 12px; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; }
      p { color: #444; line-height: 1.6; margin: 0 0 16px; font-size: 16px; }
      ul, ol { color: #444; padding-left: 24px; margin: 0 0 16px; }
      li { margin-bottom: 8px; line-height: 1.5; }
      table td { color: #444; font-size: 14px; border-bottom: 1px solid #eee; }
      table td:first-child { color: #666; }
      table td:last-child { color: #1a1a1a; font-weight: 600; text-align: right; }
    </style>
</head>
<body>
    <table role="presentation" style="width: 100%; background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" style="width: 600px; max-width: 100%; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                            <h1 style="margin: 0; color: ${primaryColor}; font-size: 28px; letter-spacing: 2px;">${companyName}</h1>
                            <p style="margin: 10px 0 0; color: #888; font-size: 14px;">Premium Car Rentals</p>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 30px;">
                            ${content}
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background: #f8f9fa; padding: 25px 30px; border-radius: 0 0 12px 12px; text-align: center;">
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
): Promise<{ company_name: string; company_email: string; company_phone: string }> {
  try {
    const { data, error } = await supabaseClient
      .from('tenants')
      .select('company_name, email, phone')
      .eq('id', tenantId)
      .single();

    if (error) throw error;

    return {
      company_name: data.company_name || 'DRIVE 247',
      company_email: data.email || 'support@drive-247.com',
      company_phone: data.phone || '',
    };
  } catch (err) {
    console.warn('Error fetching tenant info:', err);
    return {
      company_name: 'DRIVE 247',
      company_email: 'support@drive-247.com',
      company_phone: '',
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
  // Get tenant info if not provided
  if (!data.company_name || !data.company_email) {
    const tenantInfo = await getTenantInfo(supabaseClient, tenantId);
    data.company_name = data.company_name || tenantInfo.company_name;
    data.company_email = data.company_email || tenantInfo.company_email;
    data.company_phone = data.company_phone || tenantInfo.company_phone;
  }

  // Get template (custom or default)
  const template = await getEmailTemplate(supabaseClient, tenantId, templateKey);

  // Replace variables in subject and content
  const subject = replaceTemplateVariables(template.subject, data);
  const content = replaceTemplateVariables(template.content, data);

  // Wrap in standard email HTML layout
  const html = wrapEmailHtml(content, data.company_name);

  return { subject, html };
}
