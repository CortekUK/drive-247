'use client';

/**
 * Developer Test Mode, in one place and rendered in two.
 *
 * It appears on the Customer Management page, where the timelines are edited,
 * and on /admin/developer, which is where every other rehearsal tool already
 * lives. Those are two different jobs — "check the copy I just wrote" and
 * "drive the canary" — and somebody doing the second should not have to find
 * the first.
 *
 * ── WHY ONE COMPONENT AND NOT TWO ───────────────────────────────────────────
 *
 * The switch is not cosmetic. Turning it on stamps the anchor every compressed
 * due time is measured from, mints the run id that keeps one rehearsal's log
 * rows from blocking the next, and redirects every recipient. A second copy of
 * that on another page is a second chance to get one of the three wrong, and
 * the failure would be an email reaching a real operator — so there is one
 * copy, and `api.setTestMode` owns the three-column write.
 */

import { useEffect, useState } from 'react';
import { FlaskConical, Mail } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';

import { TEST_MODE_ANCHOR_LABELS } from '@/lib/customer-management/schedule';
import { loadTestTargetEmail, setTestMode } from '@/lib/customer-management/api';
import type { CustomerManagementSettings } from '@/lib/customer-management/types';

/**
 * There is no address to type. Rehearsal mail goes to the rehearsal tenant's
 * own email (Northwind's), looked up when test mode is switched on — so the
 * switch is the only control, and it works the first time it is pressed.
 */
export function TestModePanel({
  settings,
  canEdit,
  onChange,
  idPrefix = 'cms',
}: {
  settings: CustomerManagementSettings;
  canEdit: boolean;
  onChange: (next: CustomerManagementSettings) => void;
  /** Two instances can be mounted on one page; ids have to stay unique. */
  idPrefix?: string;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // While a rehearsal runs, the address it was stamped with is the truth.
  // Otherwise show where the next one would go.
  useEffect(() => {
    if (settings.test_mode) return;
    loadTestTargetEmail(settings.scope_tenant_slug)
      .then(setTarget)
      .catch(() => setTarget(null));
  }, [settings.test_mode, settings.scope_tenant_slug]);

  const recipient = settings.test_mode ? settings.test_recipient_email : target;

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      onChange(await setTestMode(on, settings.scope_tenant_slug));
      toast.success(
        on ? 'Test mode on — the day-0 email is on its way.' : 'Test mode off.',
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <Label
            htmlFor={`${idPrefix}-test`}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <FlaskConical className="h-4 w-4" />
            Developer test mode
            {settings.test_mode && <Badge variant="secondary">Running</Badge>}
          </Label>
          <p className="text-sm text-muted-foreground">
            Plays the timeline at test speed: day 0 immediately,{' '}
            {TEST_MODE_ANCHOR_LABELS.join(', ')}. The emails send themselves — there is nothing to
            press after switching this on.
          </p>
          <p className="text-xs text-muted-foreground">
            Only {settings.scope_tenant_slug} is rehearsed, even when every operator is switched on,
            and real operators receive nothing while this runs. Test sends are logged separately
            and never block the real ones.
          </p>
        </div>
        <Switch
          id={`${idPrefix}-test`}
          checked={settings.test_mode}
          disabled={!canEdit || busy}
          onCheckedChange={toggle}
        />
      </div>

      <p className="flex items-center gap-2 text-sm">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">Test emails go to</span>
        <span className="font-medium">{recipient || `${settings.scope_tenant_slug}'s email`}</span>
      </p>

      {settings.test_mode && settings.test_mode_started_at && (
        <p className="text-xs text-muted-foreground">
          Rehearsal started {new Date(settings.test_mode_started_at).toLocaleString()} — every
          delay is measured from then, not from the operator&apos;s real signup date.
        </p>
      )}
    </div>
  );
}
