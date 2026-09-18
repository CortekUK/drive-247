'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LIMITS, type AnnouncementDraft, type AnnouncementSlide, type DraftErrors } from '@/lib/announcements/contract';
import { NO_MISSING_IMAGES, missingImageNote, type MissingImages } from '@/lib/announcements/row-actions';
import { cn } from '@/lib/utils';
import { FormField, FormSection, HIDDEN_SCROLLBAR, QUIET_BUTTON } from './form-field';
import {
  appendSlide,
  moveSlideByKey,
  newSlideKey,
  patchSlideByKey,
  removeSlideByKey,
  type KeyedSlides,
} from './form-logic';
import { ImageUploadField } from './image-upload-field';
import type { FeaturePreviewView } from './preview/announcement-preview';

/** The dashboard card (title, one line, illustration) and its dialog slides (add or remove freely, 1-10). */
export function FeatureFields({
  draft,
  slideKeys,
  errors,
  onChange,
  onSlidesChange,
  onUploaded,
  onBusyChange,
  onPreview,
  missingImages = NO_MISSING_IMAGES,
}: {
  draft: AnnouncementDraft;
  /** One stable client key per slide, same order as draft.slides. */
  slideKeys: readonly string[];
  errors: DraftErrors;
  onChange: (patch: Partial<AnnouncementDraft>) => void;
  /** Slide changes, applied to the latest slides (an upload can resolve after later edits). */
  onSlidesChange: (fn: (current: KeyedSlides) => KeyedSlides) => void;
  onUploaded: (url: string) => void;
  onBusyChange: (busy: boolean) => void;
  /** Point the live preview at what is being edited. */
  onPreview: (view: FeaturePreviewView, slide: number) => void;
  /** A duplicate's images whose copy failed and that are still empty: each gets its note under its own field. */
  missingImages?: MissingImages;
}) {
  const slides = draft.slides;

  // By key, never by index: a slide image upload holds on to its slide's key
  // while the admin keeps typing, adding, moving or removing slides.
  const moveSlide = (key: string, index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= slides.length) return;
    onSlidesChange((current) => moveSlideByKey(current, key, delta));
    onPreview('dialog', to);
  };

  const removeSlide = (key: string, index: number) => {
    if (slides.length <= LIMITS.slidesMin) return;
    onSlidesChange((current) => removeSlideByKey(current, key));
    onPreview('dialog', Math.max(0, index - 1));
  };

  const addSlide = () => {
    if (slides.length >= LIMITS.slidesMax) return;
    const key = newSlideKey();
    onSlidesChange((current) => appendSlide(current, key));
    onPreview('dialog', slides.length);
  };

  return (
    <>
      <FormSection title="Dashboard card" description="The card on the dashboard's “On your desk” row.">
        <FormField
          label="Title"
          htmlFor="ann-title"
          required
          counter={{ value: draft.title, max: LIMITS.featureTitle }}
          error={errors.title}
        >
          <Input
            id="ann-title"
            value={draft.title}
            onChange={(e) => onChange({ title: e.target.value })}
            onFocus={() => onPreview('card', 0)}
            placeholder="Expense Tracker"
            aria-invalid={!!errors.title}
          />
        </FormField>
        <FormField
          label="One-line description"
          htmlFor="ann-summary"
          required
          counter={{ value: draft.summary, max: LIMITS.featureSummary }}
          help="Shown under the heading on the dashboard card."
          error={errors.summary}
        >
          <Input
            id="ann-summary"
            value={draft.summary}
            onChange={(e) => onChange({ summary: e.target.value })}
            onFocus={() => onPreview('card', 0)}
            placeholder="Log every cost against the car it belongs to."
            aria-invalid={!!errors.summary}
          />
        </FormField>
        <FormField label="Card illustration" htmlFor="ann-image" required>
          <ImageUploadField
            id="ann-image"
            label="card illustration"
            slot="card"
            value={draft.image_url}
            onChange={(url) => {
              onChange({ image_url: url });
              onPreview('card', 0);
            }}
            onUploaded={onUploaded}
            onBusyChange={onBusyChange}
            error={errors.image_url}
            notice={missingImages.card ? missingImageNote({ kind: 'card' }) : null}
          />
        </FormField>
      </FormSection>

      <FormSection
        title={'Slides (' + slides.length + ')'}
        description={
          'Opening the card shows these in a large dialog. Add or remove slides as you need, up to ' +
          LIMITS.slidesMax + '. Newlines in the text are kept.'
        }
      >
        {slides.map((slide, index) => {
          const atMinimum = slides.length <= LIMITS.slidesMin;
          const e = errors.slideErrors?.[index] ?? null;
          const base = 'ann-slide-' + index;
          const key = slideKeys[index] ?? 'slide-at-' + index;
          const setSlide = (patch: Partial<AnnouncementSlide>) =>
            onSlidesChange((current) => patchSlideByKey(current, key, patch));
          return (
            <div key={key} className="space-y-4 rounded-2xl border border-border p-4" onFocus={() => onPreview('dialog', index)}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">Slide {index + 1}</p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn('h-8 w-8', QUIET_BUTTON)}
                    aria-label={'Move slide ' + (index + 1) + ' up'}
                    disabled={index === 0}
                    onClick={() => moveSlide(key, index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn('h-8 w-8', QUIET_BUTTON)}
                    aria-label={'Move slide ' + (index + 1) + ' down'}
                    disabled={index === slides.length - 1}
                    onClick={() => moveSlide(key, index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  {/* aria-disabled, not disabled: a disabled button gets no hover or
                      focus, so its tooltip could never say WHY it does nothing
                      (user, Sep 17 2026: "why am I unable to delete them"). */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(
                          'h-8 w-8',
                          QUIET_BUTTON,
                          atMinimum && 'cursor-not-allowed opacity-40 hover:bg-transparent dark:hover:bg-transparent',
                        )}
                        aria-label={'Remove slide ' + (index + 1)}
                        aria-disabled={atMinimum || undefined}
                        onClick={() => removeSlide(key, index)}
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-xs">
                      {atMinimum
                        ? 'The dialog needs at least one slide. Add another slide first, then remove this one.'
                        : 'Remove slide ' + (index + 1)}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <FormField
                label="Heading"
                htmlFor={base + '-heading'}
                required
                counter={{ value: slide.heading, max: LIMITS.slideHeading }}
                error={e?.heading}
              >
                <Input
                  id={base + '-heading'}
                  value={slide.heading}
                  onChange={(ev) => setSlide({ heading: ev.target.value })}
                  aria-invalid={!!e?.heading}
                />
              </FormField>
              <FormField
                label="Text"
                htmlFor={base + '-body'}
                required
                counter={{ value: slide.body, max: LIMITS.slideBody }}
                error={e?.body}
              >
                <Textarea
                  id={base + '-body'}
                  rows={4}
                  className={cn('[field-sizing:content]', HIDDEN_SCROLLBAR)}
                  value={slide.body}
                  onChange={(ev) => setSlide({ body: ev.target.value })}
                  aria-invalid={!!e?.body}
                />
              </FormField>
              <FormField label="Image (optional)" htmlFor={base + '-image'}>
                <ImageUploadField
                  id={base + '-image'}
                  label={'slide ' + (index + 1) + ' image'}
                  slot="slide"
                  value={slide.image_url}
                  onChange={(url) => setSlide({ image_url: url })}
                  onUploaded={onUploaded}
                  onBusyChange={onBusyChange}
                  error={e?.image_url}
                  notice={missingImages.slideKeys.indexOf(key) !== -1 ? missingImageNote({ kind: 'slide', index }) : null}
                />
              </FormField>
            </div>
          );
        })}
        {errors.slides && (
          <p id="ann-slides-error" role="alert" className="text-xs font-medium leading-5 text-destructive">
            {errors.slides}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={QUIET_BUTTON}
            onClick={addSlide}
            disabled={slides.length >= LIMITS.slidesMax}
          >
            <Plus />
            Add slide
          </Button>
          {slides.length >= LIMITS.slidesMax && (
            <p className="text-xs leading-5 text-muted-foreground">
              {LIMITS.slidesMax} slides is the most one dialog shows. Remove one to add another.
            </p>
          )}
        </div>
      </FormSection>
    </>
  );
}
