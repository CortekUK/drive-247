'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ImageOff, ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IMAGE_GUIDANCE, type ImageSlot } from '@/lib/announcements/contract';
import { removeAnnouncementImages, uploadAnnouncementImage } from '@/lib/announcements/api';
import {
  IMAGE_ACCEPT,
  IMAGE_ERRORS,
  checkImageFile,
  imageGuidanceSummary,
  imageWarnings,
  readImageDimensions,
} from '@/lib/announcements/image-upload';
import { cn } from '@/lib/utils';
import { QUIET_BUTTON } from './form-field';

/**
 * One announcement image: click or drop, checked, uploaded to the announcement
 * bucket, then shown as a thumbnail with Replace / Remove. Removing or replacing
 * only changes the draft; the editor deletes objects the saved row no longer
 * references (or everything uploaded, on cancel). An upload that finishes after
 * this field is gone (editor closed, or its slide removed) can never reach a
 * draft, so its object is deleted right away.
 */
export function ImageUploadField({
  id,
  slot,
  value,
  onChange,
  onUploaded,
  onBusyChange,
  error,
  notice,
  label,
}: {
  id: string;
  slot: ImageSlot;
  value: string | null;
  onChange: (url: string | null) => void;
  /** Every URL uploaded, so the editor can clean up. */
  onUploaded: (url: string) => void;
  onBusyChange: (busy: boolean) => void;
  error?: string;
  /** A standing note about this image (a duplicate's copy that failed), shown right under the control. */
  notice?: string | null;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [broken, setBroken] = useState(false);
  const guidance = IMAGE_GUIDANCE[slot];

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => setBroken(false), [value]);

  const setBusyBoth = (next: boolean) => {
    setBusy(next);
    onBusyChange(next);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setLocalError(null);
    setWarnings([]);
    const check = checkImageFile(file);
    if (!check.ok) {
      setLocalError(check.error);
      return;
    }
    setBusyBoth(true);
    try {
      const dims = await readImageDimensions(file);
      if (!dims) {
        if (mounted.current) setLocalError(IMAGE_ERRORS.unreadable);
        return;
      }
      if (!mounted.current) return;
      const result = await uploadAnnouncementImage(slot, file);
      if (!result.ok) {
        if (mounted.current) setLocalError(result.message);
        return;
      }
      if (!mounted.current) {
        void removeAnnouncementImages([result.data]);
        return;
      }
      onUploaded(result.data);
      onChange(result.data);
      setWarnings(imageWarnings(slot, dims, file.size));
    } finally {
      if (mounted.current) setBusyBoth(false);
      else onBusyChange(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragOver(false);
    void handleFile(e.dataTransfer.files?.[0]);
  };

  const shownError = localError ?? error;
  const noticeId = notice ? id + '-notice' : undefined;
  const thumbClass = slot === 'card' ? 'aspect-square w-28' : 'aspect-video w-44';

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {value ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className={cn('relative shrink-0 overflow-hidden rounded-xl ring-1 ring-foreground/10', thumbClass)}>
            {broken ? (
              <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(180deg,#f7f5f0,#ece8df)]">
                <ImageOff className="h-5 w-5 text-amber-700" aria-hidden />
              </div>
            ) : (
              <img src={value} alt="" decoding="async" className="h-full w-full object-cover" onError={() => setBroken(true)} />
            )}
            {busy && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Uploading" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              id={id}
              type="button"
              variant="outline"
              size="sm"
              className={QUIET_BUTTON}
              disabled={busy}
              aria-label={'Replace ' + label}
              aria-describedby={noticeId}
              onClick={() => inputRef.current?.click()}
            >
              <RefreshCw />
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={QUIET_BUTTON}
              disabled={busy}
              aria-label={'Remove ' + label}
              onClick={() => {
                setWarnings([]);
                setLocalError(null);
                onChange(null);
              }}
            >
              <Trash2 />
              Remove
            </Button>
          </div>
          {broken && (
            <p className="basis-full text-xs font-medium leading-5 text-amber-700">
              This image could not be loaded. Replace it, or remove it.
            </p>
          )}
        </div>
      ) : (
        <button
          id={id}
          type="button"
          disabled={busy}
          aria-label={'Upload ' + label}
          aria-describedby={noticeId ? noticeId + ' ' + id + '-guidance' : id + '-guidance'}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-wait',
            dragOver ? 'border-primary bg-primary/10' : 'border-border bg-input/30 hover:border-primary/50 hover:bg-primary/5',
            notice && !shownError && !dragOver && 'border-amber-500/60',
            shownError && 'border-destructive/60',
          )}
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
          ) : (
            <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden />
          )}
          <span className="text-sm font-medium text-foreground">{busy ? 'Uploading…' : 'Click or drop an image'}</span>
          <span className="text-xs text-muted-foreground">PNG, JPG or WebP, up to 2 MB</span>
        </button>
      )}
      {notice && (
        <p id={noticeId} className="text-xs font-medium leading-5 text-amber-700 dark:text-amber-300">
          {notice}
        </p>
      )}
      <div id={id + '-guidance'} className="space-y-1 text-xs leading-5 text-muted-foreground">
        <p className="font-medium text-foreground/80">{imageGuidanceSummary(slot)}</p>
        <p>{guidance.note}</p>
      </div>
      {warnings.map((w) => (
        <p key={w} className="text-xs font-medium leading-5 text-amber-700">
          {w}
        </p>
      ))}
      {shownError && (
        <p id={id + '-error'} role="alert" className="text-xs font-medium leading-5 text-destructive">
          {shownError}
        </p>
      )}
    </div>
  );
}
