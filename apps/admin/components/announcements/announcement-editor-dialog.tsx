'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { referencedImageUrls, removeAnnouncementImages, saveAnnouncement } from '@/lib/announcements/api';
import {
  FREQUENCY_OPTIONS,
  LIMITS,
  emptyDraft,
  rowToDraft,
  validateAnnouncementDraft,
  type AdminAnnouncementRow,
  type AnnouncementDraft,
  type AnnouncementKind,
  type DraftErrors,
  type RepeatAfterDays,
} from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './confirm-dialog';
import { FeatureFields } from './feature-fields';
import { FormField, FormSection, QUIET_BUTTON } from './form-field';
import { blocksEveryTenant, withSlideKeys, type KeyedSlides } from './form-logic';
import { AnnouncementPreview, type FeaturePreviewView, type PreviewFocus } from './preview/announcement-preview';
import { SegmentedControl } from './segmented-control';
import { SystemFields } from './system-fields';
import { TargetingField } from './targeting-field';

const PANE_OPTIONS = [
  { value: 'edit', label: 'Edit' },
  { value: 'preview', label: 'Preview' },
] as const;

/** The first invalid field in form order, as the id of the control to focus. */
function firstInvalidFieldId(kind: AnnouncementKind, errors: DraftErrors): string | null {
  const order: Array<[boolean, string]> = [[!!errors.title, 'ann-title']];
  if (kind === 'feature') {
    order.push([!!errors.summary, 'ann-summary'], [!!errors.image_url, 'ann-image']);
    (errors.slideErrors ?? []).forEach((e, i) => {
      if (!e) return;
      order.push([!!e.heading, 'ann-slide-' + i + '-heading'], [!!e.body, 'ann-slide-' + i + '-body'], [!!e.image_url, 'ann-slide-' + i + '-image']);
    });
  } else {
    order.push([!!errors.body, 'ann-body'], [!!errors.display, 'ann-display'], [!!errors.blocking, 'ann-blocking'], [!!errors.tone, 'ann-tone']);
  }
  order.push(
    [!!errors.cta_url, 'ann-cta-url'],
    [!!errors.cta_label, 'ann-cta-label'],
    [!!errors.repeat_after_days, 'ann-frequency'],
    [!!errors.audience, 'ann-audience'],
    [!!errors.segment_key, 'ann-segment-key'],
    [!!errors.tenant_ids, 'ann-tenant-ids'],
  );
  const hit = order.find(([bad]) => bad);
  return hit ? hit[1] : null;
}

function focusField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const target =
    el.getAttribute('role') === 'radiogroup'
      ? (el.querySelector<HTMLElement>('[aria-checked="true"]:not([disabled])') ??
        el.querySelector<HTMLElement>('button:not([disabled])') ??
        el)
      : el;
  target.scrollIntoView({ block: 'center' });
  target.focus({ preventScroll: true });
}

/**
 * Before the first Save attempt only over-length errors show (so switching a
 * long dialog message to Banner flags it at once); after it, every error.
 */
function visibleErrors(errors: DraftErrors, showAll: boolean): DraftErrors {
  if (showAll) return errors;
  const tooLong = (m: string | undefined) => (m && m.endsWith('characters or fewer.') ? m : undefined);
  const out: DraftErrors = {
    title: tooLong(errors.title),
    summary: tooLong(errors.summary),
    body: tooLong(errors.body),
    cta_label: tooLong(errors.cta_label),
  };
  if (errors.blocking && !errors.blocking.startsWith('Choose')) out.blocking = errors.blocking;
  if (errors.slideErrors) {
    out.slideErrors = errors.slideErrors.map((e) =>
      e && (tooLong(e.heading) || tooLong(e.body)) ? { heading: tooLong(e.heading), body: tooLong(e.body) } : null,
    );
  }
  return out;
}

/**
 * Create or edit one announcement, with the live preview beside the form
 * (stacked behind an Edit | Preview switch below `lg`). Images uploaded here are
 * cleaned up: all of them on cancel, and on save any the saved row no longer
 * references (including images this edit replaced).
 */
export function AnnouncementEditorDialog({
  kind,
  row,
  tenantIds,
  otherActiveFeatures,
  onClose,
  onSaved,
  onCloseAutoFocus,
}: {
  kind: AnnouncementKind;
  /** null = new announcement. */
  row: AdminAnnouncementRow | null;
  /** The row's selected tenants (audience 'selected'). */
  tenantIds: readonly string[];
  otherActiveFeatures: number;
  onClose: () => void;
  onSaved: () => void;
  /** Opened from code (no DialogTrigger), so the page says where focus goes on close. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  // Seeded once per mount; the page remounts the editor (new key) for every open.
  const [initial] = useState<AnnouncementDraft>(() => (row ? rowToDraft(row, tenantIds.slice()) : emptyDraft(kind)));
  const initialJson = useRef(JSON.stringify(initial));
  // The draft and its slides' client keys change together, in one state update
  // (see form-logic.ts); the keys are never saved and never make the draft dirty.
  const [form, setForm] = useState<{ draft: AnnouncementDraft; slideKeys: string[] }>(() => ({
    draft: initial,
    slideKeys: withSlideKeys(initial.slides).keys,
  }));
  const draft = form.draft;
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyUploads, setBusyUploads] = useState(0);
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmHardAll, setConfirmHardAll] = useState(false);
  const [previewFocus, setPreviewFocus] = useState<PreviewFocus | null>(null);
  const uploaded = useRef<string[]>([]);
  const focusSeq = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  const isFeature = draft.kind === 'feature';
  const isNew = draft.id === null;
  const hard = !isFeature && draft.blocking === 'hard';
  const validation = useMemo(() => validateAnnouncementDraft(draft), [draft]);
  const errors = visibleErrors(validation.errors, showAllErrors);
  const dirty = JSON.stringify(draft) !== initialJson.current;

  const patch = useCallback((next: Partial<AnnouncementDraft>) => {
    setForm((f) => ({ ...f, draft: { ...f.draft, ...next } }));
    setServerError(null);
  }, []);

  /**
   * Every slide change goes through here and is computed against the LATEST
   * slides, so an image upload that resolves late never reverts edits made
   * while it was in flight.
   */
  const updateSlides = useCallback((fn: (current: KeyedSlides) => KeyedSlides) => {
    setForm((f) => {
      const next = fn({ slides: f.draft.slides, keys: f.slideKeys });
      if (next.slides === f.draft.slides && next.keys === f.slideKeys) return f;
      return { draft: { ...f.draft, slides: next.slides }, slideKeys: next.keys };
    });
    setServerError(null);
  }, []);

  const onPreview = useCallback((view: FeaturePreviewView, slide: number) => {
    focusSeq.current += 1;
    setPreviewFocus({ view, slide, seq: focusSeq.current });
  }, []);

  const onBusyChange = useCallback((busy: boolean) => setBusyUploads((n) => Math.max(0, n + (busy ? 1 : -1))), []);
  const onUploaded = useCallback((url: string) => {
    uploaded.current.push(url);
  }, []);

  const discard = () => {
    void removeAnnouncementImages(uploaded.current);
    onClose();
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else discard();
  };

  const save = async (hardAllConfirmed: boolean) => {
    if (saving || busyUploads > 0) return;
    const result = validateAnnouncementDraft(draft);
    if (!result.valid) {
      setShowAllErrors(true);
      const id = firstInvalidFieldId(draft.kind, result.errors);
      setPane('edit');
      if (id) window.setTimeout(() => focusField(id), 0);
      return;
    }
    const p = result.args.p_row;
    if (!hardAllConfirmed && blocksEveryTenant(p)) {
      setConfirmHardAll(true);
      return;
    }
    setSaving(true);
    setServerError(null);
    const res = await saveAnnouncement(result.args);
    if (!res.ok) {
      setSaving(false);
      setServerError(res.message);
      return;
    }
    const keep = new Set(referencedImageUrls(p));
    const candidates = uploaded.current.concat(row ? referencedImageUrls(row) : []);
    onSaved();
    void removeAnnouncementImages(candidates.filter((url) => !keep.has(url)));
  };

  const title = (isNew ? 'New ' : 'Edit ') + (isFeature ? 'feature' : 'system') + ' announcement';
  const frequencyHelp = hard
    ? 'Hard announcements show every time.'
    : isFeature
      ? 'How soon the dialog opens again after someone closes it. The card stays on the dashboard either way.'
      : 'How soon it shows again after someone closes it.';

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent
          className="flex max-h-[92vh] w-[96vw] max-w-[1200px] flex-col gap-0 overflow-hidden p-0"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <DialogHeader className="border-b border-border px-5 pb-4 pr-14 pt-5 text-left sm:px-6 sm:pr-14">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {isFeature
                ? 'A card on the dashboard that opens a slides dialog, for portals on the new dashboard.'
                : 'A dialog or banner in the portal of every tenant it targets, classic and new.'}
            </DialogDescription>
            <div className="pt-2 lg:hidden">
              <SegmentedControl size="sm" ariaLabel="Editor view" options={PANE_OPTIONS} value={pane} onChange={setPane} />
            </div>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className={cn('min-h-0 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-5 py-5 sm:px-6', pane === 'preview' && 'hidden lg:block')}>
              <div className="space-y-5">
                {isFeature ? (
                  <FeatureFields
                    draft={draft}
                    slideKeys={form.slideKeys}
                    errors={errors}
                    onChange={patch}
                    onSlidesChange={updateSlides}
                    onUploaded={onUploaded}
                    onBusyChange={onBusyChange}
                    onPreview={onPreview}
                  />
                ) : (
                  <SystemFields draft={draft} errors={errors} onChange={patch} />
                )}

                <FormSection title="Button (optional)">
                  <FormField
                    label="Link"
                    htmlFor="ann-cta-url"
                    help="A portal page, starting with /. Leave empty for no button."
                    error={errors.cta_url}
                  >
                    <Input
                      id="ann-cta-url"
                      value={draft.cta_url}
                      onChange={(e) => patch({ cta_url: e.target.value })}
                      onFocus={() => isFeature && onPreview('dialog', Math.max(0, draft.slides.length - 1))}
                      placeholder="/insights/expenses"
                      spellCheck={false}
                      autoComplete="off"
                      aria-invalid={!!errors.cta_url}
                    />
                  </FormField>
                  <FormField
                    label="Label"
                    htmlFor="ann-cta-label"
                    required={draft.cta_url.trim() !== ''}
                    counter={{ value: draft.cta_label, max: LIMITS.ctaLabel }}
                    error={errors.cta_label}
                  >
                    <Input
                      id="ann-cta-label"
                      value={draft.cta_label}
                      onChange={(e) => patch({ cta_label: e.target.value })}
                      onFocus={() => isFeature && onPreview('dialog', Math.max(0, draft.slides.length - 1))}
                      placeholder="Open Expenses"
                      aria-invalid={!!errors.cta_label}
                    />
                  </FormField>
                </FormSection>

                <FormSection title="Who sees it, and how often">
                  <FormField label="Frequency" htmlFor="ann-frequency" help={frequencyHelp} error={errors.repeat_after_days}>
                    <div>
                      <SegmentedControl<RepeatAfterDays | null>
                        id="ann-frequency"
                        ariaLabel="Frequency"
                        options={FREQUENCY_OPTIONS}
                        value={draft.repeat_after_days}
                        disabled={hard}
                        noSelection={hard}
                        onChange={(repeat_after_days) => patch({ repeat_after_days })}
                      />
                    </div>
                  </FormField>
                  <TargetingField
                    audience={draft.audience}
                    segmentKey={draft.segment_key}
                    tenantIds={draft.tenant_ids}
                    blocking={isFeature ? 'soft' : draft.blocking}
                    showStripeBannerNote={
                      !isFeature &&
                      draft.display === 'banner' &&
                      draft.audience === 'segment' &&
                      draft.segment_key === 'stripe_connect_not_connected'
                    }
                    errors={errors}
                    onChange={patch}
                  />
                </FormSection>

                <FormSection title="Status">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Switch
                        id="ann-active"
                        aria-label="Active"
                        checked={draft.is_active}
                        onCheckedChange={(is_active) => patch({ is_active })}
                      />
                      <label htmlFor="ann-active" className="cursor-pointer text-sm font-medium">
                        Active
                      </label>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">Inactive announcements are hidden from every tenant.</p>
                  </div>
                  {!isNew && (
                    <label className="flex cursor-pointer items-start gap-3">
                      <Checkbox
                        className="mt-0.5"
                        checked={draft.reshow}
                        onCheckedChange={(reshow) => patch({ reshow })}
                        aria-label="Show it again to everyone who already closed it"
                      />
                      <span className="space-y-1">
                        <span className="block text-sm font-medium">Show it again to everyone who already closed it</span>
                        <span className="block text-xs leading-5 text-muted-foreground">
                          Leave this off for small fixes like typos. Turn it on when the message itself changed.
                        </span>
                      </span>
                    </label>
                  )}
                </FormSection>
              </div>
            </div>

            <div
              className={cn(
                'min-h-0 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden border-border bg-muted/30 px-5 py-5 sm:px-6 lg:border-l',
                pane === 'edit' && 'hidden lg:block',
              )}
            >
              <AnnouncementPreview draft={draft} otherActiveFeatures={otherActiveFeatures} focus={previewFocus} />
            </div>
          </div>

          {serverError && (
            <div
              role="alert"
              className="mx-5 mb-0 mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6"
            >
              {serverError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
            {showAllErrors && !validation.valid && (
              <p className="mr-auto text-xs font-medium text-destructive">Fix the highlighted fields to save.</p>
            )}
            {busyUploads > 0 && <p className="mr-auto text-xs text-muted-foreground">Waiting for the image upload…</p>}
            <Button ref={cancelRef} type="button" variant="outline" className={QUIET_BUTTON} onClick={requestClose} disabled={saving}>
              Cancel
            </Button>
            <Button ref={saveRef} type="button" onClick={() => void save(false)} disabled={saving || busyUploads > 0}>
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard changes?"
        description="Your edits to this announcement will be lost."
        confirmLabel="Discard"
        destructive
        returnFocusRef={cancelRef}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          discard();
        }}
      />
      <ConfirmDialog
        open={confirmHardAll}
        title="Block every tenant?"
        description="This blocks every tenant's portal until you deactivate it. Continue?"
        confirmLabel="Save and block"
        destructive
        returnFocusRef={saveRef}
        onCancel={() => setConfirmHardAll(false)}
        onConfirm={() => {
          setConfirmHardAll(false);
          void save(true);
        }}
      />
    </>
  );
}
