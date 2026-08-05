'use client';

// INSHUR / ABI "Period Z" per-rental cover, as it appears on a rental.
//
// Three things drive every layout decision in this file:
//
//  1. A rental that is OUT with no live cover is the failure this integration
//     exists to prevent, so `uninsured` and `failed` are rendered as loud
//     top-of-card alarms rather than as one more status pill in a row of pills.
//
//  2. `mock` is the default mode and will be the only mode until INSHUR issues
//     credentials, so a simulated record has to be unmistakable — and it has to
//     stay unmistakable after the tenant goes live. Every badge reads
//     `inshur_rental_coverage.source_mode`, which is stamped on the row when it
//     is written, never the tenant's current mode.
//
//  3. All decisions come from the shared hooks (`use-inshur`,
//     `use-inshur-coverage`, `use-inshur-eligibility`), which are tri-state on
//     purpose: `null` means "we could not determine this" and must never render
//     as a confident "no". This file only renders.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  Download,
  RefreshCw,
  ExternalLink,
  Ban,
  Copy,
  Car,
  History,
  Info,
} from 'lucide-react';

import { supabase, supabaseUntyped } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useInshur, type InshurMode } from '@/hooks/use-inshur';
import {
  useInshurCoverage,
  type InshurCoverage,
  type InshurCoverageStatus,
} from '@/hooks/use-inshur-coverage';
import { useInshurEligibility } from '@/hooks/use-inshur-eligibility';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** INSHUR brand hex. Declared once so it never gets scattered the way Bonzah's
 *  `#CC004A` did. */
export const INSHUR_BRAND = '#3D2BFF';
export const INSHUR_BRAND_SOFT = 'rgba(61,43,255,0.10)';

export const ABI_PORTAL_URL = 'https://portal.abiweb.com';

/** Private bucket. `inshur_rental_coverage.id_card_url` holds the object PATH,
 *  not a URL — a public URL would 400, and the path is what the signer wants. */
const ID_CARD_BUCKET = 'inshur-id-cards';
const ID_CARD_SIGNED_URL_TTL_SECONDS = 900;

// ---------------------------------------------------------------------------
// Shared presentation helpers (also consumed by the insurances list)
// ---------------------------------------------------------------------------

export interface InshurStatusInfo {
  label: string;
  badgeClass: string;
  dotClass: string;
  tone: 'success' | 'pending' | 'warning' | 'danger' | 'muted';
}

const STATUS_INFO: Record<InshurCoverageStatus, InshurStatusInfo> = {
  active: {
    label: 'On cover',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
    dotClass: 'bg-emerald-500',
    tone: 'success',
  },
  pending: {
    label: 'Starting…',
    badgeClass: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
    dotClass: 'bg-blue-500',
    tone: 'pending',
  },
  ineligible: {
    label: 'Not eligible',
    badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    dotClass: 'bg-amber-500',
    tone: 'warning',
  },
  ended: {
    label: 'Ended',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    dotClass: 'bg-muted-foreground/60',
    tone: 'muted',
  },
  cancelled: {
    label: 'Cancelled',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    dotClass: 'bg-muted-foreground/60',
    tone: 'muted',
  },
  failed: {
    label: 'Failed',
    badgeClass: 'bg-red-500/10 text-red-600 border-red-500/30',
    dotClass: 'bg-red-500',
    tone: 'danger',
  },
};

export function getInshurStatusInfo(status: string | null | undefined): InshurStatusInfo {
  return (
    STATUS_INFO[(status || '') as InshurCoverageStatus] ?? {
      label: status ? String(status) : 'Unknown',
      badgeClass: 'bg-muted text-muted-foreground border-border',
      dotClass: 'bg-muted-foreground/60',
      tone: 'muted',
    }
  );
}

export function InshurStatusBadge({ status }: { status: string | null | undefined }) {
  const info = getInshurStatusInfo(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
        info.badgeClass,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', info.dotClass)} aria-hidden />
      {info.label}
    </span>
  );
}

/**
 * The badge that stops a fake policy being mistaken for real cover.
 *
 * Renders for anything that is not `live` — including a null or unknown mode,
 * because "we cannot prove this is real" has to fail loud, not silent. `mock`
 * and `test` get different words on purpose: mock never touched ABI at all,
 * test created a real API object on a test account. Collapsing the two is how a
 * sandbox policy reached a paying renter on the Bonzah integration.
 */
export function InshurModeChip({
  mode,
  className,
}: {
  mode: string | null | undefined;
  className?: string;
}) {
  if (mode === 'live') return null;
  const isTest = mode === 'test';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap',
        isTest ? 'bg-blue-600 text-white' : 'bg-amber-400 text-black',
        className,
      )}
      title={
        isTest
          ? 'Written against ABI’s test account. Nobody is insured by this record.'
          : 'Generated by the Drive247 simulator. No insurance exists behind this record.'
      }
    >
      {isTest ? 'Test' : 'Simulated'}
    </span>
  );
}

/** Tenant-level mode, shown in the card header. Deliberately distinct from the
 *  row chip: this is the mode new cover would be written in, not the mode an
 *  existing record was written in. */
function TenantModeBadge({ mode }: { mode: InshurMode }) {
  if (mode === 'live') {
    return (
      <span className="inline-flex items-center rounded bg-green-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
        Live
      </span>
    );
  }
  if (mode === 'test') {
    return (
      <span className="inline-flex items-center rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
        Test
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
      Simulation
    </span>
  );
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * "Now" as a wall clock in `timeZone`, in ABI's own `YYYY-MM-DD HH:mm:ss` shape.
 *
 * `start_time_sent` is stored verbatim as it was sent — a wall clock in the
 * rental's timezone, not an instant. Rendering "now" the same way makes a plain
 * string comparison chronologically correct, and avoids inventing a UTC instant
 * that would move the cancel/end boundary by hours.
 */
function wallClockNow(timeZone: string | null | undefined): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
  } catch {
    return null;
  }
}

function relative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${formatDistanceToNow(d)} ago`;
}

function absolute(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return format(d, 'd MMM yyyy, HH:mm');
}

// ---------------------------------------------------------------------------
// ID card download
// ---------------------------------------------------------------------------

interface InshurIdCardButtonProps {
  coverage: Pick<InshurCoverage, 'id' | 'source_mode' | 'id_card_url' | 'status'>;
  variant?: 'outline' | 'ghost' | 'default';
  size?: 'sm' | 'default';
  className?: string;
}

/**
 * Signs the stored object and opens it.
 *
 * Deliberately does NOT decode base64 in the browser — that block already
 * exists in six portal files, and `inshur-create-coverage` has already written
 * the card to private storage with the content type it derived from ABI's
 * FILETYPE. Nothing here may assume PNG: the extension lives in the stored
 * path, so a PDF from ABI downloads as a PDF with no code change.
 */
export function InshurIdCardButton({
  coverage,
  variant = 'outline',
  size = 'sm',
  className,
}: InshurIdCardButtonProps) {
  const { toast } = useToast();
  const [isFetching, setIsFetching] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isSimulated = coverage.source_mode !== 'live';

  const openCard = async () => {
    const path = coverage.id_card_url;
    if (!path) {
      toast({
        title: 'ID card not ready',
        description:
          'INSHUR hasn’t produced the card for this rental period yet. Cover is unaffected — try again in a minute, or download it from portal.abiweb.com.',
      });
      return;
    }

    setIsFetching(true);
    try {
      // A card fetched before the integration was reconfigured may already be an
      // absolute URL; sign only what is actually a storage path.
      if (/^https?:\/\//i.test(path)) {
        window.open(path, '_blank', 'noopener,noreferrer');
        return;
      }

      const { data, error } = await supabase.storage
        .from(ID_CARD_BUCKET)
        .createSignedUrl(path, ID_CARD_SIGNED_URL_TTL_SECONDS);

      if (error || !data?.signedUrl) {
        toast({
          title: 'Couldn’t download the ID card',
          description: `${error?.message || 'The document could not be opened.'} Cover is unaffected — try again, or download it from portal.abiweb.com.`,
          variant: 'destructive',
        });
        return;
      }

      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setIsFetching(false);
    }
  };

  const handleClick = () => {
    if (coverage.status !== 'active' && coverage.status !== 'ended') {
      toast({
        title: 'No ID card for this rental',
        description: 'An ID card only exists once cover has started.',
      });
      return;
    }
    // Shown every time, not once: this interstitial is the last thing between a
    // simulated document and a renter's glovebox.
    if (isSimulated) {
      setConfirmOpen(true);
      return;
    }
    void openCard();
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={handleClick}
        disabled={isFetching}
      >
        {isFetching ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5 mr-1.5" />
        )}
        {isFetching ? 'Fetching…' : isSimulated ? 'ID card (simulated)' : 'Download ID card'}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              {coverage.source_mode === 'test'
                ? 'This card is from ABI’s test account'
                : 'This is a simulated ID card'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {coverage.source_mode === 'test'
                ? 'This document was produced against ABI’s test account. No renter is insured by it, and it must never be given to a renter, a customer, or a police officer.'
                : 'This document was generated by Drive247’s simulator. It is marked SIMULATED, no insurance exists behind it, and it must never be given to a renter, a customer, or a police officer. It exists so you can test the flow before INSHUR issues your credentials.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => void openCard()}
            >
              I understand, download
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------

interface InshurCoverageBlockProps {
  rentalId: string;
  /** The rental row from the detail page's query. Typed loosely to match the
   *  sibling insurance components on the same page. */
  rental: any;
  canEdit: boolean;
}

export function InshurCoverageBlock({ rentalId, rental, canEdit }: InshurCoverageBlockProps) {
  const { toast } = useToast();
  const inshur = useInshur();
  const cov = useInshurCoverage(rentalId);

  const [endOpen, setEndOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const vehicleId: string | undefined = rental?.vehicle_id || rental?.vehicles?.id;
  const elig = useInshurEligibility(vehicleId);

  // The rental query on the detail page doesn't select the VIN or the garaging
  // state, and both decide whether INSHUR can apply at all.
  const { data: vehicle, isLoading: isLoadingVehicle } = useQuery({
    queryKey: ['inshur-block-vehicle', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabaseUntyped
        .from('vehicles')
        .select('id, reg, make, model, vin, garaging_state')
        .eq('id', vehicleId)
        .maybeSingle();
      if (error) return null;
      return data as {
        id: string;
        reg: string | null;
        make: string | null;
        model: string | null;
        vin: string | null;
        garaging_state: string | null;
      } | null;
    },
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });

  const coverages = cov.coverages ?? [];
  const current = cov.coverage;
  const history = useMemo(
    () => (current ? coverages.filter((c) => c.id !== current.id).reverse() : []),
    [coverages, current],
  );

  const mode = inshur.mode;
  const isPayg = rental?.is_pay_as_you_go === true;
  const rentalStatus: string | undefined = rental?.status;
  const vin = vehicle?.vin || current?.vin || null;
  const reg = vehicle?.reg || rental?.vehicles?.reg || 'This vehicle';

  /** Why INSHUR can never apply to this rental. Null when it could. */
  const notApplicableReason: string | null = useMemo(() => {
    if (isPayg) {
      return 'Pay-as-you-go rentals have no fixed end date. INSHUR needs an exact start and end time for every rental period, so cover has to be arranged another way.';
    }
    if (rentalStatus === 'Cancelled' || rentalStatus === 'Rejected') {
      return `This rental was ${String(rentalStatus).toLowerCase()}, so there is nothing to insure.`;
    }
    if (!vin) {
      return `${reg} has no VIN on record. INSHUR identifies vehicles by VIN only — add the 17-character number on the vehicle page.`;
    }
    return null;
  }, [isPayg, rentalStatus, vin, reg]);

  const coverHasStarted = useMemo(() => {
    // No window on record means only End is safe — ABI rejects a cancel once the
    // period has begun, and we cannot prove it hasn't.
    if (!current?.start_time_sent) return true;
    const now = wallClockNow(current.timezone);
    if (!now) return true;
    return now >= current.start_time_sent;
  }, [current]);

  /** The car is out. Anything other than live cover here is an alarm. */
  const rentalIsOut = rentalStatus === 'Active';
  const isUninsured = rentalIsOut && current?.status !== 'active';

  /** The rental's vehicle was swapped out from under a live rental period. */
  const vinMismatch =
    (current?.status === 'active' || current?.status === 'pending') &&
    !!vehicle?.vin &&
    !!current?.vin &&
    vehicle.vin.trim().toUpperCase() !== current.vin.trim().toUpperCase();

  const pendingForAWhile = useMemo(() => {
    if (current?.status !== 'pending') return false;
    const started = new Date(current.last_attempt_at || current.created_at).getTime();
    return !isNaN(started) && Date.now() - started > 30_000;
  }, [current]);

  const copyDiagnostics = async () => {
    const lines = [
      `Rental: ${rental?.rental_number || rentalId}`,
      `Vehicle: ${reg}${vin ? ` (VIN ${vin})` : ''}`,
      `Mode: ${current?.source_mode || mode || 'unknown'}`,
      `Cover window: ${current?.start_time_sent || '—'} → ${current?.end_time_sent || '—'} (${current?.timezone || '—'})`,
      `State: ${current?.state || '—'}  Usage: ${current?.usage_type || '—'}`,
      `Attempts: ${current?.attempt_count ?? 0}`,
      `Error: ${current?.error_code || '—'} — ${current?.error_message || '—'}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast({ title: 'Copied', description: 'Paste these details into your message to INSHUR support.' });
    } catch {
      toast({
        title: 'Couldn’t copy',
        description: 'Your browser blocked clipboard access — select the details in the panel instead.',
        variant: 'destructive',
      });
    }
  };

  // --- render --------------------------------------------------------------

  // Say nothing until we know: a cover promise that appears then vanishes is
  // worse than a beat of delay. Rows that already exist keep the card visible
  // even if the integration was later switched off — a rental already on cover
  // must never lose the surface that can end it.
  const hasRows = coverages.length > 0;
  if (inshur.configState === 'loading' && !hasRows) return null;
  if (inshur.enabled !== true && !hasRows) return null;

  const header = (
    <CardHeader className="pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span
              className="inline-flex items-center justify-center rounded-lg p-1.5"
              style={{ background: INSHUR_BRAND_SOFT }}
            >
              <ShieldCheck className="h-4 w-4" style={{ color: INSHUR_BRAND }} />
            </span>
            INSHUR Period Z
            {mode && <TenantModeBadge mode={mode} />}
          </CardTitle>
          <CardDescription>Per-rental liability cover for this rental</CardDescription>
        </div>
        {current && (
          <div className="flex items-center gap-2">
            <InshurModeChip mode={current.source_mode} />
            <InshurStatusBadge status={current.status} />
          </div>
        )}
      </div>
    </CardHeader>
  );

  // The VIN decides whether INSHUR can apply at all, so hold the skeleton until
  // the vehicle read settles — otherwise every rental flashes "no VIN" first.
  if (cov.isLoading || (!!vehicleId && isLoadingVehicle)) {
    return (
      <Card id="inshur-section">
        {header}
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Checked before the "nothing here" branches below: an unreadable table looks
  // exactly like an uninsured rental, and the two must never be confused.
  if (cov.error) {
    return (
      <Card id="inshur-section">
        {header}
        <CardContent>
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
            <p className="text-sm font-medium text-red-600">Couldn’t load INSHUR cover</p>
            <p className="mt-1 text-xs text-muted-foreground">{cov.error.message}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Until this loads, don’t assume the rental is uninsured — check portal.abiweb.com.
            </p>
            <Button variant="outline" size="sm" className="mt-3 h-7 text-xs" onClick={() => cov.refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Nothing to show and nothing that could ever be shown — explain the absence
  // rather than leaving a hole where staff expect an insurance section.
  if (!current && notApplicableReason) {
    return (
      <Card id="inshur-section" className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <ShieldOff className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">INSHUR Period Z</span>
          <span className="text-xs text-muted-foreground">Not available for this rental</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{notApplicableReason}</p>
      </Card>
    );
  }

  // Finished with nothing on record: a historical fact, not a call to action.
  if (!current && rentalStatus === 'Closed') {
    return (
      <Card id="inshur-section" className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <ShieldOff className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">INSHUR Period Z</span>
          <span className="text-xs text-muted-foreground">No cover was recorded for this rental</span>
        </div>
      </Card>
    );
  }

  // `issuesRealCover` is null when the config could not be read; that is not
  // permission to render a record as real.
  const rowIsSimulated = current ? current.source_mode !== 'live' : inshur.issuesRealCover !== true;

  return (
    <Card id="inshur-section" className={cn(rowIsSimulated && 'border-2 border-dashed border-amber-400/60')}>
      {header}
      <CardContent className="space-y-4">
        {/* The exact Bonzah failure shape: real money in, imaginary cover out. */}
        {inshur.simulatedWhileStripeLive === true && (
          <div className="rounded-md bg-red-600 px-3 py-2 text-[12px] font-semibold text-white" role="alert">
            INSHUR is simulated but Stripe is LIVE. Renters can be charged real money for cover that does not exist.
          </div>
        )}

        {rowIsSimulated && (
          <SimulationStrip mode={(current?.source_mode as InshurMode) || mode || 'mock'} tenantMode={mode} />
        )}

        {/* The alarm. A car that is out with no live cover is the whole point of
            this integration, so it sits above every other detail. */}
        {isUninsured && <UninsuredAlarm coverage={current} reg={reg} />}

        {/* A vehicle swap moves the rental without moving the cover, and ABI
            can't repoint a rental period. Both records look internally
            consistent, so only comparing them catches it. */}
        {vinMismatch && (
          <div className="rounded-lg border-2 border-red-500 bg-red-500/10 p-4" role="alert">
            <p className="flex items-center gap-2 text-sm font-bold text-red-600">
              <ShieldAlert className="h-5 w-5" />
              Cover names a different vehicle
            </p>
            <p className="mt-1 text-xs text-red-700 dark:text-red-300 leading-relaxed">
              This rental is on {reg} (VIN {vehicle?.vin}), but the INSHUR rental period covers VIN {current?.vin}.
              The renter is not insured on the vehicle they have.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              End this cover and start new cover on the current vehicle — ABI can’t move a rental period to another
              VIN.
            </p>
          </div>
        )}

        {!current && !notApplicableReason && (
          <ReadyPanel
            reg={reg}
            vin={vin}
            vehicle={vehicle}
            elig={elig}
            canEdit={canEdit}
            issuesRealCover={inshur.issuesRealCover}
            stateAllowed={inshur.isStateAllowed(vehicle?.garaging_state)}
            statesAllowed={inshur.statesAllowed}
            isBinding={cov.create.isPending}
            onStart={() => cov.create.mutate()}
            vehicleId={vehicleId}
          />
        )}

        {current?.status === 'pending' && (
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-blue-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting cover with INSHUR…
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {pendingForAWhile
                ? 'This is taking longer than usual. INSHUR hasn’t replied yet — we’ll keep checking. Don’t start cover again; you’d risk two rental periods on the same vehicle.'
                : 'Adding the renter and opening the rental period. This normally takes a few seconds.'}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Started {relative(current.last_attempt_at || current.created_at)}
            </p>
          </div>
        )}

        {current?.status === 'ineligible' && (
          <IneligiblePanel
            coverage={current}
            elig={elig}
            reg={reg}
            vin={vin}
            vehicleId={vehicleId}
            statesAllowed={inshur.statesAllowed}
            stateAllowed={inshur.isStateAllowed(vehicle?.garaging_state)}
            garagingState={vehicle?.garaging_state ?? null}
            canEdit={canEdit}
            isRetrying={cov.retry.isPending}
            onRetry={() => cov.retry.mutate()}
          />
        )}

        {current?.status === 'active' && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium text-emerald-600">On cover</p>
              <InshurModeChip mode={current.source_mode} />
            </div>
            <CoverageFacts coverage={current} />
            {!current.id_card_url && (
              <p className="text-[11px] text-muted-foreground">
                ID card not fetched yet. INSHUR sometimes produces it a minute or two after cover starts.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <InshurIdCardButton coverage={current} className="h-7 text-xs" />
              {canEdit && !coverHasStarted && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                  onClick={() => setCancelOpen(true)}
                  disabled={cov.cancel.isPending}
                >
                  {cov.cancel.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Ban className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Cancel cover
                </Button>
              )}
              {canEdit && coverHasStarted && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
                  onClick={() => setEndOpen(true)}
                  disabled={cov.end.isPending}
                >
                  {cov.end.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  End cover early
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => cov.refetch()}
                disabled={cov.isFetching}
              >
                <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', cov.isFetching && 'animate-spin')} />
                Refresh
              </Button>
              <AbiPortalLink />
            </div>
          </div>
        )}

        {current?.status === 'ended' && (
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Cover ended</p>
              <InshurModeChip mode={current.source_mode} />
            </div>
            <p className="text-xs text-muted-foreground">
              Rental period {current.inshur_rental_id || '—'} ended {absolute(current.ended_at)}. The ID card stays
              available.
            </p>
            <CoverageFacts coverage={current} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <InshurIdCardButton coverage={current} className="h-7 text-xs" />
            </div>
          </div>
        )}

        {current?.status === 'cancelled' && (
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Ban className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">Cover cancelled</p>
              <InshurModeChip mode={current.source_mode} />
            </div>
            <p className="text-xs text-muted-foreground">
              Cancelled {absolute(current.cancelled_at)}, before it started. Nothing was insured.
            </p>
            {canEdit && !notApplicableReason && rentalStatus !== 'Closed' && (
              <Button
                size="sm"
                className="h-7 text-xs text-white"
                style={{ backgroundColor: INSHUR_BRAND }}
                onClick={() => cov.create.mutate()}
                disabled={cov.create.isPending}
              >
                {cov.create.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                )}
                Start cover again
              </Button>
            )}
          </div>
        )}

        {current?.status === 'failed' && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" />
              <p className="text-sm font-medium text-red-600">Couldn’t start cover</p>
              <InshurModeChip mode={current.source_mode} />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {current.error_message ||
                'INSHUR rejected the request without saying why — that’s normal for their API.'}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {current.error_code && (
                <span className="font-mono rounded bg-muted px-1.5 py-0.5">{current.error_code}</span>
              )}
              <span>
                Attempt {current.attempt_count || 1}
                {current.last_attempt_at ? ` · last tried ${relative(current.last_attempt_at)}` : ''}
              </span>
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  className="h-7 text-xs text-white"
                  style={{ backgroundColor: INSHUR_BRAND }}
                  onClick={() => cov.retry.mutate()}
                  disabled={cov.retry.isPending}
                >
                  {cov.retry.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Try again
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => elig.refresh.mutate()}
                  disabled={elig.isRefreshing || !vehicleId}
                >
                  {elig.isRefreshing ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Car className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Re-check vehicle
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={copyDiagnostics}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy details for INSHUR
                </Button>
                <AbiPortalLink />
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Earlier cover on this rental
            </p>
            {history.map((row) => (
              <div
                key={row.id}
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-l-4 bg-muted/30 px-3 py-2 text-xs',
                  row.status === 'failed' ? 'border-l-red-500' : 'border-l-muted-foreground/40',
                )}
              >
                <InshurStatusBadge status={row.status} />
                <InshurModeChip mode={row.source_mode} />
                <span className="font-mono text-[11px] text-muted-foreground">{row.inshur_rental_id || '—'}</span>
                <span className="text-muted-foreground">
                  {row.start_time_sent || '—'} → {row.end_time_sent || '—'}
                </span>
                {(row.status === 'ended' || row.status === 'active') && (
                  <InshurIdCardButton coverage={row} variant="ghost" className="h-6 px-2 text-[11px]" />
                )}
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">
              INSHUR can’t change a rental period once it exists, so a changed window ends the old cover and starts
              new cover. Each period has its own ID card — make sure the renter has the current one.
            </p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End INSHUR cover now?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends cover for {reg} immediately. The renter is no longer insured through INSHUR from this moment.
              It can’t be undone — restarting cover creates a new rental period with a new ID card. INSHUR hasn’t
              published how early termination affects billing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => cov.end.mutate()}>
              Yes, end cover now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel INSHUR cover?</AlertDialogTitle>
            <AlertDialogDescription>
              Cover hasn’t started yet, so it can be cancelled outright. If the period has in fact begun, INSHUR
              refuses the cancellation and it is ended instead — you’ll be told which happened. INSHUR hasn’t
              published its refund rules for cancellations, so check your monthly invoice.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep cover</AlertDialogCancel>
            <AlertDialogAction className="bg-amber-600 hover:bg-amber-700" onClick={() => cov.cancel.mutate()}>
              Yes, cancel cover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default InshurCoverageBlock;

// ---------------------------------------------------------------------------
// Sub-panels
// ---------------------------------------------------------------------------

type EligibilityView = ReturnType<typeof useInshurEligibility>;

function AbiPortalLink() {
  return (
    <a
      href={ABI_PORTAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      Open ABI portal
    </a>
  );
}

/**
 * `mode` is the mode the RECORD was written in; `tenantMode` is where the tenant
 * is now. They diverge the moment a tenant goes live with simulated records
 * still on file, and the record is the one that must be believed — so the
 * wording follows the record and only the call to action follows the tenant.
 */
function SimulationStrip({ mode, tenantMode }: { mode: InshurMode; tenantMode: InshurMode | null }) {
  if (mode === 'test') {
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white"
        role="status"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>TEST ACCOUNT — nobody is insured</span>
        <span className="font-normal opacity-90">
          Requests reach INSHUR with test credentials. Cover written here does not insure the renter and is not
          billed.
        </span>
      </div>
    );
  }
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-3 rounded-md px-3 py-2 text-[13px] font-semibold text-black"
      style={{ background: 'repeating-linear-gradient(45deg,#fbbf24 0 12px,#111827 12px 24px)' }}
      role="status"
    >
      <span className="rounded bg-amber-300 px-2 py-0.5">
        {tenantMode === 'live'
          ? 'SIMULATED RECORD — this cover was never real'
          : 'SIMULATION MODE — no insurance is real'}
      </span>
      {tenantMode !== 'live' && (
        <Link
          href="/settings?tab=inshur"
          className="rounded bg-amber-300 px-2 py-0.5 underline decoration-2 underline-offset-2"
        >
          Set up INSHUR
        </Link>
      )}
    </div>
  );
}

/** Loud, unmissable, and above everything else on the card. */
function UninsuredAlarm({ coverage, reg }: { coverage: InshurCoverage | null; reg: string }) {
  let detail: string;
  if (!coverage) {
    detail = `${reg} is out on this rental and no INSHUR cover has been started. Nobody is insured through INSHUR right now.`;
  } else if (coverage.status === 'failed') {
    detail = `Cover for ${reg} could not be created and the vehicle is already out. Nobody is insured through INSHUR right now.`;
  } else if (coverage.status === 'pending') {
    detail = `Cover for ${reg} hasn’t been confirmed by INSHUR yet and the vehicle is already out. Treat the renter as uninsured until this reads “On cover”.`;
  } else if (coverage.status === 'ended') {
    detail = `Cover for ${reg} was ended while the rental is still running. Nobody is insured through INSHUR right now.`;
  } else if (coverage.status === 'cancelled') {
    detail = `Cover for ${reg} was cancelled and the rental is now running. Nobody is insured through INSHUR right now.`;
  } else {
    detail = `${reg} is out on this rental and INSHUR reports it as not insurable. Nobody is insured through INSHUR right now.`;
  }

  return (
    <div className="rounded-lg border-2 border-red-500 bg-red-500/10 p-4" role="alert">
      <p className="flex items-center gap-2 text-sm font-bold text-red-600">
        <ShieldAlert className="h-5 w-5" />
        This rental is not insured through INSHUR
      </p>
      <p className="mt-1 text-xs text-red-700 dark:text-red-300 leading-relaxed">{detail}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Either fix the problem below and start cover, or make sure the renter is covered another way before the
        vehicle stays out any longer.
      </p>
    </div>
  );
}

function CoverageFacts({ coverage }: { coverage: InshurCoverage }) {
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
      <Fact label="Rental period" value={coverage.inshur_rental_id || '—'} mono />
      <Fact label="VIN" value={coverage.vin} mono />
      {/* Rendered exactly as sent. Recomputing them from our own dates would not
          prove what cover was actually bought. */}
      <Fact
        label="Cover window"
        value={`${coverage.start_time_sent || '—'} → ${coverage.end_time_sent || '—'}`}
        mono
      />
      <Fact label="Timezone" value={coverage.timezone || '—'} />
      <Fact label="Garaging state" value={coverage.state || '—'} />
      <Fact
        label="Usage"
        value={
          coverage.usage_type === 'Rideshare'
            ? 'Rideshare — the renter’s name appears on the ID card'
            : 'Personal — like a standard rental car'
        }
      />
      <Fact
        label="Comprehensive & collision"
        value={
          coverage.has_comp_coll === null
            ? 'Unknown'
            : coverage.has_comp_coll
              ? 'Included'
              : 'Liability only — the ID card won’t show comp/collision'
        }
      />
      <Fact label="ID card" value={coverage.id_card_url ? `Fetched ${relative(coverage.id_card_fetched_at)}` : 'Not fetched yet'} />
    </dl>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('font-medium text-foreground break-all', mono && 'font-mono text-[11px]')}>{value}</dd>
    </div>
  );
}

function RequirementRow({
  ok,
  label,
  pass,
  fail,
}: {
  ok: boolean | null | undefined;
  label: string;
  pass: string;
  fail: string;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok === true ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
      ) : ok === false ? (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
      ) : (
        <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <div>
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-muted-foreground">
          {ok === null || ok === undefined ? 'Not checked yet.' : ok ? pass : fail}
        </p>
      </div>
    </div>
  );
}

function EligibilityRequirements({ elig }: { elig: EligibilityView }) {
  return (
    <div className="space-y-2 rounded-md border border-amber-500/20 bg-background/60 p-3">
      <RequirementRow
        ok={elig.onPeriodX}
        label="On your Period X policy"
        pass="This VIN is on your annual policy."
        fail="Add this VIN at portal.abiweb.com, then re-check. Drive247 can’t add it for you — there is no API for that step."
      />
      <RequirementRow
        ok={elig.hasTrackingDevice}
        label="Tracking device reporting"
        pass="INSHUR is receiving GPS data for this VIN."
        fail="INSHUR hasn’t received GPS for this VIN. Your telematics provider sends this to them directly."
      />
      <RequirementRow
        ok={elig.hasCompColl}
        label="Comprehensive & collision"
        pass="Included on this VIN."
        fail="Liability only. Rental cover can still be started; the ID card won’t show comp/collision."
      />
      <p className="pt-1 text-[11px] text-muted-foreground">
        {elig.checkedAt ? `Last checked ${relative(elig.checkedAt)}` : 'Never checked'}
        {elig.isSimulated ? ' — simulated result, INSHUR was not contacted.' : ''}
        {elig.isStale ? ' · Period X membership can change without notice — re-check before relying on it.' : ''}
      </p>
    </div>
  );
}

function IneligiblePanel({
  coverage,
  elig,
  reg,
  vin,
  vehicleId,
  statesAllowed,
  stateAllowed,
  garagingState,
  canEdit,
  isRetrying,
  onRetry,
}: {
  coverage: InshurCoverage;
  elig: EligibilityView;
  reg: string;
  vin: string | null;
  vehicleId: string | undefined;
  statesAllowed: string[] | null;
  stateAllowed: boolean | null;
  garagingState: string | null;
  canEdit: boolean;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const stateBlocked = stateAllowed === false;

  const reason =
    coverage.error_message ||
    elig.reason ||
    (stateBlocked
      ? `Your policy writes Period Z in ${(statesAllowed || []).join(', ')}. ${reg} is garaged in ${garagingState}, which isn’t on the list.`
      : 'INSHUR reports this vehicle as ineligible but gave no reason.');

  const fix =
    elig.state === 'known'
      ? elig.onPeriodX === false
        ? `Add VIN ${vin || '—'} to your Period X policy at portal.abiweb.com, then re-check. Drive247 can’t add it for you — there is no API for that step.`
        : elig.hasTrackingDevice === false
          ? 'Your telematics provider sends GPS data to INSHUR directly. Contact your tracking supplier or INSHUR — Drive247 can’t change it from here.'
          : elig.hasCompColl === false
            ? 'Speak to INSHUR if you need comprehensive and collision on rental cover. Liability-only vehicles can still be covered.'
            : 'Check the VIN at portal.abiweb.com, or ask INSHUR why it can’t be covered.'
      : stateBlocked
        ? 'Contact INSHUR to add this state to your policy, or move the rental to a covered state.'
        : 'Re-check the vehicle below. If it stays ineligible, check the VIN at portal.abiweb.com or ask INSHUR.';

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          {reg} can’t be covered by INSHUR
        </p>
        <InshurModeChip mode={coverage.source_mode} />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{reason}</p>
      <p className="text-xs font-medium text-foreground leading-relaxed">{fix}</p>

      {elig.state === 'known' && <EligibilityRequirements elig={elig} />}

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => elig.refresh.mutate()}
            disabled={elig.isRefreshing || !vehicleId}
          >
            {elig.isRefreshing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Re-check with INSHUR
          </Button>
        )}
        {canEdit && (
          <Button
            size="sm"
            className="h-7 text-xs text-white"
            style={{ backgroundColor: INSHUR_BRAND }}
            onClick={onRetry}
            disabled={isRetrying}
          >
            {isRetrying ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            )}
            Try cover again
          </Button>
        )}
        {vehicleId && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
            <Link href={`/vehicles/${vehicleId}`}>
              <Car className="mr-1.5 h-3.5 w-3.5" />
              Vehicle page
            </Link>
          </Button>
        )}
        <AbiPortalLink />
      </div>
    </div>
  );
}

function ReadyPanel({
  reg,
  vin,
  vehicle,
  elig,
  canEdit,
  issuesRealCover,
  stateAllowed,
  statesAllowed,
  isBinding,
  onStart,
  vehicleId,
}: {
  reg: string;
  vin: string | null;
  vehicle: { make: string | null; model: string | null; garaging_state: string | null } | null | undefined;
  elig: EligibilityView;
  canEdit: boolean;
  issuesRealCover: boolean | null;
  stateAllowed: boolean | null;
  statesAllowed: string[] | null;
  isBinding: boolean;
  onStart: () => void;
  vehicleId: string | undefined;
}) {
  // Fails CLOSED, unlike the Bonzah equivalent: an unchecked or unreadable
  // eligibility row means we do not know whether the VIN is on Period X, and
  // binding one that isn't produces INSHUR's bare 400 with nothing to tell the
  // operator. `elig.eligible` is null in exactly those cases.
  const blockedReason =
    elig.state === 'loading'
      ? 'Checking this vehicle…'
      : elig.state === 'unchecked'
        ? 'Run an eligibility check first — starting cover on an unchecked VIN produces an error INSHUR won’t explain.'
        : elig.state === 'unknown'
          ? 'We couldn’t read this vehicle’s eligibility, so we can’t tell whether it’s insurable. Re-check before starting cover.'
          : elig.eligible !== true
            ? elig.reason || 'INSHUR reports this vehicle as not insurable.'
            : stateAllowed === false
              ? `Your policy writes Period Z in ${(statesAllowed || []).join(', ')}, and this vehicle is garaged in ${vehicle?.garaging_state}.`
              : !vehicle?.garaging_state
                ? 'Set this vehicle’s garaging state first — INSHUR requires a state on every rental period.'
                : null;

  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">No INSHUR cover on this rental yet</p>
      </div>

      <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        <Fact label="Vehicle" value={`${vehicle?.make || ''} ${vehicle?.model || ''} (${reg})`.trim()} />
        <Fact label="VIN" value={vin || '—'} mono />
        <Fact label="Garaging state" value={vehicle?.garaging_state || 'Not set'} />
        <Fact
          label="Eligibility"
          value={
            elig.state === 'known'
              ? elig.eligible
                ? 'Insurable'
                : elig.reason || 'Not insurable'
              : elig.state === 'unchecked'
                ? 'Not checked yet'
                : elig.state === 'unknown'
                  ? 'Couldn’t be read'
                  : 'Checking…'
          }
        />
      </dl>

      {elig.state === 'known' && elig.eligible !== true && <EligibilityRequirements elig={elig} />}

      {!vehicle?.garaging_state && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          This vehicle has no garaging state. INSHUR requires a state on every rental period — set it on the vehicle
          page before starting cover.
        </p>
      )}

      {issuesRealCover !== true && (
        <p className="text-xs text-muted-foreground">
          Cover started now is not real and insures nobody. It exists so you can exercise the whole flow before
          INSHUR issues your credentials.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <span title={blockedReason ?? undefined} className={blockedReason ? 'cursor-not-allowed' : undefined}>
            <Button
              size="sm"
              className="h-7 text-xs text-white"
              style={{ backgroundColor: INSHUR_BRAND }}
              onClick={onStart}
              disabled={isBinding || !!blockedReason}
            >
              {isBinding ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              )}
              Start INSHUR cover
            </Button>
          </span>
        )}
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => elig.refresh.mutate()}
            disabled={elig.isRefreshing || !vehicleId}
          >
            {elig.isRefreshing ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {elig.state === 'known' ? 'Re-check with INSHUR' : 'Check with INSHUR'}
          </Button>
        )}
      </div>

      {blockedReason && elig.state !== 'loading' && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {blockedReason}
        </p>
      )}
    </div>
  );
}
