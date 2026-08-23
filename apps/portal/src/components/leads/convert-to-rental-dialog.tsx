"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { supabase } from "@/integrations/supabase/client";
import type { LeadRow } from "@/hooks/use-leads";
import { throwEdgeError } from "@/lib/edge-error";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadRow;
}

export function ConvertToRentalDialog({ open, onOpenChange, lead }: Props) {
  const router = useRouter();
  // Empty string lets the input render blank with its placeholder visible —
  // operators noticed the placeholder "0" was easy to miss and required deleting
  // before typing a real number.
  const [monthlyAmount, setMonthlyAmount] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  // Where the customer came from. Asked here because the lead flow is where it
  // is most likely to be known — somebody has already spoken to them.
  const [fromTuro, setFromTuro] = useState(false);

  const handleSubmit = async () => {
    const amount = Number(monthlyAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a monthly amount greater than 0.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ customerId: string; rentalId: string | null; status: string }>(
        "convert-lead-to-rental",
        {
          body: {
            leadId: lead.id,
            pricing: { monthlyAmount: amount, rentalPeriodType: (lead.rental_type as "daily" | "weekly" | "monthly") ?? "weekly" },
            leadSource: fromTuro ? "turo" : "direct",
          },
        },
      );
      if (error) {
        // Surface the real edge-function error body (e.g. "Failed to create
        // rental: null value in column ...") instead of "non-2xx status code".
        await throwEdgeError(error);
      }
      // The function is idempotent. Read the actual outcome instead of always
      // claiming success — the old "Rental created!" toast lied when the lead
      // was already half-converted.
      if (!data?.rentalId) {
        toast.error("Conversion incomplete — no rental was created. Check logs.");
        return;
      }
      if (data.status === "already_converted") {
        toast.success("Already converted — opening existing rental.");
      } else {
        toast.success("Rental created!");
      }
      onOpenChange(false);
      router.push(`/rentals/${data.rentalId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert to rental</DialogTitle>
          <DialogDescription>
            This will create a customer record and an active rental for {lead.full_name}. The
            conversation history is preserved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p>
              <span className="text-muted-foreground">Vehicle: </span>
              {lead.vehicle_id ? "Selected vehicle" : "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Dates: </span>
              {lead.start_date} → {lead.end_date}
            </p>
            <p>
              <span className="text-muted-foreground">Rental type: </span>
              {lead.rental_type ?? "weekly"}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Monthly amount ($)</Label>
            <Input
              type="number"
              min={0}
              step={1}
              placeholder="e.g. 1200"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Per the rentals schema, monthly_amount is required. Adjust later from the rental
              detail page.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox
              id="convert-from-turo"
              checked={fromTuro}
              onCheckedChange={(checked) => setFromTuro(checked === true)}
              className="mt-0.5"
            />
            <Label htmlFor="convert-from-turo" className="cursor-pointer text-sm font-normal leading-relaxed">
              This customer came from Turo
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Tags the rental so you can tell your Turo bookings apart. Nothing is sent to Turo.
              </span>
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Converting…</>
            ) : (
              "Convert"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
