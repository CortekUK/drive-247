'use client';

/**
 * Customer Management Service — the three scheduled operator emails.
 *
 * ── THE SUB-TABS ARE IN THE SIDEBAR, NOT ACROSS THE TOP ─────────────────────
 *
 * Asked for Sep 25 2026 and already the house pattern: a page's own sections
 * live in the navigation rail (components/admin/sidebar-sections.tsx), which is
 * how Northwind's rail works and how /admin/promo-codes carries its five. So
 * the brief's three sub-tabs are registered rather than rendered as a
 * `TabsList`, and they appear under this page's nav entry.
 *
 * ── WHAT THE MODULE IS ──────────────────────────────────────────────────────
 *
 * Three automations that nothing on the platform sends today — there is no drip
 * engine anywhere in supabase/functions and nothing warns an operator before a
 * renewal charge. The runner (`customer-management-run`) does the work on a
 * minutely cron; this page is where its timelines, its copy, its audience and
 * its rehearsal mode are set, and where its log is read.
 *
 * It is deliberately NOT part of lib/notifications-v2/, which is a switchboard
 * over mail the codebase already sends and requires `evidence` (file:line) for
 * every entry. These three have no existing sender to point at.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';

import { useAuthStore } from '@/store/authStore';
import { useRegisterSidebarSections } from '@/components/admin/sidebar-sections';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { AUTOMATIONS } from '@/lib/customer-management/catalog';
import { loadSettings, loadSteps, NotInstalledError } from '@/lib/customer-management/api';
import type {
  AutomationId,
  CustomerManagementSettings,
  CustomerManagementStep,
} from '@/lib/customer-management/types';

import { AutomationTab } from './automation-tab';
import { CancellationsTab } from './cancellations-tab';
import { RetentionOffersTab } from './retention-offers-tab';
import { LifecycleCheckinsTab } from './lifecycle-checkins-tab';
import { WebinarPollTab } from './webinar-poll-tab';
import { MarketingEmailsTab } from './marketing-emails-tab';
import { WebinarsTab } from './webinars-tab';
import { ScopeCard } from './scope-card';

export function CustomerManagementPage() {
  const { user } = useAuthStore();
  const canEdit = !!user?.is_super_admin;

  /** The three automations, the Cancellations report and the retention offers. */
  const [tab, setTab] = useState<AutomationId | 'cancellations' | 'retention' | 'lifecycle' | 'poll' | 'marketing' | 'webinars'>('signup');
  const [settings, setSettings] = useState<CustomerManagementSettings | null>(null);
  const [steps, setSteps] = useState<CustomerManagementStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [notInstalled, setNotInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useRegisterSidebarSections(
    '/admin/customer-management',
    [
      ...AUTOMATIONS.map((a) => ({ id: a.id, label: a.label })),
      { id: 'cancellations', label: 'Cancellations' },
      { id: 'retention', label: 'Tiered retention offers' },
      { id: 'lifecycle', label: 'Lifecycle check-ins' },
      { id: 'poll', label: 'Webinar Poll' },
      { id: 'marketing', label: 'Marketing Instructions Emails' },
      { id: 'webinars', label: 'Webinars' },
    ],
    tab,
    (id) => setTab(id as AutomationId | 'cancellations' | 'retention' | 'lifecycle' | 'poll' | 'marketing' | 'webinars'),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSettings, nextSteps] = await Promise.all([loadSettings(), loadSteps()]);
      setSettings(nextSettings);
      setSteps(nextSteps);
      setNotInstalled(false);
    } catch (e) {
      if (e instanceof NotInstalledError) setNotInstalled(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshSteps = useCallback(async () => {
    try {
      setSteps(await loadSteps());
    } catch {
      /* The toast on the failing action already said so. */
    }
  }, []);

  // The report needs none of the email settings, so it never waits on them
  // (or on the module being installed).
  if (tab === 'cancellations') {
    return <CancellationsTab canEdit={canEdit} />;
  }
  if (tab === 'retention') {
    return <RetentionOffersTab canEdit={canEdit} />;
  }
  if (tab === 'lifecycle') {
    return <LifecycleCheckinsTab canEdit={canEdit} />;
  }
  if (tab === 'poll') {
    return <WebinarPollTab canEdit={canEdit} />;
  }
  if (tab === 'marketing') {
    return <MarketingEmailsTab canEdit={canEdit} />;
  }
  if (tab === 'webinars') {
    return <WebinarsTab canEdit={canEdit} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  /*
   * The migration is written and deliberately not applied, so this is the
   * normal state on a fresh database rather than an error. Naming the file
   * beats "Something went wrong" — it is the next thing the reader has to do.
   */
  if (notInstalled) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>Not installed yet</CardTitle>
            <CardDescription>
              This module needs its tables before it can do anything.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Run{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                supabase/migrations/PENDING_20261006_customer_management_service.sql.txt
              </code>{' '}
              against the database, then deploy{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">customer-management-run</code>.
            </p>
            <p>
              Applying it sends nothing on its own: it creates the tables, seeds the default
              emails, and leaves the audience set to the Northwind rehearsal tenant. The cron
              schedule at the foot of that file is commented out, because the moment to start
              mailing operators is a decision rather than a side effect of running a migration.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="space-y-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>Could not load</CardTitle>
            <CardDescription>{error || 'No settings row.'}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Read-only: changing these needs a super admin account.
        </p>
      )}

      <ScopeCard settings={settings} canEdit={canEdit} onChange={setSettings} />

      <AutomationTab
        automation={tab}
        steps={steps}
        settings={settings}
        canEdit={canEdit}
        onSettingsChange={setSettings}
        onStepsChange={refreshSteps}
      />
    </div>
  );
}

function Header() {
  return (
    <div className="space-y-1">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <MailCheck className="h-5 w-5" />
        Customer Management Service
      </h1>
      <p className="text-sm text-muted-foreground">
        The scheduled emails Drive247 sends its operators: onboarding, renewal warnings and
        payment confirmations.
      </p>
    </div>
  );
}
