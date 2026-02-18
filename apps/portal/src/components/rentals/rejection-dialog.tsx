'use client';

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import {
  Loader2,
  AlertTriangle,
  Mail,
  Eye,
  ChevronRight,
  ChevronLeft,
  XCircle,
  CreditCard,
  Banknote,
} from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/format-utils";

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

interface RentalPayment {
  id: string;
  amount: number;
  status: string;
  capture_status?: string;
  stripe_payment_intent_id?: string;
  stripe_checkout_session_id?: string;
  payment_type?: string;
  target_categories?: string[];
  created_at: string;
}

export default function RejectionDialog({
  open,
  onOpenChange,
  rental,
}: RejectionDialogProps) {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const [activeTab, setActiveTab] = useState("reason");
  const [rejectionReason, setRejectionReason] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [renderedEmail, setRenderedEmail] = useState<{ subject: string; html: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [renderingEmail, setRenderingEmail] = useState(false);

  const currencyCode = (tenant as any)?.currency_code || 'GBP';

  // Fetch ALL payments for this rental
  const { data: allPayments, isLoading: loadingPayments } = useQuery({
    queryKey: ["rental-all-payments", rental.id, tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];

      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("rental_id", rental.id)
        .not("status", "in", '("Refunded","Cancelled","Reversed")')
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Error fetching rental payments:", error);
        return [];
      }
      return (data || []) as RentalPayment[];
    },
    enabled: open && !!rental.id && !!tenant?.id,
  });

  const totalRefundAmount = (allPayments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  const capturedPayments = (allPayments || []).filter(p => p.capture_status === 'captured');
  const preAuthPayments = (allPayments || []).filter(p => p.capture_status === 'requires_capture');
  const manualPayments = (allPayments || []).filter(
    p => p.capture_status !== 'captured' && p.capture_status !== 'requires_capture' && (p.amount || 0) > 0
  );

  // Fetch rejection email templates for this tenant
  const { data: templates } = useQuery({
    queryKey: ['email-templates', 'booking_rejected', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];

      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('template_key', 'booking_rejected')
        .eq('is_active', true)
        .eq('tenant_id', tenant.id)
        .order('template_name', { ascending: true });

      if (error || !data || data.length === 0) {
        return [{
          id: 'default-rejection',
          tenant_id: tenant.id,
          template_key: 'booking_rejected',
          template_name: 'Default Rejection Email',
          subject: 'Booking Update - {{rental_number}}',
          template_content: `<p>Dear {{customer_name}},</p>
<p>We regret to inform you that your booking request ({{rental_number}}) for {{vehicle_make}} {{vehicle_model}} has been declined.</p>
<p><strong>Reason:</strong> {{rejection_reason}}</p>
<p>If you have any questions, please contact us at {{company_email}} or {{company_phone}}.</p>
<p>Best regards,<br/>The {{company_name}} Team</p>`,
          is_active: true,
          created_at: null,
          updated_at: null,
        }];
      }

      return data;
    },
    enabled: open && !!tenant?.id,
  });

  // Auto-select first template when templates load
  useEffect(() => {
    if (templates && templates.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  // Clear rendered email when leaving email tab
  useEffect(() => {
    if (activeTab !== 'email') {
      setRenderedEmail(null);
    }
  }, [activeTab]);

  // Render email preview when entering email tab
  useEffect(() => {
    if (activeTab === 'email' && selectedTemplateId) {
      renderEmailPreview();
    }
  }, [activeTab, selectedTemplateId, rejectionReason]);

  const renderEmailPreview = async () => {
    if (!selectedTemplateId) return;

    setRenderingEmail(true);
    try {
      const template = templates?.find(t => t.id === selectedTemplateId);
      if (!template) throw new Error('Template not found');

      const templateContent = template.template_content || '';
      const templateSubject = template.subject || 'Booking Update';

      const variables: Record<string, string> = {
        customer_name: rental.customer?.name || 'Customer',
        customer_email: rental.customer?.email || '',
        rental_number: rental.id.substring(0, 8).toUpperCase(),
        rejection_reason: rejectionReason || 'We were unable to verify all required information.',
        refund_amount: formatCurrency(totalRefundAmount, currencyCode),
        vehicle_make: rental.vehicle?.make || '',
        vehicle_model: rental.vehicle?.model || '',
        vehicle_reg: rental.vehicle?.reg || '',
        rental_start_date: rental.start_date ? format(new Date(rental.start_date), 'MMMM dd, yyyy') : 'N/A',
        rental_end_date: rental.end_date ? format(new Date(rental.end_date), 'MMMM dd, yyyy') : 'N/A',
        rental_amount: formatCurrency(rental.monthly_amount || 0, currencyCode),
        company_name: (tenant as any)?.name || 'Our Company',
        company_email: (tenant as any)?.email || '',
        company_phone: (tenant as any)?.phone || '',
      };

      let renderedContent = templateContent;
      let renderedSubject = templateSubject;

      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{{${key}}}`;
        renderedContent = renderedContent.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
        renderedSubject = renderedSubject.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
      }

      setRenderedEmail({ subject: renderedSubject, html: renderedContent });
    } catch (error: any) {
      console.error('Email render error:', error);
      toast({
        title: "Preview Error",
        description: error.message || "Failed to render email preview",
        variant: "destructive",
      });
    } finally {
      setRenderingEmail(false);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // Call the reject-rental edge function (handles all refunds server-side)
      const { data, error } = await supabase.functions.invoke('reject-rental', {
        body: {
          rentalId: rental.id,
          reason: rejectionReason || undefined,
          tenantId: tenant?.id,
        },
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || 'Failed to reject rental');

      // Send rejection email
      if (rental.customer?.email && renderedEmail) {
        await supabase.functions.invoke('notify-booking-rejected', {
          body: {
            customerEmail: rental.customer.email,
            customerName: rental.customer.name,
            vehicleName: `${rental.vehicle?.make} ${rental.vehicle?.model}`,
            bookingRef: rental.id.substring(0, 8).toUpperCase(),
            rejectionReason: rejectionReason || 'We were unable to verify all required information.',
            refundAmount: totalRefundAmount,
            emailSubject: renderedEmail.subject,
            emailBody: renderedEmail.html,
            tenantId: tenant?.id,
          }
        }).catch(err => {
          console.warn('Failed to send rejection email:', err);
        });
      }

      // Build success message
      const paymentsProcessed = data?.paymentsProcessed || 0;
      const totalRefunded = data?.totalRefunded || 0;
      const manualRequired = data?.manualRefundsRequired || 0;

      let description = 'Booking has been rejected.';
      if (paymentsProcessed > 0) {
        description = `Booking rejected. ${paymentsProcessed} payment(s) processed`;
        if (totalRefunded > 0) {
          description += ` — ${formatCurrency(totalRefunded, currencyCode)} refunded/released`;
        }
        if (manualRequired > 0) {
          description += `. ${manualRequired} require manual refund`;
        }
        description += '.';
      }

      toast({ title: "Booking Rejected", description });

      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
      queryClient.invalidateQueries({ queryKey: ['rental', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['rental-payment', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['rental-all-payments', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['rental-refund-breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['rental-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
      queryClient.invalidateQueries({ queryKey: ['rental-totals'] });

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
    setSelectedTemplateId("");
    setRenderedEmail(null);
    onOpenChange(false);
  };

  const getPaymentLabel = (p: RentalPayment) => {
    const categories = p.target_categories;
    if (categories && categories.length > 0) return categories.join(', ');
    if (p.payment_type) return p.payment_type;
    return 'Payment';
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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="reason" className="text-xs">
              1. Reason & Refunds
            </TabsTrigger>
            <TabsTrigger value="email" className="text-xs">
              2. Email & Confirm
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Rejection Reason + Payment Summary */}
          <TabsContent value="reason" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reason">Rejection Reason (Optional)</Label>
              <Textarea
                id="reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Provide a reason for rejecting this booking (optional). This will be included in the email to the customer."
                rows={4}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                If left blank, a default message will be used in the email.
              </p>
            </div>

            {/* Payment Summary */}
            {loadingPayments ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading payments...
              </div>
            ) : (allPayments || []).length > 0 ? (
              <div className="space-y-3">
                <h3 className="font-semibold text-sm">Payments to be refunded</h3>
                <div className="border rounded-lg divide-y">
                  {(allPayments || []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.capture_status === 'requires_capture' ? (
                          <Badge variant="outline" className="text-blue-600 border-blue-300">Hold</Badge>
                        ) : p.capture_status === 'captured' ? (
                          <Badge variant="outline" className="text-green-600 border-green-300">
                            <CreditCard className="h-3 w-3 mr-1" />
                            Stripe
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-300">
                            <Banknote className="h-3 w-3 mr-1" />
                            Manual
                          </Badge>
                        )}
                        <span className="text-sm">{getPaymentLabel(p)}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium">{formatCurrency(p.amount || 0, currencyCode)}</span>
                        <p className="text-xs text-muted-foreground">
                          {p.capture_status === 'requires_capture'
                            ? 'Hold will be released'
                            : p.capture_status === 'captured'
                              ? 'Will be refunded via Stripe'
                              : 'Will need manual refund'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="flex items-center justify-between px-4 py-2 bg-muted/50 rounded-lg">
                  <span className="font-semibold text-sm">Total</span>
                  <span className="font-bold">{formatCurrency(totalRefundAmount, currencyCode)}</span>
                </div>

                {/* Summary badges */}
                <div className="flex flex-wrap gap-2">
                  {capturedPayments.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {capturedPayments.length} Stripe refund{capturedPayments.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                  {preAuthPayments.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {preAuthPayments.length} hold{preAuthPayments.length > 1 ? 's' : ''} to release
                    </Badge>
                  )}
                  {manualPayments.length > 0 && (
                    <Badge variant="secondary" className="text-xs text-amber-700">
                      {manualPayments.length} manual refund{manualPayments.length > 1 ? 's' : ''} needed
                    </Badge>
                  )}
                </div>
              </div>
            ) : (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This booking has <strong>no active payments</strong>. It will be cancelled without any refunds.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          {/* Tab 2: Email Template + Preview + Confirm */}
          <TabsContent value="email" className="space-y-4 py-4">
            {/* Template Selection */}
            <div className="space-y-2">
              <Label htmlFor="template">Email Template</Label>
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
                      {template.template_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Email Preview */}
            {renderingEmail ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : renderedEmail ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Subject</Label>
                  <div className="border rounded-lg p-2 bg-muted/30 text-sm font-medium">
                    {renderedEmail.subject}
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Body</Label>
                  <div className="border rounded-lg overflow-hidden">
                    <iframe
                      srcDoc={renderedEmail.html}
                      className="w-full h-[300px] bg-white"
                      title="Email Preview"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Select a template to preview the email.
              </div>
            )}

            {/* Confirmation info */}
            <Alert>
              <Eye className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {rental.customer?.email ? (
                  <>Email will be sent to <strong>{rental.customer.email}</strong>. </>
                ) : (
                  <>No customer email on file. </>
                )}
                {(allPayments || []).length > 0 ? (
                  <>All {(allPayments || []).length} payment(s) totalling <strong>{formatCurrency(totalRefundAmount, currencyCode)}</strong> will be refunded automatically.</>
                ) : (
                  <>No payments to refund.</>
                )}
              </AlertDescription>
            </Alert>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <DialogFooter className="flex items-center justify-between sm:justify-between border-t pt-4">
          <div className="flex gap-2">
            {activeTab === "email" && (
              <Button
                variant="outline"
                onClick={() => setActiveTab("reason")}
                disabled={isSubmitting}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
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

            {activeTab === "email" ? (
              <Button
                variant="destructive"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Rejecting...
                  </>
                ) : (
                  <>
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject & Refund
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={() => setActiveTab("email")}
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
