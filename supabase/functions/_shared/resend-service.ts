/**
 * Resend Email Service - Multi-tenant aware
 * Replaces AWS SES with Resend for email delivery
 */

interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
  tenantId?: string;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  simulated?: boolean;
}

/**
 * Get tenant-specific email settings from database
 */
async function getTenantEmailSettings(tenantId: string, supabaseClient: any) {
  try {
    const { data, error } = await supabaseClient
      .from('tenants')
      .select('slug, company_name, admin_email, contact_email')
      .eq('id', tenantId)
      .single();

    if (error) {
      console.error('Error fetching tenant email settings:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Exception fetching tenant settings:', error);
    return null;
  }
}

/**
 * Get tenant admin email for notifications
 * Falls back to contact_email if admin_email not set
 */
export async function getTenantAdminEmail(tenantId: string, supabaseClient: any): Promise<string | null> {
  try {
    const { data, error } = await supabaseClient
      .from('tenants')
      .select('admin_email, contact_email')
      .eq('id', tenantId)
      .single();

    if (error) {
      console.error('Error fetching tenant admin email:', error);
      return null;
    }

    // Prefer admin_email, fall back to contact_email
    return data?.admin_email || data?.contact_email || null;
  } catch (error) {
    console.error('Exception fetching tenant admin email:', error);
    return null;
  }
}

/**
 * Send email via Resend API
 * Multi-tenant aware: uses tenant-specific sender if tenantId provided
 */
export async function sendResendEmail(
  options: EmailOptions,
  supabaseClient?: any
): Promise<EmailResult> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, simulating email send');
    console.log('To:', options.to);
    console.log('Subject:', options.subject);
    return {
      success: true,
      simulated: true,
      messageId: 'simulated-' + Date.now(),
    };
  }

  // Default sender info
  let fromEmail = options.from || 'noreply@drive-247.com';
  let fromName = options.fromName || 'Drive 247';

  // If tenant-specific email is requested and we have a Supabase client
  if (options.tenantId && supabaseClient) {
    const tenantSettings = await getTenantEmailSettings(options.tenantId, supabaseClient);
    if (tenantSettings) {
      // Use {slug}@drive-247.com as the from email
      if (tenantSettings.slug) {
        fromEmail = `${tenantSettings.slug}@drive-247.com`;
      }
      if (tenantSettings.company_name) {
        fromName = tenantSettings.company_name;
      }
    }
  }

  const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

  // Build Resend API request
  const emailData: any = {
    from: `${fromName} <${fromEmail}>`,
    to: toAddresses,
    subject: options.subject,
  };

  if (options.html) {
    emailData.html = options.html;
  }

  if (options.text) {
    emailData.text = options.text;
  }

  if (options.replyTo) {
    emailData.reply_to = options.replyTo;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });

    const responseData = await response.json();
    console.log('Resend API Response Status:', response.status);

    if (!response.ok) {
      console.error('Resend API Error:', responseData);
      return {
        success: false,
        error: responseData.message || 'Unknown error from Resend',
      };
    }

    console.log('Email sent successfully via Resend, ID:', responseData.id);

    return {
      success: true,
      messageId: responseData.id,
    };
  } catch (error) {
    console.error('Resend API request error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Backwards-compatible sendEmail function
 * Drop-in replacement for the old AWS SES sendEmail
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  supabaseClient?: any,
  tenantId?: string
): Promise<EmailResult> {
  return sendResendEmail({
    to,
    subject,
    html,
    tenantId,
  }, supabaseClient);
}
