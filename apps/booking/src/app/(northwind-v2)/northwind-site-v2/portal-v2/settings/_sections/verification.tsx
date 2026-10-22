'use client';

/**
 * Settings → Verification (owner, Oct 21 2026): who the customer is and where
 * they are from, established from ONE document — a driving licence or an ID
 * card, their choice, never both. It replaces the read-only ID verification
 * page and the licence fields that used to sit under Details.
 *
 * ── THE FLOW ────────────────────────────────────────────────────────────────
 *   1. Choose: driving licence or ID card.
 *   2. Capture, two ways side by side:
 *        - a QR code for the phone, which opens the existing capture page
 *          (/verify/<token>) — front, back, selfie on the camera; this page
 *          follows along every few seconds;
 *        - or upload the three photos from this device.
 *      Both go through the same pipeline the operator's checks use: photos to
 *      `customer-documents/ai-verification/<session>/`, then
 *      `process-ai-verification` (OCR + face match).
 *      The session comes from `customer-start-verification`, which takes the
 *      customer from the JWT — never an id from the page.
 *   3. Result: the three pictures, and underneath them what was read off the
 *      document, in one place. OCR gets things wrong, so the customer can
 *      correct the details here (`customer_correct_verification`, which keeps
 *      the originals for the operator and only touches the latest check).
 *      Re-verify starts again from 1; a verified customer stays verified
 *      until the new check decides.
 *
 * With a licence the "ID number" is the licence number; nothing else changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react-nw';

import { formatDate, formatTimestamp } from '@nw/components/portal/format';
import { LoadError } from '@nw/portal-v2/primitives';
import { Input } from '@nw/components/ui/input';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomerVerification, type CustomerVerificationRow } from '@nw/hooks/use-customer-verification';
import { supabase } from '@nw/integrations/supabase/client';
import { cn } from '@nw/lib/utils';
import { AddCustomerVerifyArt } from '@portal-v2-shared/empty-states/add-customer';
import { TeachingEmptyState } from '@portal-v2-shared/empty-states/teaching-empty-state';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@portal-v2-shared/card';

import { PV_BUTTON, PV_BUTTON_OUTLINE_SM, PV_BUTTON_SM, PV_ICON_BUTTON, PV_INPUT } from '../_components/pv-kit';
import { RowHint, SettingsPageHeader, StatusPill } from '../_components/settings-ui';
import { ageInYears } from './details';

type DocumentChoice = 'drivers_license' | 'id_card';

interface Session {
  sessionId: string;
  qrUrl: string;
  expiresAt: string;
  documentType: DocumentChoice;
}

const DOC_NAME: Record<DocumentChoice, string> = { drivers_license: 'driving licence', id_card: 'ID card' };

/** 'drivers_license' / 'DRIVERS_LICENSE' / 'driving_licence' → the licence; anything else reads as an ID. */
const isLicence = (type: string | null | undefined) => ['drivers_license', 'driving_licence', 'driver_license'].includes((type ?? '').toLowerCase());

const documentLabel = (type: string | null | undefined) => {
  const key = (type ?? '').toLowerCase();
  if (isLicence(key)) return 'Driving licence';
  if (key === 'id_card') return 'ID card';
  if (key === 'passport') return 'Passport';
  return key ? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null;
};

/** The capture page's steps, as the operator's QR screen shows them. */
const STEP: Record<string, { label: string; percent: number }> = {
  init: { label: 'Waiting for you to scan the code', percent: 0 },
  qr_scanned: { label: 'Code scanned', percent: 10 },
  document_front: { label: 'Photographing the front', percent: 20 },
  document_front_captured: { label: 'Front captured', percent: 35 },
  document_back: { label: 'Photographing the back', percent: 45 },
  document_back_captured: { label: 'Back captured', percent: 55 },
  selfie: { label: 'Taking your selfie', percent: 65 },
  selfie_captured: { label: 'Selfie captured', percent: 75 },
  uploading: { label: 'Uploading your photos', percent: 85 },
  processing: { label: 'Checking your document', percent: 95 },
  completed: { label: 'Finished', percent: 100 },
};

const decisionOf = (row: CustomerVerificationRow) => {
  const result = (row.review_result ?? '').toUpperCase();
  if (result === 'GREEN') return { label: 'Verified', tone: 'positive' as const };
  if (result === 'RED') return { label: 'Not accepted', tone: 'negative' as const };
  if (result === 'RETRY' || result === 'YELLOW') return { label: 'Being reviewed', tone: 'notice' as const };
  return null;
};

/** An unfinished check whose link still works. */
function isOpen(row: CustomerVerificationRow | null, now: number): boolean {
  if (!row || row.review_result) return false;
  const status = (row.status ?? '').toLowerCase();
  if (status === 'processing') return true;
  if (!['init', 'pending'].includes(status)) return false;
  const expires = row.qr_session_expires_at ? Date.parse(row.qr_session_expires_at) : NaN;
  return Number.isFinite(expires) ? expires > now : true;
}

/* ──────────────────────────────── the page ─────────────────────────────── */

export function VerificationSettings() {
  const { tenant } = useTenant();
  const company = tenant?.company_name ?? 'the rental company';
  const verification = useCustomerVerification();
  const { history, verifiedByOperator, refetch } = verification;

  const [mode, setMode] = useState<'view' | 'choose' | 'capture' | 'edit'>('view');
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const latest = history[0] ?? null;
  const open = isOpen(latest, now) ? latest : null;
  const decided = useMemo(() => history.find((row) => row.review_result) ?? null, [history]);

  // While a check is running, follow it — the hook alone stops polling for a
  // customer who is already verified.
  const following = mode === 'capture' || open !== null;
  useEffect(() => {
    if (!following) return;
    const timer = setInterval(() => void refetch(), 4000);
    return () => clearInterval(timer);
  }, [following, refetch]);

  // The check finished while the capture screen was up: show the result.
  const sessionRow = session ? history.find((row) => row.session_id === session.sessionId) ?? null : null;
  useEffect(() => {
    if (mode === 'capture' && sessionRow?.review_result) {
      setMode('view');
      setSession(null);
      const decision = decisionOf(sessionRow);
      setNotice(
        decision?.tone === 'positive'
          ? 'Your ID is verified. Check the details below and correct anything the scan read wrong.'
          : decision?.tone === 'notice'
            ? `Your photos are in. ${company} will review them.`
            : 'That check was not accepted. You can try again with clearer photos.',
      );
    }
  }, [mode, sessionRow, company]);

  const start = async (documentType: DocumentChoice) => {
    if (!tenant?.id) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('customer-start-verification', {
        body: { action: 'start', tenant_id: tenant.id, document_type: documentType },
      });
      if (invokeError || !data?.ok) {
        throw new Error((data as { error?: string } | null)?.error ?? 'We could not start your check. Please try again.');
      }
      setSession({ sessionId: data.sessionId, qrUrl: data.qrUrl, expiresAt: data.expiresAt, documentType });
      setMode('capture');
      void refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not start your check.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (sessionId: string | null) => {
    setError(null);
    if (sessionId && tenant?.id) {
      setBusy(true);
      await supabase.functions
        .invoke('customer-start-verification', { body: { action: 'cancel', tenant_id: tenant.id, session_id: sessionId } })
        .catch(() => undefined);
      setBusy(false);
    }
    setSession(null);
    setMode('view');
    void refetch();
  };

  // The decided check is on screen (not choosing, capturing or following one).
  const showingResult = decided !== null && (mode === 'view' || mode === 'edit') && !(open && mode === 'view');
  const decision = decided ? decisionOf(decided) : null;
  const stillVerified =
    decided !== null && verification.outcome === 'approved' && (decided.review_result ?? '').toUpperCase() !== 'GREEN';

  // Owner, Oct 22 2026: the status sits up in the header row, and Re-verify
  // is the page's one main action, on its right.
  const header = (
    <SettingsPageHeader
      title="Verification"
      description={
        showingResult && decided ? (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-pv-fg">{documentLabel(decided.document_type) ?? 'Document'}</span>
            {decision ? <StatusPill tone={decision.tone}>{decision.label}</StatusPill> : null}
            <span>Checked {formatTimestamp(decided.verification_completed_at ?? decided.updated_at ?? decided.created_at) ?? ''}</span>
            {stillVerified ? <span>· You are still verified from your earlier check.</span> : null}
          </span>
        ) : (
          'Who you are and where you are from, from one document: your driving licence or your ID card.'
        )
      }
      action={
        showingResult && mode === 'view' ? (
          <button
            type="button"
            className={cn(PV_BUTTON, 'min-w-[132px]')}
            onClick={() => {
              setNotice(null);
              setMode('choose');
            }}
          >
            Re-verify
          </button>
        ) : undefined
      }
    />
  );

  if (verification.isError) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <LoadError title="We could not load your verification" error={verification.error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (verification.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div className="grid grid-cols-3 gap-4" aria-hidden>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="aspect-[4/3] rounded-2xl bg-pv-tint" />
          ))}
        </div>
        <Skeleton className="h-56 w-full rounded-2xl bg-pv-tint/70" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      {notice ? <p className="text-[13px] text-pv-fg">{notice}</p> : null}
      {error ? <RowHint tone="danger">{error}</RowHint> : null}

      {mode === 'choose' ? (
        <ChooseDocument busy={busy} onPick={(type) => void start(type)} onBack={() => setMode('view')} />
      ) : mode === 'capture' && session ? (
        <Capture session={session} row={sessionRow} onCancel={() => void cancel(session.sessionId)} onProcessed={() => void refetch()} />
      ) : open && mode === 'view' ? (
        <InFlight
          row={open}
          busy={busy}
          onRestart={() => setMode('choose')}
          onCancel={() => void cancel(open.session_id)}
        />
      ) : decided ? (
        <Result
          row={decided}
          editing={mode === 'edit'}
          onEdit={() => {
            setNotice(null);
            setMode('edit');
          }}
          onEditDone={(message) => {
            setMode('view');
            if (message) setNotice(message);
            void refetch();
          }}
        />
      ) : verifiedByOperator ? (
        <TeachingEmptyState
          illustration={<AddCustomerVerifyArt />}
          headline="Verified by the company"
          body={`${company} checked your ID in person, so there is no online check to show. You can still verify online with your licence or ID card.`}
          primaryAction={{ label: 'Driving licence', onClick: () => void start('drivers_license'), disabled: busy, hint: 'Verify with your driving licence.' }}
          secondaryAction={{ label: 'ID card', onClick: () => void start('id_card'), disabled: busy, hint: 'Verify with your national ID card.' }}
        />
      ) : (
        <TeachingEmptyState
          illustration={<AddCustomerVerifyArt />}
          headline="Verify who you are"
          body={`Your driving licence or your ID card — one is enough. Photograph it on your phone or upload it here, then take a selfie.`}
          primaryAction={{ label: 'Driving licence', onClick: () => void start('drivers_license'), disabled: busy, hint: 'Front, back and a selfie. The licence number is read off it.' }}
          secondaryAction={{ label: 'ID card', onClick: () => void start('id_card'), disabled: busy, hint: 'Front, back and a selfie. The ID number is read off it.' }}
          footnote={tenant?.require_identity_verification ? `${company} needs a verified ID before you collect a vehicle.` : undefined}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────── choose ────────────────────────────────── */

function ChooseDocument({ busy, onPick, onBack }: { busy: boolean; onPick: (type: DocumentChoice) => void; onBack: () => void }) {
  const options: { type: DocumentChoice; title: string; body: string }[] = [
    { type: 'drivers_license', title: 'Driving licence', body: 'Front and back of your licence, and a selfie. Your licence number becomes your ID number.' },
    { type: 'id_card', title: 'ID card', body: 'Front and back of your national ID card, and a selfie.' },
  ];
  return (
    <section aria-labelledby="choose-title" className="flex flex-col gap-4">
      <div>
        <h2 id="choose-title" className="text-[17px] font-semibold tracking-tight text-pv-fg">
          Which document will you use?
        </h2>
        <p className="mt-0.5 text-[14px] text-pv-muted-fg">One is enough. Use the one you carry.</p>
      </div>
      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.type}
            type="button"
            disabled={busy}
            onClick={() => onPick(option.type)}
            className="rounded-2xl border border-pv-border bg-pv-card p-5 text-left transition-colors duration-200 hover:border-pv-primary/40 hover:bg-pv-primary/5 focus-visible:ring-3 focus-visible:ring-pv-primary/25 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
          >
            <span className="block text-[15px] font-semibold text-pv-primary">{option.title}</span>
            <span className="mt-1 block text-[13px] leading-relaxed text-pv-muted-fg">{option.body}</span>
          </button>
        ))}
      </div>
      <div>
        <button type="button" onClick={onBack} disabled={busy} className={PV_BUTTON_OUTLINE_SM}>
          Back
        </button>
        {busy ? <Loader2 aria-label="Starting" className="ml-3 inline size-4 animate-spin text-pv-muted-fg" /> : null}
      </div>
    </section>
  );
}

/* ─────────────────────────────── capture ───────────────────────────────── */

function Progress({ row }: { row: CustomerVerificationRow | null }) {
  const step = STEP[row?.verification_step ?? 'init'] ?? STEP.init;
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-pv-fg">{step.label}</p>
        <span className="text-[12px] tabular-nums text-pv-muted-fg">{step.percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-pv-muted" role="progressbar" aria-valuenow={step.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-pv-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${step.percent}%` }} />
      </div>
    </div>
  );
}

type Slot = 'front' | 'back' | 'selfie';

function Capture({
  session,
  row,
  onCancel,
  onProcessed,
}: {
  session: Session;
  row: CustomerVerificationRow | null;
  onCancel: () => void;
  onProcessed: () => void;
}) {
  const name = DOC_NAME[session.documentType];
  const [files, setFiles] = useState<Partial<Record<Slot, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<Slot, string>>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<Slot, HTMLInputElement | null>>>({});

  useEffect(
    () => () => {
      Object.values(previews).forEach((url) => url && URL.revokeObjectURL(url));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const choose = (slot: Slot, file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpe?g|png)$/i.test(file.type)) return setError('Use a JPG or PNG photo.');
    if (file.size > 5 * 1024 * 1024) return setError('Each photo must be smaller than 5 MB.');
    setError(null);
    setFiles((current) => ({ ...current, [slot]: file }));
    setPreviews((current) => {
      if (current[slot]) URL.revokeObjectURL(current[slot]!);
      return { ...current, [slot]: URL.createObjectURL(file) };
    });
  };

  const submit = async () => {
    if (!files.front || !files.back || !files.selfie) return;
    setError(null);
    try {
      const put = async (file: File, type: string) => {
        const path = `ai-verification/${session.sessionId}/${type}.jpg`;
        const { data, error: uploadError } = await supabase.storage
          .from('customer-documents')
          .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
        if (uploadError) throw new Error(`Your ${type.replace('document-', '')} photo did not upload. ${uploadError.message}`);
        return data.path;
      };
      setUploading('Uploading the front…');
      const documentFrontPath = await put(files.front, 'document-front');
      setUploading('Uploading the back…');
      const documentBackPath = await put(files.back, 'document-back');
      setUploading('Uploading your selfie…');
      const selfiePath = await put(files.selfie, 'selfie');
      setUploading(`Checking your ${name}…`);
      const { error: processError } = await supabase.functions.invoke('process-ai-verification', {
        body: { sessionId: session.sessionId, documentFrontPath, documentBackPath, selfiePath },
      });
      if (processError) throw new Error('Your photos are in, but the check did not finish. Please try again.');
      onProcessed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
      setUploading(null);
    }
  };

  const slots: { slot: Slot; label: string; capture: 'environment' | 'user' }[] = [
    { slot: 'front', label: `Front of ${name}`, capture: 'environment' },
    { slot: 'back', label: `Back of ${name}`, capture: 'environment' },
    { slot: 'selfie', label: 'Selfie', capture: 'user' },
  ];
  const qrImage = `https://quickchart.io/qr?text=${encodeURIComponent(session.qrUrl)}&size=400&margin=1&dark=000000&light=ffffff&ecLevel=M&format=png`;
  const expires = (() => {
    const at = new Date(session.expiresAt);
    return Number.isNaN(at.getTime()) ? null : at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  })();
  const phoneActive = (row?.verification_step ?? 'init') !== 'init';

  return (
    <section aria-label={`Verify with your ${name}`} className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-2xl border border-pv-border bg-pv-card p-5">
          <div>
            <h2 className="text-[15px] font-semibold text-pv-fg">Use your phone</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-pv-muted-fg">
              Scan the code with your phone&apos;s camera. It opens a page that photographs your {name} and takes a selfie.
            </p>
          </div>
          <div className="flex items-center gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrImage} alt={`QR code to verify your ${name} on your phone`} width={168} height={168} className="size-[168px] shrink-0 rounded-xl bg-white p-2 ring-1 ring-pv-border" />
            <div className="min-w-0 flex-1 space-y-3">
              <Progress row={row} />
              {expires ? <p className="text-[12px] text-pv-muted-fg">The code works until {expires}.</p> : null}
            </div>
          </div>
        </div>

        <div className={cn('flex flex-col gap-4 rounded-2xl border border-pv-border bg-pv-card p-5', phoneActive && 'opacity-60')}>
          <div>
            <h2 className="text-[15px] font-semibold text-pv-fg">Or upload from this device</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-pv-muted-fg">Clear photos in good light, all four corners in view, no glare. JPG or PNG.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {slots.map(({ slot, label, capture }) => (
              <div key={slot} className="flex min-w-0 flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => inputs.current[slot]?.click()}
                  disabled={uploading !== null || phoneActive}
                  className={cn(
                    'relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-dashed text-[12px] text-pv-muted-fg transition-colors duration-200',
                    previews[slot] ? 'border-transparent' : 'border-pv-border hover:border-pv-primary/50 hover:bg-pv-primary/5',
                  )}
                  aria-label={previews[slot] ? `Replace: ${label}` : `Add: ${label}`}
                >
                  {previews[slot] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previews[slot]} alt="" className="size-full object-cover" />
                  ) : (
                    'Add photo'
                  )}
                </button>
                <span className="truncate text-[12px] font-medium text-pv-fg">{label}</span>
                <input
                  ref={(element) => {
                    inputs.current[slot] = element;
                  }}
                  type="file"
                  accept="image/jpeg,image/png"
                  capture={capture}
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(event) => {
                    choose(slot, event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </div>
            ))}
          </div>
          {error ? <RowHint tone="danger">{error}</RowHint> : null}
          <div className="flex items-center justify-end gap-3">
            {uploading ? <span className="text-[12px] text-pv-muted-fg">{uploading}</span> : null}
            <button
              type="button"
              className={PV_BUTTON_SM}
              disabled={!files.front || !files.back || !files.selfie || uploading !== null || phoneActive}
              onClick={() => void submit()}
            >
              {uploading ? <Loader2 aria-hidden className="animate-spin" /> : null}
              Submit photos
            </button>
          </div>
        </div>
      </div>

      <div>
        <button type="button" onClick={onCancel} disabled={uploading !== null} className={PV_BUTTON_OUTLINE_SM}>
          Cancel this check
        </button>
      </div>
    </section>
  );
}

/** A check already under way when the page opened: the phone has the code. */
function InFlight({ row, busy, onRestart, onCancel }: { row: CustomerVerificationRow; busy: boolean; onRestart: () => void; onCancel: () => void }) {
  const processing = (row.status ?? '').toLowerCase() === 'processing';
  return (
    <section className="flex max-w-2xl flex-col gap-4 rounded-2xl border border-pv-border bg-pv-card p-5">
      <div>
        <h2 className="text-[15px] font-semibold text-pv-fg">{processing ? 'Checking your document' : 'Your check is under way'}</h2>
        <p className="mt-0.5 text-[13px] leading-relaxed text-pv-muted-fg">
          {processing
            ? 'Your photos are in. This page updates by itself when the check finishes.'
            : 'Finish it on the phone you scanned the code with. Lost the code? Start again for a new one.'}
        </p>
      </div>
      <Progress row={row} />
      {processing ? null : (
        <div className="flex gap-2">
          <button type="button" className={PV_BUTTON_SM} onClick={onRestart} disabled={busy}>
            Start again
          </button>
          <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={onCancel} disabled={busy}>
            Cancel this check
          </button>
        </div>
      )}
    </section>
  );
}

/* ──────────────────────────────── result ───────────────────────────────── */

/**
 * One picture from the check. Drawn only when the check stored it (owner, Oct
 * 22 2026: no "No picture on file" tiles); one the browser cannot load takes
 * itself out rather than showing a broken frame.
 */
function Picture({ label, src }: { label: string; src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="block aspect-[4/3] overflow-hidden rounded-2xl bg-pv-muted"
        aria-label={`Open ${label}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={label} onError={() => setFailed(true)} className="size-full object-cover" />
      </a>
      <figcaption className="text-[12px] font-medium text-pv-muted-fg">{label}</figcaption>
    </figure>
  );
}

const FIELDS = [
  'first_name',
  'last_name',
  'date_of_birth',
  'document_number',
  'document_country',
  'document_issuing_date',
  'document_expiry_date',
  'address',
] as const;
type Field = (typeof FIELDS)[number];

function Result({
  row,
  editing,
  onEdit,
  onEditDone,
}: {
  row: CustomerVerificationRow;
  editing: boolean;
  onEdit: () => void;
  onEditDone: (message: string | null) => void;
}) {
  const licence = isLicence(row.document_type);
  const name = licence ? 'licence' : 'ID';
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const age = row.date_of_birth && now ? ageInYears(row.date_of_birth, now) : null;
  const today = now ? now.toISOString().slice(0, 10) : null;
  const expired = row.document_expiry_date && today ? row.document_expiry_date.slice(0, 10) < today : false;

  const labels: Record<Field, string> = {
    first_name: 'First name',
    last_name: 'Last name',
    date_of_birth: 'Date of birth',
    document_number: licence ? 'Licence number' : 'ID number',
    document_country: 'Country of issue',
    document_issuing_date: 'Issued',
    document_expiry_date: 'Expires',
    address: 'Address',
  };

  const shown: Record<Field, React.ReactNode> = {
    first_name: row.first_name,
    last_name: row.last_name,
    date_of_birth: row.date_of_birth ? (
      <>
        {formatDate(row.date_of_birth.slice(0, 10))}
        {age !== null ? <span className="text-pv-muted-fg"> · {age} years old</span> : null}
      </>
    ) : null,
    document_number: row.document_number ? <span className="font-mono text-[13px]">{row.document_number}</span> : null,
    document_country: row.document_country ? countryName(row.document_country) : null,
    document_issuing_date: formatDate(row.document_issuing_date?.slice(0, 10) ?? null),
    document_expiry_date: row.document_expiry_date ? (
      <span className="inline-flex flex-wrap items-center justify-end gap-2">
        {formatDate(row.document_expiry_date.slice(0, 10))}
        {expired ? <StatusPill tone="negative">Expired</StatusPill> : null}
      </span>
    ) : null,
    address: row.address,
  };

  // Only the pictures this check actually stored.
  const pictures = [
    { label: `Front of ${name}`, src: row.document_front_url },
    { label: `Back of ${name}`, src: row.document_back_url },
    { label: 'Selfie', src: row.selfie_image_url ?? row.face_image_url },
  ].filter((picture): picture is { label: string; src: string } => Boolean(picture.src));
  const hasPictures = pictures.length > 0;

  // Owner, Oct 22 2026: everything read off the document in ONE white card,
  // with a pencil on the card to correct it. No separate button, no
  // explanation: the pencil says it.
  const details = (
    <Card className="gap-3 py-5">
      <CardHeader className="px-6">
        <CardTitle className="text-[15px] font-semibold text-pv-fg">{licence ? 'Your driving licence' : 'Your ID card'}</CardTitle>
        {editing ? null : (
          <CardAction>
            <button type="button" className={PV_ICON_BUTTON} onClick={onEdit} aria-label="Edit details" title="Edit details">
              <Pencil aria-hidden />
            </button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-6">
        {editing ? (
          <EditDetails row={row} labels={labels} onDone={onEditDone} />
        ) : (
          <dl className={cn('grid gap-x-10', !hasPictures && 'sm:grid-cols-2')}>
            {FIELDS.map((field) => (
              <div key={field} className="flex items-baseline justify-between gap-4 border-b border-pv-border/60 py-2.5 last:border-b-0">
                <dt className="shrink-0 text-[13px] text-pv-muted-fg">{labels[field]}</dt>
                <dd className="min-w-0 text-right text-[14px] break-words text-pv-fg">{shown[field] ?? <span className="text-pv-muted-fg">—</span>}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );

  if (!hasPictures) return <section aria-label="Your verification">{details}</section>;

  return (
    <section aria-label="Your verification" className="grid items-start gap-6 lg:grid-cols-2">
      {details}
      <div className="grid grid-cols-2 gap-4">
        {pictures.map((picture) => (
          <Picture key={picture.label} label={picture.label} src={picture.src} />
        ))}
      </div>
    </section>
  );
}

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(undefined, { type: 'region' }) : null;
function countryName(code: string): string {
  const value = code.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(value) && regionNames) {
    try {
      return regionNames.of(value) ?? value;
    } catch {
      return value;
    }
  }
  return value;
}

function EditDetails({
  row,
  labels,
  onDone,
}: {
  row: CustomerVerificationRow;
  labels: Record<Field, string>;
  onDone: (message: string | null) => void;
}) {
  const initial = useMemo<Record<Field, string>>(
    () => ({
      first_name: row.first_name ?? '',
      last_name: row.last_name ?? '',
      date_of_birth: row.date_of_birth?.slice(0, 10) ?? '',
      document_number: row.document_number ?? '',
      document_country: row.document_country ?? '',
      document_issuing_date: row.document_issuing_date?.slice(0, 10) ?? '',
      document_expiry_date: row.document_expiry_date?.slice(0, 10) ?? '',
      address: row.address ?? '',
    }),
    [row],
  );
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = FIELDS.filter((field) => draft[field].trim() !== initial[field].trim());
  const dates: Field[] = ['date_of_birth', 'document_issuing_date', 'document_expiry_date'];

  const save = useCallback(async () => {
    if (changed.length === 0) return onDone(null);
    if (!draft.first_name.trim() || !draft.last_name.trim()) return setError('Your first and last name are needed.');
    setSaving(true);
    setError(null);
    try {
      const fields = Object.fromEntries(changed.map((field) => [field, draft[field].trim()]));
      const { error: rpcError } = await supabase.rpc('customer_correct_verification', { p_verification_id: row.id, p_fields: fields });
      if (rpcError) throw new Error(rpcError.message);
      onDone('Your details are corrected.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not save your corrections.');
    } finally {
      setSaving(false);
    }
  }, [changed, draft, onDone, row.id]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field} className={cn('space-y-1.5', field === 'address' && 'sm:col-span-2')}>
            <label htmlFor={`verify-${field}`} className="text-[13px] font-medium text-pv-fg">
              {labels[field]}
            </label>
            <Input
              id={`verify-${field}`}
              type={dates.includes(field) ? 'date' : 'text'}
              value={draft[field]}
              maxLength={field === 'document_country' ? 2 : undefined}
              placeholder={field === 'document_country' ? 'US' : undefined}
              onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
              className={cn(PV_INPUT, field === 'document_country' && 'uppercase')}
            />
          </div>
        ))}
      </div>
      {error ? <RowHint tone="danger">{error}</RowHint> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={() => onDone(null)} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className={PV_BUTTON_SM} disabled={saving || changed.length === 0}>
          {saving ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Save details
        </button>
      </div>
    </form>
  );
}
