'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { loadSegmentTenants } from '@/lib/announcements/api';
import type { SegmentKey, SegmentMatchTenant } from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';
import { HIDDEN_SCROLLBAR, QUIET_BUTTON } from './form-field';

type MatchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tenants: SegmentMatchTenant[] };

/**
 * Who a smart filter reaches RIGHT NOW. The filter is evaluated by the database
 * on every portal read, so this list is a snapshot: tenants join and leave on
 * their own as their setup changes.
 */
export function SegmentMatches({ segmentKey }: { segmentKey: SegmentKey }) {
  const [state, setState] = useState<MatchState>({ status: 'loading' });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState({ status: 'loading' });
    const result = await loadSegmentTenants(segmentKey);
    if (mine !== seq.current) return;
    setState(result.ok ? { status: 'ready', tenants: result.data } : { status: 'error', message: result.message });
  }, [segmentKey]);

  useEffect(() => {
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load]);

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          {state.status === 'ready'
            ? state.tenants.length === 1
              ? '1 tenant matches right now'
              : state.tenants.length + ' tenants match right now'
            : state.status === 'loading'
              ? 'Checking who matches…'
              : 'Could not check who matches'}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={QUIET_BUTTON}
          onClick={() => void load()}
          disabled={state.status === 'loading'}
        >
          <RefreshCw className={cn(state.status === 'loading' && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {state.status === 'loading' && (
        <div className="mt-2 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full rounded-xl" />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <div className="mt-2 space-y-2">
          <p className="text-xs leading-5 text-destructive">{state.message}</p>
          <Button type="button" variant="outline" size="sm" className={QUIET_BUTTON} onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {state.status === 'ready' && state.tenants.length === 0 && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          No tenant matches right now. Tenants join automatically when the condition becomes true.
        </p>
      )}

      {state.status === 'ready' && state.tenants.length > 0 && (
        // Inside the editor dialog, which shows no scrollbars (it still scrolls).
        <ul className={cn('mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-xl bg-background', HIDDEN_SCROLLBAR)}>
          {state.tenants.map((t) => {
            const suspended = t.status === 'suspended';
            return (
              <li key={t.tenant_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground" title={t.company_name}>
                    {t.company_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.slug}
                    {suspended && ' · not reachable while suspended'}
                  </p>
                </div>
                <Badge
                  variant={t.status === 'active' ? 'success' : suspended ? 'destructive' : 'secondary'}
                  className="capitalize"
                >
                  {t.status}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
