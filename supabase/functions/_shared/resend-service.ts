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
 * Tenant branding information for emails
 */
export interface TenantBranding {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  contactEmail: string;
  contactPhone: string | null;
  slug: string;
}

const DEFAULT_BRANDING: TenantBranding = {
  companyName: 'Drive 247',
  logoUrl: null,
  primaryColor: '#1a1a1a',
  accentColor: '#C5A572',
  contactEmail: 'support@drive-247.com',
  contactPhone: null,
  slug: 'drive247',
};

/**
 * Get tenant branding for email templates
 */
export async function getTenantBranding(tenantId: string, supabaseClient: any): Promise<TenantBranding> {
  try {
    const { data, error } = await supabaseClient
      .from('tenants')
      .select('slug, company_name, app_name, logo_url, primary_color, accent_color, contact_email, contact_phone')
      .eq('id', tenantId)
      .single();

    if (error || !data) {
      console.error('Error fetching tenant branding:', error);
      return DEFAULT_BRANDING;
    }

    return {
      companyName: data.app_name || data.company_name || DEFAULT_BRANDING.companyName,
      logoUrl: data.logo_url || null,
      primaryColor: data.primary_color || DEFAULT_BRANDING.primaryColor,
      accentColor: data.accent_color || DEFAULT_BRANDING.accentColor,
      contactEmail: data.contact_email || DEFAULT_BRANDING.contactEmail,
      contactPhone: data.contact_phone || null,
      slug: data.slug || DEFAULT_BRANDING.slug,
    };
  } catch (error) {
    console.error('Exception fetching tenant branding:', error);
    return DEFAULT_BRANDING;
  }
}

/**
 * Generate branded email header
 */
export function getEmailHeader(branding: TenantBranding): string {
  const logoHtml = branding.logoUrl
    ? `<img src="${branding.logoUrl}" alt="${branding.companyName}" style="max-height: 50px; max-width: 200px;">`
    : `<h1 style="margin: 0; color: ${branding.accentColor}; font-size: 28px; letter-spacing: 2px;">${branding.companyName.toUpperCase()}</h1>`;

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="background: linear-gradient(135deg, ${branding.primaryColor} 0%, #2d2d2d 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                            ${logoHtml}
                        </td>
                    </tr>`;
}

/**
 * Generate branded email footer
 */
export function getEmailFooter(branding: TenantBranding): string {
  const currentYear = new Date().getFullYear();

  return `
                    <tr>
                        <td style="background: #f8f9fa; padding: 25px 30px; border-radius: 0 0 12px 12px; text-align: center;">
                            <p style="margin: 0 0 10px; color: #666; font-size: 14px;">
                                Questions? Email us at <a href="mailto:${branding.contactEmail}" style="color: ${branding.accentColor}; text-decoration: none;">${branding.contactEmail}</a>
                            </p>
                            <p style="margin: 0; color: #999; font-size: 12px;">&copy; ${currentYear} ${branding.companyName}. All rights reserved.</p>
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
 * Wrap email content with branded header and footer
 */
export function wrapWithBrandedTemplate(content: string, branding: TenantBranding): string {
  return getEmailHeader(branding) + content + getEmailFooter(branding);
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
