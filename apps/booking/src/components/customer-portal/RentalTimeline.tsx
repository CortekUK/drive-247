'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Shield,
  FileSignature,
  CheckCircle,
  Clock,
  XCircle,
  Mail,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Download,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import { useRentalAgreements } from '@/hooks/use-rental-agreements';
import type { RentalAgreement } from '@/hooks/use-rental-agreements';
import { useRentalInsurancePolicies } from '@/hooks/use-rental-insurance-policies';
import type { CustomerInsurancePolicy } from '@/hooks/use-rental-insurance-policies';
import {
  useSignAgreement,
  useViewAgreement,
  useDownloadAgreement,
} from '@/hooks/use-customer-agreements';
import type { CustomerAgreement } from '@/hooks/use-customer-agreements';
import { toast } from 'sonner';

interface RentalTimelineProps {
  rentalId: string;
}

// ── Shared types ──

type TimelineItem =
  | { type: 'agreement'; data: RentalAgreement; sortDate: string }
  | { type: 'insurance'; data: CustomerInsurancePolicy; sortDate: string };

// ── Coverage helpers ──

const COVERAGE_LABELS: Record<string, string> = {
  cdw: 'CDW',
  rcli: 'RCLI',
  sli: 'SLI',
  pai: 'PAI',
};

// ── Agreement status helpers ──

function getAgreementDotClass(status: string | null): string {
  const isSigned = status === 'signed' || status === 'completed';
  if (isSigned) return 'bg-green-500';
  if (status === 'sent' || status === 'delivered') return 'bg-amber-500';
  return 'bg-gray-400';
}

function getAgreementStatusBadge(status: string | null) {
  const isSigned = status === 'signed' || status === 'completed';
  if (isSigned) {
    return { label: 'Signed', className: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800' };
  }
  if (status === 'sent' || status === 'delivered') {
    return { label: status === 'delivered' ? 'Viewed' : 'Awaiting Signature', className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800' };
  }
  return { label: 'Pending', className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700' };
}

// ── Insurance status helpers ──

function getInsuranceDotClass(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-500';
    case 'quoted':
    case 'payment_pending':
      return 'bg-amber-500';
    default:
      return 'bg-gray-400';
  }
}

function getInsuranceStatusBadge(status: string) {
  switch (status) {
    case 'active':
      return { label: 'Active', className: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800' };
    case 'quoted':
    case 'payment_pending':
      return { label: 'Pending', className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800' };
    default:
      return { label: status, className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700' };
  }
}

// ── Adaptor: RentalAgreement → CustomerAgreement (for mutation hooks) ──

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

// ── Agreement timeline item ──

function AgreementItem({
  agreement,
  isLast,
}: {
  agreement: RentalAgreement;
  isLast: boolean;
}) {
  const signMutation = useSignAgreement();
  const viewMutation = useViewAgreement();
  const downloadMutation = useDownloadAgreement();
  const [signingLoading, setSigningLoading] = useState(false);

  const statusBadge = getAgreementStatusBadge(agreement.document_status);
  const dotClass = getAgreementDotClass(agreement.document_status);
  const isSigned =
    agreement.document_status === 'signed' ||
    agreement.document_status === 'completed' ||
    !!agreement.signed_document_id;
  const isExtension = agreement.agreement_type === 'extension';
  const canSign = !isSigned && !!agreement.document_id;

  const handleSign = async () => {
    setSigningLoading(true);
    try {
      const result = await signMutation.mutateAsync(toCustomerAgreement(agreement));
      if (result.signingUrl) {
        window.open(result.signingUrl, '_blank');
      } else if (result.emailSent) {
        toast.success('Signing link sent to your email');
      }
    } catch {
      toast.error('Failed to get signing link');
    } finally {
      setSigningLoading(false);
    }
  };

  const handleView = async () => {
    try {
      const url = await viewMutation.mutateAsync(toCustomerAgreement(agreement));
      window.open(url, '_blank');
    } catch {
      // Error toast handled by mutation
    }
  };

  const handleDownload = () => {
    downloadMutation.mutate(toCustomerAgreement(agreement));
  };

  return (
    <div className="relative flex gap-3">
      {/* Dot + line */}
      <div className="flex flex-col items-center">
        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${dotClass}`} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <FileSignature className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">
                {isExtension ? 'Extension Agreement' : 'Original Agreement'}
              </span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${statusBadge.className}`}>
                {statusBadge.label}
              </Badge>
            </div>

            {/* Period dates */}
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {isExtension
                ? `Extended to ${agreement.period_end_date ? format(new Date(agreement.period_end_date), 'MMM d, yyyy') : 'N/A'}`
                : agreement.period_start_date && agreement.period_end_date
                ? `${format(new Date(agreement.period_start_date), 'MMM d, yyyy')} – ${format(new Date(agreement.period_end_date), 'MMM d, yyyy')}`
                : ''}
            </p>

            {/* Timestamps */}
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {agreement.envelope_sent_at && `Sent ${format(new Date(agreement.envelope_sent_at), 'MMM d')}`}
              {agreement.envelope_sent_at && agreement.envelope_completed_at && ' · '}
              {agreement.envelope_completed_at && `Signed ${format(new Date(agreement.envelope_completed_at), 'MMM d')}`}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-1 flex-shrink-0">
            {canSign && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={handleSign}
                disabled={signingLoading}
              >
                {signingLoading ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <ExternalLink className="h-3 w-3 mr-1" />
                )}
                Sign
              </Button>
            )}
            {isSigned && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={handleView}
                  disabled={viewMutation.isPending}
                >
                  {viewMutation.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3 w-3 mr-1" />
                  )}
                  View
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={handleDownload}
                  disabled={downloadMutation.isPending}
                >
                  {downloadMutation.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3 mr-1" />
                  )}
                  PDF
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Insurance timeline item ──

function InsuranceItem({
  policy,
  isLast,
  currencyCode,
}: {
  policy: CustomerInsurancePolicy;
  isLast: boolean;
  currencyCode: string;
}) {
  const coverageTypes = policy.coverage_types || {};
  const activeCoverages = Object.entries(COVERAGE_LABELS).filter(
    ([key]) => coverageTypes[key]
  );
  const statusBadge = getInsuranceStatusBadge(policy.status);
  const dotClass = getInsuranceDotClass(policy.status);
  const isExtension = policy.policy_type === 'extension';

  return (
    <div className="relative flex gap-3">
      {/* Dot + line */}
      <div className="flex flex-col items-center">
        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${dotClass}`} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">
                {isExtension ? 'Extension Insurance' : 'Original Insurance'}
              </span>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${statusBadge.className}`}>
                {statusBadge.label}
              </Badge>
            </div>

            {/* Coverage badges + trip dates */}
            <div className="flex items-center gap-1 flex-wrap mt-1">
              {activeCoverages.map(([key, label]) => (
                <Badge
                  key={key}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 h-4"
                >
                  {label}
                </Badge>
              ))}
              <span className="text-[10px] text-muted-foreground ml-1">
                {format(new Date(policy.trip_start_date), 'MMM dd')} – {format(new Date(policy.trip_end_date), 'MMM dd, yyyy')}
              </span>
            </div>
          </div>

          {/* Premium */}
          <span className="text-xs font-semibold flex-shrink-0">
            {formatCurrency(policy.premium_amount, currencyCode)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ──

export function RentalTimeline({ rentalId }: RentalTimelineProps) {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';

  const { data: agreements = [], isLoading: agreementsLoading } = useRentalAgreements(rentalId);
  const { data: policies = [], isLoading: policiesLoading } = useRentalInsurancePolicies(rentalId);

  const [expanded, setExpanded] = useState(true);

  const isLoading = agreementsLoading || policiesLoading;

  // Merge into chronological timeline
  const timelineItems: TimelineItem[] = [
    ...agreements.map((a) => ({
      type: 'agreement' as const,
      data: a,
      sortDate: a.created_at || '',
    })),
    ...policies.map((p) => ({
      type: 'insurance' as const,
      data: p,
      sortDate: p.created_at || '',
    })),
  ].sort((a, b) => a.sortDate.localeCompare(b.sortDate));

  // Nothing to show
  if (!isLoading && timelineItems.length === 0) return null;

  // Loading state
  if (isLoading && timelineItems.length === 0) return null;

  // Summary counts
  const agreementCount = agreements.length;
  const policyCount = policies.length;
  const summaryParts: string[] = [];
  if (agreementCount > 0) summaryParts.push(`${agreementCount} agreement${agreementCount > 1 ? 's' : ''}`);
  if (policyCount > 0) summaryParts.push(`${policyCount} policy${policyCount > 1 ? 'ies' : ''}`);
  const summaryText = summaryParts.join(' · ');

  return (
    <div className="pt-2 border-t mt-2">
      {/* Toggle header */}
      <button
        type="button"
        className="flex items-center justify-between w-full text-left group"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs font-medium text-muted-foreground">
          {summaryText}
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Timeline */}
      {expanded && (
        <div className="mt-2">
          {timelineItems.map((item, index) => {
            const isLast = index === timelineItems.length - 1;
            if (item.type === 'agreement') {
              return (
                <AgreementItem
                  key={`agreement-${item.data.id}`}
                  agreement={item.data}
                  isLast={isLast}
                />
              );
            }
            return (
              <InsuranceItem
                key={`insurance-${item.data.id}`}
                policy={item.data}
                isLast={isLast}
                currencyCode={currencyCode}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
