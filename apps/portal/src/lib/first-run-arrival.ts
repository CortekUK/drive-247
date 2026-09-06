/**
 * The first-run ARRIVAL — two cannons of confetti from the bottom corners, at
 * the moment a brand-new operator is let into the portal.
 *
 * This is the companion to `dissolveIntoDashboard` in
 * `components/onboarding/first-run-wizard.tsx`: the wizard writes its row,
 * unmounts, paints a detached veil of its own wash over the dashboard and
 * fades it off in ~0.42s. That dissolve is the threshold; this is the
 * celebration on top of it. Both live OUTSIDE React on purpose — saving
 * unmounts the wizard immediately (the row is the one source of truth and the
 * tour is queued behind "the wizard let go"), so nothing that survives the
 * moment can be a component.
 *
 * IT IS SILENT. There is no chime and no audio of any kind here, by request —
 * an earlier draft synthesised one and it was cut. If sound ever comes back it
 * is a new decision, not a restoration, and `__tests__/lib/first-run-arrival`
 * has a tripwire that will say so.
 *
 * TWO CANNONS, SLOW, AND PLENTY.
 * ------------------------------
 * Two hundred and twenty pieces, none larger than 8px, launched from just
 * beyond the bottom-left and bottom-right corners so the muzzles are never on
 * screen. They fire up and inward, decelerate to an apex, then fall out of
 * frame over ~2.6s.
 *
 * The slowness is the feature. The first cut ran in 700ms from a single point
 * near the top and read as a flicker — something you half-see and then doubt.
 * This one is meant to be watched. All three of "more", "from the corners" and
 * "slower" pull the same way: pieces that stay in frame long enough to be
 * individually legible.
 *
 * What has NOT moved is the piece size. Every raise of the count has kept the
 * 8px ceiling, and that is what stops a generous burst turning into debris.
 *
 * Colours are read from the live theme (`--primary`, `--chart-1/2/3`) rather
 * than written down here, exactly as `LiquidWash` in the wizard does, so this
 * is the product's own indigo and never a birthday.
 *
 * WHY WAAPI AND NOT A CONFETTI LIBRARY, OR `motion`.
 * -------------------------------------------------
 * No dependency was added. `motion` is the portal's animation library but it
 * animates a React tree, and there is no tree here to animate — the wizard is
 * already gone. Mounting a second React root to throw 220 pieces would cost
 * more than it buys. The Web Animations API composites off the main thread,
 * which is what makes 220 concurrent animations cheap, and every animation it
 * starts is a handle we can `cancel()`, which is what makes the cleanup total.
 *
 * TIMING — the walkthrough waits for this, not the other way round.
 * ----------------------------------------------------------------
 * This used to be capped under the tour's `AUTOSTART_DELAY_MS` so the Welcome
 * card was never rushed. At 2.6s that cap is no longer payable, and squeezing
 * the burst back under it is exactly the flicker we were asked to fix. So the
 * dependency is inverted: `arrivalHoldMs()` reports how much of the burst is
 * left, and `use-first-rental-tour` adds it to its autostart delay. An
 * ordinary dashboard load holds for 0ms and is unaffected.
 *
 * The layer is `pointer-events: none` regardless, so even if that hold were
 * ever removed, the confetti could not take the card's click.
 *
 * `prefers-reduced-motion` GETS NOTHING. Not a gentler burst — no confetti at
 * all, just the dissolve. Someone who has asked for calm has asked for calm.
 *
 * ONCE. Ever, per page life. `celebrateArrival` latches on its first call, so
 * a double-click on "Go to my dashboard", a retry after a failed write, or a
 * second mount of the wizard cannot fire it twice — and nothing else in the
 * app calls it, so a replayed tour and an ordinary dashboard load are both
 * silent by construction.
 */

/**
 * The whole confetti run, in ms — launch to teardown.
 *
 * Every piece's `delay + duration` is kept under this, and one backstop timer
 * removes the layer at exactly this mark whatever the animations did.
 */
export const ARRIVAL_CONFETTI_MS = 2_600;

/**
 * Pieces per cannon. Two cannons, so twice this in the air.
 *
 * Raised twice now, and both times the answer to "it looks thin" was more
 * pieces and never bigger ones.
 */
const PIECES_PER_CANNON = 110;

/**
 * The two cannons, as a fraction of the viewport, with the direction each one
 * throws. Just outside the corner, so the origin itself is off screen.
 */
const CANNONS: readonly { x: number; y: number; aim: 1 | -1 }[] = [
  { x: -0.02, y: 1.02, aim: 1 },
  { x: 1.02, y: 1.02, aim: -1 },
];

/** Marks the detached layer, so a stray one is greppable in a live DOM. */
export const ARRIVAL_LAYER_ATTR = 'data-first-run-confetti';

/**
 * Theme-derived, not literal. These are the same custom properties the
 * wizard's wash spends, so a tenant is never handed a second palette.
 */
const PIECE_COLORS: readonly string[] = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-1))',
  'hsl(var(--primary) / 0.55)',
];

/** Four small shapes: two squarish, one round, one sliver. Max 8px. */
const PIECE_SHAPES: readonly { w: number; h: number; radius: string }[] = [
  { w: 6, h: 6, radius: '1.5px' },
  { w: 5, h: 5, radius: '50%' },
  { w: 3, h: 8, radius: '1.5px' },
  { w: 7, h: 4, radius: '2px' },
];

/** Has the celebration already run in this page's life? See the header note. */
let celebrated = false;

/**
 * `Date.now()` at which the burst finishes, or 0 if none is running.
 *
 * Read by `arrivalHoldMs()` so the walkthrough can wait the remainder out. It
 * is a wall-clock deadline rather than a countdown because the reader is a
 * different module on a different tick, and "how much is left" has to stay
 * true however late it asks.
 */
let finishesAt = 0;

/** The live run's handles, so teardown can be total. */
let layer: HTMLElement | null = null;
let animations: Animation[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(list: readonly T[]): T =>
  list[Math.floor(Math.random() * list.length)];

/**
 * Take everything back off the page: cancel every animation, drop the layer,
 * clear the backstop. Safe to call twice, and safe to call when nothing ran.
 */
function teardown(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  for (const anim of animations) {
    try {
      anim.cancel();
    } catch {
      // A finished animation can throw on cancel in some engines. Nothing here
      // is worth failing an arrival over.
    }
  }
  animations = [];
  finishesAt = 0;
  layer?.remove();
  layer = null;
}

/**
 * The scatter. Returns silently — and leaves nothing behind — on any browser
 * without the Web Animations API, rather than pinning 26 static dots to the
 * screen for the duration.
 */
function scatterConfetti(): void {
  if (typeof document === 'undefined') return;
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') {
    return;
  }

  // Belt and braces: never stack two runs.
  teardown();

  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute(ARRIVAL_LAYER_ATTR, '');
  // Above the wizard's veil (z-index 69) so the burst is seen in full against
  // the dissolving wash rather than through it — the two are one moment, not
  // two. It also sits above the tour's card layer (z-65), which is safe only
  // because it takes no pointer events at any point AND the tour holds its
  // card until `arrivalHoldMs()` reaches zero. Remove that hold and the
  // confetti would draw over the Welcome card — visible, never clickable.
  el.style.cssText =
    'position:fixed;inset:0;z-index:71;pointer-events:none;overflow:hidden;';
  document.body.appendChild(el);
  layer = el;

  const started: Animation[] = [];

  // Trajectories are computed against the real viewport, so a 13" laptop and a
  // 34" monitor both get a burst that crosses a comparable share of the screen
  // rather than one that either falls short or shoots miles past the edge.
  const vw = Math.max(320, window.innerWidth || 1_280);
  const vh = Math.max(320, window.innerHeight || 800);
  // The reference throw. The diagonal, near enough — a corner cannon has to
  // cross more screen than a centre one to look like it is clearing the room.
  const reach = Math.hypot(vw, vh);

  for (const cannon of CANNONS) {
    for (let i = 0; i < PIECES_PER_CANNON; i += 1) {
      const shape = pick(PIECE_SHAPES);
      const piece = document.createElement('span');
      piece.style.cssText = [
        'position:absolute',
        // Parked at the muzzle. Just outside the corner, so nothing is ever
        // seen sitting still before it launches.
        `left:${cannon.x * 100}%`,
        `top:${cannon.y * 100}%`,
        `width:${shape.w}px`,
        `height:${shape.h}px`,
        `margin-left:${-shape.w / 2}px`,
        `margin-top:${-shape.h / 2}px`,
        `border-radius:${shape.radius}`,
        `background:${pick(PIECE_COLORS)}`,
        'opacity:0',
        'will-change:transform,opacity',
        'pointer-events:none',
      ].join(';');
      el.appendChild(piece);

      // Fired up and INWARD — `aim` is +1 for the left cannon, -1 for the
      // right — in a fan from shallow (28°, skimming across the bottom) to
      // steep (76°, straight up the side). The spread is what makes two
      // cannons read as two cannons rather than as two jets.
      const angle = rand(28, 76) * (Math.PI / 180);
      const power = reach * rand(0.42, 0.88);
      const apexX = Math.cos(angle) * power * cannon.aim;
      const apexY = -Math.sin(angle) * power;

      // After the apex, gravity. Every piece ends below the bottom edge from
      // wherever it got to, and drifts a little further inward on the way down
      // rather than dropping in a dead vertical line.
      const restX = apexX + rand(0.04, 0.22) * reach * cannon.aim;
      const restY = apexY + vh * rand(0.85, 1.6);

      // Tumble. `rotate3d` on a mixed axis flips the piece through its own
      // plane as it spins, so a flat rectangle catches and loses its face the
      // way real confetti does — which one plain `rotate()` never looks like.
      const spin = rand(420, 1_100) * (Math.random() < 0.5 ? -1 : 1);
      const axisX = rand(0.2, 1);
      const axisY = rand(0.2, 1);

      // The stagger IS the cannon. Firing 110 pieces on the same frame is a
      // single sheet leaving the corner; spread over ~340ms it is a burst with
      // a leading edge and a tail.
      const delay = rand(0, 340);
      // Long, and varied, so pieces separate in the air instead of moving as
      // one mass. Capped so the slowest piece still lands inside the run.
      const duration = rand(1_500, ARRIVAL_CONFETTI_MS - 340);

      let anim: Animation;
      try {
        anim = piece.animate(
          [
            {
              transform: `translate3d(0px, 0px, 0) rotate3d(${axisX}, ${axisY}, 0.35, 0deg)`,
              opacity: 1,
              // Out of the muzzle hard, then bleeding speed all the way to the
              // apex: the shape of a thing that was thrown, not carried.
              easing: 'cubic-bezier(0.06, 0.72, 0.24, 1)',
            },
            {
              offset: 0.42,
              transform: `translate3d(${apexX}px, ${apexY}px, 0) rotate3d(${axisX}, ${axisY}, 0.35, ${spin * 0.42}deg)`,
              opacity: 1,
              // Falling accelerates. Anything symmetrical here reads as a
              // balloon rather than as paper.
              easing: 'cubic-bezier(0.42, 0, 0.86, 0.9)',
            },
            {
              offset: 0.86,
              transform: `translate3d(${(apexX + restX) / 2}px, ${(apexY + restY) / 2}px, 0) rotate3d(${axisX}, ${axisY}, 0.35, ${spin * 0.78}deg)`,
              opacity: 1,
            },
            {
              // Only the last stretch fades, and only a little before the piece
              // is off the bottom anyway — so the burst ends by emptying the
              // frame, not by dimming in place.
              transform: `translate3d(${restX}px, ${restY}px, 0) rotate3d(${axisX}, ${axisY}, 0.35, ${spin}deg)`,
              opacity: 0,
            },
          ],
          { duration, delay, fill: 'forwards' },
        );
      } catch {
        // An engine that has `animate` but rejects these keyframes: drop the
        // whole effect rather than leave half a burst frozen on the dashboard.
        teardown();
        return;
      }
      started.push(anim);
    }
  }

  animations = started;
  finishesAt = Date.now() + ARRIVAL_CONFETTI_MS;
  // The one guarantee. Whatever the animations do or fail to do, the layer is
  // off the page at the cap.
  timer = setTimeout(teardown, ARRIVAL_CONFETTI_MS);
}

/**
 * Celebrate the arrival: one scatter of confetti, once, in silence.
 *
 * @param reduced `prefers-reduced-motion`, as resolved by the caller through
 *   motion's `useReducedMotion`. True means nothing happens at all.
 */
export function celebrateArrival(reduced: boolean): void {
  // Latch BEFORE the guard on `reduced`, so this is genuinely "the arrival has
  // happened" and not "the arrival has been drawn".
  if (celebrated) return;
  celebrated = true;
  if (reduced) return;
  scatterConfetti();
}

/**
 * How long the caller should wait for the burst to finish, in ms.
 *
 * This is the whole of the arrival's contract with the walkthrough, and the
 * reason the dependency runs this way round rather than the other: the tour
 * knows when it wants to show its Welcome card, so the tour is the thing that
 * should decide to wait. `use-first-rental-tour` adds this to its autostart
 * delay.
 *
 * Returns 0 — meaning "go now" — for every case that is not a live burst: no
 * arrival at all (an ordinary dashboard load, which is the overwhelmingly
 * common one), a reduced-motion arrival, a browser with no Web Animations API,
 * and a burst that has already finished. So the ONLY path that delays the tour
 * is the one where there is visibly something to wait for.
 */
export function arrivalHoldMs(): number {
  if (finishesAt === 0) return 0;
  return Math.max(0, finishesAt - Date.now());
}

/**
 * Undo the latch and take any live run off the page.
 *
 * FOR TESTS. Nothing in the app calls this: the celebration is once per page
 * life by design, and the wizard cannot come back without a reload because the
 * row it wrote is the thing that stops it.
 */
export function resetArrivalCelebration(): void {
  celebrated = false;
  teardown();
}
