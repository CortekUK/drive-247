"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, FileSignature } from "lucide-react";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RentalPicker, type PickerRental } from "@/components/shared/rental-picker";

interface GenerateAgreementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ExtensionRow {
  id: string;
  sequence_number: number;
  previous_end_date: string | null;
  new_end_date: string | null;
}

interface RentalFlags {
  is_pay_as_you_go: boolean;
  has_installment_plan: boolean;
}

type AgreementType = "original" | "payg" | "installment" | "extension";

export function GenerateAgreementDialog({
  open,
  onOpenChange,
}: GenerateAgreementDialogProps) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const [rental, setRental] = useState<PickerRental | null>(null);
  const [agreementType, setAgreementType] = useState<AgreementType>("original");
  const [extensionId, setExtensionId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Fetch extensions for the picked rental — only when we need to populate the dropdown
  const { data: extensions = [], isLoading: extensionsLoading } = useQuery({
    queryKey: ["rental-extensions-for-agreement", rental?.id],
    queryFn: async (): Promise<ExtensionRow[]> => {
      if (!rental?.id) return [];
      const { data, error } = await supabase
        .from("rental_extensions")
        .select("id, sequence_number, previous_end_date, new_end_date")
        .eq("rental_id", rental.id)
        .order("sequence_number", { ascending: true });
      if (error) throw error;
      return (data || []) as ExtensionRow[];
    },
    enabled: !!rental?.id,
  });

  // Fetch rental flags (PAYG / installment) so we can enable the right dropdown options
  const { data: rentalFlags } = useQuery({
    queryKey: ["rental-flags-for-agreement", rental?.id],
    queryFn: async (): Promise<RentalFlags | null> => {
      if (!rental?.id) return null;
      const { data, error } = await supabase
        .from("rentals")
        .select("is_pay_as_you_go, has_installment_plan")
        .eq("id", rental.id)
        .single();
      if (error) throw error;
      return {
        is_pay_as_you_go: !!data?.is_pay_as_you_go,
        has_installment_plan: !!data?.has_installment_plan,
      };
    },
    enabled: !!rental?.id,
  });

  const hasExtensions = extensions.length > 0;
  const isPayg = !!rentalFlags?.is_pay_as_you_go;
  const hasInstallment = !!rentalFlags?.has_installment_plan;

  // Reset transient state when the configure dialog closes
  useEffect(() => {
    if (!rental) {
      setAgreementType("original");
      setExtensionId("");
    }
  }, [rental]);

  // Pre-select the most appropriate type once rental flags load
  useEffect(() => {
    if (!rentalFlags) return;
    if (hasInstallment) setAgreementType("installment");
    else if (isPayg) setAgreementType("payg");
    else setAgreementType("original");
  }, [rentalFlags, hasInstallment, isPayg]);

  // If user picks Extension but only one exists, auto-select it
  useEffect(() => {
    if (agreementType === "extension" && extensions.length === 1) {
      setExtensionId(extensions[0].id);
    }
  }, [agreementType, extensions]);

  const handlePick = (picked: PickerRental) => {
    setRental(picked);
    onOpenChange(false);
  };

  const handleClose = () => {
    setRental(null);
  };

  const selectedExtension = extensions.find((e) => e.id === extensionId);

  const handleSubmit = async () => {
    if (!rental || !tenant?.id) return;
    if (agreementType === "extension" && !selectedExtension) {
      toast.error("Pick an extension period");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        rentalId: rental.id,
        customerEmail: rental.customers.email,
        customerName: rental.customers.name,
        tenantId: tenant.id,
        agreementType,
      };

      if (agreementType === "extension" && selectedExtension) {
        body.extensionPreviousEndDate = selectedExtension.previous_end_date;
        body.extensionNewEndDate = selectedExtension.new_end_date;
        body.extensionNumber = selectedExtension.sequence_number;
      }

      const response = await fetch("/api/esign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (data?.error === "insufficient_credits") {
        toast.error("Insufficient credits — top up to send this agreement");
      } else if (!response.ok || !data?.ok) {
        const detail = data?.detail || data?.error || "Failed to send agreement";
        const isRateLimit =
          typeof detail === "string" &&
          (detail.toLowerCase().includes("quota exceeded") ||
            detail.toLowerCase().includes("rate limit"));
        toast.error(
          isRateLimit
            ? "BoldSign API limit reached (50/hour). Wait a few minutes."
            : detail
        );
      } else {
        const successMessage =
          agreementType === "extension"
            ? `Extension #${selectedExtension?.sequence_number} agreement sent for signing`
            : agreementType === "payg"
            ? "PAYG rental agreement sent for signing"
            : agreementType === "installment"
            ? "Installment rental agreement sent for signing"
            : "Rental agreement sent for signing";
        toast.success(successMessage);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["signed-agreements"] }),
          queryClient.invalidateQueries({ queryKey: ["rental-agreements-page"] }),
          queryClient.invalidateQueries({ queryKey: ["extension-agreements-page"] }),
        ]);
        handleClose();
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to send agreement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <RentalPicker
        open={open}
        onOpenChange={onOpenChange}
        mode="agreement"
        onSelect={handlePick}
        title="Generate Agreement"
        description="Pick a rental, then choose which agreement to send."
      />

      <Dialog open={!!rental} onOpenChange={(v) => { if (!v && !submitting) handleClose(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5" />
              Configure Agreement
            </DialogTitle>
            <DialogDescription>
              {rental && (
                <>
                  For{" "}
                  <span className="font-medium text-foreground">{rental.customers.name}</span>{" "}
                  ·{" "}
                  <span className="font-mono uppercase">{rental.vehicles.reg}</span>{" "}
                  · {rental.vehicles.make} {rental.vehicles.model}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Agreement Type</Label>
              <Select
                value={agreementType}
                onValueChange={(v) => setAgreementType(v as AgreementType)}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="original">Original Rental Agreement</SelectItem>
                  <SelectItem value="payg" disabled={!isPayg}>
                    PAYG Rental Agreement{!isPayg ? " (rental is not PAYG)" : ""}
                  </SelectItem>
                  <SelectItem value="installment" disabled={!hasInstallment}>
                    Installment Rental Agreement{!hasInstallment ? " (no installment plan)" : ""}
                  </SelectItem>
                  <SelectItem value="extension" disabled={!hasExtensions}>
                    Extension Agreement{!hasExtensions && extensionsLoading ? " (loading…)" : !hasExtensions ? " (no extensions)" : ""}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {agreementType === "extension" && hasExtensions && (
              <div className="space-y-2">
                <Label>Extension Period</Label>
                <Select
                  value={extensionId}
                  onValueChange={setExtensionId}
                  disabled={submitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select extension period" />
                  </SelectTrigger>
                  <SelectContent>
                    {extensions.map((ext) => (
                      <SelectItem key={ext.id} value={ext.id}>
                        Extension #{ext.sequence_number}
                        {ext.previous_end_date && ext.new_end_date && (
                          <span className="text-muted-foreground ml-2">
                            ({format(parseLocalDate(ext.previous_end_date), "MMM d")} →{" "}
                            {format(parseLocalDate(ext.new_end_date), "MMM d, yyyy")})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!rental?.customers.email && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Customer has no email on file — signing notifications may fail.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || (agreementType === "extension" && !extensionId)}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                "Generate & Send"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
