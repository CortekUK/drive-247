'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@drive247/ui';
import { BONZAH_BALANCE_POLL_INTERVAL_MS } from '@drive247/shared-types';
import type { BonzahBalanceResponse } from '@drive247/shared-types';
import { bonzahApi } from '@/lib/api';
import { ModeBadge } from './mode-badge';

/**
 * Compact balance widget for the main dashboard. Hides itself when Bonzah
 * is not configured (caller passes `connected` to avoid unnecessary fetches).
 */
export function DashboardBalanceWidget({ connected }: { connected: boolean }) {
  const [balance, setBalance] = useState<BonzahBalanceResponse | null>(null);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;

    const fetchBalance = async () => {
      try {
        const { data: res } = await bonzahApi.getBalance();
        if (!cancelled && res.success) setBalance(res.data);
      } catch {
        // silent; widget hides
      }
    };

    fetchBalance();
    const t = setInterval(fetchBalance, BONZAH_BALANCE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [connected]);

  if (!connected) return null;

  const alertColor =
    balance?.alertLevel === 'critical'
      ? 'text-[#dc2626]'
      : balance?.alertLevel === 'warning'
        ? 'text-[#d97706]'
        : 'text-[#080812]';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm text-muted-foreground">
            Bonzah Balance
          </CardTitle>
          {balance && <ModeBadge mode={balance.mode} />}
        </div>
        <Link
          href="/settings/bonzah"
          className="text-xs text-[#6366f1] hover:underline"
        >
          Manage
        </Link>
      </CardHeader>
      <CardContent>
        {balance ? (
          <div className={`text-[24px] font-medium ${alertColor}`}>
            {formatUsd(balance.brokerBalance)}
            {balance.alertLevel !== 'none' && (
              <span className="ml-2 text-xs font-medium uppercase tracking-wider">
                LOW
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Loading...</span>
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
