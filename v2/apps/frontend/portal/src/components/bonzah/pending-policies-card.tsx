'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@drive247/ui';
import { BonzahPolicyStatus } from '@drive247/shared-types';
import type { BonzahPolicyResponse } from '@drive247/shared-types';
import { bonzahApi } from '@/lib/api';

export function PendingPoliciesCard() {
  const [policies, setPolicies] = useState<BonzahPolicyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const load = async () => {
    try {
      const { data: res } = await bonzahApi.listPolicies({
        status: BonzahPolicyStatus.INSUFFICIENT_BALANCE,
      });
      if (res.success) setPolicies(res.data.items);
    } catch {
      // silent — the card just hides on error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const { data: res } = await bonzahApi.retryPending();
      if (res.success) {
        toast.success(
          `Retry complete: ${res.data.succeeded}/${res.data.attempted} succeeded`,
        );
        await load();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  if (loading || policies.length === 0) return null;

  const totalPending = policies.reduce(
    (acc, p) => acc + Number(p.premiumAmount ?? 0),
    0,
  );

  return (
    <Card className="border-[#dc2626]">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base text-[#dc2626]">
          Pending Policies — Insufficient Balance
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRetry}
          disabled={retrying}
        >
          {retrying ? 'Retrying...' : 'Retry All'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          {policies.length} polic{policies.length === 1 ? 'y' : 'ies'} blocked, totalling{' '}
          <span className="font-medium text-[#080812]">
            {formatUsd(totalPending)}
          </span>
          . Top up your Bonzah account and click Retry All.
        </p>
      </CardContent>
    </Card>
  );
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}
