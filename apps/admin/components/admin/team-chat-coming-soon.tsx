'use client';

/**
 * Messaging in the top bar will be Drive247's internal team chat. Until it is
 * built, the button opens this: one picture, one sentence, one button — the
 * house shape for a dialog screen (minimal, stacked, no scroll).
 */

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { TeamChatArt } from '@/components/admin/illustrations/scenes/admin-scenes';

export function TeamChatComingSoon({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] rounded-3xl p-8 text-center">
        <div aria-hidden="true" className="mx-auto w-full max-w-[300px]">
          <TeamChatArt />
        </div>
        <span className="mx-auto mt-2 inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
          Coming soon
        </span>
        <DialogTitle className="mt-1 text-xl font-semibold tracking-tight">Team chat</DialogTitle>
        <DialogDescription className="mx-auto max-w-[320px] text-[14px] leading-relaxed">
          One place for the Drive247 team to talk — about an operator, a ticket or a launch — without leaving the dashboard.
        </DialogDescription>
        <Button className="mt-4 w-full" onClick={() => onOpenChange(false)}>
          Got it
        </Button>
      </DialogContent>
    </Dialog>
  );
}
