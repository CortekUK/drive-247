'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { BookOpen } from 'lucide-react';
import { useWelcomePackPrompt } from '@/hooks/use-welcome-pack';
import { useTenant } from '@/contexts/TenantContext';
import { isAreaHidden } from '@/lib/lean-areas';

const DISMISS_KEY = 'welcome-pack-prompt-dismissed-v';

/**
 * First-login nudge toward the welcome pack.
 *
 * DELIBERATELY DISMISSIBLE, and suppressed by the caller behind every existing
 * gate. The dashboard already mounts the subscription gate, the setup reminder,
 * the migration blocker and the feedback prompt; a new operator can meet three
 * of them before seeing a single screen. An operator who cannot get past four
 * consecutive dialogs concludes the software is broken, not that the reading is
 * important. `FeedbackForcePrompt` already takes a `suppressed` prop for
 * exactly this reason — this follows the same rule.
 *
 * Dismissal is remembered per version in localStorage so it does not reappear
 * on every navigation in a session, while a genuine completion (written to the
 * database) suppresses it permanently and across devices.
 */
export function WelcomePackPrompt({ suppressed = false }: { suppressed?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { tenantSlug } = useTenant();
  const { shouldPrompt, settings } = useWelcomePackPrompt();
  // Starts dismissed so nothing can flash before localStorage is read.
  const [dismissed, setDismissed] = useState(true);

  const version = settings?.version ?? 1;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY + version) === '1');
    } catch {
      setDismissed(false); // storage blocked — show it, it is dismissible
    }
  }, [version]);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY + version, '1');
    } catch {
      // Private browsing with storage disabled — the prompt returns next
      // session, which is harmless because it is one dismissible dialog.
    }
  };

  // Never over the pack itself, and never on top of a blocking gate.
  const onPack = pathname?.startsWith('/welcome');
  // Hidden from the lean canary. Gated HERE rather than at the mount site in
  // (dashboard)/layout.tsx on purpose: this dialog's only action is
  // `router.push('/welcome')`, which now 404s for a lean tenant, so an
  // ungated caller would offer northwind a button into a dead end. Keeping the
  // predicate inside the component means every present and future caller
  // inherits it. `suppressed` stays what it always was — dialog stacking, not
  // tenancy — so the two concerns do not get tangled.
  const hidden = isAreaHidden('welcome', tenantSlug);
  const open = shouldPrompt && !dismissed && !suppressed && !onPack && !hidden;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" />
          </div>
          <DialogTitle className="text-left text-lg">
            {settings?.doc_title ?? 'Welcome'}
          </DialogTitle>
          <DialogDescription className="text-left text-[13.5px] leading-relaxed">
            We&apos;ve put together a complete guide to the platform — how bookings,
            payments, insurance and contracts fit together, plus answers to the
            questions operators ask most. It&apos;s worth twenty minutes on your first
            day.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={dismiss}>
            Maybe later
          </Button>
          <Button
            onClick={() => {
              dismiss();
              router.push('/welcome');
            }}
          >
            Read the guide
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
