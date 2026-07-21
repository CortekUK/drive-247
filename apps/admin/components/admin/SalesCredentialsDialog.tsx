'use client';

import { useMemo } from 'react';
import { toast } from '@/components/ui/sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Copy, CheckCircle, KeyRound, AlertTriangle } from 'lucide-react';
import {
  bookingUrlFor,
  buildClientMessage,
  derivePasswordFromSlug,
  formatAmount,
  portalUrlFor,
} from '@/lib/sales-credentials';

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
 * Re-opens the "send to client" pane for an already-provisioned tenant so sales
 * can re-send the details. Mirrors the success pane in SalesOnboardingDialog:
 * the message in a read-only box, ONE copy button, and a plain details list.
 */
export default function SalesCredentialsDialog({ open, onOpenChange, target }: SalesCredentialsDialogProps) {
  const view = useMemo(() => {
    if (!target) return null;

    const password = derivePasswordFromSlug(target.slug);
    const portalUrl = portalUrlFor(target.slug);
    const bookingUrl = bookingUrlFor(target.slug);
    // When the amount was never recorded we still show the details list, and
    // buildClientMessage OMITS the subscription sentence entirely. Passing 0
    // here instead would put a written "($0/month)" commitment into the message
    // a sales person actually sends to a client.
    const amountCents = typeof target.amountCents === 'number' ? target.amountCents : null;
    const currency = target.currency || 'usd';

    const message = buildClientMessage({
      firstName: target.firstName,
      companyName: target.companyName,
      email: target.email,
      password,
      portalUrl,
      bookingUrl,
      amountCents,
      currency,
    });

    const details: Array<[string, string]> = [
      ['Email', target.email],
      ['Password', password],
      ['Portal URL', portalUrl],
      ['Booking URL', bookingUrl],
      ['Subscription', amountCents == null ? '—' : `${formatAmount(amountCents, currency)}/month`],
    ];

    return { password, portalUrl, bookingUrl, message, details };
  }, [target]);

  // ONE button, everything at once: the message already contains the email,
  // password and both URLs, so copying it copies the whole handover.
  // writeText REJECTS in a non-secure context, when the document isn't focused,
  // or when clipboard permission is denied. Firing the success toast without
  // awaiting means George pastes whatever was previously on his clipboard into
  // WhatsApp believing the copy worked — and this is now the ONLY copy control.
  const copyEverything = async () => {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.message);
      toast.success('Credentials copied to clipboard!');
    } catch {
      toast.error('Could not copy — select the message and copy it manually.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            {target?.companyName || 'Client'} — send details again
          </DialogTitle>
          <DialogDescription>
            Copy this message and send it to the client. Nothing here is stored — it is rebuilt from their slug.
          </DialogDescription>
        </DialogHeader>

        {view && target && (
          <>
            {/* must_change_password = true, so this is only ever the FIRST-login password. */}
            <Card className="border-warning/50 bg-warning/10">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">This is the initial password</h3>
                  <p className="text-xs text-muted-foreground">
                    The password below is the one issued when {target.companyName} was created. Clients are forced
                    to set their own on first login, so if they have already logged in this will no longer work —
                    they should use &quot;Forgot password&quot; on the portal instead.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Copy-paste message */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Client message</Label>
                <Button size="sm" onClick={copyEverything}>
                  <Copy className="h-4 w-4" />
                  Copy all details
                </Button>
              </div>
              <Textarea
                readOnly
                value={view.message}
                rows={12}
                className="font-mono text-xs leading-relaxed"
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>

            {/* Details — read-only, no per-field copy buttons (the one button above copies the lot). */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">Details</h3>
                {view.details.map(([label, value]) => (
                  <div key={label}>
                    <Label className="text-xs mb-1 block">{label}</Label>
                    <code className="block bg-muted/40 px-3 py-2 rounded-md border border-border text-sm font-mono break-all">
                      {value}
                    </code>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            <CheckCircle className="h-4 w-4" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
