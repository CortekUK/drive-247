import { useState } from "react";
import { AlertTriangle, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { useVehicleDisposal } from "@/hooks/use-vehicle-disposal";

interface Vehicle {
  id: string;
  reg: string;
  make?: string;
  model?: string;
}

interface VehicleUndoDisposalDialogProps {
  vehicle: Vehicle;
  onUndo?: () => void;
}

export function VehicleUndoDisposalDialog({ vehicle, onUndo }: VehicleUndoDisposalDialogProps) {
  const [open, setOpen] = useState(false);
  const { undoDisposal, isUndoing } = useVehicleDisposal(vehicle.id);

  const handleUndo = async () => {
    try {
      await undoDisposal();
      setOpen(false);
      onUndo?.();
    } catch (error) {
      console.error('Failed to undo disposal:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Undo2 className="h-4 w-4" />
          Undo Disposal
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Undo Vehicle Disposal</DialogTitle>
          <DialogDescription>
            Are you sure you want to undo the disposal of {vehicle.reg} ({vehicle.make} {vehicle.model})?
          </DialogDescription>
        </DialogHeader>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">Warning</p>
              <p>
                This will remove the disposal record, restore the vehicle to "Available" status, 
                and delete any associated P&L gain/loss entries. This action cannot be undone.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleUndo}
            disabled={isUndoing}
          >
            {isUndoing ? "Processing..." : "Undo Disposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}