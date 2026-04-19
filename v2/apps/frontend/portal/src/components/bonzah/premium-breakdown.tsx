import type { CalculatePremiumResponse } from '@drive247/shared-types';
import { COVERAGE_TIER_LABELS } from '@drive247/shared-types';

export function PremiumBreakdown({
  premium,
  loading,
}: {
  premium: CalculatePremiumResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-md border bg-[#f8fafc] p-3 text-sm text-muted-foreground">
        Calculating premium...
      </div>
    );
  }
  if (!premium) {
    return (
      <div className="rounded-md border bg-[#f8fafc] p-3 text-sm text-muted-foreground">
        Select coverage and dates to see the premium.
      </div>
    );
  }

  const tiers = ['cdw', 'rcli', 'sli', 'pai'] as const;

  return (
    <div className="rounded-md border bg-white p-3 space-y-2">
      {tiers.map((t) => {
        const val = premium.breakdown[t];
        if (val <= 0) return null;
        return (
          <div key={t} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{COVERAGE_TIER_LABELS[t]}</span>
            <span>{formatUsd(val)}</span>
          </div>
        );
      })}
      <div className="flex justify-between border-t pt-2 text-sm font-medium">
        <span>Total ({premium.days} day{premium.days !== 1 ? 's' : ''})</span>
        <span>{formatUsd(premium.totalPremium)}</span>
      </div>
    </div>
  );
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}
