'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { tenantsApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@drive247/ui';
import type { TenantStats } from '@drive247/shared-types';

export default function DashboardPage() {
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tenantsApi
      .stats()
      .then(({ data: res }) => {
        if (res.success) setStats(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const kpis = stats
    ? [
        { label: 'Total Tenants', value: stats.total },
        { label: 'Active', value: stats.active, color: 'text-[#16a34a]' },
        { label: 'Inactive', value: stats.inactive, color: 'text-[#d97706]' },
        { label: 'Suspended', value: stats.suspended, color: 'text-[#dc2626]' },
        { label: 'Production', value: stats.production },
        { label: 'Test', value: stats.test },
        { label: 'Total Staff Users', value: stats.totalUsers },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[30px] font-medium text-[#080812]">Dashboard</h2>
        <Link href="/tenants">
          <Button>Manage Tenants</Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 7 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="h-4 bg-muted rounded w-20 mb-2" />
                  <div className="h-8 bg-muted rounded w-12" />
                </CardContent>
              </Card>
            ))
          : kpis.map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className={`text-3xl font-semibold mt-1 ${kpi.color ?? ''}`}>
                    {kpi.value}
                  </p>
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  );
}
