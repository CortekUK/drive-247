'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  FileSignature,
  CheckCircle,
  Clock,
  Mail,
  Send,
  ExternalLink,
  RefreshCw,
  Loader2,
  Car,
  CalendarPlus,
  AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import type { RentalAgreement } from '@/hooks/use-rental-agreements';

export interface ExtensionGroupInfo {
  extensionNumber: number;
  entryDate: string;
  previousEndDate?: string;
  newEndDate?: string;
}

interface AgreementTimelineProps {
  rentalId: string;
  rental: {
    id: string;
    document_status?: string | null;
    docusign_envelope_id?: string | null;
    signed_document_id?: string | null;
    boldsign_mode?: string | null;
    status?: string;
    end_date?: string;
    customers?: { id: string; name: string; email?: string };
  };
  agreements: RentalAgreement[];
  isLoading: boolean;
  canEdit: boolean;
  tenantId: string | undefined;
  displayStatus: string;
  extensionGroups?: ExtensionGroupInfo[];
  onViewAgreement: (agreementId: string, signedDocFileUrl?: string | null) => void;
}

function getStatusInfo(agreement: RentalAgreement) {
  const status = agreement.document_status;
  const isSigned = status === 'signed' || status === 'completed' || !!agreement.signed_document_id;

  if (isSigned) {
    return { label: 'Signed', color: 'green' as const, icon: CheckCircle, dotClass: 'bg-green-500' };
  }
  if (status === 'credit_failed') {
    return {
      label: 'Failed - Low Credits',
      color: 'red' as const,
      icon: AlertCircle,
      dotClass: 'bg-red-500',
    };
  }
  if (status === 'sent' || status === 'delivered') {
    return { label: status === 'delivered' ? 'Viewed' : 'Awaiting Signature', color: 'yellow' as const, icon: Mail, dotClass: 'bg-yellow-500' };
  }
  return { label: 'Not Sent', color: 'gray' as const, icon: Clock, dotClass: 'bg-gray-400' };
}

function AgreementCard({
  agreement,
  canEdit,
  tenantId,
  rentalId,
  customerEmail,
  customerName,
  extensionNumber,
  hideStatusBadge,
  isSuperseded,
  onViewAgreement,
}: {
  agreement: RentalAgreement;
  canEdit: boolean;
  tenantId: string | undefined;
  rentalId: string;
  customerEmail?: string;
  customerName?: string;
  extensionNumber?: number;
  hideStatusBadge?: boolean;
  isSuperseded?: boolean;
  onViewAgreement: (agreementId: string, signedDocFileUrl?: string | null) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [resending, setResending] = useState(false);
  const [statusCooldown, setStatusCooldown] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Cooldown timers for rate-limit protection
  useEffect(() => {
    if (statusCooldown <= 0) return;
    const timer = setTimeout(() => setStatusCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [statusCooldown]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const statusInfo = getStatusInfo(agreement);
  const isSigned = statusInfo.label === 'Signed';
  const isCreditFailed = agreement.document_status === 'credit_failed';
  const isExtension = agreement.agreement_type === 'extension';
  const hasSentDoc = !!agreement.document_id;
  const isTestMode = agreement.boldsign_mode === 'test';

  const handleCheckStatus = async () => {
    setCheckingStatus(true);
    try {
      const response = await fetch('/api/esign/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalId, envelopeId: agreement.document_id, agreementId: agreement.id }),
      });
      const data = await response.json();
      if (data?.ok) {
        const friendlyStatus: Record<string, string> = { sent: 'Awaiting Signature', delivered: 'Viewed', signed: 'Signed', completed: 'Signed', declined: 'Declined', voided: 'Voided', expired: 'Expired', pending: 'Draft' };
        toast({ title: 'Status Updated', description: `Document status: ${friendlyStatus[data.status] || data.status}` });
        await queryClient.refetchQueries({ queryKey: ['rental-agreements'] });
        await queryClient.refetchQueries({ queryKey: ['rental'] });
      } else {
        toast({ title: 'Check Failed', description: data?.error || 'Could not check status', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error?.message || 'Failed to check status', variant: 'destructive' });
    } finally {
      setCheckingStatus(false);
      setStatusCooldown(30); // 30s cooldown to protect BoldSign rate limit
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      const response = await fetch('/api/esign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalId, customerEmail, customerName, tenantId,
          agreementType: agreement.agreement_type,
          ...(isExtension && {
            extensionPreviousEndDate: agreement.period_start_date,
            extensionNewEndDate: agreement.period_end_date,
            extensionNumber,
          }),
        }),
      });
      const data = await response.json();
      if (data?.ok) {
        toast({ title: 'Agreement Resent', description: 'A new agreement has been sent for signing' });
        await queryClient.refetchQueries({ queryKey: ['rental-agreements'] });
        await queryClient.refetchQueries({ queryKey: ['rental'] });
      } else if (data?.error === 'insufficient_credits') {
        toast({ title: 'Insufficient Credits', description: 'Top up your credits to send this agreement', variant: 'destructive' });
        await queryClient.refetchQueries({ queryKey: ['rental-agreements'] });
        await queryClient.refetchQueries({ queryKey: ['rental'] });
      } else {
        toast({ title: 'Resend Failed', description: data?.error || data?.detail || 'Failed to resend agreement', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error?.message || 'Failed to resend', variant: 'destructive' });
    } finally {
      setResending(false);
      setResendCooldown(60); // 60s cooldown to protect BoldSign rate limit
    }
  };

  return (
    <div className={`space-y-3 ${isSuperseded ? 'opacity-50' : ''}`}>
      {/* Superseded label */}
      {isSuperseded && (
        <p className="text-xs text-muted-foreground italic">Replaced by newer agreement below</p>
      )}
      {/* Status + badges row (hidden when parent accordion trigger already shows it) */}
      {!hideStatusBadge && (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            className={isSigned ? 'bg-green-600' : statusInfo.color === 'yellow' ? 'bg-yellow-600' : ''}
            variant={statusInfo.color === 'gray' ? 'outline' : 'default'}
          >
            <statusInfo.icon className="h-3 w-3 mr-1" />
            {statusInfo.label}
          </Badge>
          {isTestMode && (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 dark:bg-blue-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-500/20 dark:ring-blue-400/20">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
              Test
            </span>
          )}
        </div>
      )}

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {agreement.period_start_date && agreement.period_end_date && (
          <div>
            <p className="text-xs text-muted-foreground">Period</p>
            <p className="font-medium">
              {format(new Date(agreement.period_start_date), 'MMM d, yyyy')} – {format(new Date(agreement.period_end_date), 'MMM d, yyyy')}
            </p>

            {/* Credit failed alert */}
            {agreement.document_status === 'credit_failed' && (
              <div className="mt-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-2.5">
                <p className="text-xs text-red-700 dark:text-red-400">
                  Agreement could not be sent due to insufficient credits.{' '}
                  <Link href="/credits" className="font-medium underline hover:no-underline">
                    Top up from here
                  </Link>
                </p>
              </div>
            )}
          </div>
        )}
        {agreement.envelope_sent_at && !isNaN(new Date(agreement.envelope_sent_at).getTime()) && (
          <div>
            <p className="text-xs text-muted-foreground">Sent</p>
            <p className="font-medium">{format(new Date(agreement.envelope_sent_at), 'MMM d, yyyy')}</p>
          </div>
        )}
        {agreement.envelope_completed_at && !isNaN(new Date(agreement.envelope_completed_at).getTime()) && (
          <div>
            <p className="text-xs text-muted-foreground">Signed</p>
            <p className="font-medium">{format(new Date(agreement.envelope_completed_at), 'MMM d, yyyy')}</p>
          </div>
        )}
      </div>

      {/* Actions — hidden for superseded (replaced) agreements */}
      {!isSuperseded && (
        <div className="flex gap-2 pt-1">
          {hasSentDoc && (
            <Button variant="outline" size="sm" onClick={() => onViewAgreement(agreement.id, agreement.signed_document?.file_url)}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              {isSigned ? 'View Signed' : 'View'}
            </Button>
          )}
          {hasSentDoc && !isSigned && (
            <Button variant="ghost" size="sm" onClick={handleCheckStatus} disabled={checkingStatus || statusCooldown > 0}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${checkingStatus ? 'animate-spin' : ''}`} />
              {checkingStatus ? 'Checking...' : statusCooldown > 0 ? `Wait ${statusCooldown}s` : 'Check Status'}
            </Button>
          )}
          {canEdit && hasSentDoc && !isSigned && (
            <Button variant="ghost" size="sm" onClick={handleResend} disabled={resending || resendCooldown > 0}>
              <Send className="h-3.5 w-3.5 mr-1" />
              {resending ? 'Sending...' : resendCooldown > 0 ? `Wait ${resendCooldown}s` : 'Resend'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function AgreementTimeline({
  rentalId,
  rental,
  agreements,
  isLoading,
  canEdit,
  tenantId,
  displayStatus,
  extensionGroups = [],
  onViewAgreement,
}: AgreementTimelineProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sendingAgreement, setSendingAgreement] = useState<string | null>(null);

  const originalAgreements = agreements.filter((a) => a.agreement_type === 'original');
  const extensionAgreements = agreements.filter((a) => a.agreement_type === 'extension');
  const hasOriginal = originalAgreements.length > 0;

  // Map extension agreements to extension groups by matching period dates
  const extensionAgreementsByNum: Record<number, RentalAgreement[]> = {};
  extensionAgreements.forEach((a) => {
    // Find the extension group whose dates match this agreement's period
    const matchedGroup = extensionGroups.find(
      (g) => g.previousEndDate && g.newEndDate &&
        a.period_start_date?.startsWith(g.previousEndDate.slice(0, 10)) &&
        a.period_end_date?.startsWith(g.newEndDate.slice(0, 10))
    );
    const num = matchedGroup?.extensionNumber ?? 0;
    if (num > 0) {
      if (!extensionAgreementsByNum[num]) extensionAgreementsByNum[num] = [];
      extensionAgreementsByNum[num].push(a);
    }
  });
  // Fallback: if no agreements matched by dates (e.g. legacy data), assign unmatched ones by index
  const unmatchedAgreements = extensionAgreements.filter((a) =>
    !Object.values(extensionAgreementsByNum).flat().includes(a)
  );
  if (unmatchedAgreements.length > 0 && Object.keys(extensionAgreementsByNum).length === 0) {
    unmatchedAgreements.forEach((a, idx) => {
      const num = idx + 1;
      if (!extensionAgreementsByNum[num]) extensionAgreementsByNum[num] = [];
      extensionAgreementsByNum[num].push(a);
    });
  }

  // Extensions that are missing agreements
  const extensionAgreementNumbers = new Set(Object.keys(extensionAgreementsByNum).map(Number));
  const missingExtensions = extensionGroups.filter((g) => !extensionAgreementNumbers.has(g.extensionNumber));

  const hasExtensions = extensionGroups.length > 0;

  const handleSendAgreement = async (agreementType: 'original' | 'extension', extGroup?: ExtensionGroupInfo) => {
    const sendKey = agreementType === 'original' ? 'original' : `ext-${extGroup?.extensionNumber}`;
    setSendingAgreement(sendKey);
    try {
      const response = await fetch('/api/esign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalId,
          customerEmail: rental.customers?.email,
          customerName: rental.customers?.name,
          tenantId,
          agreementType,
          ...(agreementType === 'extension' && extGroup && {
            extensionPreviousEndDate: extGroup.previousEndDate,
            extensionNewEndDate: extGroup.newEndDate,
            extensionNumber: extGroup.extensionNumber,
          }),
        }),
      });
      const data = await response.json();
      if (data?.error === 'insufficient_credits') {
        toast({
          title: 'Insufficient Credits',
          description: 'Top up your credits to send this agreement',
          variant: 'destructive',
        });
        await queryClient.refetchQueries({ queryKey: ['rental-agreements'] });
        await queryClient.refetchQueries({ queryKey: ['rental'] });
      } else if (!response.ok || !data?.ok) {
        const detail = data?.detail || data?.error || 'Failed to send agreement.';
        const isRateLimit = detail.toLowerCase().includes('quota exceeded') || detail.toLowerCase().includes('rate limit');
        toast({
          title: isRateLimit ? 'Rate Limit Reached' : 'Agreement Error',
          description: isRateLimit
            ? 'BoldSign API limit reached (50/hour). Please wait a few minutes before trying again.'
            : detail,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Agreement Sent',
          description: agreementType === 'extension'
            ? `Extension #${extGroup?.extensionNumber} agreement has been sent for signing`
            : 'Rental agreement has been sent for signing',
        });
        await queryClient.refetchQueries({ queryKey: ['rental-agreements'] });
        await queryClient.refetchQueries({ queryKey: ['rental'] });
      }
    } catch (error: any) {
      toast({ title: 'Agreement Error', description: error?.message || 'Failed to send agreement', variant: 'destructive' });
    } finally {
      setSendingAgreement(null);
    }
  };

  // An unsigned agreement is "superseded" if a newer unsigned agreement exists in the same group
  const isSuperseded = (agreement: RentalAgreement, groupAgreements: RentalAgreement[]) => {
    const isSigned = agreement.document_status === 'signed' || agreement.document_status === 'completed' || !!agreement.signed_document_id;
    if (isSigned) return false; // signed agreements are never superseded
    // If this is not the last agreement in the group and is unsigned, it's superseded
    const idx = groupAgreements.indexOf(agreement);
    return idx < groupAgreements.length - 1;
  };

  // Get overall status badge for accordion trigger
  const getGroupStatusBadge = (groupAgreements: RentalAgreement[]) => {
    if (groupAgreements.length === 0) return null;
    const latest = groupAgreements[groupAgreements.length - 1];
    const info = getStatusInfo(latest);
    return (
      <Badge
        className={info.label === 'Signed' ? 'bg-green-600' : info.color === 'yellow' ? 'bg-yellow-600' : ''}
        variant={info.color === 'gray' ? 'outline' : 'default'}
      >
        <info.icon className="h-3 w-3 mr-1" />
        {info.label}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <FileSignature className="h-5 w-5 text-blue-600" />
          Rental Agreements
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground px-6 py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading agreements...
          </div>
        ) : !hasOriginal && !hasExtensions ? (
          /* No agreements and no extensions — simple empty state with send button */
          <div className="px-6 py-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">No agreements have been sent for this rental yet.</p>
              {canEdit && displayStatus !== 'Completed' && (
                <Button variant="outline" size="sm" onClick={() => handleSendAgreement('original')} disabled={sendingAgreement !== null}>
                  <Send className="h-4 w-4 mr-2" />
                  {sendingAgreement === 'original' ? 'Sending...' : 'Send Agreement'}
                </Button>
              )}
            </div>
          </div>
        ) : !hasExtensions ? (
          /* Only original, no extensions — no accordion needed */
          <div className="px-6 pb-6 pt-2">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Car className="h-3 w-3 text-green-500" />
                </div>
                <span className="text-sm font-medium">Original Agreement</span>
              </div>
              {canEdit && !hasOriginal && displayStatus !== 'Completed' && (
                <Button variant="outline" size="sm" onClick={() => handleSendAgreement('original')} disabled={sendingAgreement !== null}>
                  <Send className="h-4 w-4 mr-2" />
                  {sendingAgreement === 'original' ? 'Sending...' : 'Send Agreement'}
                </Button>
              )}
            </div>
            {originalAgreements.length > 0 ? (
              (() => {
                const latest = originalAgreements[originalAgreements.length - 1];
                return (
                  <AgreementCard
                    key={latest.id} agreement={latest} canEdit={canEdit} tenantId={tenantId}
                    rentalId={rentalId} customerEmail={rental.customers?.email}
                    customerName={rental.customers?.name} onViewAgreement={onViewAgreement}
                  />
                );
              })()
            ) : (
              <p className="text-sm text-muted-foreground">No agreement sent yet.</p>
            )}
          </div>
        ) : (
          /* Has extensions — use accordion */
          <Accordion type="single" defaultValue="original" collapsible className="w-full space-y-3 px-4 pb-4">
            {/* Original Rental section */}
            <AccordionItem value="original" className="border rounded-lg overflow-hidden">
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Car className="h-3 w-3 text-green-500" />
                  </div>
                  <span className="text-sm font-medium">Original Agreement</span>
                  {originalAgreements.length > 0 && getGroupStatusBadge(originalAgreements)}
                  {!hasOriginal && canEdit && displayStatus !== 'Completed' && (
                    <Badge variant="outline" className="text-muted-foreground text-[10px]">Not Sent</Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                {originalAgreements.length > 0 ? (
                  (() => {
                    const latest = originalAgreements[originalAgreements.length - 1];
                    return (
                      <AgreementCard
                        key={latest.id} agreement={latest} canEdit={canEdit} tenantId={tenantId}
                        rentalId={rentalId} customerEmail={rental.customers?.email}
                        customerName={rental.customers?.name} onViewAgreement={onViewAgreement}
                        hideStatusBadge
                      />
                    );
                  })()
                )
                ) : (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">No agreement sent yet.</p>
                    {canEdit && displayStatus !== 'Completed' && (
                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleSendAgreement('original'); }} disabled={sendingAgreement !== null}>
                        <Send className="h-4 w-4 mr-2" />
                        {sendingAgreement === 'original' ? 'Sending...' : 'Send Agreement'}
                      </Button>
                    )}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* Extension sections */}
            {extensionGroups.map((extGroup) => {
              const extAgreements = extensionAgreementsByNum[extGroup.extensionNumber] || [];
              const isMissing = extAgreements.length === 0;

              return (
                <AccordionItem key={`ext-${extGroup.extensionNumber}`} value={`extension-${extGroup.extensionNumber}`} className="border rounded-lg overflow-hidden">
                  <AccordionTrigger className="px-4 py-3 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-blue-500/10 flex items-center justify-center">
                        <CalendarPlus className="h-3 w-3 text-blue-500" />
                      </div>
                      <div className="text-left">
                        <span className="text-sm font-medium">Extension #{extGroup.extensionNumber}</span>
                      </div>
                      {extAgreements.length > 0 && getGroupStatusBadge(extAgreements)}
                      {isMissing && (
                        <Badge variant="outline" className="text-muted-foreground text-[10px]">Not Sent</Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    {extAgreements.length > 0 ? (
                      (() => {
                        const latest = extAgreements[extAgreements.length - 1];
                        return (
                          <AgreementCard
                            key={latest.id} agreement={latest} canEdit={canEdit} tenantId={tenantId}
                            rentalId={rentalId} customerEmail={rental.customers?.email}
                            customerName={rental.customers?.name}
                            extensionNumber={extGroup.extensionNumber}
                            onViewAgreement={onViewAgreement}
                            hideStatusBadge
                          />
                        );
                      })()
                    ) : (
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">No agreement sent for this extension yet.</p>
                        {canEdit && displayStatus !== 'Completed' && (
                          <Button
                            variant="outline" size="sm"
                            onClick={(e) => { e.stopPropagation(); handleSendAgreement('extension', extGroup); }}
                            disabled={sendingAgreement !== null}
                          >
                            <Send className="h-4 w-4 mr-2" />
                            {sendingAgreement === `ext-${extGroup.extensionNumber}` ? 'Sending...' : `Send Extension #${extGroup.extensionNumber}`}
                          </Button>
                        )}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
