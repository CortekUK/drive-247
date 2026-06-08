"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { Tile } from "@/components/bento";
import { AuthShell } from "../_components/auth-shell";

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
    <AuthShell width="max-w-[400px]">
      <Tile variant="glass" pad="roomy" className="space-y-3 text-center">
        <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary" />
        <h1 className="text-[22px] font-extrabold tracking-tight text-foreground">
          Password reset
        </h1>
        <p className="text-sm font-medium text-muted-foreground">
          Verifying your link…
        </p>
      </Tile>
    </AuthShell>
  );
}
