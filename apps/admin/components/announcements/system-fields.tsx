'use client';

import { useRef, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  ANNOUNCEMENT_TONES,
  BLOCKING_LABEL,
  DISPLAY_LABEL,
  LIMITS,
  TONE_CLASSES,
  TONE_META,
  type AnnouncementDraft,
  type Blocking,
  type DraftErrors,
  type SystemDisplay,
} from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';
import { FormField, FormSection, HIDDEN_SCROLLBAR } from './form-field';
import { radioKeyTarget, radioTabStop } from './form-logic';
import { SegmentedControl } from './segmented-control';
import { ToneIcon } from './tone-icon';

const DISPLAY_OPTIONS: ReadonlyArray<{ value: SystemDisplay; label: string }> = [
  { value: 'dialog', label: DISPLAY_LABEL.dialog },
  { value: 'banner', label: DISPLAY_LABEL.banner },
];

const BLOCKING_OPTIONS: ReadonlyArray<{ value: Blocking; label: string }> = [
  { value: 'soft', label: BLOCKING_LABEL.soft },
  { value: 'hard', label: BLOCKING_LABEL.hard },
];

function behaviourHelp(display: SystemDisplay, blocking: Blocking): string {
  if (display === 'dialog') {
    return blocking === 'soft'
      ? 'Can be closed.'
      : "Blocks the portal until you deactivate it or the tenant leaves the smart filter. Users can still sign out and open Subscription, Credits, Settings and this button's page.";
  }
  return blocking === 'soft' ? 'Can be dismissed.' : 'Cannot be dismissed.';
}

/** A system message: title, plain-text message, dialog or banner, soft or hard, and its colour. */
export function SystemFields({
  draft,
  errors,
  onChange,
}: {
  draft: AnnouncementDraft;
  errors: DraftErrors;
  onChange: (patch: Partial<AnnouncementDraft>) => void;
}) {
  const bodyMax = draft.display === 'banner' ? LIMITS.systemBodyBanner : LIMITS.systemBodyDialog;
  const toneRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const toneTabStop = radioTabStop(ANNOUNCEMENT_TONES.indexOf(draft.tone), ANNOUNCEMENT_TONES.length, () => false);

  const onToneKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = radioKeyTarget(e.key, index, ANNOUNCEMENT_TONES.length, () => false);
    if (next === null) return;
    e.preventDefault();
    toneRefs.current[next]?.focus();
    onChange({ tone: ANNOUNCEMENT_TONES[next] });
  };

  return (
    <>
      <FormSection title="Message">
        <FormField
          label="Title"
          htmlFor="ann-title"
          required
          counter={{ value: draft.title, max: LIMITS.systemTitle }}
          error={errors.title}
        >
          <Input
            id="ann-title"
            value={draft.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Scheduled maintenance on Sunday"
            aria-invalid={!!errors.title}
          />
        </FormField>
        <FormField
          label="Message"
          htmlFor="ann-body"
          required
          counter={{ value: draft.body, max: bodyMax }}
          help={draft.display === 'banner' ? 'Plain text. A banner shows it on one line where it fits.' : 'Plain text. Newlines are kept.'}
          error={errors.body}
        >
          <Textarea
            id="ann-body"
            rows={draft.display === 'banner' ? 3 : 5}
            className={cn('[field-sizing:content]', HIDDEN_SCROLLBAR)}
            value={draft.body}
            onChange={(e) => onChange({ body: e.target.value })}
            aria-invalid={!!errors.body}
          />
        </FormField>
      </FormSection>

      <FormSection title="How it shows">
        <FormField label="Show as" htmlFor="ann-display" error={errors.display}>
          <div>
            <SegmentedControl
              id="ann-display"
              ariaLabel="Show as"
              options={DISPLAY_OPTIONS}
              value={draft.display}
              onChange={(display) => onChange({ display })}
            />
          </div>
        </FormField>
        <FormField label="Behaviour" htmlFor="ann-blocking" help={behaviourHelp(draft.display, draft.blocking)} error={errors.blocking}>
          <div>
            <SegmentedControl
              id="ann-blocking"
              ariaLabel="Behaviour"
              options={BLOCKING_OPTIONS}
              value={draft.blocking}
              onChange={(blocking) => onChange({ blocking })}
            />
          </div>
        </FormField>
        {errors.blocking && (
          <p className="-mt-2 text-xs leading-5 text-muted-foreground">{behaviourHelp(draft.display, draft.blocking)}</p>
        )}
        <FormField label="Colour" htmlFor="ann-tone" error={errors.tone}>
          <div id="ann-tone" role="radiogroup" aria-label="Colour" tabIndex={-1} className="grid gap-2 outline-none sm:grid-cols-2">
            {ANNOUNCEMENT_TONES.map((tone, index) => {
              const checked = draft.tone === tone;
              return (
                <button
                  key={tone}
                  ref={(el) => {
                    toneRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={index === toneTabStop ? 0 : -1}
                  onClick={() => onChange({ tone })}
                  onKeyDown={(e) => onToneKeyDown(e, index)}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30',
                    checked ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/30' : 'border-border hover:bg-primary/5',
                  )}
                >
                  <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white', TONE_CLASSES[tone].swatch)}>
                    <ToneIcon tone={tone} className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{TONE_META[tone].label}</span>
                    <span className="block text-xs leading-5 text-muted-foreground">{TONE_META[tone].useFor}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </FormField>
      </FormSection>
    </>
  );
}
