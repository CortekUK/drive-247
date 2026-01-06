import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Key,
  KeyRound,
  AlertCircle
} from "lucide-react";
import { useKeyHandover, HandoverType } from "@/hooks/use-key-handover";
import { KeyHandoverPhotos } from "@/components/rentals/key-handover-photos";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface KeyHandoverSectionProps {
  rentalId: string;
  rentalStatus: string;
}

export const KeyHandoverSection = ({ rentalId, rentalStatus }: KeyHandoverSectionProps) => {
  const {
    givingHandover,
    receivingHandover,
    uploadPhoto,
    deletePhoto,
    markKeyHanded,
    unmarkKeyHanded,
    updateNotes,
    isLoading,
    isUploading,
    isDeleting,
    isMarkingHanded,
    isUnmarkingHanded,
  } = useKeyHandover(rentalId);

  const [confirmHandover, setConfirmHandover] = useState<HandoverType | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<HandoverType | null>(null);
  const [givingNotes, setGivingNotes] = useState<string>("");
  const [receivingNotes, setReceivingNotes] = useState<string>("");

  // Sync local state with server data
  useEffect(() => {
    setGivingNotes(givingHandover?.notes || "");
  }, [givingHandover?.notes]);

  useEffect(() => {
    setReceivingNotes(receivingHandover?.notes || "");
  }, [receivingHandover?.notes]);

  const isClosed = rentalStatus === "Closed" || rentalStatus === "Completed";

  const givingCompleted = !!givingHandover?.handed_at;
  const receivingCompleted = !!receivingHandover?.handed_at;

  const handleUpload = (type: HandoverType) => (file: File) => {
    uploadPhoto.mutate({ type, file });
  };

  const handleConfirmHandover = () => {
    if (confirmHandover) {
      markKeyHanded.mutate(confirmHandover);
      setConfirmHandover(null);
    }
  };

  const handleConfirmUndo = () => {
    if (confirmUndo) {
      unmarkKeyHanded.mutate(confirmUndo);
      setConfirmUndo(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading handover details...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5 text-primary" />
          Key Handover
        </CardTitle>
        <CardDescription>
          Document car condition before giving and after receiving keys
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Vehicle Collection Section */}
          <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Vehicle Collection</h3>
            </div>

            <p className="text-sm text-muted-foreground">
              Before rental - Document car condition before handing over the key
            </p>

            {/* Photos */}
            <KeyHandoverPhotos
              photos={givingHandover?.photos || []}
              onUpload={handleUpload("giving")}
              onDelete={(photo) => deletePhoto.mutate(photo)}
              isUploading={isUploading}
              isDeleting={isDeleting}
              disabled={givingCompleted || isClosed}
            />

            {/* Notes */}
            <div>
              <label className="text-sm font-medium">Notes (Optional)</label>
              <Textarea
                placeholder="Fuel level, mileage, damages, etc."
                value={givingNotes}
                onChange={(e) => setGivingNotes(e.target.value)}
                onBlur={() => {
                  if (givingNotes !== (givingHandover?.notes || "")) {
                    updateNotes.mutate({ type: "giving", notes: givingNotes });
                  }
                }}
                disabled={givingCompleted || isClosed}
                className="mt-1"
                rows={3}
              />
            </div>

            {/* Handed timestamp */}
            {givingCompleted && givingHandover?.handed_at && (
              <p className="text-sm text-muted-foreground">
                Collected on: {new Date(givingHandover.handed_at).toLocaleString()}
              </p>
            )}

            {/* Key Handed Toggle Button */}
            {!isClosed && (
              <Button
                onClick={() => givingCompleted ? setConfirmUndo("giving") : setConfirmHandover("giving")}
                disabled={isMarkingHanded || isUnmarkingHanded}
                variant={givingCompleted ? "outline" : "default"}
                className="w-full"
              >
                <KeyRound className="h-4 w-4 mr-2" />
                {isMarkingHanded || isUnmarkingHanded
                  ? "Processing..."
                  : givingCompleted
                    ? "Undo Collection"
                    : "Confirm Collection"}
              </Button>
            )}

            {/* Warning if no photos */}
            {!givingCompleted && !isClosed && (givingHandover?.photos?.length || 0) === 0 && (
              <div className="flex items-center gap-2 text-amber-600 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>Consider uploading photos first</span>
              </div>
            )}
          </div>

          {/* Vehicle Return Section */}
          <div className={`space-y-4 p-4 border rounded-lg ${!givingCompleted ? 'bg-muted/50 opacity-60' : 'bg-muted/20'}`}>
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Vehicle Return</h3>
            </div>

            <p className="text-sm text-muted-foreground">
              After rental - Document car condition when receiving the key back
            </p>

            {/* Message if giving not completed */}
            {!givingCompleted && !isClosed && (
              <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Complete Vehicle Collection first</p>
              </div>
            )}

            {/* Photos */}
            {givingCompleted && (
              <KeyHandoverPhotos
                photos={receivingHandover?.photos || []}
                onUpload={handleUpload("receiving")}
                onDelete={(photo) => deletePhoto.mutate(photo)}
                isUploading={isUploading}
                isDeleting={isDeleting}
                disabled={receivingCompleted || isClosed}
              />
            )}

            {/* Notes */}
            {givingCompleted && (
              <div>
                <label className="text-sm font-medium">Notes (Optional)</label>
                <Textarea
                  placeholder="Condition upon return, damages, fuel level, etc."
                  value={receivingNotes}
                  onChange={(e) => setReceivingNotes(e.target.value)}
                  onBlur={() => {
                    if (receivingNotes !== (receivingHandover?.notes || "")) {
                      updateNotes.mutate({ type: "receiving", notes: receivingNotes });
                    }
                  }}
                  disabled={receivingCompleted || isClosed}
                  className="mt-1"
                  rows={3}
                />
              </div>
            )}

            {/* Handed timestamp */}
            {receivingCompleted && receivingHandover?.handed_at && (
              <p className="text-sm text-muted-foreground">
                Returned on: {new Date(receivingHandover.handed_at).toLocaleString()}
              </p>
            )}

            {/* Key Received Toggle Button */}
            {givingCompleted && !isClosed && (
              <Button
                onClick={() => receivingCompleted ? setConfirmUndo("receiving") : setConfirmHandover("receiving")}
                disabled={isMarkingHanded || isUnmarkingHanded}
                variant={receivingCompleted ? "outline" : "default"}
                className="w-full"
              >
                <Key className="h-4 w-4 mr-2" />
                {isMarkingHanded || isUnmarkingHanded
                  ? "Processing..."
                  : receivingCompleted
                    ? "Undo Return"
                    : "Confirm Return"}
              </Button>
            )}

            {/* Warning if no photos */}
            {!receivingCompleted && givingCompleted && !isClosed && (receivingHandover?.photos?.length || 0) === 0 && (
              <div className="flex items-center gap-2 text-amber-600 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>Consider uploading photos first</span>
              </div>
            )}
          </div>
        </div>

        {/* Confirmation Dialog */}
        <AlertDialog open={!!confirmHandover} onOpenChange={() => setConfirmHandover(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmHandover === "giving"
                  ? "Confirm Vehicle Collection"
                  : "Confirm Vehicle Return"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmHandover === "giving" ? (
                  <>
                    Are you sure you want to mark the vehicle as collected?
                    <br />
                    <span className="text-muted-foreground text-sm">
                      The rental will become active once both this and admin approval are completed.
                    </span>
                  </>
                ) : (
                  <>
                    Are you sure you want to mark the vehicle as returned?
                    <br />
                    <strong>This will close the rental and mark the vehicle as available.</strong>
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmHandover}>
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Undo Confirmation Dialog */}
        <AlertDialog open={!!confirmUndo} onOpenChange={() => setConfirmUndo(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmUndo === "giving"
                  ? "Undo Vehicle Collection"
                  : "Undo Vehicle Return"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmUndo === "giving" ? (
                  <>
                    Are you sure you want to undo the vehicle collection?
                    <br />
                    <span className="text-muted-foreground text-sm">
                      If the rental was active, it will be reverted to pending status.
                    </span>
                  </>
                ) : (
                  "Are you sure you want to undo the vehicle return?"
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmUndo} className="bg-amber-600 hover:bg-amber-700">
                Undo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};
