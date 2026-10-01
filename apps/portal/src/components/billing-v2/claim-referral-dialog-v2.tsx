"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Textarea } from "@/components/ui-v2/textarea";
import { useReferralClaim, type ReferralsData } from "@/hooks/use-referrals";

/**
 * "Someone joined because of you?" — for an operator who subscribed WITHOUT
 * the code. Sends a claim (`tenant-referrals`, action "claim"); the team
 * checks it and, if it matches, adds them to the referrer's list. Earlier
 * claims are listed underneath with where they've got to.
 */
export function ClaimReferralDialogV2({
  open,
  onOpenChange,
  claims,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claims: ReferralsData["claims"];
  readOnly: boolean;
}) {
  const claim = useReferralClaim();
  const [businessName, setBusinessName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) {
      setBusinessName("");
      setContact("");
      setNote("");
    }
  }, [open]);

  const submit = async () => {
    try {
      await claim.mutateAsync({ businessName, contact, note });
      toast.success("Thanks — we'll check and add them to your referrals.");
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || "Could not send that right now");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-7 sm:max-w-lg">
        <DialogHeader className="text-left">
          <DialogTitle>Claim a referral</DialogTitle>
          <DialogDescription>
            Someone joined Drive247 because of you but didn&apos;t use your code? Tell us who, and we&apos;ll add them to your
            referrals once we&apos;ve checked.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="claim-business" className="text-xs text-muted-foreground">
              Their business name
            </label>
            <Input id="claim-business" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Sunrise Car Hire" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="claim-contact" className="text-xs text-muted-foreground">
              Their email or phone (optional)
            </label>
            <Input id="claim-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="claim-note" className="text-xs text-muted-foreground">
              Anything else (optional)
            </label>
            <Textarea id="claim-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="resize-none rounded-xl" />
          </div>
        </div>

        {claims.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Your claims</p>
            <div className="divide-y divide-border/60">
              {claims.map((c) => (
                <div key={c.id} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                  <span className="truncate">{c.claimed_business_name}</span>
                  <span
                    className={`shrink-0 ${
                      c.status === "approved" ? "text-green-600 dark:text-green-400" : c.status === "rejected" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {c.status === "approved" ? "Added" : c.status === "rejected" ? "Not matched" : "Checking"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={claim.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={readOnly || claim.isPending || businessName.trim().length < 2} className="rounded-xl">
            {claim.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send claim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
