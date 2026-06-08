# Bento Motion System — animation guide

Bento is **animation-heavy but disciplined**. Motion should make the product feel alive and
physical (Apple-flavoured), never decorative or laggy. This file is binding alongside
`DESIGN_SYSTEM.md`.

The mantra: **animate `transform` and `opacity`, spring the things that "pop", ease the things
that "travel", and always honour `prefers-reduced-motion`.**

---

## 1. Tooling (use these, don't hand-roll)

The app already ships **`tailwindcss-animate`** and **shadcn/Radix** (which expose
`data-[state=open/closed]`, `data-[side]`, etc.). Build on them, and add **`motion`**
(`motion/react`, the maintained successor to framer-motion) for orchestrated/JS-driven motion.

| Need | Use |
|------|-----|
| Popover / Dialog / Dropdown / Tooltip / Accordion enter-exit | Radix `data-[state]` + `tailwindcss-animate` utilities (`animate-in`, `fade-in`, `zoom-in-95`, `slide-in-from-*`) — already shadcn’s default; just retune durations/eases to Bento. |
| Page / route transitions, shared layout, list reordering | `motion` (`<AnimatePresence>`, `layout`, `layoutId`) |
| Staggered lists / grids | `motion` parent `variants` + `staggerChildren` |
| Number count-up (KPIs) | `motion` `useMotionValue` + `animate`, or a tiny `useCountUp` hook |
| Scroll-reveal (long pages) | `motion` `whileInView` + `viewport={{ once: true }}` |
| Press feedback | CSS `:active`/pointer transform, or `whileTap` |
| Charts draw-in | the chart lib’s animation (Recharts `isAnimationActive`) + a reveal wrapper |
| Cross-route morph (optional, progressive) | View Transitions API where supported |

Keep one **easing/duration token set** (below) and reuse it everywhere — consistency is what
makes heavy motion feel designed rather than noisy.

---

## 2. Motion tokens

Add these as constants (e.g. `lib/motion.ts`) and reuse:

```ts
export const ease = {
  spring:  [0.34, 1.56, 0.64, 1],   // overshoot — pops (modals, toggles, toasts, checks)
  sheet:   [0.32, 0.72, 0, 1],      // iOS sheet — travels (side/bottom sheets, drawers)
  out:     [0.22, 1, 0.36, 1],      // standard ease-out — most enters
  inOut:   [0.65, 0, 0.35, 1],      // symmetric — color/size tweens
};
export const dur = { xs: 0.12, sm: 0.18, md: 0.28, lg: 0.42, xl: 0.55 }; // seconds

// motion spring presets
export const springs = {
  pop:    { type: 'spring', stiffness: 520, damping: 30 },
  soft:   { type: 'spring', stiffness: 320, damping: 32 },
  snappy: { type: 'spring', stiffness: 700, damping: 38 },
};
```

Tailwind/`tailwindcss-animate` defaults are ~150ms linear — override to these so Radix
components feel Bento, e.g. `data-[state=open]:animate-in data-[state=open]:fade-in-0
data-[state=open]:zoom-in-95 duration-200 ease-[cubic-bezier(.34,1.56,.64,1)]`.

---

## 3. What animates where (the catalogue)

### App shell
- **Route change:** fade + 8px upward slide of the page body (`AnimatePresence` keyed on
  pathname), `dur.md`, `ease.out`. Sidebar/header stay put.
- **Sidebar active item:** the violet pill **slides** between items via `layoutId="nav-pill"`
  (shared-layout) — the signature shell animation.
- **Sidebar collapse/expand:** width `layout` spring (`springs.soft`).

### Tiles / cards
- **Mount:** staggered fade-up — parent `staggerChildren: 0.04`, child `y: 12 → 0`, opacity,
  `springs.soft`. Cap stagger so a 12-tile grid finishes < 400ms.
- **Hover:** lift `translateY(-2px)` + shadow grow, `dur.sm`. (Skip on touch.)
- **KPI numbers:** **count-up** from 0 (or previous value) over `dur.xl`, `ease.out`,
  tabular-nums so width doesn’t jump. Re-run when the value changes.

### Charts (inside tiles)
- Area/line **draws in** left→right on first view (`whileInView`), `dur.xl`. Bars grow from
  baseline with a small stagger. Donut sweeps its arc.

### Tables / lists
- Rows **stagger-fade** on load (cap ~10 then instant). Row **hover** bg fade `dur.sm`.
- Add/remove rows animate height+opacity via `AnimatePresence` (e.g. after creating a rental,
  the new row springs in at the top).
- Filter/sort changes use `layout` so rows glide to new positions.

### Segmented control / tabs
- The white indicator **slides** (`layout`/`layoutId` or animated left+width) with
  `springs.snappy`. Label colour cross-fades `dur.sm`.

### Inputs & forms
- Focus: ring scales in (`box-shadow` + 1.0→1 inner), `dur.sm`.
- **Validation error:** field does a 2px horizontal **shake** (`x: [0,-4,4,-3,3,0]`,
  `dur.md`) + the inline message fades/slides down. Error banner slides down from top.
- **Section checklist:** the tick **draws/pops** (`springs.pop`) when a section completes;
  turns red with a quick shake on error.
- Stepper/quantity: value flips (`y` swap) on change.

### Overlays
- **Side sheet:** scrim fade + panel `translateX(100% → 0)` with `ease.sheet`, ~`dur.xl`.
  Support **drag-to-dismiss** (pointer drag, release past threshold → spring out).
- **Modal:** scrim blur-in; card `scale(0.92 → 1)` + opacity, `springs.pop`. Exit reverses.
- **Toast:** slides up from bottom with `springs.pop`, auto-dismisses, exits downward.
- **Process overlay (multi-step actions):** each step row’s spinner→check swap is a
  `springs.pop` scale; progress bar width tweens `ease.out`; final **success check** draws
  (SVG path `pathLength 0→1`, `dur.lg`) then the card content cross-fades.

### State transitions
- **Skeleton → content:** cross-fade (skeleton out, content stagger-in) — never a hard cut.
- **Empty → populated:** the first items stagger in.
- **Theme toggle:** instant token swap (see §6 gotcha in DESIGN_SYSTEM) + one-shot overlay
  fade; the knob slides with `springs.pop`.

---

## 4. Reduced motion & accessibility (required)

- Wrap orchestrated motion so that under `prefers-reduced-motion: reduce` you **drop
  transforms and long tweens** and keep only short opacity fades (≤120ms). With `motion`, read
  `useReducedMotion()` and switch variants; with CSS, gate keyframes in
  `@media (prefers-reduced-motion: no-preference)`.
- Never block interaction on an animation — content is usable immediately; motion is garnish.
- Don’t animate scroll position programmatically in ways that fight the user.
- Keep focus rings instant and visible.

---

## 5. Performance rules

- Animate **`transform` and `opacity` only** for anything that runs frequently (hover, scroll,
  lists). Avoid animating `width/height/top/left/box-shadow` on large or many elements; use
  `transform: scale`/translate and fade a shadow layer instead.
- Add `will-change: transform` only on actively-animating nodes; remove after.
- Cap stagger counts (virtualize long lists; animate only what’s visible).
- One easing token set; avoid per-component bespoke springs.
- Target 60fps; if a chart/table animation janks, reduce or disable it there.

---

## 6. Definition of “animation-heavy, done right”
Every page has: a **route enter**, **staggered tile/row entrances**, **count-up KPIs**,
**spring overlays**, a **sliding nav/segmented indicator**, **hover lift**, and animated
**state transitions** (skeleton↔content, error shake, success draw) — all from the shared
tokens, all reduced-motion-safe, all on transform/opacity. If motion ever feels busy or slow,
it’s wrong: trim duration, reduce travel, or cut it.
