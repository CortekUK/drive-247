'use client';

/**
 * Settings → Branding → Logos (v2, northwind only). Replaces LogoStudio and
 * FaviconUpload on the v2 page; v1 keeps rendering those two unchanged.
 *
 * Two slots, each for one job, so nobody has to guess which file goes where:
 *
 *   Small logo  `favicon_url`  the browser tab and the sidebar badge (a square icon)
 *   Large logo  `logo_url`     the sign-in page and the booking site (the full logo)
 *
 * No migration: both columns already exist. The sign-in logo (`auth_logo_url`)
 * and the dark-mode logo (`dark_logo_url`) follow `logo_url` through the sync
 * in `useTenantBranding`'s update, as long as the page does not send them.
 *
 * Every file is checked in the browser before anything is uploaded (type,
 * size, pixel size, shape), with the reason shown inline under the card. The
 * limits live in `lib/appearance/logo.ts` and the help text is built from them.
 *
 * Save semantics match the rest of the page: an accepted file is uploaded at
 * once, but only the form points at it. Nothing reaches the tenant row until
 * Save changes, Reset puts the saved logos back, and Remove never deletes the
 * stored file.
 */

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { AlertTriangle, Globe, Loader2, Scissors, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { SettingsSection } from '@/components/settings-v2/settings-kit';
import { useImageLoadFailed } from '@/components/settings-v2/business-settings-states';
import { getBrandInitials } from '@/components/shared/layout/brand-logo';
import {
  analyzeLogo,
  LARGE_LOGO_ACCEPT,
  loadLogoFile,
  logoFileProblem,
  logoHelpText,
  logoSizeProblem,
  prepareLargeLogo,
  removeLogoBackdrop,
  renderSmallLogo,
  SMALL_LOGO_ACCEPT,
  uploadLogoBlob,
  type LoadedLogo,
  type LogoSlot,
} from '@/lib/appearance/logo';
import { cn } from '@/lib/utils';

export const LOGOS_V2_INTRO =
  'You need two versions of your logo: a small square icon, and your full logo with its name.';

const UNREADABLE = "We couldn't open this image. Save it again as a PNG and try once more.";
const UPLOAD_FAILED = "We couldn't upload this image. Check your connection and try again.";

export interface LogosV2Props {
  tenantId: string;
  /** The name shown beside the small logo in its previews. */
  portalName: string;
  faviconUrl: string | null;
  logoUrl: string | null;
  onFaviconChange: (url: string | null) => void;
  onLogoChange: (url: string | null) => void;
  disabled?: boolean;
  /** True while either card is reading, preparing or uploading a file. */
  onBusyChange?: (busy: boolean) => void;
}

export function LogosV2({
  tenantId,
  portalName,
  faviconUrl,
  logoUrl,
  onFaviconChange,
  onLogoChange,
  disabled,
  onBusyChange,
}: LogosV2Props) {
  const [smallBusy, setSmallBusy] = useState(false);
  const [largeBusy, setLargeBusy] = useState(false);
  const busy = smallBusy || largeBusy;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;

  useEffect(() => {
    onBusyChangeRef.current?.(busy);
  }, [busy]);
  // A card that unmounts mid-upload (Reset remounts this section) is no longer busy.
  useEffect(() => () => onBusyChangeRef.current?.(false), []);

  return (
    <SettingsSection anchor="logos" title="Logos" description={LOGOS_V2_INTRO}>
      <div className="grid gap-4 lg:grid-cols-2">
        <SmallLogoCard
          tenantId={tenantId}
          portalName={portalName}
          url={faviconUrl}
          fallbackUrl={logoUrl}
          onChange={onFaviconChange}
          disabled={disabled}
          onBusyChange={setSmallBusy}
        />
        <LargeLogoCard
          tenantId={tenantId}
          url={logoUrl}
          onChange={onLogoChange}
          disabled={disabled}
          onBusyChange={setLargeBusy}
        />
      </div>
    </SettingsSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Picking, checking and uploading a file                                      */
/* -------------------------------------------------------------------------- */

interface UploadOptions {
  slot: LogoSlot;
  tenantId: string;
  onChange: (url: string | null) => void;
  onBusyChange: (busy: boolean) => void;
}

function useLogoUpload({ slot, tenantId, onChange, onBusyChange }: UploadOptions) {
  const [problem, setProblem] = useState<string | null>(null);
  // Small logo only: a file that is fine except for its shape, waiting on "Fit into a square".
  const [notSquare, setNotSquare] = useState<{ loaded: LoadedLogo; message: string } | null>(null);
  const [busy, setBusyState] = useState(false);
  const mounted = useRef(true);
  const latest = useRef({ onChange, onBusyChange, notSquare });
  latest.current = { onChange, onBusyChange, notSquare };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      latest.current.notSquare?.loaded.release();
    };
  }, []);

  const setBusy = (next: boolean) => {
    if (!mounted.current) return;
    setBusyState(next);
    latest.current.onBusyChange(next);
  };

  const dropNotSquare = () => {
    latest.current.notSquare?.loaded.release();
    setNotSquare(null);
  };

  /** Prepare the image for its slot and upload it; the form points at it only once that worked. */
  const finish = async (file: File | null, loaded: LoadedLogo) => {
    try {
      const blob = slot === 'small' ? await renderSmallLogo(loaded) : file ? await prepareLargeLogo(file, loaded) : null;
      if (!blob) {
        if (mounted.current) setProblem(UNREADABLE);
        return;
      }
      const url = await uploadLogoBlob(blob, tenantId, slot === 'small' ? 'favicon' : 'logo');
      if (mounted.current) latest.current.onChange(url);
    } catch {
      if (mounted.current) setProblem(UPLOAD_FAILED);
    } finally {
      loaded.release();
    }
  };

  const pick = async (file: File) => {
    setProblem(null);
    dropNotSquare();
    const fileProblem = logoFileProblem(slot, file);
    if (fileProblem) {
      setProblem(fileProblem);
      return;
    }
    setBusy(true);
    try {
      const loaded = await loadLogoFile(file);
      if (!mounted.current) {
        loaded?.release();
        return;
      }
      if (!loaded) {
        setProblem(UNREADABLE);
        return;
      }
      const sizeProblem = logoSizeProblem(slot, loaded);
      if (sizeProblem?.kind === 'not-square') {
        setNotSquare({ loaded, message: sizeProblem.message });
        return;
      }
      if (sizeProblem) {
        loaded.release();
        setProblem(sizeProblem.message);
        return;
      }
      await finish(file, loaded);
    } finally {
      setBusy(false);
    }
  };

  const fitIntoSquare = async () => {
    const pending = notSquare;
    if (!pending) return;
    // The square is drawn from the image already open; `finish` releases it.
    setNotSquare(null);
    setBusy(true);
    try {
      await finish(null, pending.loaded);
    } finally {
      setBusy(false);
    }
  };

  /** A repaired copy made from the stored image (the large logo's "Remove the box"). */
  const replaceWith = async (make: () => Promise<Blob | null>, suffix: string) => {
    setProblem(null);
    setBusy(true);
    try {
      const blob = await make();
      if (!blob) {
        if (mounted.current) setProblem("We couldn't change this image here. Remove the box in an image editor and upload it again.");
        return;
      }
      const url = await uploadLogoBlob(blob, tenantId, suffix);
      if (mounted.current) latest.current.onChange(url);
    } catch {
      if (mounted.current) setProblem(UPLOAD_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setProblem(null);
    dropNotSquare();
  };

  return { problem, notSquare, busy, pick, fitIntoSquare, replaceWith, clear };
}

/* -------------------------------------------------------------------------- */
/* The card both slots share                                                   */
/* -------------------------------------------------------------------------- */

interface LogoCardProps {
  slot: LogoSlot;
  title: string;
  description: string;
  accept: string;
  url: string | null;
  disabled?: boolean;
  upload: ReturnType<typeof useLogoUpload>;
  onRemove: () => void;
  preview: ReactNode;
  /** Advice about the stored image (the large logo's box), under the preview. */
  advice?: ReactNode;
}

function LogoCard({ slot, title, description, accept, url, disabled, upload, onRemove, preview, advice }: LogoCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const failed = useImageLoadFailed(url);
  const noun = slot === 'small' ? 'small logo' : 'large logo';
  const choose = () => inputRef.current?.click();

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && !disabled && !upload.busy) void upload.pick(file);
  };

  return (
    <div
      data-logo-card={slot}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>
      </div>

      {preview}

      {url && failed && (
        <p role="alert" className="text-[13px] text-destructive">
          We couldn&apos;t load your saved {noun}. Upload it again to replace it.
        </p>
      )}

      {advice}

      <p data-logo-help={slot} className="text-xs text-muted-foreground">
        {logoHelpText(slot)}
      </p>

      {upload.problem && (
        <p role="alert" className="flex items-start gap-1.5 text-[13px] leading-snug text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{upload.problem}</span>
        </p>
      )}

      {upload.notSquare && (
        <div
          role="alert"
          className="space-y-2.5 rounded-xl bg-amber-500/10 px-3.5 py-3 text-[13px] leading-snug text-amber-800 dark:text-amber-300"
        >
          <p>{upload.notSquare.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void upload.fitIntoSquare()}>
              Fit into a square
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                upload.clear();
                choose();
              }}
            >
              Choose another file
            </Button>
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || upload.busy}
          aria-busy={upload.busy || undefined}
          aria-label={`${url ? 'Replace' : 'Upload'} ${noun}`}
          onClick={choose}
        >
          {upload.busy ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <Upload data-icon="inline-start" />
          )}
          {upload.busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}
        </Button>
        {url && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || upload.busy}
            aria-label={`Remove ${noun}`}
            onClick={() => {
              upload.clear();
              onRemove();
            }}
          >
            Remove
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload.pick(file);
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small logo                                                                  */
/* -------------------------------------------------------------------------- */

function SmallLogoCard({
  tenantId,
  portalName,
  url,
  fallbackUrl,
  onChange,
  disabled,
  onBusyChange,
}: {
  tenantId: string;
  portalName: string;
  url: string | null;
  /** The large logo: what the sidebar badge falls back to, as OrgMark does. */
  fallbackUrl: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const upload = useLogoUpload({ slot: 'small', tenantId, onChange, onBusyChange });
  const badgeSrc = url || fallbackUrl;

  const preview = (
    <div className="grid gap-3 sm:grid-cols-2">
      <figure className="min-w-0 space-y-1.5">
        {/* The sidebar's top row: OrgMark's 32px badge beside the portal name. */}
        <div className="flex h-14 items-center gap-2.5 rounded-xl border bg-background px-3">
          {badgeSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={badgeSrc}
              alt="Small logo in the sidebar"
              className="h-8 w-8 shrink-0 rounded-lg bg-muted object-contain p-0.5"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[12px] font-semibold text-primary-foreground"
            >
              {getBrandInitials(portalName) || 'O'}
            </span>
          )}
          <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">{portalName}</span>
        </div>
        <figcaption className="text-[11px] text-muted-foreground">Sidebar</figcaption>
      </figure>
      <figure className="min-w-0 space-y-1.5">
        {/* A browser tab: the 16px icon and the page title. */}
        <div className="flex h-14 items-end overflow-hidden rounded-xl border bg-muted px-2 pt-2">
          <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-t-xl bg-background px-3">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="Small logo in a browser tab" className="size-4 shrink-0 object-contain" />
            ) : (
              <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{portalName}</span>
            <X className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
        <figcaption className="text-[11px] text-muted-foreground">Browser tab</figcaption>
      </figure>
    </div>
  );

  return (
    <LogoCard
      slot="small"
      title="Small logo"
      description="Used for your browser tab and the badge at the top of your sidebar."
      accept={SMALL_LOGO_ACCEPT}
      url={url}
      disabled={disabled}
      upload={upload}
      onRemove={() => onChange(null)}
      preview={preview}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Large logo                                                                  */
/* -------------------------------------------------------------------------- */

function LargeLogoCard({
  tenantId,
  url,
  onChange,
  disabled,
  onBusyChange,
}: {
  tenantId: string;
  url: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const upload = useLogoUpload({ slot: 'large', tenantId, onChange, onBusyChange });

  // A logo welded into a solid box (the classic JPG) shows as a rectangle on the
  // dark surface. Found by LogoStudio's corner check; unreadable pixels
  // (another host without CORS) simply say nothing.
  const [boxedUrl, setBoxedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    analyzeLogo(url).then((analysis) => {
      if (!cancelled) setBoxedUrl(analysis?.hasSolidBackdrop ? url : null);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const surfaces = [
    { label: 'On a light background', className: 'bg-white' },
    { label: 'On a dark background', className: 'bg-[#0B1120]' },
  ];

  const preview = (
    <div className="grid grid-cols-2 gap-3">
      {surfaces.map((surface) => (
        <figure key={surface.label} className="min-w-0 space-y-1.5">
          <div className={cn('flex h-24 items-center justify-center rounded-xl border p-4', surface.className)}>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={`Large logo ${surface.label.toLowerCase()}`} className="max-h-12 max-w-full object-contain" />
            ) : (
              <span className="text-xs text-slate-400">No logo yet</span>
            )}
          </div>
          <figcaption className="text-[11px] text-muted-foreground">{surface.label}</figcaption>
        </figure>
      ))}
    </div>
  );

  const advice =
    url && boxedUrl === url ? (
      <div className="space-y-2.5 rounded-xl bg-amber-500/10 px-3.5 py-3 text-[13px] leading-snug text-amber-800 dark:text-amber-300">
        <p>Your logo has a solid box behind it, so it shows as a rectangle on dark backgrounds.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || upload.busy}
          onClick={() => void upload.replaceWith(() => removeLogoBackdrop(url), 'logo-clean')}
        >
          <Scissors data-icon="inline-start" />
          Remove the box
        </Button>
      </div>
    ) : null;

  return (
    <LogoCard
      slot="large"
      title="Large logo"
      description="Shown on your sign-in page and your booking website."
      accept={LARGE_LOGO_ACCEPT}
      url={url}
      disabled={disabled}
      upload={upload}
      onRemove={() => onChange(null)}
      preview={preview}
      advice={advice}
    />
  );
}
