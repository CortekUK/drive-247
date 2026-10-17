'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { SettingsRow } from '@/components/admin/settings/settings-kit';

/**
 * "Verify the email address during signup": the switch for the emailed code.
 *
 * ON means self-serve signup sends a 6-digit code and will not continue to the
 * company name or the card until it is entered:
 *
 *   name, email, password  ->  enter code  ->  company + slug  ->  payment
 *
 * OFF is the behaviour the product has had until now — the address is
 * auto-confirmed and no code is sent.
 *
 * WHY IT IS A SWITCH AND NOT A DEPLOY. This was an edge function secret, and
 * there was no slot left for it. A row is the better home anyway: if Resend
 * stops delivering, signup keeps working the moment someone unticks this. No
 * redeploy, no secret.
 *
 * Stored as `admin_settings.signup_otp_enabled` on every row and read as "true
 * if any row is true", the same way `landing_pricing_enabled` works.
 * `signup-begin` reads it the same way, and that agreement matters: a flag this
 * page shows as on while the function reads it off is worse than either value.
 * The function reads it fresh per signup, so a flip takes effect immediately —
 * for signups that START after it. Anyone already looking at the code screen
 * still has to enter their code, and `signup-verify-otp` keeps accepting it.
 */
export function SignupOtpSwitch() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase.from('admin_settings').select('signup_otp_enabled' as any);
    if (error) {
      setLoadError(error.message);
      return;
    }
    const rows = (data ?? []) as Array<{ signup_otp_enabled?: boolean | null }>;
    setEnabled(rows.some((row) => row.signup_otp_enabled === true));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (next: boolean) => {
    if (enabled === null || saving) return;
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    // `.select()` so an update that matched no rows (RLS, or no settings row)
    // is reported instead of reading as success.
    const { data, error } = await supabase
      .from('admin_settings')
      .update({ signup_otp_enabled: next, updated_at: new Date().toISOString() } as any)
      .not('id', 'is', null)
      .select('id');
    setSaving(false);
    if (error || !data || data.length === 0) {
      setEnabled(previous);
      toast.error('Could not change email verification', {
        description: error?.message ?? 'No settings row was updated.',
      });
      return;
    }
    toast.success(next ? 'Email verification is on' : 'Email verification is off', {
      description: next
        ? 'New signups get a 6-digit code before the company details and payment.'
        : 'New signups continue straight to the company details, as before.',
    });
  };

  const busy = enabled === null || saving;

  return (
    <SettingsRow
      label="Verify the email address during signup"
      htmlFor="signup-otp-enabled"
      description={
        <>
          Sends a 6-digit code after the name and password, and holds the signup there until it is
          entered. Turn it off if verification emails stop arriving: signups then continue straight
          to the company details, as they did before.
          {loadError && <span className="mt-1 block text-destructive">Could not read this setting: {loadError}</span>}
        </>
      }
    >
      {enabled === null && !loadError ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <Switch
          id="signup-otp-enabled"
          aria-label="Verify the email address during signup"
          checked={enabled === true}
          disabled={busy}
          onCheckedChange={(v) => void toggle(v)}
        />
      )}
    </SettingsRow>
  );
}
