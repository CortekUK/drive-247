'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { BonzahConnectionStatus } from '@drive247/shared-types';
import { bonzahApi } from '@/lib/api';
import { BalanceCard } from '@/components/bonzah/balance-card';
import { CredentialsForm } from '@/components/bonzah/credentials-form';
import { BrochureUrlForm } from '@/components/bonzah/brochure-url-form';
import { AlertConfigForm } from '@/components/bonzah/alert-config-form';
import { PendingPoliciesCard } from '@/components/bonzah/pending-policies-card';

export default function BonzahSettingsPage() {
  const [connection, setConnection] = useState<BonzahConnectionStatus | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const { data: res } = await bonzahApi.getConnection();
      if (res.success) setConnection(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load Bonzah connection');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!connection) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load Bonzah connection.
      </p>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link href="/" className="text-sm text-[#6366f1] hover:underline">
          ← Dashboard
        </Link>
        <h2 className="text-[30px] font-medium text-[#080812] mt-1">
          Bonzah Insurance
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure your Bonzah integration for offering rental insurance at booking.
        </p>
      </div>

      <PendingPoliciesCard />

      {connection.connected && <BalanceCard />}

      <CredentialsForm connection={connection} onChanged={load} />

      {connection.connected && (
        <>
          <BrochureUrlForm connection={connection} onChanged={load} />
          <AlertConfigForm />
        </>
      )}
    </div>
  );
}
