'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
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
} from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useRentalAgreements, type RentalAgreement } from '@/hooks/use-rental-agreements';
import { useRentalInsurancePolicies, type CustomerInsurancePolicy } from '@/hooks/use-rental-insurance-policies';
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
import { ExtendRentalDialog } from '@/components/customer-portal/ExtendRentalDialog';
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

function PaymentSubSection({
  sectionPayments,
  outstanding,
  currencyCode,
  onPay,
  paying,
}: {
  sectionPayments: any[];
  outstanding: number;
  currencyCode: string;
  onPay?: () => void;
  paying?: boolean;
}) {
  const sectionTotal = sectionPayments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

  if (sectionPayments.length === 0 && outstanding <= 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Payments</span>
      </div>
      <div className="ml-6 space-y-1.5">
        {sectionPayments.map((payment: any) => (
          <div key={payment.id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-green-600" />
              <span>{formatCurrency(payment.amount || 0, currencyCode)}</span>
              <span className="text-xs text-muted-foreground">
                {formatDate(payment.payment_date)}
                {payment.method && ` · ${payment.method}`}
              </span>
            </div>
            <Badge className={`text-[10px] ${getPaymentStatusColor(payment.status || '')}`}>
              {payment.status}
            </Badge>
          </div>
        ))}
        {sectionPayments.length > 0 && (
          <div className="flex items-center justify-between text-sm pt-1 border-t">
            <span className="text-muted-foreground">Paid</span>
            <span className="font-medium">{formatCurrency(sectionTotal, currencyCode)}</span>
          </div>
        )}
        {outstanding > 0 && (
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Balance Due: {formatCurrency(outstanding, currencyCode)}
              </span>
            </div>
            {onPay && (
              <Button size="sm" variant="default" onClick={onPay} disabled={paying}>
                {paying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                )}
                Pay Now
              </Button>
            )}
          </div>
        )}
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
      const { data, error } = await supabase
        .from('rentals')
        .select(`
          id, start_date, end_date, status, monthly_amount, rental_period_type,
          payment_status, approval_status, pickup_location, return_location,
          created_at, has_installment_plan, is_extended, previous_end_date,
          original_end_date, cancellation_requested, cancellation_reason,
          extension_checkout_url, extension_amount, delivery_method, delivery_address, delivery_fee,
          document_status, docusign_envelope_id, signed_document_id,
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

  const originalOutstanding = useMemo(
    () =>
      ledgerEntries
        .filter((e) => e.type === 'Charge' && !extensionCategories.includes(e.category))
        .reduce((sum, e) => sum + (e.remaining_amount || 0), 0),
    [ledgerEntries]
  );

  const extensionOutstandingTotal = useMemo(
    () =>
      ledgerEntries
        .filter((e) => e.type === 'Charge' && extensionCategories.includes(e.category))
        .reduce((sum, e) => sum + (e.remaining_amount || 0), 0),
    [ledgerEntries]
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

  // ---- Payment handlers ----

  const [payingExtension, setPayingExtension] = useState(false);
  const [payingBalance, setPayingBalance] = useState(false);
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);

  const canExtend = rental?.status === 'Active' && !rental?.is_extended;
  const hasExtensionPending = rental?.is_extended === true;

  const handlePayExtension = async () => {
    if (!rental || !tenant?.id) return;
    setPayingExtension(true);
    try {
      const extAmount = rental.extension_amount;
      if (!extAmount || extAmount <= 0) {
        if (rental.extension_checkout_url) {
          window.location.href = rental.extension_checkout_url;
        }
        return;
      }
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId: rental.id,
          totalAmount: extAmount,
          tenantId: tenant.id,
          customerEmail: customerUser?.customer?.email,
          source: 'booking',
          targetCategories: ['Extension Rental', 'Extension Tax', 'Extension Service Fee', 'Extension Insurance'],
          successUrl: `${window.location.origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rental.id}&type=invoice`,
          cancelUrl: `${window.location.origin}/portal/bookings/${rental.id}`,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else if (rental.extension_checkout_url) {
        window.location.href = rental.extension_checkout_url;
      }
    } catch {
      if (rental.extension_checkout_url) {
        window.location.href = rental.extension_checkout_url;
      } else {
        toast.error('Failed to create payment link');
      }
    } finally {
      setPayingExtension(false);
    }
  };

  const handlePayBalance = async () => {
    if (!rental || !tenant?.id || originalOutstanding <= 0) return;
    setPayingBalance(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          rentalId: rental.id,
          totalAmount: originalOutstanding,
          tenantId: tenant.id,
          customerEmail: customerUser?.customer?.email,
          source: 'booking',
          successUrl: `${window.location.origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rental.id}&type=invoice`,
          cancelUrl: `${window.location.origin}/portal/bookings/${rental.id}`,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        toast.error('Failed to create payment link');
      }
    } catch {
      toast.error('Failed to create payment link');
    } finally {
      setPayingBalance(false);
    }
  };

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
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold truncate">
              {vehicle
                ? `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || vehicle.reg
                : 'Booking Details'}
            </h1>
            <Badge className={getRentalStatusColor(rental.status)}>
              {rental.status?.replace(/_/g, ' ')}
            </Badge>
            {hasExtensionPending && (
              <Badge className="bg-amber-100 text-amber-800">Extension Pending</Badge>
            )}
          </div>
          {vehicle?.reg && (
            <p className="text-sm text-muted-foreground">{vehicle.reg}</p>
          )}
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

      {/* 1. Original Rental */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Car className="h-5 w-5" />
            Original Rental
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {originalAgreement ? (
            <AgreementSection agreement={originalAgreement} currencyCode={currencyCode} />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileSignature className="h-4 w-4" />
              <span>No agreement created yet</span>
            </div>
          )}

          {originalInsurance && (
            <>
              <Separator />
              <InsuranceSection policy={originalInsurance} currencyCode={currencyCode} />
            </>
          )}

          {/* Original rental payments */}
          <Separator />
          <PaymentSubSection
            sectionPayments={payments}
            outstanding={originalOutstanding}
            currencyCode={currencyCode}
            onPay={originalOutstanding > 0 ? handlePayBalance : undefined}
            paying={payingBalance}
          />
        </CardContent>
      </Card>

      {/* 2. Extension Sections — each with its own agreement, insurance, and payments */}
      {extensionSections.map((ext) => (
        <Card key={ext.agreement.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Extension #{ext.index}
              {ext.agreement.period_start_date && ext.agreement.period_end_date && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  {formatDate(ext.agreement.period_start_date)} &mdash;{' '}
                  {formatDate(ext.agreement.period_end_date)}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AgreementSection agreement={ext.agreement} currencyCode={currencyCode} />

            {ext.insurance && (
              <>
                <Separator />
                <InsuranceSection policy={ext.insurance} currencyCode={currencyCode} />
              </>
            )}

            {ext.ledgerEntry && (
              <>
                <Separator />
                <div className="flex items-center gap-2 text-sm">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Extension Fee:</span>
                  <span className="font-medium">
                    {formatCurrency(Math.abs(ext.ledgerEntry.amount || 0), currencyCode)}
                  </span>
                  {ext.ledgerEntry.reference && (
                    <span className="text-muted-foreground text-xs">
                      &mdash; {ext.ledgerEntry.reference}
                    </span>
                  )}
                </div>
              </>
            )}

            {/* Extension payment — show outstanding if any */}
            {extensionOutstandingTotal > 0 && (
              <>
                <Separator />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                      Balance Due: {formatCurrency(extensionOutstandingTotal, currencyCode)}
                    </span>
                  </div>
                  <Button size="sm" onClick={handlePayExtension} disabled={payingExtension}>
                    {payingExtension ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    )}
                    Pay Now
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ))}

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

      {/* Extend Rental Dialog */}
      {rental && (
        <ExtendRentalDialog
          open={extendDialogOpen}
          onOpenChange={setExtendDialogOpen}
          rental={rental as unknown as CustomerRental}
        />
      )}
    </div>
  );
}
