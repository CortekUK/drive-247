'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0 max-w-2xl">
          <p className="text-sm font-semibold">Verify the email address during signup</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Sends a 6-digit code after the name and password, and holds the signup there until
            it is entered. Turn it off if verification emails stop arriving &mdash; signups
            then continue straight to the company details, as they did before.
          </p>
          {loadError && (
            <p className="mt-1 text-sm text-destructive">Could not read this setting: {loadError}</p>
          )}
        </div>
        <label className={cn('flex shrink-0 items-center', busy ? 'cursor-wait' : 'cursor-pointer')}>
          <div className="relative">
            <input
              type="checkbox"
              role="switch"
              aria-label="Verify the email address during signup"
              checked={enabled === true}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
              className="peer sr-only"
            />
            <div
              className={cn(
                'h-6 w-11 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                enabled ? 'bg-emerald-500' : 'bg-muted',
                busy && 'opacity-70',
              )}
            >
              <div
                className={cn(
                  'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform',
                  enabled && 'translate-x-5',
                )}
              />
            </div>
          </div>
          <Badge variant={enabled ? 'success' : 'outline'} className="ml-2 whitespace-nowrap">
            {enabled === null ? (
              loadError ? 'Unknown' : <Loader2 className="h-3 w-3 animate-spin" />
            ) : enabled ? (
              'On'
            ) : (
              'Off'
            )}
          </Badge>
        </label>
      </CardContent>
    </Card>
  );
}
