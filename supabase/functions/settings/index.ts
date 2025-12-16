import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrgSettings {
  id?: string;
  org_id: string;
  company_name: string;
  timezone: string;
  currency_code: string;
  date_format: string;
  logo_url?: string;
  reminder_due_today: boolean;
  reminder_overdue_1d: boolean;
  reminder_overdue_multi: boolean;
  reminder_due_soon_2d: boolean;
  payment_mode: 'automated' | 'manual';
  tests_last_run_dashboard?: string;
  tests_last_result_dashboard?: any;
  tests_last_run_rental?: string;
  tests_last_result_rental?: any;
  tests_last_run_finance?: string;
  tests_last_result_finance?: any;
  // Branding fields
  app_name?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  // Theme-specific colors
  light_primary_color?: string;
  light_secondary_color?: string;
  light_accent_color?: string;
  dark_primary_color?: string;
  dark_secondary_color?: string;
  dark_accent_color?: string;
  // Background colors
  light_background_color?: string;
  dark_background_color?: string;
  // Header/Footer colors
  light_header_footer_color?: string;
  dark_header_footer_color?: string;
  // Meta tags
  meta_title?: string;
  meta_description?: string;
  og_image_url?: string;
  favicon_url?: string;
  created_at?: string;
  updated_at?: string;
}

// In-memory cache for settings (60 seconds)
let settingsCache: { data: OrgSettings | null; timestamp: number } = {
  data: null,
  timestamp: 0
};

const CACHE_DURATION = 60 * 1000; // 60 seconds

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const currentTime = Date.now();

    if (req.method === 'GET') {
      // Check cache first
      if (settingsCache.data && (currentTime - settingsCache.timestamp) < CACHE_DURATION) {
        console.log('Returning cached settings');
        return new Response(JSON.stringify(settingsCache.data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch from database
      const { data: settings, error } = await supabaseClient
        .from('org_settings')
        .select('*')
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching settings:', error);
        throw error;
      }

      // Auto-seed if no settings exist
      if (!settings) {
        console.log('No settings found, seeding default settings');
        const defaultSettings: Partial<OrgSettings> = {
          company_name: 'Fleet Management System',
          timezone: 'Europe/London',
          currency_code: 'GBP',
          date_format: 'DD/MM/YYYY',
          reminder_due_today: true,
          reminder_overdue_1d: true,
          reminder_overdue_multi: true,
          reminder_due_soon_2d: false,
          payment_mode: 'automated',
          // Branding defaults
          app_name: 'Drive 917',
          primary_color: '#C6A256',
          secondary_color: '#C6A256',
          accent_color: '#C6A256',
          meta_title: 'Drive 917 - Portal',
          meta_description: 'Fleet management portal',
        };

        const { data: newSettings, error: insertError } = await supabaseClient
          .from('org_settings')
          .insert(defaultSettings)
          .select()
          .single();

        if (insertError) {
          console.error('Error creating default settings:', insertError);
          throw insertError;
        }

        // Update cache
        settingsCache = { data: newSettings, timestamp: currentTime };
        
        return new Response(JSON.stringify(newSettings), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update cache
      settingsCache = { data: settings, timestamp: currentTime };

      return new Response(JSON.stringify(settings), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST') {
      // Handle body - always use text() and parse manually
      let body;
      try {
        const rawBody = await req.text();
        console.log('Raw body received:', rawBody);

        if (rawBody && rawBody.trim()) {
          body = JSON.parse(rawBody);
        } else {
          body = {};
        }
        console.log('Parsed body:', JSON.stringify(body));
      } catch (parseError) {
        console.error('Failed to parse request body:', parseError);
        return new Response(JSON.stringify({ error: 'Invalid request body: ' + parseError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Validate required fields
      const validFields = [
        'company_name', 'timezone', 'currency_code', 'date_format',
        'logo_url', 'reminder_due_today', 'reminder_overdue_1d',
        'reminder_overdue_multi', 'reminder_due_soon_2d', 'payment_mode',
        'tests_last_run_dashboard', 'tests_last_result_dashboard',
        'tests_last_run_rental', 'tests_last_result_rental',
        'tests_last_run_finance', 'tests_last_result_finance',
        // Branding fields
        'app_name', 'primary_color', 'secondary_color', 'accent_color',
        // Theme-specific colors
        'light_primary_color', 'light_secondary_color', 'light_accent_color',
        'dark_primary_color', 'dark_secondary_color', 'dark_accent_color',
        // Background colors
        'light_background_color', 'dark_background_color',
        // Header/Footer colors
        'light_header_footer_color', 'dark_header_footer_color',
        // Meta tags
        'meta_title', 'meta_description', 'og_image_url', 'favicon_url'
      ];

      // Filter out invalid fields
      const filteredUpdate: Partial<OrgSettings> = {};
      for (const [key, value] of Object.entries(body)) {
        if (validFields.includes(key)) {
          filteredUpdate[key as keyof OrgSettings] = value;
        }
      }

      // Validation
      if (filteredUpdate.timezone && !['Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles'].includes(filteredUpdate.timezone)) {
        return new Response(JSON.stringify({ error: 'Invalid timezone' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (filteredUpdate.currency_code && !['GBP', 'EUR', 'USD'].includes(filteredUpdate.currency_code)) {
        return new Response(JSON.stringify({ error: 'Invalid currency code' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (filteredUpdate.date_format && !['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(filteredUpdate.date_format)) {
        return new Response(JSON.stringify({ error: 'Invalid date format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (filteredUpdate.payment_mode && !['automated', 'manual'].includes(filteredUpdate.payment_mode)) {
        return new Response(JSON.stringify({ error: 'Invalid payment mode' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if settings exist
      const { data: existingSettings } = await supabaseClient
        .from('org_settings')
        .select('id')
        .limit(1)
        .single();

      let updatedSettings;
      if (existingSettings) {
        // Update existing settings
        const { data, error } = await supabaseClient
          .from('org_settings')
          .update(filteredUpdate)
          .eq('id', existingSettings.id)
          .select()
          .single();

        if (error) {
          console.error('Error updating settings:', error);
          throw error;
        }
        updatedSettings = data;
      } else {
        // Insert new settings if none exist
        const { data, error } = await supabaseClient
          .from('org_settings')
          .insert(filteredUpdate)
          .select()
          .single();

        if (error) {
          console.error('Error creating settings:', error);
          throw error;
        }
        updatedSettings = data;
      }

      // Bust cache
      settingsCache = { data: null, timestamp: 0 };

      console.log('Settings updated successfully');
      return new Response(JSON.stringify(updatedSettings), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Settings API error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});