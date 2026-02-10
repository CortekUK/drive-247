'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Shield, ShieldCheck, Car, Users, AlertCircle, Loader2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useBonzahPremium,
  COVERAGE_INFO,
  type CoverageOptions,
} from '@/hooks/use-bonzah-premium';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';

interface BonzahInsuranceSelectorProps {
  tripStartDate: string | null;
  tripEndDate: string | null;
  pickupState: string;
  onCoverageChange: (coverage: CoverageOptions, premium: number) => void;
  onSkipInsurance: () => void;
  initialCoverage?: CoverageOptions;
}

const DEFAULT_COVERAGE: CoverageOptions = {
  cdw: false,
  rcli: false,
  sli: false,
  pai: false,
};

const CoverageIcon = ({ type, className, style }: { type: keyof CoverageOptions; className?: string; style?: React.CSSProperties }) => {
  switch (type) {
    case 'cdw': return <Car className={className} style={style} />;
    case 'rcli': return <Shield className={className} style={style} />;
    case 'sli': return <ShieldCheck className={className} style={style} />;
    case 'pai': return <Users className={className} style={style} />;
  }
};

const coverageColors: Record<keyof CoverageOptions, string> = {
  cdw: '#3B82F6',
  rcli: '#10B981',
  sli: '#8B5CF6',
  pai: '#F59E0B',
};

export default function BonzahInsuranceSelector({
  tripStartDate,
  tripEndDate,
  pickupState,
  onCoverageChange,
  onSkipInsurance,
  initialCoverage = DEFAULT_COVERAGE,
}: BonzahInsuranceSelectorProps) {
  const { tenant } = useTenant();
  const [coverage, setCoverage] = useState<CoverageOptions>(initialCoverage);
  const hasInitialCoverage = initialCoverage.cdw || initialCoverage.rcli || initialCoverage.sli || initialCoverage.pai;
  const [showInsurance, setShowInsurance] = useState(hasInitialCoverage);

  const {
    totalPremium,
    breakdown,
    isLoading,
    isFetching,
    error,
    isReady,
  } = useBonzahPremium({
    tripStartDate,
    tripEndDate,
    pickupState,
    coverage,
    enabled: showInsurance,
  });

  useEffect(() => {
    if (showInsurance) {
      onCoverageChange(coverage, totalPremium);
    }
  }, [coverage, totalPremium, showInsurance]);

  const handleCoverageToggle = (type: keyof CoverageOptions) => {
    setCoverage(prev => {
      const newCoverage = { ...prev };
      newCoverage[type] = !newCoverage[type];
      if (type === 'rcli' && !newCoverage.rcli) {
        newCoverage.sli = false;
      }
      return newCoverage;
    });
  };

  const handleSkipInsurance = () => {
    setShowInsurance(false);
    setCoverage(DEFAULT_COVERAGE);
    onSkipInsurance();
  };

  const handleAddInsurance = () => {
    setShowInsurance(true);
  };

  const hasCoverage = coverage.cdw || coverage.rcli || coverage.sli || coverage.pai;

  if (!showInsurance) {
    return (
      <div className="p-4 rounded-lg border-2 border-dashed border-muted-foreground/30">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">Bonzah Insurance</p>
              <p className="text-xs text-muted-foreground">No insurance coverage selected (optional)</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleAddInsurance}>
            Add Insurance
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="font-medium">Bonzah Insurance</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground text-xs"
          onClick={handleSkipInsurance}
        >
          <X className="w-3 h-3 mr-1" />
          Skip
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Select insurance coverage for this rental. Premium is calculated based on the rental dates.
      </p>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p>Failed to calculate premium. Please try again.</p>
        </div>
      )}

      {/* Coverage Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(Object.keys(COVERAGE_INFO) as Array<keyof CoverageOptions>).map((type) => {
          const info = COVERAGE_INFO[type];
          const isSelected = coverage[type];
          const isDisabled = type === 'sli' && !coverage.rcli;
          const color = coverageColors[type];
          const price = breakdown[type];

          return (
            <div
              key={type}
              className={cn(
                'relative rounded-lg border-2 p-3 transition-all cursor-pointer',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : isDisabled
                    ? 'border-muted bg-muted/30 opacity-60 cursor-not-allowed'
                    : 'border-border hover:border-primary/40'
              )}
              onClick={() => !isDisabled && handleCoverageToggle(type)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <div
                    className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: isSelected ? `${color}20` : 'var(--muted)' }}
                  >
                    <CoverageIcon
                      type={type}
                      className={cn('w-4 h-4', isSelected ? '' : 'text-muted-foreground')}
                      style={isSelected ? { color } : undefined}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm">{info.shortName}</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-sm font-medium mb-1">{info.name}</p>
                            <p className="text-xs">{info.description}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{info.name}</p>
                    {type === 'sli' && !coverage.rcli && (
                      <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Requires RCLI
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Switch
                    checked={isSelected}
                    disabled={isDisabled}
                    onCheckedChange={() => handleCoverageToggle(type)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {isSelected && price > 0 && (
                    <span className="text-xs font-semibold" style={{ color }}>
                      {formatCurrency(price, tenant?.currency_code || 'USD')}
                    </span>
                  )}
                </div>
              </div>

              {isSelected && (
                <div
                  className="absolute top-0 left-0 w-1 h-full rounded-l-lg"
                  style={{ backgroundColor: color }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Premium Summary */}
      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Insurance Premium</span>
            {hasCoverage && (
              <Badge variant="secondary" className="text-xs">
                {Object.values(coverage).filter(Boolean).length} selected
              </Badge>
            )}
          </div>
          <div className="text-right">
            {isLoading || isFetching ? (
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="text-sm text-muted-foreground">Calculating...</span>
              </div>
            ) : (
              <span className="text-lg font-bold text-primary">{formatCurrency(totalPremium, tenant?.currency_code || 'USD')}</span>
            )}
          </div>
        </div>

        {hasCoverage && totalPremium > 0 && !isLoading && (
          <div className="mt-2 pt-2 border-t border-primary/10 flex flex-wrap gap-3 text-xs">
            {coverage.cdw && breakdown.cdw > 0 && (
              <span><span className="text-muted-foreground">CDW:</span> <span className="font-medium">{formatCurrency(breakdown.cdw, tenant?.currency_code || 'USD')}</span></span>
            )}
            {coverage.rcli && breakdown.rcli > 0 && (
              <span><span className="text-muted-foreground">RCLI:</span> <span className="font-medium">{formatCurrency(breakdown.rcli, tenant?.currency_code || 'USD')}</span></span>
            )}
            {coverage.sli && breakdown.sli > 0 && (
              <span><span className="text-muted-foreground">SLI:</span> <span className="font-medium">{formatCurrency(breakdown.sli, tenant?.currency_code || 'USD')}</span></span>
            )}
            {coverage.pai && breakdown.pai > 0 && (
              <span><span className="text-muted-foreground">PAI:</span> <span className="font-medium">{formatCurrency(breakdown.pai, tenant?.currency_code || 'USD')}</span></span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
