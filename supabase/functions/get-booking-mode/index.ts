import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get the booking_payment_mode from org_settings
    const { data, error } = await supabase
      .from('org_settings')
      .select('booking_payment_mode')
      .limit(1)
      .single()

    if (error) {
      console.error('Error fetching booking mode:', error)
      // Default to manual mode if settings not found
      return new Response(
        JSON.stringify({ mode: 'manual' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    return new Response(
      JSON.stringify({ mode: data.booking_payment_mode || 'manual' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error in get-booking-mode:', error)
    // Default to manual mode on error
    return new Response(
      JSON.stringify({ mode: 'manual' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  }
})
