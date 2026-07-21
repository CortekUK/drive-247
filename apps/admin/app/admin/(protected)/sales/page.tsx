'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import SalesOnboardingDialog from '@/components/admin/SalesOnboardingDialog';
import { TrendingUp, Plus, AlertCircle } from 'lucide-react';

interface SubmissionRow {
  id: string;
  business_name: string | null;
  slug: string | null;
  subscription_amount: number | null; // cents
  subscription_currency: string | null;
  status: string | null;
  error_message: string | null;
  created_at: string;
}

const currencySymbol = (currency: string | null): string => {
  switch ((currency || 'usd').toLowerCase()) {
    case 'usd':
      return '$';
    case 'gbp':
      return '£';
    case 'eur':
      return '€';
    case 'aed':
      return 'AED ';
    default:
      return (currency || '').toUpperCase() + ' ';
  }
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

// subscription_amount is stored in CENTS (see sales_onboarding_submissions).
// Show whole dollars for round amounts, cents when there are any — never round
// $199.50 up to "$200".
const fmtAmount = (row: SubmissionRow) => {
  if (row.subscription_amount == null) return '—';
  const major = row.subscription_amount / 100;
  return `${currencySymbol(row.subscription_currency)}${major.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}/mo`;
};

const STATUS_LABELS: Record<string, string> = {
  created: 'Created',
  failed: 'Failed',
};

const statusClass = (status: string | null) => {
  if (status === 'created') return 'text-sm font-medium text-success';
  if (status === 'failed') return 'text-sm font-medium text-destructive';
  // Unknown/pending statuses are informational, not errors.
  return 'text-sm font-medium text-muted-foreground';
};

export default function SalesPage() {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadRows = async () => {
    setLoadError(null);
    try {
      const { data, error } = await (supabase as any)
        .from('sales_onboarding_submissions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setRows((data || []) as SubmissionRow[]);
    } catch (err: any) {
      const message = err?.message || 'Unknown error';
      setLoadError(message);
      toast.error('Failed to load submissions: ' + message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sales</h1>
            <p className="text-sm text-muted-foreground">Onboard new rental companies</p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          Create Onboarding
        </Button>
      </div>

      {/* Recent submissions */}
      <Card>
        <CardContent className="pt-6 overflow-x-auto">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : loadError ? (
            <div className="text-center py-16">
              <AlertCircle className="h-10 w-10 text-destructive/60 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-4">
                Couldn&apos;t load onboardings. {loadError}
              </p>
              <Button variant="outline" size="sm" onClick={() => { setLoading(true); void loadRows(); }}>
                Try again
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16">
              <TrendingUp className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No onboardings yet. Click &quot;Create Onboarding&quot; to provision your first rental company.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-primary/5 hover:bg-primary/5">
                  <TableHead className="min-w-[180px]">Business</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {row.business_name || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {row.slug || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{fmtAmount(row)}</TableCell>
                    <TableCell>
                      <span className={statusClass(row.status)}>
                        {(row.status && STATUS_LABELS[row.status]) || row.status || '—'}
                      </span>
                      {row.status === 'failed' && row.error_message && (
                        <p
                          className="text-xs text-muted-foreground truncate max-w-[280px]"
                          title={row.error_message}
                        >
                          {row.error_message}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                      {fmtDate(row.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SalesOnboardingDialog open={showCreate} onOpenChange={setShowCreate} onCreated={loadRows} />
    </div>
  );
}
