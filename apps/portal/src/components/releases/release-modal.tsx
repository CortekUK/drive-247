'use client';

/**
 * The weekly release modal.
 *
 * Three rules make this tolerable rather than annoying, and all three are
 * load-bearing:
 *
 *   1. At most ONE per week, however many times we deploy. Enforced in
 *      `useReleases`, not here — three releases in a week arrive as one
 *      combined summary.
 *   2. It never blocks work. Dismissible by button, escape, or clicking away.
 *   3. "Later" is honoured for the whole week, not until the next page load.
 *
 * It leads with what CHANGED rather than what is new, because a changed
 * workflow is the only thing here that can cost someone their morning.
 */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TIER_CLASS, TIER_LABEL } from '@/lib/releases';
import { useReleases } from '@/hooks/use-releases';
import { cn } from '@/lib/utils';

export function ReleaseModal() {
  const { modalRelease, dismissModal } = useReleases();

  if (!modalRelease) return null;

  // Workflow changes first — everything else is optional reading.
  const ordered = [...modalRelease.items].sort((a, b) => {
    const weight = (tier: string) => (tier === 'changed' ? 0 : 1);
    return weight(a.tier) - weight(b.tier);
  });

  const primaryLink = ordered.find((item) => item.href)?.href;

  return (
    <Dialog open onOpenChange={(open) => !open && dismissModal(false)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{modalRelease.title}</DialogTitle>
          <DialogDescription>
            A few things changed in your portal. Here&apos;s the short version.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3">
          {ordered.map((item) => (
            <li key={item.title} className="rounded-lg border bg-card p-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    TIER_CLASS[item.tier]
                  )}
                >
                  {TIER_LABEL[item.tier]}
                </span>
                <span className="text-sm font-medium">{item.title}</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </li>
          ))}
        </ul>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => dismissModal(false)}>
            Later
          </Button>
          {primaryLink ? (
            <Button asChild onClick={() => dismissModal(true)}>
              <Link href={primaryLink}>
                Show me
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : (
            <Button onClick={() => dismissModal(true)}>Got it</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
