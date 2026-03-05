'use client';

import { Badge } from '@/components/ui/badge';
import { Shield, CheckCircle, Clock, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import { useRentalInsurancePolicies } from '@/hooks/use-rental-insurance-policies';

interface InsurancePoliciesSectionProps {
  rentalId: string;
}

const COVERAGE_LABELS: Record<string, string> = {
  cdw: 'CDW',
  rcli: 'RCLI',
  sli: 'SLI',
  pai: 'PAI',
};

function getStatusConfig(status: string) {
  switch (status) {
    case 'active':
      return { label: 'Active', icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800' };
    case 'quoted':
    case 'payment_pending':
      return { label: 'Pending', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800' };
    default:
      return { label: status, icon: XCircle, color: 'text-gray-500', bg: 'bg-gray-50 dark:bg-gray-900/20', border: 'border-gray-200 dark:border-gray-800' };
  }
}

export function InsurancePoliciesSection({ rentalId }: InsurancePoliciesSectionProps) {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';
  const { data: policies, isLoading } = useRentalInsurancePolicies(rentalId);

  if (isLoading || !policies || policies.length === 0) return null;

  return (
    <div className="pt-2 border-t mt-2 space-y-2">
      {policies.map((policy) => {
        const coverageTypes = policy.coverage_types || {};
        const activeCoverages = Object.entries(COVERAGE_LABELS).filter(
          ([key]) => coverageTypes[key]
        );
        const statusConfig = getStatusConfig(policy.status);
        const StatusIcon = statusConfig.icon;
        const isExtension = policy.policy_type === 'extension';

        return (
          <div
            key={policy.id}
            className={`p-2.5 rounded-lg border ${statusConfig.bg} ${statusConfig.border} space-y-1.5`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Shield className={`h-3.5 w-3.5 ${statusConfig.color}`} />
                <span className={`text-xs font-medium ${statusConfig.color}`}>
                  {isExtension ? 'Extension Insurance' : 'Insurance'}
                </span>
                <StatusIcon className={`h-3 w-3 ${statusConfig.color}`} />
              </div>
              <span className="text-xs font-semibold">
                {formatCurrency(policy.premium_amount, currencyCode)}
              </span>
            </div>

            {/* Coverage badges */}
            <div className="flex items-center gap-1 flex-wrap">
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
        );
      })}
    </div>
  );
}
