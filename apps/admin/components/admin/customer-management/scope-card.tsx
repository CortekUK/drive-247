'use client';

/**
 * Who receives anything, and the Developer Test Mode switch.
 *
 * This card sits above all three automations because it governs all three, and
 * because the two switches on it are the only controls in the module that can
 * do something you cannot undo: one widens the audience from a single
 * rehearsal tenant to every operator on the platform, and the other starts
 * mailing on a compressed clock.
 *
 * Both therefore say what they will do BEFORE they are touched — the scope
 * switch shows the operator count either way, and test mode will not turn on
 * without somewhere to deliver.
 */

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';

import { loadScopeCounts, saveSettings } from '@/lib/customer-management/api';
import type { CustomerManagementSettings } from '@/lib/customer-management/types';

import { TestModePanel } from './test-mode-panel';

export function ScopeCard({
  settings,
  canEdit,
  onChange,
}: {
  settings: CustomerManagementSettings;
  canEdit: boolean;
  onChange: (next: CustomerManagementSettings) => void;
}) {
  const [counts, setCounts] = useState<{ all: number; scoped: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadScopeCounts(settings.scope_tenant_slug)
      .then(setCounts)
      .catch(() => setCounts(null));
  }, [settings.scope_tenant_slug]);

  const toggleScope = async (on: boolean) => {
    setBusy(true);
    try {
      onChange(await saveSettings({ scope_all_tenants: on }));
      toast.success(on ? 'Now sending to every operator.' : `Now sending to ${settings.scope_tenant_slug} only.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const scopedLabel = counts?.scoped === 0
    ? `no tenant with the slug "${settings.scope_tenant_slug}"`
    : `1 operator (${settings.scope_tenant_slug})`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Who receives these emails
        </CardTitle>
        <CardDescription>
          Applies to all three automations. Each automation also has its own switch.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ---- scope ---- */}
        <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="cms-scope" className="text-sm font-medium">
              Send to every operator
            </Label>
            <p className="text-sm text-muted-foreground">
              {settings.scope_all_tenants ? (
                <>
                  On — every operator on Drive247 is eligible
                  {counts ? ` (${counts.all} tenant${counts.all === 1 ? '' : 's'})` : ''}.
                </>
              ) : (
                <>Off — only {scopedLabel} is eligible.</>
              )}
            </p>
            {/* The count is here, before the switch is touched, because "all
                tenants" is an abstraction and "142 operators" is a decision. */}
            {counts && !settings.scope_all_tenants && counts.all > 1 && (
              <p className="text-xs text-muted-foreground">
                Turning this on makes {counts.all - counts.scoped} more operator
                {counts.all - counts.scoped === 1 ? '' : 's'} eligible. Anything already
                overdue by more than two days is logged as skipped rather than sent, so
                switching on does not mail a backlog.
              </p>
            )}
          </div>
          <Switch
            id="cms-scope"
            checked={settings.scope_all_tenants}
            disabled={!canEdit || busy}
            onCheckedChange={toggleScope}
          />
        </div>

        <TestModePanel settings={settings} canEdit={canEdit} onChange={onChange} />

      </CardContent>
    </Card>
  );
}
