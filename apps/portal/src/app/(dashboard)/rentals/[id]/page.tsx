"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, ArrowLeft, DollarSign, Plus, X, Send, Download, Ban, Check, AlertTriangle, Loader2, Shield, CheckCircle, XCircle, ExternalLink, UserCheck, IdCard, Camera, FileSignature, Clock, Mail, RefreshCw, Trash2 } from "lucide-react";
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
  insurance_status?: string;
  customer_id?: string;
  customers: { id: string; name: string; email?: string; phone?: string | null };
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
  const [checkingDocuSignStatus, setCheckingDocuSignStatus] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showRejectionDialog, setShowRejectionDialog] = useState(false);


  const { data: rental, isLoading, error: rentalError } = useQuery({
    queryKey: ["rental", id, tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error("No tenant context");

      const { data, error } = await supabase
        .from("rentals")
        .select(`
          *,
          customers!rentals_customer_id_fkey(id, name, email, phone),
          vehicles!rentals_vehicle_id_fkey(id, reg, make, model)
        `)
        .eq("id", id)
        .eq("tenant_id", tenant.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Rental not found");
      if (!data.customers) throw new Error("Rental customer not found");
      return data as Rental;
    },
    enabled: !!id && !!tenant?.id,
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
    queryKey: ["rental-payment", id, tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return null;

      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("rental_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error fetching rental payment:", error);
        return null;
      }
      return data;
    },
    enabled: !!id && !!tenant?.id,
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
  // Documents may be linked by rental_id, customer_id, or still be unlinked (from temp customers)
  const { data: insuranceDocuments, data: unlinkedDocs } = useQuery({
    queryKey: ["rental-insurance-docs", id, rental?.customers?.id, tenant?.id],
    queryFn: async () => {
      const results: any[] = [];

      // First try to find by rental_id (direct link)
      if (tenant?.id) {
        const { data: rentalDocs } = await supabase
          .from("customer_documents")
          .select("*")
          .eq("rental_id", id)
          .eq("document_type", "Insurance Certificate")
          .eq("tenant_id", tenant.id)
          .order("uploaded_at", { ascending: false });

        if (rentalDocs && rentalDocs.length > 0) {
          return rentalDocs;
        }
      }

      // Try by customer_id
      if (rental?.customers?.id && tenant?.id) {
        const { data: customerDocs } = await supabase
          .from("customer_documents")
          .select("*")
          .eq("customer_id", rental.customers.id)
          .eq("document_type", "Insurance Certificate")
          .eq("tenant_id", tenant.id)
          .order("uploaded_at", { ascending: false });

        if (customerDocs && customerDocs.length > 0) {
          return customerDocs;
        }
      }

      // Fallback: Show all unlinked insurance documents for this tenant
      // These may be orphaned from bookings where the linking failed
      if (tenant?.id) {
        const { data: unlinkedDocs } = await supabase
          .from("customer_documents")
          .select("*, customers!customer_documents_customer_id_fkey(email)")
          .eq("document_type", "Insurance Certificate")
          .eq("tenant_id", tenant.id)
          .is("rental_id", null)
          .order("uploaded_at", { ascending: false })
          .limit(10);

        // Mark these as unlinked so UI can show appropriate message
        if (unlinkedDocs && unlinkedDocs.length > 0) {
          return unlinkedDocs.map(doc => ({ ...doc, isUnlinked: true }));
        }
      }

      return [];
    },
    enabled: !!id && !!tenant?.id,
  });

  // Fetch identity verification for this customer
  const { data: identityVerification, isLoading: isLoadingVerification } = useQuery({
    queryKey: ["customer-identity-verification", rental?.customers?.id, tenant?.id],
    queryFn: async () => {
      if (!rental?.customers?.id) return null;

      console.log('Fetching identity verification for customer:', rental.customers.id);

      // First try to find by customer_id
      const { data, error } = await supabase
        .from("identity_verifications")
        .select("*")
        .eq("customer_id", rental.customers.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error fetching identity verification:", error);
        return null;
      }

      if (data) {
        console.log('Found identity verification by customer_id:', data.id, 'status:', data.review_result);
        return data;
      }

      console.log('No verification by customer_id, checking ALL unlinked records...');

      // Check ALL unlinked verifications (might not have tenant_id either)
      const { data: unlinkedData } = await supabase
        .from("identity_verifications")
        .select("*")
        .is("customer_id", null)
        .order("created_at", { ascending: false })
        .limit(10);

      if (unlinkedData && unlinkedData.length > 0) {
        console.log('Found unlinked verifications:', unlinkedData.length);
        // Try to match by name if available
        const customerName = rental?.customers?.name?.toLowerCase() || '';
        const match = unlinkedData.find((v: any) => {
          const veriffName = `${v.first_name || ''} ${v.last_name || ''}`.toLowerCase().trim();
          return veriffName && customerName && (
            customerName.includes(veriffName) ||
            veriffName.includes(customerName) ||
            (v.first_name && customerName.includes(v.first_name.toLowerCase())) ||
            (v.last_name && customerName.includes(v.last_name.toLowerCase()))
          );
        });

        if (match) {
          console.log('Found matching unlinked verification by name:', match.id);
          return { ...match, needsLinking: true };
        }

        // Return all unlinked for selection
        console.log('No name match, returning first unlinked for review');
        return { ...unlinkedData[0], needsLinking: true, allUnlinked: unlinkedData };
      }

      console.log('No identity verification found for customer');
      return null;
    },
    enabled: !!rental?.customers?.id,
  });

  // Fetch all recent unlinked verifications for manual linking
  const { data: unlinkedVerifications } = useQuery({
    queryKey: ["unlinked-verifications", tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("identity_verifications")
        .select("*")
        .is("customer_id", null)
        .order("created_at", { ascending: false })
        .limit(10);
      return data || [];
    },
    enabled: !identityVerification && !!rental?.customers?.id,
  });

  // Mutation to link a verification to this customer
  const linkVerificationMutation = useMutation({
    mutationFn: async (verificationId: string) => {
      const { error } = await supabase
        .from("identity_verifications")
        .update({
          customer_id: rental?.customers?.id,
          tenant_id: tenant?.id
        })
        .eq("id", verificationId);

      if (error) throw error;

      // Also update customer's verification status
      const { data: verif } = await supabase
        .from("identity_verifications")
        .select("review_result")
        .eq("id", verificationId)
        .single();

      if (verif) {
        const status = verif.review_result === 'GREEN' ? 'verified' :
          verif.review_result === 'RED' ? 'rejected' : 'pending';
        await supabase
          .from("customers")
          .update({ identity_verification_status: status })
          .eq("id", rental?.customers?.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-identity-verification"] });
      queryClient.invalidateQueries({ queryKey: ["unlinked-verifications"] });
      queryClient.invalidateQueries({ queryKey: ["rental", id] });
      toast({
        title: "Verification Linked",
        description: "Identity verification has been linked to this customer.",
      });
    },
    onError: (error: any) => {
      console.error("Link verification error:", error);
      toast({
        title: "Error",
        description: "Failed to link verification: " + error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation for approving insurance document
  const approveInsuranceMutation = useMutation({
    mutationFn: async (documentId: string) => {
      let query = supabase
        .from("customer_documents")
        .update({
          verified: true,
          status: "Active",
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rental-insurance-docs", id] });
      toast({
        title: "Insurance Approved",
        description: "The insurance document has been approved.",
      });
    },
    onError: (error: any) => {
      console.error("Approve error:", error);
      toast({
        title: "Error",
        description: "Failed to approve insurance document.",
        variant: "destructive",
      });
    },
  });

  // Rejecting insurance = rejecting the booking
  // Just open the rejection dialog directly
  const handleRejectInsurance = () => {
    setShowRejectionDialog(true);
  };

  // Mutation for linking unlinked document to this rental
  const linkDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      let query = supabase
        .from("customer_documents")
        .update({
          rental_id: id,
          customer_id: rental?.customers?.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rental-insurance-docs", id] });
      toast({
        title: "Document Linked",
        description: "The insurance document has been linked to this rental.",
      });
    },
    onError: (error: any) => {
      console.error("Link error:", error);
      toast({
        title: "Error",
        description: "Failed to link insurance document.",
        variant: "destructive",
      });
    },
  });

  // Mutation for retrying AI scan on stuck documents
  const retryScanMutation = useMutation({
    mutationFn: async (documentId: string) => {
      // First, get the document to get the file_url
      const { data: doc, error: fetchError } = await supabase
        .from("customer_documents")
        .select("file_url")
        .eq("id", documentId)
        .single();

      if (fetchError || !doc) {
        throw new Error("Failed to fetch document");
      }

      // Reset the scan status to pending
      const { error: updateError } = await supabase
        .from("customer_documents")
        .update({
          ai_scan_status: 'pending',
          ai_scan_errors: null,
          ai_extracted_data: null,
          ai_validation_score: null,
          ai_confidence_score: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);

      if (updateError) throw updateError;

      // Trigger the scan edge function
      const { error: scanError } = await supabase.functions.invoke('scan-insurance-document', {
        body: { documentId, fileUrl: doc.file_url }
      });

      if (scanError) {
        console.error("Scan function error:", scanError);
        // Don't throw - the function might still process
      }

      return documentId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rental-insurance-docs", id] });
      toast({
        title: "Scan Restarted",
        description: "The document scan has been restarted.",
      });
    },
    onError: (error: any) => {
      console.error("Retry scan error:", error);
      toast({
        title: "Error",
        description: "Failed to restart document scan.",
        variant: "destructive",
      });
    },
  });

  // Mutation for deleting insurance documents
  const deleteDocumentMutation = useMutation({
    mutationFn: async (doc: { id: string; file_url: string }) => {
      // Delete file from storage
      if (doc.file_url) {
        const { error: storageError } = await supabase.storage
          .from('customer-documents')
          .remove([doc.file_url]);
        if (storageError) {
          console.error("Storage delete error:", storageError);
        }
      }

      // Delete record from database
      let query = supabase
        .from("customer_documents")
        .delete()
        .eq("id", doc.id);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rental-insurance-docs", id] });
      toast({
        title: "Document Deleted",
        description: "The insurance document has been deleted.",
      });
    },
    onError: (error: any) => {
      console.error("Delete error:", error);
      toast({
        title: "Error",
        description: "Failed to delete document.",
        variant: "destructive",
      });
    },
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
      <div className="grid gap-6 md:grid-cols-3">
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
              <p className="text-sm text-muted-foreground">Date of Birth</p>
              <p className="font-medium">
                {identityVerification?.date_of_birth
                  ? `${new Date(identityVerification.date_of_birth).toLocaleDateString()} (${Math.floor((Date.now() - new Date(identityVerification.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} yrs)`
                  : 'No DOB'}
              </p>
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

      {/* DocuSign Agreement Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-blue-600" />
            Rental Agreement
          </CardTitle>
          <CardDescription>
            DocuSign rental agreement status and signed document
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Status Badge */}
              {rental.document_status === 'signed' || rental.signed_document_id ? (
                <Badge className="bg-green-600">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Signed
                </Badge>
              ) : rental.document_status === 'sent' ? (
                <Badge className="bg-yellow-600">
                  <Mail className="h-3 w-3 mr-1" />
                  Sent - Awaiting Signature
                </Badge>
              ) : rental.document_status === 'viewed' ? (
                <Badge className="bg-blue-600">
                  <Clock className="h-3 w-3 mr-1" />
                  Viewed - Awaiting Signature
                </Badge>
              ) : (
                <Badge variant="outline">
                  <Clock className="h-3 w-3 mr-1" />
                  Not Sent
                </Badge>
              )}

              {/* Info text */}
              <span className="text-sm text-muted-foreground">
                {rental.document_status === 'signed' || rental.signed_document_id
                  ? 'Agreement has been signed by customer'
                  : rental.document_status === 'sent'
                    ? 'Waiting for customer to sign'
                    : rental.document_status === 'viewed'
                      ? 'Customer has viewed the agreement'
                      : 'Agreement has not been sent yet'}
              </span>
            </div>

            <div className="flex gap-2">
              {/* View Signed Document Button */}
              {signedDocument && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const { data } = supabase.storage
                      .from('customer-documents')
                      .getPublicUrl(signedDocument.file_url);
                    window.open(data.publicUrl, '_blank');
                  }}
                >
                  <Download className="h-4 w-4 mr-2" />
                  View Signed Agreement
                </Button>
              )}

              {/* Send DocuSign Button - only show if not signed */}
              {!rental.signed_document_id && displayStatus !== 'Closed' && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    setSendingDocuSign(true);
                    try {
                      // Use local API route instead of edge function
                      const response = await fetch('/api/docusign', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          rentalId: id,
                          customerEmail: rental.customers?.email,
                          customerName: rental.customers?.name,
                          tenantId: tenant?.id,
                        }),
                      });

                      const docuSignData = await response.json();

                      if (!response.ok || !docuSignData?.ok) {
                        toast({
                          title: "DocuSign Error",
                          description: docuSignData?.detail || docuSignData?.error || "Failed to send DocuSign agreement.",
                          variant: "destructive",
                        });
                      } else {
                        toast({
                          title: "DocuSign Sent",
                          description: "Rental agreement has been sent via DocuSign",
                        });
                        queryClient.invalidateQueries({ queryKey: ["rental", id] });
                      }
                    } catch (error: any) {
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
                  {sendingDocuSign ? "Sending..." : rental.document_status === 'sent' ? "Resend DocuSign" : "Send DocuSign"}
                </Button>
              )}

              {/* Check Status Button - show when sent but not signed */}
              {(rental as any).docusign_envelope_id && rental.document_status !== 'signed' && !rental.signed_document_id && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    setCheckingDocuSignStatus(true);
                    try {
                      const response = await fetch('/api/docusign/status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          rentalId: id,
                          envelopeId: (rental as any).docusign_envelope_id,
                        }),
                      });

                      const statusData = await response.json();

                      if (statusData?.ok) {
                        toast({
                          title: "Status Updated",
                          description: `Document status: ${statusData.status}`,
                        });
                        queryClient.invalidateQueries({ queryKey: ["rental", id] });
                      } else {
                        toast({
                          title: "Check Failed",
                          description: statusData?.error || "Could not check status",
                          variant: "destructive",
                        });
                      }
                    } catch (error: any) {
                      toast({
                        title: "Error",
                        description: error?.message || "Failed to check status",
                        variant: "destructive",
                      });
                    } finally {
                      setCheckingDocuSignStatus(false);
                    }
                  }}
                  disabled={checkingDocuSignStatus}
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${checkingDocuSignStatus ? 'animate-spin' : ''}`} />
                  {checkingDocuSignStatus ? "Checking..." : "Check Status"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Insurance Verification Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Insurance Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Upload customer's insurance documents for verification</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*,.pdf';
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;

                  try {
                    toast({ title: "Uploading...", description: "Uploading insurance document" });

                    const fileName = `${rental.customer_id}/${Date.now()}_${file.name}`;
                    const { error: uploadError } = await supabase.storage
                      .from('customer-documents')
                      .upload(fileName, file);

                    if (uploadError) throw uploadError;

                    const { data: docData, error: docError } = await supabase
                      .from('customer_documents')
                      .insert({
                        customer_id: rental.customer_id,
                        rental_id: id,
                        document_type: 'Insurance Certificate',
                        document_name: file.name,
                        file_name: file.name,
                        file_url: fileName,
                        status: 'Pending',
                        ai_scan_status: 'pending',
                        tenant_id: tenant?.id,
                      })
                      .select()
                      .single();

                    if (docError) throw docError;

                    // Trigger AI scan with documentId and fileUrl
                    supabase.functions.invoke('scan-insurance-document', {
                      body: { documentId: docData.id, fileUrl: fileName }
                    });

                    toast({ title: "Success", description: "Insurance document uploaded and AI scan initiated" });
                    queryClient.invalidateQueries({ queryKey: ["rental-insurance-docs", id] });
                  } catch (error: any) {
                    toast({
                      title: "Upload Failed",
                      description: error.message || "Failed to upload document",
                      variant: "destructive"
                    });
                  }
                };
                input.click();
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Upload Document
            </Button>
          </div>

          {/* Document List */}
          {insuranceDocuments && insuranceDocuments.length > 0 ? (
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
                  <div key={doc.id} className={`border rounded-lg p-4 space-y-3 ${doc.isUnlinked ? 'border-yellow-500/50 bg-yellow-500/5' : ''}`}>
                    {/* Unlinked Warning */}
                    {doc.isUnlinked && (
                      <Alert className="mb-3 border-yellow-500/50 bg-yellow-500/10">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        <AlertDescription className="text-sm">
                          This document is not linked to any rental. Click "Link to Rental" to associate it with this booking.
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{doc.file_name || doc.document_name}</span>
                          {doc.isUnlinked && (
                            <Badge variant="outline" className="text-yellow-600 border-yellow-500">Unlinked</Badge>
                          )}
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
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">Pending Scan</Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => retryScanMutation.mutate(doc.id)}
                              disabled={retryScanMutation.isPending}
                              title="Start AI scan"
                            >
                              {retryScanMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        )}
                        {doc.ai_scan_status === 'processing' && (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              Scanning...
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => retryScanMutation.mutate(doc.id)}
                              disabled={retryScanMutation.isPending}
                              title="Retry scan if stuck"
                            >
                              <RefreshCw className={`h-3 w-3 ${retryScanMutation.isPending ? 'animate-spin' : ''}`} />
                            </Button>
                          </div>
                        )}
                        {doc.ai_scan_status === 'failed' && (
                          <div className="flex items-center gap-2">
                            <Badge variant="destructive">Scan Failed</Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => retryScanMutation.mutate(doc.id)}
                              disabled={retryScanMutation.isPending}
                              title="Retry scan"
                            >
                              <RefreshCw className={`h-3 w-3 ${retryScanMutation.isPending ? 'animate-spin' : ''}`} />
                            </Button>
                          </div>
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

                    {/* Action Buttons */}
                    <div className="pt-3 border-t flex items-center justify-between">
                      <div className="flex gap-2">
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
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View Document
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-300"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this document?')) {
                              deleteDocumentMutation.mutate({ id: doc.id, file_url: doc.file_url });
                            }
                          }}
                          disabled={deleteDocumentMutation.isPending}
                        >
                          {deleteDocumentMutation.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3 mr-1" />
                          )}
                          Delete
                        </Button>
                        {/* Link to Rental button for unlinked documents */}
                        {doc.isUnlinked && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-300"
                            onClick={() => linkDocumentMutation.mutate(doc.id)}
                            disabled={linkDocumentMutation.isPending}
                          >
                            {linkDocumentMutation.isPending ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <CheckCircle className="h-3 w-3 mr-1" />
                            )}
                            Link to Rental
                          </Button>
                        )}
                      </div>

                      {/* Approve/Reject Buttons - only show if not already active/verified and document is linked */}
                      {!doc.isUnlinked && doc.status?.toLowerCase() !== 'active' && !doc.verified && (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-300"
                            onClick={() => approveInsuranceMutation.mutate(doc.id)}
                            disabled={approveInsuranceMutation.isPending}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-300"
                            onClick={handleRejectInsurance}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject Booking
                          </Button>
                        </div>
                      )}

                      {/* Show status badge if already approved (Active status or verified) */}
                      {(doc.status?.toLowerCase() === 'active' || doc.verified) && (
                        <Badge className="bg-green-600">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Approved
                        </Badge>
                      )}
                      {doc.status?.toLowerCase() === 'expired' && (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          Expired
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No insurance documents uploaded</p>
              <p className="text-sm">The customer hasn't uploaded insurance documents for this rental yet.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Identity Verification Section - Always show */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-purple-600" />
            Identity Verification
          </CardTitle>
          <CardDescription>
            Identity verification status and documents for this customer
          </CardDescription>
        </CardHeader>
        <CardContent>
          {identityVerification && (
            <div className="space-y-4">
              {/* Needs Linking Alert */}
              {(identityVerification as any).needsLinking && (
                <Alert className="border-blue-500/50 bg-blue-500/10">
                  <AlertTriangle className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="flex items-center justify-between">
                    <span className="text-sm">
                      Found a verification that appears to match this customer but is not linked.
                      <strong className="ml-1">
                        {identityVerification.first_name} {identityVerification.last_name}
                      </strong>
                    </span>
                    <Button
                      size="sm"
                      onClick={() => linkVerificationMutation.mutate(identityVerification.id)}
                      disabled={linkVerificationMutation.isPending}
                      className="ml-4"
                    >
                      {linkVerificationMutation.isPending ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle className="h-3 w-3 mr-1" />
                      )}
                      Link to Customer
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Status Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Status:</span>
                  {identityVerification.review_result === 'GREEN' ? (
                    <Badge className="bg-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Verified
                    </Badge>
                  ) : identityVerification.review_result === 'RED' ? (
                    <Badge variant="destructive">
                      <XCircle className="h-3 w-3 mr-1" />
                      Declined
                    </Badge>
                  ) : identityVerification.review_result === 'RETRY' ? (
                    <Badge className="bg-yellow-600">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Resubmission Required
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Pending
                    </Badge>
                  )}
                  {/* Provider Badge */}
                  {identityVerification.verification_provider === 'ai' ? (
                    <Badge variant="outline" className="border-purple-500 text-purple-600">
                      AI Verified
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      Veriff
                    </Badge>
                  )}
                </div>
                {identityVerification.verification_completed_at && (
                  <span className="text-sm text-muted-foreground">
                    Verified: {new Date(identityVerification.verification_completed_at).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* AI Face Match Score - only show for AI verifications */}
              {identityVerification.verification_provider === 'ai' && identityVerification.ai_face_match_score && (
                <div className="border border-border rounded-lg p-4 bg-card">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${identityVerification.ai_face_match_score >= 0.9 ? 'bg-green-500/10' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'bg-yellow-500/10' : 'bg-red-500/10'
                        }`}>
                        <Camera className={`h-5 w-5 ${identityVerification.ai_face_match_score >= 0.9 ? 'text-green-500' :
                          identityVerification.ai_face_match_score >= 0.7 ? 'text-yellow-500' : 'text-red-500'
                          }`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Face Match Score</p>
                        <p className="text-xs text-muted-foreground">AI Biometric Verification</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${identityVerification.ai_face_match_score >= 0.9 ? 'text-green-500' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'text-yellow-500' : 'text-red-500'
                        }`}>
                        {(identityVerification.ai_face_match_score * 100).toFixed(1)}%
                      </p>
                      <p className={`text-xs font-medium ${identityVerification.ai_face_match_score >= 0.9 ? 'text-green-500' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'text-yellow-500' : 'text-red-500'
                        }`}>
                        {identityVerification.ai_face_match_score >= 0.9 ? 'Excellent Match' :
                          identityVerification.ai_face_match_score >= 0.7 ? 'Needs Review' : 'Low Match'}
                      </p>
                    </div>
                  </div>
                  <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`absolute left-0 top-0 h-full rounded-full transition-all ${identityVerification.ai_face_match_score >= 0.9 ? 'bg-green-500' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                      style={{ width: `${identityVerification.ai_face_match_score * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Extracted Person Info */}
              {(identityVerification.first_name || identityVerification.last_name || identityVerification.date_of_birth) && (
                <div className="bg-muted/50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <IdCard className="h-4 w-4" />
                    Verified Identity
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    {identityVerification.first_name && (
                      <div>
                        <span className="text-muted-foreground">First Name:</span>
                        <p className="font-medium">{identityVerification.first_name}</p>
                      </div>
                    )}
                    {identityVerification.last_name && (
                      <div>
                        <span className="text-muted-foreground">Last Name:</span>
                        <p className="font-medium">{identityVerification.last_name}</p>
                      </div>
                    )}
                    {identityVerification.date_of_birth && (
                      <div>
                        <span className="text-muted-foreground">Date of Birth:</span>
                        <p className="font-medium">{new Date(identityVerification.date_of_birth).toLocaleDateString()}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Document Info */}
              {(identityVerification.document_type || identityVerification.document_number || identityVerification.document_country) && (
                <div className="bg-muted/50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Document Details
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    {identityVerification.document_type && (
                      <div>
                        <span className="text-muted-foreground">Type:</span>
                        <p className="font-medium capitalize">{identityVerification.document_type.replace(/_/g, ' ')}</p>
                      </div>
                    )}
                    {identityVerification.document_number && (
                      <div>
                        <span className="text-muted-foreground">Number:</span>
                        <p className="font-medium font-mono">{identityVerification.document_number}</p>
                      </div>
                    )}
                    {identityVerification.document_country && (
                      <div>
                        <span className="text-muted-foreground">Country:</span>
                        <p className="font-medium">{identityVerification.document_country}</p>
                      </div>
                    )}
                    {identityVerification.document_expiry_date && (
                      <div>
                        <span className="text-muted-foreground">Expiry:</span>
                        <p className="font-medium">{new Date(identityVerification.document_expiry_date).toLocaleDateString()}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Document Images */}
              {(identityVerification.document_front_url || identityVerification.document_back_url || identityVerification.selfie_image_url) && (
                <div className="bg-muted/50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Verification Images
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {identityVerification.document_front_url && (
                      <div className="space-y-2">
                        <span className="text-sm text-muted-foreground">ID Front</span>
                        <div className="relative aspect-[3/2] bg-black/5 rounded-lg overflow-hidden border">
                          <img
                            src={identityVerification.document_front_url}
                            alt="ID Front"
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                            Image unavailable
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => window.open(identityVerification.document_front_url, '_blank')}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View Full Size
                        </Button>
                      </div>
                    )}
                    {identityVerification.document_back_url && (
                      <div className="space-y-2">
                        <span className="text-sm text-muted-foreground">ID Back</span>
                        <div className="relative aspect-[3/2] bg-black/5 rounded-lg overflow-hidden border">
                          <img
                            src={identityVerification.document_back_url}
                            alt="ID Back"
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                            Image unavailable
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => window.open(identityVerification.document_back_url, '_blank')}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View Full Size
                        </Button>
                      </div>
                    )}
                    {identityVerification.selfie_image_url && (
                      <div className="space-y-2">
                        <span className="text-sm text-muted-foreground">Selfie</span>
                        <div className="relative aspect-[3/4] bg-black/5 rounded-lg overflow-hidden border">
                          <img
                            src={identityVerification.selfie_image_url}
                            alt="Selfie"
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                            Image unavailable
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => window.open(identityVerification.selfie_image_url, '_blank')}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View Full Size
                        </Button>
                      </div>
                    )}
                  </div>
                  {identityVerification.media_fetched_at && (
                    <p className="text-xs text-muted-foreground mt-3">
                      Images fetched: {new Date(identityVerification.media_fetched_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {/* Rejection Reason */}
              {identityVerification.rejection_reason && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Rejection Reason:</strong> {identityVerification.rejection_reason}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Empty state when no verification data */}
          {!identityVerification && !isLoadingVerification && (
            <div className="space-y-4">
              <div className="text-center py-4 text-muted-foreground">
                <UserCheck className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No identity verification linked</p>
                <p className="text-sm mt-1">
                  This customer hasn't completed Veriff identity verification yet, or the verification is not linked to this customer.
                </p>
              </div>

              {/* Show unlinked verifications if available */}
              {unlinkedVerifications && unlinkedVerifications.length > 0 && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    Unlinked Verifications Found ({unlinkedVerifications.length})
                  </h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    The following verifications are not linked to any customer. If one belongs to <strong>{rental?.customers?.name}</strong>, click "Link" to connect it.
                  </p>
                  <div className="space-y-2">
                    {unlinkedVerifications.map((verif: any) => (
                      <div
                        key={verif.id}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border"
                      >
                        <div className="flex items-center gap-4">
                          <div>
                            {verif.review_result === 'GREEN' ? (
                              <Badge className="bg-green-600" variant="default">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Verified
                              </Badge>
                            ) : verif.review_result === 'RED' ? (
                              <Badge variant="destructive">
                                <XCircle className="h-3 w-3 mr-1" />
                                Declined
                              </Badge>
                            ) : (
                              <Badge variant="outline">Pending</Badge>
                            )}
                          </div>
                          <div>
                            <p className="font-medium">
                              {verif.first_name || ''} {verif.last_name || ''}
                              {!verif.first_name && !verif.last_name && <span className="text-muted-foreground italic">Name not extracted</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {verif.document_type ? verif.document_type.replace(/_/g, ' ') : 'Document type unknown'}
                              {verif.document_country && ` • ${verif.document_country}`}
                              {verif.created_at && ` • ${new Date(verif.created_at).toLocaleDateString()}`}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => linkVerificationMutation.mutate(verif.id)}
                          disabled={linkVerificationMutation.isPending}
                          className="border-blue-300 text-blue-600 hover:bg-blue-50"
                        >
                          {linkVerificationMutation.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <CheckCircle className="h-3 w-3 mr-1" />
                          )}
                          Link
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Loading state */}
          {isLoadingVerification && (
            <div className="text-center py-8 text-muted-foreground">
              <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin" />
              <p className="text-sm">Loading verification data...</p>
            </div>
          )}
        </CardContent>
      </Card>

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
