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
import { FileText, ArrowLeft, PoundSterling, Plus, X, Send, Shield, Download, Ban, Check } from "lucide-react";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { useToast } from "@/hooks/use-toast";
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

  // Function to download protection plan details as PDF
  const downloadProtectionDetails = () => {
    if (!protectionSelection || !protectionSelection.protection_plans) return;

    const plan = protectionSelection.protection_plans;

    // Create a hidden printable div
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({
        title: "Error",
        description: "Could not open print window. Please check your popup blocker.",
        variant: "destructive",
      });
      return;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Protection Coverage - ${rental.vehicles?.reg}</title>
          <meta charset="UTF-8">
          <style>
            @page {
              margin: 15mm;
              size: A4;
            }
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            body {
              font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #1a1a1a;
              background: white;
            }
            .document {
              max-width: 210mm;
              margin: 0 auto;
              background: white;
            }
            .header {
              background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
              color: white;
              padding: 40px;
              margin-bottom: 30px;
            }
            .header h1 {
              font-size: 28px;
              font-weight: 600;
              letter-spacing: -0.5px;
              margin-bottom: 8px;
            }
            .header .subtitle {
              font-size: 14px;
              color: #C5A572;
              font-weight: 500;
              text-transform: uppercase;
              letter-spacing: 1px;
            }
            .content {
              padding: 0 40px 40px;
            }
            .info-card {
              background: #f8f9fa;
              border-left: 4px solid #C5A572;
              padding: 24px;
              margin-bottom: 30px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            .info-card h2 {
              font-size: 16px;
              font-weight: 600;
              color: #1a1a1a;
              margin-bottom: 16px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              padding: 12px 0;
              border-bottom: 1px solid #e9ecef;
            }
            .info-row:last-child {
              border-bottom: none;
            }
            .info-label {
              font-size: 13px;
              color: #6c757d;
              font-weight: 500;
              text-transform: uppercase;
              letter-spacing: 0.3px;
            }
            .info-value {
              font-size: 15px;
              color: #1a1a1a;
              font-weight: 600;
            }
            .section {
              margin-bottom: 35px;
            }
            .section-title {
              font-size: 18px;
              font-weight: 600;
              color: #1a1a1a;
              margin-bottom: 20px;
              padding-bottom: 10px;
              border-bottom: 2px solid #e9ecef;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .pricing-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 20px;
              margin-bottom: 30px;
            }
            .pricing-card {
              background: white;
              border: 1px solid #e9ecef;
              padding: 20px;
              text-align: center;
              box-shadow: 0 2px 4px rgba(0,0,0,0.04);
            }
            .pricing-card .label {
              font-size: 11px;
              color: #6c757d;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-bottom: 8px;
            }
            .pricing-card .value {
              font-size: 24px;
              font-weight: 700;
              color: #C5A572;
              line-height: 1;
            }
            .pricing-card .subvalue {
              font-size: 12px;
              color: #6c757d;
              margin-top: 4px;
            }
            .coverage-list {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
              list-style: none;
            }
            .coverage-list li {
              padding: 12px 16px;
              background: #f8f9fa;
              border-left: 3px solid #28a745;
              font-size: 14px;
              color: #1a1a1a;
            }
            .exclusions-list {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
              list-style: none;
            }
            .exclusions-list li {
              padding: 12px 16px;
              background: #fff5f5;
              border-left: 3px solid #dc3545;
              font-size: 14px;
              color: #1a1a1a;
            }
            .badge {
              display: inline-block;
              padding: 6px 14px;
              border-radius: 4px;
              font-size: 12px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin: 4px 4px 4px 0;
            }
            .badge-tier {
              background: #e3f2fd;
              color: #1976d2;
            }
            .badge-zero {
              background: #28a745;
              color: white;
            }
            .highlight-box {
              background: linear-gradient(135deg, #C5A572 0%, #d4b589 100%);
              color: white;
              padding: 24px;
              margin: 30px 0;
              box-shadow: 0 4px 12px rgba(197, 165, 114, 0.2);
            }
            .highlight-box .amount {
              font-size: 36px;
              font-weight: 700;
              margin-bottom: 8px;
            }
            .highlight-box .description {
              font-size: 14px;
              opacity: 0.95;
            }
            .footer {
              margin-top: 50px;
              padding-top: 24px;
              border-top: 2px solid #e9ecef;
            }
            .footer-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 20px;
            }
            .footer-item {
              font-size: 12px;
            }
            .footer-item .label {
              color: #6c757d;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              margin-bottom: 4px;
            }
            .footer-item .value {
              color: #1a1a1a;
              font-weight: 500;
            }
            @media print {
              body {
                background: white;
              }
            }
          </style>
        </head>
        <body>
          <div class="document">
            <div class="header">
              <h1>Protection Coverage Certificate</h1>
              <div class="subtitle">Vehicle Protection Plan Details</div>
            </div>

            <div class="content">
              <div class="info-card">
                <h2>Plan Overview</h2>
                <div class="info-row">
                  <span class="info-label">Plan Name</span>
                  <span class="info-value">${plan.display_name}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Coverage Tier</span>
                  <span class="info-value">
                    <span class="badge badge-tier">${plan.tier}</span>
                    ${plan.deductible_amount === 0 ? '<span class="badge badge-zero">Zero Deductible</span>' : ''}
                  </span>
                </div>
                <div class="info-row">
                  <span class="info-label">Description</span>
                  <span class="info-value">${plan.description}</span>
                </div>
              </div>

              <div class="highlight-box">
                <div class="amount">$${Number(protectionSelection.total_cost).toLocaleString()}</div>
                <div class="description">Total Protection Cost — $${Number(protectionSelection.daily_rate).toLocaleString()}/day × ${protectionSelection.total_days} days</div>
              </div>

              <div class="section">
                <div class="section-title">Financial Details</div>
                <div class="pricing-grid">
                  <div class="pricing-card">
                    <div class="label">Daily Rate</div>
                    <div class="value">$${Number(protectionSelection.daily_rate).toLocaleString()}</div>
                  </div>
                  <div class="pricing-card">
                    <div class="label">Coverage Period</div>
                    <div class="value">${protectionSelection.total_days}</div>
                    <div class="subvalue">days</div>
                  </div>
                  <div class="pricing-card">
                    <div class="label">Deductible</div>
                    <div class="value">${plan.deductible_amount === 0 ? '$0' : `$${plan.deductible_amount.toLocaleString()}`}</div>
                  </div>
                  ${plan.max_coverage_amount ? `
                  <div class="pricing-card">
                    <div class="label">Max Coverage</div>
                    <div class="value">$${plan.max_coverage_amount.toLocaleString()}</div>
                  </div>
                  ` : ''}
                </div>
              </div>

              ${plan.features && Array.isArray(plan.features) && plan.features.length > 0 ? `
              <div class="section">
                <div class="section-title">Coverage Includes</div>
                <ul class="coverage-list">
                  ${plan.features.map((f: string) => `<li>${f}</li>`).join('')}
                </ul>
              </div>
              ` : ''}

              ${plan.exclusions && Array.isArray(plan.exclusions) && plan.exclusions.length > 0 ? `
              <div class="section">
                <div class="section-title">Coverage Exclusions</div>
                <ul class="exclusions-list">
                  ${plan.exclusions.map((e: string) => `<li>${e}</li>`).join('')}
                </ul>
              </div>
              ` : ''}

              <div class="footer">
                <div class="footer-grid">
                  <div class="footer-item">
                    <div class="label">Document Generated</div>
                    <div class="value">${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}</div>
                  </div>
                  <div class="footer-item">
                    <div class="label">Rental Reference</div>
                    <div class="value">${id}</div>
                  </div>
                  <div class="footer-item">
                    <div class="label">Customer Name</div>
                    <div class="value">${rental.customers?.name}</div>
                  </div>
                  <div class="footer-item">
                    <div class="label">Vehicle</div>
                    <div class="value">${rental.vehicles?.reg} — ${rental.vehicles?.make} ${rental.vehicles?.model}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();

    // Wait for content to load, then trigger print dialog
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
        // Close window after printing/saving
        setTimeout(() => printWindow.close(), 1000);
      }, 250);
    };

    toast({
      title: "Print Dialog Opened",
      description: "Save as PDF from the print dialog",
    });
  };

  // Fetch protection plan selection for this rental
  const { data: protectionSelection } = useQuery({
    queryKey: ["rental-protection", id],
    queryFn: async () => {
      console.log('Fetching protection plan for rental:', id);

      const { data, error } = await supabase
        .from("rental_protection_selections" as any)
        .select(`
          *,
          protection_plans (
            id,
            display_name,
            description,
            deductible_amount,
            max_coverage_amount,
            tier,
            color_theme,
            features,
            exclusions
          )
        `)
        .eq("rental_id", id)
        .single();

      if (error) {
        console.log('Protection plan query error:', error);
        // If no protection plan, return null (not an error)
        if (error.code === 'PGRST116') {
          console.log('No protection plan found for this rental');
          return null;
        }
        throw error;
      }

      console.log('Protection plan data fetched:', data);
      return data as any;
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
                    await supabase
                      .from("rentals")
                      .update({ status: "Closed" })
                      .eq("id", id);

                    await supabase
                      .from("vehicles")
                      .update({ status: "Available" })
                      .eq("id", rental.vehicles?.id);

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

      {/* Protection Plan Details */}
      {protectionSelection && protectionSelection.protection_plans && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-[#C5A572]" />
              Protection Coverage
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadProtectionDetails}
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Plan Header */}
              <div className="flex items-start justify-between pb-4 border-b">
                <div className="flex items-start gap-4">
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: protectionSelection.protection_plans.color_theme + '20' || '#C5A57220' }}
                  >
                    <Shield
                      className="w-6 h-6"
                      style={{ color: protectionSelection.protection_plans.color_theme || '#C5A572' }}
                    />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{protectionSelection.protection_plans.display_name}</h3>
                    <p className="text-sm text-muted-foreground">{protectionSelection.protection_plans.description}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline">{protectionSelection.protection_plans.tier}</Badge>
                      {protectionSelection.protection_plans.deductible_amount === 0 && (
                        <Badge className="bg-green-600">ZERO DEDUCTIBLE</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-[#C5A572]">
                    ${Number(protectionSelection.total_cost).toLocaleString()}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    ${Number(protectionSelection.daily_rate).toLocaleString()}/day × {protectionSelection.total_days} days
                  </p>
                </div>
              </div>

              {/* Coverage Details */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Daily Rate</p>
                  <p className="font-medium">${Number(protectionSelection.daily_rate).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Days</p>
                  <p className="font-medium">{protectionSelection.total_days} days</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Cost</p>
                  <p className="font-medium text-[#C5A572]">${Number(protectionSelection.total_cost).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Deductible</p>
                  <p className="font-medium">
                    {protectionSelection.protection_plans.deductible_amount === 0
                      ? <Badge className="bg-green-600">$0</Badge>
                      : `$${protectionSelection.protection_plans.deductible_amount.toLocaleString()}`
                    }
                  </p>
                </div>
                {protectionSelection.protection_plans.max_coverage_amount && (
                  <div>
                    <p className="text-sm text-muted-foreground">Max Coverage</p>
                    <p className="font-medium">${protectionSelection.protection_plans.max_coverage_amount.toLocaleString()}</p>
                  </div>
                )}
              </div>

              {/* Features */}
              {protectionSelection.protection_plans.features && Array.isArray(protectionSelection.protection_plans.features) && protectionSelection.protection_plans.features.length > 0 && (
                <div className="pt-4 border-t">
                  <h4 className="font-semibold text-sm mb-3">Coverage Includes:</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {protectionSelection.protection_plans.features.map((feature: string, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-sm">
                        <span className="text-green-600">✓</span>
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Exclusions */}
              {protectionSelection.protection_plans.exclusions && Array.isArray(protectionSelection.protection_plans.exclusions) && protectionSelection.protection_plans.exclusions.length > 0 && (
                <div className="pt-4 border-t">
                  <h4 className="font-semibold text-sm mb-3 text-destructive">Not Covered:</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {protectionSelection.protection_plans.exclusions.map((exclusion: string, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="text-destructive">×</span>
                        <span>{exclusion}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
