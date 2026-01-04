import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders } from "../_shared/aws-config.ts";
import {
  sendEmail,
  getTenantBranding,
  TenantBranding,
  wrapWithBrandedTemplate
} from "../_shared/resend-service.ts";

function generateContactEmailContent(
  name: string,
  email: string,
  phone: string,
  subject: string,
  message: string,
  branding: TenantBranding
): string {
  return `
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">New Contact Form Submission</h2>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Name:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${name}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Email:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-align: right;"><a href="mailto:${email}" style="color: ${branding.accentColor};">${email}</a></td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Phone:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-align: right;"><a href="tel:${phone}" style="color: ${branding.accentColor};">${phone}</a></td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Subject:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${subject}</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-left: 4px solid ${branding.accentColor}; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #1a1a1a; font-size: 14px;">Message</h3>
                                        <p style="margin: 0; color: #444; line-height: 1.6; white-space: pre-wrap;">${message}</p>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef3c7; border-left: 4px solid ${branding.accentColor}; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 15px 20px;">
                                        <p style="margin: 0; color: #92400e; font-size: 14px;"><strong>Received:</strong> ${new Date().toLocaleString('en-GB', {
                                          dateStyle: 'full',
                                          timeStyle: 'short',
                                          timeZone: 'Europe/London'
                                        })}</p>
                                    </td>
                                </tr>
                            </table>
                            <div style="text-align: center;">
                                <a href="mailto:${email}" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: 600;">Reply to ${name.split(' ')[0]}</a>
                            </div>
                        </td>
                    </tr>`;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const {
      name,
      email,
      phone,
      subject,
      message,
      adminEmail,
      tenantId
    } = await req.json()

    // Create supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get tenant branding if tenantId is provided
    const branding = tenantId
      ? await getTenantBranding(tenantId, supabase)
      : { companyName: 'Drive 247', logoUrl: null, primaryColor: '#1a1a1a', accentColor: '#C5A572', contactEmail: 'support@drive-247.com', contactPhone: null, slug: 'drive247' };

    // Build branded email HTML
    const emailContent = generateContactEmailContent(name, email, phone, subject, message, branding);
    const emailHtml = wrapWithBrandedTemplate(emailContent, branding);

    // Send email using shared service
    const emailResult = await sendEmail(
      adminEmail,
      `New Contact Form Submission: ${subject}`,
      emailHtml,
      supabase,
      tenantId
    );

    if (emailResult?.success) {
      return new Response(JSON.stringify({ success: true, data: emailResult }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    } else {
      throw new Error(emailResult?.error || 'Failed to send email')
    }
  } catch (error) {
    console.error('Error sending contact email:', error)
    const errorMessage = String(error instanceof Error ? error.message : error)
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
