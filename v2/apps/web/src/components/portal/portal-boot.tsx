/**
 * What the portal shows while it works out who you are.
 *
 * Deliberately NOT a skeleton of the signed-in shell. A sidebar and five nav
 * items appearing for half a second before a redirect to /login tells a signed
 * -out visitor they were in, then throws them out — and on a shared machine it
 * is a real, if brief, disclosure that an account exists. A neutral panel says
 * nothing either way.
 */

import { Skeleton } from '@/components/ui/skeleton';

export function PortalBoot({ label = 'Loading your account…' }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-brand-cream px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <Skeleton className="h-2 w-32 rounded-full bg-brand-stone" />
        <p className="text-sm text-brand-text-subtle" role="status" aria-live="polite">
          {label}
        </p>
      </div>
    </div>
  );
}
