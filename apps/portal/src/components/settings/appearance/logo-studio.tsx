'use client';

/**
 * Logo studio — upload, diagnose, repair, or generate.
 *
 * The old flow was a bare upload box and a second "dark logo" box nobody
 * understood. Three things go wrong in practice and each is handled here:
 *
 *   · A dark logo vanishes against a dark sidebar (and the reverse).
 *   · A JPG arrives welded into a white rectangle.
 *   · The tenant has no logo file at all and the sidebar looks unfinished.
 *
 * Every repair is previewed and accepted explicitly — nothing is silently
 * rewritten, because a logo is the one asset an owner is precious about.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Scissors, Sparkles, Wand2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogoUploadWithResize } from '@/components/settings/logo-upload-with-resize';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';
import {
  analyzeLogo,
  recolorLogo,
  removeLogoBackdrop,
  uploadLogoBlob,
  type LogoAnalysis,
} from '@/lib/appearance/logo';
import {
  MONOGRAM_STYLES,
  buildMonogramSvg,
  monogramToPng,
  type MonogramStyleId,
} from '@/lib/appearance/monogram';
import { readableForegroundOn } from '@/lib/appearance/color';
import { cn } from '@/lib/utils';

interface LogoStudioProps {
  logoUrl: string | null;
  darkLogoUrl: string | null;
  onLogoChange: (url: string | null) => void;
  onDarkLogoChange: (url: string | null) => void;
  /** Brand colour, used to tint generated marks. */
  brandColor: string;
  /** Sidebar colours the logo will actually sit on, for the honest preview. */
  lightSidebar: string;
  darkSidebar: string;
  companyName: string;
  disabled?: boolean;
}

export function LogoStudio({
  logoUrl,
  darkLogoUrl,
  onLogoChange,
  onDarkLogoChange,
  brandColor,
  lightSidebar,
  darkSidebar,
  companyName,
  disabled,
}: LogoStudioProps) {
  const { tenant } = useTenant();
  const [analysis, setAnalysis] = useState<LogoAnalysis | null>(null);
  const [busy, setBusy] = useState<null | 'backdrop' | 'dark' | 'generate'>(null);

  // Re-diagnose whenever the logo changes.
  useEffect(() => {
    let cancelled = false;
    if (!logoUrl) {
      setAnalysis(null);
      return;
    }
    analyzeLogo(logoUrl).then((result) => {
      if (!cancelled) setAnalysis(result);
    });
    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  const run = useCallback(
    async (kind: 'backdrop' | 'dark', work: () => Promise<Blob | null>, suffix: string) => {
      if (!tenant?.id) return;
      setBusy(kind);
      try {
        const blob = await work();
        if (!blob) {
          toast({
            title: "Couldn't process this logo",
            description:
              'The image may be hosted somewhere we cannot read pixels from. Try re-uploading the file.',
            variant: 'destructive',
          });
          return;
        }
        const url = await uploadLogoBlob(blob, tenant.id, suffix);
        if (kind === 'backdrop') {
          onLogoChange(url);
          toast({ title: 'Background removed', description: 'Your logo now has a transparent background.' });
        } else {
          onDarkLogoChange(url);
          toast({ title: 'Dark-mode logo created', description: 'A light version has been set for dark mode.' });
        }
      } catch (error) {
        toast({
          title: 'Something went wrong',
          description: error instanceof Error ? error.message : 'Please try again.',
          variant: 'destructive',
        });
      } finally {
        setBusy(null);
      }
    },
    [tenant?.id, onLogoChange, onDarkLogoChange]
  );

  /** Warnings a tenant can actually act on — never vague. */
  const warnings = useMemo(() => {
    if (!analysis) return [];
    const out: { id: string; text: string; action?: React.ReactNode }[] = [];

    if (analysis.hasSolidBackdrop) {
      out.push({
        id: 'backdrop',
        text: `Your logo has a solid ${analysis.backdropColor ?? 'coloured'} box around it, which will show as a rectangle on your sidebar.`,
        action: (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || busy !== null}
            className="h-7 gap-1.5 text-xs"
            onClick={() => run('backdrop', () => removeLogoBackdrop(logoUrl!), 'logo-clean')}
          >
            {busy === 'backdrop' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Scissors className="h-3 w-3" />
            )}
            Remove the box
          </Button>
        ),
      });
    }

    if (analysis.isDarkInk && !darkLogoUrl) {
      out.push({
        id: 'dark',
        text: 'This logo is dark, so it will be hard to see when your team uses dark mode.',
        action: (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || busy !== null}
            className="h-7 gap-1.5 text-xs"
            onClick={() => run('dark', () => recolorLogo(logoUrl!, '#FFFFFF'), 'logo-dark-mode')}
          >
            {busy === 'dark' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Wand2 className="h-3 w-3" />
            )}
            Create a light version
          </Button>
        ),
      });
    }

    if (analysis.isLightInk && analysis.hasTransparency) {
      out.push({
        id: 'light',
        text: 'This logo is very light. It may be hard to read on white backgrounds such as printed agreements.',
      });
    }

    return out;
  }, [analysis, darkLogoUrl, logoUrl, busy, disabled, run]);

  return (
    <Tabs defaultValue={logoUrl ? 'upload' : 'generate'} className="space-y-4">
      <TabsList>
        <TabsTrigger value="upload">Upload a logo</TabsTrigger>
        <TabsTrigger value="generate" className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          Create one
        </TabsTrigger>
      </TabsList>

      {/* ---------------- Upload ---------------- */}
      <TabsContent value="upload" className="space-y-5">
        <LogoUploadWithResize
          currentLogoUrl={logoUrl || undefined}
          onLogoChange={onLogoChange}
          label="Logo"
          description="PNG with a transparent background works best. We'll tell you if something's off."
        />

        {logoUrl && (
          <>
            {/* Honest side-by-side: the two backgrounds it will actually sit on */}
            <div className="space-y-2">
              <Label className="text-xs">How it looks on your sidebar</Label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Light mode', bg: lightSidebar, src: logoUrl },
                  { label: 'Dark mode', bg: darkSidebar, src: darkLogoUrl || logoUrl },
                ].map((panel) => (
                  <div key={panel.label} className="space-y-1.5">
                    <div
                      className="flex h-20 items-center justify-center rounded-md border p-3"
                      style={{ background: panel.bg }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={panel.src}
                        alt={`Logo on ${panel.label}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    <p className="text-center text-[11px] text-muted-foreground">
                      {panel.label}
                      {panel.label === 'Dark mode' && darkLogoUrl && ' · using your light version'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {warnings.map((warning) => (
              <div
                key={warning.id}
                className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1 space-y-2">
                  <p className="leading-snug">{warning.text}</p>
                  {warning.action}
                </div>
              </div>
            ))}

            {analysis && warnings.length === 0 && (
              <div className="flex items-start gap-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-xs text-emerald-700 dark:text-emerald-400">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p className="leading-snug">
                  This logo will look good in both light and dark mode.
                </p>
              </div>
            )}

            {darkLogoUrl && (
              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  A separate dark-mode logo is set.
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  className="h-7 text-xs"
                  onClick={() => onDarkLogoChange(null)}
                >
                  Remove it
                </Button>
              </div>
            )}
          </>
        )}
      </TabsContent>

      {/* ---------------- Generate ---------------- */}
      <TabsContent value="generate">
        <MonogramPicker
          companyName={companyName}
          brandColor={brandColor}
          disabled={disabled || busy !== null}
          generating={busy === 'generate'}
          onPick={async (styleId) => {
            if (!tenant?.id) return;
            setBusy('generate');
            try {
              const svg = buildMonogramSvg({
                style: styleId,
                name: companyName,
                color: brandColor,
                onColor: readableForegroundOn(brandColor),
              });
              const png = await monogramToPng(svg);
              if (!png) throw new Error('Could not render the mark.');
              const url = await uploadLogoBlob(png, tenant.id, `monogram-${styleId}`);
              onLogoChange(url);
              toast({
                title: 'Logo created',
                description: 'You can change it any time, or upload your own later.',
              });
            } catch (error) {
              toast({
                title: "Couldn't create that logo",
                description: error instanceof Error ? error.message : 'Please try again.',
                variant: 'destructive',
              });
            } finally {
              setBusy(null);
            }
          }}
        />
      </TabsContent>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ */

function MonogramPicker({
  companyName,
  brandColor,
  disabled,
  generating,
  onPick,
}: {
  companyName: string;
  brandColor: string;
  disabled?: boolean;
  generating?: boolean;
  onPick: (style: MonogramStyleId) => void;
}) {
  const name = companyName.trim();

  if (!name) {
    return (
      <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
        Add your portal name above and we&apos;ll draw some options from it.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Built from your business name in your brand colour. Pick one to use it as
        your logo — you can always upload your own instead.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {MONOGRAM_STYLES.map((style) => {
          const svg = buildMonogramSvg({
            style: style.id,
            name,
            color: brandColor,
            onColor: readableForegroundOn(brandColor),
          });
          return (
            <button
              key={style.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(style.id)}
              className={cn(
                'group flex flex-col items-center gap-2 rounded-lg border bg-card p-3 transition-all',
                'hover:border-primary/60 hover:shadow-sm focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                disabled && 'pointer-events-none opacity-60'
              )}
            >
              <div
                className="flex h-16 w-full items-center justify-center overflow-hidden"
                dangerouslySetInnerHTML={{
                  __html: svg.replace(
                    /<svg /,
                    '<svg style="max-height:100%;max-width:100%;height:auto;width:auto" '
                  ),
                }}
              />
              <span className="text-xs text-muted-foreground group-hover:text-foreground">
                {generating ? '…' : style.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
