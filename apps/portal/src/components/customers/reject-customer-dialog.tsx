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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { XCircle } from "lucide-react";

interface Customer {
  id: string;
  name: string;
  email?: string;
  status?: string;
}

interface RejectCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  onConfirm: (reason: string) => void;
  isLoading?: boolean;
}

export function RejectCustomerDialog({
  open,
  onOpenChange,
  customer,
  onConfirm,
  isLoading = false,
}: RejectCustomerDialogProps) {
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    if (reason.trim()) {
      onConfirm(reason.trim());
      setReason("");
    }
  };

  const handleClose = () => {
    setReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <XCircle className="h-5 w-5" />
            Reject Customer
          </DialogTitle>
          <DialogDescription>
            {customer && (
              <>
                Reject <strong>{customer.name}</strong> and provide a reason.
                This customer will be flagged for review.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason for rejection <span className="text-red-500">*</span></Label>
            <Textarea
              id="reject-reason"
              placeholder="Enter the reason for rejecting this customer..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              This reason will be visible to admins reviewing the customer.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!reason.trim() || isLoading}
          >
            {isLoading ? "Rejecting..." : "Reject Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
