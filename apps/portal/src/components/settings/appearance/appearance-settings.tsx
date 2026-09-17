'use client';

/**
 * Settings → Appearance
 *
 * Everything that decides what a tenant's *own team* looks at all day: theme,
 * brand colour, logos, favicon, app name.
 *
 * Deliberately separate from CMS → Site Settings, which owns the customer-facing
 * website and its SEO. Mixing the two is what made the old Branding tab
 * confusing — `meta_title` and `og_image` describe what a tenant's *customers*
 * see on Google, and have no business sitting next to the portal sidebar colour.
 *
 * Migration-free by design: a theme is a bundle of hex values written into
 * branding columns that already exist on `tenants`, and the active preset is
 * derived by matching those colours back against the preset list.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, RotateCcw, Save } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { Input } from '@/components/ui-v2/input';
import { Label } from '@/components/ui-v2/label';
import { Separator } from '@/components/ui-v2/separator';
import { Skeleton } from '@/components/ui-v2/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui-v2/alert-dialog';

import { FaviconUpload } from '@/components/settings/favicon-upload';
import { BrandSwatches } from '@/components/settings/appearance/brand-swatches';
import { BrandColorField } from '@/components/settings/appearance/brand-color-field';
import { LogoStudio } from '@/components/settings/appearance/logo-studio';

import { useTenantBranding, type TenantBranding } from '@/hooks/use-tenant-branding';
import { useTenant } from '@/contexts/TenantContext';
import { useV2 } from '@/lib/v2-context';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { useThemePreview } from '@/hooks/use-theme-preview';
import { toast } from '@/hooks/use-toast';
import { useUnsavedChangesWarning } from '@/hooks/use-unsaved-changes-warning';
import { UnsavedChangesDialog } from '@/components/shared/unsaved-changes-dialog';
import {
  DEFAULT_PRESET_ID,
  getPreset,
  type ThemePalette,
} from '@/lib/appearance/presets';
import { shade } from '@/lib/appearance/color';
import {
  describeSaveError,
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  SettingsSaveState,
  useSettingsSaveStatus,
  useWarnOnUnsavedChanges,
} from '@/components/settings-v2/section-states';
import { ScopeIf, isHexColor6, useImageLoadFailed } from '@/components/settings-v2/business-settings-states';

/** The shape this screen edits — a palette plus the identity fields. */
interface AppearanceForm extends ThemePalette {
  app_name: string;
  logo_url: string | null;
  dark_logo_url: string | null;
  favicon_url: string | null;
}

/**
 * Derive a full palette from one brand colour.
 *
 * The runtime engine already derives hover/light/foreground from `primary`, so
 * all this needs to produce is the handful of columns that engine reads. The
 * sidebar deepens the brand colour rather than inventing an unrelated hue, so
 * a custom choice still looks composed rather than assembled.
 */
function paletteFromBrandColor(hex: string): ThemePalette {
  return {
    primary_color: hex,
    secondary_color: shade(hex, -0.62),
    accent_color: shade(hex, 0.22),
    light_primary_color: hex,
    light_secondary_color: shade(hex, -0.62),
    light_accent_color: shade(hex, 0.18),
    light_background_color: '#F8FAFC',
    dark_primary_color: shade(hex, 0.24),
    dark_secondary_color: shade(hex, -0.44),
    dark_accent_color: shade(hex, 0.4),
    dark_background_color: '#0B1120',
  };
}

/** Server branding → the shape this screen edits, with defaults filled in. */
function formFromBranding(
  branding: TenantBranding,
  companyName?: string | null
): AppearanceForm {
  const base = paletteFromBrandColor(branding.primary_color || '#C6A256');
  return {
    primary_color: branding.primary_color || base.primary_color,
    secondary_color: branding.secondary_color || base.secondary_color,
    accent_color: branding.accent_color || base.accent_color,
    light_primary_color: branding.light_primary_color || base.light_primary_color,
    light_secondary_color: branding.light_secondary_color || base.light_secondary_color,
    light_accent_color: branding.light_accent_color || base.light_accent_color,
    light_background_color: branding.light_background_color || base.light_background_color,
    dark_primary_color: branding.dark_primary_color || base.dark_primary_color,
    dark_secondary_color: branding.dark_secondary_color || base.dark_secondary_color,
    dark_accent_color: branding.dark_accent_color || base.dark_accent_color,
    dark_background_color: branding.dark_background_color || base.dark_background_color,
    app_name: branding.app_name || companyName || '',
    logo_url: branding.logo_url,
    dark_logo_url: branding.dark_logo_url,
    favicon_url: branding.favicon_url,
  };
}

const EMPTY_FORM: AppearanceForm = {
  ...paletteFromBrandColor('#C6A256'),
  app_name: '',
  logo_url: null,
  dark_logo_url: null,
  favicon_url: null,
};

export function AppearanceSettings() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { branding, updateBranding, isUpdating } = useTenantBranding();
  const { canEditSettings, isLoading: permissionsLoading } = useManagerPermissions();
  // v2 chrome (northwind only; fails closed to v1). Used only to put this page's
  // header on the sidebar switch's row at md; every other tenant renders the
  // classes it did before. Above the early returns, as every hook must be.
  const v2Chrome = useV2('chrome');
  // v2 states (northwind): wait for the real branding row before hydrating. The
  // placeholder is tenant-context defaults, and a snapshot of it would let Save
  // null the live logo and favicon. A failed read offers a retry instead.
  const {
    hasBrandingData,
    error: brandingError,
    refetch: refetchBranding,
    isFetchingBranding,
  } = useTenantBranding();

  const readOnly = !permissionsLoading && !canEditSettings('branding');

  const [form, setForm] = useState<AppearanceForm>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(false);

  /**
   * Try-on mode. The portal itself is the preview — a candidate palette is
   * pushed through the same engine a saved change uses, so the tenant is
   * looking at the real thing rather than a mock-up that can drift.
   */
  const { preview: previewTheme, restore: restoreTheme, commit: commitTheme } =
    useThemePreview();

  /**
   * Server truth, captured once.
   *
   * `dirty` cannot be derived from `branding`: try-on mode writes the candidate
   * palette straight into the branding query cache so the live portal repaints,
   * which moves BOTH sides of the comparison together — the form always equalled
   * `branding`, so the Save button never enabled and a chosen colour could not be
   * kept. Hydration had the same flaw: it re-ran on every preview and reset the
   * form from values the tenant had not saved.
   */
  const savedRef = useRef<AppearanceForm | null>(null);
  // v2: the tenant the form was hydrated for. On mount both effects below run
  // in order, so the "tenant switched" reset used to undo the first hydration
  // (loaded back to false, savedRef back to null) and, with the branding
  // already cached, nothing re-ran it: the page sat on its skeleton.
  const v2HydratedTenant = useRef<string | null>(null);

  // Hydrate once per tenant. Deliberately NOT keyed on `branding`, which now
  // mutates during preview.
  useEffect(() => {
    if (loaded || !branding) return;
    if (v2Chrome && !hasBrandingData) return;
    const next = formFromBranding(branding, tenant?.company_name);
    savedRef.current = next;
    setForm(next);
    setLoaded(true);
    v2HydratedTenant.current = tenant?.id ?? null;
  }, [branding, loaded, tenant?.company_name]);

  // Re-hydrate when the tenant is switched underneath us.
  useEffect(() => {
    if (v2Chrome && v2HydratedTenant.current !== null && v2HydratedTenant.current === (tenant?.id ?? null)) return;
    setLoaded(false);
    savedRef.current = null;
  }, [tenant?.id]);

  const dirty = useMemo(() => {
    const saved = savedRef.current;
    if (!saved || !loaded) return false;
    return (
      form.primary_color !== saved.primary_color ||
      form.light_primary_color !== saved.light_primary_color ||
      form.dark_primary_color !== saved.dark_primary_color ||
      form.secondary_color !== saved.secondary_color ||
      form.accent_color !== saved.accent_color ||
      form.app_name !== saved.app_name ||
      form.logo_url !== saved.logo_url ||
      form.dark_logo_url !== saved.dark_logo_url ||
      form.favicon_url !== saved.favicon_url
    );
  }, [form, loaded]);

  // v2: the browser's leave prompt while a try-on is unsaved (unmounting restores
  // the saved theme, so leaving would silently drop it), a note when the stored
  // favicon file is gone, and a half-typed hex that must not be saved.
  useWarnOnUnsavedChanges(v2Chrome && dirty && !readOnly);
  const faviconFailed = useImageLoadFailed(v2Chrome ? form.favicon_url : null);
  const v2HexInvalid = v2Chrome && !isHexColor6(form.light_primary_color);

  // v2: a failed save stays on screen beside Save until the next edit (the
  // toast disappears), and a second click while a save is in flight is ignored.
  const [v2SaveError, setV2SaveError] = useState<unknown>(null);
  const v2SaveInFlight = useRef(false);
  useEffect(() => {
    if (v2Chrome) setV2SaveError(null);
  }, [form]);
  // Inert for v1 (never dirty, never pending), so it adds no renders or timers there.
  const v2SaveStatus = useSettingsSaveStatus({
    isDirty: v2Chrome && dirty,
    isPending: v2Chrome && isUpdating,
    error: v2SaveError,
  });

  /**
   * Apply a palette to the form *and* to the running portal, so the tenant sees
   * the consequence of the tap immediately rather than imagining it.
   */
  const applyPalette = (palette: ThemePalette) => {
    setForm((prev) => ({ ...prev, ...palette }));
    previewTheme(palette);
  };

  const applyCustomColor = (hex: string) => {
    if (v2Chrome && !isHexColor6(hex)) {
      // Still being typed: keep it in the field, never preview or derive a palette from it.
      setForm((prev) => ({ ...prev, light_primary_color: hex }));
      return;
    }
    applyPalette(paletteFromBrandColor(hex));
  };

  const resetToDefault = () => {
    const preset = getPreset(DEFAULT_PRESET_ID);
    if (preset) applyPalette(preset.palette);
  };

  /** Drop the previewed colours and put the live portal back to what's saved. */
  const discardChanges = () => {
    restoreTheme();
    if (savedRef.current) setForm(savedRef.current);
  };

  const handleSave = async () => {
    if (v2Chrome && !isHexColor6(form.light_primary_color)) {
      toast({
        title: 'Finish the brand colour first',
        description: 'Enter a 6-digit hex code such as #C6A256, or pick a swatch.',
        variant: 'destructive',
      });
      return false;
    }
    if (v2Chrome) {
      if (v2SaveInFlight.current) return false;
      v2SaveInFlight.current = true;
      setV2SaveError(null);
    }
    try {
      await updateBranding({
        primary_color: form.primary_color,
        secondary_color: form.secondary_color,
        accent_color: form.accent_color,
        light_primary_color: form.light_primary_color,
        light_secondary_color: form.light_secondary_color,
        light_accent_color: form.light_accent_color,
        light_background_color: form.light_background_color,
        dark_primary_color: form.dark_primary_color,
        dark_secondary_color: form.dark_secondary_color,
        dark_accent_color: form.dark_accent_color,
        dark_background_color: form.dark_background_color,
        app_name: form.app_name.trim() || null,
        logo_url: form.logo_url,
        dark_logo_url: form.dark_logo_url,
        favicon_url: form.favicon_url,
      });
      v2SaveInFlight.current = false;
      // The previewed palette is server truth now — advance both baselines, or
      // Save stays enabled and a later Discard resurrects the old colours.
      savedRef.current = { ...form };
      commitTheme();
      toast({
        title: 'Appearance saved',
        description: 'Your portal has been updated for everyone on your team.',
      });
      return true;
    } catch (error) {
      v2SaveInFlight.current = false;
      if (v2Chrome) setV2SaveError(error ?? new Error('Save failed'));
      toast({
        title: "Couldn't save appearance",
        description: v2Chrome ? describeSaveError(error) : error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      return false;
    }
  };

  // v2: leaving mid try-on (Back, the sidebar, the browser's back button) asks
  // first. Unmounting restores the saved theme, so leaving used to drop the
  // try-on without a word. "Save & Leave" saves and stays put if that fails.
  const v2Leave = useUnsavedChangesWarning({
    hasChanges: v2Chrome && dirty && !readOnly,
    onSave: async () => (await handleSave()) === true,
  });

  if (v2Chrome && !loaded && brandingError && !hasBrandingData) {
    return (
      <div className="space-y-6 pb-16 md:pt-7">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 gap-1.5 text-muted-foreground"
            onClick={() => router.push('/settings')}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Settings
          </Button>
          <h1 className="font-heading text-2xl font-medium tracking-tight">Appearance</h1>
        </div>
        <SettingsLoadError
          thing="your branding"
          error={brandingError}
          onRetry={refetchBranding}
          retrying={isFetchingBranding}
        />
      </div>
    );
  }

  // v2: also wait for a manager's permissions, or a view-only manager sees
  // enabled controls for a moment before they lock.
  if (!loaded || (v2Chrome && permissionsLoading)) {
    if (v2Chrome) {
      // Shaped like the page: header with its two actions, then the two sections.
      return (
        <div role="status" aria-busy="true" className="space-y-8 pb-16 md:pt-7">
          <span className="sr-only">Loading appearance</span>
          <div aria-hidden="true" className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-8 w-40 rounded-full" />
              <Skeleton className="h-4 w-72 max-w-[70vw] rounded-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20 rounded-full" />
              <Skeleton className="h-8 w-32 rounded-full" />
            </div>
          </div>
          {[0, 1].map((i) => (
            <div key={i} aria-hidden="true" className="grid gap-8 lg:grid-cols-[304px_minmax(0,1fr)]">
              <div className="space-y-2">
                <Skeleton className="h-5 w-32 rounded-full" />
                <Skeleton className="h-4 w-56 max-w-full rounded-full" />
              </div>
              <div className="max-w-xl space-y-3">
                <Skeleton className="h-9 w-full rounded-3xl" />
                <Skeleton className="h-24 w-full rounded-2xl" />
              </div>
            </div>
          ))}
        </div>
      );
    }
    // v2 (switch row alignment): the same 28px top as the loaded header below, so
    // the skeleton starts where the Back button will (y=78 at md) rather than at
    // y=54, under the 64px top bar.
    return (
      <div className={`space-y-6 p-1${v2Chrome ? ' md:pt-7' : ''}`}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // v2 (switch row alignment): at md <main> starts at y=50. The header's first
  // line is the 28px Back button, so 28px of top padding centres it at
  // 50 + 28 + 14 = 92, the sidebar switch's row. It sat at y=50, under the top bar.
  return (
    <div className={`space-y-8 pb-16${v2Chrome ? ' md:pt-7' : ''}`}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 gap-1.5 text-muted-foreground"
            onClick={() => router.push('/settings')}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Settings
          </Button>
          <h1 className="text-2xl font-medium tracking-tight">Appearance</h1>
          {v2Chrome ? (
            <p className="max-w-2xl text-sm text-muted-foreground">
              Choose how your portal looks for you and your team. Your customers&apos;
              booking site is styled separately in{' '}
              <Link href="/cms/site-settings" className="font-medium text-primary underline-offset-4 hover:underline dark:text-indigo-300">
                Website → Site settings
              </Link>
              .
            </p>
          ) : (
          <p className="max-w-2xl text-sm text-muted-foreground">
            Choose how your portal looks for you and your team. Your customers&apos;
            booking site is styled separately under CMS.
          </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={readOnly || isUpdating} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset to the default theme?</AlertDialogTitle>
                <AlertDialogDescription>
                  This puts the colours back to Drive Gold. Your logo, favicon and
                  app name are left exactly as they are. Nothing is saved until you
                  press Save changes.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={resetToDefault}>
                  Reset colours
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={readOnly || isUpdating || !dirty || v2HexInvalid}
            className="gap-1.5"
          >
            {isUpdating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save changes
          </Button>
        </div>
      </div>

      {/* Shown here only when the sticky bar (which carries the same error) is not. */}
      {v2Chrome && v2SaveStatus === 'error' && !(dirty && !readOnly) && (
        <SettingsSaveState status="error" error={v2SaveError} onRetry={handleSave} />
      )}

      {readOnly && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
          You have view-only access to branding settings. Ask an admin to make changes.
        </div>
      )}

      <Separator />

      {/* Brand colour — the whole theme, in one decision */}
      <section className="grid gap-8 lg:grid-cols-[304px_minmax(0,1fr)]">
        <div>
          <h2 className="text-base font-medium">Brand colour</h2>
          <p className="text-sm text-muted-foreground">
            Pick a colour and your portal updates around you straight away.
            Nothing is saved until you press Save changes.
          </p>
        </div>
        <div className="max-w-xl space-y-6">
          <BrandSwatches
            value={form.light_primary_color}
            onChange={applyCustomColor}
            disabled={readOnly}
          />
          <BrandColorField
            value={form.light_primary_color}
            onChange={applyCustomColor}
            disabled={readOnly}
          />
          {v2HexInvalid && (
            <p role="alert" className="text-xs text-destructive">
              That isn&apos;t a full colour code yet. Use # and 6 characters, like #C6A256.
            </p>
          )}
        </div>
      </section>

      <Separator />

      {/* Identity */}
      <section className="grid gap-8 lg:grid-cols-[304px_minmax(0,1fr)]">
        <div>
          <h2 className="text-base font-medium">Logo &amp; name</h2>
          <p className="text-sm text-muted-foreground">
            Shown in your sidebar, on sign-in and on documents you send out.
          </p>
        </div>

        <div className="max-w-xl space-y-6">
          <div className="space-y-2">
            <Label htmlFor="app_name">Portal name</Label>
            <Input
              id="app_name"
              value={form.app_name}
              maxLength={v2Chrome ? 60 : undefined}
              // v2 dark: --input carries its own alpha there, so bg-input/50 is invalid
              // and the field had no fill; the name floated with no box around it.
              className={v2Chrome ? 'dark:bg-muted' : undefined}
              // v2: a long name scrolls inside the box; hovering shows it whole.
              title={v2Chrome && form.app_name ? form.app_name : undefined}
              disabled={readOnly}
              placeholder={tenant?.company_name || 'Your company'}
              onChange={(e) => setForm((p) => ({ ...p, app_name: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Appears in the browser tab and beside your logo.
            </p>
          </div>

          <ScopeIf
            on={v2Chrome}
            wrap={(children) => (
              <SettingsReadOnlyFieldset
                readOnly={readOnly}
                className={readOnly ? 'pointer-events-none space-y-6' : 'space-y-6'}
              >
                {children}
              </SettingsReadOnlyFieldset>
            )}
          >
          <LogoStudio
            logoUrl={form.logo_url}
            darkLogoUrl={form.dark_logo_url}
            onLogoChange={(url) => setForm((p) => ({ ...p, logo_url: url }))}
            onDarkLogoChange={(url) => setForm((p) => ({ ...p, dark_logo_url: url }))}
            lightSidebar={form.light_secondary_color}
            darkSidebar={form.dark_secondary_color}
            disabled={readOnly}
            deferStorageDelete={v2Chrome}
          />

          <div className="space-y-2">
            {/* v2: FaviconUpload already renders the "Favicon" label and its help line. */}
            {!v2Chrome && (
            <Label>Favicon</Label>
            )}
            <FaviconUpload
              currentFaviconUrl={form.favicon_url || undefined}
              onFaviconChange={(url) => setForm((p) => ({ ...p, favicon_url: url }))}
              deferStorageDelete={v2Chrome}
              v2States={v2Chrome}
            />
            {!v2Chrome && (
            <p className="text-xs text-muted-foreground">
              The small icon on your browser tab.
            </p>
            )}
            {faviconFailed && (
              <p role="alert" className="text-xs text-destructive">
                We couldn&apos;t load your favicon file. Upload it again to replace it.
              </p>
            )}
          </div>
          </ScopeIf>
        </div>
      </section>

      {v2Chrome && (
        <UnsavedChangesDialog
          open={v2Leave.isDialogOpen}
          onCancel={v2Leave.cancelLeave}
          onDiscard={v2Leave.confirmLeave}
          onSave={v2HexInvalid ? undefined : v2Leave.saveAndLeave}
          isSaving={v2Leave.isSaving}
        />
      )}

      {/* Sticky save affordance so a tenant deep in the page never loses changes.
          Its right edge stops at `--trax-offset` — the width the open Trax panel
          floats over in v2 (styles/v2-theme.css), 0px everywhere else — so Save
          and Discard stay beside the panel instead of under it. */}
      {dirty && !readOnly && (
        <div className="fixed bottom-0 left-0 right-[var(--trax-offset,0px)] z-40 border-t bg-background/95 px-4 py-3 backdrop-blur transition-[right] duration-200 ease-linear motion-reduce:transition-none supports-[backdrop-filter]:bg-background/80">
          {v2Chrome && v2SaveStatus === 'error' && (
            <div className="mx-auto mb-2 max-w-5xl">
              <SettingsSaveState status="error" error={v2SaveError} onRetry={handleSave} />
            </div>
          )}
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">
              You&apos;re trying this out — nobody else sees it until you save.
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={discardChanges}
                disabled={isUpdating}
              >
                Discard
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isUpdating || v2HexInvalid} className="gap-1.5">
                {isUpdating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
