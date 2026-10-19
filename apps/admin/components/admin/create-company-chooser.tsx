'use client';

/**
 * The first screen of "Add company" on Rental Companies: two ways to make one,
 * each a picture, a name and a line — pick one and its form opens.
 *
 *   Quick setup  CreateTenantDialog: a company and its first admin, nothing else.
 *   Onboarding   SalesOnboardingDialog: the full sales provisioning — portal,
 *                branding, credits and paywall in one step (what /admin/sales
 *                used to be the only door to).
 */

import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CompaniesEmptyArt } from '@/components/admin/illustrations/scenes/admin-scenes';
import { LeadsEmptyArt } from '@/components/admin/illustrations/scenes/leads';

export type CreateCompanyMode = 'quick' | 'onboarding';

const OPTIONS: { mode: CreateCompanyMode; art: ReactNode; title: string; body: string }[] = [
  {
    mode: 'quick',
    art: <CompaniesEmptyArt />,
    title: 'Quick setup',
    body: 'A company and its first admin. Everything else is set up later.',
  },
  {
    mode: 'onboarding',
    art: <LeadsEmptyArt />,
    title: 'Onboarding',
    body: 'The full provisioning: portal, branding, credits and paywall in one go.',
  },
];

export function CreateCompanyChooser({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (mode: CreateCompanyMode) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] rounded-3xl p-8">
        <div className="text-center">
          <DialogTitle className="text-xl font-semibold tracking-tight">Add a rental company</DialogTitle>
          <DialogDescription className="mt-1 text-[14px]">How would you like to set it up?</DialogDescription>
        </div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              type="button"
              onClick={() => onChoose(o.mode)}
              className="group flex cursor-pointer flex-col items-center rounded-2xl border border-border bg-card px-5 pb-5 pt-4 text-center outline-none transition-colors hover:border-primary/40 hover:bg-[hsl(var(--v2-row-hover,var(--muted)))] focus-visible:ring-3 focus-visible:ring-ring/30 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]"
            >
              <div aria-hidden="true" className="w-full max-w-[220px]">
                {o.art}
              </div>
              <span className="mt-3 text-base font-semibold tracking-tight text-foreground group-hover:text-primary dark:group-hover:text-[hsl(var(--v2-link,var(--primary)))]">
                {o.title}
              </span>
              <span className="mt-1 max-w-[240px] text-[13px] leading-snug text-muted-foreground">{o.body}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
