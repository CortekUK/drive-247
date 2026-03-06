'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ShieldCheck,
  Shield,
  ShieldPlus,
  CheckCircle,
  Clock,
  AlertTriangle,
  XCircle,
  Loader2,
  Download,
  RefreshCw,
  ExternalLink,
  Link2,
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/formatters';
import type { InsurancePolicy } from '@/hooks/use-rental-insurance-policies';

interface InsuranceTimelineProps {
  rentalId: string;
  rental: any;
  policies: InsurancePolicy[];
  isLoading: boolean;
  canEdit: boolean;
  tenantId: string | undefined;
  isBonzahConnected: boolean;
  bonzahCdBalance: number | null;
  onBuyInsurance: () => void;
}

const COVERAGE_SHORT_LABELS: Record<string, string> = {
  cdw: 'CDW',
  rcli: 'RCLI',
  sli: 'SLI',
  pai: 'PAI',
};

const COVERAGE_FULL_LABELS: Record<string, string> = {
  cdw: 'Collision Damage Waiver (CDW)',
  rcli: "Renter's Contingent Liability Insurance (RCLI)",
  sli: 'Supplemental Liability Insurance (SLI)',
  pai: 'Personal Accident Insurance (PAI)',
};

function getStatusInfo(status: string) {
  switch (status) {
    case 'active':
      return { label: 'Active', dotClass: 'bg-green-500', icon: CheckCircle, badgeClass: 'bg-emerald-400 text-black font-semibold hover:bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]' };
    case 'quoted':
      return { label: 'Quoted', dotClass: 'bg-yellow-500', icon: Clock, badgeClass: 'bg-amber-400 text-black font-semibold hover:bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' };
    case 'payment_pending':
      return { label: 'Payment Pending', dotClass: 'bg-yellow-500', icon: Clock, badgeClass: 'bg-amber-400 text-black font-semibold hover:bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' };
    case 'payment_confirmed':
      return { label: 'Payment Confirmed', dotClass: 'bg-blue-500', icon: CheckCircle, badgeClass: 'bg-sky-400 text-black font-semibold hover:bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.6)]' };
    case 'failed':
      return { label: 'Failed', dotClass: 'bg-red-500', icon: XCircle, badgeClass: 'bg-red-400 text-black font-semibold hover:bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.6)]' };
    case 'insufficient_balance':
      return { label: 'Pending Allocation', dotClass: 'bg-red-500', icon: AlertTriangle, badgeClass: 'bg-[#CC004A] text-white font-semibold hover:bg-[#CC004A] shadow-[0_0_12px_rgba(204,0,74,0.6)]' };
    case 'cancelled':
      return { label: 'Cancelled', dotClass: 'bg-gray-400', icon: XCircle, badgeClass: '' };
    default:
      return { label: status, dotClass: 'bg-gray-400', icon: Clock, badgeClass: '' };
  }
}

function getCoverageBadges(coverageTypes: any) {
  if (!coverageTypes) return [];
  return ['cdw', 'rcli', 'sli', 'pai'].filter((key) => coverageTypes[key]);
}

function InsuranceTimelineItem({
  policy,
  isLast,
  canEdit,
  tenantId,
  rentalId,
  bonzahMode,
  extensionIndex,
}: {
  policy: InsurancePolicy;
  isLast: boolean;
  canEdit: boolean;
  tenantId: string | undefined;
  rentalId: string;
  bonzahMode: string;
  extensionIndex?: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [issuingPolicy, setIssuingPolicy] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);
  const [refreshingPolicy, setRefreshingPolicy] = useState(false);

  const statusInfo = getStatusInfo(policy.status);
  const coverageKeys = getCoverageBadges(policy.coverage_types);
  const pdfIds = (policy.coverage_types as any)?.pdf_ids as Record<string, string> | undefined;
  const isRetryable = policy.status === 'quoted' || policy.status === 'failed' || policy.status === 'insufficient_balance';

  const handleRetryPurchase = async () => {
    setIssuingPolicy(true);
    try {
      const { data, error } = await supabase.functions.invoke('bonzah-confirm-payment', {
        body: {
          policy_record_id: policy.id,
          stripe_payment_intent_id: `portal-${policy.policy_type === 'extension' ? 'extension' : 'manual'}-${rentalId}`,
        },
      });
      if (error) throw error;
      if (data?.error === 'insufficient_balance') {
        const mode = data?.bonzah_mode || bonzahMode;
        const title = mode === 'live' ? 'Available balance still insufficient' : 'Allocated balance still insufficient';
        const desc = mode === 'live'
          ? `Your Bonzah available balance is still too low (premium: $${data.premium}). Top up your Bonzah account and retry.`
          : `Your Bonzah allocated balance is still too low (premium: $${data.premium}). Allocate more funds in the Bonzah portal and retry.`;
        toast({ title, description: desc, variant: 'destructive' });
      } else {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['rental-insurance-policies', rentalId] }),
          queryClient.invalidateQueries({ queryKey: ['rental-bonzah-policy', rentalId] }),
          queryClient.invalidateQueries({ queryKey: ['bonzah-balance'] }),
          queryClient.invalidateQueries({ queryKey: ['bonzah-insufficient-balance-count'] }),
          queryClient.invalidateQueries({ queryKey: ['bonzah-pending-policies'] }),
        ]);
        toast({ title: 'Policy Issued', description: `Bonzah policy ${data?.policy_no || ''} has been issued successfully.` });
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to issue policy', variant: 'destructive' });
    } finally {
      setIssuingPolicy(false);
    }
  };

  const handleRefreshPolicy = async () => {
    if (!policy.policy_id) return;
    setRefreshingPolicy(true);
    try {
      const { error } = await supabase.functions.invoke('bonzah-view-policy', {
        body: { tenant_id: tenantId, policy_id: policy.policy_id },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['rental-insurance-policies', rentalId] });
      queryClient.invalidateQueries({ queryKey: ['rental-bonzah-policy', rentalId] });
      toast({ title: 'Policy Refreshed', description: 'Latest policy data has been fetched from Bonzah.' });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to refresh policy data', variant: 'destructive' });
    } finally {
      setRefreshingPolicy(false);
    }
  };

  const handleDownloadPdf = async (type: string, pdfId: string) => {
    setDownloadingPdf(type);
    try {
      const { data, error } = await supabase.functions.invoke('bonzah-download-pdf', {
        body: { tenant_id: tenantId, pdf_id: String(pdfId), policy_id: policy.policy_id },
      });
      if (error || !data?.documentBase64) {
        toast({ title: 'Error', description: 'Failed to download PDF', variant: 'destructive' });
        return;
      }
      const byteCharacters = atob(data.documentBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bonzah-${type}-${policy.policy_no || policy.quote_id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Error', description: 'Failed to download PDF', variant: 'destructive' });
    } finally {
      setDownloadingPdf(null);
    }
  };

  const isExtension = policy.policy_type === 'extension';

  return (
    <div className={`rounded-sm border-l-4 border bg-card p-4 ${
      isExtension
        ? 'border-l-amber-500 dark:border-l-amber-400'
        : 'border-l-emerald-500 dark:border-l-emerald-400'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Extension number label */}
          {isExtension && extensionIndex != null && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1.5">
              Extension #{extensionIndex}
            </span>
          )}

          {/* Header row: dates + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">
              {format(new Date(policy.trip_start_date), 'MMM d, yyyy')} – {format(new Date(policy.trip_end_date), 'MMM d, yyyy')}
            </span>
            <Badge className={statusInfo.badgeClass} variant={statusInfo.badgeClass ? 'default' : 'outline'}>
              <statusInfo.icon className="h-3 w-3 mr-1" />
              {statusInfo.label}
            </Badge>
          </div>

          {/* Coverage badges + premium */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {coverageKeys.map((key) => (
              <span
                key={key}
                className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary ring-1 ring-inset ring-primary/20"
                title={COVERAGE_FULL_LABELS[key]}
              >
                {COVERAGE_SHORT_LABELS[key]}
              </span>
            ))}
            <span className="text-sm font-semibold text-green-600 dark:text-green-400 ml-1">
              {formatCurrency(policy.premium_amount, 'USD')}
            </span>
          </div>

          {/* Policy number */}
          {policy.policy_no && (
            <p className="text-xs text-muted-foreground mt-1.5">
              Policy #: <span className="font-mono">{policy.policy_no}</span>
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-1 flex-shrink-0">
          {policy.policy_id && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={refreshingPolicy}
              title="Refresh policy data"
              onClick={handleRefreshPolicy}
            >
              {refreshingPolicy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          )}

          {canEdit && isRetryable && (
            <Button
              size="sm"
              disabled={issuingPolicy}
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleRetryPurchase}
            >
              {issuingPolicy ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4 mr-1.5" />
              )}
              {policy.status === 'failed' || policy.status === 'insufficient_balance' ? 'Retry' : 'Complete'}
            </Button>
          )}

          {/* PDF downloads for active policies */}
          {policy.status === 'active' && pdfIds && Object.keys(pdfIds).length > 0 && (
            <div className="flex gap-1">
              {Object.entries(pdfIds).map(([type, pdfId]) => (
                <Button
                  key={type}
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={downloadingPdf === type}
                  onClick={() => handleDownloadPdf(type, pdfId)}
                  title={`Download ${COVERAGE_SHORT_LABELS[type] || type} PDF`}
                >
                  {downloadingPdf === type ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5 mr-1" />
                  )}
                  {COVERAGE_SHORT_LABELS[type] || type}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function InsuranceTimeline({
  rentalId,
  rental,
  policies,
  isLoading,
  canEdit,
  tenantId,
  isBonzahConnected,
  bonzahCdBalance,
  onBuyInsurance,
}: InsuranceTimelineProps) {
  const bonzahMode = (rental as any)?.tenants?.bonzah_mode || 'test';
  const portalUrl = bonzahMode === 'live' ? 'https://bonzah.insillion.com/bb1/' : 'https://bonzah.sb.insillion.com/bb1/';
  const hasOriginal = policies.some((p) => p.policy_type === 'original');
  const hasInsufficientBalance = policies.some((p) => p.status === 'insufficient_balance');

  // Split policies into original and extension groups
  const originalPolicies = policies.filter((p) => p.policy_type !== 'extension');
  const extensionPolicies = policies.filter((p) => p.policy_type === 'extension');

  const originalTotal = originalPolicies.reduce((sum, p) => sum + (p.premium_amount || 0), 0);
  const extensionTotal = extensionPolicies.reduce((sum, p) => sum + (p.premium_amount || 0), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <div className="flex items-center gap-3">
              <img src="/bonzah-logo.svg" alt="Bonzah" className="h-8 w-auto dark:hidden" />
              <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="h-8 w-auto hidden dark:block" />
              Insurance Policies
            </div>
          </CardTitle>
          {canEdit && !hasOriginal && isBonzahConnected && (
            <Button variant="outline" size="sm" onClick={onBuyInsurance}>
              <ShieldCheck className="h-4 w-4 mr-2" />
              Buy Insurance
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bonzah Balance */}
        {isBonzahConnected && bonzahCdBalance != null && (
          <div className="flex items-center justify-between rounded-md px-4 py-2.5 bg-muted/50 border border-border">
            <span className="text-sm font-medium text-muted-foreground">Bonzah Balance (Broker Total)</span>
            <span className="text-base font-bold tabular-nums text-foreground">
              ${bonzahCdBalance.toFixed(2)}
            </span>
          </div>
        )}

        {/* Insufficient balance warning */}
        {hasInsufficientBalance && (
          <div className="rounded-lg border border-[#CC004A]/30 bg-[#CC004A]/5 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-[#CC004A] mt-0.5 flex-shrink-0" />
              <div className="text-sm space-y-2">
                <p className="font-medium text-[#CC004A]">
                  {bonzahMode === 'live'
                    ? 'One or more policies have insufficient available balance'
                    : 'One or more policies have insufficient allocated balance'}
                </p>
                <p className="text-muted-foreground">
                  {bonzahMode === 'live'
                    ? 'Some insurance policies could not be activated because your Bonzah available balance is too low. Please top up your Bonzah account and retry.'
                    : 'Some insurance policies could not be activated because your Bonzah allocated balance is too low. Please allocate more funds in the Bonzah portal and retry.'}
                </p>
              </div>
            </div>
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#CC004A] hover:underline ml-6"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {bonzahMode === 'live' ? 'Top Up Balance on Bonzah Portal' : 'Allocate Funds on Bonzah Portal'}
            </a>
          </div>
        )}

        {/* Policies */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading insurance policies...
          </div>
        ) : policies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No insurance policies for this rental.
          </p>
        ) : (
          <div className="space-y-6">
            {/* Original Policies Section */}
            {originalPolicies.length > 0 && (
              <div className="border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/40 dark:bg-emerald-950/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
                      <Shield className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">Original Coverage</h4>
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">
                        {originalPolicies.length} {originalPolicies.length === 1 ? 'policy' : 'policies'}
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                    {formatCurrency(originalTotal, 'USD')}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {originalPolicies.map((policy) => (
                    <InsuranceTimelineItem
                      key={policy.id}
                      policy={policy}
                      isLast={false}
                      canEdit={canEdit}
                      tenantId={tenantId}
                      rentalId={rentalId}
                      bonzahMode={bonzahMode}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Connector between sections */}
            {originalPolicies.length > 0 && extensionPolicies.length > 0 && (
              <div className="flex items-center gap-2 -my-2">
                <div className="h-px flex-1 bg-border" />
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/80 border">
                  <Link2 className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Extended</span>
                </div>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}

            {/* Extension Policies Section */}
            {extensionPolicies.length > 0 && (
              <div className="border border-amber-200 dark:border-amber-800/50 bg-amber-50/40 dark:bg-amber-950/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/50">
                      <ShieldPlus className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Extension Coverage</h4>
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        {extensionPolicies.length === 1
                          ? 'Rental extended once'
                          : `Rental extended ${extensionPolicies.length} times`}
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-amber-700 dark:text-amber-300">
                    {formatCurrency(extensionTotal, 'USD')}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {extensionPolicies.map((policy, index) => (
                    <InsuranceTimelineItem
                      key={policy.id}
                      policy={policy}
                      isLast={false}
                      canEdit={canEdit}
                      tenantId={tenantId}
                      rentalId={rentalId}
                      bonzahMode={bonzahMode}
                      extensionIndex={index + 1}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bonzah Portal Link */}
        {policies.length > 0 && (
          <div className="flex items-center gap-3 pt-2 border-t">
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              View in Bonzah Portal
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
