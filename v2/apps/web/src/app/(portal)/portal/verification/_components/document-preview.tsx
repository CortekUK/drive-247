'use client';

/**
 * A photo the customer sent to prove who they are — blurred until they ask for it.
 *
 * These are passport and driving-licence scans and a face photo. They sit in
 * the PUBLIC `customer-documents` bucket, so the URL is the only thing guarding
 * them; showing them unprompted means a shoulder-surfer, a screen share or a
 * screenshot of this page carries somebody's document number. v1 has the same
 * reveal-on-click idea in its `BlurredImage`; this is the v2 skin of it, kept
 * local to the verification route because nothing else in the portal shows
 * identity documents.
 *
 * The blur is a CSS filter, so it is a courtesy and not a security control —
 * the file is still fetched and is in the page. It is here to stop an
 * accidental disclosure, not a determined one.
 */

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';

export function DocumentPreview({
  label,
  src,
  portrait = false,
}: {
  label: string;
  src: string;
  /** Selfies are taller than they are wide; ID cards are not. */
  portrait?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-xs text-brand-text-subtle">{label}</figcaption>

      <div
        className={cn(
          'relative overflow-hidden rounded-[10px] border border-brand-border-soft bg-brand-stone',
          portrait ? 'aspect-[3/4]' : 'aspect-[3/2]',
        )}
      >
        {failed ? (
          <p className="absolute inset-0 grid place-items-center px-3 text-center text-xs text-brand-text-subtle">
            This image is no longer available
          </p>
        ) : (
          // A plain <img>, not next/image: these are Supabase storage URLs on a
          // host the image optimiser is not configured for, and routing private
          // documents through an optimiser cache would be worse, not better.
          <img
            src={src}
            alt={revealed ? label : ''}
            aria-hidden={!revealed}
            onError={() => setFailed(true)}
            className={cn(
              'size-full object-cover transition-[filter] duration-200',
              revealed ? 'blur-0' : 'scale-110 blur-lg',
            )}
          />
        )}

        {!revealed && !failed ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="absolute inset-0 grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
          >
            <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-card px-4 text-sm font-medium text-brand-text">
              <Eye aria-hidden strokeWidth={1.75} className="size-4" />
              Show
              {/* The visible word stays one short verb; the control still
                  announces WHICH photo it reveals to a screen reader. */}
              <span className="sr-only">{label}</span>
            </span>
          </button>
        ) : null}
      </div>

      {revealed && !failed ? (
        <button
          type="button"
          onClick={() => setRevealed(false)}
          className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm text-brand-text-soft transition-colors hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
        >
          <EyeOff aria-hidden strokeWidth={1.75} className="size-4" />
          Hide
        </button>
      ) : null}
    </figure>
  );
}
