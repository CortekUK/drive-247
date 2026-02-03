'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Check, Shield, ShieldCheck, Car, Users, AlertCircle, Loader2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useBonzahPremium,
  COVERAGE_INFO,
  type CoverageOptions,
} from '@/hooks/useBonzahPremium';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
const CoverageIcon = ({ type, className }: { type: keyof CoverageOptions; className?: string }) => {
  switch (type) {
    case 'cdw':
      return <Car className={className} />;
    case 'rcli':
      return <Shield className={className} />;
    case 'sli':
      return <ShieldCheck className={className} />;
    case 'pai':
      return <Users className={className} />;
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
  const [coverage, setCoverage] = useState<CoverageOptions>(initialCoverage);
  const [showInsurance, setShowInsurance] = useState(true);

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

          return (
            <Card
              key={type}
              className={cn(
                'relative transition-all duration-300 border-2 overflow-hidden',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : isDisabled
                    ? 'border-muted bg-muted/30 opacity-60'
                    : 'border-border hover:border-primary/40 cursor-pointer'
              )}
              onClick={() => !isDisabled && handleCoverageToggle(type)}
            >
              <div className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  {/* Left: Icon and Info */}
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
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-sm sm:text-base">{info.name}</h4>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-sm">{info.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {info.shortName}
                      </Badge>
                      {type === 'sli' && !coverage.rcli && (
                        <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Requires RCLI
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Switch and Price */}
                  <div className="flex flex-col items-end gap-2">
                    <Switch
                      checked={isSelected}
                      disabled={isDisabled}
                      onCheckedChange={() => handleCoverageToggle(type)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {isSelected && price > 0 && (
                      <span className="text-sm font-semibold" style={{ color }}>
                        ${price.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Description on larger screens */}
                <p className="hidden sm:block text-xs text-muted-foreground mt-3 leading-relaxed">
                  {info.description}
                </p>
              </div>

              {/* Selected indicator */}
              {isSelected && (
                <div
                  className="absolute top-0 left-0 w-1 h-full"
                  style={{ backgroundColor: color }}
                />
              )}
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
                    ${totalPremium.toFixed(2)}
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
                  <span className="font-medium sm:ml-1">${breakdown.cdw.toFixed(2)}</span>
                </div>
              )}
              {coverage.rcli && breakdown.rcli > 0 && (
                <div className="flex justify-between sm:block">
                  <span className="text-muted-foreground">RCLI:</span>
                  <span className="font-medium sm:ml-1">${breakdown.rcli.toFixed(2)}</span>
                </div>
              )}
              {coverage.sli && breakdown.sli > 0 && (
                <div className="flex justify-between sm:block">
                  <span className="text-muted-foreground">SLI:</span>
                  <span className="font-medium sm:ml-1">${breakdown.sli.toFixed(2)}</span>
                </div>
              )}
              {coverage.pai && breakdown.pai > 0 && (
                <div className="flex justify-between sm:block">
                  <span className="text-muted-foreground">PAI:</span>
                  <span className="font-medium sm:ml-1">${breakdown.pai.toFixed(2)}</span>
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

      {/* Powered by Bonzah */}
      <div className="text-center">
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
