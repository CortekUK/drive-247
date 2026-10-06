'use client';

/**
 * Billing receipt test — pretend Northwind just paid, and watch the receipt.
 *
 * A real receipt goes out when a subscription invoice is marked paid. Waiting
 * for a real charge to test that is not practical, so this records a PRETEND
 * payment for the scope tenant (`test_receipt_at`). On its next tick the runner
 * builds a receipt for it through exactly the same template and sender as a
 * real one — with TEST references in place of Stripe's — and sends it to
 * Northwind's own email.
 *
 * Nothing is written to the invoice tables and Stripe is never called, so
 * Northwind's billing history is untouched. Every press is a new payment.
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Receipt, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';

import { loadSends, simulateReceipt } from '@/lib/customer-management/api';
import type {
  CustomerManagementSendRow,
  CustomerManagementSettings,
} from '@/lib/customer-management/types';

const REFRESH_MS = 10_000;

export function ReceiptSimulator({
  settings,
  onChange,
}: {
  settings: CustomerManagementSettings;
  onChange: (next: CustomerManagementSettings) => void;
}) {
  const slug = settings.scope_tenant_slug;
  const [sends, setSends] = useState<CustomerManagementSendRow[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = await loadSends({ automation: 'receipt', limit: 20 });
      setSends(rows.filter((r) => r.tenant_slug === slug && r.cycle_key.startsWith('test:sim:')));
    } catch {
      /* The next refresh tries again. */
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const pay = async () => {
    setBusy(true);
    try {
      onChange(await simulateReceipt());
      toast.success('Pretend payment recorded. The receipt goes out within 30 seconds.');
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pendingSince = settings.test_receipt_at ? new Date(settings.test_receipt_at) : null;
  const stamp = pendingSince ? Math.floor(pendingSince.getTime() / 60_000) : null;
  const latest = stamp === null ? undefined : sends.find((r) => r.cycle_key.endsWith(`sim-${stamp}`));

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Receipt className="h-4 w-4" />
          Billing receipt test — {slug}
        </p>
        <p className="text-sm text-muted-foreground">
          Pretend {slug} just paid its subscription. The system sends the receipt email by itself,
          exactly as it does for a real payment, with TEST numbers in place of Stripe&apos;s.
          Northwind&apos;s real billing is not touched.
        </p>
      </div>

      {!settings.receipt_enabled && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
          Billing Receipts are switched off on the Customer Management page, so nothing will send.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" disabled={busy} onClick={pay}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Simulate a paid payment
        </Button>
        {pendingSince && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {latest?.status === 'sent' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            ) : latest?.status === 'failed' ? (
              <XCircle className="h-3.5 w-3.5 text-red-600" />
            ) : (
              <Clock className="h-3.5 w-3.5" />
            )}
            {latest
              ? latest.status === 'sent'
                ? `Receipt sent → ${latest.to_email}`
                : `${latest.status}: ${(latest.detail || '').replace(/_/g, ' ')}`
              : `Paid ${pendingSince.toLocaleTimeString()} — receipt sending within 30 seconds`}
          </span>
        )}
      </div>

      {sends.length > 0 && (
        <ul className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
          {sends.slice(0, 5).map((r) => (
            <li key={r.id}>
              {new Date(r.created_at).toLocaleTimeString()} · {r.subject || r.step_key} · {r.status}
              {r.to_email ? ` → ${r.to_email}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
