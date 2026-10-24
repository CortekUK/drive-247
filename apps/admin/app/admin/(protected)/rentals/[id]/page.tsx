'use client';

import { ToggleTile } from '@/components/admin/form-grid';
import { setTenantStatus, setTenantType, type TenantStatus, type TenantType } from '@/lib/tenant-actions';
import { DeleteTenantDialog } from '@/components/admin/delete-tenant-dialog';
import { EmptyState, NoMatchState } from '@/components/admin/empty-state';
import { PlansEmptyArt } from '@/components/admin/illustrations/scenes/admin-scenes';
import { DocumentsEmptyArt } from '@/components/admin/illustrations/scenes/documents';
import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRegisterSidebarSections } from '@/components/admin/sidebar-sections';
import { CardBrandIcon } from '@/components/ui/card-brand-icon';
import { TenantCreditsTab } from '@/components/admin/tenant-credits-tab';
import { TenantTimelineTab } from '@/components/admin/tenant-timeline-tab';
import { LinkPromoPicker } from '@/components/admin/promo-codes/link-promo-picker';
import { InvoiceStatusBadge, SubscriptionTrail } from '@/components/admin/subscription-trail';
import { HealthFeedbackPanel, OnboardingAnswers } from '@/components/admin/tenant-insights';
import { NotesPanel } from '@/components/admin/tenant-notes';
import { EditCompanyDialog } from '@/components/admin/edit-company-dialog';
import { ForceLogoutDialog } from '@/components/admin/force-logout-dialog';
import { bookingUrlFor, portalUrlFor } from '@/lib/sales-credentials';
import { useAdminSupport } from '@/lib/use-support-messaging';
import {
  ArrowLeft,
  Pencil,
  ExternalLink,
  Download,
  Building2,
  Link2,
  Settings2,
  Shield,
  CreditCard,
  FileText,
  X,
  Plus,
  Car,
  UserCheck,
  CircleDot,
  ShieldCheck,
  ArrowRightLeft,
  Coins,
  LayoutTemplate,
  KeyRound,
  Copy,
  Percent,
  Tag,
  Lock,
  Unlock,
  ChevronRight,
  LogOut,
  Trash2,
  LifeBuoy,
  History,
  LayoutDashboard,
  Globe,
  Signature,
  ArrowUpRight,
  LayoutGrid,
  ListChecks,
  Ban,
  CircleCheck,
} from 'lucide-react';
import { confirmDialog } from '@/components/ui/confirm';

interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  admin_name: string | null;
  status: string;
  contact_email: string;
  created_at: string;
  tenant_type: 'production' | 'test' | null;
  integration_bonzah: boolean;
  subscription_plan: string | null;
  stripe_subscription_customer_id: string | null;
  subscription_stripe_mode: 'test' | 'live';
  stripe_mode: 'test' | 'live';
  bonzah_mode: string | null;
  bonzah_sandbox_override: boolean | null;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
  stripe_account_status: string | null;
  bonzah_username: string | null;
  boldsign_mode: string;
  integration_tesla_fleet: boolean;
  subscription_gate_disabled: boolean | null;
  /** Serve this tenant's custom booking site instead of the legacy one. */
  booking_v2_enabled: boolean | null;
  /** Whether the platform allows this tenant to run the custom site at all. */
  custom_site_eligible: boolean | null;
}

/**
 * Where to actually OPEN a tenant's site from this admin.
 *
 * The production hostnames are not reachable from a dev machine, so in
 * development these buttons opened the LIVE site instead of the one running on
 * localhost. That made a local toggle look broken: you flipped a flag in one
 * database and then looked at a different deployment reading a different one.
 *
 * Only the click-through buttons use this. Anything
 * handed to a tenant deliberately keeps the real production hostnames.
 */
const IS_DEV = process.env.NODE_ENV === 'development';
const tenantBookingUrl = (slug: string) =>
  IS_DEV ? `http://${slug}.localhost:3000` : `https://${slug}.drive-247.com`;
const tenantPortalUrl = (slug: string) =>
  IS_DEV ? `http://${slug}.portal.localhost:3001` : `https://${slug}.portal.drive-247.com`;

/*
 * Integrations tiles, drawn to match the operator portal's board
 * (`apps/portal/src/app/(dashboard)/integrations/integrations-board.tsx`):
 * brand logos from the same logo.dev CDN with the same publishable key, the
 * same centred card, and one status pill.
 */
const LOGO_DEV_TOKEN = 'pk_EmodMTbiSPiHDa2fIPUo3w';
const brandLogo = (domain: string) =>
  `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&size=128&format=png`;

function IntegrationLogo({ src, alt, size = 64 }: { src: string; alt: string; size?: number }) {
  return <img src={src} alt={alt} className="object-contain" style={{ height: size, width: size }} />;
}

type StatusTone = 'success' | 'warning' | 'info' | 'neutral';

function IntegrationStatus({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tone === 'success' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        tone === 'warning' && 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        tone === 'info' && 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
        tone === 'neutral' && 'border-border bg-transparent text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          tone === 'success' && 'bg-emerald-500',
          tone === 'warning' && 'bg-amber-500',
          tone === 'info' && 'bg-sky-500',
          tone === 'neutral' && 'bg-muted-foreground/50',
        )}
      />
      {label}
    </span>
  );
}

/*
 * Integration dialog body pieces — the admin twins of the portal's panel kit
 * (`apps/portal/src/app/(dashboard)/integrations/_panels/_kit.tsx`).
 *
 * Label left, value right, one row per fact. The dialog used to reuse the old
 * cards' `grid-cols-4` rows, where a long value (a Bonzah login email) ran
 * straight over the column beside it. A row gives every value the full width
 * that is left after its label, and wraps it rather than overlapping.
 */
function PanelCard({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border/60 rounded-xl border bg-muted/20 px-4">{children}</div>;
}

function PanelRow({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className={cn('min-w-0 text-right text-sm text-foreground', mono && 'break-all font-mono text-[13px]')}>
        {children}
      </div>
    </div>
  );
}

function PanelNote({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3 text-xs leading-relaxed',
        tone === 'info' && 'border-border bg-muted/30 text-muted-foreground',
        tone === 'warn' && 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
      )}
    >
      {children}
    </div>
  );
}

/** A test/live badge with its Switch button, as every mode row uses. */
function ModeControl({ mode, disabled, onSwitch }: { mode: string; disabled: boolean; onSwitch: () => void }) {
  return (
    <span className="inline-flex items-center gap-2">
      <IntegrationStatus tone={mode === 'live' ? 'success' : 'warning'} label={mode === 'live' ? 'Live' : 'Test'} />
      <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" disabled={disabled} onClick={onSwitch}>
        <ArrowRightLeft className="h-3 w-3" />
        Switch
      </Button>
    </span>
  );
}

const NO_SECTIONS: { id: string; label: string }[] = [];
const noSection = () => {};

/** How many integration tiles fit the page row before See all. */
const INTEGRATIONS_IN_ROW = 5;

function IntegrationTile({
  logo,
  name,
  description,
  status,
  onOpen,
}: {
  logo: ReactNode;
  /** Omitted when the logo is a wordmark that already says it (Bonzah). */
  name?: string;
  description: string;
  status: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-w-0 flex-col items-center gap-1.5 rounded-2xl bg-card px-2 py-3 text-center shadow-sm ring-1 ring-foreground/10 transition-all duration-200 hover:ring-primary/30 hover:bg-gradient-to-br hover:from-primary/15 hover:via-primary/5 hover:to-transparent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {/* Compact, so the whole record fits one screen and all five sit in
          one row: a small logo, the name, the status; the description is
          the tooltip. */}
      <div className="flex h-7 items-center justify-center [&_img]:max-h-7 [&_img]:max-w-20 [&_svg]:size-7">{logo}</div>
      {name && <p className="max-w-full truncate text-[13px] font-semibold text-foreground">{name}</p>}
      {/* Pinned to the bottom, so every status sits on one line even
          when a tile has no name under its logo (Bonzah). */}
      <div className="mt-auto max-w-full pt-1.5">{status}</div>
    </button>
  );
}

interface TenantSubscription {
  id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  plan_id: string | null;
  status: string;
  plan_name: string;
  amount: number;
  currency: string;
  interval: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  created_at: string;
}

interface TenantInvoice {
  id: string;
  stripe_invoice_id: string;
  stripe_invoice_pdf: string | null;
  stripe_hosted_invoice_url: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  paid_at: string | null;
  invoice_number: string | null;
  created_at: string;
}

interface SubscriptionPlan {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  features: string[];
  amount: number;
  currency: string;
  interval: string;
  stripe_price_id: string | null;
  is_active: boolean;
  sort_order: number;
  trial_days: number;
  billing_model: string;
  created_at: string;
  active_subscriptions: number;
}

interface PlanFormData {
  name: string;
  description: string;
  amount: string;
  currency: string;
  interval: string;
  trialDays: string;
  billingModel: string;
  features: string[];
}

interface TenantStats {
  totalVehicles: number;
  activeRentals: number;
  totalCustomers: number;
  staffUsers: number;
  completedRentals: number;
}


interface PolicyAcceptance {
  id: string;
  app_user_id: string;
  policy_type: string;
  version: string;
  ip_address: string | null;
  user_agent: string | null;
  accepted_at: string;
  user_name?: string;
  user_email?: string;
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// supabase-js throws FunctionsHttpError on a non-2xx edge response whose `.message`
// is generic; the real server message lives in `.context` (the Response). Best-effort.
async function fnErrorMessage(e: any, fallback: string): Promise<string> {
  try {
    const body = await e?.context?.json?.();
    if (body?.error) return body.error;
  } catch {
    // ignore — fall through to the generic message
  }
  return e?.message || fallback;
}

export default function TenantDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  // Support tickets still open for this company, behind the header button.
  const [openTickets, setOpenTickets] = useState<{ id: string; reference: string; summary: string | null; status: string; created_at: string }[]>([]);
  // The right column's open tab.
  const [railTab, setRailTab] = useState<'overview' | 'tickets' | 'onboarding' | 'consent' | 'timeline'>('overview');

  // Delete state

  // Force logout state
  const [showForceLogoutConfirm, setShowForceLogoutConfirm] = useState(false);

  /* Locked-out operator recovery. The portal's own reset emails the tenant a
     link, and admin-reset-password authorises the caller as an admin WITHIN the
     tenant — so neither reaches a head admin who is locked out, or one whose
     address cannot receive mail at all (Drive Hustle's domain returns NXDOMAIN;
     Heirs Rental sat locked out for six weeks). This is the super-admin route
     back in, for any company. */
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [pwUsers, setPwUsers] = useState<Array<{ id: string; email: string; name: string | null; role: string; isActive: boolean; canReset: boolean }>>([]);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwResettingId, setPwResettingId] = useState<string | null>(null);
  /* Shown ONCE, in the dialog, and never stored. */
  const [pwResult, setPwResult] = useState<{ email: string; password: string } | null>(null);
  const [forceLogoutLoading, setForceLogoutLoading] = useState(false);

  // Subscription state
  const [subscription, setSubscription] = useState<TenantSubscription | null>(null);
  const [invoices, setInvoices] = useState<TenantInvoice[]>([]);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  /** Non-null when the subscription read FAILED — never render that as "none". */
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  // Subscription-link state. The plaintext token exists only in the response to
  // Generate — it is stored as a hash, so once this is cleared it is gone and
  // the only way back is Regenerate. That is deliberate.
  const [subLink, setSubLink] = useState<any | null>(null);
  const [subLinkUrl, setSubLinkUrl] = useState<string | null>(null);
  const [subLinkBusy, setSubLinkBusy] = useState(false);
  const [subLinkTick, setSubLinkTick] = useState(0);
  const [subLinkEmail, setSubLinkEmail] = useState('');
  const [subLinkSending, setSubLinkSending] = useState(false);

  // Plans state
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [planSaving, setPlanSaving] = useState(false);
  const [planForm, setPlanForm] = useState<PlanFormData>({
    name: '',
    description: '',
    amount: '',
    currency: 'usd',
    interval: 'month',
    trialDays: '',
    billingModel: 'trial',
    features: [],
  });
  const [newFeature, setNewFeature] = useState('');

  // Stats, charts, staff state
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [policyAcceptances, setPolicyAcceptances] = useState<PolicyAcceptance[]>([]);
  const [policyLoading, setPolicyLoading] = useState(true);

  // Integration mode state
  const [modeUpdating, setModeUpdating] = useState(false);
  const [gateUpdating, setGateUpdating] = useState(false);
  const [bookingV2Updating, setBookingV2Updating] = useState(false);
  const [showModeConfirm, setShowModeConfirm] = useState(false);
  const [pendingModeChange, setPendingModeChange] = useState<{ type: 'stripe' | 'bonzah' | 'boldsign' | 'subscription_stripe'; newMode: 'test' | 'live' } | null>(null);
  const [showSubscriptionDetail, setShowSubscriptionDetail] = useState(false);
  const [showCreditsDetail, setShowCreditsDetail] = useState(false);
  // Which Integrations tile has its detail dialog open.
  const [openIntegration, setOpenIntegration] = useState<'booking-site' | 'stripe' | 'bonzah' | 'tesla' | 'boldsign' | null>(null);
  // One-time subscription discount (Stripe coupon, duration:once → next invoice only)
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [discountBusy, setDiscountBusy] = useState(false);
  const [currentDiscount, setCurrentDiscount] = useState<{ percentOff: number | null; amountOff: number | null; currency: string | null } | null>(null);

  // Reprice an ONGOING subscription (a renegotiated rate), as opposed to the
  // one-time discount above which only touches the next invoice.
  const [showRepriceModal, setShowRepriceModal] = useState(false);
  const [repriceAmount, setRepriceAmount] = useState('');
  const [repricePlanId, setRepricePlanId] = useState<string | null>(null);
  const [repriceBusy, setRepriceBusy] = useState(false);

  useEffect(() => {
    if (params.id) {
      loadTenant(params.id as string);
    }
  }, [params.id]);

  // LIVE SUBSCRIPTION STATE — this page previously loaded once at mount and
  // never refetched, so an operator sitting on a tenant while chasing a payment
  // watched a frozen screen and had to reload to learn anything changed.
  //
  // Mirrors the list page: realtime push on tenant_subscriptions (already in the
  // supabase_realtime publication), a poll as backstop because a socket can die
  // silently, and a refresh when the tab regains focus. Invoice-only changes
  // reach us too, because a DB trigger now touches the subscription row whenever
  // an invoice's status or attempt_count changes.
  //
  // Only the subscription block is refreshed — deliberately not loadTenant(),
  // which would clobber the edit form the operator may be typing into.
  useEffect(() => {
    const tenantId = params.id as string | undefined;
    if (!tenantId) return;

    // silent: background refreshes must not re-trigger the loading skeleton.
    const refresh = () => {
      void loadSubscription(tenantId, true);
      void loadSubscriptionLink(tenantId);
    };

    const channel = supabase
      .channel(`admin-tenant-subscription-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tenant_subscriptions',
          filter: `tenant_id=eq.${tenantId}`,
        },
        refresh,
      )
      .subscribe();

    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 20_000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
    // loadSubscription is a stable module-scope closure over setState setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const loadTenant = async (id: string) => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      setTenant(data);

      loadSubscription(id);
      loadSubscriptionLink(id);
      loadPlans(id);
      loadStats(id);
      loadPolicyAcceptances(id);
    } catch (error) {
      console.error('Error loading tenant:', error);
      toast.error('Failed to load tenant details');
    } finally {
      setLoading(false);
    }
  };

  /**
   * @param silent Background refresh (the 20s poll, Realtime, window focus).
   *
   * A silent pass must NOT touch subscriptionLoading. Flipping it on every tick
   * re-mounted the Current Subscription block into its skeleton three times a
   * minute, so the panel visibly flashed forever and any expanded detail
   * collapsed under the operator. Same discipline as `subsLoaded` on the list
   * page.
   */
  // Recomputed against a 1s tick, not just on refetch: a 20s poll cannot see the
  // moment a link crosses its own expiry, and "Link live · 0m" is a lie.
  useEffect(() => {
    if (!subLink || subLink.status !== 'pending') return;
    const t = setInterval(() => setSubLinkTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [subLink?.id, subLink?.status]);

  // Whether the SUBSCRIPTION is live, which is a different question from
  // whether the link settled. The panel must not answer one with the other.
  const subIsLive = !!subscription && ['active', 'trialing', 'past_due'].includes(subscription.status);
  const subLinkExpiresMs = subLink?.expires_at ? new Date(subLink.expires_at).getTime() : 0;
  const subLinkLive = subLink?.status === 'pending' && subLinkExpiresMs > Date.now();
  const subLinkRemaining = (() => {
    void subLinkTick; // re-read the clock on every tick
    const ms = subLinkExpiresMs - Date.now();
    if (ms <= 0) return 'expired';
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  const loadSubscriptionLink = async (tenantId: string) => {
    try {
      const { data } = await supabase
        .from('subscription_links')
        .select('id, status, kind, expires_at, mint_count, payment_attempted_at, paid_at, sent_at, amount_snapshot, currency_snapshot, plan_name_snapshot, link_mode')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(1);
      setSubLink((data ?? [])[0] ?? null);
    } catch {
      // A link read failing must never blank the subscription card.
    }
  };

  const handleGenerateLink = async () => {
    const tenantId = params.id as string;
    setSubLinkBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-subscription-link', {
        body: { tenantId },
      });
      if (error) {
        // The edge function puts the actionable reason in the BODY, not the
        // status text — surface that rather than "non-2xx".
        let msg = error.message || 'Could not generate the link';
        try {
          const body = await (error as any)?.context?.json?.();
          if (body?.error) msg = body.error;
        } catch { /* keep the generic message */ }
        toast.error(msg);
        return;
      }
      if (data?.raced) {
        toast.info('Another admin just generated a link — showing theirs.');
      } else if (data?.url) {
        setSubLinkUrl(data.url);
        await navigator.clipboard?.writeText(data.url).catch(() => {});
        toast.success('Link generated and copied — paste it to the client.');
      }
      await loadSubscriptionLink(tenantId);
    } catch (e: any) {
      toast.error(e?.message || 'Could not generate the link');
    } finally {
      setSubLinkBusy(false);
    }
  };

  const handleSendLinkEmail = async () => {
    const to = subLinkEmail.trim();
    if (!to) return;
    setSubLinkSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-subscription-link-email', {
        body: { tenantId: params.id as string, to },
      });
      if (error) {
        let msg = error.message || 'Could not send the link';
        let recovered: string | null = null;
        try {
          const b = await (error as any)?.context?.json?.();
          if (b?.error) msg = b.error;
          // Delivery can fail AFTER the link was created. supabase-js surfaces
          // any non-2xx as `error`, so without reading the body here George was
          // left looking at the PREVIOUS link — which this send had already
          // superseded — and would paste a dead address.
          if (b?.url) recovered = b.url as string;
        } catch { /* keep the generic message */ }
        if (recovered) {
          setSubLinkUrl(recovered);
          await loadSubscriptionLink(params.id as string);
        }
        toast.error(msg);
        return;
      }
      // Sending mints a FRESH link, so the address on screen is now stale —
      // show the new one rather than leaving George with a dead URL to paste.
      if (data?.url) setSubLinkUrl(data.url);
      setSubLinkEmail('');
      toast.success(`Link sent to ${to}`);
      await loadSubscriptionLink(params.id as string);
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the link');
    } finally {
      setSubLinkSending(false);
    }
  };

  const handleRevokeLink = async () => {
    if (!subLink?.id) return;
    setSubLinkBusy(true);
    try {
      // Through the edge function, NOT a direct UPDATE: revoking has to expire
      // the Stripe session too, and a browser cannot call Stripe. A bare status
      // write left the prospect's open checkout tab payable while telling George
      // the opposite.
      const { data, error } = await supabase.functions.invoke('revoke-subscription-link', {
        body: { linkId: subLink.id },
      });
      if (error) {
        let msg = error.message || 'Could not revoke the link';
        try {
          const b = await (error as any)?.context?.json?.();
          if (b?.error) msg = b.error;
        } catch { /* keep the generic message */ }
        toast.error(msg);
        return;
      }
      setSubLinkUrl(null);
      toast.success(
        data?.sessionExpired
          ? 'Link revoked — the open checkout was cancelled too.'
          : 'Link revoked — it can no longer be paid.',
      );
      await loadSubscriptionLink(params.id as string);
    } catch (e: any) {
      toast.error(e?.message || 'Could not revoke the link');
    } finally {
      setSubLinkBusy(false);
    }
  };

  // Tickets are only readable through the support service (RLS keeps the
  // table closed), so this asks it, filtered to this company.
  const { call: supportCall } = useAdminSupport();
  const loadOpenTickets = async (tenantId: string) => {
    try {
      const data = await supportCall('list', { statuses: ['open', 'in_progress'], tenants: [tenantId] });
      setOpenTickets(data?.tickets ?? []);
    } catch {
      setOpenTickets([]);
    }
  };
  // Re-asked when the support client changes (it is keyed to the signed-in
  // admin, who may load after the page).
  useEffect(() => {
    if (params.id) void loadOpenTickets(String(params.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportCall, params.id]);

  const loadSubscription = async (tenantId: string, silent = false) => {
    if (!silent) setSubscriptionLoading(true);
    try {
      // Do NOT filter to live statuses here.
      //
      // This used to be .in('status', ['active','trialing','past_due']), which
      // made a canceled / unpaid / paused / incomplete_expired subscription
      // render as "No active subscription" — identical to a tenant who never
      // subscribed at all. That is precisely the churned-and-declined cohort an
      // operator drills into this page to investigate, and the only way to tell
      // the two apart was to open Stripe.
      //
      // Prefer a live row when there is one, else fall back to the most recent,
      // mirroring selectSubscription() on the list page so the two screens
      // cannot disagree about which subscription a tenant "has".
      const { data: subRows, error: subErr } = await supabase
        .from('tenant_subscriptions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false });

      // A failed read is NOT "no subscription". Discarding the error rendered a
      // permissions problem or a network blip as the confident, and completely
      // wrong, answer "No active subscription" — the same thing shown for a
      // tenant who genuinely never subscribed. An operator would then act on it.
      if (subErr) throw subErr;
      setSubscriptionError(null);

      const rows = (subRows as any[] | null) ?? [];
      const LIVE = ['active', 'trialing', 'past_due'];
      const subData = rows.find((r) => LIVE.includes(r.status)) ?? rows[0] ?? null;

      setSubscription(subData);

      // Load any pending one-time discount live from Stripe (source of truth).
      if (subData) {
        try {
          const { data: dd } = await supabase.functions.invoke('apply-subscription-discount-v2', {
            body: { tenantId, action: 'get' },
          });
          setCurrentDiscount(dd?.discount ?? null);
        } catch {
          setCurrentDiscount(null);
        }
      } else {
        setCurrentDiscount(null);
      }

      const { data: invoiceData, error: invErr } = await supabase
        .from('tenant_subscription_invoices')
        .select('*')
        .eq('tenant_id', tenantId)
        // Stripe's invoice date, not our row-insert time — created_at is stamped
        // whenever the reconciler backfills, which reordered history and gave
        // invoices dates that never happened.
        .order('invoice_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(20);

      if (invErr) throw invErr;
      setInvoices(invoiceData || []);
    } catch (error: any) {
      console.error('Error loading subscription:', error);
      // Surface it. Silence here is what turned a failed read into "no
      // subscription" — see the note above.
      setSubscriptionError(error?.message || 'Could not load subscription data');
    } finally {
      if (!silent) setSubscriptionLoading(false);
    }
  };

  const handleApplyDiscount = async () => {
    const num = Number(discountValue);
    if (!Number.isFinite(num) || num <= 0) {
      toast.error('Enter a positive discount value');
      return;
    }
    if (discountType === 'percent' && num > 100) {
      toast.error('Percentage cannot exceed 100');
      return;
    }
    setDiscountBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('apply-subscription-discount-v2', {
        body: { tenantId: params.id, action: 'apply', discountType, value: num },
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Failed to apply discount');
      setCurrentDiscount(data?.discount ?? null);
      toast.success('Discount applied to the next invoice');
      setShowDiscountModal(false);
      setDiscountValue('');
    } catch (e: any) {
      toast.error(await fnErrorMessage(e, 'Failed to apply discount'));
    } finally {
      setDiscountBusy(false);
    }
  };

  const handleRemoveDiscount = async () => {
    setDiscountBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('apply-subscription-discount-v2', {
        body: { tenantId: params.id, action: 'remove' },
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Failed to remove discount');
      setCurrentDiscount(null);
      toast.success('Discount removed');
    } catch (e: any) {
      toast.error(await fnErrorMessage(e, 'Failed to remove discount'));
    } finally {
      setDiscountBusy(false);
    }
  };

  /** Open the reprice modal primed with the plan the subscription is actually on. */
  const openRepriceModal = () => {
    const current =
      plans.find((p) => p.id === subscription?.plan_id) ??
      plans.find((p) => p.is_active) ??
      plans[0];
    setRepricePlanId(current?.id ?? null);
    setRepriceAmount(current ? (current.amount / 100).toFixed(2) : '');
    setShowRepriceModal(true);
  };

  /**
   * Move a live subscription onto a new ongoing rate.
   *
   * Two calls on purpose. manage-subscription-plans mints the new Stripe Price
   * and rewrites the plan row, but deliberately leaves existing subscribers
   * alone; change-subscription-price then moves this subscription onto it.
   * Doing only the first is what let an edited plan read as applied on this
   * screen while Stripe quietly carried on billing the old amount.
   */
  const handleReprice = async () => {
    const tenantId = params.id as string;
    const plan = plans.find((p) => p.id === repricePlanId);
    if (!plan) {
      toast.error('Pick which plan to reprice');
      return;
    }

    const dollars = Number(repriceAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    const cents = Math.round(dollars * 100);

    setRepriceBusy(true);
    try {
      if (cents !== plan.amount) {
        const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
          body: { action: 'update', planId: plan.id, amount: cents },
        });
        if (error) throw error;
        if (data?.success === false) throw new Error(data.error || 'Failed to update the plan');
      }

      const { data: moved, error: moveErr } = await supabase.functions.invoke('change-subscription-price', {
        body: { tenantId, planId: plan.id, action: 'apply' },
      });
      if (moveErr) throw moveErr;
      if (moved?.success === false) throw new Error(moved.error || 'Failed to move the subscription');

      const renews = subscription?.current_period_end
        ? new Date(subscription.current_period_end).toLocaleDateString()
        : 'their next renewal';
      toast.success(`Now ${formatCurrency(cents, plan.currency)}/${plan.interval} from ${renews} — nothing charged today.`);
      setShowRepriceModal(false);
      await Promise.all([loadSubscription(tenantId, true), loadPlans(tenantId)]);
    } catch (e: any) {
      toast.error(await fnErrorMessage(e, 'Failed to change the price'));
    } finally {
      setRepriceBusy(false);
    }
  };

  const loadPlans = async (tenantId: string) => {
    setPlansLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
        body: { action: 'list', tenantId },
      });
      if (error) throw error;
      const rawPlans = data?.plans || [];

      const { data: subCounts } = await supabase
        .from('tenant_subscriptions')
        .select('plan_id')
        .eq('tenant_id', tenantId)
        .in('status', ['active', 'trialing', 'past_due']);

      const countMap: Record<string, number> = {};
      (subCounts || []).forEach((s: any) => {
        if (s.plan_id) countMap[s.plan_id] = (countMap[s.plan_id] || 0) + 1;
      });

      setPlans(rawPlans.map((p: any) => ({ ...p, active_subscriptions: countMap[p.id] || 0 })));
    } catch (error) {
      console.error('Error loading plans:', error);
    } finally {
      setPlansLoading(false);
    }
  };

  const loadStats = async (tenantId: string) => {
    setStatsLoading(true);
    try {
      const [vehiclesRes, activeRentalsRes, completedRentalsRes, customersRes, staffRes] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('status', ['active', 'in_progress', 'confirmed']),
        supabase.from('rentals').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'completed'),
        supabase.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      ]);

      setStats({
        totalVehicles: vehiclesRes.count || 0,
        activeRentals: activeRentalsRes.count || 0,
        completedRentals: completedRentalsRes.count || 0,
        totalCustomers: customersRes.count || 0,
        staffUsers: staffRes.count || 0,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setStatsLoading(false);
    }
  };




  const loadPolicyAcceptances = async (tenantId: string) => {
    setPolicyLoading(true);
    try {
      const { data, error } = await supabase
        .from('policy_acceptances')
        .select('id, app_user_id, policy_type, version, ip_address, user_agent, accepted_at')
        .eq('tenant_id', tenantId)
        .order('accepted_at', { ascending: false });

      if (error) throw error;

      // Batch-resolve user names
      const userIds = [...new Set((data || []).map((d) => d.app_user_id).filter(Boolean))];
      let userMap: Record<string, { name: string | null; email: string }> = {};
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('app_users')
          .select('id, name, email')
          .in('id', userIds);

        (users || []).forEach((u: any) => {
          userMap[u.id] = { name: u.name, email: u.email };
        });
      }

      setPolicyAcceptances(
        (data || []).map((entry) => ({
          ...entry,
          ip_address: entry.ip_address as string | null,
          user_name: userMap[entry.app_user_id]?.name || undefined,
          user_email: userMap[entry.app_user_id]?.email || undefined,
        }))
      );
    } catch (error) {
      console.error('Error loading policy acceptances:', error);
    } finally {
      setPolicyLoading(false);
    }
  };

  // Per-tenant booking-site design switch. When on, this tenant's booking
  // home page (`/`) serves their custom site, and the booking app's middleware
  // sends every old-site page (/fleet, /about, /contact, …) to the custom
  // site's version. The booking funnel, payment pages and customer portal are
  // shared by both sites and keep working either way.
  //
  // Which design renders is resolved server-side per request, so an already-open
  // booking tab does NOT swap on its own — it needs a reload. (TenantContext's
  // realtime subscription does receive the new value, but nothing on the client
  // consumes it to switch designs.)
  const handleToggleBookingV2 = async (next: boolean) => {
    if (!tenant) return;
    setBookingV2Updating(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ booking_v2_enabled: next } as any)
        .eq('id', tenant.id);
      if (error) throw error;
      setTenant({ ...tenant, booking_v2_enabled: next });
      toast.success(next
        ? 'Custom site enabled — this tenant\'s booking website now serves their custom site'
        : 'Reverted to the legacy booking website');
    } catch (error: any) {
      toast.error(`Failed to update booking design: ${error.message}`);
    } finally {
      setBookingV2Updating(false);
    }
  };

  // Per-tenant subscription-blocker override. When on, this tenant is never
  // shown the "Finish Setup" / subscription-expired blocker (status/plans/
  // billing untouched).
  const handleToggleSubscriptionGate = async (next: boolean) => {
    if (!tenant) return;
    setGateUpdating(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ subscription_gate_disabled: next } as any)
        .eq('id', tenant.id);
      if (error) throw error;
      setTenant({ ...tenant, subscription_gate_disabled: next });
      toast.success(next
        ? 'Subscription blocker hidden for this tenant'
        : 'Subscription blocker restored for this tenant');
    } catch (error: any) {
      toast.error(`Failed to update: ${error.message}`);
    } finally {
      setGateUpdating(false);
    }
  };

  const openAddPlan = () => {
    setEditingPlan(null);
    setPlanForm({ name: '', description: '', amount: '', currency: 'usd', interval: 'month', trialDays: '0', billingModel: 'trial', features: [] });
    setNewFeature('');
    setShowPlanModal(true);
  };

  const openEditPlan = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setPlanForm({
      name: plan.name,
      description: plan.description || '',
      amount: (plan.amount / 100).toString(),
      currency: plan.currency,
      interval: plan.interval,
      trialDays: (plan.trial_days || 0).toString(),
      billingModel: plan.billing_model || 'trial',
      features: [...plan.features],
    });
    setNewFeature('');
    setShowPlanModal(true);
  };

  const handleSavePlan = async () => {
    if (!tenant) return;
    if (!planForm.name.trim()) { toast.error('Plan name is required'); return; }
    const amountDollars = parseFloat(planForm.amount);
    if (isNaN(amountDollars) || amountDollars <= 0) { toast.error('Amount must be a positive number'); return; }

    setPlanSaving(true);
    try {
      const amountCents = Math.round(amountDollars * 100);

      if (editingPlan) {
        const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
          body: {
            action: 'update',
            planId: editingPlan.id,
            name: planForm.name,
            description: planForm.description || null,
            features: planForm.features,
            amount: amountCents,
            currency: planForm.currency,
            interval: planForm.interval,
            trialDays: parseInt(planForm.trialDays) || 0,
            billingModel: planForm.billingModel,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (data?.pricingChanged && editingPlan.active_subscriptions > 0) {
          // "until they renew" was not true. manage-subscription-plans mints a
          // new Stripe Price and stores it on the PLAN; it never calls
          // subscriptions.update, and a renewal charges the price pinned to the
          // subscription. So an existing subscriber stays on the old amount
          // forever, while this toast told the operator the change would land
          // at the next renewal — a promise the system never keeps.
          toast.warning(
            `New price saved for new signups only. ${editingPlan.active_subscriptions} existing subscriber${editingPlan.active_subscriptions > 1 ? 's' : ''} will keep being billed the old amount — move them in Stripe to change it.`,
            { duration: 9000 },
          );
        } else {
          toast.success(`"${planForm.name}" plan updated successfully`);
        }
      } else {
        const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
          body: {
            action: 'create',
            tenantId: tenant.id,
            name: planForm.name,
            description: planForm.description || null,
            features: planForm.features,
            amount: amountCents,
            currency: planForm.currency,
            interval: planForm.interval,
            trialDays: parseInt(planForm.trialDays) || 0,
            billingModel: planForm.billingModel,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        toast.success(`"${planForm.name}" plan created \u2014 tenant can now subscribe from their portal`);
      }

      setShowPlanModal(false);
      loadPlans(tenant.id);
    } catch (error: any) {
      toast.error(`Something went wrong while saving the plan. Please try again.`);
    } finally {
      setPlanSaving(false);
    }
  };

  const handleTogglePlanActive = async (plan: SubscriptionPlan) => {
    if (!tenant) return;

    if (plan.is_active && plan.active_subscriptions > 0) {
      const confirmed = await confirmDialog({
        title: `Deactivate "${plan.name}"?`,
        description: `It has ${plan.active_subscriptions} active subscriber${plan.active_subscriptions > 1 ? 's' : ''}. Deactivating hides it from new signups, but existing subscribers keep being billed.`,
        confirmLabel: 'Deactivate',
      });
      if (!confirmed) return;
    }

    try {
      const action = plan.is_active ? 'deactivate' : 'activate';
      const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
        body: { action, planId: plan.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (plan.is_active) {
        toast.success(`"${plan.name}" deactivated \u2014 no longer visible to new subscribers`);
      } else {
        toast.success(`"${plan.name}" activated \u2014 now visible to the tenant in their portal`);
      }
      loadPlans(tenant.id);
    } catch (error: any) {
      toast.error(`Something went wrong while updating the plan. Please try again.`);
    }
  };

  const handleDeletePlan = async (plan: SubscriptionPlan) => {
    if (!tenant) return;

    if (plan.active_subscriptions > 0) {
      toast.error(
        `Can't delete "${plan.name}" because it has ${plan.active_subscriptions} active subscriber${plan.active_subscriptions > 1 ? 's' : ''}. Deactivate it instead to hide it from new signups.`
      );
      return;
    }

    if (!(await confirmDialog({ title: `Delete "${plan.name}"?`, description: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true }))) return;

    try {
      const { data, error } = await supabase.functions.invoke('manage-subscription-plans', {
        body: { action: 'delete', planId: plan.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // The function can succeed but fail to archive the Stripe price.
      if (data?.warning) toast.warning(data.warning);
      else toast.success(`"${plan.name}" has been deleted`);
      loadPlans(tenant.id);
    } catch (error: any) {
      // Show the REAL reason. supabase-js throws a generic FunctionsHttpError and
      // puts the message in the response body, so this used to render
      // "Something went wrong... Please try again" for a deliberate 409 — advice
      // that is not just unhelpful but wrong, since retrying cannot work.
      // Matches the discount handlers, which already do this.
      toast.error(await fnErrorMessage(error, `Failed to delete "${plan.name}"`));
    }
  };

  const handleToggleStripeMode = async (newMode: 'test' | 'live') => {
    if (!tenant) return;
    if (newMode === tenant.subscription_stripe_mode) return;

    if (newMode === 'live') {
      const confirmed = await confirmDialog({
        title: 'Switch to live Stripe mode?',
        description: 'Real charges will be made. Make sure live Stripe keys are configured.',
        confirmLabel: 'Switch to live',
        destructive: true,
      });
      if (!confirmed) return;
    }

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ subscription_stripe_mode: newMode })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, subscription_stripe_mode: newMode });
      toast.success(`Stripe mode switched to ${newMode} for ${tenant.company_name}`);
    } catch (error: any) {
      toast.error(`Failed to update Stripe mode: ${error.message}`);
    }
  };

  const handleModeToggle = (type: 'stripe' | 'bonzah' | 'boldsign' | 'subscription_stripe', newMode: 'test' | 'live') => {
    if (newMode === 'live') {
      setPendingModeChange({ type, newMode });
      setShowModeConfirm(true);
    } else {
      executeModeChange(type, newMode);
    }
  };

  const executeModeChange = async (type: 'stripe' | 'bonzah' | 'boldsign' | 'subscription_stripe', newMode: 'test' | 'live') => {
    if (!tenant) return;
    setModeUpdating(true);
    try {
      const fieldMap: Record<string, string> = {
        stripe: 'stripe_mode',
        bonzah: 'bonzah_mode',
        boldsign: 'boldsign_mode',
        subscription_stripe: 'subscription_stripe_mode',
      };
      const field = fieldMap[type];
      const { error } = await supabase
        .from('tenants')
        .update({ [field]: newMode })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, [field]: newMode } as any);
      const labels: Record<string, string> = {
        stripe: 'Stripe Connect',
        bonzah: 'Bonzah API',
        boldsign: 'BoldSign',
        subscription_stripe: 'Subscription Stripe',
      };
      toast.success(`${labels[type]} switched to ${newMode} mode`);
    } catch (error: any) {
      toast.error(`Error updating mode: ${error.message}`);
    } finally {
      setModeUpdating(false);
    }
  };

  const confirmModeChange = () => {
    if (pendingModeChange) {
      executeModeChange(pendingModeChange.type, pendingModeChange.newMode);
    }
    setShowModeConfirm(false);
    setPendingModeChange(null);
  };

  const addFeature = () => {
    if (newFeature.trim()) {
      setPlanForm({ ...planForm, features: [...planForm.features, newFeature.trim()] });
      setNewFeature('');
    }
  };

  const removeFeature = (index: number) => {
    setPlanForm({ ...planForm, features: planForm.features.filter((_, i) => i !== index) });
  };



  const handleToggleIntegration = async (integration: 'bonzah' | 'tesla_fleet', enabled: boolean) => {
    if (!tenant) return;

    const fieldName = `integration_${integration}` as keyof Tenant;

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ [fieldName]: enabled })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, [fieldName]: enabled });
      toast.success(`${integration.charAt(0).toUpperCase() + integration.slice(1)} ${enabled ? 'enabled' : 'disabled'}!`);
    } catch (error: any) {
      toast.error(`Error updating integration: ${error.message}`);
    }
  };

  /**
   * Super-admin escape hatch: let a tenant sell Bonzah while still in test mode.
   * Sandbox policies are NOT real cover, so this is for internal/demo tenants
   * only — never for a tenant taking real customers.
   */
  const handleToggleSandboxOverride = async (enabled: boolean) => {
    if (!tenant) return;

    if (enabled) {
      const ok = await confirmDialog({
        title: `Allow ${tenant.company_name} to sell Bonzah insurance in test mode?`,
        description: 'Policies issued will be sandbox policies, not real cover, even though the customer can still be charged. Only do this for internal or demo tenants.',
        confirmLabel: 'Allow',
        destructive: true,
      });
      if (!ok) return;
    }

    try {
      const { error } = await supabase
        .from('tenants')
        .update({ bonzah_sandbox_override: enabled })
        .eq('id', tenant.id);

      if (error) throw error;

      setTenant({ ...tenant, bonzah_sandbox_override: enabled });
      toast.success(enabled ? 'Sandbox selling allowed for this tenant' : 'Sandbox override disabled');
    } catch (error: any) {
      toast.error(`Error updating sandbox override: ${error.message}`);
    }
  };

  const openPasswordReset = async () => {
    if (!tenant) return;
    setPwResult(null);
    setPwUsers([]);
    setShowPasswordReset(true);
    setPwLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-tenant-password-reset', {
        body: { action: 'list', tenantId: tenant.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPwUsers(data.users ?? []);
    } catch (error: any) {
      toast.error(`Could not load logins: ${error.message}`);
      setShowPasswordReset(false);
    } finally {
      setPwLoading(false);
    }
  };

  const handleResetPassword = async (userId: string) => {
    if (!tenant) return;
    setPwResettingId(userId);
    try {
      const { data, error } = await supabase.functions.invoke('admin-tenant-password-reset', {
        body: { action: 'reset', tenantId: tenant.id, userId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPwResult({ email: data.email, password: data.password });
      toast.success('Password reset. Copy it now — it is not shown again.');
    } catch (error: any) {
      toast.error(`Reset failed: ${error.message}`);
    } finally {
      setPwResettingId(null);
    }
  };

  const handleForceLogout = async () => {
    if (!tenant) return;
    setForceLogoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-force-logout', {
        body: { tenantId: tenant.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(
        `Successfully logged out ${data.successCount} user${data.successCount !== 1 ? 's' : ''} from ${tenant.company_name}`
      );
      if (data.failCount > 0) {
        toast.error(`${data.failCount} user${data.failCount !== 1 ? 's' : ''} could not be logged out`);
      }
    } catch (error: any) {
      toast.error(`Failed to force logout: ${error.message}`);
    } finally {
      setForceLogoutLoading(false);
    }
  };


  /*
   * The six tabs move into the rail, the way Promo Codes' five did and the way
   * Northwind puts a customer's sections there.
   *
   * `Tabs` was uncontrolled, with a `defaultValue` that read `?tab=payments`
   * off the URL — a link other admin screens send. That seed is kept exactly,
   * just moved into state so the rail can set the section too. Nothing else
   * about the tab behaviour changes.
   *
   * The title is the COMPANY's name, not "Rental Companies": this is a record
   * page, and a rail that says the same thing on every tenant cannot tell you
   * which one you have open.
   */
  /* Restored Sep 26 2026: the controls moved into the account menu rather
     than being dropped. The dialog they open is unchanged. */
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showGateDialog, setShowGateDialog] = useState(false);
  const [showIntegrations, setShowIntegrations] = useState(false);
  /*
   * Four sections, not six: Details, Subscriptions, Integrations and Consent.
   *
   * Payments, Analytics, Finance Sync and Todos were removed from Super Admin
   * on Sep 26 2026 by request. This takes them off THIS page only — the rental
   * operator's own portal is a separate application (`apps/portal`) and is
   * untouched, so nothing a tenant sees or uses changes.
   */
  // Status, type and delete are shared with the Rental Companies list
  // (lib/tenant-actions.ts, components/admin/delete-tenant-dialog.tsx).
  const handleUpdateStatus = async (newStatus: TenantStatus) => {
    if (!tenant) return;
    try {
      await setTenantStatus(tenant.id, newStatus);
      setTenant({ ...tenant, status: newStatus });
      toast.success(`Tenant ${newStatus === 'active' ? 'activated' : 'suspended'} successfully!`);
    } catch (error: any) {
      toast.error(`Error updating status: ${error.message}`);
    }
  };

  const handleUpdateType = async (newType: TenantType) => {
    if (!tenant) return;
    try {
      await setTenantType(tenant.id, newType);
      setTenant({ ...tenant, tenant_type: newType });
      toast.success(`Tenant marked as ${newType}!`);
    } catch (error: any) {
      toast.error(`Error updating tenant type: ${error.message}`);
    }
  };

  /* No sections any more: everything is on one screen (Oct 17 2026), so the
     rail keeps the normal navigation. The company's actions (type, status,
     force logout, password reset, delete) sit top right of the page header
     since Oct 19 2026, no longer in the account menu. */
  useRegisterSidebarSections(
    '/admin/rentals',
    NO_SECTIONS,
    '',
    noSection,
    tenant?.company_name ?? 'Rental company',
  );

  if (loading) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="p-6 lg:p-8">
        <div className="text-center py-12">
          <p className="text-muted-foreground text-lg">Tenant not found</p>
          <Button variant="link" onClick={() => router.push('/admin/rentals')} className="mt-4">
            Back to Rental Companies
          </Button>
        </div>
      </div>
    );
  }



  // Integration tiles, in order. The page shows one row of them; See all
  // opens the full set in a dialog. Each opens its own detail dialog.
  const integrationTiles = [
    tenant.custom_site_eligible && (
      <IntegrationTile
        key="booking-site"
        logo={<LayoutTemplate size={64} className="text-violet-600" />}
        name="Booking Site Design"
        description="Serve this tenant's custom website instead of the legacy site."
        status={<IntegrationStatus tone={tenant.booking_v2_enabled ? 'success' : 'neutral'} label={tenant.booking_v2_enabled ? 'Custom site' : 'Legacy'} />}
        onOpen={() => setOpenIntegration('booking-site')}
      />
    ),
    <IntegrationTile
      key="credits"
      logo={<Coins size={64} className="text-amber-500" />}
      name="Credits"
      description="Verification credit wallet and transaction history."
      status={<IntegrationStatus tone="neutral" label="Balance" />}
      onOpen={() => setShowCreditsDetail(true)}
    />,
    <IntegrationTile
      key="stripe"
      logo={<IntegrationLogo src={brandLogo('stripe.com')} alt="Stripe" />}
      name="Stripe Connect"
      description="Accept booking payments, deposits & payouts."
      status={
        <IntegrationStatus
          tone={tenant.stripe_account_id ? (tenant.stripe_onboarding_complete ? 'success' : 'warning') : 'neutral'}
          label={tenant.stripe_account_id ? (tenant.stripe_onboarding_complete ? 'Connected' : 'Onboarding') : 'Not connected'}
        />
      }
      onOpen={() => setOpenIntegration('stripe')}
    />,
    <IntegrationTile
      key="bonzah"
      logo={
        <>
          <img src="/bonzah-logo.svg" alt="Bonzah" className="h-10 w-auto dark:hidden" />
          <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="hidden h-10 w-auto dark:block" />
        </>
      }
      description="Per-rental insurance coverage at checkout."
      status={<IntegrationStatus tone={tenant.integration_bonzah ? 'success' : 'neutral'} label={tenant.integration_bonzah ? 'Enabled' : 'Not connected'} />}
      onOpen={() => setOpenIntegration('bonzah')}
    />,
    <IntegrationTile
      key="tesla"
      logo={<IntegrationLogo src={brandLogo('tesla.com')} alt="Tesla" />}
      name="Tesla"
      description="Supercharging & vehicle data via the Fleet API."
      status={<IntegrationStatus tone={tenant.integration_tesla_fleet ? 'success' : 'neutral'} label={tenant.integration_tesla_fleet ? 'Enabled' : 'Disabled'} />}
      onOpen={() => setOpenIntegration('tesla')}
    />,
    <IntegrationTile
      key="boldsign"
      logo={<IntegrationLogo src={brandLogo('boldsign.com')} alt="BoldSign" />}
      name="BoldSign"
      description="E-signature for rental agreements."
      status={<IntegrationStatus tone={tenant.boldsign_mode === 'live' ? 'success' : 'info'} label={tenant.boldsign_mode === 'live' ? 'Production' : 'Sandbox'} />}
      onOpen={() => setOpenIntegration('boldsign')}
    />,
    // MOCK (Ghulam, Oct 18 2026): placeholder tiles to preview See all with
    // more than one row. Delete this block once reviewed.
    ...[
      { key: 'mock-xero', domain: 'xero.com', name: 'Xero', label: 'Connected', tone: 'success' as const },
      { key: 'mock-twilio', domain: 'twilio.com', name: 'Twilio', label: 'Enabled', tone: 'success' as const },
      { key: 'mock-turo', domain: 'turo.com', name: 'Turo', label: 'Not connected', tone: 'neutral' as const },
      { key: 'mock-zoho', domain: 'zoho.com', name: 'Zoho Books', label: 'Not connected', tone: 'neutral' as const },
    ].map((m) => (
      <IntegrationTile
        key={m.key}
        logo={<IntegrationLogo src={brandLogo(m.domain)} alt={m.name} />}
        name={m.name}
        description="Mock tile."
        status={<IntegrationStatus tone={m.tone} label={m.label} />}
        onOpen={() => {}}
      />
    )),
  ].filter(Boolean);

  return (
    /* One screen (Ghulam, Oct 17 2026): the five sections that were rail rows
       — Details, Subscriptions, Integrations, Consent, Timeline — sit on one
       page. On a desktop it is bounded to the viewport (no top bar here), the
       Timeline runs down the right as its own scrolling column, and the main
       pane only scrolls if a tall subscription panel overflows it. */
    <div className="flex flex-col gap-5 lg:h-[calc(100svh-3rem)]">
      {/* No back button, and no breadcrumb above it — both removed Sep 26
          2026 ("remove all breadcrumbs globally").

          The way back is the rail: All sections → Rental Companies. Two
          clicks where there was one, and nobody is stranded. */}
      {/* Page header.

          The title and everything you can DO to this company on ONE line.
          It used to be a `space-y-4` stack: a `justify-between` row holding
          only the title — so it had nothing to justify against and left the
          whole right half of the screen empty — and then the buttons on a
          second row below it. Reported Sep 26 2026 with that empty space
          circled in red. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* The name is the way into their portal. */}
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            <a
              href={portalUrlFor(tenant.slug)}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${tenant.company_name}'s portal`}
              className="group inline-flex items-center gap-1.5 rounded-md outline-none transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              {tenant.company_name}
              {/* Says it's a link that opens a new tab. */}
              <ArrowUpRight
                className="size-5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary sm:size-6"
                aria-hidden="true"
              />
            </a>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
            {/* Type is a button: a click flips it. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleUpdateType(tenant.tenant_type === 'production' ? 'test' : 'production')}
              title={tenant.tenant_type === 'production' ? 'Production. Click to mark as test' : 'Test. Click to mark as production'}
              className={cn(
                'h-8 rounded-lg px-3 text-[13px] capitalize',
                tenant.tenant_type === 'production' ? 'text-success hover:text-success' : 'text-warning hover:text-warning',
              )}
            >
              {tenant.tenant_type || 'Not set'}
            </Button>
            {/* The current state; a click flips it. Suspending locks their
                team out, so that one asks first. */}
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (
                  tenant.status === 'active' &&
                  !(await confirmDialog({
                    title: `Suspend ${tenant.company_name}?`,
                    description: 'Their team loses access until reactivated.',
                    confirmLabel: 'Suspend',
                    destructive: true,
                  }))
                )
                  return;
                void handleUpdateStatus(tenant.status === 'active' ? 'suspended' : 'active');
              }}
              title={tenant.status === 'active' ? 'Active. Click to suspend' : 'Suspended. Click to activate'}
              className={cn(
                'h-8 rounded-lg px-3 text-[13px] capitalize',
                tenant.status === 'active' ? 'text-success hover:text-success' : 'text-destructive hover:text-destructive',
              )}
            >
              {tenant.status}
            </Button>
            {/* Edit and delete: icons, named in the tooltip. */}
            <Button size="icon" variant="outline" className="size-8 rounded-lg" onClick={() => setIsEditing(true)} title="Edit company and login" aria-label="Edit company and login">
              <Pencil className="size-3.5" />
            </Button>
            <Button size="icon" variant="outline" className="size-8 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setShowDeleteConfirm(true)} title="Delete company" aria-label="Delete company">
              <Trash2 className="size-3.5" />
            </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: the company, its billing, its integrations, its consent log,
            each a compact full-width strip. */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4 lg:-m-1.5 lg:overflow-y-auto lg:p-1.5">
          {/* The company's facts, in one row. Its name is the page title, so
              only what the title doesn't say. Edit is in the header. */}
          <Card className="shrink-0">
            <CardContent className="px-7 py-6 max-md:px-5 max-md:py-5">
              {/* On a phone the who and the what stack. */}
              <div className="flex items-center gap-6 max-md:flex-col max-md:items-start max-md:gap-4">
                {/* Who: the admin, and the address to reach them, in full. */}
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold uppercase text-primary">
                    {(tenant.admin_name || tenant.company_name).charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <p className={cn('text-base font-medium', tenant.admin_name ? 'text-foreground' : 'text-muted-foreground')}>
                      {tenant.admin_name || 'No admin name'}
                    </p>
                    <a href={`mailto:${tenant.contact_email}`} className="block break-all text-sm text-muted-foreground hover:text-primary">
                      {tenant.contact_email}
                    </a>
                  </div>
                </div>
                {/* What: its slug and when it joined. */}
                <dl className="flex shrink-0 gap-8 max-md:w-full max-md:shrink">
                  {[
                    { label: 'Slug', value: tenant.slug },
                    {
                      label: 'Created',
                      value: new Date(tenant.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
                    },
                  ].map((item) => (
                    <div key={item.label} className="min-w-0 space-y-0.5">
                      <dt className="text-[13px] text-muted-foreground">{item.label}</dt>
                      <dd className="text-base font-medium text-foreground max-md:break-all">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </CardContent>
          </Card>

          {/* Integrations: one row of tiles; the rest behind See all. */}
          <section className="shrink-0 space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-base font-semibold tracking-tight">Integrations</h2>
              {integrationTiles.length > INTEGRATIONS_IN_ROW && (
                <Button variant="ghost" size="sm" className="-my-1 h-8 px-3 text-[13px]" onClick={() => setShowIntegrations(true)}>
                  See all
                </Button>
              )}
            </div>
            {/* On a phone the row scrolls sideways, each tile a fixed width. */}
            <div className="grid grid-cols-5 gap-3 max-md:-mx-4 max-md:flex max-md:snap-x max-md:scroll-px-4 max-md:overflow-x-auto max-md:px-4 max-md:pb-1 max-md:pt-0.5 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden max-md:[&>*]:w-28 max-md:[&>*]:shrink-0 max-md:[&>*]:snap-start">
              {integrationTiles.slice(0, INTEGRATIONS_IN_ROW)}
            </div>
          </section>

          <Dialog open={showIntegrations} onOpenChange={setShowIntegrations}>
            <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto rounded-3xl p-7">
              <DialogHeader>
                <DialogTitle>Integrations</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">{integrationTiles}</div>
            </DialogContent>
          </Dialog>

          {/* One dialog for every tile. Its bodies are the detail rows and
              controls the stacked cards used to carry, unchanged. */}
          <Dialog open={openIntegration !== null} onOpenChange={(o) => { if (!o) setOpenIntegration(null); }}>
            <DialogContent className="max-h-[88vh] overflow-y-auto p-8 sm:max-w-4xl">
              {openIntegration === 'booking-site' && (
                <>
                  <DialogHeader>
                    <div className="mb-2 flex h-16 items-center"><LayoutTemplate size={48} className="text-violet-600" /></div>
                    <DialogTitle>Booking Site Design</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Serve this tenant&apos;s <span className="font-medium text-foreground">custom website</span>{' '}
                        instead of the legacy booking site. It draws its fleet, rates, content and
                        branding from this tenant&apos;s own portal data, and shares the same booking
                        funnel and customer portal.
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Turning this on also reveals{' '}
                        <span className="font-medium text-foreground">Website Content &rarr; New Website Content</span>{' '}
                        in their portal, where they edit the custom site.
                      </p>
                      {tenant.slug && (
                        <a
                          href={`${tenantBookingUrl(tenant.slug)}/custom-booking-page`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-2"
                        >
                          Preview it without switching <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <label className="flex items-center cursor-pointer">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={!!tenant.booking_v2_enabled}
                          disabled={bookingV2Updating}
                          onChange={(e) => handleToggleBookingV2(e.target.checked)}
                          className="sr-only"
                        />
                        <div className={cn(
                          "w-11 h-6 rounded-full transition-colors",
                          tenant.booking_v2_enabled ? 'bg-violet-500' : 'bg-muted'
                        )}>
                          <div className={cn(
                            "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md ring-1 ring-black/5 transition-transform dark:bg-white",
                            tenant.booking_v2_enabled && 'translate-x-5'
                          )} />
                        </div>
                      </div>
                      <Badge variant={tenant.booking_v2_enabled ? 'success' : 'outline'} className="ml-2 whitespace-nowrap">
                        {tenant.booking_v2_enabled ? 'Custom site' : 'Legacy'}
                      </Badge>
                    </label>
                  </div>
                </>
              )}
              {openIntegration === 'stripe' && (
                <>
                  <DialogHeader>
                    <div className="mb-2 flex h-16 items-center"><IntegrationLogo src={brandLogo('stripe.com')} alt="Stripe" size={48} /></div>
                    <DialogTitle className="flex items-center gap-2">
                      Stripe Connect
                      <IntegrationStatus
                        tone={tenant.stripe_account_id ? (tenant.stripe_onboarding_complete ? 'success' : 'warning') : 'neutral'}
                        label={tenant.stripe_account_id ? (tenant.stripe_onboarding_complete ? 'Connected' : 'Onboarding') : 'Not connected'}
                      />
                    </DialogTitle>
                    <DialogDescription>Payment processing for customer bookings via Stripe Connect</DialogDescription>
                  </DialogHeader>
                  <PanelCard>
                    <PanelRow label="Account ID" mono>
                      {tenant.stripe_account_id || <span className="font-sans text-muted-foreground">Not set up</span>}
                    </PanelRow>
                    <PanelRow label="Onboarding">
                      {tenant.stripe_account_id ? (
                        <span className={cn('font-medium', tenant.stripe_onboarding_complete ? 'text-success' : 'text-warning')}>
                          {tenant.stripe_onboarding_complete ? 'Complete' : 'Incomplete'}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </PanelRow>
                    <PanelRow label="Account status">
                      <span className="capitalize">{tenant.stripe_account_status || <span className="text-muted-foreground">—</span>}</span>
                    </PanelRow>
                    <PanelRow label="Mode">
                      <ModeControl
                        mode={tenant.stripe_mode}
                        disabled={modeUpdating}
                        onSwitch={() => handleModeToggle('stripe', tenant.stripe_mode === 'test' ? 'live' : 'test')}
                      />
                    </PanelRow>
                  </PanelCard>
                </>
              )}
              {openIntegration === 'bonzah' && (
                <>
                  <DialogHeader>
                    <div className="mb-2 flex h-16 items-center">
                      <img src="/bonzah-logo.svg" alt="Bonzah" className="h-8 w-auto dark:hidden" />
                      <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="hidden h-8 w-auto dark:block" />
                    </div>
                    <DialogTitle className="flex items-center gap-2">
                      Bonzah Insurance
                      <IntegrationStatus tone={tenant.integration_bonzah ? 'success' : 'neutral'} label={tenant.integration_bonzah ? 'Enabled' : 'Not connected'} />
                    </DialogTitle>
                    <DialogDescription>Customer insurance coverage and premium calculation</DialogDescription>
                  </DialogHeader>
                  <PanelCard>
                    <PanelRow label="Integration">
                      <span className="inline-flex items-center gap-2">
                        <span className={cn('inline-block h-2 w-2 rounded-full', tenant.integration_bonzah ? 'bg-emerald-400' : 'bg-muted-foreground/40')} />
                        <span className="font-medium">{tenant.integration_bonzah ? 'Active' : 'Inactive'}</span>
                        <Button
                          variant="outline" size="sm" className="h-7 px-2.5 text-xs"
                          onClick={() => handleToggleIntegration('bonzah', !tenant.integration_bonzah)}
                        >
                          {tenant.integration_bonzah ? 'Disable' : 'Enable'}
                        </Button>
                      </span>
                    </PanelRow>
                    <PanelRow label="Credentials">
                      {tenant.bonzah_username
                        ? <span className="break-all">{tenant.bonzah_username}</span>
                        : <span className="text-muted-foreground">Not configured</span>}
                    </PanelRow>
                    <PanelRow label="Mode">
                      <ModeControl
                        mode={tenant.bonzah_mode || 'test'}
                        disabled={modeUpdating}
                        onSwitch={() => handleModeToggle('bonzah', (tenant.bonzah_mode || 'test') === 'test' ? 'live' : 'test')}
                      />
                    </PanelRow>
                    {/* Selling is blocked in test mode: a sandbox policy is not real
                        cover, yet the customer can still be charged real money for it.
                        The override exists only for internal/demo tenants. */}
                    <PanelRow label="Selling new policies">
                      {tenant.integration_bonzah &&
                      ((tenant.bonzah_mode || 'test') === 'live' || tenant.bonzah_sandbox_override) ? (
                        <IntegrationStatus tone="success" label="Allowed" />
                      ) : (
                        <IntegrationStatus tone="warning" label="Blocked" />
                      )}
                    </PanelRow>
                  </PanelCard>
                  {(tenant.bonzah_mode || 'test') === 'test' && (
                    <PanelNote tone={tenant.bonzah_sandbox_override ? 'warn' : 'info'}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span>
                          {tenant.bonzah_sandbox_override
                            ? 'Sandbox override ON — this tenant can sell sandbox policies. Internal/demo use only.'
                            : 'Test mode issues sandbox policies, so selling is blocked.'}
                        </span>
                        <Button
                          variant="outline" size="sm" className="h-7 shrink-0 px-2.5 text-xs"
                          disabled={modeUpdating}
                          onClick={() => handleToggleSandboxOverride(!tenant.bonzah_sandbox_override)}
                        >
                          <ArrowRightLeft className="h-3 w-3" />
                          {tenant.bonzah_sandbox_override ? 'Disable override' : 'Allow sandbox selling'}
                        </Button>
                      </div>
                    </PanelNote>
                  )}
                </>
              )}
              {openIntegration === 'tesla' && (
                <>
                  <DialogHeader>
                    <div className="mb-2 flex h-16 items-center"><IntegrationLogo src={brandLogo('tesla.com')} alt="Tesla" size={48} /></div>
                    <DialogTitle className="flex items-center gap-2">
                      Tesla Fleet API
                      <IntegrationStatus tone={tenant.integration_tesla_fleet ? 'success' : 'neutral'} label={tenant.integration_tesla_fleet ? 'Enabled' : 'Disabled'} />
                    </DialogTitle>
                    <DialogDescription>Supercharger billing tracking for Tesla vehicles</DialogDescription>
                  </DialogHeader>
                  <PanelCard>
                    <PanelRow label="Integration">
                      <span className="inline-flex items-center gap-2">
                        <span className={cn('inline-block h-2 w-2 rounded-full', tenant.integration_tesla_fleet ? 'bg-emerald-400' : 'bg-muted-foreground/40')} />
                        <span className="font-medium">{tenant.integration_tesla_fleet ? 'Active' : 'Inactive'}</span>
                        <Button
                          variant="outline" size="sm" className="h-7 px-2.5 text-xs"
                          onClick={() => handleToggleIntegration('tesla_fleet', !tenant.integration_tesla_fleet)}
                        >
                          {tenant.integration_tesla_fleet ? 'Disable' : 'Enable'}
                        </Button>
                      </span>
                    </PanelRow>
                  </PanelCard>
                </>
              )}
              {openIntegration === 'boldsign' && (
                <>
                  <DialogHeader>
                    <div className="mb-2 flex h-16 items-center"><IntegrationLogo src={brandLogo('boldsign.com')} alt="BoldSign" size={48} /></div>
                    <DialogTitle className="flex items-center gap-2">
                      BoldSign
                      <IntegrationStatus tone={tenant.boldsign_mode === 'live' ? 'success' : 'info'} label={tenant.boldsign_mode === 'live' ? 'Production' : 'Sandbox'} />
                    </DialogTitle>
                    <DialogDescription>Electronic signatures for rental agreements and contracts</DialogDescription>
                  </DialogHeader>
                  <PanelCard>
                    <PanelRow label="Environment">
                      <span className={cn('font-medium', tenant.boldsign_mode === 'live' ? 'text-success' : 'text-sky-600')}>
                        {tenant.boldsign_mode === 'live' ? 'Production' : 'Sandbox'}
                      </span>
                    </PanelRow>
                    <PanelRow label="Mode">
                      <ModeControl
                        mode={tenant.boldsign_mode || 'test'}
                        disabled={modeUpdating}
                        onSwitch={() => handleModeToggle('boldsign', tenant.boldsign_mode === 'live' ? 'test' : 'live')}
                      />
                    </PanelRow>
                  </PanelCard>
                  <PanelNote>
                    {tenant.boldsign_mode === 'live'
                      ? 'Production documents are legally binding and stored permanently.'
                      : 'Sandbox documents are watermarked and auto-deleted after 14 days.'}
                  </PanelNote>
                </>
              )}
            </DialogContent>
          </Dialog>

          {/* Subscription: billing, plans, the sales link and the block on
              top, then every payment — as many lines as fit the rest of the
              column, the others behind See all. */}
          <SubscriptionTrail
            invoices={invoices}
            formatCurrency={formatCurrency}
            formatDate={formatDate}
            top={
              <>
              {(subLinkUrl || subLink) && (
                <div className="mb-5 rounded-lg border border-border bg-muted/40 p-4 space-y-3">
                  {subLink?.status === 'paid' ? (
                    <p className={`text-sm font-medium ${subIsLive ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {subIsLive
                        ? `Payment link paid${subLink.paid_at ? ` on ${new Date(subLink.paid_at).toLocaleDateString()}` : ''} — this tenant is subscribed.`
                        // The link settled, but the subscription is no longer
                        // live (cancelled, lapsed, expired). Claiming "subscribed"
                        // off the link row alone was how this printed green while
                        // the status two lines below read Incomplete_expired.
                        : `Payment link was paid${subLink.paid_at ? ` on ${new Date(subLink.paid_at).toLocaleDateString()}` : ''}, but the subscription is no longer active — see Status below.`}
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          {subLink?.kind === 'first' ? 'First subscription link' : 'Subscription link'}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {subLinkLive
                            ? `Expires in ${subLinkRemaining}`
                            : subLink?.status === 'revoked'
                              ? 'Revoked'
                              : subLink?.status === 'superseded'
                                ? 'Replaced by a newer link'
                                : 'Expired'}
                        </span>
                      </div>
                      {subLinkUrl && subLinkLive ? (
                        <div className="flex items-center gap-2">
                          <code className="flex-1 select-all break-all rounded bg-background px-3 py-2 text-xs">
                            {subLinkUrl}
                          </code>
                          <Button size="sm" variant="outline" onClick={() => {
                            navigator.clipboard?.writeText(subLinkUrl);
                            toast.success('Link copied');
                          }}>Copy</Button>
                        </div>
                      ) : (
                        // The plaintext token is never stored, so once this screen is
                        // gone the address is unrecoverable — by design.
                        <p className="text-xs text-muted-foreground">
                          {subLinkLive
                            ? 'A link is live, but its address is only shown once at generation. Press Regenerate to create a fresh one you can send.'
                            : 'This link can no longer be paid. Press Regenerate to send a fresh one.'}
                        </p>
                      )}
                      {subLink?.payment_attempted_at && (
                        <p className="text-xs text-red-600">
                          {subLinkLive
                            ? 'Card declined — they are not subscribed. They can retry with the same link.'
                            : 'A card was declined on this link before it closed. They are not subscribed — send a fresh link.'}
                        </p>
                      )}
                      {(subLink?.mint_count ?? 0) > 0 && (
                        <p className="text-xs text-muted-foreground">Opened {subLink.mint_count}&times;</p>
                      )}
                      {/* Send from here so George never changes tab mid-call.
                          Sending mints a FRESH link, because the plaintext of
                          the current one is unrecoverable by design. */}
                      <div className="flex items-center gap-2 pt-1">
                        <Input
                          type="email"
                          placeholder="client@company.com"
                          value={subLinkEmail}
                          onChange={(e) => setSubLinkEmail(e.target.value)}
                          disabled={subLinkSending}
                          className="h-8 text-xs"
                        />
                        <Button
                          size="sm"
                          disabled={subLinkSending || !subLinkEmail.trim()}
                          onClick={handleSendLinkEmail}
                        >
                          {subLinkSending ? 'Sending…' : 'Email it'}
                        </Button>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" variant="outline" disabled={subLinkBusy} onClick={handleGenerateLink}>Regenerate</Button>
                        {subLinkLive && (
                          <Button size="sm" variant="ghost" disabled={subLinkBusy} onClick={handleRevokeLink}>Revoke</Button>
                        )}
                      </div>
                      {subLinkLive && <LinkPromoPicker tenantId={String(params.id)} />}
                    </>
                  )}
                </div>
              )}
              {(subLinkUrl || subLink) && <Separator className="mb-3" />}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 max-md:grid-cols-1 max-md:gap-3">
                {/* Status, plan and billing are one fact, so one pill: the plan
                    and its price, green when active, amber while trialing or
                    unpaid, grey with no subscription. A state other than active
                    is spelled out in it. */}
                <div className="min-w-0 space-y-1.5">
                  {/* The pill is the way into Manage Plans. */}
                  <button
                    type="button"
                    onClick={() => setShowSubscriptionDetail(true)}
                    title="Manage plans"
                    className="inline-flex h-8 max-w-full items-center gap-1 rounded-lg border border-border bg-background pl-3 pr-2 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 [&>*]:cursor-pointer"
                  >
                    {subscription ? (
                      <Badge
                        variant={
                          subscription.status === 'active' ? 'success'
                          : ['trialing', 'past_due'].includes(subscription.status) ? 'warning'
                          : ['unpaid', 'canceled', 'incomplete_expired'].includes(subscription.status) ? 'destructive'
                          : 'secondary'
                        }
                        className="gap-1.5 bg-transparent p-0 text-[13px]"
                      >
                        <span className="capitalize">{subscription.plan_name || 'Plan'}</span>
                        <span className="opacity-50">·</span>
                        <span className="tabular-nums">
                          {formatCurrency(subscription.amount, subscription.currency)}/{subscription.interval}
                        </span>
                        {subscription.status !== 'active' && (
                          <>
                            <span className="opacity-50">·</span>
                            <span className="capitalize">{subscription.status.replace(/_/g, ' ')}</span>
                          </>
                        )}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-transparent p-0 text-[13px] text-muted-foreground">No plan</Badge>
                    )}
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </button>
                  {currentDiscount && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500">
                      −{currentDiscount.percentOff != null
                        ? `${currentDiscount.percentOff}%`
                        : formatCurrency((currentDiscount.amountOff || 0) * 100, currentDiscount.currency || subscription?.currency || 'usd')} next invoice
                      <button
                        type="button"
                        onClick={handleRemoveDiscount}
                        disabled={discountBusy}
                        className="text-muted-foreground hover:text-red-500 disabled:opacity-50"
                        title="Remove discount"
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
                {/* Icon buttons; each one's name is its tooltip. */}
                <div className="flex items-center gap-1 [&>button]:size-8 [&>button]:rounded-full">
                  {/* Sales link. Deliberately NOT gated on a subscription
                      existing: the whole point is the tenant who has never
                      subscribed. Its state (live, expired) is in the tooltip
                      and the link panel above. */}
                  {(() => {
                    const label = subLinkBusy
                      ? 'Working…'
                      : subLinkLive
                        ? `Link live · ${subLinkRemaining}`
                        : (subLink?.status === 'expired' || (subLink?.status === 'pending' && subLinkExpiresMs > 0 && subLinkExpiresMs <= Date.now()))
                          ? 'Link expired · Regenerate'
                          : subLink
                            ? 'Generate subscription link'
                            : 'Generate first subscription link';
                    return (
                      <Button
                        size="icon"
                        variant={subLinkLive ? 'secondary' : 'outline'}
                        disabled={subLinkBusy}
                        onClick={handleGenerateLink}
                        title={label}
                        aria-label={label}
                      >
                        <Link2 className="size-4" />
                      </Button>
                    );
                  })()}
                  {/* Discount and Change price need a LIVE subscription: there is
                      no next invoice or ongoing rate on a dead one, and Change
                      price also needs a plan to move onto. */}
                  {subscription && ['active', 'trialing', 'past_due'].includes(subscription.status) && (
                    <Button size="icon" variant="outline" onClick={() => setShowDiscountModal(true)} title="Discount next invoice" aria-label="Discount next invoice">
                      <Percent className="size-4" />
                    </Button>
                  )}
                  {subscription && ['active', 'trialing', 'past_due'].includes(subscription.status) && plans.length > 0 && (
                    <Button size="icon" variant="outline" onClick={openRepriceModal} title="Change price" aria-label="Change price">
                      <Tag className="size-4" />
                    </Button>
                  )}
                  {/* The per-tenant blocker override: the icon says which block
                      is in force. */}
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => setShowGateDialog(true)}
                    title={tenant.subscription_gate_disabled ? 'Soft block' : 'Hard block'}
                    aria-label={tenant.subscription_gate_disabled ? 'Soft block' : 'Hard block'}
                  >
                    {tenant.subscription_gate_disabled ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                  </Button>
                  {/* Billing mode: the button names the current mode; a click
                      flips it. Going live still asks first. */}
                  {(() => {
                    const live = (tenant.subscription_stripe_mode || 'test') === 'live';
                    // Wrapped, so the row's icon-button sizing doesn't square it.
                    return (
                      <span className="ml-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={modeUpdating}
                        onClick={() => handleModeToggle('subscription_stripe', live ? 'test' : 'live')}
                        title={live ? 'Live billing. Click to switch to Test' : 'Test billing. Click to switch to Live'}
                        className={cn('h-8 rounded-lg px-3 text-[13px]', live ? 'text-success hover:text-success' : 'text-warning hover:text-warning')}
                      >
                        {live ? 'Live' : 'Test'}
                      </Button>
                      </span>
                    );
                  })()}
                </div>
              </div>
              {subscription && (
                <div className="mt-3 pt-2.5 border-t border-border/40 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
                  {subscription.current_period_end && (
                    <span>Period ends <span className="text-foreground font-medium">{formatDate(subscription.current_period_end)}</span></span>
                  )}
                  {subscription.card_last4 && (
                    <span className="inline-flex items-center gap-1.5">
                      Payment
                      <CardBrandIcon brand={subscription.card_brand} className="h-4 w-6" />
                      <span className="text-foreground font-medium tabular-nums">
                        ····{subscription.card_last4}
                      </span>
                    </span>
                  )}
                  {subscription.card_exp_month && subscription.card_exp_year && (
                    <span>Expires <span className="text-foreground font-medium">{String(subscription.card_exp_month).padStart(2, '0')}/{subscription.card_exp_year}</span></span>
                  )}
                  {subscription.stripe_customer_id && (
                    <span className="min-w-0 break-all">Customer <span className="text-foreground font-mono text-[11px]">{subscription.stripe_customer_id}</span></span>
                  )}
                </div>
              )}

              </>
            }
          />
        </div>
        {/* Right: how to get in, what they told us, and the team's sticky note. */}
        {/* Right: tabs. Overview (health, feedback, the team's sticky note),
            then support tickets, onboarding answers, consent and the
            timeline, each shown in place. */}
        <aside className="flex min-h-0 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-foreground/10">
          <div role="tablist" aria-label="Company panels" className="flex shrink-0 items-center gap-0.5 border-b border-border/60 p-1.5">
            {(
              [
                { id: 'overview', name: 'Overview', label: 'Overview', icon: <LayoutGrid className="size-4" /> },
                { id: 'tickets', name: 'Tickets', label: `Support tickets${openTickets.length ? ` · ${openTickets.length} open` : ''}`, icon: <LifeBuoy className="size-4" />, badge: openTickets.length },
                { id: 'onboarding', name: 'Onboarding', label: 'Onboarding answers', icon: <ListChecks className="size-4" /> },
                { id: 'consent', name: 'Consent', label: `Consent${policyLoading ? '' : ` · ${policyAcceptances.length} accepted`}`, icon: <Signature className="size-4" /> },
                { id: 'timeline', name: 'Timeline', label: 'Timeline', icon: <History className="size-4" /> },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={railTab === t.id}
                aria-label={t.label}
                title={t.label}
                onClick={() => setRailTab(t.id)}
                className={cn(
                  // The open tab grows and names itself; the rest stay icons.
                  // Together they always fill the bar.
                  'relative flex h-9 items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium outline-none transition-all duration-200 focus-visible:ring-3 focus-visible:ring-ring/30',
                  railTab === t.id
                    ? 'min-w-0 flex-1 bg-primary/10 px-3 text-primary'
                    : 'w-10 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {t.icon}
                {railTab === t.id && <span className="truncate">{t.name}</span>}
                {'badge' in t && t.badge > 0 && (
                  railTab === t.id ? (
                    <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-4 tabular-nums text-white">
                      {t.badge > 99 ? '99+' : t.badge}
                    </span>
                  ) : (
                    <span className="absolute -right-0.5 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-white ring-2 ring-card">
                      {t.badge > 99 ? '99+' : t.badge}
                    </span>
                  )
                )}
              </button>
            ))}
          </div>

          {/* One card: the tabs on top, the open tab's content under them. */}
          {railTab === 'overview' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
              <HealthFeedbackPanel tenantId={tenant.id} className="shrink-0" />
              <NotesPanel tenantId={tenant.id} className="flex-1" />
            </div>
          ) : railTab === 'timeline' ? (
            <div className="min-h-0 flex-1 overflow-y-auto [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent [&>div]:shadow-none [&>div]:ring-0">
              <TenantTimelineTab tenantId={tenant.id} />
            </div>
          ) : (
            <section className="min-h-0 flex-1 overflow-y-auto p-5">
              {railTab === 'tickets' ? (
                <>
                  <h2 className="mb-2 text-base font-semibold tracking-tight">Open support tickets</h2>
                  {openTickets.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">Nothing open.</p>
                  ) : (
                    <ul className="-mx-2">
                      {openTickets.map((t) => (
                        <li key={t.id}>
                          <a
                            href={`/admin/support?ticket=${t.id}`}
                            className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">{t.summary || 'No summary'}</span>
                              <span className="block text-xs text-muted-foreground">
                                {t.reference} · {formatDate(t.created_at)}
                              </span>
                            </span>
                            <span className={cn('text-xs font-medium', t.status === 'open' ? 'text-warning' : 'text-primary')}>
                              {t.status === 'open' ? 'Open' : 'In progress'}
                            </span>
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : railTab === 'onboarding' ? (
                <>
                  <h2 className="mb-1 text-base font-semibold tracking-tight">Onboarding answers</h2>
                  <OnboardingAnswers tenantId={tenant.id} companyName={tenant.company_name} />
                </>
              ) : (
                <>
                  <h2 className="mb-1 text-base font-semibold tracking-tight">Consent</h2>
                  <p className="mb-2 text-xs text-muted-foreground">Who accepted the privacy policy and terms. Hover a row for its IP.</p>
                      {policyLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-8 w-full" />
                          <Skeleton className="h-8 w-full" />
                        </div>
                      ) : policyAcceptances.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No one has accepted the privacy policy or terms yet.
                        </p>
                      ) : (
                        <ul className="divide-y divide-border/60">
                          {policyAcceptances.map((entry) => (
                            <li
                              key={entry.id}
                              className="flex items-baseline justify-between gap-3 py-2"
                              title={entry.ip_address ? `IP ${entry.ip_address}` : undefined}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">
                                  {entry.policy_type === 'privacy_policy' ? 'Privacy Policy' : 'Terms & Conditions'}
                                  <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">v{entry.version}</span>
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {entry.user_name || entry.user_email || 'No name'}
                                </p>
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground">{formatDate(entry.accepted_at)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                </>
              )}
            </section>
          )}

        </div>

          {/* Under the card, its full width, whatever tab is open. */}
          <Button
            variant="ghost"
            className="h-10 w-full shrink-0 gap-1.5 rounded-2xl bg-destructive/10 text-[13px] text-destructive shadow-none hover:bg-destructive/20 hover:text-destructive"
            onClick={() => setShowForceLogoutConfirm(true)}
          >
            <LogOut className="size-3.5" />
            Force logout all users
          </Button>
        </aside>
      </div>

      <EditCompanyDialog
        open={isEditing}
        onOpenChange={setIsEditing}
        tenant={tenant}
        onSaved={(patch) => setTenant((t) => (t ? ({ ...t, ...patch } as Tenant) : t))}
      />

      {/* Soft / hard subscription block for this tenant. */}
      <Dialog open={showGateDialog} onOpenChange={setShowGateDialog}>
        <DialogContent className="max-w-md rounded-3xl p-7">
          <DialogHeader>
            <DialogTitle>Subscription block</DialogTitle>
            <DialogDescription className="leading-relaxed">
              What an unpaid {tenant.company_name} meets. Soft: they keep their dashboard, with a
              dismissible reminder every 24 hours and a &ldquo;payment due&rdquo; bar that stays.
              Hard: the full-screen blocker. Their status, plans and billing stay the same either way.
            </DialogDescription>
          </DialogHeader>
          <ToggleTile
            label="Soft subscription block"
            checked={!!tenant.subscription_gate_disabled}
            on="Soft block: reminded, not locked out"
            off="Hard block: full-screen blocker"
            onChange={(v) => { if (!gateUpdating) void handleToggleSubscriptionGate(v); }}
          />
        </DialogContent>
      </Dialog>

      {/* Subscription Detail Dialog */}
      {/* One-time discount modal — next invoice only, then auto-reverts */}
      <Dialog open={showDiscountModal} onOpenChange={(o) => { if (!o) setShowDiscountModal(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="max-sm:px-6">One-time discount — next invoice only</DialogTitle>
            <DialogDescription>
              Applies to {tenant?.company_name}&rsquo;s very next invoice, then billing reverts to normal automatically. The plan is not changed.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const normalCents = subscription?.amount || 0;
            const cur = subscription?.currency || 'usd';
            const v = Number(discountValue) || 0;
            const valid = Number.isFinite(v) && v > 0 && (discountType !== 'percent' || v <= 100);
            const discountedCents = discountType === 'percent'
              ? Math.max(0, Math.round(normalCents * (1 - v / 100)))
              : Math.max(0, normalCents - Math.round(v * 100));
            return (
              <div className="space-y-4 py-1">
                <div className="space-y-1.5">
                  <Label className="text-xs">Discount type</Label>
                  <div className="inline-flex rounded-md border border-border p-0.5">
                    {(['percent', 'amount'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setDiscountType(t)}
                        className={cn(
                          'px-3 py-1 rounded text-xs font-medium transition-colors',
                          discountType === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {t === 'percent' ? 'Percentage' : 'Fixed amount'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{discountType === 'percent' ? 'Percentage off' : `Amount off (${cur.toUpperCase()})`}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={discountType === 'percent' ? 100 : undefined}
                    step="0.01"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === 'percent' ? '50' : '0.00'}
                  />
                </div>
                {subscription && valid && (
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Next invoice</span>
                      <span className="font-semibold">
                        {formatCurrency(discountedCents, cur)}{' '}
                        <span className="text-muted-foreground text-xs line-through">{formatCurrency(normalCents, cur)}</span>
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">Then reverts to {formatCurrency(normalCents, cur)}/{subscription.interval}.</p>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1 max-sm:flex-col-reverse max-sm:[&>button]:w-full">
                  <Button variant="outline" onClick={() => setShowDiscountModal(false)} disabled={discountBusy}>Cancel</Button>
                  <Button onClick={handleApplyDiscount} disabled={!valid || discountBusy}>
                    {discountBusy ? 'Applying…' : 'Apply discount'}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Reprice modal — changes the ONGOING rate, unlike the one-time discount above */}
      <Dialog open={showRepriceModal} onOpenChange={(o) => { if (!o) setShowRepriceModal(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change subscription price</DialogTitle>
            <DialogDescription>
              Sets {tenant?.company_name}&rsquo;s ongoing rate. It takes effect at their next renewal — nothing is charged or credited today, and the renewal date does not move.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const plan = plans.find((p) => p.id === repricePlanId) || null;
            const cur = plan?.currency || subscription?.currency || 'usd';
            const dollars = Number(repriceAmount);
            const valid = !!plan && Number.isFinite(dollars) && dollars > 0;
            const cents = valid ? Math.round(dollars * 100) : 0;
            const renews = subscription?.current_period_end
              ? new Date(subscription.current_period_end).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
              : null;
            return (
              <div className="space-y-4 py-1">
                {plans.length > 1 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Plan</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {plans.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => { setRepricePlanId(p.id); setRepriceAmount((p.amount / 100).toFixed(2)); }}
                          className={cn(
                            'px-3 py-1 rounded border text-xs font-medium transition-colors',
                            repricePlanId === p.id
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    New amount ({cur.toUpperCase()} per {plan?.interval || subscription?.interval || 'month'})
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={repriceAmount}
                    onChange={(e) => setRepriceAmount(e.target.value)}
                    placeholder="250.00"
                  />
                </div>
                {valid && (
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Today</span>
                      <span className="font-semibold">Nothing charged</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{renews ? `From ${renews}` : 'From next renewal'}</span>
                      <span className="font-semibold">
                        {formatCurrency(cents, cur)}/{plan?.interval || 'month'}{' '}
                        {subscription && cents !== subscription.amount && (
                          <span className="text-muted-foreground text-xs line-through">
                            {formatCurrency(subscription.amount, subscription.currency)}
                          </span>
                        )}
                      </span>
                    </div>
                    {currentDiscount && (
                      <p className="text-[11px] text-amber-600 pt-1">
                        A one-time discount is already queued, so their very next invoice still gets that — the new rate bills from the one after.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-1 max-sm:flex-col-reverse max-sm:[&>button]:w-full">
                  <Button variant="outline" onClick={() => setShowRepriceModal(false)} disabled={repriceBusy}>Cancel</Button>
                  <Button onClick={handleReprice} disabled={!valid || repriceBusy}>
                    {repriceBusy ? 'Applying…' : 'Change price'}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={showSubscriptionDetail} onOpenChange={setShowSubscriptionDetail}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Subscription Management</DialogTitle>
            <DialogDescription>Manage plans, view status, and invoices for {tenant.company_name}</DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-6 pt-2">
            {/* Plans */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-semibold">Subscription Plans</h3>
                <Button size="sm" onClick={openAddPlan}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Plan
                </Button>
              </div>
              {plansLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : plans.length === 0 ? (
                <EmptyState
                  size="section"
                  illustration={<PlansEmptyArt />}
                  headline="No plans for this company"
                  body="Add a plan to let this company subscribe. They choose from the plans listed here."
                  action={{ label: 'Add plan', onClick: openAddPlan }}
                />
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border/40">
                  {/* Scrolls sideways on a phone rather than squashing. */}
                  <Table className="max-md:min-w-[640px] max-md:[&_td:not(:first-child)]:whitespace-nowrap">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Interval</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plans.map((plan) => (
                        <TableRow key={plan.id}>
                          <TableCell>
                            <p className="font-medium text-sm">{plan.name}</p>
                            {plan.description && <p className="text-xs text-muted-foreground">{plan.description}</p>}
                          </TableCell>
                          <TableCell className="text-sm">{formatCurrency(plan.amount, plan.currency)}</TableCell>
                          <TableCell className="text-sm capitalize">
                            {plan.interval}
                            {plan.billing_model === 'upfront_monthly'
                              ? <Badge variant="secondary" className="ml-2 text-[10px]">upfront · 1st charge +1mo</Badge>
                              : plan.trial_days > 0 && <Badge variant="default" className="ml-2 text-[10px]">{plan.trial_days}d trial</Badge>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={plan.is_active ? 'success' : 'secondary'}>{plan.is_active ? 'Active' : 'Inactive'}</Badge>
                              {plan.active_subscriptions > 0 && <Badge variant="info">{plan.active_subscriptions} sub{plan.active_subscriptions > 1 ? 's' : ''}</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEditPlan(plan)}>Edit</Button>
                              <Button variant="ghost" size="sm" className={cn("h-7 text-xs", plan.is_active ? "text-amber-600" : "text-emerald-600")} onClick={() => handleTogglePlanActive(plan)}>
                                {plan.is_active ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600" disabled={plan.active_subscriptions > 0} onClick={() => handleDeletePlan(plan)}>Delete</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <Separator />

            {/* Current Subscription Status */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Current Subscription</h3>
              {subscriptionLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : subscription ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 [&>*]:min-w-0">
                  {[
                    { label: 'Status', value: <Badge variant={subscription.status === 'active' ? 'success' : subscription.status === 'past_due' ? 'destructive' : 'secondary'} className="capitalize">{subscription.status}</Badge> },
                    { label: 'Plan', value: <span className="capitalize">{subscription.plan_name}</span> },
                    { label: 'Amount', value: `${formatCurrency(subscription.amount, subscription.currency)}/${subscription.interval}` },
                    { label: 'Period', value: `${formatDate(subscription.current_period_start)} \u2013 ${formatDate(subscription.current_period_end)}` },
                    ...(subscription.card_last4 ? [{ label: 'Card', value: (
                      <span className="inline-flex items-center gap-2">
                        <CardBrandIcon brand={subscription.card_brand} className="h-5 w-[1.875rem]" />
                        <span className="tabular-nums">•••• {subscription.card_last4}</span>
                      </span>
                    ) }] : []),
                    { label: 'Created', value: formatDate(subscription.created_at) },
                  ].map((item) => (
                    <div key={item.label} className="space-y-1">
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{item.label}</span>
                      <div className="text-sm">{item.value}</div>
                    </div>
                  ))}
                </div>
              ) : subscriptionError ? (
                /* A failed read must never masquerade as "no subscription" —
                   that is a confident wrong answer an operator will act on. */
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <p className="font-medium">Could not load subscription</p>
                  <p className="mt-0.5 text-red-600">{subscriptionError}</p>
                  <button
                    type="button"
                    onClick={() => loadSubscription(params.id as string)}
                    className="mt-1.5 underline underline-offset-2"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No active subscription. Plan: <span className="capitalize">{tenant.subscription_plan || 'basic'}</span></p>
              )}
            </div>

            {/* Invoices */}
            {/* subscriptionError is checked here TOO, not only in the block
                above. The error banner up there only renders when `subscription`
                is falsy, so a tenant WITH a subscription whose invoice read
                failed showed a healthy subscription panel and simply no invoice
                table — the failure was completely invisible. */}
            {subscriptionError && invoices.length === 0 && (
              <>
                <Separator />
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Could not load invoices — {subscriptionError}
                </div>
              </>
            )}
            {invoices.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="text-sm font-semibold mb-3">Invoices</h3>
                  <div className="overflow-hidden rounded-2xl border border-border/40">
                    <Table className="max-md:min-w-[600px] max-md:[&_td]:whitespace-nowrap">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.map((invoice) => (
                          <TableRow key={invoice.id}>
                            <TableCell className="text-sm">{invoice.invoice_number || '\u2014'}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{formatDate((invoice as any).invoice_date || invoice.created_at)}</TableCell>
                            <TableCell className="text-sm">
                              {formatCurrency(invoice.amount_due, invoice.currency)}
                              {((invoice as any).amount_refunded ?? 0) > 0 && (
                                <span className="ml-1.5 text-xs text-orange-600">
                                  &minus;{formatCurrency((invoice as any).amount_refunded, invoice.currency)} refunded
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <InvoiceStatusBadge invoice={invoice} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {invoice.stripe_hosted_invoice_url && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                                    <a href={invoice.stripe_hosted_invoice_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3 mr-1" />View</a>
                                  </Button>
                                )}
                                {invoice.stripe_invoice_pdf && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                                    <a href={invoice.stripe_invoice_pdf} target="_blank" rel="noopener noreferrer"><Download className="w-3 h-3 mr-1" />PDF</a>
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Credits Detail Dialog */}
      <Dialog open={showCreditsDetail} onOpenChange={setShowCreditsDetail}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Credits Management</DialogTitle>
            <DialogDescription>View balances, adjust credits, and transaction history for {tenant.company_name}</DialogDescription>
          </DialogHeader>
          <div className="min-w-0 pt-2">
            <TenantCreditsTab tenantId={params.id as string} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Plan Modal */}
      <Dialog open={showPlanModal} onOpenChange={setShowPlanModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPlan ? 'Edit Plan' : 'Add Plan'}</DialogTitle>
            {editingPlan && editingPlan.active_subscriptions > 0 && (
              <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning ring-1 ring-warning/25 mt-2">
                This plan has {editingPlan.active_subscriptions} active subscriber{editingPlan.active_subscriptions > 1 ? 's' : ''}.
                Changing the price will only apply to new subscriptions.
              </div>
            )}
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Plan Name</Label>
              <Input
                value={planForm.name}
                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                placeholder="e.g., Starter, Pro, Enterprise"
              />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={planForm.description}
                onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                placeholder="Short description of the plan"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={planForm.amount}
                  onChange={(e) => setPlanForm({ ...planForm, amount: e.target.value })}
                  placeholder="200"
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={planForm.currency} onValueChange={(v) => setPlanForm({ ...planForm, currency: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usd">USD</SelectItem>
                    <SelectItem value="gbp">GBP</SelectItem>
                    <SelectItem value="eur">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Interval</Label>
                <Select value={planForm.interval} onValueChange={(v) => setPlanForm({ ...planForm, interval: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="year">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Billing Model</Label>
              <Select value={planForm.billingModel} onValueChange={(v) => setPlanForm({ ...planForm, billingModel: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">Free trial (then auto-charge)</SelectItem>
                  <SelectItem value="upfront_monthly">Upfront monthly — first charge 1 month after card entry (no free trial)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {planForm.billingModel === 'upfront_monthly'
                  ? 'Tenant hits a hard gate, enters their card, and is charged exactly one calendar month later (relative to entry), then monthly. Never shown as a free trial.'
                  : 'Tenant starts a free trial, then is auto-charged when it ends.'}
              </p>
            </div>

            {planForm.billingModel === 'trial' && (
              <div className="space-y-2">
                <Label>Trial Period (days)</Label>
                <Input
                  type="number"
                  min="0"
                  value={planForm.trialDays}
                  onChange={(e) => setPlanForm({ ...planForm, trialDays: e.target.value })}
                  placeholder="0 = no trial"
                />
                <p className="text-xs text-muted-foreground">Set to 0 for no trial. Customers enter card at checkout but aren&apos;t charged until trial ends.</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Features</Label>
              <div className="space-y-2">
                {planForm.features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="flex-1 px-3 py-1.5 bg-muted/50 border border-border/40 rounded-md text-sm">
                      {feature}
                    </span>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600" onClick={() => removeFeature(index)}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Input
                    value={newFeature}
                    onChange={(e) => setNewFeature(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())}
                    placeholder="Add a feature..."
                    className="text-sm"
                  />
                  <Button variant="outline" size="sm" onClick={addFeature}>Add</Button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="max-sm:gap-2">
            <Button variant="outline" onClick={() => setShowPlanModal(false)}>Cancel</Button>
            <Button onClick={handleSavePlan} disabled={planSaving}>
              {planSaving ? 'Saving...' : editingPlan ? 'Update Plan' : 'Create Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mode Switch Confirmation */}
      <Dialog open={showModeConfirm} onOpenChange={(open) => { if (!open) { setShowModeConfirm(false); setPendingModeChange(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Switch to Live Mode?</DialogTitle>
            <DialogDescription>
              {pendingModeChange?.type === 'stripe'
                ? 'This will enable real payments for this tenant. Real money will be charged.'
                : 'This will use the production Bonzah API. Real insurance policies will be issued.'}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm text-warning ring-1 ring-warning/25">
            Make sure everything is properly configured before switching.
          </div>
          <DialogFooter className="max-sm:gap-2">
            <Button variant="outline" onClick={() => { setShowModeConfirm(false); setPendingModeChange(null); }}>Cancel</Button>
            <Button onClick={confirmModeChange}>Yes, Switch to Live</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Logout Confirmation */}
      <ForceLogoutDialog
        open={showForceLogoutConfirm}
        onOpenChange={setShowForceLogoutConfirm}
        tenantId={tenant.id}
        companyName={tenant.company_name}
        onLogoutAll={handleForceLogout}
      />

      {/* Password reset — the super-admin way back in for a locked-out operator. */}
      <Dialog open={showPasswordReset} onOpenChange={(open) => { if (!open) { setShowPasswordReset(false); setPwResult(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reset login password</DialogTitle>
            <DialogDescription>
              For <strong className="text-foreground">{tenant.company_name}</strong>. Use this when the
              operator cannot receive the self-service reset email.
            </DialogDescription>
          </DialogHeader>

          {pwResult ? (
            /* Shown once. There is no second chance to read it, so the dialog
               says so plainly rather than letting someone close it and hunt. */
            <div className="space-y-3">
              <div className="rounded-2xl bg-success/10 px-4 py-3 text-sm ring-1 ring-success/25">
                <p className="font-medium text-foreground">Password reset for {pwResult.email}</p>
                <p className="mt-1 text-muted-foreground">
                  They will be asked to choose their own password when they sign in.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-xl bg-muted px-3 py-2 font-mono text-base tracking-wide">
                  {pwResult.password}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(pwResult.password);
                    toast.success('Copied');
                  }}
                >
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This password is not stored and cannot be shown again. Send it to them over a channel
                they already control, and ask them to change it once they are in.
              </p>
            </div>
          ) : pwLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading logins...</p>
          ) : pwUsers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              This company has no login accounts.
            </p>
          ) : (
            <div className="space-y-2">
              {pwUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 ring-1 ring-border/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{u.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.name || 'No name'} · {u.role}
                      {u.isActive ? '' : ' · inactive'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!u.canReset || pwResettingId === u.id}
                    onClick={() => void handleResetPassword(u.id)}
                    title={u.canReset ? 'Generate a new password' : 'This account has no login to reset'}
                  >
                    <KeyRound className="h-4 w-4" />
                    {pwResettingId === u.id ? 'Resetting...' : 'Reset'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="max-sm:gap-2">
            <Button variant="outline" onClick={() => { setShowPasswordReset(false); setPwResult(null); }}>
              {pwResult ? 'Done' : 'Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <DeleteTenantDialog
        tenant={showDeleteConfirm ? tenant : null}
        onOpenChange={setShowDeleteConfirm}
        onDeleted={() => router.push('/admin/rentals')}
      />
    </div>
  );
}
