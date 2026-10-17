"use client";

/**
 * "Customer registration link" — the v2 dialog (Ghulam, Oct 7 2026: "make the
 * screen better and according to the vibe of the other dialogs").
 *
 * The same family as the add-customer dialog: the accent wash, no header, a
 * picture on top, what Trax is saying in one line, and the foot carrying the
 * actions. Two screens:
 *
 *   1. Make a link   what the link does and how long it lasts → "Make the link"
 *   2. The link      the link itself with Copy, when it expires,
 *                    "Make a new one" and "Done"
 *
 * A v2 copy of v1's `GenerateInviteDialog` (components/customers/
 * generate-invite-dialog.tsx, untouched — the v1 new-rental page still uses
 * it). The same call: `create-customer-invite` with the tenant's id and slug.
 */

import { useState } from "react";
import { format } from "date-fns";
import { Check, Copy, Link2, Loader2, RotateCcw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui-v2/dialog";
import { CONTROL, FORM_DIALOG_WASH, TWINKLE_CSS } from "@/components/shared/form-grid-v2";
import { InviteLinkArt, InviteLinkReadyArt } from "@/components/illustrations-v2/scenes/add-customer";

export function InviteLinkDialogV2({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const make = async () => {
    if (!tenant?.id || !tenant?.slug) {
      toast({ title: "Couldn't make the link", description: "I couldn't tell which business this is for. Please reload.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-customer-invite", {
        body: { tenantId: tenant.id, tenantSlug: tenant.slug },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Failed to generate invite link");
      setLink({ url: data.url, expiresAt: data.expiresAt ?? null });
      setCopied(false);
    } catch (e: any) {
      toast({ title: "Couldn't make the link", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused — the link is selectable in the field */
    }
  };

  const close = (o: boolean) => {
    if (!o) {
      setLink(null);
      setCopied(false);
    }
    onOpenChange(o);
  };

  const Art = link ? InviteLinkReadyArt : InviteLinkArt;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[600px]" style={FORM_DIALOG_WASH} showCloseButton={false}>
        <DialogTitle className="sr-only">Customer registration link</DialogTitle>
        <DialogDescription className="sr-only">
          {link ? "Your registration link is ready" : "Make a link customers use to sign themselves up"}
        </DialogDescription>
        <style>{TWINKLE_CSS}</style>

        <div
          key={link ? "ready" : "make"}
          className="flex h-[400px] flex-col items-center justify-center px-10 text-center duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none"
        >
          <Art className="max-w-[260px]" />
          <h3 className="mt-5 text-xl font-medium leading-snug text-foreground [text-wrap:balance]">
            {link ? "Here's their link." : "Let them sign themselves up"}
          </h3>
          <p className="mx-auto mt-1.5 min-h-[2lh] max-w-[26rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
            {link
              ? link.expiresAt
                ? `It works until ${format(new Date(link.expiresAt), "MMM d 'at' h:mm a")}. Send it any way you like.`
                : "Send it any way you like."
              : "I'll make a link to a short form on your booking site. They fill in their details and verify their ID. It works for 7 days."}
          </p>

          {link && (
            <div className="relative mt-5 w-full max-w-[440px]">
              <input
                readOnly
                value={link.url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Registration link"
                className={cn(CONTROL, "pr-12 text-left font-mono text-[13px]")}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={copy}
                aria-label={copied ? "Link copied" : "Copy link"}
                title={copied ? "Copied" : "Copy link"}
                className="absolute right-1.5 top-1/2 size-8 -translate-y-1/2 rounded-lg"
              >
                {copied ? <Check className="size-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-4" />}
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 px-8 py-4">
          {link ? (
            <>
              <Button variant="outline" className="h-10 rounded-full px-5" onClick={make} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                Make a new one
              </Button>
              <Button className="h-10 rounded-full px-5" onClick={() => close(false)}>
                <Check className="size-4" /> Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="h-10 rounded-full px-5" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button className="h-10 rounded-full px-5" onClick={make} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                {loading ? "Making it…" : "Make the link"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
