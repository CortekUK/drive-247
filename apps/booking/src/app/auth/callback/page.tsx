'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

/**
 * Auth Callback Page
 *
 * Handles Supabase auth callbacks (email confirmation, magic links, OAuth)
 * This page processes the auth tokens from the URL hash and redirects appropriately.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Supabase automatically detects hash fragments and exchanges tokens
        // via the onAuthStateChange listener. We just need to wait for the session.
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('Auth callback error:', sessionError);
          setError(sessionError.message);
          return;
        }

        if (session) {
          // User is authenticated, redirect to portal
          console.log('Auth callback: Session found, redirecting to portal');
          router.replace('/portal');
        } else {
          // No session yet, wait a bit and try again (tokens might still be processing)
          setTimeout(async () => {
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            if (retrySession) {
              router.replace('/portal');
            } else {
              // Still no session, redirect to home
              console.log('Auth callback: No session after retry, redirecting to home');
              router.replace('/');
            }
          }, 1000);
        }
      } catch (err) {
        console.error('Auth callback unexpected error:', err);
        setError('An unexpected error occurred');
      }
    };

    handleAuthCallback();
  }, [router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <p className="text-destructive">{error}</p>
          <button
            onClick={() => router.replace('/')}
            className="text-accent hover:underline"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <Loader2 className="w-10 h-10 text-accent animate-spin mx-auto" />
        <p className="text-muted-foreground">Confirming your email...</p>
      </div>
    </div>
  );
}
