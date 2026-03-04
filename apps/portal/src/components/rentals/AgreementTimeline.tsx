'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  FileSignature,
  CheckCircle,
  Clock,
  Mail,
  Send,
  ExternalLink,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { RentalAgreement } from '@/hooks/use-rental-agreements';

interface AgreementTimelineProps {
  rentalId: string;
  rental: {
    id: string;
    document_status?: string | null;
    docusign_envelope_id?: string | null;
    signed_document_id?: string | null;
    boldsign_mode?: string | null;
    status?: string;
    customers?: { id: string; name: string; email?: string };
  };
  agreements: RentalAgreement[];
  isLoading: boolean;
  canEdit: boolean;
  tenantId: string | undefined;
  displayStatus: string;
  onViewAgreement: (agreementId: string, signedDocFileUrl?: string | null) => void;
}

function getStatusInfo(agreement: RentalAgreement) {
  const status = agreement.document_status;
  const isSigned = status === 'signed' || status === 'completed' || !!agreement.signed_document_id;

  if (isSigned) {
    return {
      label: 'Signed',
      color: 'green' as const,
      icon: CheckCircle,
      dotClass: 'bg-green-500',
    };
  }
  if (status === 'sent' || status === 'delivered') {
    return {
      label: status === 'delivered' ? 'Viewed' : 'Awaiting Signature',
      color: 'yellow' as const,
      icon: Mail,
      dotClass: 'bg-yellow-500',
    };
  }
  return {
    label: 'Not Sent',
    color: 'gray' as const,
    icon: Clock,
    dotClass: 'bg-gray-400',
  };
}

function AgreementTimelineItem({
  agreement,
  isLast,
  canEdit,
  tenantId,
  rentalId,
  customerEmail,
  customerName,
  onViewAgreement,
}: {
  agreement: RentalAgreement;
  isLast: boolean;
  canEdit: boolean;
  tenantId: string | undefined;
  rentalId: string;
  customerEmail?: string;
  customerName?: string;
  onViewAgreement: (agreementId: string, signedDocFileUrl?: string | null) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [resending, setResending] = useState(false);

  const statusInfo = getStatusInfo(agreement);
  const isSigned = statusInfo.label === 'Signed';
  const isExtension = agreement.agreement_type === 'extension';
  const hasSentDoc = !!agreement.document_id;
  const isTestMode = agreement.boldsign_mode === 'test';

  const handleCheckStatus = async () => {
    setCheckingStatus(true);
    try {
      const response = await fetch('/api/esign/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalId,
          envelopeId: agreement.document_id,
          agreementId: agreement.id,
        }),
      });
      const data = await response.json();
      if (data?.ok) {
        toast({ title: 'Status Updated', description: `Document status: ${data.status}` });
        queryClient.invalidateQueries({ queryKey: ['rental-agreements', rentalId] });
        queryClient.invalidateQueries({ queryKey: ['rental', rentalId] });
      } else {
        toast({ title: 'Check Failed', description: data?.error || 'Could not check status', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error?.message || 'Failed to check status', variant: 'destructive' });
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      const response = await fetch('/api/esign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalId,
          customerEmail,
          customerName,
          tenantId,
          agreementType: agreement.agreement_type,
          ...(isExtension && {
            extensionPreviousEndDate: agreement.period_start_date,
            extensionNewEndDate: agreement.period_end_date,
          }),
        }),
      });
      const data = await response.json();
      if (data?.ok) {
        toast({ title: 'Agreement Resent', description: 'A new agreement has been sent for signing' });
        queryClient.invalidateQueries({ queryKey: ['rental-agreements', rentalId] });
        queryClient.invalidateQueries({ queryKey: ['rental', rentalId] });
      } else {
        toast({ title: 'Resend Failed', description: data?.error || data?.detail || 'Failed to resend agreement', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error?.message || 'Failed to resend', variant: 'destructive' });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="relative flex gap-3">
      {/* Timeline line and dot */}
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${statusInfo.dotClass}`} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">
                {isExtension ? 'Extension Agreement' : 'Original Agreement'}
              </span>
              <Badge
                className={
                  isSigned
                    ? 'bg-green-600'
                    : statusInfo.color === 'yellow'
                    ? 'bg-yellow-600'
                    : ''
                }
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

            {/* Period dates */}
            <p className="text-sm text-muted-foreground mt-0.5">
              {isExtension
                ? `Extended to ${agreement.period_end_date ? format(new Date(agreement.period_end_date), 'MMM d, yyyy') : 'N/A'}`
                : agreement.period_start_date && agreement.period_end_date
                ? `${format(new Date(agreement.period_start_date), 'MMM d, yyyy')} – ${format(new Date(agreement.period_end_date), 'MMM d, yyyy')}`
                : ''}
            </p>

            {/* Timestamps */}
            <p className="text-xs text-muted-foreground mt-0.5">
              {agreement.envelope_sent_at && `Sent: ${format(new Date(agreement.envelope_sent_at), 'MMM d, yyyy')}`}
              {agreement.envelope_sent_at && agreement.envelope_completed_at && ' · '}
              {agreement.envelope_completed_at && `Signed: ${format(new Date(agreement.envelope_completed_at), 'MMM d, yyyy')}`}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1 flex-shrink-0">
            {hasSentDoc && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onViewAgreement(agreement.id, agreement.signed_document?.file_url)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                {isSigned ? 'View Signed' : 'View'}
              </Button>
            )}

            {hasSentDoc && !isSigned && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCheckStatus}
                disabled={checkingStatus}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${checkingStatus ? 'animate-spin' : ''}`} />
                {checkingStatus ? 'Checking...' : 'Check'}
              </Button>
            )}

            {canEdit && hasSentDoc && !isSigned && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResend}
                disabled={resending}
              >
                <Send className={`h-3.5 w-3.5 mr-1`} />
                {resending ? 'Sending...' : 'Resend'}
              </Button>
            )}
          </div>
        </div>
      </div>
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
  onViewAgreement,
}: AgreementTimelineProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sendingAgreement, setSendingAgreement] = useState(false);

  const hasOriginal = agreements.some((a) => a.agreement_type === 'original');

  const handleSendOriginal = async () => {
    setSendingAgreement(true);
    try {
      const response = await fetch('/api/esign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalId,
          customerEmail: rental.customers?.email,
          customerName: rental.customers?.name,
          tenantId,
          agreementType: 'original',
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.ok) {
        toast({
          title: 'Agreement Error',
          description: data?.detail || data?.error || 'Failed to send agreement.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Agreement Sent', description: 'Rental agreement has been sent for signing' });
        queryClient.invalidateQueries({ queryKey: ['rental-agreements', rentalId] });
        queryClient.invalidateQueries({ queryKey: ['rental', rentalId] });
      }
    } catch (error: any) {
      toast({ title: 'Agreement Error', description: error?.message || 'Failed to send agreement', variant: 'destructive' });
    } finally {
      setSendingAgreement(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-blue-600" />
            Rental Agreements
          </CardTitle>
          {canEdit && !hasOriginal && displayStatus !== 'Completed' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSendOriginal}
              disabled={sendingAgreement}
            >
              <Send className="h-4 w-4 mr-2" />
              {sendingAgreement ? 'Sending...' : 'Send Agreement'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading agreements...
          </div>
        ) : agreements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agreements have been sent for this rental yet.
          </p>
        ) : (
          <div>
            {agreements.map((agreement, index) => (
              <AgreementTimelineItem
                key={agreement.id}
                agreement={agreement}
                isLast={index === agreements.length - 1}
                canEdit={canEdit}
                tenantId={tenantId}
                rentalId={rentalId}
                customerEmail={rental.customers?.email}
                customerName={rental.customers?.name}
                onViewAgreement={onViewAgreement}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
