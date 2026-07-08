"use client";

import { useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, subDays, subWeeks } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTenant } from "@/contexts/TenantContext";
import { useVehicleOwners } from "@/hooks/use-vehicle-owners";
import { useOwnerOwedPreview } from "@/hooks/use-owner-revenue";
import { useCreatePayout } from "@/hooks/use-owner-payouts";
import { formatCurrency } from "@/lib/format-utils";

interface CreatePayoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultOwnerId?: string;
  onCreated?: () => void;
}

export function CreatePayoutDialog({ open, onOpenChange, defaultOwnerId, onCreated }: CreatePayoutDialogProps) {
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";
  const { data: owners = [] } = useVehicleOwners({ includeInactive: true });
  const create = useCreatePayout();

  const [ownerId, setOwnerId] = useState<string | undefined>(defaultOwnerId);
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [refundAdjustments, setRefundAdjustments] = useState<string>("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Manual mode: type a flat Net Owed and skip the revenue calculator entirely.
  const [manualMode, setManualMode] = useState(false);
  const [manualNetOwed, setManualNetOwed] = useState<string>("");

  // Reset state on open and prefill default range based on owner's frequency
  useEffect(() => {
    if (!open) return;
    setOwnerId(defaultOwnerId);
    setError(null);
    setNotes("");
    setRefundAdjustments("0");
    setManualMode(false);
    setManualNetOwed("");
    const today = new Date();
    setPeriodStart(format(startOfMonth(today), "yyyy-MM-dd"));
    setPeriodEnd(format(endOfMonth(today), "yyyy-MM-dd"));
  }, [open, defaultOwnerId]);

  const owner = owners.find((o) => o.id === ownerId);

  // Apply default range based on owner frequency when owner changes
  useEffect(() => {
    if (!owner) return;
    const today = new Date();
    if (owner.payout_frequency === "weekly") {
      setPeriodStart(format(subDays(today, 6), "yyyy-MM-dd"));
      setPeriodEnd(format(today, "yyyy-MM-dd"));
    } else if (owner.payout_frequency === "biweekly") {
      setPeriodStart(format(subWeeks(today, 2), "yyyy-MM-dd"));
      setPeriodEnd(format(today, "yyyy-MM-dd"));
    } else if (owner.payout_frequency === "monthly") {
      setPeriodStart(format(startOfMonth(today), "yyyy-MM-dd"));
      setPeriodEnd(format(endOfMonth(today), "yyyy-MM-dd"));
    }
  }, [owner?.id]);

  const { data: preview = [], isLoading, error: previewError } = useOwnerOwedPreview({
    ownerId,
    fromDate: periodStart,
    toDate: periodEnd,
  });

  const totals = useMemo(() => {
    const gross = preview.reduce((s, r) => s + Number(r.paid_revenue || 0), 0);
    const commission = preview.reduce((s, r) => s + Number(r.commission_amount || 0), 0);
    const refund = Number(refundAdjustments) || 0;
    const net = gross - commission - refund;
    return { gross, commission, refund, net };
  }, [preview, refundAdjustments]);

  const handleCreate = async () => {
    setError(null);
    if (!ownerId) {
      setError("Pick an owner.");
      return;
    }
    if (!periodStart || !periodEnd) {
      setError("Pick a date range.");
      return;
    }
    if (periodEnd < periodStart) {
      setError("End date must be on or after start date.");
      return;
    }
    if (manualMode) {
      const amt = Number(manualNetOwed);
      if (!manualNetOwed || Number.isNaN(amt) || amt <= 0) {
        setError("Enter a net payout amount greater than 0.");
        return;
      }
    } else if (preview.length === 0) {
      setError("This owner has no managed vehicles or no revenue in the selected range.");
      return;
    }
    try {
      await create.mutateAsync({
        owner_id: ownerId,
        period_start: periodStart,
        period_end: periodEnd,
        refund_adjustments: manualMode ? 0 : (Number(refundAdjustments) || 0),
        notes: notes.trim() || undefined,
        preview: manualMode ? [] : preview,
        ...(manualMode ? { manualNetOwed: Number(manualNetOwed) } : {}),
      });
      onCreated?.();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Owner Payout</DialogTitle>
          <DialogDescription>
            Snapshot revenue and commission for an owner over a date range. The payout becomes immutable once created.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 sm:col-span-1">
              <Label>Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue placeholder="Select owner..." /></SelectTrigger>
                <SelectContent>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.full_name}{!o.is_active ? " (inactive)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="period-start">Period Start</Label>
              <Input id="period-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="period-end">Period End</Label>
              <Input id="period-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="manual-mode"
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={manualMode}
              onChange={(e) => setManualMode(e.target.checked)}
            />
            <Label htmlFor="manual-mode" className="cursor-pointer font-normal">
              Enter a manual amount (skip the revenue calculator)
            </Label>
          </div>

          {manualMode ? (
            <div>
              <Label htmlFor="manual-net">Net Payout Amount ({currency})</Label>
              <Input
                id="manual-net"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={manualNetOwed}
                onChange={(e) => setManualNetOwed(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                This exact amount is recorded as owed to the owner. No per-vehicle breakdown or revenue lookup is performed.
              </p>
            </div>
          ) : (
          <div>
            <Label>Preview</Label>
            <div className="border rounded-md overflow-hidden mt-1">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                    <TableHead>Vehicle</TableHead>
                    <TableHead className="text-right">Rentals</TableHead>
                    <TableHead className="text-right">Paid Revenue</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Net to Owner</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                    ))
                  ) : previewError ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-red-600">Failed to load preview.</TableCell></TableRow>
                  ) : preview.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                      {ownerId ? "No revenue data for this period." : "Select an owner to preview."}
                    </TableCell></TableRow>
                  ) : (
                    preview.map((row) => (
                      <TableRow key={row.vehicle_id}>
                        <TableCell className="font-medium">{row.vehicle_reg}</TableCell>
                        <TableCell className="text-right">{row.rental_count}</TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(row.paid_revenue), currency)}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(row.commission_amount), currency)}
                          <div className="text-xs text-muted-foreground">
                            {row.commission_type === "percentage"
                              ? `${row.commission_value}%`
                              : `${formatCurrency(Number(row.commission_value), currency)} / ${row.flat_fee_period === "per_month" ? "mo" : "rental"}`}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(Number(row.net_to_owner), currency)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {!manualMode && (
              <div>
                <Label htmlFor="refund-adj">Refund Adjustments ({currency})</Label>
                <Input
                  id="refund-adj"
                  type="number"
                  step="0.01"
                  value={refundAdjustments}
                  onChange={(e) => setRefundAdjustments(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Subtract refunds issued in this period that you've already paid the owner for.
                </p>
              </div>
            )}
            <div className={manualMode ? "col-span-2" : ""}>
              <Label htmlFor="payout-notes">Notes</Label>
              <Textarea id="payout-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {!manualMode && (
            <div className="rounded-md border p-3 bg-[#f8fafc] dark:bg-muted/40">
              <div className="grid grid-cols-4 text-sm gap-2">
                <Stat label="Gross Revenue" value={formatCurrency(totals.gross, currency)} />
                <Stat label="Commission" value={`- ${formatCurrency(totals.commission, currency)}`} />
                <Stat label="Refund Adj." value={`- ${formatCurrency(totals.refund, currency)}`} />
                <Stat label="Net Owed" value={formatCurrency(totals.net, currency)} highlight />
              </div>
              {totals.net < 0 && (
                <p className="text-xs text-orange-700 dark:text-orange-400 mt-2">
                  Net is negative — owner currently owes the operator {formatCurrency(Math.abs(totals.net), currency)}. Carry forward to next payout.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
          <Button onClick={handleCreate} disabled={create.isPending || !ownerId || (!manualMode && preview.length === 0)}>
            {create.isPending ? "Creating..." : "Create Payout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={highlight ? "text-base font-medium text-foreground" : "text-sm text-foreground/80"}>{value}</div>
    </div>
  );
}
