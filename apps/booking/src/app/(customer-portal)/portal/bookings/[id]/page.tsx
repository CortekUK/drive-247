'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Car,
  Calendar,
  MapPin,
  FileSignature,
  Shield,
  CreditCard,
  ArrowLeft,
  ExternalLink,
  Download,
  Clock,
  CheckCircle,
  Loader2,
  AlertCircle,
  CalendarPlus,
  Copy,
} from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useRentalAgreements, type RentalAgreement } from '@/hooks/use-rental-agreements';
import { useRentalInsurancePolicies, type CustomerInsurancePolicy } from '@/hooks/use-rental-insurance-policies';
import { useRentalExtensionTotals, sumExtensionOutstanding } from '@/hooks/use-rental-extension-totals';
import { useRentalInvoice, useRentalPaymentBreakdown } from '@/hooks/use-rental-invoice';
import { useRentalCharges } from '@/hooks/use-rental-ledger-data';
import {
  useSignAgreement,
  useViewAgreement,
  useDownloadAgreement,
  type CustomerAgreement,
} from '@/hooks/use-customer-agreements';
import { formatCurrency } from '@/lib/format-utils';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ExtendRentalDialog } from '@/components/customer-portal/ExtendRentalDialog';
import PaymentBreakdown from '@/components/customer-portal/PaymentBreakdown';
import type { CustomerRental } from '@/hooks/use-customer-rentals';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COVERAGE_LABELS: Record<string, string> = {
  cdw: 'CDW',
  rcli: 'RCLI',
  sli: 'SLI',
  pai: 'PAI',
};

function toCustomerAgreement(a: RentalAgreement): CustomerAgreement {
  return {
    ...a,
    envelope_created_at: null,
    rental_number: null,
    rental_start_date: a.period_start_date || '',
    rental_end_date: a.period_end_date || null,
    vehicles: null,
  };
}

function formatDate(date: string | null | undefined): string {
  if (!date) return '-';
  try {
    return format(new Date(date), 'dd MMM yyyy');
  } catch {
    return '-';
  }
}

function formatDateTime(date: string | null | undefined): string {
  if (!date) return '-';
  try {
    return format(new Date(date), 'dd MMM yyyy, HH:mm');
  } catch {
    return '-';
  }
}

function getRentalStatusColor(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'active':
    case 'confirmed':
      return 'bg-green-100 text-green-800';
    case 'pending':
    case 'pending_approval':
      return 'bg-amber-100 text-amber-800';
    case 'completed':
      return 'bg-blue-100 text-blue-800';
    case 'cancelled':
    case 'canceled':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function getAgreementStatusColor(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'completed':
    case 'signed':
      return 'bg-green-100 text-green-800';
    case 'sent':
    case 'delivered':
      return 'bg-amber-100 text-amber-800';
    case 'declined':
    case 'voided':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function getAgreementStatusLabel(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'sent':
      return 'Awaiting Signature';
    case 'delivered':
      return 'Viewed';
    case 'signed':
      return 'Signed';
    case 'completed':
      return 'Completed';
    case 'declined':
      return 'Declined';
    case 'voided':
      return 'Voided';
    default:
      return 'Pending';
  }
}

function getInsuranceStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'active':
    case 'issued':
      return 'bg-green-100 text-green-800';
    case 'pending':
      return 'bg-amber-100 text-amber-800';
    case 'expired':
    case 'cancelled':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function getPaymentStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'applied':
    case 'paid':
    case 'succeeded':
      return 'bg-green-100 text-green-800';
    case 'pending':
      return 'bg-amber-100 text-amber-800';
    case 'failed':
    case 'overdue':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function getInstallmentStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'paid':
      return 'bg-green-100 text-green-800';
    case 'pending':
    case 'scheduled':
      return 'bg-amber-100 text-amber-800';
    case 'overdue':
    case 'failed':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function getPeriodLabel(type: string | null): string {
  switch (type?.toLowerCase()) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    default:
      return type || '-';
  }
}

// ---------------------------------------------------------------------------
// Brand icons
// ---------------------------------------------------------------------------

function BoldSignIcon({ className }: { className?: string }) {
  return (
    <img src="/boldsign-logo.svg" alt="BoldSign" className={`dark:hidden ${className || 'h-4 w-4'}`} />
  );
}

function BoldSignIconDark({ className }: { className?: string }) {
  return (
    <img src="/boldsign-logo-dark.svg" alt="BoldSign" className={`hidden dark:block ${className || 'h-4 w-4'}`} />
  );
}

function BonzahIcon({ className }: { className?: string }) {
  return (
    <img src="/bonzah-logo.svg" alt="Bonzah" className={`dark:hidden ${className || 'h-4'}`} />
  );
}

function BonzahIconDark({ className }: { className?: string }) {
  return (
    <img src="/bonzah-logo-dark.svg" alt="Bonzah" className={`hidden dark:block ${className || 'h-4'}`} />
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgreementSection({
  agreement,
  currencyCode,
}: {
  agreement: RentalAgreement;
  currencyCode: string;
}) {
  const signMutation = useSignAgreement();
  const viewMutation = useViewAgreement();
  const downloadMutation = useDownloadAgreement();

  const isSigned =
    agreement.document_status === 'completed' || agreement.document_status === 'signed';
  const isPending =
    agreement.document_status === 'sent' || agreement.document_status === 'delivered';
  const hasDocument = !!agreement.document_id;

  const handleSign = async () => {
    const result = await signMutation.mutateAsync(toCustomerAgreement(agreement));
    if (result.signingUrl) {
      window.open(result.signingUrl, '_blank');
    } else if (result.emailSent) {
      toast.success('Signing link sent to your email');
    }
  };

  const handleView = async () => {
    const url = await viewMutation.mutateAsync(toCustomerAgreement(agreement));
    if (url) {
      window.open(url, '_blank');
    }
  };

  const handleDownload = () => {
    downloadMutation.mutate(toCustomerAgreement(agreement));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative h-4 w-4 flex-shrink-0">
          <BoldSignIcon className="h-4 w-4" />
          <BoldSignIconDark className="h-4 w-4" />
        </div>
        <span className="text-sm font-medium">Agreement</span>
        {hasDocument && (
          <Badge className={getAgreementStatusColor(agreement.document_status)}>
            {getAgreementStatusLabel(agreement.document_status)}
          </Badge>
        )}
        {!hasDocument && (
          <Badge className="bg-gray-100 text-gray-800">Not Created</Badge>
        )}
      </div>

      {hasDocument && (
        <div className="ml-6 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {agreement.envelope_sent_at && (
              <>
                <span className="text-muted-foreground">Sent</span>
                <span>{formatDateTime(agreement.envelope_sent_at)}</span>
              </>
            )}
            {agreement.envelope_completed_at && (
              <>
                <span className="text-muted-foreground">Signed</span>
                <span>{formatDateTime(agreement.envelope_completed_at)}</span>
              </>
            )}
            {agreement.period_start_date && (
              <>
                <span className="text-muted-foreground">Period</span>
                <span>
                  {formatDate(agreement.period_start_date)} &mdash;{' '}
                  {formatDate(agreement.period_end_date)}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            {isPending && (
              <Button
                size="sm"
                onClick={handleSign}
                disabled={signMutation.isPending}
              >
                {signMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <FileSignature className="h-3 w-3 mr-1" />
                )}
                Sign
              </Button>
            )}
            {isSigned && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleView}
                  disabled={viewMutation.isPending}
                >
                  {viewMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <ExternalLink className="h-3 w-3 mr-1" />
                  )}
                  View
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownload}
                  disabled={downloadMutation.isPending}
                >
                  {downloadMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Download className="h-3 w-3 mr-1" />
                  )}
                  Download
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InsuranceSection({
  policy,
  currencyCode,
}: {
  policy: CustomerInsurancePolicy;
  currencyCode: string;
}) {
  const activeCoverages = Object.entries(COVERAGE_LABELS).filter(
    ([key]) => policy.coverage_types?.[key]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative h-4 flex-shrink-0">
          <BonzahIcon className="h-4" />
          <BonzahIconDark className="h-4" />
        </div>
        <span className="text-sm font-medium">Insurance</span>
        <Badge className={getInsuranceStatusColor(policy.status)}>
          {policy.status}
        </Badge>
      </div>

      <div className="ml-6 space-y-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {activeCoverages.length > 0 && (
            <>
              <span className="text-muted-foreground">Coverage</span>
              <span>{activeCoverages.map(([, label]) => label).join(', ')}</span>
            </>
          )}
          <span className="text-muted-foreground">Period</span>
          <span>
            {formatDate(policy.trip_start_date)} &mdash;{' '}
            {formatDate(policy.trip_end_date)}
          </span>
          <span className="text-muted-foreground">Premium</span>
          <span className="font-medium">
            {formatCurrency(policy.premium_amount, currencyCode)}
          </span>
          {policy.policy_issued_at && (
            <>
              <span className="text-muted-foreground">Issued</span>
              <span>{formatDateTime(policy.policy_issued_at)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BookingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';

  const { tenant } = useTenant();
  const { customerUser } = useCustomerAuthStore();
  const currencyCode = tenant?.currency_code || 'USD';

  // ---- Data fetching ----

  const { data: rental, isLoading: rentalLoading } = useQuery({
    queryKey: ['customer-rental-detail', id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('rentals')
        .select(`
          id, rental_number, start_date, end_date, status, monthly_amount, rental_period_type,
          payment_status, approval_status, pickup_location, return_location,
          created_at, has_installment_plan, is_extended, previous_end_date,
          original_end_date, cancellation_requested, cancellation_reason,
          extension_checkout_url, extension_amount, delivery_method, delivery_address, delivery_fee,
          collection_fee, deposit_hold_status, deposit_hold_amount,
          document_status, docusign_envelope_id, signed_document_id,
          is_pay_as_you_go, payg_start_ts, payg_next_accrual_at, payg_last_reminder_sent_at,
          payg_reminder_count, payg_reminder_interval_days, payg_paused, payg_closed_at,
          payg_accrual_day_count,
          vehicles:vehicle_id (id, reg, make, model, colour, photo_url, daily_mileage, weekly_mileage, monthly_mileage, excess_mileage_rate, vehicle_photos (photo_url)),
          installment_plans!installment_plans_rental_id_fkey (id, plan_type, status, total_installable_amount, upfront_amount, upfront_paid, installment_amount, number_of_installments, paid_installments, total_paid, next_due_date, scheduled_installments (id, installment_number, amount, due_date, status))
        `)
        .eq('id', id)
        .eq('customer_id', customerUser?.customer_id as string)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id && !!customerUser?.customer_id,
  });

  const { data: agreements = [] } = useRentalAgreements(id || undefined);

  const { data: insurancePolicies = [] } = useRentalInsurancePolicies(id || undefined);

  const { data: ledgerEntries = [] } = useQuery({
    queryKey: ['customer-rental-ledger', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('ledger_entries')
        .select('id, category, reference, amount, type, entry_date, remaining_amount')
        .eq('rental_id', id)
        .order('entry_date', { ascending: true });
      return data || [];
    },
    enabled: !!id,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['customer-rental-payments', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('payments')
        .select('id, amount, status, payment_date, method, capture_status')
        .eq('rental_id', id)
        .eq('status', 'Applied')
        .order('payment_date', { ascending: false });
      return data || [];
    },
    enabled: !!id,
  });

  const queryClient = useQueryClient();
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`customer-rental-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_entries', filter: `rental_id=eq.${id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['customer-rental-ledger', id] });
        queryClient.invalidateQueries({ queryKey: ['rental-invoice'] });
        queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] });
        queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
        queryClient.invalidateQueries({ queryKey: ['rental-refund-breakdown'] });
        queryClient.invalidateQueries({ queryKey: ['rental-extension-totals'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `rental_id=eq.${id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['customer-rental-payments', id] });
        queryClient.invalidateQueries({ queryKey: ['rental-extension-totals'] });
        queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_applications' }, () => {
        queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
        queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] });
        queryClient.invalidateQueries({ queryKey: ['rental-extension-totals'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_extensions', filter: `rental_id=eq.${id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['rental-extension-totals'] });
        queryClient.invalidateQueries({ queryKey: ['customer-rental-ledger', id] });
        queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rentals', filter: `id=eq.${id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['customer-rental-detail', id] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  // ---- Derived data ----

  const vehicle = rental?.vehicles as any;
  const installmentPlan = (rental?.installment_plans as any)?.[0] || null;

  const originalAgreement = useMemo(
    () => agreements.find((a) => a.agreement_type === 'original') || null,
    [agreements]
  );
  const extensionAgreements = useMemo(
    () => agreements.filter((a) => a.agreement_type === 'extension'),
    [agreements]
  );

  // Build extension sections from extension agreements, enriched with insurance + ledger
  const extensionSections = useMemo(() => {
    return extensionAgreements.map((agreement, idx) => {
      // Find matching insurance policy by overlapping dates
      const matchingPolicy = insurancePolicies.find((p) => {
        if (!agreement.period_start_date) return false;
        return p.trip_start_date >= (agreement.period_start_date || '');
      });

      // Find matching extension ledger entry
      const matchingLedger = ledgerEntries.find(
        (e) =>
          (e.category === 'Extension Rental' || e.category === 'Extension') &&
          e.entry_date &&
          agreement.period_start_date &&
          e.entry_date >= agreement.period_start_date
      );

      return {
        index: idx + 1,
        agreement,
        insurance: matchingPolicy || null,
        ledgerEntry: matchingLedger || null,
      };
    });
  }, [extensionAgreements, insurancePolicies, ledgerEntries]);

  // Original insurance = first policy that is NOT matched to an extension
  const originalInsurance = useMemo(() => {
    const extensionPolicyIds = new Set(
      extensionSections.map((s) => s.insurance?.id).filter(Boolean)
    );
    return insurancePolicies.find((p) => !extensionPolicyIds.has(p.id)) || null;
  }, [insurancePolicies, extensionSections]);

  const totalPaid = useMemo(
    () => payments.reduce((sum, p) => sum + (p.amount || 0), 0),
    [payments]
  );

  // Per-section outstanding: original charges vs extension charges
  const extensionCategories = ['Extension Rental', 'Extension Tax', 'Extension Service Fee', 'Extension Insurance', 'Extension'];

  // Use invoice + ledger to compute outstanding the same way admin does.
  // Ledger charges are authoritative when present; otherwise fall back to
  // invoice amounts so a freshly-created rental with no ledger entries still
  // shows the correct amount due.
  const { data: invoiceBreakdown } = useRentalInvoice(id || undefined);
  const { data: rentalChargesForOutstanding } = useRentalCharges(id || undefined);
  const { data: paymentBreakdownByCategory } = useRentalPaymentBreakdown(id || undefined);

  const originalOutstanding = useMemo(() => {
    const amounts: Record<string, number> = {};
    const hasLedgerData = new Set<string>();

    if (paymentBreakdownByCategory) {
      for (const [cat, data] of Object.entries(paymentBreakdownByCategory)) {
        if (extensionCategories.includes(cat)) continue;
        hasLedgerData.add(cat);
        if (data.remaining > 0) amounts[cat] = data.remaining;
      }
    }

    if (invoiceBreakdown) {
      const insuranceCharge = (rentalChargesForOutstanding || []).find((c) => c.category === 'Insurance');
      const collectionCharge = (rentalChargesForOutstanding || []).find((c) => c.category === 'Collection Fee');
      // Security Deposit is intentionally omitted — never an outstanding
      // charge. Deposits live on rentals.deposit_hold_* and are Stripe
      // preauth holds, not owed money.
      const invoiceCategoryMap: Record<string, number> = {
        Rental: invoiceBreakdown.rentalFee,
        Tax: invoiceBreakdown.taxAmount,
        Insurance: insuranceCharge?.amount ?? invoiceBreakdown.insurancePremium ?? 0,
        'Service Fee': invoiceBreakdown.serviceFee,
        'Delivery Fee': (rental as any)?.delivery_fee || invoiceBreakdown.deliveryFee || 0,
        'Collection Fee': collectionCharge ? Number(collectionCharge.amount) : ((rental as any)?.collection_fee ?? 0),
        Extras: invoiceBreakdown.extrasTotal ?? 0,
      };

      for (const [cat, invAmount] of Object.entries(invoiceCategoryMap)) {
        if (amounts[cat] !== undefined || hasLedgerData.has(cat)) continue;
        if (invAmount <= 0) continue;
        amounts[cat] = invAmount;
      }
    }

    return Object.values(amounts).reduce((s, v) => s + v, 0);
  }, [paymentBreakdownByCategory, invoiceBreakdown, rentalChargesForOutstanding, rental]);

  // Phase 5: authoritative extension outstanding from the unified view.
  // Replaces the old ledger-sum which drifted when extension insurance was
  // added before its ledger entry landed, and which double-counted during
  // partial refunds.
  const { data: extensionTotals } = useRentalExtensionTotals(id || undefined);
  const extensionOutstandingTotal = useMemo(
    () => sumExtensionOutstanding(extensionTotals),
    [extensionTotals]
  );

  const vehiclePhotoUrl =
    vehicle?.photo_url ||
    vehicle?.vehicle_photos?.[0]?.photo_url ||
    null;

  const mileageAllowance = (() => {
    if (!vehicle) return null;
    switch (rental?.rental_period_type?.toLowerCase()) {
      case 'daily':
        return vehicle.daily_mileage;
      case 'weekly':
        return vehicle.weekly_mileage;
      case 'monthly':
        return vehicle.monthly_mileage;
      default:
        return vehicle.monthly_mileage || vehicle.weekly_mileage || vehicle.daily_mileage;
    }
  })();

  const [extendDialogOpen, setExtendDialogOpen] = useState(false);

  // PAYG rentals are open-ended by definition — the customer "extends" by simply
  // continuing to rent (daily accrual), so the extension flow doesn't apply.
  const canExtend = rental?.status === 'Active' && !rental?.is_extended && !(rental as any)?.is_pay_as_you_go;
  const hasExtensionPending = rental?.is_extended === true;

  // ---- Loading state ----

  if (rentalLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="flex gap-6">
          <Skeleton className="h-40 w-56 rounded-lg" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-52" />
          </div>
        </div>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!rental) {
    return (
      <div className="space-y-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/portal/bookings')}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Bookings
        </Button>
        <Card className="p-8 text-center">
          <Car className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-2">Booking not found</h3>
          <p className="text-muted-foreground">
            This booking doesn&apos;t exist or you don&apos;t have access to it.
          </p>
        </Card>
      </div>
    );
  }

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Back button + header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/portal/bookings')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          {(() => {
            const ref = (rental as { rental_number?: string | null }).rental_number || rental.id?.slice(0, 8).toUpperCase();
            const vehicleTitle = vehicle
              ? `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || vehicle.reg
              : 'Booking Details';
            return (
              <>
                <div className="flex items-center gap-3 flex-wrap group">
                  <h1 className="text-2xl font-bold font-mono tabular-nums tracking-tight">
                    #{ref || '—'}
                  </h1>
                  {ref && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(String(ref));
                          toast.success('Reference copied', { description: ref });
                        } catch {
                          toast.error('Copy failed');
                        }
                      }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      title="Copy reference"
                      aria-label="Copy reference number"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  )}
                  <Badge className={getRentalStatusColor(rental.status)}>
                    {rental.status?.replace(/_/g, ' ')}
                  </Badge>
                  {hasExtensionPending && (
                    <Badge className="bg-amber-100 text-amber-800">Extension Pending</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1 truncate">
                  {vehicleTitle}
                  {vehicle?.reg && ` • ${vehicle.reg}`}
                </p>
              </>
            );
          })()}
        </div>
        {canExtend && (
          <Button onClick={() => setExtendDialogOpen(true)}>
            <CalendarPlus className="h-4 w-4 mr-2" />
            Request Extension
          </Button>
        )}
      </div>

      {/* Vehicle photo + quick info */}
      {vehicle && (
        <div className="flex flex-col sm:flex-row gap-4">
          {vehiclePhotoUrl && (
            <div className="w-full sm:w-56 flex-shrink-0">
              <img
                src={vehiclePhotoUrl}
                alt={`${vehicle.make} ${vehicle.model}`}
                className="w-full h-36 object-cover rounded-lg border"
              />
            </div>
          )}
          <Card className="flex-1">
            <CardContent className="pt-4 pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                {vehicle.colour && (
                  <div className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Colour:</span>
                    <span className="capitalize">{vehicle.colour}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground">Period:</span>
                  <span>{getPeriodLabel(rental.rental_period_type)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground">Dates:</span>
                  <span>
                    {formatDate(rental.start_date)} &mdash; {formatDate(rental.end_date)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground">Amount:</span>
                  <span className="font-medium">
                    {formatCurrency(rental.monthly_amount || 0, currencyCode)}
                    {rental.rental_period_type && (
                      <span className="text-muted-foreground font-normal">
                        /{rental.rental_period_type === 'daily' ? 'day' : rental.rental_period_type === 'weekly' ? 'wk' : 'mo'}
                      </span>
                    )}
                  </span>
                </div>
                {rental.pickup_location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Pickup:</span>
                    <span className="truncate">{rental.pickup_location}</span>
                  </div>
                )}
                {rental.delivery_method && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Delivery:</span>
                    <span className="capitalize">{rental.delivery_method.replace(/_/g, ' ')}</span>
                    {rental.delivery_fee != null && rental.delivery_fee > 0 && (
                      <span className="text-muted-foreground">
                        ({formatCurrency(rental.delivery_fee, currencyCode)})
                      </span>
                    )}
                  </div>
                )}
                {mileageAllowance != null && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Mileage:</span>
                    <span>
                      {mileageAllowance.toLocaleString()} miles
                      {vehicle.excess_mileage_rate != null && (
                        <span className="text-muted-foreground">
                          {' '}
                          (excess: {formatCurrency(vehicle.excess_mileage_rate, currencyCode)}/mi)
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {rental.is_extended && rental.original_end_date && (
                <div className="mt-3 pt-3 border-t text-sm">
                  <div className="flex items-center gap-2 text-amber-700">
                    <Calendar className="h-4 w-4" />
                    <span>
                      Extended &mdash; Original end date:{' '}
                      <span className="font-medium">{formatDate(rental.original_end_date)}</span>,
                      Current end date:{' '}
                      <span className="font-medium">{formatDate(rental.end_date)}</span>
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Balance summary */}
      {(originalOutstanding + extensionOutstandingTotal) > 0 && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardContent className="pt-4 pb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  Outstanding Balance
                </p>
                <p className="text-lg font-semibold text-amber-700 dark:text-amber-400">
                  {formatCurrency(
                    originalOutstanding + extensionOutstandingTotal,
                    currencyCode
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs: Payments / Agreements / Insurance */}
      <Tabs defaultValue="payments" className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="agreements">Agreements</TabsTrigger>
          <TabsTrigger value="insurance">Insurance</TabsTrigger>
        </TabsList>

        <TabsContent value="payments" className="mt-4">
          <PaymentBreakdown
            rental={rental as any}
            customerEmail={customerUser?.customer?.email}
          />
        </TabsContent>

        <TabsContent value="agreements" className="mt-4 space-y-4">
          {/* Original */}
          <div className="rounded-lg border overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-green-500/5 border-b">
              <div className="h-8 w-8 rounded-full bg-green-500/15 flex items-center justify-center">
                <Car className="h-4 w-4 text-green-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Original Rental</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(rental.start_date)} &mdash; {formatDate(rental.end_date)}
                </p>
              </div>
              {originalAgreement && (
                <Badge className={getAgreementStatusColor(originalAgreement.document_status)}>
                  {getAgreementStatusLabel(originalAgreement.document_status)}
                </Badge>
              )}
            </div>
            <div className="p-4">
              {originalAgreement ? (
                <AgreementSection agreement={originalAgreement} currencyCode={currencyCode} />
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileSignature className="h-4 w-4" />
                  <span>No agreement created yet</span>
                </div>
              )}
            </div>
          </div>

          {/* Extensions */}
          {extensionSections.map((ext) => (
            <div key={`agr-${ext.index}`} className="rounded-lg border overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-blue-500/5 border-b">
                <div className="h-8 w-8 rounded-full bg-blue-500/15 flex items-center justify-center">
                  <CalendarPlus className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Extension #{ext.index}</p>
                  {ext.agreement.period_start_date && (
                    <p className="text-xs text-muted-foreground">
                      {formatDate(ext.agreement.period_start_date)} &mdash;{' '}
                      {formatDate(ext.agreement.period_end_date)}
                    </p>
                  )}
                </div>
                <Badge className={getAgreementStatusColor(ext.agreement.document_status)}>
                  {getAgreementStatusLabel(ext.agreement.document_status)}
                </Badge>
              </div>
              <div className="p-4">
                <AgreementSection agreement={ext.agreement} currencyCode={currencyCode} />
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="insurance" className="mt-4 space-y-4">
          {!originalInsurance && !extensionSections.some((e) => e.insurance) && (
            <Card className="p-8 text-center">
              <Shield className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No insurance policies yet</p>
            </Card>
          )}

          {originalInsurance && (
            <div className="rounded-lg border overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-green-500/5 border-b">
                <div className="h-8 w-8 rounded-full bg-green-500/15 flex items-center justify-center">
                  <Car className="h-4 w-4 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Original Rental</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(originalInsurance.trip_start_date)} &mdash;{' '}
                    {formatDate(originalInsurance.trip_end_date)}
                  </p>
                </div>
                <Badge className={getInsuranceStatusColor(originalInsurance.status)}>
                  {originalInsurance.status}
                </Badge>
              </div>
              <div className="p-4">
                <InsuranceSection policy={originalInsurance} currencyCode={currencyCode} />
              </div>
            </div>
          )}

          {extensionSections
            .filter((e) => e.insurance)
            .map((ext) => (
              <div key={`ins-${ext.index}`} className="rounded-lg border overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 bg-blue-500/5 border-b">
                  <div className="h-8 w-8 rounded-full bg-blue-500/15 flex items-center justify-center">
                    <CalendarPlus className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Extension #{ext.index}</p>
                    {ext.insurance && (
                      <p className="text-xs text-muted-foreground">
                        {formatDate(ext.insurance.trip_start_date)} &mdash;{' '}
                        {formatDate(ext.insurance.trip_end_date)}
                      </p>
                    )}
                  </div>
                  {ext.insurance && (
                    <Badge className={getInsuranceStatusColor(ext.insurance.status)}>
                      {ext.insurance.status}
                    </Badge>
                  )}
                </div>
                <div className="p-4">
                  {ext.insurance && (
                    <InsuranceSection policy={ext.insurance} currencyCode={currencyCode} />
                  )}
                </div>
              </div>
            ))}
        </TabsContent>
      </Tabs>

      {/* 4. Installment Plan */}
      {installmentPlan && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Installment Plan
              <Badge
                className={
                  installmentPlan.status === 'active'
                    ? 'bg-green-100 text-green-800'
                    : installmentPlan.status === 'completed'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-800'
                }
              >
                {installmentPlan.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {installmentPlan.paid_installments || 0} of{' '}
                  {installmentPlan.number_of_installments || 0} installments paid
                </span>
                <span className="font-medium">
                  {formatCurrency(installmentPlan.total_paid || 0, currencyCode)} /{' '}
                  {formatCurrency(installmentPlan.total_installable_amount || 0, currencyCode)}
                </span>
              </div>
              <Progress
                value={
                  installmentPlan.number_of_installments
                    ? ((installmentPlan.paid_installments || 0) /
                        installmentPlan.number_of_installments) *
                      100
                    : 0
                }
                className="h-2"
              />
            </div>

            {/* Summary row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              {installmentPlan.upfront_amount != null && installmentPlan.upfront_amount > 0 && (
                <div>
                  <p className="text-muted-foreground">Upfront</p>
                  <p className="font-medium">
                    {formatCurrency(installmentPlan.upfront_amount, currencyCode)}
                    {installmentPlan.upfront_paid && (
                      <CheckCircle className="h-3 w-3 text-green-600 inline ml-1" />
                    )}
                  </p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">Per Installment</p>
                <p className="font-medium">
                  {formatCurrency(installmentPlan.installment_amount || 0, currencyCode)}
                </p>
              </div>
              {installmentPlan.next_due_date && (
                <div>
                  <p className="text-muted-foreground">Next Due</p>
                  <p className="font-medium">{formatDate(installmentPlan.next_due_date)}</p>
                </div>
              )}
            </div>

            {/* Scheduled installments table */}
            {installmentPlan.scheduled_installments &&
              installmentPlan.scheduled_installments.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Schedule</h4>
                    <div className="rounded-md border">
                      <div className="grid grid-cols-4 gap-2 px-4 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                        <span>#</span>
                        <span>Due Date</span>
                        <span>Amount</span>
                        <span>Status</span>
                      </div>
                      {(installmentPlan.scheduled_installments as any[])
                        .sort((a: any, b: any) => a.installment_number - b.installment_number)
                        .map((inst: any) => (
                          <div
                            key={inst.id}
                            className="grid grid-cols-4 gap-2 px-4 py-2 border-t text-sm"
                          >
                            <span>{inst.installment_number}</span>
                            <span>{formatDate(inst.due_date)}</span>
                            <span>{formatCurrency(inst.amount || 0, currencyCode)}</span>
                            <Badge
                              className={`${getInstallmentStatusColor(inst.status)} w-fit text-xs`}
                            >
                              {inst.status}
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </div>
                </>
              )}
          </CardContent>
        </Card>
      )}

      {/* Cancellation notice */}
      {rental.cancellation_requested && (
        <Card className="border-red-200">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 p-2">
                <Clock className="h-4 w-4 text-red-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-red-800">Cancellation Requested</p>
                {rental.cancellation_reason && (
                  <p className="text-sm text-red-700 mt-1">{rental.cancellation_reason}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Extend Rental Dialog — not mounted for PAYG (open-ended, no end_date to extend) */}
      {rental && !(rental as any).is_pay_as_you_go && (
        <ExtendRentalDialog
          open={extendDialogOpen}
          onOpenChange={setExtendDialogOpen}
          rental={rental as unknown as CustomerRental}
        />
      )}
    </div>
  );
}
