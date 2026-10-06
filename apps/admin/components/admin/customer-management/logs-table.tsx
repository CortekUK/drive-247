'use client';

/**
 * What this automation actually did.
 *
 * SKIPS ARE ROWS, and that is the point of the table. "Why did this operator
 * not get the day-7 email" is the question somebody will ask, and a log that
 * only records successes cannot answer it — so the runner writes a row with a
 * reason whenever it decides not to send, and this is where the reason is read.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Log</CardTitle>
            <CardDescription>
              Every send and every deliberate skip, newest first.
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor={`tests-${automation}`} className="text-xs text-muted-foreground">
                Include rehearsals
              </Label>
              <Switch
                id={`tests-${automation}`}
                checked={includeTests}
                onCheckedChange={setIncludeTests}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {missing ? (
          <p className="text-sm text-muted-foreground">
            The log table does not exist yet.
          </p>
        ) : rows.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Use &ldquo;Preview what would send&rdquo; above to see what the next run
            would do without sending it.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent to</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                      {row.test_mode && (
                        <Badge variant="outline" className="ml-2">
                          Rehearsal
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.tenant_name || row.tenant_slug || '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.step_key}</TableCell>
                    <TableCell>
                      <StatusCell row={row} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.to_email || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusCell({ row }: { row: CustomerManagementSendRow }) {
  if (row.status === 'sent') return <Badge variant="secondary">Sent</Badge>;

  const explanation = row.detail ? SKIP_REASONS[row.detail] || row.detail : null;
  return (
    <div className="space-y-1">
      <Badge variant={row.status === 'failed' ? 'destructive' : 'outline'}>
        {row.status === 'failed' ? 'Failed' : 'Skipped'}
      </Badge>
      {explanation && (
        <p className="max-w-xs text-xs text-muted-foreground">{explanation}</p>
      )}
    </div>
  );
}
