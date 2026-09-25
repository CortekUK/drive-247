'use client';

import { useState } from 'react';
import { TicketPercent } from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useRegisterSidebarSections } from '@/components/admin/sidebar-sections';
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

  /* The five sections live in the sidebar, not in a strip across the top —
     which is where Northwind's rail keeps a page's sub-pages, and which this
     page needed more than most: its `TabsList` wrapped onto two lines on a
     narrow window. The state, the handlers and the panels below are all
     exactly as they were; only where you press to change section has moved. */
  useRegisterSidebarSections(
    '/admin/promo-codes',
    [
      { id: 'codes', label: 'Codes' },
      { id: 'referral-links', label: 'Referral Links' },
      ...(canEdit ? [{ id: 'claims', label: 'Claims' }] : []),
      { id: 'leaderboard', label: 'Leaderboard' },
      ...(canEdit ? [{ id: 'settings', label: 'Settings' }] : []),
    ],
    tab,
    setTab,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 glow-purple-sm">
          <TicketPercent className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Promo Codes</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
            Drive247 campaign codes, and the operator referral programme. Every operator gets a code and a link;
            a new operator who uses it gets a discount, and the operator who referred them earns a growing discount on their own bill.
            {!canEdit && ' You can look up codes and copy links; changes are made by a super admin.'}
          </p>
        </div>
      </div>

      {/* No `TabsList`: the triggers are in the sidebar. `Tabs` itself stays,
          because it is what mounts the right panel for `value` — and keeping it
          means every panel below is untouched. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="codes"><CodesTab canEdit={canEdit} /></TabsContent>
        <TabsContent value="referral-links">
          <ReferralLinksTab canEdit={canEdit} viewing={operator} onView={setOperator} />
        </TabsContent>
        {canEdit && <TabsContent value="claims"><ClaimsTab canEdit={canEdit} /></TabsContent>}
        <TabsContent value="leaderboard">
          <LeaderboardTab onOpen={t => { setOperator(t.id); setTab('referral-links'); }} />
        </TabsContent>
        {canEdit && <TabsContent value="settings"><SettingsTab canEdit={canEdit} /></TabsContent>}
      </Tabs>
    </div>
  );
}
