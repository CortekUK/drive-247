'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
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
import {
  allTenantsConfirmCopy,
  allTenantsConfirmKey,
  needsAllTenantsConfirm,
  type ConfirmCopy,
} from '@/lib/announcements/all-tenants-confirm';
import {
  DUPLICATE_INACTIVE_NOTE,
  NO_MISSING_IMAGES,
  missingImageNote,
  missingImageTargets,
  missingImagesFromSeed,
  missingImagesSaveConfirm,
  pruneMissingImages,
  type DuplicateSeed,
  type ImageTarget,
  type MissingImages,
} from '@/lib/announcements/row-actions';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './confirm-dialog';
import { FeatureFields } from './feature-fields';
import { FormField, FormSection, QUIET_BUTTON } from './form-field';
import { withSlideKeys, type KeyedSlides } from './form-logic';
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

/** The image control a missing-image target refers to (ids as in FeatureFields). */
function imageFieldId(target: ImageTarget): string {
  return target.kind === 'card' ? 'ann-image' : 'ann-slide-' + target.index + '-image';
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
 *
 * A duplicate opens in CREATE mode (`row` null) from a prefilled draft whose
 * images are copies made for it; those copies count as this session's uploads,
 * so Cancel deletes them and Save keeps the ones the new row references. The
 * original's images are never candidates for cleanup here.
 */
export function AnnouncementEditorDialog({
  kind,
  row,
  duplicate,
  tenantIds,
  otherActiveFeatures,
  resolveAllTenantsCount,
  onClose,
  onSaved,
  onCloseAutoFocus,
}: {
  kind: AnnouncementKind;
  /** null = new announcement (blank, or a duplicate). */
  row: AdminAnnouncementRow | null;
  /** A duplicate to open in create mode. Ignored when `row` is set. */
  duplicate?: DuplicateSeed | null;
  /** The row's selected tenants (audience 'selected'). */
  tenantIds: readonly string[];
  otherActiveFeatures: number;
  /** N for "(N active tenants)" in the All tenants confirmation; null when it cannot be read. */
  resolveAllTenantsCount: () => Promise<number | null>;
  onClose: () => void;
  onSaved: () => void;
  /** Opened from code (no DialogTrigger), so the page says where focus goes on close. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  // Seeded once per mount; the page remounts the editor (new key) for every open.
  const [initial] = useState<AnnouncementDraft>(() =>
    row ? rowToDraft(row, tenantIds.slice()) : duplicate ? duplicate.draft : emptyDraft(kind),
  );
  const isDuplicate = !row && !!duplicate;
  const initialJson = useRef(JSON.stringify(initial));
  // The draft and its slides' client keys change together, in one state update
  // (see form-logic.ts); the keys are never saved and never make the draft dirty.
  const [form, setForm] = useState<{ draft: AnnouncementDraft; slideKeys: string[] }>(() => ({
    draft: initial,
    slideKeys: withSlideKeys(initial.slides).keys,
  }));
  const draft = form.draft;
  // A duplicate's images whose copy failed. Each note sits under its own field
  // (and in the summary at the top) until that field has an image again or its
  // slide is removed; it then goes for good, even if the new image is removed.
  const [missingState, setMissingState] = useState<MissingImages>(() =>
    !row && duplicate ? missingImagesFromSeed(duplicate.missingImages, form.slideKeys) : NO_MISSING_IMAGES,
  );
  const missingImages = pruneMissingImages(missingState, draft, form.slideKeys);
  useEffect(() => {
    if (missingImages !== missingState) setMissingState(missingImages);
  }, [missingImages, missingState]);
  const missingTargets = missingImageTargets(missingImages, form.slideKeys);
  // The targets stay put while the dialog closes, so its text does not change mid-animation.
  const [confirmMissing, setConfirmMissing] = useState<{ open: boolean; targets: ImageTarget[] }>({ open: false, targets: [] });
  const missingFocusRef = useRef<HTMLElement | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyUploads, setBusyUploads] = useState(0);
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Saving an ACTIVE SYSTEM announcement for All tenants (any display, soft or hard) asks first.
  // `key` is what was asked about; the text stays put while the dialog animates closed.
  const [confirmAll, setConfirmAll] = useState<{ open: boolean; copy: ConfirmCopy; key: string }>(() => ({
    open: false,
    copy: allTenantsConfirmCopy({ blocking: 'soft', display: 'dialog' }, 'save', null),
    key: '',
  }));
  /** Reading the tenant count before that question opens: Save waits. */
  const [checkingReach, setCheckingReach] = useState(false);
  const checkingReachRef = useRef(false);
  /**
   * Bumped by each Save that waits for the count and by each close request. Only the latest Save's
   * count may open the question: a close asked for meanwhile cancels it (see requestClose).
   */
  const reachAsk = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [previewFocus, setPreviewFocus] = useState<PreviewFocus | null>(null);
  // A duplicate's copied images are this session's uploads from the start.
  const uploaded = useRef<string[]>(!row && duplicate ? duplicate.uploads.slice() : []);
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

  /** Drop a Save that is still waiting for the tenant count; its question will not open. */
  const cancelReachAsk = () => {
    if (!checkingReachRef.current) return;
    reachAsk.current += 1;
    checkingReachRef.current = false;
    setCheckingReach(false);
  };

  const requestClose = () => {
    if (saving) return;
    // Cancel, Escape and the X win over a Save still waiting for the count. Otherwise its All tenants
    // question would open on top of "Discard changes?", right where a click meant for Discard lands
    // on "Save for all tenants". To save after all, press Save again.
    cancelReachAsk();
    if (dirty) setConfirmDiscard(true);
    else discard();
  };

  const save = async (confirmed: { allTenantsKey?: string; missingImages?: boolean } = {}) => {
    if (saving || busyUploads > 0 || checkingReachRef.current) return;
    const result = validateAnnouncementDraft(draft);
    if (!result.valid) {
      setShowAllErrors(true);
      const id = firstInvalidFieldId(draft.kind, result.errors);
      setPane('edit');
      if (id) window.setTimeout(() => focusField(id), 0);
      return;
    }
    const p = result.args.p_row;
    // A duplicate never loses an image it could not copy without the admin saying so.
    if (!confirmed.missingImages && missingTargets.length > 0) {
      setConfirmMissing({ open: true, targets: missingTargets });
      return;
    }
    // A yes covers only what was asked: a change to kind, audience, active, blocking or display asks again.
    if (needsAllTenantsConfirm(p) && confirmed.allTenantsKey !== allTenantsConfirmKey(p)) {
      const ask = ++reachAsk.current;
      checkingReachRef.current = true;
      setCheckingReach(true);
      const count = await resolveAllTenantsCount().catch(() => null);
      if (!mounted.current || ask !== reachAsk.current) return;
      checkingReachRef.current = false;
      setCheckingReach(false);
      setConfirmAll({ open: true, copy: allTenantsConfirmCopy(p, 'save', count), key: allTenantsConfirmKey(p) });
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

  const title = (isDuplicate ? 'Duplicate ' : isNew ? 'New ' : 'Edit ') + (isFeature ? 'feature' : 'system') + ' announcement';
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
                {isDuplicate && duplicate && (
                  <div
                    role="note"
                    className="flex gap-2.5 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs leading-5 text-indigo-950 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100"
                  >
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
                    <div className="min-w-0 space-y-1">
                      <p>{DUPLICATE_INACTIVE_NOTE}</p>
                      {missingTargets.map((target) => {
                        const note = missingImageNote(target);
                        return (
                          <p key={note} className="font-medium text-amber-800 dark:text-amber-200">
                            {note}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                )}
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
                    missingImages={missingImages}
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
            <Button ref={saveRef} type="button" onClick={() => void save()} disabled={saving || checkingReach || busyUploads > 0}>
              {(saving || checkingReach) && <Loader2 className="animate-spin" />}
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
        open={confirmAll.open}
        {...confirmAll.copy}
        returnFocusRef={saveRef}
        onCancel={() => setConfirmAll((c) => ({ ...c, open: false }))}
        onConfirm={() => {
          const key = confirmAll.key;
          setConfirmAll((c) => ({ ...c, open: false }));
          // This question comes after the missing-image one, so that one is already answered (or never asked).
          void save({ allTenantsKey: key, missingImages: true });
        }}
      />
      <ConfirmDialog
        open={confirmMissing.open}
        {...missingImagesSaveConfirm(confirmMissing.targets)}
        returnFocusRef={missingFocusRef}
        onCancel={() => {
          // Back to the first image that still needs uploading.
          const first = confirmMissing.targets[0];
          missingFocusRef.current = (first && document.getElementById(imageFieldId(first))) || saveRef.current;
          setPane('edit');
          setConfirmMissing((c) => ({ ...c, open: false }));
        }}
        onConfirm={() => {
          missingFocusRef.current = saveRef.current;
          setConfirmMissing((c) => ({ ...c, open: false }));
          void save({ missingImages: true });
        }}
      />
    </>
  );
}
