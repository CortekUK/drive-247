"use client";

import { useState } from "react";
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadRow;
}

export function ConvertToRentalDialog({ open, onOpenChange, lead }: Props) {
  const router = useRouter();
  const [monthlyAmount, setMonthlyAmount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (monthlyAmount <= 0) {
      toast.error("Enter a price first.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ customerId: string; rentalId: string; status: string }>(
        "convert-lead-to-rental",
        {
          body: {
            leadId: lead.id,
            pricing: { monthlyAmount, rentalPeriodType: (lead.rental_type as "daily" | "weekly" | "monthly") ?? "weekly" },
          },
        },
      );
      if (error) throw error;
      toast.success("Rental created!");
      onOpenChange(false);
      if (data?.rentalId) router.push(`/rentals/${data.rentalId}`);
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
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground">
              Per the rentals schema, monthly_amount is required. Adjust later from the rental
              detail page.
            </p>
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
