import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
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
  Mail,
  MessageCircle,
  Phone,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useKeyHandover, HandoverType, MileageSummary } from "@/hooks/use-key-handover";
import { formatCurrency, getDistanceUnitShort } from "@/lib/format-utils";
import type { DistanceUnit } from "@/lib/format-utils";
import { KeyHandoverPhotos } from "@/components/rentals/key-handover-photos";
import { LockboxSendTimeline } from "@/components/rentals/lockbox-send-timeline";
import { LockboxCountdownTicker } from "@/components/rentals/lockbox-countdown-ticker";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { useRentalSettings } from "@/hooks/use-rental-settings";
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
  vehicleId?: string;
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
  vehicleId,
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
    fetchMileageSummary,
    isLoading,
    isUploading,
    isDeleting,
    isMarkingHanded,
    isUnmarkingHanded,
  } = useKeyHandover(rentalId);

  const { tenant } = useTenant();
  const { toast } = useToast();
  const { settings: rentalSettings } = useRentalSettings();

  const [confirmHandover, setConfirmHandover] = useState<HandoverType | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<HandoverType | null>(null);
  const [mileageWarning, setMileageWarning] = useState<HandoverType | null>(null);
  const [mileageSummary, setMileageSummary] = useState<MileageSummary | null>(null);
  const [givingNotes, setGivingNotes] = useState<string>("");
  const [receivingNotes, setReceivingNotes] = useState<string>("");
  const [givingMileage, setGivingMileage] = useState<string>("");
  const [receivingMileage, setReceivingMileage] = useState<string>("");

  // Lockbox delivery method state
  const [deliveryMethodChoice, setDeliveryMethodChoice] = useState<'lockbox' | 'in_person'>(
    savedDeliveryMethod === 'lockbox' ? 'lockbox' : 'in_person'
  );
  const [isSendingLockbox, setIsSendingLockbox] = useState(false);

  // Derive enabled notification methods from tenant settings
  const enabledMethods = rentalSettings?.lockbox_notification_methods || ['email'];
  const emailEnabled = enabledMethods.includes('email');
  const whatsappEnabled = enabledMethods.includes('whatsapp');
  const smsEnabled = enabledMethods.includes('sms');

  // Lockbox code state — pre-fill from vehicle, editable by admin
  const [lockboxCodeInput, setLockboxCodeInput] = useState(vehicleLockboxCode || '');

  useEffect(() => {
    setLockboxCodeInput(vehicleLockboxCode || '');
  }, [vehicleLockboxCode]);

  // Notification method state
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWhatsApp, setSendWhatsApp] = useState(false);
  const [sendSms, setSendSms] = useState(false);
  const [whatsAppPhone, setWhatsAppPhone] = useState(customerPhone || '');
  const [smsPhone, setSmsPhone] = useState(customerPhone || '');
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);

  // Show lockbox option when feature is enabled in tenant settings (not dependent on vehicle having a code)
  const showLockboxOption = !!rentalSettings?.lockbox_enabled;

  // Helper to generate a lockbox code using the tenant's configured length
  const generateLockboxCode = (): string => {
    const length = rentalSettings?.lockbox_code_length || 4;
    const max = Math.pow(10, length);
    return Math.floor(Math.random() * max).toString().padStart(length, '0');
  };

  // Sync local state with server data
  useEffect(() => {
    setGivingNotes(givingHandover?.notes || "");
  }, [givingHandover?.notes]);

  useEffect(() => {
    setReceivingNotes(receivingHandover?.notes || "");
  }, [receivingHandover?.notes]);

  // Pre-fill pickup mileage from handover or vehicle's current odometer
  useEffect(() => {
    if (givingHandover?.mileage) {
      setGivingMileage(givingHandover.mileage.toString());
    } else if (!givingHandover && vehicleId) {
      // Pre-fill from vehicle's current_mileage when no handover recorded yet
      supabase
        .from("vehicles")
        .select("current_mileage")
        .eq("id", vehicleId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.current_mileage && !givingMileage) {
            setGivingMileage(data.current_mileage.toString());
          }
        });
    }
  }, [givingHandover?.mileage, vehicleId]);

  useEffect(() => {
    setReceivingMileage(receivingHandover?.mileage?.toString() || "");
  }, [receivingHandover?.mileage]);

  const isClosed = rentalStatus === "Closed" || rentalStatus === "Completed";
  const isActive = rentalStatus === "Active";
  const returnEnabled = isActive || isClosed; // Only allow return when rental is active (or already closed for viewing)

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

    // Track the resolved lockbox code — use admin input, fallback to vehicle, then auto-generate
    let resolvedLockboxCode = lockboxCodeInput || vehicleLockboxCode;

    // If giving handover with lockbox delivery method, send notification and save delivery_method
    if (confirmHandover === "giving" && showLockboxOption && deliveryMethodChoice === "lockbox") {
      setIsSendingLockbox(true);
      try {
        // Use admin-entered code, or auto-generate as last resort
        let lockboxCode = resolvedLockboxCode;
        if (!lockboxCode && vehicleId) {
          lockboxCode = generateLockboxCode();
          resolvedLockboxCode = lockboxCode;
          setLockboxCodeInput(lockboxCode);
        }
        // Always save the code to the vehicle record
        if (lockboxCode && vehicleId) {
          const { error: vehicleUpdateError } = await supabase
            .from("vehicles")
            .update({ lockbox_code: lockboxCode })
            .eq("id", vehicleId);

          if (vehicleUpdateError) {
            console.error("Failed to save auto-generated lockbox code:", vehicleUpdateError);
            toast({
              title: "Error",
              description: "Failed to generate lockbox code. Please try again.",
              variant: "destructive",
            });
            setIsSendingLockbox(false);
            setConfirmHandover(null);
            return;
          }
        }

        // Save delivery_method on the rental
        await supabase
          .from("rentals")
          .update({ delivery_method: 'lockbox' })
          .eq("id", rentalId);

        // Send lockbox notification
        const photoUrls = (givingHandover?.photos || []).map((p) => p.file_url);
        const { error } = await supabase.functions.invoke("notify-lockbox-code", {
          body: {
            customerName,
            customerEmail,
            customerPhone: sendSms ? (smsPhone || customerPhone) : customerPhone,
            vehicleName,
            vehicleReg,
            lockboxCode,
            lockboxInstructions: vehicleLockboxInstructions || '',
            deliveryAddress: deliveryAddress || '',
            bookingRef,
            tenantId: tenant?.id,
            odometerReading: givingMileage || null,
            notes: givingNotes || null,
            photoUrls,
            defaultInstructions: rentalSettings?.lockbox_default_instructions || null,
            sendEmail,
            sendSms,
          },
        });

        if (error) {
          console.error("Failed to send lockbox notification:", error);
          // Log failure
          await supabase.from("lockbox_send_log").insert({
            rental_id: rentalId,
            tenant_id: tenant?.id,
            event_type: "failed",
            channel: "email",
            details: `Manual send failed: ${error.message || "Unknown error"}`,
          } as any);
          toast({
            title: "Warning",
            description: "Lockbox code notification failed to send. You may need to contact the customer manually.",
            variant: "destructive",
          });
        } else {
          // Log successful send and stamp lockbox_sent_at
          await supabase.from("lockbox_send_log").insert({
            rental_id: rentalId,
            tenant_id: tenant?.id,
            event_type: givingHandover?.handed_at ? "resent" : "sent",
            channel: "email",
            sent_by_name: "Admin",
            details: `Lockbox code sent to ${customerEmail || 'customer'} via email`,
          } as any);
          await supabase
            .from("rentals")
            .update({ lockbox_sent_at: new Date().toISOString() })
            .eq("id", rentalId);
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

    // Send WhatsApp notification if selected (applies to ALL collection types)
    if (confirmHandover === "giving" && sendWhatsApp && whatsAppPhone) {
      setIsSendingWhatsApp(true);
      try {
        const photoUrls = (givingHandover?.photos || []).map((p) => p.file_url);
        const { error } = await supabase.functions.invoke("send-collection-whatsapp", {
          body: {
            customerName,
            customerPhone: whatsAppPhone,
            vehicleName,
            vehicleReg,
            bookingRef,
            lockboxCode: resolvedLockboxCode || null,
            lockboxInstructions: vehicleLockboxInstructions || null,
            deliveryAddress: deliveryAddress || null,
            odometerReading: givingMileage || null,
            notes: givingNotes || null,
            photoUrls,
            tenantId: tenant?.id,
            defaultInstructions: rentalSettings?.lockbox_default_instructions || null,
          },
        });

        if (error) {
          console.error("Failed to send WhatsApp notification:", error);
          toast({
            title: "Warning",
            description: "WhatsApp notification failed to send. You may need to contact the customer manually.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "WhatsApp Sent",
            description: `Collection details sent via WhatsApp to ${whatsAppPhone}`,
          });
        }
      } catch (err) {
        console.error("WhatsApp notification error:", err);
      } finally {
        setIsSendingWhatsApp(false);
      }
    }

    // Auto-save mileage if it has a value but hasn't been saved yet
    if (confirmHandover === 'giving' && givingMileage && !givingHandover?.mileage) {
      const mileageVal = parseInt(givingMileage, 10);
      if (!isNaN(mileageVal)) {
        updateMileage.mutate({ type: 'giving', mileage: mileageVal });
      }
    }

    // For receiving: await mileage save (triggers excess calc), then show summary
    if (confirmHandover === 'receiving') {
      if (receivingMileage && !receivingHandover?.mileage) {
        const mileageVal = parseInt(receivingMileage, 10);
        if (!isNaN(mileageVal)) {
          await updateMileage.mutateAsync({ type: 'receiving', mileage: mileageVal });
        }
      }
      await markKeyHanded.mutateAsync(confirmHandover);
      // Fetch and show mileage summary popup
      try {
        const summary = await fetchMileageSummary();
        if (summary) {
          setMileageSummary(summary);
        }
      } catch (err) {
        console.warn('[KEY-HANDOVER] Failed to fetch mileage summary:', err);
      }
    } else {
      markKeyHanded.mutate(confirmHandover);
    }

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
        {/* Lockbox Countdown Ticker — prominent at the top, only for approved/active lockbox rentals */}
        {savedDeliveryMethod === 'lockbox' && ['Approved', 'Active', 'Pending'].includes(rentalStatus) && (
          <div className="mb-6">
            <LockboxCountdownTicker rentalId={rentalId} />
          </div>
        )}

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

            {/* Lockbox Code Input */}
            {showLockboxOption && deliveryMethodChoice === 'lockbox' && !givingCompleted && !isClosed && (
              <div className="p-3 border rounded-lg bg-muted/20 space-y-2">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  Lockbox Code
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    placeholder="Enter lockbox code"
                    value={lockboxCodeInput}
                    onChange={(e) => setLockboxCodeInput(e.target.value)}
                    className="max-w-[200px] text-center text-lg font-mono tracking-widest"
                  />
                  {!lockboxCodeInput && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLockboxCodeInput(generateLockboxCode())}
                    >
                      Auto-generate
                    </Button>
                  )}
                </div>
                {vehicleLockboxCode && lockboxCodeInput === vehicleLockboxCode && (
                  <p className="text-[11px] text-muted-foreground">Pre-filled from vehicle record</p>
                )}
                {!lockboxCodeInput && (
                  <p className="text-[11px] text-muted-foreground">Enter a code or click auto-generate. This will be sent to the customer.</p>
                )}
              </div>
            )}

            {/* Show lockbox code after completion */}
            {showLockboxOption && deliveryMethodChoice === 'lockbox' && givingCompleted && vehicleLockboxCode && (
              <div className="flex items-center gap-2 text-sm p-2 border rounded-md bg-muted/30">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Lockbox code:</span>
                <span className="font-mono font-bold tracking-widest">{vehicleLockboxCode}</span>
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
              <p className="text-xs text-muted-foreground mt-1">
                {!givingHandover?.mileage && givingMileage ? "Pre-filled from vehicle's current odometer. Verify and adjust if needed." : "Record the odometer reading when handing over keys"}
              </p>
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

            {/* Notification Method Selector */}
            {!givingCompleted && !isClosed && (emailEnabled || whatsappEnabled || smsEnabled) && (
              <div className="p-3 border rounded-lg bg-muted/20 space-y-3">
                <Label className="text-sm font-medium">Notify customer on collection</Label>
                <div className="space-y-2">
                  {emailEnabled && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="notify-email"
                        checked={sendEmail}
                        onCheckedChange={(checked) => setSendEmail(!!checked)}
                      />
                      <Label htmlFor="notify-email" className="text-sm cursor-pointer flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5" />
                        Email
                      </Label>
                    </div>
                  )}
                  {smsEnabled && (
                    <div className="flex items-center gap-2 opacity-50">
                      <Checkbox
                        id="notify-sms"
                        checked={false}
                        disabled
                      />
                      <Label htmlFor="notify-sms" className="text-sm cursor-not-allowed flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5" />
                        SMS
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 ml-1">Coming soon</Badge>
                      </Label>
                    </div>
                  )}
                  {whatsappEnabled && (
                    <div className="flex items-center gap-2 opacity-50">
                      <Checkbox
                        id="notify-whatsapp"
                        checked={false}
                        disabled
                      />
                      <Label htmlFor="notify-whatsapp" className="text-sm cursor-not-allowed flex items-center gap-1.5">
                        <MessageCircle className="h-3.5 w-3.5" />
                        WhatsApp
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 ml-1">Coming soon</Badge>
                      </Label>
                    </div>
                  )}
                </div>

                {/* SMS phone input */}
                {sendSms && (
                  <div className="space-y-1.5 pl-6">
                    <Label htmlFor="sms-phone" className="text-xs text-muted-foreground">
                      SMS number
                    </Label>
                    <PhoneInput
                      value={smsPhone}
                      onChange={(val) => setSmsPhone(val)}
                      defaultCountry="US"
                    />
                  </div>
                )}

                {/* WhatsApp phone input */}
                {sendWhatsApp && (
                  <div className="space-y-1.5 pl-6">
                    <Label htmlFor="whatsapp-phone" className="text-xs text-muted-foreground">
                      WhatsApp number
                    </Label>
                    <PhoneInput
                      value={whatsAppPhone}
                      onChange={(val) => setWhatsAppPhone(val)}
                      defaultCountry="US"
                    />
                    <p className="text-xs text-muted-foreground">
                      Please enter the number with WhatsApp on it
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Handed timestamp */}
            {givingCompleted && givingHandover?.handed_at && (
              <p className="text-sm text-muted-foreground">
                Collected on: {new Date(givingHandover.handed_at).toLocaleString()}
              </p>
            )}

            {/* Key Handed Toggle Button — sticky at bottom */}
            {!isClosed && (
              <div className="sticky bottom-0 pt-3 pb-1 bg-inherit space-y-2 border-t mt-2 -mx-4 px-4">
                <Button
                  onClick={() => givingCompleted ? setConfirmUndo("giving") : handleRequestHandover("giving")}
                  disabled={isMarkingHanded || isUnmarkingHanded || isSendingLockbox || isSendingWhatsApp}
                  variant={givingCompleted ? "outline" : "default"}
                  className="w-full"
                >
                  {(isSendingLockbox || isSendingWhatsApp) ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4 mr-2" />
                  )}
                  {isSendingLockbox
                    ? "Sending lockbox code..."
                    : isSendingWhatsApp
                      ? "Sending WhatsApp..."
                      : isMarkingHanded || isUnmarkingHanded
                        ? "Processing..."
                        : givingCompleted
                          ? "Undo Collection"
                          : showLockboxOption && deliveryMethodChoice === 'lockbox'
                            ? "Confirm Collection & Send Code"
                            : "Confirm Collection"}
                </Button>

                {/* Warning if no photos */}
                {!givingCompleted && (givingHandover?.photos?.length || 0) === 0 && (
                  <div className="flex items-center gap-2 text-amber-600 text-sm">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>Consider uploading photos first</span>
                  </div>
                )}
              </div>
            )}
            {/* Lockbox Send Log Timeline */}
            {(savedDeliveryMethod === 'lockbox' || deliveryMethodChoice === 'lockbox') && (
              <LockboxSendTimeline rentalId={rentalId} />
            )}
          </div>

          {/* Vehicle Return Section */}
          <div className={`space-y-4 p-4 border rounded-lg ${!returnEnabled || !givingCompleted ? 'bg-muted/50 opacity-60' : 'bg-muted/20'}`}>
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Vehicle Return</h3>
            </div>

            <p className="text-sm text-muted-foreground">
              After rental - Document car condition when receiving the key back
            </p>

            {/* Message if rental not active */}
            {!returnEnabled && !isClosed && (
              <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Rental must be active before vehicle can be returned</p>
              </div>
            )}

            {/* Message if giving not completed */}
            {returnEnabled && !givingCompleted && !isClosed && (
              <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Complete Vehicle Collection first</p>
              </div>
            )}

            {/* Photos */}
            {returnEnabled && givingCompleted && (
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
            {returnEnabled && givingCompleted && (
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
                {receivingMileage && givingMileage && parseInt(receivingMileage, 10) < parseInt(givingMileage, 10) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-1.5 mt-1.5">
                    Return odometer ({parseInt(receivingMileage, 10).toLocaleString()}) is lower than pickup ({parseInt(givingMileage, 10).toLocaleString()}). Please verify the reading.
                  </p>
                )}
              </div>
            )}

            {/* Notes */}
            {returnEnabled && givingCompleted && (
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

            {/* Key Received Toggle Button — sticky at bottom */}
            {returnEnabled && givingCompleted && !isClosed && (
              <div className="sticky bottom-0 pt-3 pb-1 bg-inherit space-y-2 border-t mt-2 -mx-4 px-4">
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

                {/* Warning if no photos */}
                {!receivingCompleted && (receivingHandover?.photos?.length || 0) === 0 && (
                  <div className="flex items-center gap-2 text-amber-600 text-sm">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>Consider uploading photos first</span>
                  </div>
                )}
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
                    {sendSms && smsPhone && (
                      <>
                        <br /><br />
                        <span className="flex items-center gap-1.5 text-blue-600 font-medium">
                          <Phone className="h-3.5 w-3.5" />
                          An SMS with collection details will be sent to {smsPhone}.
                        </span>
                      </>
                    )}
                    {sendWhatsApp && whatsAppPhone && (
                      <>
                        <br /><br />
                        <span className="flex items-center gap-1.5 text-green-600 font-medium">
                          <MessageCircle className="h-3.5 w-3.5" />
                          A WhatsApp message with collection details will be sent to {whatsAppPhone}.
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

        {/* Mileage Summary Dialog — shown after vehicle return */}
        <AlertDialog open={!!mileageSummary} onOpenChange={() => setMileageSummary(null)}>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-primary" />
                Mileage Summary
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-4 pt-2">
                  {mileageSummary && (() => {
                    const distUnit = (tenant?.distance_unit || 'miles') as DistanceUnit;
                    const unitShort = getDistanceUnitShort(distUnit);
                    const unitSingular = distUnit === 'miles' ? 'mile' : 'km';
                    const currCode = tenant?.currency_code || 'GBP';
                    const s = mileageSummary;

                    return (
                      <>
                        {/* Odometer readings */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3 bg-muted/50 rounded-lg text-center">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">At Pickup</p>
                            <p className="text-lg font-semibold text-foreground">{s.pickupMileage.toLocaleString()} {unitShort}</p>
                          </div>
                          <div className="p-3 bg-muted/50 rounded-lg text-center">
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">At Return</p>
                            <p className="text-lg font-semibold text-foreground">{s.returnMileage.toLocaleString()} {unitShort}</p>
                          </div>
                        </div>

                        {/* Miles driven */}
                        <div className="p-3 bg-primary/5 rounded-lg text-center border border-primary/10">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total {distUnit === 'miles' ? 'Miles' : 'Km'} Driven</p>
                          <p className="text-2xl font-bold text-primary">{s.milesDriven.toLocaleString()} {unitShort}</p>
                        </div>

                        {/* Allowance & excess */}
                        {s.isUnlimited ? (
                          <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
                            <p className="text-sm font-medium text-green-700 dark:text-green-400 text-center">
                              Unlimited mileage — no excess charge
                            </p>
                          </div>
                        ) : s.allowedMileage !== null ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Allowed ({s.tier} tier)</span>
                              <span className="font-medium text-foreground">{s.allowedMileage.toLocaleString()} {unitShort}</span>
                            </div>
                            {s.excessMiles > 0 ? (
                              <>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-destructive font-medium">Excess</span>
                                  <span className="font-semibold text-destructive">+{s.excessMiles.toLocaleString()} {unitShort}</span>
                                </div>
                                {s.excessRate != null && s.chargeAmount != null && (
                                  <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-900 mt-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm text-muted-foreground">
                                        {s.excessMiles.toLocaleString()} {unitShort} x {formatCurrency(s.excessRate, currCode)}/{unitSingular}
                                      </span>
                                      <span className="text-lg font-bold text-destructive">
                                        {formatCurrency(s.chargeAmount, currCode)}
                                      </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Excess mileage charge has been added to the rental ledger.
                                    </p>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-900">
                                <p className="text-sm font-medium text-green-700 dark:text-green-400 text-center">
                                  Within allowance — no excess mileage charge
                                </p>
                                <p className="text-xs text-muted-foreground text-center mt-0.5">
                                  {s.milesDriven.toLocaleString()} of {s.allowedMileage.toLocaleString()} {unitShort} used
                                </p>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setMileageSummary(null)}>
                Got it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};
