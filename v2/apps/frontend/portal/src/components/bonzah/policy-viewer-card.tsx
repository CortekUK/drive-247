'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
} from '@drive247/ui';
import { BonzahPolicyStatus } from '@drive247/shared-types';
import type { BonzahPolicyResponse } from '@drive247/shared-types';
import { bonzahApi } from '@/lib/api';
import { PolicyStatusBadge } from './policy-status-badge';
import { PdfDownloadButton } from './pdf-download-button';
import { ModeBadge } from './mode-badge';

interface Props {
  policies: BonzahPolicyResponse[];
  onChanged: () => void;
}

/**
 * Shows every policy chunk in the chain individually. Never a rolled-up
 * green checkmark until every chunk is active (rule #15).
 */
export function PolicyViewerCard({ policies, onChanged }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (policies.length === 0) return null;

  const sorted = [...policies].sort(
    (a, b) => a.chainSequence - b.chainSequence,
  );
  const chainId = sorted[0].chainId;
  const mode = sorted[0].mode;

  const allActive = sorted.every(
    (p) => p.status === BonzahPolicyStatus.ACTIVE,
  );
  const canConfirm = sorted.some(
    (p) =>
      p.status === BonzahPolicyStatus.QUOTED ||
      p.status === BonzahPolicyStatus.PAYMENT_PENDING ||
      p.status === BonzahPolicyStatus.INSUFFICIENT_BALANCE,
  );

  const totalPremium = sorted.reduce(
    (acc, p) => acc + Number(p.premiumAmount),
    0,
  );

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const { data: res } = await bonzahApi.confirmPayment(chainId);
      if (res.success) {
        if (res.data.anyFailed) {
          toast.error(
            `${res.data.totalConfirmed}/${res.data.totalPolicies} chunks confirmed — some failed, check statuses`,
          );
        } else {
          toast.success('Payment confirmed — all policies active');
        }
        onChanged();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Confirmation failed');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base">Bonzah Insurance</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {sorted.length === 1
              ? 'One policy issued.'
              : `Chain of ${sorted.length} policies (rental > 30 days).`}{' '}
            Total premium {formatUsd(totalPremium)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModeBadge mode={mode} />
          {canConfirm && (
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={confirming}
            >
              {confirming ? 'Confirming...' : 'Confirm payment'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.map((policy, idx) => (
          <PolicyRow
            key={policy.id}
            policy={policy}
            showDivider={idx > 0}
            soleChunk={sorted.length === 1}
          />
        ))}

        {!allActive && (
          <p className="text-xs text-muted-foreground pt-1 border-t">
            All chunks must be active before this rental&apos;s overall insurance
            status flips to &quot;Bonzah&quot;.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PolicyRow({
  policy,
  showDivider,
  soleChunk,
}: {
  policy: BonzahPolicyResponse;
  showDivider: boolean;
  soleChunk: boolean;
}) {
  const coverage = policy.coverage;
  const tiers: Array<'cdw' | 'rcli' | 'sli' | 'pai'> = [
    'cdw',
    'rcli',
    'sli',
    'pai',
  ];

  return (
    <>
      {showDivider && <Separator />}
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-medium">
              {soleChunk ? 'Policy' : `Chunk ${policy.chainSequence + 1}`}
            </span>{' '}
            <span className="text-xs text-muted-foreground">
              {policy.tripStartDate} → {policy.tripEndDate}
            </span>
          </div>
          <PolicyStatusBadge status={policy.status} />
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5">
          {policy.policyNo && <div>Policy #{policy.policyNo}</div>}
          {policy.quoteNo && <div>Quote #{policy.quoteNo}</div>}
          <div>Premium: {formatUsd(Number(policy.premiumAmount))}</div>
          {policy.lastError && (
            <div className="text-[#dc2626]">Error: {policy.lastError}</div>
          )}
        </div>

        {policy.status === BonzahPolicyStatus.ACTIVE && coverage.pdf_ids && (
          <div className="flex flex-wrap gap-2 pt-1">
            {tiers.map((t) => {
              const id = coverage.pdf_ids?.[t];
              if (!coverage[t] || !id) return null;
              return (
                <PdfDownloadButton
                  key={t}
                  policyId={policy.id}
                  dataId={id}
                  label={`${t.toUpperCase()} PDF`}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}
