import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Key,
  KeyRound,
  AlertCircle,
  AlertTriangle,
  Gauge,
  Lock,
  Loader2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyHandover, HandoverType } from "@/hooks/use-key-handover";
import { KeyHandoverPhotos } from "@/components/rentals/key-handover-photos";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
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
  /** Whether to highlight this section as needing action */
  needsAction?: boolean;
  /** Lockbox delivery props */
  isDeliveryRental?: boolean;
  vehicleLockboxCode?: string | null;
  vehicleLockboxInstructions?: string | null;
  deliveryMethod?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerName?: string;
  vehicleName?: string;
  vehicleReg?: string;
  deliveryAddress?: string | null;
  bookingRef?: string;
}

export const KeyHandoverSection = ({
  rentalId,
  rentalStatus,
  needsAction = false,
  isDeliveryRental = false,
  vehicleLockboxCode = null,
  vehicleLockboxInstructions = null,
  deliveryMethod: savedDeliveryMethod = null,
  customerEmail = null,
  customerPhone = null,
  customerName = '',
  vehicleName = '',
  vehicleReg = '',
  deliveryAddress = null,
  bookingRef = '',
}: KeyHandoverSectionProps) => {
  const {
    givingHandover,
    receivingHandover,
    uploadPhoto,
    deletePhoto,
    markKeyHanded,
    unmarkKeyHanded,
    updateNotes,
    updateMileage,
    isLoading,
    isUploading,
    isDeleting,
    isMarkingHanded,
    isUnmarkingHanded,
  } = useKeyHandover(rentalId);

  const { tenant } = useTenant();
  const { toast } = useToast();

  const [confirmHandover, setConfirmHandover] = useState<HandoverType | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<HandoverType | null>(null);
  const [mileageWarning, setMileageWarning] = useState<HandoverType | null>(null);
  const [givingNotes, setGivingNotes] = useState<string>("");
  const [receivingNotes, setReceivingNotes] = useState<string>("");
  const [givingMileage, setGivingMileage] = useState<string>("");
  const [receivingMileage, setReceivingMileage] = useState<string>("");

  // Lockbox delivery method state
  const [deliveryMethodChoice, setDeliveryMethodChoice] = useState<'lockbox' | 'in_person'>(
    savedDeliveryMethod === 'lockbox' ? 'lockbox' : 'in_person'
  );
  const [isSendingLockbox, setIsSendingLockbox] = useState(false);

  const showLockboxOption = isDeliveryRental && !!vehicleLockboxCode;
  const showNoLockboxWarning = isDeliveryRental && !vehicleLockboxCode && tenant?.lockbox_enabled;

  // Sync local state with server data
  useEffect(() => {
    setGivingNotes(givingHandover?.notes || "");
  }, [givingHandover?.notes]);

  useEffect(() => {
    setReceivingNotes(receivingHandover?.notes || "");
  }, [receivingHandover?.notes]);

  useEffect(() => {
    setGivingMileage(givingHandover?.mileage?.toString() || "");
  }, [givingHandover?.mileage]);

  useEffect(() => {
    setReceivingMileage(receivingHandover?.mileage?.toString() || "");
  }, [receivingHandover?.mileage]);

  const isClosed = rentalStatus === "Closed" || rentalStatus === "Completed";

  const givingCompleted = !!givingHandover?.handed_at;
  const receivingCompleted = !!receivingHandover?.handed_at;

  const handleUpload = (type: HandoverType) => (file: File) => {
    uploadPhoto.mutate({ type, file });
  };

  const handleRequestHandover = (type: HandoverType) => {
    const mileage = type === "giving" ? givingMileage : receivingMileage;
    if (!mileage || !mileage.trim()) {
      setMileageWarning(type);
    } else {
      setConfirmHandover(type);
    }
  };

  const handleConfirmHandover = async () => {
    if (!confirmHandover) return;

    // If giving handover with lockbox delivery method, send notification and save delivery_method
    if (confirmHandover === "giving" && showLockboxOption && deliveryMethodChoice === "lockbox") {
      setIsSendingLockbox(true);
      try {
        // Save delivery_method on the rental
        await supabase
          .from("rentals")
          .update({ delivery_method: 'lockbox' })
          .eq("id", rentalId);

        // Send lockbox notification
        const { error } = await supabase.functions.invoke("notify-lockbox-code", {
          body: {
            customerName,
            customerEmail,
            customerPhone,
            vehicleName,
            vehicleReg,
            lockboxCode: vehicleLockboxCode,
            lockboxInstructions: vehicleLockboxInstructions || '',
            deliveryAddress: deliveryAddress || '',
            bookingRef,
            tenantId: tenant?.id,
          },
        });

        if (error) {
          console.error("Failed to send lockbox notification:", error);
          toast({
            title: "Warning",
            description: "Lockbox code notification failed to send. You may need to contact the customer manually.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Lockbox Code Sent",
            description: `Lockbox code sent to ${customerEmail || 'customer'}`,
          });
        }
      } catch (err) {
        console.error("Lockbox notification error:", err);
      } finally {
        setIsSendingLockbox(false);
      }
    } else if (confirmHandover === "giving" && isDeliveryRental) {
      // In-person delivery — save delivery_method
      await supabase
        .from("rentals")
        .update({ delivery_method: 'in_person' })
        .eq("id", rentalId);
    }

    markKeyHanded.mutate(confirmHandover);
    setConfirmHandover(null);
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
    <Card
      id="key-handover-section"
      className={cn(
        "transition-all duration-300",
        needsAction && "border-amber-500 border-2 shadow-lg shadow-amber-100 dark:shadow-amber-900/20"
      )}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Key className={cn("h-5 w-5", needsAction ? "text-amber-600" : "text-primary")} />
            Key Handover
          </CardTitle>
          {needsAction && (
            <Badge variant="outline" className="border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Action Required
            </Badge>
          )}
        </div>
        <CardDescription>
          {needsAction
            ? "Complete the vehicle collection to activate this rental"
            : "Document car condition before giving and after receiving keys"
          }
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

            {/* Delivery Method Choice — only for delivery rentals with lockbox available */}
            {showLockboxOption && !givingCompleted && !isClosed && (
              <div className="p-3 border rounded-lg bg-primary/5 space-y-3">
                <Label className="text-sm font-medium">How are the keys being handed over?</Label>
                <RadioGroup
                  value={deliveryMethodChoice}
                  onValueChange={(v) => setDeliveryMethodChoice(v as 'lockbox' | 'in_person')}
                  className="space-y-2"
                >
                  <div className={cn(
                    "flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors",
                    deliveryMethodChoice === 'lockbox' ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50"
                  )}>
                    <RadioGroupItem value="lockbox" id="method-lockbox" />
                    <Label htmlFor="method-lockbox" className="flex items-center gap-2 cursor-pointer flex-1">
                      <Lock className="h-4 w-4 text-primary" />
                      <div>
                        <span className="text-sm font-medium">Lockbox</span>
                        <p className="text-xs text-muted-foreground">Keys placed in lockbox — code will be sent to customer</p>
                      </div>
                    </Label>
                  </div>
                  <div className={cn(
                    "flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors",
                    deliveryMethodChoice === 'in_person' ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/50"
                  )}>
                    <RadioGroupItem value="in_person" id="method-inperson" />
                    <Label htmlFor="method-inperson" className="flex items-center gap-2 cursor-pointer flex-1">
                      <User className="h-4 w-4 text-primary" />
                      <div>
                        <span className="text-sm font-medium">In-person handoff</span>
                        <p className="text-xs text-muted-foreground">Keys handed directly to the customer</p>
                      </div>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Warning if delivery rental but no lockbox code on vehicle */}
            {showNoLockboxWarning && !givingCompleted && !isClosed && (
              <div className="flex items-center gap-2 text-muted-foreground text-xs p-2 border rounded-md bg-muted/30">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span>This vehicle has no lockbox code configured. Only in-person handoff is available.</span>
              </div>
            )}

            {/* Show which delivery method was used (after completion) */}
            {givingCompleted && savedDeliveryMethod && (
              <div className="flex items-center gap-2 text-sm">
                {savedDeliveryMethod === 'lockbox' ? (
                  <Badge variant="outline" className="border-primary/30 bg-primary/5">
                    <Lock className="h-3 w-3 mr-1" />
                    Lockbox
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    <User className="h-3 w-3 mr-1" />
                    In-person
                  </Badge>
                )}
              </div>
            )}

            {/* Photos */}
            <KeyHandoverPhotos
              photos={givingHandover?.photos || []}
              onUpload={handleUpload("giving")}
              onDelete={(photo) => deletePhoto.mutate(photo)}
              isUploading={isUploading}
              isDeleting={isDeleting}
              disabled={givingCompleted || isClosed}
            />

            {/* Mileage Input */}
            <div>
              <Label htmlFor="giving-mileage" className="text-sm font-medium flex items-center gap-2">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                Odometer Reading
              </Label>
              <Input
                id="giving-mileage"
                type="number"
                placeholder="Enter mileage at pickup"
                value={givingMileage}
                onChange={(e) => setGivingMileage(e.target.value)}
                onBlur={() => {
                  const mileageValue = givingMileage ? parseInt(givingMileage, 10) : null;
                  const serverValue = givingHandover?.mileage ?? null;
                  if (mileageValue !== serverValue) {
                    updateMileage.mutate({ type: "giving", mileage: mileageValue });
                  }
                }}
                disabled={givingCompleted || isClosed}
                className="mt-1"
                min={0}
              />
              <p className="text-xs text-muted-foreground mt-1">Record the odometer reading when handing over keys</p>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-sm font-medium">Notes (Optional)</Label>
              <Textarea
                placeholder="Fuel level, damages, condition notes, etc."
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
                onClick={() => givingCompleted ? setConfirmUndo("giving") : handleRequestHandover("giving")}
                disabled={isMarkingHanded || isUnmarkingHanded || isSendingLockbox}
                variant={givingCompleted ? "outline" : "default"}
                className="w-full"
              >
                {isSendingLockbox ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4 mr-2" />
                )}
                {isSendingLockbox
                  ? "Sending lockbox code..."
                  : isMarkingHanded || isUnmarkingHanded
                    ? "Processing..."
                    : givingCompleted
                      ? "Undo Collection"
                      : showLockboxOption && deliveryMethodChoice === 'lockbox'
                        ? "Confirm Collection & Send Code"
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

            {/* Mileage Input */}
            {givingCompleted && (
              <div>
                <Label htmlFor="receiving-mileage" className="text-sm font-medium flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                  Odometer Reading
                </Label>
                <Input
                  id="receiving-mileage"
                  type="number"
                  placeholder="Enter mileage at return"
                  value={receivingMileage}
                  onChange={(e) => setReceivingMileage(e.target.value)}
                  onBlur={() => {
                    const mileageValue = receivingMileage ? parseInt(receivingMileage, 10) : null;
                    const serverValue = receivingHandover?.mileage ?? null;
                    if (mileageValue !== serverValue) {
                      updateMileage.mutate({ type: "receiving", mileage: mileageValue });
                    }
                  }}
                  disabled={receivingCompleted || isClosed}
                  className="mt-1"
                  min={0}
                />
                <p className="text-xs text-muted-foreground mt-1">Record the odometer reading when receiving keys back</p>
              </div>
            )}

            {/* Notes */}
            {givingCompleted && (
              <div>
                <Label className="text-sm font-medium">Notes (Optional)</Label>
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
                onClick={() => receivingCompleted ? setConfirmUndo("receiving") : handleRequestHandover("receiving")}
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
                    {showLockboxOption && deliveryMethodChoice === "lockbox" && (
                      <>
                        <br /><br />
                        <span className="flex items-center gap-1.5 text-primary font-medium">
                          <Lock className="h-3.5 w-3.5" />
                          The lockbox code will be sent to the customer via {customerEmail ? 'email' : 'notification'}.
                        </span>
                      </>
                    )}
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

        {/* Missing Odometer Warning Dialog */}
        <AlertDialog open={!!mileageWarning} onOpenChange={() => setMileageWarning(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                No Odometer Reading
              </AlertDialogTitle>
              <AlertDialogDescription>
                You haven&apos;t entered an odometer reading for the vehicle {mileageWarning === "giving" ? "collection" : "return"}.
                Recording mileage helps track vehicle usage and resolve disputes.
                <br /><br />
                Are you sure you want to continue without adding the odometer reading?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Go Back & Add Reading</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const type = mileageWarning;
                  setMileageWarning(null);
                  if (type) setConfirmHandover(type);
                }}
                className="bg-amber-600 hover:bg-amber-700"
              >
                Continue Without Reading
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
