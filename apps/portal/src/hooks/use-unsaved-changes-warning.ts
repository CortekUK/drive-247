'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface UseUnsavedChangesWarningOptions {
  hasChanges: boolean;
  onSave?: () => Promise<boolean>;
}

interface UseUnsavedChangesWarningReturn {
  isDialogOpen: boolean;
  confirmLeave: () => void;
  saveAndLeave: () => Promise<void>;
  cancelLeave: () => void;
  isSaving: boolean;
}

export function useUnsavedChangesWarning({
  hasChanges,
  onSave,
}: UseUnsavedChangesWarningOptions): UseUnsavedChangesWarningReturn {
  const router = useRouter();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const pendingUrl = useRef<string | null>(null);
  const isBypassing = useRef(false);
  // Ref mirror of isDialogOpen for sync checks inside non-React handlers
  // (capture-phase click listener, pushState override) so we never re-trigger
  // while a dialog is already showing or within a short cooldown after close.
  const dialogOpenRef = useRef(false);
  const cooldownUntil = useRef(0);
  const currentUrl = useRef(
    typeof window !== 'undefined'
      ? window.location.pathname + window.location.search
      : '',
  );

  const openDialog = useCallback(() => {
    dialogOpenRef.current = true;
    setIsDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    dialogOpenRef.current = false;
    cooldownUntil.current = Date.now() + 350;
    setIsDialogOpen(false);
  }, []);

  const shouldBlock = () =>
    !dialogOpenRef.current && Date.now() >= cooldownUntil.current;

  // Keep track of the current URL
  useEffect(() => {
    currentUrl.current = window.location.pathname + window.location.search;
  });

  // beforeunload — browser native prompt for refresh/tab close
  useEffect(() => {
    if (!hasChanges) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  // Intercept <a> clicks (capture phase) — catches sidebar links, Link components, etc.
  useEffect(() => {
    if (!hasChanges) return;

    const handler = (e: MouseEvent) => {
      if (isBypassing.current) return;
      if (!shouldBlock()) return;

      const anchor = (e.target as Element).closest('a');
      if (!anchor || !anchor.href) return;

      // Skip external links, new-tab links, download links
      if (
        anchor.target === '_blank' ||
        anchor.hasAttribute('download') ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey
      ) {
        return;
      }

      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        return;
      }

      // Only intercept same-origin, different-path navigation
      if (
        url.origin === window.location.origin &&
        url.pathname !== window.location.pathname
      ) {
        e.preventDefault();
        e.stopPropagation();
        pendingUrl.current = url.pathname + url.search;
        openDialog();
      }
    };

    // Capture phase so we fire before Next.js Link component processes the click
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [hasChanges]);

  // Intercept pushState — catches programmatic router.push() calls
  useEffect(() => {
    if (!hasChanges) return;

    const originalPushState = history.pushState.bind(history);

    history.pushState = function (
      data: any,
      unused: string,
      url?: string | URL | null,
    ) {
      if (isBypassing.current) {
        return originalPushState(data, unused, url);
      }

      if (url && shouldBlock()) {
        const targetUrl = url.toString();
        const current = window.location.pathname + window.location.search;

        // Only intercept if actually navigating to a different path
        if (targetUrl !== current && !targetUrl.startsWith('#')) {
          pendingUrl.current = targetUrl;
          // Defer state update — Next.js 16's router calls pushState inside
          // useInsertionEffect, where scheduling updates is forbidden.
          queueMicrotask(openDialog);
          return; // Block navigation
        }
      }

      return originalPushState(data, unused, url);
    };

    return () => {
      history.pushState = originalPushState;
    };
  }, [hasChanges]);

  // Intercept popstate (browser back/forward)
  useEffect(() => {
    if (!hasChanges) return;

    const handler = () => {
      if (isBypassing.current) return;
      if (!shouldBlock()) return;

      // When popstate fires, window.location has ALREADY changed to the target
      const targetUrl = window.location.pathname + window.location.search;
      const originalUrl = currentUrl.current;

      // Push the original URL back to undo the back/forward
      isBypassing.current = true;
      history.pushState(null, '', originalUrl);
      isBypassing.current = false;

      pendingUrl.current = targetUrl;
      openDialog();
    };

    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [hasChanges]);

  const navigateAway = useCallback(() => {
    const url = pendingUrl.current;
    if (url) {
      isBypassing.current = true;
      pendingUrl.current = null;
      closeDialog();
      router.push(url);
      // Reset bypass after navigation settles
      setTimeout(() => {
        isBypassing.current = false;
      }, 500);
    } else {
      closeDialog();
    }
  }, [router, closeDialog]);

  const confirmLeave = useCallback(() => {
    navigateAway();
  }, [navigateAway]);

  const saveAndLeave = useCallback(async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      const success = await onSave();
      if (success) {
        navigateAway();
      }
    } catch {
      // Save failed, stay on page
    } finally {
      setIsSaving(false);
    }
  }, [onSave, navigateAway]);

  const cancelLeave = useCallback(() => {
    pendingUrl.current = null;
    closeDialog();
  }, [closeDialog]);

  return {
    isDialogOpen,
    confirmLeave,
    saveAndLeave,
    cancelLeave,
    isSaving,
  };
}
