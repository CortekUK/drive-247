'use client';

/**
 * Template 2 ("Glass") — answers a click at once. The moment someone follows
 * a link to another Template 2 page, the page they are leaving gives way to
 * the skeleton of the one they asked for (`skeletons.tsx`), until it arrives.
 *
 * Each route's `loading.tsx` does the same, but only once the server has
 * replied, which can take a second for a page Next has not prefetched (every
 * page in development, any dynamic one not yet scrolled past in production).
 * This needs no reply. The old page stays mounted underneath, hidden, so a
 * navigation that never happens loses nothing: the skeleton gives up after
 * a while, or on Back.
 *
 * Left alone: new tabs and windows (modifier keys, middle click, target),
 * downloads, other sites, the same page, and links within a page (#).
 */

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { skeletonFor } from '@nw/template-2/skeletons';

const GIVE_UP_MS = 12_000;

export function Template2PendingPage({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState<React.ReactNode>(null);

  // Arrived (or went Back): the real page takes over.
  useEffect(() => setPending(null), [pathname]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPending(null), GIVE_UP_MS);
    const back = () => setPending(null);
    window.addEventListener('popstate', back);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('popstate', back);
    };
  }, [pending]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith('/template-2')) return;
      if (url.pathname === window.location.pathname) return; // same page, or a #section on it
      const skeleton = skeletonFor(url.pathname);
      if (!skeleton) return;
      setPending(skeleton);
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    // Bubbling, so a link's own handler can still cancel it first.
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return (
    <>
      {pending}
      <div className={pending ? 'hidden' : 'contents'}>
        {children}
      </div>
    </>
  );
}
