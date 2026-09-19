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
 *
 * TWO RENDERS. Every v1 tenant gets `AppearanceSettings` below, exactly as
 * before. A v2 tenant gets "Branding": the same hooks gate on the real
 * branding row and the manager's permissions, then mount `AppearanceFormV2`
 * keyed on the tenant, which seeds its form once from that row. Portal name
 * (with a preview of where it shows), Brand colour and Logos in that order,
 * one level of navigation (no tabs), the kit's page header, sticky save bar
 * and leave dialog, and five named brand colours plus a custom one.
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
import { LogosV2 } from '@/components/settings/appearance/logos-v2';

import { LOGO_PREVIEW_HEIGHT, PortalNamePreview, portalTabTitle } from '@/components/settings/appearance/branding-previews';

import { useTenantBranding, type TenantBranding } from '@/hooks/use-tenant-branding';
import { useTenant } from '@/contexts/TenantContext';
import { useV2 } from '@/lib/v2-context';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { useThemePreview } from '@/hooks/use-theme-preview';
import { toast } from '@/hooks/use-toast';
import { useLeaveGuardV2 } from '@/hooks/use-leave-guard-v2';
import {
  DEFAULT_PRESET_ID,
  getPreset,
  V2_BRAND_PRESETS,
  V2_DEFAULT_BRAND_COLOR,
  V2_DEFAULT_BRAND_NAME,
  type ThemePalette,
} from '@/lib/appearance/presets';
import { hexToHsl, isUsableV2Brand, shade } from '@/lib/appearance/color';
import {
  describeSaveError,
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  SettingsReadOnlyNotice,
  SettingsSaveState,
} from '@/components/settings-v2/section-states';
import {
  SettingsPageHeader,
  SettingsPageSaveProvider,
  SettingsPanel,
  SettingsSection,
  SettingsStickySaveBar,
} from '@/components/settings-v2/settings-kit';
import { settingsSectionId } from '@/components/settings-v2/settings-shell-state';
import { LeaveDialogV2 } from '@/components/settings-v2/leave-dialog-v2';
import { isHexColor6 } from '@/components/settings-v2/business-settings-states';

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

/**
 * Server branding → the shape this screen edits, with defaults filled in.
 * `fallbackColor` is the brand colour when none is stored: Drive Gold for v1,
 * the v2 Default (#442DD7) for v2.
 */
function formFromBranding(
  branding: TenantBranding,
  companyName?: string | null,
  fallbackColor = '#C6A256'
): AppearanceForm {
  const base = paletteFromBrandColor(branding.primary_color || fallbackColor);
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
  // v2 chrome (northwind only; fails closed to v1): the v2 page below, after
  // every hook, as hooks must be.
  const v2Chrome = useV2('chrome');
  // v2 states (northwind): wait for the real branding row before mounting the
  // form. The placeholder is tenant-context defaults, and a snapshot of it would
  // let Save null the live logo and favicon. A failed read offers a retry instead.
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

  // Hydrate once per tenant. Deliberately NOT keyed on `branding`, which now
  // mutates during preview. v1 only: v2's form seeds itself from `initial`.
  useEffect(() => {
    if (v2Chrome) return;
    if (loaded || !branding) return;
    const next = formFromBranding(branding, tenant?.company_name);
    savedRef.current = next;
    setForm(next);
    setLoaded(true);
  }, [branding, loaded, tenant?.company_name]);

  // Re-hydrate when the tenant is switched underneath us. v1 only: on v2 a new
  // tenant remounts the keyed form instead. (Both effects running in one flush
  // on mount is what left v2 on its skeleton when branding was already cached.)
  useEffect(() => {
    if (v2Chrome) return;
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

  // v2 (northwind): Branding. Nothing below this point runs for it.
  if (v2Chrome) {
    // Wait for the real branding row and a manager's permissions (or a view-only
    // manager sees enabled controls for a moment before they lock), then mount
    // the form once per tenant.
    if (!tenant?.id || !hasBrandingData || permissionsLoading) {
      if (brandingError && !hasBrandingData) {
        return (
          <div className={V2_PAGE_CLASS}>
            <SettingsPageHeader title={V2_PAGE_TITLE} description={<V2PageDescription />} />
            <SettingsLoadError
              thing="your branding"
              error={brandingError}
              onRetry={refetchBranding}
              retrying={isFetchingBranding}
            />
          </div>
        );
      }
      return <AppearanceSkeletonV2 />;
    }
    return (
      <AppearanceFormV2
        key={tenant.id}
        tenantId={tenant.id}
        companyName={tenant.company_name}
        initial={formFromBranding(branding, tenant.company_name, V2_DEFAULT_BRAND_COLOR)}
        metaTitle={branding.meta_title}
        readOnly={readOnly}
      />
    );
  }

  /**
   * Apply a palette to the form *and* to the running portal, so the tenant sees
   * the consequence of the tap immediately rather than imagining it.
   */
  const applyPalette = (palette: ThemePalette) => {
    setForm((prev) => ({ ...prev, ...palette }));
    previewTheme(palette);
  };

  const applyCustomColor = (hex: string) => {
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
      toast({
        title: "Couldn't save appearance",
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      return false;
    }
  };

  if (!loaded) {
    return (
      <div className="space-y-6 p-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-16">
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
          <p className="max-w-2xl text-sm text-muted-foreground">
            Choose how your portal looks for you and your team. Your customers&apos;
            booking site is styled separately under CMS.
          </p>
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
            disabled={readOnly || isUpdating || !dirty}
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
              disabled={readOnly}
              placeholder={tenant?.company_name || 'Your company'}
              onChange={(e) => setForm((p) => ({ ...p, app_name: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Appears in the browser tab and beside your logo.
            </p>
          </div>

          <LogoStudio
            logoUrl={form.logo_url}
            darkLogoUrl={form.dark_logo_url}
            onLogoChange={(url) => setForm((p) => ({ ...p, logo_url: url }))}
            onDarkLogoChange={(url) => setForm((p) => ({ ...p, dark_logo_url: url }))}
            lightSidebar={form.light_secondary_color}
            darkSidebar={form.dark_secondary_color}
            disabled={readOnly}
            deferStorageDelete={false}
          />

          <div className="space-y-2">
            <Label>Favicon</Label>
            <FaviconUpload
              currentFaviconUrl={form.favicon_url || undefined}
              onFaviconChange={(url) => setForm((p) => ({ ...p, favicon_url: url }))}
              deferStorageDelete={false}
              v2States={false}
            />
            <p className="text-xs text-muted-foreground">
              The small icon on your browser tab.
            </p>
          </div>
        </div>
      </section>

      {/* Sticky save affordance so a tenant deep in the page never loses changes.
          Its right edge stops at `--trax-offset` — the width the open Trax panel
          floats over in v2 (styles/v2-theme.css), 0px everywhere else — so Save
          and Discard stay beside the panel instead of under it. */}
      {dirty && !readOnly && (
        <div className="fixed bottom-0 left-0 right-[var(--trax-offset,0px)] z-40 border-t bg-background/95 px-4 py-3 backdrop-blur transition-[right] duration-200 ease-linear motion-reduce:transition-none supports-[backdrop-filter]:bg-background/80">
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
              <Button size="sm" onClick={handleSave} disabled={isUpdating} className="gap-1.5">
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

/* -------------------------------------------------------------------------- */
/* v2 (northwind): Branding                                                    */
/* -------------------------------------------------------------------------- */

/** The Settings index card that opens this page is called Branding, so the page is too. */
const V2_PAGE_TITLE = 'Branding';
// md:pt-[26px]: no breadcrumb or Back button, so the header starts with the 32px
// title, centred on the sidebar switch's row (50 + 26 + 16 = 92), as on every
// other v2 settings page.
const V2_PAGE_CLASS = 'w-full max-w-[1160px] space-y-8 pb-16 md:pt-[26px]';
/** Between the three sections: close enough to read as one page (was space-y-10). */
const V2_SECTIONS_CLASS = 'space-y-8';

function V2PageDescription() {
  return (
    <>
      Your portal name, brand colour and logos. Your customers&apos; booking site keeps its own
      colours in{' '}
      <Link href="/cms/site-settings" className="font-medium text-primary underline-offset-4 hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]">
        Website → Site settings
      </Link>
      .
    </>
  );
}

/**
 * A genuine change: the colours a person perceives, the name and the two logos.
 * `dark_logo_url` is not here: v2 has no control for it, and Save leaves it to
 * the logo sync in `useTenantBranding`.
 */
function appearanceFormDiffers(form: AppearanceForm, saved: AppearanceForm): boolean {
  return (
    form.primary_color !== saved.primary_color ||
    form.light_primary_color !== saved.light_primary_color ||
    form.dark_primary_color !== saved.dark_primary_color ||
    form.secondary_color !== saved.secondary_color ||
    form.accent_color !== saved.accent_color ||
    form.app_name !== saved.app_name ||
    form.logo_url !== saved.logo_url ||
    form.favicon_url !== saved.favicon_url
  );
}

/**
 * The v2 page. Mounted only once the real branding row and the permissions are
 * in, and keyed on the tenant, so its form is seeded exactly once from
 * `initial` and a tenant switch starts a fresh one. No hydrate or reset effect:
 * the pair of them is what left the page on its skeleton until a refresh.
 */
function AppearanceFormV2({
  tenantId,
  companyName,
  initial,
  metaTitle,
  readOnly,
}: {
  tenantId: string;
  companyName?: string | null;
  initial: AppearanceForm;
  /** The site title from Website settings: when set, the browser tab shows it instead of the name. */
  metaTitle?: string | null;
  readOnly: boolean;
}) {
  const { updateBranding, isUpdating } = useTenantBranding();
  // Try-on: the whole portal repaints with the chosen colour, and the sidebar
  // badge and the browser tab pick up a new logo, before anything is saved.
  // All of it goes back to what is saved on Reset, "Don't save" or leaving.
  const { preview: previewTheme, restore: restoreTheme, commit: commitTheme } = useThemePreview();

  const [form, setForm] = useState<AppearanceForm>(() => initial);
  /** What is saved. A ref, so a try-on repainting the branding cache never moves it. */
  const savedRef = useRef<AppearanceForm>(initial);
  // Re-renders once a save lands, so `dirty` is recomputed against the new baseline.
  const [, setSavedVersion] = useState(0);

  // Why the last save failed: beside Save (and in the leave dialog) until the
  // next edit, Reset, or the leave dialog closing. The toast disappears.
  const [saveError, setSaveError] = useState<unknown>(null);
  const saveInFlight = useRef(false);
  const [logosBusy, setLogosBusy] = useState(false);
  // Reset remounts the logo cards, dropping a pending "Fit into a square" or an inline error.
  const [logosVersion, setLogosVersion] = useState(0);

  const dirty = !readOnly && appearanceFormDiffers(form, savedRef.current);
  const hexInvalid = !isHexColor6(form.light_primary_color);
  /**
   * A finished colour the v2 theme cannot carry: near-black, near-white or grey
   * (`isUsableV2Brand`). It saves like any other, but the portal keeps the
   * default colour, so say so rather than leave the tenant tapping a colour
   * that changes nothing. None of the five presets land here.
   */
  const brandHsl = hexInvalid ? null : hexToHsl(form.light_primary_color);
  const brandUnusable = !!brandHsl && !isUsableV2Brand(brandHsl);

  useEffect(() => {
    setSaveError(null);
  }, [form]);

  /**
   * The palette last tried on, or null for the saved one. A logo try-on rides
   * on top of it, because each preview replaces the one before; the form's own
   * colour cannot be used there, as it may be half typed.
   */
  const triedPalette = useRef<ThemePalette | null>(null);

  /** Show `palette` (or the saved colours) and these logos on the running portal. */
  const tryOn = (palette: ThemePalette | null, logos: Pick<AppearanceForm, 'favicon_url' | 'logo_url'>) => {
    const saved = savedRef.current;
    const patch: Partial<TenantBranding> = { ...palette, favicon_url: logos.favicon_url, logo_url: logos.logo_url };
    // As the save will do (useTenantBranding): a dark-mode logo that was only
    // following the old logo follows the new one, so the sidebar shows it in
    // dark mode too. A deliberately different dark logo is left alone.
    if (logos.logo_url !== saved.logo_url && (!saved.dark_logo_url || saved.dark_logo_url === saved.logo_url)) {
      patch.dark_logo_url = null;
    }
    previewTheme(patch);
  };

  /** Put a palette in the form and on the running portal at once. */
  const applyPalette = (palette: ThemePalette) => {
    setForm((prev) => ({ ...prev, ...palette }));
    triedPalette.current = palette;
    tryOn(palette, form);
  };

  /** A new (or removed) logo: in the form, and in the sidebar and browser tab straight away. */
  const applyLogos = (patch: Partial<Pick<AppearanceForm, 'favicon_url' | 'logo_url'>>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    tryOn(triedPalette.current, { favicon_url: form.favicon_url, logo_url: form.logo_url, ...patch });
  };

  const applyBrandColor = (hex: string) => {
    if (!isHexColor6(hex)) {
      // Still being typed: keep it in the field, never preview or derive a palette from it.
      setForm((prev) => ({ ...prev, light_primary_color: hex }));
      return;
    }
    applyPalette(paletteFromBrandColor(hex));
  };

  /** Reset and "Don't save": back to what is saved. Never to the defaults. */
  const discardChanges = () => {
    restoreTheme();
    triedPalette.current = null;
    setForm(savedRef.current);
    setSaveError(null);
    setLogosVersion((v) => v + 1);
  };

  const handleSave = async (): Promise<boolean> => {
    if (readOnly) return false;
    if (!isHexColor6(form.light_primary_color)) {
      toast({
        title: 'Finish the brand colour first',
        description: `Enter a 6-character colour code such as ${V2_DEFAULT_BRAND_COLOR}, or pick a colour.`,
        variant: 'destructive',
      });
      return false;
    }
    if (logosBusy) {
      toast({
        title: 'Your logo is still uploading',
        description: 'Wait for it to finish, then save your changes.',
      });
      return false;
    }
    if (saveInFlight.current) return false;
    saveInFlight.current = true;
    setSaveError(null);
    const values = form;
    try {
      await updateBranding({
        primary_color: values.primary_color,
        secondary_color: values.secondary_color,
        accent_color: values.accent_color,
        light_primary_color: values.light_primary_color,
        light_secondary_color: values.light_secondary_color,
        light_accent_color: values.light_accent_color,
        light_background_color: values.light_background_color,
        dark_primary_color: values.dark_primary_color,
        dark_secondary_color: values.dark_secondary_color,
        dark_accent_color: values.dark_accent_color,
        dark_background_color: values.dark_background_color,
        app_name: values.app_name.trim() || null,
        // Deliberately no dark_logo_url or auth_logo_url: left out, the update
        // keeps any that were following the old logo in step with the new one
        // (and a deliberately different dark-mode logo untouched).
        logo_url: values.logo_url,
        favicon_url: values.favicon_url,
      });
      // The previewed palette is server truth now: advance both baselines, or
      // Save stays enabled and a later Reset brings the old colours back.
      savedRef.current = { ...values };
      setSavedVersion((v) => v + 1);
      triedPalette.current = null;
      commitTheme();
      toast({
        title: 'Branding saved',
        description: 'Your portal has been updated for everyone on your team.',
      });
      return true;
    } catch (error) {
      setSaveError(error ?? new Error('Save failed'));
      toast({
        title: "Couldn't save branding",
        description: describeSaveError(error),
        variant: 'destructive',
      });
      return false;
    } finally {
      saveInFlight.current = false;
    }
  };

  // Every way out with unsaved edits (links, the guarded router, Back and
  // Forward, reload) asks "Save" or "Don't save" first.
  const leave = useLeaveGuardV2({
    enabled: !readOnly,
    isDirty: dirty,
    canSave: !hexInvalid && !logosBusy,
    onSave: handleSave,
    onDiscard: discardChanges,
  });

  const leaveWasOpen = useRef(false);
  useEffect(() => {
    if (leaveWasOpen.current && !leave.open) setSaveError(null);
    leaveWasOpen.current = leave.open;
  }, [leave.open]);

  const portalNameTitleId = `${settingsSectionId('portal-name')}-title`;
  const portalName = form.app_name.trim() || companyName || 'Your portal';
  const tabTitle = portalTabTitle(portalName, metaTitle);
  // What the sign-in page tints its hero with in light mode (login-v2).
  const signInColor = form.light_accent_color || form.accent_color || form.light_primary_color || form.primary_color;

  return (
    <div className={V2_PAGE_CLASS}>
      <SettingsPageHeader title={V2_PAGE_TITLE} description={<V2PageDescription />} />
      {readOnly && <SettingsReadOnlyNotice />}

      <SettingsPageSaveProvider>
        <SettingsReadOnlyFieldset readOnly={readOnly}>
          <div className={V2_SECTIONS_CLASS}>
            <SettingsSection
              anchor="portal-name"
              title="Portal name"
              description="Shows at the top of your sidebar and in the browser tab. Up to 60 characters."
            >
              <SettingsPanel>
                <div className="space-y-3 px-5 py-4">
                  <Input
                    id="app_name"
                    aria-labelledby={portalNameTitleId}
                    value={form.app_name}
                    maxLength={60}
                    // --input carries its own alpha in v2 dark, so the field's
                    // bg-input/50 is invalid there and the box had no fill.
                    className="max-w-md dark:bg-muted"
                    // A long name scrolls inside the box; hovering shows it whole.
                    title={form.app_name || undefined}
                    placeholder={companyName || 'Your company'}
                    onChange={(e) => setForm((p) => ({ ...p, app_name: e.target.value }))}
                  />
                  <PortalNamePreview
                    name={portalName}
                    tabIconUrl={form.favicon_url}
                    sidebarIconUrl={form.favicon_url || form.logo_url}
                    tabTitle={tabTitle}
                  />
                </div>
              </SettingsPanel>
            </SettingsSection>

            <SettingsSection
              anchor="brand-colour"
              title="Brand colour"
              description="Pick a colour and your portal updates around you straight away. Nothing is saved until you press Save changes."
            >
              <SettingsPanel>
                <div className="space-y-3 px-5 py-4">
                  <BrandSwatches value={form.light_primary_color} onChange={applyBrandColor} disabled={readOnly} />
                  <BrandColorField value={form.light_primary_color} onChange={applyBrandColor} disabled={readOnly} />
                  {hexInvalid && (
                    <p role="alert" className="text-[13px] text-destructive">
                      That isn&apos;t a full colour code yet. Use # and 6 characters, like {V2_DEFAULT_BRAND_COLOR}.
                    </p>
                  )}
                  {brandUnusable && (
                    <p role="status" className="text-[13px] text-muted-foreground">
                      This colour is too close to black, white or grey to colour the portal, so the
                      portal keeps the {V2_DEFAULT_BRAND_NAME.toLowerCase()} colour.
                    </p>
                  )}
                </div>
              </SettingsPanel>
            </SettingsSection>

            <LogosV2
              key={logosVersion}
              tenantId={tenantId}
              portalName={portalName}
              tabTitle={tabTitle}
              brandColor={signInColor}
              faviconUrl={form.favicon_url}
              logoUrl={form.logo_url}
              onFaviconChange={(url) => applyLogos({ favicon_url: url })}
              onLogoChange={(url) => applyLogos({ logo_url: url })}
              disabled={readOnly}
              onBusyChange={setLogosBusy}
            />
          </div>
        </SettingsReadOnlyFieldset>
      </SettingsPageSaveProvider>

      {/* Last child: at the end of a short page, floating above the bottom of
          the window on a long one. */}
      {!readOnly && (
        <SettingsStickySaveBar
          dirty={dirty}
          saving={isUpdating || leave.saving}
          error={leave.open ? null : saveError}
          onSave={() => void handleSave()}
          onReset={discardChanges}
        />
      )}

      <LeaveDialogV2
        open={leave.open}
        canSave={leave.canSave}
        saving={leave.saving}
        onSave={() => void leave.save()}
        onDiscard={leave.discard}
        onCancel={leave.cancel}
        error={saveError ? <SettingsSaveState status="error" error={saveError} /> : null}
      />
    </div>
  );
}

/**
 * The v2 page before its data is in, section for section in the loaded order
 * (Portal name, Brand colour, Logos) and at the loaded sizes, so nothing jumps
 * when it arrives. The loading label goes last: first, it would push the header
 * down by one `space-y-8` gap.
 */
function AppearanceSkeletonV2() {
  const sectionHeading = (titleWidth: string, descriptionWidth: string) => (
    <div>
      <div className="flex h-6 items-center">
        <Skeleton className={`h-4 ${titleWidth} rounded-full`} />
      </div>
      <div className="mt-0.5 flex h-5 items-center">
        <Skeleton className={`h-3.5 ${descriptionWidth} max-w-full rounded-full`} />
      </div>
    </div>
  );
  // A logo card: title, a line of description, the preview, the help line and Upload.
  const logoCard = (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div>
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-24 rounded-full" />
        </div>
        <div className="mt-0.5 flex h-5 items-center">
          <Skeleton className="h-3 w-4/5 rounded-full" />
        </div>
      </div>
      <Skeleton className={`${LOGO_PREVIEW_HEIGHT} w-full rounded-xl`} />
      <div className="flex h-4 items-center">
        <Skeleton className="h-3 w-3/4 rounded-full" />
      </div>
      <Skeleton className="h-8 w-24 rounded-full" />
    </div>
  );

  return (
    <div role="status" aria-busy="true" className={V2_PAGE_CLASS}>
      {/* SettingsPageHeader's boxes: the 32px title, then a description that
          runs to two lines inside its max-w-2xl. */}
      <div aria-hidden="true" className="space-y-1.5">
        <div className="flex h-8 items-center">
          <Skeleton className="h-6 w-36 rounded-full" />
        </div>
        <div className="max-w-2xl">
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-full rounded-full" />
          </div>
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-1/3 rounded-full" />
          </div>
        </div>
      </div>
      <div aria-hidden="true" className={V2_SECTIONS_CLASS}>
        <div className="space-y-3">
          {sectionHeading('w-28', 'w-96')}
          <div className="space-y-3 rounded-xl border bg-card px-5 py-4">
            <Skeleton className="h-9 w-full max-w-md rounded-3xl" />
            {/* The sidebar row and the browser tab: the 44px row, 6px padding
                a side and a 1px border a side make 58px tall; the 256px
                sidebar plus that border makes 258px wide. */}
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-[58px] w-[258px] max-w-full rounded-xl" />
              <Skeleton className="h-[58px] w-[258px] max-w-full rounded-xl" />
            </div>
          </div>
        </div>
        <div className="space-y-3">
          {sectionHeading('w-28', 'w-[36rem]')}
          <div className="rounded-xl border bg-card px-5 py-4">
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
              {/* The five colours and Custom. */}
              {[...V2_BRAND_PRESETS.map((preset) => preset.id), 'custom'].map((id) => (
                <div key={id} className="flex w-16 flex-col items-center gap-2 py-2">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex h-4 items-center">
                    <Skeleton className="h-3 w-10 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-3">
          {sectionHeading('w-16', 'w-[34rem]')}
          {/* The "Best results" line. */}
          <Skeleton className="h-10 w-full rounded-xl" />
          <div className="grid gap-4 lg:grid-cols-2">
            {logoCard}
            {logoCard}
          </div>
        </div>
      </div>
      <span className="sr-only">Loading branding</span>
    </div>
  );
}
