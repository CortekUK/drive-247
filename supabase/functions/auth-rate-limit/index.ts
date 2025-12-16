import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RateLimitRequest {
  email: string;
  ipAddress: string;
  success: boolean;
}

interface RateLimitResponse {
  allowed: boolean;
  attemptsRemaining: number;
  lockoutMinutes: number;
  nextAttemptAt?: string;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const WINDOW_MINUTES = 10;

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (req.method === 'POST') {
      const { email, ipAddress, success }: RateLimitRequest = await req.json();
      
      // Get client IP if not provided
      const clientIP = ipAddress || req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
      
      // Log the attempt
      await supabase.from('login_attempts').insert({
        username: email.toLowerCase(),
        ip_address: clientIP,
        success: success,
        attempted_at: new Date().toISOString()
      });

      // If successful login, clear old failed attempts
      if (success) {
        const cutoffTime = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
        await supabase
          .from('login_attempts')
          .delete()
          .eq('username', email.toLowerCase())
          .eq('success', false)
          .gte('attempted_at', cutoffTime);

        return new Response(JSON.stringify({
          allowed: true,
          attemptsRemaining: MAX_ATTEMPTS,
          lockoutMinutes: 0
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // Check failed attempts in the last window
      const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
      const { data: recentAttempts, error } = await supabase
        .from('login_attempts')
        .select('attempted_at')
        .eq('username', email.toLowerCase())
        .eq('success', false)
        .gte('attempted_at', windowStart)
        .order('attempted_at', { ascending: false });

      if (error) {
        console.error('Error checking attempts:', error);
        throw error;
      }

      const failedAttempts = recentAttempts?.length || 0;
      const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - failedAttempts);

      // Check if user is locked out
      if (failedAttempts >= MAX_ATTEMPTS) {
        const latestAttempt = new Date(recentAttempts[0].attempted_at);
        const lockoutEnd = new Date(latestAttempt.getTime() + LOCKOUT_MINUTES * 60 * 1000);
        const now = new Date();

        if (now < lockoutEnd) {
          const minutesRemaining = Math.ceil((lockoutEnd.getTime() - now.getTime()) / (60 * 1000));
          return new Response(JSON.stringify({
            allowed: false,
            attemptsRemaining: 0,
            lockoutMinutes: minutesRemaining,
            nextAttemptAt: lockoutEnd.toISOString()
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      return new Response(JSON.stringify({
        allowed: attemptsRemaining > 0,
        attemptsRemaining: Math.max(0, attemptsRemaining - 1),
        lockoutMinutes: attemptsRemaining <= 1 ? LOCKOUT_MINUTES : 0
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // GET request - check current status
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const email = url.searchParams.get('email');
      
      if (!email) {
        return new Response(JSON.stringify({ error: 'Email parameter required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
      const { data: recentAttempts } = await supabase
        .from('login_attempts')
        .select('attempted_at')
        .eq('username', email.toLowerCase())
        .eq('success', false)
        .gte('attempted_at', windowStart)
        .order('attempted_at', { ascending: false });

      const failedAttempts = recentAttempts?.length || 0;
      const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - failedAttempts);

      if (failedAttempts >= MAX_ATTEMPTS && recentAttempts.length > 0) {
        const latestAttempt = new Date(recentAttempts[0].attempted_at);
        const lockoutEnd = new Date(latestAttempt.getTime() + LOCKOUT_MINUTES * 60 * 1000);
        const now = new Date();

        if (now < lockoutEnd) {
          const minutesRemaining = Math.ceil((lockoutEnd.getTime() - now.getTime()) / (60 * 1000));
          return new Response(JSON.stringify({
            allowed: false,
            attemptsRemaining: 0,
            lockoutMinutes: minutesRemaining,
            nextAttemptAt: lockoutEnd.toISOString()
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      return new Response(JSON.stringify({
        allowed: true,
        attemptsRemaining,
        lockoutMinutes: 0
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error: any) {
    console.error('Error in auth-rate-limit function:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      allowed: true, // Fail open for availability
      attemptsRemaining: MAX_ATTEMPTS,
      lockoutMinutes: 0
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
});