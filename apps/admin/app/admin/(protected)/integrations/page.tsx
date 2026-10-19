'use client';

/**
 * Integrations — the operator's Integrations board, as northwind draws it
 * (apps/portal/src/app/(dashboard)/integrations/integrations-board.tsx), with
 * the super admin's controls inside each card's dialog instead of a connect
 * flow (Oct 17 2026, Ghulam: "exactly like the UI on northwind … I don't want
 * to connect anything here, but all the controls").
 *
 * Each dialog holds what used to be one table row
 * (docs/integration-billing/build-spec.md, D4, D12):
 *   Add-on           — a crown and a Subscribe button in the operator's dialog
 *   Monthly price    — USD, added to the operator's Drive247 bill every month
 *   First month free — the first bill it appears on credits it back in full
 *   Beta             — a "Beta" flag beside the name
 *   Not available    — the card is dimmed and its panel is read-only
 *   Hidden           — the card is not shown at all
 * and a preview of what the operator sees, plus who pays for it (with Cancel).
 *
 * Platform-wide, not per-tenant — but only the integration-billing tenant
 * (northwind) reads it today. Saving upserts that one integration's row of
 * `integration_catalog_v2` (RLS: super admins only). Stripe is not touched: the
 * Price is created the first time an operator subscribes, so a new price only
 * affects new subscribers.
 */

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { Crown, Globe, IdCard, Loader2 } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePageSearch } from '@/components/admin/page-search-slot';
import {
  ADMIN_INTEGRATIONS,
  DEFAULT_PREMIUM_KEYS,
  PREVIEW_ONLY_KEYS,
  catalogRowsToSave,
  centsToDollarsInput,
  parseDollarsToCents,
  premiumPriceProblem,
} from '@/lib/integration-pricing';
import { confirmDialog } from '@/components/ui/confirm';

/* ── the board's cards, as northwind lists them ─────────────────────────── */

// logo.dev — publishable key (safe for client-side img.logo.dev), as the portal uses.
const LOGO_TOKEN = 'pk_EmodMTbiSPiHDa2fIPUo3w';
const logoSrc = (domain: string) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}&size=128&format=png`;

/** Add-ons LIVE on the operator's board though still preview-only for billing (portal LIVE_ADD_ONS). */
const LIVE_ADD_ONS: ReadonlySet<string> = new Set(['turo_sync']);

type BoardCard = {
  key: string;
  description: string;
  domain?: string;
  localLogo?: boolean;
  fallbackGlobe?: boolean;
  Icon?: ComponentType<{ size?: number; color?: string }>;
  iconColor?: string;
  wordmark?: string;
};

const CARDS: Record<string, BoardCard> = {
  turo_sync: { key: 'turo_sync', description: 'Pull your Turo trips in and stop double-booking.', domain: 'turo.com', wordmark: 'Turo' },
  stripe_connect: { key: 'stripe_connect', description: 'Accept booking payments, deposits & payouts.', domain: 'stripe.com' },
  square: { key: 'square', description: 'Take booking payments through your Square account.', domain: 'squareup.com' },
  bonzah: { key: 'bonzah', description: 'Per-rental insurance coverage at checkout.', localLogo: true },
  inshur: { key: 'inshur', description: 'Fleet insurance for your vehicles between rentals.', domain: 'inshur.com' },
  boldsign: { key: 'boldsign', description: 'E-signature for rental agreements.', domain: 'boldsign.com' },
  checkmydriver: { key: 'checkmydriver', description: "Verify driver's licenses & identity.", Icon: IdCard, iconColor: '#0EA5E9' },
  twilio_messages: { key: 'twilio_messages', description: 'SMS notifications, reminders & 2-way chat.', domain: 'twilio.com' },
  twilio_calling: { key: 'twilio_calling', description: 'Call forwarding, voicemail & recordings.', domain: 'twilio.com' },
  tesla: { key: 'tesla', description: 'Supercharging & vehicle data via the Fleet API.', domain: 'tesla.com' },
  custom_domain: { key: 'custom_domain', description: 'Use your own domain for booking & portal.', fallbackGlobe: true },
  xero: { key: 'xero', description: 'Sync invoices & payments to Xero.', domain: 'xero.com' },
  zoho: { key: 'zoho', description: 'Sync books & CRM with Zoho.', domain: 'zoho.com' },
};

function IntegrationLogo({ name, card, size }: { name: string; card: BoardCard; size: number }) {
  if (card.Icon) return <card.Icon size={size} color={card.iconColor} />;
  if (card.localLogo)
    return (
      <>
        <img src="/bonzah-logo.svg" alt={name} className="w-auto dark:hidden" style={{ height: size * 0.62 }} />
        <img src="/bonzah-logo-dark.svg" alt={name} className="hidden w-auto dark:block" style={{ height: size * 0.62 }} />
      </>
    );
  if (card.fallbackGlobe) return <Globe size={size} className="text-muted-foreground" />;
  return <img src={logoSrc(card.domain!)} alt={name} className="object-contain" style={{ height: size, width: size }} />;
}

/* ── data ───────────────────────────────────────────────────────────────── */

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

type Notice = { tone: 'error' | 'setup'; text: string } | null;

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

const isPaying = (s: SubscriberRow) => s.status === 'pending' || s.status === 'active';

/* ── the card's tag, as the portal's CardTag ────────────────────────────── */

type TagKind = 'soon' | 'addon' | 'unavailable' | 'hidden';
const TAG: Record<TagKind, { text: string; className: string }> = {
  soon: { text: 'Soon', className: 'border-primary/30 bg-primary/10 text-primary' },
  addon: { text: 'Add-on', className: 'border-border bg-muted text-foreground/75' },
  unavailable: { text: 'Unavailable', className: 'border-border/70 bg-muted/60 text-muted-foreground' },
  hidden: { text: 'Hidden', className: 'border-border/70 bg-background text-muted-foreground' },
};

function CardTag({ kind }: { kind: TagKind }) {
  const tag = TAG[kind];
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wide', tag.className)}>
      {tag.text}
    </span>
  );
}

function tagFor(r: CatalogDraft): TagKind | null {
  if (r.is_hidden) return 'hidden';
  if (r.is_unavailable) return 'unavailable';
  if (PREVIEW_ONLY_KEYS.includes(r.key) && !LIVE_ADD_ONS.has(r.key)) return 'soon';
  if (r.is_premium) return 'addon';
  return null;
}

/** The Beta flag: plain accent capitals beside the name (the portal's BetaPill). */
function Beta() {
  return <span className="shrink-0 font-semibold uppercase tracking-wide text-primary">Beta</span>;
}

/** What the card costs, under its description — the one thing the admin board adds. */
function priceLine(r: CatalogDraft): string {
  if (!r.is_premium) return 'Free';
  const cents = r.price.trim() ? parseDollarsToCents(r.price) : null;
  if (!cents) return 'Price to be announced';
  return `${money(cents)}/month${r.first_month_free ? ' · first month free' : ''}`;
}

/** The dialog's soft wash (the portal's SCREEN_LED_WASH). */
const DIALOG_WASH = [
  'radial-gradient(40rem 26rem at 105% -10%, hsl(var(--v2-wash, var(--primary)) / 0.30), transparent 62%)',
  'radial-gradient(34rem 24rem at -8% -6%, hsl(var(--chart-3) / 0.24), transparent 58%)',
  'radial-gradient(36rem 22rem at 50% 118%, hsl(var(--v2-wash, var(--primary)) / 0.20), transparent 62%)',
  'linear-gradient(180deg, hsl(var(--v2-wash, var(--primary)) / 0.08) 0%, transparent 45%)',
].join(', ');

/* ── page ───────────────────────────────────────────────────────────────── */

export default function IntegrationsAdminPage() {
  const [rows, setRows] = useState<CatalogDraft[]>(ADMIN_INTEGRATIONS.map(blankDraft));
  const [subscribers, setSubscribers] = useState<SubscriberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  // A read that failed for any reason but a missing table: the cards show
  // defaults, not what is saved, and the subscriber guard has nothing to check
  // against — so saving is locked until a reload succeeds.
  const [loadFailed, setLoadFailed] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');

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
      setNotice(
        isMissingTable(catalogRes.error)
          ? {
              tone: 'setup',
              text: 'The integration_catalog_v2 table has not been created yet. Apply ops/integration_billing_v2.sql, then reload. Until then operators see the defaults: every integration free and visible, except Inshur, Turo Sync and CheckMyDriver, which show as coming soon with no price.',
            }
          : { tone: 'error', text: `Could not load the integrations: ${catalogRes.error.message}. Nothing can be saved until they load; reload the page.` },
      );
      if (!isMissingTable(catalogRes.error)) setLoadFailed(true);
      setSubscribers([]);
      setLoading(false);
      return;
    }

    const byKey = new Map((catalogRes.data ?? []).map((r: Record<string, unknown>) => [String(r.integration_key), r]));
    setRows(
      ADMIN_INTEGRATIONS.map((i) => {
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
      }),
    );
    setSubscribers(subsRes.error ? [] : ((subsRes.data ?? []) as unknown as SubscriberRow[]));
    // Without the subscriber list, a save could make a paid integration free
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

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          !needle ||
          r.name.toLowerCase().includes(needle) ||
          r.category.toLowerCase().includes(needle) ||
          (CARDS[r.key]?.description ?? '').toLowerCase().includes(needle),
      ),
    [rows, needle],
  );
  usePageSearch({ placeholder: 'Search integrations…', value: query, onChange: setQuery, scopeLabel: 'Integrations' });

  /** Saves one integration. Returns true when it reached the database. */
  const saveOne = async (draft: CatalogDraft): Promise<boolean> => {
    if (loadFailed) {
      toast.error('The saved integrations did not load, so saving now would overwrite them. Reload the page first.');
      return false;
    }
    const problem = draft.is_premium ? premiumPriceProblem(draft.price) : null;
    if (problem) {
      toast.error(problem);
      return false;
    }
    // Making a paid integration free or hidden does not stop Stripe billing the
    // operators already subscribed to it, so it is refused until they are canceled.
    if (!draft.is_premium || draft.is_hidden) {
      const paying = subscribers.filter((s) => s.integration_key === draft.key && isPaying(s)).length;
      if (paying > 0) {
        toast.error(
          `${draft.name} has ${paying} subscriber${paying === 1 ? '' : 's'}. Cancel ${paying === 1 ? 'it' : 'them'} first; until then Stripe keeps billing ${paying === 1 ? 'it' : 'them'}.`,
          { duration: 9000 },
        );
        return false;
      }
    }
    const { data: auth } = await supabase.auth.getUser();
    const { data: me } = auth?.user
      ? await supabase.from('app_users').select('id').eq('auth_user_id', auth.user.id).maybeSingle()
      : { data: null };
    const payload = catalogRowsToSave([draft], {
      updatedBy: (me as { id?: string } | null)?.id ?? null,
      now: new Date().toISOString(),
    });
    const { error } = await supabase.from('integration_catalog_v2').upsert(payload, { onConflict: 'integration_key' });
    if (error) {
      toast.error(
        isMissingTable(error)
          ? 'The integration_catalog_v2 table has not been created yet. Apply ops/integration_billing_v2.sql, then save again.'
          : `Could not save: ${error.message}`,
      );
      return false;
    }
    setRows((prev) => prev.map((r) => (r.key === draft.key ? { ...draft } : r)));
    toast.success(`${draft.name} saved. Operators see it the next time they open Integrations.`);
    return true;
  };

  const cancelSubscription = async (row: SubscriberRow) => {
    const name = ADMIN_INTEGRATIONS.find((i) => i.key === row.integration_key)?.name ?? row.integration_key;
    const company = row.tenants?.company_name || row.tenants?.slug || 'this company';
    const ok = await confirmDialog({
      title: `Remove ${name} from ${company}'s bill?`,
      description: `It comes off their next bill and every bill after. Nothing is refunded for the current month, and their ${name} panel becomes read-only.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const { data, error } = await supabase.functions.invoke('integration-billing', {
      body: { action: 'cancel', tenantId: row.tenant_id, integrationKey: row.integration_key },
    });
    if (error) {
      let message = error.message;
      try {
        const body = await (error as { context?: Response }).context?.clone().json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        /* not JSON */
      }
      toast.error(`Could not cancel: ${message}`);
      return;
    }
    if (data?.ok === false) {
      toast.error(`Could not cancel: ${data.error ?? 'unknown error'}`);
      return;
    }
    toast.success(`${name} was removed from ${company}'s bill.`);
    void load();
  };

  const open = rows.find((r) => r.key === openKey) ?? null;
  const live = subscribers.filter(isPaying);

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6 pb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          The operator&rsquo;s Integrations board. Open a card to set its price and how it shows. Northwind only for now.
        </p>
      </div>

      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={cn('rounded-lg px-3 py-2 text-sm', notice.tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}
        >
          {notice.text}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-4xl border border-border bg-card/40" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No integration matches &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((r) => {
            const card = CARDS[r.key];
            if (!card) return null;
            const tag = tagFor(r);
            const paying = live.filter((s) => s.integration_key === r.key).length;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => setOpenKey(r.key)}
                className={cn(
                  'group relative isolate flex flex-col items-center gap-2 rounded-4xl border border-border bg-transparent px-6 py-6 text-center transition-colors duration-200 ease-in hover:border-primary/30 hover:ease-out focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
                  (r.is_unavailable || r.is_hidden) && 'opacity-60',
                )}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] bg-gradient-to-br from-primary/15 via-primary/5 to-transparent opacity-0 transition-opacity duration-200 ease-in group-hover:opacity-100 group-hover:ease-out motion-reduce:transition-none"
                />
                <div className="absolute left-4 top-3.5 z-10 flex items-center gap-1.5">{tag && <CardTag kind={tag} />}</div>
                {paying > 0 && (
                  <span
                    className="absolute right-4 top-3.5 z-10 inline-flex h-6 items-center rounded-full border border-success/30 bg-success/10 px-2.5 text-[11px] font-semibold text-success"
                    title={`${paying} operator${paying === 1 ? '' : 's'} paying for it`}
                  >
                    {paying} paying
                  </span>
                )}
                <div className="flex h-20 items-center justify-center px-6">
                  <IntegrationLogo name={r.name} card={card} size={72} />
                </div>
                <div className="flex-1 space-y-1 pt-1">
                  {!card.localLogo ? (
                    <p className="flex items-center justify-center gap-1.5 text-base font-semibold leading-none tracking-tight text-foreground">
                      {r.name}
                      {r.is_beta && <Beta />}
                    </p>
                  ) : (
                    r.is_beta && (
                      <div className="flex justify-center text-base">
                        <Beta />
                      </div>
                    )
                  )}
                  <p className="text-sm text-muted-foreground">{card.description}</p>
                </div>
                <p className={cn('text-xs font-medium', r.is_premium ? 'text-foreground/80' : 'text-muted-foreground')}>{priceLine(r)}</p>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenKey(null)}>
        <DialogContent
          showCloseButton={false}
          style={{ backgroundImage: DIALOG_WASH }}
          className="no-scrollbar max-h-[94vh] overflow-y-auto overflow-x-hidden p-7 sm:max-w-4xl [&>*]:min-w-0"
        >
          {open && (
            <IntegrationControls
              key={open.key}
              saved={open}
              subscribers={live.filter((s) => s.integration_key === open.key)}
              locked={loadFailed}
              onSave={saveOne}
              onCancelSubscription={cancelSubscription}
              onClose={() => setOpenKey(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── one integration's dialog ───────────────────────────────────────────── */

function IntegrationControls({
  saved,
  subscribers,
  locked,
  onSave,
  onCancelSubscription,
  onClose,
}: {
  saved: CatalogDraft;
  subscribers: SubscriberRow[];
  locked: boolean;
  onSave: (draft: CatalogDraft) => Promise<boolean>;
  onCancelSubscription: (row: SubscriberRow) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CatalogDraft>(saved);
  const [saving, setSaving] = useState(false);
  const card = CARDS[saved.key];
  const set = (patch: Partial<CatalogDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const problem = draft.is_premium ? premiumPriceProblem(draft.price) : null;
  const previewOnly = PREVIEW_ONLY_KEYS.includes(draft.key);
  const tag = tagFor(draft);

  const save = async () => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) onClose();
  };

  const pill = 'inline-flex h-6 min-w-[4.5rem] items-center justify-center rounded-full border px-2.5 text-[11px] font-medium leading-none';
  const status =
    tag === 'hidden' ? 'Hidden' : tag === 'unavailable' ? 'Not available' : tag === 'soon' ? 'Soon' : draft.is_premium ? null : 'Free';

  return (
    <>
      {/* Northwind's screen-led header: logo left, the pills right. */}
      <DialogHeader className="space-y-0">
        <div className="-mt-1 flex h-12 items-center gap-3">
          {card?.wordmark ? (
            <span className="text-2xl font-bold tracking-tight text-foreground">{card.wordmark}</span>
          ) : (
            card && <IntegrationLogo name={draft.name} card={card} size={44} />
          )}
          <div className="ml-auto flex items-center gap-2">
            {draft.is_premium && (
              <span className={cn(pill, 'border-sky-300/70 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300')}>Add-on</span>
            )}
            {draft.is_beta && <span className={cn(pill, 'border-primary/30 bg-primary/10 text-primary')}>Beta</span>}
            {status && (
              <span className={cn(pill, 'gap-1.5 border-border bg-background/60 text-foreground/75')}>
                <span className="size-1.5 rounded-full bg-muted-foreground/60" />
                {status}
              </span>
            )}
          </div>
        </div>
        <DialogTitle className="sr-only">{draft.name}</DialogTitle>
        <DialogDescription className="sr-only">{card?.description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-5 py-1">
        <div>
          <h3 className="text-xl font-medium leading-snug text-foreground">{draft.name}</h3>
          <p className="text-sm text-muted-foreground">
            {draft.category} · {card?.description}
          </p>
        </div>

        {/* Every control, as tiles across the dialog. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <ControlRow title="Add-on" hint="Paid monthly on their Drive247 bill. Read-only until they subscribe.">
            <Switch
              checked={draft.is_premium}
              onCheckedChange={(v) => set({ is_premium: v, ...(v ? {} : { first_month_free: false }) })}
              aria-label={`${draft.name} is an add-on`}
            />
          </ControlRow>
          <ControlRow
            title="Monthly price"
            hint={
              !draft.is_premium
                ? 'Free while it is not an add-on.'
                : problem ?? (draft.price.trim() === '' ? 'Blank shows "Price to be announced", not on sale.' : 'New subscribers only.')
            }
            warn={Boolean(problem)}
            muted={!draft.is_premium}
          >
            <div className="flex h-8 items-center rounded-full border border-input bg-background pl-3 focus-within:border-primary/50">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                inputMode="decimal"
                value={draft.price}
                disabled={!draft.is_premium}
                placeholder={draft.is_premium ? '20.00' : 'Free'}
                onChange={(e) => set({ price: e.target.value })}
                aria-label={`${draft.name} monthly price in dollars`}
                aria-invalid={Boolean(problem)}
                className="h-full w-20 bg-transparent px-1.5 text-sm tabular-nums outline-none disabled:cursor-not-allowed"
              />
            </div>
          </ControlRow>
          <ControlRow title="First month free" hint="Their first bill credits it back in full." muted={!draft.is_premium}>
            <Switch
              checked={draft.first_month_free}
              disabled={!draft.is_premium}
              onCheckedChange={(v) => set({ first_month_free: v })}
              aria-label="First month free"
            />
          </ControlRow>
          <ControlRow title="Beta" hint='A "Beta" flag beside the name.'>
            <Switch checked={draft.is_beta} onCheckedChange={(v) => set({ is_beta: v })} aria-label={`${draft.name} is in beta`} />
          </ControlRow>
          <ControlRow title="Not available" hint="Dimmed; its panel can be read but not used.">
            <Switch checked={draft.is_unavailable} onCheckedChange={(v) => set({ is_unavailable: v })} aria-label={`${draft.name} is not available`} />
          </ControlRow>
          <ControlRow title="Hidden" hint="Not shown to operators at all.">
            <Switch checked={draft.is_hidden} onCheckedChange={(v) => set({ is_hidden: v })} aria-label={`${draft.name} is hidden`} />
          </ControlRow>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Paying for it</p>
          {subscribers.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-border/80 px-4 py-3 text-sm text-muted-foreground">Nobody yet.</p>
          ) : (
            <ul className="divide-y divide-border/70 overflow-hidden rounded-3xl border border-border/80 bg-card/80">
              {subscribers.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{s.tenants?.company_name || s.tenants?.slug || s.tenant_id}</p>
                    <p className="text-xs text-muted-foreground">
                      {money(s.monthly_price_cents, s.currency)}/mo · <span className="capitalize">{s.status}</span> · since {day(s.subscribed_at)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 rounded-full text-xs text-destructive" onClick={() => onCancelSubscription(s)}>
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {previewOnly && (
          <p className="mr-auto text-xs text-muted-foreground">Preview only for billing: its price shows, but it can&rsquo;t be bought until it launches.</p>
        )}
        <Button variant="outline" className="h-10 rounded-2xl px-5" onClick={onClose} disabled={saving}>
          {dirty ? 'Discard' : 'Close'}
        </Button>
        <Button className="h-10 rounded-2xl px-6" onClick={() => void save()} disabled={!dirty || saving || locked || Boolean(problem)}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </>
  );
}

function ControlRow({
  title,
  hint,
  warn,
  muted,
  children,
}: {
  title: string;
  hint: string;
  warn?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-4 rounded-3xl border border-border/80 bg-card/80 px-4 py-3.5 transition-opacity', muted && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className={cn('text-xs leading-snug', warn ? 'text-destructive' : 'text-muted-foreground')}>{hint}</p>
      </div>
      {children}
    </div>
  );
}
