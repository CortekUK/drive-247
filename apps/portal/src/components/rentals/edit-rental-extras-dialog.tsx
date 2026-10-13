"use client";

/**
 * Edit add-ons on an existing (v1) rental, any time before the car is handed
 * over — including after the agreement has gone out and after payment.
 *
 * Saving calls `update_rental_extras_v1`, which re-prices the Extras charge in
 * one transaction. Add-ons already on the rental keep the price they were
 * booked at; new ones take today's catalogue price. When the renter already
 * PAID for add-ons that are now removed, the function returns `refund_due` and
 * `onSaved` hands it back to the page, which opens the normal Refund dialog —
 * no money moves on its own.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Package, Plus, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format-utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface EditExtrasResult {
  extras_total: number;
  previous_total: number;
  added_owed: number;
  refund_due: number;
}

interface CurrentSelection {
  extra_id: string;
  quantity: number;
  price_at_booking: number;
  billing_type_at_booking: string | null;
  rental_extras?: { name?: string | null } | null;
}

interface CatalogueExtra {
  id: string;
  name: string;
  description: string | null;
  price: number;
  billing_type: string | null;
  max_quantity: number | null;
  is_active: boolean | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  rentalDays: number;
  currentSelections: CurrentSelection[];
  currentTotal: number;
  currencyCode: string;
  onSaved?: (result: EditExtrasResult) => void;
}

export function EditRentalExtrasDialog({
  open,
  onOpenChange,
  rentalId,
  rentalDays,
  currentSelections,
  currentTotal,
  currencyCode,
  onSaved,
}: Props) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [blocker, setBlocker] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const { data: catalogue = [], isLoading } = useQuery({
    queryKey: ["rental-extras-catalogue", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_extras")
        .select("id, name, description, price, billing_type, max_quantity, is_active")
        .eq("tenant_id", tenant!.id)
        .order("name");
      if (error) throw error;
      return (data || []) as CatalogueExtra[];
    },
    enabled: open && !!tenant?.id,
  });

  // Reset to what the rental has each time the dialog opens, and ask the
  // server (dry run) whether this rental can still be changed.
  useEffect(() => {
    if (!open) return;
    const init: Record<string, number> = {};
    for (const s of currentSelections) init[s.extra_id] = s.quantity;
    setQty(init);
    setBlocker(null);
    setChecking(true);
    (supabase.rpc as any)("update_rental_extras_v1", { p_rental_id: rentalId, p_selections: [], p_dry_run: true })
      .then(({ data, error }: any) => {
        if (error) setBlocker(error.message);
        else if (!data?.ok) setBlocker(data?.reason || "This rental's add-ons cannot be changed.");
      })
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rentalId]);

  const booked = useMemo(() => {
    const m: Record<string, CurrentSelection> = {};
    for (const s of currentSelections) m[s.extra_id] = s;
    return m;
  }, [currentSelections]);

  // Active catalogue items, plus anything already on the rental that has since
  // been switched off (it can still be kept or removed, just not added).
  const items = useMemo(
    () => catalogue.filter((e) => e.is_active !== false || booked[e.id]),
    [catalogue, booked],
  );

  const unitPrice = (e: CatalogueExtra) => (booked[e.id] ? Number(booked[e.id].price_at_booking) : Number(e.price));
  const billing = (e: CatalogueExtra) =>
    booked[e.id] ? booked[e.id].billing_type_at_booking || e.billing_type || "per_trip" : e.billing_type || "per_trip";
  const lineTotal = (e: CatalogueExtra, q: number) => q * unitPrice(e) * (billing(e) === "per_day" ? rentalDays : 1);

  const newTotal = Math.round(items.reduce((sum, e) => sum + lineTotal(e, qty[e.id] || 0), 0) * 100) / 100;
  const changed = items.some((e) => (qty[e.id] || 0) !== (booked[e.id]?.quantity || 0));

  const setQuantity = (e: CatalogueExtra, q: number) => {
    const max = e.max_quantity ?? 99;
    setQty((prev) => ({ ...prev, [e.id]: Math.max(0, Math.min(max, q)) }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const selections = Object.entries(qty)
        .filter(([, q]) => q > 0)
        .map(([extra_id, quantity]) => ({ extra_id, quantity }));
      const { data, error } = await (supabase.rpc as any)("update_rental_extras_v1", {
        p_rental_id: rentalId,
        p_selections: selections,
        p_dry_run: false,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.reason || "Could not update add-ons.");

      await Promise.all(
        [
          ["rental-extras-details", rentalId],
          ["rental-charges"],
          ["rental-totals"],
          ["rental-invoice"],
          ["rental-payment-breakdown"],
          ["rental", rentalId],
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey, refetchType: "all" })),
      );

      const result = data as EditExtrasResult;
      toast({
        title: "Add-ons updated",
        description:
          result.refund_due > 0
            ? `Renter already paid ${formatCurrency(result.refund_due, currencyCode)} for removed add-ons — refund it next.`
            : result.added_owed > 0
              ? `${formatCurrency(result.added_owed, currencyCode)} added to the balance due.`
              : `Add-ons total is now ${formatCurrency(result.extras_total, currencyCode)}.`,
      });
      onOpenChange(false);
      onSaved?.(result);
    } catch (err: any) {
      toast({ title: "Could not update add-ons", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const locked = !!blocker;

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-indigo-500" />
            Edit add-ons
          </DialogTitle>
          <DialogDescription>
            Add or remove add-ons before pickup. Add-ons already on the rental keep their booked price.
          </DialogDescription>
        </DialogHeader>

        {locked && (
          <Alert>
            <Lock className="h-4 w-4" />
            <AlertDescription>{blocker}</AlertDescription>
          </Alert>
        )}

        <div className="max-h-[50vh] overflow-y-auto divide-y rounded-md border">
          {isLoading || checking ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading add-ons…
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No add-ons in your catalogue. Create them in Settings → Extras.
            </p>
          ) : (
            items.map((e) => {
              const q = qty[e.id] || 0;
              const perDay = billing(e) === "per_day";
              const max = e.max_quantity ?? 99;
              const canAdd = !locked && q < max && (e.is_active !== false || q < (booked[e.id]?.quantity || 0));
              return (
                <div key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(unitPrice(e), currencyCode)}
                      {perDay ? `/day × ${rentalDays} ${rentalDays === 1 ? "day" : "days"}` : " per trip"}
                      {e.is_active === false ? " · no longer offered" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={locked || q <= 0}
                      onClick={() => setQuantity(e, q - 1)}
                      aria-label={`Remove one ${e.name}`}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-6 text-center text-sm tabular-nums">{q}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      disabled={!canAdd}
                      onClick={() => setQuantity(e, q + 1)}
                      aria-label={`Add one ${e.name}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <span className="w-20 text-right text-sm font-medium tabular-nums">
                    {formatCurrency(lineTotal(e, q), currencyCode)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Add-ons total</span>
          <span className="font-semibold tabular-nums">
            {changed && (
              <span className="mr-2 font-normal text-muted-foreground line-through">
                {formatCurrency(currentTotal, currencyCode)}
              </span>
            )}
            {formatCurrency(newTotal, currencyCode)}
          </span>
        </div>
        {changed && newTotal < currentTotal && (
          <p className="text-xs text-muted-foreground">
            If the renter already paid for removed add-ons, you'll be asked to refund the difference after saving.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={locked || !changed || saving || checking}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save add-ons
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
