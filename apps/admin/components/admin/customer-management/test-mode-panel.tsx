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
import { AlertTriangle, FlaskConical } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';

import { TEST_MODE_ANCHOR_LABELS } from '@/lib/customer-management/schedule';
import { saveSettings, setTestMode } from '@/lib/customer-management/api';
import type { CustomerManagementSettings } from '@/lib/customer-management/types';

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
  const [recipient, setRecipient] = useState(settings.test_recipient_email || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRecipient(settings.test_recipient_email || '');
  }, [settings.test_recipient_email]);

  const toggle = async (on: boolean) => {
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

  const saveRecipient = () => {
    if (settings.test_mode) return;
    const trimmed = recipient.trim();
    if (trimmed === (settings.test_recipient_email || '')) return;
    saveSettings({ test_recipient_email: trimmed || null })
      .then(onChange)
      .catch((e) => toast.error((e as Error).message));
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
            Compresses the timeline so a two-week sequence plays out in minutes:{' '}
            {TEST_MODE_ANCHOR_LABELS.join(', ')}.
          </p>
          <p className="text-xs text-muted-foreground">
            Every email is redirected to the address below — no operator receives anything while
            this is on. Rehearsal sends are logged separately and never block the real ones.
          </p>
        </div>
        <Switch
          id={`${idPrefix}-test`}
          checked={settings.test_mode}
          disabled={!canEdit || busy || !recipient.trim()}
          onCheckedChange={toggle}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-test-email`}>Send rehearsal email to</Label>
        <Input
          id={`${idPrefix}-test-email`}
          type="email"
          placeholder="you@drive-247.com"
          value={recipient}
          /* Locked while a rehearsal runs: the anchor and the run id were
             stamped against this address, and moving it mid-run would split
             one rehearsal across two inboxes. */
          disabled={!canEdit || settings.test_mode}
          onChange={(e) => setRecipient(e.target.value)}
          onBlur={saveRecipient}
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
            compressed delay is measured from then, not from the operator&apos;s real signup date.
          </p>
        )}
      </div>
    </div>
  );
}
