"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, ArrowLeft, PoundSterling, Plus, X, Send, Download, Ban, Check, AlertTriangle, Loader2 } from "lucide-react";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useRentalTotals } from "@/hooks/use-rental-ledger-data";
import { useRentalInitialFee } from "@/hooks/use-rental-initial-fee";
import { RentalLedger } from "@/components/rentals/rental-ledger";
import { ComplianceStatusPanel } from "@/components/rentals/compliance-status-panel";
import { KeyHandoverSection } from "@/components/rentals/key-handover-section";
import { CancelRentalDialog } from "@/components/shared/dialogs/cancel-rental-dialog";
import RejectionDialog from "@/components/rentals/rejection-dialog";

interface Rental {
  id: string;
  start_date: string;
  end_date: string;
  rental_period_type?: string;
  monthly_amount: number;
  status: string;
  computed_status?: string;
  document_status?: string;
  signed_document_id?: string;
  customers: { id: string; name: string };
  vehicles: { id: string; reg: string; make: string; model: string };
}

const RentalDetail = () => {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [sendingDocuSign, setSendingDocuSign] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showRejectionDialog, setShowRejectionDialog] = useState(false);


  const { data: rental, isLoading } = useQuery({
    queryKey: ["rental", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select(`
          *,
          customers(id, name),
          vehicles(id, reg, make, model)
        `)
        .eq("id", id)
        .single();

      if (error) throw error;
      return data as Rental;
    },
    enabled: !!id,
  });

  const { data: rentalTotals } = useRentalTotals(id);
  const { data: initialFee } = useRentalInitialFee(id);

  // Scroll to ledger section if hash is present (wait for data to load)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#ledger' && !isLoading && rental) {
      const scrollToLedger = () => {
        const ledgerElement = document.getElementById('ledger');
        if (ledgerElement) {
          const yOffset = -90;
          const y = ledgerElement.getBoundingClientRect().top + window.pageYOffset + yOffset;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      };
      // Wait for content to fully render
      setTimeout(scrollToLedger, 500);
    }
  }, [isLoading, rental]);

  // Fetch payment information for pending bookings
  const { data: payment } = useQuery({
    queryKey: ["rental-payment", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("rental_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch signed document if available
  const { data: signedDocument } = useQuery({
    queryKey: ["signed-document", rental?.signed_document_id],
    queryFn: async () => {
      if (!rental?.signed_document_id) return null;

      const { data, error } = await supabase
        .from("customer_documents")
        .select("id, document_name, file_url, file_name, mime_type")
        .eq("id", rental.signed_document_id)
        .single();

      if (error) {
        console.log('Error fetching signed document:', error);
        return null;
      }

      return data;
    },
    enabled: !!rental?.signed_document_id,
  });

  // Fetch insurance documents with AI scanning results
  const { data: insuranceDocuments } = useQuery({
    queryKey: ["rental-insurance-docs", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_documents")
        .select("*")
        .eq("rental_id", id)
        .eq("document_type", "Insurance Certificate")
        .order("uploaded_at", { ascending: false });

      if (error && error.code !== 'PGRST116') throw error;
      return data || [];
    },
    enabled: !!id,
  });

  if (isLoading) {
    return <div>Loading rental details...</div>;
  }

  if (!rental) {
    return <div>Rental not found</div>;
  }

  // Use the new totals from allocation-based calculations
  const totalCharges = rentalTotals?.totalCharges || 0;
  const totalPayments = rentalTotals?.totalPayments || 0;
  const outstandingBalance = rentalTotals?.outstanding || 0;

  // Compute rental status dynamically based on dates and status
  const computeStatus = (rental: Rental): string => {
    if (rental.status === 'Closed') return 'Closed';
    if (rental.status === 'Pending') return 'Pending';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(rental.start_date);
    startDate.setHours(0, 0, 0, 0);

    if (startDate > today) {
      return 'Upcoming';
    }

    return 'Active';
  };

  const displayStatus = rental.computed_status || computeStatus(rental);
  const getStatusVariant = (status: string) => {
    if (status === 'Active') return 'default';
    if (status === 'Closed') return 'secondary';
    if (status === 'Pending') return 'outline';
    return 'outline';
  };


  return (
    <div className="space-y-6 py-[24px] px-[8px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => router.push("/rentals")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Rentals
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Rental Agreement</h1>
            <p className="text-muted-foreground">
              {rental.customers?.name} • {rental.vehicles?.reg}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {displayStatus === 'Active' && (
            <>
              <Button variant="outline" onClick={() => setShowAddPayment(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Payment
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  setSendingDocuSign(true);
                  try {
                    // Send DocuSign
                    const { data: docuSignData, error: docuSignError } = await supabase.functions.invoke('create-docusign-envelope', {
                      body: {
                        rentalId: id,
                      }
                    });

                    if (docuSignError || !docuSignData?.ok) {
                      console.error('DocuSign error:', docuSignError || docuSignData);
                      toast({
                        title: "DocuSign Error",
                        description: docuSignData?.detail || docuSignError?.message || "Failed to send DocuSign agreement.",
                        variant: "destructive",
                      });
                    } else {
                      toast({
                        title: "DocuSign Sent",
                        description: "Rental agreement has been sent via DocuSign",
                      });
                    }
                  } catch (error: any) {
                    console.error('Error sending DocuSign:', error);
                    toast({
                      title: "DocuSign Error",
                      description: error?.message || "Failed to send DocuSign agreement",
                      variant: "destructive",
                    });
                  } finally {
                    setSendingDocuSign(false);
                  }
                }}
                disabled={sendingDocuSign}
              >
                <Send className="h-4 w-4 mr-2" />
                {sendingDocuSign ? "Sending..." : "Send DocuSign"}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    let closeRentalQuery = supabase
                      .from("rentals")
                      .update({ status: "Closed" })
                      .eq("id", id);

                    if (tenant?.id) {
                      closeRentalQuery = closeRentalQuery.eq("tenant_id", tenant.id);
                    }

                    await closeRentalQuery;

                    let updateVehicleQuery = supabase
                      .from("vehicles")
                      .update({ status: "Available" })
                      .eq("id", rental.vehicles?.id);

                    if (tenant?.id) {
                      updateVehicleQuery = updateVehicleQuery.eq("tenant_id", tenant.id);
                    }

                    await updateVehicleQuery;

                    toast({
                      title: "Rental Closed",
                      description: "Rental has been closed and vehicle is now available.",
                    });

                    queryClient.invalidateQueries({ queryKey: ["rental", id] });
                    queryClient.invalidateQueries({ queryKey: ["rentals-list"] });
                    queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
                  } catch (error) {
                    toast({
                      title: "Error",
                      description: "Failed to close rental.",
                      variant: "destructive",
                    });
                  }
                }}
              >
                <X className="h-4 w-4 mr-2" />
                Close Rental
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowCancelDialog(true)}
              >
                <Ban className="h-4 w-4 mr-2" />
                Cancel & Refund
              </Button>
            </>
          )}
          {(displayStatus === 'Pending' || displayStatus === 'Pending Approval') && (
            <>
              {payment?.capture_status === 'requires_capture' && (
                <Button
                  variant="default"
                  onClick={async () => {
                    try {
                      // Capture the payment
                      const { error: captureError } = await supabase.functions.invoke('capture-payment', {
                        body: {
                          paymentId: payment.id,
                          rentalId: id,
                        }
                      });

                      if (captureError) throw captureError;

                      // Update rental status to Active
                      await supabase
                        .from('rentals')
                        .update({ status: 'Active' })
                        .eq('id', id);

                      // Send approval email
                      await supabase.functions.invoke('notify-booking-approved', {
                        body: {
                          customerEmail: rental.customers?.email,
                          customerName: rental.customers?.name,
                          vehicleName: `${rental.vehicles?.make} ${rental.vehicles?.model}`,
                          bookingRef: id.substring(0, 8).toUpperCase(),
                          pickupDate: rental.start_date,
                          returnDate: rental.end_date,
                        }
                      }).catch(err => {
                        console.warn('Failed to send approval email:', err);
                      });

                      toast({
                        title: "Booking Approved",
                        description: "Payment captured and customer notified",
                      });

                      queryClient.invalidateQueries({ queryKey: ['rental', id] });
                      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
                      queryClient.invalidateQueries({ queryKey: ['rental-payment', id] });
                    } catch (error: any) {
                      toast({
                        title: "Error",
                        description: error.message || "Failed to approve booking",
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  <Check className="h-4 w-4 mr-2" />
                  Approve Booking
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => setShowRejectionDialog(true)}
              >
                <Ban className="h-4 w-4 mr-2" />
                Reject Booking
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Rental Summary */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Total Charges</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              ${totalCharges.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Total Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${totalPayments.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${outstandingBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
              ${outstandingBalance.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={getStatusVariant(displayStatus)} className="text-lg px-3 py-1">
              {displayStatus}
            </Badge>
          </CardContent>
        </Card>

      </div>

      {/* Rental Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Rental Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Customer</p>
              <p className="font-medium">{rental.customers?.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Vehicle</p>
              <p className="font-medium">
                {rental.vehicles?.reg} ({rental.vehicles?.make} {rental.vehicles?.model})
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Start Date</p>
              <p className="font-medium">{new Date(rental.start_date).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">End Date</p>
              <p className="font-medium">{new Date(rental.end_date).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Period Type</p>
              <Badge variant="outline" className="font-medium">
                {rental.rental_period_type || 'Monthly'}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{rental.rental_period_type || 'Monthly'} Amount</p>
              <p className="font-medium">${Number(rental.monthly_amount).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Initial Fee</p>
              <p className="font-medium">
                {initialFee ? `$${Number(initialFee.amount).toLocaleString()}` : 'No Initial Fee'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Insurance Documents Card */}
      {insuranceDocuments && insuranceDocuments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-600" />
              Insurance Documents
            </CardTitle>
            <CardDescription>
              AI-verified insurance certificates uploaded by the customer
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {insuranceDocuments.map((doc: any) => {
                const validationScore = doc.ai_validation_score || 0;
                const extractedData = doc.ai_extracted_data || {};

                const getScoreBadge = (score: number) => {
                  if (score >= 0.7) {
                    return <Badge className="bg-green-600">Valid ({(score * 100).toFixed(0)}%)</Badge>;
                  } else if (score >= 0.4) {
                    return <Badge className="bg-yellow-600">Review Required ({(score * 100).toFixed(0)}%)</Badge>;
                  } else {
                    return <Badge className="bg-orange-600">Low Confidence ({(score * 100).toFixed(0)}%)</Badge>;
                  }
                };

                return (
                  <div key={doc.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{doc.file_name || doc.document_name}</span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Uploaded: {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : 'N/A'}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {doc.ai_scan_status === 'completed' && doc.ai_validation_score !== null && (
                          getScoreBadge(doc.ai_validation_score)
                        )}
                        {doc.ai_scan_status === 'pending' && (
                          <Badge variant="outline">Pending Scan</Badge>
                        )}
                        {doc.ai_scan_status === 'processing' && (
                          <Badge variant="outline">
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            Scanning...
                          </Badge>
                        )}
                        {doc.ai_scan_status === 'failed' && (
                          <Badge variant="destructive">Scan Failed</Badge>
                        )}
                      </div>
                    </div>

                    {/* AI Extracted Data */}
                    {doc.ai_scan_status === 'completed' && extractedData && Object.keys(extractedData).length > 0 && (
                      <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                        <h4 className="text-sm font-semibold mb-2">AI Extracted Information</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {extractedData.provider && (
                            <div>
                              <span className="text-muted-foreground">Provider:</span>{' '}
                              <span className="font-medium">{extractedData.provider}</span>
                            </div>
                          )}
                          {extractedData.policyNumber && (
                            <div>
                              <span className="text-muted-foreground">Policy #:</span>{' '}
                              <span className="font-medium">{extractedData.policyNumber}</span>
                            </div>
                          )}
                          {extractedData.startDate && (
                            <div>
                              <span className="text-muted-foreground">Start Date:</span>{' '}
                              <span className="font-medium">{extractedData.startDate}</span>
                            </div>
                          )}
                          {extractedData.endDate && (
                            <div>
                              <span className="text-muted-foreground">End Date:</span>{' '}
                              <span className="font-medium">{extractedData.endDate}</span>
                            </div>
                          )}
                          {extractedData.coverageAmount && (
                            <div>
                              <span className="text-muted-foreground">Coverage:</span>{' '}
                              <span className="font-medium">${extractedData.coverageAmount.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                        {doc.ai_confidence_score !== null && (
                          <div className="text-xs text-muted-foreground pt-2 border-t">
                            Extraction Confidence: {(doc.ai_confidence_score * 100).toFixed(0)}%
                          </div>
                        )}
                      </div>
                    )}

                    {/* AI Scan Errors */}
                    {doc.ai_scan_errors && doc.ai_scan_errors.length > 0 && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                          <strong>Scan Errors:</strong> {doc.ai_scan_errors.join(', ')}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Download Button */}
                    <div className="pt-2 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const { data } = supabase.storage
                            .from('customer-documents')
                            .getPublicUrl(doc.file_url);
                          window.open(data.publicUrl, '_blank');
                        }}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        View Document
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key Handover Section */}
      {id && <KeyHandoverSection rentalId={id} rentalStatus={displayStatus} />}

      {/* Enhanced Ledger */}
      <div id="ledger">
        {id && <RentalLedger rentalId={id} />}
      </div>

      {/* Payment Status Compliance */}
      {id && (
        <ComplianceStatusPanel
          objectType="Rental"
          objectId={id}
          title="Payment Reminders"
        />
      )}

      {/* Add Payment Dialog */}
      {rental && (
        <AddPaymentDialog
          open={showAddPayment}
          onOpenChange={setShowAddPayment}
          customer_id={rental.customers?.id}
          vehicle_id={rental.vehicles?.id}
          rental_id={rental.id}
        />
      )}

      {/* Cancel Rental Dialog */}
      {rental && (
        <CancelRentalDialog
          open={showCancelDialog}
          onOpenChange={setShowCancelDialog}
          rental={{
            id: rental.id,
            customer: rental.customers,
            vehicle: rental.vehicles,
            monthly_amount: rental.monthly_amount,
          }}
        />
      )}

      {/* Rejection Dialog */}
      {rental && (
        <RejectionDialog
          open={showRejectionDialog}
          onOpenChange={setShowRejectionDialog}
          rental={{
            id: rental.id,
            customer: {
              id: rental.customers?.id,
              name: rental.customers?.name,
              email: rental.customers?.email,
            },
            vehicle: {
              make: rental.vehicles?.make,
              model: rental.vehicles?.model,
              reg: rental.vehicles?.reg,
            },
            monthly_amount: rental.monthly_amount,
            start_date: rental.start_date,
            end_date: rental.end_date,
          }}
          payment={payment || undefined}
        />
      )}
    </div>
  );
};

export default RentalDetail;
