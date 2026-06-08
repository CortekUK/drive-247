"use client";

import { useState, useRef } from "react";
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
import { ArrowLeft, CreditCard, FileText, Plus, Upload, Car, AlertTriangle, Eye, Download, Edit, Trash2, User, Mail, Phone, CalendarPlus, DollarSign, FolderOpen, Receipt, CreditCard as PaymentIcon, Ban, CheckCircle, Users, ShieldCheck, Briefcase, ExternalLink, ImageIcon, Loader2, Pencil, Check, X, RefreshCw, Shield, Scale } from "lucide-react";
import { MetricItem, MetricDivider } from "@/components/vehicles/metric-card";
import { useCustomerBlockingActions } from "@/hooks/use-customer-blocking";
import { TruncatedCell } from "@/components/shared/data-display/truncated-cell";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import {
  KpiTile,
  StatusPill,
  statusTone,
  type StatusTone,
  ErrorState,
  Shimmer,
  TableSkeleton,
} from "@/components/bento";
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
import { EditBalanceDialog } from "@/components/customers/edit-balance-dialog";
import { CollectPaymentDialog } from "@/components/customers/collect-payment-dialog";
import { AllocatePaymentDialog } from "@/components/customers/allocate-payment-dialog";
import { AddFineDialog } from "@/components/fines/add-fine-dialog";
import { CustomerFormModal } from "@/components/customers/customer-form-modal";
import DocumentStatusBadge from "@/components/customers/document-status-badge";
import { DocumentSigningStatusBadge } from "@/components/customers/document-signing-status-badge";
import { NextOfKinCard } from "@/components/customers/next-of-kin-card";
import { PaymentStatusBadge } from "@/components/customers/payment-status-badge";
import { FineStatusBadge } from "@/components/shared/status/fine-status-badge";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { useGigDriverImages, useDeleteGigDriverImage } from "@/hooks/use-gig-driver-images";
import GigDriverUploadDialog from "@/components/customers/gig-driver-upload-dialog";
import { BlurredImage } from "@/components/ui/blurred-image";
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
import { CustomerReviewSummaryCard } from "@/components/reviews/customer-review-summary-card";
import { StartVerificationDialog } from "@/components/customers/start-verification-dialog";
import { StartCmdVerificationDialog } from "@/components/customers/start-cmd-verification-dialog";
import { useCmdVerification, useCmdResults, useResendCmdLink, type CmdLicenseStatus } from "@/hooks/use-cmd-verification";
import { useToast } from "@/hooks/use-toast";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  whatsapp_opt_in: boolean;
  license_number?: string;
  id_number?: string;
  date_of_birth?: string;
  is_blocked?: boolean;
  blocked_at?: string;
  blocked_reason?: string;
  is_gig_driver?: boolean;
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
  const [collectDialogOpen, setCollectDialogOpen] = useState(false);
  const [editBalanceOpen, setEditBalanceOpen] = useState(false);
  const [allocatePayment, setAllocatePayment] = useState<{ id: string; amount: number; remaining_amount: number } | null>(null);
  const [fineDialogOpen, setFineDialogOpen] = useState(false);
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [gigDriverUploadOpen, setGigDriverUploadOpen] = useState(false);
  const [gigDriverDeleteId, setGigDriverDeleteId] = useState<string | null>(null);
  const [editingDob, setEditingDob] = useState(false);
  const [dobValue, setDobValue] = useState("");
  const [savingDob, setSavingDob] = useState(false);
  const dobInputRef = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [verificationDialogOpen, setVerificationDialogOpen] = useState(false);
  const [cmdDialogOpen, setCmdDialogOpen] = useState(false);
  const [verificationTab, setVerificationTab] = useState<"cmd" | "ai">("cmd");
  const [nameValue, setNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Pagination state per tab
  const [rentalsPage, setRentalsPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [finesPage, setFinesPage] = useState(1);
  const PAGE_SIZE = 10;

  const { tenant } = useTenant();
  const { toast } = useToast();
  const currencyCode = tenant?.currency_code || 'USD';

  const { blockCustomer, unblockCustomer, isLoading: blockingLoading } = useCustomerBlockingActions();

  // Fetch latest identity verification for this customer (DOB fallback + photos)
  const { data: latestVerification } = useQuery({
    queryKey: ["customer-verification", id],
    queryFn: async () => {
      // Prefer completed verifications over init/pending ones.
      // Scope to AI/Veriff only — CMD has its own dedicated tab + query.
      const { data: completedData } = await (supabase as any)
        .from("identity_verifications")
        .select("date_of_birth, document_expiry_date, face_image_url, selfie_image_url, document_front_url, document_back_url, status, provider, verification_completed_at")
        .eq("customer_id", id)
        .eq("status", "completed")
        .in("provider", ["ai", "veriff"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (completedData) return completedData;
      // Fallback to latest AI/Veriff record if no completed one exists.
      const { data, error } = await (supabase as any)
        .from("identity_verifications")
        .select("date_of_birth, document_expiry_date, face_image_url, selfie_image_url, document_front_url, document_back_url, status, provider, verification_completed_at")
        .eq("customer_id", id)
        .in("provider", ["ai", "veriff"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as {
        date_of_birth: string | null;
        document_expiry_date: string | null;
        face_image_url: string | null;
        selfie_image_url: string | null;
        document_front_url: string | null;
        document_back_url: string | null;
        status: string | null;
        provider: string | null;
        verification_completed_at: string | null;
      } | null;
    },
    enabled: !!id,
  });

  // CMD (Modives CheckMyDriver) verification — runs in parallel to the AI flow above.
  const { data: cmdVerification } = useCmdVerification(id);
  const { data: cmdResults } = useCmdResults(cmdVerification?.cmd_applicant_verification_id);
  const resendCmdMutation = useResendCmdLink();
  const hasCmd = !!cmdVerification;

  const [previewImage, setPreviewImage] = useState<{ url: string; label: string } | null>(null);

  const { data: customer, isLoading, refetch: refetchCustomer } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("customers")
        .select(`
          id, name, email, phone, status, whatsapp_opt_in,
          license_number, id_number, date_of_birth, is_blocked, blocked_at, blocked_reason,
          is_gig_driver,
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

  const handleStartEditDob = () => {
    const currentDob = customer?.date_of_birth || latestVerification?.date_of_birth || "";
    setDobValue(currentDob);
    setEditingDob(true);
    setTimeout(() => dobInputRef.current?.focus(), 0);
  };

  const handleSaveDob = async () => {
    if (!dobValue) return;
    setSavingDob(true);
    try {
      const { error } = await (supabase as any)
        .from("customers")
        .update({ date_of_birth: dobValue })
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Date of birth updated" });
      setEditingDob(false);
      refetchCustomer();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to update DOB", variant: "destructive" });
    } finally {
      setSavingDob(false);
    }
  };

  const handleCancelEditDob = () => {
    setEditingDob(false);
    setDobValue("");
  };

  const handleStartEditName = () => {
    setNameValue(customer?.name || "");
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const handleSaveName = async () => {
    if (!nameValue.trim()) return;
    setSavingName(true);
    try {
      const { error } = await (supabase as any)
        .from("customers")
        .update({ name: nameValue.trim() })
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Customer name updated" });
      setEditingName(false);
      refetchCustomer();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to update name", variant: "destructive" });
    } finally {
      setSavingName(false);
    }
  };

  const handleCancelEditName = () => {
    setEditingName(false);
    setNameValue("");
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
  const { data: gigDriverImages } = useGigDriverImages(id);
  const deleteGigDriverImage = useDeleteGigDriverImage();

  // Per-rental outstanding, matched to the rental detail page math so the same
  // number shows in both places. Switch the source by rental type:
  //   - PAYG rentals: sum open payg_accruals' day_total (rental detail's
  //     `balanceDue` in use-payg-invoices.ts uses exactly this).
  //   - Fixed-term rentals: sum ledger_entries.remaining_amount on Charges.
  // Mixing both sources double-counts open PAYG days (the ledger Charge row
  // and the open accrual point at the same money).
  const { data: rentalOutstandings } = useQuery({
    queryKey: ["customer-rental-outstandings", tenant?.id, id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const rentalsRes = await supabase
        .from("rentals")
        .select("id, is_pay_as_you_go")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", id);
      if (rentalsRes.error) throw rentalsRes.error;

      const paygRentalIds = (rentalsRes.data || [])
        .filter(r => r.is_pay_as_you_go)
        .map(r => r.id);
      const fixedRentalIds = (rentalsRes.data || [])
        .filter(r => !r.is_pay_as_you_go)
        .map(r => r.id);

      const [paygRes, ledgerRes] = await Promise.all([
        paygRentalIds.length > 0
          ? supabase
              .from("payg_accruals")
              .select("rental_id, daily_rate, tax_amount, service_fee_amount, rentals!inner(payg_closed_at)")
              .eq("tenant_id", tenant.id)
              .in("rental_id", paygRentalIds)
              .eq("invoice_status", "open")
              .is("rentals.payg_closed_at", null)
          : Promise.resolve({ data: [], error: null }),
        fixedRentalIds.length > 0
          ? supabase
              .from("ledger_entries")
              .select("rental_id, remaining_amount")
              .eq("tenant_id", tenant.id)
              .in("rental_id", fixedRentalIds)
              .eq("type", "Charge")
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (paygRes.error) console.error("PAYG outstanding fetch failed:", paygRes.error);
      if (ledgerRes.error) throw ledgerRes.error;

      const map: Record<string, number> = {};
      (paygRes.data as any[])?.forEach(a => {
        const key = a.rental_id || "__no_rental__";
        const dayTotal = Number(a.daily_rate || 0) + Number(a.tax_amount || 0) + Number(a.service_fee_amount || 0);
        map[key] = (map[key] || 0) + dayTotal;
      });
      (ledgerRes.data as any[])?.forEach(entry => {
        const key = entry.rental_id || "__no_rental__";
        map[key] = (map[key] || 0) + Number(entry.remaining_amount || 0);
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
          boldsign_mode,
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
    return (
      <div className="space-y-8 pt-4">
        <div className="flex items-center justify-between">
          <Shimmer className="h-7 w-40" />
          <Shimmer className="h-9 w-64 rounded-tile" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Shimmer className="h-64 rounded-tile lg:col-span-2" />
          <Shimmer className="h-64 rounded-tile" />
        </div>
        <TableSkeleton rows={6} cols={6} />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="pt-4">
        <ErrorState
          title="Customer not found"
          description="We couldn't find this customer. They may have been deleted."
          onRetry={() => router.push("/customers")}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-8">
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
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          {/* Blocked badge if applicable */}
          <div className="flex items-center gap-3">
            {customer.is_blocked && (
              <Badge variant="destructive">
                <Ban className="h-3 w-3 mr-1" />
                Blocked
              </Badge>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {!customer.is_blocked ? (
              <>
                <Button size="sm" onClick={() => router.push(`/rentals/new?customer=${id}`)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Rental
                </Button>
                <Button size="sm" variant="outline" onClick={() => setCollectDialogOpen(true)}>
                  <DollarSign className="h-4 w-4 mr-1" />
                  Collect Payment
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditBalanceOpen(true)}>
                  <Scale className="h-4 w-4 mr-1" />
                  Edit Balance
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
                className="border-[color:var(--bento-success)] text-[color:var(--bento-success)] hover:[background:var(--bento-success-weak)]"
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

      {/* Profile & Verification */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Personal Information */}
        <Card className="lg:col-span-2 shadow-bento rounded-tile">
          <CardHeader className="pb-2 pt-4 px-5 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Personal Information</CardTitle>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditCustomerOpen(true)} title="Edit customer info">
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </CardHeader>
          <CardContent className="pt-3 pb-4 px-5">
            <div className="space-y-3">
              {/* Contact Information */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground mb-0.5">Name</span>
                  {editingName ? (
                    <div className="flex items-center gap-1">
                      <Input
                        ref={nameInputRef}
                        type="text"
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        className="h-7 text-sm w-[180px]"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveName();
                          if (e.key === "Escape") handleCancelEditName();
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleSaveName} disabled={savingName || !nameValue.trim()}>
                        <Check className="h-3.5 w-3.5 text-[color:var(--bento-success)]" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCancelEditName} disabled={savingName}>
                        <X className="h-3.5 w-3.5 text-[color:var(--bento-danger-fg)]" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 group">
                      <span className="text-sm font-semibold">{customer.name}</span>
                      <button
                        onClick={handleStartEditName}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                        title="Edit name"
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                </div>
                {customer.email && <MetricItem label="Email" value={customer.email} />}
                {customer.phone && <MetricItem label="Phone" value={customer.phone} />}
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground mb-0.5">Date of Birth</span>
                  {editingDob ? (
                    <div className="flex items-center gap-1">
                      <Input
                        ref={dobInputRef}
                        type="date"
                        value={dobValue}
                        onChange={(e) => setDobValue(e.target.value)}
                        className="h-7 text-sm w-[140px]"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveDob();
                          if (e.key === "Escape") handleCancelEditDob();
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleSaveDob} disabled={savingDob || !dobValue}>
                        <Check className="h-3.5 w-3.5 text-[color:var(--bento-success)]" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCancelEditDob} disabled={savingDob}>
                        <X className="h-3.5 w-3.5 text-[color:var(--bento-danger-fg)]" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 group">
                      <span className="text-sm font-semibold">
                        {(customer.date_of_birth || latestVerification?.date_of_birth)
                          ? format(new Date((customer.date_of_birth || latestVerification?.date_of_birth)!), 'MMM d, yyyy')
                          : "Not set"}
                      </span>
                      <button
                        onClick={handleStartEditDob}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
                        title="Edit date of birth"
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground mb-0.5">Gig Driver</span>
                  <span className="text-sm font-semibold">
                    {customer.is_gig_driver ? (
                      <StatusPill tone="success">
                        <Briefcase className="h-3 w-3" />
                        Yes
                      </StatusPill>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Additional Info */}
              {(customer.license_number || customer.id_number || customer.whatsapp_opt_in) && (
                <>
                  <MetricDivider />
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
                    {customer.license_number && <MetricItem label="License No." value={customer.license_number} />}
                    {customer.id_number && <MetricItem label="ID Number" value={customer.id_number} />}
                    {customer.whatsapp_opt_in && (
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground mb-0.5">WhatsApp</span>
                        <Badge variant="outline" className="w-fit text-[10px] px-1.5 py-0">
                          <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                          Opted In
                        </Badge>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Next of Kin */}
              {(customer.nok_full_name || customer.nok_phone || customer.nok_email) && (
                <>
                  <MetricDivider />
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      Next of Kin
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
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

        {/* Right: Verification (CMD + AI) */}
        <Card className="shadow-bento rounded-tile">
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base font-semibold">Verification</CardTitle>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {!hasCmd && latestVerification?.status && (
                  <StatusPill
                    tone={
                      latestVerification.status === 'approved'
                        ? 'success'
                        : latestVerification.status === 'declined'
                        ? 'danger'
                        : 'warn'
                    }
                    dot
                  >
                    {latestVerification.status === 'approved' ? 'Verified' : latestVerification.status === 'declined' ? 'Declined' : 'Pending'}
                  </StatusPill>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setVerificationDialogOpen(true)}
                >
                  {latestVerification?.status === 'approved' ? (
                    <>
                      <RefreshCw className="h-3 w-3" />
                      Re-verify
                    </>
                  ) : (
                    <>
                      <Shield className="h-3 w-3" />
                      Verify
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-3 pb-4 px-5">
            {hasCmd ? (
              <Tabs value={verificationTab} onValueChange={(v) => setVerificationTab(v as "cmd" | "ai")} className="space-y-3">
                <TabsList className="grid grid-cols-2 h-8 p-0.5">
                  <TabsTrigger value="cmd" className="text-xs gap-1.5 h-7">
                    <ShieldCheck className="h-3 w-3" />
                    CMD
                    {cmdVerification?.cmd_license_status === 'Valid' && (
                      <span className="h-1.5 w-1.5 rounded-full [background:var(--bento-success)]" />
                    )}
                    {(cmdVerification?.cmd_license_status === 'Invalid' || cmdVerification?.cmd_license_status === 'Expired') && (
                      <span className="h-1.5 w-1.5 rounded-full [background:var(--bento-danger-fg)]" />
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="ai" className="text-xs gap-1.5 h-7">
                    <Shield className="h-3 w-3" />
                    AI
                    {latestVerification?.status === 'approved' && (
                      <span className="h-1.5 w-1.5 rounded-full [background:var(--bento-success)]" />
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="cmd" className="mt-3 space-y-3">
                  <CmdLicensePill status={cmdVerification?.cmd_license_status as CmdLicenseStatus} />

                  {cmdResults?.license && (cmdResults.license.licenseNumber || cmdResults.license.licenseHolderFullName) ? (
                    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5">
                      {cmdResults.license.licenseHolderFullName && (
                        <DetailRow label="Holder" value={cmdResults.license.licenseHolderFullName} />
                      )}
                      {cmdResults.license.licenseNumber && (
                        <DetailRow label="License #" value={cmdResults.license.licenseNumber} mono />
                      )}
                      {cmdResults.license.licenseExpiryDate && (
                        <DetailRow
                          label="Expires"
                          value={format(new Date(cmdResults.license.licenseExpiryDate), 'MMM d, yyyy')}
                        />
                      )}
                      {cmdResults.license.licenseState && (
                        <DetailRow
                          label="State"
                          value={`${cmdResults.license.licenseState}${cmdResults.license.licenseCity ? ' · ' + cmdResults.license.licenseCity : ''}`}
                        />
                      )}
                    </div>
                  ) : (
                    cmdVerification?.cmd_license_status === 'Pending' && (
                      <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border py-6 text-center">
                        <Loader2 className="h-5 w-5 text-muted-foreground/50 animate-spin mb-2" />
                        <p className="text-xs text-muted-foreground">Waiting for the customer to complete verification</p>
                        <p className="text-[11px] text-muted-foreground/60 mt-0.5">This page will update automatically</p>
                      </div>
                    )
                  )}

                  {cmdResults?.license?.documentURLs && cmdResults.license.documentURLs.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {cmdResults.license.documentURLs.slice(0, 2).map((url, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setPreviewImage({ url, label: `License Doc ${i + 1}` })}
                          className="relative aspect-[3/2] rounded-lg overflow-hidden border border-border hover:border-primary/50 transition-colors"
                        >
                          <BlurredImage src={url} alt={`License doc ${i + 1}`} label={`Doc ${i + 1}`} />
                          <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] py-1 text-center z-10">
                            Doc {i + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="text-[11px] text-muted-foreground">
                      {cmdVerification?.cmd_last_event_at
                        ? `Last update ${format(new Date(cmdVerification.cmd_last_event_at), 'MMM d, h:mm a')}`
                        : 'No events yet'}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px] gap-1 text-primary hover:text-primary hover:[background:var(--bento-primary-weak)]"
                      disabled={!cmdVerification || resendCmdMutation.isPending}
                      onClick={() =>
                        cmdVerification &&
                        resendCmdMutation.mutate({
                          verificationId: cmdVerification.id,
                          customerId: id,
                          channels: (cmdVerification.cmd_delivery_channels as ("email"|"sms"|"whatsapp")[]) ?? ["email"],
                        })
                      }
                    >
                      {resendCmdMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Resend link
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="ai" className="mt-3">
                  <AiVerificationGrid
                    verification={latestVerification}
                    onPreview={(p) => setPreviewImage(p)}
                  />
                </TabsContent>
              </Tabs>
            ) : (
              <>
                <AiVerificationGrid
                  verification={latestVerification}
                  onPreview={(p) => setPreviewImage(p)}
                />
                {latestVerification?.verification_completed_at && (
                  <p className="text-[11px] text-muted-foreground mt-3 text-center">
                    Verified on {format(new Date(latestVerification.verification_completed_at), 'MMM d, yyyy')}
                    {latestVerification.provider && ` via ${latestVerification.provider}`}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Image Preview Dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>{previewImage?.label}</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <div className="px-4 pb-4">
              <img src={previewImage.url} alt={previewImage.label} className="w-full rounded-lg" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Customer Review Summary */}
      <CustomerReviewSummaryCard customerId={id} customerName={customer?.name} />

      {/* Complete Tabbed Interface */}
      <div className="relative">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="overflow-x-auto scrollbar-hide">
            <TabsList variant="sticky-evenly-spaced" className="min-w-full">
              <TabsTrigger value="rentals" variant="evenly-spaced" className="min-w-0">
                Rentals
              </TabsTrigger>
              <TabsTrigger value="payments" variant="evenly-spaced" className="min-w-0">
                Payments
              </TabsTrigger>
              <TabsTrigger value="fines" variant="evenly-spaced" className="min-w-0">
                Fines
              </TabsTrigger>
              <TabsTrigger value="vehicles" variant="evenly-spaced" className="min-w-0">
                Vehicle History
              </TabsTrigger>
              <TabsTrigger value="documents" variant="evenly-spaced" className="min-w-0">
                Documents
              </TabsTrigger>
              {customer?.is_gig_driver && (
                <TabsTrigger value="gig-driver" variant="evenly-spaced" className="min-w-0">
                  Gig Driver
                </TabsTrigger>
              )}
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
                <>
                <div className="rounded-md border max-h-[500px] overflow-auto relative">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
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
                      {rentals.slice((rentalsPage - 1) * PAGE_SIZE, rentalsPage * PAGE_SIZE).map((rental) => {
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
                            {format(parseLocalDate(rental.start_date), "MM/dd/yyyy")}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {rental.end_date ? format(parseLocalDate(rental.end_date), "MM/dd/yyyy") : "Ongoing"}
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
                              <span className="text-[color:var(--bento-danger-fg)] font-mono font-medium tabular-nums">{formatCurrency(outstanding, currencyCode)}</span>
                            ) : (
                              <span className="text-[color:var(--bento-success)] font-medium">Settled</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusPill tone={statusTone(rental.status)} dot>
                              {rental.status}
                            </StatusPill>
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
                {rentals.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {(rentalsPage - 1) * PAGE_SIZE + 1}-{Math.min(rentalsPage * PAGE_SIZE, rentals.length)} of {rentals.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setRentalsPage(p => Math.max(1, p - 1))} disabled={rentalsPage === 1}>
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {rentalsPage} of {Math.ceil(rentals.length / PAGE_SIZE)}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => setRentalsPage(p => Math.min(Math.ceil(rentals.length / PAGE_SIZE), p + 1))} disabled={rentalsPage >= Math.ceil(rentals.length / PAGE_SIZE)}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
                </>
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

        <TabsContent value="payments" className="mt-6 space-y-4">
          {/* Balance summary — shows the full picture so operators can reconcile
              against the customer's bank statement / Stripe dashboard. Without
              this, "Collected $X" and "Balance $Y" make it look like money is
              missing when in reality $Z of captured payments is sitting on the
              customer's account as unallocated credit. */}
          {customerBalanceData && (
            <div className="space-y-3">
              <div>
                <h2 className="text-base font-bold tracking-tight">Balance Summary</h2>
                <p className="text-sm text-muted-foreground">
                  Lifetime totals across all rentals. Use these to reconcile against Stripe and the customer's bank statement.
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiTile
                  label="Total charges"
                  value={customerBalanceData.totalCharges}
                  noCountUp
                  format={(v) => formatCurrency(v, currencyCode)}
                />
                <KpiTile
                  label="Applied to charges"
                  value={Math.max(0, customerBalanceData.totalCharges - customerBalanceData.outstandingDebt)}
                  noCountUp
                  format={(v) => formatCurrency(v, currencyCode)}
                />
                <KpiTile
                  label="Outstanding"
                  value={customerBalanceData.outstandingDebt}
                  noCountUp
                  format={(v) => (
                    <span className={customerBalanceData.outstandingDebt > 0 ? "text-[color:var(--bento-danger-fg)]" : ""}>
                      {formatCurrency(v, currencyCode)}
                    </span>
                  )}
                />
                <KpiTile
                  label="Available credit"
                  value={customerBalanceData.availableCredit}
                  noCountUp
                  format={(v) => (
                    <span className={customerBalanceData.availableCredit > 0 ? "text-[color:var(--bento-success)]" : ""}>
                      {formatCurrency(v, currencyCode)}
                    </span>
                  )}
                />
              </div>
              {customerBalanceData.availableCredit > 0 && (
                <p className="text-xs text-muted-foreground">
                  Available credit is money already captured from the customer that hasn't yet been applied to a charge. It will auto-apply (FIFO) to the next open charge.
                </p>
              )}
            </div>
          )}

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
                <>
                <div className="rounded-md border max-h-[500px] overflow-auto relative">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-semibold">Date</TableHead>
                        <TableHead className="font-semibold text-right">Amount</TableHead>
                        <TableHead className="font-semibold">Method</TableHead>
                        <TableHead className="font-semibold">Vehicle</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold text-right">Remaining</TableHead>
                        <TableHead className="font-semibold text-center">Stripe</TableHead>
                        <TableHead className="font-semibold text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.slice((paymentsPage - 1) * PAGE_SIZE, paymentsPage * PAGE_SIZE).map((payment) => (
                        <TableRow key={payment.id} className="hover:bg-muted/50 transition-colors">
                          <TableCell className="whitespace-nowrap">
                            {format(new Date(payment.payment_date), "MM/dd/yyyy")}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium tabular-nums">
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
                              <span className="text-[color:var(--bento-warn-accent)] font-mono font-medium tabular-nums">
                                {formatCurrency(payment.remaining_amount, currencyCode)}
                              </span>
                            ) : (
                              <span className="text-[color:var(--bento-success)] font-medium">Fully Applied</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {payment.stripe_payment_intent_id ? (
                              <a
                                href={`https://dashboard.stripe.com/payments/${payment.stripe_payment_intent_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                                title={`Open in Stripe Dashboard (${payment.capture_status ?? 'captured'})`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {payment.remaining_amount > 0.005 ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setAllocatePayment({ id: payment.id, amount: payment.amount, remaining_amount: payment.remaining_amount })}
                              >
                                Allocate
                              </Button>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {payments.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {(paymentsPage - 1) * PAGE_SIZE + 1}-{Math.min(paymentsPage * PAGE_SIZE, payments.length)} of {payments.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPaymentsPage(p => Math.max(1, p - 1))} disabled={paymentsPage === 1}>
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {paymentsPage} of {Math.ceil(payments.length / PAGE_SIZE)}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => setPaymentsPage(p => Math.min(Math.ceil(payments.length / PAGE_SIZE), p + 1))} disabled={paymentsPage >= Math.ceil(payments.length / PAGE_SIZE)}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
                </>
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
              <CardTitle>Customer Fines</CardTitle>
              <CardDescription>All fines associated with this customer</CardDescription>
            </CardHeader>
            <CardContent>
              {fines && fines.length > 0 ? (
                <>
                <div className="rounded-md border max-h-[500px] overflow-auto relative">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
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
                      {fines.slice((finesPage - 1) * PAGE_SIZE, finesPage * PAGE_SIZE).map((fine) => (
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
                {fines.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-4">
                    <p className="text-sm text-muted-foreground">
                      Showing {(finesPage - 1) * PAGE_SIZE + 1}-{Math.min(finesPage * PAGE_SIZE, fines.length)} of {fines.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setFinesPage(p => Math.max(1, p - 1))} disabled={finesPage === 1}>
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {finesPage} of {Math.ceil(fines.length / PAGE_SIZE)}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => setFinesPage(p => Math.min(Math.ceil(fines.length / PAGE_SIZE), p + 1))} disabled={finesPage >= Math.ceil(fines.length / PAGE_SIZE)}>
                        Next
                      </Button>
                    </div>
                  </div>
                )}
                </>
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
                <div className="rounded-md border max-h-[500px] overflow-auto relative">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
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
                                  <DocumentSigningStatusBadge status={rental.document_status || 'pending'} boldsignMode={rental.boldsign_mode} />
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

        {customer?.is_gig_driver && (
          <TabsContent value="gig-driver" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Briefcase className="h-5 w-5" />
                    Gig Driver Documents
                  </span>
                  <Button size="sm" onClick={() => setGigDriverUploadOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Images
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {gigDriverImages && gigDriverImages.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {gigDriverImages.map((image) => {
                      const { data: urlData } = supabase.storage.from('gig-driver-images').getPublicUrl(image.image_url);
                      return (
                        <div key={image.id} className="relative group rounded-lg overflow-hidden border">
                          <div className="aspect-square bg-muted overflow-hidden">
                            <BlurredImage
                              src={urlData.publicUrl}
                              alt={image.file_name}
                              label="View"
                            />
                          </div>
                          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="h-7 w-7 p-0"
                              onClick={(e) => { e.stopPropagation(); window.open(urlData.publicUrl, '_blank'); }}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                            {gigDriverImages && gigDriverImages.length > 1 && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 w-7 p-0"
                                onClick={(e) => { e.stopPropagation(); setGigDriverDeleteId(image.id); }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                          <div className="p-2">
                            <p className="text-xs text-muted-foreground truncate">{image.file_name}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    icon={ImageIcon}
                    title="No gig driver documents"
                    description="Upload proof images showing this customer's gig driver status."
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        </Tabs>
      </div>

      {/* Gig Driver Dialogs */}
      <GigDriverUploadDialog
        open={gigDriverUploadOpen}
        onOpenChange={setGigDriverUploadOpen}
        customerId={id}
      />

      <AlertDialog open={!!gigDriverDeleteId} onOpenChange={(open) => !open && setGigDriverDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this gig driver document? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const image = gigDriverImages?.find(i => i.id === gigDriverDeleteId);
              if (image) {
                deleteGigDriverImage.mutate(image);
              }
              setGigDriverDeleteId(null);
            }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialogs */}
      <AddPaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        customer_id={id}
      />

      <CollectPaymentDialog
        open={collectDialogOpen}
        onOpenChange={setCollectDialogOpen}
        customerId={id!}
      />

      <EditBalanceDialog
        open={editBalanceOpen}
        onOpenChange={setEditBalanceOpen}
        customerId={id!}
        customerName={customer.name}
        currentOutstanding={customerBalanceData?.outstandingDebt ?? 0}
        currentCredit={customerBalanceData?.availableCredit ?? 0}
      />

      <AllocatePaymentDialog
        open={!!allocatePayment}
        onOpenChange={(v) => { if (!v) setAllocatePayment(null); }}
        payment={allocatePayment}
        customerId={id!}
      />

      <AddFineDialog
        open={fineDialogOpen}
        onOpenChange={setFineDialogOpen}
        preselectedCustomerId={id}
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
              <Label htmlFor="block-reason">Reason for blocking <span className="text-destructive">*</span></Label>
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

      {/* Start Verification Dialog */}
      {customer && (
        <StartVerificationDialog
          open={verificationDialogOpen}
          onOpenChange={setVerificationDialogOpen}
          customerId={id}
          customerName={customer.name}
        />
      )}

      {/* Start CMD (Modives) Verification Dialog */}
      {customer && (
        <StartCmdVerificationDialog
          open={cmdDialogOpen}
          onOpenChange={setCmdDialogOpen}
          customerId={id}
          customer={{
            name: customer.name,
            email: customer.email ?? null,
            phone: customer.phone ?? null,
            date_of_birth: customer.date_of_birth ?? null,
          }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Small helper components scoped to this page only — not extracted to avoid
// premature abstraction.
// ─────────────────────────────────────────────────────────────────────────────

function CmdLicensePill({ status }: { status: CmdLicenseStatus }) {
  const map: Record<string, { label: string; tone: StatusTone; icon: React.ReactNode }> = {
    Valid: {
      label: 'License valid',
      tone: 'success',
      icon: <CheckCircle className="h-3 w-3" />,
    },
    Invalid: {
      label: 'License invalid',
      tone: 'danger',
      icon: <Ban className="h-3 w-3" />,
    },
    Expired: {
      label: 'License expired',
      tone: 'warn',
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    Pending: {
      label: 'Waiting for customer',
      tone: 'primary',
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
  };
  const config = (status && map[status]) || map.Pending;
  return (
    <StatusPill tone={config.tone} className="h-6">
      {config.icon}
      {config.label}
    </StatusPill>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wide text-[color:var(--bento-text-3)]">{label}</span>
      <span className={`text-[13px] text-foreground/90 ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</span>
    </div>
  );
}

function AiVerificationGrid({
  verification,
  onPreview,
}: {
  verification: {
    face_image_url?: string | null;
    selfie_image_url?: string | null;
    document_front_url?: string | null;
    document_back_url?: string | null;
  } | null | undefined;
  onPreview: (p: { url: string; label: string }) => void;
}) {
  const photos = verification
    ? [
        { url: verification.face_image_url, label: 'Face Photo', short: 'Face' },
        { url: verification.selfie_image_url, label: 'Selfie', short: 'Selfie' },
        { url: verification.document_front_url, label: 'Document Front', short: 'Doc Front' },
        { url: verification.document_back_url, label: 'Document Back', short: 'Doc Back' },
      ].filter((p) => p.url)
    : [];

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <ImageIcon className="h-10 w-10 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">No verification photos</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">
          Photos will appear here once the customer completes ID verification
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {photos.map((p) => (
        <button
          key={p.short}
          onClick={() => onPreview({ url: p.url!, label: p.label })}
          className="relative aspect-square rounded-lg overflow-hidden border border-border hover:border-primary/50 transition-colors"
        >
          <BlurredImage src={p.url!} alt={p.label} label={p.short} />
          <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] py-1 text-center z-10">
            {p.short}
          </span>
        </button>
      ))}
    </div>
  );
}

export default CustomerDetail;
