import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { corsHeaders } from "../_shared/aws-config.ts";

interface EmailRequest {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  template?: string;
  templateData?: Record<string, string>;
  tenantId?: string; // Multi-tenant support
}

interface EmailResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Load email template and replace placeholders
 */
function processTemplate(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

/**
 * Get tenant-specific email settings from database
 */
async function getTenantEmailSettings(tenantId: string, supabaseClient: any) {
  try {
    const { data, error } = await supabaseClient
      .from('tenants')
      .select('email_from, company_name')
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
 * Send email via Resend
 */
async function sendEmail(request: EmailRequest, supabaseClient: any): Promise<EmailResponse> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return {
      success: false,
      error: 'Email service not configured',
    };
  }

  // Get tenant-specific settings if tenantId provided
  let fromEmail = request.from || 'noreply@drive-247.com';
  let fromName = 'Drive 247';

  if (request.tenantId) {
    const tenantSettings = await getTenantEmailSettings(request.tenantId, supabaseClient);
    if (tenantSettings) {
      if (tenantSettings.email_from) {
        fromEmail = tenantSettings.email_from;
      }
      if (tenantSettings.company_name) {
        fromName = tenantSettings.company_name;
      }
    }
  }

  const toAddresses = Array.isArray(request.to) ? request.to : [request.to];

  // Build Resend API request
  const emailData: any = {
    from: `${fromName} <${fromEmail}>`,
    to: toAddresses,
    subject: request.subject,
  };

  if (request.html) {
    emailData.html = request.html;
  }

  if (request.text) {
    emailData.text = request.text;
  }

  if (request.replyTo) {
    emailData.reply_to = request.replyTo;
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
    console.log('Resend Response Status:', response.status);

    if (!response.ok) {
      console.error('Resend Error Response:', responseData);
      return {
        success: false,
        error: responseData.message || 'Unknown error',
      };
    }

    console.log('Email sent successfully via Resend, ID:', responseData.id);

    return {
      success: true,
      messageId: responseData.id,
    };
  } catch (error) {
    console.error('Resend request error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create Supabase client for tenant lookups
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.3');
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    const request: EmailRequest = await req.json();
    console.log('Email request received:', {
      to: request.to,
      subject: request.subject,
      template: request.template,
      tenantId: request.tenantId,
    });

    // Validate required fields
    if (!request.to || !request.subject) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields: to, subject',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process template if provided
    if (request.template && request.templateData) {
      request.html = processTemplate(request.template, request.templateData);
    }

    // Ensure we have content
    if (!request.html && !request.text) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Either html or text content is required',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await sendEmail(request, supabaseClient);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in resend-email:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
