"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { FileText, ArrowLeft, DollarSign, Plus, X, Send, Download, Ban, Check, AlertTriangle, Loader2, Shield, CheckCircle, XCircle, ExternalLink, UserCheck, IdCard, Camera, FileSignature, Clock, Mail, RefreshCw, Trash2 } from "lucide-react";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { isInsuranceExemptTenant } from "@/config/tenant-config";
import { useRentalTotals } from "@/hooks/use-rental-ledger-data";
import { RentalLedger } from "@/components/rentals/rental-ledger";
import { KeyHandoverSection } from "@/components/rentals/key-handover-section";
import { KeyHandoverActionBanner } from "@/components/rentals/key-handover-action-banner";
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
  docusign_envelope_id?: string;
  signed_document_id?: string;
  insurance_status?: string;
  payment_mode?: string;
  approval_status?: string;
  payment_status?: string;
  cancellation_reason?: string;
  customer_id?: string;
  customers: { id: string; name: string; email?: string; phone?: string | null };
  vehicles: { id: string; reg: string; make: string; model: string; status?: string };
}

const RentalDetail = () => {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const skipInsurance = isInsuranceExemptTenant(tenant?.id);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [sendingDocuSign, setSendingDocuSign] = useState(false);
  const [checkingDocuSignStatus, setCheckingDocuSignStatus] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showRejectionDialog, setShowRejectionDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showDocuSignWarning, setShowDocuSignWarning] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [loadingDocuSignDoc, setLoadingDocuSignDoc] = useState(false);


  const { data: rental, isLoading, error: rentalError } = useQuery({
    queryKey: ["rental", id, tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error("No tenant context");

      const { data, error } = await supabase
        .from("rentals")
        .select(`
          *,
          customers!rentals_customer_id_fkey(id, name, email, phone),
          vehicles!rentals_vehicle_id_fkey(id, reg, make, model, status)
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

  // Fetch key handover status for approval check
  const { data: keyHandoverStatus } = useQuery({
    queryKey: ["key-handover-status", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_key_handovers")
        .select("id, handover_type, handed_at")
        .eq("rental_id", id)
        .eq("handover_type", "giving")
        .maybeSingle();

      if (error) {
        console.error("Error fetching key handover:", error);
        return null;
      }
      return data;
    },
    enabled: !!id,
  });

  const isKeyHandoverCompleted = !!keyHandoverStatus?.handed_at;

  // Sync DB status to 'Active' if all conditions are met but DB status is still 'Pending'
  // This handles edge cases where the status update might have failed
  useEffect(() => {
    const syncStatusToActive = async () => {
      if (!rental || !tenant?.id) return;

      // Check if rental should be Active but DB status is not
      const shouldBeActive =
        rental.status !== 'Active' &&
        rental.status !== 'Closed' &&
        rental.status !== 'Cancelled' &&
        rental.approval_status === 'approved' &&
        rental.payment_status === 'fulfilled' &&
        isKeyHandoverCompleted;

      if (shouldBeActive) {
        console.log('Syncing rental status to Active (was:', rental.status, ')');
        const { error } = await supabase
          .from('rentals')
          .update({ status: 'Active', updated_at: new Date().toISOString() })
          .eq('id', rental.id)
          .eq('tenant_id', tenant.id);

        if (error) {
          console.error('Failed to sync status:', error);
        } else {
          // Invalidate queries to refresh the data
          queryClient.invalidateQueries({ queryKey: ['rental', rental.id] });
          queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
          queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
        }
      }
    };

    syncStatusToActive();
  }, [rental?.id, rental?.status, rental?.approval_status, rental?.payment_status, isKeyHandoverCompleted, tenant?.id]);

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
  const { data: insuranceDocuments } = useQuery({
    queryKey: ["rental-insurance-docs", id, rental?.customers?.id, tenant?.id],
    queryFn: async () => {
      // Collect all potential document IDs to avoid showing duplicates
      const seenDocIds = new Set<string>();
      const allDocs: any[] = [];

      // First try to find by rental_id (direct link) - highest priority
      if (tenant?.id) {
        const { data: rentalDocs } = await supabase
          .from("customer_documents")
          .select("*")
          .eq("rental_id", id)
          .eq("document_type", "Insurance Certificate")
          .eq("tenant_id", tenant.id)
          .order("uploaded_at", { ascending: false });

        if (rentalDocs && rentalDocs.length > 0) {
          rentalDocs.forEach(doc => {
            if (!seenDocIds.has(doc.id)) {
              seenDocIds.add(doc.id);
              allDocs.push(doc);
            }
          });
        }
      }

      // Then try by customer_id (exclude documents already linked to OTHER rentals)
      if (rental?.customers?.id && tenant?.id) {
        const { data: customerDocs } = await supabase
          .from("customer_documents")
          .select("*")
          .eq("customer_id", rental.customers.id)
          .eq("document_type", "Insurance Certificate")
          .eq("tenant_id", tenant.id)
          .is("rental_id", null) // Only show if not linked to a rental yet
          .order("uploaded_at", { ascending: false });

        if (customerDocs && customerDocs.length > 0) {
          customerDocs.forEach(doc => {
            if (!seenDocIds.has(doc.id)) {
              seenDocIds.add(doc.id);
              allDocs.push(doc);
            }
          });
        }
      }

      // Fallback: Show unlinked insurance documents for this tenant ONLY if no docs found yet
      if (allDocs.length === 0 && tenant?.id) {
        const { data: unlinkedDocs } = await supabase
          .from("customer_documents")
          .select("*, customers!customer_documents_customer_id_fkey(email)")
          .eq("document_type", "Insurance Certificate")
          .eq("tenant_id", tenant.id)
          .is("rental_id", null)
          .is("customer_id", null)
          .order("uploaded_at", { ascending: false })
          .limit(10);

        // Mark these as unlinked so UI can show appropriate message
        if (unlinkedDocs && unlinkedDocs.length > 0) {
          unlinkedDocs.forEach(doc => {
            if (!seenDocIds.has(doc.id)) {
              seenDocIds.add(doc.id);
              allDocs.push({ ...doc, isUnlinked: true });
            }
          });
        }
      }

      console.log(`[RENTAL-DOCS] Found ${allDocs.length} unique insurance documents for rental ${id}`);
      return allDocs;
    },
    enabled: !!id && !!tenant?.id,
  });

  // Fetch identity verification for this customer (by customer_id or by email)
  const { data: identityVerification, isLoading: isLoadingVerification } = useQuery({
    queryKey: ["customer-identity-verification", rental?.customers?.id, rental?.customers?.email, tenant?.id],
    queryFn: async () => {
      if (!rental?.customers?.id) return null;

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
      }

      if (data) {
        return data;
      }

      // Fallback: look by customer email if no verification linked by customer_id
      if (rental.customers?.email) {
        const customerEmail = rental.customers.email.toLowerCase().trim();
        const { data: emailData, error: emailError } = await supabase
          .from("identity_verifications")
          .select("*")
          .eq("customer_email", customerEmail)
          .is("customer_id", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (emailError) {
          console.error("Error fetching identity verification by email:", emailError);
          return null;
        }

        if (emailData) {
          // Auto-link this verification to the customer
          await supabase
            .from("identity_verifications")
            .update({ customer_id: rental.customers.id, tenant_id: tenant?.id })
            .eq("id", emailData.id);

          // Update customer's verification status
          const status = emailData.review_result === 'GREEN' ? 'verified' :
                         emailData.review_result === 'RED' ? 'rejected' : 'pending';
          await supabase
            .from("customers")
            .update({ identity_verification_status: status })
            .eq("id", rental.customers.id);

          return { ...emailData, customer_id: rental.customers.id };
        }
      }

      return null;
    },
    enabled: !!rental?.customers?.id,
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

  // Compute rental status based on approval_status, payment_status, AND key handover
  const computeStatus = (rental: Rental): string => {
    if (rental.status === 'Cancelled') return 'Cancelled';
    if (rental.status === 'Closed') return 'Closed';
    if (rental.approval_status === 'rejected') return 'Rejected';

    // Only show as Active if ALL conditions are met:
    // 1. approval_status is approved
    // 2. payment_status is fulfilled
    // 3. key handover is completed
    if (rental.approval_status === 'approved' && rental.payment_status === 'fulfilled' && isKeyHandoverCompleted) {
      return 'Active';
    }

    // Otherwise show as Pending
    return 'Pending';
  };

  const displayStatus = computeStatus(rental);

  // Check if DocuSign is signed
  const isDocuSignSigned = rental?.document_status === 'completed' || rental?.document_status === 'signed';
  const hasDocuSign = !!rental?.docusign_envelope_id;

  // Handle Approve button click - check DocuSign first
  const handleApproveClick = () => {
    if (hasDocuSign && !isDocuSignSigned) {
      // DocuSign sent but not signed - show warning
      setShowDocuSignWarning(true);
    } else {
      // No DocuSign or already signed - proceed to approval
      setShowApproveDialog(true);
    }
  };

  // Function to view DocuSign agreement
  const handleViewAgreement = async () => {
    setLoadingDocuSignDoc(true);

    // Open window immediately to avoid popup blocker
    const newWindow = window.open('about:blank', '_blank');

    try {
      // If we have a signed document, open it directly
      if (signedDocument?.file_url) {
        const { data } = supabase.storage
          .from('customer-documents')
          .getPublicUrl(signedDocument.file_url);
        if (newWindow) {
          newWindow.location.href = data.publicUrl;
        }
        return;
      }

      // Show loading message in new window
      if (newWindow) {
        newWindow.document.write('<html><head><title>Loading Agreement...</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:system-ui;"><p>Loading agreement...</p></body></html>');
      }

      // Fetch from DocuSign via local API route
      const response = await fetch('/api/docusign/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalId: id,
          envelopeId: rental?.docusign_envelope_id
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        if (newWindow) newWindow.close();
        toast({
          title: "Error",
          description: data?.error || "Failed to get document",
          variant: "destructive",
        });
        return;
      }

      // If we got a stored URL, redirect to it
      if (data.documentUrl) {
        if (newWindow) {
          newWindow.location.href = data.documentUrl;
        }
        return;
      }

      // If we got base64 PDF, create blob and display
      if (data.documentBase64) {
        const byteCharacters = atob(data.documentBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        if (newWindow) {
          newWindow.location.href = url;
        }
      }
    } catch (err: any) {
      if (newWindow) newWindow.close();
      toast({
        title: "Error",
        description: err?.message || "Failed to view agreement",
        variant: "destructive",
      });
    } finally {
      setLoadingDocuSignDoc(false);
    }
  };

  const getStatusVariant = (status: string) => {
    if (status === 'Active') return 'default';
    if (status === 'Closed') return 'secondary';
    if (status === 'Pending') return 'outline';
    return 'outline';
  };


  // Determine if key handover needs action (approved + fulfilled but not handed over)
  const needsKeyHandover = rental?.approval_status === 'approved' && rental?.payment_status === 'fulfilled' && !isKeyHandoverCompleted;

  return (
    <div className="space-y-6 py-[24px] px-[8px]">
      {/* Key Handover Action Banner */}
      <KeyHandoverActionBanner
        show={needsKeyHandover}
        customerName={rental?.customers?.name}
        vehicleInfo={rental?.vehicles ? `${rental.vehicles.make} ${rental.vehicles.model} • ${rental.vehicles.reg}` : undefined}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => router.push("/rentals")}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Back to Rentals</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div>
            <h1 className="text-3xl font-bold">Rental Agreement</h1>
            <p className="text-muted-foreground">
              {rental.customers?.name} • {rental.vehicles?.reg}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {/* Pending Rental - Show Approve, Reject, Delete buttons */}
          {displayStatus === 'Pending' && (
            <>
              <Button
                variant="default"
                className="bg-green-600 hover:bg-green-700"
                onClick={handleApproveClick}
                disabled={rental.approval_status === 'approved'}
              >
                <Check className="h-4 w-4 mr-2" />
                {rental.approval_status === 'approved' ? 'Approved' : 'Approve'}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowRejectionDialog(true)}
                disabled={rental.approval_status === 'approved'}
              >
                <Ban className="h-4 w-4 mr-2" />
                Reject
              </Button>
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </>
          )}

          {/* Active Rental - Show Add Payment, Add Fine, Close, Cancel, Delete buttons */}
          {displayStatus === 'Active' && (
            <>
              <Button variant="outline" onClick={() => setShowAddPayment(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Payment
              </Button>
              <Button variant="outline" onClick={() => router.push(`/fines/new?rental_id=${rental.id}&customer_id=${rental.customers?.id}&vehicle_id=${rental.vehicles?.id}`)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Fine
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCloseDialog(true)}
              >
                <X className="h-4 w-4 mr-2" />
                Close
              </Button>
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => setShowCancelDialog(true)}
              >
                <Ban className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </>
          )}

          {/* Closed/Cancelled/Rejected Rental - Show Delete button */}
          {(displayStatus === 'Closed' || displayStatus === 'Cancelled' || displayStatus === 'Rejected') && (
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Rental Summary */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Total Paid</CardTitle>
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
        <CardContent className="space-y-6">
          {/* Customer & Vehicle Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-muted/30 rounded-lg p-4 space-y-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Customer</p>
              <p className="text-lg font-semibold">{rental.customers?.name}</p>
              {identityVerification?.date_of_birth && (
                <p className="text-sm text-muted-foreground">
                  DOB: {new Date(identityVerification.date_of_birth).toLocaleDateString()} ({Math.floor((Date.now() - new Date(identityVerification.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} yrs)
                </p>
              )}
            </div>
            <div className="bg-muted/30 rounded-lg p-4 space-y-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Vehicle</p>
              <p className="text-lg font-semibold">{rental.vehicles?.reg}</p>
              <p className="text-sm text-muted-foreground">{rental.vehicles?.make} {rental.vehicles?.model}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-4 space-y-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{rental.rental_period_type || 'Monthly'} Amount</p>
              <p className="text-lg font-semibold">${Number(rental.monthly_amount).toLocaleString()}</p>
            </div>
          </div>

          {/* Rental Period */}
          <div className="border rounded-lg p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Rental Period</p>
            <div className="grid grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Start Date</p>
                <p className="text-base font-medium">{new Date(rental.start_date).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">End Date</p>
                <p className="text-base font-medium">{new Date(rental.end_date).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Period Type</p>
                <Badge variant="outline" className="mt-1">{rental.rental_period_type || 'Monthly'}</Badge>
              </div>
            </div>
          </div>

          {/* Status Overview */}
          <div className="border rounded-lg p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Status Overview</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-3 bg-muted/20 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">Rental</p>
                <Badge
                  variant="outline"
                  className={
                    displayStatus === 'Active'
                      ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800'
                      : displayStatus === 'Closed'
                      ? 'bg-slate-800/50 text-slate-300 border-slate-700'
                      : displayStatus === 'Cancelled' || displayStatus === 'Rejected'
                      ? 'bg-red-950/50 text-red-300 border-red-800'
                      : 'bg-amber-950/50 text-amber-300 border-amber-800'
                  }
                >
                  {displayStatus}
                </Badge>
              </div>
              <div className="text-center p-3 bg-muted/20 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">Approval</p>
                <Badge
                  variant="outline"
                  className={
                    rental.approval_status === 'approved'
                      ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800'
                      : rental.approval_status === 'rejected'
                      ? 'bg-red-950/50 text-red-300 border-red-800'
                      : 'bg-amber-950/50 text-amber-300 border-amber-800'
                  }
                >
                  {rental.approval_status === 'approved' ? 'Approved' : rental.approval_status === 'rejected' ? 'Rejected' : 'Pending'}
                </Badge>
              </div>
              <div className="text-center p-3 bg-muted/20 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">Payment</p>
                <Badge
                  variant="outline"
                  className={
                    rental.payment_status === 'fulfilled'
                      ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800'
                      : rental.payment_status === 'refunded'
                      ? 'bg-orange-950/50 text-orange-300 border-orange-800'
                      : rental.payment_status === 'failed'
                      ? 'bg-red-950/50 text-red-300 border-red-800'
                      : 'bg-amber-950/50 text-amber-300 border-amber-800'
                  }
                >
                  {rental.payment_status === 'fulfilled' ? 'Fulfilled' : rental.payment_status === 'refunded' ? 'Refunded' : rental.payment_status === 'failed' ? 'Failed' : 'Pending'}
                </Badge>
              </div>
              <div className="text-center p-3 bg-muted/20 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">Vehicle</p>
                <Badge
                  variant="outline"
                  className={
                    rental.vehicles?.status === 'Available'
                      ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800'
                      : rental.vehicles?.status === 'Rented'
                      ? 'bg-sky-950/50 text-sky-300 border-sky-800'
                      : 'bg-slate-800/50 text-slate-300 border-slate-700'
                  }
                >
                  {rental.vehicles?.status || 'Unknown'}
                </Badge>
              </div>
              <div className="text-center p-3 bg-muted/20 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">Payment Mode</p>
                <Badge
                  variant="outline"
                  className={rental.payment_mode === 'auto'
                    ? 'bg-sky-950/50 text-sky-300 border-sky-800'
                    : 'bg-slate-800/50 text-slate-300 border-slate-700'}
                >
                  {rental.payment_mode === 'auto' ? 'Auto' : 'Manual'}
                </Badge>
              </div>
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
              {/* View Agreement Button - works for both pending and signed */}
              {(rental.document_status === 'sent' || rental.document_status === 'delivered' || rental.document_status === 'viewed' || rental.document_status === 'signed' || rental.document_status === 'completed' || signedDocument) && (
                <Button
                  variant="outline"
                  onClick={handleViewAgreement}
                  disabled={loadingDocuSignDoc}
                >
                  {loadingDocuSignDoc ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ExternalLink className="h-4 w-4 mr-2" />
                  )}
                  {signedDocument || rental.document_status === 'completed' || rental.document_status === 'signed'
                    ? 'View Signed Agreement'
                    : 'View Agreement'}
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
                        queryClient.invalidateQueries({ queryKey: ["rental", id, tenant?.id] });
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
              {rental.docusign_envelope_id && rental.document_status !== 'signed' && !rental.signed_document_id && (
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
                          envelopeId: rental.docusign_envelope_id,
                        }),
                      });

                      const statusData = await response.json();

                      if (statusData?.ok) {
                        toast({
                          title: "Status Updated",
                          description: `Document status: ${statusData.status}`,
                        });
                        queryClient.invalidateQueries({ queryKey: ["rental", id, tenant?.id] });
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

      {/* Insurance Verification Card - Hidden for insurance-exempt tenants like Kedic Services */}
      {!skipInsurance && (
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
                  const confidenceScore = doc.ai_confidence_score || 0;
                  const extractedData = doc.ai_extracted_data || {};
                  const verificationDecision = doc.verification_decision || extractedData?.verificationDecision;
                  const reviewReasons = doc.review_reasons || extractedData?.reviewReasons || [];
                  const fraudRiskScore = doc.fraud_risk_score ?? extractedData?.fraudRiskScore;

                  const getScoreColor = (score: number) => {
                    if (score >= 0.85) return 'green';
                    if (score >= 0.60) return 'yellow';
                    return 'red';
                  };

                  const getScoreLabel = (score: number) => {
                    if (score >= 0.85) return 'Verified';
                    if (score >= 0.60) return 'Review Needed';
                    return 'Low Confidence';
                  };

                  const getDecisionDisplay = (decision: string | undefined) => {
                    switch (decision) {
                      case 'auto_approved':
                        return { label: 'Auto-Approved', color: 'bg-green-600', icon: CheckCircle };
                      case 'auto_rejected':
                        return { label: 'Rejected', color: 'bg-red-600', icon: XCircle };
                      case 'pending_review':
                        return { label: 'Pending Review', color: 'bg-yellow-600', icon: AlertTriangle };
                      case 'manually_approved':
                        return { label: 'Manually Approved', color: 'bg-green-600', icon: CheckCircle };
                      case 'manually_rejected':
                        return { label: 'Manually Rejected', color: 'bg-red-600', icon: XCircle };
                      default:
                        return null;
                    }
                  };

                  const decisionDisplay = getDecisionDisplay(verificationDecision);
                  const scoreColor = getScoreColor(validationScore);

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

                      {/* Document Info Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{doc.file_name || doc.document_name}</span>
                          {doc.isUnlinked && (
                            <Badge variant="outline" className="text-yellow-600 border-yellow-500">Unlinked</Badge>
                          )}
                          {/* Verification Decision Badge */}
                          {decisionDisplay && (
                            <Badge className={decisionDisplay.color}>
                              <decisionDisplay.icon className="h-3 w-3 mr-1" />
                              {decisionDisplay.label}
                            </Badge>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          Uploaded: {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : 'N/A'}
                        </span>
                      </div>

                      {/* Fraud Risk Warning */}
                      {fraudRiskScore !== undefined && fraudRiskScore >= 0.5 && (
                        <Alert className="border-red-500/50 bg-red-500/10">
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                          <AlertDescription className="text-sm text-red-700">
                            <strong>High Fraud Risk ({Math.round(fraudRiskScore * 100)}%):</strong> This document has been flagged for additional verification.
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Review Reasons */}
                      {reviewReasons && reviewReasons.length > 0 && (
                        <Alert className="border-yellow-500/50 bg-yellow-500/10">
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                          <AlertDescription className="text-sm">
                            <strong className="text-yellow-700">Review Required:</strong>
                            <ul className="list-disc list-inside mt-1 text-yellow-700">
                              {reviewReasons.map((reason: string, i: number) => (
                                <li key={i}>{reason}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Validation Score Card - similar to Face Match Score */}
                      {doc.ai_scan_status === 'completed' && doc.ai_validation_score !== null && (
                        <div className="border border-border rounded-lg p-4 bg-card">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                scoreColor === 'green' ? 'bg-green-500/10' :
                                scoreColor === 'yellow' ? 'bg-yellow-500/10' : 'bg-red-500/10'
                              }`}>
                                <Shield className={`h-5 w-5 ${
                                  scoreColor === 'green' ? 'text-green-500' :
                                  scoreColor === 'yellow' ? 'text-yellow-500' : 'text-red-500'
                                }`} />
                              </div>
                              <div>
                                <p className="text-sm font-medium">Validation Score</p>
                                <p className="text-xs text-muted-foreground">AI Document Verification</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-2xl font-bold ${
                                scoreColor === 'green' ? 'text-green-500' :
                                scoreColor === 'yellow' ? 'text-yellow-500' : 'text-red-500'
                              }`}>
                                {(validationScore * 100).toFixed(0)}%
                              </p>
                              <p className={`text-xs font-medium ${
                                scoreColor === 'green' ? 'text-green-500' :
                                scoreColor === 'yellow' ? 'text-yellow-500' : 'text-red-500'
                              }`}>
                                {getScoreLabel(validationScore)}
                              </p>
                            </div>
                          </div>
                          <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                                scoreColor === 'green' ? 'bg-green-500' :
                                scoreColor === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${validationScore * 100}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Scan Status Indicators */}
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
                          {extractedData.policyHolderName && (
                            <div>
                              <span className="text-muted-foreground">Policy Holder:</span>{' '}
                              <span className="font-medium">{extractedData.policyHolderName}</span>
                            </div>
                          )}
                          {extractedData.coverageType && (
                            <div>
                              <span className="text-muted-foreground">Coverage Type:</span>{' '}
                              <span className="font-medium">{extractedData.coverageType}</span>
                            </div>
                          )}
                          {(extractedData.effectiveDate || extractedData.startDate) && (
                            <div>
                              <span className="text-muted-foreground">Effective Date:</span>{' '}
                              <span className="font-medium">{extractedData.effectiveDate || extractedData.startDate}</span>
                            </div>
                          )}
                          {(extractedData.expirationDate || extractedData.endDate) && (
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">Expiration Date:</span>{' '}
                              <span className="font-medium">{extractedData.expirationDate || extractedData.endDate}</span>
                              {extractedData.isExpired && (
                                <Badge variant="destructive" className="text-xs ml-1">EXPIRED</Badge>
                              )}
                            </div>
                          )}
                          {extractedData.documentType && (
                            <div>
                              <span className="text-muted-foreground">Document Type:</span>{' '}
                              <span className="font-medium">{extractedData.documentType}</span>
                            </div>
                          )}
                          {extractedData.coverageLimits?.liability && (
                            <div>
                              <span className="text-muted-foreground">Liability:</span>{' '}
                              <span className="font-medium">${extractedData.coverageLimits.liability.toLocaleString()}</span>
                            </div>
                          )}
                          {extractedData.coverageLimits?.collision && (
                            <div>
                              <span className="text-muted-foreground">Collision:</span>{' '}
                              <span className="font-medium">${extractedData.coverageLimits.collision.toLocaleString()}</span>
                            </div>
                          )}
                          {extractedData.coverageLimits?.comprehensive && (
                            <div>
                              <span className="text-muted-foreground">Comprehensive:</span>{' '}
                              <span className="font-medium">${extractedData.coverageLimits.comprehensive.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                        {/* Confidence and validation notes */}
                        <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
                          {confidenceScore > 0 && (
                            <span>Extraction Confidence: {Math.round(confidenceScore * 100)}%</span>
                          )}
                          {extractedData.isValidDocument !== undefined && (
                            <span className={extractedData.isValidDocument ? 'text-green-600' : 'text-red-600'}>
                              {extractedData.isValidDocument ? 'Valid Document' : 'Document Issues Detected'}
                            </span>
                          )}
                        </div>
                        {/* Validation Notes */}
                        {extractedData.validationNotes && Array.isArray(extractedData.validationNotes) && extractedData.validationNotes.length > 0 && (
                          <div className="text-xs text-muted-foreground pt-1">
                            <span className="font-medium">Notes:</span> {extractedData.validationNotes.join(', ')}
                          </div>
                        )}
                      </div>
                    )}

                    {/* AI Scan Errors */}
                    {doc.ai_scan_errors && Array.isArray(doc.ai_scan_errors) && doc.ai_scan_errors.length > 0 && (
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
      )}

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
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        identityVerification.ai_face_match_score >= 0.9 ? 'bg-green-500/10' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'bg-yellow-500/10' : 'bg-red-500/10'
                      }`}>
                        <Camera className={`h-5 w-5 ${
                          identityVerification.ai_face_match_score >= 0.9 ? 'text-green-500' :
                          identityVerification.ai_face_match_score >= 0.7 ? 'text-yellow-500' : 'text-red-500'
                        }`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Face Match Score</p>
                        <p className="text-xs text-muted-foreground">AI Biometric Verification</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${
                        identityVerification.ai_face_match_score >= 0.9 ? 'text-green-500' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'text-yellow-500' : 'text-red-500'
                      }`}>
                        {(identityVerification.ai_face_match_score * 100).toFixed(1)}%
                      </p>
                      <p className={`text-xs font-medium ${
                        identityVerification.ai_face_match_score >= 0.9 ? 'text-green-500' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'text-yellow-500' : 'text-red-500'
                      }`}>
                        {identityVerification.ai_face_match_score >= 0.9 ? 'Excellent Match' :
                         identityVerification.ai_face_match_score >= 0.7 ? 'Needs Review' : 'Low Match'}
                      </p>
                    </div>
                  </div>
                  <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                        identityVerification.ai_face_match_score >= 0.9 ? 'bg-green-500' :
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {identityVerification.document_front_url && (
                      <div className="space-y-2">
                        <span className="text-sm text-muted-foreground">ID Front</span>
                        <div className="relative aspect-square rounded-lg overflow-hidden border">
                          <img
                            src={identityVerification.document_front_url}
                            alt="ID Front"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-sm">
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
                        <div className="relative aspect-square rounded-lg overflow-hidden border">
                          <img
                            src={identityVerification.document_back_url}
                            alt="ID Back"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-sm">
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
                        <div className="relative aspect-square rounded-lg overflow-hidden border">
                          <img
                            src={identityVerification.selfie_image_url}
                            alt="Selfie"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-sm">
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
            <div className="text-center py-4 text-muted-foreground">
              <UserCheck className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No identity verification found</p>
              <p className="text-sm mt-1">
                This customer hasn't completed identity verification yet.
              </p>
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
      {id && (
        <KeyHandoverSection
          rentalId={id}
          rentalStatus={displayStatus}
          needsAction={needsKeyHandover}
        />
      )}

      {/* Enhanced Ledger */}
      <div id="ledger">
        {id && <RentalLedger rentalId={id} />}
      </div>

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

      {/* DocuSign Not Signed Warning Dialog */}
      <AlertDialog open={showDocuSignWarning} onOpenChange={setShowDocuSignWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              DocuSign Not Signed
            </AlertDialogTitle>
            <AlertDialogDescription>
              The rental agreement has been sent but has not been signed by the customer yet.
              <span className="block mt-2 font-medium">
                Do you still want to approve this booking without a signed agreement?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, Wait for Signature</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => {
                setShowDocuSignWarning(false);
                setShowApproveDialog(true);
              }}
            >
              Yes, Approve Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Approve Confirmation Dialog */}
      <AlertDialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Booking</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to approve this booking for {rental?.customers?.name}?
              {rental?.payment_mode === 'manual' && rental?.payment_status === 'pending' && (
                <span className="block mt-2 text-amber-600">
                  This will capture the payment hold on the customer's card.
                </span>
              )}
              {!isKeyHandoverCompleted ? (
                <span className="block mt-2 text-blue-500">
                  <strong>Note:</strong> The rental will remain "Pending" until key handover is completed.
                </span>
              ) : (
                <span className="block mt-2">
                  The rental will become active and the customer will be notified.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isApproving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isApproving}
              onClick={async (e) => {
                e.preventDefault();
                setIsApproving(true);
                try {
                  // For manual mode with pending payment, capture first
                  if (rental?.payment_mode === 'manual' && rental?.payment_status === 'pending' && payment?.capture_status === 'requires_capture') {
                    const { error: captureError } = await supabase.functions.invoke('capture-payment', {
                      body: {
                        paymentId: payment.id,
                        rentalId: id,
                      }
                    });
                    if (captureError) throw captureError;
                  }

                  // Query DB directly for key handover status (don't rely on React Query cache)
                  const { data: keyHandover } = await supabase
                    .from('rental_key_handovers')
                    .select('handed_at')
                    .eq('rental_id', id)
                    .eq('handover_type', 'giving')
                    .maybeSingle();

                  const keyHandoverDone = !!keyHandover?.handed_at;

                  // Update rental - only set to Active if key handover is also completed
                  const rentalUpdateData: any = {
                    approval_status: 'approved',
                    payment_status: 'fulfilled',
                    updated_at: new Date().toISOString(),
                  };

                  // Only set status to Active if key handover is completed
                  if (keyHandoverDone) {
                    rentalUpdateData.status = 'Active';
                  }

                  await supabase
                    .from('rentals')
                    .update(rentalUpdateData)
                    .eq('id', id);

                  // Send approval email
                  await supabase.functions.invoke('notify-booking-approved', {
                    body: {
                      customerEmail: rental?.customers?.email,
                      customerName: rental?.customers?.name,
                      vehicleName: `${rental?.vehicles?.make} ${rental?.vehicles?.model}`,
                      bookingRef: id.substring(0, 8).toUpperCase(),
                      pickupDate: rental?.start_date,
                      returnDate: rental?.end_date,
                    }
                  }).catch(err => console.warn('Failed to send approval email:', err));

                  // If rental became Active (key handover was already done), send rental started notification
                  if (keyHandoverDone) {
                    await supabase.functions.invoke('notify-rental-started', {
                      body: {
                        customerName: rental?.customers?.name,
                        customerEmail: rental?.customers?.email,
                        customerPhone: rental?.customers?.phone,
                        vehicleName: `${rental?.vehicles?.make} ${rental?.vehicles?.model}`,
                        vehicleReg: rental?.vehicles?.reg,
                        vehicleMake: rental?.vehicles?.make,
                        vehicleModel: rental?.vehicles?.model,
                        bookingRef: id.substring(0, 8).toUpperCase(),
                        startDate: rental?.start_date ? new Date(rental.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
                        endDate: rental?.end_date ? new Date(rental.end_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
                        tenantId: tenant?.id,
                      }
                    }).catch(err => console.warn('Failed to send rental started email:', err));
                  }

                  toast({
                    title: "Booking Approved",
                    description: keyHandoverDone
                      ? "Rental is now active and customer notified"
                      : "Booking approved. Rental will become active after key handover.",
                  });

                  queryClient.invalidateQueries({ queryKey: ['rental', id, tenant?.id] });
                  queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
                  queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
                  queryClient.invalidateQueries({ queryKey: ['rental-payment', id, tenant?.id] });
                  queryClient.invalidateQueries({ queryKey: ['key-handover-status', id] });
                  setShowApproveDialog(false);
                } catch (error: any) {
                  toast({
                    title: "Error",
                    description: error.message || "Failed to approve booking",
                    variant: "destructive",
                  });
                } finally {
                  setIsApproving(false);
                }
              }}
            >
              {isApproving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Approving...
                </>
              ) : (
                "Approve"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close Rental Confirmation Dialog */}
      <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Rental</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to close this rental for {rental?.customers?.name}?
              <span className="block mt-2">
                The vehicle ({rental?.vehicles?.reg}) will be marked as available.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClosing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isClosing}
              onClick={async (e) => {
                e.preventDefault();
                setIsClosing(true);
                try {
                  await supabase
                    .from("rentals")
                    .update({ status: "Closed", updated_at: new Date().toISOString() })
                    .eq("id", id)
                    .eq("tenant_id", tenant?.id);

                  await supabase
                    .from("vehicles")
                    .update({ status: "Available" })
                    .eq("id", rental?.vehicles?.id)
                    .eq("tenant_id", tenant?.id);

                  toast({
                    title: "Rental Closed",
                    description: "Rental has been closed and vehicle is now available.",
                  });

                  queryClient.invalidateQueries({ queryKey: ["rental", id, tenant?.id] });
                  queryClient.invalidateQueries({ queryKey: ["rentals-list"] });
                  queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
                  queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
                  setShowCloseDialog(false);
                } catch (error) {
                  toast({
                    title: "Error",
                    description: "Failed to close rental.",
                    variant: "destructive",
                  });
                } finally {
                  setIsClosing(false);
                }
              }}
            >
              {isClosing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Closing...
                </>
              ) : (
                "Close Rental"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Rental Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rental</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this rental?
              <span className="block mt-2 text-red-600 font-medium">
                This action cannot be undone. All associated data will be permanently removed.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                setIsDeleting(true);
                try {
                  // Use the database function to delete rental and all related records
                  const { error: deleteError } = await supabase.rpc("delete_rental_cascade", {
                    rental_uuid: id,
                  });

                  if (deleteError) {
                    console.error("Error deleting rental:", deleteError);
                    throw new Error(`Failed to delete rental: ${deleteError.message}`);
                  }

                  toast({
                    title: "Rental Deleted",
                    description: "The rental has been permanently deleted.",
                  });

                  // Invalidate all rental-related queries
                  queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
                  queryClient.invalidateQueries({ queryKey: ["rentals-list"] });
                  queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
                  router.push("/rentals");
                } catch (error: any) {
                  console.error("Delete error:", error);
                  toast({
                    title: "Error",
                    description: error?.message || "Failed to delete rental.",
                    variant: "destructive",
                  });
                } finally {
                  setIsDeleting(false);
                }
              }}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default RentalDetail;
