'use client';

import { useMemo } from 'react';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Copy } from 'lucide-react';
import { CopyRow, FORM_DIALOG_WASH } from '@/components/admin/form-grid';
import { AddVehicleKeysArt } from '@/components/admin/illustrations/scenes/add-vehicle';
import { bookingUrlFor, derivePasswordFromSlug, portalUrlFor } from '@/lib/sales-credentials';

/**
 * Everything the dialog needs from a sales_onboarding_submissions row. The
 * password is NOT part of it — it is never stored and is recomputed from the
 * slug (see lib/sales-credentials.ts).
 */
export interface SalesCredentialsTarget {
  companyName: string;
  slug: string;
  email: string;
  firstName?: string | null;
  /** Subscription amount in CENTS. */
  amountCents?: number | null;
  currency?: string | null;
}

interface SalesCredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: SalesCredentialsTarget | null;
}

/**
 * A company's login details, re-opened from the key button on Rental
 * Companies (and the Onboarding page). Just the four things they log in with,
 * drawn like the stepped "add" dialogs' hand-over screen (form-grid.tsx):
 * a picture, a line, the rows with a copy each (Ghulam, Oct 17 2026).
 * Nothing here is stored; the password is rebuilt from the slug.
 */
export default function SalesCredentialsDialog({ open, onOpenChange, target }: SalesCredentialsDialogProps) {
  const details = useMemo(() => {
    if (!target) return null;
    return [
      { label: 'Email', value: target.email },
      { label: 'Password', value: derivePasswordFromSlug(target.slug) },
      { label: 'Portal', value: portalUrlFor(target.slug), href: portalUrlFor(target.slug) },
      { label: 'Booking site', value: bookingUrlFor(target.slug), href: bookingUrlFor(target.slug) },
    ];
  }, [target]);

  // writeText REJECTS in a non-secure context, when the document isn't
  // focused, or without permission, so success is only toasted once it lands.
  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-[660px] flex-col gap-0 overflow-hidden p-0" style={FORM_DIALOG_WASH} showCloseButton={false}>
        <div className="flex flex-col items-center px-10 pt-8 text-center">
          <div aria-hidden="true" className="w-full max-w-[240px]">
            <AddVehicleKeysArt />
          </div>
          <DialogTitle className="mt-4 text-xl font-medium tracking-normal text-foreground [text-wrap:balance]">
            {target?.companyName || 'Client'}&apos;s login
          </DialogTitle>
          {/* must_change_password = true, so this is only ever the FIRST-login password. */}
          <DialogDescription className="mx-auto mt-1.5 max-w-[26rem] text-sm leading-relaxed [text-wrap:balance]">
            The password is the one they were given at the start. If they&apos;ve already changed it, they can use
            Forgot password on the portal.
          </DialogDescription>
          {details && (
            <div className="mt-5 w-full rounded-2xl border border-foreground/10 bg-background/80 px-4 text-left">
              {details.map((d) => (
                <CopyRow key={d.label} label={d.label} value={d.value} href={d.href} onCopy={() => void copy(d.value, d.label)} />
              ))}
            </div>
          )}
        </div>
        {/* No Done: Escape or a click outside closes it. */}
        <div className="flex items-center justify-end px-10 pb-6 pt-4">
          {details && (
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 rounded-full px-3.5 text-[13px]"
              onClick={() => void copy(details.map((d) => `${d.label}: ${d.value}`).join('\n'), 'Login details')}
            >
              <Copy className="size-3.5" /> Copy all
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
