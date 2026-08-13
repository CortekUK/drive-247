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

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, RotateCcw, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
} from '@/components/ui/alert-dialog';

import { LogoUploadWithResize } from '@/components/settings/logo-upload-with-resize';
import { FaviconUpload } from '@/components/settings/favicon-upload';
import { ThemePresetGrid } from '@/components/settings/appearance/theme-preset-grid';
import { PortalPreview } from '@/components/settings/appearance/portal-preview';
import { BrandColorField } from '@/components/settings/appearance/brand-color-field';

import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { useTenant } from '@/contexts/TenantContext';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { toast } from '@/hooks/use-toast';
import {
  DEFAULT_PRESET_ID,
  getPreset,
  matchPreset,
  type ThemePalette,
  type ThemePreset,
} from '@/lib/appearance/presets';
import { readableForegroundOn, shade } from '@/lib/appearance/color';

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

const EMPTY_FORM: AppearanceForm = {
  ...paletteFromBrandColor('#C6A256'),
  app_name: '',
  logo_url: null,
  dark_logo_url: null,
  favicon_url: null,
};

export default function AppearanceSettingsPage() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { branding, updateBranding, isUpdating } = useTenantBranding();
  const { canEditSettings, isLoading: permissionsLoading } = useManagerPermissions();

  const readOnly = !permissionsLoading && !canEditSettings('branding');

  const [form, setForm] = useState<AppearanceForm>(EMPTY_FORM);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  /** Preset currently hovered in the grid — previewed but not committed. */
  const [peeked, setPeeked] = useState<ThemePreset | null>(null);

  // Hydrate once branding arrives. Re-runs if the tenant is switched.
  useEffect(() => {
    if (!branding) return;
    const base = paletteFromBrandColor(branding.primary_color || '#C6A256');
    setForm({
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
      app_name: branding.app_name || tenant?.company_name || '',
      logo_url: branding.logo_url,
      dark_logo_url: branding.dark_logo_url,
      favicon_url: branding.favicon_url,
    });
    setLoaded(true);
  }, [branding, tenant?.company_name]);

  const activePresetId = useMemo(() => matchPreset(form)?.id ?? null, [form]);

  /** What the preview paints: the hovered preset if any, otherwise the form. */
  const previewPalette: ThemePalette = peeked?.palette ?? form;
  const preview =
    mode === 'dark'
      ? {
          primary: previewPalette.dark_primary_color,
          secondary: previewPalette.dark_secondary_color,
          accent: previewPalette.dark_accent_color,
          background: previewPalette.dark_background_color,
        }
      : {
          primary: previewPalette.light_primary_color,
          secondary: previewPalette.light_secondary_color,
          accent: previewPalette.light_accent_color,
          background: previewPalette.light_background_color,
        };

  const dirty = useMemo(() => {
    if (!branding || !loaded) return false;
    return (
      form.primary_color !== (branding.primary_color || '') ||
      form.light_primary_color !== (branding.light_primary_color || '') ||
      form.dark_primary_color !== (branding.dark_primary_color || '') ||
      form.secondary_color !== (branding.secondary_color || '') ||
      form.accent_color !== (branding.accent_color || '') ||
      form.app_name !== (branding.app_name || tenant?.company_name || '') ||
      form.logo_url !== branding.logo_url ||
      form.dark_logo_url !== branding.dark_logo_url ||
      form.favicon_url !== branding.favicon_url
    );
  }, [form, branding, loaded, tenant?.company_name]);

  const applyPreset = (preset: ThemePreset) => {
    setForm((prev) => ({ ...prev, ...preset.palette }));
  };

  const applyCustomColor = (hex: string) => {
    setForm((prev) => ({ ...prev, ...paletteFromBrandColor(hex) }));
  };

  const resetToDefault = () => {
    const preset = getPreset(DEFAULT_PRESET_ID);
    if (preset) applyPreset(preset);
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
      toast({
        title: 'Appearance saved',
        description: 'Your portal has been updated for everyone on your team.',
      });
    } catch (error) {
      toast({
        title: "Couldn't save appearance",
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
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

      {/* Theme + live preview */}
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-medium">Theme</h2>
            <p className="text-sm text-muted-foreground">
              Pick a ready-made look. Hover to try one before you choose.
            </p>
          </div>
          <ThemePresetGrid
            selectedId={activePresetId}
            onSelect={applyPreset}
            onPeek={setPeeked}
            mode={mode}
            disabled={readOnly}
          />
        </div>

        {/* Preview column sticks so it stays visible while scrolling the options */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Preview</span>
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'light' | 'dark')}>
              <TabsList className="h-7">
                <TabsTrigger value="light" className="h-5 px-2 text-xs">
                  Light
                </TabsTrigger>
                <TabsTrigger value="dark" className="h-5 px-2 text-xs">
                  Dark
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <PortalPreview
            primary={preview.primary}
            secondary={preview.secondary}
            accent={preview.accent}
            background={preview.background}
            mode={mode}
          />
          <p className="text-xs text-muted-foreground">
            {peeked
              ? `Previewing ${peeked.name} — click the card to keep it.`
              : 'This is roughly how your portal will look.'}
          </p>
        </div>
      </section>

      <Separator />

      {/* Custom colour */}
      <section className="grid gap-8 lg:grid-cols-[304px_minmax(0,1fr)]">
        <div>
          <h2 className="text-base font-medium">Custom colour</h2>
          <p className="text-sm text-muted-foreground">
            Prefer your own? Set your brand colour and we&apos;ll build the rest of
            the theme around it.
          </p>
        </div>
        <div className="max-w-md">
          <BrandColorField
            value={form.light_primary_color}
            onChange={applyCustomColor}
            logoUrl={form.logo_url}
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

          <LogoUploadWithResize
            currentLogoUrl={form.logo_url || undefined}
            onLogoChange={(url) => setForm((p) => ({ ...p, logo_url: url }))}
            label="Logo"
            description="Used across the portal. A wide wordmark works best."
          />

          <LogoUploadWithResize
            currentLogoUrl={form.dark_logo_url || undefined}
            onLogoChange={(url) => setForm((p) => ({ ...p, dark_logo_url: url }))}
            label="Logo for dark mode"
            description="Optional. Upload a lighter version if your main logo is dark and disappears against a dark sidebar."
          />

          <div className="space-y-2">
            <Label>Favicon</Label>
            <FaviconUpload
              currentFaviconUrl={form.favicon_url || undefined}
              onFaviconChange={(url) => setForm((p) => ({ ...p, favicon_url: url }))}
            />
            <p className="text-xs text-muted-foreground">
              The small icon on your browser tab.
            </p>
          </div>
        </div>
      </section>

      {/* Sticky save affordance so a tenant deep in the page never loses changes */}
      {dirty && !readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">
              You have unsaved changes.
            </span>
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
      )}
    </div>
  );
}
