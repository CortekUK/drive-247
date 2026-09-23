'use client';

import { useState } from 'react';
import { TicketPercent } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/store/authStore';
import { CodesTab } from '@/components/admin/promo-codes/codes-tab';
import { ReferralLinksTab } from '@/components/admin/promo-codes/referral-links-tab';
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
  /** The operator whose referral set-up is open under Referral Links, if any. */
  const [operator, setOperator] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 glow-purple-sm">
          <TicketPercent className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Promo Codes</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
            Drive247 campaign codes, and the operator referral programme. Every operator gets a code and a link;
            a new operator who uses it gets a discount, and the operator who referred them earns a growing discount on their own bill.
            {!canEdit && ' You can look up codes and copy links; changes are made by a super admin.'}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="codes">Codes</TabsTrigger>
          <TabsTrigger value="referral-links">Referral Links</TabsTrigger>
          {canEdit && <TabsTrigger value="claims">Claims</TabsTrigger>}
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          {canEdit && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>
        <TabsContent value="codes" className="mt-4"><CodesTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="referral-links" className="mt-4">
          <ReferralLinksTab canEdit={canEdit} viewing={operator} onView={setOperator} />
        </TabsContent>
        {canEdit && <TabsContent value="claims" className="mt-4"><ClaimsTab canEdit={canEdit} /></TabsContent>}
        <TabsContent value="leaderboard" className="mt-4">
          <LeaderboardTab onOpen={t => { setOperator(t.id); setTab('referral-links'); }} />
        </TabsContent>
        {canEdit && <TabsContent value="settings" className="mt-4"><SettingsTab canEdit={canEdit} /></TabsContent>}
      </Tabs>
    </div>
  );
}
