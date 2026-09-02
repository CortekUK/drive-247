"use client";

import { useState, useEffect, useMemo, Fragment, Children, type ReactNode } from "react";
import { differenceInDays, format } from "date-fns";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { FileText, ArrowLeft, DollarSign, Plus, X, Send, Download, Ban, Check, AlertTriangle, AlertCircle, Loader2, Shield, ShieldCheck, CheckCircle, XCircle, ExternalLink, UserCheck, IdCard, Camera, FileSignature, Clock, Mail, RefreshCw, Trash2, Receipt, Percent, Car, Undo2, Truck, MapPin, Key, KeyRound, CalendarPlus, Package, Banknote, CreditCard, Calendar, Info, Copy, Gauge, Briefcase, Eye, EyeOff, Pencil, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { BlurredImage } from "@/components/ui/blurred-image";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { RefundDialog } from "@/components/shared/dialogs/refund-dialog";
import { ChargeDepositDialog } from "@/components/shared/dialogs/charge-deposit-dialog";
import { TakeDepositDialog } from "@/components/shared/dialogs/take-deposit-dialog";
import { AddHoldDialog } from "@/components/shared/dialogs/add-hold-dialog";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { isBonzahSellable, bonzahBlockedReason } from "@/lib/bonzah";
// integration_bonzah controls Bonzah-specific features only; insurance document upload is always available
import { useRentalTotals, useRentalCharges } from "@/hooks/use-rental-ledger-data";
import { useRentalInvoice, useRentalPaymentBreakdown, useRentalRefundBreakdown } from "@/hooks/use-rental-invoice";
import { useRentalManualPaidBreakdown } from "@/hooks/use-rental-manual-paid-breakdown";
import { RentalLedger } from "@/components/rentals/rental-ledger";
import { PaymentLinksPanel } from "@/components/payments/payment-links-panel";
import { useRentalPaymentLinks } from "@/hooks/use-payment-links";
import { KeyHandoverSection } from "@/components/rentals/key-handover-section";
import { KeyHandoverActionBanner } from "@/components/rentals/key-handover-action-banner";
import { DamageAnalysisCard } from "@/components/rentals/damage-analysis-card";
import { MileageSummaryCard } from "@/components/rentals/mileage-summary-card";
import { CancelRentalDialog } from "@/components/shared/dialogs/cancel-rental-dialog";
import RejectionDialog from "@/components/rentals/rejection-dialog";
import { EditPickupReturnDialog } from "@/components/rentals/edit-pickup-return-dialog";
import { SwapVehicleDialog } from "@/components/rentals/swap-vehicle-dialog";
import { BuyInsuranceDialog } from "@/components/rentals/buy-insurance-dialog";
import { useBonzahBalance } from "@/hooks/use-bonzah-balance";
import { useBonzahVehicleEligibility } from "@/hooks/use-bonzah-vehicle-eligibility";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/formatters";
import { formatCurrency as formatCurrencyUtil, getCurrencySymbol } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { getActiveCoverageLabels } from "@/lib/coverage-labels";
import { getPacificTomorrow } from "@/lib/bonzah-dates";
import { extractFunctionError } from "@/lib/edge-error";
import { usePickupLocations } from "@/hooks/use-pickup-locations";
import { LocationMap } from "@/components/ui/location-map";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useAuth } from "@/stores/auth-store";
import { useRentalAgreements } from "@/hooks/use-rental-agreements";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { AgreementTimeline } from "@/components/rentals/AgreementTimeline";
import { AdditionalDriversCard } from "@/components/rentals/additional-drivers-card";
import { useRentalInsurancePolicies } from "@/hooks/use-rental-insurance-policies";
import { InsuranceTimeline } from "@/components/rentals/InsuranceTimeline";
import { RentalInsuranceVerificationsCard } from "@/components/insurance/rental-insurance-verifications-card";

// Parse a Postgres DATE string ("YYYY-MM-DD") as local midnight. `new Date("2026-05-20")`
// is parsed as UTC midnight, which renders as the previous day in any timezone
// west of UTC — making extended end-dates appear "1 day short" on the rental page.
const parseLocalDate = (value: string | null | undefined): Date => {
  if (!value) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00`);
  return new Date(value);
};

// A Stripe pre-auth is NOT permanent: the bank releases the money after ~5-7
// days (up to 30 with extended authorization) and Stripe flips the
// PaymentIntent to `canceled`. Nothing in our webhook chain watches
// rentals.deposit_hold_payment_intent_id, so the row can sit on 'held' over a
// dead authorisation (GMT, Aug 2026 — "I cannot refresh the hold"). Until that
// gap closes the least we can do is put the death date in front of the
// operator, loudly once it's close.
const describeHoldExpiry = (
  expiresAt: string | null | undefined,
): { tone: 'ok' | 'soon' | 'past'; label: string } | null => {
  if (!expiresAt) return null;
  const ts = new Date(expiresAt);
  if (Number.isNaN(ts.getTime())) return null;

  const dateLabel = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const msLeft = ts.getTime() - Date.now();
  if (msLeft <= 0) return { tone: 'past', label: `Authorisation lapsed ${dateLabel}` };

  const hoursLeft = Math.floor(msLeft / 3_600_000);
  const daysLeft = Math.floor(hoursLeft / 24);
  const remaining =
    daysLeft >= 1
      ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
      : hoursLeft >= 1
        ? `${hoursLeft} hour${hoursLeft === 1 ? '' : 's'} left`
        : 'under an hour left';

  // 3 days is the practical warning window: it's the last point at which an
  // operator can still refresh the hold before a weekend swallows it.
  return { tone: daysLeft < 3 ? 'soon' : 'ok', label: `Authorisation expires ${dateLabel} · ${remaining}` };
};

// ── Reading verify-deposit-hold's answer ────────────────────────────────────
// Kept byte-for-byte in step with the copy in add-hold-dialog.tsx (two call
// sites, no shared module yet). `liveHold:false` is NOT the same as "resolved":
// the function returns it while a card is still authorising (requires_action)
// and when another worker owns the row ('processing'/'refreshing'), and in the
// latter case it still carries DEAD_HOLD_MESSAGES copy telling the operator to
// place a new hold. Only a conclusively dead status counts as resolved.
type VerifyOutcome = 'resolved' | 'live' | 'in_progress' | 'needs_review';

// Mirrors PI_STATUS_TO_HOLD_STATUS in supabase/functions/verify-deposit-hold:
// canceled -> expired, succeeded -> captured, requires_payment_method -> failed.
const CONCLUSIVELY_DEAD_HOLD_STATUSES = ['expired', 'captured', 'failed'];

const classifyVerify = (data: any): VerifyOutcome => {
  if (data?.verified !== true || data?.needsReview === true) return 'needs_review';
  // `!== false` (not `=== true`): a missing/renamed field must read as "live".
  if (data?.liveHold !== false) return 'live';
  return CONCLUSIVELY_DEAD_HOLD_STATUSES.includes(String(data?.status)) ? 'resolved' : 'in_progress';
};

const describeInProgressHold = (status: unknown): string =>
  `This deposit hold is still being worked on${status ? ` (currently ${status})` : ''} — either the card is still authorising or another update is finishing it off. Nothing was changed. Check again in a moment rather than placing a second hold.`;

// ── Reading refresh-deposit-holds' answer ───────────────────────────────────
// Mirrors `RefreshResult` in supabase/functions/_shared/deposit-hold-refresh.ts.
// 'released', 'skipped', 'lost_race' and 'chain_expired' are CORRECT outcomes,
// not failures — the cron driver deliberately keeps them out of its failure
// count, and a toast that shouted "failed" at them would train an operator to
// ignore the ones that matter.
const REFRESH_PROBLEM_RESULTS = ['failed', 'needs_review', 'requires_action', 'config_unavailable'];

const REFRESH_RESULT_TITLES: Record<string, string> = {
  refreshed: 'Hold refreshed',
  released: 'Hold released',
  skipped: 'Nothing to do',
  lost_race: 'Another update got there first',
  chain_expired: 'Chain has reached its end',
  failed: 'Refresh failed',
  requires_action: 'Card needs the customer',
  needs_review: 'Needs a closer look',
  config_unavailable: 'Left untouched — configuration problem',
};

// The refresh driver applies the SAME due-filters to a single-rental dispatch
// as it does to the nightly run: deadline lookahead, retry backoff, chain end,
// terminal rental statuses. A hold with weeks left, or a failed row still
// inside its backoff window, is legitimately not due — the run then reports
// zero, and that must read as "nothing needed doing", never as a silent
// failure.
const NOTHING_DUE_MESSAGE =
  'Nothing needed refreshing on this rental right now. The chain only re-authorises a hold as its deadline approaches, a failed hold waits out its retry backoff first, and a hold that never authorised successfully has nothing to re-drive — use "Add Hold" for that. Use "Check with Stripe" if the status itself looks wrong.';

/**
 * The Pre-Auth Hold row's non-money actions, collapsed behind a kebab (⋯).
 *
 * The Action column gives every other row ONE control. This row had four text
 * actions plus a bell competing for the same right-aligned gutter, which left
 * the two that matter at vehicle return — Release and Charge — no more
 * prominent than a diagnostic. So the split is by consequence, not by
 * frequency: anything that moves money or places an authorisation (Release,
 * Charge, Refresh & Charge, Add Hold, Send card link) stays inline and one
 * click; the reconcile/retry pair, which an operator reaches for only when
 * something looks wrong, moves in here.
 *
 * This is a component, not inline JSX, because the deposit row renders that
 * pair from three mutually-exclusive deposit_hold_status blocks (held/expired,
 * processing/refreshing/failed, requires_action/needs_review). They had already
 * started to drift — the two Force refresh buttons carry different tooltips —
 * and hand-rolling a fourth copy of the markup would guarantee more of it.
 *
 * Permission gates are NOT decided here, and that is deliberate. The menu takes
 * its items as CHILDREN so each `canEdit('rentals')` / `isAdmin()` predicate
 * stays written out at the branch it has always guarded, next to the comment
 * explaining it — rather than being hoisted into one clever row-level boolean
 * where a later edit could widen it for every status at once. Two rules follow:
 *   - a gated-out action is ABSENT, never rendered disabled. Collapsing a
 *     control into a menu must not change who can reach it.
 *   - if every child is gated out, the trigger itself does not render, because
 *     a ⋯ that opens onto nothing is worse than the clutter it replaced. That
 *     is what the Children.toArray count below is for: React drops the `false`
 *     a failed `cond && <Item/>` leaves behind, so an empty array means every
 *     gate said no.
 *
 * Every handler stops propagation: the table row is itself clickable, so a
 * click that escapes navigates the operator away instead of opening the menu.
 */
function HoldActionsMenu({
  emphasizeTrigger = false,
  triggerLabel,
  busy = false,
  busyLabel,
  children,
}: {
  /** needs_review has no other way out of the status, so the closed trigger
   *  inherits the find-me styling its inline button used to carry. Without it,
   *  the one status whose entire job is a single action would be the one status
   *  drawn as an unremarkable grey dot. */
  emphasizeTrigger?: boolean;
  /** Text beside the ⋯ for statuses where the menu is the ONLY exit. An
   *  unlabelled icon is fine when it holds extras next to a visible Release /
   *  Charge; it is not fine when it is the single thing an operator must find
   *  (needs_review). Costs a few pixels on one status, saves a support call. */
  triggerLabel?: string;
  /** Radix closes the menu on select, so once an action starts the row would
   *  otherwise show NOTHING while it runs — the item's "Checking…" spinner is
   *  behind a click the operator just dismissed. That reads as a dead button and
   *  invites a second click on a money-adjacent action, so the closed trigger
   *  carries the in-flight state itself. */
  busy?: boolean;
  busyLabel?: string;
  children?: ReactNode;
}) {
  if (Children.toArray(children).length === 0) return null;

  const label = busy ? (busyLabel ?? triggerLabel) : triggerLabel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={busy ? (busyLabel ?? "Working…") : "More actions"}
          aria-busy={busy || undefined}
          title={busy ? (busyLabel ?? "Working…") : "More actions"}
          className={cn(
            "inline-flex items-center justify-center gap-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted/60 data-[state=open]:text-foreground",
            label && "px-2 text-xs font-medium",
            emphasizeTrigger &&
              "border border-indigo-500/40 bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 hover:text-indigo-500 data-[state=open]:bg-indigo-500/20 data-[state=open]:text-indigo-500",
            busy && "text-indigo-500",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {busy ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MoreHorizontal className="h-4 w-4" />
          )}
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" onClick={(e) => e.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One item in the hold kebab: the action's label over a muted one-line gloss of
 * what it will actually do.
 *
 * `spinning` / `disabled` are separate props because they are separate ideas —
 * the label already carries the in-flight wording ("Checking…"), and an item can
 * legitimately be busy without the caller wanting it clickable-through.
 *
 * `title` is the original button's tooltip, passed through verbatim. The kebab
 * hides these actions behind one more click, so the sentence that explained what
 * each one does is worth MORE here than it was inline, not less.
 */
function HoldMenuAction({
  tone,
  label,
  description,
  title,
  spinning = false,
  disabled = false,
  onSelect,
}: {
  tone: string;
  label: string;
  description: string;
  title: string;
  spinning?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      className="flex-col items-start gap-0.5 py-2"
      disabled={disabled}
      title={title}
      // Radix turns Enter/Space on a focused item into a click, so this one
      // handler serves pointer and keyboard alike. The stopPropagation is not
      // belt-and-braces: DropdownMenuContent portals out of the <tr>, but the
      // row's onClick is the kind of thing that gets re-parented later.
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <span className={cn("inline-flex items-center gap-2 text-xs font-medium", tone)}>
        <RefreshCw className={`h-3 w-3 ${spinning ? 'animate-spin' : ''}`} />
        {label}
      </span>
      <span className="pl-5 text-[11px] text-muted-foreground">{description}</span>
    </DropdownMenuItem>
  );
}

// Format a Postgres TIME value ("HH:MM" or "HH:MM:SS") into 12-hour clock
// notation ("10:30 AM"). Returns null when the value is missing so callers
// can decide whether to render the line at all.
const formatTimeOfDay = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour24 = Number(match[1]);
  const minutes = match[2];
  if (Number.isNaN(hour24) || hour24 < 0 || hour24 > 23) return null;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${hour12}:${minutes} ${period}`;
};

interface Rental {
  id: string;
  start_date: string;
  end_date: string;
  rental_period_type?: string;
  monthly_amount: number;
  status: string;
  computed_status?: string;
  document_status?: string;
  docusign_envelope_id?: string;
  signed_document_id?: string;
  boldsign_mode?: string;
  insurance_status?: string;
  payment_mode?: string;
  approval_status?: string;
  payment_status?: string;
  cancellation_reason?: string;
  cancellation_requested?: boolean;
  customer_id?: string;
  customers: { id: string; name: string; email?: string; phone?: string | null };
  vehicles: { id: string; reg: string; make: string; model: string; status?: string; lockbox_code?: string | null; lockbox_instructions?: string | null; daily_rent?: number | null; weekly_rent?: number | null; monthly_rent?: number | null };
  // Location fields
  pickup_location?: string | null;
  pickup_location_id?: string | null;
  return_location?: string | null;
  return_location_id?: string | null;
  pickup_time?: string | null;
  return_time?: string | null;
  delivery_fee?: number;
  collection_fee?: number;
  // Legacy delivery fields
  uses_delivery_service?: boolean;
  delivery_location_id?: string;
  delivery_address?: string;
  delivery_method?: string | null;
  collection_location_id?: string;
  collection_address?: string;
  previous_end_date?: string | null;
  original_end_date?: string | null;
  // Renewal fields
  renewed_from_rental_id?: string | null;
  // Insurance fields
  bonzah_policy_id?: string | null;
  // Gig driver
  is_gig_driver?: boolean;
  // Pay As You Go
  // Security deposit pre-auth hold. These live on the rental, NOT on payments —
  // which is exactly why an expiring Stripe authorisation goes unnoticed (the
  // webhooks only look PaymentIntents up in payments.stripe_payment_intent_id).
  deposit_hold_status?: string | null;
  deposit_hold_amount?: number | null;
  deposit_hold_expires_at?: string | null;
  deposit_hold_payment_intent_id?: string | null;
  deposit_amount_override?: number | null;
  // Set when staff created this rental for a customer who never passed ID
  // verification. Declared here so the amber banner below is reading a
  // documented field rather than an untyped one — the query is a nested
  // select whose result infers loosely, so these are the only written record
  // of the shape this page relies on.
  id_verification_waived?: boolean | null;
  id_verification_waived_reason?: string | null;
  id_verification_waived_by?: string | null;
  id_verification_waived_at?: string | null;
}

function LocationCard({ type, address, location, fee, time, currencyCode }: {
  type: 'pickup' | 'return';
  address: string;
  location: { name: string; description?: string | null } | null;
  fee: number | null | undefined;
  time: string | null | undefined;
  currencyCode: string;
}) {
  const [copied, setCopied] = useState(false);
  const isPickup = type === 'pickup';
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mapsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="bg-muted/20 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${isPickup ? 'bg-emerald-500/15' : 'bg-blue-500/15'}`}>
          <MapPin className={`w-3.5 h-3.5 ${isPickup ? 'text-emerald-500' : 'text-blue-500'}`} />
        </div>
        <p className={`text-xs font-semibold uppercase tracking-wider ${isPickup ? 'text-emerald-500' : 'text-blue-500'}`}>{isPickup ? 'Pickup' : 'Return'}</p>
      </div>
      {location && <p className="font-semibold text-sm mb-0.5">{location.name}</p>}
      <p className="text-sm">{address}</p>
      {location?.description && (
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-1.5">
          <Info className="w-3 h-3 flex-shrink-0" />
          {location.description}
        </p>
      )}
      {(time || (fee != null && fee > 0)) && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/50 text-xs">
          {time && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" />
              {time}
            </span>
          )}
          {fee != null && fee > 0 && (
            <span className="font-semibold text-amber-500">
              +{formatCurrencyUtil(Number(fee), currencyCode)} {isPickup ? 'delivery' : 'collection'}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
        <span className="text-border">|</span>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Open in Maps
        </a>
      </div>
    </div>
  );
}

function LocationActionButtons({ pickupAddress, returnAddress, pickupLoc, returnLoc, pickupFee, returnFee, rental, currencyCode }: {
  pickupAddress: string | null | undefined;
  returnAddress: string | null | undefined;
  pickupLoc: { name: string; description?: string | null } | null;
  returnLoc: { name: string; description?: string | null } | null;
  pickupFee: number | null | undefined;
  returnFee: number | null | undefined;
  rental: { pickup_time?: string | null; return_time?: string | null };
  currencyCode: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {pickupAddress && (
        <LocationCard
          type="pickup"
          address={pickupAddress}
          location={pickupLoc}
          fee={pickupFee}
          time={rental.pickup_time}
          currencyCode={currencyCode}
        />
      )}
      {returnAddress && (
        <LocationCard
          type="return"
          address={returnAddress}
          location={returnLoc}
          fee={returnFee}
          time={rental.return_time}
          currencyCode={currencyCode}
        />
      )}
    </div>
  );
}

const RentalDetail = () => {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  // Charged-deposit tenants take the deposit as real money (a 'Security Deposit'
  // ledger Charge, refundable in full or in part). Hold tenants ring-fence it on
  // the card instead, which is what every deposit_hold_* branch below serves.
  const depositIsChargedTenant = tenant?.deposit_charge_enabled === true;
  const { canEdit } = useManagerPermissions();
  // `isAdmin()` covers head_admin + admin, and super admins too — the auth
  // store rewrites a super admin's role to 'head_admin' when loading the
  // profile. It also returns false for an inactive account. Used to gate the
  // Force-refresh action, which re-drives a DESTRUCTIVE money path.
  const { isAdmin } = useAuth();
  const { settings: rentalSettings } = useRentalSettings();
  const { balanceNumber: bonzahCdBalance, isBonzahConnected, portalUrl: bonzahPortalUrl } = useBonzahBalance();
  // Buying a NEW policy also requires that Bonzah can issue real cover — test
  // mode would produce a sandbox policy. Viewing/downloading existing policies
  // below is deliberately left alone.
  const bonzahCanSell = isBonzahConnected && isBonzahSellable(tenant);
  const bonzahSellBlockedReason = !isBonzahConnected
    ? 'Connect Bonzah in Settings → Integrations first'
    : bonzahBlockedReason(tenant);
  const { data: rentalAgreements = [], isLoading: loadingAgreements } = useRentalAgreements(id);
  const { data: insurancePolicies = [], isLoading: isLoadingInsurancePolicies } = useRentalInsurancePolicies(id);
  // skipInsurance removed — insurance doc upload is always visible; only Bonzah selector is gated on integration_bonzah
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [sendingDocuSign, setSendingDocuSign] = useState(false);
  const [checkingDocuSignStatus, setCheckingDocuSignStatus] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showRejectionDialog, setShowRejectionDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showDocuSignWarning, setShowDocuSignWarning] = useState(false);
  const [showInsuranceWarning, setShowInsuranceWarning] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSensitiveInfo, setShowSensitiveInfo] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [loadingDocuSignDoc, setLoadingDocuSignDoc] = useState(false);

  // Refund dialog states
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [refundCategory, setRefundCategory] = useState<string>("");
  const [refundTotalAmount, setRefundTotalAmount] = useState(0);
  const [refundPaidAmount, setRefundPaidAmount] = useState(0);

  // Undo manual payment dialog state
  const [showUndoDialog, setShowUndoDialog] = useState(false);
  const [undoCategory, setUndoCategory] = useState<string>("");
  const [undoAmount, setUndoAmount] = useState(0);
  const [isUndoing, setIsUndoing] = useState(false);


  // Edit pickup/return dialog state
  const [showEditPickupReturn, setShowEditPickupReturn] = useState(false);
  const [showSwapVehicle, setShowSwapVehicle] = useState(false);


  // Buy Insurance dialog state
  const [showBuyInsurance, setShowBuyInsurance] = useState(false);
  const [insurancePaymentMode, setInsurancePaymentMode] = useState(false);
  const [insurancePaymentAmount, setInsurancePaymentAmount] = useState<number | undefined>();
  const [insurancePaymentCategories, setInsurancePaymentCategories] = useState<string[]>(['Insurance']);

  // Targeted payment selection state
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedExtCategories, setSelectedExtCategories] = useState<Set<string>>(new Set());
  const [showTargetedPayment, setShowTargetedPayment] = useState(false);
  const [showTakeDeposit, setShowTakeDeposit] = useState(false);
  // Amount agreed in TakeDepositDialog, carried into the payment dialog so it
  // does not depend on the breakdown query having refetched yet.
  const [depositPaymentAmount, setDepositPaymentAmount] = useState<number | null>(null);

  // Excess mileage deduction dialog state
  const [showDeductFromDepositDialog, setShowDeductFromDepositDialog] = useState(false);
  const [isDeductingDeposit, setIsDeductingDeposit] = useState(false);
  const [isSendingPaymentLink, setIsSendingPaymentLink] = useState(false);


  const { locations: allLocations } = usePickupLocations();

  const { data: rental, isLoading, error: rentalError } = useQuery({
    queryKey: ["rental", id, tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error("No tenant context");

      const { data, error } = await supabase
        .from("rentals")
        .select(`
          *,
          customers!rentals_customer_id_fkey(id, name, email, phone),
          vehicles!rentals_vehicle_id_fkey(id, reg, make, model, status, lockbox_code, lockbox_instructions, daily_rent, weekly_rent, monthly_rent)
        `)
        .eq("id", id)
        .eq("tenant_id", tenant.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Rental not found");
      if (!data.customers) throw new Error("Rental customer not found");
      return data as Rental;
    },
    enabled: !!id && !!tenant?.id,
    // Poll every 5s while DocuSign is pending (sent but not yet signed)
    refetchInterval: (query) => {
      const d = query.state.data as Rental | undefined;
      const isPending =
        !!d?.docusign_envelope_id &&
        d?.document_status !== 'signed' &&
        d?.document_status !== 'completed' &&
        !d?.signed_document_id;
      return isPending ? 5000 : false;
    },
  });

  // Check Bonzah vehicle eligibility (only queries when rental + Bonzah integration exist)
  const { isEligible: isBonzahEligible, isLoading: isBonzahEligibilityLoading } = useBonzahVehicleEligibility({
    vehicleMake: rental?.vehicles?.make || null,
    vehicleModel: rental?.vehicles?.model || null,
    enabled: !!rental?.vehicles && isBonzahConnected,
  });

  const { data: rentalTotals } = useRentalTotals(id);

  // What a deposit raised on this rental should default to. A per-rental
  // override wins when set (including an explicit 0, which means the operator
  // opted out); otherwise the tenant's configured amount. Charged deposits are
  // a single global amount by design — no per-vehicle variant.

  const depositDefaultAmount = (() => {
    const override = (rental as any)?.deposit_amount_override;
    if (override !== null && override !== undefined) return Number(override) || 0;
    return Number(tenant?.global_deposit_amount) || 0;
  })();
  // Direct payments-table sum — counts received money regardless of allocation.
  // Counts received money regardless of allocation.
  const { data: rentalPaymentsTotal = 0 } = useQuery({
    queryKey: ['rental-payments-total', tenant?.id, id],
    queryFn: async () => {
      if (!id) return 0;
      // Count only money actually received. 'Credit' = unallocated prepayment.
      // 'Pending' = Stripe checkout created but not paid, do NOT count.
      const { data, error } = await supabase
        .from('payments')
        .select('amount, status')
        .eq('rental_id', id)
        .in('status', ['Applied', 'Credit', 'Partial']);
      if (error) throw error;
      return (data || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    },
    enabled: !!id && !!tenant?.id,
    staleTime: 5000,
  });
  const { data: rentalCharges } = useRentalCharges(id);
  const { data: rawInvoiceBreakdown } = useRentalInvoice(id);
  const { data: paymentBreakdown, isLoading: isPaymentBreakdownLoading } = useRentalPaymentBreakdown(id);
  // Does this rental carry a legacy authorisation? A tenant can be switched to
  // charged deposits while rentals created under the old model still hold a LIVE
  // hold. Treating those as "charged" hides the hold actions and leaves the
  // authorisation unreleasable — the renter's funds stay ring-fenced with no way
  // out from the UI.
  const depositHoldPresent =
    !!(rental as any)?.deposit_hold_payment_intent_id ||
    (!!rental?.deposit_hold_status && rental.deposit_hold_status !== 'released');

  // Treat the row as CHARGED when the money really was charged — i.e. a
  // 'Security Deposit' ledger charge exists — or when the tenant is on charged
  // deposits and there is no legacy hold to manage. Keying off the ledger as
  // well as the flag makes this survive the flag being switched back OFF: a
  // deposit that was already taken and part-refunded must keep its Refund
  // action, not silently revert to hold wording with no way to return the money.
  const depositHasLedgerCharge = Number(paymentBreakdown?.['Security Deposit']?.total ?? 0) > 0;
  const depositIsCharged =
    depositHasLedgerCharge || (depositIsChargedTenant && !depositHoldPresent);
  const { data: paymentLinks, isLoading: paymentLinksLoading } = useRentalPaymentLinks(id);

  const { data: refundData } = useRentalRefundBreakdown(id);
  const refundBreakdown = refundData?.categoryRefunds || null;
  const chargeRefunds = refundData?.chargeRefunds || {};
  const { data: manualPaidByCategory } = useRentalManualPaidBreakdown(id);

  // Ledger-billed rentals have no upfront invoice — synthesise an
  // invoice-shaped object from the ledger-entry sums so the regular Payment
  // Breakdown card (incl. the per-extension accordion) can render with all the
  // same categories, refund controls, pay-selected buttons, etc. Regular rentals
  // keep using the real invoice row untouched.
  const invoiceBreakdown = useMemo(() => {
    if (rawInvoiceBreakdown) return rawInvoiceBreakdown;
    // No real invoice: synthesise from the ledger when charges exist without
    // an upfront invoice row.
    const billsViaLedger = rentalCharges && rentalCharges.length > 0;
    if (!billsViaLedger) return null;

    const sumBy = (cat: string) =>
      (rentalCharges || [])
        .filter((c: any) => c.category === cat)
        .reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);

    const rentalFee = sumBy('Rental');
    const taxAmount = sumBy('Tax');
    const serviceFee = sumBy('Service Fee');
    const insurancePremium = sumBy('Insurance');
    const deliveryFee = sumBy('Delivery Fee');
    const extrasTotal = sumBy('Extras');

    return {
      id: 'ledger-synthetic',
      rentalFee,
      taxAmount,
      serviceFee,
      securityDeposit: 0,
      insurancePremium,
      deliveryFee,
      extrasTotal,
      totalAmount: rentalFee + taxAmount + serviceFee + insurancePremium + deliveryFee + extrasTotal,
      status: 'active',
    } as typeof rawInvoiceBreakdown;
  }, [rawInvoiceBreakdown, rental, rentalCharges]);

  // Map of category → remaining unpaid amount (combines ledger charges + invoice fallback)
  const categoryRemainingAmounts = useMemo(() => {
    const amounts: Record<string, number> = {};
    // Track which categories have ledger data (even if fully paid / remaining === 0)
    const hasLedgerData = new Set<string>();

    // First, populate from ledger payment breakdown (most accurate)
    if (paymentBreakdown) {
      for (const [cat, data] of Object.entries(paymentBreakdown)) {
        hasLedgerData.add(cat);
        if (data.remaining > 0) {
          amounts[cat] = data.remaining;
        }
      }
    }

    // Then, fill in from invoice breakdown for categories without ledger entries
    if (invoiceBreakdown) {
      const insuranceCharge = (rentalCharges || []).find((c: any) => c.category === 'Insurance');
      const collectionCharge = (rentalCharges || []).find((c: any) => c.category === 'Collection Fee');
      // On the CHARGED-deposit path the deposit is genuinely money owed, so it
      // belongs in the invoice fallback like any other category. On the HOLD path
      // it must stay out: 12 hold-era invoices still carry a non-zero
      // security_deposit that was only ever an instruction to Stripe about how
      // much to ring-fence, never a debt — including it would inflate Balance Due.
      const invoiceCategoryMap: Record<string, number> = {
        'Rental': invoiceBreakdown.rentalFee,
        'Tax': invoiceBreakdown.taxAmount,
        'Insurance': insuranceCharge?.amount ?? invoiceBreakdown.insurancePremium ?? 0,
        'Service Fee': invoiceBreakdown.serviceFee,
        'Delivery Fee': rental?.delivery_fee || invoiceBreakdown.deliveryFee || 0,
        'Collection Fee': collectionCharge ? Number(collectionCharge.amount) : (rental?.collection_fee ?? 0),
        'Extras': invoiceBreakdown.extrasTotal ?? 0,
        ...(tenant?.deposit_charge_enabled === true
          ? { 'Security Deposit': invoiceBreakdown.securityDeposit ?? 0 }
          : {}),
      };

      for (const [cat, invoiceAmount] of Object.entries(invoiceCategoryMap)) {
        if (amounts[cat] !== undefined || hasLedgerData.has(cat)) continue; // already have ledger data (paid or outstanding)
        if (invoiceAmount <= 0) continue;
        const refunded = refundBreakdown?.[cat] ?? 0;
        const remaining = invoiceAmount - refunded;
        if (remaining > 0) {
          amounts[cat] = remaining;
        }
      }
    }

    return amounts;
  }, [paymentBreakdown, invoiceBreakdown, rentalCharges, rental, refundBreakdown, tenant?.deposit_charge_enabled]);

  // Auto-refresh payment data when tab regains focus (e.g. after Stripe checkout in new tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && id) {
        queryClient.invalidateQueries({ queryKey: ['rental-totals'] });
        queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] });
        queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
        queryClient.invalidateQueries({ queryKey: ['rental-refund-breakdown'] });
        queryClient.invalidateQueries({ queryKey: ['rental-invoice'] });
        queryClient.invalidateQueries({ queryKey: ['rental', id] });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [id, queryClient]);

  // Realtime invalidation — when the customer pays from the booking portal,
  // ledger_entries / payments / payment_applications change. Listen for those
  // changes on this rental and invalidate the cached payment queries so the
  // admin tab reflects the new state without needing a manual refresh.
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`rental-payments-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_entries', filter: `rental_id=eq.${id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['rental-totals'] });
        queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] });
        queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
        queryClient.invalidateQueries({ queryKey: ['rental-refund-breakdown'] });
        queryClient.invalidateQueries({ queryKey: ['rental-invoice'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `rental_id=eq.${id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['rental-totals'] });
        queryClient.invalidateQueries({ queryKey: ['rental-payments'] });
        queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_applications' }, () => {
        queryClient.invalidateQueries({ queryKey: ['rental-totals'] });
        queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
        queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rentals', filter: `id=eq.${id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['rental', id] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  // Handle ?payment=success|cancelled — ensure Stripe payment is allocated after checkout
  const [paymentProcessed, setPaymentProcessed] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{ status: 'success' | 'failed' | 'cancelled'; message: string } | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(() => {
    // Initialize from URL so the banner shows immediately on page load
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('payment') === 'success';
    }
    return false;
  });
  useEffect(() => {
    const paymentStatus = searchParams?.get('payment');
    if (!paymentStatus || !id || paymentProcessed) return;

    // Handle cancelled/failed payments
    if (paymentStatus === 'cancelled') {
      setPaymentProcessed(true);
      setPaymentResult({ status: 'cancelled', message: 'Payment was cancelled. The customer did not complete checkout.' });
      router.replace(`/rentals/${id}`);
      return;
    }

    if (paymentStatus !== 'success' || !tenant?.id) return;

    setPaymentProcessed(true);
    setIsProcessingPayment(true);

    const processStripePayment = async () => {
      try {
        // Read targetCategories: try localStorage first, then fall back to payment record
        const storedCategories = localStorage.getItem(`payment_target_categories_${id}`);
        let targetCategories = storedCategories ? JSON.parse(storedCategories) : undefined;
        localStorage.removeItem(`payment_target_categories_${id}`);

        // Find the most recent Stripe payment for this rental (any status — webhook may have already updated it)
        const { data: stripePayment } = await supabase
          .from('payments')
          .select('id, stripe_checkout_session_id, stripe_payment_intent_id, status, remaining_amount, amount, target_categories')
          .eq('rental_id', id)
          .not('stripe_checkout_session_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!stripePayment) {
          setIsProcessingPayment(false);
          router.replace(`/rentals/${id}`);
          return;
        }

        // If localStorage didn't have targetCategories, read from payment record
        if (!targetCategories && stripePayment.target_categories) {
          targetCategories = stripePayment.target_categories as string[];
        }

        // If still Pending, update to Completed (webhook hasn't fired yet)
        if (stripePayment.status === 'Pending') {
          if (!stripePayment.stripe_payment_intent_id && stripePayment.stripe_checkout_session_id) {
            await supabase.functions.invoke('sync-payment-intent', {
              body: {
                paymentId: stripePayment.id,
                checkoutSessionId: stripePayment.stripe_checkout_session_id,
                tenantId: tenant.id,
              },
            });
          }

          await supabase
            .from('payments')
            .update({
              status: 'Completed',
              capture_status: 'captured',
              verification_status: 'auto_approved',
              updated_at: new Date().toISOString(),
            })
            .eq('id', stripePayment.id);
        }

        // Wait for webhook to process the payment allocation (3 attempts, 2s each)
        let allocated = false;
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const { data: apps } = await supabase
            .from('payment_applications')
            .select('id')
            .eq('payment_id', stripePayment.id)
            .limit(1);
          if (apps && apps.length > 0) {
            allocated = true;
            break;
          }
        }

        // If webhook didn't allocate, call apply-payment as fallback
        // apply-payment uses a DB unique index on payment ledger entries to prevent double-processing
        if (!allocated) {
          await supabase.functions.invoke('apply-payment', {
            body: {
              paymentId: stripePayment.id,
              ...(targetCategories && targetCategories.length > 0 ? { targetCategories } : {}),
            },
          });
        }

        // Charge-via-Stripe path: we just collected the customer's card, so
        // auto-place the deposit hold now. Record Payment (manual) still
        // leaves the hold off — admin uses the Add Hold button for that case.
        // Skipped when the rental already has an active hold or the tenant
        // doesn't have security deposits enabled.
        if (rental?.deposit_hold_status !== 'held') {
          try {
            const { data: holdData, error: holdError } = await supabase.functions.invoke('place-deposit-hold', {
              body: { rentalId: id, tenantId: tenant.id },
            });
            if (holdError) {
              console.warn('[DEPOSIT-HOLD] Failed:', holdError);
            } else {
              console.log('[DEPOSIT-HOLD] Placed:', holdData);
            }
          } catch (holdErr) {
            console.warn('[DEPOSIT-HOLD] Non-blocking error:', holdErr);
          }
        }

        // Refresh all payment-related queries and wait for them to settle
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['rental-totals'] }),
          queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] }),
          queryClient.invalidateQueries({ queryKey: ['rental-charges'] }),
          queryClient.invalidateQueries({ queryKey: ['rental-refund-breakdown'] }),
          queryClient.invalidateQueries({ queryKey: ['rental-invoice'] }),
          queryClient.invalidateQueries({ queryKey: ['rental', id] }),
          queryClient.invalidateQueries({ queryKey: ['rental-payments'] }),
          queryClient.invalidateQueries({ queryKey: ['excess-mileage-charge'] }),
          queryClient.invalidateQueries({ queryKey: ['key-handovers-mileage'] }),
        ]);

        setPaymentResult({ status: 'success', message: 'Stripe payment has been processed and applied successfully.' });
      } catch (err: any) {
        console.error('Error processing Stripe payment:', err);
        setPaymentResult({ status: 'failed', message: err.message || 'Payment was received but could not be fully processed. Please check the payment details.' });
      }

      setIsProcessingPayment(false);
      router.replace(`/rentals/${id}`);
    };

    processStripePayment();
  }, [searchParams, id, tenant?.id, paymentProcessed, queryClient, toast, router]);

  // Handle ?hold=placed&session_id=... returned by the Add Hold → Place via Stripe
  // flow. Calls sync-deposit-hold to record the authorised PaymentIntent onto
  // the rental. Idempotent.
  const [holdSynced, setHoldSynced] = useState(false);
  useEffect(() => {
    const holdParam = searchParams?.get('hold');
    const sessionId = searchParams?.get('session_id');
    if (!id || !tenant?.id || holdSynced) return;
    if (holdParam !== 'placed' || !sessionId) return;

    setHoldSynced(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('sync-deposit-hold', {
          body: { sessionId, rentalId: id },
        });
        if (error) throw new Error(error.message || 'Failed to sync hold');
        queryClient.invalidateQueries({ queryKey: ['rental', id] });
        if (data?.skipped) {
          toast({ title: 'Hold already recorded', description: 'No changes made.' });
        } else {
          toast({ title: 'Hold placed', description: `$${data?.amount ?? ''} held on the customer's card.` });
        }
      } catch (err: any) {
        toast({ title: 'Hold sync failed', description: err.message || 'Could not record the hold. Try again or contact support.', variant: 'destructive' });
      } finally {
        router.replace(`/rentals/${id}`);
      }
    })();
  }, [searchParams, id, tenant?.id, holdSynced, queryClient, toast, router]);

  // Poll for pending email payment completion (when admin sent Stripe link via email)
  useEffect(() => {
    if (!id || !tenant?.id) return;
    const sessionId = localStorage.getItem(`pending_email_payment_${id}`);
    if (!sessionId) return;

    let attempts = 0;
    const maxAttempts = 60; // Poll for up to 5 minutes (60 × 5s)
    const pollInterval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(pollInterval);
        localStorage.removeItem(`pending_email_payment_${id}`);
        return;
      }

      // Check if the payment is still Pending
      const { data: payment } = await supabase
        .from('payments')
        .select('id, status, stripe_checkout_session_id')
        .eq('stripe_checkout_session_id', sessionId)
        .maybeSingle();

      if (!payment) return;

      // If payment is no longer Pending (webhook or success page handled it), refresh
      if (payment.status !== 'Pending') {
        clearInterval(pollInterval);
        localStorage.removeItem(`pending_email_payment_${id}`);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['rental-totals'] }),
          queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] }),
          queryClient.invalidateQueries({ queryKey: ['rental-charges'] }),
          queryClient.invalidateQueries({ queryKey: ['rental-invoice'] }),
          queryClient.invalidateQueries({ queryKey: ['rental', id] }),
        ]);
        setPaymentResult({ status: 'success', message: 'Customer has completed the payment.' });
        return;
      }

      // Check with Stripe if the session is actually paid (via edge function)
      try {
        const { data: result } = await supabase.functions.invoke('process-pending-payment', {
          body: { checkoutSessionId: sessionId },
        });
        if (result?.ok && !result?.alreadyProcessed) {
          clearInterval(pollInterval);
          localStorage.removeItem(`pending_email_payment_${id}`);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['rental-totals'] }),
            queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] }),
            queryClient.invalidateQueries({ queryKey: ['rental-charges'] }),
            queryClient.invalidateQueries({ queryKey: ['rental-invoice'] }),
            queryClient.invalidateQueries({ queryKey: ['rental', id] }),
          ]);
          setPaymentResult({ status: 'success', message: 'Customer has completed the payment.' });
        }
      } catch {}
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [id, tenant?.id, queryClient]);

  // Fetch extras details for this rental
  const { data: extrasDetails } = useQuery({
    queryKey: ["rental-extras-details", id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from("rental_extras_selections")
        .select("id, quantity, price_at_booking, billing_type_at_booking, extra_id, rental_extras(name, description)")
        .eq("rental_id", id);
      if (error || !data) return [];
      return data as any[];
    },
    enabled: !!id,
  });
  // Number of rental days — used to expand per_day extras. MUST use the same
  // day-count algorithm as the charge (rentals/new: differenceInDays on local-
  // midnight dates), otherwise a DST spring-forward crossing makes the displayed
  // extras total drift from what was actually charged/stored. parseLocalDate
  // yields local midnight, matching the date-picker dates used at booking.
  const extrasRentalDays = rental?.end_date
    ? Math.max(1, differenceInDays(parseLocalDate(rental.end_date), parseLocalDate(rental.start_date)))
    : 1;
  const extrasTotal = (extrasDetails || []).reduce(
    (sum: number, s: any) =>
      sum + (s.quantity * s.price_at_booking * (s.billing_type_at_booking === 'per_day' ? extrasRentalDays : 1)),
    0
  );
  const [showExtrasDialog, setShowExtrasDialog] = useState(false);
  const [showChargeDepositDialog, setShowChargeDepositDialog] = useState(false);
  const [showAddHoldDialog, setShowAddHoldDialog] = useState(false);
  const [verifyingHold, setVerifyingHold] = useState(false);
  const [showForceRefreshDialog, setShowForceRefreshDialog] = useState(false);
  const [forceRefreshingHold, setForceRefreshingHold] = useState(false);

  // Ask Stripe what the deposit authorisation is ACTUALLY doing and write the
  // answer back to the rental.
  //
  // GMT (Aug 2026): "I cannot refresh the hold. This is affecting our day to
  // day business." Their 60-120 day rentals outlive a Stripe authorisation by
  // an order of magnitude; when one lapses, Stripe cancels the PaymentIntent
  // but nothing tells us, so deposit_hold_status stays 'held' forever. Both
  // create-hold-checkout and place-deposit-hold then short-circuit on that
  // stale 'held' and the operator is stuck staring at a green badge over a
  // dead authorisation with no way forward. This button is the way forward:
  // verify-deposit-hold reconciles the row against Stripe, after which the
  // normal Add Hold / Refresh & Charge actions unblock themselves.
  const handleVerifyDepositHold = async () => {
    if (!rental?.id || verifyingHold) return;
    setVerifyingHold(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-deposit-hold', {
        body: { rentalId: rental.id },
      });
      // invoke() does not throw on non-2xx — it resolves with { data, error }.
      if (error) throw new Error(await extractFunctionError(error, 'Could not check the hold with Stripe.'));

      await queryClient.invalidateQueries({ queryKey: ['rental', id] });

      // Read the answer the same way add-hold-dialog does — see classifyVerify
      // above. The distinction that matters: verify-deposit-hold returns
      // liveHold:false for states that are NOT resolved (still authorising, or
      // a worker owns the row), and for the worker-owned case it still carries
      // the "Place a new hold to re-authorise the deposit" copy. Titling that
      // 'Hold checked' and repeating the advice would talk an operator into a
      // second authorisation on top of one that is still in flight.
      const outcome = classifyVerify(data);
      if (outcome === 'in_progress') {
        toast({
          title: 'Still in progress',
          description: describeInProgressHold(data?.status),
        });
      } else {
        toast({
          title: outcome === 'needs_review'
            ? 'Needs a closer look'
            : data?.changed
              ? 'Hold status corrected'
              : 'Hold checked',
          description: data?.message || 'Checked this deposit hold against Stripe.',
          variant: outcome === 'needs_review' ? 'destructive' : undefined,
        });
      }
    } catch (err: any) {
      toast({
        title: 'Could not check with Stripe',
        description: err.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setVerifyingHold(false);
    }
  };

  // ── Force refresh: re-drive the hold chain for THIS rental, now ───────────
  //
  // The chained-hold engine otherwise only runs on the nightly cron. When a
  // renter is at the counter and the authorisation is about to lapse, "come
  // back tomorrow" is not an answer. `refresh-deposit-holds` already accepts
  // `only_rental_id` and applies it as a filter (it was built for the sandbox
  // Time Machine), so a single-rental dispatch needs no new server surface and
  // can never touch another tenant's holds.
  //
  // Two things the operator has to understand, so the confirmation and the
  // toasts say them out loud:
  //
  //  * It is DESTRUCTIVE. The engine cancels the live authorisation before
  //    placing its replacement. If the card then declines, the rental is left
  //    unsecured — that is the whole reason this sits behind a confirm step and
  //    behind isAdmin() rather than the usual canEdit('rentals').
  //  * It is NOT a "make it green" button. The same due-filters as the cron
  //    apply, so a healthy hold with weeks left is simply not due and the run
  //    correctly reports zero (see NOTHING_DUE_MESSAGE).
  const handleForceRefreshHold = async () => {
    if (!rental?.id || forceRefreshingHold) return;
    setForceRefreshingHold(true);
    try {
      const { data, error } = await supabase.functions.invoke('refresh-deposit-holds', {
        body: { only_rental_id: rental.id },
      });

      // invoke() does not throw on non-2xx — it resolves with { data, error }.
      if (error) {
        // 401/403 is its own story and must not be swallowed as a generic edge
        // error. The function accepts either the cron's platform secret or a
        // SUPER-ADMIN user JWT; the portal can only ever send the signed-in
        // user's token, so a tenant-level head_admin can legitimately be turned
        // away here. Say which door was shut and name a route that does work,
        // rather than leaving an operator retrying an action that can never
        // succeed for them.
        const status = (error as { context?: Response })?.context?.status;
        if (status === 401 || status === 403) {
          throw new Error(
            'This sign-in is not permitted to dispatch the deposit-hold refresh — it needs a Drive247 platform (super-admin) account. In the meantime use "Check with Stripe" to correct the status, then "Add Hold" to place a fresh authorisation.',
          );
        }
        throw new Error(await extractFunctionError(error, 'Could not run the deposit hold refresh.'));
      }

      // Re-read the rental so the badge, the expiry line and the action buttons
      // all reflect whatever the engine just wrote.
      await queryClient.invalidateQueries({ queryKey: ['rental', id] });

      // The driver returns one RefreshOutcome per rental it processed. Match on
      // rentalId rather than trusting position — a future driver change that
      // widened the batch must not make us report someone else's outcome.
      const results = Array.isArray((data as any)?.results) ? (data as any).results : [];
      const outcome = results.find((r: any) => r?.rentalId === rental.id) ?? null;

      if (!outcome) {
        // Nothing was processed. Either the row is genuinely not due, or the
        // driver skipped it — either way no money moved.
        toast({
          title: 'Nothing was due',
          description: NOTHING_DUE_MESSAGE,
        });
        return;
      }

      const isProblem = REFRESH_PROBLEM_RESULTS.includes(String(outcome.result));
      toast({
        title: REFRESH_RESULT_TITLES[String(outcome.result)] || 'Refresh finished',
        description: outcome.message || `Result: ${outcome.result}`,
        variant: isProblem ? 'destructive' : undefined,
      });
    } catch (err: any) {
      toast({
        title: 'Could not refresh the hold',
        description: err.message || 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setForceRefreshingHold(false);
      setShowForceRefreshDialog(false);
    }
  };

  // Fetch renewal chain info: any rental that was renewed from this one
  const { data: renewedAsRental } = useQuery({
    queryKey: ["renewed-as-rental", id, tenant?.id],
    queryFn: async () => {
      if (!id || !tenant?.id) return null;
      const { data, error } = await supabase
        .from("rentals")
        .select("id, status, start_date")
        .eq("renewed_from_rental_id", id)
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: !!id && !!tenant?.id,
  });

  // Scroll to ledger section if hash is present (wait for data to load)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#ledger' && !isLoading && rental) {
      const scrollToLedger = () => {
        const ledgerElement = document.getElementById('ledger');
        if (ledgerElement) {
          const yOffset = -90;
          const y = ledgerElement.getBoundingClientRect().top + window.pageYOffset + yOffset;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      };
      // Wait for content to fully render
      setTimeout(scrollToLedger, 500);
    }
  }, [isLoading, rental]);

  // Fetch payment information for pending bookings
  const { data: payment } = useQuery({
    queryKey: ["rental-payment", id, tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return null;

      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("rental_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error fetching rental payment:", error);
        return null;
      }
      return data;
    },
    enabled: !!id && !!tenant?.id,
  });

  // Fetch key handover status for approval check
  const { data: keyHandoverStatus } = useQuery({
    queryKey: ["key-handover-status", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_key_handovers")
        .select("id, handover_type, handed_at")
        .eq("rental_id", id)
        .eq("handover_type", "giving")
        .maybeSingle();

      if (error) {
        console.error("Error fetching key handover:", error);
        return null;
      }
      return data;
    },
    enabled: !!id,
  });

  const isKeyHandoverCompleted = !!keyHandoverStatus?.handed_at;

  // Fetch key return status
  const { data: keyReturnStatus } = useQuery({
    queryKey: ["key-return-status", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_key_handovers")
        .select("id, handover_type, handed_at")
        .eq("rental_id", id)
        .eq("handover_type", "receiving")
        .maybeSingle();

      if (error) {
        console.error("Error fetching key return:", error);
        return null;
      }
      return data;
    },
    enabled: !!id,
  });

  const isKeyReturnCompleted = !!keyReturnStatus?.handed_at;

  // Helper to scroll to key handover section
  const scrollToKeyHandover = () => {
    const element = document.getElementById('key-handover-section');
    if (element) {
      const yOffset = -90;
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  const scrollToInsurance = () => {
    const element = document.getElementById('insurance-section');
    if (element) {
      const yOffset = -90;
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  // Sync DB status to 'Active' if all conditions are met but DB status is still 'Pending'
  // This handles edge cases where the status update might have failed
  useEffect(() => {
    const syncStatusToActive = async () => {
      if (!rental || !tenant?.id) return;

      // Check if rental should be Active but DB status is not
      const shouldBeActive =
        rental.status !== 'Active' &&
        rental.status !== 'Closed' &&
        rental.status !== 'Cancelled' &&
        rental.approval_status === 'approved' &&
        rental.payment_status === 'fulfilled' &&
        isKeyHandoverCompleted;

      if (shouldBeActive) {
        console.log('Syncing rental status to Active (was:', rental.status, ')');
        const { error } = await supabase
          .from('rentals')
          .update({ status: 'Active', updated_at: new Date().toISOString() })
          .eq('id', rental.id)
          .eq('tenant_id', tenant.id);

        if (error) {
          console.error('Failed to sync status:', error);
        } else {
          // Auto-close the source rental if this is a renewal
          if (rental.renewed_from_rental_id) {
            await supabase
              .from('rentals')
              .update({ status: 'Closed', updated_at: new Date().toISOString() })
              .eq('id', rental.renewed_from_rental_id)
              .eq('tenant_id', tenant.id);
          }

          // Invalidate queries to refresh the data
          queryClient.invalidateQueries({ queryKey: ['rental', rental.id] });
          queryClient.invalidateQueries({ queryKey: ['rental', rental.renewed_from_rental_id] });
          queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
          queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
        }
      }
    };

    syncStatusToActive();
  }, [rental?.id, rental?.status, rental?.approval_status, rental?.payment_status, isKeyHandoverCompleted, tenant?.id]);

  // Fetch signed document if available
  const { data: signedDocument } = useQuery({
    queryKey: ["signed-document", rental?.signed_document_id],
    queryFn: async () => {
      if (!rental?.signed_document_id) return null;

      const { data, error } = await supabase
        .from("customer_documents")
        .select("id, document_name, file_url, file_name, mime_type")
        .eq("id", rental.signed_document_id)
        .single();

      if (error) {
        console.log('Error fetching signed document:', error);
        return null;
      }

      return data;
    },
    enabled: !!rental?.signed_document_id,
  });

  // Fetch insurance documents with AI scanning results
  // Documents may be linked by rental_id, customer_id, or still be unlinked (from temp customers)
  // IMPORTANT: We include documents with NULL tenant_id to catch docs uploaded from booking app
  // where tenant context might not have been available
  const { data: insuranceDocuments } = useQuery({
    queryKey: ["rental-insurance-docs", id, rental?.customers?.id, tenant?.id],
    queryFn: async () => {
      const allDocs: any[] = [];
      const seenDocIds = new Set<string>();

      // Query 1: Find by rental_id (direct link) - highest priority
      const { data: rentalDocs, error: rentalDocsError } = await supabase
        .from("customer_documents")
        .select("*")
        .eq("rental_id", id as string)
        .eq("document_type", "Insurance Certificate")
        .order("uploaded_at", { ascending: false });

      if (rentalDocsError) {
        console.error("[RENTAL-DOCS] Error fetching by rental_id:", rentalDocsError);
      }
      if (rentalDocs && rentalDocs.length > 0) {
        rentalDocs.forEach(doc => {
          if (!seenDocIds.has(doc.id)) {
            seenDocIds.add(doc.id);
            allDocs.push(doc);
          }
        });
      }

      // Query 2: Find by customer_id (docs not yet linked to any rental)
      if (rental?.customers?.id) {
        const { data: customerDocs, error: customerDocsError } = await supabase
          .from("customer_documents")
          .select("*")
          .eq("customer_id", rental.customers.id)
          .eq("document_type", "Insurance Certificate")
          .eq("tenant_id", tenant!.id)
          .is("rental_id", null)
          .order("uploaded_at", { ascending: false });

        if (customerDocsError) {
          console.error("[RENTAL-DOCS] Error fetching by customer_id:", customerDocsError);
        }
        if (customerDocs && customerDocs.length > 0) {
          customerDocs.forEach(doc => {
            if (!seenDocIds.has(doc.id)) {
              seenDocIds.add(doc.id);
              allDocs.push(doc);
            }
          });
        }
      }

      console.log(`[RENTAL-DOCS] Found ${allDocs.length} insurance documents for rental ${id}`);
      return allDocs;
    },
    enabled: !!id && !!tenant?.id && !!rental?.customers?.id,
  });

  // Fetch Bonzah insurance policy for this rental
  const { data: bonzahPolicy, isLoading: isLoadingBonzahPolicy } = useQuery({
    queryKey: ["rental-bonzah-policy", id, tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bonzah_insurance_policies")
        .select("*")
        .eq("rental_id", id)
        .eq("policy_type", "original")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error fetching Bonzah policy:", error);
        return null;
      }

      return data;
    },
    enabled: !!id && !!tenant?.id,
  });

  // Fetch identity verification for this customer (by customer_id or by email)
  const { data: identityVerification, isLoading: isLoadingVerification } = useQuery({
    queryKey: ["customer-identity-verification", rental?.customers?.id, rental?.customers?.email, tenant?.id],
    queryFn: async () => {
      if (!rental?.customers?.id) return null;

      // First try to find by customer_id
      const { data, error } = await supabase
        .from("identity_verifications")
        .select("*")
        .eq("customer_id", rental.customers.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error fetching identity verification:", error);
      }

      if (data) {
        return data;
      }

      // Fallback: look by customer email if no verification linked by customer_id
      if (rental.customers?.email) {
        const customerEmail = rental.customers.email.toLowerCase().trim();
        const { data: emailData, error: emailError } = await supabase
          .from("identity_verifications")
          .select("*")
          .eq("customer_email", customerEmail)
          .is("customer_id", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (emailError) {
          console.error("Error fetching identity verification by email:", emailError);
          return null;
        }

        if (emailData) {
          // Auto-link this verification to the customer
          await supabase
            .from("identity_verifications")
            .update({ customer_id: rental.customers.id, tenant_id: tenant?.id })
            .eq("id", emailData.id);

          // Update customer's verification status.
          //
          // Two guards, both load-bearing:
          //
          // 1. tenant_id — this ran with only .eq("id", …), so merely OPENING a
          //    rental could rewrite a customer row belonging to another tenant.
          //
          // 2. manually_verified is never overwritten. A staff member recorded,
          //    with their name and a reason, that they checked this person's ID.
          //    A later verification row going 'pending' (or an unrelated attempt
          //    resolving RED) must not silently erase that — it would re-block a
          //    customer who was legitimately cleared, with no audit entry
          //    explaining why. Only an explicit action should undo an explicit
          //    action.
          // Skip entirely without a tenant rather than passing a placeholder:
          // tenant_id is uuid, and comparing it to '' fails with
          // "invalid input syntax for type uuid" — which supabase-js RETURNS
          // rather than throws, so it would have failed silently.
          if (tenant?.id) {
            const status = emailData.review_result === 'GREEN' ? 'verified' :
                           emailData.review_result === 'RED' ? 'rejected' : 'pending';
            const { error: syncError } = await supabase
              .from("customers")
              .update({ identity_verification_status: status })
              .eq("id", rental.customers.id)
              .eq("tenant_id", tenant.id)
              .neq("identity_verification_status", "manually_verified");
            if (syncError) {
              console.error("Failed to sync customer verification status:", syncError);
            }
          }

          return { ...emailData, customer_id: rental.customers.id };
        }
      }

      return null;
    },
    enabled: !!rental?.customers?.id,
  });


  // Mutation for approving insurance document
  const approveInsuranceMutation = useMutation({
    mutationFn: async (documentId: string) => {
      let query = supabase
        .from("customer_documents")
        .update({
          verified: true,
          status: "Active",
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rental-insurance-docs", id] });
      toast({
        title: "Insurance Approved",
        description: "The insurance document has been approved.",
      });
    },
    onError: (error: any) => {
      console.error("Approve error:", error);
      toast({
        title: "Error",
        description: "Failed to approve insurance document.",
        variant: "destructive",
      });
    },
  });

  // Rejecting insurance = rejecting the booking
  // Just open the rejection dialog directly
  const handleRejectInsurance = () => {
    setShowRejectionDialog(true);
  };

  // Mutation for linking unlinked document to this rental
  const linkDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      let query = supabase
        .from("customer_documents")
        .update({
          rental_id: id,
          customer_id: rental?.customers?.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rental-insurance-docs", id] });
      toast({
        title: "Document Linked",
        description: "The insurance document has been linked to this rental.",
      });
    },
    onError: (error: any) => {
      console.error("Link error:", error);
      toast({
        title: "Error",
        description: "Failed to link insurance document.",
        variant: "destructive",
      });
    },
  });

  // Mutation for retrying AI scan on stuck documents
  const retryScanMutation = useMutation({
    mutationFn: async (documentId: string) => {
      // First, get the document to get the file_url
      const { data: doc, error: fetchError } = await supabase
        .from("customer_documents")
        .select("file_url")
        .eq("id", documentId)
        .single();

      if (fetchError || !doc) {
        throw new Error("Failed to fetch document");
      }

      // Reset the scan status to pending
      const { error: updateError } = await supabase
        .from("customer_documents")
        .update({
          ai_scan_status: 'pending',
          ai_scan_errors: null,
          ai_extracted_data: null,
          ai_validation_score: null,
          ai_confidence_score: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);

      if (updateError) throw updateError;

      // Trigger the scan edge function
      const { error: scanError } = await supabase.functions.invoke('scan-insurance-document', {
        body: { documentId, fileUrl: doc.file_url }
      });

      if (scanError) {
        console.error("Scan function error:", scanError);
        // Don't throw - the function might still process
      }

      return documentId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rental-insurance-docs", id] });
      toast({
        title: "Scan Restarted",
        description: "The document scan has been restarted.",
      });
    },
    onError: (error: any) => {
      console.error("Retry scan error:", error);
      toast({
        title: "Error",
        description: "Failed to restart document scan.",
        variant: "destructive",
      });
    },
  });

  // Mutation for deleting insurance documents
  const deleteDocumentMutation = useMutation({
    mutationFn: async (doc: { id: string; file_url: string }) => {
      // Delete file from storage
      if (doc.file_url) {
        const { error: storageError } = await supabase.storage
          .from('customer-documents')
          .remove([doc.file_url]);
        if (storageError) {
          console.error("Storage delete error:", storageError);
        }
      }

      // Delete record from database
      let query = supabase
        .from("customer_documents")
        .delete()
        .eq("id", doc.id);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rental-insurance-docs", id] });
      toast({
        title: "Document Deleted",
        description: "The insurance document has been deleted.",
      });
    },
    onError: (error: any) => {
      console.error("Delete error:", error);
      toast({
        title: "Error",
        description: "Failed to delete document.",
        variant: "destructive",
      });
    },
  });

  // Mutation for requesting insurance re-upload from customer
  const notifyInsuranceReuploadMutation = useMutation({
    mutationFn: async () => {
      if (!rental?.customer_id || !tenant?.id) throw new Error("Missing rental or tenant context");

      // Look up customer_user_id from customer_users table
      const { data: customerUser, error: lookupError } = await supabase
        .from("customer_users")
        .select("id")
        .eq("customer_id", rental.customer_id)
        .eq("tenant_id", tenant.id)
        .maybeSingle();

      if (lookupError) throw lookupError;
      if (!customerUser) throw new Error("Customer user account not found. The customer may not have registered on the portal yet.");

      const vehicleName = rental.vehicles
        ? `${rental.vehicles.make} ${rental.vehicles.model}`
        : rental.vehicles?.reg || "your vehicle";

      const { error: insertError } = await supabase
        .from("customer_notifications")
        .insert({
          customer_user_id: customerUser.id,
          tenant_id: tenant.id,
          title: "Insurance Re-upload Required",
          message: `Your insurance document for booking ${vehicleName} has been flagged as invalid. Please re-upload a valid insurance document.`,
          type: "insurance_reupload",
          link: "/portal/bookings",
          metadata: { rental_id: id, vehicle_reg: rental.vehicles?.reg },
        });

      if (insertError) throw insertError;
    },
    onSuccess: () => {
      toast({
        title: "Notification Sent",
        description: "The customer has been notified to re-upload their insurance document.",
      });
    },
    onError: (error: any) => {
      console.error("Insurance re-upload notification error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to send re-upload notification.",
        variant: "destructive",
      });
    },
  });

  // Outstanding balance from ledger-backed categoryRemainingAmounts.
  const outstandingBalance = useMemo(() => {
    return categoryRemainingAmounts
      ? Object.entries(categoryRemainingAmounts).reduce((sum, [, amt]) => sum + amt, 0)
      : 0;
  }, [categoryRemainingAmounts]);

  if (isLoading) {
    return <div>Loading rental details...</div>;
  }

  if (!rental) {
    return <div>Rental not found</div>;
  }

  const originalInsuranceDocs = (insuranceDocuments || []).filter((d: any) => !d.extension_id);

  // Does the ORIGINAL scope already have insurance? (active Bonzah OR uploaded doc)
  const originalBonzahActive = (insurancePolicies || []).some(
    (p: any) => p.policy_type !== 'extension' && (p.status === 'active' || p.status === 'payment_pending' || p.status === 'quoted')
  );
  const originalHasCoverage = originalBonzahActive || originalInsuranceDocs.length > 0;

  // Does this rental still have any days Bonzah can insure?
  // Bonzah refuses to insure today — a policy must start TOMORROW (Pacific) or later
  // (mirrors the clamp in the bonzah-create-quote edge function). So a rental whose
  // end date is today or earlier has zero insurable days left and Buy Bonzah would
  // always error. We compute "tomorrow" in America/Los_Angeles to match the backend.
  const bonzahHasInsurableDays = (() => {
    const endStr = (rental as any)?.end_date as string | undefined;
    if (!endStr) return true; // no date yet → don't block
    // Insurable only if the trip ends strictly after tomorrow.
    return String(endStr).slice(0, 10) > getPacificTomorrow();
  })();

  // Inline upload helper — used by both scopes. Stamps extension_id when provided.
  const uploadInsuranceDoc = (scope: { extensionId: string | null }) => {
    if (!rental) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        toast({ title: 'Uploading...', description: 'Uploading insurance document' });
        // Sanitize the filename before it becomes part of the Supabase Storage key.
        // Supabase rejects keys with characters outside its allow-list (e.g. the
        // U+202F narrow-no-break-space macOS puts before AM/PM in screenshot names),
        // failing with "Invalid key". The original name is kept for display below.
        const fileName = `${rental.customer_id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const { error: uploadError } = await supabase.storage
          .from('customer-documents')
          .upload(fileName, file);
        if (uploadError) throw uploadError;
        const { data: docData, error: docError } = await supabase
          .from('customer_documents')
          .insert({
            customer_id: rental.customer_id,
            rental_id: id,
            extension_id: scope.extensionId,
            document_type: 'Insurance Certificate',
            document_name: file.name,
            file_name: file.name,
            file_url: fileName,
            status: 'Pending',
            ai_scan_status: 'pending',
            tenant_id: tenant?.id,
          })
          .select()
          .single();
        if (docError) throw docError;
        supabase.functions.invoke('scan-insurance-document', {
          body: { documentId: docData.id, fileUrl: fileName },
        });
        toast({ title: 'Success', description: 'Insurance document uploaded' });
        queryClient.invalidateQueries({ queryKey: ['rental-insurance-docs', id] });
      } catch (error: any) {
        toast({ title: 'Upload Failed', description: error.message || 'Failed to upload document', variant: 'destructive' });
      }
    };
    input.click();
  };

  // Check if any insurance document has been rejected or has low validation score
  const hasInvalidInsuranceDoc = insuranceDocuments?.some((doc: any) => {
    const verificationDecision = doc.verification_decision || doc.ai_extracted_data?.verificationDecision;
    const isRejected = verificationDecision === 'auto_rejected' || verificationDecision === 'manually_rejected';
    const isLowScore = doc.ai_validation_score !== null && doc.ai_validation_score < 0.6;
    return isRejected || isLowScore;
  }) || false;

  // Use the new totals from allocation-based calculations
  const totalCharges = rentalTotals?.totalCharges || 0;
  const totalPayments = rentalTotals?.totalPayments || 0;

  // IS THERE ANYTHING LEFT TO COLLECT?
  //
  // Read from the SAME two numbers the "Collected" and "Balance Due" cards print
  // (~line 3115), so the Collect Payment button can never contradict the card
  // three inches below it — the allocation ledger.
  //
  // NOT from rentalPaymentsTotal. That query counts only status in
  // ('Applied','Credit','Partial'), so money-received has to come from the
  // allocation totals instead.
  const collectedTotal = totalPayments;
  const balanceDueTotal = outstandingBalance;
  // Money has arrived and the ledger wants nothing more. Sub-penny tolerance
  // because these are summed floats.
  const rentalFullyPaid = collectedTotal > 0 && balanceDueTotal <= 0.01;

  // Compute rental status based on approval_status, payment_status, AND key handover
  const computeStatus = (rental: Rental): string => {
    if (rental.status === 'Cancelled') return 'Cancelled';
    if (rental.status === 'Closed') return 'Completed';
    if (rental.approval_status === 'rejected') return 'Rejected';

    // Only show as Active if ALL conditions are met:
    // 1. approval_status is approved
    // 2. payment_status is fulfilled
    // 3. key handover is completed
    if (rental.approval_status === 'approved' && rental.payment_status === 'fulfilled' && isKeyHandoverCompleted) {
      return 'Active';
    }

    // Otherwise show as Pending
    return 'Pending';
  };

  const displayStatus = computeStatus(rental);

  // Check if original agreement is signed (from rental_agreements or fallback to rental fields)
  const originalAgreement = rentalAgreements.find(a => a.agreement_type === 'original');
  const isDocuSignSigned = originalAgreement
    ? (originalAgreement.document_status === 'completed' || originalAgreement.document_status === 'signed' || !!originalAgreement.signed_document_id)
    : (rental?.document_status === 'completed' || rental?.document_status === 'signed');
  const hasDocuSign = originalAgreement
    ? !!originalAgreement.document_id
    : !!rental?.docusign_envelope_id;

  // Handle Approve button click - check DocuSign first
  const proceedToApproveAfterChecks = () => {
    const insuranceStatus = bonzahPolicy?.status;
    if (!bonzahPolicy || insuranceStatus === 'quoted' || insuranceStatus === 'failed' || insuranceStatus === 'insufficient_balance') {
      setShowInsuranceWarning(true);
    } else {
      setShowApproveDialog(true);
    }
  };

  const handleApproveClick = async () => {
    if (!hasDocuSign) {
      // No agreement sent at all — show warning
      setShowDocuSignWarning(true);
      return;
    }
    if (hasDocuSign && !isDocuSignSigned) {
      // DB says not signed — check BoldSign API for latest status before warning
      try {
        const response = await fetch('/api/esign/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rentalId: id,
            envelopeId: originalAgreement?.document_id || rental?.docusign_envelope_id,
            agreementId: originalAgreement?.id,
          }),
        });
        const result = await response.json();
        if (result.ok && (result.status === 'signed' || result.status === 'completed')) {
          // Actually signed — refresh rental data and proceed
          queryClient.invalidateQueries({ queryKey: ["rental", id, tenant?.id] });
          queryClient.invalidateQueries({ queryKey: ["rental-agreements", id] });
          proceedToApproveAfterChecks();
          return;
        }
      } catch (err) {
        console.error('Failed to check BoldSign status:', err);
      }
      // Still not signed — show warning
      setShowDocuSignWarning(true);
    } else {
      // Already signed - check insurance next
      proceedToApproveAfterChecks();
    }
  };

  // Function to view DocuSign agreement
  const handleViewAgreement = async () => {
    setLoadingDocuSignDoc(true);

    // Open window immediately to avoid popup blocker
    const newWindow = window.open('about:blank', '_blank');

    try {
      // If we have a signed document, open it directly
      if (signedDocument?.file_url) {
        let documentUrl = signedDocument.file_url;
        if (!documentUrl.startsWith('http')) {
          const { data } = supabase.storage
            .from('customer-documents')
            .getPublicUrl(signedDocument.file_url);
          documentUrl = data.publicUrl;
        }
        if (newWindow) {
          newWindow.location.href = documentUrl;
        }
        return;
      }

      // Show loading message in new window
      if (newWindow) {
        newWindow.document.write('<html><head><title>Loading Agreement...</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:system-ui;"><p>Loading agreement...</p></body></html>');
      }

      // Fetch from eSign via local API route
      const response = await fetch('/api/esign/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rentalId: id,
          envelopeId: rental?.docusign_envelope_id
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        if (newWindow) newWindow.close();
        toast({
          title: "Error",
          description: data?.error || "Failed to get document",
          variant: "destructive",
        });
        return;
      }

      // If we got a stored URL, redirect to it
      if (data.documentUrl) {
        if (newWindow) {
          newWindow.location.href = data.documentUrl;
        }
        return;
      }

      // If we got base64 PDF, create blob and display
      if (data.documentBase64) {
        const byteCharacters = atob(data.documentBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        if (newWindow) {
          newWindow.location.href = url;
        }
      }
    } catch (err: any) {
      if (newWindow) newWindow.close();
      toast({
        title: "Error",
        description: err?.message || "Failed to view agreement",
        variant: "destructive",
      });
    } finally {
      setLoadingDocuSignDoc(false);
    }
  };

  // View agreement from AgreementTimeline (by agreementId)
  const handleViewAgreementById = async (agreementId: string, signedDocFileUrl?: string | null) => {
    setLoadingDocuSignDoc(true);
    const newWindow = window.open('about:blank', '_blank');

    try {
      // If signed document URL provided, open directly
      if (signedDocFileUrl) {
        let documentUrl = signedDocFileUrl;
        if (!documentUrl.startsWith('http')) {
          const { data } = supabase.storage
            .from('customer-documents')
            .getPublicUrl(signedDocFileUrl);
          documentUrl = data.publicUrl;
        }
        if (newWindow) newWindow.location.href = documentUrl;
        return;
      }

      if (newWindow) {
        newWindow.document.write('<html><head><title>Loading Agreement...</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:system-ui;"><p>Loading agreement...</p></body></html>');
      }

      const response = await fetch('/api/esign/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rentalId: id, agreementId }),
      });
      const data = await response.json();

      if (!response.ok || !data?.ok) {
        if (newWindow) newWindow.close();
        toast({ title: 'Error', description: data?.error || 'Failed to get document', variant: 'destructive' });
        return;
      }

      if (data.documentUrl) {
        if (newWindow) newWindow.location.href = data.documentUrl;
        return;
      }

      if (data.documentBase64) {
        const byteCharacters = atob(data.documentBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        if (newWindow) newWindow.location.href = URL.createObjectURL(blob);
      }
    } catch (err: any) {
      if (newWindow) newWindow.close();
      toast({ title: 'Error', description: err?.message || 'Failed to view agreement', variant: 'destructive' });
    } finally {
      setLoadingDocuSignDoc(false);
    }
  };

  const getStatusVariant = (status: string) => {
    if (status === 'Active') return 'default';
    if (status === 'Completed') return 'secondary';
    if (status === 'Pending') return 'outline';
    return 'outline';
  };


  // Determine if key handover needs action (approved + fulfilled but not handed over)
  const needsKeyHandover = rental?.approval_status === 'approved' && rental?.payment_status === 'fulfilled' && !isKeyHandoverCompleted;

  return (
    <div className="container mx-auto space-y-6 py-[24px] px-[8px]">
      {/* This rental was created without an ID check. Surfaced permanently and
          prominently: anyone handling it later — a claim, a dispute, an
          insurance query — needs to know without digging through audit logs. */}
      {rental?.id_verification_waived && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm min-w-0">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              Created without ID verification
            </p>
            <p className="text-amber-700/90 dark:text-amber-400/90 mt-0.5 break-words">
              {rental.id_verification_waived_reason}
            </p>
            {rental.id_verification_waived_at && (
              <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-1">
                Recorded {format(new Date(rental.id_verification_waived_at), "d MMM yyyy, HH:mm")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Key Handover Action Banner */}
      <KeyHandoverActionBanner
        show={needsKeyHandover}
        customerName={rental?.customers?.name}
        vehicleInfo={rental?.vehicles ? `${rental.vehicles.make} ${rental.vehicles.model} • ${rental.vehicles.reg}` : undefined}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => router.push("/rentals")}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Back to Rentals</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div>
            {(() => {
              const ref = rental.rental_number || rental.id?.slice(0, 8).toUpperCase();
              return (
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl sm:text-3xl font-bold font-mono tabular-nums tracking-tight">
                    #{ref || '—'}
                  </h1>
                  {ref && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(String(ref));
                          toast({ title: 'Reference copied', description: ref });
                        } catch {
                          toast({ title: 'Copy failed', variant: 'destructive' });
                        }
                      }}
                      className="h-8 w-8"
                      title="Copy reference"
                      aria-label="Copy reference number"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })()}
            <p className="text-muted-foreground mt-1">
              {rental.customers?.name} • {rental.vehicles?.reg}
            </p>
            {/* Key Status Badges */}
            <div className="flex flex-wrap gap-2 mt-2">
            </div>
            <div className="flex flex-wrap gap-2 mt-1">
              <Badge
                variant="outline"
                className={`cursor-pointer transition-colors ${
                  isKeyHandoverCompleted
                    ? 'bg-green-500/10 text-green-600 border-green-500 hover:bg-green-500/20'
                    : 'bg-amber-500/10 text-amber-600 border-amber-500 hover:bg-amber-500/20'
                }`}
                onClick={scrollToKeyHandover}
              >
                <Key className="h-3 w-3 mr-1" />
                {isKeyHandoverCompleted ? 'Keys Collected' : 'Keys Not Collected'}
              </Badge>
              {isKeyHandoverCompleted && (
                <Badge
                  variant="outline"
                  className={`cursor-pointer transition-colors ${
                    isKeyReturnCompleted
                      ? 'bg-green-500/10 text-green-600 border-green-500 hover:bg-green-500/20'
                      : 'bg-amber-500/10 text-amber-600 border-amber-500 hover:bg-amber-500/20'
                  }`}
                  onClick={scrollToKeyHandover}
                >
                  <KeyRound className="h-3 w-3 mr-1" />
                  {isKeyReturnCompleted ? 'Keys Returned' : 'Return Pending'}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={`cursor-pointer hover:opacity-80 transition-opacity ${
                  !bonzahPolicy
                    ? 'bg-gray-500/10 text-gray-400 border-gray-500'
                    : bonzahPolicy.status === 'active'
                    ? 'bg-green-500/10 text-green-600 border-green-500'
                    : bonzahPolicy.status === 'quoted' || bonzahPolicy.status === 'insufficient_balance'
                    ? 'bg-amber-600/10 text-amber-600 border-amber-600'
                    : bonzahPolicy.status === 'failed'
                    ? 'bg-red-500/10 text-red-500 border-red-500'
                    : 'bg-muted text-muted-foreground border-border'
                }`}
                onClick={scrollToInsurance}
              >
                <ShieldCheck className="h-3 w-3 mr-1" />
                {!bonzahPolicy ? 'No Insurance'
                  : bonzahPolicy.status === 'active' ? 'Insurance Active'
                  : bonzahPolicy.status === 'quoted' ? 'Insurance Quoted'
                  : bonzahPolicy.status === 'failed' ? 'Insurance Failed'
                  : bonzahPolicy.status === 'insufficient_balance' ? 'Insurance Insufficient Balance'
                  : `Insurance ${bonzahPolicy.status}`}
              </Badge>
              {(rental as any)?.is_gig_driver && (
                <Badge
                  variant="outline"
                  className="bg-blue-500/10 text-blue-600 border-blue-500"
                >
                  <Briefcase className="h-3 w-3 mr-1" />
                  Gig Driver
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Universal Collect Payment — available on every rental regardless of
              status (Active, Closed, Completed…) so staff can always send a Stripe
              pay link / record a payment. Opens the regular AddPaymentDialog. */}
          {canEdit('rentals') && (
            <Button
              variant="default"
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={() => setShowAddPayment(true)}
              disabled={rentalFullyPaid}
              title={
                rentalFullyPaid
                  ? 'This rental is fully paid — there is nothing left to collect.'
                  : undefined
              }
            >
              <CreditCard className="h-4 w-4 mr-2" />
              {rentalFullyPaid ? 'Fully Paid' : 'Collect Payment'}
            </Button>
          )}
          {/* Pending Rental - Show Approve, Reject, Delete buttons */}
          {canEdit('rentals') && displayStatus === 'Pending' && (
            <>
              <Button
                variant="default"
                className="bg-green-600 hover:bg-green-700"
                onClick={handleApproveClick}
                disabled={rental.approval_status === 'approved'}
              >
                <Check className="h-4 w-4 mr-2" />
                {rental.approval_status === 'approved' ? 'Approved' : 'Approve'}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowRejectionDialog(true)}
                disabled={rental.approval_status === 'approved'}
              >
                <Ban className="h-4 w-4 mr-2" />
                Reject
              </Button>
              <div className="border-l pl-2 ml-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 text-destructive"
                        onClick={() => setShowDeleteDialog(true)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete Rental</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </>
          )}

          {/* Active Rental - Show Add Payment, Close, Cancel, Delete buttons */}
          {canEdit('rentals') && displayStatus === 'Active' && (
            <>
              <Button variant="outline" onClick={() => setShowAddPayment(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Payment
              </Button>
              <TooltipProvider>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowCloseDialog(true)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Close Rental</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setShowCancelDialog(true)}
                      >
                        <Ban className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Cancel Rental</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setShowDeleteDialog(true)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete Rental</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </>
          )}

          {/* Completed/Cancelled/Rejected Rental - Show Renew and Delete buttons */}
          {canEdit('rentals') && (displayStatus === 'Completed' || displayStatus === 'Cancelled' || displayStatus === 'Rejected') && (
            <>
              {displayStatus === 'Completed' && (
                <Button
                  variant="default"
                  onClick={() => router.push(`/rentals/new?renew_from=${rental.id}`)}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Renew
                </Button>
              )}
              <div className="border-l pl-2 ml-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 text-destructive"
                        onClick={() => setShowDeleteDialog(true)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Delete Rental</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Cancellation Requested Alert */}
      {rental.cancellation_requested && (
        <Alert className="border-red-200 bg-red-50 dark:bg-red-950/30">
          <XCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800 dark:text-red-200">
            <span className="font-medium">Cancellation Requested:</span> Customer has requested to cancel this booking.
            {rental.cancellation_reason && (
              <> Reason: <strong>{rental.cancellation_reason}</strong></>
            )}
            <Button
              variant="link"
              className="ml-2 h-auto p-0 text-red-700 dark:text-red-300"
              onClick={() => setShowRejectionDialog(true)}
            >
              Process Cancellation
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Processing Payment Banner */}
      {isProcessingPayment && (
        <Alert className="border-blue-500/30 bg-blue-500/10">
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          <AlertDescription className="text-blue-500 font-medium">
            Processing your Stripe payment... This may take a few seconds.
          </AlertDescription>
        </Alert>
      )}

      {/* Payment Result Banner */}
      {paymentResult && !isProcessingPayment && (
        <Alert className={cn(
          "pr-10",
          paymentResult.status === 'success' && "border-emerald-500/30 bg-emerald-500/10",
          paymentResult.status === 'cancelled' && "border-amber-500/30 bg-amber-500/10",
          paymentResult.status === 'failed' && "border-red-500/30 bg-red-500/10",
        )}>
          {paymentResult.status === 'success' && <CheckCircle className="h-4 w-4 text-emerald-500" />}
          {paymentResult.status === 'cancelled' && <XCircle className="h-4 w-4 text-amber-500" />}
          {paymentResult.status === 'failed' && <XCircle className="h-4 w-4 text-red-500" />}
          <AlertTitle className={cn(
            "text-sm font-semibold",
            paymentResult.status === 'success' && "text-emerald-500",
            paymentResult.status === 'cancelled' && "text-amber-500",
            paymentResult.status === 'failed' && "text-red-500",
          )}>
            {paymentResult.status === 'success' ? 'Payment Successful' : paymentResult.status === 'cancelled' ? 'Payment Cancelled' : 'Payment Failed'}
          </AlertTitle>
          <AlertDescription className={cn(
            paymentResult.status === 'success' && "text-emerald-600 dark:text-emerald-400",
            paymentResult.status === 'cancelled' && "text-amber-600 dark:text-amber-400",
            paymentResult.status === 'failed' && "text-red-600 dark:text-red-400",
          )}>
            {paymentResult.message}
          </AlertDescription>
          <button
            type="button"
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setPaymentResult(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </Alert>
      )}

      {/* Rental Financial Summary */}
      {(() => {
        // Exclude Security Deposit deductions applied to Excess Mileage — not a customer refund
        const hasExcessMileageCharge = (rentalCharges || []).some(c => c.category === 'Excess Mileage');
        const legacyRefunded = refundBreakdown
          ? Object.entries(refundBreakdown).reduce((sum, [cat, val]) => {
              if (cat === 'Security Deposit' && hasExcessMileageCharge) return sum; // deducted, not refunded
              return sum + val;
            }, 0)
          : 0;
        const collectedDisplay = totalPayments;
        const balanceDueDisplay = outstandingBalance;
        const refundedDisplay = legacyRefunded;
        const netReceivedDisplay = totalPayments - legacyRefunded;
        const cur = tenant?.currency_code || 'USD';
        return (
          <div className={`grid gap-4 grid-cols-2 lg:grid-cols-4 ${isProcessingPayment ? 'opacity-50 pointer-events-none' : ''}`}>
            {/* Total Collected */}
            <Card className="border-emerald-500/20 bg-emerald-500/5">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Collected</CardTitle>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[280px] p-3 text-xs leading-relaxed">
                        <p className="font-medium mb-1">Total money received from the customer</p>
                        <p className="text-muted-foreground mb-2">Sum of all payments applied to this rental's charges.</p>
                        <div className="font-mono text-[11px] bg-muted/50 rounded p-2 space-y-0.5">
                          <p className="text-muted-foreground">Example: Customer pays £500 for rental + £50 for an extra</p>
                          <p className="font-medium">Collected = £550</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${collectedDisplay > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                  {formatCurrencyUtil(collectedDisplay, cur)}
                </div>
              </CardContent>
            </Card>

            {/* Balance Due */}
            <Card className={balanceDueDisplay > 0 ? "border-red-500/20 bg-red-500/5" : "border-blue-500/20 bg-blue-500/5"}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className={`text-sm font-medium ${balanceDueDisplay > 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>Balance Due</CardTitle>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[280px] p-3 text-xs leading-relaxed">
                        <p className="font-medium mb-1">Balance Due = Total Charges − Payments Applied</p>
                        <p className="text-muted-foreground mb-2">The remaining unpaid amount across all charges. Reaches zero when fully paid.</p>
                        <div className="font-mono text-[11px] bg-muted/50 rounded p-2 space-y-0.5">
                          <p className="text-muted-foreground">Example: Total charges £600, paid £500</p>
                          <p className="font-medium">Balance Due = £100</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${balanceDueDisplay > 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                  {formatCurrencyUtil(balanceDueDisplay, cur)}
                </div>
                {balanceDueDisplay === 0 && collectedDisplay > 0 && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">Fully settled</p>
                )}
              </CardContent>
            </Card>

            {/* Refunded */}
            <Card className={refundedDisplay > 0 ? "border-amber-500/20 bg-amber-500/5" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className={`text-sm font-medium ${refundedDisplay > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>Refunded</CardTitle>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[280px] p-3 text-xs leading-relaxed">
                        <p className="font-medium mb-1">Total returned to the customer</p>
                        <p className="text-muted-foreground mb-2">Partial or full refunds across any category — rental, pre-auth, fees, etc. Reduces your Net Received but does not change Balance Due.</p>
                        <div className="font-mono text-[11px] bg-muted/50 rounded p-2 space-y-0.5">
                          <p className="text-muted-foreground">Example: Collected £500, refund pre-auth £100</p>
                          <p className="font-medium">Refunded = £100</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${refundedDisplay > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                  {formatCurrencyUtil(refundedDisplay, cur)}
                </div>
                {refundedDisplay === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No refunds</p>
                )}
              </CardContent>
            </Card>

            {/* Net Received */}
            <Card className="border-indigo-500/20 bg-indigo-500/5">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-indigo-600 dark:text-indigo-400">Net Received</CardTitle>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[280px] p-3 text-xs leading-relaxed">
                        <p className="font-medium mb-1">Net Received = Collected − Refunded</p>
                        <p className="text-muted-foreground mb-2">The actual amount you kept from this rental. This is your real revenue after all refunds.</p>
                        <div className="font-mono text-[11px] bg-muted/50 rounded p-2 space-y-0.5">
                          <div className="flex justify-between"><span>Collected</span><span>{formatCurrencyUtil(collectedDisplay, cur)}</span></div>
                          <div className="flex justify-between text-orange-500"><span>Refunded</span><span>−{formatCurrencyUtil(refundedDisplay, cur)}</span></div>
                          <div className="flex justify-between font-bold border-t border-border pt-0.5 mt-0.5"><span>Net</span><span>{formatCurrencyUtil(netReceivedDisplay, cur)}</span></div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${netReceivedDisplay > 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground'}`}>
                  {formatCurrencyUtil(netReceivedDisplay, cur)}
                </div>
                {refundedDisplay > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    After {formatCurrencyUtil(refundedDisplay, cur)} refunded
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* Payment Breakdown — upfront fixed charges (Insurance, Delivery, Extras, etc.).
          */}
      {invoiceBreakdown && (() => {
        const canRefund = totalPayments > 0 && rental.status !== 'Cancelled';
        // Determine insurance amount: prefer ledger charge, fall back to invoice
        const insuranceCharge = (rentalCharges || []).find(c => c.category === 'Insurance');
        const insuranceAmount = insuranceCharge?.amount ?? invoiceBreakdown.insurancePremium ?? 0;

        // Determine delivery/collection amounts
        const deliveryLedgerCharge = (rentalCharges || []).find(c => c.category === 'Delivery Fee');
        const collectionLedgerCharge = (rentalCharges || []).find(c => c.category === 'Collection Fee');
        // Use rental record as source of truth for delivery/collection split
        const deliveryFeeAmount = rental.delivery_fee || invoiceBreakdown.deliveryFee || 0;
        const collectionFeeAmount = collectionLedgerCharge ? Number(collectionLedgerCharge.amount) : (rental.collection_fee ?? 0);

        const rows: { label: string; category: string; amount: number; detail: string; icon: any; color: string; bg: string; nonRefundable?: boolean; onClick?: () => void; isDepositDeducted?: boolean }[] = [
          { label: 'Rental', category: 'Rental', amount: invoiceBreakdown.rentalFee, detail: rental.rental_period_type || 'Monthly', icon: Car, color: 'text-green-500', bg: 'bg-green-500/10' },
          { label: 'Tax', category: 'Tax', amount: invoiceBreakdown.taxAmount, detail: invoiceBreakdown.taxAmount > 0 && invoiceBreakdown.rentalFee > 0 ? `${((invoiceBreakdown.taxAmount / invoiceBreakdown.rentalFee) * 100).toFixed(1)}% rate` : 'Tax on rental', icon: Percent, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Bonzah Insurance', category: 'Insurance', amount: insuranceAmount, detail: bonzahPolicy ? 'Bonzah Insurance' : 'Insurance coverage', icon: ShieldCheck, color: 'text-teal-500', bg: 'bg-teal-500/10' },
          { label: 'Service Fee', category: 'Service Fee', amount: invoiceBreakdown.serviceFee, detail: 'Platform fee', icon: Receipt, color: 'text-purple-500', bg: 'bg-purple-500/10' },
          { label: depositIsCharged ? 'Security Deposit' : 'Pre-Auth Hold', category: 'Security Deposit', amount: (() => {
            // Charged path: the deposit is an ordinary ledger charge, so read it
            // the same way every other category is read. deposit_hold_* is stale
            // history here and must not be consulted.
            if (depositIsCharged) {
              const led = paymentBreakdown?.['Security Deposit'];
              if (led && led.total > 0) return led.total;
              return Number(invoiceBreakdown.securityDeposit) || 0;
            }
            // Deposits are never charged upfront — they live on rental.deposit_hold_*.
            // When the hold has been captured or released, show the remaining
            // deposit_hold_amount directly (0 for fully-captured/released).
            // Otherwise prefer the actual held amount, then the per-rental
            // override (operator's edit on the new-rental Pre-Auth input), then
            // the tenant default, then the invoice line as a last resort.
            const holdStatus = rental.deposit_hold_status;
            if (holdStatus === 'captured' || holdStatus === 'released' || holdStatus === 'expired') {
              return Number(rental.deposit_hold_amount) || 0;
            }
            const depositFromHold = Number(rental.deposit_hold_amount) || 0;
            const depositFromRentalOverride = Number((rental as any).deposit_amount_override) || 0;
            const depositFromTenant = tenant?.security_deposit_enabled ? Number(tenant?.global_deposit_amount) || 0 : 0;
            const depositFromInvoice = Number(invoiceBreakdown.securityDeposit) || 0;
            return depositFromHold || depositFromRentalOverride || depositFromTenant || depositFromInvoice;
          })(), depositHoldStatus: depositIsCharged ? null : (rental.deposit_hold_status || null), detail: (() => {
            if (depositIsCharged) {
              const led = paymentBreakdown?.['Security Deposit'];
              if (!led || led.total <= 0) return '';
              // The STATUS badge beside this already reads the refund ledger and
              // says Refunded / Partial Refund. This line did not, so a refunded
              // deposit kept describing itself as "Paid — refundable" directly
              // under a badge saying "Refunded" — the same fact, two answers.
              // Derived from the amounts, so it follows any refund size.
              const depositRefunded = refundBreakdown?.['Security Deposit'] ?? 0;
              if (depositRefunded > 0) {
                const deductedToMileage = (rentalCharges || []).some(c => c.category === 'Excess Mileage');
                if (deductedToMileage) return 'Applied to Excess Mileage';
                return depositRefunded >= led.paid - 0.01
                  ? 'Refunded to customer'
                  : 'Partially refunded';
              }
              if (led.remaining <= 0) return 'Paid — refundable';
              if (led.paid > 0) return 'Part paid';
              return 'Refundable deposit';
            }
            const depositAmount = Number(rental.deposit_hold_amount) || Number((rental as any).deposit_amount_override) || (tenant?.security_deposit_enabled ? Number(tenant?.global_deposit_amount) || 0 : 0) || Number(invoiceBreakdown.securityDeposit) || 0;
            if (depositAmount <= 0) return '';
            if (rental.deposit_hold_status === 'held') return 'On hold';
            if (rental.deposit_hold_status === 'captured') return 'Charged';
            if (rental.deposit_hold_status === 'released') return 'Released back to customer';
            if (rental.deposit_hold_status === 'expired') return 'Hold expired';
            // These three used to fall through to "No hold placed", which is a
            // lie — there IS a hold record, it's just mid-flight or broken.
            if (rental.deposit_hold_status === 'processing') return 'Authorisation in progress';
            if (rental.deposit_hold_status === 'refreshing') return 'Replacing the hold';
            if (rental.deposit_hold_status === 'failed') return 'Hold failed';
            // The four statuses the chained-hold work added (Aug 2026), when the
            // CHECK constraint went from 7 values to 11. None of them matched a
            // branch here, so they fell through to "No hold placed" — the SAME
            // lie the three above were fixed for, reopened from the other end.
            // It is not latent: _shared/deposit-hold-refresh.ts writes
            // 'requires_action' on every SCA and dead-card decline and
            // 'needs_review' on every unclassified failure and at the 8-attempt
            // ceiling, and reconcile-deposit-holds writes 'needs_review' for a
            // hold it cannot verify. Every one of those is a renter left
            // UNSECURED with a human being asked to act.
            //
            // The two strings here are lifted verbatim from REFRESH_RESULT_TITLES
            // at the top of this file, so the toast an operator saw after a
            // refresh and the row they are now looking at say the same thing.
            if (rental.deposit_hold_status === 'capturing') return 'Charging the hold';
            if (rental.deposit_hold_status === 'requires_action') return 'Card needs the customer';
            if (rental.deposit_hold_status === 'needs_review') return 'Needs a closer look';
            if (rental.deposit_hold_status === 'disputed') return 'Disputed by the customer';
            const depositRefunded = refundBreakdown?.['Security Deposit'] ?? 0;
            const hasExcessMileage = (rentalCharges || []).some(c => c.category === 'Excess Mileage');
            if (depositRefunded > 0 && hasExcessMileage) return 'Applied to Excess Mileage';
            if (depositRefunded > 0) return 'Refunded to customer';
            if (rental.status === 'Closed') return 'Eligible for refund';
            return 'No hold placed';
          })(), icon: Shield, color: 'text-amber-500', bg: 'bg-amber-500/10', isDepositDeducted: (() => {
            const depositRefunded = refundBreakdown?.['Security Deposit'] ?? 0;
            const hasExcessMileage = (rentalCharges || []).some(c => c.category === 'Excess Mileage');
            return depositRefunded > 0 && hasExcessMileage;
          })() },
          { label: 'Delivery Fee', category: 'Delivery Fee', amount: deliveryFeeAmount, detail: 'Vehicle delivery', icon: Truck, color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
          { label: 'Collection Fee', category: 'Collection Fee', amount: collectionFeeAmount, detail: 'Vehicle collection', icon: MapPin, color: 'text-rose-500', bg: 'bg-rose-500/10' },
          { label: 'Extras', category: 'Extras', amount: extrasTotal, detail: (extrasDetails?.length || 0) > 0 ? `${extrasDetails!.length} item${extrasDetails!.length > 1 ? 's' : ''}` : 'Add-ons', icon: Package, color: 'text-indigo-500', bg: 'bg-indigo-500/10', onClick: extrasTotal > 0 ? () => setShowExtrasDialog(true) : undefined },
        ];

        // Add excess mileage row if charge exists in the ledger
        const excessMileageCharge = (rentalCharges || []).find(c => c.category === 'Excess Mileage');
        if (excessMileageCharge) {
          rows.push({
            label: 'Excess Mileage',
            category: 'Excess Mileage',
            amount: excessMileageCharge.amount,
            detail: excessMileageCharge.reference || 'Over mileage allowance',
            icon: Gauge,
            color: 'text-red-500',
            bg: 'bg-red-500/10',
          });
        }

        // Payment Breakdown card renders unconditionally for every rental.
        // All-zero upfront rows render dimmed ("$0.00 · Not applied") so the
        // card is not cluttered when there's genuinely nothing to bill
        // up-front.

        // Compute which rows have unpaid charges (selectable for targeted payment)
        // Don't allow payments on cancelled/rejected rentals
        const isCancelledOrRejected = rental.status === 'Cancelled' || rental.approval_status === 'rejected';

        const selectableCategories = rows
          .filter(({ category, amount }) => {
            if (amount <= 0) return false;
            const refunded = refundBreakdown?.[category] ?? 0;
            if (refunded >= amount) return false;
            // Selectable if there's a remaining amount (from ledger or invoice)
            return (categoryRemainingAmounts[category] ?? 0) > 0;
          })
          .map(r => r.category);

        const allUnpaidSelected = selectableCategories.length > 0 && selectableCategories.every(c => selectedCategories.has(c));
        const someUnpaidSelected = selectableCategories.some(c => selectedCategories.has(c));

        const selectedTotal = selectableCategories
          .filter(c => selectedCategories.has(c))
          .reduce((sum, c) => sum + (categoryRemainingAmounts[c] ?? 0), 0);

        const toggleCategory = (category: string) => {
          setSelectedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) {
              next.delete(category);
            } else {
              next.add(category);
            }
            return next;
          });
        };

        const toggleAllUnpaid = () => {
          if (allUnpaidSelected) {
            setSelectedCategories(new Set());
          } else {
            setSelectedCategories(new Set(selectableCategories));
          }
        };

        // Render the original breakdown table (reused in both accordion and standalone)
        const renderOriginalBreakdownTable = () => (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6 w-10">
                    {selectableCategories.length > 0 ? (
                      <Checkbox
                        checked={allUnpaidSelected ? true : someUnpaidSelected ? "indeterminate" : false}
                        onCheckedChange={toggleAllUnpaid}
                        aria-label="Select all unpaid"
                      />
                    ) : null}
                  </TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead className="text-right pr-6">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ label, category, amount, detail, icon: Icon, color, bg, nonRefundable, onClick, isDepositDeducted, depositHoldStatus }: any, idx: number) => {
                  const refunded = isDepositDeducted ? 0 : (refundBreakdown?.[category] ?? 0);
                  const applied = amount > 0;
                  const fullyRefunded = !isDepositDeducted && applied && refunded >= amount;
                  const net = amount - refunded;
                  // Check if insurance charge is unpaid
                  const isInsuranceUnpaid = category === 'Insurance' && insuranceCharge && insuranceCharge.remaining_amount > 0;
                  // Check if excess mileage charge is unpaid
                  const isExcessMileageUnpaid = category === 'Excess Mileage' && excessMileageCharge && excessMileageCharge.remaining_amount > 0;
                  const isSelectable = selectableCategories.includes(category);
                  // A charged deposit is always actionable: it must stay live even
                  // with nothing raised yet, so an operator who skipped it at
                  // creation can still take one without unwinding the rental.
                  const isChargedDepositRow = depositIsCharged && category === 'Security Deposit';
                  const effectiveOnClick = onClick;
                  const isSelected = selectedCategories.has(category);

                  return (
                    <Fragment key={category}>
                    <TableRow className={`${(!applied || isDepositDeducted) && !isChargedDepositRow ? 'opacity-40' : ''} ${effectiveOnClick ? 'cursor-pointer hover:bg-muted/30' : ''}`} onClick={effectiveOnClick}>
                      <TableCell className="pl-6 w-10">
                        {isSelectable ? (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleCategory(category)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select ${label}`}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {category === 'Insurance' ? (
                            <div className="h-7 w-7 flex items-center justify-center">
                              <img src="/bonzah-logo.svg" alt="Bonzah" className="h-5 w-auto dark:hidden" />
                              <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="h-5 w-auto hidden dark:block" />
                            </div>
                          ) : (
                            <div className={`h-7 w-7 rounded-full flex items-center justify-center ${applied ? bg : 'bg-muted/30'}`}>
                              <Icon className={`h-3.5 w-3.5 ${applied ? color : 'text-muted-foreground/50'}`} />
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-medium flex items-center gap-1">
                              {label}
                              {effectiveOnClick && <ExternalLink className="h-3 w-3 inline-block ml-1.5 text-muted-foreground" />}
                            </div>
                            <p className="text-xs text-muted-foreground">{applied ? detail : 'Not applied'}</p>
                            {/* Expiry of the Stripe authorisation. This was never
                                rendered anywhere in the portal, so an operator had
                                no way to see a hold was about to die under them —
                                they only found out when a capture failed. */}
                            {category === 'Security Deposit' && (() => {
                              // 'processing'/'refreshing' mean a worker is placing a
                              // NEW authorisation right now, and neither writer clears
                              // deposit_hold_expires_at when it claims the row — so the
                              // column still holds the OUTGOING hold's date, which by
                              // definition is at or past expiry (that is why the cron
                              // picked the row up). Rendering it would shout
                              // "Authorisation lapsed" in red over a hold that is being
                              // placed successfully. Say what is actually happening
                              // instead.
                              if (depositHoldStatus === 'processing' || depositHoldStatus === 'refreshing') {
                                return (
                                  <p className="text-xs mt-0.5 flex items-center gap-1 text-muted-foreground">
                                    <Clock className="h-3 w-3 shrink-0" />
                                    Placing a new authorisation…
                                  </p>
                                );
                              }
                              // The four states the chained-hold work added. A
                              // stored expiry date says nothing useful in any of
                              // them — the engine NULLs deposit_hold_expires_at on
                              // every one of these exits, and on 'disputed' the
                              // date describes an authorisation that is now
                              // contested. What the operator needs instead is who
                              // has to act, so say that, in the same slot the
                              // expiry warning uses. 'requires_action' and
                              // 'needs_review' both mean the renter is holding
                              // NOTHING (see the `money: "unsecured"` exits in
                              // _shared/deposit-hold-refresh.ts) — that fact goes
                              // first, because it is the one that costs money.
                              if (depositHoldStatus === 'capturing') {
                                return (
                                  <p className="text-xs mt-0.5 flex items-center gap-1 text-muted-foreground">
                                    <Clock className="h-3 w-3 shrink-0" />
                                    Taking the deposit from this authorisation…
                                  </p>
                                );
                              }
                              if (depositHoldStatus === 'requires_action') {
                                return (
                                  <p className="text-xs mt-0.5 flex items-center gap-1 text-orange-500 font-medium">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    Not secured — the customer must authorise the card (3DS, or it needs replacing). This cannot be fixed from here.
                                  </p>
                                );
                              }
                              if (depositHoldStatus === 'needs_review') {
                                return (
                                  <p className="text-xs mt-0.5 flex items-center gap-1 text-rose-500 font-medium">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    Not secured — we could not establish what this authorisation is doing. Check with Stripe before placing another.
                                  </p>
                                );
                              }
                              if (depositHoldStatus === 'disputed') {
                                return (
                                  <p className="text-xs mt-0.5 flex items-center gap-1 text-red-600 font-medium">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    Chargeback opened — charging and deducting are blocked until the dispute resolves.
                                  </p>
                                );
                              }
                              if (depositHoldStatus !== 'held' && depositHoldStatus !== 'expired') return null;
                              const expiry = describeHoldExpiry(rental.deposit_hold_expires_at);
                              if (!expiry) return null;
                              // 'expired' with a still-future timestamp means the hold
                              // died EARLY (cancelled, or the bank pulled it), so the
                              // stored date describes nothing that happened. Only show
                              // the date on this status when it corroborates the badge.
                              if (depositHoldStatus === 'expired' && expiry.tone !== 'past') return null;
                              return (
                                <p
                                  className={`text-xs mt-0.5 flex items-center gap-1 ${
                                    expiry.tone === 'past'
                                      ? 'text-red-500 font-medium'
                                      : expiry.tone === 'soon'
                                        ? 'text-amber-500 font-medium'
                                        : 'text-muted-foreground'
                                  }`}
                                >
                                  {expiry.tone === 'ok' ? <Clock className="h-3 w-3 shrink-0" /> : <AlertTriangle className="h-3 w-3 shrink-0" />}
                                  {expiry.label}
                                </p>
                              );
                            })()}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-muted-foreground border-muted-foreground/20 text-[11px]"
                        >
                          Regular
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          // Security Deposit with active hold — show hold-specific statuses
                          if (depositHoldStatus) {
                            if (depositHoldStatus === 'held') return <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[11px]">Held</Badge>;
                            if (depositHoldStatus === 'captured') return <Badge variant="outline" className="text-red-500 border-red-500/30 bg-red-500/10 text-[11px]">Charged</Badge>;
                            if (depositHoldStatus === 'released') return <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 text-[11px]">Released</Badge>;
                            if (depositHoldStatus === 'expired') return <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 text-[11px]">Expired</Badge>;
                            // Previously unrendered — these fell through to the
                            // "No Hold" badge below, which told the operator the
                            // opposite of the truth.
                            if (depositHoldStatus === 'processing') return <Badge variant="outline" className="text-blue-500 border-blue-500/30 bg-blue-500/10 text-[11px]">Processing</Badge>;
                            if (depositHoldStatus === 'refreshing') return <Badge variant="outline" className="text-indigo-500 border-indigo-500/30 bg-indigo-500/10 text-[11px]">Refreshing</Badge>;
                            if (depositHoldStatus === 'failed') return <Badge variant="outline" className="text-red-500 border-red-500/30 bg-red-500/10 text-[11px]">Failed</Badge>;
                            // The four the widened CHECK constraint added. Until
                            // now they matched nothing here and fell through to
                            // "No Hold" below — telling the operator there was no
                            // authorisation at the precise moment the renter was
                            // unsecured and someone had to act. Distinct colours
                            // on purpose: 'Capturing' is in-flight and needs
                            // nobody; the other three each need a DIFFERENT
                            // human (the customer, us, or the dispute process).
                            if (depositHoldStatus === 'capturing') return <Badge variant="outline" className="text-purple-500 border-purple-500/30 bg-purple-500/10 text-[11px]">Capturing</Badge>;
                            if (depositHoldStatus === 'requires_action') return <Badge variant="outline" className="text-orange-500 border-orange-500/40 bg-orange-500/10 text-[11px]">Action Needed</Badge>;
                            if (depositHoldStatus === 'needs_review') return <Badge variant="outline" className="text-rose-500 border-rose-500/40 bg-rose-500/10 text-[11px]">Needs Review</Badge>;
                            if (depositHoldStatus === 'disputed') return <Badge variant="outline" className="text-red-600 border-red-600/50 bg-red-600/15 text-[11px]">Disputed</Badge>;
                          }
                          // HOLD path only. A hold that never fired genuinely has no
                          // payment state, so "Not Paid" would be wrong there.
                          //
                          // A CHARGED deposit is the opposite: it IS a charge, the
                          // customer's card really was debited, and it has exactly the
                          // same paid / partially-paid / not-paid / refunded states as
                          // every other category. Short-circuiting to "No Hold" told the
                          // operator a paid, refunded deposit had no hold — true but
                          // useless, and it hid whether the money had actually arrived.
                          if (category === 'Security Deposit' && !depositIsCharged) {
                            return <Badge variant="outline" className="text-muted-foreground/60 border-muted-foreground/20 text-[11px]">No Hold</Badge>;
                          }
                          if (isDepositDeducted) {
                            return <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[11px]">Deducted</Badge>;
                          }
                          if (!applied) {
                            return <Badge variant="outline" className="text-muted-foreground/60 border-muted-foreground/20 text-[11px]">Not Applied</Badge>;
                          }
                          if (fullyRefunded) {
                            return <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[11px]">Refunded</Badge>;
                          }
                          if (refunded > 0) {
                            return <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[11px]">Partial Refund</Badge>;
                          }
                          // Check payment status from ledger breakdown
                          const catPayment = paymentBreakdown?.[category];
                          // Also check directly from rentalCharges (loaded with allocations)
                          const catCharges = rentalCharges?.filter(c => c.category === category) || [];
                          const catChargeRemaining = catCharges.reduce((sum, c) => sum + Number(c.remaining_amount), 0);
                          const catChargeTotal = catCharges.reduce((sum, c) => sum + Number(c.amount), 0);
                          const catAllocated = catCharges.reduce((sum, c) => sum + c.allocations.reduce((s, a) => s + Number(a.amount_applied), 0), 0);

                          if (catPayment) {
                            if (Number(catPayment.remaining) <= 0) {
                              return <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 text-[11px]">Paid</Badge>;
                            }
                            if (Number(catPayment.paid) > 0) {
                              return <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[11px]">Partially Paid</Badge>;
                            }
                          } else if (catCharges.length > 0) {
                            // Fallback: check directly from charge data
                            if (catChargeRemaining <= 0 && catChargeTotal > 0) {
                              return <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 text-[11px]">Paid</Badge>;
                            }
                            if (catAllocated > 0) {
                              return <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[11px]">Partially Paid</Badge>;
                            }
                          }
                          // On cancelled/rejected rental, show "Cancelled" instead of "Not Paid"
                          if (isCancelledOrRejected) {
                            return <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 text-[11px]">Cancelled</Badge>;
                          }
                          return <Badge variant="outline" className="text-red-500 border-red-500/30 bg-red-500/10 text-[11px]">Not Paid</Badge>;
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`text-sm font-semibold ${!applied ? 'text-muted-foreground/50' : ''}`}>
                          {formatCurrencyUtil(amount, tenant?.currency_code || 'USD')}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {refunded > 0 ? (
                          <span className="text-sm text-amber-500 font-medium">{formatCurrencyUtil(refunded, tenant?.currency_code || 'USD')}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground/40">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center gap-2 justify-end">
                        {category === 'Security Deposit' && !depositIsCharged && (depositHoldStatus === 'held' || depositHoldStatus === 'expired' || !depositHoldStatus) ? (
                          // Deliberately the SAME three statuses this branch owned before
                          // (held / expired / no hold). It must not swallow 'processing',
                          // 'refreshing', 'failed', 'captured' or 'released': those fall
                          // through to the generic ladder below, which carries real
                          // Security-Deposit handling (isDepositUsed, the Release/Release
                          // More button, Add Payment). A rental whose hold failed and
                          // whose deposit was then collected manually still has to be
                          // releasable from this row. The hold-specific affordances for
                          // those states are appended after the ladder instead — see the
                          // in-flight block below.
                          //
                          // What IS new here is "Check with Stripe" on held/expired. The
                          // stored status is not trustworthy on its own: a Stripe
                          // authorisation lapses after ~5-7 days and nothing pushes that
                          // to us, so 'held' can (and for GMT's 60-120 day rentals
                          // routinely does) sit over a dead auth, with both Add Hold and
                          // Refresh refusing to run. Reconciling first unblocks them.
                          <div className="flex items-center gap-2 justify-end">
                            {/* Release CANCELS a live authorisation and Charge CAPTURES
                                it — the two most destructive things this row can do to
                                a renter's card. They were the only write buttons in
                                this cell with no permission gate, which left the UI
                                incoherent once `canEdit` began answering for `viewer`:
                                the safe reconcile action ("Check with Stripe", below)
                                would disappear for a read-only user while these two
                                stayed. Same predicate as every other write control on
                                this page. */}
                            {depositHoldStatus === 'held' && canEdit('rentals') && (
                              <>
                                <button
                                  className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      // supabase.functions.invoke() does NOT throw on a
                                      // non-2xx response — it resolves with { data, error }.
                                      // We must inspect both, otherwise a server-side 500
                                      // (e.g. the hold could not be cancelled) silently
                                      // shows a success toast while the status never changes.
                                      const { data, error } = await supabase.functions.invoke('release-deposit-hold', {
                                        body: { rentalId: rental.id, tenantId: tenant?.id },
                                      });
                                      if (error) {
                                        let detail = error.message;
                                        try {
                                          const body = await error.context?.json?.();
                                          if (body?.error) detail = body.error;
                                        } catch { /* ignore parse errors */ }
                                        throw new Error(detail);
                                      }
                                      if (data && data.success === false) {
                                        throw new Error(data.error || 'Failed to release the deposit hold.');
                                      }
                                      queryClient.invalidateQueries({ queryKey: ['rental', rental.id] });
                                      toast({ title: 'Deposit Released', description: 'The deposit hold has been released.' });
                                    } catch (err: any) {
                                      toast({ title: 'Error', description: err.message, variant: 'destructive' });
                                    }
                                  }}
                                >
                                  Release
                                </button>
                                <button
                                  className="text-xs font-medium text-red-500 hover:text-red-400 hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowChargeDepositDialog(true);
                                  }}
                                >
                                  Charge
                                </button>
                              </>
                            )}

                            {depositHoldStatus === 'expired' && (
                              // Charge opens the two-step dialog: explain → Refresh hold →
                              // Charge. Add Hold is offered alongside it because "put a
                              // live hold back on the card" is a legitimate end in itself —
                              // it doesn't have to be followed by taking the money.
                              <>
                                {/* Gated for the same reason as its Add Hold sibling
                                    directly below: the dialog it opens places a fresh
                                    authorisation and then captures it. Left as a
                                    per-button gate rather than hoisted onto the branch
                                    so the two stay visibly parallel. */}
                                {canEdit('rentals') && (
                                  <button
                                    className="text-xs font-medium text-amber-500 hover:text-amber-400 hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowChargeDepositDialog(true);
                                    }}
                                  >
                                    Refresh &amp; Charge
                                  </button>
                                )}
                                {canEdit('rentals') && (
                                  <button
                                    className="text-xs font-medium text-amber-500 hover:text-amber-400 hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowAddHoldDialog(true);
                                    }}
                                  >
                                    Add Hold
                                  </button>
                                )}
                              </>
                            )}

                            {depositHoldStatus === 'released' &&
                              rental.status !== 'Closed' &&
                              rental.status !== 'Cancelled' &&
                              canEdit('rentals') && (
                              // A RELEASED hold on a rental that is still running is not
                              // a finished story — it is an uncovered vehicle.
                              //
                              // Gated on the rental still being open. A deposit released
                              // at the end of a completed rental is the correct outcome
                              // and must not sprout an "Add Hold" button — that is the
                              // normal, finished path and offering to re-authorise a
                              // returned customer would be worse than useless.
                              //
                              // 'released' was the one non-terminal-in-practice status
                              // with no placement entry point at all: 'expired', null,
                              // 'failed', 'requires_action' and 'needs_review' each offer
                              // one, so a released hold rendered a green "Released" badge
                              // and no way forward. Observed live on GMT R-161fe1 — an
                              // Active rental whose deposit had been released, with the
                              // car still out and the operator unable to re-secure it
                              // from this screen.
                              //
                              // Safe to offer: place-deposit-hold probes Stripe before
                              // refusing and only blocks when an authorisation is
                              // genuinely ALIVE, so a released (cancelled) PaymentIntent
                              // cannot produce a double hold.
                              <button
                                className="text-xs font-medium text-amber-500 hover:text-amber-400 hover:underline"
                                title="The previous deposit was released. Place a new hold on the card."
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowAddHoldDialog(true);
                                }}
                              >
                                Add Hold
                              </button>
                            )}

                            {!depositHoldStatus && (
                              // No usable hold — open the Add Hold dialog which offers
                              // "Place via Stripe" (new tab) and "Send email link".
                              //
                              // This was the ONE placement entry point with no gate.
                              // Its three siblings — Add Hold on 'expired' just above,
                              // Add Hold on 'failed' in the in-flight block, and "Send
                              // card link" on 'requires_action' — all sit behind
                              // canEdit('rentals'), and add-hold-dialog.tsx carries no
                              // permission check of its own, so this branch was the
                              // whole click-path: a read-only user could open the
                              // dialog and put a real authorisation on a renter's card
                              // (or email them a link to do it). It is also the branch
                              // a read-only user is MOST likely to meet, since a
                              // rental that never had a hold renders it unconditionally.
                              //
                              // The gate is nested rather than folded into the
                              // condition above so the branch keeps reading as "no
                              // hold here", with permission as a separate question.
                              // Client gating is UX only — the enforceable boundary is
                              // the server-side authorisation in the deposit-hold edge
                              // functions.
                              canEdit('rentals') && (
                                <button
                                  className="text-xs font-medium text-amber-500 hover:text-amber-400 hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowAddHoldDialog(true);
                                  }}
                                >
                                  Add Hold
                                </button>
                              )
                            )}

                            {/* Both diagnostics moved behind the ⋯ so that Release
                                and Charge above are the only one-click actions in
                                this cell. Nothing about WHO may run them changed:
                                the two gates below are the same expressions that
                                guarded the inline buttons, kept here rather than
                                hoisted so each stays next to its reason. */}
                            <HoldActionsMenu busy={verifyingHold || forceRefreshingHold} busyLabel={verifyingHold ? "Checking…" : "Refreshing…"}>
                              {/* Reconcile against Stripe. Gated on canEdit because
                                  verify-deposit-hold WRITES (it corrects
                                  deposit_hold_status), so it is not a viewer action.
                                  Only offered where there is a PaymentIntent worth
                                  asking about — never on the no-hold row. */}
                              {depositHoldStatus && canEdit('rentals') && (
                                <HoldMenuAction
                                  tone="text-indigo-500"
                                  disabled={verifyingHold}
                                  spinning={verifyingHold}
                                  label={verifyingHold ? 'Checking…' : 'Check with Stripe'}
                                  description="Confirm the real status with Stripe"
                                  title="Ask Stripe whether this authorisation is still live and correct the status"
                                  onSelect={() => handleVerifyDepositHold()}
                                />
                              )}

                              {/* Re-drive the chain for this one rental instead of
                                  waiting for the nightly cron. Gated to 'held' —
                                  NOT to every status with a hold — because
                                  REFRESHABLE_HOLD_STATUSES in the engine is
                                  exactly ['held','failed']. An 'expired' row can
                                  never be selected by the driver, so a Force
                                  refresh there would always report "nothing was
                                  due" and read as a broken button; Refresh &
                                  Charge / Add Hold are the real routes out of
                                  'expired' and are already offered above.
                                  head_admin/admin only: the engine CANCELS the
                                  live authorisation before placing a
                                  replacement. */}
                              {depositHoldStatus === 'held' && isAdmin() && (
                                <HoldMenuAction
                                  tone="text-violet-500"
                                  disabled={forceRefreshingHold}
                                  spinning={forceRefreshingHold}
                                  label={forceRefreshingHold ? 'Refreshing…' : 'Force refresh'}
                                  description="Re-authorise now"
                                  title="Run the deposit-hold refresh for this rental now instead of waiting for tonight's job"
                                  onSelect={() => setShowForceRefreshDialog(true)}
                                />
                              )}
                            </HoldActionsMenu>
                          </div>
                        ) : isExcessMileageUnpaid && excessMileageCharge ? (
                          <div className="flex items-center gap-2 justify-end">
                            {(() => {
                              // Only show Deduct Deposit if deposit charge exists and has remaining > 0
                              const depositCharge = (rentalCharges || []).find(c => c.category === 'Security Deposit');
                              // NOTE the sense of this test: remaining_amount > 0 means the deposit is
                              // UNPAID. It reads correctly on the hold path, where no deposit Charge row
                              // exists at all and depositFromInvoice does the work.
                              const depositAvailable = depositCharge && Number(depositCharge.remaining_amount) > 0;
                              const depositFromInvoice = !depositCharge && invoiceBreakdown && invoiceBreakdown.securityDeposit > 0;

                              // On the CHARGED path this button is a dead end. Its edge function
                              // (deduct-from-deposit) captures against a live authorisation, and a
                              // charged tenant never has one — so it now refuses them outright rather
                              // than falling through to a legacy branch that refunded an unrelated
                              // payment. The test above is also inverted for charged deposits: it shows
                              // when the deposit is UNPAID (nothing to take) and hides once it is PAID
                              // (when the operator actually holds the money).
                              //
                              // There is no cash movement to make here anyway: the operator already
                              // holds the deposit, so covering excess mileage means collecting the
                              // charge and returning less of the deposit at the end. The Add Payment
                              // button beside this one is that path.
                              if (depositIsCharged) return null;
                              // A chargeback has been raised against the
                              // authorisation this button would draw on.
                              // deduct-from-deposit captures against that same
                              // PaymentIntent, so pressing it during a dispute
                              // either fails at Stripe or takes money that is
                              // already being clawed back — and either way it
                              // weakens the tenant's position on the dispute.
                              // Say that instead of offering the button.
                              if (rental.deposit_hold_status === 'disputed') {
                                return (
                                  <span
                                    className="text-xs font-medium text-red-600 inline-flex items-center gap-1"
                                    title="The deposit authorisation is under a chargeback. Deducting from it is blocked until the dispute resolves — collect this by payment link instead."
                                  >
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    Deposit disputed
                                  </span>
                                );
                              }
                              return (depositAvailable || depositFromInvoice) ? (
                                <button
                                  className="text-xs text-amber-500 hover:text-amber-400 hover:underline font-medium"
                                  disabled={isDeductingDeposit}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowDeductFromDepositDialog(true);
                                  }}
                                >
                                  {isDeductingDeposit ? 'Deducting...' : 'Deduct Deposit'}
                                </button>
                              ) : null;
                            })()}
                            <button
                              className="text-xs font-medium text-blue-500 hover:text-blue-400 hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCategories(new Set(['Excess Mileage']));
                                setShowTargetedPayment(true);
                              }}
                            >
                              Add Payment
                            </button>
                          </div>
                        ) : nonRefundable && applied ? (
                          <span className="text-xs text-muted-foreground/50">-</span>
                        ) : (() => {
                          // Show Refund if category has been paid (via ledger or total payment coverage)
                          const catPayment = paymentBreakdown?.[category];
                          const categoryHasBeenPaid = catPayment ? catPayment.paid > 0 : false;
                          // Security Deposit: disable refund if deposit was already used (deducted for excess mileage — remaining=0 and refunded)
                          const isDepositUsed = !depositIsCharged && category === 'Security Deposit' && (refundBreakdown?.['Security Deposit'] ?? 0) > 0;
                          const wouldShowRefund = applied && !fullyRefunded && categoryHasBeenPaid && canRefund && !isDepositUsed;
                          return wouldShowRefund;
                        })() ? (
                          <>
                            {(() => {
                              const manualPaid = manualPaidByCategory?.[category] ?? 0;
                              const refundedForCat = refundBreakdown?.[category] ?? 0;
                              const showUndo = manualPaid > 0 && refundedForCat === 0 && category !== 'Security Deposit';
                              if (!showUndo) return null;
                              return (
                                <button
                                  className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setUndoCategory(category);
                                    setUndoAmount(manualPaid);
                                    setShowUndoDialog(true);
                                  }}
                                >
                                  Undo
                                </button>
                              );
                            })()}
                            <button
                              className="text-xs font-medium text-orange-500 hover:text-orange-400 hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRefundCategory(category);
                                setRefundTotalAmount(amount);
                                const alreadyRefunded = refundBreakdown?.[category] ?? 0;
                                setRefundPaidAmount(Math.max(0, amount - alreadyRefunded));
                                setRefundExtensionId(undefined);
                                setShowRefundDialog(true);
                              }}
                            >
                              {category === 'Security Deposit' && !depositIsCharged ? (refunded > 0 ? 'Release More' : 'Release') : (refunded > 0 ? 'Refund More' : 'Refund')}
                            </button>
                          </>
                        ) : applied && fullyRefunded ? (
                          <Check className="h-4 w-4 text-green-500 inline-block" />
                        ) : (() => {
                          // Show Add Payment if category has remaining amount AND is NOT covered by total payments.
                          const catRemaining = categoryRemainingAmounts[category] ?? 0;
                          // Nothing raised yet on a charged deposit: still offer it,
                          // so the deposit can be taken mid-rental. Every other
                          // category needs an outstanding amount to be payable.
                          if (isChargedDepositRow && amount <= 0 && !isCancelledOrRejected) return true;
                          const wouldBeSelectable = (isSelectable || (applied && !fullyRefunded && catRemaining > 0)) && !isCancelledOrRejected;
                          return wouldBeSelectable;
                        })() ? (
                          <button
                            className="text-xs font-medium text-blue-500 hover:text-blue-400 hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              // No deposit charge yet — raise one (with the amount
                              // confirmation) before any money is taken, or the
                              // payment would have nothing to settle against.
                              if (isChargedDepositRow && amount <= 0) {
                                setShowTakeDeposit(true);
                                return;
                              }
                              setSelectedCategories(new Set([category]));
                              setShowTargetedPayment(true);
                            }}
                          >
                            {isChargedDepositRow && amount <= 0 ? 'Take Deposit' : 'Add Payment'}
                          </button>
                        ) : (
                          <span className="text-muted-foreground/30">-</span>
                        )}

                        {/* In-flight / broken hold affordances, rendered ALONGSIDE the
                            ladder above rather than instead of it.
                            'processing', 'refreshing' and 'failed' have always fallen
                            through to that ladder, and that is where a deposit collected
                            outside the hold gets its Release / Release More / Add Payment
                            button — swallowing these statuses into a hold-only branch
                            would take those away from every tenant. So the hold actions
                            are appended here instead of replacing anything.
                            'processing'/'refreshing' deliberately get NO placement
                            button: a second authorisation while one is in flight
                            double-holds the customer's card. Check with Stripe is how you
                            find out whether it really finished. */}
                        {category === 'Security Deposit'
                          && ['processing', 'refreshing', 'failed'].includes(depositHoldStatus || '')
                          && canEdit('rentals') && (
                          <>
                            {depositHoldStatus === 'failed' && (
                              <button
                                className="text-xs font-medium text-amber-500 hover:text-amber-400 hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowAddHoldDialog(true);
                                }}
                              >
                                Add Hold
                              </button>
                            )}
                            {/* Same kebab as the ladder above. Add Hold stays
                                inline beside it because it places a real
                                authorisation; these two only look at one. */}
                            <HoldActionsMenu busy={verifyingHold || forceRefreshingHold} busyLabel={verifyingHold ? "Checking…" : "Refreshing…"}>
                              <HoldMenuAction
                                tone="text-indigo-500"
                                disabled={verifyingHold}
                                spinning={verifyingHold}
                                label={verifyingHold ? 'Checking…' : 'Check with Stripe'}
                                description="Confirm the real status with Stripe"
                                title="Ask Stripe whether this authorisation is still live and correct the status"
                                onSelect={() => handleVerifyDepositHold()}
                              />
                              {/* Force refresh is offered on 'failed' only.
                                  'processing'/'refreshing' mean another worker
                                  holds the CAS claim on this row: dispatching
                                  into that would at best lose the race and at
                                  worst race a live Stripe call, so those two get
                                  Check with Stripe and nothing else — the same
                                  rule that denies them a placement button above. */}
                              {depositHoldStatus === 'failed' && isAdmin() && (
                                <HoldMenuAction
                                  tone="text-violet-500"
                                  disabled={forceRefreshingHold}
                                  spinning={forceRefreshingHold}
                                  label={forceRefreshingHold ? 'Refreshing…' : 'Force refresh'}
                                  description="Re-authorise now"
                                  title="Retry the deposit-hold chain for this rental now instead of waiting for tonight's job"
                                  onSelect={() => setShowForceRefreshDialog(true)}
                                />
                              )}
                            </HoldActionsMenu>
                          </>
                        )}

                        {/* The four statuses the chained-hold work added, appended
                            the same way and for the same reason as the block
                            above: none of them belongs in the hold-only branch at
                            the top of this cell, because that branch REPLACES the
                            generic ladder, and the generic ladder is where a
                            deposit collected outside the hold gets its Release /
                            Add Payment button. Taking that away from a rental
                            whose card went bad would be a second dead end.

                            Who is being asked to act decides what is offered:

                              capturing       nobody — a capture is in flight.
                                              No button at all, not even Check
                                              with Stripe: verify-deposit-hold
                                              only treats 'processing'/'refreshing'
                                              as worker-owned, so on 'capturing'
                                              it WOULD write, and a PI still at
                                              requires_capture maps back to
                                              'held' — stamping that over a
                                              capture in flight.
                              requires_action the CUSTOMER — SCA, or the card is
                                              unusable. There is no server-side
                                              fix (the engine says so in as many
                                              words), so the useful action is a
                                              fresh authorisation link to them.
                              needs_review    US — we do not know what is true.
                                              Check with Stripe is the whole job,
                                              so it is the only thing offered and
                                              it is styled to be found.
                              disputed        the dispute process. Capture and
                                              deduct are blocked outright; see the
                                              Deduct Deposit guard on the Excess
                                              Mileage row. */}
                        {category === 'Security Deposit'
                          && ['capturing', 'requires_action', 'needs_review', 'disputed'].includes(depositHoldStatus || '') && (
                          <>
                            {depositHoldStatus === 'capturing' && (
                              <span
                                className="text-xs text-muted-foreground inline-flex items-center gap-1"
                                title="A capture is in flight on this authorisation. It will settle to Charged or fall back on its own."
                              >
                                <RefreshCw className="h-3 w-3 animate-spin" />
                                Capturing…
                              </span>
                            )}

                            {depositHoldStatus === 'disputed' && (
                              <span
                                className="text-xs font-medium text-red-600 inline-flex items-center gap-1"
                                title="A chargeback has been raised against this authorisation. Charging it or deducting from it is blocked until the dispute is resolved — contest it in Stripe."
                              >
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                Charge blocked
                              </span>
                            )}

                            {/* Reaching the customer IS the fix here, so it leads.
                                The dialog it opens offers both routes: email them
                                a link, or run Stripe Checkout at the counter if
                                they are standing there. create-hold-checkout
                                guards only on 'held', so it will not refuse this
                                row — and the authorisation that stalled is holding
                                nothing, so there is no double-hold to cause. */}
                            {depositHoldStatus === 'requires_action' && canEdit('rentals') && (
                              <button
                                className="text-xs font-medium text-orange-500 hover:text-orange-400 hover:underline"
                                title="Send the customer a fresh authorisation link, or take one at the counter. The card cannot be re-authorised from here — it needs the cardholder."
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowAddHoldDialog(true);
                                }}
                              >
                                Send card link
                              </button>
                            )}

                            {/* 'needs_review' with NO PaymentIntent is a dead
                                end: the engine NULLs the intent when it gives up
                                (one unclassified Stripe error is enough — it does
                                not take the 8-attempt ceiling), neither driver
                                re-selects the row, and the reconciler has nothing
                                to probe. Yet the alert this state raises tells the
                                operator to "re-place the hold on a working card or
                                release it" — actions this screen did not offer.
                                Safe to place a new hold precisely BECAUSE the
                                intent is null: nothing is authorised, so there is
                                no double-hold to cause. When an intent DOES exist
                                the ⋯ menu's reconcile remains the right route, so
                                this button is gated on its absence. */}
                            {depositHoldStatus === 'needs_review' &&
                              !rental.deposit_hold_payment_intent_id &&
                              canEdit('rentals') && (
                                <button
                                  className="text-xs font-medium text-indigo-600 hover:text-indigo-500 hover:underline"
                                  title="No authorisation exists on this rental — the last attempt gave up without one. Place a fresh hold."
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowAddHoldDialog(true);
                                  }}
                                >
                                  Place new hold
                                </button>
                              )}

                            {/* Both of these states exist because something is
                                unverified, so the reconcile is the way out of
                                both. On 'needs_review' it is the ONLY way out,
                                which is why the emphasis it used to carry as an
                                inline button now sits on the closed ⋯ trigger —
                                otherwise the one status whose entire job is a
                                single action would be the one status drawn as an
                                unremarkable grey dot. Not offered on 'capturing'
                                or 'disputed' — see the note above; the menu
                                renders nothing at all for those two, and
                                HoldActionsMenu suppresses its own trigger rather
                                than opening onto an empty list. */}
                            <HoldActionsMenu
                              emphasizeTrigger={depositHoldStatus === 'needs_review'}
                              /* needs_review's ONLY exit is the item inside this
                                 menu, so the trigger is labelled as well as
                                 emphasised — an operator should not have to
                                 discover a bare icon to clear the one status
                                 that cannot clear itself. */
                              triggerLabel={depositHoldStatus === 'needs_review' ? 'Resolve' : undefined}
                              busy={verifyingHold}
                              busyLabel="Checking…"
                            >
                              {(depositHoldStatus === 'requires_action' || depositHoldStatus === 'needs_review') && canEdit('rentals') && (
                                <HoldMenuAction
                                  tone="text-indigo-500"
                                  disabled={verifyingHold}
                                  spinning={verifyingHold}
                                  label={verifyingHold ? 'Checking…' : 'Check with Stripe'}
                                  description="Confirm the real status with Stripe"
                                  title="Ask Stripe whether this authorisation is still live and correct the status"
                                  onSelect={() => handleVerifyDepositHold()}
                                />
                              )}
                            </HoldActionsMenu>
                          </>
                        )}

                        </div>
                      </TableCell>
                    </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>

            {/* Selection footer for targeted payment */}
            {selectedCategories.size > 0 && (
              <div className="sticky bottom-0 border-t bg-primary/20 border-primary/40 px-6 py-3 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedCategories.size} item{selectedCategories.size > 1 ? 's' : ''} selected &mdash;{' '}
                  <span className="font-semibold text-foreground">{formatCurrencyUtil(selectedTotal, tenant?.currency_code || 'USD')}</span>
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => setShowTargetedPayment(true)}
                  >
                    <DollarSign className="h-3.5 w-3.5 mr-1.5" />
                    Add Payment
                  </Button>
                </div>
              </div>
            )}
          </>
        );

        return (
          <Card className={isProcessingPayment ? 'opacity-50 pointer-events-none' : ''}>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-medium">Payment Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {renderOriginalBreakdownTable()}
            </CardContent>
          </Card>
        );

      })()}

      {/* Rental Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Rental Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Customer & Vehicle Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-muted/30 rounded-lg p-4 space-y-1">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Customer</p>
              <p className="text-lg font-semibold">{rental.customers?.name}</p>
              {identityVerification?.date_of_birth && (
                <p className="text-sm text-muted-foreground">
                  DOB: {parseLocalDate(identityVerification.date_of_birth).toLocaleDateString('en-US')} ({Math.floor((Date.now() - parseLocalDate(identityVerification.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} yrs)
                </p>
              )}
            </div>
            <div className="bg-muted/30 rounded-lg p-4 space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Vehicle</p>
                {canEdit('rentals') && (displayStatus === 'Active' || displayStatus === 'Pending') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowSwapVehicle(true)}
                  >
                    <RefreshCw className="w-3 h-3" />
                    Swap
                  </Button>
                )}
              </div>
              <p className="text-lg font-semibold">{rental.vehicles?.reg}</p>
              <p className="text-sm text-muted-foreground">{rental.vehicles?.make} {rental.vehicles?.model}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-4 space-y-1">
              {(() => {
                const periodType = (rental.rental_period_type || 'Monthly').toLowerCase();
                const vehicle = rental.vehicles;
                const currCode = tenant?.currency_code || 'USD';
                // monthly_amount is stored GROSS; the agreed reduction lives in
                // discount_applied. Showing the gross figure here is what an operator
                // reports as "the weekly rental amount is still showing a higher amount"
                // — this tile is the first money figure on the page.
                const discountAmt = Number((rental as any).discount_applied) || 0;
                const grossAmount = Number(rental.monthly_amount);
                const totalAmount = Math.max(0, grossAmount - discountAmt);

                // Get the per-unit rate from the vehicle
                let unitRate = 0;
                let unitLabel = 'month';
                if (periodType === 'daily' && vehicle?.daily_rent) {
                  unitRate = vehicle.daily_rent;
                  unitLabel = 'day';
                } else if (periodType === 'weekly' && vehicle?.weekly_rent) {
                  unitRate = vehicle.weekly_rent;
                  unitLabel = 'week';
                } else if (periodType === 'monthly' && vehicle?.monthly_rent) {
                  unitRate = vehicle.monthly_rent;
                  unitLabel = 'month';
                }

                // Calculate expected amount from vehicle rate.
                const startDate = parseLocalDate(rental.start_date);
                const endDate = parseLocalDate(rental.end_date);
                const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
                let units = 1;
                if (unitLabel === 'day') units = totalDays;
                else if (unitLabel === 'week') units = Math.ceil(totalDays / 7);
                else units = Math.max(1, Math.round(totalDays / (tenant?.monthly_tier_days ?? 30)));

                const expectedAmount = Math.round(unitRate * units * 100) / 100;
                const isCustomPrice = unitRate > 0 && Math.abs(totalAmount - expectedAmount) > 0.01;

                if (unitRate > 0 && !isCustomPrice) {
                  // Standard rate — show formula
                  return (
                    <>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">{rental.rental_period_type || 'Monthly'} Rate</p>
                      <p className="text-lg font-semibold">
                        {formatCurrencyUtil(discountAmt > 0 ? totalAmount / units : unitRate, currCode)}
                        <span className="text-sm font-normal text-muted-foreground">/{unitLabel}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {discountAmt > 0
                          ? `${formatCurrencyUtil(unitRate, currCode)} × ${units} ${unitLabel}${units !== 1 ? 's' : ''} less ${formatCurrencyUtil(discountAmt, currCode)} discount = ${formatCurrencyUtil(totalAmount, currCode)}`
                          : `${formatCurrencyUtil(unitRate, currCode)} × ${units} ${unitLabel}${units !== 1 ? 's' : ''} = ${formatCurrencyUtil(totalAmount, currCode)}`}
                      </p>
                    </>
                  );
                }

                if (isCustomPrice) {
                  // Custom price — show amount with badge, no misleading formula
                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">{rental.rental_period_type || 'Monthly'} Amount</p>
                        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">Custom</Badge>
                      </div>
                      <p className="text-lg font-semibold">{formatCurrencyUtil(totalAmount, currCode)}</p>
                      <p className="text-xs text-muted-foreground">
                        {discountAmt > 0
                          ? `${formatCurrencyUtil(grossAmount, currCode)} less ${formatCurrencyUtil(discountAmt, currCode)} discount · vehicle rate ${formatCurrencyUtil(unitRate, currCode)}/${unitLabel}`
                          : `Vehicle rate: ${formatCurrencyUtil(unitRate, currCode)}/${unitLabel} — overridden at creation`}
                      </p>
                    </>
                  );
                }

                // Fallback: no vehicle rate available
                return (
                  <>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">{rental.rental_period_type || 'Monthly'} Amount</p>
                    <p className="text-lg font-semibold">{formatCurrencyUtil(totalAmount, currCode)}</p>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Renewal Chain Links */}
          {(rental.renewed_from_rental_id || renewedAsRental) && (
            <div className="flex flex-wrap gap-3">
              {rental.renewed_from_rental_id && (
                <button
                  onClick={() => router.push(`/rentals/${rental.renewed_from_rental_id}`)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 text-sm hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Renewed from previous rental
                </button>
              )}
              {renewedAsRental && (
                <button
                  onClick={() => router.push(`/rentals/${renewedAsRental.id}`)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 text-sm hover:bg-green-100 dark:hover:bg-green-950/50 transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Renewed as rental ({renewedAsRental.status})
                </button>
              )}
            </div>
          )}

          {/* Rental Period */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Rental Period</p>
              {/* `canEdit` is the FUNCTION off useManagerPermissions, so the bare
                  `{canEdit && …}` this used to be was always truthy and gated
                  nothing — this Edit button (and its twin on Pickup & Return
                  below) rendered for every role, viewer included, and it rewrites
                  the rental's dates. Calling it restores the gate the author
                  plainly intended. */}
              {canEdit('rentals') && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowEditPickupReturn(true)}
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Pickup</p>
                <p className="text-base font-medium">{parseLocalDate(rental.start_date).toLocaleDateString('en-US')}</p>
                {formatTimeOfDay(rental.pickup_time) && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <Clock className="inline-block h-3 w-3 mr-1 -mt-0.5" />
                    {formatTimeOfDay(rental.pickup_time)}
                  </p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Return</p>
                {(
                  <>
                    <p className="text-base font-medium">{rental.end_date ? parseLocalDate(rental.end_date).toLocaleDateString('en-US') : '—'}</p>
                    {formatTimeOfDay(rental.return_time) && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <Clock className="inline-block h-3 w-3 mr-1 -mt-0.5" />
                        {formatTimeOfDay(rental.return_time)}
                      </p>
                    )}
                    {/* Show original end date if rental has been extended */}
                    {(rental.original_end_date || rental.previous_end_date) && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Originally: {parseLocalDate(rental.original_end_date || rental.previous_end_date!).toLocaleDateString('en-US')}
                      </p>
                    )}
                  </>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Period Type</p>
                <Badge variant="outline" className="mt-1">{rental.rental_period_type || 'Monthly'}</Badge>
              </div>
            </div>

            {/* Timezone footer — operators were confused which timezone the
                dates and times were in (especially after the off-by-one bug),
                so spell it out explicitly. Tenant timezone wins; falls back to
                the browser's resolved zone. */}
            <p className="text-xs text-muted-foreground mt-3 italic">
              Times shown in {tenant?.timezone || (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "local time")}
            </p>

          </div>

          {/* Pickup & Return Locations */}
          {(rental.pickup_location || rental.return_location || rental.delivery_address || rental.collection_address) && (() => {
            const pickupAddr = rental.pickup_location || rental.delivery_address;
            const returnAddr = rental.return_location || rental.collection_address;
            const pickupLocId = rental.pickup_location_id || rental.delivery_location_id;
            const returnLocId = rental.return_location_id || rental.collection_location_id;
            const pickupLoc = pickupLocId ? allLocations.find(l => l.id === pickupLocId) : null;
            const returnLoc = returnLocId ? allLocations.find(l => l.id === returnLocId) : null;
            const pickupFee = rental.delivery_fee;
            const returnFee = rental.collection_fee;

            return (
              <div className="border rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Pickup & Return</p>
                  {/* Same never-fired gate as Rental Period above — see the note
                      there. Opens the same dialog, which also moves the rental's
                      pickup/return locations and their fees. */}
                  {canEdit('rentals') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowEditPickupReturn(true)}
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </Button>
                  )}
                </div>

                <LocationActionButtons pickupAddress={pickupAddr} returnAddress={returnAddr} pickupLoc={pickupLoc} returnLoc={returnLoc} pickupFee={pickupFee} returnFee={returnFee} rental={rental} currencyCode={tenant?.currency_code || 'USD'} />

                {/* Map View */}
                <LocationMap
                  pickupAddress={pickupAddr}
                  returnAddress={returnAddr}
                  className="mt-4 h-[220px]"
                />
              </div>
            );
          })()}

          <EditPickupReturnDialog
            open={showEditPickupReturn}
            onOpenChange={setShowEditPickupReturn}
            rental={rental}
          />

          <SwapVehicleDialog
            open={showSwapVehicle}
            onOpenChange={setShowSwapVehicle}
            rental={rental}
          />

          {/* Status Overview */}
          <div className="border rounded-lg p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Status Overview</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/20 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">Rental</p>
                <Badge
                  variant="outline"
                  className={
                    displayStatus === 'Active'
                      ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800'
                      : displayStatus === 'Completed'
                      ? 'bg-slate-800/50 text-slate-300 border-slate-700'
                      : displayStatus === 'Cancelled' || displayStatus === 'Rejected'
                      ? 'bg-red-950/50 text-red-300 border-red-800'
                      : 'bg-amber-950/50 text-amber-300 border-amber-800'
                  }
                >
                  {displayStatus}
                </Badge>
              </div>
              <div className="text-center p-3 bg-muted/20 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">Approval</p>
                <Badge
                  variant="outline"
                  className={
                    rental.approval_status === 'approved'
                      ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800'
                      : rental.approval_status === 'rejected'
                      ? 'bg-red-950/50 text-red-300 border-red-800'
                      : 'bg-amber-950/50 text-amber-300 border-amber-800'
                  }
                >
                  {rental.approval_status === 'approved' ? 'Approved' : rental.approval_status === 'rejected' ? 'Rejected' : 'Pending'}
                </Badge>
              </div>
              <div className="text-center p-3 bg-muted/20 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">Payment</p>
                <Badge
                  variant="outline"
                  className={
                    rental.payment_status === 'fulfilled'
                      ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800'
                      : rental.payment_status === 'refunded'
                      ? 'bg-orange-950/50 text-orange-300 border-orange-800'
                      : rental.payment_status === 'failed'
                      ? 'bg-red-950/50 text-red-300 border-red-800'
                      : 'bg-amber-950/50 text-amber-300 border-amber-800'
                  }
                >
                  {rental.payment_status === 'fulfilled' ? 'Fulfilled' : rental.payment_status === 'refunded' ? 'Refunded' : rental.payment_status === 'failed' ? 'Failed' : 'Pending'}
                </Badge>
              </div>
              <div className="text-center p-3 bg-muted/20 rounded-lg">
                <p className="text-xs text-muted-foreground mb-2">Vehicle</p>
                <Badge
                  variant="outline"
                  className={
                    rental.vehicles?.status === 'Available'
                      ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800'
                      : rental.vehicles?.status === 'Rented'
                      ? 'bg-sky-950/50 text-sky-300 border-sky-800'
                      : 'bg-slate-800/50 text-slate-300 border-slate-700'
                  }
                >
                  {rental.vehicles?.status || 'Unknown'}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Handover Section - Operations */}
      {id && (() => {
        return (
          <KeyHandoverSection
            rentalId={id}
            rentalStatus={displayStatus}
            needsAction={needsKeyHandover}
            isDeliveryRental={!!(rental?.delivery_address || rental?.delivery_fee)}
            vehicleId={rental?.vehicles?.id}
            vehicleLockboxCode={rental?.vehicles?.lockbox_code || null}
            vehicleLockboxInstructions={rental?.vehicles?.lockbox_instructions || null}
            deliveryMethod={rental?.delivery_method || null}
            customerEmail={rental?.customers?.email || null}
            customerPhone={rental?.customers?.phone || null}
            customerName={rental?.customers?.name || ''}
            vehicleName={rental?.vehicles ? `${rental.vehicles.make} ${rental.vehicles.model}` : ''}
            vehicleReg={rental?.vehicles?.reg || ''}
            deliveryAddress={rental?.delivery_address || rental?.pickup_location || null}
            bookingRef={rental?.id?.slice(0, 8)?.toUpperCase() || ''}
            approvalStatus={rental?.approval_status || null}
            startDate={rental?.start_date || null}
          />
        );
      })()}

      {/* AI Damage Analysis — compares handover vs return photos */}
      {id && <DamageAnalysisCard rentalId={id} />}

      {/* Deposit Hold Status — removed separate card; pre-auth info is shown in Payment Breakdown */}

      {/* Mileage Summary */}
      {id && rental?.vehicles?.id && (
        <MileageSummaryCard
          rentalId={id}
          vehicleId={rental.vehicles.id}
          startDate={rental.start_date}
          endDate={rental.end_date}
        />
      )}

      {/* Rental Agreements Timeline */}
      <AgreementTimeline
        rentalId={id}
        rental={rental}
        agreements={rentalAgreements}
        isLoading={loadingAgreements}
        canEdit={canEdit('rentals')}
        tenantId={tenant?.id}
        displayStatus={displayStatus}
        onViewAgreement={handleViewAgreementById}
      />

      {/* Insurance Policies Timeline */}
      {(insurancePolicies.length > 0 || isLoadingInsurancePolicies || rental?.original_end_date || rental?.previous_end_date) && (
        <InsuranceTimeline
          rentalId={id}
          rental={rental}
          policies={insurancePolicies}
          isLoading={isLoadingInsurancePolicies}
          canEdit={canEdit('rentals')}
          tenantId={tenant?.id}
          isBonzahConnected={isBonzahConnected}
          canSellBonzah={bonzahCanSell}
          bonzahCdBalance={bonzahCdBalance}
          onBuyInsurance={() => setShowBuyInsurance(true)}
        />
      )}

      {/* AI-verified insurance documents attached to this rental */}
      <RentalInsuranceVerificationsCard rentalId={id} />

      {/* Insurance Verification Card - Compact when no documents, full when documents exist.
          */}
      {(insuranceDocuments && insuranceDocuments.length > 0 ? (
      <Card id="insurance-section">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Insurance Verification
            </CardTitle>
          </CardHeader>
        <CardContent className="space-y-4">
          {/* Bonzah Insurance CTA - Show when no Bonzah policy exists */}
          {canEdit('rentals') && !bonzahPolicy && (
            <div
              className={`relative overflow-hidden rounded-lg border border-[#CC004A]/20 bg-gradient-to-r from-[#CC004A]/5 via-[#CC004A]/10 to-[#CC004A]/5 dark:from-[#CC004A]/10 dark:via-[#CC004A]/15 dark:to-[#CC004A]/10 p-4 transition-all ${bonzahCanSell && isBonzahEligible && bonzahHasInsurableDays ? 'cursor-pointer hover:border-[#CC004A]/40 group' : 'opacity-60'}`}
              onClick={() => { if (bonzahCanSell && isBonzahEligible && bonzahHasInsurableDays) { setBuyInsuranceMode('original'); setShowBuyInsurance(true); } }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-16 flex-shrink-0 flex items-center">
                    <img
                      src="/bonzah-logo.svg"
                      alt="Bonzah"
                      className="h-8 w-auto dark:hidden"
                    />
                    <img
                      src="/bonzah-logo-dark.svg"
                      alt="Bonzah"
                      className="h-8 w-auto hidden dark:block"
                    />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Purchase Rental Car Insurance</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {!isBonzahEligible
                        ? `${rental.vehicles?.make} ${rental.vehicles?.model} is not eligible for Bonzah coverage`
                        : !bonzahHasInsurableDays
                        ? "Bonzah must be added before the trip's last day — this rental's final day is today, so there are no upcoming days left to cover."
                        : 'CDW, Liability, Supplemental & Personal Accident coverage powered by Bonzah'}
                    </p>
                  </div>
                </div>
                {bonzahCanSell ? (
                  <Button
                    size="sm"
                    className={(!isBonzahEligible || !bonzahHasInsurableDays) ? "flex-shrink-0 opacity-50" : "bg-[#CC004A] hover:bg-[#A80040] text-white hover:text-white flex-shrink-0 group-hover:shadow-md transition-shadow"}
                    variant={(!isBonzahEligible || !bonzahHasInsurableDays) ? "outline" : undefined}
                    disabled={!isBonzahEligible || !bonzahHasInsurableDays || isBonzahEligibilityLoading}
                    title={!isBonzahEligible ? "This vehicle is not eligible for Bonzah insurance" : !bonzahHasInsurableDays ? "Bonzah must be added before the trip's last day. This rental's final day is today, so there are no upcoming days left to cover — use Upload to attach a policy manually." : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      setBuyInsuranceMode('original');
                      setShowBuyInsurance(true);
                    }}
                  >
                    <ShieldCheck className="h-4 w-4 mr-1.5" />
                    {isBonzahEligibilityLoading ? 'Checking...' : !isBonzahEligible ? 'Not Eligible' : !bonzahHasInsurableDays ? 'No Days Left' : 'Get Insurance'}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    className="flex-shrink-0"
                    title={bonzahSellBlockedReason ?? undefined}
                  >
                    <ShieldCheck className="h-4 w-4 mr-1.5" />
                    Get Insurance
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted-foreground">Upload customer's insurance documents for verification</p>
            {canEdit('rentals') && (
            <div className="flex flex-wrap gap-2 shrink-0">
              {hasInvalidInsuranceDoc && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-300 dark:text-amber-400 dark:hover:bg-amber-900/20 dark:border-amber-700"
                  onClick={() => notifyInsuranceReuploadMutation.mutate()}
                  disabled={notifyInsuranceReuploadMutation.isPending}
                >
                  {notifyInsuranceReuploadMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-1" />
                  )}
                  Request Re-Upload
                </Button>
              )}
            <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*,.pdf';
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;

                      try {
                        toast({ title: "Uploading...", description: "Uploading insurance document" });

                        // Sanitize the filename before it becomes part of the Supabase Storage key.
        // Supabase rejects keys with characters outside its allow-list (e.g. the
        // U+202F narrow-no-break-space macOS puts before AM/PM in screenshot names),
        // failing with "Invalid key". The original name is kept for display below.
        const fileName = `${rental.customer_id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
                        const { error: uploadError } = await supabase.storage
                          .from('customer-documents')
                          .upload(fileName, file);

                        if (uploadError) throw uploadError;

                        const { data: docData, error: docError } = await supabase
                          .from('customer_documents')
                          .insert({
                            customer_id: rental.customer_id,
                            rental_id: id,
                            document_type: 'Insurance Certificate',
                            document_name: file.name,
                            file_name: file.name,
                            file_url: fileName,
                            status: 'Pending',
                            ai_scan_status: 'pending',
                            tenant_id: tenant?.id,
                          })
                          .select()
                          .single();

                        if (docError) throw docError;

                        // Trigger AI scan with documentId and fileUrl
                        supabase.functions.invoke('scan-insurance-document', {
                          body: { documentId: docData.id, fileUrl: fileName }
                        });

                        toast({ title: "Success", description: "Insurance document uploaded and AI scan initiated" });
                        queryClient.invalidateQueries({ queryKey: ["rental-insurance-docs", id] });
                      } catch (error: any) {
                        toast({
                          title: "Upload Failed",
                          description: error.message || "Failed to upload document",
                          variant: "destructive"
                        });
                      }
                    };
                    input.click();
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Upload Document
                </Button>
            </div>
            )}
          </div>

          {/* Document List */}
            {insuranceDocuments && insuranceDocuments.length > 0 ? (
              <div className="space-y-4">
                {insuranceDocuments.map((doc: any) => {
                  const validationScore = doc.ai_validation_score || 0;
                  const confidenceScore = doc.ai_confidence_score || 0;
                  const extractedData = doc.ai_extracted_data || {};
                  const verificationDecision = doc.verification_decision || extractedData?.verificationDecision;
                  const reviewReasons = doc.review_reasons || extractedData?.reviewReasons || [];
                  const fraudRiskScore = doc.fraud_risk_score ?? extractedData?.fraudRiskScore;

                  const getScoreColor = (score: number) => {
                    if (score >= 0.85) return 'green';
                    if (score >= 0.60) return 'yellow';
                    return 'red';
                  };

                  const getScoreLabel = (score: number) => {
                    if (score >= 0.85) return 'Verified';
                    if (score >= 0.60) return 'Review Needed';
                    return 'Low Confidence';
                  };

                  const getDecisionDisplay = (decision: string | undefined) => {
                    switch (decision) {
                      case 'auto_approved':
                        return { label: 'Auto-Approved', color: 'bg-green-600', icon: CheckCircle };
                      case 'auto_rejected':
                        return { label: 'Rejected', color: 'bg-red-600', icon: XCircle };
                      case 'pending_review':
                        return { label: 'Pending Review', color: 'bg-yellow-600', icon: AlertTriangle };
                      case 'manually_approved':
                        return { label: 'Manually Approved', color: 'bg-green-600', icon: CheckCircle };
                      case 'manually_rejected':
                        return { label: 'Manually Rejected', color: 'bg-red-600', icon: XCircle };
                      default:
                        return null;
                    }
                  };

                  const decisionDisplay = getDecisionDisplay(verificationDecision);
                  const scoreColor = getScoreColor(validationScore);

                  return (
                    <div key={doc.id} className={`border rounded-lg p-4 space-y-3 ${doc.isUnlinked ? 'border-yellow-500/50 bg-yellow-500/5' : ''}`}>
                      {/* Unlinked Warning */}
                      {doc.isUnlinked && (
                        <Alert className="mb-3 border-yellow-500/50 bg-yellow-500/10">
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                          <AlertDescription className="text-sm">
                            This document is not linked to any rental. Click "Link to Rental" to associate it with this booking.
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Document Info Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium break-all">{doc.file_name || doc.document_name}</span>
                          {doc.isUnlinked && (
                            <Badge variant="outline" className="text-yellow-600 border-yellow-500">Unlinked</Badge>
                          )}
                          {/* Verification Decision Badge */}
                          {decisionDisplay && (
                            <Badge className={decisionDisplay.color}>
                              <decisionDisplay.icon className="h-3 w-3 mr-1" />
                              {decisionDisplay.label}
                            </Badge>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          Uploaded: {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString('en-US') : 'N/A'}
                        </span>
                      </div>

                      {/* Fraud Risk Warning */}
                      {fraudRiskScore !== undefined && fraudRiskScore >= 0.5 && (
                        <Alert className="border-red-500/50 bg-red-500/10">
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                          <AlertDescription className="text-sm text-red-700">
                            <strong>High Fraud Risk ({Math.round(fraudRiskScore * 100)}%):</strong> This document has been flagged for additional verification.
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Review Reasons */}
                      {reviewReasons && reviewReasons.length > 0 && (
                        <Alert className="border-yellow-500/50 bg-yellow-500/10">
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                          <AlertDescription className="text-sm">
                            <strong className="text-yellow-700">Review Required:</strong>
                            <ul className="list-disc list-inside mt-1 text-yellow-700">
                              {reviewReasons.map((reason: string, i: number) => (
                                <li key={i}>{reason}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Validation Score Card - similar to Face Match Score */}
                      {doc.ai_scan_status === 'completed' && doc.ai_validation_score !== null && (
                        <div className="border border-border rounded-lg p-4 bg-card">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                scoreColor === 'green' ? 'bg-green-500/10' :
                                scoreColor === 'yellow' ? 'bg-yellow-500/10' : 'bg-red-500/10'
                              }`}>
                                <Shield className={`h-5 w-5 ${
                                  scoreColor === 'green' ? 'text-green-500' :
                                  scoreColor === 'yellow' ? 'text-yellow-500' : 'text-red-500'
                                }`} />
                              </div>
                              <div>
                                <p className="text-sm font-medium">Validation Score</p>
                                <p className="text-xs text-muted-foreground">AI Document Verification</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-2xl font-bold ${
                                scoreColor === 'green' ? 'text-green-500' :
                                scoreColor === 'yellow' ? 'text-yellow-500' : 'text-red-500'
                              }`}>
                                {(validationScore * 100).toFixed(0)}%
                              </p>
                              <p className={`text-xs font-medium ${
                                scoreColor === 'green' ? 'text-green-500' :
                                scoreColor === 'yellow' ? 'text-yellow-500' : 'text-red-500'
                              }`}>
                                {getScoreLabel(validationScore)}
                              </p>
                            </div>
                          </div>
                          <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                                scoreColor === 'green' ? 'bg-green-500' :
                                scoreColor === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${validationScore * 100}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Scan Status Indicators */}
                      {doc.ai_scan_status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Pending Scan</Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retryScanMutation.mutate(doc.id)}
                            disabled={retryScanMutation.isPending}
                            title="Start AI scan"
                          >
                            {retryScanMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      )}
                      {doc.ai_scan_status === 'processing' && (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            Scanning...
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retryScanMutation.mutate(doc.id)}
                            disabled={retryScanMutation.isPending}
                            title="Retry scan if stuck"
                          >
                            <RefreshCw className={`h-3 w-3 ${retryScanMutation.isPending ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>
                      )}
                      {doc.ai_scan_status === 'failed' && (
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive">Scan Failed</Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retryScanMutation.mutate(doc.id)}
                            disabled={retryScanMutation.isPending}
                            title="Retry scan"
                          >
                            <RefreshCw className={`h-3 w-3 ${retryScanMutation.isPending ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>
                      )}

                    {/* AI Extracted Data */}
                    {doc.ai_scan_status === 'completed' && extractedData && Object.keys(extractedData).length > 0 && (
                      <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                        <h4 className="text-sm font-semibold mb-2">AI Extracted Information</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {extractedData.provider && (
                            <div>
                              <span className="text-muted-foreground">Provider:</span>{' '}
                              <span className="font-medium">{extractedData.provider}</span>
                            </div>
                          )}
                          {extractedData.policyNumber && (
                            <div>
                              <span className="text-muted-foreground">Policy #:</span>{' '}
                              <span className="font-medium">{extractedData.policyNumber}</span>
                            </div>
                          )}
                          {extractedData.policyHolderName && (
                            <div>
                              <span className="text-muted-foreground">Policy Holder:</span>{' '}
                              <span className="font-medium">{extractedData.policyHolderName}</span>
                            </div>
                          )}
                          {extractedData.coverageType && (
                            <div>
                              <span className="text-muted-foreground">Coverage Type:</span>{' '}
                              <span className="font-medium">{extractedData.coverageType}</span>
                            </div>
                          )}
                          {(extractedData.effectiveDate || extractedData.startDate) && (
                            <div>
                              <span className="text-muted-foreground">Effective Date:</span>{' '}
                              <span className="font-medium">{extractedData.effectiveDate || extractedData.startDate}</span>
                            </div>
                          )}
                          {(extractedData.expirationDate || extractedData.endDate) && (
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">Expiration Date:</span>{' '}
                              <span className="font-medium">{extractedData.expirationDate || extractedData.endDate}</span>
                              {extractedData.isExpired && (
                                <Badge variant="destructive" className="text-xs ml-1">EXPIRED</Badge>
                              )}
                            </div>
                          )}
                          {extractedData.documentType && (
                            <div>
                              <span className="text-muted-foreground">Document Type:</span>{' '}
                              <span className="font-medium">{extractedData.documentType}</span>
                            </div>
                          )}
                          {extractedData.coverageLimits?.liability && (
                            <div>
                              <span className="text-muted-foreground">Liability:</span>{' '}
                              <span className="font-medium">{formatCurrencyUtil(extractedData.coverageLimits.liability, tenant?.currency_code || 'USD')}</span>
                            </div>
                          )}
                          {extractedData.coverageLimits?.collision && (
                            <div>
                              <span className="text-muted-foreground">Collision:</span>{' '}
                              <span className="font-medium">{formatCurrencyUtil(extractedData.coverageLimits.collision, tenant?.currency_code || 'USD')}</span>
                            </div>
                          )}
                          {extractedData.coverageLimits?.comprehensive && (
                            <div>
                              <span className="text-muted-foreground">Comprehensive:</span>{' '}
                              <span className="font-medium">{formatCurrencyUtil(extractedData.coverageLimits.comprehensive, tenant?.currency_code || 'USD')}</span>
                            </div>
                          )}
                        </div>
                        {/* Confidence and validation notes */}
                        <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
                          {confidenceScore > 0 && (
                            <span>Extraction Confidence: {Math.round(confidenceScore * 100)}%</span>
                          )}
                          {extractedData.isValidDocument !== undefined && (
                            <span className={extractedData.isValidDocument ? 'text-green-600' : 'text-red-600'}>
                              {extractedData.isValidDocument ? 'Valid Document' : 'Document Issues Detected'}
                            </span>
                          )}
                        </div>
                        {/* Validation Notes */}
                        {extractedData.validationNotes && Array.isArray(extractedData.validationNotes) && extractedData.validationNotes.length > 0 && (
                          <div className="text-xs text-muted-foreground pt-1">
                            <span className="font-medium">Notes:</span> {extractedData.validationNotes.join(', ')}
                          </div>
                        )}
                      </div>
                    )}

                    {/* AI Scan Errors */}
                    {doc.ai_scan_errors && Array.isArray(doc.ai_scan_errors) && doc.ai_scan_errors.length > 0 && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                          <strong>Scan Errors:</strong> {doc.ai_scan_errors.join(', ')}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Action Buttons */}
                    <div className="pt-3 border-t flex items-center justify-between">
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            let url = doc.file_url;
                            if (!url.startsWith('http')) {
                              const { data } = supabase.storage
                                .from('customer-documents')
                                .getPublicUrl(doc.file_url);
                              url = data.publicUrl;
                            }
                            window.open(url, '_blank');
                          }}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View Document
                        </Button>
                        {canEdit('rentals') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-300"
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this document?')) {
                              deleteDocumentMutation.mutate({ id: doc.id, file_url: doc.file_url });
                            }
                          }}
                          disabled={deleteDocumentMutation.isPending}
                        >
                          {deleteDocumentMutation.isPending ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3 mr-1" />
                          )}
                          Delete
                        </Button>
                        )}
                        {/* Link to Rental button for unlinked documents */}
                        {canEdit('rentals') && doc.isUnlinked && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-300"
                            onClick={() => linkDocumentMutation.mutate(doc.id)}
                            disabled={linkDocumentMutation.isPending}
                          >
                            {linkDocumentMutation.isPending ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <CheckCircle className="h-3 w-3 mr-1" />
                            )}
                            Link to Rental
                          </Button>
                        )}
                        {/* Approve / Reject buttons for unverified insurance documents */}
                        {canEdit('rentals') && !doc.verified && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-300"
                              onClick={() => approveInsuranceMutation.mutate(doc.id)}
                              disabled={approveInsuranceMutation.isPending}
                            >
                              {approveInsuranceMutation.isPending ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <CheckCircle className="h-3 w-3 mr-1" />
                              )}
                              Approve
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-300"
                              onClick={() => handleRejectInsurance()}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {doc.verified && (
                          <Badge className="bg-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        )}
                        {doc.status?.toLowerCase() === 'expired' && (
                          <Badge variant="destructive">
                            <XCircle className="h-3 w-3 mr-1" />
                            Expired
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
        </Card>
      ) : (
        /* Compact empty state — ORIGINAL rental scope only. Hidden entirely
           when original already has coverage (Bonzah active OR doc uploaded). */
        !originalHasCoverage && (
          <Card id="insurance-section" className="px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Insurance (Original Rental)</span>
                <span className="text-xs text-muted-foreground">No coverage yet</span>
              </div>
              <div className="flex items-center gap-2">
                {tenant?.bonzah_brochure_url && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                    <a href={tenant.bonzah_brochure_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Coverage Brochure
                    </a>
                  </Button>
                )}
                {bonzahCanSell && (
                  isBonzahEligible ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-[#CC004A]/30 text-[#CC004A] hover:bg-[#CC004A]/10 hover:text-[#CC004A]"
                      disabled={isBonzahEligibilityLoading || !bonzahHasInsurableDays}
                      title={!bonzahHasInsurableDays ? "Bonzah must be added before the trip's last day. This rental's final day is today, so there are no upcoming days left to cover — use Upload to attach a policy manually." : undefined}
                      onClick={() => { setBuyInsuranceMode('original'); setBuyInsuranceExtensionId(null); setShowBuyInsurance(true); }}
                    >
                      <img src="/bonzah-logo.svg" alt="" className="h-3 w-3 mr-1 dark:hidden" />
                      <img src="/bonzah-logo-dark.svg" alt="" className="h-3 w-3 mr-1 hidden dark:inline" />
                      {isBonzahEligibilityLoading ? 'Checking...' : 'Buy Bonzah'}
                    </Button>
                  ) : !isBonzahEligibilityLoading ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={`${rental?.vehicles?.make} ${rental?.vehicles?.model} is not supported by Bonzah`}>
                      <img src="/bonzah-logo.svg" alt="" className="h-3 w-3 opacity-40 dark:hidden" />
                      <img src="/bonzah-logo-dark.svg" alt="" className="h-3 w-3 opacity-40 hidden dark:inline" />
                      Not eligible for Bonzah
                    </span>
                  ) : null
                )}
                {canEdit('rentals') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => uploadInsuranceDoc({ extensionId: null })}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Upload
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )
      ))}

      {/* Identity Verification Section - Always show */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-purple-600" />
              Identity Verification
            </CardTitle>
            {(rental as any)?.is_gig_driver && rental?.customer_id && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/customers/${rental.customer_id}?tab=gig-driver`)}
              >
                <Briefcase className="h-4 w-4 mr-2" />
                View Gig Driver Docs
              </Button>
            )}
          </div>
          <CardDescription>
            Identity verification status and documents for this customer
          </CardDescription>
        </CardHeader>
        <CardContent>
          {identityVerification && (
            <div className="space-y-4">
              {/* Status Row */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted-foreground">Status:</span>
                  {identityVerification.review_result === 'GREEN' ? (
                    <Badge className="bg-green-600">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Verified
                    </Badge>
                  ) : identityVerification.review_result === 'RED' ? (
                    <Badge variant="destructive">
                      <XCircle className="h-3 w-3 mr-1" />
                      Declined
                    </Badge>
                  ) : identityVerification.review_result === 'RETRY' ? (
                    <Badge className="bg-yellow-600">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Resubmission Required
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Pending
                    </Badge>
                  )}
                  {/* Provider Badge */}
                  <Badge variant="outline" className="border-purple-500 text-purple-600">
                    AI Verified
                  </Badge>
                </div>
                {identityVerification.verification_completed_at && (
                  <span className="text-sm text-muted-foreground">
                    Verified: {new Date(identityVerification.verification_completed_at).toLocaleDateString('en-US')}
                  </span>
                )}
              </div>

              {/* AI Face Match Score - only show for AI verifications */}
              {identityVerification.verification_provider === 'ai' && identityVerification.ai_face_match_score && (
                <div className="border border-border rounded-lg p-4 bg-card">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        identityVerification.ai_face_match_score >= 0.9 ? 'bg-green-500/10' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'bg-yellow-500/10' : 'bg-red-500/10'
                      }`}>
                        <Camera className={`h-5 w-5 ${
                          identityVerification.ai_face_match_score >= 0.9 ? 'text-green-500' :
                          identityVerification.ai_face_match_score >= 0.7 ? 'text-yellow-500' : 'text-red-500'
                        }`} />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Face Match Score</p>
                        <p className="text-xs text-muted-foreground">AI Biometric Verification</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${
                        identityVerification.ai_face_match_score >= 0.9 ? 'text-green-500' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'text-yellow-500' : 'text-red-500'
                      }`}>
                        {(identityVerification.ai_face_match_score * 100).toFixed(1)}%
                      </p>
                      <p className={`text-xs font-medium ${
                        identityVerification.ai_face_match_score >= 0.9 ? 'text-green-500' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'text-yellow-500' : 'text-red-500'
                      }`}>
                        {identityVerification.ai_face_match_score >= 0.9 ? 'Excellent Match' :
                         identityVerification.ai_face_match_score >= 0.7 ? 'Needs Review' : 'Low Match'}
                      </p>
                    </div>
                  </div>
                  <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`absolute left-0 top-0 h-full rounded-full transition-all ${
                        identityVerification.ai_face_match_score >= 0.9 ? 'bg-green-500' :
                        identityVerification.ai_face_match_score >= 0.7 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${identityVerification.ai_face_match_score * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Sensitive Info Toggle */}
              {(identityVerification.first_name || identityVerification.last_name || identityVerification.document_number) && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowSensitiveInfo(!showSensitiveInfo)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showSensitiveInfo ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {showSensitiveInfo ? 'Hide sensitive info' : 'Reveal sensitive info'}
                  </button>
                </div>
              )}

              {/* Extracted Person Info */}
              {(identityVerification.first_name || identityVerification.last_name || identityVerification.date_of_birth) && (
                <div className="bg-muted/50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <IdCard className="h-4 w-4" />
                    Verified Identity
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    {identityVerification.first_name && (
                      <div>
                        <span className="text-muted-foreground">First Name:</span>
                        <p className="font-medium">{showSensitiveInfo ? identityVerification.first_name : identityVerification.first_name.charAt(0) + '••••'}</p>
                      </div>
                    )}
                    {identityVerification.last_name && (
                      <div>
                        <span className="text-muted-foreground">Last Name:</span>
                        <p className="font-medium">{showSensitiveInfo ? identityVerification.last_name : identityVerification.last_name.charAt(0) + '••••'}</p>
                      </div>
                    )}
                    {identityVerification.date_of_birth && (
                      <div>
                        <span className="text-muted-foreground">Date of Birth:</span>
                        <p className="font-medium">{showSensitiveInfo ? parseLocalDate(identityVerification.date_of_birth).toLocaleDateString('en-US') : '••/••/••••'}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Document Info */}
              {(identityVerification.document_type || identityVerification.document_number || identityVerification.document_country) && (
                <div className="bg-muted/50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Document Details
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    {identityVerification.document_type && (
                      <div>
                        <span className="text-muted-foreground">Type:</span>
                        <p className="font-medium">{identityVerification.document_type.replace(/_/g, ' ').replace(/\bid\b/gi, 'ID').replace(/\b\w/g, c => c.toUpperCase())}</p>
                      </div>
                    )}
                    {identityVerification.document_number && (
                      <div>
                        <span className="text-muted-foreground">Number:</span>
                        <p className="font-medium font-mono">{showSensitiveInfo ? identityVerification.document_number : '••••••' + identityVerification.document_number.slice(-4)}</p>
                      </div>
                    )}
                    {identityVerification.document_country && (
                      <div>
                        <span className="text-muted-foreground">Country:</span>
                        <p className="font-medium">{identityVerification.document_country}</p>
                      </div>
                    )}
                    {identityVerification.document_expiry_date && (
                      <div>
                        <span className="text-muted-foreground">Expiry:</span>
                        <p className="font-medium">{showSensitiveInfo ? parseLocalDate(identityVerification.document_expiry_date).toLocaleDateString('en-US') : '••/••/••••'}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Document Images */}
              {(identityVerification.document_front_url || identityVerification.document_back_url || identityVerification.selfie_image_url) && (
                <div className="bg-muted/50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Verification Images
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {identityVerification.document_front_url && (
                      <div className="space-y-2">
                        <span className="text-sm text-muted-foreground">ID Front</span>
                        <div className="relative aspect-square rounded-lg overflow-hidden border">
                          <BlurredImage
                            src={identityVerification.document_front_url}
                            alt="ID Front"
                            label="ID Front"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => window.open(identityVerification.document_front_url, '_blank')}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View Full Size
                        </Button>
                      </div>
                    )}
                    {identityVerification.document_back_url && (
                      <div className="space-y-2">
                        <span className="text-sm text-muted-foreground">ID Back</span>
                        <div className="relative aspect-square rounded-lg overflow-hidden border">
                          <BlurredImage
                            src={identityVerification.document_back_url}
                            alt="ID Back"
                            label="ID Back"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => window.open(identityVerification.document_back_url, '_blank')}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View Full Size
                        </Button>
                      </div>
                    )}
                    {identityVerification.selfie_image_url && (
                      <div className="space-y-2">
                        <span className="text-sm text-muted-foreground">Selfie</span>
                        <div className="relative aspect-square rounded-lg overflow-hidden border">
                          <BlurredImage
                            src={identityVerification.selfie_image_url}
                            alt="Selfie"
                            label="Selfie"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => window.open(identityVerification.selfie_image_url, '_blank')}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View Full Size
                        </Button>
                      </div>
                    )}
                  </div>
                  {identityVerification.media_fetched_at && (
                    <p className="text-xs text-muted-foreground mt-3">
                      Images fetched: {new Date(identityVerification.media_fetched_at).toLocaleString('en-US')}
                    </p>
                  )}
                </div>
              )}

              {/* Rejection Reason */}
              {identityVerification.rejection_reason && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Rejection Reason:</strong> {identityVerification.rejection_reason}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Empty state when no verification data */}
          {!identityVerification && !isLoadingVerification && (
            <div className="text-center py-4 text-muted-foreground">
              <UserCheck className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No identity verification found</p>
              <p className="text-sm mt-1">
                This customer hasn't completed identity verification yet.
              </p>
            </div>
          )}

          {/* Loading state */}
          {isLoadingVerification && (
            <div className="text-center py-8 text-muted-foreground">
              <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin" />
              <p className="text-sm">Loading verification data...</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Ledger removed — charges visible in Payment Breakdown */}

      {/* Add Payment Dialog */}
      {rental && (
        <AddPaymentDialog
          open={showAddPayment}
          onOpenChange={setShowAddPayment}
          customer_id={rental.customers?.id}
          vehicle_id={rental.vehicles?.id}
          rental_id={rental.id}
          outstandingBalanceOverride={outstandingBalance}
        />
      )}

      {/* Buy Insurance Dialog */}
      {rental && (
        <BuyInsuranceDialog
          open={showBuyInsurance}
          onOpenChange={setShowBuyInsurance}
          rental={rental}
          onUploadOwnPolicy={() => {
            setShowBuyInsurance(false);
            uploadInsuranceDoc({});
          }}
          onPurchaseComplete={(premium) => {
            setInsurancePaymentAmount(premium);
            setInsurancePaymentCategories(['Insurance']);
            setInsurancePaymentMode(true);
          }}
        />
      )}

      {/* Insurance Payment Dialog (Mark Paid) */}
      {rental && (
        <AddPaymentDialog
          open={insurancePaymentMode}
          onOpenChange={setInsurancePaymentMode}
          customer_id={rental.customers?.id}
          vehicle_id={rental.vehicles?.id}
          rental_id={rental.id}
          defaultAmount={insurancePaymentAmount}
          targetCategories={insurancePaymentCategories}
          insuranceChargeMode
        />
      )}

      {/* Cancel Rental Dialog */}
      {rental && (
        <CancelRentalDialog
          open={showCancelDialog}
          onOpenChange={setShowCancelDialog}
          rental={{
            id: rental.id,
            customer: rental.customers,
            vehicle: rental.vehicles,
            monthly_amount: rental.monthly_amount,
          }}
        />
      )}

      {/* Refund Dialog */}
      {rental && (
        <RefundDialog
          open={showRefundDialog}
          onOpenChange={setShowRefundDialog}
          rentalId={rental.id}
          category={refundCategory}
          totalAmount={refundTotalAmount}
          paidAmount={refundPaidAmount}
        />
      )}

      {/* Undo Manual Payment Confirmation Dialog */}
      {rental && (
        <AlertDialog open={showUndoDialog} onOpenChange={setShowUndoDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Undo manual payment?</AlertDialogTitle>
              <AlertDialogDescription>
                This will reverse {formatCurrencyUtil(undoAmount, tenant?.currency_code || 'USD')} of manually-recorded payments against{' '}
                <strong>{undoCategory}</strong> and remove the payment record. The charge will return to unpaid. This action does not refund any money — use it only when the original payment was recorded in error.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isUndoing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={isUndoing}
                onClick={async (e) => {
                  e.preventDefault();
                  if (!rental || !tenant?.id) return;
                  setIsUndoing(true);
                  try {
                    const { data, error } = await supabase.functions.invoke('undo-manual-payment', {
                      body: {
                        rentalId: rental.id,
                        category: undoCategory,
                        tenantId: tenant.id,
                      },
                    });
                    if (error) throw error;
                    if (!data?.success) throw new Error(data?.error || 'Failed to undo payment');

                    toast({
                      title: 'Payment undone',
                      description: `Reversed ${data.details?.allocationsReversed || 0} allocation(s) for ${undoCategory}.`,
                    });

                    await Promise.all([
                      queryClient.invalidateQueries({ queryKey: ['rental', rental.id] }),
                      queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] }),
                      queryClient.invalidateQueries({ queryKey: ['rental-charges'] }),
                      queryClient.invalidateQueries({ queryKey: ['rental-manual-paid-breakdown'] }),
                      queryClient.invalidateQueries({ queryKey: ['rental-totals'] }),
                      queryClient.invalidateQueries({ queryKey: ['customer-balance'] }),
                      queryClient.invalidateQueries({ queryKey: ['customer-balance-status'] }),
                    ]);
                    setShowUndoDialog(false);
                  } catch (err: any) {
                    toast({
                      title: 'Error',
                      description: err?.message || 'Failed to undo payment',
                      variant: 'destructive',
                    });
                  } finally {
                    setIsUndoing(false);
                  }
                }}
              >
                {isUndoing ? 'Undoing…' : 'Undo Payment'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Deduct from Deposit Confirmation Dialog */}
      {rental && (() => {
        const excessCharge = (rentalCharges || []).find(c => c.category === 'Excess Mileage');
        const depositAmount = invoiceBreakdown?.securityDeposit || 0;
        const depositRefunded = refundBreakdown?.['Security Deposit'] ?? 0;
        const depositAvailable = Math.max(0, depositAmount - depositRefunded);
        const excessRemaining = excessCharge?.remaining_amount || 0;
        const deductAmount = Math.min(depositAvailable, excessRemaining);

        return (
          <AlertDialog open={showDeductFromDepositDialog} onOpenChange={setShowDeductFromDepositDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Deduct from Pre-Authorization</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-3">
                    <p>Deduct excess mileage charge from the customer&apos;s pre-authorization hold:</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>Pre-Auth Available:</span>
                        <span className="font-medium">{formatCurrencyUtil(depositAvailable, tenant?.currency_code || 'USD')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Excess Mileage Owed:</span>
                        <span className="font-medium">{formatCurrencyUtil(excessRemaining, tenant?.currency_code || 'USD')}</span>
                      </div>
                      <div className="flex justify-between border-t pt-1 font-semibold">
                        <span>Amount to Deduct:</span>
                        <span>{formatCurrencyUtil(deductAmount, tenant?.currency_code || 'USD')}</span>
                      </div>
                      {excessRemaining > depositAvailable && (
                        <p className="text-xs text-amber-600 mt-2">
                          The pre-authorization does not fully cover the charge. The remaining {formatCurrencyUtil(excessRemaining - depositAvailable, tenant?.currency_code || 'USD')} can be collected via a payment link.
                        </p>
                      )}
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeductingDeposit}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isDeductingDeposit || deductAmount <= 0}
                  onClick={async (e) => {
                    e.preventDefault();
                    setIsDeductingDeposit(true);
                    try {
                      const { data: result, error } = await supabase.functions.invoke('deduct-from-deposit', {
                        body: { rentalId: rental.id, amount: deductAmount, tenantId: tenant?.id },
                      });
                      if (error) throw error;
                      toast({ title: 'Pre-Authorization Deducted', description: `${formatCurrencyUtil(deductAmount, tenant?.currency_code || 'USD')} deducted from pre-authorization for excess mileage.` });
                      queryClient.invalidateQueries({ queryKey: ["rental-charges"] });
                      queryClient.invalidateQueries({ queryKey: ["rental-totals"] });
                      queryClient.invalidateQueries({ queryKey: ["rental-invoice"] });
                      queryClient.invalidateQueries({ queryKey: ["rental-payments"] });
                      queryClient.invalidateQueries({ queryKey: ["payments-data"] });
                      setShowDeductFromDepositDialog(false);
                    } catch (err: any) {
                      toast({ title: 'Deduction Failed', description: err.message, variant: 'destructive' });
                    } finally {
                      setIsDeductingDeposit(false);
                    }
                  }}
                >
                  {isDeductingDeposit ? 'Processing...' : `Deduct ${formatCurrencyUtil(deductAmount, tenant?.currency_code || 'USD')}`}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      })()}

      {/* Charge Deposit Dialog */}
      {rental && (
        <ChargeDepositDialog
          open={showChargeDepositDialog}
          onOpenChange={setShowChargeDepositDialog}
          rentalId={rental.id}
          holdAmount={Number(rental.deposit_hold_amount) || 0}
          holdStatus={rental.deposit_hold_status}
          holdExpiresAt={rental.deposit_hold_expires_at}
        />
      )}

      {/* Raise a deposit charge mid-rental, then collect it. */}
      {rental && depositIsCharged && (
        <TakeDepositDialog
          open={showTakeDeposit}
          onOpenChange={setShowTakeDeposit}
          rentalId={rental.id}
          customerId={rental.customers?.id}
          vehicleId={rental.vehicles?.id}
          tenantId={tenant?.id}
          defaultAmount={depositDefaultAmount}
          currencyCode={tenant?.currency_code || 'USD'}
          currencySymbol={getCurrencySymbol(tenant?.currency_code || 'USD')}
          onReady={(amt) => {
            setDepositPaymentAmount(amt);
            setSelectedCategories(new Set(['Security Deposit']));
            setShowTargetedPayment(true);
          }}
        />
      )}

      {/* Add Hold Dialog */}
      {rental && (
        <AddHoldDialog
          open={showAddHoldDialog}
          onOpenChange={setShowAddHoldDialog}
          rentalId={rental.id}
          customerEmail={(rental as any).customers?.email || null}
        />
      )}

      {/* Force-refresh confirmation. The refresh engine CANCELS the live
          authorisation before it places the replacement, so there is a window
          in which the rental is unsecured and a declined replacement leaves it
          that way. That is not something to trigger from a single stray click
          on a table row. */}
      <AlertDialog open={showForceRefreshDialog} onOpenChange={(open) => { if (!forceRefreshingHold) setShowForceRefreshDialog(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-violet-500" />
              Force a deposit hold refresh?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This runs the nightly deposit-hold job immediately, for this rental only. It will
                  cancel the current authorisation and place a replacement on the saved card.
                </p>
                <p className="text-amber-600 dark:text-amber-500 font-medium">
                  If the replacement is declined, this rental is left without a live hold until a new
                  one is placed.
                </p>
                <p className="text-muted-foreground">
                  Nothing happens if the hold is not yet due — the job applies its normal deadline and
                  retry-backoff rules.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={forceRefreshingHold}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={forceRefreshingHold}
              onClick={(e) => {
                // Keep the dialog mounted while the request is in flight; the
                // handler closes it in its finally block.
                e.preventDefault();
                handleForceRefreshHold();
              }}
            >
              {forceRefreshingHold ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Refreshing…
                </>
              ) : (
                'Refresh now'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Extras Breakdown Dialog */}
      <Dialog open={showExtrasDialog} onOpenChange={setShowExtrasDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-indigo-500" />
              Extras Breakdown
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            {(extrasDetails || []).length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(extrasDetails || []).map((item: any) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <p className="text-sm font-medium">{item.rental_extras?.name || 'Unknown'}</p>
                          {item.rental_extras?.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">{item.rental_extras.description}</p>
                          )}
                          {item.billing_type_at_booking === 'per_day' && (
                            <p className="text-xs text-muted-foreground">Per day × {extrasRentalDays} {extrasRentalDays === 1 ? 'day' : 'days'}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                        <TableCell className="text-right text-sm">
                          {formatCurrencyUtil(item.price_at_booking, tenant?.currency_code || 'USD')}{item.billing_type_at_booking === 'per_day' ? '/day' : ''}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">{formatCurrencyUtil(item.quantity * item.price_at_booking * (item.billing_type_at_booking === 'per_day' ? extrasRentalDays : 1), tenant?.currency_code || 'USD')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex justify-between items-center pt-3 border-t px-2">
                  <span className="text-sm font-semibold">Total</span>
                  <span className="text-sm font-bold">{formatCurrencyUtil(extrasTotal, tenant?.currency_code || 'USD')}</span>
                </div>
                <p className="text-xs text-muted-foreground pt-2 px-2">Extras are non-refundable.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No extras for this rental.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Rejection Dialog */}
      {rental && (
        <RejectionDialog
          open={showRejectionDialog}
          onOpenChange={setShowRejectionDialog}
          rental={{
            id: rental.id,
            customer: {
              id: rental.customers?.id,
              name: rental.customers?.name,
              email: rental.customers?.email,
            },
            vehicle: {
              id: rental.vehicles?.id,
              make: rental.vehicles?.make,
              model: rental.vehicles?.model,
              reg: rental.vehicles?.reg,
            },
            monthly_amount: rental.monthly_amount,
            start_date: rental.start_date,
            end_date: rental.end_date,
          }}
        />
      )}

      {/* DocuSign Not Signed Warning Dialog */}
      <AlertDialog open={showDocuSignWarning} onOpenChange={setShowDocuSignWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Agreement Not Signed
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasDocuSign
                ? 'The rental agreement has been sent but has not been signed by the customer yet.'
                : 'No rental agreement has been sent for this booking.'}
              <span className="block mt-2 font-medium">
                Do you still want to approve this booking without a signed agreement?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, Wait for Signature</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => {
                setShowDocuSignWarning(false);
                proceedToApproveAfterChecks();
              }}
            >
              Yes, Approve Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Insurance Warning Dialog */}
      <AlertDialog open={showInsuranceWarning} onOpenChange={setShowInsuranceWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              {!bonzahPolicy
                ? 'No Insurance Policy'
                : bonzahPolicy.status === 'quoted'
                ? 'Insurance Not Confirmed'
                : bonzahPolicy.status === 'failed'
                ? 'Insurance Failed'
                : 'Insurance Insufficient Balance'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {!bonzahPolicy
                ? 'This rental agreement does not have an insurance policy attached.'
                : bonzahPolicy.status === 'quoted'
                ? 'The insurance policy has been quoted but has not been confirmed or paid yet.'
                : bonzahPolicy.status === 'failed'
                ? 'The insurance policy purchase has failed.'
                : 'The insurance policy could not be purchased due to insufficient Bonzah account balance.'}
              <span className="block mt-2 font-medium">
                Do you still want to approve this booking without active insurance?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, Go Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => {
                setShowInsuranceWarning(false);
                setShowApproveDialog(true);
              }}
            >
              Yes, Approve Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Approve Confirmation Dialog */}
      <AlertDialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Booking</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to approve this booking for {rental?.customers?.name}?
              {rental?.payment_mode === 'manual' && rental?.payment_status === 'pending' && (
                <span className="block mt-2 text-amber-600">
                  This will capture the payment hold on the customer's card.
                </span>
              )}
              {!isKeyHandoverCompleted ? (
                <span className="block mt-2 text-blue-500">
                  <strong>Note:</strong> The rental will remain "Pending" until key handover is completed.
                </span>
              ) : (
                <span className="block mt-2">
                  The rental will become active and the customer will be notified.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isApproving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isApproving}
              onClick={async (e) => {
                e.preventDefault();
                setIsApproving(true);
                try {
                  // For manual mode with pending payment, capture first — only if a Stripe payment intent actually exists
                  const hasStripePayment = payment?.stripe_payment_intent_id || payment?.stripe_checkout_session_id;
                  if (rental?.payment_mode === 'manual' && rental?.payment_status === 'pending' && payment?.capture_status === 'requires_capture' && hasStripePayment) {
                    try {
                      const { data: captureData, error: captureError } = await supabase.functions.invoke('capture-booking-payment', {
                        body: {
                          paymentId: payment.id,
                          rentalId: id,
                        }
                      });
                      if (captureError) {
                        console.warn('Payment capture failed, proceeding with approval:', captureError);
                      } else if (captureData && !captureData.success) {
                        console.warn('Payment capture returned error, proceeding with approval:', captureData.error);
                      }
                    } catch (captureErr) {
                      console.warn('Payment capture exception, proceeding with approval:', captureErr);
                    }
                  }

                  // Query DB directly for key handover status (don't rely on React Query cache)
                  const { data: keyHandover } = await supabase
                    .from('rental_key_handovers')
                    .select('handed_at')
                    .eq('rental_id', id)
                    .eq('handover_type', 'giving')
                    .maybeSingle();

                  const keyHandoverDone = !!keyHandover?.handed_at;

                  // Update rental - only set to Active if key handover is also completed
                  const rentalUpdateData: any = {
                    approval_status: 'approved',
                    payment_status: 'fulfilled',
                    approved_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };

                  // Only set status to Active if key handover is completed
                  if (keyHandoverDone) {
                    rentalUpdateData.status = 'Active';
                  }

                  await supabase
                    .from('rentals')
                    .update(rentalUpdateData)
                    .eq('id', id);

                  // Send approval email
                  await supabase.functions.invoke('notify-booking-approved', {
                    body: {
                      rentalId: id,
                      tenantId: tenant?.id,
                      customerEmail: rental?.customers?.email,
                      customerName: rental?.customers?.name,
                      vehicleName: `${rental?.vehicles?.make} ${rental?.vehicles?.model}`,
                      bookingRef: id.substring(0, 8).toUpperCase(),
                      pickupDate: rental?.start_date,
                      returnDate: rental?.end_date,
                    }
                  }).catch(err => console.warn('Failed to send approval email:', err));

                  // If rental became Active (key handover was already done), send rental started notification
                  if (keyHandoverDone) {
                    await supabase.functions.invoke('notify-rental-started', {
                      body: {
                        rentalId: id,
                        customerName: rental?.customers?.name,
                        customerEmail: rental?.customers?.email,
                        vehicleName: `${rental?.vehicles?.make} ${rental?.vehicles?.model}`,
                        bookingRef: id.substring(0, 8).toUpperCase(),
                        tenantId: tenant?.id,
                      }
                    }).catch(err => console.warn('Failed to send rental started email:', err));
                  }

                  toast({
                    title: "Booking Approved",
                    description: keyHandoverDone
                      ? "Rental is now active and customer notified"
                      : "Booking approved. Rental will become active after key handover.",
                  });

                  queryClient.invalidateQueries({ queryKey: ['rental', id, tenant?.id] });
                  queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
                  queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
                  queryClient.invalidateQueries({ queryKey: ['rental-payment', id, tenant?.id] });
                  queryClient.invalidateQueries({ queryKey: ['key-handover-status', id] });
                  setShowApproveDialog(false);
                } catch (error: any) {
                  toast({
                    title: "Error",
                    description: error.message || "Failed to approve booking",
                    variant: "destructive",
                  });
                } finally {
                  setIsApproving(false);
                }
              }}
            >
              {isApproving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Approving...
                </>
              ) : (
                "Approve"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close Rental Confirmation Dialog */}
      <AlertDialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Rental</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to close this rental for {rental?.customers?.name}?
              <span className="block mt-2">
                The vehicle ({rental?.vehicles?.reg}) will be marked as available.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClosing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isClosing}
              onClick={async (e) => {
                e.preventDefault();
                setIsClosing(true);
                try {
                  await supabase
                    .from("rentals")
                    .update({ status: "Closed", updated_at: new Date().toISOString() })
                    .eq("id", id)
                    .eq("tenant_id", tenant?.id);

                  await supabase
                    .from("vehicles")
                    .update({ status: "Available" })
                    .eq("id", rental?.vehicles?.id)
                    .eq("tenant_id", tenant?.id);

                  toast({
                    title: "Rental Closed",
                    description: "Rental has been closed and vehicle is now available.",
                  });

                  queryClient.invalidateQueries({ queryKey: ["rental", id, tenant?.id] });
                  queryClient.invalidateQueries({ queryKey: ["rentals-list"] });
                  queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
                  queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
                  setShowCloseDialog(false);
                } catch (error) {
                  toast({
                    title: "Error",
                    description: "Failed to close rental.",
                    variant: "destructive",
                  });
                } finally {
                  setIsClosing(false);
                }
              }}
            >
              {isClosing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Closing...
                </>
              ) : (
                "Close Rental"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Rental Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rental</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this rental?
              <span className="block mt-2 text-red-600 font-medium">
                This action cannot be undone. All associated data will be permanently removed.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                setIsDeleting(true);
                try {
                  // Use the database function to delete rental and all related records
                  const { error: deleteError } = await supabase.rpc("delete_rental_cascade", {
                    rental_uuid: id,
                  });

                  if (deleteError) {
                    console.error("Error deleting rental:", deleteError);
                    throw new Error(`Failed to delete rental: ${deleteError.message}`);
                  }

                  toast({
                    title: "Rental Deleted",
                    description: "The rental has been permanently deleted.",
                  });

                  // Invalidate all rental-related queries
                  queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
                  queryClient.invalidateQueries({ queryKey: ["rentals-list"] });
                  queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
                  router.push("/rentals");
                } catch (error: any) {
                  console.error("Delete error:", error);
                  toast({
                    title: "Error",
                    description: error?.message || "Failed to delete rental.",
                    variant: "destructive",
                  });
                } finally {
                  setIsDeleting(false);
                }
              }}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* Finance Sync — per-rental sync stripe (Sprint 3). Renders nothing when
          no provider connected or no events for this rental yet. */}
    </div>
  );
};

export default RentalDetail;
