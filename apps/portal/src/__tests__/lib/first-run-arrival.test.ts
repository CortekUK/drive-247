/**
 * The first-run ARRIVAL — the confetti that rides on the wizard's dissolve.
 *
 * Four things here are correctness rather than taste, and all four are the
 * kind that fail silently in production:
 *
 *   1. ONCE. The celebration must never fire twice — not on a double click,
 *      not on a retry after a failed write, not on a replayed tour. The latch
 *      is checked BEFORE the reduced-motion guard, so "we already arrived" is
 *      true even when the arrival was drawn as nothing.
 *   2. `prefers-reduced-motion` gets NOTHING. Not a smaller burst — no DOM at
 *      all.
 *   3. CLEANUP is total. No layer left on <body>, no animation still running.
 *      This layer sits at z-index 71 over the whole viewport; one that
 *      outlives its 700ms is a permanently dead app.
 *   4. IT IS SILENT. The arrival was built with a chime and the chime was cut
 *      by request, so `silence` below is a live tripwire rather than a note:
 *      it fails if anything here ever constructs an AudioContext or an <audio>
 *      element again. Sound coming back has to be a decision someone makes on
 *      purpose, in front of this test.
 *
 * jsdom has no Web Animations API, which is convenient: it is injected here,
 * so the module's real branches are exercised against a double we can
 * interrogate — including the branch where it is ABSENT, which is the one a
 * very old browser takes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  ARRIVAL_CONFETTI_MS,
  ARRIVAL_LAYER_ATTR,
  arrivalHoldMs,
  celebrateArrival,
  resetArrivalCelebration,
} from '@/lib/first-run-arrival';

// ── Web Animations double ──────────────────────────────────────────────────

interface FakeAnimation {
  cancel: ReturnType<typeof vi.fn>;
  keyframes: unknown;
  options: unknown;
}

let animations: FakeAnimation[] = [];
/** Make `piece.animate` throw, to prove a rejected keyframe leaves no DOM. */
let animateThrows = false;

function installWAAPI() {
  (Element.prototype as unknown as { animate: unknown }).animate = function (
    keyframes: unknown,
    options: unknown,
  ) {
    if (animateThrows) throw new Error('unsupported keyframes');
    const anim: FakeAnimation = { cancel: vi.fn(), keyframes, options };
    animations.push(anim);
    return anim;
  };
}

function removeWAAPI() {
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
}

// ── Silence tripwire ───────────────────────────────────────────────────────
//
// Not a double — a detector. Real Web Audio does not exist in jsdom, so an
// absent AudioContext would let "no sound" pass for the wrong reason. One is
// installed here purely so that touching it is observable, and every test
// below asserts it was never touched.

let audioConstructed = 0;

function installSilenceTripwire() {
  const Tripwire = function () {
    audioConstructed += 1;
    return {};
  };
  (window as unknown as { AudioContext: unknown }).AudioContext = Tripwire;
  (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = Tripwire;
}

function removeSilenceTripwire() {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
}

/** Anything that would make a noise, however it was reached. */
const madeNoise = () =>
  audioConstructed > 0 || document.querySelectorAll('audio').length > 0;

const layerCount = () => document.querySelectorAll(`[${ARRIVAL_LAYER_ATTR}]`).length;
const pieceCount = () =>
  document.querySelectorAll(`[${ARRIVAL_LAYER_ATTR}] > span`).length;

beforeEach(() => {
  animations = [];
  audioConstructed = 0;
  animateThrows = false;
  document.body.innerHTML = '';
  resetArrivalCelebration();
  installWAAPI();
  installSilenceTripwire();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
  resetArrivalCelebration();
  removeWAAPI();
  removeSilenceTripwire();
  document.body.innerHTML = '';
});

// ── The timing contract with the walkthrough ───────────────────────────────
//
// The burst is now LONGER than the tour's autostart delay, so the old cap is
// gone and the tour waits instead. `arrivalHoldMs()` is that whole contract,
// and every one of its zero-cases is a case where the tour must NOT be
// delayed. Get one wrong and the Welcome card is either late for no reason or
// buried under confetti.

describe('the hold the walkthrough honours', () => {
  it('is zero when no arrival has happened — the ordinary dashboard load', () => {
    expect(arrivalHoldMs()).toBe(0);
  });

  it('covers the whole burst the moment it is fired', () => {
    celebrateArrival(false);
    // Fake timers freeze the clock, so this is the full run, exactly.
    expect(arrivalHoldMs()).toBe(ARRIVAL_CONFETTI_MS);
  });

  it('counts down as the burst runs, and is zero once it is over', () => {
    celebrateArrival(false);
    vi.advanceTimersByTime(1_000);
    expect(arrivalHoldMs()).toBe(ARRIVAL_CONFETTI_MS - 1_000);

    vi.advanceTimersByTime(ARRIVAL_CONFETTI_MS);
    expect(arrivalHoldMs()).toBe(0);
  });

  it('is zero under reduced motion — nothing was drawn, so nothing to wait for', () => {
    celebrateArrival(true);
    expect(arrivalHoldMs()).toBe(0);
  });

  it('is zero when the burst could not draw at all', () => {
    removeWAAPI();
    celebrateArrival(false);
    expect(arrivalHoldMs()).toBe(0);
  });

  it('gives every piece a delay + duration inside the run', () => {
    celebrateArrival(false);
    expect(animations.length).toBe(pieceCount());
    for (const anim of animations) {
      const opts = anim.options as { delay: number; duration: number };
      expect(opts.delay + opts.duration).toBeLessThanOrEqual(ARRIVAL_CONFETTI_MS);
    }
  });

  it('runs slowly enough to be watched, not glimpsed', () => {
    // The brief, as a number. The first cut was 700ms and read as a flicker.
    expect(ARRIVAL_CONFETTI_MS).toBeGreaterThanOrEqual(2_000);
    celebrateArrival(false);
    for (const anim of animations) {
      const opts = anim.options as { duration: number };
      expect(opts.duration).toBeGreaterThanOrEqual(1_000);
    }
  });
});

// ── The confetti ───────────────────────────────────────────────────────────

describe('confetti', () => {
  it('draws one detached layer of a great many small pieces', () => {
    celebrateArrival(false);

    expect(layerCount()).toBe(1);
    const layer = document.querySelector(`[${ARRIVAL_LAYER_ATTR}]`)!;
    expect(layer.parentElement).toBe(document.body);
    expect(layer.getAttribute('aria-hidden')).toBe('true');

    // A good amount — but of confetti. The floor is the ask, asked twice
    // ("more of it"); the ceiling keeps it a burst and not weather.
    expect(pieceCount()).toBeGreaterThanOrEqual(180);
    expect(pieceCount()).toBeLessThanOrEqual(400);
  });

  it('fires from the two bottom corners, in equal halves', () => {
    celebrateArrival(false);
    const pieces = Array.from(
      document.querySelectorAll<HTMLElement>(`[${ARRIVAL_LAYER_ATTR}] > span`),
    );

    // Every piece starts along the bottom edge, at one end or the other, and
    // never in between — a piece parked mid-screen is the single-origin burst
    // creeping back.
    const left = pieces.filter((p) => parseFloat(p.style.left) < 10);
    const right = pieces.filter((p) => parseFloat(p.style.left) > 90);
    expect(left.length + right.length).toBe(pieces.length);
    expect(left.length).toBe(right.length);
    expect(left.length).toBeGreaterThan(0);

    for (const piece of pieces) {
      expect(parseFloat(piece.style.top)).toBeGreaterThan(95);
    }
  });

  it('throws each cannon inward, so the two bursts meet over the screen', () => {
    celebrateArrival(false);
    const pieces = Array.from(
      document.querySelectorAll<HTMLElement>(`[${ARRIVAL_LAYER_ATTR}] > span`),
    );

    // The apex keyframe carries the launch. Left-hand pieces must travel
    // right and right-hand pieces left; a sign error here aims both cannons
    // off screen and the operator sees an empty dashboard.
    pieces.forEach((piece, i) => {
      const frames = animations[i].keyframes as { transform: string }[];
      const apex = frames[1].transform;
      const [, dx, dy] = apex.match(
        /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/,
      )!.map(Number) as unknown as number[];
      const fromLeft = parseFloat(piece.style.left) < 10;
      if (fromLeft) expect(dx).toBeGreaterThan(0);
      else expect(dx).toBeLessThan(0);
      // And upward. `translate3d` y is negative going up the screen.
      expect(dy).toBeLessThan(0);
    });
  });

  it('keeps every piece under 8px — the count went up, the size did not', () => {
    celebrateArrival(false);
    const pieces = Array.from(
      document.querySelectorAll<HTMLElement>(`[${ARRIVAL_LAYER_ATTR}] > span`),
    );
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(parseFloat(piece.style.width)).toBeLessThanOrEqual(8);
      expect(parseFloat(piece.style.height)).toBeLessThanOrEqual(8);
    }
  });

  it('never takes a pointer event, on the layer or on a piece', () => {
    celebrateArrival(false);
    const layer = document.querySelector<HTMLElement>(`[${ARRIVAL_LAYER_ATTR}]`)!;
    expect(layer.style.pointerEvents).toBe('none');
    for (const piece of Array.from(
      document.querySelectorAll<HTMLElement>(`[${ARRIVAL_LAYER_ATTR}] > span`),
    )) {
      expect(piece.style.pointerEvents).toBe('none');
    }
  });

  it('sits above the wizard veil and is gone before the tour card is drawn', () => {
    celebrateArrival(false);
    const layer = document.querySelector<HTMLElement>(`[${ARRIVAL_LAYER_ATTR}]`)!;
    // The veil is z-index 69; the tour card layer is z-65. Above the veil so
    // the burst is seen in full, and finished before the card exists.
    expect(Number(layer.style.zIndex)).toBeGreaterThan(69);
  });

  it('cleans itself up completely at the cap — no DOM, no live animation', () => {
    celebrateArrival(false);
    const started = animations.length;
    expect(started).toBeGreaterThan(0);

    vi.advanceTimersByTime(ARRIVAL_CONFETTI_MS);

    expect(layerCount()).toBe(0);
    expect(document.body.querySelector('span')).toBeNull();
    for (const anim of animations) expect(anim.cancel).toHaveBeenCalled();
  });

  it('leaves nothing behind on a browser with no Web Animations API', () => {
    removeWAAPI();
    expect(() => celebrateArrival(false)).not.toThrow();
    expect(layerCount()).toBe(0);
  });

  it('leaves nothing behind when the keyframes are rejected mid-burst', () => {
    animateThrows = true;
    expect(() => celebrateArrival(false)).not.toThrow();
    expect(layerCount()).toBe(0);
  });
});

// ── Once, ever ─────────────────────────────────────────────────────────────

describe('once only', () => {
  it('does not fire a second time', () => {
    celebrateArrival(false);
    const first = pieceCount();
    expect(first).toBeGreaterThan(0);

    celebrateArrival(false);

    // Still exactly one layer with exactly the original pieces.
    expect(layerCount()).toBe(1);
    expect(pieceCount()).toBe(first);
    expect(madeNoise()).toBe(false);
  });

  it('does not fire after the tail has been cleaned up either', () => {
    celebrateArrival(false);
    vi.advanceTimersByTime(ARRIVAL_CONFETTI_MS);
    expect(layerCount()).toBe(0);

    celebrateArrival(false);
    expect(layerCount()).toBe(0);
    expect(madeNoise()).toBe(false);
  });

  it('latches even when the first arrival was suppressed by reduced motion', () => {
    // A reduced-motion arrival still HAPPENED. It must not be re-celebrated
    // loudly by a later call.
    celebrateArrival(true);
    celebrateArrival(false);
    expect(layerCount()).toBe(0);
    expect(madeNoise()).toBe(false);
  });
});

// ── prefers-reduced-motion ─────────────────────────────────────────────────

describe('prefers-reduced-motion', () => {
  it('draws nothing at all — no layer, no animation, no noise', () => {
    celebrateArrival(true);
    expect(layerCount()).toBe(0);
    expect(animations.length).toBe(0);
    expect(madeNoise()).toBe(false);
  });
});

// ── Silence ────────────────────────────────────────────────────────────────

describe('silence', () => {
  it('makes no sound on an ordinary arrival', () => {
    celebrateArrival(false);
    expect(layerCount()).toBe(1);
    expect(madeNoise()).toBe(false);
  });

  it('makes no sound once the burst has run and been cleaned up', () => {
    celebrateArrival(false);
    vi.advanceTimersByTime(ARRIVAL_CONFETTI_MS + 2_000);
    expect(madeNoise()).toBe(false);
  });

  it('makes no sound on the paths where the confetti itself bails out', () => {
    // A chime slipped back in behind a failed burst would be the one place
    // nobody would think to look.
    removeWAAPI();
    celebrateArrival(false);
    expect(layerCount()).toBe(0);
    expect(madeNoise()).toBe(false);

    resetArrivalCelebration();
    installWAAPI();
    animateThrows = true;
    celebrateArrival(false);
    expect(layerCount()).toBe(0);
    expect(madeNoise()).toBe(false);
  });

  it('the tripwire itself works — so the assertions above are not vacuous', () => {
    // Without this, every `madeNoise()` check would keep passing if the
    // detector were quietly broken.
    expect(madeNoise()).toBe(false);
    new (window as unknown as { AudioContext: new () => unknown }).AudioContext();
    expect(madeNoise()).toBe(true);
  });
});
