"use client";

import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, CreditCard, FileText, Plus, Upload, Car, AlertTriangle, Eye, Download, Edit, Trash2, User, Mail, Phone, CalendarPlus, DollarSign, FolderOpen, Receipt, CreditCard as PaymentIcon, Ban, CheckCircle, Users, ShieldCheck } from "lucide-react";
import { MetricItem, MetricDivider } from "@/components/vehicles/metric-card";
import { useCustomerBlockingActions } from "@/hooks/use-customer-blocking";
import { TruncatedCell } from "@/components/shared/data-display/truncated-cell";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { CustomerBalanceChip } from "@/components/customers/customer-balance-chip";
import { useCustomerDocuments, useDeleteCustomerDocument, useDownloadDocument } from "@/hooks/use-customer-documents";
import { useCustomerBalanceWithStatus } from "@/hooks/use-customer-balance";
import { useCustomerActiveRentals } from "@/hooks/use-customer-active-rentals";
import { useCustomerRentals } from "@/hooks/use-customer-rentals";
import { useCustomerPayments, useCustomerPaymentStats } from "@/hooks/use-customer-payments";
import { useCustomerFines, useCustomerFineStats } from "@/hooks/use-customer-fines";
import { useCustomerVehicleHistory } from "@/hooks/use-customer-vehicle-history";
import AddCustomerDocumentDialog from "@/components/customers/add-customer-document-dialog";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { AddFineDialog } from "@/components/shared/dialogs/add-fine-dialog";
import { CustomerFormModal } from "@/components/customers/customer-form-modal";
import DocumentStatusBadge from "@/components/customers/document-status-badge";
import { DocumentSigningStatusBadge } from "@/components/customers/document-signing-status-badge";
import { NextOfKinCard } from "@/components/customers/next-of-kin-card";
import { PaymentStatusBadge } from "@/components/customers/payment-status-badge";
import { FineStatusBadge } from "@/components/shared/status/fine-status-badge";
import { format } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  customer_type: "Individual" | "Company";
  status: string;
  whatsapp_opt_in: boolean;
  license_number?: string;
  id_number?: string;
  is_blocked?: boolean;
  blocked_at?: string;
  blocked_reason?: string;
  nok_full_name?: string;
  nok_relationship?: string;
  nok_phone?: string;
  nok_email?: string;
  nok_address?: string;
}

const CustomerDetail = () => {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") || "rentals";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
  const [editingDocumentId, setEditingDocumentId] = useState<string | undefined>();
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [fineDialogOpen, setFineDialogOpen] = useState(false);
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");

  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';

  const { blockCustomer, unblockCustomer, isLoading: blockingLoading } = useCustomerBlockingActions();

  const { data: customer, isLoading, refetch: refetchCustomer } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("customers")
        .select(`
          id, name, email, phone, customer_type, status, whatsapp_opt_in,
          license_number, id_number, is_blocked, blocked_at, blocked_reason,
          nok_full_name, nok_relationship, nok_phone, nok_email, nok_address
        `)
        .eq("id", id)
        .single();

      if (error) throw error;
      return data as Customer;
    },
    enabled: !!id,
    staleTime: 0, // Always fetch fresh data
  });

  const handleBlockCustomer = async () => {
    if (!blockReason.trim() || !id) return;

    blockCustomer.mutate(
      { customerId: id, reason: blockReason },
      {
        onSuccess: async () => {
          setBlockDialogOpen(false);
          setBlockReason("");
          await refetchCustomer();
        }
      }
    );
  };

  const handleUnblockCustomer = async () => {
    unblockCustomer.mutate(id!, {
      onSuccess: async () => {
        // Force refetch to ensure UI updates immediately
        await refetchCustomer();
      }
    });
  };

  // Use the enhanced customer balance hook with status
  const { data: customerBalanceData } = useCustomerBalanceWithStatus(id);

  // Fetch customer data
  const { data: activeRentalsCount } = useCustomerActiveRentals(id!);
  const { data: rentals } = useCustomerRentals(id!);
  const { data: payments } = useCustomerPayments(id!);
  const { data: paymentStats } = useCustomerPaymentStats(id!);
  const { data: fines } = useCustomerFines(id!);
  const { data: fineStats } = useCustomerFineStats(id!);
  const { data: vehicleHistory } = useCustomerVehicleHistory(id!);
  const { data: documents } = useCustomerDocuments(id!);
  const deleteDocument = useDeleteCustomerDocument();
  const downloadDocument = useDownloadDocument();

  // Fetch per-rental outstanding amounts from ledger entries
  const { data: rentalOutstandings } = useQuery({
    queryKey: ["customer-rental-outstandings", tenant?.id, id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("ledger_entries")
        .select("rental_id, remaining_amount")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", id)
        .eq("type", "Charge");

      if (error) throw error;

      // Group by rental_id and sum remaining_amount
      const map: Record<string, number> = {};
      data?.forEach(entry => {
        const key = entry.rental_id || "__no_rental__";
        map[key] = (map[key] || 0) + (entry.remaining_amount || 0);
      });
      return map;
    },
    enabled: !!tenant && !!id,
    staleTime: 0,
    gcTime: 0,
  });

  // Fetch rentals with DocuSign status for documents tab
  const { data: rentalAgreements } = useQuery({
    queryKey: ["customer-rental-agreements", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select(`
          id,
          created_at,
          docusign_envelope_id,
          document_status,
          signed_document_id,
          signed_document:signed_document_id (
            id,
            file_url,
            document_name
          ),
          vehicles:vehicle_id (reg, make, model)
        `)
        .eq("customer_id", id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!id,
    refetchInterval: 5000, // Auto-refresh every 5 seconds to show updated status
  });

  if (isLoading) {
    return <div>Loading customer details...</div>;
  }

  if (!customer) {
    return <div>Customer not found</div>;
  }

  return (
    <div className="space-y-8 pt-4">
      {/* Blocked Customer Alert */}
      {customer.is_blocked && (
        <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
          <Ban className="h-4 w-4" />
          <AlertTitle>Customer Blocked</AlertTitle>
          <AlertDescription>
            This customer has been blocked{customer.blocked_at && ` on ${format(new Date(customer.blocked_at), "MMM dd, yyyy")}`}.
            {customer.blocked_reason && (
              <span className="block mt-1"><strong>Reason:</strong> {customer.blocked_reason}</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <div className="space-y-4">
        {/* Back Button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => router.push("/customers")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Back to Customers</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Customer Info & Actions */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          {/* Customer Info */}
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold">{customer.name}</h1>
              {customer.is_blocked && (
                <Badge variant="destructive">
                  <Ban className="h-3 w-3 mr-1" />
                  Blocked
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {customer.customer_type} Customer
              {customer.license_number && (
                <span className="mx-2">•</span>
              )}
              {customer.license_number && (
                <span>License: {customer.license_number}</span>
              )}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {!customer.is_blocked ? (
              <>
                <Button size="sm" onClick={() => router.push(`/rentals/new?customer=${id}`)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Rental
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPaymentDialogOpen(true)}>
                  <DollarSign className="h-4 w-4 mr-1" />
                  Payment
                </Button>
                <Button size="sm" variant="outline" onClick={() => setFineDialogOpen(true)}>
                  <AlertTriangle className="h-4 w-4 mr-1" />
                  Fine
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleUnblockCustomer}
                disabled={blockingLoading}
                className="border-green-600 text-green-600 hover:bg-green-600/10"
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                {blockingLoading ? "Unblocking..." : "Unblock"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditCustomerOpen(true)}>
              <Edit className="h-4 w-4 mr-1" />
              Edit
            </Button>
            {!customer.is_blocked && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBlockDialogOpen(true)}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Ban className="h-4 w-4 mr-1" />
                Block
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Customer Details */}
      <Card className="shadow-card rounded-lg">
        <CardHeader className="pb-2 pt-4 px-5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <User className="h-4 w-4" />
              Customer Details
            </CardTitle>
            <Badge variant="outline" className="text-[10px] font-medium text-foreground border-foreground/20 bg-foreground/5 px-1.5 py-0.5">
              <ShieldCheck className="h-3 w-3 mr-1 text-green-500" />
              Sourced from ID verification
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-3 pb-4 px-5">
          <div className="space-y-3">
            {/* Contact Information */}
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-2">
              <MetricItem label="Name" value={customer.name} />
              {customer.email && <MetricItem label="Email" value={customer.email} />}
              {customer.phone && <MetricItem label="Phone" value={customer.phone} />}
              <MetricItem label="Type" value={customer.customer_type} />
              {customer.license_number && <MetricItem label="License No." value={customer.license_number} />}
              {customer.id_number && <MetricItem label="ID Number" value={customer.id_number} />}
              {customer.whatsapp_opt_in && (
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground mb-0.5">WhatsApp</span>
                  <Badge variant="outline" className="w-fit text-[10px] px-1.5 py-0">
                    <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                    Yes
                  </Badge>
                </div>
              )}
            </div>

            {/* Account & Statistics */}
            <MetricDivider />
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-2">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground mb-0.5">Balance</span>
                {customerBalanceData ? (
                  <CustomerBalanceChip
                    balance={customerBalanceData.balance}
                    status={customerBalanceData.status}
                    totalCharges={customerBalanceData.totalCharges}
                    totalPayments={customerBalanceData.totalPayments}
                  />
                ) : (
                  <Badge variant="secondary">Loading...</Badge>
                )}
              </div>
              <MetricItem label="Active Rentals" value={activeRentalsCount || 0} />
              <MetricItem label="Payments" value={paymentStats?.paymentCount || 0} />
              {paymentStats?.totalPayments != null && paymentStats.totalPayments > 0 && (
                <MetricItem label="Paid Amount" value={paymentStats.totalPayments} isAmount />
              )}
              <MetricItem label="Open Fines" value={fineStats?.openFines || 0} />
              {fineStats?.openFineAmount != null && fineStats.openFineAmount > 0 && (
                <MetricItem label="Fine Amount" value={fineStats.openFineAmount} isAmount />
              )}
              <MetricItem label="Documents" value={documents?.length || 0} />
            </div>

            {/* Next of Kin Information */}
            {(customer.nok_full_name || customer.nok_phone || customer.nok_email) && (
              <>
                <MetricDivider />
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    Next of Kin
                  </h3>
                  <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-2">
                    {customer.nok_full_name && <MetricItem label="Name" value={customer.nok_full_name} />}
                    {customer.nok_relationship && <MetricItem label="Relationship" value={customer.nok_relationship} />}
                    {customer.nok_phone && <MetricItem label="Phone" value={customer.nok_phone} />}
                    {customer.nok_email && <MetricItem label="Email" value={customer.nok_email} />}
                    {customer.nok_address && (
                      <div className="col-span-2 flex flex-col">
                        <span className="text-xs text-muted-foreground mb-0.5">Address</span>
                        <span className="text-sm font-semibold">{customer.nok_address}</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Complete Tabbed Interface */}
      <div className="relative">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="overflow-x-auto scrollbar-hide">
            <TabsList variant="sticky-evenly-spaced" className="min-w-full">
              <TabsTrigger value="rentals" variant="evenly-spaced" className="min-w-0">
                <Car className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden xs:inline sm:hidden">Rentals</span>
                <span className="xs:hidden sm:inline">Rentals</span>
                <span className="sm:hidden">R</span>
              </TabsTrigger>
              <TabsTrigger value="payments" variant="evenly-spaced" className="min-w-0">
                <PaymentIcon className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden xs:inline sm:hidden">Payments</span>
                <span className="xs:hidden sm:inline">Payments</span>
                <span className="sm:hidden">P</span>
              </TabsTrigger>
              <TabsTrigger value="fines" variant="evenly-spaced" className="min-w-0">
                <AlertTriangle className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden xs:inline sm:hidden">Fines</span>
                <span className="xs:hidden sm:inline">Fines</span>
                <span className="sm:hidden">F</span>
              </TabsTrigger>
              <TabsTrigger value="vehicles" variant="evenly-spaced" className="min-w-0">
                <Car className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden xs:inline sm:hidden">History</span>
                <span className="xs:hidden sm:inline">Vehicle History</span>
                <span className="sm:hidden">H</span>
              </TabsTrigger>
              <TabsTrigger value="documents" variant="evenly-spaced" className="min-w-0">
                <FileText className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden xs:inline sm:hidden">Documents</span>
                <span className="xs:hidden sm:inline">Documents</span>
                <span className="sm:hidden">D</span>
              </TabsTrigger>
            </TabsList>
          </div>

        <TabsContent value="rentals" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Customer Rentals</span>
                <Button onClick={() => router.push(`/rentals/new?customer=${id}`)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Rental
                </Button>
              </CardTitle>
              <CardDescription>All rental agreements for this customer</CardDescription>
            </CardHeader>
            <CardContent>
              {rentals && rentals.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-semibold">Vehicle</TableHead>
                        <TableHead className="font-semibold">Start Date</TableHead>
                        <TableHead className="font-semibold">End Date</TableHead>
                        <TableHead className="font-semibold text-right">Monthly Amount</TableHead>
                        <TableHead className="font-semibold text-right">Outstanding</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rentals.map((rental) => {
                        const isCancelledOrRejected = rental.status === 'Cancelled' || rental.approval_status === 'rejected';
                        const outstanding = rentalOutstandings?.[rental.id] ?? null;

                        return (
                        <TableRow key={rental.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="font-medium">
                            <div>
                              <div className="font-semibold text-foreground">{rental.vehicle.reg}</div>
                              <TruncatedCell
                                content={`${rental.vehicle.make} ${rental.vehicle.model}`}
                                maxLength={25}
                                className="text-sm text-muted-foreground"
                              />
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(rental.start_date), "MM/dd/yyyy")}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {rental.end_date ? format(new Date(rental.end_date), "MM/dd/yyyy") : "Ongoing"}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(rental.monthly_amount, currencyCode)}
                          </TableCell>
                          <TableCell className="text-right">
                            {isCancelledOrRejected ? (
                              <span className="text-muted-foreground text-sm">Cancelled</span>
                            ) : outstanding === null ? (
                              <span className="text-muted-foreground text-sm">-</span>
                            ) : outstanding > 0.01 ? (
                              <span className="text-red-600 font-medium">{formatCurrency(outstanding, currencyCode)}</span>
                            ) : (
                              <span className="text-green-600 font-medium">Settled</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={rental.status === 'Active' ? 'default' : 'secondary'}>
                              {rental.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push(`/rentals/${rental.id}`)}
                              className="hover:bg-primary hover:text-primary-foreground"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  icon={Car}
                  title="No rentals found"
                  description="This customer doesn't have any rental agreements yet."
                  actionLabel="Add First Rental"
                  onAction={() => router.push(`/rentals/new?customer=${id}`)}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Payment History</span>
                <Button onClick={() => setPaymentDialogOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Payment
                </Button>
              </CardTitle>
              <CardDescription>All payments made by this customer</CardDescription>
            </CardHeader>
            <CardContent>
              {payments && payments.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-semibold">Date</TableHead>
                        <TableHead className="font-semibold text-right">Amount</TableHead>
                        <TableHead className="font-semibold">Method</TableHead>
                        <TableHead className="font-semibold">Vehicle</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold text-right">Remaining</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((payment) => (
                        <TableRow key={payment.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(payment.payment_date), "MM/dd/yyyy")}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(payment.amount, currencyCode)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{payment.method}</Badge>
                          </TableCell>
                          <TableCell>
                            {payment.vehicle?.reg ? (
                              <TruncatedCell
                                content={payment.vehicle.reg}
                                maxLength={15}
                                className="font-medium"
                              />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <PaymentStatusBadge
                              applied={payment.amount - payment.remaining_amount}
                              amount={payment.amount}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            {payment.remaining_amount > 0 ? (
                              <span className="text-orange-600 font-medium">
                                {formatCurrency(payment.remaining_amount, currencyCode)}
                              </span>
                            ) : (
                              <span className="text-green-600 font-medium">Fully Applied</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  icon={Receipt}
                  title="No payments found"
                  description="This customer hasn't made any payments yet."
                  actionLabel="Add First Payment"
                  onAction={() => setPaymentDialogOpen(true)}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fines" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Customer Fines</span>
                <Button onClick={() => setFineDialogOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Upload Fine
                </Button>
              </CardTitle>
              <CardDescription>All fines associated with this customer</CardDescription>
            </CardHeader>
            <CardContent>
              {fines && fines.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-semibold">Type</TableHead>
                        <TableHead className="font-semibold">Reference</TableHead>
                        <TableHead className="font-semibold">Vehicle</TableHead>
                        <TableHead className="font-semibold text-right">Amount</TableHead>
                        <TableHead className="font-semibold">Issue Date</TableHead>
                        <TableHead className="font-semibold">Due Date</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold">Liability</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fines.map((fine) => (
                        <TableRow key={fine.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="font-medium">{fine.type === "PCN" ? "Parking Citation" : fine.type}</TableCell>
                          <TableCell>
                            {fine.reference_no ? (
                              <TruncatedCell
                                content={fine.reference_no}
                                maxLength={12}
                                className="font-mono text-sm"
                              />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-semibold text-foreground">{fine.vehicle.reg}</div>
                              <TruncatedCell
                                content={`${fine.vehicle.make} ${fine.vehicle.model}`}
                                maxLength={20}
                                className="text-sm text-muted-foreground"
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(fine.amount, currencyCode)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(fine.issue_date), "MM/dd/yyyy")}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(fine.due_date), "MM/dd/yyyy")}
                          </TableCell>
                          <TableCell>
                            <FineStatusBadge
                              status={fine.status}
                              dueDate={fine.due_date}
                              remainingAmount={fine.amount}
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant={fine.liability === 'Individual' || fine.liability === 'Customer' ? 'default' : 'secondary'}>
                              {fine.liability === "Customer" ? "Individual" : fine.liability}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  icon={AlertTriangle}
                  title="No fines found"
                  description="This customer doesn't have any fines associated with their account."
                  actionLabel="Upload Fine"
                  onAction={() => setFineDialogOpen(true)}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vehicles" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Vehicle History</CardTitle>
              <CardDescription>All vehicles this customer has rented</CardDescription>
            </CardHeader>
            <CardContent>
              {vehicleHistory && vehicleHistory.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-semibold">Vehicle</TableHead>
                        <TableHead className="font-semibold">Start Date</TableHead>
                        <TableHead className="font-semibold">End Date</TableHead>
                        <TableHead className="font-semibold text-right">Monthly Amount</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vehicleHistory.map((history) => (
                        <TableRow key={history.rental_id} className="hover:bg-muted/50 transition-colors">
                          <TableCell>
                            <div>
                              <div className="font-semibold text-foreground">{history.vehicle_reg}</div>
                              <TruncatedCell
                                content={`${history.vehicle_make} ${history.vehicle_model}`}
                                maxLength={25}
                                className="text-sm text-muted-foreground"
                              />
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(history.start_date), "MM/dd/yyyy")}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {history.end_date ? format(new Date(history.end_date), "MM/dd/yyyy") : "Ongoing"}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(history.monthly_amount, currencyCode)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={history.status === 'Active' ? 'default' : 'secondary'}>
                              {history.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push(`/vehicles/${history.vehicle_id}`)}
                              className="hover:bg-primary hover:text-primary-foreground"
                            >
                              <Car className="h-4 w-4 mr-1" />
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  icon={Car}
                  title="No vehicle history"
                  description="This customer hasn't rented any vehicles yet."
                  actionLabel="Add First Rental"
                  onAction={() => router.push(`/rentals/new?customer=${id}`)}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Customer Documents</span>
                <Button onClick={() => setDocumentDialogOpen(true)} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Document
                </Button>
              </CardTitle>
              <CardDescription>All documents uploaded for this customer, including rental agreements</CardDescription>
            </CardHeader>
            <CardContent>
              {(documents && documents.length > 0) || (rentalAgreements && rentalAgreements.length > 0) ? (
                <div className="space-y-6">
                  {/* Customer Documents Section */}
                  {documents && documents.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Uploaded Documents</h3>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="font-semibold">Document</TableHead>
                              <TableHead className="font-semibold">Type</TableHead>
                              <TableHead className="font-semibold">Vehicle</TableHead>
                              <TableHead className="font-semibold">Created</TableHead>
                              <TableHead className="font-semibold text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {documents.map((doc) => (
                              <TableRow key={doc.id} className="hover:bg-muted/50 transition-colors">
                                <TableCell>
                                  <div className="font-semibold text-foreground">
                                    {doc.document_name}
                                  </div>
                                  {doc.file_name && (
                                    <div className="text-xs text-muted-foreground">{doc.file_name}</div>
                                  )}
                                </TableCell>
                                <TableCell>{doc.document_type}</TableCell>
                                <TableCell>
                                  {doc.vehicles ? (
                                    <TruncatedCell
                                      content={`${doc.vehicles.reg} - ${doc.vehicles.make} ${doc.vehicles.model}`}
                                      maxLength={25}
                                      className="text-sm"
                                    />
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {format(new Date(doc.created_at), "MM/dd/yyyy")}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-1">
                                    {doc.file_url && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 w-8 p-0"
                                        title="Download document"
                                        onClick={() => downloadDocument.mutate(doc)}
                                      >
                                        <Download className="h-3 w-3" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                      title="Delete document"
                                      onClick={() => deleteDocument.mutate(doc.id)}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Rental Agreements Section */}
                  {rentalAgreements && rentalAgreements.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Rental Agreements</h3>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="font-semibold">Document</TableHead>
                              <TableHead className="font-semibold">Vehicle</TableHead>
                              <TableHead className="font-semibold">Signing Status</TableHead>
                              <TableHead className="font-semibold">Created</TableHead>
                              <TableHead className="font-semibold text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {rentalAgreements.map((rental) => (
                              <TableRow key={rental.id} className="hover:bg-muted/50 transition-colors">
                                <TableCell>
                                  <div className="font-semibold text-foreground">
                                    Rental Agreement
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <TruncatedCell
                                    content={`${rental.vehicles?.reg} - ${rental.vehicles?.make} ${rental.vehicles?.model}`}
                                    maxLength={25}
                                    className="text-sm"
                                  />
                                </TableCell>
                                <TableCell>
                                  <DocumentSigningStatusBadge status={rental.document_status || 'pending'} />
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {format(new Date(rental.created_at), "MM/dd/yyyy")}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-1">
                                    {rental.signed_document_id && rental.signed_document?.file_url ? (
                                      <>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-8 w-8 p-0"
                                          title="View signed document"
                                          onClick={() => window.open(rental.signed_document.file_url, '_blank')}
                                        >
                                          <Eye className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-8 w-8 p-0"
                                          title="Download signed document"
                                          onClick={() => {
                                            console.log('Downloading signed document...');
                                            const link = document.createElement('a');
                                            link.href = rental.signed_document.file_url;
                                            link.download = rental.signed_document.document_name || 'rental-agreement.pdf';
                                            link.click();
                                          }}
                                        >
                                          <Download className="h-3 w-3" />
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => router.push(`/rentals/${rental.id}`)}
                                        className="hover:bg-primary hover:text-primary-foreground"
                                      >
                                        <Eye className="h-4 w-4 mr-1" />
                                        View Rental
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <EmptyState
                  icon={FileText}
                  title="No documents found"
                  description="This customer doesn't have any documents uploaded yet."
                  actionLabel="Add First Document"
                  onAction={() => setDocumentDialogOpen(true)}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        </Tabs>
      </div>

      {/* Dialogs */}
      <AddPaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        customer_id={id}
      />

      <AddFineDialog
        open={fineDialogOpen}
        onOpenChange={setFineDialogOpen}
      />

      <CustomerFormModal
        open={editCustomerOpen}
        onOpenChange={setEditCustomerOpen}
        customer={customer}
      />

      <AddCustomerDocumentDialog
        open={documentDialogOpen}
        onOpenChange={setDocumentDialogOpen}
        customerId={id!}
      />

      {/* Block Customer Dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" />
              Block Customer
            </DialogTitle>
            <DialogDescription>
              This will block {customer.name} from making new rentals. Their email will be added to the blocklist.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="block-reason">Reason for blocking <span className="text-red-500">*</span></Label>
              <Textarea
                id="block-reason"
                placeholder="Enter the reason for blocking this customer..."
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                rows={3}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              <strong>Email:</strong> {customer.email} will be added to blocklist
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBlockCustomer}
              disabled={!blockReason.trim() || blockCustomer.isPending}
            >
              {blockCustomer.isPending ? "Blocking..." : "Block Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerDetail;
