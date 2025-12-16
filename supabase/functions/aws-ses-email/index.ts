import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  signedAWSRequest,
  parseXMLValue,
  isAWSConfigured,
  EMAIL_CONFIG
} from "../_shared/aws-config.ts";

interface EmailRequest {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
  template?: string;
  templateData?: Record<string, string>;
}

interface EmailResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  simulated?: boolean;
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
 * Send email via AWS SES
 */
async function sendEmail(request: EmailRequest): Promise<EmailResponse> {
  // Check if AWS is configured
  if (!isAWSConfigured()) {
    console.log('AWS not configured, simulating email send');
    console.log('To:', request.to);
    console.log('Subject:', request.subject);
    console.log('HTML (first 500 chars):', request.html?.substring(0, 500));
    return {
      success: true,
      simulated: true,
      messageId: 'simulated-' + Date.now()
    };
  }

  const fromEmail = request.from || EMAIL_CONFIG.fromEmail;
  const toAddresses = Array.isArray(request.to) ? request.to : [request.to];

  // Build SES SendEmail request body
  const params: Record<string, string> = {
    'Action': 'SendEmail',
    'Version': '2010-12-01',
    'Source': fromEmail,
    'Message.Subject.Data': request.subject,
    'Message.Subject.Charset': 'UTF-8',
  };

  // Add recipients
  toAddresses.forEach((email, index) => {
    params[`Destination.ToAddresses.member.${index + 1}`] = email;
  });

  // Add reply-to if specified
  if (request.replyTo) {
    params['ReplyToAddresses.member.1'] = request.replyTo;
  }

  // Add HTML body
  if (request.html) {
    params['Message.Body.Html.Data'] = request.html;
    params['Message.Body.Html.Charset'] = 'UTF-8';
  }

  // Add text body
  if (request.text) {
    params['Message.Body.Text.Data'] = request.text;
    params['Message.Body.Text.Charset'] = 'UTF-8';
  }

  // URL encode parameters
  const body = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  try {
    const response = await signedAWSRequest({
      service: 'ses',
      method: 'POST',
      body,
    });

    const responseText = await response.text();
    console.log('SES Response Status:', response.status);

    if (!response.ok) {
      console.error('SES Error Response:', responseText);
      const errorMessage = parseXMLValue(responseText, 'Message') || 'Unknown error';
      return {
        success: false,
        error: errorMessage,
      };
    }

    const messageId = parseXMLValue(responseText, 'MessageId');
    console.log('Email sent successfully, MessageId:', messageId);

    return {
      success: true,
      messageId: messageId || undefined,
    };
  } catch (error) {
    console.error('SES request error:', error);
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
    const request: EmailRequest = await req.json();
    console.log('Email request received:', {
      to: request.to,
      subject: request.subject,
      template: request.template,
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

    const result = await sendEmail(request);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in aws-ses-email:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
