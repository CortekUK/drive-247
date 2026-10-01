"use client";

/**
 * Agreements v2: "Manage agreement templates" — the templates, in a dialog
 * opened from the hero card, instead of a section on the tab itself.
 *
 * It holds the whole templates section (search, Edit, Set as default, Delete,
 * New template). The Trax studio and the confirmations open over it, and
 * closing the studio comes back here.
 */

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { AgreementTemplatesSectionV2, TEMPLATES_SECTION_DESCRIPTION } from "@/components/agreements-v2/templates-section-v2";

export const MANAGE_TEMPLATES_TITLE = "Manage agreement templates";

export function AgreementTemplatesDialogV2({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88dvh,56rem)] flex-col gap-5 sm:max-w-5xl">
        <DialogHeader className="pr-10">
          <DialogTitle className="font-heading text-xl font-semibold tracking-tight">{MANAGE_TEMPLATES_TITLE}</DialogTitle>
          <DialogDescription>{TEMPLATES_SECTION_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6 pb-1">
          {open && <AgreementTemplatesSectionV2 id="agreement-templates" inDialog />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
