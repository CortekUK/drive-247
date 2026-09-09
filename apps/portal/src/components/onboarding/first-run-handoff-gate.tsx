'use client';

/**
 * Catches the `?firstrun=1` handoff from apps/web's demo signup journey and
 * re-arms the first-run experience before anything else gets to decide.
 *
 * Renders nothing, ever. See `lib/first-run-handoff.ts` for why this exists and
 * why it reloads rather than clearing in place.
 *
 * WHERE THIS IS MOUNTED MATTERS. It belongs in the dashboard layout, ABOVE the
 * wizard and the walkthrough, so the reload happens on the first paint after
 * arrival rather than after the operator has watched the wrong screen settle.
 */

import { useEffect, useRef } from 'react';

import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import {
  performFirstRunHandoff,
  urlWithoutFirstRun,
  wantsFirstRun,
} from '@/lib/first-run-handoff';
import type { FirstRunClient } from '@/lib/dev-actions';

export function FirstRunHandoffGate() {
  const { tenant } = useTenant();

  /**
   * One shot per page load.
   *
   * React 18 mounts effects twice in development StrictMode, and without this
   * the second pass would fire a second reset and a second reload — which,
   * because the reload strips the parameter, would race the first one and could
   * land the operator on a half-navigated page.
   */
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    if (typeof window === 'undefined') return;
    if (!wantsFirstRun(window.location.search)) return;

    // Wait for the tenant before touching anything. The checklist keys are
    // per-tenant, so clearing with no tenant id would leave them behind and the
    // setup guide would arrive already ticked — the one part of the first run a
    // tester most needs to see empty.
    if (!tenant?.id) return;

    doneRef.current = true;

    let cancelled = false;
    void (async () => {
      await performFirstRunHandoff(supabase as unknown as FirstRunClient, tenant.id);
      if (cancelled) return;
      // A HARD load, not router.replace. The wizard and the walkthrough have
      // already mounted and made their decisions; only a cold page makes the
      // sequence the real one. `replace` rather than `assign` so the handoff
      // URL does not sit in history — going Back should not re-run the reset.
      window.location.replace(urlWithoutFirstRun(window.location.href));
    })();

    return () => {
      cancelled = true;
    };
  }, [tenant?.id]);

  return null;
}
