'use client';

/**
 * Try-on mode: paint the *whole portal* with an unsaved palette.
 *
 * A miniature mock-up of the portal is never convincing — it reads as a toy,
 * and it silently drifts from reality every time a component changes. The
 * honest preview is the product itself.
 *
 * Rather than reimplement the colour derivation, this pushes the candidate
 * palette into the `['tenant-branding']` query cache that `use-dynamic-theme`
 * already watches. That hook then applies it to `document.documentElement`
 * through exactly the same code path a saved change would take — so what the
 * tenant sees while trying a colour is, by construction, what they get after
 * saving. No second styling pipeline to keep in sync.
 *
 * Nothing is written to the database. The cache is restored on revert and on
 * unmount, so navigating away mid-preview can never strand a theme the tenant
 * did not choose.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useTenant } from '@/contexts/TenantContext';
import type { TenantBranding } from '@/hooks/use-tenant-branding';

export function useThemePreview() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  const queryKey = ['tenant-branding', tenant?.id] as const;

  /**
   * The last server-truth branding, captured before the first preview write.
   * Kept in a ref so React re-renders never clobber the restore target.
   */
  const savedRef = useRef<TenantBranding | null>(null);
  const previewingRef = useRef(false);

  const restore = useCallback(() => {
    if (!previewingRef.current) return;
    if (savedRef.current) {
      queryClient.setQueryData(queryKey, savedRef.current);
    } else {
      // Never captured a baseline — refetching is the safe way back.
      queryClient.invalidateQueries({ queryKey });
    }
    previewingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, tenant?.id]);

  const preview = useCallback(
    (patch: Partial<TenantBranding>) => {
      const current = queryClient.getQueryData<TenantBranding>(queryKey);
      if (!current) return;

      if (!previewingRef.current) {
        savedRef.current = current;
        previewingRef.current = true;
      }

      const base = savedRef.current ?? current;
      queryClient.setQueryData(queryKey, { ...base, ...patch });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [queryClient, tenant?.id]
  );

  /**
   * Called once the tenant saves: the previewed palette is now server truth, so
   * the old baseline must be dropped or a later revert would resurrect it.
   */
  const commit = useCallback(() => {
    savedRef.current = null;
    previewingRef.current = false;
  }, []);

  // Leaving the screen must never leave a colour applied that was not saved.
  useEffect(() => restore, [restore]);

  return { preview, restore, commit };
}
