'use client';

/**
 * Integrations — which integrations are premium, what they cost each month,
 * and how they appear on the operator's Integrations page
 * (docs/integration-billing/build-spec.md, D4, D12).
 *
 * The controls Ghulam listed, one row per integration on the operator's board:
 *   Premium          — a crown on the card and a Subscribe button in its dialog
 *   Monthly price    — USD, added to the operator's Drive247 bill every month
 *   First month free — the first bill it appears on credits it back in full
 *   Beta             — a "Beta" flag on the card
 *   Not available    — the card is dimmed and its panel is read-only
 *   Hidden           — the card is not shown at all
 *
 * Platform-wide, not per-tenant — but only the integration-billing tenant
 * (northwind) reads it today; every other operator's board ignores it.
 *
 * Saving writes `integration_catalog_v2` directly (RLS: super admins only).
 * Stripe is not touched here: the Price for a premium integration is created
 * the first time an operator subscribes, on that operator's own platform
 * account. Changing a price therefore only affects NEW subscribers — anyone
 * already subscribed keeps the price they agreed to.
 *
 * The table may not exist yet (`ops/integration_billing_v2.sql` is applied by
 * hand), so a missing table is reported as a setup instruction.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Crown, Loader2, Plug, Save } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { Switch } from '@/components/ui/switch';
import {
  ADMIN_INTEGRATIONS,
  DEFAULT_PREMIUM_KEYS,
  PREVIEW_ONLY_KEYS,
  catalogRowsToSave,
  centsToDollarsInput,
  premiumPriceProblem,
} from '@/lib/integration-pricing';

interface CatalogDraft {
  key: string;
  name: string;
  category: string;
  is_premium: boolean;
  price: string;
  first_month_free: boolean;
  is_beta: boolean;
  is_unavailable: boolean;
  is_hidden: boolean;
}

interface SubscriberRow {
  id: string;
  tenant_id: string;
  integration_key: string;
  status: string;
  monthly_price_cents: number;
  currency: string;
  first_month_free: boolean;
  first_bill_at: string | null;
  subscribed_at: string;
  error: string | null;
  tenants: { company_name: string | null; slug: string | null } | null;
}

type Notice = { tone: 'ok' | 'error' | 'setup'; text: string } | null;

const blankDraft = (i: (typeof ADMIN_INTEGRATIONS)[number]): CatalogDraft => ({
  key: i.key,
  name: i.name,
  category: i.category,
  // Before anything is saved, the portal shows these three as premium.
  is_premium: DEFAULT_PREMIUM_KEYS.includes(i.key),
  price: '',
  first_month_free: false,
  is_beta: false,
  is_unavailable: false,
  is_hidden: false,
});

const isMissingTable = (error: { code?: string; message?: string } | null) =>
  !!error &&
  (error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /could not find the table|does not exist/i.test(error.message ?? ''));

const money = (cents: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

export default function IntegrationsAdminPage() {
  const [rows, setRows] = useState<CatalogDraft[]>(ADMIN_INTEGRATIONS.map(blankDraft));
  /** The rows as last loaded or saved; what "unsaved changes" is measured against. */
  const [saved, setSaved] = useState<CatalogDraft[]>(ADMIN_INTEGRATIONS.map(blankDraft));
  const [subscribers, setSubscribers] = useState<SubscriberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  // A read that failed for any reason but a missing table: the rows on screen
  // are defaults, not what is saved, and the subscriber guard below has nothing
  // to check against. Saving then would overwrite every saved price and flag,
  // so Save is locked until a reload succeeds.
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const [catalogRes, subsRes] = await Promise.all([
      supabase
        .from('integration_catalog_v2')
        .select('integration_key, is_premium, monthly_price_cents, first_month_free, is_beta, is_unavailable, is_hidden'),
      supabase
        .from('tenant_integration_subscriptions_v2')
        .select(
          'id, tenant_id, integration_key, status, monthly_price_cents, currency, first_month_free, first_bill_at, subscribed_at, error, tenants(company_name, slug)',
        )
        .in('status', ['pending', 'active', 'failed'])
        .order('subscribed_at', { ascending: false })
        .limit(200),
    ]);

    if (catalogRes.error) {
      setRows(ADMIN_INTEGRATIONS.map(blankDraft));
      setSaved(ADMIN_INTEGRATIONS.map(blankDraft));
      setNotice(
        isMissingTable(catalogRes.error)
          ? {
              tone: 'setup',
              text: 'The integration_catalog_v2 table has not been created yet. Apply ops/integration_billing_v2.sql, then reload. Until then operators see the defaults below: every integration free and visible, except Inshur, Turo Sync and CheckMyDriver, which show the crown as coming soon with no price.',
            }
          : { tone: 'error', text: `Could not load the integrations: ${catalogRes.error.message}. Nothing can be saved until they load; reload the page.` },
      );
      if (!isMissingTable(catalogRes.error)) setLoadFailed(true);
      setSubscribers([]);
      setLoading(false);
      return;
    }

    const byKey = new Map(
      (catalogRes.data ?? []).map((r: Record<string, unknown>) => [String(r.integration_key), r]),
    );
    const loaded = ADMIN_INTEGRATIONS.map((i) => {
        const r = byKey.get(i.key);
        if (!r) return blankDraft(i);
        return {
          ...blankDraft(i),
          is_premium: r.is_premium === true,
          price: centsToDollarsInput(r.monthly_price_cents == null ? null : Number(r.monthly_price_cents)),
          first_month_free: r.first_month_free === true,
          is_beta: r.is_beta === true,
          is_unavailable: r.is_unavailable === true,
          is_hidden: r.is_hidden === true,
        };
    });
    setRows(loaded);
    setSaved(loaded);
    setSubscribers(subsRes.error ? [] : ((subsRes.data ?? []) as unknown as SubscriberRow[]));
    // Without the subscriber list, Save could make a paid integration free
    // while someone is still billed for it; so it is locked here too.
    const subsFailed = !!subsRes.error && !isMissingTable(subsRes.error);
    if (subsFailed) setLoadFailed(true);
    setNotice(
      subsFailed
        ? { tone: 'error', text: `Could not load subscribers: ${subsRes.error!.message}. Nothing can be saved until they load; reload the page.` }
        : null,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (key: string, fields: Partial<CatalogDraft>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...fields } : r)));

  const problems = useMemo(
    () =>
      rows
        .filter((r) => r.is_premium)
        .map((r) => ({ name: r.name, problem: premiumPriceProblem(r.price) }))
        .filter((p): p is { name: string; problem: string } => p.problem !== null),
    [rows],
  );

  const saveAll = async () => {
    if (loadFailed) {
      setNotice({ tone: 'error', text: 'The saved integrations did not load, so saving now would overwrite them. Reload the page first.' });
      return;
    }
    if (problems.length > 0) {
      setNotice({ tone: 'error', text: `${problems[0].name}: ${problems[0].problem}` });
      return;
    }
    // Making a paid integration free or hidden does not stop Stripe billing the
    // operators already subscribed to it — their subscription item stays on
    // their bill. So it is refused until those subscriptions are canceled below.
    for (const r of rows) {
      if (r.is_premium && !r.is_hidden) continue;
      const paying = subscribers.filter(
        (s) => s.integration_key === r.key && (s.status === 'pending' || s.status === 'active'),
      ).length;
      if (paying > 0) {
        setNotice({
          tone: 'error',
          text: `${r.name} has ${paying} subscriber${paying === 1 ? '' : 's'}. Cancel ${paying === 1 ? 'it' : 'them'} under Subscribers before making ${r.name} free or hiding it; until then Stripe keeps billing ${paying === 1 ? 'it' : 'them'}.`,
        });
        return;
      }
    }
    setSaving(true);
    setNotice(null);
    const { data: auth } = await supabase.auth.getUser();
    const { data: me } = auth?.user
      ? await supabase.from('app_users').select('id').eq('auth_user_id', auth.user.id).maybeSingle()
      : { data: null };
    const payload = catalogRowsToSave(rows, {
      updatedBy: (me as { id?: string } | null)?.id ?? null,
      now: new Date().toISOString(),
    });
    // One upsert on the primary key: re-pressing Save after a failure is always safe.
    const { error } = await supabase.from('integration_catalog_v2').upsert(payload, { onConflict: 'integration_key' });
    setSaving(false);
    if (error) {
      setNotice(
        isMissingTable(error)
          ? { tone: 'setup', text: 'The integration_catalog_v2 table has not been created yet. Apply ops/integration_billing_v2.sql, then save again.' }
          : { tone: 'error', text: `Could not save: ${error.message}` },
      );
      return;
    }
    setSaved(rows.map((r) => ({ ...r })));
    setNotice({
      tone: 'ok',
      text: 'Saved. Operators see the change the next time they open their Integrations page (a reload shows it at once).',
    });
    void load();
  };

  const cancelSubscription = async (row: SubscriberRow) => {
    const name = ADMIN_INTEGRATIONS.find((i) => i.key === row.integration_key)?.name ?? row.integration_key;
    const company = row.tenants?.company_name || row.tenants?.slug || 'this company';
    const ok = window.confirm(
      `Remove ${name} from ${company}'s Drive247 bill?\n\nIt comes off their next bill and every bill after. Nothing is refunded for the current month, and their ${name} panel becomes read-only.`,
    );
    if (!ok) return;
    setCanceling(row.id);
    setNotice(null);
    const { data, error } = await supabase.functions.invoke('integration-billing', {
      body: { action: 'cancel', tenantId: row.tenant_id, integrationKey: row.integration_key },
    });
    setCanceling(null);
    if (error) {
      let message = error.message;
      try {
        const body = await (error as { context?: Response }).context?.clone().json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        /* not JSON */
      }
      setNotice({ tone: 'error', text: `Could not cancel: ${message}` });
      return;
    }
    if (data?.ok === false) {
      setNotice({ tone: 'error', text: `Could not cancel: ${data.error ?? 'unknown error'}` });
      return;
    }
    setNotice({ tone: 'ok', text: `${name} was removed from ${company}'s bill.` });
    void load();
  };

  // What is on screen but not in the database yet. The Save button used to sit
  // below a 13-row table, off the bottom of the screen, so switches read as
  // doing nothing at all.
  const changed = rows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(saved[i]));
  const dirty = changed.length > 0;

  const live = subscribers.filter((s) => s.status === 'pending' || s.status === 'active');
  const failed = subscribers.filter((s) => s.status === 'failed');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Plug className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Choose which integrations are premium and what they cost each month, and how each one
            appears on the operator&rsquo;s Integrations page. A premium price is added to the
            operator&rsquo;s Drive247 bill as its own line. For now this applies to northwind only.
          </p>
        </div>
      </header>

      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${
            notice.tone === 'error'
              ? 'bg-destructive/10 text-destructive'
              : notice.tone === 'setup'
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {notice.text}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      ) : (
        <>
          {/* Sticky, so Save is on screen whichever row is being changed. */}
          <div className="sticky top-0 z-20 -mx-6 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
            <p className="text-sm text-muted-foreground">
              {dirty ? (
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  {changed.length} unsaved change{changed.length === 1 ? '' : 's'} — nothing reaches operators until you save.
                </span>
              ) : (
                'Every change is saved.'
              )}
            </p>
            <button
              type="button"
              onClick={() => void saveAll()}
              disabled={saving || loadFailed || !dirty}
              title={loadFailed ? 'Reload the page first: the saved integrations did not load' : undefined}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Integration</th>
                  <th className="px-3 py-3">Premium</th>
                  <th className="px-3 py-3">Monthly price (USD)</th>
                  <th className="px-3 py-3">First month free</th>
                  <th className="px-3 py-3">Beta</th>
                  <th className="px-3 py-3">Not available</th>
                  <th className="px-3 py-3">Hidden</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const problem = r.is_premium ? premiumPriceProblem(r.price) : null;
                  return (
                    <tr key={r.key} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          {r.name}
                          {r.is_premium && <Crown className="size-3.5 text-amber-500" aria-label="Premium" />}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.category}</div>
                        {PREVIEW_ONLY_KEYS.includes(r.key) && (
                          <div className="mt-0.5 max-w-[14rem] text-xs text-amber-700 dark:text-amber-400">
                            Preview only: its price shows, but it can&rsquo;t be subscribed to until it launches.
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Switch
                          checked={r.is_premium}
                          onCheckedChange={(v) => patch(r.key, { is_premium: v, ...(v ? {} : { first_month_free: false }) })}
                          aria-label={`${r.name} is premium`}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">$</span>
                          <input
                            inputMode="decimal"
                            value={r.price}
                            disabled={!r.is_premium}
                            placeholder={r.is_premium ? '20.00' : 'Free'}
                            onChange={(e) => patch(r.key, { price: e.target.value })}
                            aria-label={`${r.name} monthly price in dollars`}
                            aria-invalid={!!problem}
                            className={`h-9 w-28 rounded-md border bg-background px-2 text-sm tabular-nums disabled:cursor-not-allowed disabled:opacity-50 ${
                              problem ? 'border-destructive' : 'border-input'
                            }`}
                          />
                        </div>
                        {problem && <p className="mt-1 max-w-[14rem] text-xs text-destructive">{problem}</p>}
                        {!problem && r.is_premium && r.price.trim() === '' && (
                          <p className="mt-1 max-w-[14rem] text-xs text-muted-foreground">
                            No price yet: shown as &ldquo;Price to be announced&rdquo; and not on sale.
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Switch
                          checked={r.first_month_free}
                          disabled={!r.is_premium}
                          onCheckedChange={(v) => patch(r.key, { first_month_free: v })}
                          aria-label={`${r.name}: first month free`}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <Switch
                          checked={r.is_beta}
                          onCheckedChange={(v) => patch(r.key, { is_beta: v })}
                          aria-label={`${r.name} is in beta`}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <Switch
                          checked={r.is_unavailable}
                          onCheckedChange={(v) => patch(r.key, { is_unavailable: v })}
                          aria-label={`${r.name} is not available`}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <Switch
                          checked={r.is_hidden}
                          onCheckedChange={(v) => patch(r.key, { is_hidden: v })}
                          aria-label={`${r.name} is hidden`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-xs text-muted-foreground">
              Nothing is charged on the day an operator subscribes: the price is added to their
              next Drive247 bill and every bill after it, and the days in between are on us. A new
              price applies to new subscribers only. Making an integration premium does not switch
              it off for an operator already using it: its panel on their Integrations page becomes
              read-only until they subscribe. Keep an integration&rsquo;s price below the
              operator&rsquo;s plan price; the subscription reconciler reads the largest line as
              the plan amount.
            </p>
            <button
              type="button"
              onClick={() => void saveAll()}
              disabled={saving || loadFailed || !dirty}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Subscribers</h2>
            {live.length === 0 ? (
              <p className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                No operator has subscribed to a premium integration yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3">Company</th>
                      <th className="px-3 py-3">Integration</th>
                      <th className="px-3 py-3">Price</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3">Subscribed</th>
                      <th className="px-3 py-3">First bill</th>
                      <th className="px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {live.map((s) => (
                      <tr key={s.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-medium">{s.tenants?.company_name || s.tenants?.slug || s.tenant_id}</td>
                        <td className="px-3 py-3">
                          {ADMIN_INTEGRATIONS.find((i) => i.key === s.integration_key)?.name ?? s.integration_key}
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          {money(s.monthly_price_cents, s.currency)}/mo{s.first_month_free ? ' · first month free' : ''}
                        </td>
                        <td className={`px-3 py-3 capitalize ${s.status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {s.status}
                          {s.status === 'pending' && Date.now() - new Date(s.subscribed_at).getTime() > 10 * 60_000 && (
                            <span className="block text-xs normal-case text-destructive">
                              Stuck. Check this company&rsquo;s subscription in Stripe, then Cancel to clear it.
                            </span>
                          )}
                          {s.error && <span className="block max-w-[16rem] truncate text-xs normal-case text-destructive" title={s.error}>{s.error}</span>}
                        </td>
                        <td className="px-3 py-3">{day(s.subscribed_at)}</td>
                        <td className="px-3 py-3">{day(s.first_bill_at)}</td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void cancelSubscription(s)}
                            disabled={canceling === s.id}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                          >
                            {canceling === s.id && <Loader2 className="size-3.5 animate-spin" />}
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {failed.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {failed.length} recent attempt{failed.length === 1 ? '' : 's'} did not go through on
                Stripe and billed nothing (latest: {failed[0].error ?? 'no detail'}).
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
