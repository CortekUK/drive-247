"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, Shield, LogOut } from "lucide-react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hviqoaokxvlancmftwuo.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q";

export function PolicyAcceptanceGate() {
  const { appUser, signOut } = useAuth();
  const { tenant } = useTenant();
  const [needsAcceptance, setNeedsAcceptance] = useState(false);
  const [checking, setChecking] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    console.log('[PolicyGate] appUser:', appUser?.email, 'is_super_admin:', appUser?.is_super_admin, 'tenant:', tenant?.id, 'role:',appUser.role);

    if (!appUser || !tenant?.id) {
      console.log('[PolicyGate] Skipping — no appUser or tenant');
      setChecking(false);
      return;
    }

    checkAcceptance();
  }, [appUser?.id, tenant?.id]);

  const checkAcceptance = async () => {
    try {
      setChecking(true);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-policy-acceptance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email: appUser?.email, tenant_id: tenant?.id }),
      });
      const result = await res.json();
      console.log('[PolicyGate] Edge function response:', result);
      setNeedsAcceptance(result.needsAcceptance === true);
    } catch (err) {
      console.error('[PolicyGate] Edge function error:', err);
      // On error, don't block the user — fail open
      setNeedsAcceptance(false);
    } finally {
      setChecking(false);
    }
  };

  const handleAccept = async () => {
    if (!appUser || !tenant?.id) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/check-policy-acceptance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({
          action: "record",
          email: appUser.email,
          tenant_id: tenant.id,
          user_agent: navigator.userAgent,
        }),
      });
      const result = await res.json();
      console.log('[PolicyGate] Record response:', result);

      if (result.success) {
        setNeedsAcceptance(false);
      }
    } catch (e) {
      console.error("Policy acceptance recording failed:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut();
    } catch {
      window.location.href = "/login";
    }
  };

  // Don't render anything while checking or if acceptance not needed
  if (checking || !needsAcceptance) return null;

  return (
    <Dialog open>
      <DialogContent
        className="sm:max-w-md [&>button:last-child]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-xl">
            Policy Acceptance Required
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Please review and accept our policies to continue using the platform.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div
            className="flex items-start space-x-3 rounded-md border p-4 cursor-pointer"
            onClick={() => setAccepted(!accepted)}
          >
            <Checkbox
              id="accept-policies"
              checked={accepted}
              onCheckedChange={(v) => setAccepted(v === true)}
            />
            <Label htmlFor="accept-policies" className="text-sm font-normal leading-relaxed cursor-pointer">
              I have read and accept the{" "}
              <a
                href="/privacy-policy"
                target="_blank"
                className="text-primary underline hover:text-primary/80"
                onClick={(e) => e.stopPropagation()}
              >
                Privacy Policy
              </a>{" "}
              and{" "}
              <a
                href="/terms"
                target="_blank"
                className="text-primary underline hover:text-primary/80"
                onClick={(e) => e.stopPropagation()}
              >
                Terms &amp; Conditions
              </a>
            </Label>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            onClick={handleAccept}
            disabled={!accepted || submitting}
            className="w-full"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Continue"
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={handleLogout}
            disabled={submitting || loggingOut}
            className="w-full text-muted-foreground"
          >
            {loggingOut ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Logging out...
              </>
            ) : (
              <>
                <LogOut className="mr-2 h-4 w-4" />
                Log Out
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
