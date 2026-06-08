"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCreateVehicleOwner, useUpdateVehicleOwner } from "@/hooks/use-vehicle-owners";
import {
  COMMISSION_TYPE_OPTIONS,
  FLAT_FEE_PERIOD_OPTIONS,
  PAYOUT_FREQUENCY_OPTIONS,
  type CommissionType,
  type FlatFeePeriod,
  type PayoutFrequency,
  type VehicleOwner,
} from "@/types/vehicle-owners";

interface OwnerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owner?: VehicleOwner;
  onSaved?: (owner: VehicleOwner) => void;
}

export function OwnerFormDialog({ open, onOpenChange, owner, onSaved }: OwnerFormDialogProps) {
  const isEdit = !!owner;
  const create = useCreateVehicleOwner();
  const update = useUpdateVehicleOwner();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [commissionType, setCommissionType] = useState<CommissionType>("percentage");
  const [commissionValue, setCommissionValue] = useState<string>("0");
  const [flatFeePeriod, setFlatFeePeriod] = useState<FlatFeePeriod>("per_month");
  const [payoutFrequency, setPayoutFrequency] = useState<PayoutFrequency>("biweekly");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (owner) {
      setFullName(owner.full_name);
      setEmail(owner.email ?? "");
      setPhone(owner.phone ?? "");
      setAddress(owner.address ?? "");
      setNotes(owner.notes ?? "");
      setCommissionType(owner.commission_type);
      setCommissionValue(String(owner.commission_value));
      setFlatFeePeriod(owner.flat_fee_period ?? "per_month");
      setPayoutFrequency(owner.payout_frequency);
      setIsActive(owner.is_active);
    } else {
      setFullName("");
      setEmail("");
      setPhone("");
      setAddress("");
      setNotes("");
      setCommissionType("percentage");
      setCommissionValue("0");
      setFlatFeePeriod("per_month");
      setPayoutFrequency("biweekly");
      setIsActive(true);
    }
    setError(null);
  }, [open, owner]);

  const handleSubmit = async () => {
    setError(null);
    if (!fullName.trim()) {
      setError("Owner name is required.");
      return;
    }
    const valueNum = Number(commissionValue);
    if (Number.isNaN(valueNum) || valueNum < 0) {
      setError("Commission value must be a positive number.");
      return;
    }
    if (commissionType === "percentage" && valueNum > 100) {
      setError("Percentage commission cannot exceed 100%.");
      return;
    }

    const payload = {
      full_name: fullName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      commission_type: commissionType,
      commission_value: valueNum,
      flat_fee_period: commissionType === "flat_fee" ? flatFeePeriod : null,
      payout_frequency: payoutFrequency,
      is_active: isActive,
    };

    try {
      if (isEdit && owner) {
        const updated = await update.mutateAsync({ id: owner.id, patch: payload });
        onSaved?.(updated);
      } else {
        const created = await create.mutateAsync(payload);
        onSaved?.(created);
      }
      onOpenChange(false);
    } catch (e) {
      // toast handled in hook
    }
  };

  const isSubmitting = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Vehicle Owner" : "Add Vehicle Owner"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this owner's contact and commission settings." : "Record a third-party owner whose vehicles you manage."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="owner-name">Full Name *</Label>
              <Input id="owner-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div>
              <Label htmlFor="owner-email">Email</Label>
              <Input id="owner-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
            </div>
            <div>
              <Label htmlFor="owner-phone">Phone</Label>
              <Input id="owner-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 ..." />
            </div>
            <div>
              <Label htmlFor="owner-address">Address</Label>
              <Input id="owner-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Commission Type *</Label>
              <Select value={commissionType} onValueChange={(v) => setCommissionType(v as CommissionType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMISSION_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="owner-commission-value">
                {commissionType === "percentage" ? "Percentage (%)" : "Flat Amount"} *
              </Label>
              <Input
                id="owner-commission-value"
                type="number"
                min={0}
                max={commissionType === "percentage" ? 100 : undefined}
                step="0.01"
                value={commissionValue}
                onChange={(e) => setCommissionValue(e.target.value)}
              />
            </div>
          </div>

          {commissionType === "flat_fee" && (
            <div>
              <Label>Flat Fee Period *</Label>
              <Select value={flatFeePeriod} onValueChange={(v) => setFlatFeePeriod(v as FlatFeePeriod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FLAT_FEE_PERIOD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Payout Frequency *</Label>
            <Select value={payoutFrequency} onValueChange={(v) => setPayoutFrequency(v as PayoutFrequency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYOUT_FREQUENCY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="owner-notes">Notes</Label>
            <Textarea
              id="owner-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Bank account details, payment preferences, etc."
              rows={3}
            />
          </div>

          {isEdit && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="owner-active">Active</Label>
                <p className="text-xs text-muted-foreground mt-1">Inactive owners are hidden from defaults but their payout history is preserved.</p>
              </div>
              <Switch id="owner-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}

          {error && <p className="text-sm text-[color:var(--bento-danger-fg)]">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : isEdit ? "Save Changes" : "Add Owner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
