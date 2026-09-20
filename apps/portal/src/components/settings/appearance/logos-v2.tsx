'use client';

/**
 * Settings → Branding → Logos (v2 only). Replaces LogoStudio and
 * FaviconUpload on the v2 page; v1 keeps rendering those two unchanged.
 *
 * Two slots, each for one job, so nobody has to guess which file goes where:
 *
 *   Square icon  `favicon_url`  the browser tab and the sidebar badge
 *   Full logo    `logo_url`     the sign-in page and the booking site
 *
 * The code calls them `small` and `large` (`LogoSlot`); people only ever see
 * the names above, never "small", "large" or "favicon".
 *
 * The two slots are independent. The full logo never stands in for the square
 * icon: a wordmark with the company name in it is an unreadable sliver at
 * 16px, and uploading one used to put it in the tab and the sidebar badge, a
 * slot the tenant had not chosen it for (team lead, Sep 2026). With no square
 * icon both places show a mark drawn from the portal name's initials in the
 * brand colour — `resolveBrandIcon` in lib/appearance/logo.ts, the same chain
 * that drives the real browser tab.
 *
 * No migration: both columns already exist. The sign-in logo (`auth_logo_url`)
 * and the dark-mode logo (`dark_logo_url`) follow `logo_url` through the sync
 * in `useTenantBranding`'s update, as long as the page does not send them.
 *
 * One highlighted line at the top says what works best, and every file is
 * checked in the browser before anything is uploaded (type, file size, pixel
 * size within a range, shape), with the reason shown inline under the card.
 * The limits live in `lib/appearance/logo.ts` and all the copy is built from
 * them.
 *
 * Each card shows its image where it will really appear (branding-previews),
 * on that surface and with no tile of ours around it. The two previews are the
 * same height, so the cards line up.
 *
 * Save semantics match the rest of the page: an accepted file is uploaded at
 * once, but only the form points at it. Nothing reaches the tenant row until
 * Save changes, Reset puts the saved logos back, and Remove never deletes the
 * stored file.
 */

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { SettingsSection } from '@/components/settings-v2/settings-kit';
import { useImageLoadFailed } from '@/components/settings-v2/business-settings-states';
import { SignInPreview, SquareIconPreview } from '@/components/settings/appearance/branding-previews';
import {
  LARGE_LOGO_ACCEPT,
  loadLogoFile,
  LOGO_SLOT_NAMES,
  logoBestResultsText,
  logoFileProblem,
  logoHelpText,
  logoSizeProblem,
  logoSlotNoun,
  prepareLargeLogo,
  renderSmallLogo,
  SMALL_LOGO_ACCEPT,
  uploadLogoBlob,
  type LoadedLogo,
  type LogoSlot,
} from '@/lib/appearance/logo';

export const LOGOS_V2_INTRO =
  'You need two versions of your logo: a square icon, and your full logo with its name.';

const UNREADABLE = "We couldn't open this image. Save it again as a PNG and try once more.";
const UPLOAD_FAILED = "We couldn't upload this image. Check your connection and try again.";

export interface LogosV2Props {
  tenantId: string;
  /** The name shown beside the square icon and on the sign-in page. */
  portalName: string;
  /** What the browser tab says (see `portalTabTitle`). */
  tabTitle: string;
  /** The colour the sign-in page tints its hero with. */
  brandColor: string | null;
  /** The brand colour the sidebar badge and the tab mark are drawn in (the primary). */
  markColor: string | null;
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
  tabTitle,
  brandColor,
  markColor,
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
      <p
        data-logo-best=""
        className="rounded-xl bg-primary/10 px-4 py-2.5 text-[13px] font-medium leading-snug text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
      >
        {logoBestResultsText()}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <SquareIconCard
          tenantId={tenantId}
          portalName={portalName}
          tabTitle={tabTitle}
          markColor={markColor}
          url={faviconUrl}
          onChange={onFaviconChange}
          disabled={disabled}
          onBusyChange={setSmallBusy}
        />
        <FullLogoCard
          tenantId={tenantId}
          portalName={portalName}
          brandColor={brandColor}
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
  // Square icon only: a file that is fine except for its shape, waiting on "Fit into a square".
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
      // Storage file names are unchanged: favicon-… and logo-… under the tenant.
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

  const clear = () => {
    setProblem(null);
    dropNotSquare();
  };

  return { problem, notSquare, busy, pick, fitIntoSquare, clear };
}

/* -------------------------------------------------------------------------- */
/* The card both slots share                                                   */
/* -------------------------------------------------------------------------- */

interface LogoCardProps {
  slot: LogoSlot;
  description: string;
  accept: string;
  url: string | null;
  disabled?: boolean;
  upload: ReturnType<typeof useLogoUpload>;
  onRemove: () => void;
  preview: ReactNode;
}

function LogoCard({ slot, description, accept, url, disabled, upload, onRemove, preview }: LogoCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const failed = useImageLoadFailed(url);
  const noun = logoSlotNoun(slot);
  const choose = () => inputRef.current?.click();

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && !disabled && !upload.busy) void upload.pick(file);
  };

  return (
    <div
      data-logo-card={slot}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div>
        <h3 className="text-sm font-semibold text-foreground">{LOGO_SLOT_NAMES[slot]}</h3>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>
      </div>

      {preview}

      {url && failed && (
        <p role="alert" className="text-[13px] text-destructive">
          We couldn&apos;t load your saved {noun}. Upload it again to replace it.
        </p>
      )}

      <p data-logo-help={slot} className="text-xs text-muted-foreground">
        {logoHelpText(slot)}
      </p>

      {upload.problem && (
        <p role="alert" className="text-[13px] leading-snug text-destructive">
          {upload.problem}
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
          {upload.busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
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
/* Square icon                                                                 */
/* -------------------------------------------------------------------------- */

function SquareIconCard({
  tenantId,
  portalName,
  tabTitle,
  markColor,
  url,
  onChange,
  disabled,
  onBusyChange,
}: {
  tenantId: string;
  portalName: string;
  tabTitle: string;
  markColor: string | null;
  url: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const upload = useLogoUpload({ slot: 'small', tenantId, onChange, onBusyChange });

  return (
    <LogoCard
      slot="small"
      description="Shows in the browser tab and at the top of your sidebar."
      accept={SMALL_LOGO_ACCEPT}
      url={url}
      disabled={disabled}
      upload={upload}
      onRemove={() => onChange(null)}
      // No full-logo fallback: this card shows the square icon, or the
      // initials mark that stands in for it everywhere else.
      preview={<SquareIconPreview name={portalName} iconUrl={url} brandColor={markColor} tabTitle={tabTitle} />}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Full logo                                                                   */
/* -------------------------------------------------------------------------- */

function FullLogoCard({
  tenantId,
  portalName,
  brandColor,
  url,
  onChange,
  disabled,
  onBusyChange,
}: {
  tenantId: string;
  portalName: string;
  brandColor: string | null;
  url: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const upload = useLogoUpload({ slot: 'large', tenantId, onChange, onBusyChange });

  return (
    <LogoCard
      slot="large"
      description="Shows on your sign-in page and your booking website."
      accept={LARGE_LOGO_ACCEPT}
      url={url}
      disabled={disabled}
      upload={upload}
      onRemove={() => onChange(null)}
      preview={<SignInPreview logoUrl={url} appName={portalName} brandColor={brandColor} />}
    />
  );
}
