import { useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCancelRental } from "@/hooks/use-cancel-rental";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import { AlertTriangle, Loader2 } from "lucide-react";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";

interface CancelRentalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
    customer?: { name?: string; email?: string };
    vehicle?: { make?: string; model?: string };
    monthly_amount?: number;
  };
  payment?: {
    id: string;
    amount?: number;
    stripe_payment_intent_id?: string;
    capture_status?: string;
  };
}

export function CancelRentalDialog({
  open,
  onOpenChange,
  rental,
  payment,
}: CancelRentalDialogProps) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const cancelRental = useCancelRental();

  const [refundType, setRefundType] = useState<"full" | "partial" | "none">("full");
  const [refundAmount, setRefundAmount] = useState<string>("");
  const [reason, setReason] = useState("");

  const maxRefundAmount = payment?.amount || rental.monthly_amount || 0;
  const isPreAuth = payment?.capture_status === "requires_capture";
  const currencyCode = tenant?.currency_code || 'GBP';
  const currencySymbol = getCurrencySymbol(currencyCode);

  const handleCancel = async () => {
    if (!reason.trim()) {
      return;
    }

    const params = {
      rentalId: rental.id,
      paymentId: payment?.id,
      refundType,
      refundAmount: refundType === "partial" ? parseFloat(refundAmount) : undefined,
      reason: reason.trim(),
      cancelledBy: user?.id || "unknown",
      tenantId: tenant?.id,
    };

    await cancelRental.mutateAsync(params);
    onOpenChange(false);
  };

  const handleClose = () => {
    setRefundType("full");
    setRefundAmount("");
    setReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Cancel Rental
          </DialogTitle>
          <DialogDescription>
            Cancel the rental for {rental.customer?.name || "Customer"} -{" "}
            {rental.vehicle?.make} {rental.vehicle?.model}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Refund Options */}
          <div className="space-y-3">
            <Label>Refund Option</Label>
            {isPreAuth ? (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  This is a pre-authorized payment. The hold of{" "}
                  <strong>{formatCurrency(maxRefundAmount, currencyCode)}</strong> will be released automatically.
                  No refund is needed as the payment was never captured.
                </p>
              </div>
            ) : (
              <RadioGroup
                value={refundType}
                onValueChange={(value) => setRefundType(value as "full" | "partial" | "none")}
                className="space-y-2"
              >
                <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-gray-50">
                  <RadioGroupItem value="full" id="full" />
                  <Label htmlFor="full" className="cursor-pointer flex-1">
                    <div className="font-medium">Full Refund</div>
                    <div className="text-sm text-muted-foreground">
                      Refund {formatCurrency(maxRefundAmount, currencyCode)} to customer
                    </div>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-gray-50">
                  <RadioGroupItem value="partial" id="partial" />
                  <Label htmlFor="partial" className="cursor-pointer flex-1">
                    <div className="font-medium">Partial Refund</div>
                    <div className="text-sm text-muted-foreground">
                      Refund a specific amount
                    </div>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 border rounded-lg p-3 cursor-pointer hover:bg-gray-50">
                  <RadioGroupItem value="none" id="none" />
                  <Label htmlFor="none" className="cursor-pointer flex-1">
                    <div className="font-medium">No Refund</div>
                    <div className="text-sm text-muted-foreground">
                      Cancel without refunding
                    </div>
                  </Label>
                </div>
              </RadioGroup>
            )}
          </div>

          {/* Partial Refund Amount */}
          {refundType === "partial" && !isPreAuth && (
            <div className="space-y-2">
              <Label htmlFor="refundAmount">Refund Amount ({currencySymbol})</Label>
              <Input
                id="refundAmount"
                type="number"
                min="0"
                max={maxRefundAmount}
                step="0.01"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                placeholder={`Max: ${formatCurrency(maxRefundAmount, currencyCode)}`}
              />
              {parseFloat(refundAmount) > maxRefundAmount && (
                <p className="text-sm text-red-500">
                  Amount cannot exceed {formatCurrency(maxRefundAmount, currencyCode)}
                </p>
              )}
            </div>
          )}

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">
              Reason for Cancellation <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Please provide a reason for this cancellation..."
              rows={3}
            />
            {!reason.trim() && (
              <p className="text-sm text-muted-foreground">
                A reason is required for cancellation
              </p>
            )}
          </div>

          {/* Warning */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-sm text-yellow-800">
              <strong>Note:</strong> This action will:
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Cancel the rental and mark the vehicle as available</li>
                {isPreAuth ? (
                  <li>Release the payment hold on the customer's card</li>
                ) : refundType !== "none" ? (
                  <li>Process a {refundType} refund via Stripe</li>
                ) : (
                  <li>Not issue any refund</li>
                )}
                <li>Send a notification email to the customer</li>
              </ul>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={cancelRental.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={
              cancelRental.isPending ||
              !reason.trim() ||
              (refundType === "partial" &&
                (!refundAmount || parseFloat(refundAmount) <= 0 || parseFloat(refundAmount) > maxRefundAmount))
            }
          >
            {cancelRental.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Confirm Cancellation"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
