import { LIMITS, emptySlide, type AnnouncementSlide } from '@/lib/announcements/contract';

// ─── Slides with stable client keys ──────────────────────────────────────────
//
// Each slide carries a client-only key (never saved), kept in step with the
// slides array in ONE state update. An image upload that finishes after the
// admin typed, added, moved or removed slides targets its slide by key against
// the LATEST slides, so it neither reverts those edits nor lands on whichever
// slide now sits at the old index.

export interface KeyedSlides {
  slides: AnnouncementSlide[];
  keys: string[];
}

let slideKeySeq = 0;

/** A key no other slide in this page session has used. */
export function newSlideKey(): string {
  slideKeySeq += 1;
  return 'slide-' + slideKeySeq;
}

export function withSlideKeys(slides: AnnouncementSlide[]): KeyedSlides {
  return { slides, keys: slides.map(() => newSlideKey()) };
}

/** Patch one slide by key; an unknown key (slide removed meanwhile) changes nothing. */
export function patchSlideByKey(state: KeyedSlides, key: string, patch: Partial<AnnouncementSlide>): KeyedSlides {
  const index = state.keys.indexOf(key);
  if (index === -1 || index >= state.slides.length) return state;
  return { slides: state.slides.map((s, i) => (i === index ? { ...s, ...patch } : s)), keys: state.keys };
}

export function moveSlideByKey(state: KeyedSlides, key: string, delta: -1 | 1): KeyedSlides {
  const from = state.keys.indexOf(key);
  const to = from + delta;
  if (from === -1 || from >= state.slides.length || to < 0 || to >= state.slides.length) return state;
  const slides = state.slides.slice();
  const keys = state.keys.slice();
  slides.splice(to, 0, slides.splice(from, 1)[0]);
  keys.splice(to, 0, keys.splice(from, 1)[0]);
  return { slides, keys };
}

export function removeSlideByKey(state: KeyedSlides, key: string): KeyedSlides {
  const index = state.keys.indexOf(key);
  if (index === -1 || index >= state.slides.length || state.slides.length <= LIMITS.slidesMin) return state;
  return { slides: state.slides.filter((_, i) => i !== index), keys: state.keys.filter((_, i) => i !== index) };
}

/** `key` comes from newSlideKey() in the event handler, so the updater stays pure. */
export function appendSlide(state: KeyedSlides, key: string): KeyedSlides {
  if (state.slides.length >= LIMITS.slidesMax || state.keys.indexOf(key) !== -1) return state;
  return { slides: state.slides.concat(emptySlide()), keys: state.keys.concat(key) };
}

// ─── Confirmations ───────────────────────────────────────────────────────────
//
// The "every tenant" question (saving or switching on an active system
// announcement for All tenants, soft or hard) lives in
// lib/announcements/all-tenants-confirm.ts.

// ─── Radio groups (roving tab stop + arrow keys) ─────────────────────────────

/** The one option that is in the Tab order: the checked one if enabled, else the first enabled, else none (-1). */
export function radioTabStop(checkedIndex: number, count: number, isDisabled: (index: number) => boolean): number {
  if (checkedIndex >= 0 && checkedIndex < count && !isDisabled(checkedIndex)) return checkedIndex;
  for (let i = 0; i < count; i++) if (!isDisabled(i)) return i;
  return -1;
}

/**
 * Where an arrow / Home / End key moves the selection in a radio group,
 * wrapping around and skipping disabled options. null = key not handled, or
 * nothing to move to.
 */
export function radioKeyTarget(key: string, index: number, count: number, isDisabled: (index: number) => boolean): number | null {
  if (count <= 0) return null;
  if (key === 'Home' || key === 'End') {
    for (let n = 0; n < count; n++) {
      const i = key === 'Home' ? n : count - 1 - n;
      if (!isDisabled(i)) return i;
    }
    return null;
  }
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return null;
  for (let n = 1; n <= count; n++) {
    const i = (((index + step * n) % count) + count) % count;
    if (!isDisabled(i)) return i === index ? null : i;
  }
  return null;
}
