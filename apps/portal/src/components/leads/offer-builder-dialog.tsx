/**
 * OfferBuilderDialog — Spec Section 6.6 (Offer-builder UI).
 *
 * Form fields:
 *   - vehicles (pre-selected from matching engine)
 *   - default dates (pre-filled from lead.start_date / end_date)
 *   - date flexibility (0/±1/±2/±3/±7)
 *   - deposit amount
 *   - custom message
 *   - expiry (12h/24h/3d/7d)
 *   - show prices toggle
 *   - send method (sms/email/whatsapp/copy)
 */
"use client";

import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { getOfferUrl } from "@/lib/booking-url";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  defaultStartDate: string;
  defaultEndDate: string;
  selectedVehicleIds: string[];
}

export function OfferBuilderDialog({
  open,
  onOpenChange,
  leadId,
  defaultStartDate,
  defaultEndDate,
  selectedVehicleIds,
}: Props) {
  const { tenant, tenantSlug } = useTenant();
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [dateFlexDays, setDateFlexDays] = useState(2);
  const [depositAmount, setDepositAmount] = useState(300);
  const [customMessage, setCustomMessage] = useState("");
  const [expiresInHours, setExpiresInHours] = useState(72);
  const [showPrices, setShowPrices] = useState(true);
  const [sendMethod, setSendMethod] = useState<"sms" | "email" | "whatsapp" | "copy">("sms");
  const [submitting, setSubmitting] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ url: string; shortCode: string }>(
        "create-offer-link",
        {
          body: {
            leadId,
            vehicles: selectedVehicleIds.map((id) => ({ vehicleId: id })),
            defaultStartDate: startDate,
            defaultEndDate: endDate,
            dateFlexDays,
            depositAmount,
            customMessage: customMessage.trim() || undefined,
            expiresInHours,
            showPrices,
            sendMethod,
          },
        },
      );
      if (error) throw error;
      if (sendMethod === "copy" && data?.shortCode) {
        // Display the dev-correct URL (localhost or prod)
        const displayUrl = getOfferUrl(tenantSlug, data.shortCode) || data.url;
        setCreatedUrl(displayUrl);
        toast.success("Offer link created. Copy it from below.");
      } else {
        toast.success("Offer sent.");
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create offer");
    } finally {
      setSubmitting(false);
    }
  };

  const copyUrl = () => {
    if (!createdUrl) return;
    navigator.clipboard?.writeText(createdUrl);
    toast.success("Copied");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create offer link</DialogTitle>
          <DialogDescription>
            {selectedVehicleIds.length} vehicle{selectedVehicleIds.length === 1 ? "" : "s"} selected.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Date flexibility</Label>
              <Select value={String(dateFlexDays)} onValueChange={(v) => setDateFlexDays(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">No flex</SelectItem>
                  <SelectItem value="1">±1 day</SelectItem>
                  <SelectItem value="2">±2 days</SelectItem>
                  <SelectItem value="3">±3 days</SelectItem>
                  <SelectItem value="7">±7 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Deposit ($)</Label>
              <Input
                type="number"
                min={0}
                step={50}
                value={depositAmount}
                onChange={(e) => setDepositAmount(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Custom message (optional)</Label>
            <Textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="Hi {{first_name}}, I picked these out for you…"
              rows={3}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Expiry</Label>
              <Select value={String(expiresInHours)} onValueChange={(v) => setExpiresInHours(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="12">12 hours</SelectItem>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="72">3 days</SelectItem>
                  <SelectItem value="168">7 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Send via</Label>
              <Select value={sendMethod} onValueChange={(v) => setSendMethod(v as typeof sendMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="copy">Copy link only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
            <div>
              <Label className="text-sm font-medium">Show prices on offer page</Label>
              <p className="text-xs text-muted-foreground">Some tenants prefer quoting in chat.</p>
            </div>
            <Switch checked={showPrices} onCheckedChange={setShowPrices} />
          </div>

          {createdUrl && (
            <div className="rounded-md border bg-emerald-50 p-3">
              <p className="text-xs text-emerald-800">Link created:</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs">{createdUrl}</code>
                <Button size="sm" variant="outline" onClick={copyUrl}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || selectedVehicleIds.length === 0}>
            {submitting ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Creating…</>
            ) : (
              sendMethod === "copy" ? "Create link" : "Create & send"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
