'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Check, Shield, ShieldCheck, Car, Users, AlertCircle, Loader2, X, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format-utils';
import { useTenant } from '@/contexts/TenantContext';
import {
  useBonzahPremium,
  COVERAGE_INFO,
  type CoverageOptions,
} from '@/hooks/useBonzahPremium';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface BonzahInsuranceSelectorProps {
  tripStartDate: string | null;  // YYYY-MM-DD
  tripEndDate: string | null;    // YYYY-MM-DD
  pickupState: string;           // US state code
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

// Coverage card icons
const CoverageIcon = ({ type, className, style }: { type: keyof CoverageOptions; className?: string; style?: React.CSSProperties }) => {
  switch (type) {
    case 'cdw':
      return <Car className={className} style={style} />;
    case 'rcli':
      return <Shield className={className} style={style} />;
    case 'sli':
      return <ShieldCheck className={className} style={style} />;
    case 'pai':
      return <Users className={className} style={style} />;
  }
};

// Coverage colors
const coverageColors: Record<keyof CoverageOptions, string> = {
  cdw: '#3B82F6',  // Blue
  rcli: '#10B981', // Green
  sli: '#8B5CF6',  // Purple
  pai: '#F59E0B',  // Amber
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
  const currencyCode = tenant?.currency_code || 'GBP';
  const [coverage, setCoverage] = useState<CoverageOptions>(initialCoverage);
  const [showInsurance, setShowInsurance] = useState(true);
  const [expandedCoverage, setExpandedCoverage] = useState<string | null>(null);

  // Use the premium calculation hook
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

  // Update parent when coverage or premium changes
  useEffect(() => {
    if (showInsurance) {
      onCoverageChange(coverage, totalPremium);
    }
  }, [coverage, totalPremium, showInsurance]);

  // Handle coverage toggle
  const handleCoverageToggle = (type: keyof CoverageOptions) => {
    setCoverage(prev => {
      const newCoverage = { ...prev };

      // Toggle the coverage
      newCoverage[type] = !newCoverage[type];

      // If disabling RCLI, also disable SLI (SLI requires RCLI)
      if (type === 'rcli' && !newCoverage.rcli) {
        newCoverage.sli = false;
      }

      return newCoverage;
    });
  };

  // Handle skip insurance
  const handleSkipInsurance = () => {
    setShowInsurance(false);
    setCoverage(DEFAULT_COVERAGE);
    onSkipInsurance();
  };

  // Handle add insurance after skipping
  const handleAddInsurance = () => {
    setShowInsurance(true);
  };

  // Check if no coverage selected
  const hasCoverage = coverage.cdw || coverage.rcli || coverage.sli || coverage.pai;

  // If skipped, show minimal UI to re-enable
  if (!showInsurance) {
    return (
      <Card className="p-6 border-2 border-dashed border-muted-foreground/30">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
              <Shield className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <h4 className="font-semibold">Insurance Declined</h4>
              <p className="text-sm text-muted-foreground">You've chosen to proceed without Bonzah insurance</p>
            </div>
          </div>
          <Button variant="outline" onClick={handleAddInsurance}>
            Add Insurance
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto">
        <h3 className="text-2xl md:text-3xl font-display font-semibold mb-2">
          Protect Your Trip with Bonzah
        </h3>
        <p className="text-muted-foreground">
          Add comprehensive insurance coverage powered by Bonzah. Select the coverages that fit your needs.
        </p>
      </div>

      {/* Error State */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">Failed to calculate premium. Please try again.</p>
        </div>
      )}

      {/* Coverage Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(Object.keys(COVERAGE_INFO) as Array<keyof CoverageOptions>).map((type) => {
          const info = COVERAGE_INFO[type];
          const isSelected = coverage[type];
          const isDisabled = type === 'sli' && !coverage.rcli;
          const color = coverageColors[type];
          const price = breakdown[type];
          const isExpanded = expandedCoverage === type;
          const keyFeatures = info.features.slice(0, 4);

          return (
            <Card
              key={type}
              className={cn(
                'relative transition-all duration-300 border-2 overflow-hidden',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : isDisabled
                    ? 'border-muted bg-muted/30 opacity-60'
                    : 'border-border hover:border-primary/40'
              )}
            >
              {/* Left accent bar */}
              {isSelected && (
                <div
                  className="absolute top-0 left-0 w-1 h-full"
                  style={{ backgroundColor: color }}
                />
              )}

              <div className="p-4 sm:p-5">
                {/* Header row: Icon + Name + Badge + Price + Switch */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: isSelected ? `${color}20` : 'var(--muted)' }}
                    >
                      <CoverageIcon
                        type={type}
                        className={cn(
                          'w-5 h-5 sm:w-6 sm:h-6',
                          isSelected ? '' : 'text-muted-foreground'
                        )}
                        style={isSelected ? { color } : undefined}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold text-sm sm:text-base">{info.name}</h4>
                        <Badge variant="secondary" className="text-xs">
                          {info.shortName}
                        </Badge>
                      </div>
                      {/* Price under name */}
                      {isSelected && price > 0 ? (
                        <p className="text-sm font-semibold mt-0.5" style={{ color }}>
                          {formatCurrency(price, currencyCode)}
                          <span className="text-xs font-normal text-muted-foreground ml-1">total</span>
                        </p>
                      ) : !isSelected && !isDisabled ? (
                        <p className="text-xs text-muted-foreground mt-0.5">Click to add coverage</p>
                      ) : null}
                    </div>
                  </div>

                  {/* Switch */}
                  <div className="flex-shrink-0 pt-1">
                    <Switch
                      checked={isSelected}
                      disabled={isDisabled}
                      onCheckedChange={() => handleCoverageToggle(type)}
                    />
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                  {info.description}
                </p>

                {/* Deductible badge */}
                <div className="mt-2">
                  {info.deductible === 'None' ? (
                    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-0 text-xs">
                      No Deductible
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      {info.deductible} Deductible
                    </Badge>
                  )}
                  <Badge variant="outline" className="ml-1.5 text-xs">
                    {info.maxCoverage.startsWith('$') ? `Up to ${info.maxCoverage}` : info.maxCoverage}
                  </Badge>
                </div>

                {/* SLI requires RCLI warning */}
                {type === 'sli' && !coverage.rcli && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Requires RCLI to be active
                  </p>
                )}

                {/* Key features - always visible */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                  {keyFeatures.map((feature, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-muted-foreground">{feature}</span>
                    </div>
                  ))}
                </div>

                {/* Collapsible full coverage details */}
                <Collapsible
                  open={isExpanded}
                  onOpenChange={(open) => setExpandedCoverage(open ? type : null)}
                >
                  <CollapsibleContent className="mt-3 space-y-3">
                    {/* Exclusions */}
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Not Covered:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                        {info.exclusions.map((exclusion, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                            <span className="text-xs text-muted-foreground">{exclusion}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Max coverage row */}
                    <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Maximum Coverage</span>
                      <span className="text-xs font-semibold">{info.maxCoverage}</span>
                    </div>
                  </CollapsibleContent>

                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground h-7"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isExpanded ? (
                        <>Show Less <ChevronUp className="w-3 h-3 ml-1" /></>
                      ) : (
                        <>View Full Coverage Details <ChevronDown className="w-3 h-3 ml-1" /></>
                      )}
                    </Button>
                  </CollapsibleTrigger>
                </Collapsible>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Premium Summary */}
      <Card className="p-4 sm:p-6 bg-gradient-to-r from-primary/5 to-transparent border-primary/20">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h4 className="font-semibold">Total Insurance Premium</h4>
              <p className="text-sm text-muted-foreground">
                {hasCoverage
                  ? `${Object.entries(coverage).filter(([_, v]) => v).length} coverage${Object.entries(coverage).filter(([_, v]) => v).length > 1 ? 's' : ''} selected`
                  : 'No coverage selected'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 w-full sm:w-auto">
            <div className="text-right flex-1 sm:flex-initial">
              {isLoading || isFetching ? (
                <div className="flex items-center gap-2 justify-end">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-muted-foreground">Calculating...</span>
                </div>
              ) : (
                <>
                  <div className="text-2xl sm:text-3xl font-bold text-primary">
                    {formatCurrency(totalPremium, currencyCode)}
                  </div>
                  {hasCoverage && (
                    <div className="text-xs text-muted-foreground">
                      One-time payment
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Coverage breakdown */}
        {hasCoverage && totalPremium > 0 && !isLoading && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              {coverage.cdw && breakdown.cdw > 0 && (
                <div className="flex justify-between sm:block">
                  <span className="text-muted-foreground">CDW:</span>
                  <span className="font-medium sm:ml-1">{formatCurrency(breakdown.cdw, currencyCode)}</span>
                </div>
              )}
              {coverage.rcli && breakdown.rcli > 0 && (
                <div className="flex justify-between sm:block">
                  <span className="text-muted-foreground">RCLI:</span>
                  <span className="font-medium sm:ml-1">{formatCurrency(breakdown.rcli, currencyCode)}</span>
                </div>
              )}
              {coverage.sli && breakdown.sli > 0 && (
                <div className="flex justify-between sm:block">
                  <span className="text-muted-foreground">SLI:</span>
                  <span className="font-medium sm:ml-1">{formatCurrency(breakdown.sli, currencyCode)}</span>
                </div>
              )}
              {coverage.pai && breakdown.pai > 0 && (
                <div className="flex justify-between sm:block">
                  <span className="text-muted-foreground">PAI:</span>
                  <span className="font-medium sm:ml-1">{formatCurrency(breakdown.pai, currencyCode)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Skip Insurance Option */}
      <div className="flex justify-center">
        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={handleSkipInsurance}
        >
          <X className="w-4 h-4 mr-2" />
          Skip Insurance
        </Button>
      </div>

      {/* Bonzah Disclaimer & Links */}
      <div className="text-center space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          By selecting any of these insurances, the renter agrees to the{' '}
          <a href="https://bonzah.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Terms &amp; Conditions
          </a>
          ,{' '}
          <a href="https://bonzah.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Privacy Policy
          </a>
          , and{' '}
          <a href="https://bonzah.com/included-and-restricted-vehicle-types" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Covered Vehicles
          </a>
          . Insurance is only for drivers 21 years and older with a valid driver&apos;s license.
        </p>
        <p className="text-xs text-muted-foreground">
          Insurance provided by{' '}
          <a
            href="https://www.bonzah.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Bonzah
          </a>
        </p>
      </div>
    </div>
  );
}
