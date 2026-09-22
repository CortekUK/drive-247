'use client';

import { useState } from 'react';
import { TicketPercent } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/store/authStore';
import type { TenantLite } from '@/components/admin/promo-codes/api';
import { CodesTab } from '@/components/admin/promo-codes/codes-tab';
import { OperatorsTab } from '@/components/admin/promo-codes/operators-tab';
import { ReferralsTab } from '@/components/admin/promo-codes/referrals-tab';
import { ClaimsTab } from '@/components/admin/promo-codes/claims-tab';
import { LeaderboardTab } from '@/components/admin/promo-codes/leaderboard-tab';
import { SettingsTab } from '@/components/admin/promo-codes/settings-tab';

/**
 * Drive247 promo codes + the operator referral programme.
 *
 * Money off what DRIVE247 charges operators — not an operator's own renter
 * promo codes. Super admins manage everything; sales agents can look up codes,
 * copy referral links and put a code on a payment link (brief R3).
 */
export default function PromoCodesPage() {
  const { user } = useAuthStore();
  const canEdit = !!user?.is_super_admin;
  const [tab, setTab] = useState('codes');
  const [operator, setOperator] = useState<TenantLite | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 glow-purple-sm">
          <TicketPercent className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Promo Codes</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
            Drive247 subscription promo codes and the operator referral programme. Every operator gets a code and a link;
            a new operator who uses it gets a discount, and the operator who referred them earns a growing discount on their own bill.
            {!canEdit && ' You can look up codes and copy links; changes are made by a super admin.'}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="codes">Codes</TabsTrigger>
          <TabsTrigger value="operators">Operators</TabsTrigger>
          <TabsTrigger value="referrals">Referrals</TabsTrigger>
          {canEdit && <TabsTrigger value="claims">Claims</TabsTrigger>}
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          {canEdit && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>
        <TabsContent value="codes" className="mt-4"><CodesTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="operators" className="mt-4">
          <OperatorsTab key={operator?.id ?? 'none'} canEdit={canEdit} initialTenant={operator} />
        </TabsContent>
        <TabsContent value="referrals" className="mt-4"><ReferralsTab canEdit={canEdit} /></TabsContent>
        {canEdit && <TabsContent value="claims" className="mt-4"><ClaimsTab canEdit={canEdit} /></TabsContent>}
        <TabsContent value="leaderboard" className="mt-4">
          <LeaderboardTab onOpen={t => { setOperator(t); setTab('operators'); }} />
        </TabsContent>
        {canEdit && <TabsContent value="settings" className="mt-4"><SettingsTab canEdit={canEdit} /></TabsContent>}
      </Tabs>
    </div>
  );
}
