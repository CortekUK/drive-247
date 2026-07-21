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
import SalesCredentialsDialog, { type SalesCredentialsTarget } from '@/components/admin/SalesCredentialsDialog';
import { formatAmount } from '@/lib/sales-credentials';
import { TrendingUp, Plus, AlertCircle } from 'lucide-react';

/** The embedded tenant row — null once the tenant has been deleted (FK is ON DELETE SET NULL). */
interface EmbeddedTenant {
  id: string;
  company_name: string | null;
  slug: string | null;
}

interface SubmissionRow {
  id: string;
  first_name: string | null;
  business_name: string | null;
  slug: string | null;
  business_email: string | null;
  generated_email: string | null;
  subscription_amount: number | null; // cents
  subscription_currency: string | null;
  status: string | null;
  error_message: string | null;
  created_at: string;
  tenants: EmbeddedTenant | null;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });

// subscription_amount is stored in CENTS (see sales_onboarding_submissions).
// formatAmount() shows whole dollars for round amounts and cents when there are
// any — never rounds $199.50 up to "$200".
const fmtAmount = (row: SubmissionRow) =>
  row.subscription_amount == null ? '—' : `${formatAmount(row.subscription_amount, row.subscription_currency)}/mo`;

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

/**
 * A row is only re-openable when the tenant it provisioned still exists — the
 * credentials pane derives the portal/booking URLs and the first-login password
 * from the slug, which is meaningless for a deleted or never-created tenant.
 */
const credentialsFor = (row: SubmissionRow): SalesCredentialsTarget | null => {
  const tenant = row.tenants;
  if (!tenant) return null;
  // Prefer the submission's slug: the first-login password was derived from it
  // at provisioning time, so a later rename must not change what we show.
  const slug = row.slug || tenant.slug;
  const email = row.generated_email || row.business_email;
  if (!slug || !email) return null;
  return {
    companyName: tenant.company_name || row.business_name || slug,
    slug,
    email,
    firstName: row.first_name,
    amountCents: row.subscription_amount,
    currency: row.subscription_currency,
  };
};

export default function SalesPage() {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [credentials, setCredentials] = useState<SalesCredentialsTarget | null>(null);

  const loadRows = async () => {
    setLoadError(null);
    try {
      // Embed the tenant so we can tell live tenants from deleted ones —
      // tenant_id is ON DELETE SET NULL, so a deleted tenant leaves the
      // submission behind with a null tenant_id and it would otherwise keep
      // showing (Haseeb Fleet / Alpha Rentals etc.).
      //
      // The visibility rule is "tenant still exists OR status = 'failed'".
      // PostgREST cannot express that OR in one filter (an `!inner` embed drops
      // failed rows, which never had a tenant, and `or=(...)` cannot reference
      // an embedded resource's presence), so we do ONE query with a LEFT embed
      // and apply the OR client-side. That is cheaper than two round trips and
      // keeps a single ordered result set.
      // Over-fetch, then filter, then slice. The limit has to be a budget of
      // VISIBLE rows, not raw ones: filtering after a .limit(50) means every
      // deleted tenant eats a slot, so live onboardings silently drop off the
      // bottom, and once 50 consecutive rows are deleted-tenant rows the page
      // shows the "No onboardings yet" empty state while real ones exist.
      const VISIBLE_LIMIT = 50;
      const { data, error } = await (supabase as any)
        .from('sales_onboarding_submissions')
        .select('*, tenants(id, company_name, slug)')
        .order('created_at', { ascending: false })
        .limit(VISIBLE_LIMIT * 4);
      if (error) throw error;
      const all = (data || []) as SubmissionRow[];
      setRows(
        all
          .filter((row) => row.tenants !== null || row.status === 'failed')
          .slice(0, VISIBLE_LIMIT)
      );
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
                {rows.map((row) => {
                  const target = credentialsFor(row);
                  return (
                    <TableRow
                      key={row.id}
                      // No role="button": overriding a <tr>'s implicit `row` role
                      // orphans its cells, so screen readers stop associating
                      // them with the column headers and stop announcing
                      // "row N of M" — for exactly the rows that carry data.
                      // tabIndex + aria-label + the key handler give keyboard
                      // access without destroying the table semantics.
                      // A real focus ring (not outline-none + a 5% tint, which
                      // is indistinguishable from hover and fails WCAG 2.4.11).
                      className={
                        target
                          ? 'cursor-pointer hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary'
                          : undefined
                      }
                      tabIndex={target ? 0 : undefined}
                      aria-label={target ? `View credentials for ${target.companyName}` : undefined}
                      onClick={target ? () => setCredentials(target) : undefined}
                      onKeyDown={
                        target
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setCredentials(target);
                              }
                            }
                          : undefined
                      }
                    >
                      <TableCell className="font-medium whitespace-nowrap">
                        {row.tenants?.company_name || row.business_name || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {row.slug || row.tenants?.slug || '—'}
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
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SalesOnboardingDialog open={showCreate} onOpenChange={setShowCreate} onCreated={loadRows} />
      <SalesCredentialsDialog
        open={credentials !== null}
        onOpenChange={(o) => {
          if (!o) setCredentials(null);
        }}
        target={credentials}
      />
    </div>
  );
}
