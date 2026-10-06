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
import { AlertTriangle, FlaskConical, Users } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';

import { TEST_MODE_ANCHOR_LABELS } from '@/lib/customer-management/schedule';
import { loadScopeCounts, saveSettings, setTestMode } from '@/lib/customer-management/api';
import type { CustomerManagementSettings } from '@/lib/customer-management/types';

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
  const [recipient, setRecipient] = useState(settings.test_recipient_email || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadScopeCounts(settings.scope_tenant_slug)
      .then(setCounts)
      .catch(() => setCounts(null));
  }, [settings.scope_tenant_slug]);

  useEffect(() => {
    setRecipient(settings.test_recipient_email || '');
  }, [settings.test_recipient_email]);

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

  const toggleTest = async (on: boolean) => {
    setBusy(true);
    try {
      onChange(await setTestMode(on, recipient));
      toast.success(on ? 'Test mode on — the timeline is compressed.' : 'Test mode off.');
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

        {/* ---- developer test mode ---- */}
        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <Label htmlFor="cms-test" className="flex items-center gap-2 text-sm font-medium">
                <FlaskConical className="h-4 w-4" />
                Developer test mode
                {settings.test_mode && <Badge variant="secondary">Running</Badge>}
              </Label>
              <p className="text-sm text-muted-foreground">
                Compresses the timeline so a two-week sequence plays out in minutes:{' '}
                {TEST_MODE_ANCHOR_LABELS.join(', ')}.
              </p>
              <p className="text-xs text-muted-foreground">
                Every email is redirected to the address below — no operator receives
                anything while this is on. Rehearsal sends are logged separately and never
                block the real ones.
              </p>
            </div>
            <Switch
              id="cms-test"
              checked={settings.test_mode}
              disabled={!canEdit || busy || !recipient.trim()}
              onCheckedChange={toggleTest}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cms-test-email">Send rehearsal email to</Label>
            <Input
              id="cms-test-email"
              type="email"
              placeholder="you@drive-247.com"
              value={recipient}
              disabled={!canEdit || settings.test_mode}
              onChange={(e) => setRecipient(e.target.value)}
              onBlur={() => {
                if (settings.test_mode) return;
                const trimmed = recipient.trim();
                if (trimmed === (settings.test_recipient_email || '')) return;
                saveSettings({ test_recipient_email: trimmed || null })
                  .then(onChange)
                  .catch((e) => toast.error((e as Error).message));
              }}
            />
            {!recipient.trim() && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" />
                Test mode needs an address before it can be switched on.
              </p>
            )}
            {settings.test_mode && settings.test_mode_started_at && (
              <p className="text-xs text-muted-foreground">
                Rehearsal started {new Date(settings.test_mode_started_at).toLocaleString()} — every
                compressed delay is measured from then, not from the operator&apos;s real signup
                date.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
