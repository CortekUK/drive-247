'use client';

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import {
  Loader2,
  AlertTriangle,
  Calendar as CalendarIcon,
  Mail,
  Eye,
  ChevronRight,
  ChevronLeft,
  XCircle
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface RejectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
    customer?: {
      id?: string;
      name?: string;
      email?: string;
    };
    vehicle?: {
      id?: string;
      make?: string;
      model?: string;
      reg?: string;
    };
    monthly_amount?: number;
    start_date?: string;
    end_date?: string;
  };
  payment?: {
    id: string;
    amount?: number;
    stripe_payment_intent_id?: string;
    capture_status?: string;
  };
}

export default function RejectionDialog({
  open,
  onOpenChange,
  rental,
  payment,
}: RejectionDialogProps) {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const [activeTab, setActiveTab] = useState("reason");
  const [rejectionReason, setRejectionReason] = useState("");
  const [refundTiming, setRefundTiming] = useState<"now" | "scheduled" | "manual">("now");
  const [scheduledDate, setScheduledDate] = useState<Date>();
  const [manualRefundConfirmed, setManualRefundConfirmed] = useState(false);
  const [manualPaymentIntentId, setManualPaymentIntentId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [renderedEmail, setRenderedEmail] = useState<{ subject: string; html: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [renderingEmail, setRenderingEmail] = useState(false);

  const isPaymentCaptured = payment?.capture_status === 'captured';
  const isPreAuth = payment?.capture_status === 'requires_capture';
  const hasStripePaymentIntent = !!payment?.stripe_payment_intent_id;
  const canProcessStripeRefund = isPaymentCaptured && hasStripePaymentIntent;
  const showRefundTab = isPaymentCaptured && !isPreAuth; // Show refund tab for any captured payment
  const refundAmount = payment?.amount || 0;

  // Fetch rejection email templates for this tenant
  const { data: templates } = useQuery({
    queryKey: ['email-templates', 'rejection', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];

      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('category', 'rejection')
        .eq('is_active', true)
        .eq('tenant_id', tenant.id)
        .order('name', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: open && !!tenant?.id,
  });

  // Auto-select first template when templates load
  useEffect(() => {
    if (templates && templates.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  // Clear rendered email when leaving preview tab (ensures fresh render on return)
  useEffect(() => {
    if (activeTab !== 'preview') {
      setRenderedEmail(null);
    }
  }, [activeTab]);

  // Render email preview when entering preview tab or when dependencies change
  useEffect(() => {
    if (activeTab === 'preview' && selectedTemplateId) {
      renderEmailPreview();
    }
  }, [activeTab, selectedTemplateId, rejectionReason]);

  const renderEmailPreview = async () => {
    if (!selectedTemplateId) return;

    setRenderingEmail(true);
    try {
      const template = templates?.find(t => t.id === selectedTemplateId);
      if (!template) return;

      const variables = {
        customerName: rental.customer?.name || 'Customer',
        bookingRef: rental.id.substring(0, 8).toUpperCase(),
        rejectionReason: rejectionReason || 'We were unable to verify all required information.',
        refundAmount: refundAmount.toFixed(2),
        vehicleName: `${rental.vehicle?.make} ${rental.vehicle?.model}` || 'Vehicle',
        pickupDate: rental.start_date ? format(new Date(rental.start_date), 'MMMM dd, yyyy') : 'N/A',
        returnDate: rental.end_date ? format(new Date(rental.end_date), 'MMMM dd, yyyy') : 'N/A',
        totalAmount: rental.monthly_amount?.toFixed(2) || '0.00',
      };

      const { data, error } = await supabase.functions.invoke('render-email-template', {
        body: {
          templateBody: template.body,
          templateSubject: template.subject,
          variables,
        }
      });

      if (error) throw error;

      setRenderedEmail({
        subject: data.subject,
        html: data.html,
      });
    } catch (error: any) {
      console.error('Email render error:', error);
      toast({
        title: "Preview Error",
        description: "Failed to render email preview",
        variant: "destructive",
      });
    } finally {
      setRenderingEmail(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedTemplateId) {
      toast({
        title: "Validation Error",
        description: "Please select an email template",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Step 1: Handle payment/refund
      if (isPreAuth) {
        // Cancel pre-authorization
        const { error: cancelError } = await supabase.functions.invoke('cancel-booking-preauth', {
          body: {
            paymentId: payment?.id,
            tenantId: tenant?.id,
            reason: rejectionReason || 'Booking rejected by admin',
          }
        });

        if (cancelError) throw cancelError;
      } else if ((canProcessStripeRefund || manualPaymentIntentId.startsWith('pi_')) && refundAmount > 0 && refundTiming === 'now') {
        // Process Stripe refund - either from existing payment intent or manually entered one
        const paymentIntentId = hasStripePaymentIntent ? payment?.stripe_payment_intent_id : manualPaymentIntentId;

        // If using manual payment intent, first save it to the payment record
        if (!hasStripePaymentIntent && manualPaymentIntentId && payment?.id) {
          await supabase
            .from('payments')
            .update({
              stripe_payment_intent_id: manualPaymentIntentId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', payment.id);
        }

        // Process immediate refund
        const { data: refundData, error: refundError } = await supabase.functions.invoke('process-scheduled-refund', {
          body: {
            paymentId: payment?.id,
            paymentIntentId: paymentIntentId, // Pass the payment intent directly
            amount: refundAmount,
            reason: rejectionReason || 'Booking rejected by admin',
            tenantId: tenant?.id,
          }
        });

        if (refundError) throw refundError;
        if (refundData && !refundData.success) throw new Error(refundData.error || 'Refund failed');
      } else if (canProcessStripeRefund && refundAmount > 0 && refundTiming === 'scheduled' && scheduledDate) {
        // Schedule refund via schedule-refund function
        const { error: scheduleError } = await supabase.functions.invoke('schedule-refund', {
          body: {
            paymentId: payment?.id,
            refundAmount,
            scheduledDate: scheduledDate.toISOString(),
            reason: rejectionReason || 'Booking rejected by admin',
            tenantId: tenant?.id,
          }
        });

        if (scheduleError) throw scheduleError;
      } else if (isPaymentCaptured && !hasStripePaymentIntent && refundTiming === 'manual') {
        // Payment captured but no Stripe payment intent - mark as pending manual refund
        console.log('Payment captured without Stripe payment intent - marked for manual refund');
        if (payment?.id) {
          await supabase
            .from('payments')
            .update({
              refund_status: 'pending_manual',
              refund_reason: rejectionReason || 'Booking rejected - manual refund required',
              refund_amount: refundAmount,
              updated_at: new Date().toISOString(),
            })
            .eq('id', payment.id);
        }
      }

      // Step 2: Update rental status - using new status fields
      // approval_status -> rejected, status -> Cancelled, payment_status -> refunded (if applicable)
      const rentalUpdateData: any = {
        status: 'Cancelled',
        approval_status: 'rejected',
        cancellation_reason: rejectionReason || 'rejected_by_admin',
        updated_at: new Date().toISOString(),
      };

      // Set payment_status based on refund action
      if (isPaymentCaptured && refundAmount > 0) {
        rentalUpdateData.payment_status = 'refunded';
      } else if (isPreAuth) {
        // Pre-auth was released, not a refund
        rentalUpdateData.payment_status = 'refunded';
      }

      let rentalQuery = supabase
        .from('rentals')
        .update(rentalUpdateData)
        .eq('id', rental.id);

      if (tenant?.id) {
        rentalQuery = rentalQuery.eq('tenant_id', tenant.id);
      }

      const { error: rentalError } = await rentalQuery;

      if (rentalError) throw rentalError;

      // Step 3: Mark vehicle as available
      if (rental.vehicle?.id) {
        let vehicleQuery = supabase
          .from('vehicles')
          .update({ status: 'Available' })
          .eq('id', rental.vehicle.id);

        if (tenant?.id) {
          vehicleQuery = vehicleQuery.eq('tenant_id', tenant.id);
        }

        await vehicleQuery;
      }

      // Step 4: Send rejection email (use already-rendered email from preview)
      if (rental.customer?.email && renderedEmail) {
        await supabase.functions.invoke('notify-booking-rejected', {
          body: {
            customerEmail: rental.customer.email,
            customerName: rental.customer.name,
            vehicleName: `${rental.vehicle?.make} ${rental.vehicle?.model}`,
            bookingRef: rental.id.substring(0, 8).toUpperCase(),
            rejectionReason: rejectionReason || 'We were unable to verify all required information.',
            refundAmount: refundAmount,
            emailSubject: renderedEmail.subject,
            emailBody: renderedEmail.html,
            tenantId: tenant?.id,
          }
        }).catch(err => {
          console.warn('Failed to send rejection email:', err);
        });
      }

      // Success!
      let successDescription = 'Booking has been rejected.';
      if (refundTiming === 'scheduled') {
        successDescription = 'Booking has been rejected and refund scheduled.';
      } else if (refundTiming === 'manual') {
        successDescription = 'Booking has been rejected. Manual refund of $' + refundAmount.toLocaleString() + ' is pending.';
      } else if (canProcessStripeRefund && refundTiming === 'now') {
        successDescription = 'Booking has been rejected and refund processed.';
      }

      toast({
        title: "Booking Rejected",
        description: successDescription,
      });

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
      queryClient.invalidateQueries({ queryKey: ['rental', rental.id] });

      // Close dialog and reset
      handleClose();
    } catch (error: any) {
      console.error('Rejection error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to reject booking",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setActiveTab("reason");
    setRejectionReason("");
    setRefundTiming("now");
    setScheduledDate(undefined);
    setManualRefundConfirmed(false);
    setManualPaymentIntentId("");
    setSelectedTemplateId("");
    setRenderedEmail(null);
    onOpenChange(false);
  };

  const canProceedToNextTab = () => {
    if (activeTab === "reason") return true; // Reason is optional
    if (activeTab === "refund") {
      if (refundTiming === "scheduled" && !scheduledDate) return false;
      if (refundTiming === "manual" && !manualRefundConfirmed) return false;
      // For non-Stripe payments wanting automatic refund, require payment intent ID
      if (!hasStripePaymentIntent && refundTiming === "now" && !manualPaymentIntentId.startsWith("pi_")) return false;
      return true;
    }
    if (activeTab === "template") return !!selectedTemplateId;
    return true;
  };

  const goToNextTab = () => {
    if (activeTab === "reason") {
      if (showRefundTab) {
        setActiveTab("refund");
      } else {
        setActiveTab("template");
      }
    } else if (activeTab === "refund") {
      setActiveTab("template");
    } else if (activeTab === "template") {
      setActiveTab("preview");
    }
  };

  const goToPreviousTab = () => {
    if (activeTab === "preview") {
      setActiveTab("template");
    } else if (activeTab === "template") {
      if (showRefundTab) {
        setActiveTab("refund");
      } else {
        setActiveTab("reason");
      }
    } else if (activeTab === "refund") {
      setActiveTab("reason");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <XCircle className="h-5 w-5" />
            Reject Booking
          </DialogTitle>
          <DialogDescription>
            Reject booking for {rental.customer?.name || "Customer"} - {rental.vehicle?.make} {rental.vehicle?.model}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="reason" className="text-xs">
              1. Reason
            </TabsTrigger>
            <TabsTrigger
              value="refund"
              disabled={!showRefundTab}
              className="text-xs"
            >
              2. Refund
            </TabsTrigger>
            <TabsTrigger value="template" className="text-xs">
              3. Email
            </TabsTrigger>
            <TabsTrigger value="preview" className="text-xs">
              4. Preview
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Rejection Reason */}
          <TabsContent value="reason" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Rejection Reason (Optional)</Label>
              <Textarea
                id="reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Provide a reason for rejecting this booking (optional). This will be included in the email to the customer."
                rows={5}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                If left blank, a default message will be used in the email.
              </p>
            </div>

            {/* Payment Status Info */}
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {isPreAuth ? (
                  <p>
                    This booking has a <strong>pre-authorized payment</strong> of <strong>${refundAmount.toLocaleString()}</strong>.
                    The hold will be released automatically when you reject this booking.
                  </p>
                ) : isPaymentCaptured ? (
                  <p>
                    This booking has a <strong>captured payment</strong> of <strong>${refundAmount.toLocaleString()}</strong>.
                    You'll configure the refund in the next step.
                  </p>
                ) : (
                  <p>
                    This booking has <strong>no payment captured</strong>. You can proceed directly to email selection.
                  </p>
                )}
              </AlertDescription>
            </Alert>
          </TabsContent>

          {/* Tab 2: Refund Timing */}
          <TabsContent value="refund" className="space-y-4 py-4">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">Refund Configuration</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Refund amount: <strong>${refundAmount.toLocaleString()}</strong>
                </p>
              </div>

              {canProcessStripeRefund ? (
                /* Stripe-linked payment - show automatic refund options */
                <>
                  <RadioGroup
                    value={refundTiming}
                    onValueChange={(value) => setRefundTiming(value as "now" | "scheduled" | "manual")}
                  >
                    <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                      <RadioGroupItem value="now" id="now" />
                      <Label htmlFor="now" className="cursor-pointer flex-1">
                        <div className="font-medium">Refund Now</div>
                        <div className="text-sm text-muted-foreground">
                          Process the refund immediately via Stripe
                        </div>
                      </Label>
                    </div>

                    <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                      <RadioGroupItem value="scheduled" id="scheduled" />
                      <Label htmlFor="scheduled" className="cursor-pointer flex-1">
                        <div className="font-medium">Schedule Refund</div>
                        <div className="text-sm text-muted-foreground">
                          Schedule the refund for a future date
                        </div>
                      </Label>
                    </div>
                  </RadioGroup>

                  {refundTiming === "scheduled" && (
                    <div className="space-y-2 pl-6">
                      <Label>Refund Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !scheduledDate && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {scheduledDate ? format(scheduledDate, "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={scheduledDate}
                            onSelect={setScheduledDate}
                            disabled={(date) => date < new Date()}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      {!scheduledDate && (
                        <p className="text-xs text-red-500">
                          Please select a refund date to continue
                        </p>
                      )}
                    </div>
                  )}

                  <Alert>
                    <AlertDescription className="text-sm">
                      {refundTiming === "now" ? (
                        <p>The refund will be processed immediately and typically appears in the customer's account within 5-10 business days.</p>
                      ) : (
                        <p>The refund will be scheduled and processed automatically on the selected date.</p>
                      )}
                    </AlertDescription>
                  </Alert>
                </>
              ) : (
                /* Non-Stripe payment - need to link payment intent */
                <>
                  <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/30">
                    <AlertTriangle className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-800 dark:text-blue-200">
                      <p className="font-medium mb-1">Link Stripe Payment for Automatic Refund</p>
                      <p className="text-sm">
                        This payment record is not linked to Stripe. To process an automatic refund,
                        enter the Payment Intent ID from your Stripe Dashboard.
                      </p>
                    </AlertDescription>
                  </Alert>

                  <RadioGroup
                    value={refundTiming}
                    onValueChange={(value) => {
                      setRefundTiming(value as "now" | "scheduled" | "manual");
                      if (value !== "manual") setManualRefundConfirmed(false);
                    }}
                  >
                    <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                      <RadioGroupItem value="now" id="link-refund" />
                      <Label htmlFor="link-refund" className="cursor-pointer flex-1">
                        <div className="font-medium">Refund via Stripe</div>
                        <div className="text-sm text-muted-foreground">
                          Enter the Payment Intent ID from Stripe to process automatic refund
                        </div>
                      </Label>
                    </div>

                    <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                      <RadioGroupItem value="manual" id="manual" />
                      <Label htmlFor="manual" className="cursor-pointer flex-1">
                        <div className="font-medium">I will process the refund manually</div>
                        <div className="text-sm text-muted-foreground">
                          Handle the refund outside this system (bank transfer, cash, etc.)
                        </div>
                      </Label>
                    </div>
                  </RadioGroup>

                  {refundTiming === "now" && (
                    <div className="space-y-3 pl-6 border-l-2 border-blue-400 ml-2">
                      <div className="space-y-2">
                        <Label htmlFor="payment-intent-id">Stripe Payment Intent ID</Label>
                        <Input
                          id="payment-intent-id"
                          value={manualPaymentIntentId}
                          onChange={(e) => setManualPaymentIntentId(e.target.value.trim())}
                          placeholder="pi_xxxxxxxxxxxxxxxx"
                          className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          Find this in Stripe Dashboard → Payments → Click on the payment → Copy the Payment Intent ID (starts with "pi_")
                        </p>
                      </div>
                      {manualPaymentIntentId && !manualPaymentIntentId.startsWith("pi_") && (
                        <p className="text-xs text-red-500">
                          Payment Intent ID must start with "pi_"
                        </p>
                      )}
                      {manualPaymentIntentId.startsWith("pi_") && (
                        <Alert className="border-green-200 bg-green-50 dark:bg-green-950/30">
                          <AlertDescription className="text-green-800 dark:text-green-200 text-sm">
                            Refund of <strong>${refundAmount.toLocaleString()}</strong> will be processed automatically via Stripe.
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}

                  {refundTiming === "manual" && (
                    <div className="space-y-3 pl-6 border-l-2 border-amber-400 ml-2">
                      <div className="flex items-start space-x-3">
                        <Checkbox
                          id="manual-confirm"
                          checked={manualRefundConfirmed}
                          onCheckedChange={(checked) => setManualRefundConfirmed(checked === true)}
                        />
                        <Label htmlFor="manual-confirm" className="text-sm cursor-pointer">
                          I confirm that I will process the refund of <strong>${refundAmount.toLocaleString()}</strong> manually.
                        </Label>
                      </div>
                      {!manualRefundConfirmed && (
                        <p className="text-xs text-red-500">
                          Please confirm to continue
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </TabsContent>

          {/* Tab 3: Email Template Selection */}
          <TabsContent value="template" className="space-y-4 py-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="template">Email Template</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Select a rejection email template to send to the customer
                </p>
                <Select
                  value={selectedTemplateId}
                  onValueChange={setSelectedTemplateId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates?.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedTemplateId && templates && (
                <div className="border rounded-lg p-4 bg-muted/30">
                  <h4 className="font-semibold text-sm mb-2">Template Details</h4>
                  {(() => {
                    const template = templates.find(t => t.id === selectedTemplateId);
                    if (!template) return null;
                    return (
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Name:</span>{' '}
                          <span className="font-medium">{template.name}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Subject:</span>{' '}
                          <span className="font-medium">{template.subject}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Category:</span>{' '}
                          <Badge variant="secondary">{template.category}</Badge>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Show rejection reason preview */}
              {rejectionReason && (
                <div className="border rounded-lg p-4 bg-amber-50 border-amber-200">
                  <h4 className="font-semibold text-sm mb-2 text-amber-800">Rejection Reason (will be included in email)</h4>
                  <p className="text-sm text-amber-900">{rejectionReason}</p>
                </div>
              )}

              <Alert>
                <Mail className="h-4 w-4" />
                <AlertDescription>
                  The email will be sent to <strong>{rental.customer?.email || 'customer email'}</strong>
                  {rejectionReason ? ' with the rejection reason shown above.' : ' with a default rejection message.'}
                </AlertDescription>
              </Alert>
            </div>
          </TabsContent>

          {/* Tab 4: Email Preview */}
          <TabsContent value="preview" className="space-y-4 py-4">
            {renderingEmail ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : renderedEmail ? (
              <div className="space-y-4">
                {/* Show what rejection reason is being used */}
                <div className="border rounded-lg p-3 bg-amber-50 border-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <span className="font-medium text-amber-800">Rejection Reason:</span>{' '}
                      <span className="text-amber-900">
                        {rejectionReason || 'We were unable to verify all required information. (default)'}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-sm text-muted-foreground">Subject Line</Label>
                  <div className="border rounded-lg p-3 bg-muted/30 font-medium">
                    {renderedEmail.subject}
                  </div>
                </div>

                <div>
                  <Label className="text-sm text-muted-foreground mb-2 block">Email Body Preview</Label>
                  <div className="border rounded-lg overflow-hidden">
                    <iframe
                      srcDoc={renderedEmail.html}
                      className="w-full h-[400px] bg-white"
                      title="Email Preview"
                    />
                  </div>
                </div>

                <Alert>
                  <Eye className="h-4 w-4" />
                  <AlertDescription>
                    Review the email carefully before submitting. Once sent, this cannot be undone.
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <p>No preview available. Please go back and select a template.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Footer with Navigation */}
        <DialogFooter className="flex items-center justify-between sm:justify-between border-t pt-4">
          <div className="flex gap-2">
            {activeTab !== "reason" && (
              <Button
                variant="outline"
                onClick={goToPreviousTab}
                disabled={isSubmitting}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>

            {activeTab === "preview" ? (
              <Button
                variant="destructive"
                onClick={handleSubmit}
                disabled={isSubmitting || !selectedTemplateId}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <XCircle className="mr-2 h-4 w-4" />
                    Confirm Rejection
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={goToNextTab}
                disabled={!canProceedToNextTab() || isSubmitting}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
