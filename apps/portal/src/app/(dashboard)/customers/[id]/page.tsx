"use client";

import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, CreditCard, FileText, Plus, Upload, Car, AlertTriangle, Eye, Download, Edit, Trash2, User, Mail, Phone, CalendarPlus, DollarSign, FolderOpen, Receipt, CreditCard as PaymentIcon, Ban, CheckCircle, Users, ArrowUpRight } from "lucide-react";
import { MetricItem, MetricDivider } from "@/components/vehicles/metric-card";
import { useCustomerBlockingActions } from "@/hooks/use-customer-blocking";
import { TruncatedCell } from "@/components/shared/data-display/truncated-cell";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { CustomerBalanceChip } from "@/components/customers/customer-balance-chip";
import { useCustomerDocuments, useDeleteCustomerDocument, useDownloadDocument } from "@/hooks/use-customer-documents";
import { useCustomerBalanceWithStatus } from "@/hooks/use-customer-balance";
import { useCustomerActiveRentals } from "@/hooks/use-customer-active-rentals";
import { useCustomerRentals } from "@/hooks/use-customer-rentals";
import { useCustomerPayments } from "@/hooks/use-customer-payments";
import AddCustomerDocumentDialog from "@/components/customers/add-customer-document-dialog";
import { CustomerFormModal } from "@/components/customers/customer-form-modal";
import DocumentStatusBadge from "@/components/customers/document-status-badge";
import { NextOfKinCard } from "@/components/customers/next-of-kin-card";
import { PaymentStatusBadge } from "@/components/customers/payment-status-badge";
import { format } from "date-fns";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  customer_type: "Individual" | "Company";
  status: string;
  whatsapp_opt_in: boolean;
  high_switcher?: boolean;
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
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { addBlockedIdentity, unblockCustomer, isLoading: blockingLoading } = useCustomerBlockingActions();
  const [isBlocking, setIsBlocking] = useState(false);

  const { data: customer, isLoading, refetch: refetchCustomer } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("customers")
        .select(`
          id, name, email, phone, customer_type, status, whatsapp_opt_in, high_switcher,
          license_number, id_number, is_blocked, blocked_at, blocked_reason,
          nok_full_name, nok_relationship, nok_phone, nok_email, nok_address
        `)
        .eq("id", id)
        .single();

      if (error) throw error;
      return data as Customer;
    },
    enabled: !!id,
  });

  const handleBlockCustomer = async () => {
    if (!blockReason.trim() || !customer) return;

    // Determine what to block: license > id_number > email
    const identityToBlock = customer.license_number || customer.id_number || customer.email;
    const identityType = customer.license_number ? 'license' :
                         customer.id_number ? 'id_card' : 'email';

    setIsBlocking(true);
    try {
      // First block the customer directly in database
      const { error: blockError } = await (supabase as any)
        .from('customers')
        .update({
          is_blocked: true,
          blocked_at: new Date().toISOString(),
          blocked_reason: blockReason
        })
        .eq('id', id);

      if (blockError) throw blockError;

      // Then add to blocked identities list
      if (identityToBlock) {
        await addBlockedIdentity.mutateAsync({
          identityType: identityType as 'license' | 'id_card' | 'passport' | 'other',
          identityNumber: identityToBlock,
          reason: blockReason,
          notes: `Blocked from customer: ${customer.name}`
        });
      }

      setBlockDialogOpen(false);
      setBlockReason("");
      refetchCustomer();
    } catch (error: any) {
      console.error('Failed to block customer:', error);
    } finally {
      setIsBlocking(false);
    }
  };

  const handleUnblockCustomer = () => {
    unblockCustomer.mutate(id!, {
      onSuccess: () => {
        refetchCustomer();
      }
    });
  };

  const handleDeleteCustomer = async () => {
    try {
      const { error } = await supabase
        .from("customers")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setDeleteDialogOpen(false);
      router.push("/customers");
    } catch (error) {
      console.error("Error deleting customer:", error);
    }
  };

  // Use the enhanced customer balance hook with status
  const { data: customerBalanceData } = useCustomerBalanceWithStatus(id);

  // Fetch customer data
  const { data: activeRentalsCount } = useCustomerActiveRentals(id!);
  const { data: rentals } = useCustomerRentals(id!);
  const { data: payments } = useCustomerPayments(id!);
  const { data: documents } = useCustomerDocuments(id!);
  const deleteDocument = useDeleteCustomerDocument();
  const downloadDocument = useDownloadDocument();

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
        <Button variant="ghost" size="sm" onClick={() => router.push("/customers")} className="gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </Button>

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
              {customer.high_switcher && (
                <Badge variant="secondary">High Switcher</Badge>
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
            {customer.is_blocked && (
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
                className="text-orange-600 hover:text-orange-600 hover:bg-orange-600/10"
              >
                <Ban className="h-4 w-4 mr-1" />
                Block
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleteDialogOpen(true)}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Customer Details */}
      <Card className="shadow-card rounded-lg">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <User className="h-5 w-5" />
            Customer Details
          </CardTitle>
          <CardDescription>Basic customer information and account status</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-6">
            {/* Contact Information */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <User className="h-4 w-4" />
                Contact Information
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-3">
                <MetricItem label="Name" value={customer.name} />
                {customer.email && <MetricItem label="Email" value={customer.email} />}
                {customer.phone && <MetricItem label="Phone" value={customer.phone} />}
                <MetricItem label="Type" value={customer.customer_type} />
                {customer.license_number && <MetricItem label="License Number" value={customer.license_number} />}
                {customer.id_number && <MetricItem label="ID Number" value={customer.id_number} />}
                {customer.whatsapp_opt_in && (
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground mb-1">WhatsApp Opt-in</span>
                    <Badge variant="outline" className="w-fit">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Yes
                    </Badge>
                  </div>
                )}
              </div>
            </div>

            {/* Next of Kin Information */}
            {(customer.nok_full_name || customer.nok_phone || customer.nok_email) && (
              <>
                <MetricDivider />
                <div>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Next of Kin Information
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-3">
                    {customer.nok_full_name && <MetricItem label="Name" value={customer.nok_full_name} />}
                    {customer.nok_relationship && <MetricItem label="Relationship" value={customer.nok_relationship} />}
                    {customer.nok_phone && <MetricItem label="Phone" value={customer.nok_phone} />}
                    {customer.nok_email && <MetricItem label="Email" value={customer.nok_email} />}
                    {customer.nok_address && (
                      <div className="col-span-2 flex flex-col">
                        <span className="text-xs text-muted-foreground mb-1">Address</span>
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
              <CardTitle>Customer Rentals</CardTitle>
              <CardDescription>All rental agreements for this customer</CardDescription>
            </CardHeader>
            <CardContent>
              {rentals && rentals.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-semibold">Rental ID</TableHead>
                        <TableHead className="font-semibold">Vehicle</TableHead>
                        <TableHead className="font-semibold text-right">View</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rentals.map((rental) => (
                        <TableRow key={rental.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="font-medium font-mono text-xs">
                            {rental.id.split('-')[0]}
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-semibold text-foreground">{rental.vehicle.reg}</div>
                              <TruncatedCell
                                content={`${rental.vehicle.make} ${rental.vehicle.model}`}
                                maxLength={25}
                                className="text-sm text-muted-foreground"
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => router.push(`/rentals/${rental.id}`)}
                            >
                              <ArrowUpRight className="h-4 w-4" />
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
                  title="No rentals found"
                  description="This customer doesn't have any rental agreements yet."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Payment History</CardTitle>
              <CardDescription>Paid payments by this customer</CardDescription>
            </CardHeader>
            <CardContent>
              {payments && payments.filter(p => p.remaining_amount === 0).length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-semibold">Date</TableHead>
                        <TableHead className="font-semibold">Amount</TableHead>
                        <TableHead className="font-semibold text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.filter(p => p.remaining_amount === 0).map((payment) => (
                        <TableRow key={payment.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(payment.payment_date), "MM/dd/yyyy")}
                          </TableCell>
                          <TableCell className="font-medium">
                            ${payment.amount.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <PaymentStatusBadge
                              applied={payment.amount - payment.remaining_amount}
                              amount={payment.amount}
                            />
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
                  description="This customer doesn't have any paid payments yet."
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
              <CardDescription>Documents uploaded for this customer</CardDescription>
            </CardHeader>
            <CardContent>
              {documents && documents.length > 0 ? (
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
              This will block {customer.name} from making new rentals. Their license/ID number will be added to the blocklist.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!customer.license_number && !customer.id_number ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Cannot Block Customer</AlertTitle>
                <AlertDescription>
                  This customer does not have a license number or ID number on file.
                  Please edit the customer and add their license number before blocking.
                </AlertDescription>
              </Alert>
            ) : (
              <>
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
                {customer.license_number && (
                  <div className="text-sm text-muted-foreground">
                    <strong>License Number:</strong> {customer.license_number} will be added to blocklist
                  </div>
                )}
                {customer.id_number && (
                  <div className="text-sm text-muted-foreground">
                    <strong>ID Number:</strong> {customer.id_number} will be added to blocklist
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBlockCustomer}
              disabled={!blockReason.trim() || isBlocking || (!customer.license_number && !customer.id_number)}
            >
              {isBlocking ? "Blocking..." : "Block Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Customer Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Customer
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {customer.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCustomer}
            >
              Delete Customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerDetail;
