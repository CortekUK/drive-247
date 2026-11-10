'use client';

import { useEffect, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { markArriving } from '@/lib/arrival-cover';
import { performFirstRunHandoff, urlWithoutFirstRun } from '@/lib/first-run-handoff';
import type { FirstRunClient } from '@/lib/dev-actions';

/**
 * The portal end of the localhost signup rehearsal
 * (apps/web/src/components/onboarding/mock-signup.ts).
 *
 * apps/web's /api/dev/mock-signup-handoff mints a one-time sign-in token for the
 * rehearsal owner and sends the browser here with it. This spends the token on
 * THIS origin (so the session lands where the portal reads it), then hard-loads
 * `next`, which carries `firstrun=1` so the welcome questions, the quick tour
 * and the checklist start fresh.
 *
 * DEVELOPMENT ONLY. NODE_ENV folds to "production" in every build, so there the
 * page renders nothing and does nothing.
 */
const IS_DEV = process.env.NODE_ENV === 'development';

export default function DevHandoffPage() {
  // Blank while it works: the next thing on screen is the first question.
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!IS_DEV) return;
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const next = params.get('next') || '/';
    // Same-origin paths only.
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    if (!tokenHash) {
      setMessage('This link is missing its sign-in token. Start the signup again.');
      return;
    }
    void (async () => {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
      if (error) {
        setMessage(`Sign-in failed: ${error.message}. Start the signup again.`);
        return;
      }
      try {
        // Arrive as a brand-new signup: on a free trial (the portal's dev
        // billing override, use-billing-scenario.ts) and in light mode.
        window.localStorage.setItem('d247.dev.billingScenario', 'trial');
        window.localStorage.setItem('theme', 'light');
      } catch {
        /* storage blocked: the real state shows instead */
      }
      // Re-arm the first run HERE, on the way in, rather than letting the
      // portal see `firstrun=1`, reset and reload itself: that second load is
      // the dashboard flashing up before the questions. Then cover the portal
      // until the questions are on screen (lib/arrival-cover.ts).
      const authUserId = data.user?.id;
      if (authUserId) {
        const { data: me } = await supabase
          .from('app_users')
          .select('tenant_id')
          .eq('auth_user_id', authUserId)
          .maybeSingle();
        const tenantId = (me as { tenant_id?: string | null } | null)?.tenant_id ?? null;
        await performFirstRunHandoff(supabase as unknown as FirstRunClient, tenantId);
      }
      markArriving();
      window.location.replace(urlWithoutFirstRun(new URL(safeNext, window.location.origin).toString()));
    })();
  }, []);

  if (!IS_DEV) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-white font-sans text-sm text-[#404040]">
      {message}
    </div>
  );
}
