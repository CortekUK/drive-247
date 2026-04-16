'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, Shield, ShieldCheck, Car, Users, AlertCircle, Loader2, X, ChevronDown, ChevronUp, XCircle, UserCheck, MapPin, Save, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useBonzahPremium,
  COVERAGE_INFO,
  type CoverageOptions,
} from '@/hooks/use-bonzah-premium';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import { supabase } from '@/integrations/supabase/client';
import { US_STATES } from '@/lib/us-states';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export interface BonzahCustomerDetails {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  date_of_birth?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  license_number?: string | null;
  license_state?: string | null;
}

interface BonzahInsuranceSelectorProps {
  tripStartDate: string | null;
  tripEndDate: string | null;
  pickupState: string;
  onCoverageChange: (coverage: CoverageOptions, premium: number) => void;
  onSkipInsurance: () => void;
  initialCoverage?: CoverageOptions;
  hidePremiumSummary?: boolean;
  customerDetails?: BonzahCustomerDetails | null;
  onCustomerDetailsUpdated?: () => void;
}

const DEFAULT_COVERAGE: CoverageOptions = {
  cdw: false,
  rcli: false,
  sli: false,
  pai: false,
};

// Brochure PDFs (stored in Supabase storage, same for all tenants)
const BROCHURE_URLS: Record<keyof CoverageOptions, string> = {
  cdw: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bonzah-brochures/cdw-brochure.pdf`,
  rcli: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bonzah-brochures/rcli-brochure.pdf`,
  sli: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bonzah-brochures/sli-brochure.pdf`,
  pai: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bonzah-brochures/pai-brochure.pdf`,
};

const CoverageIcon = ({ type, className }: { type: keyof CoverageOptions; className?: string }) => {
  switch (type) {
    case 'cdw': return <Car className={className} />;
    case 'rcli': return <Shield className={className} />;
    case 'sli': return <ShieldCheck className={className} />;
    case 'pai': return <Users className={className} />;
  }
};

export default function BonzahInsuranceSelector({
  tripStartDate,
  tripEndDate,
  pickupState,
  onCoverageChange,
  onSkipInsurance,
  initialCoverage = DEFAULT_COVERAGE,
  hidePremiumSummary = false,
  customerDetails,
  onCustomerDetailsUpdated,
}: BonzahInsuranceSelectorProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [coverage, setCoverage] = useState<CoverageOptions>(initialCoverage);
  const hasInitialCoverage = initialCoverage.cdw || initialCoverage.rcli || initialCoverage.sli || initialCoverage.pai;
  const [showInsurance, setShowInsurance] = useState(hasInitialCoverage);
  const [expandedCoverage, setExpandedCoverage] = useState<string | null>(null);

  // Renter details form state
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [detailsForm, setDetailsForm] = useState({
    address_street: '',
    address_city: '',
    address_state: '',
    address_zip: '',
    license_number: '',
    license_state: '',
    date_of_birth: '',
  });

  // Check which fields are missing
  const missingFields = useMemo(() => {
    if (!customerDetails) return [];
    const missing: string[] = [];
    if (!customerDetails.address_street) missing.push('address_street');
    if (!customerDetails.address_city) missing.push('address_city');
    if (!customerDetails.address_state) missing.push('address_state');
    if (!customerDetails.address_zip) missing.push('address_zip');
    if (!customerDetails.license_number) missing.push('license_number');
    if (!customerDetails.license_state) missing.push('license_state');
    if (!customerDetails.date_of_birth) missing.push('date_of_birth');
    return missing;
  }, [customerDetails]);

  const hasMissingFields = missingFields.length > 0;

  // Init form when editing or when missing fields detected
  useEffect(() => {
    if (customerDetails) {
      setDetailsForm({
        address_street: customerDetails.address_street || '',
        address_city: customerDetails.address_city || '',
        address_state: customerDetails.address_state || '',
        address_zip: customerDetails.address_zip || '',
        license_number: customerDetails.license_number || '',
        license_state: customerDetails.license_state || '',
        date_of_birth: customerDetails.date_of_birth || '',
      });
    }
  }, [customerDetails]);

  // Auto-show form when there are missing fields and insurance is shown
  useEffect(() => {
    if (showInsurance && hasMissingFields) {
      setIsEditingDetails(true);
    }
  }, [showInsurance, hasMissingFields]);

  const handleSaveDetails = async () => {
    if (!customerDetails?.id || !tenant?.id) return;

    // Validate required fields
    const requiredFields = ['address_street', 'address_city', 'address_state', 'address_zip', 'license_number', 'license_state', 'date_of_birth'] as const;
    const stillMissing = requiredFields.filter(f => !detailsForm[f]?.trim());
    if (stillMissing.length > 0) {
      toast({ title: 'Missing fields', description: 'Please fill in all required fields.', variant: 'destructive' });
      return;
    }

    // Validate ZIP
    if (!/^\d{5}(-\d{4})?$/.test(detailsForm.address_zip.trim())) {
      toast({ title: 'Invalid ZIP', description: 'Enter a valid ZIP code (e.g. 33101).', variant: 'destructive' });
      return;
    }

    // Validate age 21+
    const dob = new Date(detailsForm.date_of_birth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
    if (age < 21) {
      toast({ title: 'Age requirement', description: 'Customer must be at least 21 years old for Bonzah insurance.', variant: 'destructive' });
      return;
    }

    setIsSavingDetails(true);
    try {
      const { error } = await (supabase as any)
        .from('customers')
        .update({
          address_street: detailsForm.address_street.trim(),
          address_city: detailsForm.address_city.trim(),
          address_state: detailsForm.address_state,
          address_zip: detailsForm.address_zip.trim(),
          license_number: detailsForm.license_number.trim(),
          license_state: detailsForm.license_state,
          date_of_birth: detailsForm.date_of_birth,
        })
        .eq('id', customerDetails.id)
        .eq('tenant_id', tenant.id);

      if (error) throw error;

      toast({ title: 'Details saved', description: 'Customer details updated for Bonzah insurance.' });
      setIsEditingDetails(false);

      // Refresh customer details
      queryClient.invalidateQueries({ queryKey: ['customer-details-for-rental'] });
      onCustomerDetailsUpdated?.();
    } catch (err) {
      console.error('Error saving customer details:', err);
      toast({ title: 'Error', description: 'Failed to save customer details.', variant: 'destructive' });
    } finally {
      setIsSavingDetails(false);
    }
  };

  const {
    totalPremium,
    breakdown,
    isLoading,
    isFetching,
    error,
  } = useBonzahPremium({
    tripStartDate,
    tripEndDate,
    pickupState,
    coverage,
    enabled: showInsurance && !hasMissingFields,
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
  const cur = tenant?.currency_code || 'USD';

  if (!showInsurance) {
    return (
      <div className="p-4 rounded-lg border border-dashed border-[#CC004A]/25 hover:border-[#CC004A]/40 transition-colors">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/bonzah-logo.svg" alt="Bonzah" className="h-6 w-auto flex-shrink-0 dark:hidden" />
            <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="h-6 w-auto flex-shrink-0 hidden dark:block" />
            <div>
              <p className="font-medium text-sm">Bonzah Insurance</p>
              <p className="text-xs text-muted-foreground">No coverage selected (optional)</p>
            </div>
          </div>
          <Button type="button" size="sm" className="bg-[#CC004A] hover:bg-[#CC004A]/90 text-white" onClick={handleAddInsurance}>
            Add Insurance
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/bonzah-logo.svg" alt="Bonzah" className="h-4 w-auto flex-shrink-0 dark:hidden" />
          <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="h-4 w-auto flex-shrink-0 hidden dark:block" />
          <span className="text-sm text-muted-foreground">Select coverage for this rental</span>
          <Badge variant="outline" className={cn(
            "text-[10px] px-1.5 py-0 uppercase font-medium",
            (tenant as any)?.bonzah_mode === 'live'
              ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
              : "border-amber-500/30 text-amber-600 dark:text-amber-400"
          )}>
            {(tenant as any)?.bonzah_mode === 'live' ? 'Live' : 'Test'}
          </Badge>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground text-xs h-7 px-2"
          onClick={handleSkipInsurance}
        >
          <X className="w-3 h-3 mr-1" />
          Skip
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <p>Failed to calculate premium. Please try again.</p>
        </div>
      )}

      {/* Renter Details — show when missing or editing */}
      {customerDetails && (isEditingDetails || hasMissingFields) && (
        <div className="rounded-lg border border-[#CC004A]/20 bg-[#CC004A]/5 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-[#CC004A]" />
              <p className="text-sm font-medium">
                {hasMissingFields ? 'Complete renter details for Bonzah' : 'Edit renter details'}
              </p>
            </div>
            {!hasMissingFields && (
              <Button type="button" variant="ghost" size="sm" className="text-xs h-7" onClick={() => setIsEditingDetails(false)}>
                Cancel
              </Button>
            )}
          </div>

          {hasMissingFields && (
            <p className="text-xs text-muted-foreground -mt-2">
              Bonzah requires address, license, and date of birth. These will be saved to the customer's profile.
            </p>
          )}

          {/* Address */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs font-medium">Address</Label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                placeholder="Street address"
                value={detailsForm.address_street}
                onChange={(e) => setDetailsForm(prev => ({ ...prev, address_street: e.target.value }))}
                className="text-sm h-9"
              />
              <Input
                placeholder="City"
                value={detailsForm.address_city}
                onChange={(e) => setDetailsForm(prev => ({ ...prev, address_city: e.target.value }))}
                className="text-sm h-9"
              />
              <Select value={detailsForm.address_state} onValueChange={(val) => setDetailsForm(prev => ({ ...prev, address_state: val }))}>
                <SelectTrigger className="text-sm h-9">
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="ZIP code"
                value={detailsForm.address_zip}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^[\d-]*$/.test(val)) {
                    setDetailsForm(prev => ({ ...prev, address_zip: val }));
                  }
                }}
                className="text-sm h-9"
              />
            </div>
          </div>

          {/* License + DOB */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">License Number</Label>
              <Input
                placeholder="DL number"
                value={detailsForm.license_number}
                onChange={(e) => setDetailsForm(prev => ({ ...prev, license_number: e.target.value }))}
                className="text-sm h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">License State</Label>
              <Select value={detailsForm.license_state} onValueChange={(val) => setDetailsForm(prev => ({ ...prev, license_state: val }))}>
                <SelectTrigger className="text-sm h-9">
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Date of Birth</Label>
              <Input
                type="date"
                value={detailsForm.date_of_birth}
                onChange={(e) => setDetailsForm(prev => ({ ...prev, date_of_birth: e.target.value }))}
                className="text-sm h-9"
                max={new Date(new Date().setFullYear(new Date().getFullYear() - 21)).toISOString().split('T')[0]}
              />
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            className="bg-[#CC004A] hover:bg-[#CC004A]/90 text-white"
            onClick={handleSaveDetails}
            disabled={isSavingDetails}
          >
            {isSavingDetails ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving...</>
            ) : (
              <><Save className="h-3.5 w-3.5 mr-1.5" /> Save & Continue</>
            )}
          </Button>
        </div>
      )}

      {/* Renter summary — show when details are complete and not editing */}
      {customerDetails && !hasMissingFields && !isEditingDetails && (
        <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          <span>
            <span className="font-medium text-foreground">{customerDetails.name}</span>
            {customerDetails.address_city && ` · ${customerDetails.address_city}, ${customerDetails.address_state}`}
            {customerDetails.license_number && ` · DL: ${customerDetails.license_state}-${customerDetails.license_number}`}
          </span>
          <button
            type="button"
            className="text-[11px] text-[#CC004A] hover:underline"
            onClick={() => setIsEditingDetails(true)}
          >
            Edit
          </button>
        </div>
      )}

      {/* Coverage Cards — only show when details are complete */}
      {(!hasMissingFields || !customerDetails) && (
        <div className="space-y-2">
          {(Object.keys(COVERAGE_INFO) as Array<keyof CoverageOptions>).map((type) => {
            const info = COVERAGE_INFO[type];
            const isSelected = coverage[type];
            const isDisabled = type === 'sli' && !coverage.rcli;
            const price = breakdown[type];
            const isExpanded = expandedCoverage === type;

            return (
              <Collapsible
                key={type}
                open={isExpanded}
                onOpenChange={(open) => setExpandedCoverage(open ? type : null)}
              >
                <div
                  className={cn(
                    'rounded-lg border transition-all',
                    isSelected
                      ? 'border-[#CC004A]/40 bg-[#CC004A]/5'
                      : isDisabled
                        ? 'border-muted bg-muted/20 opacity-50 cursor-not-allowed'
                        : 'border-border hover:border-muted-foreground/30'
                  )}
                >
                  {/* Main row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Checkbox */}
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => handleCoverageToggle(type)}
                      className={cn(
                        "h-5 w-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all",
                        isSelected
                          ? "bg-[#CC004A] border-[#CC004A]"
                          : "border-muted-foreground/30 hover:border-[#CC004A]/50"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3 text-white" />}
                    </button>

                    {/* Icon */}
                    <div className={cn(
                      "h-8 w-8 rounded-md flex items-center justify-center flex-shrink-0",
                      isSelected ? "bg-[#CC004A]/10" : "bg-muted"
                    )}>
                      <CoverageIcon
                        type={type}
                        className={cn('w-4 h-4', isSelected ? 'text-[#CC004A]' : 'text-muted-foreground')}
                      />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{info.shortName}</span>
                        <span className="text-xs text-muted-foreground hidden sm:inline">{info.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
                        <span>{info.deductible === 'None' ? 'No deductible' : `${info.deductible} deductible`}</span>
                        <span>·</span>
                        <span>{info.maxCoverage.startsWith('$') ? `Up to ${info.maxCoverage}` : info.maxCoverage}</span>
                      </div>
                    </div>

                    {/* Price + details link */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {isSelected && price > 0 && (
                        <span className="text-sm font-semibold text-[#CC004A]">
                          {formatCurrency(price, cur)}
                        </span>
                      )}
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="text-[11px] text-[#CC004A] hover:underline flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </button>
                      </CollapsibleTrigger>
                    </div>
                  </div>

                  {/* SLI requires RCLI */}
                  {type === 'sli' && !coverage.rcli && (
                    <div className="px-4 pb-2.5 -mt-1">
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Enable RCLI first to add SLI
                      </p>
                    </div>
                  )}

                  {/* Expanded details */}
                  <CollapsibleContent>
                    <div className="px-4 pb-3 border-t border-border/50 pt-3 mx-4 mb-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
                        <div>
                          <p className="text-[11px] font-medium mb-1.5">Covered</p>
                          {info.features.map((feature, i) => (
                            <div key={i} className="flex items-start gap-1.5 py-0.5">
                              <Check className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                              <span className="text-[11px] text-muted-foreground leading-tight">{feature}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="text-[11px] font-medium mb-1.5">Not Covered</p>
                          {info.exclusions.map((exclusion, i) => (
                            <div key={i} className="flex items-start gap-1.5 py-0.5">
                              <X className="w-3 h-3 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
                              <span className="text-[11px] text-muted-foreground leading-tight">{exclusion}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Brochure link */}
                      <a
                        href={BROCHURE_URLS[type]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 flex items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground hover:border-[#CC004A]/40 transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5 flex-shrink-0 text-[#CC004A]" />
                        <span>View {info.shortName} Coverage Brochure</span>
                      </a>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      )}

      {/* Premium Summary */}
      {!hidePremiumSummary && hasCoverage && !hasMissingFields && (
        <div className="rounded-lg bg-[#CC004A]/5 border border-[#CC004A]/20 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Total Premium</span>
            {isLoading || isFetching ? (
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Calculating...</span>
              </div>
            ) : (
              <span className="text-lg font-bold text-[#CC004A]">{formatCurrency(totalPremium, cur)}</span>
            )}
          </div>

          {totalPremium > 0 && !isLoading && !isFetching && (
            <div className="mt-2 pt-2 border-t border-[#CC004A]/10 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              {coverage.cdw && breakdown.cdw > 0 && (
                <span>CDW <span className="font-medium text-foreground">{formatCurrency(breakdown.cdw, cur)}</span></span>
              )}
              {coverage.rcli && breakdown.rcli > 0 && (
                <span>RCLI <span className="font-medium text-foreground">{formatCurrency(breakdown.rcli, cur)}</span></span>
              )}
              {coverage.sli && breakdown.sli > 0 && (
                <span>SLI <span className="font-medium text-foreground">{formatCurrency(breakdown.sli, cur)}</span></span>
              )}
              {coverage.pai && breakdown.pai > 0 && (
                <span>PAI <span className="font-medium text-foreground">{formatCurrency(breakdown.pai, cur)}</span></span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        By selecting coverage, the renter agrees to Bonzah&apos;s{' '}
        <a href="https://bonzah.com/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Terms</a>,{' '}
        <a href="https://bonzah.com/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Privacy</a>, and{' '}
        <a href="https://bonzah.com/included-and-restricted-vehicle-types" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">Covered Vehicles</a>.
        {tenant?.bonzah_brochure_url && (
          <>
            {' '}<a href={tenant.bonzah_brochure_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground font-medium">View full coverage details</a>.
          </>
        )}
        {' '}Insurance is only for drivers 21+ with a valid license.
      </p>
    </div>
  );
}
