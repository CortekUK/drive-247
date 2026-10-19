'use client';

/**
 * The identity step's LOGIC, shared by the v1 panel (`identity-capture.tsx`)
 * and the v2 one (`site-v2/booking/identity-capture.tsx`). Only the markup is
 * forked; everything that decides anything lives here, once.
 *
 * Read `identity-capture.tsx`'s header before changing this file: it explains
 * the lazy mint (the session is asked for inside `submit`, never on open), why
 * a multi-file selection fans out across the empty slots, and why a rejection
 * never states a reason. Every comment below is the one that used to sit next
 * to the same lines in that component.
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { IdCard, ScanFace } from 'lucide-react-nw';
import type { LucideIcon } from 'lucide-react-nw';

import {
  useStartBookingIdentity,
  useSubmitBookingIdentity,
  validateIdentityPhoto,
  type IdentitySlot,
} from '@nw/hooks/use-booking-documents';

/* ────────────────────────────── the photos ─────────────────────────────── */

export interface PhotoSpec {
  slot: IdentitySlot;
  title: string;
  /** The one-line name used in the "still needed" sentence on the send button. */
  shortTitle: string;
  /** What a good photo looks like. Concrete, not "make sure it is clear". */
  guidance: string;
  /** `environment` is the rear camera, `user` the front one. */
  capture: 'environment' | 'user';
  optional: boolean;
  icon: LucideIcon;
}

export const PHOTOS: readonly PhotoSpec[] = [
  {
    slot: 'front',
    title: 'Front of your driving licence',
    shortTitle: 'the front of your licence',
    guidance:
      'Lay it flat in good light and fill the frame. All four corners visible, text readable.',
    capture: 'environment',
    optional: false,
    icon: IdCard,
  },
  {
    slot: 'back',
    title: 'Back of your driving licence',
    shortTitle: 'the back of your licence',
    guidance:
      'The same again, turned over. Leave this one out if your document has nothing on the back — a passport, for instance.',
    capture: 'environment',
    optional: true,
    icon: IdCard,
  },
  {
    slot: 'selfie',
    title: 'A photo of you',
    shortTitle: 'a photo of you',
    guidance:
      'Face the camera in even light, with nothing covering your face. We compare this against the photo on your document.',
    capture: 'user',
    optional: false,
    icon: ScanFace,
  },
];

/** The slots a fanned-out multi-file selection fills, in this order. */
export const FILL_ORDER: readonly IdentitySlot[] = ['front', 'back', 'selfie'];

export interface Shot {
  file: File;
  /** An object URL. Owned by this hook and revoked when it is replaced. */
  previewUrl: string;
}

export type Shots = Record<IdentitySlot, Shot | null>;

const NO_SHOTS: Shots = { front: null, back: null, selfie: null };

/** The handle the shell's single primary button calls. Never throws. */
export interface IdentityCaptureHandle {
  /**
   * Send the photos. Resolves TRUE only when the server accepted them; false
   * covers both a rejection and a failure, each of which has already been
   * rendered inside the panel.
   */
  submit: () => Promise<boolean>;
}

export function useIdentityCapture({
  token,
  onSubmitted,
  onReadyChange,
  onMissingChange,
  ref,
}: {
  token: string;
  onSubmitted: () => void;
  onReadyChange: (ready: boolean) => void;
  onMissingChange: (missing: readonly string[]) => void;
  ref?: React.Ref<IdentityCaptureHandle>;
}) {
  const start = useStartBookingIdentity();
  const submit = useSubmitBookingIdentity();

  /**
   * Null until the first send. This IS the lazy-mint gate. It is held across a
   * failed attempt so a retry reuses the session rather than spending another
   * of the customer's ten an hour.
   */
  const [uploadPrefix, setUploadPrefix] = useState<string | null>(null);

  const [shots, setShots] = useState<Shots>(NO_SHOTS);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const [sending, setSending] = useState<IdentitySlot | null>(null);

  /*
    Whether to offer "Take a photo" at all. `capture` is honoured by phones and
    quietly ignored by desktop browsers; `(pointer: coarse)` is the standard
    proxy for "this device has a camera the OS will hand us". Resolved in an
    effect and defaulted to false so the server and the first client render
    agree.
  */
  const [offerCamera, setOfferCamera] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    setOfferCamera(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  /*
    Object URLs are revoked when their shot is replaced and again for whatever
    is left when the component goes away. The ref mirrors the state for the
    unmount cleanup (which must see the CURRENT shots without depending on
    them) and for `fanOut`, which must build on the batch before it when two
    selections land in one tick.
  */
  const shotsRef = useRef<Shots>(shots);
  shotsRef.current = shots;
  useEffect(
    () => () => {
      for (const shot of Object.values(shotsRef.current)) {
        if (shot) URL.revokeObjectURL(shot.previewUrl);
      }
    },
    [],
  );

  /** Both writes go through here so the ref and the state can never disagree. */
  const commit = useCallback((next: Shots) => {
    shotsRef.current = next;
    setShots(next);
  }, []);

  const setShot = useCallback(
    (slot: IdentitySlot, file: File) => {
      const rejection = validateIdentityPhoto(file);
      if (rejection) {
        setProblem(rejection);
        return;
      }
      setProblem(null);
      const previous = shotsRef.current;
      const existing = previous[slot];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      commit({ ...previous, [slot]: { file, previewUrl: URL.createObjectURL(file) } });
    },
    [commit],
  );

  const clearShot = useCallback(
    (slot: IdentitySlot) => {
      setProblem(null);
      const previous = shotsRef.current;
      const existing = previous[slot];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      commit({ ...previous, [slot]: null });
    },
    [commit],
  );

  /**
   * Several files at once, spread across the slots that are still empty, in
   * front → back → selfie order, each validated on its own. `targetSlot` is set
   * when the drop landed on ONE slot: that slot is filled first even if it
   * already had a photo, and any extras spill into the remaining empties.
   *
   * Computed against `shotsRef` rather than inside a `setShots` updater on
   * purpose: the loop fills `rejections`, which must be read at the call site,
   * not during a later render.
   */
  const fanOut = useCallback(
    (list: FileList | null, targetSlot?: IdentitySlot) => {
      if (!list || list.length === 0) return;

      const incoming = Array.from(list);
      const rejections: string[] = [];
      const next: Shots = { ...shotsRef.current };

      const queue: IdentitySlot[] = [];
      if (targetSlot) queue.push(targetSlot);
      for (const slot of FILL_ORDER) {
        if (slot !== targetSlot && next[slot] === null) queue.push(slot);
      }

      let filled = 0;
      for (const file of incoming) {
        const rejection = validateIdentityPhoto(file);
        if (rejection) {
          rejections.push(rejection);
          continue;
        }
        const slot = queue.shift();
        if (!slot) {
          rejections.push(
            `“${file.name}” was not added — all three photo slots are already filled. Remove one first if you meant to replace it.`,
          );
          continue;
        }
        const existing = next[slot];
        if (existing) URL.revokeObjectURL(existing.previewUrl);
        next[slot] = { file, previewUrl: URL.createObjectURL(file) };
        filled += 1;
      }

      if (filled > 0) commit(next);
      setProblem(rejections.length > 0 ? rejections.join(' ') : null);
    },
    [commit],
  );

  /** Back to a clean slate. The NEXT send mints a fresh session. */
  const startOver = useCallback(() => {
    setRejected(false);
    setSubmitError(null);
    setProblem(null);
    setUploadPrefix(null);
    const previous = shotsRef.current;
    for (const shot of Object.values(previous)) {
      if (shot) URL.revokeObjectURL(shot.previewUrl);
    }
    commit(NO_SHOTS);
  }, [commit]);

  /* ── readiness, pushed up to the shell ──────────────────────────────── */

  const ready = shots.front !== null && shots.selfie !== null;

  useEffect(() => {
    onReadyChange(ready);
  }, [onReadyChange, ready]);

  useEffect(() => {
    // Only the REQUIRED slots. The back of the document is genuinely optional
    // at every layer, so naming it here would be inventing a blocker.
    const missing = PHOTOS.filter(
      (spec) => !spec.optional && shots[spec.slot] === null,
    ).map((spec) => spec.shortTitle);
    onMissingChange(missing);
  }, [onMissingChange, shots]);

  /* ── the send, driven by the shell's one button ─────────────────────── */

  const handleSubmit = useCallback(async (): Promise<boolean> => {
    const current = shotsRef.current;
    if (!current.front || !current.selfie) {
      setSubmitError(
        'We still need the front of your document and a photo of you before we can check them.',
      );
      return false;
    }
    setSubmitError(null);

    /*
      THE MINT, AND THE ONLY PLACE IT HAPPENS. Reusing the prefix we already
      hold matters: every mint can spend one of the customer's ten sessions an
      hour.
    */
    let prefix = uploadPrefix;
    if (prefix === null) {
      try {
        const minted = await start.mutateAsync({ token });
        prefix = minted.uploadPrefix;
        setUploadPrefix(minted.uploadPrefix);
      } catch (caught: unknown) {
        // The hook has already turned every server code — the ten-an-hour cap
        // included — into a sentence written for a customer.
        setSubmitError(
          caught instanceof Error
            ? caught.message
            : 'We could not start the identity check. Please try again in a moment.',
        );
        return false;
      }
    }

    try {
      const result = await submit.mutateAsync({
        token,
        uploadPrefix: prefix,
        front: current.front.file,
        back: current.back?.file ?? null,
        selfie: current.selfie.file,
        onPhotoState: (slot, state) => {
          setSending(state === 'uploading' ? slot : null);
        },
      });
      setSending(null);
      if (result.identityStatus === 'rejected') {
        // A rejected session is spent; the retry must mint a fresh one.
        setUploadPrefix(null);
        setRejected(true);
        return false;
      }
      onSubmitted();
      return true;
    } catch (caught: unknown) {
      setSending(null);
      // Already written for a customer by the hook — including the "we could
      // not check your photos just now" case, which is NOT a rejection.
      setSubmitError(
        caught instanceof Error
          ? caught.message
          : 'Something went wrong sending your photos. Please try again.',
      );
      return false;
    }
  }, [onSubmitted, start, submit, token, uploadPrefix]);

  useImperativeHandle(ref, () => ({ submit: handleSubmit }), [handleSubmit]);

  const busy = submit.isPending || start.isPending;
  const chosen = FILL_ORDER.filter((slot) => shots[slot] !== null).length;

  return {
    shots,
    problem,
    submitError,
    rejected,
    sending,
    busy,
    ready,
    chosen,
    offerCamera,
    setShot,
    clearShot,
    fanOut,
    startOver,
  };
}
