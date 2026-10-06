'use client';

/**
 * Previews — the switches that used to live on the portal's `/dev` page.
 *
 * Saved on the developer row; the Northwind portal copies them into its own
 * browser storage (apps/portal/src/components/dev/dev-bridge.tsx), where the
 * existing readers in apps/portal/src/lib/dev-overrides.ts pick them up.
 *
 * Those readers only work under `next dev`: in a production build they are
 * compiled down to "off". So these switch things on the portal running on
 * localhost, and do nothing on the live portal — by design, not by accident.
 *
 * The id lists are copies of the ones in apps/portal/src/lib/dev-overrides.ts
 * (a different app; nothing is shared between them). An id the portal does not
 * know is dropped on its side, so a stale copy here cannot break a page.
 */

import { useEffect, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';

import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { callDeveloper, type PortalPreviews } from './developer-api';

const MESSAGE_SCENARIOS = [
  { id: 'off', label: 'Off' },
  { id: 'mixed', label: 'Active mixed' },
  { id: 'email', label: 'Email-heavy' },
  { id: 'calls', label: 'Call history' },
  { id: 'failed', label: 'Failed send' },
  { id: 'empty', label: 'New conversation' },
];

const BILLING_SCENARIOS = [
  { id: 'off', label: 'Off' },
  { id: 'active', label: 'Active' },
  { id: 'payment_failed', label: 'Payment failed' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'grace_expiring', label: 'Grace, nearly out' },
  { id: 'grace_expired', label: 'Grace expired' },
  { id: 'recovered', label: 'Payment recovered' },
];

const EMPTY_STATE_PAGES = [
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'customers', label: 'Customers' },
  { id: 'rentals', label: 'Rentals' },
  { id: 'agreements', label: 'Agreements' },
  { id: 'insurances', label: 'Insurances' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'payments', label: 'Payments' },
  { id: 'pending-bookings', label: 'Pending bookings' },
  { id: 'enquiries', label: 'Enquiries' },
  { id: 'leads', label: 'Leads' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'messages', label: 'Messages' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'support', label: 'Support' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'fines', label: 'Fines' },
  { id: 'documents', label: 'Documents' },
  { id: 'blocked-dates', label: 'Availability' },
  { id: 'blocked-customers', label: 'Blocked customers' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'users', label: 'Users' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'vehicle-owners', label: 'Vehicle owners' },
  { id: 'owner-payouts', label: 'Owner payouts' },
];

function Chips({
  options,
  value,
  onPick,
  disabled,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onPick: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(o.id)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            value === o.id ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PreviewsCard({ initial }: { initial: PortalPreviews | null }) {
  const [previews, setPreviews] = useState<PortalPreviews>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) setPreviews(initial);
  }, [initial]);

  const update = async (patch: Partial<PortalPreviews>) => {
    const previous = previews;
    const next = { ...previews, ...patch };
    setPreviews(next);
    setSaving(true);
    const res = await callDeveloper({ action: 'previews', previews: next });
    setSaving(false);
    if (!res.ok) {
      setPreviews(previous);
      toast.error('Could not save the preview', { description: res.error ?? undefined });
    }
  };

  const forced = new Set(previews.emptyStates ?? []);
  const toggleEmpty = (id: string) => {
    const next = new Set(forced);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void update({ emptyStates: EMPTY_STATE_PAGES.map((p) => p.id).filter((p) => next.has(p)) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Eye className="size-5" />
          Previews
          {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </CardTitle>
        <CardDescription>
          For the Northwind portal running on your machine (localhost). The live portal ignores these.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Hold skeletons</p>
            <p className="text-sm text-muted-foreground">Keeps every auto skeleton on screen so it can be looked at.</p>
          </div>
          <Switch
            checked={previews.holdSkeletons === true}
            onCheckedChange={(v) => void update({ holdSkeletons: v })}
            disabled={saving}
            aria-label="Hold skeletons"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Messages conversation</p>
          <Chips
            options={MESSAGE_SCENARIOS}
            value={previews.messagesScenario ?? 'off'}
            onPick={(id) => void update({ messagesScenario: id })}
            disabled={saving}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium">Billing state</p>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Sample data
              <Switch
                checked={previews.billingSampleData === true}
                onCheckedChange={(v) => void update({ billingSampleData: v })}
                disabled={saving}
                aria-label="Billing sample data"
              />
            </label>
          </div>
          <Chips
            options={BILLING_SCENARIOS}
            value={previews.billingScenario ?? 'off'}
            onPick={(id) => void update({ billingScenario: id })}
            disabled={saving}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium">
              Teaching empty states <span className="text-muted-foreground">({forced.size} on)</span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => void update({ emptyStates: EMPTY_STATE_PAGES.map((p) => p.id) })}
              >
                All on
              </Button>
              <Button variant="outline" size="sm" disabled={saving} onClick={() => void update({ emptyStates: [] })}>
                All off
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {EMPTY_STATE_PAGES.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={saving}
                onClick={() => toggleEmpty(p.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  forced.has(p.id) ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
