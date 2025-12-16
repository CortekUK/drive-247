import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Handlebars from "https://esm.sh/handlebars@4.7.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RenderRequest {
  templateId?: string;
  templateBody?: string;
  templateSubject?: string;
  variables: Record<string, any>;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { templateId, templateBody, templateSubject, variables }: RenderRequest = await req.json();

    console.log('Rendering email template:', { templateId, hasBody: !!templateBody, variables });

    let htmlBody = templateBody || '';
    let subject = templateSubject || '';

    // If templateId provided, fetch from database
    if (templateId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: template, error } = await supabase
        .from('email_templates')
        .select('body, subject')
        .eq('id', templateId)
        .eq('is_active', true)
        .single();

      if (error) {
        throw new Error(`Template not found: ${error.message}`);
      }

      htmlBody = template.body;
      subject = template.subject;
    }

    if (!htmlBody) {
      throw new Error('No template body provided');
    }

    console.log('Compiling template with Handlebars...');

    // Register Handlebars helpers
    Handlebars.registerHelper('if', function(this: any, conditional: any, options: any) {
      if (conditional) {
        return options.fn(this);
      } else {
        return options.inverse(this);
      }
    });

    Handlebars.registerHelper('formatCurrency', function(amount: number) {
      if (typeof amount !== 'number') return amount;
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(amount);
    });

    Handlebars.registerHelper('formatDate', function(dateString: string) {
      if (!dateString) return '';
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    });

    // Compile and render templates
    const bodyTemplate = Handlebars.compile(htmlBody);
    const subjectTemplate = Handlebars.compile(subject);

    const renderedBody = bodyTemplate(variables);
    const renderedSubject = subjectTemplate(variables);

    console.log('Template rendered successfully');

    return new Response(
      JSON.stringify({
        success: true,
        html: renderedBody,
        subject: renderedSubject
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error: any) {
    console.error('Template rendering error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Template rendering failed'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
