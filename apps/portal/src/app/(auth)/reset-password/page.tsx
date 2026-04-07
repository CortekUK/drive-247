"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * Reset Password Page
 *
 * Handles legacy confirmation links from emails. If a user arrives here
 * with a valid Supabase session (from a link token), they can set a new password.
 * Otherwise, redirects to the login page where OTP-based reset is available.
 */
export default function ResetPasswordPage() {
  const router = useRouter();

  useEffect(() => {
    const check = async () => {
      // If user landed here via old confirmation link, Supabase may have set a session
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        // They have a valid session from the link — let them set a new password
        // But since we're moving to OTP, just redirect to login
        // The session means they're already authenticated
        router.replace("/");
      } else {
        // No session — redirect to login page for OTP-based reset
        router.replace("/login");
      }
    };

    // Small delay to let Supabase process any URL tokens
    setTimeout(check, 500);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <Loader2 className="w-10 h-10 animate-spin mx-auto text-primary" />
        <p className="text-muted-foreground">Processing...</p>
      </div>
    </div>
  );
}
