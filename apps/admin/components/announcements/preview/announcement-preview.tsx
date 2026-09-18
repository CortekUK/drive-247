'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { resolveInPortalCta, type AnnouncementDraft } from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';
import { HIDDEN_SCROLLBAR } from '../form-field';
import { SegmentedControl } from '../segmented-control';
import { DeskBandPreview, FeatureCardPreview } from './feature-card-preview';
import { FeatureDialogPreview } from './feature-dialog-preview';
import { PreviewStage, type PreviewDevice } from './preview-stage';
import { SystemBannerPreview } from './system-banner-preview';
import { SystemDialogPreview } from './system-dialog-preview';

export type FeaturePreviewView = 'card' | 'dialog';

/** Lets the form steer the preview to what is being edited (e.g. slide 2 opens the dialog on slide 2). */
export interface PreviewFocus {
  view: FeaturePreviewView;
  slide: number;
  /** Bumped on every request so the same target can be requested twice. */
  seq: number;
}

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const DEVICE_OPTIONS = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'phone', label: 'Phone' },
] as const;

const VIEW_OPTIONS = [
  { value: 'card', label: 'Card' },
  { value: 'dialog', label: 'Dialog' },
] as const;

/**
 * Live preview of the draft as a tenant's portal shows it: the feature card on
 * the dashboard desk band or its slides dialog, or the system banner / dialog.
 * Everything inside the canvas is built from the contract's class maps.
 */
export function AnnouncementPreview({
  draft,
  otherActiveFeatures,
  focus,
}: {
  draft: AnnouncementDraft;
  /** Active features other than this one; the deck shows dots when there would be more than one card. */
  otherActiveFeatures: number;
  focus: PreviewFocus | null;
}) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [view, setView] = useState<FeaturePreviewView>('card');
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (!focus) return;
    setView(focus.view);
    setSlide(focus.slide);
  }, [focus]);

  const isFeature = draft.kind === 'feature';
  const ctaVisible = resolveInPortalCta(draft.cta_url.trim()) !== null;
  const slideIndex = Math.min(slide, Math.max(0, draft.slides.length - 1));

  let canvas: ReactNode;
  if (isFeature) {
    const card = (
      <FeatureCardPreview
        title={draft.title}
        summary={draft.summary}
        imageUrl={draft.image_url}
        cardCount={otherActiveFeatures + 1}
        onOpen={() => {
          setView('dialog');
          setSlide(0);
        }}
      />
    );
    canvas = (
      <PortalFrame device={device}>
        <DeskBandPreview>{card}</DeskBandPreview>
        {view === 'dialog' && (
          <FeatureDialogPreview
            title={draft.title}
            slides={draft.slides}
            index={slideIndex}
            onIndexChange={setSlide}
            ctaLabel={draft.cta_label}
            ctaVisible={ctaVisible}
            showDontShowAgain={draft.repeat_after_days !== null}
          />
        )}
      </PortalFrame>
    );
  } else if (draft.display === 'banner') {
    canvas = (
      <PortalFrame
        device={device}
        banner={
          <SystemBannerPreview
            tone={draft.tone}
            blocking={draft.blocking}
            title={draft.title}
            body={draft.body}
            ctaLabel={draft.cta_label}
            ctaVisible={ctaVisible}
          />
        }
      >
        <PageStandIn />
      </PortalFrame>
    );
  } else {
    canvas = (
      <PortalFrame device={device}>
        <PageStandIn />
        <SystemDialogPreview
          tone={draft.tone}
          blocking={draft.blocking}
          title={draft.title}
          body={draft.body}
          ctaLabel={draft.cta_label}
          ctaVisible={ctaVisible}
        />
      </PortalFrame>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl size="sm" ariaLabel="Preview theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
        <SegmentedControl size="sm" ariaLabel="Preview size" options={DEVICE_OPTIONS} value={device} onChange={setDevice} />
        {isFeature && (
          <SegmentedControl
            size="sm"
            ariaLabel="Preview surface"
            options={VIEW_OPTIONS}
            value={view}
            onChange={(v) => {
              setView(v);
              if (v === 'dialog') setSlide(0);
            }}
          />
        )}
      </div>
      <PreviewStage device={device} dark={theme === 'dark'} title="Portal preview">
        {canvas}
      </PreviewStage>
      <div className="space-y-1 text-xs leading-5 text-muted-foreground">
        <p>Preview of the portal. Classic (v1) portals show system messages the same way, in their own font.</p>
        {isFeature && view === 'dialog' && draft.repeat_after_days !== null && (
          <p>&ldquo;Don&apos;t show again&rdquo; is shown only when the dialog opens by itself.</p>
        )}
        {isFeature && view === 'card' && <p>Click the card to open its dialog.</p>}
      </div>
    </div>
  );
}

/**
 * A stand-in portal page: full-width banner slot, a 256px sidebar column
 * (desktop only), a 64px top bar and a padded content area (976px wide on
 * desktop, 312px on a phone, as in the portal).
 */
function PortalFrame({ device, banner, children }: { device: PreviewDevice; banner?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-50 text-foreground dark:bg-neutral-950">
      {banner}
      <div className="flex min-h-0 flex-1">
        {device === 'desktop' && (
          <aside
            aria-hidden
            className="flex w-64 shrink-0 flex-col gap-3 border-r border-neutral-200 bg-white px-5 py-5 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="mb-3 h-7 w-28 rounded-lg bg-neutral-200 dark:bg-neutral-700" />
            {[70, 58, 64, 48, 60, 54, 44].map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-4 w-4 rounded bg-neutral-200 dark:bg-neutral-700" />
                <div className="h-2.5 rounded-full bg-neutral-100 dark:bg-neutral-800" style={{ width: w + '%' }} />
              </div>
            ))}
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            aria-hidden
            className="flex h-16 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-6 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="h-9 max-w-[320px] flex-1 rounded-full bg-neutral-100 dark:bg-neutral-800" />
            <div className="ml-auto h-8 w-8 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          </div>
          {/* The preview sits inside the editor dialog, which shows no scrollbars. */}
          <main className={cn('min-h-0 flex-1 overflow-y-auto p-6', HIDDEN_SCROLLBAR)}>{children}</main>
        </div>
      </div>
    </div>
  );
}

/** Grey page content behind a system banner or dialog. */
function PageStandIn() {
  return (
    <div aria-hidden className="space-y-5">
      <div className="h-7 w-48 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
        ))}
      </div>
      <div className="h-64 rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
    </div>
  );
}
