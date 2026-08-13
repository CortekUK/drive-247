'use client';

/**
 * "What's New" — the always-available record of everything we've shipped.
 *
 * This is the escape hatch for anyone who dismisses the weekly modal without
 * reading it. They can ignore every interruption we ever show and still find
 * the answer here, on their own time, which is what makes an interruption
 * acceptable in the first place.
 */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { TIER_CLASS, TIER_LABEL } from '@/lib/releases';
import { useReleases } from '@/hooks/use-releases';
import { cn } from '@/lib/utils';

export function WhatsNewSheet({ trigger }: { trigger: React.ReactNode }) {
  const { releases, seen, markAllSeen } = useReleases();

  return (
    <Sheet
      onOpenChange={(open) => {
        // Opening the panel IS reading it — anything else leaves a dot that
        // never clears and quickly gets ignored.
        if (open) markAllSeen();
      }}
    >
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>What&apos;s new</SheetTitle>
          <SheetDescription>
            Everything we&apos;ve shipped, newest first.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-8">
          {releases.map((release) => (
            <section key={release.id} className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold">{release.title}</h3>
                <time className="shrink-0 text-xs text-muted-foreground">
                  {new Date(release.date).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </time>
              </div>

              {!seen.includes(release.id) && (
                <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  New for you
                </span>
              )}

              <ul className="space-y-3">
                {release.items.map((item) => (
                  <li
                    key={item.title}
                    className="rounded-lg border bg-card p-3 space-y-1.5"
                  >
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
                    {item.href && (
                      <Button
                        asChild
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                      >
                        <Link href={item.href}>
                          Take me there
                          <ArrowRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
