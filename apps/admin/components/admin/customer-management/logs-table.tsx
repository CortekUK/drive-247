'use client';

/**
 * What this automation actually did.
 *
 * SKIPS ARE ROWS, and that is the point of the table. "Why did this operator
 * not get the day-7 email" is the question somebody will ask, and a log that
 * only records successes cannot answer it — so the runner writes a row with a
 * reason whenever it decides not to send, and this is where the reason is read.
 */

import { EmptyState } from '@/components/admin/empty-state';
import { EmailsEmptyArt } from '@/components/admin/illustrations/scenes/admin-scenes';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { LogEntry, LogList, LogRailCard } from './log-rail';

import { loadSends, NotInstalledError } from '@/lib/customer-management/api';
import type { AutomationId, CustomerManagementSendRow } from '@/lib/customer-management/types';

/** Plain English for the reasons the runner writes. */
const SKIP_REASONS: Record<string, string> = {
  past_backfill_grace:
    'Was already more than two days overdue when the automation reached it, so it was closed rather than sent late.',
  scheduled_to_cancel: 'The operator has cancelled but still has paid-up time — there is no next charge.',
  past_due: 'The subscription is past due. Chasing payment is Stripe’s job, not this reminder’s.',
  not_live: 'No live subscription.',
  no_subscription: 'No subscription on record.',
  no_billing_date: 'Stripe has not given a next billing date.',
  billing_date_passed: 'The billing date has already passed.',
  no_recipient: 'No contact email on the tenant.',
};

export function SendLog({ automation }: { automation: AutomationId }) {
  const [rows, setRows] = useState<CustomerManagementSendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeTests, setIncludeTests] = useState(true);
  const [missing, setMissing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await loadSends({ automation, includeTests, limit: 60 }));
      setMissing(false);
    } catch (e) {
      if (e instanceof NotInstalledError) setMissing(true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [automation, includeTests]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <LogRailCard
      title="Log"
      description="Every send and every deliberate skip, newest first."
      actions={
        <>
          <div className="flex items-center gap-2">
            <Switch id={`tests-${automation}`} checked={includeTests} onCheckedChange={setIncludeTests} />
            <Label htmlFor={`tests-${automation}`} className="text-xs text-muted-foreground">
              Include rehearsals
            </Label>
          </div>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} aria-label="Refresh the log">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </>
      }
    >
      {missing ? (
        <p className="text-sm text-muted-foreground">The log table does not exist yet.</p>
      ) : rows.length === 0 && !loading ? (
        <EmptyState
          size="section"
          illustration={<EmailsEmptyArt />}
          headline="Nothing sent yet"
          body="Use “Preview what would send” to see what the next run would do, without sending it."
        />
      ) : (
        <LogList>
          {rows.map((row) => (
            <LogEntry
              key={row.id}
              who={row.tenant_name || row.tenant_slug || '—'}
              status={<StatusBadge row={row} />}
              what={<span className="font-mono">{row.step_key}</span>}
              when={
                <>
                  <span className="whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</span>
                  {row.test_mode && <Badge variant="outline">Rehearsal</Badge>}
                  {row.to_email && <span className="min-w-0 truncate">{row.to_email}</span>}
                </>
              }
              detail={skipExplanation(row)}
            />
          ))}
        </LogList>
      )}
    </LogRailCard>
  );
}

function StatusBadge({ row }: { row: CustomerManagementSendRow }) {
  if (row.status === 'sent') return <Badge variant="secondary">Sent</Badge>;
  return (
    <Badge variant={row.status === 'failed' ? 'destructive' : 'outline'}>
      {row.status === 'failed' ? 'Failed' : 'Skipped'}
    </Badge>
  );
}

/** Why a row was not sent, in plain English. */
function skipExplanation(row: CustomerManagementSendRow): string | null {
  if (row.status === 'sent' || !row.detail) return null;
  return SKIP_REASONS[row.detail] || row.detail;
}
