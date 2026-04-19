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
import { BONZAH_BALANCE_POLL_INTERVAL_MS } from '@drive247/shared-types';
import type { BonzahBalanceResponse } from '@drive247/shared-types';
import { bonzahApi } from '@/lib/api';
import { ModeBadge } from './mode-badge';

export function BalanceCard() {
  const [balance, setBalance] = useState<BonzahBalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBalance = async () => {
    try {
      const { data: res } = await bonzahApi.getBalance();
      if (res.success) setBalance(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load balance');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBalance();
    const t = setInterval(fetchBalance, BONZAH_BALANCE_POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchBalance();
  };

  const alertColor =
    balance?.alertLevel === 'critical'
      ? 'text-[#dc2626]'
      : balance?.alertLevel === 'warning'
        ? 'text-[#d97706]'
        : 'text-[#080812]';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Bonzah CD Balance</CardTitle>
          {balance && <ModeBadge mode={balance.mode} />}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading ? (
          <span className="text-muted-foreground">Loading...</span>
        ) : !balance ? (
          <span className="text-muted-foreground">No balance data</span>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Broker balance</span>
              <span className={`text-[24px] font-medium ${alertColor}`}>
                {formatUsd(balance.brokerBalance)}
              </span>
            </div>
            {balance.threshold != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Alert threshold</span>
                <span>{formatUsd(balance.threshold)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>As of</span>
              <span>{balance.asOf}</span>
            </div>
            {balance.alertLevel !== 'none' && (
              <div className="pt-2 border-t">
                <span
                  className={
                    balance.alertLevel === 'critical'
                      ? 'text-[#dc2626] font-medium'
                      : 'text-[#d97706] font-medium'
                  }
                >
                  ⚠ Balance is {balance.alertLevel === 'critical' ? 'critically ' : ''}low
                </span>
              </div>
            )}
          </>
        )}
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
